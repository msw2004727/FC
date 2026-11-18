/**
 * cpHost 第 2 步動作：create、update、publish、setStatus、delete（§6.1）。
 * generateSchedule、assignStaff、createInvite、revokeInvite、confirmMatchResult、resetMatch 屬第 3、4 步，
 * 這裡回 UNKNOWN_ACTION（未實作的動作一律拒絕，不靜默成功）。
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
  competitionName,
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
import { cleanLine } from './text.js';

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
    order
  };
}

// ── create ─────────────────────────────────────────────────────────────
const CREATE_KEYS = [
  'action', 'name', 'hostType', 'hostTeamId', 'hostDisplay', 'sport', 'timezone',
  'regOpenAt', 'regCloseAt', 'firstMatchAt', 'lastMatchAt', 'venues', 'feeNote', 'liveLinks', 'divisions'
];

export async function createCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, CREATE_KEYS);
  const nowMs = deps.now().getTime();
  if (input.hostType === 'group') throw bad('HOST_TYPE_NOT_SUPPORTED', { field: 'hostType' });
  const hostType = requireEnum(input.hostType, ['personal', 'club'] as const, 'hostType');
  const name = competitionName(input.name);
  const sport = requireEnum(input.sport, SPORTS, 'sport');
  const timezone = requireEnum(input.timezone ?? 'Asia/Taipei', TIMEZONES, 'timezone');
  const sched = scheduleOf(input, nowMs, { requireFuture: true });
  const venues = venuesOf(input.venues);
  const liveLinks = liveLinksOf(input.liveLinks);
  const feeNote = feeNoteOf(input.feeNote, hostType);
  const divisions = divisionsOf(input.divisions);
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
      personalDisplay = hostDisplayName(input.hostDisplay);
    } else {
      const user = await readDoc(deps, null, deps.mainDb.doc(`users/${caller.uid}`));
      const fallback = cleanLine(user.get('displayName')) ?? '';
      personalDisplay = hostDisplayName(fallback.slice(0, 30) || '主辦');
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
      const active = await readCount(deps, tx, deps.db.collection('competitions')
        .where('hostUid', '==', caller.uid).where('hostType', '==', 'personal')
        .where('endedAt', '==', null).where('status', 'in', ACTIVE_STATUSES).count());
      if (active >= HOST_QUOTA.personalActiveMax) {
        throw new CpError('resource-exhausted', 'HOST_QUOTA_ACTIVE', { max: HOST_QUOTA.personalActiveMax });
      }
    }

    // ── 寫 ──
    const now = FieldValue.serverTimestamp();
    tx.create(deps.db.doc(`competitions/${cid}`), {
      name, sport, hostType, hostUid: caller.uid, hostTeamId, hostDisplay,
      // §12.2 b：內部期一律 internal，用戶端無法指定
      visibility: gate.isPublic ? 'public' : 'internal',
      status: 'draft', statusReason: null, hidden: false,
      regOpenAt: ts(sched.regOpenAt), regCloseAt: ts(sched.regCloseAt),
      firstMatchAt: ts(sched.firstMatchAt), lastMatchAt: ts(sched.lastMatchAt),
      endedAt: null, endedBy: null, rostersLockedAt: null,
      timezone, venues, feeNote, liveLinks,
      stateVersion: 1, createdAt: now, updatedAt: now
    });
    divisions.forEach((d, i) => {
      tx.create(deps.db.doc(`competitions/${cid}/divisions/${dvIds[i]}`), {
        ...divisionDoc(d, i), entryCount: 0, approvedCount: 0, createdAt: now, updatedAt: now
      });
    });
    if (quotaRef && hostType === 'personal') {
      tx.set(quotaRef, { recentCreates: [...recent, Timestamp.fromMillis(nowMs)], updatedAt: now });
    } else if (quotaRef) {
      tx.set(quotaRef, { lastCreateAt: Timestamp.fromMillis(nowMs), updatedAt: now });
    }
    writeAudit(deps, tx, cid, caller, 'create', { hostType, divisions: divisions.length });
  });
  return { cid, dvIds };
}

// ── update ─────────────────────────────────────────────────────────────
const UPDATE_KEYS = [
  'action', 'cid', 'name', 'hostDisplay', 'regOpenAt', 'regCloseAt', 'firstMatchAt', 'lastMatchAt',
  'venues', 'feeNote', 'liveLinks', 'divisions'
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

  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    await assertHostOrCo(deps, tx, cid, comp, caller);
    if (comp.status === 'cancelled' || comp.endedAt) throw pre('COMPETITION_CLOSED');
    if (comp.hidden && !isAdmin(caller)) throw pre('COMPETITION_HIDDEN');

    const patch: Record<string, unknown> = {};
    if (has('name')) patch.name = competitionName(input.name);
    if (has('hostDisplay')) {
      if (comp.hostType !== 'personal') throw bad('UNKNOWN_FIELD', { field: 'hostDisplay' });
      patch.hostDisplay = hostDisplayName(input.hostDisplay);
    }
    if (schedKeys.length === 4) {
      const s = scheduleOf(input, nowMs, { requireFuture: false });
      if (comp.rostersLockedAt && s.firstMatchAt !== comp.firstMatchAt.toMillis()) {
        // 名單鎖定後首場日期影響 isMinor／ageEligible 的判斷基準，不能再改
        throw pre('ROSTERS_LOCKED', { field: 'firstMatchAt' });
      }
      patch.regOpenAt = ts(s.regOpenAt);
      patch.regCloseAt = ts(s.regCloseAt);
      patch.firstMatchAt = ts(s.firstMatchAt);
      patch.lastMatchAt = ts(s.lastMatchAt);
    }
    if (has('venues')) patch.venues = venuesOf(input.venues);
    if (has('feeNote')) patch.feeNote = feeNoteOf(input.feeNote, comp.hostType);
    if (has('liveLinks')) patch.liveLinks = liveLinksOf(input.liveLinks);

    // 組別：送來的是完整清單（有 dvId＝更新、沒有＝新增、清單外＝刪除）
    let divisionWrites: (() => void)[] = [];
    if (divisions) {
      if (comp.rostersLockedAt) throw pre('ROSTERS_LOCKED', { field: 'divisions' });
      const snap = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/divisions`).limit(20));
      const existing = new Map(snap.docs.map(d => [d.id, d]));
      const keep = new Set(divisions.filter(d => d.dvId).map(d => d.dvId!));
      for (const id of keep) if (!existing.has(id)) throw bad('BAD_ID', { field: 'divisions' });
      for (const [id, d] of existing) {
        if (!keep.has(id) && (d.get('entryCount') ?? 0) > 0) throw pre('DIVISION_HAS_ENTRIES', { field: 'divisions' });
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
    }

    if (Object.keys(patch).length === 0 && !divisions) throw bad('NOTHING_TO_UPDATE');
    divisionWrites.forEach(w => w());
    tx.update(deps.db.doc(`competitions/${cid}`), {
      ...patch, stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
    });
    writeAudit(deps, tx, cid, caller, 'update', { fields: Object.keys(patch), divisions: divisions ? divisions.length : null });
  });
  return { cid };
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
  const comp: CompDoc = await loadComp(deps, null, cid);
  assertCompVisible(comp, gate);
  const admin = isAdmin(caller);
  // 只有 hostUid 本人（不含共同主辦、俱樂部其他代表）或管理員
  if (!admin && comp.hostUid !== caller.uid) throw deny('NOT_PRIMARY_HOST');
  if (!admin && deps.now().getTime() >= comp.firstMatchAt.toMillis()) throw pre('DELETE_AFTER_START');

  // 1. 先寫頂層稽核（賽事內 audits 會跟著刪掉）；冪等：同一 cid 重跑只覆寫同一份
  await deps.db.doc(`cpAudits/del_${cid}`).set({
    action: 'deleteCompetition', cid, actor: actorHash(cid, caller.uid), actorIsAdmin: admin,
    name: comp.name, at: FieldValue.serverTimestamp()
  });
  // 2. 清 cpMine 索引（從私密名單與報隊者推導；不信用戶端）
  const uids = new Set<string>();
  const rp = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/rosterPrivate`).select('uid'));
  rp.docs.forEach(d => { const u = d.get('uid'); if (typeof u === 'string' && u) uids.add(u); });
  const ep = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/entryPrivate`).select('registeredByUid'));
  ep.docs.forEach(d => { const u = d.get('registeredByUid'); if (typeof u === 'string' && u) uids.add(u); });
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
  delete: deleteCompetition
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
