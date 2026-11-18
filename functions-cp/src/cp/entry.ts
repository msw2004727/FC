/**
 * cpEntry 第 2 步動作（§6.1）：registerEntry、reviewEntry、withdrawEntry、joinRoster、addRosterByRep、
 * leaveRoster、confirmRoster、lockRosters。流程：代表報隊 → 成員登錄（或代表代填）→ 代表確認 → 主辦審核與鎖定（檢錄）。
 *
 * 個資（§4.3、§4.4、§15）：生日只用來算 isMinor／ageEligible，不寫進賽事庫；真名只在 rosterPrivate；
 * 公開 roster 只有顯示名、背號、位置、isMinor；未成年公開名只能是姓氏候選之一。
 */
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { evaluateAge } from './age.js';
import { CpError, bad, deny, notFound, pre } from './errors.js';
import {
  CID_RE,
  DVID_RE,
  ENID_RE,
  FieldValue,
  PLID_RE,
  TEAM_ID_RE,
  assertCompVisible,
  isClubMember,
  isClubRep,
  isHostOrCo,
  launchGate,
  loadComp,
  newId,
  readDoc,
  readQuery,
  requireId,
  writeAudit,
  type Caller,
  type CompDoc,
  type CpDeps,
  type GateResult
} from './context.js';
import { cleanLine, findBannedWord, minorPublicNameCandidates, optionalLine, requireLine, surnameOf } from './text.js';
import { asRecord, onlyKeys, requireEnum, statusReasonOf } from './validate.js';

export const POSITIONS = ['GK', 'DF', 'MF', 'FW'] as const;
/** 每組報隊上限（含待審）：maxTeams 的 2 倍，防灌報名 */
export const PENDING_FACTOR = 2;

type Tx = Transaction;
interface EntryDoc { dvId: string; teamId: string; name: string; status: string; rosterCount: number; rosterConfirmed: boolean }
interface DivisionDoc {
  name: string; maxTeams: number; rosterMin: number; rosterMax: number;
  minAge: number | null; maxAge: number | null; requireRealName: boolean;
  entryCount: number; approvedCount: number;
}

const nowMsOf = (deps: CpDeps) => deps.now().getTime();

/** 報隊、名單異動共同前提：已發布、未下架、未結束、名單未鎖、首場前。 */
function assertRosterPhase(comp: CompDoc, nowMs: number): void {
  if (comp.status !== 'published') throw pre('COMPETITION_NOT_OPEN', { status: comp.status });
  if (comp.hidden) throw pre('COMPETITION_HIDDEN');
  if (comp.endedAt) throw pre('COMPETITION_CLOSED');
  if (comp.rostersLockedAt) throw pre('ROSTERS_LOCKED');
  if (nowMs >= comp.firstMatchAt.toMillis()) throw pre('COMPETITION_STARTED');
}

async function loadEntry(deps: CpDeps, tx: Tx, cid: string, enId: string): Promise<{ ref: DocumentReference; data: EntryDoc }> {
  const ref = deps.db.doc(`competitions/${cid}/entries/${enId}`);
  const snap = await readDoc(deps, tx, ref);
  if (!snap.exists) throw notFound('ENTRY_NOT_FOUND');
  return { ref, data: snap.data() as EntryDoc };
}

async function loadDivision(deps: CpDeps, tx: Tx, cid: string, dvId: string): Promise<{ ref: DocumentReference; data: DivisionDoc }> {
  const ref = deps.db.doc(`competitions/${cid}/divisions/${dvId}`);
  const snap = await readDoc(deps, tx, ref);
  if (!snap.exists) throw notFound('DIVISION_NOT_FOUND');
  return { ref, data: snap.data() as DivisionDoc };
}

// ── cpMine 索引（§5.2：伺服器在登錄、報隊時寫；只存索引不存個資）──────────
interface MineChange { addEntry?: string; removeEntry?: string; addPlayer?: string; removePlayer?: string }

/** 讀（交易讀階段呼叫）→ 回傳寫入函式（寫階段呼叫）。 */
async function prepareMine(deps: CpDeps, tx: Tx, uid: string, cid: string, comp: CompDoc, ch: MineChange): Promise<() => void> {
  const ref = deps.db.doc(`cpMine/${uid}/items/${cid}`);
  const snap: DocumentSnapshot = await readDoc(deps, tx, ref);
  const entryIds = new Set<string>(snap.exists && Array.isArray(snap.get('entryIds')) ? snap.get('entryIds') : []);
  const plIds = new Set<string>(snap.exists && Array.isArray(snap.get('plIds')) ? snap.get('plIds') : []);
  if (ch.addEntry) entryIds.add(ch.addEntry);
  if (ch.removeEntry) entryIds.delete(ch.removeEntry);
  if (ch.addPlayer) plIds.add(ch.addPlayer);
  if (ch.removePlayer) plIds.delete(ch.removePlayer);
  const roles = [...(entryIds.size ? ['rep'] : []), ...(plIds.size ? ['player'] : [])];
  return () => {
    if (roles.length === 0) {
      if (snap.exists) tx.delete(ref);
      return;
    }
    tx.set(ref, {
      cid, name: comp.name, firstMatchAt: comp.firstMatchAt, roles,
      entryIds: [...entryIds], plIds: [...plIds], updatedAt: FieldValue.serverTimestamp()
    });
  };
}

// ── registerEntry ─────────────────────────────────────────────────────
const PHONE_RE = /^[0-9+\-() ]{6,20}$/;

export async function registerEntry(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId', 'teamId', 'teamName', 'contactName', 'contactPhone']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  if (typeof input.teamId !== 'string' || !TEAM_ID_RE.test(input.teamId)) throw bad('BAD_ID', { field: 'teamId' });
  const teamId = input.teamId;
  const teamNameIn = optionalLine(input.teamName, 'teamName', 30);
  if (teamNameIn && findBannedWord(teamNameIn)) throw bad('BANNED_WORD', { field: 'teamName' });
  const contactName = optionalLine(input.contactName, 'contactName', 30);
  const contactPhone = optionalLine(input.contactPhone, 'contactPhone', 20);
  if (contactPhone && !PHONE_RE.test(contactPhone)) throw bad('FIELD_FORMAT', { field: 'contactPhone' });
  const nowMs = nowMsOf(deps);
  const enId = newId('en');

  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    assertRosterPhase(comp, nowMs);
    if (nowMs < comp.regOpenAt.toMillis()) throw pre('REG_NOT_OPEN');
    if (nowMs >= comp.regCloseAt.toMillis()) throw pre('REG_CLOSED');
    const rep = await isClubRep(deps, tx, teamId, caller.uid);
    if (!rep.ok) throw deny('NOT_CLUB_REP');
    const dv = await loadDivision(deps, tx, cid, dvId);
    if ((dv.data.entryCount ?? 0) >= dv.data.maxTeams * PENDING_FACTOR) throw new CpError('resource-exhausted', 'DIVISION_FULL');
    const dup = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/entries`)
      .where('teamId', '==', teamId).where('dvId', '==', dvId)
      .where('status', 'in', ['pending', 'approved']).limit(1));
    if (!dup.empty) throw new CpError('already-exists', 'ENTRY_EXISTS');
    const writeMine = await prepareMine(deps, tx, caller.uid, cid, comp, { addEntry: enId });

    const now = FieldValue.serverTimestamp();
    const name = teamNameIn ?? rep.name ?? '隊伍';
    tx.create(deps.db.doc(`competitions/${cid}/entries/${enId}`), {
      dvId, teamId, name, status: 'pending', rosterCount: 0, rosterConfirmed: false,
      createdAt: now, updatedAt: now
    });
    tx.create(deps.db.doc(`competitions/${cid}/entryPrivate/${enId}`), {
      dvId, teamId, registeredByUid: caller.uid, contactName, contactPhone,
      // §8.4 支付接點：只預留狀態，不實作繳費
      paymentStatus: 'none', reviewNote: null, createdAt: now, updatedAt: now
    });
    tx.update(dv.ref, { entryCount: FieldValue.increment(1), updatedAt: now });
    writeMine();
    writeAudit(deps, tx, cid, caller, 'registerEntry', { enId, dvId });
  });
  return { cid, enId, status: 'pending' };
}

// ── reviewEntry（主辦審核；拒絕必填原因）──────────────────────────────
export async function reviewEntry(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId', 'decision', 'reason']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  const decision = requireEnum(input.decision, ['approve', 'reject'] as const, 'decision');
  const reason = decision === 'reject' ? statusReasonOf(input.reason) : null;
  const nowMs = nowMsOf(deps);
  let status = '';
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    if (!(await isHostOrCo(deps, tx, cid, comp, caller))) throw deny('NOT_HOST');
    assertRosterPhase(comp, nowMs);
    const entry = await loadEntry(deps, tx, cid, enId);
    const dv = await loadDivision(deps, tx, cid, entry.data.dvId);
    const now = FieldValue.serverTimestamp();
    if (decision === 'approve') {
      if (entry.data.status !== 'pending') throw pre('ENTRY_STATE', { status: entry.data.status });
      if ((dv.data.approvedCount ?? 0) >= dv.data.maxTeams) throw new CpError('resource-exhausted', 'DIVISION_APPROVED_FULL');
      tx.update(dv.ref, { approvedCount: FieldValue.increment(1), updatedAt: now });
      status = 'approved';
    } else {
      if (entry.data.status !== 'pending' && entry.data.status !== 'approved') throw pre('ENTRY_STATE', { status: entry.data.status });
      tx.update(dv.ref, {
        entryCount: FieldValue.increment(-1),
        ...(entry.data.status === 'approved' ? { approvedCount: FieldValue.increment(-1) } : {}),
        updatedAt: now
      });
      status = 'rejected';
    }
    tx.update(entry.ref, { status, updatedAt: now });
    tx.update(deps.db.doc(`competitions/${cid}/entryPrivate/${enId}`), { reviewNote: reason, updatedAt: now });
    writeAudit(deps, tx, cid, caller, 'reviewEntry', { enId, decision });
  });
  return { cid, enId, status };
}

// ── withdrawEntry（代表撤隊；連同該隊名單一併移除，球員可改報他隊）──────
export async function withdrawEntry(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  const nowMs = nowMsOf(deps);
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    assertRosterPhase(comp, nowMs);
    const entry = await loadEntry(deps, tx, cid, enId);
    if (!(await isClubRep(deps, tx, entry.data.teamId, caller.uid)).ok) throw deny('NOT_CLUB_REP');
    if (entry.data.status !== 'pending' && entry.data.status !== 'approved') throw pre('ENTRY_STATE', { status: entry.data.status });
    const dv = await loadDivision(deps, tx, cid, entry.data.dvId);
    const priv = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/entryPrivate/${enId}`));
    const registrant = priv.exists ? priv.get('registeredByUid') : null;
    const roster = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/rosterPrivate`)
      .where('enId', '==', enId).limit(60));
    const mineWrites: (() => void)[] = [];
    // 同一人可能同時是報隊者與本隊球員：合併成一次 cpMine 變更
    const changes = new Map<string, MineChange>();
    if (typeof registrant === 'string' && registrant) changes.set(registrant, { removeEntry: enId });
    for (const d of roster.docs) {
      const u = d.get('uid');
      if (typeof u === 'string' && u) changes.set(u, { ...(changes.get(u) ?? {}), removePlayer: d.id });
    }
    for (const [u, ch] of changes) mineWrites.push(await prepareMine(deps, tx, u, cid, comp, ch));

    const now = FieldValue.serverTimestamp();
    for (const d of roster.docs) {
      tx.delete(d.ref);
      tx.delete(deps.db.doc(`competitions/${cid}/roster/${d.id}`));
    }
    tx.update(entry.ref, { status: 'withdrawn', rosterCount: 0, rosterConfirmed: false, updatedAt: now });
    tx.update(dv.ref, {
      entryCount: FieldValue.increment(-1),
      ...(entry.data.status === 'approved' ? { approvedCount: FieldValue.increment(-1) } : {}),
      updatedAt: now
    });
    mineWrites.forEach(w => w());
    writeAudit(deps, tx, cid, caller, 'withdrawEntry', { enId, removedPlayers: roster.size });
  });
  return { cid, enId, status: 'withdrawn' };
}

// ── 名單：共用驗證 ─────────────────────────────────────────────────────
interface PlayerInput {
  number: number;
  position: string | null;
  realName: string | null;
  publicName: string | null;
  nickname: string | null;
  guardianConsent: boolean;
}

function playerInputOf(input: Record<string, unknown>): PlayerInput {
  const number = input.number;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 99) {
    throw bad('FIELD_RANGE', { field: 'number', min: 0, max: 99 });
  }
  const position = input.position == null ? null : requireEnum(input.position, POSITIONS, 'position');
  if (input.privacyAck !== true) throw bad('PRIVACY_ACK_REQUIRED', { field: 'privacyAck' });
  if (input.guardianConsent != null && typeof input.guardianConsent !== 'boolean') throw bad('FIELD_TYPE', { field: 'guardianConsent' });
  const realName = optionalLine(input.realName, 'realName', 40);
  const publicName = optionalLine(input.publicName, 'publicName', 20);
  const nickname = optionalLine(input.nickname, 'nickname', 20);
  if (nickname && findBannedWord(nickname)) throw bad('BANNED_WORD', { field: 'nickname' });
  return { number, position, realName, publicName, nickname, guardianConsent: input.guardianConsent === true };
}

/**
 * 依年齡結果決定公開顯示名與私密真名（§4.3）：
 * - 真名必填：組別 requireRealName 或未成年。
 * - 未成年：必勾監護人同意；公開名只能是姓氏候選之一（未指定時用 surnameOf）。
 * - 成年：暱稱優先，否則用 fallback（自己登錄＝主站顯示名；代填＝真名）。
 */
function resolveNames(p: PlayerInput, isMinor: boolean, requireRealName: boolean, adultFallback: string | null) {
  if ((requireRealName || isMinor) && !p.realName) throw bad('REAL_NAME_REQUIRED', { field: 'realName' });
  if (isMinor) {
    if (!p.guardianConsent) throw bad('GUARDIAN_CONSENT_REQUIRED', { field: 'guardianConsent' });
    const candidates = minorPublicNameCandidates(p.realName!);
    const displayName = p.publicName ?? surnameOf(p.realName!);
    if (!candidates.includes(displayName)) throw bad('MINOR_PUBLIC_NAME', { field: 'publicName' });
    return { displayName, realName: p.realName };
  }
  if (p.publicName) throw bad('UNKNOWN_FIELD', { field: 'publicName' });
  const displayName = p.nickname ?? (cleanLine(adultFallback ?? '')?.slice(0, 30) || '球員');
  return { displayName, realName: p.realName };
}

async function assertNumberFree(deps: CpDeps, tx: Tx, cid: string, enId: string, number: number) {
  const dup = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/roster`)
    .where('enId', '==', enId).where('number', '==', number).limit(1));
  if (!dup.empty) throw new CpError('already-exists', 'NUMBER_TAKEN');
}

function assertEntryAcceptsRoster(entry: EntryDoc, dv: DivisionDoc) {
  if (entry.status !== 'pending' && entry.status !== 'approved') throw pre('ENTRY_STATE', { status: entry.status });
  if ((entry.rosterCount ?? 0) >= dv.rosterMax) throw new CpError('resource-exhausted', 'ROSTER_FULL', { max: dv.rosterMax });
}

// ── joinRoster（成員自己登錄）─────────────────────────────────────────
export async function joinRoster(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId', 'number', 'position', 'realName', 'publicName', 'nickname', 'guardianConsent', 'privacyAck']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  const p = playerInputOf(input);
  const nowMs = nowMsOf(deps);
  // 主站 users：只讀顯示名與生日（生日算完即丟，不寫賽事庫）
  const user = await readDoc(deps, null, deps.mainDb.doc(`users/${caller.uid}`));
  const birthday = user.exists ? user.get('birthday') : null;
  const mainDisplayName = user.exists && typeof user.get('displayName') === 'string' ? (user.get('displayName') as string) : null;
  const plId = newId('pl');
  let isMinorOut = false;

  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    assertRosterPhase(comp, nowMs);
    const entry = await loadEntry(deps, tx, cid, enId);
    const dv = await loadDivision(deps, tx, cid, entry.data.dvId);
    assertEntryAcceptsRoster(entry.data, dv.data);
    const member = await isClubMember(deps, tx, entry.data.teamId, caller.uid)
      || (await isClubRep(deps, tx, entry.data.teamId, caller.uid)).ok;
    if (!member) throw deny('NOT_CLUB_MEMBER');
    const age = evaluateAge(birthday, comp.firstMatchAt.toDate(), dv.data);
    if (!age) throw pre('BIRTHDAY_REQUIRED');
    if (!age.ageEligible) throw pre('AGE_NOT_ELIGIBLE', {
      ...(dv.data.minAge != null ? { minAge: dv.data.minAge } : {}),
      ...(dv.data.maxAge != null ? { maxAge: dv.data.maxAge } : {})
    });
    const names = resolveNames(p, age.isMinor, dv.data.requireRealName, mainDisplayName);
    // 同一賽事一人只能在一份名單（不分組別、不分隊）
    const dupUid = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/rosterPrivate`)
      .where('uid', '==', caller.uid).limit(1));
    if (!dupUid.empty) throw new CpError('already-exists', 'ALREADY_IN_ROSTER');
    await assertNumberFree(deps, tx, cid, enId, p.number);
    const writeMine = await prepareMine(deps, tx, caller.uid, cid, comp, { addPlayer: plId });

    const now = FieldValue.serverTimestamp();
    tx.create(deps.db.doc(`competitions/${cid}/roster/${plId}`), {
      enId, dvId: entry.data.dvId, displayName: names.displayName, number: p.number,
      position: p.position, isMinor: age.isMinor, createdAt: now
    });
    tx.create(deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`), {
      enId, dvId: entry.data.dvId, teamId: entry.data.teamId, uid: caller.uid, realName: names.realName,
      isMinor: age.isMinor, ageEligible: age.ageEligible, guardianConsent: age.isMinor ? true : null,
      source: 'self', addedByUid: null, privacyAckAt: now, createdAt: now
    });
    tx.update(entry.ref, { rosterCount: FieldValue.increment(1), rosterConfirmed: false, updatedAt: now });
    writeMine();
    writeAudit(deps, tx, cid, caller, 'joinRoster', { enId, plId, isMinor: age.isMinor });
    isMinorOut = age.isMinor;
  });
  return { cid, enId, plId, isMinor: isMinorOut };
}

// ── addRosterByRep（§4.4：隊長或領隊代填無帳號球員；uid 為 null）─────────
export async function addRosterByRep(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId', 'number', 'position', 'realName', 'birthday', 'publicName', 'nickname', 'guardianConsent', 'privacyAck']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  const p = playerInputOf(input);
  // 代填一律要真名（沒有主站帳號可帶名字）
  p.realName = requireLine(input.realName, 'realName', 1, 40);
  if (typeof input.birthday !== 'string') throw bad('FIELD_REQUIRED', { field: 'birthday' });
  const birthday = input.birthday; // 只在記憶體內使用，不寫入任何文件
  const nowMs = nowMsOf(deps);
  const plId = newId('pl');
  let isMinorOut = false;

  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    assertRosterPhase(comp, nowMs);
    const entry = await loadEntry(deps, tx, cid, enId);
    if (!(await isClubRep(deps, tx, entry.data.teamId, caller.uid)).ok) throw deny('NOT_CLUB_REP');
    const dv = await loadDivision(deps, tx, cid, entry.data.dvId);
    assertEntryAcceptsRoster(entry.data, dv.data);
    const age = evaluateAge(birthday, comp.firstMatchAt.toDate(), dv.data);
    if (!age) throw bad('BIRTHDAY_INVALID', { field: 'birthday' });
    if (!age.ageEligible) throw pre('AGE_NOT_ELIGIBLE', {
      ...(dv.data.minAge != null ? { minAge: dv.data.minAge } : {}),
      ...(dv.data.maxAge != null ? { maxAge: dv.data.maxAge } : {})
    });
    const names = resolveNames(p, age.isMinor, true, p.realName);
    await assertNumberFree(deps, tx, cid, enId, p.number);

    const now = FieldValue.serverTimestamp();
    tx.create(deps.db.doc(`competitions/${cid}/roster/${plId}`), {
      enId, dvId: entry.data.dvId, displayName: names.displayName, number: p.number,
      position: p.position, isMinor: age.isMinor, createdAt: now
    });
    tx.create(deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`), {
      enId, dvId: entry.data.dvId, teamId: entry.data.teamId, uid: null, realName: names.realName,
      isMinor: age.isMinor, ageEligible: age.ageEligible, guardianConsent: age.isMinor ? true : null,
      source: 'rep', addedByUid: caller.uid, privacyAckAt: now, createdAt: now
    });
    tx.update(entry.ref, { rosterCount: FieldValue.increment(1), rosterConfirmed: false, updatedAt: now });
    writeAudit(deps, tx, cid, caller, 'addRosterByRep', { enId, plId, isMinor: age.isMinor });
    isMinorOut = age.isMinor;
  });
  return { cid, enId, plId, isMinor: isMinorOut };
}

// ── leaveRoster（本人退出；代表或主辦移除）────────────────────────────
export async function leaveRoster(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'plId']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const plId = requireId(input.plId, PLID_RE, 'plId');
  const nowMs = nowMsOf(deps);
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    assertRosterPhase(comp, nowMs);
    const privRef = deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`);
    const priv = await readDoc(deps, tx, privRef);
    if (!priv.exists) throw notFound('PLAYER_NOT_FOUND');
    const uid = priv.get('uid') as string | null;
    const teamId = priv.get('teamId') as string;
    const enId = priv.get('enId') as string;
    const self = typeof uid === 'string' && uid === caller.uid;
    const allowed = self
      || (await isClubRep(deps, tx, teamId, caller.uid)).ok
      || (await isHostOrCo(deps, tx, cid, comp, caller));
    if (!allowed) throw deny('NOT_ROSTER_OWNER');
    const entry = await loadEntry(deps, tx, cid, enId);
    const writeMine = typeof uid === 'string' && uid
      ? await prepareMine(deps, tx, uid, cid, comp, { removePlayer: plId })
      : () => {};
    const now = FieldValue.serverTimestamp();
    tx.delete(privRef);
    tx.delete(deps.db.doc(`competitions/${cid}/roster/${plId}`));
    tx.update(entry.ref, { rosterCount: FieldValue.increment(-1), rosterConfirmed: false, updatedAt: now });
    writeMine();
    writeAudit(deps, tx, cid, caller, 'leaveRoster', { enId, plId, self });
  });
  return { cid, plId, removed: true };
}

// ── confirmRoster（代表確認名單）──────────────────────────────────────
export async function confirmRoster(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  const nowMs = nowMsOf(deps);
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    assertRosterPhase(comp, nowMs);
    const entry = await loadEntry(deps, tx, cid, enId);
    if (!(await isClubRep(deps, tx, entry.data.teamId, caller.uid)).ok) throw deny('NOT_CLUB_REP');
    if (entry.data.status !== 'approved') throw pre('ENTRY_NOT_APPROVED');
    const dv = await loadDivision(deps, tx, cid, entry.data.dvId);
    const n = entry.data.rosterCount ?? 0;
    if (n < dv.data.rosterMin || n > dv.data.rosterMax) {
      throw pre('ROSTER_SIZE', { min: dv.data.rosterMin, max: dv.data.rosterMax, actual: n });
    }
    const now = FieldValue.serverTimestamp();
    tx.update(entry.ref, { rosterConfirmed: true, rosterConfirmedAt: now, updatedAt: now });
    writeAudit(deps, tx, cid, caller, 'confirmRoster', { enId, players: n });
  });
  return { cid, enId, rosterConfirmed: true };
}

// ── lockRosters（主辦檢錄完成，鎖定全部名單）──────────────────────────
export async function lockRosters(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    if (!(await isHostOrCo(deps, tx, cid, comp, caller))) throw deny('NOT_HOST');
    if (comp.status !== 'published') throw pre('COMPETITION_NOT_OPEN', { status: comp.status });
    if (comp.rostersLockedAt) throw pre('ROSTERS_LOCKED');
    tx.update(deps.db.doc(`competitions/${cid}`), {
      rostersLockedAt: FieldValue.serverTimestamp(),
      stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
    });
    writeAudit(deps, tx, cid, caller, 'lockRosters');
  });
  return { cid, locked: true };
}

export const ENTRY_ACTIONS = {
  registerEntry, reviewEntry, withdrawEntry, joinRoster, addRosterByRep, leaveRoster, confirmRoster, lockRosters
} as const;

export async function handleCpEntry(deps: CpDeps, caller: Caller, data: unknown) {
  const input = asRecord(data);
  const action = input.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ENTRY_ACTIONS, action)) {
    throw bad('UNKNOWN_ACTION');
  }
  const gate = await launchGate(deps, caller);
  return ENTRY_ACTIONS[action as keyof typeof ENTRY_ACTIONS](deps, caller, gate, input);
}
