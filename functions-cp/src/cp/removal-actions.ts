/**
 * 賽事個資移除動作層（工程卡 PII-P3b）。
 *
 * - listRemovalTargets：合併 cpMine items 與 cpHostQuota.activeCids，給呼叫端列目標。
 * - acquireLease：交易取得工作文件租約（LEASE_MS），回傳隨機 holder 或 null（Opus 審 P2-1）。
 * - runRemovalJob：核心續跑；pseudo／ccKey／waiting／pending／counts 逐場落地。
 * - requestMyDataRemoval / removeProxyPlayerData / adminRemoveUserData：對外動作。
 * - buildDryRunSummary：管理員 dryRun 摘要（§4.8），digest 供確認碼比對。
 *
 * 原則：
 * - 讀取一律經 readDoc／readQuery。
 * - log、錯誤、回傳值不含 uid 原文；jobId、cid 可用。
 * - 任一場丟錯都收斂成 failed.{cid}，繼續下一場；全部結束才依 failed 是否為空判斷 done／error。
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
  newContactKey,
  newPseudonym,
  removalJobId,
  type MineRole,
  type WaitReason
} from './removal-plan.js';

// ── 共用小工具 ───────────────────────────────────────────────────────
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const FAILED_MAX_ATTEMPTS = 3;
const SUMMARY_BUDGET_MS = 40_000;

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

function parsePending(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

function parseWaitingMap(raw: unknown): Record<string, WaitReason[]> {
  const out: Record<string, WaitReason[]> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[k] = v.filter((r): r is WaitReason => typeof r === 'string') as WaitReason[];
      }
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

/** waiting 原因轉文字（P2-6：staff_active→'指派到期'，rep_contact_active／host_active→'賽事結束'）。 */
function describeUntil(reasons: WaitReason[]): string {
  const texts: string[] = [];
  for (const r of reasons) {
    if (r === 'staff_active' && !texts.includes('指派到期')) texts.push('指派到期');
    else if ((r === 'rep_contact_active' || r === 'host_active') && !texts.includes('賽事結束')) texts.push('賽事結束');
  }
  return texts.join('、');
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
/**
 * 交易取得工作租約。
 * （Opus 審 P2-1）產生隨機 holder，交易寫 leaseUntil＋leaseHolder；已被持有就回 null。
 * 續約／釋放時用 leaseHolder 確認是自己的租約才動。
 */
export async function acquireLease(deps: CpDeps, jobId: string, nowMs: number): Promise<string | null> {
  const holder = newPseudonym();
  return deps.db.runTransaction(async tx => {
    const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) return null;
    const lease = snap.get('leaseUntil');
    if (lease && typeof (lease as { toMillis?: unknown }).toMillis === 'function') {
      if ((lease as { toMillis: () => number }).toMillis() > nowMs) return null;
    }
    tx.update(ref, {
      leaseUntil: Timestamp.fromMillis(nowMs + LEASE_MS),
      leaseHolder: holder
    });
    return holder;
  });
}

/** （Opus 審 P2-1）交易續約；leaseHolder 不是自己就回 false。 */
async function renewLease(deps: CpDeps, jobId: string, holder: string, nowMs: number): Promise<boolean> {
  return deps.db.runTransaction(async tx => {
    const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) return false;
    if (snap.get('leaseHolder') !== holder) return false;
    tx.update(ref, { leaseUntil: Timestamp.fromMillis(nowMs + LEASE_MS) });
    return true;
  });
}

/** （Opus 審 P2-1）交易釋放租約；leaseHolder 不是自己就不動。 */
async function releaseLease(deps: CpDeps, jobId: string, holder: string): Promise<void> {
  await deps.db.runTransaction(async tx => {
    const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) return;
    if (snap.get('leaseHolder') !== holder) return;
    tx.update(ref, { leaseUntil: null, leaseHolder: FieldValue.delete() });
  });
}

/**
 * （Opus 審 P2-1）交易「沒有才寫」pseudo.{cid}／ccKey.{cid}；已有就沿用。
 * 回傳兩個值；工作文件不存在回 null。
 */
async function ensurePseudoAndCcKey(
  deps: CpDeps, jobId: string, cid: string
): Promise<{ pseudo: string; ccKey: string } | null> {
  return deps.db.runTransaction(async tx => {
    const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) return null;
    const pseudoNow = snap.get(`pseudo.${cid}`);
    const ccKeyNow = snap.get(`ccKey.${cid}`);
    let pseudo = typeof pseudoNow === 'string' && pseudoNow ? pseudoNow : '';
    let ccKey = typeof ccKeyNow === 'string' && ccKeyNow ? ccKeyNow : '';
    const updates: Record<string, unknown> = {};
    if (!pseudo) {
      pseudo = newPseudonym();
      updates[`pseudo.${cid}`] = pseudo;
    }
    if (!ccKey) {
      ccKey = newContactKey();
      updates[`ccKey.${cid}`] = ccKey;
    }
    if (Object.keys(updates).length > 0) tx.update(ref, updates);
    return { pseudo, ccKey };
  });
}

/**
 * （Opus 審 P2-1／P2-3）交易內套用單場結果：讀取工作文件最新 pending／waiting／counts → 套用差異 → 寫回。
 * - res.waiting 非空：cid 從 pending 移除、記 waiting.{cid}；保留 pseudo／ccKey。
 * - res.waiting 空且 res.more：cid 移到 pending 尾端；保留 pseudo／ccKey。
 * - 都空：cid 完成 → 從 pending 移除、刪 waiting／pseudo／ccKey。
 * - counts 以交易內讀到的最新值為基礎累加（不依賴記憶體快照）。
 * - 清掉 failed.{cid}。
 */
async function applyCompResult(
  deps: CpDeps, jobId: string, cid: string, res: CompResult
): Promise<void> {
  await deps.db.runTransaction(async tx => {
    const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) return;
    const data = snap.data() as Record<string, unknown>;
    const pendingNow = parsePending(data.pending);
    const updates: Record<string, unknown> = {};

    if (res.waiting.length > 0) {
      updates.pending = pendingNow.filter(c => c !== cid);
      updates[`waiting.${cid}`] = res.waiting;
    } else if (res.more) {
      // 移到尾端：先移除、再 arrayUnion 追加（交易內兩步都原子）
      updates.pending = pendingNow.filter(c => c !== cid);
      updates[`waiting.${cid}`] = FieldValue.delete();
      // 用 FieldValue.arrayUnion 分兩步（同筆交易內，陣列最終順序不受本次交易外影響）
      // 先寫過濾後的陣列，再用 arrayUnion 追回尾端（避免在交易內重組後 append 順序混亂）
      updates.pending = FieldValue.arrayUnion(cid);
      // 但 arrayUnion 不會移除既有 cid；需先 arrayRemove，改採下面步驟：
      delete updates.pending;
      updates.pending = FieldValue.arrayRemove(cid);
      updates[`__pendingAppend.${cid}`] = true; // 佔位：D 步驟在交易外追加（見下方註解）
    } else {
      updates.pending = pendingNow.filter(c => c !== cid);
      updates[`waiting.${cid}`] = FieldValue.delete();
      updates[`pseudo.${cid}`] = FieldValue.delete();
      updates[`ccKey.${cid}`] = FieldValue.delete();
    }

    const newCounts = accumulateCounts(snap.get('counts'), res.counts);
    updates.counts = newCounts;
    updates[`failed.${cid}`] = FieldValue.delete();
    updates.lastRunAt = FieldValue.serverTimestamp();
    tx.update(ref, updates);
  });

  // P2-3 more：交易外再一步 arrayUnion 加回尾端（避開「先 arrayRemove 再 arrayUnion」在交易外不能拆兩步的限制）。
  if (res.waiting.length === 0 && res.more) {
    const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
    await ref.update({ pending: FieldValue.arrayUnion(cid) });
  }
}

/**
 * （Opus 審 P2-2）交易內登記一場失敗：failed.{cid} = { reason, attempts: 原值+1 }。
 * attempts < 3 → 移到 pending 尾端；≥ 3 → 從 pending 移除、留在 failed（不重試）。
 */
async function applyCompFailure(
  deps: CpDeps, jobId: string, cid: string, reason: string
): Promise<void> {
  const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
  let shouldRequeue = false;
  await deps.db.runTransaction(async tx => {
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) return;
    const data = snap.data() as Record<string, unknown>;
    const pendingNow = parsePending(data.pending);
    const failedNow = snap.get(`failed.${cid}`) as { attempts?: unknown } | undefined;
    const curAttempts = failedNow && typeof failedNow === 'object'
      && typeof (failedNow as { attempts?: unknown }).attempts === 'number'
      ? (failedNow as { attempts: number }).attempts
      : 0;
    const nextAttempts = curAttempts + 1;
    const updates: Record<string, unknown> = {
      [`failed.${cid}`]: { reason, attempts: nextAttempts },
      lastError: reason,
      lastRunAt: FieldValue.serverTimestamp()
    };
    const filtered = pendingNow.filter(c => c !== cid);
    if (nextAttempts < FAILED_MAX_ATTEMPTS) {
      shouldRequeue = true;
      updates.pending = filtered;  // 先移除
    } else {
      updates.pending = filtered;  // 從 pending 移除，留在 failed
    }
    tx.update(ref, updates);
  });
  if (shouldRequeue) {
    await ref.update({ pending: FieldValue.arrayUnion(cid) });
  }
}

/**
 * （Opus 審 P2-1／P2-2／P2-3）結束時依最新工作文件狀態判斷：
 * - pending 與 waiting 都空：failed 也空 → done（刪 uid／pseudo／ccKey）；failed 不空 → status 'error'（保留 uid，回傳 partial）。
 * - pending 空、waiting 非空 → status 'waiting'。
 * - pending 非空 → status 'queued'。
 * 只有 leaseHolder 仍是自己才釋放租約。
 */
async function finalizeJob(
  deps: CpDeps, jobId: string, holder: string, processed: number
): Promise<{ status: 'done' | 'partial' | 'waiting'; processed: number; waiting: Array<{ cid: string; reason: WaitReason }> }> {
  let result: { status: 'done' | 'partial' | 'waiting'; processed: number; waiting: Array<{ cid: string; reason: WaitReason }> } =
    { status: 'partial', processed, waiting: [] };
  try {
    await deps.db.runTransaction(async tx => {
      const ref = deps.db.doc(`cpRemovalJobs/${jobId}`);
      const snap = await readDoc(deps, tx, ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (snap.get('leaseHolder') !== holder) {
        result = { status: 'partial', processed, waiting: [] };
        return;
      }
      const pendingNow = parsePending(data.pending);
      const waitingNow = parseWaitingMap(data.waiting);
      const failedRaw = data.failed;
      const failedKeys: string[] = failedRaw && typeof failedRaw === 'object' && !Array.isArray(failedRaw)
        ? Object.keys(failedRaw as Record<string, unknown>)
        : [];
      const waitList = waitingListOf(waitingNow);

      if (pendingNow.length === 0 && Object.keys(waitingNow).length === 0) {
        if (failedKeys.length === 0) {
          tx.update(ref, {
            status: 'done',
            uid: FieldValue.delete(),
            pseudo: FieldValue.delete(),
            ccKey: FieldValue.delete(),
            doneAt: FieldValue.serverTimestamp(),
            leaseUntil: null,
            leaseHolder: FieldValue.delete(),
            lastRunAt: FieldValue.serverTimestamp(),
            lastError: null
          });
          result = { status: 'done', processed, waiting: [] };
        } else {
          // 有 failed：交管理員；保留 uid
          tx.update(ref, {
            status: 'error',
            leaseUntil: null,
            leaseHolder: FieldValue.delete(),
            lastRunAt: FieldValue.serverTimestamp()
          });
          result = { status: 'partial', processed, waiting: waitList };
        }
      } else if (pendingNow.length === 0) {
        tx.update(ref, {
          status: 'waiting',
          leaseUntil: null,
          leaseHolder: FieldValue.delete(),
          lastRunAt: FieldValue.serverTimestamp()
        });
        result = { status: 'waiting', processed, waiting: waitList };
      } else {
        tx.update(ref, {
          status: 'queued',
          leaseUntil: null,
          leaseHolder: FieldValue.delete(),
          lastRunAt: FieldValue.serverTimestamp()
        });
        result = { status: 'partial', processed, waiting: waitList };
      }
    });
  } catch {
    // 交易失敗：不往外丟，租約之後會自然過期；回目前進度
  }
  return result;
}

// ── 3. runRemovalJob ─────────────────────────────────────────────────
/**
 * 續跑一份工作。
 * - 先取得租約；開頭讀取與結尾寫入都包 try（Opus 審 P3-3）。
 * - 先處理 pending，再處理 waiting 中尚未在 pending 的 cid。
 * - 每場前先交易續約；leaseHolder 不是自己就停止（回目前進度 partial）。
 * - 每場先 ensurePseudoAndCcKey（交易內「沒有才寫」），再 processCompetition → pseudonymizeAudits。
 * - 每場結果在交易內套用（applyCompResult）；丟錯登記 failed 並繼續下一場（P2-2）。
 * - 達 maxComps 或 budgetMs 就停。
 */
export async function runRemovalJob(
  deps: CpDeps, jobId: string, opts: { maxComps: number; budgetMs: number }
): Promise<{ status: 'done' | 'partial' | 'waiting'; processed: number; waiting: Array<{ cid: string; reason: WaitReason }> }> {
  const jobRef = deps.db.doc(`cpRemovalJobs/${jobId}`);
  const startMs = deps.now().getTime();

  let holder: string | null;
  try {
    holder = await acquireLease(deps, jobId, deps.now().getTime());
  } catch {
    return { status: 'partial', processed: 0, waiting: [] };
  }
  if (!holder) return { status: 'partial', processed: 0, waiting: [] };

  let processed = 0;

  try {
    const startSnap = await readDoc(deps, null, jobRef);
    if (!startSnap.exists) {
      await releaseLease(deps, jobId, holder).catch(() => undefined);
      return { status: 'partial', processed: 0, waiting: [] };
    }
    const startData = startSnap.data() as Record<string, unknown>;
    const uid = typeof startData.uid === 'string' ? startData.uid : '';
    if (!uid) {
      await releaseLease(deps, jobId, holder).catch(() => undefined);
      return { status: 'partial', processed: 0, waiting: [] };
    }

    const startPending = parsePending(startData.pending);
    const startWaiting = parseWaitingMap(startData.waiting);

    const order: string[] = [...startPending];
    for (const c of Object.keys(startWaiting)) {
      if (!startPending.includes(c)) order.push(c);
    }

    for (const cid of order) {
      if (processed >= opts.maxComps) break;
      if (deps.now().getTime() - startMs >= opts.budgetMs) break;

      // （Opus 審 P2-1）每場前交易續約，leaseHolder 不是自己就停
      let renewed: boolean;
      try {
        renewed = await renewLease(deps, jobId, holder, deps.now().getTime());
      } catch {
        renewed = false;
      }
      if (!renewed) break;

      try {
        const ctx = await ensurePseudoAndCcKey(deps, jobId, cid);
        if (!ctx) throw pre('JOB_GONE');
        const res: CompResult = await processCompetition(deps, uid, cid, {
          pseudo: ctx.pseudo, ccKey: ctx.ccKey, dryRun: false
        });
        await pseudonymizeAudits(deps, cid, actorHash(cid, uid), ctx.pseudo, { dryRun: false });
        await applyCompResult(deps, jobId, cid, res);
        processed += 1;
      } catch (e) {
        // （Opus 審 P2-2）一場失敗不卡整份：登記 failed、繼續下一場
        const reason = e instanceof CpError ? e.reason : 'INTERNAL';
        try {
          await applyCompFailure(deps, jobId, cid, reason);
        } catch { /* 盡力而為 */ }
        processed += 1;
      }
    }
  } catch {
    // （Opus 審 P3-3）任何未預期錯誤都回目前進度、不往外丟
    try {
      await releaseLease(deps, jobId, holder);
    } catch { /* 盡力而為 */ }
    return { status: 'partial', processed, waiting: [] };
  }

  return finalizeJob(deps, jobId, holder, processed);
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

  if (snap.exists) {
    // （Opus 審 P2-1）對既有工作只用 arrayUnion 加 pending，不整份覆寫 pending／waiting
    const updates: Record<string, unknown> = {
      kind: 'self',
      uid,
      status: 'queued',
      requestedAt: FieldValue.serverTimestamp()
    };
    if (targets.cids.length > 0) {
      updates.pending = FieldValue.arrayUnion(...targets.cids);
    }
    await jobRef.update(updates);
  } else {
    await jobRef.set({
      kind: 'self',
      uid,
      status: 'queued',
      pending: [...targets.cids],
      waiting: {},
      pseudo: {},
      ccKey: {},
      failed: {},
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
    entryRegistrantClear: number; entryContactClear: number; addedByClear: number;
    staffNameClear: number; staffDelete: number; controlDelete: number;
    hostDisplayReset: number; publicByClear: number;
    auditPseudonymize: number; scorerAuditRekey: number; invitePseudonymize: number;
    cpMineDelete: number;
  };
  later: { reasons: WaitReason[]; until: string } | null;
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
  /** （Opus 審 P2-6）digest 計算要包含 reasonCode。 */
  reasonCode: string;
}

/**
 * 管理員 dryRun 摘要。逐場跑 processCompetition / pseudonymizeAudits 的 dryRun（只讀不寫），
 * 依計數推估寫入量。摘要內容不含 uid 原文；查詢失敗記 warning 並續下一場。
 * 回傳物件不含 generatedAt／confirmToken／expiresAt，供 dryRunDigest 使用。
 *
 * （Opus 審 P3-4）加時間預算 40 秒（deps.now()）；用完就停、warnings 加 SUMMARY_TRUNCATED。
 * （Opus 審 P2-6）now 列出 counts 全部鍵＋auditPseudonymize／scorerAuditRekey／invitePseudonymize；
 *                later 給 { reasons, until }；collections 補 invites 與（account_deleted 時）cpHostQuota。
 */
export async function buildDryRunSummary(
  deps: CpDeps, uid: string, reasonCode: string
): Promise<DryRunSummary> {
  const readsStart = deps.meter?.reads ?? 0;
  const wallStart = deps.now().getTime();
  const deadline = wallStart + SUMMARY_BUDGET_MS;
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
    if (deps.now().getTime() >= deadline) {
      warnings.push('SUMMARY_TRUNCATED');
      break;
    }
    try {
      const res = await processCompetition(deps, uid, cid, { pseudo: 'dryrun', ccKey: 'dryrun', dryRun: true });
      const auditRes = await pseudonymizeAudits(deps, cid, actorHash(cid, uid), 'dryrun', { dryRun: true });

      const compSnap = await readDoc(deps, null, deps.db.doc(`competitions/${cid}`));
      const rawName = compSnap.exists ? compSnap.get('name') : null;
      const name = typeof rawName === 'string' ? [...rawName].slice(0, 30).join('') : '';

      const now = {
        rosterDelete: res.counts.rosterDelete,
        rosterDeidentify: res.counts.rosterDeidentify,
        statsNameReplace: res.counts.statsNameReplace,
        entryRegistrantClear: res.counts.entryRegistrantClear,
        entryContactClear: res.counts.entryContactClear,
        addedByClear: res.counts.addedByClear,
        staffNameClear: res.counts.staffNameClear,
        staffDelete: res.counts.staffDelete,
        controlDelete: res.counts.controlDelete,
        hostDisplayReset: res.counts.hostDisplayReset,
        publicByClear: res.counts.publicByClear,
        auditPseudonymize: auditRes.auditPseudonymize,
        scorerAuditRekey: auditRes.scorerAuditRekey,
        invitePseudonymize: auditRes.invitePseudonymize,
        cpMineDelete: res.counts.cpMineDelete
      };

      if (res.waiting.length > 0) {
        competitions.push({
          cid, name, roles: res.roles, phase: res.phase, now,
          later: { reasons: res.waiting, until: describeUntil(res.waiting) }
        });
      } else {
        competitions.push({ cid, name, roles: res.roles, phase: res.phase, now, later: null });
      }

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
      if (c.entryRegistrantClear > 0) addColl('competitions/{cid}/entryPrivate', 'update', c.entryRegistrantClear);
      if (c.entryContactClear > 0) addColl('competitions/{cid}/entryPrivate', 'update', c.entryContactClear);
      if (c.staffNameClear > 0) addColl('competitions/{cid}/staff', 'update', c.staffNameClear);
      if (c.staffDelete > 0) addColl('competitions/{cid}/staff', 'delete', c.staffDelete);
      if (c.controlDelete > 0) addColl('competitions/{cid}/matches/{mtId}/control', 'delete', c.controlDelete);
      if (c.hostDisplayReset > 0 || c.publicByClear > 0) addColl('competitions/{cid}', 'update', 1);
      if (c.cpMineDelete > 0) addColl('cpMine/{uid}/items', 'delete', c.cpMineDelete);
      if (auditRes.auditPseudonymize > 0) addColl('competitions/{cid}/audits', 'update', auditRes.auditPseudonymize);
      if (auditRes.scorerAuditRekey > 0) addColl('competitions/{cid}/audits', 'create+delete', auditRes.scorerAuditRekey);
      if (auditRes.invitePseudonymize > 0) addColl('competitions/{cid}/invites', 'update', auditRes.invitePseudonymize);
    } catch (e) {
      if (isFailedPreconditionError(e)) warnings.push(`INDEX_MISSING:${cid}`);
      else warnings.push(`QUERY_FAILED:${cid}`);
      continue;
    }
  }

  if (targets.truncated) warnings.push('PENDING_TRUNCATED');

  // （Opus 審 P2-6）account_deleted 另刪 cpHostQuota/{uid}——不綁迴圈，全域一筆
  if (reasonCode === 'account_deleted') addColl('cpHostQuota/{uid}', 'delete', 1);

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
    irreversible: ['真名', '報隊聯絡資料', '記分員顯示名', '稽核雜湊改假名', '邀請建立者雜湊改假名'],
    notTouched: ['比賽紀錄（timeline）', '檢舉紀錄（依 180 天規則另行處理）', '主站會員資料'],
    estimatedReads: (deps.meter?.reads ?? 0) - readsStart,
    warnings,
    reasonCode
  };
}

/**
 * 管理員移除。
 * （Opus 審 P2-6／P3-6）
 * dryRun=true：工作文件只寫 dryRun: { token, issuedAtMs, digest, reasonCode }、kind:'admin'；不寫 uid。
 *             工作不存在就建立只含這些欄位與 status:'done'、pending:[] 的文件。
 * dryRun=false：先重算摘要與 digest；transaction 內比對 reasonCode、token、digest、消耗 dryRun、
 *            寫 uid／kind／reasonCode／adminActor／pending（arrayUnion）、status 'queued'。
 *            並行兩次只會有一次成功（另一次 DRY_RUN_REQUIRED）。
 *            truncated 的摘要（warnings 含 SUMMARY_TRUNCATED）不得拿來執行 → SUMMARY_TOO_LARGE。
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
    const summary = await buildDryRunSummary(deps, uid, reasonCode);
    const digest = dryRunDigest(summary);
    const token = newConfirmToken();

    const snap = await readDoc(deps, null, jobRef);
    if (snap.exists) {
      // 既有工作：只更新 dryRun 與 kind（不寫 uid）
      await jobRef.update({
        kind: 'admin',
        dryRun: { token, issuedAtMs: nowMs, digest, reasonCode }
      });
    } else {
      // 工作不存在：建立只含 dryRun 相關欄位與 status done、pending [] 的文件
      await jobRef.set({
        kind: 'admin',
        dryRun: { token, issuedAtMs: nowMs, digest, reasonCode },
        status: 'done',
        pending: []
      });
    }

    return {
      dryRun: true,
      subject: jobId.slice(0, 10),
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
  const summary = await buildDryRunSummary(deps, uid, reasonCode);
  if (summary.warnings.includes('SUMMARY_TRUNCATED')) {
    // （Opus 審 P3-4）truncated 摘要不得拿來執行
    throw pre('SUMMARY_TOO_LARGE');
  }
  const digest = dryRunDigest(summary);
  const targets = await listRemovalTargets(deps, uid);
  const adminActor = actorHash('cpAdmin', caller.uid);

  // （Opus 審 P2-6）確認碼在交易內消耗；reasonCode／token／digest 都比對
  await deps.db.runTransaction(async tx => {
    const snap = await readDoc(deps, tx, jobRef);
    if (!snap.exists) throw pre('DRY_RUN_REQUIRED');
    const saved = snap.get('dryRun') as
      { token?: unknown; issuedAtMs?: unknown; digest?: unknown; reasonCode?: unknown }
      | null | undefined;
    if (!saved || typeof saved !== 'object') throw pre('DRY_RUN_REQUIRED');
    if (saved.reasonCode !== reasonCode) throw pre('DRY_RUN_STALE');
    const check = checkConfirmToken(saved, input.confirmToken, digest, deps.now().getTime());
    if (check === 'required') throw pre('DRY_RUN_REQUIRED');
    if (check === 'stale') throw pre('DRY_RUN_STALE');

    const updates: Record<string, unknown> = {
      dryRun: FieldValue.delete(),
      kind: 'admin',
      uid,
      reasonCode,
      adminActor,
      status: 'queued',
      requestedAt: FieldValue.serverTimestamp()
    };
    if (targets.cids.length > 0) {
      updates.pending = FieldValue.arrayUnion(...targets.cids);
    }
    tx.update(jobRef, updates);
  });

  if (reasonCode === 'account_deleted') {
    try {
      await deps.db.doc(`cpHostQuota/${uid}`).delete();
    } catch { /* 盡力而為；不影響賽事資料移除 */ }
  }

  return runRemovalJob(deps, jobId, { maxComps: CALLABLE_MAX_COMPS, budgetMs: CALLABLE_BUDGET_MS });
}
