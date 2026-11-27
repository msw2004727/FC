/**
 * 賽事個資移除核心（工程卡 PII-P3a）。
 *
 * T1：`processCompetition` —— 單場 runTransaction。讀完全部在寫入之前（含 prepareMine 的讀）。
 *     名單依 phase 刪除或去識別、代表聯絡資料清除、staff/記分員指派刪除、主辦公開欄位去識別、
 *     cpMine 條目刪除或更新、寫一筆 dataRemoval 稽核（actor 用假名，不用 writeAudit 的雜湊）。
 * T2：`pseudonymizeAudits` —— 分批把 audits 中 `actor`／`details.target`／`prev` 等於 oldHash 的
 *     換成 pseudo，並把接手稽核 `tk_{ms}_{mtId}_{oldHash}` 改成新 id 後刪舊 id。可重跑（冪等）。
 *
 * 原則：
 * - 所有讀取經 `readDoc`／`readQuery`，供讀取計數（context.ts）。
 * - 交易的寫入全部在讀取之後。dryRun 時只讀不寫（同一套讀取與計數）。
 * - 任何 log、錯誤、回傳值都不含 uid 原文（僅回 cid 與數量）。
 * - 純函式（planCompetition、competitionEnded、ANON_PLAYER、ANON_HOST）在 removal-plan.ts。
 */
import {
  FieldPath,
  type DocumentReference,
  type DocumentSnapshot,
  type QuerySnapshot,
  type Transaction
} from 'firebase-admin/firestore';
import {
  actorHash,
  FieldValue,
  Timestamp,
  readDoc,
  readQuery,
  type CompDoc,
  type CpDeps
} from './context.js';
import { prepareMine } from './mine.js';
import {
  ANON_HOST,
  ANON_PLAYER,
  auditExpireAtMs,
  competitionEnded,
  newPseudonym,
  planCompetition,
  type MineRole,
  type WaitReason
} from './removal-plan.js';

export type { MineRole, WaitReason } from './removal-plan.js';

// ── 型別 ─────────────────────────────────────────────────────────────
export interface CompCounts {
  rosterDelete: number; rosterDeidentify: number; statsNameReplace: number;
  entryRegistrantClear: number; entryContactClear: number; addedByClear: number;
  staffNameClear: number; staffDelete: number; controlDelete: number;
  hostDisplayReset: number; publicByClear: number; cpMineDelete: number;
}

export interface CompResult {
  cid: string;
  skipped: boolean;                 // 賽事不存在或 deletingAt 有值
  roles: MineRole[];                // 有效角色（cpMine ∪ 查到資料 implied ∪ staff 文件角色）
  phase: 'roster_open' | 'started' | 'ended';
  counts: CompCounts;
  waiting: WaitReason[];
  more: boolean;                    // 任一有限查詢回滿（尚有未處理資料）
}

// ── 小工具 ───────────────────────────────────────────────────────────
const MINE_ROLES: readonly MineRole[] = ['host', 'coHost', 'rep', 'player', 'scorer', 'referee'];

function emptyCounts(): CompCounts {
  return {
    rosterDelete: 0, rosterDeidentify: 0, statsNameReplace: 0,
    entryRegistrantClear: 0, entryContactClear: 0, addedByClear: 0,
    staffNameClear: 0, staffDelete: 0, controlDelete: 0,
    hostDisplayReset: 0, publicByClear: 0, cpMineDelete: 0
  };
}

function mineRolesOf(snap: DocumentSnapshot): MineRole[] {
  if (!snap.exists) return [];
  const raw = snap.get('roles');
  if (!Array.isArray(raw)) return [];
  const found = new Set<string>();
  for (const r of raw) if (typeof r === 'string') found.add(r);
  return MINE_ROLES.filter(r => found.has(r));
}

function stringListOf(snap: DocumentSnapshot, field: string): string[] {
  if (!snap.exists) return [];
  const raw = snap.get(field);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/** 名單階段內（同 entry.ts assertRosterPhase 條件；不丟錯，回布林）。 */
function rosterPhaseOpen(comp: CompDoc, nowMs: number): boolean {
  if (comp.status !== 'published') return false;
  if (comp.hidden) return false;
  if (comp.endedAt) return false;
  if (comp.rostersLockedAt) return false;
  if (nowMs >= comp.firstMatchAt.toMillis()) return false;
  return true;
}

/** staff 指派是否仍有效：roles 含 scorer 或 referee、（expiresAt 為 null 或 > now）、且賽事未結束。 */
function staffActiveOf(snap: DocumentSnapshot, ended: boolean, nowMs: number): boolean {
  if (!snap.exists) return false;
  const roles = snap.get('roles');
  if (!Array.isArray(roles)) return false;
  const scored = roles.includes('scorer') || roles.includes('referee');
  if (!scored) return false;
  if (ended) return false;
  const exp = snap.get('expiresAt');
  if (exp == null) return true;
  if (typeof (exp as { toMillis?: unknown }).toMillis === 'function') {
    return nowMs < (exp as { toMillis: () => number }).toMillis();
  }
  return false;
}

/** 以一次 tx.update 送出多個 FieldPath：path1, value1, path2, value2, ... */
function updatePaths(tx: Transaction, ref: DocumentReference, pairs: Array<{ path: FieldPath; value: unknown }>): void {
  if (pairs.length === 0) return;
  const args: unknown[] = [];
  for (const p of pairs) {
    args.push(p.path);
    args.push(p.value);
  }
  const fn = tx.update.bind(tx) as (r: DocumentReference, ...rest: unknown[]) => Transaction;
  fn(ref, ...args);
}

// ── T1：單場交易 ─────────────────────────────────────────────────────
/**
 * 對 `cid` 跑一場個資移除。`dryRun: true` 只做讀取與計數（不寫任何文件）。
 * 回傳 skipped=true 時不寫任何東西（含稽核），roles 仍照讀。
 * 任何 log 與回傳值只帶 cid、數量、roles、waiting。
 */
export async function processCompetition(
  deps: CpDeps, uid: string, cid: string,
  opts: { pseudo: string; ccKey: string; dryRun: boolean }
): Promise<CompResult> {
  const nowMs = deps.now().getTime();
  const compRef = deps.db.doc(`competitions/${cid}`);
  const mineRef = deps.db.doc(`cpMine/${uid}/items/${cid}`);
  const staffRef = deps.db.doc(`competitions/${cid}/staff/${uid}`);
  const h = actorHash(cid, uid);

  type ScorerRead = { mtId: string; snap: DocumentSnapshot };

  return deps.db.runTransaction(async tx => {
    // ── 讀 1：賽事根
    const compSnap = await readDoc(deps, tx, compRef);
    // ── 讀 2：cpMine（roles；即使賽事不存在也照讀）
    const mineSnap = await readDoc(deps, tx, mineRef);
    const roles = mineRolesOf(mineSnap);

    if (!compSnap.exists) {
      return {
        cid, skipped: true, roles, phase: 'started' as const, counts: emptyCounts(), waiting: [], more: false
      };
    }
    const comp = compSnap.data() as CompDoc;
    if (comp.deletingAt) {
      return {
        cid, skipped: true, roles, phase: 'started' as const, counts: emptyCounts(), waiting: [], more: false
      };
    }

    // ── 讀 3：staff/{uid}
    const staffSnap = await readDoc(deps, tx, staffRef);
    const staffExists = staffSnap.exists;
    const staffMatchIds = staffExists ? stringListOf(staffSnap, 'matchIds') : [];
    const staffDisplayName = staffExists ? staffSnap.get('displayName') : null;

    let more = false;
    // ── 讀 4：rosterPrivate where uid == uid（limit 5）＋對應 roster
    const myPrivQ = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/rosterPrivate`)
      .where('uid', '==', uid).limit(5));
    const myPrivs = myPrivQ.docs;
    if (myPrivQ.size === 5) more = true;
    for (const p of myPrivs) {
      await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/roster/${p.id}`));
    }

    // ── 讀 5：entryPrivate where registeredByUid == uid（limit 20）
    const regByQ = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/entryPrivate`)
      .where('registeredByUid', '==', uid).limit(20));
    const regByDocs = regByQ.docs;
    if (regByQ.size === 20) more = true;
    // ── 讀 5b：之前處理時標記「結束後再清聯絡資料」的報隊（registeredByUid 已清，靠標記找回）
    //     ccKey 由呼叫端每場另外產生，不可由假名推導（Opus 審 P1）。
    const ccQ = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/entryPrivate`)
      .where('contactClearKey', '==', opts.ccKey).limit(20));
    if (ccQ.size === 20) more = true;
    const regByIds = new Set(regByDocs.map(d => d.id));
    const ccDocs = ccQ.docs.filter(d => !regByIds.has(d.id));

    // ── 讀 6：rosterPrivate where addedByUid == uid（limit 60）
    const addedByQ = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/rosterPrivate`)
      .where('addedByUid', '==', uid).limit(60));
    const addedByDocs = addedByQ.docs;
    if (addedByQ.size === 60) more = true;

    // （Opus 審 P2-4）有效角色：cpMine ∪ 查到資料 implied ∪ staff 文件角色。
    const effectiveRoleSet = new Set<MineRole>(roles);
    if (myPrivs.length > 0) effectiveRoleSet.add('player');
    // 只有報隊人或聯絡標記才推定為代表；只代填過球員不算（否則會不必要地等到賽事結束，Opus 複審 P3-d）。
    // 代填人欄位 addedByUid 另外「查到就清」，不靠角色。
    if (regByDocs.length > 0 || ccDocs.length > 0) effectiveRoleSet.add('rep');
    if (staffExists) {
      const staffRoles = stringListOf(staffSnap, 'roles');
      if (staffRoles.includes('scorer')) effectiveRoleSet.add('scorer');
      if (staffRoles.includes('referee')) effectiveRoleSet.add('referee');
      if (staffRoles.includes('host')) effectiveRoleSet.add('host');
      if (staffRoles.includes('coHost')) effectiveRoleSet.add('coHost');
    }
    const effectiveRoles = MINE_ROLES.filter(r => effectiveRoleSet.has(r));

    // ── 階段與 plan
    const ended = competitionEnded(comp, nowMs);
    const openNow = rosterPhaseOpen(comp, nowMs);
    const phase: 'roster_open' | 'started' | 'ended' = ended ? 'ended' : (openNow ? 'roster_open' : 'started');
    const staffActive = staffActiveOf(staffSnap, ended, nowMs);
    const plan = planCompetition({
      roles: effectiveRoles, ended, rosterPhaseOpen: openNow, staffActive, deleting: false
    });

    // （Opus 審 P3-9）名單刪除：entries 先在讀階段讀完，寫階段只對存在的文件 increment。
    const rosterEntrySnaps = new Map<string, DocumentSnapshot>();
    if (plan.roster === 'delete') {
      const enIds = new Set<string>();
      for (const p of myPrivs) {
        const enId = p.get('enId');
        if (typeof enId === 'string' && enId) enIds.add(enId);
      }
      for (const enId of enIds) {
        rosterEntrySnaps.set(enId, await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/entries/${enId}`)));
      }
    }

    // ── 讀 7：若會去識別名單 —— 讀 stats/{dvId}（dvId 去重 ≤8）
    const statsSnaps = new Map<string, DocumentSnapshot>();
    if (plan.roster === 'deidentify') {
      const dvSet = new Set<string>();
      for (const p of myPrivs) {
        const dv = p.get('dvId');
        if (typeof dv === 'string' && dv) dvSet.add(dv);
      }
      const dvList = [...dvSet].slice(0, 8);
      for (const dvId of dvList) {
        const s = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/stats/${dvId}`));
        statsSnaps.set(dvId, s);
      }
    }

    // ── 讀 8：若計畫要刪 staff —— 讀 control/scorer（≤100）
    const scorers: ScorerRead[] = [];
    if (plan.staffDelete) {
      const cap = Math.min(staffMatchIds.length, 100);
      for (let i = 0; i < cap; i += 1) {
        const mtId = staffMatchIds[i]!;
        const snap = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/matches/${mtId}/control/scorer`));
        scorers.push({ mtId, snap });
      }
    }

    // ── 讀 9：主辦/共同主辦 —— standings where manualOverride.by == h
    let standingsDocs: DocumentSnapshot[] = [];
    if (plan.hostPublicReset) {
      const q = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/standings`)
        .where('manualOverride.by', '==', h).limit(50));
      if (q.size === 50) more = true;
      standingsDocs = q.docs;
    }

    // ── 讀 10：若計畫不是 mineDelete 且有球員被處理 → prepareMine
    //    一個人在同一賽事最多一份名單（entry.ts ALREADY_IN_ROSTER）；用第一筆 plId 一次搞定。
    const firstPlId = myPrivs[0]?.id ?? null;
    const processingPlayer = plan.roster === 'delete' || plan.roster === 'deidentify';
    let writeMine: (() => void) | null = null;
    if (!plan.mineDelete && processingPlayer && firstPlId) {
      writeMine = await prepareMine(deps, tx, uid, cid, comp, { removePlayer: firstPlId });
    }

    // ── 計數（從已讀資料算出）
    const counts = emptyCounts();

    if (plan.roster === 'delete') counts.rosterDelete = myPrivs.length;
    if (plan.roster === 'deidentify') counts.rosterDeidentify = myPrivs.length;

    // statsNameReplace：m.{mtId}.{plId}.n 存在數
    const statsUpdates = new Map<string, Array<{ mtId: string; plId: string }>>();
    if (plan.roster === 'deidentify') {
      for (const p of myPrivs) {
        const dvId = p.get('dvId');
        if (typeof dvId !== 'string') continue;
        const s = statsSnaps.get(dvId);
        if (!s || !s.exists) continue;
        const m = s.get('m');
        if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
        const hits: Array<{ mtId: string; plId: string }> = [];
        for (const mtId of Object.keys(m as Record<string, unknown>)) {
          const row = (m as Record<string, unknown>)[mtId];
          if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
          const line = (row as Record<string, unknown>)[p.id];
          if (line && typeof line === 'object' && 'n' in (line as Record<string, unknown>)) {
            hits.push({ mtId, plId: p.id });
          }
        }
        if (hits.length > 0) {
          counts.statsNameReplace += hits.length;
          statsUpdates.set(dvId, hits);
        }
      }
    }

    if (plan.repRegistrantClear) counts.entryRegistrantClear = regByDocs.length;
    counts.addedByClear = addedByDocs.length;
    if (plan.repContactClear) counts.entryContactClear = regByDocs.length + ccDocs.length;

    if (!plan.staffDelete && plan.staffNameClear && staffExists && staffDisplayName != null) {
      counts.staffNameClear = 1;
    }
    if (plan.staffDelete && staffExists) counts.staffDelete = 1;

    if (plan.staffDelete) {
      for (const s of scorers) {
        if (s.snap.exists && s.snap.get('uid') === uid) counts.controlDelete += 1;
      }
    }

    if (plan.hostDisplayReset && comp.hostDisplay !== ANON_HOST) counts.hostDisplayReset = 1;

    // publicByClear：notices（元素 by==h）＋ standings（查詢已篩）
    const rawNotices: unknown = comp.notices;
    const noticesChangedHits: Array<{ index: number }> = [];
    if (plan.hostPublicReset && Array.isArray(rawNotices)) {
      rawNotices.forEach((n, i) => {
        if (n && typeof n === 'object' && (n as Record<string, unknown>).by === h) {
          noticesChangedHits.push({ index: i });
        }
      });
    }
    if (plan.hostPublicReset) {
      counts.publicByClear = noticesChangedHits.length + standingsDocs.length;
    }

    if (plan.mineDelete && mineSnap.exists) counts.cpMineDelete = 1;

    // ── 寫入階段（dryRun 跳過）
    if (!opts.dryRun) {
      // roster 'delete'：刪 rosterPrivate + roster，更新 entries 的 rosterCount/rosterConfirmed
      if (plan.roster === 'delete') {
        for (const p of myPrivs) {
          const plId = p.id;
          const enId = p.get('enId');
          tx.delete(deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`));
          tx.delete(deps.db.doc(`competitions/${cid}/roster/${plId}`));
          if (typeof enId === 'string' && enId && rosterEntrySnaps.get(enId)?.exists) {
            tx.update(deps.db.doc(`competitions/${cid}/entries/${enId}`), {
              rosterCount: FieldValue.increment(-1),
              rosterConfirmed: false,
              updatedAt: FieldValue.serverTimestamp()
            });
          }
        }
      }

      // roster 'deidentify'：公開名改成 ANON_PLAYER、rosterPrivate 去識別、stats 名字改 ANON_PLAYER
      // 原始暱稱是 LINE 名，去識別要一併清掉
      if (plan.roster === 'deidentify') {
        for (const p of myPrivs) {
          const plId = p.id;
          tx.update(deps.db.doc(`competitions/${cid}/roster/${plId}`), {
            displayName: ANON_PLAYER,
            originalName: FieldValue.delete(),
            nickname: FieldValue.delete(),
            nameSource: FieldValue.delete()
          });
          tx.update(deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`), {
            uid: null,
            realName: null,
            removedAt: FieldValue.serverTimestamp()
          });
        }
        // stats：每個 dv 文件一次 update，多個 FieldPath 交替參數
        for (const [dvId, hits] of statsUpdates) {
          const ref = deps.db.doc(`competitions/${cid}/stats/${dvId}`);
          const pairs: Array<{ path: FieldPath; value: unknown }> = [];
          for (const hit of hits) {
            pairs.push({ path: new FieldPath('m', hit.mtId, hit.plId, 'n'), value: ANON_PLAYER });
          }
          updatePaths(tx, ref, pairs);
        }
      }

      // repRegistrantClear：entryPrivate 清 registeredByUid；rosterPrivate 清 addedByUid；
      // repContactClear：同批 entryPrivate 清聯絡人
      if (plan.repRegistrantClear) {
        for (const d of regByDocs) {
          const update: Record<string, unknown> = { registeredByUid: null };
          if (plan.repContactClear) {
            update.contactName = null;
            update.contactPhone = null;
            update.contactClearKey = FieldValue.delete();
          } else {
            // 賽事未結束：聯絡資料留著給主辦聯絡，結束後由排程用標記找回再清
            update.contactClearKey = opts.ccKey;
          }
          tx.update(d.ref, update);
        }
        if (plan.repContactClear) {
          for (const d of ccDocs) {
            tx.update(d.ref, { contactName: null, contactPhone: null, contactClearKey: FieldValue.delete() });
          }
        }
      }
      // 代填人欄位查到就清，不看角色（Opus 複審 P3-d、審查 P2-4）
      for (const d of addedByDocs) {
        tx.update(d.ref, { addedByUid: null });
      }

      // staffNameClear：僅在非 staffDelete 時
      if (!plan.staffDelete && plan.staffNameClear && staffExists && staffDisplayName != null) {
        tx.update(staffRef, { displayName: null });
      }

      // staffDelete：刪 staff；刪 control/scorer（uid 相符的）
      if (plan.staffDelete) {
        if (staffExists) tx.delete(staffRef);
        for (const s of scorers) {
          if (s.snap.exists && s.snap.get('uid') === uid) {
            tx.delete(s.snap.ref);
          }
        }
      }

      // 根文件的 hostDisplay / notices / updatedAt 合在一次 update
      const rootUpdates: Record<string, unknown> = {};
      if (plan.hostDisplayReset && counts.hostDisplayReset > 0) {
        rootUpdates.hostDisplay = ANON_HOST;
      }
      if (plan.hostPublicReset && Array.isArray(rawNotices) && noticesChangedHits.length > 0) {
        const nextNotices = rawNotices.map(n => {
          if (n && typeof n === 'object' && (n as Record<string, unknown>).by === h) {
            return { ...(n as Record<string, unknown>), by: null };
          }
          return n;
        });
        rootUpdates.notices = nextNotices;
      }
      if (Object.keys(rootUpdates).length > 0) {
        rootUpdates.updatedAt = FieldValue.serverTimestamp();
        tx.update(compRef, rootUpdates);
      }

      // standings.manualOverride.by = null（standingsDocs 已由 where 篩出）
      if (plan.hostPublicReset) {
        for (const d of standingsDocs) {
          tx.update(d.ref, new FieldPath('manualOverride', 'by'), null);
        }
      }

      // mine：mineDelete 刪 cpMine，否則若 prepareMine 有回傳寫入函式就呼叫
      if (plan.mineDelete && mineSnap.exists) {
        tx.delete(mineRef);
      } else if (writeMine) {
        writeMine();
      }

      // 稽核（不用 writeAudit）。actor 每次寫入都用新假名，避免與 T2 的 pseudo 相同而標出「這個假名申請了移除」；
      // counts 全 0 且 waiting 空時不寫（Opus 審 P3-2）。
      const auditTotal = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
      if (auditTotal > 0 || plan.waiting.length > 0) {
        const auditCounts: Record<string, number> = {};
        for (const k of Object.keys(counts) as Array<keyof CompCounts>) {
          auditCounts[k] = counts[k];
        }
        tx.create(deps.db.collection(`competitions/${cid}/audits`).doc(), {
          action: 'dataRemoval',
          actor: newPseudonym(),
          actorIsAdmin: false,
          details: { counts: auditCounts, waiting: plan.waiting },
          at: FieldValue.serverTimestamp(),
          expireAt: Timestamp.fromMillis(auditExpireAtMs(deps.now().getTime(), comp.lastMatchAt ? comp.lastMatchAt.toMillis() : null))
        });
      }
    }

    return { cid, skipped: false, roles: effectiveRoles, phase, counts, waiting: plan.waiting, more };
  });
}

// ── T2：稽核假名化 ───────────────────────────────────────────────────
/** 把一批（limit 400）符合 baseQuery 的稽核對應欄位改成 pseudo；回傳本批處理的筆數。 */
async function pseudonymizeBatch(
  deps: CpDeps, baseQuery: ReturnType<CpDeps['db']['collection']> extends unknown ? any : any,
  field: string | FieldPath, pseudo: string
): Promise<number> {
  const snap = await readQuery(deps, null, (baseQuery as { limit: (n: number) => unknown }).limit(400) as never);
  if (snap.empty) return 0;
  const batch = deps.db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, field, pseudo);
  }
  await batch.commit();
  return snap.size;
}

/**
 * T2：把 `competitions/{cid}/audits` 中 actor／details.target／prev 等於 oldHash 的改成 pseudo，
 * 並把接手稽核 `tk_{ms}_{mtId}_{oldHash}` 換成新 id。
 * `dryRun: true` 只計數，不寫。
 *
 * 迴圈策略：非 dryRun 為「寫了就查不到（actor/prev/... → pseudo）」，天然冪等；每批 ≤400。
 * dryRun 用 orderBy(documentId) 游標分頁。
 */
export async function pseudonymizeAudits(
  deps: CpDeps, cid: string, oldHash: string, pseudo: string, opts: { dryRun: boolean }
): Promise<{ auditPseudonymize: number; scorerAuditRekey: number; invitePseudonymize: number; inviteOpenRemaining: number }> {
  const auditsColl = deps.db.collection(`competitions/${cid}/audits`);
  let auditPseudonymize = 0;

  // 三種查詢：actor、details.target、prev
  const queries: Array<{ q: ReturnType<typeof auditsColl.where>; field: string | FieldPath }> = [
    { q: auditsColl.where('actor', '==', oldHash), field: 'actor' },
    { q: auditsColl.where('details.target', '==', oldHash), field: new FieldPath('details', 'target') },
    { q: auditsColl.where('prev', '==', oldHash), field: 'prev' }
  ];

  for (const { q, field } of queries) {
    if (opts.dryRun) {
      // 游標分頁計數
      let lastId: string | null = null;
      while (true) {
        const page: QuerySnapshot = lastId == null
          ? await readQuery(deps, null, q.orderBy(FieldPath.documentId()).limit(400))
          : await readQuery(deps, null, q.orderBy(FieldPath.documentId()).startAfter(lastId).limit(400));
        if (page.empty) break;
        auditPseudonymize += page.size;
        lastId = page.docs[page.docs.length - 1]!.id;
        if (page.size < 400) break;
      }
      continue;
    }
    // 非 dryRun：改完就查不到，loop 到空為止
    while (true) {
      const snap = await readQuery(deps, null, q.limit(400));
      if (snap.empty) break;
      const batch = deps.db.batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, field, pseudo);
      }
      await batch.commit();
      auditPseudonymize += snap.size;
    }
  }

  // 接手稽核 id 改假名（id 形如 tk_{ms}_{mtId}_{oldHash}，結尾換 pseudo）
  const scorerAuditRekey = await rekeyScorerAudits(deps, cid, oldHash, pseudo, opts);

  // （Opus 審 P2-7／複審 P2-D）invites.createdBy 也是主辦讀得到的雜湊。開放中且未到期的邀請保留：
  // participant.ts 接受邀請仍用 createdBy 驗發行者；不是 open、或已過期（過期後狀態仍可能是 open）的才改假名。
  // 仍有開放未到期的邀請時回 inviteOpenRemaining，呼叫端讓這場進入等待（invite_open），到期後再處理。
  const invitesColl = deps.db.collection(`competitions/${cid}/invites`);
  const inviteSnap = await readQuery(deps, null, invitesColl.where('createdBy', '==', oldHash).limit(400));
  const nowMs = deps.now().getTime();
  const inviteOpenActive = (d: { get(f: string): unknown }) => {
    if (d.get('status') !== 'open') return false;
    const exp = d.get('expiresAt') as { toMillis?: () => number } | null | undefined;
    return !(exp && typeof exp.toMillis === 'function' && exp.toMillis() <= nowMs);
  };
  const inviteHits = inviteSnap.docs.filter(d => !inviteOpenActive(d));
  const inviteOpenRemaining = inviteSnap.docs.length - inviteHits.length;
  if (!opts.dryRun && inviteHits.length > 0) {
    const batch = deps.db.batch();
    for (const d of inviteHits) batch.update(d.ref, 'createdBy', pseudo);
    await batch.commit();
  }
  const invitePseudonymize = inviteHits.length;

  return { auditPseudonymize, scorerAuditRekey, invitePseudonymize, inviteOpenRemaining };
}

/** 接手稽核 id 尾端的雜湊換成 pseudo；新 id 已存在就只刪舊 id。dryRun 只計數。 */
async function rekeyScorerAudits(
  deps: CpDeps, cid: string, oldHash: string, pseudo: string, opts: { dryRun: boolean }
): Promise<number> {
  const auditsColl = deps.db.collection(`competitions/${cid}/audits`);
  const suffix = `_${oldHash}`;
  let count = 0;
  let lastId: string | null = null;

  while (true) {
    const q = lastId == null
      ? auditsColl.orderBy(FieldPath.documentId()).startAt('tk_').endAt('tk_\uf8ff').limit(400)
      : auditsColl.orderBy(FieldPath.documentId()).startAfter(lastId).endAt('tk_\uf8ff').limit(400);

    const page = await readQuery(deps, null, q);
    if (page.empty) break;

    const hits: DocumentSnapshot[] = [];
    for (const doc of page.docs) {
      if (doc.id.endsWith(suffix)) hits.push(doc);
    }

    if (hits.length > 0) {
      if (opts.dryRun) {
        count += hits.length;
      } else {
        // 先確認新 id 是否存在（避免 create 撞已存在）
        type Job = { oldRef: DocumentReference; oldData: Record<string, unknown>; newRef: DocumentReference; newExists: boolean };
        const jobs: Job[] = [];
        for (const doc of hits) {
          const newId = doc.id.slice(0, -suffix.length) + '_' + pseudo;
          const newRef = auditsColl.doc(newId);
          const newSnap = await readDoc(deps, null, newRef);
          jobs.push({
            oldRef: doc.ref,
            oldData: doc.data() ?? {},
            newRef,
            newExists: newSnap.exists
          });
        }
        // 每批 ≤200（每筆 2 個寫入操作 ≤ 500）
        for (let i = 0; i < jobs.length; i += 200) {
          const chunk = jobs.slice(i, i + 200);
          const batch = deps.db.batch();
          for (const j of chunk) {
            if (!j.newExists) {
              batch.create(j.newRef, replaceHashes(j.oldData, oldHash, pseudo));
            }
            batch.delete(j.oldRef);
          }
          await batch.commit();
        }
        count += hits.length;
      }
    }

    lastId = page.docs[page.docs.length - 1]!.id;
    if (page.size < 400) break;
  }

  return count;
}

/** 資料中的 actor／prev 若等於 oldHash 就換成 pseudo。其他欄位（含 expireAt）原封不動。 */
function replaceHashes(data: Record<string, unknown>, oldHash: string, pseudo: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if ((k === 'actor' || k === 'prev') && v === oldHash) {
      out[k] = pseudo;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * 把某賽事所有稽核的 expireAt 重算為 auditExpireAtMs(該筆 at, lastMatchAtMs)。
 * 只寫入比現有 expireAt 大的（含原本沒有 expireAt）。可重跑。
 * 每批 400 筆，documentId 游標。
 */
export async function restampAuditExpiry(deps: CpDeps, cid: string, lastMatchAtMs: number): Promise<void> {
  const coll = deps.db.collection(`competitions/${cid}/audits`);
  let lastId: string | null = null;
  while (true) {
    const q = lastId == null
      ? coll.orderBy(FieldPath.documentId()).limit(400)
      : coll.orderBy(FieldPath.documentId()).startAfter(lastId).limit(400);
    const page = await readQuery(deps, null, q);
    if (page.empty) break;
    const batch = deps.db.batch();
    let changed = 0;
    for (const doc of page.docs) {
      const at = doc.get('at');
      const atMs = at && typeof at.toMillis === 'function' ? at.toMillis() : deps.now().getTime();
      const next = auditExpireAtMs(atMs, lastMatchAtMs);
      const cur = doc.get('expireAt');
      const curMs = cur && typeof cur.toMillis === 'function' ? cur.toMillis() : null;
      if (curMs == null || next > curMs) {
        batch.update(doc.ref, { expireAt: Timestamp.fromMillis(next) });
        changed += 1;
      }
    }
    if (changed > 0) await batch.commit();
    lastId = page.docs[page.docs.length - 1]!.id;
    if (page.size < 400) break;
  }
}
