/**
 * cpHost 第 2 步動作：create、update、publish、setStatus、delete（§6.1）。
 * 第 3 步動作（排賽程、改期、登錄比分、確認、棄權、重置、積分重算、同分裁定與查詢）在 match-host.ts，於 HOST_ACTIONS 合併。
 * 組別規則 setDivisionRules 在 rules-host.ts，直接掛在 HOST_ACTIONS（不放進 MATCH_HOST_ACTIONS，避免循環引用）。
 * 第 4 步最小指派 assignStaff、removeStaff 在 staff-host.ts。createInvite、revokeInvite 仍未實作，回 UNKNOWN_ACTION。
 */
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { CpError, bad, deny, pre } from './errors.js';
import {
  CID_RE,
  FieldValue,
  TEAM_ID_RE,
  Timestamp,
  actorHash,
  assertCompVisible,
  assertHostOrCo,
  isAdmin,
  isClubRep,
  isPrimaryHost,
  launchGate,
  loadComp,
  newId,
  readCount,
  readDoc,
  readQuery,
  requireId,
  ts,
  writeAudit,
  type Caller,
  type CompDoc,
  type CpDeps,
  type GateResult
} from './context.js';
import {
  SPORTS,
  TIMEZONES,
  asRecord,
  assertFeeAllowed,
  categoryInput,
  categoryOf,
  competitionName,
  contactNoteOf,
  divisionsOf,
  feeNoteOf,
  hostDisplayName,
  liveLinksOf,
  onlyKeys,
  requireEnum,
  scheduleOf,
  statusReasonOf,
  venuesOf,
  type DivisionInput
} from './validate.js';
import { cleanLine, findBannedWord } from './text.js';
import { prepareMine } from './mine.js';
import { MATCH_HOST_ACTIONS } from './match-host.js';
import { setDivisionRules } from './rules-host.js';
import { STAFF_ACTIONS } from './staff-host.js';
import { standingRef } from './match-trigger.js';
import { matchDayOf } from '../engine/index.js';
import { taipeiYmd } from './schedule-flex.js';

/** §5.5 建賽限制 */
export const HOST_QUOTA = Object.freeze({
  personalActiveMax: 2,
  personalCreates30dMax: 3,
  clubActiveMax: 10,
  windowDays: 30
});

const ACTIVE_STATUSES = ['draft', 'published', 'postponed'];
const DAY = 86400_000;

function divisionDoc(d: DivisionInput, order: number) {
  return {
    name: d.name,
    playersOnField: d.playersOnField,
    maxTeams: d.maxTeams,
    rosterMin: d.rosterMin,
    rosterMax: d.rosterMax,
    minAge: d.minAge,
    maxAge: d.maxAge,
    requireRealName: d.requireRealName,
    feePerTeam: d.feePerTeam,
    order
  };
}

// ── create ─────────────────────────────────────────────────────────────
const CREATE_KEYS = [
  'action', 'name', 'hostType', 'hostTeamId', 'hostDisplay', 'sport', 'timezone', 'category',
  'regOpenAt', 'regCloseAt', 'firstMatchAt', 'lastMatchAt', 'venues', 'feeNote', 'liveLinks', 'divisions',
  'contactNote'
];

export async function createCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, CREATE_KEYS);
  const nowMs = deps.now().getTime();
  if (input.hostType === 'group') throw bad('HOST_TYPE_NOT_SUPPORTED', { field: 'hostType' });
  const hostType = requireEnum(input.hostType, ['personal', 'club'] as const, 'hostType');
  const name = competitionName(input.name, gate.bannedWords);
  // 選填；缺值（沒帶或 null）寫 league。其他值白名單不過就 INVALID_FIELD
  const category = input.category == null ? 'league' : categoryInput(input.category);
  const sport = requireEnum(input.sport, SPORTS, 'sport');
  const timezone = requireEnum(input.timezone ?? 'Asia/Taipei', TIMEZONES, 'timezone');
  const sched = scheduleOf(input, nowMs, { requireFuture: true });
  const venues = venuesOf(input.venues);
  const liveLinks = liveLinksOf(input.liveLinks);
  const feeNote = feeNoteOf(input.feeNote, hostType);
  const contactNote = contactNoteOf(input.contactNote, gate.bannedWords);
  const divisions = divisionsOf(input.divisions);
  assertFeeAllowed(divisions, hostType);
  if (divisions.some(d => d.dvId)) throw bad('BAD_ID', { field: 'divisions' });

  let hostTeamId: string | null = null;
  let personalDisplay: string | null = null;
  if (hostType === 'club') {
    if (typeof input.hostTeamId !== 'string' || !TEAM_ID_RE.test(input.hostTeamId)) throw bad('BAD_ID', { field: 'hostTeamId' });
    hostTeamId = input.hostTeamId;
    // §5.4：俱樂部主辦只能用俱樂部名稱（由鏡像帶入，不收用戶端值）
    if (input.hostDisplay != null) throw bad('UNKNOWN_FIELD', { field: 'hostDisplay' });
  } else {
    if (input.hostTeamId != null) throw bad('UNKNOWN_FIELD', { field: 'hostTeamId' });
    if (input.hostDisplay != null) {
      personalDisplay = hostDisplayName(input.hostDisplay, gate.bannedWords);
    } else {
      const user = await readDoc(deps, null, deps.mainDb.doc(`users/${caller.uid}`));
      const fallback = cleanLine(user.get('displayName')) ?? '';
      // 主站顯示名含禁用字時退回「主辦」，不回報使用者沒送的欄位（Opus 終審 P3）
      const candidate = fallback.slice(0, 30);
      personalDisplay = candidate && !findBannedWord(candidate, gate.bannedWords) ? candidate : '主辦';
    }
  }

  const cid = newId('cp');
  const dvIds = divisions.map(() => newId('dv'));
  const admin = isAdmin(caller);

  await deps.db.runTransaction(async (tx: Transaction) => {
    // ── 讀（交易內全部讀完才寫）──
    let hostDisplay = personalDisplay;
    let quotaRef: DocumentReference | null = null;
    let recent: Timestamp[] = [];
    const activeCids: string[] = [];
    if (hostType === 'club') {
      const rep = await isClubRep(deps, tx, hostTeamId!, caller.uid);
      if (!rep.ok && !admin) throw deny('NOT_CLUB_REP');
      if (!rep.name) throw pre('CLUB_SYNC_PENDING');
      hostDisplay = rep.name;
      if (!admin) {
        quotaRef = deps.db.doc(`cpHostQuota/t_${hostTeamId}`);
        await readDoc(deps, tx, quotaRef); // 鎖住同隊並行建立
        const active = await readCount(deps, tx, deps.db.collection('competitions')
          .where('hostTeamId', '==', hostTeamId).where('endedAt', '==', null)
          .where('status', 'in', ACTIVE_STATUSES).count());
        if (active >= HOST_QUOTA.clubActiveMax) throw new CpError('resource-exhausted', 'CLUB_QUOTA_ACTIVE', { max: HOST_QUOTA.clubActiveMax });
      }
    } else if (!admin) {
      quotaRef = deps.db.doc(`cpHostQuota/${caller.uid}`);
      const q = await readDoc(deps, tx, quotaRef);
      const cutoff = nowMs - HOST_QUOTA.windowDays * DAY;
      const raw = q.exists ? q.get('recentCreates') : null;
      recent = (Array.isArray(raw) ? raw : []).filter((t): t is Timestamp => t instanceof Timestamp && t.toMillis() > cutoff);
      if (recent.length >= HOST_QUOTA.personalCreates30dMax) {
        throw new CpError('resource-exhausted', 'HOST_QUOTA_30D', { max: HOST_QUOTA.personalCreates30dMax });
      }
      // 進行中計數改用配額文件的 activeCids（§3.251 (c)：主文件不放建立者 uid，無法用 hostUid 查詢）。
      // 每次建立時逐一讀回確認狀態（自我修復：刪除、取消、結束的自動剔除），最多讀 personalActiveMax＋少量殘留。
      const rawActive = q.exists ? q.get('activeCids') : null;
      const candidates = (Array.isArray(rawActive) ? rawActive : []).filter((x): x is string => typeof x === 'string' && CID_RE.test(x)).slice(0, 10);
      for (const ac of candidates) {
        const snap = await readDoc(deps, tx, deps.db.doc(`competitions/${ac}`));
        if (snap.exists && snap.get('endedAt') == null && ACTIVE_STATUSES.includes(snap.get('status'))) activeCids.push(ac);
      }
      if (activeCids.length >= HOST_QUOTA.personalActiveMax) {
        throw new CpError('resource-exhausted', 'HOST_QUOTA_ACTIVE', { max: HOST_QUOTA.personalActiveMax });
      }
    }

    // 個人主辦的「自己的清單」走 cpMine（主文件不放 uid）；俱樂部主辦由目前代表以 hostTeamId 查（V16）
    const writeMine = hostType === 'personal'
      ? await prepareMine(deps, tx, caller.uid, cid, { name, firstMatchAt: ts(sched.firstMatchAt), category }, { addHost: true })
      : null;

    // ── 寫 ──
    const now = FieldValue.serverTimestamp();
    // 主文件不放建立者 uid（§3.251 (c)）；個人主辦身分寫在 staff/{uid}（host），俱樂部主辦只認目前代表
    tx.create(deps.db.doc(`competitions/${cid}`), {
      name, sport, category, hostType, hostTeamId, hostDisplay,
      // §12.2 b：內部期一律 internal，用戶端無法指定
      visibility: gate.isPublic ? 'public' : 'internal',
      status: 'draft', statusReason: null, hidden: false,
      regOpenAt: ts(sched.regOpenAt), regCloseAt: ts(sched.regCloseAt),
      firstMatchAt: ts(sched.firstMatchAt), lastMatchAt: ts(sched.lastMatchAt),
      endedAt: null, endedBy: null, rostersLockedAt: null, ageBasisAt: null,
      timezone, venues, feeNote, liveLinks, contactNote, notices: [],
      stateVersion: 1, createdAt: now, updatedAt: now
    });
    divisions.forEach((d, i) => {
      tx.create(deps.db.doc(`competitions/${cid}/divisions/${dvIds[i]}`), {
        ...divisionDoc(d, i), entryCount: 0, approvedCount: 0, createdAt: now, updatedAt: now
      });
    });
    // 個人主辦身分寫在 staff/{uid}（host）；俱樂部主辦只認目前代表，不寫 staff（建立者只留在雜湊稽核）
    if (hostType === 'personal') {
      tx.create(deps.db.doc(`competitions/${cid}/staff/${caller.uid}`), { roles: ['host'], matchIds: [], expiresAt: null, createdAt: now });
      writeMine!();
    }
    if (quotaRef && hostType === 'personal') {
      tx.set(quotaRef, { recentCreates: [...recent, Timestamp.fromMillis(nowMs)], activeCids: [...activeCids, cid], updatedAt: now });
    } else if (quotaRef) {
      tx.set(quotaRef, { lastCreateAt: Timestamp.fromMillis(nowMs), updatedAt: now });
    }
    writeAudit(deps, tx, cid, caller, 'create', { hostType, divisions: divisions.length });
  });
  return { cid, dvIds };
}

/**
 * 名單鎖定後只能改既有組別的名稱（給積分榜顯示）。增刪、調順序、改規則仍是 ROSTERS_LOCKED。
 * 規則欄位與當初寫入的組別文件一致才算「只改名」。
 */
function isNameOnlyDivisionEdit(
  existing: Map<string, { get(field: string): unknown }>,
  divisions: DivisionInput[]
): boolean {
  if (divisions.length !== existing.size) return false;
  const seen = new Set<string>();
  for (let i = 0; i < divisions.length; i++) {
    const d = divisions[i];
    if (!d.dvId || seen.has(d.dvId)) return false;
    seen.add(d.dvId);
    const old = existing.get(d.dvId);
    if (!old) return false;
    if ((old.get('order') ?? i) !== i) return false;
    if (old.get('playersOnField') !== d.playersOnField) return false;
    if (old.get('maxTeams') !== d.maxTeams) return false;
    if (old.get('rosterMin') !== d.rosterMin) return false;
    if (old.get('rosterMax') !== d.rosterMax) return false;
    if ((old.get('minAge') ?? null) !== d.minAge) return false;
    if ((old.get('maxAge') ?? null) !== d.maxAge) return false;
    if (Boolean(old.get('requireRealName')) !== d.requireRealName) return false;
    if ((old.get('feePerTeam') ?? 0) !== d.feePerTeam) return false;
  }
  return seen.size === existing.size;
}

/** 積分文件的 groupId。第 3 步只有 A；沒有賽程時也試 A，才能對上已存在的那一份。 */
function standingGroupIds(schedule: unknown): string[] {
  if (!schedule || typeof schedule !== 'object') return ['A'];
  const groups = (schedule as { groups?: unknown }).groups;
  if (!Array.isArray(groups) || groups.length === 0) return ['A'];
  const ids: string[] = [];
  for (const g of groups) {
    const id = g && typeof g === 'object' ? (g as { groupId?: unknown }).groupId : null;
    if (typeof id === 'string' && /^[A-Za-z0-9]{1,8}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.length ? ids : ['A'];
}

// ── update ─────────────────────────────────────────────────────────────
const UPDATE_KEYS = [
  'action', 'cid', 'name', 'category', 'hostDisplay', 'regOpenAt', 'regCloseAt', 'firstMatchAt', 'lastMatchAt',
  'venues', 'feeNote', 'liveLinks', 'divisions', 'contactNote'
];
const SCHEDULE_KEYS = ['regOpenAt', 'regCloseAt', 'firstMatchAt', 'lastMatchAt'];

export async function updateCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, UPDATE_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const nowMs = deps.now().getTime();
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const schedKeys = SCHEDULE_KEYS.filter(has);
  if (schedKeys.length > 0 && schedKeys.length < 4) throw bad('SCHEDULE_ALL_REQUIRED', { field: 'schedule' });
  const divisions = has('divisions') ? divisionsOf(input.divisions) : null;
  let mineSync: { name: string; firstMatchAt: Timestamp; category: 'league' | 'cup' | 'friendly' } | null = null;

  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    await assertHostOrCo(deps, tx, cid, comp, caller);
    if (comp.status === 'cancelled' || comp.endedAt) throw pre('COMPETITION_CLOSED');
    if (comp.hidden && !isAdmin(caller)) throw pre('COMPETITION_HIDDEN');
    if (divisions) assertFeeAllowed(divisions, comp.hostType);

    const patch: Record<string, unknown> = {};
    if (has('name')) patch.name = competitionName(input.name, gate.bannedWords);
    // 與改名相同：已結束／已取消在上面 COMPETITION_CLOSED 擋下；這裡只驗白名單
    if (has('category')) patch.category = categoryInput(input.category);
    if (has('hostDisplay')) {
      if (comp.hostType !== 'personal') throw bad('UNKNOWN_FIELD', { field: 'hostDisplay' });
      patch.hostDisplay = hostDisplayName(input.hostDisplay, gate.bannedWords);
    }
    if (schedKeys.length === 4) {
      const s = scheduleOf(input, nowMs, { requireFuture: false });
      const admin = isAdmin(caller);
      // Opus 終審 P1-1：首場後主辦不能改時程（否則可把已開賽賽事挪到未來再刪除、或重開報名）
      if (!admin && nowMs >= comp.firstMatchAt.toMillis()) throw pre('COMPETITION_STARTED', { field: 'schedule' });
      if (!admin && s.firstMatchAt <= nowMs) throw bad('SCHEDULE_PAST', { field: 'firstMatchAt' });
      // 顧問 §3.291 P2：已有場次時，新賽期必須涵蓋最早與最晚開賽（各 orderBy kickoffAt limit 1，共 2 讀）。
      // 場次用比賽日；官方賽期用台北日曆日當標籤（午夜標記不能用 matchDayOf）。待定（kickoffAt null）不算。
      // 凌晨 00:00～04:59 算前一個比賽日，所以末場日的隔天凌晨仍算涵蓋。
      const ms = deps.db.collection(`competitions/${cid}/matches`).where('kickoffAt', '>=', Timestamp.fromMillis(0));
      const earliest = await readQuery(deps, tx, ms.orderBy('kickoffAt', 'asc').limit(1));
      const latest = await readQuery(deps, tx, ms.orderBy('kickoffAt', 'desc').limit(1));
      if (!earliest.empty && !latest.empty) {
        const periodStart = taipeiYmd(s.firstMatchAt);
        const periodEnd = taipeiYmd(s.lastMatchAt);
        const first = (earliest.docs[0]!.get('kickoffAt') as Timestamp).toMillis();
        const last = (latest.docs[0]!.get('kickoffAt') as Timestamp).toMillis();
        if (matchDayOf(first) < periodStart || matchDayOf(last) > periodEnd) {
          throw bad('SCHEDULE_OUT_OF_RANGE', { field: 'schedule' });
        }
      }
      // 首場日期可改（延期）：年齡判斷改用第一筆名單時固定的 ageBasisAt（顧問 §3.251 F2，取代 Opus P1-2 的「有名單就鎖首場」）
      patch.regOpenAt = ts(s.regOpenAt);
      patch.regCloseAt = ts(s.regCloseAt);
      patch.firstMatchAt = ts(s.firstMatchAt);
      patch.lastMatchAt = ts(s.lastMatchAt);
      // 重定官方賽期：60 天延後的基準改回這次的末場。彈性改期記下的原末場不再沿用。
      patch.lastMatchOriginAt = FieldValue.delete();
    }
    if (has('venues')) patch.venues = venuesOf(input.venues);
    if (has('feeNote')) patch.feeNote = feeNoteOf(input.feeNote, comp.hostType);
    if (has('liveLinks')) patch.liveLinks = liveLinksOf(input.liveLinks);
    if (has('contactNote')) patch.contactNote = contactNoteOf(input.contactNote, gate.bannedWords);

    // 組別：送來的是完整清單（有 dvId＝更新、沒有＝新增、清單外＝刪除）
    let divisionWrites: (() => void)[] = [];
    const standingNameWrites: Array<{ ref: DocumentReference; divisionName: string }> = [];
    const renamedDivisions: string[] = [];
    if (divisions) {
      const snap = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/divisions`).limit(20));
      const existing = new Map(snap.docs.map(d => [d.id, d]));
      // 鎖定後仍可改名稱（積分榜要跟著改）。增刪或改規則維持原本的 ROSTERS_LOCKED。
      if (comp.rostersLockedAt && !isNameOnlyDivisionEdit(existing, divisions)) {
        throw pre('ROSTERS_LOCKED', { field: 'divisions' });
      }
      const keep = new Set(divisions.filter(d => d.dvId).map(d => d.dvId!));
      for (const id of keep) if (!existing.has(id)) throw bad('BAD_ID', { field: 'divisions' });
      for (const [id, d] of existing) {
        if (keep.has(id)) continue;
        if ((d.get('entryCount') ?? 0) > 0) throw pre('DIVISION_HAS_ENTRIES', { field: 'divisions' });
        // 計數不含已拒絕／已撤隊，仍有報隊文件就不刪，避免孤兒（Opus 終審 P2-4）
        const anyEntry = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/entries`).where('dvId', '==', id).limit(1));
        if (!anyEntry.empty) throw pre('DIVISION_HAS_ENTRIES', { field: 'divisions' });
      }
      const now = FieldValue.serverTimestamp();
      divisionWrites = [];
      divisions.forEach((d, i) => {
        if (d.dvId) {
          const old = existing.get(d.dvId)!;
          const entryCount = (old.get('entryCount') as number) ?? 0;
          const approvedCount = (old.get('approvedCount') as number) ?? 0;
          if (d.maxTeams < approvedCount) throw pre('DIVISION_BELOW_APPROVED', { field: `divisions.${i}.maxTeams` });
          if (entryCount > 0 && (
            old.get('minAge') !== d.minAge || old.get('maxAge') !== d.maxAge
            || old.get('requireRealName') !== d.requireRealName || old.get('playersOnField') !== d.playersOnField
            || (old.get('feePerTeam') ?? 0) !== d.feePerTeam
          )) {
            // 已有報隊時改年齡或真名規則，會讓已登錄的資格結果失真
            throw pre('DIVISION_RULES_LOCKED', { field: `divisions.${i}` });
          }
          const ref = old.ref;
          divisionWrites.push(() => tx.update(ref, { ...divisionDoc(d, i), updatedAt: now }));
        } else {
          const ref = deps.db.doc(`competitions/${cid}/divisions/${newId('dv')}`);
          divisionWrites.push(() => tx.create(ref, {
            ...divisionDoc(d, i), entryCount: 0, approvedCount: 0, createdAt: now, updatedAt: now
          }));
        }
      });
      for (const [id, d] of existing) if (!keep.has(id)) divisionWrites.push(() => tx.delete(d.ref));
      // 改名的組別：積分文件用已讀到的 schedule 算出 id，同一筆交易更新 divisionName。
      // 第 3 步每組別一份（group A），寫入數 ≤ 組別數。沒有那份文件就不寫。
      for (const d of divisions) {
        if (!d.dvId) continue;
        const old = existing.get(d.dvId);
        if (!old || old.get('name') === d.name) continue;
        renamedDivisions.push(d.dvId);
        for (const groupId of standingGroupIds(old.get('schedule'))) {
          const ref = standingRef(deps, cid, d.dvId, 'group', groupId);
          const st = await readDoc(deps, tx, ref);
          if (st.exists) standingNameWrites.push({ ref, divisionName: d.name });
        }
      }
    }

    if (Object.keys(patch).length === 0 && !divisions) throw bad('NOTHING_TO_UPDATE');
    divisionWrites.forEach(w => w());
    for (const s of standingNameWrites) tx.update(s.ref, { divisionName: s.divisionName, updatedAt: FieldValue.serverTimestamp() });
    tx.update(deps.db.doc(`competitions/${cid}`), {
      ...patch, stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
    });
    writeAudit(deps, tx, cid, caller, 'update', {
      fields: Object.keys(patch),
      divisions: divisions ? divisions.length : null,
      ...(renamedDivisions.length ? { renamedDivisions } : {})
    });
    if (patch.name !== undefined || patch.firstMatchAt !== undefined || patch.category !== undefined) {
      mineSync = {
        name: (patch.name as string | undefined) ?? comp.name,
        firstMatchAt: (patch.firstMatchAt as Timestamp | undefined) ?? comp.firstMatchAt,
        category: categoryOf({ category: patch.category !== undefined ? patch.category : comp.category })
      };
    }
  });
  // cpMine 索引同步名稱、首場、分類（顧問 §3.254、§3.264）：交易外盡力而為，找不到索引的略過
  if (mineSync) await syncMineIndex(deps, cid, mineSync);
  return { cid };
}

/** 依伺服器資料推導持有本賽事 cpMine 索引的人（個人主辦 staff host、球員、報隊者），更新名稱、首場、分類。 */
async function syncMineIndex(deps: CpDeps, cid: string, fields: { name: string; firstMatchAt: Timestamp; category: string }): Promise<void> {
  const uids = new Set<string>();
  const hs = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/staff`).where('roles', 'array-contains', 'host').select());
  hs.docs.forEach(d => uids.add(d.id));
  const rp = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/rosterPrivate`).select('uid'));
  rp.docs.forEach(d => { const u = d.get('uid'); if (typeof u === 'string' && u) uids.add(u); });
  const ep = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/entryPrivate`).select('registeredByUid'));
  ep.docs.forEach(d => { const u = d.get('registeredByUid'); if (typeof u === 'string' && u) uids.add(u); });
  const list = [...uids];
  for (let i = 0; i < list.length; i += 50) {
    await Promise.all(list.slice(i, i + 50).map(u =>
      deps.db.doc(`cpMine/${u}/items/${cid}`).update({
        name: fields.name, firstMatchAt: fields.firstMatchAt, category: fields.category
      }).catch(() => undefined)));
  }
}

// ── publish ────────────────────────────────────────────────────────────
export async function publishCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const nowMs = deps.now().getTime();
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    await assertHostOrCo(deps, tx, cid, comp, caller);
    if (comp.status !== 'draft') throw pre('NOT_DRAFT');
    if (comp.hidden) throw pre('COMPETITION_HIDDEN');
    if (comp.regCloseAt.toMillis() <= nowMs) throw pre('REG_CLOSED');
    const n = await readCount(deps, tx, deps.db.collection(`competitions/${cid}/divisions`).count());
    if (n < 1) throw pre('DIVISION_REQUIRED');
    tx.update(deps.db.doc(`competitions/${cid}`), {
      status: 'published', statusReason: null, publishedAt: FieldValue.serverTimestamp(),
      stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
    });
    writeAudit(deps, tx, cid, caller, 'publish');
  });
  return { cid, status: 'published' };
}

// ── setStatus（延期／取消必填原因；延期可恢復為已發布）──────────────────
const TRANSITIONS: Record<string, string[]> = {
  published: ['postponed', 'cancelled'],
  postponed: ['published', 'cancelled']
};

export async function setCompetitionStatus(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'status', 'reason']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const status = requireEnum(input.status, ['published', 'postponed', 'cancelled'] as const, 'status');
  const reason = status === 'published' ? null : statusReasonOf(input.reason);
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    await assertHostOrCo(deps, tx, cid, comp, caller);
    if (comp.endedAt) throw pre('COMPETITION_CLOSED');
    // 下架期間主辦不能改狀態（Flash 交叉審 P2；與 update 一致）
    if (comp.hidden && !isAdmin(caller)) throw pre('COMPETITION_HIDDEN');
    if (!(TRANSITIONS[comp.status] ?? []).includes(status)) throw pre('STATUS_TRANSITION', { from: comp.status, to: status });
    tx.update(deps.db.doc(`competitions/${cid}`), {
      status, statusReason: reason,
      stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
    });
    writeAudit(deps, tx, cid, caller, 'setStatus', { from: comp.status, to: status });
  });
  return { cid, status };
}

// ── delete（§6.1 必修 7：首場前主辦可刪；之後只有管理員）──────────────
export async function deleteCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const admin = isAdmin(caller);
  let comp: CompDoc | null = null;
  // 1. 交易內判斷權限並先封鎖：下架＋deletingAt，讓並行的報隊、登錄、編輯全部被擋（Flash 交叉審 P2：
  //    避免 recursiveDelete 期間新寫入成為孤兒）；同時寫頂層稽核（賽事內 audits 會跟著刪）。
  await deps.db.runTransaction(async tx => {
    const c = await loadComp(deps, tx, cid);
    assertCompVisible(c, gate);
    // 主辦：俱樂部主辦＝目前代表、個人主辦＝staff host；共同主辦不能刪（Flash P1、§3.251 (a)）
    const primary = await isPrimaryHost(deps, tx, cid, c, caller);
    if (!admin && !primary) throw deny('NOT_PRIMARY_HOST');
    // 下架（被檢舉）中主辦不能自刪，避免檢舉證據隨子集合消失（Opus 終審 P2-6）；刪除中重跑例外
    if (!admin && c.hidden && !c.deletingAt) throw pre('COMPETITION_HIDDEN');
    if (!admin && deps.now().getTime() >= c.firstMatchAt.toMillis()) throw pre('DELETE_AFTER_START');
    const auditRef = deps.db.doc(`cpAudits/del_${cid}`);
    const audit = await readDoc(deps, tx, auditRef);
    if (audit.exists) {
      // 重跑（前次中途失敗）：保留第一次的紀錄，只記重試
      tx.update(auditRef, { retries: FieldValue.increment(1), lastRetryAt: FieldValue.serverTimestamp() });
    } else {
      tx.create(auditRef, {
        action: 'deleteCompetition', cid, actor: actorHash(cid, caller.uid), actorIsAdmin: admin,
        name: c.name, at: FieldValue.serverTimestamp(), retries: 0
      });
    }
    tx.update(deps.db.doc(`competitions/${cid}`), { hidden: true, deletingAt: FieldValue.serverTimestamp() });
    comp = c;
  });
  if (!comp) throw pre('DELETE_FAILED');
  // 2. 清 cpMine 索引（從私密名單與報隊者推導；不信用戶端）
  const uids = new Set<string>();
  const rp = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/rosterPrivate`).select('uid'));
  rp.docs.forEach(d => { const u = d.get('uid'); if (typeof u === 'string' && u) uids.add(u); });
  const ep = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/entryPrivate`).select('registeredByUid'));
  ep.docs.forEach(d => { const u = d.get('registeredByUid'); if (typeof u === 'string' && u) uids.add(u); });
  const hs = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/staff`).where('roles', 'array-contains', 'host').select());
  hs.docs.forEach(d => uids.add(d.id));
  const list = [...uids];
  for (let i = 0; i < list.length; i += 400) {
    const b = deps.db.batch();
    list.slice(i, i + 400).forEach(u => b.delete(deps.db.doc(`cpMine/${u}/items/${cid}`)));
    await b.commit();
  }
  // 3. 連同子集合分批刪；中途失敗可重跑（根文件最後才刪）
  await deps.db.recursiveDelete(deps.db.doc(`competitions/${cid}`));
  return { cid, deleted: true };
}

export const HOST_ACTIONS = {
  create: createCompetition,
  update: updateCompetition,
  publish: publishCompetition,
  setStatus: setCompetitionStatus,
  delete: deleteCompetition,
  ...MATCH_HOST_ACTIONS,
  setDivisionRules,
  ...STAFF_ACTIONS
} as const;

export async function handleCpHost(deps: CpDeps, caller: Caller, data: unknown) {
  const input = asRecord(data);
  const action = input.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(HOST_ACTIONS, action)) {
    throw bad('UNKNOWN_ACTION');
  }
  const gate = await launchGate(deps, caller);
  return HOST_ACTIONS[action as keyof typeof HOST_ACTIONS](deps, caller, gate, input);
}
