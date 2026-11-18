/**
 * Callable 共用：相依注入、呼叫者身分、讀取計數、內部期閘門（§12.2 a）、俱樂部鏡像、主辦判斷、稽核。
 *
 * 身分原則（§5.1、§6.1）：賽事 codebase 只認 claims `role`、賽事內 `staff`、鏡像 `cpClubs`；
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

export interface CpDeps {
  /** asia-main 具名庫 */
  db: Firestore;
  /** 主站 (default) 庫（只讀 users 的顯示名與生日） */
  mainDb: Firestore;
  now: () => Date;
  /** 讀取計數（e2e 讀取預算斷言用；正式環境也照算，只放記憶體） */
  meter?: ReadMeter;
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
  endedAt: Timestamp | null;
  /** confirm＝末場已解決；host＝主辦手動結束；auto＝每日自動結束（本步只恢復、不寫入） */
  endedBy?: 'confirm' | 'host' | 'auto' | null;
  /** 手動結束原因。確認結束不寫。 */
  endReason?: string | null;
  rostersLockedAt: Timestamp | null;
  /** 年齡基準日：第一筆名單出現時固定（§3.251 F2） */
  ageBasisAt?: Timestamp | null;
  stateVersion: number;
  [k: string]: unknown;
}

export const CID_RE = /^cp_[A-Za-z0-9]{20}$/;
export const DVID_RE = /^dv_[A-Za-z0-9]{20}$/;
export const ENID_RE = /^en_[A-Za-z0-9]{20}$/;
export const PLID_RE = /^pl_[A-Za-z0-9]{20}$/;
/** 主站俱樂部 id：只做形狀檢查（不信內容，查鏡像路徑時當路徑段用） */
export const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function requireId(value: unknown, re: RegExp, field: string): string {
  if (typeof value !== 'string' || !re.test(value)) throw new CpError('invalid-argument', 'BAD_ID', { field });
  return value;
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 前綴＋20 碼英數（R-ID：cp_／dv_／en_／pl_／mt_）。 */
export function newId(prefix: 'cp' | 'dv' | 'en' | 'pl' | 'mt'): string {
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
  return snap.data() as CompDoc;
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

export async function isClubMember(deps: CpDeps, tx: Reader, teamId: string, uid: string): Promise<boolean> {
  if (!TEAM_ID_RE.test(teamId)) return false;
  const snap = await readDoc(deps, tx, deps.db.doc(`cpClubs/${teamId}/members/${uid}`));
  return snap.exists;
}

/** 賽事內 staff 角色（伺服器寫）。 */
async function staffRoles(deps: CpDeps, tx: Reader, cid: string, uid: string): Promise<string[]> {
  const staff = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/staff/${uid}`));
  const roles = staff.exists ? staff.get('roles') : null;
  return Array.isArray(roles) ? roles : [];
}

/**
 * 主辦或共同主辦（顧問 §3.251 (a)(c)，與 Rules isHostOrCo 一致）：管理員；俱樂部主辦只認「目前」代表；
 * 個人主辦與共同主辦看 staff.roles（host／coHost）。主文件不放建立者 uid。
 * 內部賽事另由 assertCompVisible 把關。
 */
export async function isHostOrCo(deps: CpDeps, tx: Reader, cid: string, comp: CompDoc, caller: Caller): Promise<boolean> {
  if (isAdmin(caller)) return true;
  if (comp.hostType === 'club' && typeof comp.hostTeamId === 'string') {
    if ((await isClubRep(deps, tx, comp.hostTeamId, caller.uid)).ok) return true;
  }
  const roles = await staffRoles(deps, tx, cid, caller.uid);
  return roles.includes('host') || roles.includes('coHost');
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
  if (!(await isHostOrCo(deps, tx, cid, comp, caller))) throw deny('NOT_HOST');
}

// ── 稽核（私密；只存雜湊後的操作者，不存 uid 原文）─────────────────────
/** 賽事內稽核用的操作者代號：sha256(cid:uid) 前 16 碼。伺服器可重算比對，主辦看不到 uid。 */
export function actorHash(cid: string, uid: string): string {
  return createHash('sha256').update(`${cid}:${uid}`).digest('hex').slice(0, 16);
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
  tx.create(ref, {
    action,
    actor: actorHash(cid, caller.uid),
    actorIsAdmin: isAdmin(caller),
    details,
    at: FieldValue.serverTimestamp()
  });
}

export const ts = (ms: number) => Timestamp.fromMillis(ms);
export { FieldValue, Timestamp };
