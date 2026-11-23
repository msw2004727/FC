/**
 * LIVE 賽務台的純邏輯。
 * 不碰 DOM、不碰 Firestore。比分推算沿用 timeline，不另寫一份。
 */

import type { ClockState, FairPlayConfig, MatchLike, MatchResult, Score, TimelineEvent } from './types.js';
import { FAIR_PLAY } from './ranking.js';
import { GOAL_EVENT_TYPES, isLive, lastPlayedPeriod, reconcileScore, scoreFromTimeline } from './timeline.js';
import { matchResult } from './result.js';
import { CARD_LABEL, EVENT_ICON, ROSTER_ROLE_TEXT, eventText } from './live-text.js';

export { isLive, scoreFromTimeline, lastPlayedPeriod };
export { EVENT_ICON, eventText, CARD_LABEL, ROSTER_ROLE_TEXT };

/** 會改變比分的事件型別。含 own_goal。跟射手榜的 SCORING_TYPES 不是同一份。 */
export const SCORING_TYPES = GOAL_EVENT_TYPES;

/** 下一個序號。同分鐘的事件靠 seq 排序，所以不能重複。 */
export function nextSeq(events: Array<{ seq?: number | null }> | null | undefined): number {
  const max = (events || []).reduce((m, e) => Math.max(m, Number(e?.seq) || 0), 0);
  return max + 1;
}

/**
 * 一致性檢查。判定在 reconcileScore，這裡只組人看得懂的句子。
 * 不一致時警示但允許送出。
 */
export function consistencyCheck(
  score: Partial<Score> | null | undefined,
  events: TimelineEvent[] | null | undefined
) {
  const r = reconcileScore(score, events);
  const { derived, entered } = r;
  const shown = `${entered.home ?? '—'}:${entered.away ?? '—'}`;
  return {
    ok: r.ok,
    derived,
    entered,
    message: r.ok
      ? `事件加總（${derived.home}:${derived.away}）與比分一致`
      : !r.complete
        ? `比分還沒登錄完（目前 ${shown}），事件加總為 ${derived.home}:${derived.away}，仍要送出嗎？`
        : `事件加總為 ${derived.home}:${derived.away}，與比分 ${shown} 不同，仍要送出嗎？`
  };
}

interface Actor {
  memberId?: string | null;
  displayName?: string | null;
  name?: string | null;
  jerseyNo?: number | null;
}

interface EventDraft {
  matchId?: string;
  events?: TimelineEvent[] | null;
  side?: string | null;
  period?: string;
  clockSec?: number;
  minute?: number;
  uid?: string;
  teamId?: string | null;
  type?: string;
  player?: Actor | null;
  assistPlayerId?: string | null;
  goalType?: string;
  cardType?: string;
  outPlayer?: Actor | null;
  inPlayer?: Actor | null;
  ending?: boolean;
  note?: string;
}

/** 共同欄位。刻意不填 createdAt——由呼叫端補伺服器時間。 */
function baseEvent(o: EventDraft) {
  return {
    matchId: o.matchId,
    seq: nextSeq(o.events),
    periodId: o.period,
    clockSec: Math.max(0, Math.round(Number(o.clockSec) || 0)),
    minute: Number(o.minute) || 0,
    side: o.side,
    teamId: o.teamId ?? null,
    createdBy: o.uid,
    voided: false,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    note: ''
  };
}

/**
 * 進球。player 可為 null：不指定球員也要能直接記分。
 */
export function buildGoalEvent(o: EventDraft) {
  const type = o.type || 'goal';
  return {
    ...baseEvent(o),
    type,
    playerId: o.player?.memberId ?? null,
    playerName: o.player?.displayName ?? o.player?.name ?? null,
    jerseyNo: o.player?.jerseyNo ?? null,
    assistPlayerId: o.assistPlayerId ?? null,
    goalType: o.goalType || (type === 'penalty_scored' ? 'penalty' : type === 'own_goal' ? 'own' : 'open')
  };
}

export function buildCardEvent(o: EventDraft) {
  return {
    ...baseEvent(o),
    type: 'card',
    cardType: o.cardType,
    playerId: o.player?.memberId ?? null,
    playerName: o.player?.displayName ?? o.player?.name ?? null,
    jerseyNo: o.player?.jerseyNo ?? null
  };
}

export function buildSubEvent(o: EventDraft) {
  return {
    ...baseEvent(o),
    type: 'substitution',
    playerId: o.outPlayer?.memberId ?? null,
    playerName: o.outPlayer?.displayName ?? o.outPlayer?.name ?? null,
    jerseyNo: o.outPlayer?.jerseyNo ?? null,
    subInPlayerId: o.inPlayer?.memberId ?? null,
    subInPlayerName: o.inPlayer?.displayName ?? o.inPlayer?.name ?? null,
    subInJerseyNo: o.inPlayer?.jerseyNo ?? null
  };
}

export function buildPeriodEvent(o: EventDraft) {
  return { ...baseEvent(o), type: o.ending ? 'period_end' : 'period_start', side: 'neutral' };
}

export function buildNoteEvent(o: EventDraft) {
  return { ...baseEvent(o), type: 'note', side: 'neutral', note: String(o.note ?? '').slice(0, 200) };
}

/** 某球員本場已吃的有效卡片，依時序排列 */
export function cardsOf(events: TimelineEvent[] | null | undefined, playerId: string | null | undefined): TimelineEvent[] {
  return (events || [])
    .filter(e => isLive(e) && e.type === 'card' && e.playerId && e.playerId === playerId)
    .sort((a, b) => (a.clockSec ?? a.seq ?? 0) - (b.clockSec ?? b.seq ?? 0));
}

/**
 * 出牌前的提示：同一球員第二張黃牌 → 提示改記為兩黃換紅。
 */
export function suggestCardType(
  events: TimelineEvent[] | null | undefined,
  playerId: string | null | undefined,
  intended: string
): { suggest: 'second_yellow' | null; reason: string; existing: number } {
  const prior = cardsOf(events, playerId);
  const yellows = prior.filter(c => c.cardType === 'yellow').length;
  if (intended === 'yellow' && yellows >= 1) {
    return {
      suggest: 'second_yellow',
      reason: '這名球員本場已有一張黃牌，是否記為「兩黃換紅」？',
      existing: yellows
    };
  }
  return { suggest: null, reason: '', existing: yellows };
}

/** 已被罰離場的球員（紅牌或兩黃換紅） */
export function sentOffPlayerIds(events: TimelineEvent[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of events || []) {
    if (!isLive(e) || e.type !== 'card' || !e.playerId) continue;
    if (e.cardType === 'red' || e.cardType === 'second_yellow') out.add(e.playerId);
  }
  return out;
}

/** 該隊目前場上人數（先發 − 罰離場） */
export function onFieldCount(
  startingIds: string[] | null | undefined,
  events: TimelineEvent[] | null | undefined
): number {
  const off = sentOffPlayerIds(events);
  return (startingIds || []).filter(id => !off.has(id)).length;
}

/**
 * 這一場、這一隊的行為分。
 * fairPlay 預設 FAIR_PLAY，賽事設定可覆寫。不另寫一份扣分規則。
 */
export function matchFairPlay(
  events: TimelineEvent[] | null | undefined,
  teamId?: string | null,
  fairPlay: FairPlayConfig = FAIR_PLAY
): number {
  const byPlayer = new Map<string, TimelineEvent[]>();
  for (const e of events || []) {
    if (!isLive(e) || e.type !== 'card') continue;
    if (teamId && e.teamId !== teamId) continue;
    const key = e.playerId || 'unknown';
    let list = byPlayer.get(key);
    if (!list) {
      list = [];
      byPlayer.set(key, list);
    }
    list.push(e);
  }
  let total = 0;
  for (const cards of byPlayer.values()) total += fairPlayOf(cards, fairPlay);
  return total;
}

function fairPlayOf(cards: TimelineEvent[], fairPlay: FairPlayConfig): number {
  const sorted = [...cards].sort((a, b) => (a.clockSec ?? a.seq ?? 0) - (b.clockSec ?? b.seq ?? 0));
  const redAt = sorted.findIndex(c => c.cardType === 'red');
  if (redAt >= 0) {
    const prior = sorted.slice(0, redAt).some(c => c.cardType === 'yellow' || c.cardType === 'second_yellow');
    return prior ? fairPlay.yellowThenRed : fairPlay.directRed;
  }
  if (sorted.some(c => c.cardType === 'second_yellow')) return fairPlay.secondYellow;
  return sorted.filter(c => c.cardType === 'yellow').length * fairPlay.yellow;
}

/** 該隊已用換人次數 */
export function subCount(events: TimelineEvent[] | null | undefined, side: string | null | undefined): number {
  return (events || []).filter(e => isLive(e) && e.type === 'substitution' && e.side === side).length;
}

/**
 * 換人次數檢查。超過上限只警示、不阻擋。
 */
export function checkSubLimit(
  events: TimelineEvent[] | null | undefined,
  side: string | null | undefined,
  limit: number
): { used: number; limit: number | null; over: boolean; message: string } {
  const used = subCount(events, side);
  if (!Number.isFinite(limit) || limit <= 0) return { used, limit: null, over: false, message: '' };
  return {
    used,
    limit,
    over: used >= limit,
    message: used >= limit ? `這隊已用 ${used} 人次換人，達上限 ${limit}。仍要繼續嗎？` : ''
  };
}

/**
 * 組出完賽送出的 patch。
 * 勝負只有 matchResult 一份。這裡仍用 Number() 把缺的比分收成 0，維持原行為。
 */
export function buildFinishPatch({
  score,
  htScore,
  penaltyScore,
  events,
  uid,
  matchDurationMin,
  periods = 2,
  clock,
  etHalfMin = 5
}: {
  score?: Partial<Score> | null;
  htScore?: Partial<Score> | null;
  penaltyScore?: Partial<Score> | null;
  events?: TimelineEvent[] | null;
  uid?: string;
  matchDurationMin?: number;
  periods?: number;
  clock?: Partial<ClockState> | null;
  etHalfMin?: number;
}): {
  score: { home: number; away: number };
  htScore: Partial<Score> | null;
  penaltyScore: Partial<Score> | null;
  status: 'finished';
  period: 'ft';
  clock: Partial<ClockState> & { running: false; periodStartedAt: null; elapsedSecAtPause: number; addedTimeSec: number };
  result: MatchResult | null;
  lock: { locked: true; lockedBy: string | undefined };
  scoreMismatch: boolean;
  updatedBy: string | undefined;
} {
  const check = consistencyCheck(score, events);
  const h = Number(score?.home) || 0;
  const a = Number(score?.away) || 0;
  const pk = penaltyScore && (penaltyScore.home != null || penaltyScore.away != null) ? penaltyScore : null;
  const pkInts = pk ? { home: Number(pk.home) || 0, away: Number(pk.away) || 0 } : { home: null, away: null };
  const result = matchResult({ home: h, away: a }, pkInts);

  return {
    score: { home: h, away: a },
    htScore: htScore ?? null,
    penaltyScore: pk,
    status: 'finished',
    period: 'ft',
    clock: {
      ...(clock ?? {}),
      running: false,
      periodStartedAt: null,
      elapsedSecAtPause: clock?.elapsedSecAtPause ?? 0,
      addedTimeSec: Math.max(
        0,
        (clock?.elapsedSecAtPause ?? 0) - (clock?.periodId?.startsWith('et') ? etHalfMin * 60 : (matchDurationMin ?? 30) * 60 / periods)
      )
    },
    result,
    lock: { locked: true, lockedBy: uid },
    scoreMismatch: !check.ok,
    updatedBy: uid
  };
}

/** 撤回視窗（秒）。與規則檔 duration.value(3, 'm') 對齊。 */
export const UNDO_WINDOW_SEC = 180;

/**
 * 各種時間格式 → 毫秒。
 * 不讀 .seconds，也不用 Number(v)：Number(null) 是 0，會被當成 1970 年。
 * 跟 util.toMillis 分開，避免把 Timestamp 的 seconds 欄位併進來改變原行為。
 */
function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const o = v as { toMillis?: unknown };
    if (typeof o.toMillis === 'function') return (o.toMillis as () => number)();
    if (v instanceof Date) return v.getTime();
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** 出場名單上球員的兩種身分：先發／替補 */
export const SHEET_ROLES = ['start', 'bench'] as const;

/**
 * 名冊上的這一列是球員嗎。
 * 出場名單的 role 是 start／bench 時也是球員，不能只認 'player'。
 */
export function isPlayerRow(p: { role?: string | null; kind?: string | null } | null | undefined): boolean {
  const r = p?.role ?? p?.kind ?? 'player';
  return r === 'player' || (SHEET_ROLES as readonly string[]).includes(r);
}

/**
 * 目前在場上的球員。名冊上沒有先發／替補時回 null（不知道，不是沒有人）。
 */
export function onFieldIds(
  roster: Array<{ role?: string | null; kind?: string | null; memberId?: string | null }> | null | undefined,
  events: TimelineEvent[] | null | undefined
): Set<string> | null {
  const rows = (roster || []).filter(isPlayerRow);
  if (!rows.some(p => (SHEET_ROLES as readonly string[]).includes(p?.role ?? ''))) return null;
  const on = new Set(
    rows.filter(p => p.role === 'start' && p.memberId).map(p => p.memberId as string)
  );
  const subs = (events || [])
    .filter(e => isLive(e) && e.type === 'substitution')
    .sort((a, b) => (a.clockSec ?? 0) - (b.clockSec ?? 0) || (a.seq ?? 0) - (b.seq ?? 0));
  for (const e of subs) {
    if (e.playerId) on.delete(e.playerId);
    if (e.subInPlayerId) on.add(e.subInPlayerId);
  }
  for (const id of sentOffPlayerIds(events)) on.delete(id);
  return on;
}

interface RosterSortRow {
  role?: string | null;
  kind?: string | null;
  jerseyNo?: number | null;
  order?: number | null;
  displayName?: string | null;
  name?: string | null;
}

/**
 * 出場名單順序：球員在前（依背號），隊職員排最後。
 */
export function sortRosterForMatch<T extends RosterSortRow>(rows: T[] | null | undefined): T[] {
  return [...(rows || [])].sort((a, b) =>
    (isPlayerRow(a) ? 0 : 1) - (isPlayerRow(b) ? 0 : 1)
    || (a?.jerseyNo ?? Infinity) - (b?.jerseyNo ?? Infinity)
    || (a?.order ?? 0) - (b?.order ?? 0)
    || String(a?.displayName ?? a?.name ?? '').localeCompare(String(b?.displayName ?? b?.name ?? ''), 'zh-Hant'));
}

/**
 * 完賽之後可不可以自己撤回。時間由呼叫端給。
 * 離線時一律不給撤回，而且不顯示倒數。
 */
export function undoState({
  match,
  nowMs,
  online,
  uid,
  pendingWrite = false
}: {
  match?: MatchLike | null;
  nowMs: number;
  online?: boolean;
  uid?: string | null;
  pendingWrite?: boolean;
}): { can: boolean; leftSec: number | null; reason: string } {
  const no = (reason: string) => ({ can: false, leftSec: null, reason });

  if (!match) return no('沒有場次資料');
  if (match.status === 'confirmed') return no('主辦已覆核這場成績，要更正請找管理員。');
  if (match.status !== 'finished') return no('這場還沒送出完賽。');
  if (!uid || match.scoreSubmittedBy !== uid) {
    return no('只有送出完賽的那個人可以自行撤回，其他人請找管理員。');
  }
  if (online !== true || pendingWrite === true) {
    return no('完賽還在待同步，連上線之後才會開始計算可撤回時間。');
  }

  const at = toMs(match.scoreSubmittedAt);
  if (at == null) return no('完賽還在待同步，連上線之後才會開始計算可撤回時間。');

  const leftSec = Math.ceil((at + UNDO_WINDOW_SEC * 1000 - nowMs) / 1000);
  if (leftSec <= 0) return no(`已超過 ${UNDO_WINDOW_SEC / 60} 分鐘，要更正請找管理員。`);

  return { can: true, leftSec, reason: '' };
}

/** 撤回完賽的 patch。比分與事件全部保留，只是把場次退回進行中。 */
export function buildUndoPatch({
  uid,
  events
}: {
  uid?: string;
  events?: TimelineEvent[] | null;
}) {
  return {
    status: 'live',
    period: lastPlayedPeriod(events),
    result: null,
    // lockedAt 一定要一起寫。update 對巢狀 map 是整包取代，少列一個欄位就等於刪掉它。
    lock: { locked: false, lockedAt: null, lockedBy: null },
    scoreSubmittedAt: null,
    scoreSubmittedBy: null,
    updatedBy: uid
  };
}

/** 完賽確認畫面要顯示的摘要 */
export function finishSummary({
  match,
  events
}: {
  match?: MatchLike | null;
  events?: TimelineEvent[] | null;
}) {
  const check = consistencyCheck(match?.score, events);
  return {
    home: match?.home?.name ?? '主隊',
    away: match?.away?.name ?? '客隊',
    score: `${Number(match?.score?.home) || 0} - ${Number(match?.score?.away) || 0}`,
    htScore: match?.htScore ? `${match.htScore.home}-${match.htScore.away}` : null,
    eventCount: (events || []).filter(isLive).length,
    goalCount: (events || []).filter(e => isLive(e) && (SCORING_TYPES as readonly string[]).includes(e.type ?? '')).length,
    consistency: check
  };
}

/** 事件排序：時間軸由新到舊 */
export function sortEventsDesc<T extends { clockSec?: number; seq?: number }>(events: T[] | null | undefined): T[] {
  return [...(events || [])].sort((a, b) =>
    (b.clockSec ?? 0) - (a.clockSec ?? 0) || (b.seq ?? 0) - (a.seq ?? 0));
}
