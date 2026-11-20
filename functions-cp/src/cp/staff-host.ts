/**
 * cpHost 第 4 步最小指派：assignStaff、removeStaff；邀請記分員：createInvite、revokeInvite（接受邀請 acceptInvite 在 participant.ts）。
 * assignStaff 只能指派呼叫者自己，或已經有 staff 文件的人；其他人走邀請（一次性代碼，只存雜湊）。
 * 只處理記分角色 scorer／referee。共同主辦、工作人員的「指派」不做；移除時若傳入 coHost，仍照契約判斷。
 *
 * 權限：launchGate（外層）→ 交易內 loadComp → assertCompVisible → hostAccess（與 assertHostOrCo 同一套）
 * → 未下架、未刪除中、未取消、未結束（結束沿用 match-host 的寬限：末場確認 3 天，管理員不受限）。
 * 公開場次不放 uid。稽核只記操作者雜湊與對象 uid 雜湊。
 *
 * cpMine 一律在交易內用 prepareMine(..., { scoreRoles }) 讀取後整份重算；記分角色空了且沒有其他索引角色就刪文件。
 * 讀取預算：assignStaff ≤ 閘門 2＋賽事 1＋主辦判斷 ≤2＋對象 staff 1＋cpMine 1＋場次 ≤100；
 * removeStaff ≤ 閘門 2＋賽事 1＋主辦判斷 ≤2＋對象 staff 1＋cpMine 1。
 * K10 成員編號用這次已讀的賽事文件 staffSeq，+0 讀。只有新建 staff 才多寫 1 次賽事文件。
 * 呼叫者就是對象、而且主辦判斷已經讀過那份 staff 時直接重用，省 1 讀。
 * 記分守門（assertMayTouchStaff）只用已經讀到的 roles，不加讀。被拒時不再讀場次與 cpMine。
 * removeStaff 先跑 decideRemoval（要移除 host 仍是 STAFF_PROTECTED），通過後才跑守門。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { CpError, bad, deny, notFound, pre } from './errors.js';
import {
  CID_RE,
  FieldValue,
  IVID_RE,
  Timestamp,
  actorHash,
  assertCompVisible,
  hostAccess,
  isAdmin,
  loadComp,
  newId,
  readDoc,
  requireId,
  writeAudit,
  type Caller,
  type CompDoc,
  type CpDeps,
  type GateResult,
  type HostAccess
} from './context.js';
import { prepareMine, type ScoreRole } from './mine.js';
import { assertNotEnded } from './match-host.js';
import { cleanLine, findBannedWord } from './text.js';
import { onlyKeys } from './validate.js';

/** 建賽時主辦 staff 的固定編號，也是缺 staffSeq 時當成的「目前已知最大號」。 */
export const HOST_MEMBER_NO = 1;

/**
 * 新 staff 的 memberNo。staffSeq 缺值、非整數或小於 1 時，已知最大號當 1，再加 1。
 * 不回收已刪除的號碼：呼叫端把這個值寫回賽事文件的 staffSeq。已存在的文件不要呼叫。
 */
export function memberNoForNewStaff(staffSeq: unknown): number {
  const known = typeof staffSeq === 'number' && Number.isInteger(staffSeq) && staffSeq >= HOST_MEMBER_NO
    ? staffSeq
    : HOST_MEMBER_NO;
  return known + 1;
}

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MTID_RE = /^mt_[A-Za-z0-9]{20}$/;
/** 沒帶 expiresAt 時：末場時刻再加 7 天。 */
export const SCORE_ASSIGN_MS = 7 * 86400_000;
const EXPIRES_MAX = 8_640_000_000_000;
const SCORE_ORDER = ['scorer', 'referee'] as const;
const ASSIGN_KEYS = ['action', 'cid', 'uid', 'roles', 'matchIds', 'expiresAt'];
const REMOVE_KEYS = ['action', 'cid', 'uid', 'roles'];

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

/**
 * 共同主辦不得改動主辦或其他共同主辦的記分指派。
 * 三者同時成立才拒絕：不是自己、呼叫者不是主辦（primary 為 false）、對象現有 roles 含 host 或 coHost。
 * 主辦（個人 staff host、俱樂部目前代表、管理員；這三種 primary 為 true）與改自己不受限。不讀文件。
 */
export function assertMayTouchStaff(existingRoles: readonly string[], isSelf: boolean, primary: boolean): void {
  if (isSelf || primary) return;
  if (existingRoles.includes('host') || existingRoles.includes('coHost')) throw deny('FORBIDDEN');
}

/** 有給就用（不得早於現在）；沒給則 lastMatchAt + 7 天，算出來早於現在也拒。 */
export function resolveExpiresAt(given: number | null, lastMatchAtMs: number, nowMs: number): number {
  const exp = given ?? lastMatchAtMs + SCORE_ASSIGN_MS;
  if (!Number.isInteger(exp) || exp < nowMs || exp > EXPIRES_MAX) {
    throw bad('FIELD_RANGE', { field: 'expiresAt', min: nowMs, max: EXPIRES_MAX });
  }
  return exp;
}

export function canonScore(list: readonly string[]): ScoreRole[] {
  const found = new Set(list);
  return SCORE_ORDER.filter(r => found.has(r));
}

export function stringList(snap: DocumentSnapshot, field: string): string[] {
  if (!snap.exists) return [];
  const raw = snap.get(field);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

export function scoreRolesInput(v: unknown): ScoreRole[] {
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

export function matchIdsInput(v: unknown): string[] {
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

/** 呼叫者就是對象、而且主辦判斷已經讀過這份 staff 時直接重用，省 1 讀。 */
function targetStaff(deps: CpDeps, tx: Transaction, access: HostAccess, cid: string, uid: string, callerUid: string) {
  if (access.callerStaff && uid === callerUid) return Promise.resolve(access.callerStaff);
  return readDoc(deps, tx, deps.db.doc(`competitions/${cid}/staff/${uid}`));
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

export async function assignStaff(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ASSIGN_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const uid = requireUid(input.uid);
  const nowMs = deps.now().getTime();
  const scoreRoles = scoreRolesInput(input.roles);
  const matchIds = matchIdsInput(input.matchIds);
  const givenExp = expiresGiven(input.expiresAt, nowMs);

  return deps.db.runTransaction(async tx => {
    const { comp, access } = await openHost(deps, tx, caller, gate, cid);
    const exp = resolveExpiresAt(givenExp, comp.lastMatchAt.toMillis(), nowMs);
    const staffSnap = await targetStaff(deps, tx, access, cid, uid, caller.uid);
    if (uid !== caller.uid && !staffSnap.exists) throw notFound('STAFF_NOT_FOUND');
    const existing = stringList(staffSnap, 'roles');
    // 讀到對象 staff 之後、任何寫入之前。被拒就不再讀場次與 cpMine。
    assertMayTouchStaff(existing, uid === caller.uid, access.primary);
    const snaps = await readMatches(deps, tx, cid, matchIds);
    if (snaps.some(s => !s.exists)) throw notFound('MATCH_NOT_FOUND');

    const roles = staffRolesAfterAssign(existing, scoreRoles);
    // 讀在所有寫入之前。整份重算，空了就刪。
    const writeMine = await prepareMine(deps, tx, uid, cid, comp, { scoreRoles });

    const now = FieldValue.serverTimestamp();
    const ref = deps.db.doc(`competitions/${cid}/staff/${uid}`);
    // 已存在的文件不改 memberNo，也不寫賽事文件。新建才配下一號，號碼不回收。
    if (staffSnap.exists) {
      tx.set(ref, {
        roles,
        matchIds,
        expiresAt: Timestamp.fromMillis(exp),
        updatedAt: now
      }, { merge: true });
    } else {
      const memberNo = memberNoForNewStaff(comp.staffSeq);
      tx.set(ref, {
        roles,
        matchIds,
        expiresAt: Timestamp.fromMillis(exp),
        memberNo,
        updatedAt: now,
        createdAt: now
      }, { merge: true });
      tx.update(deps.db.doc(`competitions/${cid}`), { staffSeq: memberNo });
    }
    writeMine();
    writeAudit(deps, tx, cid, caller, 'assignStaff', {
      target: actorHash(cid, uid),
      roles: scoreRoles,
      matchCount: matchIds.length
    });
    return { roles, matchCount: matchIds.length, expiresAt: exp };
  });
}

export async function removeStaff(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, REMOVE_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const uid = requireUid(input.uid);
  const requested = removeRolesInput(input.roles);

  return deps.db.runTransaction(async tx => {
    const { comp, access } = await openHost(deps, tx, caller, gate, cid);
    const staffSnap = await targetStaff(deps, tx, access, cid, uid, caller.uid);
    if (!staffSnap.exists) throw notFound('STAFF_NOT_FOUND');
    const current = stringList(staffSnap, 'roles');
    // 先決定移除：要移除 host → STAFF_PROTECTED，先於記分守門。通過後才看能不能動這個人。
    const decision = decideRemoval(current, requested, access.primary);
    if (!decision.ok) {
      if (decision.reason === 'FORBIDDEN') throw deny('FORBIDDEN');
      throw pre(decision.reason);
    }
    assertMayTouchStaff(current, uid === caller.uid, access.primary);
    const prevMatches = stringList(staffSnap, 'matchIds');
    const writeMine = await prepareMine(deps, tx, uid, cid, comp, { scoreRoles: decision.scoreRoles });

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
    writeMine();
    const matchCount = decision.clearMatches ? 0 : prevMatches.length;
    writeAudit(deps, tx, cid, caller, 'removeStaff', {
      target: actorHash(cid, uid),
      roles: requested,
      matchCount
    });
    return { roles: decision.roles, deleted: decision.roles.length === 0, matchCount };
  });
}

// ── 邀請記分員（§5.5、§6.1）────────────────────────────────────────────
// competitions/{cid}/invites/{ivId}：codeHash、roles、matchIds、expiresAt、status、createdAt、updatedAt；
// 接受後加 usedAt、usedMemberNo。主辦與共同主辦可讀 invites，所以文件不放任何 uid，也不放代碼原文。
// 代碼只在 createInvite 回傳一次。稽核只記雜湊與 ivId。

/** 每個賽事最多發出幾張邀請（inviteSeq，只增不減；撤銷不退額度）。 */
export const INVITE_MAX = 30;
/** 邀請代碼：randomBytes(16) 的 base64url，固定 22 字。 */
export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{22}$/;
/** staff.displayName 上限（code point）。 */
export const STAFF_NAME_MAX = 30;
const HEX64_RE = /^[0-9a-f]{64}$/;
const CREATE_INVITE_KEYS = ['action', 'cid', 'roles', 'matchIds', 'expiresAt'];
const REVOKE_INVITE_KEYS = ['action', 'cid', 'ivId'];

export function newInviteCode(): string {
  return randomBytes(16).toString('base64url');
}

/** sha256(code) 十六進位小寫。 */
export function inviteCodeHash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** 常數時間比對。存的雜湊不是 64 碼十六進位時一律不符。 */
export function inviteCodeMatches(code: string, stored: unknown): boolean {
  if (typeof stored !== 'string' || !HEX64_RE.test(stored)) return false;
  const a = Buffer.from(inviteCodeHash(code), 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 已用的邀請數：缺值、非整數或負數當 0。 */
export function inviteSeqOf(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * 邀請到期：沒帶＝末場＋7 天；帶了不得早於現在、不得晚於末場＋7 天。
 * 末場＋7 天本身早於現在（賽事早就過了）也拒。
 */
export function resolveInviteExpiresAt(given: number | null, lastMatchAtMs: number, nowMs: number): number {
  const cap = lastMatchAtMs + SCORE_ASSIGN_MS;
  const exp = given ?? cap;
  if (!Number.isInteger(exp) || exp < nowMs || exp > cap) {
    throw bad('FIELD_RANGE', { field: 'expiresAt', min: nowMs, max: cap });
  }
  return exp;
}

/** 主庫顯示名清理：NFKC 單行、≤30 字；空或含禁用字回 null（前端退回「成員 N」）。 */
export function staffDisplayName(raw: unknown, bannedWords: readonly string[]): string | null {
  const s = cleanLine(raw);
  if (!s) return null;
  const name = [...s].slice(0, STAFF_NAME_MAX).join('').trim();
  if (!name) return null;
  if (findBannedWord(name, bannedWords)) return null;
  return name;
}

export interface InviteMergeInput {
  /** 對象現有 staff（不存在時 roles、matchIds 為空、expiresAtMs 為 null）。 */
  existing: { roles: readonly string[]; matchIds: readonly string[]; expiresAtMs: number | null };
  invite: { roles: readonly string[]; matchIds: readonly string[]; expiresAtMs: number };
}

/**
 * 接受邀請後的 staff 指派：角色＝原本記分角色 ∪ 邀請角色（host／coHost 保留）；
 * 場次＝原本 ∪ 邀請（去重，超過 100 回 FIELD_RANGE 不寫）；到期取較晚者。
 * 原本「有記分角色」時 expiresAt null 代表不過期，保留 null。
 * 原本沒有記分角色（例如主辦建賽時的 expiresAt null、共同主辦）時 null 不是指派，改用邀請的到期。
 */
export function mergeInviteAssignment({ existing, invite }: InviteMergeInput) {
  const existingScore = canonScore(existing.roles);
  const scoreRoles = canonScore([...existingScore, ...invite.roles]);
  const roles = staffRolesAfterAssign(existing.roles, scoreRoles);
  const matchIds = [...new Set([...existing.matchIds, ...invite.matchIds])];
  if (matchIds.length > 100) throw bad('FIELD_RANGE', { field: 'matchIds', min: 0, max: 100 });
  let expiresAtMs: number | null;
  if (existingScore.length === 0) expiresAtMs = invite.expiresAtMs;
  else if (existing.expiresAtMs == null) expiresAtMs = null;
  else expiresAtMs = Math.max(existing.expiresAtMs, invite.expiresAtMs);
  return { roles, scoreRoles, matchIds, expiresAtMs };
}

/**
 * 建立邀請（主辦或共同主辦）。只能邀記分角色。
 * 讀取：閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋場次 n（≤100）。inviteSeq 用已讀的賽事文件，+0 讀。
 */
export async function createInvite(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, CREATE_INVITE_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const nowMs = deps.now().getTime();
  const roles = scoreRolesInput(input.roles);
  const matchIds = matchIdsInput(input.matchIds);
  const givenExp = expiresGiven(input.expiresAt, nowMs);

  return deps.db.runTransaction(async tx => {
    const { comp } = await openHost(deps, tx, caller, gate, cid);
    const seq = inviteSeqOf(comp.inviteSeq);
    if (seq >= INVITE_MAX) throw new CpError('resource-exhausted', 'INVITE_LIMIT', { max: INVITE_MAX });
    const exp = resolveInviteExpiresAt(givenExp, comp.lastMatchAt.toMillis(), nowMs);
    const snaps = await readMatches(deps, tx, cid, matchIds);
    if (snaps.some(s => !s.exists)) throw notFound('MATCH_NOT_FOUND');

    const ivId = newId('iv');
    const code = newInviteCode();
    const now = FieldValue.serverTimestamp();
    tx.create(deps.db.doc(`competitions/${cid}/invites/${ivId}`), {
      codeHash: inviteCodeHash(code),
      roles,
      matchIds,
      expiresAt: Timestamp.fromMillis(exp),
      status: 'open',
      createdAt: now,
      updatedAt: now
    });
    tx.update(deps.db.doc(`competitions/${cid}`), { inviteSeq: seq + 1 });
    writeAudit(deps, tx, cid, caller, 'createInvite', { ivId, roles, matchCount: matchIds.length });
    return { ivId, code, expiresAt: exp };
  });
}

/**
 * 撤銷邀請（主辦或共同主辦）。只有 open 可撤；已接受的人要拿掉走 removeStaff。撤銷不退 inviteSeq。
 * 讀取：閘門 ≤2＋賽事 1＋主辦判斷 ≤2＋邀請 1。
 */
export async function revokeInvite(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, REVOKE_INVITE_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const ivId = requireId(input.ivId, IVID_RE, 'ivId');

  return deps.db.runTransaction(async tx => {
    await openHost(deps, tx, caller, gate, cid);
    const ref = deps.db.doc(`competitions/${cid}/invites/${ivId}`);
    const snap = await readDoc(deps, tx, ref);
    if (!snap.exists) throw notFound('INVITE_NOT_FOUND');
    if (snap.get('status') !== 'open') throw pre('INVITE_NOT_OPEN');
    tx.update(ref, { status: 'revoked', updatedAt: FieldValue.serverTimestamp() });
    writeAudit(deps, tx, cid, caller, 'revokeInvite', { ivId });
    return { ivId, status: 'revoked' as const };
  });
}

function requireUid(value: unknown): string {
  if (typeof value !== 'string' || !UID_RE.test(value)) throw bad('BAD_ID', { field: 'uid' });
  return value;
}

export const STAFF_ACTIONS = {
  assignStaff,
  removeStaff,
  createInvite,
  revokeInvite
} as const;
