/**
 * cpHost 第 4 步最小指派：assignStaff、removeStaff。
 * 邀請連結（createInvite、revokeInvite）與任意加人延後；這張只能指派呼叫者自己，或已經有 staff 文件的人。
 * 只處理記分角色 scorer／referee。共同主辦、工作人員的「指派」不做；移除時若傳入 coHost，仍照契約判斷。
 *
 * 權限：launchGate（外層）→ 交易內 loadComp → assertCompVisible → hostAccess（與 assertHostOrCo 同一套）
 * → 未下架、未刪除中、未取消、未結束（結束沿用 match-host 的寬限：末場確認 3 天，管理員不受限）。
 * 公開場次不放 uid。稽核只記操作者雜湊與對象 uid 雜湊。
 *
 * cpMine 要含記分角色。讀取預算沒有單獨的 cpMine 一格，所以能塞進「主辦判斷 ≤2 ＋ 對象 staff 1」剩餘的那一次才讀；
 * 讀不進的路徑（俱樂部、非代表的共同主辦，指派另一個已存在的 staff）改走不讀的 arrayUnion／arrayRemove。
 */
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { bad, deny, notFound, pre } from './errors.js';
import {
  CID_RE,
  FieldValue,
  Timestamp,
  actorHash,
  assertCompVisible,
  hostAccess,
  isAdmin,
  loadComp,
  readDoc,
  requireId,
  writeAudit,
  type Caller,
  type CompDoc,
  type CpDeps,
  type GateResult,
  type HostAccess
} from './context.js';
import { applyMineScoreBlind, prepareMine, type ScoreRole } from './mine.js';
import { SCHEDULE_LIMITS } from './match-host.js';
import { onlyKeys } from './validate.js';

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MTID_RE = /^mt_[A-Za-z0-9]{20}$/;
/** 沒帶 expiresAt 時：末場時刻再加 7 天。 */
export const SCORE_ASSIGN_MS = 7 * 86400_000;
const EXPIRES_MAX = 8_640_000_000_000;
const SCORE_ORDER = ['scorer', 'referee'] as const;
const ASSIGN_KEYS = ['action', 'cid', 'uid', 'roles', 'matchIds', 'expiresAt'];
const REMOVE_KEYS = ['action', 'cid', 'uid', 'roles'];
/** 契約：主辦判斷 ≤2，再加對象 staff 1。cpMine 只能占用這 3 次裡還沒用到的 1 次。 */
const STAFF_READ_BUDGET = 3;

export interface AssignedShape {
  roles: readonly string[];
  matchIds: readonly string[];
  /** null 表示不過期（Rules：expiresAt == null 或 request.time < expiresAt）。 */
  expiresAtMs: number | null;
}

/**
 * 與 Rules assignedData 同一條件：roles 含 scorer 或 referee、matchIds 含本場、未過期。
 * 過期比較是 now < expiresAt（剛好等於現在不算未過期）。
 */
export function assignedDataOk(staff: AssignedShape, mt: string, nowMs: number): boolean {
  const scored = staff.roles.includes('scorer') || staff.roles.includes('referee');
  const listed = staff.matchIds.includes(mt);
  const fresh = staff.expiresAtMs == null || nowMs < staff.expiresAtMs;
  return scored && listed && fresh;
}

/** 保留 host／coHost 與其他非記分角色，記分角色改成這次指定的集合（scorer 在前）。 */
export function staffRolesAfterAssign(existing: readonly string[], score: readonly ScoreRole[]): string[] {
  return [...existing.filter(r => r !== 'scorer' && r !== 'referee'), ...canonScore(score)];
}

export type RemoveDecision =
  | { ok: false; reason: 'STAFF_PROTECTED' | 'FORBIDDEN' }
  | { ok: true; roles: string[]; scoreRoles: ScoreRole[]; clearMatches: boolean };

/**
 * 主辦角色不可移除（STAFF_PROTECTED，呼叫者是誰都一樣）。
 * 共同主辦只有主辦能移除；共同主辦呼叫回 FORBIDDEN。
 * 沒有帶 host／coHost 時只動記分角色，主辦文件會留下。
 */
export function decideRemoval(current: readonly string[], requested: readonly string[], primary: boolean): RemoveDecision {
  const removing = new Set(requested);
  if (current.includes('host') && removing.has('host')) return { ok: false, reason: 'STAFF_PROTECTED' };
  if (current.includes('coHost') && removing.has('coHost') && !primary) return { ok: false, reason: 'FORBIDDEN' };
  const roles = current.filter(r => !removing.has(r));
  const scoreRoles = canonScore(roles);
  return { ok: true, roles, scoreRoles, clearMatches: scoreRoles.length === 0 };
}

/** 有給就用（不得早於現在）；沒給則 lastMatchAt + 7 天，算出來早於現在也拒。 */
export function resolveExpiresAt(given: number | null, lastMatchAtMs: number, nowMs: number): number {
  const exp = given ?? lastMatchAtMs + SCORE_ASSIGN_MS;
  if (!Number.isInteger(exp) || exp < nowMs || exp > EXPIRES_MAX) {
    throw bad('FIELD_RANGE', { field: 'expiresAt', min: nowMs, max: EXPIRES_MAX });
  }
  return exp;
}

function canonScore(list: readonly string[]): ScoreRole[] {
  const found = new Set(list);
  return SCORE_ORDER.filter(r => found.has(r));
}

function stringList(snap: DocumentSnapshot, field: string): string[] {
  if (!snap.exists) return [];
  const raw = snap.get(field);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

function scoreRolesInput(v: unknown): ScoreRole[] {
  if (!Array.isArray(v)) throw bad('FIELD_TYPE', { field: 'roles' });
  if (v.length < 1 || v.length > SCORE_ORDER.length) {
    throw bad('FIELD_RANGE', { field: 'roles', min: 1, max: SCORE_ORDER.length });
  }
  const out: ScoreRole[] = [];
  for (const r of v) {
    if (r !== 'scorer' && r !== 'referee') throw bad('FIELD_ENUM', { field: 'roles' });
    if (out.includes(r)) throw bad('FIELD_DUPLICATE', { field: 'roles' });
    out.push(r);
  }
  return canonScore(out);
}

function removeRolesInput(v: unknown): string[] {
  if (v == null) return ['scorer', 'referee'];
  const allowed = ['host', 'coHost', 'scorer', 'referee'];
  if (!Array.isArray(v)) throw bad('FIELD_TYPE', { field: 'roles' });
  if (v.length < 1 || v.length > allowed.length) throw bad('FIELD_RANGE', { field: 'roles', min: 1, max: allowed.length });
  const out: string[] = [];
  for (const r of v) {
    if (typeof r !== 'string' || !allowed.includes(r)) throw bad('FIELD_ENUM', { field: 'roles' });
    if (out.includes(r)) throw bad('FIELD_DUPLICATE', { field: 'roles' });
    out.push(r);
  }
  return out;
}

function matchIdsInput(v: unknown): string[] {
  if (!Array.isArray(v)) throw bad('FIELD_TYPE', { field: 'matchIds' });
  if (v.length > 100) throw bad('FIELD_RANGE', { field: 'matchIds', min: 0, max: 100 });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of v) {
    if (typeof id !== 'string' || !MTID_RE.test(id)) throw bad('BAD_ID', { field: 'matchIds' });
    if (seen.has(id)) throw bad('FIELD_DUPLICATE', { field: 'matchIds' });
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 有帶才檢查；省略回 null，交給交易內用末場+7 天。 */
function expiresGiven(v: unknown, nowMs: number): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < nowMs || v > EXPIRES_MAX) {
    throw bad('FIELD_RANGE', { field: 'expiresAt', min: nowMs, max: EXPIRES_MAX });
  }
  return v;
}

/**
 * 已結束則擋下非管理員。寬限只給末場確認（endedBy:'confirm'）的 3 天。
 * 與 match-host assertNotEnded 相同。
 */
function assertNotEnded(deps: CpDeps, comp: CompDoc, caller: Caller): void {
  if (!comp.endedAt || isAdmin(caller)) return;
  const graceOk = comp.endedBy === 'confirm'
    && deps.now().getTime() < comp.endedAt.toMillis() + SCHEDULE_LIMITS.endedGraceMs;
  if (!graceOk) throw pre('COMPETITION_ENDED');
}

async function openHost(
  deps: CpDeps, tx: Transaction, caller: Caller, gate: GateResult, cid: string
): Promise<{ comp: CompDoc; access: HostAccess }> {
  const comp = await loadComp(deps, tx, cid);
  assertCompVisible(comp, gate);
  const access = await hostAccess(deps, tx, cid, comp, caller);
  if (comp.hidden && !isAdmin(caller)) throw pre('COMPETITION_HIDDEN');
  if (comp.deletingAt) throw pre('COMPETITION_DELETING');
  if (comp.status === 'cancelled') throw pre('COMPETITION_CLOSED');
  assertNotEnded(deps, comp, caller);
  return { comp, access };
}

function targetStaff(deps: CpDeps, tx: Transaction, access: HostAccess, cid: string, uid: string, callerUid: string) {
  if (access.callerStaff && uid === callerUid) return Promise.resolve(access.callerStaff);
  return readDoc(deps, tx, deps.db.doc(`competitions/${cid}/staff/${uid}`));
}

/** 主辦判斷與對象 staff 讀完之後，還剩一格才讀 cpMine。 */
function mineReadFits(access: HostAccess, reusedStaff: boolean): boolean {
  const used = access.reads + (reusedStaff ? 0 : 1);
  return used + 1 <= STAFF_READ_BUDGET;
}

async function readMatches(deps: CpDeps, tx: Transaction, cid: string, matchIds: readonly string[]) {
  if (matchIds.length === 0) return [];
  const refs = matchIds.map(id => deps.db.doc(`competitions/${cid}/matches/${id}`));
  const first = refs[0];
  if (!first) return [];
  // 一批讀完（上限 100）。缺的文件也算 1 讀，接著整筆拒絕、不寫。
  const snaps = await tx.getAll(first, ...refs.slice(1));
  deps.meter?.add(snaps.length);
  return snaps;
}

interface MineSync {
  write: (() => void) | null;
  /** 交易外補 arrayUnion 的角色；不讀。 */
  pendingAdd: ScoreRole[];
}

async function syncMine(
  deps: CpDeps,
  tx: Transaction,
  fits: boolean,
  uid: string,
  cid: string,
  comp: CompDoc,
  prevScore: readonly string[],
  nextScore: readonly ScoreRole[]
): Promise<MineSync> {
  if (fits) {
    const write = await prepareMine(deps, tx, uid, cid, comp, { scoreRoles: nextScore });
    return { write, pendingAdd: [] };
  }
  return {
    write: null,
    pendingAdd: applyMineScoreBlind(tx, deps, uid, cid, comp, prevScore, nextScore)
  };
}

async function finishMine(deps: CpDeps, uid: string, cid: string, pending: readonly ScoreRole[]): Promise<void> {
  if (pending.length === 0) return;
  const [first, ...rest] = pending;
  await deps.db.doc(`cpMine/${uid}/items/${cid}`).set({
    roles: FieldValue.arrayUnion(first, ...rest),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

export async function assignStaff(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ASSIGN_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const uid = requireUid(input.uid);
  const nowMs = deps.now().getTime();
  const scoreRoles = scoreRolesInput(input.roles);
  const matchIds = matchIdsInput(input.matchIds);
  const givenExp = expiresGiven(input.expiresAt, nowMs);

  let pending: ScoreRole[] = [];
  const result = await deps.db.runTransaction(async tx => {
    const { comp, access } = await openHost(deps, tx, caller, gate, cid);
    const exp = resolveExpiresAt(givenExp, comp.lastMatchAt.toMillis(), nowMs);
    const staffSnap = await targetStaff(deps, tx, access, cid, uid, caller.uid);
    const reused = staffSnap === access.callerStaff;
    if (uid !== caller.uid && !staffSnap.exists) throw notFound('STAFF_NOT_FOUND');
    const snaps = await readMatches(deps, tx, cid, matchIds);
    if (snaps.some(s => !s.exists)) throw notFound('MATCH_NOT_FOUND');

    const existing = stringList(staffSnap, 'roles');
    const prevScore = canonScore(existing);
    const roles = staffRolesAfterAssign(existing, scoreRoles);
    const mine = await syncMine(deps, tx, mineReadFits(access, reused), uid, cid, comp, prevScore, scoreRoles);

    const now = FieldValue.serverTimestamp();
    const ref = deps.db.doc(`competitions/${cid}/staff/${uid}`);
    tx.set(ref, {
      roles,
      matchIds,
      expiresAt: Timestamp.fromMillis(exp),
      updatedAt: now,
      ...(staffSnap.exists ? {} : { createdAt: now })
    }, { merge: true });
    mine.write?.();
    writeAudit(deps, tx, cid, caller, 'assignStaff', {
      target: actorHash(cid, uid),
      roles: scoreRoles,
      matchCount: matchIds.length
    });
    pending = mine.pendingAdd;
    return { roles, matchCount: matchIds.length, expiresAt: exp };
  });
  await finishMine(deps, uid, cid, pending);
  return result;
}

export async function removeStaff(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, REMOVE_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const uid = requireUid(input.uid);
  const requested = removeRolesInput(input.roles);

  let pending: ScoreRole[] = [];
  const result = await deps.db.runTransaction(async tx => {
    const { comp, access } = await openHost(deps, tx, caller, gate, cid);
    const staffSnap = await targetStaff(deps, tx, access, cid, uid, caller.uid);
    const reused = staffSnap === access.callerStaff;
    if (!staffSnap.exists) throw notFound('STAFF_NOT_FOUND');
    const current = stringList(staffSnap, 'roles');
    const decision = decideRemoval(current, requested, access.primary);
    if (!decision.ok) {
      if (decision.reason === 'FORBIDDEN') throw deny('FORBIDDEN');
      throw pre(decision.reason);
    }
    const prevMatches = stringList(staffSnap, 'matchIds');
    const prevScore = canonScore(current);
    const mine = await syncMine(
      deps, tx, mineReadFits(access, reused), uid, cid, comp, prevScore, decision.scoreRoles
    );

    const ref = deps.db.doc(`competitions/${cid}/staff/${uid}`);
    const now = FieldValue.serverTimestamp();
    if (decision.roles.length === 0) tx.delete(ref);
    else {
      tx.set(ref, {
        roles: decision.roles,
        matchIds: decision.clearMatches ? [] : prevMatches,
        expiresAt: decision.clearMatches ? null : (staffSnap.get('expiresAt') ?? null),
        updatedAt: now
      }, { merge: true });
    }
    mine.write?.();
    const matchCount = decision.clearMatches ? 0 : prevMatches.length;
    writeAudit(deps, tx, cid, caller, 'removeStaff', {
      target: actorHash(cid, uid),
      roles: requested,
      matchCount
    });
    pending = mine.pendingAdd;
    return { roles: decision.roles, deleted: decision.roles.length === 0, matchCount };
  });
  await finishMine(deps, uid, cid, pending);
  return result;
}

function requireUid(value: unknown): string {
  if (typeof value !== 'string' || !UID_RE.test(value)) throw bad('BAD_ID', { field: 'uid' });
  return value;
}

export const STAFF_ACTIONS = {
  assignStaff,
  removeStaff
} as const;
