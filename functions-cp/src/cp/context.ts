/**
 * Callable 共用：相依注入、呼叫者身分、讀取計數、內部期閘門（§12.2 a）、俱樂部鏡像、主辦判斷、稽核。
 *
 * 身分原則（§5.1、§6.1）：賽事 codebase 只認 claims `role`、賽事內 `staff`、鏡像 `cpClubs`；
 * 例外：俱樂部「成員」改看主站 users 的 teamIds／teamId（main-profile.ts，規則 E），因 cpClubs/{teamId}/members 從沒有程式寫入（顧問 §3.839）。
 * 不寫任何權限碼判斷（需要權限碼的動作放主 codebase 的 cpAdminOps）。
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  FieldValue,
  Timestamp,
  type AggregateField,
  type AggregateQuery,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction
} from 'firebase-admin/firestore';
import { CpError, deny, notFound } from './errors.js';
import { bannedWordsOf } from './text.js';
import { auditExpireAtMs } from './removal-plan.js';

export interface CpDeps {
  /** asia-main 具名庫 */
  db: Firestore;
  /** 主站 (default) 庫（只讀 users 的顯示名、生日與隊伍清單，以及建賽時角色文件的 disabledCodes，見 host-permission.ts） */
  mainDb: Firestore;
  now: () => Date;
  /** 讀取計數（e2e 讀取預算斷言用；正式環境也照算，只放記憶體） */
  meter?: ReadMeter;
  /**
   * 摘要片交易回呼次數（含第一次）。正式環境不設定。
   * 每個 handleMatchWritten 用自己的計數器時，重試次數＝次數減 1。
   */
  summaryTxAttempts?: { count: number };
}

export class ReadMeter {
  reads = 0;
  byAction: Record<string, number> = {};
  add(n: number) { this.reads += n; }
}

export interface Caller {
  uid: string;
  role: string | null;
}

export function callerOf(auth: { uid?: unknown; token?: Record<string, unknown> } | null | undefined): Caller {
  const uid = typeof auth?.uid === 'string' ? auth.uid : '';
  if (!uid) throw new CpError('unauthenticated', 'SIGN_IN_REQUIRED');
  const role = typeof auth?.token?.role === 'string' ? (auth.token.role as string) : null;
  return { uid, role };
}

export const isAdmin = (c: Caller) => c.role === 'admin' || c.role === 'super_admin';

// ── 讀取（一律經過這裡，計數供讀取預算斷言）──────────────────────────
type Reader = Transaction | null;

export async function readDoc(deps: CpDeps, tx: Reader, ref: DocumentReference): Promise<DocumentSnapshot> {
  deps.meter?.add(1);
  return tx ? tx.get(ref) : ref.get();
}

export async function readQuery(deps: CpDeps, tx: Reader, q: Query): Promise<QuerySnapshot> {
  const snap = tx ? await tx.get(q) : await q.get();
  deps.meter?.add(Math.max(1, snap.size));
  return snap;
}

export async function readCount(deps: CpDeps, tx: Reader, q: AggregateQuery<{ count: AggregateField<number> }>): Promise<number> {
  const snap = tx ? await tx.get(q) : await q.get();
  const count = snap.data().count;
  // 聚合查詢每 1000 筆索引項計 1 讀，最少 1 讀
  deps.meter?.add(Math.max(1, Math.ceil(count / 1000)));
  return count;
}

// ── 內部期閘門（§12.2 a、b）───────────────────────────────────────────
export interface GateResult {
  isPublic: boolean;
  /** 管理員或內部測試者 */
  privileged: boolean;
  /** 管理員設定的禁用詞（cpConfig/launch.bannedWords；預設空清單＝不擋） */
  bannedWords: string[];
}

/**
 * isPublic 為 false（或 cpConfig/launch 不存在：fail-closed）時，只允許管理員或測試者。
 * 測試者名單只在內部期查（§8.1：內部期每次 Callable 另加 1 讀）。
 */
export async function launchGate(deps: CpDeps, caller: Caller): Promise<GateResult> {
  const launch = await readDoc(deps, null, deps.db.doc('cpConfig/launch'));
  const isPublic = launch.exists && launch.get('isPublic') === true;
  const bannedWords = launch.exists ? bannedWordsOf(launch.get('bannedWords')) : [];
  if (isAdmin(caller)) return { isPublic, privileged: true, bannedWords };
  if (isPublic) return { isPublic, privileged: false, bannedWords };
  const tester = await readDoc(deps, null, deps.db.doc(`cpConfig/launch/testers/${caller.uid}`));
  if (!tester.exists) throw deny('INTERNAL_PERIOD');
  return { isPublic, privileged: true, bannedWords };
}

/** 內部賽事（visibility == 'internal'）只有管理員與測試者可操作（與 Rules internalGate 一致）。 */
export function assertCompVisible(comp: CompDoc, gate: GateResult): void {
  if (comp.visibility !== 'public' && !gate.privileged) throw deny('INTERNAL_COMPETITION');
}

// ── 賽事根文件 ───────────────────────────────────────────────────────
export interface CompDoc {
  name: string;
  sport: string;
  hostType: 'personal' | 'club';
  hostTeamId?: string | null;
  hostDisplay: string;
  visibility: 'public' | 'internal';
  status: 'draft' | 'published' | 'postponed' | 'cancelled';
  /** 賽事分類。舊文件可能沒有；讀取用 categoryOf，缺值視為 league */
  category?: 'league' | 'cup' | 'friendly';
  hidden: boolean;
  regOpenAt: Timestamp;
  regCloseAt: Timestamp;
  firstMatchAt: Timestamp;
  lastMatchAt: Timestamp;
  /**
   * F2：第一次把末場日延後之前的 lastMatchAt。
   * 沒有這個欄位代表還沒延後，60 天上限從目前 lastMatchAt 的台北日算。
   * updateCompetition 重寫賽期時會刪掉，讓新的末場重新當基準。
   */
  lastMatchOriginAt?: Timestamp | null;
  endedAt: Timestamp | null;
  /** confirm＝末場已解決；host＝主辦手動結束；auto＝每日自動結束（本步只恢復、不寫入） */
  endedBy?: 'confirm' | 'host' | 'auto' | null;
  /** 手動結束原因。確認結束不寫。 */
  endReason?: string | null;
  /** 末場確認結束時各組第 1 名。手動結束不寫。解除確認結束時刪除。 */
  champions?: Array<{ dv: string; n: string }> | null;
  rostersLockedAt: Timestamp | null;
  /** 年齡基準日：第一筆名單出現時固定（§3.251 F2） */
  ageBasisAt?: Timestamp | null;
  stateVersion: number;
  /**
   * K10：已發出的成員固定編號最大值。
   * 缺值、非整數或小於 1 時，配號把它當成 1（主辦占號 1）再加 1。只在新建 staff 時前進。
   */
  staffSeq?: number;
  /**
   * 第 4 步邀請記分員：已發出的邀請數，只增不減（撤銷不退額度）。缺值當 0；上限見 staff-host.ts INVITE_MAX。
   */
  inviteSeq?: number;
  /** 第 4 步共同主辦：已加入人數（缺值視 0；上限 COHOST_MAX）。 */
  coHostCount?: number;
  [k: string]: unknown;
}

export const CID_RE = /^cp_[A-Za-z0-9]{20}$/;
export const DVID_RE = /^dv_[A-Za-z0-9]{20}$/;
export const ENID_RE = /^en_[A-Za-z0-9]{20}$/;
export const PLID_RE = /^pl_[A-Za-z0-9]{20}$/;
/** 邀請記分員 id（competitions/{cid}/invites/{ivId}），伺服器產生。 */
export const IVID_RE = /^iv_[A-Za-z0-9]{20}$/;
/** 主站俱樂部 id：只做形狀檢查（不信內容，查鏡像路徑時當路徑段用） */
export const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function requireId(value: unknown, re: RegExp, field: string): string {
  if (typeof value !== 'string' || !re.test(value)) throw new CpError('invalid-argument', 'BAD_ID', { field });
  return value;
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 前綴＋20 碼英數（R-ID：cp_／dv_／en_／pl_／mt_／iv_；公告 id 用 nt_，不是文件路徑）。 */
export function newId(prefix: 'cp' | 'dv' | 'en' | 'pl' | 'mt' | 'nt' | 'iv'): string {
  const bytes = randomBytes(20);
  let s = '';
  // 248 = 62*4，丟棄 ≥248 的位元組以免取模偏差；不足再補
  let i = 0;
  let pool = bytes;
  while (s.length < 20) {
    if (i >= pool.length) { pool = randomBytes(20); i = 0; }
    const b = pool[i++];
    if (b < 248) s += ALNUM[b % 62];
  }
  return `${prefix}_${s}`;
}

export async function loadComp(deps: CpDeps, tx: Reader, cid: string): Promise<CompDoc> {
  const snap = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}`));
  if (!snap.exists) throw notFound('COMPETITION_NOT_FOUND');
  const data = snap.data() as CompDoc;
  if (tx !== null) {
    const last = data.lastMatchAt;
    const ms = last instanceof Timestamp ? last.toMillis() : null;
    rememberCompLastMatch(tx, cid, ms);
  }
  return data;
}

// ── 俱樂部鏡像（§2.4：只信路徑 id）─────────────────────────────────────
export async function isClubRep(deps: CpDeps, tx: Reader, teamId: string, uid: string): Promise<{ ok: boolean; name: string | null; image: string | null }> {
  if (!TEAM_ID_RE.test(teamId)) return { ok: false, name: null, image: null };
  const snap = await readDoc(deps, tx, deps.db.doc(`cpClubs/${teamId}`));
  if (!snap.exists) return { ok: false, name: null, image: null };
  const reps = snap.get('repUids');
  const name = typeof snap.get('name') === 'string' ? (snap.get('name') as string) : null;
  // cpClubs.image 由主站 onTeamWrittenForCompetitions 寫入；圖片變更也要寫入列 G4 待辦，不在本 codebase
  const imageRaw = snap.get('image');
  const image = typeof imageRaw === 'string' ? imageRaw : null;
  return { ok: Array.isArray(reps) && reps.includes(uid), name, image };
}

/** 讀俱樂部目前所有代表的 uid（1 讀；teamId 形狀不對或文件不存在回 []）。 */
export async function clubRepUids(deps: CpDeps, tx: Reader, teamId: string): Promise<string[]> {
  if (!TEAM_ID_RE.test(teamId)) return [];
  const snap = await readDoc(deps, tx, deps.db.doc(`cpClubs/${teamId}`));
  if (!snap.exists) return [];
  return stringList(snap, 'repUids');
}

/** 賽事內 staff 角色（伺服器寫）。 */
async function staffRoles(deps: CpDeps, tx: Reader, cid: string, uid: string): Promise<string[]> {
  const staff = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/staff/${uid}`));
  return stringList(staff, 'roles');
}

function stringList(snap: DocumentSnapshot, field: string): string[] {
  if (!snap.exists) return [];
  const raw = snap.get(field);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * 主辦判斷的結果。reads 是這次為了判斷而讀的文件數（管理員 0、俱樂部代表 1、其餘 ≤2），
 * 與 isHostOrCo 原本的讀取次數相同。callerStaff 是呼叫者自己的 staff 快照（有讀才有），
 * 讓後續指派自己時不必再讀同一份。
 */
export interface HostAccess {
  /** 主辦（不含共同主辦）。俱樂部只認目前代表；個人主辦＝staff host；管理員算主辦。 */
  primary: boolean;
  callerStaff: DocumentSnapshot | null;
  reads: number;
}

/**
 * 主辦或共同主辦（顧問 §3.251 (a)(c)，與 Rules isHostOrCo 一致）：管理員；俱樂部主辦只認「目前」代表；
 * 個人主辦與共同主辦看 staff.roles（host／coHost）。主文件不放建立者 uid。
 * 不是主辦或共同主辦時丟 NOT_HOST。內部賽事另由 assertCompVisible 把關。
 * 讀取次數與改前的 isHostOrCo 相同，不另加文件。
 */
export async function hostAccess(deps: CpDeps, tx: Reader, cid: string, comp: CompDoc, caller: Caller): Promise<HostAccess> {
  if (isAdmin(caller)) return { primary: true, callerStaff: null, reads: 0 };
  let reads = 0;
  if (comp.hostType === 'club' && typeof comp.hostTeamId === 'string') {
    // 路徑不合法時 isClubRep 不讀文件
    if (TEAM_ID_RE.test(comp.hostTeamId)) reads += 1;
    if ((await isClubRep(deps, tx, comp.hostTeamId, caller.uid)).ok) {
      return { primary: true, callerStaff: null, reads };
    }
  }
  reads += 1;
  const callerStaff = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/staff/${caller.uid}`));
  const roles = stringList(callerStaff, 'roles');
  if (!roles.includes('host') && !roles.includes('coHost')) throw deny('NOT_HOST');
  // 俱樂部賽事的主辦只認目前代表；staff 上的 host 不是主辦（與 isPrimaryHost 一致）
  const primary = comp.hostType === 'personal' && roles.includes('host');
  return { primary, callerStaff, reads };
}

/**
 * 主辦或共同主辦。讀取次數與 hostAccess 相同。
 */
export async function isHostOrCo(deps: CpDeps, tx: Reader, cid: string, comp: CompDoc, caller: Caller): Promise<boolean> {
  try {
    await hostAccess(deps, tx, cid, comp, caller);
    return true;
  } catch (e) {
    if (e instanceof CpError && e.reason === 'NOT_HOST') return false;
    throw e;
  }
}

/** 主辦（不含共同主辦）：刪除等只限主辦的動作。俱樂部主辦＝目前代表；個人主辦＝staff host。 */
export async function isPrimaryHost(deps: CpDeps, tx: Reader, cid: string, comp: CompDoc, caller: Caller): Promise<boolean> {
  if (isAdmin(caller)) return true;
  if (comp.hostType === 'club') {
    return typeof comp.hostTeamId === 'string' && (await isClubRep(deps, tx, comp.hostTeamId, caller.uid)).ok;
  }
  return (await staffRoles(deps, tx, cid, caller.uid)).includes('host');
}

export async function assertHostOrCo(deps: CpDeps, tx: Reader, cid: string, comp: CompDoc, caller: Caller): Promise<void> {
  await hostAccess(deps, tx, cid, comp, caller);
}

// ── 稽核（私密；只存雜湊後的操作者，不存 uid 原文）─────────────────────
/** 賽事內稽核用的操作者代號：sha256(cid:uid) 前 16 碼。伺服器可重算比對，主辦看不到 uid。 */
export function actorHash(cid: string, uid: string): string {
  return createHash('sha256').update(`${cid}:${uid}`).digest('hex').slice(0, 16);
}

const compLastMatchByTx = new WeakMap<object, Map<string, number | null>>();

/** 在交易內記住某賽事的 lastMatchAt（毫秒），供 writeAudit 自動帶 expireAt。 */
export function rememberCompLastMatch(tx: Transaction, cid: string, lastMatchAtMs: number | null): void {
  let m = compLastMatchByTx.get(tx);
  if (!m) {
    m = new Map();
    compLastMatchByTx.set(tx, m);
  }
  m.set(cid, lastMatchAtMs);
}

export function writeAudit(
  deps: CpDeps,
  tx: Transaction,
  cid: string,
  caller: Caller,
  action: string,
  details: Record<string, unknown> = {}
): void {
  const ref = deps.db.collection(`competitions/${cid}/audits`).doc();
  const map = compLastMatchByTx.get(tx);
  const hasLast = map?.has(cid) ?? false;
  const last = hasLast ? (map!.get(cid) ?? null) : null;
  tx.create(ref, {
    action,
    actor: actorHash(cid, caller.uid),
    actorIsAdmin: isAdmin(caller),
    details,
    at: FieldValue.serverTimestamp(),
    // 方案 T：只有同一個交易內有記到 lastMatchAt 才帶 expireAt；沒記到就交給 daily.ts 回填
    // （TTL 不會刪沒有 expireAt 的文件，所以安全）。
    ...(hasLast ? { expireAt: Timestamp.fromMillis(auditExpireAtMs(deps.now().getTime(), last)) } : {})
  });
}

export const ts = (ms: number) => Timestamp.fromMillis(ms);
export { FieldValue, Timestamp };
