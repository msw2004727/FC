/**
 * 賽事個資移除動作層（工程卡 PII-P3b）。
 *
 * - listRemovalTargets：合併 cpMine items 與 cpHostQuota.activeCids，給呼叫端列目標。
 * - acquireLease：交易取得工作文件租約（LEASE_MS）。
 * - runRemovalJob：核心續跑；pseudo／waiting／pending／counts 逐場落地。
 * - requestMyDataRemoval / removeProxyPlayerData / adminRemoveUserData：對外動作。
 * - buildDryRunSummary：管理員 dryRun 摘要（§4.8），digest 供確認碼比對。
 *
 * 原則：
 * - 讀取一律經 readDoc／readQuery。
 * - log、錯誤、回傳值不含 uid 原文；jobId、cid 可用。
 * - 任一場丟錯都收斂成 lastError＋attempts+1，不往外丟；由排程或呼叫者續跑。
 */
import { FieldPath } from 'firebase-admin/firestore';
import {
  CID_RE,
  FieldValue,
  PLID_RE,
  Timestamp,
  actorHash,
  assertCompVisible,
  isAdmin,
  isClubRep,
  isHostOrCo,
  loadComp,
  readDoc,
  readQuery,
  requireId,
  writeAudit,
  type Caller,
  type CompDoc,
  type CpDeps,
  type GateResult
} from './context.js';
import { CpError, bad, deny, notFound, pre } from './errors.js';
import { onlyKeys, requireEnum } from './validate.js';
import {
  processCompetition,
  pseudonymizeAudits,
  type CompCounts,
  type CompResult
} from './removal.js';
import {
  ANON_PLAYER,
  CALLABLE_BUDGET_MS,
  CALLABLE_MAX_COMPS,
  DRY_RUN_TTL_MS,
  LEASE_MS,
  PENDING_PAGE,
  REMOVAL_RATE_MS,
  checkConfirmToken,
  dryRunDigest,
  newConfirmToken,
  newPseudonym,
  removalJobId,
  type MineRole,
  type WaitReason
} from './removal-plan.js';

// ── 共用小工具 ───────────────────────────────────────────────────────
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function emptyCompCounts(): CompCounts {
  return {
    rosterDelete: 0, rosterDeidentify: 0, statsNameReplace: 0,
    entryRegistrantClear: 0, entryContactClear: 0, addedByClear: 0,
    staffNameClear: 0, staffDelete: 0, controlDelete: 0,
    hostDisplayReset: 0, publicByClear: 0, cpMineDelete: 0
  };
}

function accumulateCounts(existing: unknown, add: CompCounts): CompCounts {
  const base = emptyCompCounts();
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    for (const k of Object.keys(base) as Array<keyof CompCounts>) {
      const v = (existing as Record<string, unknown>)[k];
      if (typeof v === 'number') base[k] = v;
    }
  }
  for (const k of Object.keys(add) as Array<keyof CompCounts>) {
    base[k] = (base[k] ?? 0) + add[k];
  }
  return base;
}

function waitingListOf(map: Record<string, WaitReason[]>): Array<{ cid: string; reason: WaitReason }> {
  const out: Array<{ cid: string; reason: WaitReason }> = [];
  for (const [cid, reasons] of Object.entries(map)) {
    if (Array.isArray(reasons) && reasons.length > 0) {
      out.push({ cid, reason: reasons[0]! });
    }
  }
  return out;
}

function isFailedPreconditionError(e: unknown): boolean {
  const code = (e as { code?: unknown }).code;
  if (code === 9 || code === 'failed-precondition' || code === 'FAILED_PRECONDITION') return true;
  const msg = String((e as { message?: unknown })?.message ?? e);
  return msg.includes('FAILED_PRECONDITION');
}

/** 台北時區 ISO 8601（+08:00、秒級）。 */
function taipeiIso(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 19) + '+08:00';
}

// ── 1. listRemovalTargets ─────────────────────────────────────────────
/**
 * 列出某 uid 的移除目標 cid。
 * 來源：cpMine/{uid}/items（limit PENDING_PAGE+1，超過就 truncated）＋cpHostQuota/{uid}.activeCids。
 * 合併去重；cpMine 超過 PENDING_PAGE 時只回 PENDING_PAGE 筆且 truncated=true（下一輪刪掉的會讓清單前進）。
 */
export async function listRemovalTargets(
  deps: CpDeps, uid: string
): Promise<{ cids: string[]; truncated: boolean }> {
  const itemsSnap = await readQuery(
    deps, null, deps.db.collection(`cpMine/${uid}/items`).limit(PENDING_PAGE + 1)
  );
  const truncated = itemsSnap.size > PENDING_PAGE;
  const cids = new Set<string>();
  for (let i = 0; i < Math.min(itemsSnap.docs.length, PENDING_PAGE); i += 1) {
    cids.add(itemsSnap.docs[i]!.id);
  }
  const quotaSnap = await readDoc(deps, null, deps.db.doc(`cpHostQuota/${uid}`));
  if (quotaSnap.exists) {
    const raw = quotaSnap.get('activeCids');
    if (Array.isArray(raw)) {
      for (const c of raw) if (typeof c === 'string') cids.add(c);
    }
  }
  return { cids: [...cids], truncated };
}

// ── 2. acquireLease ──────────────────────────────────────────────────
/** 交易取得工作租約；已被持有就回 false。 */
export async function acquireLease(deps: CpDeps, jobId: string, nowMs: number): Promise<boolean> {
  return deps.db.runTransaction(async tx => {
    const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) return false;
    const lease = snap.get('leaseUntil');
    if (lease && typeof (lease as { toMillis?: unknown }).toMillis === 'function') {
      if ((lease as { toMillis: () => number }).toMillis() > nowMs) return false;
    }
    tx.update(ref, { leaseUntil: Timestamp.fromMillis(nowMs + LEASE_MS) });
    return true;
  });
}

// ── 3. runRemovalJob ─────────────────────────────────────────────────
/**
 * 續跑一份工作。
 * - 先處理 pending，再處理 waiting（waiting 中的 cid 也再跑一次 processCompetition，依當下狀態決定是否解除）。
 * - 每個 cid 先確保 pseudo 落地，再 processCompetition → pseudonymizeAudits。
 * - 達 maxComps 或 budgetMs 就停。
 * - 結束：pending 空且 waiting 空 → done／uid 欄位刪除；pending 空但 waiting 非空 → waiting；否則 partial。
 * - 任一場丟錯：記 lastError、attempts+1、釋放租約、回目前進度 partial，不往外丟。
 */
export async function runRemovalJob(
  deps: CpDeps, jobId: string, opts: { maxComps: number; budgetMs: number }
): Promise<{ status: 'done' | 'partial' | 'waiting'; processed: number; waiting: Array<{ cid: string; reason: WaitReason }> }> {
  const jobRef = deps.db.doc(`cpRemovalJobs/${jobId}`);

  let acquired: boolean;
  try {
    acquired = await acquireLease(deps, jobId, deps.now().getTime());
  } catch {
    return { status: 'partial', processed: 0, waiting: [] };
  }
  if (!acquired) return { status: 'partial', processed: 0, waiting: [] };

  const startSnap = await readDoc(deps, null, jobRef);
  if (!startSnap.exists) {
    return { status: 'partial', processed: 0, waiting: [] };
  }
  const startData = startSnap.data() as Record<string, unknown>;
  const uid = typeof startData.uid === 'string' ? startData.uid : '';
  if (!uid) {
    await jobRef.update({ leaseUntil: null });
    return { status: 'partial', processed: 0, waiting: [] };
  }

  const startMs = deps.now().getTime();
  let processed = 0;

  let counts = accumulateCounts(startData.counts, emptyCompCounts());
  let pending = Array.isArray(startData.pending)
    ? (startData.pending as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  let waiting: Record<string, WaitReason[]> = {};
  if (startData.waiting && typeof startData.waiting === 'object' && !Array.isArray(startData.waiting)) {
    for (const [k, v] of Object.entries(startData.waiting as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        waiting[k] = v.filter((r): r is WaitReason => typeof r === 'string') as WaitReason[];
      }
    }
  }
  const pseudoMap: Record<string, string> = {};
  if (startData.pseudo && typeof startData.pseudo === 'object' && !Array.isArray(startData.pseudo)) {
    for (const [k, v] of Object.entries(startData.pseudo as Record<string, unknown>)) {
      if (typeof v === 'string') pseudoMap[k] = v;
    }
  }

  // 處理順序：pending 先、waiting 中還沒在 pending 的次之
  const order: string[] = [...pending];
  for (const c of Object.keys(waiting)) {
    if (!pending.includes(c)) order.push(c);
  }

  try {
    for (const cid of order) {
      if (processed >= opts.maxComps) break;
      if (deps.now().getTime() - startMs >= opts.budgetMs) break;

      // 確保 pseudo 先落地（避免重跑換假名）
      let pseudo = pseudoMap[cid];
      if (!pseudo) {
        pseudo = newPseudonym();
        pseudoMap[cid] = pseudo;
        await jobRef.update({ [`pseudo.${cid}`]: pseudo });
      }

      const res: CompResult = await processCompetition(deps, uid, cid, { pseudo, dryRun: false });
      await pseudonymizeAudits(deps, cid, actorHash(cid, uid), pseudo, { dryRun: false });
      processed += 1;

      counts = accumulateCounts(counts, res.counts);

      const updates: Record<string, unknown> = {
        lastRunAt: FieldValue.serverTimestamp(),
        counts
      };

      if (res.waiting.length > 0) {
        waiting[cid] = res.waiting;
        pending = pending.filter(c => c !== cid);
        updates.pending = pending;
        updates[`waiting.${cid}`] = res.waiting;
      } else {
        delete waiting[cid];
        delete pseudoMap[cid];
        pending = pending.filter(c => c !== cid);
        updates.pending = pending;
        updates[`waiting.${cid}`] = FieldValue.delete();
        updates[`pseudo.${cid}`] = FieldValue.delete();
      }

      await jobRef.update(updates);
    }
  } catch (e) {
    const reason = e instanceof CpError ? e.reason : 'INTERNAL';
    try {
      await jobRef.update({
        lastError: reason,
        attempts: FieldValue.increment(1),
        leaseUntil: null,
        lastRunAt: FieldValue.serverTimestamp()
      });
    } catch { /* 盡力而為 */ }
    return { status: 'partial', processed, waiting: waitingListOf(waiting) };
  }

  const done = pending.length === 0;
  const waitingEmpty = Object.keys(waiting).length === 0;

  if (done && waitingEmpty) {
    await jobRef.update({
      status: 'done',
      uid: FieldValue.delete(),
      pseudo: FieldValue.delete(),
      doneAt: FieldValue.serverTimestamp(),
      leaseUntil: null,
      lastRunAt: FieldValue.serverTimestamp(),
      lastError: null
    });
    return { status: 'done', processed, waiting: [] };
  }
  if (done) {
    await jobRef.update({
      status: 'waiting',
      leaseUntil: null,
      lastRunAt: FieldValue.serverTimestamp(),
      lastError: null
    });
    return { status: 'waiting', processed, waiting: waitingListOf(waiting) };
  }
  await jobRef.update({
    status: 'queued',
    leaseUntil: null,
    lastRunAt: FieldValue.serverTimestamp(),
    lastError: null
  });
  return { status: 'partial', processed, waiting: waitingListOf(waiting) };
}

// ── 4. requestMyDataRemoval ─────────────────────────────────────────
/** 本人移除。只有 confirm=='REMOVE'；60 秒內重按回 REMOVAL_RATE_LIMITED。 */
export async function requestMyDataRemoval(
  deps: CpDeps, caller: Caller, input: Record<string, unknown>
): Promise<{ status: 'done' | 'partial' | 'waiting'; processed: number; waiting: Array<{ cid: string; reason: WaitReason }> }> {
  onlyKeys(input, ['action', 'confirm']);
  if (input.confirm !== 'REMOVE') throw bad('CONFIRM_REQUIRED');

  const uid = caller.uid;
  const jobId = removalJobId(uid);
  const jobRef = deps.db.doc(`cpRemovalJobs/${jobId}`);
  const nowMs = deps.now().getTime();

  const snap = await readDoc(deps, null, jobRef);
  if (snap.exists) {
    const requestedAt = snap.get('requestedAt');
    if (requestedAt && typeof (requestedAt as { toMillis?: unknown }).toMillis === 'function') {
      if (nowMs - (requestedAt as { toMillis: () => number }).toMillis() < REMOVAL_RATE_MS) {
        throw new CpError('resource-exhausted', 'REMOVAL_RATE_LIMITED');
      }
    }
  }

  const targets = await listRemovalTargets(deps, uid);
  const existingPending: string[] = snap.exists && Array.isArray(snap.get('pending'))
    ? (snap.get('pending') as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const existingWaitingKeys: string[] = snap.exists && snap.get('waiting') && typeof snap.get('waiting') === 'object'
    ? Object.keys(snap.get('waiting') as Record<string, unknown>)
    : [];
  const merged = new Set<string>([...existingPending, ...existingWaitingKeys, ...targets.cids]);

  if (snap.exists) {
    // 保留既有 pseudo／waiting／counts
    await jobRef.update({
      kind: 'self',
      uid,
      status: 'queued',
      pending: [...merged],
      requestedAt: FieldValue.serverTimestamp()
    });
  } else {
    await jobRef.set({
      kind: 'self',
      uid,
      status: 'queued',
      pending: [...merged],
      waiting: {},
      pseudo: {},
      leaseUntil: null,
      attempts: 0,
      lastError: null,
      requestedAt: FieldValue.serverTimestamp(),
      counts: emptyCompCounts()
    });
  }

  return runRemovalJob(deps, jobId, { maxComps: CALLABLE_MAX_COMPS, budgetMs: CALLABLE_BUDGET_MS });
}

// ── 5. removeProxyPlayerData ────────────────────────────────────────
/** 代表／主辦／管理員對「代填球員」去識別。冪等：已去識別過就回成功、不重寫。 */
export async function removeProxyPlayerData(
  deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>
): Promise<{ cid: string; plId: string; deidentified: true }> {
  onlyKeys(input, ['action', 'cid', 'plId', 'confirm']);
  if (input.confirm !== 'REMOVE') throw bad('CONFIRM_REQUIRED');
  const cid = requireId(input.cid, CID_RE, 'cid');
  const plId = requireId(input.plId, PLID_RE, 'plId');

  return deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);

    const rpRef = deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`);
    const rpSnap = await readDoc(deps, tx, rpRef);
    if (!rpSnap.exists) throw notFound('PLAYER_NOT_FOUND');
    if (rpSnap.get('source') !== 'rep') throw pre('NOT_PROXY_PLAYER');

    // 權限：管理員、俱樂部主辦代表、主辦或共同主辦
    let allowed = isAdmin(caller);
    if (!allowed && comp.hostType === 'club' && typeof comp.hostTeamId === 'string') {
      allowed = (await isClubRep(deps, tx, comp.hostTeamId, caller.uid)).ok;
    }
    if (!allowed) {
      const hostOk = await isHostOrCo(deps, tx, cid, comp, caller);
      if (!hostOk) throw deny('NOT_ROSTER_OWNER');
    }

    const rosterRef = deps.db.doc(`competitions/${cid}/roster/${plId}`);
    const rosterSnap = await readDoc(deps, tx, rosterRef);
    const dvId = rpSnap.get('dvId');
    const curRealName = rpSnap.get('realName');
    const curDisplayName = rosterSnap.exists ? rosterSnap.get('displayName') : null;
    const alreadyDeid = curRealName === null && curDisplayName === ANON_PLAYER;

    if (alreadyDeid) return { cid, plId, deidentified: true };

    // 讀 stats（dv 檔案）→ 找 m.*.{plId}.n 存在者
    let statsSnap: Awaited<ReturnType<typeof readDoc>> | null = null;
    let statsHits: string[] = [];
    if (rosterSnap.exists && typeof dvId === 'string' && dvId) {
      statsSnap = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/stats/${dvId}`));
      if (statsSnap.exists) {
        const m = statsSnap.get('m');
        if (m && typeof m === 'object' && !Array.isArray(m)) {
          for (const mtId of Object.keys(m as Record<string, unknown>)) {
            const row = (m as Record<string, unknown>)[mtId];
            if (row && typeof row === 'object' && !Array.isArray(row)) {
              const line = (row as Record<string, unknown>)[plId];
              if (line && typeof line === 'object' && 'n' in (line as Record<string, unknown>)) {
                statsHits.push(mtId);
              }
            }
          }
        }
      }
    }

    // 寫入
    if (rosterSnap.exists) {
      tx.update(rosterRef, { displayName: ANON_PLAYER });
    }
    tx.update(rpRef, {
      realName: null,
      addedByUid: null,
      removedAt: FieldValue.serverTimestamp()
    });
    if (statsSnap && statsSnap.exists && statsHits.length > 0) {
      const args: unknown[] = [];
      for (const mtId of statsHits) {
        args.push(new FieldPath('m', mtId, plId, 'n'));
        args.push(ANON_PLAYER);
      }
      const statsRef = deps.db.doc(`competitions/${cid}/stats/${dvId}`);
      const fn = tx.update.bind(tx) as (r: unknown, ...rest: unknown[]) => unknown;
      fn(statsRef, ...args);
    }
    writeAudit(deps, tx, cid, caller, 'removeProxyPlayerData', { plId });

    return { cid, plId, deidentified: true };
  });
}

// ── 6. adminRemoveUserData + buildDryRunSummary ─────────────────────

interface SummaryComp {
  cid: string;
  name: string;
  roles: MineRole[];
  phase: 'roster_open' | 'started' | 'ended';
  now: {
    rosterDelete: number; rosterDeidentify: number; statsNameReplace: number;
    entryRegistrantClear: number; addedByClear: number; staffNameClear: number;
    hostDisplayReset: number; publicByClear: number;
    auditPseudonymize: number; scorerAuditRekey: number; cpMineDelete: number;
  };
  later: { reason: WaitReason } | null;
}

interface SummaryCollection { path: string; op: string; count: number }

interface DryRunSummary {
  competitions: SummaryComp[];
  collections: SummaryCollection[];
  totals: { competitions: number; writesNow: number; writesLater: number };
  irreversible: string[];
  notTouched: string[];
  estimatedReads: number;
  warnings: string[];
}

/**
 * 管理員 dryRun 摘要。逐場跑 processCompetition / pseudonymizeAudits 的 dryRun（只讀不寫），
 * 依計數推估寫入量。摘要內容不含 uid 原文；查詢失敗記 warning 並續下一場。
 * 回傳物件不含 generatedAt／confirmToken／expiresAt，供 dryRunDigest 使用。
 */
export async function buildDryRunSummary(deps: CpDeps, uid: string): Promise<DryRunSummary> {
  const startsAt = deps.meter?.reads ?? 0;
  const targets = await listRemovalTargets(deps, uid);
  const competitions: SummaryComp[] = [];
  const warnings: string[] = [];
  const collMap = new Map<string, number>();

  const addColl = (path: string, op: string, count: number) => {
    if (count <= 0) return;
    const k = `${path}|${op}`;
    collMap.set(k, (collMap.get(k) ?? 0) + count);
  };

  for (const cid of targets.cids) {
    try {
      const res = await processCompetition(deps, uid, cid, { pseudo: 'dryrun', dryRun: true });
      const auditRes = await pseudonymizeAudits(deps, cid, actorHash(cid, uid), 'dryrun', { dryRun: true });

      const compSnap = await readDoc(deps, null, deps.db.doc(`competitions/${cid}`));
      const rawName = compSnap.exists ? compSnap.get('name') : null;
      const name = typeof rawName === 'string' ? [...rawName].slice(0, 30).join('') : '';

      const now = {
        rosterDelete: res.counts.rosterDelete,
        rosterDeidentify: res.counts.rosterDeidentify,
        statsNameReplace: res.counts.statsNameReplace,
        entryRegistrantClear: res.counts.entryRegistrantClear,
        addedByClear: res.counts.addedByClear,
        staffNameClear: res.counts.staffNameClear,
        hostDisplayReset: res.counts.hostDisplayReset,
        publicByClear: res.counts.publicByClear,
        auditPseudonymize: auditRes.auditPseudonymize,
        scorerAuditRekey: auditRes.scorerAuditRekey,
        cpMineDelete: res.counts.cpMineDelete
      };

      if (res.waiting.length > 0) {
        competitions.push({
          cid, name, roles: res.roles, phase: res.phase, now,
          later: { reason: res.waiting[0]! }
        });
      } else {
        competitions.push({ cid, name, roles: res.roles, phase: res.phase, now, later: null });
      }

      // 依計數累積 collections
      const c = res.counts;
      if (c.rosterDelete > 0) {
        addColl('competitions/{cid}/roster', 'delete', c.rosterDelete);
        addColl('competitions/{cid}/rosterPrivate', 'delete', c.rosterDelete);
      }
      if (c.rosterDeidentify > 0) {
        addColl('competitions/{cid}/roster', 'update', c.rosterDeidentify);
        addColl('competitions/{cid}/rosterPrivate', 'update', c.rosterDeidentify);
      }
      if (c.addedByClear > 0) addColl('competitions/{cid}/rosterPrivate', 'update', c.addedByClear);
      if (c.statsNameReplace > 0) addColl('competitions/{cid}/stats', 'update', c.statsNameReplace);
      if (c.entryRegistrantClear > 0 || c.entryContactClear > 0) {
        addColl('competitions/{cid}/entryPrivate', 'update',
          Math.max(c.entryRegistrantClear, c.entryContactClear));
      }
      if (c.staffNameClear > 0) addColl('competitions/{cid}/staff', 'update', c.staffNameClear);
      if (c.staffDelete > 0) addColl('competitions/{cid}/staff', 'delete', c.staffDelete);
      if (c.controlDelete > 0) addColl('competitions/{cid}/matches/{mtId}/control', 'delete', c.controlDelete);
      if (c.hostDisplayReset > 0 || c.publicByClear > 0) addColl('competitions/{cid}', 'update', 1);
      if (c.cpMineDelete > 0) addColl('cpMine/{uid}/items', 'delete', c.cpMineDelete);
      if (auditRes.auditPseudonymize > 0) addColl('competitions/{cid}/audits', 'update', auditRes.auditPseudonymize);
      if (auditRes.scorerAuditRekey > 0) addColl('competitions/{cid}/audits', 'create+delete', auditRes.scorerAuditRekey);
    } catch (e) {
      if (isFailedPreconditionError(e)) warnings.push(`INDEX_MISSING:${cid}`);
      else warnings.push(`QUERY_FAILED:${cid}`);
      continue;
    }
  }

  if (targets.truncated) warnings.push('PENDING_TRUNCATED');

  const collections: SummaryCollection[] = [];
  for (const [k, count] of collMap) {
    const sep = k.lastIndexOf('|');
    collections.push({ path: k.slice(0, sep), op: k.slice(sep + 1), count });
  }

  let writesNow = 0;
  for (const c of competitions) {
    for (const v of Object.values(c.now)) writesNow += v;
  }
  let writesLater = 0;
  for (const c of competitions) if (c.later) writesLater += 1;

  return {
    competitions,
    collections,
    totals: { competitions: competitions.length, writesNow, writesLater },
    irreversible: ['真名', '報隊聯絡資料', '記分員顯示名', '稽核雜湊改假名'],
    notTouched: ['比賽紀錄（timeline）', '檢舉紀錄（依 180 天規則另行處理）', '主站會員資料'],
    estimatedReads: (deps.meter?.reads ?? 0) - startsAt,
    warnings
  };
}

/**
 * 管理員移除。dryRun=true 只寫工作文件的 dryRun 欄位（kind/uid/reasonCode）與空 pending；
 * dryRun=false 需 confirmToken，重算摘要＋digest 比對；成功才清 dryRun、設 pending、跑工作。
 * reasonCode='account_deleted' 時另刪 cpHostQuota/{uid}。
 */
export async function adminRemoveUserData(
  deps: CpDeps, caller: Caller, input: Record<string, unknown>
): Promise<unknown> {
  onlyKeys(input, ['action', 'uid', 'reasonCode', 'dryRun', 'confirmToken']);
  if (!isAdmin(caller)) throw deny('ADMIN_ONLY');
  const uid = requireId(input.uid, UID_RE, 'uid');
  const reasonCode = requireEnum(input.reasonCode, ['account_deleted', 'subject_request'] as const, 'reasonCode');
  const dryRun = input.dryRun !== false;

  const jobId = removalJobId(uid);
  const jobRef = deps.db.doc(`cpRemovalJobs/${jobId}`);
  const nowMs = deps.now().getTime();

  if (dryRun) {
    const summary = await buildDryRunSummary(deps, uid);
    const digest = dryRunDigest(summary);
    const token = newConfirmToken();

    const snap = await readDoc(deps, null, jobRef);
    const base: Record<string, unknown> = {
      kind: 'admin',
      uid,
      reasonCode,
      dryRun: { token, issuedAtMs: nowMs, digest }
    };
    if (snap.exists) {
      await jobRef.update(base);
    } else {
      await jobRef.set({
        ...base,
        status: 'queued',
        pending: [],
        waiting: {},
        pseudo: {},
        leaseUntil: null,
        attempts: 0,
        lastError: null,
        requestedAt: FieldValue.serverTimestamp(),
        counts: emptyCompCounts()
      });
    }

    return {
      dryRun: true,
      subject: jobId.slice(0, 10),
      reasonCode,
      generatedAt: taipeiIso(nowMs),
      confirmToken: token,
      expiresAt: taipeiIso(nowMs + DRY_RUN_TTL_MS),
      ...summary
    };
  }

  // dryRun=false
  if (typeof input.confirmToken !== 'string' || !input.confirmToken) {
    throw pre('DRY_RUN_REQUIRED');
  }
  const summary = await buildDryRunSummary(deps, uid);
  const digest = dryRunDigest(summary);

  const snap = await readDoc(deps, null, jobRef);
  if (!snap.exists) throw pre('DRY_RUN_REQUIRED');
  const saved = snap.get('dryRun') as { token?: unknown; issuedAtMs?: unknown; digest?: unknown } | null | undefined;
  const check = checkConfirmToken(saved, input.confirmToken, digest, deps.now().getTime());
  if (check === 'required') throw pre('DRY_RUN_REQUIRED');
  if (check === 'stale') throw pre('DRY_RUN_STALE');

  const targets = await listRemovalTargets(deps, uid);
  await jobRef.update({
    dryRun: FieldValue.delete(),
    kind: 'admin',
    uid, // 若前一次工作已完成而被刪 uid 欄位，這裡補回
    reasonCode,
    status: 'queued',
    pending: targets.cids
  });

  if (reasonCode === 'account_deleted') {
    try {
      await deps.db.doc(`cpHostQuota/${uid}`).delete();
    } catch { /* 盡力而為；不影響賽事資料移除 */ }
  }

  return runRemovalJob(deps, jobId, { maxComps: CALLABLE_MAX_COMPS, budgetMs: CALLABLE_BUDGET_MS });
}
