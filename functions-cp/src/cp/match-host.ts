/**
 * cpHost 第 3 步動作：排賽程、改期、主辦登錄比分、比分確認、棄權、重置、積分全量重算。
 * F1（§3.272）：取消單場、主辦手動結束、管理員恢復。取消場次同一筆交易發一則系統公告。
 * F2（§3.272）：單場改期可延後末場（原末場後 60 天）、撞期、整天順延、兩場對調。同交易發系統公告。
 * F3（§3.272）：同分裁定 resolveTie、撤銷 clearTieDecision、逐項比較 explainTie（唯讀，不寫稽核）。
 * F4（§3.272）：主辦公告 postNotice、刪除公告 deleteNotice（系統公告也可刪）。
 * 契約：docs/specs/tournament-research/cp-step3/contract.md（local-only）、.grok-input/contract.md §3.272。
 *
 * 原則
 * - 權限：launchGate（內部期）→ 交易內 loadComp → assertCompVisible → assertHostOrCo（主辦、共同主辦、管理員）。
 * - 場次寫入一律 Admin SDK；公開場次文件不放 uid（操作者只進雜湊稽核）。
 * - rev 只增不退（§3.250-6）：每次伺服器改場次都 +1，讓離線的舊直寫在 Rules 被拒；resetMatch 另記 resetRev。
 * - 積分只算 confirmed／walkover（§6.3-7）；取消不計分。積分榜由觸發器重算（match-trigger.ts）。
 *   同分裁定在同一筆交易裡重算該組，失效規則在 buildStanding。
 *   賽事 endedBy 為 confirm 時，裁定與撤銷在同一筆交易重算 champions；其他欄位與回傳不變。
 * - 第 3 步只開單一組循環；多組與淘汰屬第 5 步。
 */
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import {
  buildStanding, civilYmd, clearedManualOverride, computeRows, engineInputsOf, explainTie as explainTieCalc,
  matchResult, matchesPendingTie, resolveRules, scheduleDayWindow, tieDecisionView,
  type ManualOverride, type MatchLike, type MatchResult, type StandingDoc, type StandingRow
} from '../engine/index.js';
import { CpError, bad, deny, pre } from './errors.js';
import {
  CID_RE,
  DVID_RE,
  ENID_RE,
  FieldValue,
  Timestamp,
  assertCompVisible,
  assertHostOrCo,
  isAdmin,
  loadComp,
  newId,
  readDoc,
  readQuery,
  requireId,
  ts,
  writeAudit,
  actorHash,
  type Caller,
  type CompDoc,
  type CpDeps,
  type GateResult
} from './context.js';
import { findBannedWord, requireLine } from './text.js';
import { LIMITS, onlyKeys, requireEnum, statusReasonOf, teamLogoOf } from './validate.js';
import {
  canCancelMatch,
  canResetMatch,
  derivedScoreOf,
  planRoundRobin,
  publicMatchDoc,
  standingMatchesOf,
  statusAfterReset,
  type PlanDay
} from './schedule-plan.js';
import { correctedAtMs, summaryEntryOf, summaryShardIdOf } from './summary.js';
import { loadChampions, recomputeDivisionStandings, standingRef, zeroStandingDoc } from './match-trigger.js';
import {
  NOTICE_ID_RE,
  appendSystemNotice,
  cancelNoticeText,
  noticeTextOf,
  noticesOf,
  pushNotice,
  removeNotice,
  type Notice
} from './notice.js';
import {
  DAY_MATCH_MAX,
  conflictWindowOfKickoff,
  findSlotConflict,
  firstMoveConflict,
  isYmd,
  kickoffOutOfRange,
  nextLastMatchDayStart,
  rescheduleNoticeText,
  shiftDayNoticeText,
  shiftKickoffToDate,
  slotEndMs,
  swapNoticeText,
  taipeiDayWindow,
  type ScheduleConflict,
  type SlotView
} from './schedule-flex.js';

export const MTID_RE = /^mt_[A-Za-z0-9]{20}$/;
export const SCHEDULE_LIMITS = Object.freeze({
  teamsMin: 2,
  teamsMax: 16,
  matchesMax: 200,
  daysMax: 14,
  scoreMax: 99,
  /** 末場確認自動結束後，主辦仍可改比分的寬限（之後只有管理員） */
  endedGraceMs: 3 * 86400_000
});
const UTC_OFFSET = '+08:00';
/** 取消、手動結束、恢復的原因上限（Unicode code point）。比 statusReason 的 200 更短。 */
const ACTION_REASON_MAX = 100;
/** 確認對帳時 timeline、voids 各最多讀 200 筆（與 Rules 的 rev - resetRev <= 200 相同）。查詢多帶 1 筆，用來分辨剛好滿額與超限。 */
const TIMELINE_MAX = 200;
const EDITABLE_SCHEDULE = ['scheduled', 'postponed'];

function int(v: unknown, field: string, min: number, max: number, dflt?: number): number {
  if (v == null && dflt !== undefined) return dflt;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad('FIELD_RANGE', { field, min, max });
  return v;
}

/** 官方賽期的日期標籤（台北日曆日）。午夜標記不能用 matchDayOf，否則會掉到前一個比賽日。 */
function taipeiYmd(ms: number): string {
  const d = new Date(ms + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

/** 主辦判斷＋內部期閘門＋下架；回賽事文件。改規則與此共用，不另寫一份。 */
export async function hostComp(deps: CpDeps, tx: Transaction, caller: Caller, gate: GateResult, cid: string): Promise<CompDoc> {
  const comp = await loadComp(deps, tx, cid);
  assertCompVisible(comp, gate);
  await assertHostOrCo(deps, tx, cid, comp, caller);
  if (comp.hidden && !isAdmin(caller)) throw pre('COMPETITION_HIDDEN');
  if (comp.deletingAt) throw pre('COMPETITION_DELETING');
  return comp;
}

/**
 * 已結束則擋下非管理員。
 * 寬限只給末場確認（endedBy:'confirm'）的 3 天。手動結束（host）與自動結束（auto）沒有寬限。
 * 管理員仍可改場次。重複手動結束不走這裡，由 endCompetition 另判。
 */
export function assertNotEnded(deps: CpDeps, comp: CompDoc, caller: Caller): void {
  if (!comp.endedAt || isAdmin(caller)) return;
  const graceOk = comp.endedBy === 'confirm'
    && deps.now().getTime() < comp.endedAt.toMillis() + SCHEDULE_LIMITS.endedGraceMs;
  if (!graceOk) throw pre('COMPETITION_ENDED');
}

/** 取消／結束／恢復的原因：既有單行清理，2～100 字，並走禁用詞。 */
function hostReasonOf(v: unknown, bannedWords: readonly string[]): string {
  const reason = requireLine(v, 'reason', 2, ACTION_REASON_MAX);
  if (findBannedWord(reason, bannedWords)) throw bad('BANNED_WORD', { field: 'reason' });
  return reason;
}

function assertScheduleEditable(comp: CompDoc): void {
  if (!['draft', 'published'].includes(comp.status)) throw pre('STATUS_NOT_EDITABLE', { status: comp.status });
  if (!comp.rostersLockedAt) throw pre('ROSTERS_NOT_LOCKED');
}

function assertResultEditable(comp: CompDoc): void {
  if (comp.status !== 'published') throw pre('STATUS_NOT_EDITABLE', { status: comp.status });
}

// ── 排賽程 ─────────────────────────────────────────────────────────────
function daysOf(v: unknown): PlanDay[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > SCHEDULE_LIMITS.daysMax) {
    throw bad('FIELD_RANGE', { field: 'days', min: 1, max: SCHEDULE_LIMITS.daysMax });
  }
  return v.map((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad('FIELD_TYPE', { field: `days.${i}` });
    const o = x as Record<string, unknown>;
    onlyKeys(o, ['date', 'start', 'end']);
    for (const k of ['date', 'start', 'end'] as const) {
      if (typeof o[k] !== 'string') throw bad('FIELD_TYPE', { field: `days.${i}.${k}` });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date as string)) throw bad('FIELD_FORMAT', { field: `days.${i}.date` });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.start as string)) throw bad('FIELD_FORMAT', { field: `days.${i}.start` });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.end as string)) throw bad('FIELD_FORMAT', { field: `days.${i}.end` });
    const day = { date: o.date as string, start: o.start as string, end: o.end as string };
    // 起點早於 05:00 一律拒。凌晨場請把前一天的 end 拉過午夜（end <= start）。
    // 前端文案留給 U7；這裡只在 details 帶 reason，錯誤代碼仍是 FIELD_RANGE。
    if (day.start < '05:00') {
      throw bad('FIELD_RANGE', { field: 'days', reason: 'startBeforeCutoff' });
    }
    // end <= start 視為隔天結束。總長不合、或起點已不早於隔天 05:00，回既有 FIELD_RANGE。
    // 窗可以晚於隔天 05:00 收（比賽可踢過切點）；開賽上限在 planRoundRobin 擋。
    if (civilYmd(day.date) && scheduleDayWindow(day.date, day.start, day.end) == null) {
      throw bad('FIELD_RANGE', { field: 'days' });
    }
    return day;
  });
}

function venueIdxOf(v: unknown, venueCount: number): number[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > venueCount) throw bad('FIELD_RANGE', { field: 'venueIdx', min: 1, max: venueCount });
  const seen = new Set<number>();
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x >= venueCount || seen.has(x)) {
      throw bad('FIELD_RANGE', { field: 'venueIdx', min: 0, max: venueCount - 1 });
    }
    seen.add(x);
  }
  return [...seen];
}

interface MatchRow { ref: DocumentReference; id: string; status: string; kickoffMs: number | null }

async function divisionMatches(deps: CpDeps, tx: Transaction, cid: string, dvId: string): Promise<MatchRow[]> {
  const snap = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/matches`)
    .where('divisionId', '==', dvId).select('status', 'kickoffAt').limit(SCHEDULE_LIMITS.matchesMax + 1));
  return snap.docs.map(d => ({
    ref: d.ref, id: d.id, status: String(d.get('status') ?? ''),
    kickoffMs: typeof d.get('kickoffAt')?.toMillis === 'function' ? d.get('kickoffAt').toMillis() : null
  }));
}

/** 讀出要改的摘要片（交易內先讀完），回傳「片 id → 目前條目表」。 */
async function readShards(deps: CpDeps, tx: Transaction, cid: string, ids: Iterable<string>) {
  const out = new Map<string, { ref: DocumentReference; m: Record<string, unknown> }>();
  for (const id of new Set(ids)) {
    const ref = deps.db.doc(`competitions/${cid}/summary/${id}`);
    const snap = await readDoc(deps, tx, ref);
    const m = snap.exists && snap.get('m') && typeof snap.get('m') === 'object' ? { ...(snap.get('m') as Record<string, unknown>) } : {};
    out.set(id, { ref, m });
  }
  return out;
}

function writeShards(tx: Transaction, shards: Map<string, { ref: DocumentReference; m: Record<string, unknown> }>): void {
  for (const { ref, m } of shards.values()) {
    if (Object.keys(m).length === 0) tx.delete(ref);
    else tx.set(ref, { m, updatedAt: FieldValue.serverTimestamp() });
  }
}

const SCHEDULE_KEYS = [
  'action', 'cid', 'dvId', 'legs', 'ranking', 'matchMinutes', 'bufferMinutes', 'minRestMinutes',
  'days', 'venueIdx', 'seed', 'dryRun'
];

export async function generateSchedule(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, SCHEDULE_KEYS);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  const legs = int(input.legs, 'legs', 1, 2) as 1 | 2;
  const ranking = requireEnum(input.ranking ?? 'h2hFirst', ['h2hFirst', 'goalDiffFirst'] as const, 'ranking');
  const matchMinutes = int(input.matchMinutes, 'matchMinutes', 5, 180);
  const bufferMinutes = int(input.bufferMinutes, 'bufferMinutes', 0, 60, 0);
  const minRestMinutes = int(input.minRestMinutes, 'minRestMinutes', 0, 240, 0);
  const days = daysOf(input.days);
  const seed = input.seed == null ? Math.floor(Math.random() * 2_147_483_647) : int(input.seed, 'seed', 0, 2_147_483_647);
  if (input.dryRun != null && typeof input.dryRun !== 'boolean') throw bad('FIELD_TYPE', { field: 'dryRun' });
  const dryRun = input.dryRun === true;

  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    assertScheduleEditable(comp);
    const venues = Array.isArray(comp.venues) ? (comp.venues as Array<{ name?: unknown }>) : [];
    const venueIdx = venueIdxOf(input.venueIdx, venues.length);
    const firstYmd = taipeiYmd(comp.firstMatchAt.toMillis());
    const lastYmd = taipeiYmd(comp.lastMatchAt.toMillis());
    days.forEach((d, i) => {
      if (d.date < firstYmd || d.date > lastYmd) throw bad('SCHEDULE_OUT_OF_RANGE', { field: `days.${i}.date`, min: firstYmd, max: lastYmd });
    });

    const dvRef = deps.db.doc(`competitions/${cid}/divisions/${dvId}`);
    const dv = await readDoc(deps, tx, dvRef);
    if (!dv.exists) throw new CpError('not-found', 'DIVISION_NOT_FOUND');
    const entries = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/entries`)
      .where('dvId', '==', dvId).where('status', '==', 'approved').select('name', 'teamLogo').limit(SCHEDULE_LIMITS.teamsMax + 1));
    const n = entries.size;
    if (n < SCHEDULE_LIMITS.teamsMin || n > SCHEDULE_LIMITS.teamsMax) {
      throw pre('TEAMS_RANGE', { count: n, min: SCHEDULE_LIMITS.teamsMin, max: SCHEDULE_LIMITS.teamsMax });
    }
    const matchCount = legs * n * (n - 1) / 2;
    if (matchCount > SCHEDULE_LIMITS.matchesMax) throw pre('TOO_MANY_MATCHES', { count: matchCount, max: SCHEDULE_LIMITS.matchesMax });
    const old = await divisionMatches(deps, tx, cid, dvId);
    if (old.some(m => !EDITABLE_SCHEDULE.includes(m.status))) throw pre('RESULTS_EXIST');

    // 隊伍依 enId 排序再交給引擎抽籤，讓同 seed 的預覽與正式產生一致（查詢順序不影響結果）
    // 隊徽在產生當下再跑 teamLogoOf（含白名單）。不合格寫 null。同一查詢多投影一欄，不加讀取。
    const teams = entries.docs
      .map(d => ({
        enId: d.id,
        name: typeof d.get('name') === 'string' ? (d.get('name') as string) : '隊伍',
        logo: teamLogoOf(d.get('teamLogo'))
      }))
      .sort((a, b) => (a.enId < b.enId ? -1 : 1));
    let plan;
    try {
      plan = planRoundRobin({
        dvId, teams, legs, matchMinutes, bufferMinutes, minRestMinutes, days,
        venues: venueIdx.map(i => ({ venueIdx: i, name: String(venues[i]?.name ?? `場地 ${i + 1}`) })),
        playersOnField: Number(dv.get('playersOnField')) || 5, seed, utcOffset: UTC_OFFSET
      });
    } catch (e) {
      if (e instanceof RangeError) throw bad('FIELD_RANGE', { field: e.message || 'schedule' });
      throw e;
    }
    const preview = {
      dvId, seed, matchCount: plan.matchCount, unplacedCount: plan.unplacedCount,
      daysUsed: plan.daysUsed, perTeam: legs * (n - 1), teamCount: n
    };
    if (dryRun) return { ...preview, dryRun: true };
    if (plan.unplacedCount > 0) throw pre('SCHEDULE_UNPLACED', { count: plan.unplacedCount });

    const now = FieldValue.serverTimestamp();
    const docs = plan.matches.map(m => {
      const mtId = newId('mt');
      const { kickoffMs, ...rest } = publicMatchDoc(m, { mtId, dvId }) as Record<string, unknown> & { kickoffMs: number | null };
      return { mtId, kickoffMs, data: { ...rest, kickoffAt: kickoffMs == null ? null : ts(kickoffMs), updatedAt: now } };
    });
    const shardIds = [
      ...old.map(m => summaryShardIdOf(m.kickoffMs, UTC_OFFSET)),
      ...docs.map(d => summaryShardIdOf(d.kickoffMs, UTC_OFFSET))
    ];
    const shards = await readShards(deps, tx, cid, shardIds);
    const prevSchedule = dv.get('schedule');
    // Firestore 單一交易最多 500 筆寫入：舊場次刪除＋新場次＋摘要片＋積分＋組別＋稽核＋賽事。
    // 改期把舊場次散到很多天後直接重排可能超過（Grok 審查 P1-1）→ 失敗關閉，請主辦先清除賽程再排。
    const writeCount = old.length + docs.length + new Set(shardIds).size + 4;
    if (writeCount > 490) throw pre('SCHEDULE_REPLACE_TOO_LARGE', { writes: writeCount });
    const prevStanding = await readDoc(deps, tx, standingRef(deps, cid, dvId, 'group', 'A'));
    const prevStandingVersion = prevStanding.exists && typeof prevStanding.get('version') === 'number' ? prevStanding.get('version') as number : 0;

    // ── 寫入（交易內全部讀完之後）──
    for (const m of old) {
      tx.delete(m.ref);
      const s = shards.get(summaryShardIdOf(m.kickoffMs, UTC_OFFSET));
      if (s) delete s.m[m.id];
    }
    for (const d of docs) {
      tx.create(deps.db.doc(`competitions/${cid}/matches/${d.mtId}`), d.data);
      shards.get(summaryShardIdOf(d.kickoffMs, UTC_OFFSET))!.m[d.mtId] = summaryEntryOf(d.data, d.kickoffMs);
    }
    writeShards(tx, shards);
    const groups = plan.groups.map(g => ({ groupId: g.groupId, teamIds: [...g.teamIds] }));
    const names = Object.fromEntries(teams.map(t => [t.enId, t.name]));
    const divisionName = typeof dv.get('name') === 'string' ? dv.get('name') as string : '';
    // 組別這筆交易已經讀過。零積分榜用這份文件解析，不再用 rankingRuleOf。不另讀。
    const divisionRaw = (dv.data() ?? {}) as Record<string, unknown>;
    tx.set(standingRef(deps, cid, dvId, 'group', 'A'), zeroStandingDoc(
      cid, dvId, groups[0].teamIds, names, divisionRaw, ranking, prevStandingVersion, divisionName
    ));
    // 末場確認造成的結束（例如另一組別先打完）在新排賽程時解除（Opus 終審 P1-1 (b)）
    // K3：同一筆更新清掉冠軍名，避免留下過期隊名。不另讀。
    if (comp.endedAt && comp.endedBy === 'confirm') {
      tx.update(deps.db.doc(`competitions/${cid}`), {
        endedAt: null, endedBy: null, champions: FieldValue.delete(),
        stateVersion: FieldValue.increment(1), updatedAt: now
      });
    }
    tx.update(dvRef, {
      schedule: {
        format: 'roundRobin', legs, ranking, matchMinutes, bufferMinutes, minRestMinutes, seed,
        groups, matchCount: plan.matchCount,
        version: (typeof prevSchedule?.version === 'number' ? prevSchedule.version : 0) + 1,
        generatedAt: now
      },
      updatedAt: now
    });
    writeAudit(deps, tx, cid, caller, 'generateSchedule', { dvId, matchCount: plan.matchCount, replaced: old.length, seed });
    return { ...preview, dryRun: false };
  });
}

export async function clearSchedule(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    assertScheduleEditable(comp);
    const dvRef = deps.db.doc(`competitions/${cid}/divisions/${dvId}`);
    const dv = await readDoc(deps, tx, dvRef);
    if (!dv.exists) throw new CpError('not-found', 'DIVISION_NOT_FOUND');
    const old = await divisionMatches(deps, tx, cid, dvId);
    if (old.some(m => !EDITABLE_SCHEDULE.includes(m.status))) throw pre('RESULTS_EXIST');
    const shards = await readShards(deps, tx, cid, old.map(m => summaryShardIdOf(m.kickoffMs, UTC_OFFSET)));
    for (const m of old) {
      tx.delete(m.ref);
      const s = shards.get(summaryShardIdOf(m.kickoffMs, UTC_OFFSET));
      if (s) delete s.m[m.id];
    }
    writeShards(tx, shards);
    tx.delete(standingRef(deps, cid, dvId, 'group', 'A'));
    tx.update(dvRef, { schedule: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    writeAudit(deps, tx, cid, caller, 'clearSchedule', { dvId, removed: old.length });
    return { dvId, removed: old.length };
  });
}

// ── 單場 ───────────────────────────────────────────────────────────────
interface LoadedMatch { ref: DocumentReference; snap: DocumentSnapshot; status: string; rev: number; resetRev: number; kickoffMs: number | null }

async function loadMatch(deps: CpDeps, tx: Transaction, cid: string, mtId: string, expectedRev: number): Promise<LoadedMatch> {
  const ref = deps.db.doc(`competitions/${cid}/matches/${mtId}`);
  const snap = await readDoc(deps, tx, ref);
  if (!snap.exists) throw new CpError('not-found', 'MATCH_NOT_FOUND');
  const rev = snap.get('rev');
  if (typeof rev !== 'number' || !Number.isInteger(rev)) throw pre('MATCH_CORRUPT');
  if (rev !== expectedRev) throw pre('REV_CONFLICT', { rev });
  const k = snap.get('kickoffAt');
  return {
    ref, snap, status: String(snap.get('status') ?? ''), rev,
    resetRev: typeof snap.get('resetRev') === 'number' ? snap.get('resetRev') : 0,
    kickoffMs: k && typeof k.toMillis === 'function' ? k.toMillis() : null
  };
}

function matchIds(input: Record<string, unknown>) {
  return {
    cid: requireId(input.cid, CID_RE, 'cid'),
    mtId: requireId(input.mtId, MTID_RE, 'mtId'),
    expectedRev: int(input.expectedRev, 'expectedRev', 0, 1_000_000)
  };
}

function scoreInput(v: unknown): { home: number; away: number } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('FIELD_TYPE', { field: 'score' });
  const o = v as Record<string, unknown>;
  onlyKeys(o, ['home', 'away']);
  return {
    home: int(o.home, 'score.home', 0, SCHEDULE_LIMITS.scoreMax),
    away: int(o.away, 'score.away', 0, SCHEDULE_LIMITS.scoreMax)
  };
}

const CLEAR_CLOCK = { startedAt: null, pausedSec: 0, running: false, period: 'pre' };

// ── F2 賽程彈性 ────────────────────────────────────────────────────────
// 摘要片不在這裡搬。cpOnMatchWritten 看到 kickoffAt／venueName 變更會自己搬。
// 賽事根文件只透過 appendSystemNotice 的 patch 寫一次（末場延後與公告同一筆）。
// 撞期查整場賽事：場地跨組共用。組別只決定這場的比賽分鐘與緩衝。

interface SlotMinutes { match: number; buffer: number }

function forceOf(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v !== 'boolean') throw bad('FIELD_TYPE', { field: 'force' });
  return v;
}

function ymdOf(v: unknown, field: string): string {
  if (v == null || v === '') throw bad('FIELD_REQUIRED', { field });
  if (typeof v !== 'string') throw bad('FIELD_TYPE', { field });
  if (!isYmd(v)) throw bad('FIELD_FORMAT', { field });
  return v;
}

/** 60 天上限的基準：還沒延後過就用目前末場。 */
function originLastMs(comp: CompDoc): number {
  const origin = comp.lastMatchOriginAt;
  if (origin && typeof origin.toMillis === 'function') return origin.toMillis();
  return comp.lastMatchAt.toMillis();
}

/** 新開賽的台北日比目前末場日更晚才延後。同一日或更早不改，也不能提前。 */
function extensionPatch(comp: CompDoc, kickoffs: readonly (number | null)[]): Record<string, unknown> {
  const day = nextLastMatchDayStart(comp.lastMatchAt.toMillis(), kickoffs);
  if (day == null) return {};
  const patch: Record<string, unknown> = {
    lastMatchAt: ts(day),
    stateVersion: FieldValue.increment(1)
  };
  if (!(comp.lastMatchOriginAt && typeof comp.lastMatchOriginAt.toMillis === 'function')) {
    patch.lastMatchOriginAt = comp.lastMatchAt;
  }
  return patch;
}

function assertKickoffInWindow(kickoffMs: number, comp: CompDoc, field: string): void {
  const range = kickoffOutOfRange(kickoffMs, comp.firstMatchAt.toMillis(), originLastMs(comp));
  if (range) throw bad('SCHEDULE_OUT_OF_RANGE', { field, min: range.min, max: range.max });
}

function kickoffMsOf(snap: DocumentSnapshot): number | null {
  const k = snap.get('kickoffAt') as { toMillis?: () => number } | null;
  return k && typeof k.toMillis === 'function' ? k.toMillis() : null;
}

function teamIdsOf(snap: DocumentSnapshot): string[] {
  const raw = snap.get('teamIds');
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  const ids = [snap.get('home.teamId'), snap.get('away.teamId')];
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function venueIdxOfSnap(snap: DocumentSnapshot): number | null {
  const v = snap.get('venueIdx');
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function venueNameOfSnap(snap: DocumentSnapshot): string | null {
  const name = snap.get('venueName');
  return typeof name === 'string' ? name : null;
}

function divisionIdOf(snap: DocumentSnapshot): string {
  const id = snap.get('divisionId');
  return typeof id === 'string' ? id : '';
}

function revOfSnap(snap: DocumentSnapshot): number {
  const rev = snap.get('rev');
  if (typeof rev !== 'number' || !Number.isInteger(rev)) throw pre('MATCH_CORRUPT');
  return rev;
}

function noticeBoard(deps: CpDeps, cid: string, comp: CompDoc, caller: Caller) {
  return {
    ref: deps.db.doc(`competitions/${cid}`),
    notices: comp.notices,
    at: Timestamp.fromMillis(deps.now().getTime()),
    by: actorHash(cid, caller.uid)
  };
}

function rejectConflict(hit: ScheduleConflict | null, force: boolean): void {
  if (hit && !force) throw pre('SCHEDULE_CONFLICT', { mtId: hit.mtId, type: hit.type });
}

/** 只有真的放行一筆衝突才寫進稽核。沒撞期不記 force。 */
function conflictAudit(hit: ScheduleConflict | null, force: boolean): Record<string, unknown> {
  if (!hit || !force) return {};
  return { force: true, conflictMtId: hit.mtId, conflictType: hit.type };
}

const SLOT_FALLBACK_MATCH_MIN = 180;
const SLOT_FALLBACK_BUFFER_MIN = 60;

async function divisionMinutes(deps: CpDeps, tx: Transaction, cid: string): Promise<Map<string, SlotMinutes>> {
  const snap = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/divisions`).limit(LIMITS.divisionsMax));
  const map = new Map<string, SlotMinutes>();
  for (const doc of snap.docs) {
    const raw = doc.get('schedule');
    const o = raw && typeof raw === 'object' ? raw as { matchMinutes?: unknown; bufferMinutes?: unknown } : {};
    // 缺分鐘設定時採保守值（不當 0，避免漏判撞期；Flash 初審 P2）。正常資料由 generateSchedule 寫入。
    const match = typeof o.matchMinutes === 'number' && Number.isInteger(o.matchMinutes) && o.matchMinutes > 0 ? o.matchMinutes : SLOT_FALLBACK_MATCH_MIN;
    const buffer = typeof o.bufferMinutes === 'number' && Number.isInteger(o.bufferMinutes) && o.bufferMinutes >= 0 ? o.bufferMinutes : SLOT_FALLBACK_BUFFER_MIN;
    map.set(doc.id, { match, buffer });
  }
  return map;
}

function occupySlot(
  mtId: string, startMs: number, divisionId: string, teamIds: readonly string[], venueIdx: number | null,
  durations: Map<string, SlotMinutes>
): SlotView {
  const dur = durations.get(divisionId) ?? { match: SLOT_FALLBACK_MATCH_MIN, buffer: SLOT_FALLBACK_BUFFER_MIN };
  return { mtId, startMs, endMs: slotEndMs(startMs, dur.match, dur.buffer), teamIds, venueIdx };
}

/** 當日（或撞期窗）場次。超過上限就失敗關閉，避免截斷後漏判撞期或只搬走一部分。 */
async function matchesInWindow(deps: CpDeps, tx: Transaction, cid: string, startMs: number, endMs: number) {
  const snap = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/matches`)
    .where('kickoffAt', '>=', ts(startMs)).where('kickoffAt', '<', ts(endMs)).limit(DAY_MATCH_MAX + 1));
  if (snap.size > DAY_MATCH_MAX) throw pre('SCHEDULE_DAY_TOO_LARGE', { count: snap.size, max: DAY_MATCH_MAX });
  return snap.docs;
}

function slotsOf(docs: readonly DocumentSnapshot[], durations: Map<string, SlotMinutes>, skip: ReadonlySet<string>): SlotView[] {
  const out: SlotView[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    if (skip.has(doc.id) || seen.has(doc.id)) continue;
    if (doc.get('status') === 'cancelled') continue;
    const start = kickoffMsOf(doc);
    if (start == null) continue;
    seen.add(doc.id);
    out.push(occupySlot(doc.id, start, divisionIdOf(doc), teamIdsOf(doc), venueIdxOfSnap(doc), durations));
  }
  return out;
}

export async function rescheduleMatch(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'mtId', 'expectedRev', 'kickoffAt', 'venueIdx', 'force']);
  const { cid, mtId, expectedRev } = matchIds(input);
  const kickoffAt = input.kickoffAt == null ? null : int(input.kickoffAt, 'kickoffAt', 0, 8_640_000_000_000);
  const force = forceOf(input.force);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    // 改期收緊為已發布。草稿回 STATUS_NOT_EDITABLE（原先 draft 也可以改）。
    assertResultEditable(comp);
    const venues = Array.isArray(comp.venues) ? (comp.venues as Array<{ name?: unknown }>) : [];
    if (input.venueIdx != null && venues.length === 0) throw bad('FIELD_RANGE', { field: 'venueIdx', min: 0, max: 0 });
    const venueIdx = input.venueIdx == null ? null : int(input.venueIdx, 'venueIdx', 0, venues.length - 1);
    const venueName = venueIdx == null ? null : String(venues[venueIdx]?.name ?? `場地 ${venueIdx + 1}`);
    // 超出時間窗在讀場次前拒絕，讓這條路徑少一次讀取。
    if (kickoffAt != null) assertKickoffInWindow(kickoffAt, comp, 'kickoffAt');
    const m = await loadMatch(deps, tx, cid, mtId, expectedRev);
    if (!EDITABLE_SCHEDULE.includes(m.status)) throw pre('MATCH_STATE', { status: m.status });
    // 待定不查撞期，也不改 lastMatchAt；仍發系統公告。
    let hit: ScheduleConflict | null = null;
    if (kickoffAt != null) {
      const durations = await divisionMinutes(deps, tx, cid);
      const win = conflictWindowOfKickoff(kickoffAt);
      const docs = await matchesInWindow(deps, tx, cid, win.start, win.end);
      const candidate = occupySlot(mtId, kickoffAt, divisionIdOf(m.snap), teamIdsOf(m.snap), venueIdx, durations);
      hit = findSlotConflict(candidate, slotsOf(docs, durations, new Set([mtId])));
      rejectConflict(hit, force);
    }
    const status = kickoffAt == null ? 'postponed' : 'scheduled';
    tx.update(m.ref, {
      kickoffAt: kickoffAt == null ? null : ts(kickoffAt),
      venueIdx, venueName,
      status, rev: m.rev + 1, updatedAt: FieldValue.serverTimestamp()
    });
    const notice = appendSystemNotice(tx, noticeBoard(deps, cid, comp, caller), {
      kind: 'system',
      text: rescheduleNoticeText({
        kickoffMs: m.kickoffMs,
        homeName: sideName(m.snap.get('home'), '主隊'),
        awayName: sideName(m.snap.get('away'), '客隊'),
        toMs: kickoffAt,
        venueName
      })
    }, extensionPatch(comp, [kickoffAt]));
    writeAudit(deps, tx, cid, caller, 'rescheduleMatch', { mtId, status, ...conflictAudit(hit, force) });
    return { mtId, status, rev: m.rev + 1, noticeId: notice.id };
  });
}

/**
 * 把 fromDate（台北日）上未開賽的場次平移到 toDate，時刻與場地不變。
 * 來源日是精確的一天；目標日的撞期窗含前 240 分鐘。
 * 被搬走的場次不跟自己的舊時段撞，也不互相比（相對時刻沒變）。
 */
export async function shiftMatchDay(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'fromDate', 'toDate', 'reason', 'force']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const fromDate = ymdOf(input.fromDate, 'fromDate');
  const toDate = ymdOf(input.toDate, 'toDate');
  // 「順延」只能往後（Flash 初審 P2）；YYYY-MM-DD 字串可直接比大小
  if (toDate <= fromDate) throw bad('FIELD_RANGE', { field: 'toDate' });
  const reason = hostReasonOf(input.reason, gate.bannedWords);
  const force = forceOf(input.force);
  const fromWin = taipeiDayWindow(fromDate);
  if (!fromWin) throw bad('FIELD_FORMAT', { field: 'fromDate' });
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    assertResultEditable(comp);
    const fromDocs = await matchesInWindow(deps, tx, cid, fromWin.start, fromWin.end);
    const movable: Array<{ ref: DocumentReference; id: string; rev: number; snap: DocumentSnapshot; next: number }> = [];
    for (const doc of fromDocs) {
      if (!EDITABLE_SCHEDULE.includes(String(doc.get('status') ?? ''))) continue;
      const kick = kickoffMsOf(doc);
      if (kick == null) continue;
      const next = shiftKickoffToDate(kick, fromDate, toDate);
      if (next == null) throw bad('FIELD_FORMAT', { field: 'toDate' });
      movable.push({ ref: doc.ref, id: doc.id, rev: revOfSnap(doc), snap: doc, next });
    }
    if (movable.length === 0) throw pre('NOTHING_TO_SHIFT');
    for (const m of movable) assertKickoffInWindow(m.next, comp, 'toDate');
    const durations = await divisionMinutes(deps, tx, cid);
    // 查詢窗：起點取最早那場的窗起點，終點取所有搬動場次最晚的窗終點（Opus 終審 P3：晚場跨午夜）
    const wins = movable.map(m => conflictWindowOfKickoff(m.next));
    const target = { start: Math.min(...wins.map(w => w.start)), end: Math.max(...wins.map(w => w.end)) };
    const movedIds = new Set(movable.map(m => m.id));
    const targetDocs = await matchesInWindow(deps, tx, cid, target.start, target.end);
    const moves = movable.map(m => occupySlot(m.id, m.next, divisionIdOf(m.snap), teamIdsOf(m.snap), venueIdxOfSnap(m.snap), durations));
    const hit = firstMoveConflict(moves, slotsOf(targetDocs, durations, movedIds));
    rejectConflict(hit, force);
    const now = FieldValue.serverTimestamp();
    for (const m of movable) {
      tx.update(m.ref, { kickoffAt: ts(m.next), status: 'scheduled', rev: m.rev + 1, updatedAt: now });
    }
    const notice = appendSystemNotice(tx, noticeBoard(deps, cid, comp, caller), {
      kind: 'system', text: shiftDayNoticeText(fromDate, toDate)
    }, extensionPatch(comp, movable.map(m => m.next)));
    writeAudit(deps, tx, cid, caller, 'shiftMatchDay', {
      fromDate, toDate, reason, moved: movable.length, ...conflictAudit(hit, force)
    });
    return { fromDate, toDate, moved: movable.length, noticeId: notice.id };
  });
}

/** 兩場都未開賽才對調開賽時間與場地。場地名稱照抄，不重查場地清單。 */
export async function swapMatches(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'mtIdA', 'mtIdB', 'expectedRevA', 'expectedRevB', 'reason', 'force']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const mtIdA = requireId(input.mtIdA, MTID_RE, 'mtIdA');
  const mtIdB = requireId(input.mtIdB, MTID_RE, 'mtIdB');
  if (mtIdA === mtIdB) throw bad('FIELD_RANGE', { field: 'mtIdB' });
  const expectedRevA = int(input.expectedRevA, 'expectedRevA', 0, 1_000_000);
  const expectedRevB = int(input.expectedRevB, 'expectedRevB', 0, 1_000_000);
  const reason = hostReasonOf(input.reason, gate.bannedWords);
  const force = forceOf(input.force);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    assertResultEditable(comp);
    const a = await loadMatch(deps, tx, cid, mtIdA, expectedRevA);
    const b = await loadMatch(deps, tx, cid, mtIdB, expectedRevB);
    if (!EDITABLE_SCHEDULE.includes(a.status)) throw pre('MATCH_STATE', { status: a.status });
    if (!EDITABLE_SCHEDULE.includes(b.status)) throw pre('MATCH_STATE', { status: b.status });
    const kickA = b.kickoffMs;
    const kickB = a.kickoffMs;
    if (kickA != null) assertKickoffInWindow(kickA, comp, 'kickoffAt');
    if (kickB != null) assertKickoffInWindow(kickB, comp, 'kickoffAt');
    let hit: ScheduleConflict | null = null;
    if (kickA != null || kickB != null) {
      const durations = await divisionMinutes(deps, tx, cid);
      const found: DocumentSnapshot[] = [];
      // 每場各查自己的窗（Opus 終審 P3：原本同日去重只查第一場的窗，晚場跨午夜會漏）。
      // 不合併成一個區間：兩場可能相隔數十天，合併會一次查太多場而誤觸當日上限。重複的文件不影響撞期判斷。
      for (const kick of [kickA, kickB]) {
        if (kick == null) continue;
        const win = conflictWindowOfKickoff(kick);
        found.push(...await matchesInWindow(deps, tx, cid, win.start, win.end));
      }
      const moves: SlotView[] = [];
      if (kickA != null) moves.push(occupySlot(mtIdA, kickA, divisionIdOf(a.snap), teamIdsOf(a.snap), venueIdxOfSnap(b.snap), durations));
      if (kickB != null) moves.push(occupySlot(mtIdB, kickB, divisionIdOf(b.snap), teamIdsOf(b.snap), venueIdxOfSnap(a.snap), durations));
      const others = slotsOf(found, durations, new Set([mtIdA, mtIdB]));
      hit = firstMoveConflict(moves, [...others, ...moves]);
      rejectConflict(hit, force);
    }
    const now = FieldValue.serverTimestamp();
    tx.update(a.ref, {
      kickoffAt: kickA == null ? null : ts(kickA),
      venueIdx: venueIdxOfSnap(b.snap), venueName: venueNameOfSnap(b.snap),
      status: kickA == null ? 'postponed' : 'scheduled',
      rev: a.rev + 1, updatedAt: now
    });
    tx.update(b.ref, {
      kickoffAt: kickB == null ? null : ts(kickB),
      venueIdx: venueIdxOfSnap(a.snap), venueName: venueNameOfSnap(a.snap),
      status: kickB == null ? 'postponed' : 'scheduled',
      rev: b.rev + 1, updatedAt: now
    });
    const notice = appendSystemNotice(tx, noticeBoard(deps, cid, comp, caller), {
      kind: 'system',
      text: swapNoticeText(
        { kickoffMs: a.kickoffMs, homeName: sideName(a.snap.get('home'), '主隊'), awayName: sideName(a.snap.get('away'), '客隊') },
        { kickoffMs: b.kickoffMs, homeName: sideName(b.snap.get('home'), '主隊'), awayName: sideName(b.snap.get('away'), '客隊') }
      )
    }, extensionPatch(comp, [kickA, kickB]));
    writeAudit(deps, tx, cid, caller, 'swapMatches', { mtIdA, mtIdB, reason, ...conflictAudit(hit, force) });
    return { mtIdA, mtIdB, revA: a.rev + 1, revB: b.rev + 1, noticeId: notice.id };
  });
}

/** 負方點數只在這裡改。引擎 matchResult 仍把負方寫成 0，單元測試維持原樣。 */
function resultOf(score: { home: number; away: number }, points: { win: number; draw: number; loss: number }): MatchResult {
  const r = matchResult(score, null, { winPoints: points.win, drawPoints: points.draw });
  if (!r) throw bad('FIELD_RANGE', { field: 'score' });
  if (r.winner === 'home') r.awayPoints = points.loss;
  else if (r.winner === 'away') r.homePoints = points.loss;
  return r;
}

type TlEvent = { seq?: unknown; type?: unknown; side?: unknown; scored?: unknown };

/** 重置線之後、seq 最小的 pkStart。沒有就回 null。作廢標記不拿掉 pkStart。 */
function earliestPkStartSeq(events: TlEvent[], resetRev: number): number | null {
  let start: number | null = null;
  for (const ev of events) {
    if (ev == null || typeof ev !== 'object') continue;
    const seq = ev.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || !(seq > resetRev)) continue;
    if (ev.type !== 'pkStart') continue;
    if (start == null || seq < start) start = seq;
  }
  return start;
}

/**
 * 以 pk 事件重算 PK 比分。只算 pkStart 之後、seq 為整數、大於 resetRev、未作廢、scored === true 的 pk。
 * 沒有 pkStart 時回 {0,0,0}，確認時不因殘留的 pk 事件而 PENALTY_MISMATCH。
 * shots 含沒進與已作廢的 pk（仍須在 pkStart 之後），用來判斷「有沒有 pk 事件」。pkStart 本身不算。
 * side 只認 home／away。pkStart 之前的 pk 連 shots 都不計。
 */
export function derivedPenaltyOf(
  events: TlEvent[],
  voidedSeqs: Set<number>,
  resetRev: number
): { home: number; away: number; shots: number } {
  const start = earliestPkStartSeq(events, resetRev);
  if (start == null) return { home: 0, away: 0, shots: 0 };
  let home = 0;
  let away = 0;
  let shots = 0;
  for (const ev of events) {
    if (ev == null || typeof ev !== 'object') continue;
    const seq = ev.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || !(seq > start)) continue;
    if (ev.type !== 'pk') continue;
    shots += 1;
    if (voidedSeqs.has(seq) || ev.scored !== true) continue;
    if (ev.side === 'home') home += 1;
    else if (ev.side === 'away') away += 1;
  }
  return { home, away, shots };
}

/**
 * pkStart 之後是否有一般 goal。seq 必須是整數且大於最早的 pkStart（該 pkStart 本身已大於 resetRev）。
 * 已作廢的 goal 也算。用來讓 confirmMatchResult 一律回 SCORE_MISMATCH，不是只在數字對不上時才拒。
 */
export function goalAfterPkStart(events: TlEvent[], resetRev: number): boolean {
  const start = earliestPkStartSeq(events, resetRev);
  if (start == null) return false;
  for (const ev of events) {
    if (ev == null || typeof ev !== 'object') continue;
    const seq = ev.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || !(seq > start)) continue;
    if (ev.type === 'goal') return true;
  }
  return false;
}

/** null 與 {0,0} 不同。形狀不對視同沒有 PK 比分，讓對帳與事件重算不符。 */
function storedPenalty(raw: unknown): { home: number; away: number } | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.home !== 'number' || !Number.isInteger(o.home)) return null;
  if (typeof o.away !== 'number' || !Number.isInteger(o.away)) return null;
  return { home: o.home, away: o.away };
}

/** 場次所屬組別。沒有組別時用缺值預設，與舊賽事 3／1／0、棄權 2:0 相同。 */
async function divisionRecord(deps: CpDeps, tx: Transaction, cid: string, snap: DocumentSnapshot): Promise<Record<string, unknown>> {
  const divisionId = snap.get('divisionId');
  if (typeof divisionId !== 'string' || divisionId.length === 0) return {};
  const dv = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/divisions/${divisionId}`));
  return dv.exists ? (dv.data() ?? {}) as Record<string, unknown> : {};
}

export async function recordResult(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'mtId', 'expectedRev', 'score', 'confirm']);
  const { cid, mtId, expectedRev } = matchIds(input);
  const score = scoreInput(input.score);
  if (typeof input.confirm !== 'boolean') throw bad('FIELD_TYPE', { field: 'confirm' });
  const confirm = input.confirm;
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    assertResultEditable(comp);
    const m = await loadMatch(deps, tx, cid, mtId, expectedRev);
    if (!['scheduled', 'finished'].includes(m.status)) throw pre('MATCH_STATE', { status: m.status });
    if (m.kickoffMs == null) throw pre('MATCH_NOT_SCHEDULED');
    if (deps.now().getTime() < m.kickoffMs) throw pre('MATCH_NOT_STARTED');
    const points = resolveRules(await divisionRecord(deps, tx, cid, m.snap)).points;
    const status = confirm ? 'confirmed' : 'finished';
    const now = FieldValue.serverTimestamp();
    // 已有可 toMillis 的戳記才刷新。第一次登錄不寫。狀態仍只接受 scheduled／finished。
    const refreshCorrected = correctedAtMs(m.snap.get('scoreCorrectedAt')) != null;
    tx.update(m.ref, {
      score, status, lock: { locked: true },
      ...(m.snap.get('finishedAt') ? {} : { finishedAt: now }),
      confirmedAt: confirm ? now : null,
      result: resultOf(score, points), resultSource: 'host', walkoverSide: null,
      clockBase: { ...CLEAR_CLOCK, period: 'ft' },
      // 顧問 §3.335 P2：PK 只在正規比分平手時才有意義。主辦改成非平手就清掉 PK 比分（摘要的 p 由觸發器跟著拿掉）；
      // 平手則保留裁判記的 PK 比分。重置與棄權另有清除。
      ...(score.home !== score.away ? { penaltyScore: null } : {}),
      ...(refreshCorrected ? { scoreCorrectedAt: now } : {}),
      rev: m.rev + 1, updatedAt: now
    });
    // 主辦登錄後一律清掉目前記分者：否則記分者可在 finishedAt 後 3 分鐘內 undoFinish 撤回主辦的結果，
    // 且 resultSource=host 會讓之後的進球免對帳（Grok 審查 P1-2、Opus 終審 P3-1）。要再記分須重新接手。
    tx.delete(m.ref.collection('control').doc('scorer'));
    writeAudit(deps, tx, cid, caller, 'recordResult', { mtId, score, confirm });
    return { mtId, status, rev: m.rev + 1 };
  });
}

export async function confirmMatchResult(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'mtId', 'expectedRev']);
  const { cid, mtId, expectedRev } = matchIds(input);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    assertResultEditable(comp);
    const m = await loadMatch(deps, tx, cid, mtId, expectedRev);
    if (m.status !== 'finished') throw pre('MATCH_STATE', { status: m.status });
    // §6.3-7 比分對帳：事件明細是真相。主辦親自登錄（resultSource=host）時以主辦裁定為準。
    // 讀全部事件才能對帳；超過上限時失敗關閉，不用截斷的明細確認（Grok 審查 P2-2）
    const tl = await readQuery(deps, tx, m.ref.collection('timeline').where('seq', '>', m.resetRev).limit(TIMELINE_MAX + 1));
    // 作廢標記的 seq 是 void 事件的序號；重置線以下的標記不再參與對帳（K1 Opus P3-2，顧問 §3.322：K1b 前修）
    const vd = await readQuery(deps, tx, m.ref.collection('voids').where('seq', '>', m.resetRev).limit(TIMELINE_MAX + 1));
    if (tl.size > TIMELINE_MAX || vd.size > TIMELINE_MAX) throw pre('TIMELINE_TOO_LONG');
    const voided = new Set<number>(vd.docs.map(d => Number(d.id)).filter(n => Number.isInteger(n)));
    const events = tl.docs.map(d => d.data());
    const derived = derivedScoreOf(events, voided, m.resetRev);
    const score = { home: Number(m.snap.get('score.home')) || 0, away: Number(m.snap.get('score.away')) || 0 };
    // resultSource=host：比分、PK、以及下面的 pkStart 後 goal，都依主辦裁定略過。
    const hostRuling = m.snap.get('resultSource') === 'host';
    if (!hostRuling && derived.goals > 0
      && (derived.home !== score.home || derived.away !== score.away)) {
      throw pre('SCORE_MISMATCH', { home: derived.home, away: derived.away });
    }
    // 找到 pkStart 後，seq 更大的一般 goal 一律 SCORE_MISMATCH。
    // 「一律」指這種 goal 出現就拒：含已作廢的 goal，也含場上比分與事件重算相同的情況。
    // 不是只在數字對不上時才拒。主辦裁定（resultSource=host）與上面的比分對帳一樣略過。
    if (!hostRuling && goalAfterPkStart(events, m.resetRev)) {
      throw pre('SCORE_MISMATCH', { home: derived.home, away: derived.away });
    }
    // PK 對帳與正規比分同一批 timeline／voids。只計最早 pkStart 之後的 pk。沒有 pkStart 就不比。
    const derivedPk = derivedPenaltyOf(events, voided, m.resetRev);
    if (!hostRuling && derivedPk.shots > 0) {
      const stored = storedPenalty(m.snap.get('penaltyScore'));
      if (stored == null || stored.home !== derivedPk.home || stored.away !== derivedPk.away) {
        throw pre('PENALTY_MISMATCH', { home: derivedPk.home, away: derivedPk.away });
      }
    }
    const points = resolveRules(await divisionRecord(deps, tx, cid, m.snap)).points;
    const now = FieldValue.serverTimestamp();
    tx.update(m.ref, {
      status: 'confirmed', confirmedAt: now, lock: { locked: true }, result: resultOf(score, points),
      rev: m.rev + 1, updatedAt: now
    });
    writeAudit(deps, tx, cid, caller, 'confirmMatchResult', { mtId, score, derivedGoals: derived.goals });
    return { mtId, status: 'confirmed', rev: m.rev + 1 };
  });
}

export async function setWalkover(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'mtId', 'expectedRev', 'forfeitSide', 'reason']);
  const { cid, mtId, expectedRev } = matchIds(input);
  const forfeitSide = requireEnum(input.forfeitSide, ['home', 'away'] as const, 'forfeitSide');
  const reason = statusReasonOf(input.reason);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    assertResultEditable(comp);
    const m = await loadMatch(deps, tx, cid, mtId, expectedRev);
    if (!['scheduled', 'postponed', 'finished'].includes(m.status)) throw pre('MATCH_STATE', { status: m.status });
    const wo = resolveRules(await divisionRecord(deps, tx, cid, m.snap)).walkover;
    const winSide = forfeitSide === 'home' ? 'away' : 'home';
    const score = { home: winSide === 'home' ? wo.scoreFor : wo.scoreAgainst, away: winSide === 'away' ? wo.scoreFor : wo.scoreAgainst };
    const now = FieldValue.serverTimestamp();
    tx.update(m.ref, {
      status: 'walkover', walkoverSide: forfeitSide, score, penaltyScore: null, lock: { locked: true },
      ...(m.snap.get('finishedAt') ? {} : { finishedAt: now }),
      confirmedAt: now, resultSource: 'host',
      result: {
        winner: winSide, method: 'walkover',
        homePoints: winSide === 'home' ? wo.awardPoints : wo.penaltyPoints,
        awayPoints: winSide === 'away' ? wo.awardPoints : wo.penaltyPoints
      },
      clockBase: CLEAR_CLOCK, rev: m.rev + 1, updatedAt: now
    });
    // 原因只進稽核（可能含個資），公開場次只放棄權方
    tx.delete(m.ref.collection('control').doc('scorer'));
    writeAudit(deps, tx, cid, caller, 'setWalkover', { mtId, forfeitSide, reason });
    return { mtId, status: 'walkover', rev: m.rev + 1 };
  });
}

export async function resetMatch(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'mtId', 'expectedRev', 'reason']);
  const { cid, mtId, expectedRev } = matchIds(input);
  const reason = statusReasonOf(input.reason);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    if (!['published', 'postponed'].includes(comp.status)) throw pre('STATUS_NOT_EDITABLE', { status: comp.status });
    const m = await loadMatch(deps, tx, cid, mtId, expectedRev);
    if (!canResetMatch(m.status)) throw pre('NOTHING_TO_RESET');
    const rev = m.rev + 1;
    // 取消場回到未賽：有開賽時間為 scheduled，否則 postponed，並清掉取消欄位。
    const status = statusAfterReset(m.kickoffMs);
    const now = FieldValue.serverTimestamp();
    // 確認或棄權被重置才蓋 scoreCorrectedAt。尚未確認的場次不新增，也不刪已有戳記。
    const stampCorrected = m.status === 'confirmed' || m.status === 'walkover';
    tx.update(m.ref, {
      status, score: { home: 0, away: 0 }, penaltyScore: null, lock: { locked: false },
      finishedAt: null, confirmedAt: null, result: null, walkoverSide: null, resultSource: null,
      cancelReason: FieldValue.delete(), cancelledAt: FieldValue.delete(),
      clockBase: CLEAR_CLOCK, rev, resetRev: rev,
      ...(stampCorrected ? { scoreCorrectedAt: now } : {}),
      updatedAt: now
    });
    // 重置後要重新接手（§6.3-2）
    tx.delete(m.ref.collection('control').doc('scorer'));
    writeAudit(deps, tx, cid, caller, 'resetMatch', { mtId, from: m.status, reason });
    return { mtId, status, rev };
  });
}

export async function cancelMatch(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'mtId', 'expectedRev', 'reason']);
  const { cid, mtId, expectedRev } = matchIds(input);
  const reason = hostReasonOf(input.reason, gate.bannedWords);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    // Flash 初審 P2：與登錄比分、重置同一套賽事狀態檢查（只有 published 可改場次結果）
    assertResultEditable(comp);
    const m = await loadMatch(deps, tx, cid, mtId, expectedRev);
    if (!canCancelMatch(m.status)) throw pre('MATCH_STATE', { status: m.status });
    const rev = m.rev + 1;
    const now = FieldValue.serverTimestamp();
    tx.update(m.ref, {
      // 取消待確認場次時解除鎖定，避免記分端仍以為比分鎖住（比分保留供稽核，不計分）
      status: 'cancelled', cancelReason: reason, cancelledAt: now, lock: { locked: false }, rev, updatedAt: now
    });
    // 系統公告不占手動 20 則。賽事根文件這筆交易已經讀過，不再讀。
    const notice = appendSystemNotice(tx, {
      ref: deps.db.doc(`competitions/${cid}`),
      notices: comp.notices,
      at: Timestamp.fromMillis(deps.now().getTime()),
      by: actorHash(cid, caller.uid)
    }, {
      kind: 'system',
      text: cancelNoticeText({
        kickoffMs: m.kickoffMs,
        homeName: sideName(m.snap.get('home'), '主隊'),
        awayName: sideName(m.snap.get('away'), '客隊'),
        reason
      })
    });
    writeAudit(deps, tx, cid, caller, 'cancelMatch', { mtId, from: m.status, reason });
    return { mtId, status: 'cancelled' as const, rev, noticeId: notice.id };
  });
}

function sideName(raw: unknown, fallback: string): string {
  if (raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string') {
    const name = (raw as { name: string }).name.trim();
    if (name) return name;
  }
  return fallback;
}

export async function endCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'reason']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const reason = hostReasonOf(input.reason, gate.bannedWords);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    if (comp.status !== 'published') throw pre('STATUS_NOT_EDITABLE', { status: comp.status });
    if (comp.endedAt) throw pre('COMPETITION_ENDED');
    // 沒排賽程也能手動結束（站長 11-23：只用來報名、不在系統排賽程的賽事）；取代原本「至少一組有賽程」的 SCHEDULE_REQUIRED。
    // 未確認場次留在原狀態，不在這裡改、也不計分。
    const now = FieldValue.serverTimestamp();
    tx.update(deps.db.doc(`competitions/${cid}`), {
      endedAt: now, endedBy: 'host', endReason: reason,
      stateVersion: FieldValue.increment(1), updatedAt: now
    });
    writeAudit(deps, tx, cid, caller, 'endCompetition', { reason });
    return { cid, endedBy: 'host' as const };
  });
}

export async function restoreCompetition(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'reason']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const reason = hostReasonOf(input.reason, gate.bannedWords);
  return deps.db.runTransaction(async tx => {
    const comp = await loadComp(deps, tx, cid);
    assertCompVisible(comp, gate);
    if (!isAdmin(caller)) throw deny('NOT_ADMIN');
    if (comp.deletingAt) throw pre('COMPETITION_DELETING');
    if (!comp.endedAt) throw pre('COMPETITION_NOT_ENDED');
    const endedBy = comp.endedBy;
    if (endedBy !== 'host' && endedBy !== 'auto') {
      throw pre('RESTORE_NOT_ALLOWED', { endedBy: typeof endedBy === 'string' ? endedBy : '' });
    }
    const now = FieldValue.serverTimestamp();
    tx.update(deps.db.doc(`competitions/${cid}`), {
      endedAt: null, endedBy: null, endReason: null,
      stateVersion: FieldValue.increment(1), updatedAt: now
    });
    writeAudit(deps, tx, cid, caller, 'restoreCompetition', { reason, from: endedBy });
    return { cid, restored: true as const };
  });
}

export async function recalcStandings(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  // 權限在交易外先判（全量重算本身各組各自交易）
  await deps.db.runTransaction(async tx => {
    await hostComp(deps, tx, caller, gate, cid);
    const dv = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/divisions/${dvId}`));
    if (!dv.exists) throw new CpError('not-found', 'DIVISION_NOT_FOUND');
    if (!dv.get('schedule')) throw pre('SCHEDULE_REQUIRED');
  });
  const written = await recomputeDivisionStandings(deps, cid, dvId);
  await deps.db.runTransaction(async tx => {
    writeAudit(deps, tx, cid, caller, 'recalcStandings', { dvId, standings: written });
  });
  return { dvId, standings: written };
}

/** 裁定原因：既有單行清理與禁用詞，1～200 字（空字串當缺欄位）。 */
const TIE_REASON_MAX = 200;
const GROUP_RE = /^[A-Za-z0-9]{1,8}$/;

function tieReasonOf(v: unknown, bannedWords: readonly string[]): string {
  const reason = requireLine(v, 'reason', 1, TIE_REASON_MAX);
  if (findBannedWord(reason, bannedWords)) throw bad('BANNED_WORD', { field: 'reason' });
  return reason;
}

function groupIdOf(v: unknown): string {
  if (v == null || v === '') return 'A';
  if (typeof v !== 'string' || !GROUP_RE.test(v)) throw bad('FIELD_FORMAT', { field: 'groupId' });
  return v;
}

function idListOf(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > SCHEDULE_LIMITS.teamsMax) {
    throw bad('FIELD_RANGE', { field, min: 2, max: SCHEDULE_LIMITS.teamsMax });
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const id = requireId(x, ENID_RE, field);
    if (seen.has(id)) throw bad('FIELD_RANGE', { field, min: 2, max: SCHEDULE_LIMITS.teamsMax });
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

interface TieGroup {
  ref: DocumentReference;
  version: number;
  prev: Partial<StandingDoc> | null;
  teamIds: string[];
  matches: MatchLike[];
  /** 已讀組別解析出的計分輸入。不再讀一次。 */
  inputs: ReturnType<typeof engineInputsOf>;
  names: Record<string, string>;
  /** 組別文件已讀過的名稱。重寫積分榜時帶上，避免整份 set 把 divisionName 清掉。 */
  divisionName: string;
}

/** 交易內讀組別、積分榜、該組場次。expectedVersion 有帶且不符就 REV_CONFLICT（此時還沒讀場次）。 */
async function loadTieGroup(
  deps: CpDeps,
  tx: Transaction,
  cid: string,
  dvId: string,
  groupId: string,
  expectedVersion: number | null
): Promise<TieGroup> {
  const dv = await readDoc(deps, tx, deps.db.doc(`competitions/${cid}/divisions/${dvId}`));
  if (!dv.exists) throw new CpError('not-found', 'DIVISION_NOT_FOUND');
  const schedule = dv.get('schedule') as { ranking?: unknown; groups?: Array<{ groupId?: unknown; teamIds?: unknown }> } | undefined;
  const groups = Array.isArray(schedule?.groups) ? schedule.groups : [];
  const group = groups.find(g => g?.groupId === groupId);
  const teamIds = Array.isArray(group?.teamIds)
    ? group.teamIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (!schedule || teamIds.length < 2) throw pre('SCHEDULE_REQUIRED');
  const ref = standingRef(deps, cid, dvId, 'group', groupId);
  const prevSnap = await readDoc(deps, tx, ref);
  if (!prevSnap.exists) throw new CpError('not-found', 'STANDING_NOT_FOUND');
  const prev = prevSnap.data() as Partial<StandingDoc>;
  const version = prev.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) throw pre('STANDING_CORRUPT');
  if (expectedVersion != null && version !== expectedVersion) throw pre('REV_CONFLICT', { version });
  const snap = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/matches`)
    .where('divisionId', '==', dvId).where('stageId', '==', 'group').where('groupId', '==', groupId).limit(400));
  const all = snap.docs.map(d => ({ matchId: d.id, ...d.data() }) as MatchLike);
  const names: Record<string, string> = {};
  for (const m of all) {
    for (const side of ['home', 'away'] as const) {
      const t = m[side];
      if (t && typeof t.teamId === 'string' && typeof t.name === 'string') names[t.teamId] = t.name;
    }
  }
  const counted = standingMatchesOf(all);
  const divisionName = typeof dv.get('name') === 'string' ? dv.get('name') as string : '';
  return {
    ref, version, prev, teamIds, matches: counted, names, divisionName,
    inputs: engineInputsOf(resolveRules((dv.data() ?? {}) as Record<string, unknown>))
  };
}

function buildGroupStanding(
  cid: string,
  dvId: string,
  groupId: string,
  bundle: TieGroup,
  override: ManualOverride
): StandingDoc {
  const teamMeta = Object.fromEntries(Object.entries(bundle.names).map(([id, name]) => [id, { teamId: id, name }]));
  return buildStanding({
    competitionId: cid, divisionId: dvId, stageId: 'group', groupId,
    teamIds: bundle.teamIds, matches: bundle.matches,
    rule: bundle.inputs.rule,
    opts: { ...bundle.inputs.opts, teamMeta },
    prev: { version: bundle.version, manualOverride: override, rows: bundle.prev?.rows }
  });
}

function commitGroupStanding(tx: Transaction, bundle: TieGroup, doc: StandingDoc, computedBy: string): void {
  const now = FieldValue.serverTimestamp();
  tx.set(bundle.ref, { ...doc, divisionName: bundle.divisionName, computedBy, updatedAt: now });
}

function sameChampions(prev: unknown, next: readonly { dv: string; n: string }[]): boolean {
  if (!Array.isArray(prev) || prev.length !== next.length) return false;
  return next.every((item, i) => {
    const row = prev[i];
    if (!row || typeof row !== 'object') return false;
    const o = row as Record<string, unknown>;
    return o.dv === item.dv && o.n === item.n;
  });
}

/**
 * 末場確認（endedBy === 'confirm'）之後，裁定或撤銷在同一筆交易重算冠軍名。
 * 組別集合的讀法與 syncEnded 相同，各組積分榜走 loadChampions（與確認結束共用 championsFromStandings）。
 * 本組用剛算好的列，因為交易讀不到自己還沒寫出去的積分榜。
 * 其他 endedBy 不讀、不寫。名單與目前相同就不寫，不改賽事文件的其他欄位。
 */
async function refreshConfirmChampions(
  deps: CpDeps,
  tx: Transaction,
  cid: string,
  comp: CompDoc,
  fresh: { divisionId: string; groupId: string; rows: StandingRow[] }
): Promise<void> {
  if (comp.endedBy !== 'confirm') return;
  const divs = await readQuery(deps, tx, deps.db.collection(`competitions/${cid}/divisions`).limit(LIMITS.divisionsMax));
  const champions = await loadChampions(deps, tx, cid, divs.docs, {
    divisionId: fresh.divisionId,
    groupId: fresh.groupId,
    rows: fresh.rows
  });
  if (sameChampions(comp.champions, champions)) return;
  tx.update(deps.db.doc(`competitions/${cid}`), { champions });
}

function rankBrief(rows: StandingRow[]) {
  return rows.map(r => ({
    teamId: r.teamId,
    rank: typeof r.rank === 'number' ? r.rank : null,
    decidedBy: r.decidedBy === 'host' || r.decidedBy === 'drawLots' ? r.decidedBy : null
  }));
}

export async function resolveTie(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId', 'groupId', 'order', 'method', 'reason', 'expectedVersion']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  const groupId = groupIdOf(input.groupId);
  const order = idListOf(input.order, 'order');
  const method = requireEnum(input.method, ['host', 'drawLots'] as const, 'method');
  const reason = tieReasonOf(input.reason, gate.bannedWords);
  const expectedVersion = int(input.expectedVersion, 'expectedVersion', 0, 1_000_000);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    const bundle = await loadTieGroup(deps, tx, cid, dvId, groupId, expectedVersion);
    // 用目前場次重算後的自然名次判斷，不沿用可能已過期的列。先不套用舊裁定。
    const teamMeta = Object.fromEntries(Object.entries(bundle.names).map(([id, name]) => [id, { teamId: id, name }]));
    const natural = buildStanding({
      competitionId: cid, divisionId: dvId, stageId: 'group', groupId,
      teamIds: bundle.teamIds, matches: bundle.matches,
      rule: bundle.inputs.rule,
      opts: { ...bundle.inputs.opts, teamMeta },
      prev: { version: bundle.version, manualOverride: { enabled: false, by: null, at: null, reason: null } }
    });
    if (!matchesPendingTie(natural.rows, order)) throw pre('TIE_NOT_PENDING');
    // Opus 終審 P2：每份積分榜只存一筆裁定。另一群的裁定仍生效時不覆蓋（否則那群會靜默變回待裁定），
    // 要先 clearTieDecision；同一群重新裁定（成員相同）可以直接覆蓋。
    const existing = tieDecisionView(bundle.prev?.manualOverride, bundle.prev?.rows ?? null);
    if (existing?.active) {
      const same = existing.order.length === order.length && order.every(id => existing.order.includes(id));
      if (!same) throw pre('TIE_DECISION_EXISTS');
    }
    const now = FieldValue.serverTimestamp();
    const override: ManualOverride = {
      enabled: true, by: actorHash(cid, caller.uid), at: now, reason, method, order, decidedAt: now
    };
    const doc = buildGroupStanding(cid, dvId, groupId, bundle, override);
    await refreshConfirmChampions(deps, tx, cid, comp, { divisionId: dvId, groupId, rows: doc.rows });
    commitGroupStanding(tx, bundle, doc, 'cpHost:resolveTie');
    writeAudit(deps, tx, cid, caller, 'resolveTie', { dvId, groupId, method, reason, order, fromVersion: bundle.version });
    return { dvId, groupId, version: doc.version, method, hasUnresolvedTie: doc.hasUnresolvedTie, rows: rankBrief(doc.rows) };
  });
}

export async function clearTieDecision(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId', 'groupId', 'reason', 'expectedVersion']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  const groupId = groupIdOf(input.groupId);
  const reason = tieReasonOf(input.reason, gate.bannedWords);
  const expectedVersion = int(input.expectedVersion, 'expectedVersion', 0, 1_000_000);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    assertNotEnded(deps, comp, caller);
    const bundle = await loadTieGroup(deps, tx, cid, dvId, groupId, expectedVersion);
    if (!tieDecisionView(bundle.prev?.manualOverride)) throw pre('TIE_NO_DECISION');
    const doc = buildGroupStanding(cid, dvId, groupId, bundle, clearedManualOverride());
    await refreshConfirmChampions(deps, tx, cid, comp, { divisionId: dvId, groupId, rows: doc.rows });
    commitGroupStanding(tx, bundle, doc, 'cpHost:clearTieDecision');
    writeAudit(deps, tx, cid, caller, 'clearTieDecision', { dvId, groupId, reason, fromVersion: bundle.version });
    return { dvId, groupId, version: doc.version, hasUnresolvedTie: doc.hasUnresolvedTie, rows: rankBrief(doc.rows) };
  });
}

/**
 * 唯讀。查詢不寫稽核：紀錄只留在裁定與撤銷。
 * 放在 cpHost 是因為要比對主辦身分，而且讀取預算要能用 ReadMeter 斷言。
 * 逐項數字走引擎 explainTie（orderTied／miniTable），不在這裡重算一套排序。
 */
export async function explainTie(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'dvId', 'groupId', 'teamIds']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const dvId = requireId(input.dvId, DVID_RE, 'dvId');
  const groupId = groupIdOf(input.groupId);
  const teamIds = idListOf(input.teamIds, 'teamIds');
  return deps.db.runTransaction(async tx => {
    await hostComp(deps, tx, caller, gate, cid);
    const bundle = await loadTieGroup(deps, tx, cid, dvId, groupId, null);
    if (teamIds.some(id => !bundle.teamIds.includes(id))) throw pre('TEAM_NOT_IN_STANDING');
    const { rule, opts } = bundle.inputs;
    const meta = Object.fromEntries(Object.entries(bundle.names).map(([id, name]) => [id, { teamId: id, name }]));
    const tallyOpts = { ...opts, teamMeta: meta };
    // 列上的積分用全組場次。explainTie 自己再跑同一套 orderTied，這裡不先排名。
    const rows = computeRows(bundle.teamIds, bundle.matches, rule, tallyOpts);
    // Flash 初審 P2：只比較積分相同的隊伍，避免對任意子集重比而得出和全組名次不一致的說明
    const pts = new Set(rows.filter(r => teamIds.includes(r.teamId)).map(r => r.points));
    if (pts.size !== 1) throw pre('TIE_NOT_SAME_POINTS');
    const explained = explainTieCalc(rows, bundle.matches, rule, teamIds, tallyOpts);
    const stored = new Map((bundle.prev?.rows ?? []).map(r => [r.teamId, r]));
    const marks = teamIds.map(teamId => {
      const row = stored.get(teamId);
      const decidedBy = row?.decidedBy === 'host' || row?.decidedBy === 'drawLots' ? row.decidedBy : null;
      return { teamId, rank: typeof row?.rank === 'number' ? row.rank : null, decidedBy };
    });
    return {
      dvId, groupId,
      naturalOrder: explained.naturalOrder,
      steps: explained.steps,
      splits: explained.splits,
      decidedCriterion: explained.decidedCriterion,
      pending: explained.pending,
      pendingCriterion: explained.pendingCriterion,
      matchIds: explained.matchIds,
      decision: tieDecisionView(bundle.prev?.manualOverride ?? null, bundle.prev?.rows ?? null),
      marks
    };
  });
}

// ── 公告（F4）──────────────────────────────────────────────────────────
function writeNotices(tx: Transaction, deps: CpDeps, cid: string, notices: Notice[]): void {
  tx.update(deps.db.doc(`competitions/${cid}`), { notices, updatedAt: FieldValue.serverTimestamp() });
}

export async function postNotice(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'text']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const text = noticeTextOf(input.text, gate.bannedWords);
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    const notice: Notice = {
      id: newId('nt'),
      text,
      kind: 'host',
      at: Timestamp.fromMillis(deps.now().getTime()),
      by: actorHash(cid, caller.uid)
    };
    const notices = pushNotice(noticesOf(comp.notices), notice);
    writeNotices(tx, deps, cid, notices);
    writeAudit(deps, tx, cid, caller, 'postNotice', { noticeId: notice.id, kind: 'host', text });
    return { noticeId: notice.id, kind: 'host' as const };
  });
}

export async function deleteNotice(deps: CpDeps, caller: Caller, gate: GateResult, input: Record<string, unknown>) {
  onlyKeys(input, ['action', 'cid', 'noticeId']);
  const cid = requireId(input.cid, CID_RE, 'cid');
  const noticeId = requireId(input.noticeId, NOTICE_ID_RE, 'noticeId');
  return deps.db.runTransaction(async tx => {
    const comp = await hostComp(deps, tx, caller, gate, cid);
    const { notices, removed } = removeNotice(noticesOf(comp.notices), noticeId);
    writeNotices(tx, deps, cid, notices);
    writeAudit(deps, tx, cid, caller, 'deleteNotice', { noticeId, kind: removed.kind, text: removed.text });
    return { noticeId, kind: removed.kind };
  });
}

export const MATCH_HOST_ACTIONS = {
  generateSchedule,
  clearSchedule,
  rescheduleMatch,
  shiftMatchDay,
  swapMatches,
  recordResult,
  confirmMatchResult,
  setWalkover,
  resetMatch,
  cancelMatch,
  endCompetition,
  restoreCompetition,
  recalcStandings,
  resolveTie,
  clearTieDecision,
  explainTie,
  postNotice,
  deleteNotice
} as const;
