/**
 * cpEntry 第 2 步動作（§6.1）：registerEntry、reviewEntry、withdrawEntry、joinRoster、addRosterByRep、
 * leaveRoster、confirmRoster、lockRosters。流程：代表報隊 → 成員登錄（或代表代填）→ 代表確認 → 主辦審核與鎖定（檢錄）。
 *
 * 個資（§4.3、§4.4、§15）：生日只用來算 isMinor／ageEligible，不寫進賽事庫；真名只在 rosterPrivate；
 * 公開 roster 只有顯示名、背號、位置、isMinor；未成年公開名只能是姓氏候選之一。
 */
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { evaluateAge } from './age.js';
import { readMainProfileForAge } from './main-profile.js';
import { prepareMine, type MineChange } from './mine.js';
import { removeProxyPlayerData } from './removal-actions.js';
import { CpError, bad, deny, notFound, pre } from './errors.js';
import {
  CID_RE,
  DVID_RE,
  ENID_RE,
  FieldValue,
  PLID_RE,
  TEAM_ID_RE,
  assertCompVisible,
  isAdmin,
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
import { cleanLine, findBannedWord, maskedPublicName, optionalLine, requireLine } from './text.js';
import { LIMITS, asRecord, onlyKeys, requireEnum, statusReasonOf, teamLogoOf } from './validate.js';

export const POSITIONS = ['GK', 'DF', 'MF', 'FW', 'custom'] as const;
/** 自訂位置上限（站長 11-18「無／自訂」）：360px 名單列（背號 99＋10 字顯示名）實測 6 字溢出、5 字可放，取 5 */
export const POSITION_TEXT_MAX = 5;
/** 每組報隊上限（含待審）：maxTeams 的 2 倍，防灌報名 */
export const PENDING_FACTOR = 2;
/** 同隊同組被拒或撤隊累計上限（達到就不得再報）；查詢只取 ENTRY_RETRY_MAX + 1 筆 */
export const ENTRY_RETRY_MAX = 3;
const PREV_ENTRY_SCAN = ENTRY_RETRY_MAX + 1;

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

// ── registerEntry ─────────────────────────────────────────────────────
const PHONE_RE = /^[0-9+\-() ]{6,20}$/;

export async function registerEntry(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId', 'teamId', 'teamName', 'contactName', 'contactPhone']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  if (typeof input.teamId !== 'string' || !TEAM_ID_RE.test(input.teamId)) throw bad('BAD_ID', { field: 'teamId' });
  const teamId = input.teamId;
  const teamNameIn = optionalLine(input.teamName, 'teamName', 30);
  if (teamNameIn && findBannedWord(teamNameIn, gate.bannedWords)) throw bad('BANNED_WORD', { field: 'teamName' });
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
    // 同隊同組：不分狀態取 4 筆在記憶體判斷（顧問 §3.251 (d)：不多查詢）
    const prev = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/entries`)
      .where('teamId', '==', teamId).where('dvId', '==', dvId).limit(PREV_ENTRY_SCAN));
    const prevStatuses = prev.docs.map(d => d.get('status'));
    if (prevStatuses.some(st => st === 'pending' || st === 'approved')) throw new CpError('already-exists', 'ENTRY_EXISTS');
    if (prevStatuses.filter(st => st === 'rejected' || st === 'withdrawn').length >= ENTRY_RETRY_MAX) {
      throw new CpError('resource-exhausted', 'ENTRY_RETRY_LIMIT', { max: ENTRY_RETRY_MAX });
    }
    const writeMine = await prepareMine(deps, tx, caller.uid, cid, comp, { addEntry: enId });

    const now = FieldValue.serverTimestamp();
    // 隊名只能是鏡像俱樂部名稱或其加後綴（例如「甲隊 A」），防止報隊冒用他隊名稱（Opus 終審 P3）
    if (teamNameIn && (!rep.name || !teamNameIn.startsWith(rep.name))) throw bad('TEAM_NAME_MISMATCH', { field: 'teamName' });
    const name = teamNameIn ?? rep.name ?? '隊伍';
    // 隊徽只收鏡像上的 https 網址；不合格寫 null，不擋報隊。image 與 isClubRep 同一次讀取
    const teamLogo = teamLogoOf(rep.image);
    tx.create(deps.db.doc(`competitions/${cid}/entries/${enId}`), {
      dvId, teamId, name, teamLogo, status: 'pending', rosterCount: 0, rosterConfirmed: false,
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
    // 報隊審核由主辦方處理、不自動審（站長 11-18 選乙）：俱樂部賽事＝目前代表（建賽者被換掉就不能審）、
    // 個人主辦＝建賽者（staff host）；共同主辦與管理員可代處理
    if (!(await isHostOrCo(deps, tx, cid, comp, caller))) throw deny('NOT_HOST');
    assertRosterPhase(comp, nowMs);
    const entry = await loadEntry(deps, tx, cid, enId);
    const dv = await loadDivision(deps, tx, cid, entry.data.dvId);
    // 拒絕時清掉該隊名單（Opus 終審 P2-4：否則公開名單殘留、球員無法改報他隊）
    const clear = decision === 'reject' && (entry.data.status === 'pending' || entry.data.status === 'approved')
      ? await prepareClearRoster(deps, tx, cid, comp, enId, { removeRegistrant: false })
      : null;
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
    clear?.apply();
    tx.update(entry.ref, { status, updatedAt: now, ...(clear ? { rosterCount: 0, rosterConfirmed: false } : {}) });
    tx.update(deps.db.doc(`competitions/${cid}/entryPrivate/${enId}`), { reviewNote: reason, updatedAt: now });
    writeAudit(deps, tx, cid, caller, 'reviewEntry', { enId, decision });
  });
  return { cid, enId, status };
}

/**
 * 清掉某隊整份名單（撤隊、被拒絕共用）：刪 roster＋rosterPrivate、更新球員 cpMine；
 * removeRegistrant 時一併移除報隊者的 cpMine 報隊索引（撤隊）。被拒絕時保留，讓代表在「我的賽事」看得到結果。
 * 讀取在呼叫當下完成（交易讀階段），apply 在寫階段呼叫。
 */
async function prepareClearRoster(
  deps: CpDeps, tx: Tx, cid: string, comp: CompDoc, enId: string, opts: { removeRegistrant: boolean }
): Promise<{ apply: () => void; removed: number }> {
  const roster = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/rosterPrivate`)
    .where('enId', '==', enId).limit(60));
  // 同一人可能同時是報隊者與本隊球員：合併成一次 cpMine 變更
  const changes = new Map<string, MineChange>();
  if (opts.removeRegistrant) {
    const priv = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/entryPrivate/${enId}`));
    const registrant = priv.exists ? priv.get('registeredByUid') : null;
    if (typeof registrant === 'string' && registrant) changes.set(registrant, { removeEntry: enId });
  }
  for (const d of roster.docs) {
    const u = d.get('uid');
    if (typeof u === 'string' && u) changes.set(u, { ...(changes.get(u) ?? {}), removePlayer: d.id });
  }
  const mineWrites: (() => void)[] = [];
  for (const [u, ch] of changes) mineWrites.push(await prepareMine(deps, tx, u, cid, comp, ch));
  return {
    removed: roster.size,
    apply: () => {
      for (const d of roster.docs) {
        tx.delete(d.ref);
        tx.delete(deps.db.doc(`competitions/${cid}/roster/${d.id}`));
      }
      mineWrites.forEach(w => w());
    }
  };
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
    const clear = await prepareClearRoster(deps, tx, cid, comp, enId, { removeRegistrant: true });
    const now = FieldValue.serverTimestamp();
    clear.apply();
    tx.update(entry.ref, { status: 'withdrawn', rosterCount: 0, rosterConfirmed: false, updatedAt: now });
    tx.update(dv.ref, {
      entryCount: FieldValue.increment(-1),
      ...(entry.data.status === 'approved' ? { approvedCount: FieldValue.increment(-1) } : {}),
      updatedAt: now
    });
    writeAudit(deps, tx, cid, caller, 'withdrawEntry', { enId, removedPlayers: clear.removed });
  });
  return { cid, enId, status: 'withdrawn' };
}

// ── 名單：共用驗證 ─────────────────────────────────────────────────────
interface PlayerInput {
  number: number;
  position: string | null;
  positionText: string | null;
  realName: string | null;
  nickname: string | null;
  guardianConsent: boolean;
}

function playerInputOf(input: Record<string, unknown>, bannedWords: readonly string[]): PlayerInput {
  const number = input.number;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 99) {
    throw bad('FIELD_RANGE', { field: 'number', min: 0, max: 99 });
  }
  // 位置：null＝無；custom 時 positionText 必填（≤ POSITION_TEXT_MAX 字），其餘不得帶 positionText
  const position = input.position == null ? null : requireEnum(input.position, POSITIONS, 'position');
  let positionText: string | null = null;
  if (position === 'custom') {
    positionText = requireLine(input.positionText, 'positionText', 1, POSITION_TEXT_MAX);
    if (findBannedWord(positionText, bannedWords)) throw bad('BANNED_WORD', { field: 'positionText' });
  } else if (input.positionText != null) {
    throw bad('UNKNOWN_FIELD', { field: 'positionText' });
  }
  if (input.privacyAck !== true) throw bad('PRIVACY_ACK_REQUIRED', { field: 'privacyAck' });
  if (input.guardianConsent != null && typeof input.guardianConsent !== 'boolean') throw bad('FIELD_TYPE', { field: 'guardianConsent' });
  const realName = optionalLine(input.realName, 'realName', 40);
  const nickname = optionalLine(input.nickname, 'nickname', 20);
  if (nickname && findBannedWord(nickname, bannedWords)) throw bad('BANNED_WORD', { field: 'nickname' });
  return { number, position, positionText, realName, nickname, guardianConsent: input.guardianConsent === true };
}

/**
 * 依年齡結果決定公開顯示名與私密真名（§4.3；站長 11-18 改為遮字）：
 * - 真名必填：組別 requireRealName 或未成年。
 * - 未成年：必勾監護人同意；公開名一律 maskedPublicName（遮姓氏後第一字），不收暱稱、不讓使用者自選。
 * - 代填成年：填了暱稱用暱稱，否則同樣遮字（顧問 §3.251 F1：不得把代填真名寫進公開名單）。
 * - 自己登錄的成年：暱稱優先，否則主站顯示名。
 */
function resolveNames(p: PlayerInput, isMinor: boolean, requireRealName: boolean, adultFallback: string | null, proxy = false) {
  if ((requireRealName || isMinor) && !p.realName) throw bad('REAL_NAME_REQUIRED', { field: 'realName' });
  if (isMinor) {
    if (!p.guardianConsent) throw bad('GUARDIAN_CONSENT_REQUIRED', { field: 'guardianConsent' });
    if (p.nickname) throw bad('UNKNOWN_FIELD', { field: 'nickname' });
    return { displayName: maskedPublicName(p.realName!) || '球員', realName: p.realName };
  }
  if (proxy) {
    return { displayName: p.nickname ?? (maskedPublicName(p.realName!) || '球員'), realName: p.realName };
  }
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

/**
 * 年齡基準日（顧問 §3.251 F2）：第一筆名單出現時固定成當下的首場日期，之後 isMinor／ageEligible 一律以它判斷；
 * 首場日期仍可依規則改（延期），已登錄球員的年齡結果不會失真（生日不存，無法重算）。
 */
export function ageBasisOf(comp: CompDoc): Date {
  const basis = comp.ageBasisAt as { toDate?: () => Date } | null | undefined;
  return basis && typeof basis.toDate === 'function' ? basis.toDate() : comp.firstMatchAt.toDate();
}
function fixAgeBasis(deps: CpDeps, tx: Tx, cid: string, comp: CompDoc): void {
  if (comp.ageBasisAt) return;
  tx.update(deps.db.doc(`competitions/${cid}`), { ageBasisAt: comp.firstMatchAt });
}

// ── joinRoster（成員自己登錄）─────────────────────────────────────────
export async function joinRoster(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId', 'number', 'position', 'positionText', 'realName', 'nickname', 'guardianConsent', 'privacyAck']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  const p = playerInputOf(input, gate.bannedWords);
  const nowMs = nowMsOf(deps);
  // 主站會員資料：只讀顯示名、生日與有效隊伍清單（生日算完即丟，不寫賽事庫；A3-02 第二段搬生日時只改 main-profile.ts）
  const { birthday, displayName: mainDisplayName, teamIds: mainTeamIds } = await readMainProfileForAge(deps, caller.uid);
  const plId = newId('pl');
  let isMinorOut = false;

  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    assertRosterPhase(comp, nowMs);
    const entry = await loadEntry(deps, tx, cid, enId);
    const dv = await loadDivision(deps, tx, cid, entry.data.dvId);
    assertEntryAcceptsRoster(entry.data, dv.data);
    // 成員＝主站 users 有效隊伍清單（規則 E）含本隊，或本隊代表（顧問 §3.839 方案 C）。
    // 主站資料在交易外讀：剛退出俱樂部的人有極短空窗仍能登錄，顧問判定可接受（代表可移除）。
    const teamId = entry.data.teamId;
    const member = (TEAM_ID_RE.test(teamId) && mainTeamIds.includes(teamId))
      || (await isClubRep(deps, tx, teamId, caller.uid)).ok;
    if (!member) throw deny('NOT_CLUB_MEMBER');
    const age = evaluateAge(birthday, ageBasisOf(comp), dv.data);
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
      position: p.position, positionText: p.positionText, isMinor: age.isMinor, createdAt: now
    });
    tx.create(deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`), {
      enId, dvId: entry.data.dvId, teamId: entry.data.teamId, uid: caller.uid, realName: names.realName,
      isMinor: age.isMinor, ageEligible: age.ageEligible, guardianConsent: age.isMinor ? true : null,
      source: 'self', addedByUid: null, privacyAckAt: now, createdAt: now
    });
    tx.update(entry.ref, { rosterCount: FieldValue.increment(1), rosterConfirmed: false, updatedAt: now });
    fixAgeBasis(deps, tx, cid, comp);
    writeMine();
    writeAudit(deps, tx, cid, caller, 'joinRoster', { enId, plId, isMinor: age.isMinor });
    isMinorOut = age.isMinor;
  });
  return { cid, enId, plId, isMinor: isMinorOut };
}

// ── addRosterByRep（§4.4：隊長或領隊代填無帳號球員；uid 為 null）─────────
export async function addRosterByRep(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId', 'number', 'position', 'positionText', 'realName', 'birthday', 'nickname', 'guardianConsent', 'privacyAck']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  const p = playerInputOf(input, gate.bannedWords);
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
    const age = evaluateAge(birthday, ageBasisOf(comp), dv.data);
    if (!age) throw bad('BIRTHDAY_INVALID', { field: 'birthday' });
    if (!age.ageEligible) throw pre('AGE_NOT_ELIGIBLE', {
      ...(dv.data.minAge != null ? { minAge: dv.data.minAge } : {}),
      ...(dv.data.maxAge != null ? { maxAge: dv.data.maxAge } : {})
    });
    const names = resolveNames(p, age.isMinor, true, null, true);
    await assertNumberFree(deps, tx, cid, enId, p.number);
    // 同隊同真名不重複代填（Flash 交叉審 P2：連按兩次或換背號重填）
    const dupName = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/rosterPrivate`)
      .where('enId', '==', enId).where('realName', '==', p.realName).limit(1));
    if (!dupName.empty) throw new CpError('already-exists', 'PLAYER_DUPLICATE');

    const now = FieldValue.serverTimestamp();
    tx.create(deps.db.doc(`competitions/${cid}/roster/${plId}`), {
      enId, dvId: entry.data.dvId, displayName: names.displayName, number: p.number,
      position: p.position, positionText: p.positionText, isMinor: age.isMinor, createdAt: now
    });
    tx.create(deps.db.doc(`competitions/${cid}/rosterPrivate/${plId}`), {
      enId, dvId: entry.data.dvId, teamId: entry.data.teamId, uid: null, realName: names.realName,
      isMinor: age.isMinor, ageEligible: age.ageEligible, guardianConsent: age.isMinor ? true : null,
      source: 'rep', addedByUid: caller.uid, privacyAckAt: now, createdAt: now
    });
    tx.update(entry.ref, { rosterCount: FieldValue.increment(1), rosterConfirmed: false, updatedAt: now });
    fixAgeBasis(deps, tx, cid, comp);
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
    if (comp.hidden && !isAdmin(caller)) throw pre('COMPETITION_HIDDEN');
    if (comp.rostersLockedAt) throw pre('ROSTERS_LOCKED');
    const now = FieldValue.serverTimestamp();
    tx.update(deps.db.doc(`competitions/${cid}`), {
      rostersLockedAt: now,
      stateVersion: FieldValue.increment(1), updatedAt: now
    });
    writeAudit(deps, tx, cid, caller, 'lockRosters');
  });
  // 鎖定成功後刷新已核准隊伍的 teamLogo（顧問 §3.264④）。放在交易外分批寫：
  // 已核准上限＝組別 8 × 每組 64＝512 筆，放進鎖名單交易會超過單交易 500 寫入（Flash 初審 P2）。
  // 隊徽只是顯示用，刷新失敗不影響鎖定結果，與 syncMineIndex 同樣盡力而為。
  await refreshTeamLogos(deps, cid).catch((e: unknown) => {
    // Opus 終審 P3：不要靜默吞掉，留紀錄（只帶 cid 與錯誤類型，不帶個資）
    logger.warn('lockRosters refreshTeamLogos failed', { cid, error: (e as Error)?.name ?? 'Error', code: (e as { code?: unknown })?.code ?? null });
  });
  return { cid, locked: true };
}

/**
 * 依 cpClubs.image 刷新本賽事已核准報隊的 teamLogo。每支不同隊伍讀 1 次 cpClubs（同隊多組只讀一次），
 * 讀取上限＝已核准查詢筆數（≤ 各組 maxTeams 合計）＋去重隊數。每批 ≤ 400 筆寫入。
 */
async function refreshTeamLogos(deps: CpDeps, cid: string): Promise<void> {
  const approved = await readQuery(deps, null, deps.db.collection(`competitions/${cid}/entries`)
    .where('status', '==', 'approved').limit(LIMITS.divisionsMax * LIMITS.teamsMax));
  const byTeam = new Map<string, DocumentReference[]>();
  for (const d of approved.docs) {
    const teamId = d.get('teamId');
    if (typeof teamId !== 'string' || !TEAM_ID_RE.test(teamId)) continue;
    const refs = byTeam.get(teamId) ?? [];
    refs.push(d.ref);
    byTeam.set(teamId, refs);
  }
  const updates: Array<[DocumentReference, string | null]> = [];
  const teams = [...byTeam.entries()];
  // Opus 終審 P3：每 50 隊並行讀（讀取數不變，仍經 readDoc 計數），避免 512 次依序 await 拉長回應
  for (let i = 0; i < teams.length; i += 50) {
    const chunk = teams.slice(i, i + 50);
    const clubs = await Promise.all(chunk.map(([teamId]) => readDoc(deps, null, deps.db.doc(`cpClubs/${teamId}`))));
    chunk.forEach(([, refs], k) => {
      const club = clubs[k];
      // cpClubs.image 由主站 onTeamWrittenForCompetitions 寫入；圖片變更也要寫入列 G4 待辦，不在本 codebase
      const teamLogo = teamLogoOf(club?.exists ? club.get('image') : null);
      for (const ref of refs) updates.push([ref, teamLogo]);
    });
  }
  for (let i = 0; i < updates.length; i += 400) {
    const b = deps.db.batch();
    for (const [ref, teamLogo] of updates.slice(i, i + 400)) b.update(ref, { teamLogo, updatedAt: FieldValue.serverTimestamp() });
    await b.commit();
  }
}

// ── unlockRosters（顧問 §3.251 F3：首場前主辦或管理員可解鎖，寫稽核）──────────
export async function unlockRosters(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'reason']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const reason = statusReasonOf(input.reason);
  const nowMs = nowMsOf(deps);
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    if (!(await isHostOrCo(deps, tx, cid, comp, caller))) throw deny('NOT_HOST');
    const admin = isAdmin(caller);
    if (!comp.rostersLockedAt) throw pre('ROSTERS_NOT_LOCKED');
    if (comp.status !== 'published') throw pre('COMPETITION_NOT_OPEN', { status: comp.status });
    if (comp.hidden && !admin) throw pre('COMPETITION_HIDDEN');
    if (!admin && nowMs >= comp.firstMatchAt.toMillis()) throw pre('COMPETITION_STARTED');
    // 第 3 步：已排賽程時不能解鎖（名單異動會讓賽程失真）；要先 clearSchedule
    const scheduled = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/matches`).select().limit(1));
    if (!scheduled.empty) throw pre('SCHEDULE_EXISTS');
    tx.update(deps.db.doc(`competitions/${cid}`), {
      rostersLockedAt: null,
      stateVersion: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
    });
    writeAudit(deps, tx, cid, caller, 'unlockRosters', { reason });
  });
  return { cid, locked: false };
}

// ── setPaymentStatus（§8.4 支付接點：只主辦可改；站長 11-18「繳費標籤＋標示已繳費開關」，不接金流）──
export const PAYMENT_STATUSES = ['none', 'paid'] as const;
export async function setPaymentStatus(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'enId', 'paymentStatus']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const enId = requireId(input.enId, ENID_RE, 'enId');
  // pending／refunded 保留給未來線上支付模組（伺服器寫），手動只能切 none／paid
  const paymentStatus = requireEnum(input.paymentStatus, PAYMENT_STATUSES, 'paymentStatus');
  await deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    if (!(await isHostOrCo(deps, tx, cid, comp, caller))) throw deny('NOT_HOST');
    if (comp.hidden && !isAdmin(caller)) throw pre('COMPETITION_HIDDEN');
    // 報名費只限俱樂部主辦（顧問 §3.257）：個人主辦賽事沒有繳費，一律拒絕
    if (comp.hostType !== 'club') throw pre('PAYMENT_NOT_ALLOWED');
    const entry = await loadEntry(deps, tx, cid, enId);
    if (entry.data.status !== 'approved' && entry.data.status !== 'pending') throw pre('ENTRY_STATE', { status: entry.data.status });
    tx.update(deps.db.doc(`competitions/${cid}/entryPrivate/${enId}`), { paymentStatus, updatedAt: FieldValue.serverTimestamp() });
    writeAudit(deps, tx, cid, caller, 'setPaymentStatus', { enId, paymentStatus });
  });
  return { cid, enId, paymentStatus };
}

export const ENTRY_ACTIONS = {
  registerEntry, reviewEntry, withdrawEntry, joinRoster, addRosterByRep, leaveRoster, confirmRoster, lockRosters, unlockRosters,
  setPaymentStatus,
  removeProxyPlayerData
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
