/**
 * 射手榜。場次進入或離開 confirmed 時，以交易更新 stats/{dvId}.m[mtId]。
 * 只讀公開 roster 的 displayName，不讀私密名單。路徑只出現在 statsRef。
 */
import { logger } from 'firebase-functions/v2';
import type { DocumentData } from 'firebase-admin/firestore';
import { CID_RE, DVID_RE, FieldValue, readDoc, readQuery, type CpDeps } from './context.js';

/** 單場事件／作廢標記上限（與 Rules、confirm 對帳的 200 相同）。查詢多讀 1 筆用來分辨剛好滿額。 */
export const STATS_EVENT_MAX = 200;
/**
 * 進球與得牌者要寫名字時，一批最多讀這麼多份公開名單。
 * 保守策略：本場進球與得牌者合計超過 22 人就整批不寫名（進球者也一起不寫），只留 plId。
 * 不把進球者與只得牌的人分開計額。
 */
export const STATS_NAME_BATCH = 22;
export const STATS_DOC_MAX_BYTES = 200 * 1024;
const NAME_MAX = 30;
const PL_RE = /^pl_[A-Za-z0-9_-]{1,37}$/;
const MT_RE = /^mt_[A-Za-z0-9]{20}$/;
/** 一般進球。點球大戰是 type pk，不在這裡。烏龍不計入射手。 */
const COUNTED_GOAL_KINDS = new Set(['normal', 'penalty']);

const TS_MARK = Object.freeze({ __ts: 1 as const });

export interface StatLine {
  /** 公開名單 displayName。沒有、或本場超過 22 人時省略。 */
  n?: string;
  /** 一般進球（goalKind normal／penalty）。不含 own、不含 pk、不含作廢。 */
  g: number;
  /** 黃牌張數。第二黃不計在這裡。 */
  y: number;
  /** 直接紅牌，加上對得上且尚未被引用過的第一黃。同一張第一黃只計一次。 */
  r: number;
}

export type MatchStat = Record<string, StatLine>;

export type StatsBuildResult =
  | { ok: true; players: MatchStat; nameIds: string[] }
  | { ok: false; reason: 'TIMELINE_TOO_LONG' | 'VOIDS_TOO_LONG' };

export type StatsSyncResult = 'set' | 'delete' | 'reject' | 'noop';

interface TlEvent {
  seq?: unknown;
  type?: unknown;
  plId?: unknown;
  goalKind?: unknown;
  cardType?: unknown;
  refSeq?: unknown;
}

/**
 * 射手榜文件路徑。顧問若改收藏位置，只改這個函式。
 * 回傳路徑字串，呼叫端再拿 deps.db.doc。
 */
export function statsRef(cid: string, dvId: string): string {
  return `competitions/${cid}/stats/${dvId}`;
}

function plIdOf(value: unknown): string | null {
  return typeof value === 'string' && PL_RE.test(value) ? value : null;
}

function clipName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return Array.from(text).slice(0, NAME_MAX).join('');
}

function bump(players: MatchStat, plId: string, field: 'g' | 'y' | 'r'): void {
  let line = players[plId];
  if (!line) {
    line = { g: 0, y: 0, r: 0 };
    players[plId] = line;
  }
  line[field] += 1;
}

/**
 * 重置線之後的有效事件。events／voided 超過 200 就不算（呼叫端用 limit+1 發現超限時也會先擋）。
 * voided 是作廢目標的 seq（voids 文件 id），不是作廢事件自己的 seq。
 */
export function buildMatchStat(
  events: readonly TlEvent[],
  voided: ReadonlySet<number>,
  resetRev: number
): StatsBuildResult {
  if (events.length > STATS_EVENT_MAX) return { ok: false, reason: 'TIMELINE_TOO_LONG' };
  if (voided.size > STATS_EVENT_MAX) return { ok: false, reason: 'VOIDS_TOO_LONG' };
  const yellows = new Map<number, string>();
  const active: Array<{ seq: number; type: string; plId: string | null; goalKind: string; cardType: string; refSeq: number | null }> = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const seq = ev.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || !(seq > resetRev) || voided.has(seq)) continue;
    if (typeof ev.type !== 'string') continue;
    const plId = plIdOf(ev.plId);
    const refSeq = typeof ev.refSeq === 'number' && Number.isInteger(ev.refSeq) ? ev.refSeq : null;
    active.push({
      seq,
      type: ev.type,
      plId,
      goalKind: typeof ev.goalKind === 'string' ? ev.goalKind : '',
      cardType: typeof ev.cardType === 'string' ? ev.cardType : '',
      refSeq
    });
    if (ev.type === 'card' && ev.cardType === 'yellow' && plId) yellows.set(seq, plId);
  }
  const players: MatchStat = {};
  // 同一張第一黃以 (plId, refSeq) 標記已用。第二張第二黃再引用就不計紅。
  const usedFirstYellow = new Set<string>();
  for (const ev of active) {
    if (ev.type === 'goal' && COUNTED_GOAL_KINDS.has(ev.goalKind) && ev.plId) {
      bump(players, ev.plId, 'g');
      continue;
    }
    if (ev.type !== 'card' || !ev.plId) continue;
    if (ev.cardType === 'yellow') bump(players, ev.plId, 'y');
    else if (ev.cardType === 'red') bump(players, ev.plId, 'r');
    else if (ev.cardType === 'second_yellow' && ev.refSeq != null && yellows.get(ev.refSeq) === ev.plId) {
      const key = `${ev.plId}:${ev.refSeq}`;
      if (usedFirstYellow.has(key)) continue;
      usedFirstYellow.add(key);
      // 每張第二黃對上自己的第一黃就計一紅。同一人兩張獨立黃牌各被引用時各計一紅。
      bump(players, ev.plId, 'r');
    }
  }
  const ordered: MatchStat = {};
  const nameIds = Object.keys(players).sort();
  for (const id of nameIds) ordered[id] = players[id]!;
  return { ok: true, players: ordered, nameIds };
}

/**
 * includeNames 為 false 時整批不寫名字。
 * 這是保守策略：本場進球與得牌者合計超過 22 人就整批不寫名，不先保住進球者。
 * 缺名字或空白就省略 n。
 */
export function attachNames(
  players: MatchStat,
  names: ReadonlyMap<string, string | null>,
  includeNames: boolean
): MatchStat {
  const out: MatchStat = {};
  for (const id of Object.keys(players).sort()) {
    const src = players[id]!;
    const line: StatLine = { g: src.g, y: src.y, r: src.r };
    if (includeNames) {
      const name = clipName(names.get(id));
      if (name) line.n = name;
    }
    out[id] = line;
  }
  return out;
}

function isTsMark(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as { __ts?: unknown }).__ts === 1
    && Object.keys(value as object).length === 1;
}

function isTimestamp(value: unknown): boolean {
  return !!value && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
    && typeof (value as { toDate?: unknown }).toDate === 'function';
}

/**
 * Firestore 文件大小估算（官方計價的近似，取偏大的一邊）：
 * 路徑每段 UTF-8 位元組 +1，再加 16；每個欄名 UTF-8 +1；
 * 字串值 UTF-8 +1；數字與時間 8；布林與 null 1；
 * 巢狀 map 再加 32；文件本體再加 32。陣列只加總元素。
 */
export function firestoreDocBytes(path: string, data: Record<string, unknown>): number {
  return nameBytes(path) + fieldsBytes(data) + 32;
}

function nameBytes(path: string): number {
  let n = 16;
  for (const seg of path.split('/')) {
    if (seg.length === 0) continue;
    n += Buffer.byteLength(seg) + 1;
  }
  return n;
}

function fieldsBytes(data: Record<string, unknown>): number {
  let n = 0;
  for (const [key, value] of Object.entries(data)) {
    n += Buffer.byteLength(key) + 1 + valueBytes(value);
  }
  return n;
}

function valueBytes(value: unknown): number {
  if (value == null) return 1;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return Buffer.byteLength(value) + 1;
  if (isTsMark(value) || isTimestamp(value) || value instanceof Date) return 8;
  if (Array.isArray(value)) {
    let n = 0;
    for (const item of value) n += valueBytes(item);
    return n;
  }
  if (typeof value === 'object') return fieldsBytes(value as Record<string, unknown>) + 32;
  return 0;
}

export interface StatsSizeEstimate {
  bytes: number;
  matches: number;
  perMatch: number;
  records: number;
  nameChars: number;
}

/** 用真實文件形狀估算。matches 是 m 底下的場次數，每場 perMatch 位球員都有名字與三個計數。 */
export function estimateStatsDoc(path: string, matches: number, perMatch: number, nameChars: number): StatsSizeEstimate {
  const name = '名'.repeat(Math.max(0, nameChars));
  const m: Record<string, MatchStat> = {};
  for (let i = 0; i < matches; i++) {
    const mtId = `mt_${String(i).padStart(20, '0')}`;
    const line: MatchStat = {};
    for (let p = 0; p < perMatch; p++) {
      const plId = `pl_${String(p).padStart(20, '0')}`;
      line[plId] = name ? { n: name, g: 1, y: 1, r: 1 } : { g: 1, y: 1, r: 1 };
    }
    m[mtId] = line;
  }
  return {
    bytes: firestoreDocBytes(path, { m, updatedAt: TS_MARK }),
    matches,
    perMatch,
    records: matches * perMatch,
    nameChars
  };
}

function sameLine(a: StatLine | undefined, b: StatLine): boolean {
  if (!a) return false;
  return a.g === b.g && a.y === b.y && a.r === b.r && (a.n ?? null) === (b.n ?? null);
}

function samePlayers(prev: unknown, next: MatchStat): boolean {
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return false;
  const before = prev as Record<string, StatLine>;
  const keys = Object.keys(before);
  const nextKeys = Object.keys(next);
  if (keys.length !== nextKeys.length) return false;
  for (const key of nextKeys) {
    if (!sameLine(before[key], next[key]!)) return false;
  }
  return true;
}

export type StatsWritePlan =
  | { op: 'set'; players: MatchStat; bytes: number }
  | { op: 'noop'; bytes: number }
  | { op: 'reject'; bytes: number };

/** 換成這一場之後若超過 200KB 就拒絕。內容與上一版相同則不寫。 */
export function planStatsWrite(
  prev: Record<string, unknown> | null,
  mtId: string,
  players: MatchStat,
  path: string
): StatsWritePlan {
  const prevM = prev && prev.m && typeof prev.m === 'object' && !Array.isArray(prev.m)
    ? prev.m as Record<string, unknown>
    : {};
  if (samePlayers(prevM[mtId], players)) {
    const bytes = firestoreDocBytes(path, { ...(prev ?? {}), m: prevM, updatedAt: TS_MARK });
    return { op: 'noop', bytes };
  }
  const nextM: Record<string, unknown> = { ...prevM, [mtId]: players };
  const next: Record<string, unknown> = {};
  if (prev) {
    for (const [key, value] of Object.entries(prev)) {
      if (key !== 'm' && key !== 'updatedAt') next[key] = value;
    }
  }
  next.m = nextM;
  next.updatedAt = TS_MARK;
  const bytes = firestoreDocBytes(path, next);
  if (bytes > STATS_DOC_MAX_BYTES) return { op: 'reject', bytes };
  return { op: 'set', players, bytes };
}

function resetRevOf(data: DocumentData | null): number {
  const n = data?.resetRev;
  return typeof n === 'number' && Number.isInteger(n) ? n : 0;
}

function divisionIdOf(data: DocumentData | null | undefined): string | null {
  const id = data?.divisionId;
  return typeof id === 'string' && DVID_RE.test(id) ? id : null;
}

/**
 * 以目前場次為準，不信觸發當下的狀態：仍是 confirmed 就重算 m[mtId]，否則刪掉。
 * 超限或超過 200KB 只記錯誤、不寫、不拋（重試不會變小）。
 */
export async function syncMatchStats(
  deps: CpDeps,
  cid: string,
  mtId: string,
  before: DocumentData | null
): Promise<StatsSyncResult> {
  if (!CID_RE.test(cid) || !MT_RE.test(mtId)) {
    logger.error('cp stats bad id', { cidOk: CID_RE.test(cid), mtOk: MT_RE.test(mtId) });
    return 'reject';
  }
  const matchRef = deps.db.doc(`competitions/${cid}/matches/${mtId}`);
  return deps.db.runTransaction(async tx => {
    const match = await readDoc(deps, tx, matchRef);
    const cur = match.exists ? match.data() ?? null : null;
    const dvId = divisionIdOf(cur) ?? divisionIdOf(before);
    if (!dvId) {
      logger.error('cp stats bad division', { cid, mtId });
      return 'reject';
    }
    const path = statsRef(cid, dvId);
    const ref = deps.db.doc(path);
    if (cur?.status !== 'confirmed') {
      const stats = await readDoc(deps, tx, ref);
      if (!stats.exists) return 'noop';
      const m = stats.get('m');
      if (!m || typeof m !== 'object' || !Object.prototype.hasOwnProperty.call(m, mtId)) return 'noop';
      tx.update(ref, {
        [`m.${mtId}`]: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
      return 'delete';
    }
    const resetRev = resetRevOf(cur);
    const tl = await readQuery(deps, tx, matchRef.collection('timeline').where('seq', '>', resetRev).limit(STATS_EVENT_MAX + 1));
    const vd = await readQuery(deps, tx, matchRef.collection('voids').where('seq', '>', resetRev).limit(STATS_EVENT_MAX + 1));
    if (tl.size > STATS_EVENT_MAX || vd.size > STATS_EVENT_MAX) {
      logger.error('cp stats event cap', { cid, mtId, timeline: tl.size, voids: vd.size });
      return 'reject';
    }
    const voided = new Set<number>();
    for (const doc of vd.docs) {
      const n = Number(doc.id);
      if (Number.isInteger(n)) voided.add(n);
    }
    const built = buildMatchStat(tl.docs.map(doc => doc.data() as TlEvent), voided, resetRev);
    if (!built.ok) {
      logger.error('cp stats event cap', { cid, mtId, reason: built.reason });
      return 'reject';
    }
    // 保守策略：本場進球與得牌者合計超過 22 人就整批不寫名，不先保住進球者。
    const includeNames = built.nameIds.length <= STATS_NAME_BATCH;
    const names = new Map<string, string | null>();
    if (includeNames) {
      for (const plId of built.nameIds) {
        // 只讀公開名單。私密名單的路徑不出現在這個函式。
        const roster = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/roster/${plId}`));
        const displayName = roster.exists ? roster.get('displayName') : null;
        names.set(plId, typeof displayName === 'string' ? displayName : null);
      }
    }
    const players = attachNames(built.players, names, includeNames);
    const stats = await readDoc(deps, tx, ref);
    const prev = stats.exists ? (stats.data() as Record<string, unknown> | undefined) ?? null : null;
    const plan = planStatsWrite(prev, mtId, players, path);
    if (plan.op === 'reject') {
      logger.error('cp stats doc cap', { cid, dvId, mtId, bytes: plan.bytes });
      return 'reject';
    }
    if (plan.op === 'noop') return 'noop';
    if (stats.exists) {
      tx.update(ref, { [`m.${mtId}`]: plan.players, updatedAt: FieldValue.serverTimestamp() });
    } else {
      tx.set(ref, { m: { [mtId]: plan.players }, updatedAt: FieldValue.serverTimestamp() });
    }
    return 'set';
  });
}
