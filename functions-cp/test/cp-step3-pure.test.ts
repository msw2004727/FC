/**
 * 賽事第 3 步純函式。不改 process.env.TZ：日期只靠 utcOffset 換算。
 */
import { describe, expect, it } from 'vitest';
import { RANKING_RULES, drawOrder, taipeiMs } from '../src/engine/index.js';
import {
  CANCELLABLE_STATUSES,
  COUNTED_STATUSES,
  RESOLVED_STATUSES,
  canCancelMatch,
  canResetMatch,
  countedForStanding,
  derivedScoreOf,
  planRoundRobin,
  publicMatchDoc,
  rankingRuleOf,
  resolvedForEnd,
  standingMatchesOf,
  statusAfterReset,
  type PlanDay,
  type PlanInput,
  type PlanResult,
  type PlannedMatch
} from '../src/cp/schedule-plan.js';
import { derivedPenaltyOf } from '../src/cp/match-host.js';
import { sameEntry, summaryEntryOf, summaryShardIdOf, type SummaryEntry } from '../src/cp/summary.js';

const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ enId: `en${i + 1}`, name: `隊${i + 1}` }));

const day = (date: string, start = '09:00', end = '18:00'): PlanDay => ({ date, start, end });

function base(over: Record<string, unknown> = {}): PlanInput {
  return {
    dvId: 'dv1',
    teams: teams(4),
    legs: 1,
    matchMinutes: 30,
    bufferMinutes: 10,
    minRestMinutes: 0,
    days: [day('2026-12-05'), day('2026-12-06')],
    venues: [{ venueIdx: 0, name: 'A場' }, { venueIdx: 1, name: 'B場' }],
    playersOnField: 8,
    seed: 1,
    ...over
  } as PlanInput;
}

const plan = (over: Record<string, unknown> = {}) => planRoundRobin(base(over));

function expectRange(over: Record<string, unknown>, field: string) {
  let caught: unknown;
  try { planRoundRobin(base(over)); } catch (e) { caught = e; }
  expect(caught, field).toBeInstanceOf(RangeError);
  expect((caught as Error).message).toBe(field);
}

function assertSchedule(result: PlanResult, spec: { matchMinutes: number; bufferMinutes: number; minRestMinutes: number; days: PlanDay[] }) {
  const play = spec.matchMinutes * 60_000;
  const span = (spec.matchMinutes + spec.bufferMinutes) * 60_000;
  const rest = spec.minRestMinutes * 60_000;
  expect(result.matches.map(m => m.matchNo)).toEqual(result.matches.map((_, i) => i + 1));
  expect(result.matchCount).toBe(result.matches.length);
  expect(result.unplacedCount).toBe(result.matches.filter(m => m.kickoffMs == null).length);
  expect(new Set(result.unplacedReasons).size).toBe(result.unplacedReasons.length);

  const placed = result.matches.filter((m): m is PlannedMatch & { kickoffMs: number } => m.kickoffMs != null);
  const byVenue = new Map<number, Array<PlannedMatch & { kickoffMs: number }>>();
  const byTeam = new Map<string, Array<PlannedMatch & { kickoffMs: number }>>();
  for (const m of placed) {
    expect(m.venueIdx).not.toBeNull();
    expect(m.venueName).not.toBeNull();
    expect(m.home.teamId).not.toBe(m.away.teamId);
    expect(Object.keys(m.home).sort()).toEqual(['name', 'teamId']);
    expect(Object.keys(m.away).sort()).toEqual(['name', 'teamId']);
    const window = spec.days.find(d => {
      const start = taipeiMs(d.date, d.start, '+08:00');
      const end = taipeiMs(d.date, d.end, '+08:00');
      return start != null && end != null && m.kickoffMs >= start && m.kickoffMs + play <= end
        && (m.kickoffMs - start) % (5 * 60_000) === 0;
    });
    expect(window, `${m.matchNo} 落在可用時段`).toBeTruthy();
    const vlist = byVenue.get(m.venueIdx as number) ?? [];
    vlist.push(m);
    byVenue.set(m.venueIdx as number, vlist);
    for (const id of [m.home.teamId, m.away.teamId]) {
      const list = byTeam.get(id) ?? [];
      list.push(m);
      byTeam.set(id, list);
    }
  }
  for (const m of result.matches) {
    if (m.kickoffMs == null) {
      expect(m.venueIdx).toBeNull();
      expect(m.venueName).toBeNull();
    }
  }
  for (const list of byVenue.values()) {
    list.sort((a, b) => a.kickoffMs - b.kickoffMs);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].kickoffMs).toBeGreaterThanOrEqual(list[i - 1].kickoffMs + span);
    }
  }
  for (const list of byTeam.values()) {
    list.sort((a, b) => a.kickoffMs - b.kickoffMs);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].kickoffMs).toBeGreaterThanOrEqual(list[i - 1].kickoffMs + span + rest);
    }
  }
}

describe('planRoundRobin', () => {
  it('4 隊單循環：6 場、每隊 3 場、無自我對戰、每對只碰一次', () => {
    const list = teams(4);
    const before = list.map(t => t.enId);
    const result = plan({ teams: list, seed: 7 });
    expect(list.map(t => t.enId)).toEqual(before);
    expect(result.matchCount).toBe(6);
    expect(result.unplacedCount).toBe(0);
    expect(result.unplacedReasons).toEqual([]);
    expect(result.daysUsed).toEqual(['2026-12-05']);
    expect(result.groups).toEqual([{
      groupId: 'A',
      teamIds: drawOrder(list, 7).map(t => t.enId)
    }]);
    const games = new Map<string, number>();
    const pairs = new Set<string>();
    for (const m of result.matches) {
      expect(m.home.teamId).not.toBe(m.away.teamId);
      games.set(m.home.teamId, (games.get(m.home.teamId) ?? 0) + 1);
      games.set(m.away.teamId, (games.get(m.away.teamId) ?? 0) + 1);
      const key = [m.home.teamId, m.away.teamId].sort().join('|');
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
    expect(pairs.size).toBe(6);
    expect([...games.values()]).toEqual([3, 3, 3, 3]);
    const start = Date.parse('2026-12-05T09:00:00+08:00');
    const kicks = result.matches.map(m => m.kickoffMs).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(kicks).toEqual([0, 0, 1, 1, 2, 2].map(i => start + i * 40 * 60_000));
    assertSchedule(result, { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 0, days: [day('2026-12-05'), day('2026-12-06')] });
  });

  it('4 隊雙循環 12 場、主客互換', () => {
    const result = plan({ legs: 2, seed: 3 });
    expect(result.matchCount).toBe(12);
    expect(result.unplacedCount).toBe(0);
    const directed = new Map<string, number>();
    for (const m of result.matches) {
      const key = `${m.home.teamId}>${m.away.teamId}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
    const ids = result.groups[0].teamIds;
    expect(ids).toHaveLength(4);
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        expect(directed.get(`${ids[i]}>${ids[j]}`)).toBe(1);
      }
    }
    const games = new Map<string, number>();
    for (const m of result.matches) {
      games.set(m.home.teamId, (games.get(m.home.teamId) ?? 0) + 1);
      games.set(m.away.teamId, (games.get(m.away.teamId) ?? 0) + 1);
    }
    expect([...games.values()].every(n => n === 6)).toBe(true);
  });

  it('16 隊單循環、2 場地、09:00–18:00、30+10：一天排不完；給兩天會用到第二天', () => {
    const days = [day('2026-12-05'), day('2026-12-06')];
    const spec = {
      teams: teams(16),
      legs: 1 as const,
      matchMinutes: 30,
      bufferMinutes: 10,
      minRestMinutes: 0,
      venues: [{ venueIdx: 0, name: 'A場' }, { venueIdx: 1, name: 'B場' }],
      seed: 4
    };
    const one = plan({ ...spec, days: [days[0]] });
    const two = plan({ ...spec, days });
    expect(one.matchCount).toBe(120);
    expect(two.matchCount).toBe(120);
    expect(one.unplacedCount).toBeGreaterThan(0);
    expect(two.daysUsed).toEqual(['2026-12-05', '2026-12-06']);
    // 16 隊單循環 120 場。30+10 分、兩場地、09:00–18:00 一天約 26 場，兩天排不完。
    expect(two.unplacedCount).toBeGreaterThan(0);
    expect(two.unplacedCount).toBeLessThan(one.unplacedCount);
    const played = new Map<string, number>();
    for (const m of two.matches) {
      expect(m.home.teamId).not.toBe(m.away.teamId);
      played.set(m.home.teamId, (played.get(m.home.teamId) ?? 0) + 1);
      played.set(m.away.teamId, (played.get(m.away.teamId) ?? 0) + 1);
    }
    expect([...played.values()].every(n => n === 15)).toBe(true);
    assertSchedule(one, { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 0, days: [days[0]] });
    assertSchedule(two, { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 0, days });
    const placedMax = Math.max(...two.matches.filter(m => m.kickoffMs != null).map(m => m.matchNo));
    const unplaced = two.matches.filter(m => m.kickoffMs == null);
    expect(unplaced.length).toBe(two.unplacedCount);
    expect(Math.min(...unplaced.map(m => m.matchNo))).toBe(placedMax + 1);
  });

  it('一天排不下、兩天排完（跨到第二天且 unplacedCount 0）', () => {
    const days = [day('2026-12-05'), day('2026-12-06')];
    const spec = {
      teams: teams(8),
      matchMinutes: 30,
      bufferMinutes: 10,
      minRestMinutes: 0,
      venues: [{ venueIdx: 0, name: 'A場' }, { venueIdx: 1, name: 'B場' }],
      seed: 1
    };
    const one = plan({ ...spec, days: [days[0]] });
    const two = plan({ ...spec, days });
    expect(one.matchCount).toBe(28);
    expect(one.unplacedCount).toBeGreaterThan(0);
    expect(two.unplacedCount).toBe(0);
    expect(two.unplacedReasons).toEqual([]);
    expect(two.daysUsed).toEqual(['2026-12-05', '2026-12-06']);
    assertSchedule(two, { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 0, days });
  });

  it('同一隊同時段不打兩場、同場地不重疊、minRestMinutes 生效', () => {
    const days = [day('2026-12-05', '08:00', '22:00'), day('2026-12-06', '08:00', '22:00')];
    const tight = plan({ minRestMinutes: 0, matchMinutes: 30, bufferMinutes: 10, days, venues: [{ venueIdx: 1, name: '主場' }] });
    const rested = plan({ minRestMinutes: 90, matchMinutes: 30, bufferMinutes: 10, days, venues: [{ venueIdx: 1, name: '主場' }] });
    expect(tight.unplacedCount).toBe(0);
    expect(rested.unplacedCount).toBe(0);
    assertSchedule(tight, { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 0, days });
    assertSchedule(rested, { matchMinutes: 30, bufferMinutes: 10, minRestMinutes: 90, days });

    const minGap = (result: PlanResult) => {
      const byTeam = new Map<string, number[]>();
      for (const m of result.matches) {
        if (m.kickoffMs == null) continue;
        for (const id of [m.home.teamId, m.away.teamId]) {
          const list = byTeam.get(id) ?? [];
          list.push(m.kickoffMs);
          byTeam.set(id, list);
        }
      }
      let gap = Infinity;
      for (const list of byTeam.values()) {
        list.sort((a, b) => a - b);
        for (let i = 1; i < list.length; i++) gap = Math.min(gap, list[i] - list[i - 1]);
      }
      return gap;
    };
    expect(minGap(tight)).toBeLessThan(minGap(rested));
    expect(minGap(rested)).toBeGreaterThanOrEqual((30 + 10 + 90) * 60_000);
  });

  it('9 人制排得進場（場地不是 5v5）', () => {
    const result = plan({ playersOnField: 9, venues: [{ venueIdx: 3, name: '大場' }] });
    expect(result.unplacedCount).toBe(0);
    expect(result.matches.every(m => m.venueIdx === 3 && m.venueName === '大場')).toBe(true);
  });

  it('第一天排不下的場次改排第二天，原因不留', () => {
    const result = plan({
      days: [day('2026-12-05', '09:00', '09:20'), day('2026-12-06')],
      venues: [{ venueIdx: 0, name: 'A場' }]
    });
    expect(result.daysUsed).toEqual(['2026-12-06']);
    expect(result.unplacedCount).toBe(0);
    expect(result.unplacedReasons).toEqual([]);
  });

  it('整段都排不下：未排場次編號接在後面，原因不重複', () => {
    const result = plan({
      matchMinutes: 180,
      bufferMinutes: 0,
      days: [day('2026-12-05', '09:00', '10:00')],
      venues: [{ venueIdx: 0, name: 'A場' }]
    });
    expect(result.unplacedCount).toBe(6);
    expect(result.daysUsed).toEqual([]);
    expect(result.matches.map(m => m.matchNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.matches.every(m => m.kickoffMs == null)).toBe(true);
    expect(result.unplacedReasons).toEqual([
      '當天排不下（場地或時間不足）。可以增加場地、延後結束時間，或降低休息下限。'
    ]);
  });

  it('同 seed 兩次 deep-equal；不同 seed 抽籤順序不同', () => {
    const a = plan({ seed: 1 });
    const b = plan({ seed: 1 });
    expect(a).toEqual(b);
    const c = plan({ seed: 2 });
    expect(c).not.toEqual(a);
    expect(c.groups[0].teamIds).not.toEqual(a.groups[0].teamIds);
  });

  it('參數越界丟 RangeError，訊息是欄位名', () => {
    expectRange({ teams: teams(1) }, 'teams');
    expectRange({ teams: teams(17) }, 'teams');
    expectRange({ legs: 0 }, 'legs');
    expectRange({ legs: 3 }, 'legs');
    expectRange({ matchMinutes: 4 }, 'matchMinutes');
    expectRange({ matchMinutes: 181 }, 'matchMinutes');
    expectRange({ matchMinutes: 30.5 }, 'matchMinutes');
    expectRange({ bufferMinutes: -1 }, 'bufferMinutes');
    expectRange({ bufferMinutes: 61 }, 'bufferMinutes');
    expectRange({ bufferMinutes: 10.5 }, 'bufferMinutes');
    expectRange({ minRestMinutes: -1 }, 'minRestMinutes');
    expectRange({ minRestMinutes: 241 }, 'minRestMinutes');
    expectRange({ days: [] }, 'days');
    expectRange({
      days: Array.from({ length: 15 }, (_, i) => day(`2026-11-${String(i + 1).padStart(2, '0')}`))
    }, 'days');
    expectRange({ days: [day('2026-12-06'), day('2026-12-05')] }, 'days');
    expectRange({ days: [day('2026-12-05'), day('2026-12-05', '19:00', '21:00')] }, 'days');
    expectRange({ days: [day('2026-12-05', '18:00', '09:00')] }, 'days');
    expectRange({ days: [day('2026-12-05', '09:00', '09:00')] }, 'days');
    expectRange({ days: [day('2026-12-05', '9:00', '18:00')] }, 'days');
    expectRange({ days: [day('2026-02-31')] }, 'days');
    expectRange({ venues: [] }, 'venues');
    expectRange({
      venues: Array.from({ length: 11 }, (_, i) => ({ venueIdx: i, name: `場${i}` }))
    }, 'venues');
    expectRange({ venues: [{ venueIdx: 1, name: 'A' }, { venueIdx: 1, name: 'B' }] }, 'venues');
    expectRange({ seed: 1.5 }, 'seed');
    expectRange({ utcOffset: 'Asia/Taipei' }, 'utcOffset');
    const edge = plan({
      teams: teams(2),
      matchMinutes: 5,
      bufferMinutes: 0,
      minRestMinutes: 240,
      days: [day('2026-12-01', '08:00', '09:00')],
      venues: [{ venueIdx: 0, name: 'A' }]
    });
    expect(edge.matchCount).toBe(1);
    expect(edge.unplacedCount).toBe(0);
    const full = plan({
      days: Array.from({ length: 14 }, (_, i) => day(`2026-12-${String(i + 1).padStart(2, '0')}`, '09:00', '12:00'))
    });
    expect(full.unplacedCount).toBe(0);
  });
});

const PUBLIC_KEYS = [
  'matchId', 'divisionId', 'stageId', 'groupId', 'round', 'matchNo', 'label', 'matchKey',
  'kickoffMs', 'venueIdx', 'venueName', 'home', 'away', 'teamIds', 'score', 'penaltyScore',
  'status', 'rev', 'resetRev', 'lock', 'clockBase', 'finishedAt', 'confirmedAt',
  'walkoverSide', 'result', 'resultSource'
];

function allKeys(value: unknown, out: string[] = []): string[] {
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    if (child && typeof child === 'object') allKeys(child, out);
  }
  return out;
}

describe('publicMatchDoc', () => {
  it('鍵集合與 §1.2 相同，不含 uid 類欄位', () => {
    const planned = plan({ seed: 5 }).matches[0];
    const doc = publicMatchDoc(planned, { mtId: 'mt_abc123abc123abc123ab', dvId: 'dv9' });
    expect(Object.keys(doc)).toEqual(PUBLIC_KEYS);
    expect(Object.keys(doc).sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(doc).toEqual({
      matchId: 'mt_abc123abc123abc123ab',
      divisionId: 'dv9',
      stageId: 'group',
      groupId: 'A',
      round: planned.round,
      matchNo: planned.matchNo,
      label: null,
      matchKey: null,
      kickoffMs: planned.kickoffMs,
      venueIdx: planned.venueIdx,
      venueName: planned.venueName,
      home: { teamId: planned.home.teamId, name: planned.home.name },
      away: { teamId: planned.away.teamId, name: planned.away.name },
      teamIds: [planned.home.teamId, planned.away.teamId],
      score: { home: 0, away: 0 },
      penaltyScore: null,
      status: 'scheduled',
      rev: 0,
      resetRev: 0,
      lock: { locked: false },
      clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
      finishedAt: null,
      confirmedAt: null,
      walkoverSide: null,
      result: null,
      resultSource: null
    });
    expect(Object.keys(doc.lock as object)).toEqual(['locked']);
    expect(Object.keys(doc.clockBase as object)).toEqual(['startedAt', 'pausedSec', 'running', 'period']);
    expect(Object.keys(doc.home as object)).toEqual(['teamId', 'name']);
    expect(Object.keys(doc.score as object)).toEqual(['home', 'away']);
    const banned = ['uid', 'createdBy', 'updatedBy', 'scoreMismatch', 'kickoffAt', 'updatedAt'];
    const keys = allKeys(doc);
    for (const name of banned) expect(keys).not.toContain(name);
  });

  it('未排場次的 kickoff／場地帶 null', () => {
    const m: PlannedMatch = {
      round: 2,
      matchNo: 9,
      kickoffMs: null,
      venueIdx: null,
      venueName: null,
      home: { teamId: 'en1', name: '甲' },
      away: { teamId: 'en2', name: '乙' }
    };
    const doc = publicMatchDoc(m, { mtId: 'mt_xxxxxxxxxxxxxxxxxxxx', dvId: 'dv1' });
    expect(doc.kickoffMs).toBeNull();
    expect(doc.venueIdx).toBeNull();
    expect(doc.venueName).toBeNull();
    expect(doc.kickoffAt).toBeUndefined();
    expect(doc.updatedAt).toBeUndefined();
  });
});

describe('積分輸入', () => {
  it('只計 confirmed／walkover', () => {
    expect(COUNTED_STATUSES).toEqual(['confirmed', 'walkover']);
    expect(countedForStanding({ status: 'confirmed' })).toBe(true);
    expect(countedForStanding({ status: 'walkover' })).toBe(true);
    expect(countedForStanding({ status: 'finished' })).toBe(false);
    expect(countedForStanding({ status: 'scheduled' })).toBe(false);
    expect(countedForStanding({ status: 'cancelled' })).toBe(false);
    expect(countedForStanding({})).toBe(false);
    const rows = [
      { status: 'finished', id: 1 },
      { status: 'confirmed', id: 2 },
      { status: 'live', id: 3 },
      { status: 'walkover', id: 4 }
    ];
    const kept = standingMatchesOf(rows);
    expect(kept).toEqual([rows[1], rows[3]]);
    expect(kept[0]).toBe(rows[1]);
    expect(rows).toHaveLength(4);
  });

  it('rankingRuleOf 回新物件，兩種 criteria', () => {
    const h2h = rankingRuleOf('h2hFirst');
    expect(h2h).toEqual(RANKING_RULES.RR_FEDA_DEFAULT);
    expect(h2h).not.toBe(RANKING_RULES.RR_FEDA_DEFAULT);
    expect(h2h.criteria).not.toBe(RANKING_RULES.RR_FEDA_DEFAULT.criteria);
    expect(h2h.points).not.toBe(RANKING_RULES.RR_FEDA_DEFAULT.points);
    expect(h2h.fairPlay).not.toBe(RANKING_RULES.RR_FEDA_DEFAULT.fairPlay);

    const gd = rankingRuleOf('goalDiffFirst');
    expect(gd.points).toEqual(RANKING_RULES.RR_FEDA_DEFAULT.points);
    expect(gd.fairPlay).toEqual(RANKING_RULES.RR_FEDA_DEFAULT.fairPlay);
    expect(gd.criteria).toEqual(['points', 'goalDiff', 'goalsFor', 'headToHeadPoints', 'manual']);
    expect(gd.points).not.toBe(RANKING_RULES.RR_FEDA_DEFAULT.points);

    h2h.criteria.push('seed');
    h2h.points.win = 9;
    h2h.fairPlay.yellow = 0;
    gd.criteria.push('wins');
    expect(RANKING_RULES.RR_FEDA_DEFAULT.points.win).toBe(3);
    expect(RANKING_RULES.RR_FEDA_DEFAULT.fairPlay.yellow).toBe(-1);
    expect(RANKING_RULES.RR_FEDA_DEFAULT.criteria).not.toContain('seed');
    expect(rankingRuleOf('h2hFirst').criteria).toEqual([...RANKING_RULES.RR_FEDA_DEFAULT.criteria]);
    expect(rankingRuleOf('goalDiffFirst').criteria).toEqual(['points', 'goalDiff', 'goalsFor', 'headToHeadPoints', 'manual']);
    expect(() => rankingRuleOf('other' as 'h2hFirst')).toThrow(new RangeError('ranking'));
  });
});

describe('derivedScoreOf', () => {
  it('作廢、resetRev 前、非 goal、壞 side、非整數 seq 都不計', () => {
    const events = [
      { seq: 2, type: 'goal', side: 'home' },
      { seq: 1, type: 'goal', side: 'away' },
      { seq: 3, type: 'goal', side: 'home' },
      { seq: 4, type: 'goal', side: 'away' },
      { seq: 5, type: 'card', side: 'home' },
      { seq: 6, type: 'goal', side: 'left' },
      { seq: 7.5, type: 'goal', side: 'away' },
      { seq: '8', type: 'goal', side: 'home' },
      { seq: 9, type: 'goal', side: 'away' },
      { seq: true, type: 'goal', side: 'home' },
      { type: 'goal', side: 'home' }
    ];
    expect(derivedScoreOf(events, new Set([4]), 2)).toEqual({ home: 1, away: 1, goals: 2 });
    expect(derivedScoreOf([], new Set(), 0)).toEqual({ home: 0, away: 0, goals: 0 });
  });
});

describe('derivedPenaltyOf', () => {
  it('只算 seq > resetRev、未作廢、scored 為 true 的 pk；沒進與 pkStart 不進比分，shots 仍含沒進與作廢', () => {
    const events = [
      { seq: 1, type: 'pk', side: 'home', scored: true },
      { seq: 2, type: 'pkStart' },
      { seq: 3, type: 'pk', side: 'away', scored: false },
      { seq: 4, type: 'pk', side: 'away', scored: true },
      { seq: 5, type: 'pk', side: 'home', scored: true },
      { seq: 6, type: 'goal', side: 'home' },
      { seq: 7, type: 'pk', side: 'left', scored: true },
      { seq: 8.5, type: 'pk', side: 'home', scored: true },
      { seq: '9', type: 'pk', side: 'away', scored: true },
      { type: 'pk', side: 'home', scored: true }
    ];
    expect(derivedPenaltyOf(events, new Set([5]), 1)).toEqual({ home: 0, away: 1, shots: 4 });
    expect(derivedPenaltyOf([], new Set(), 0)).toEqual({ home: 0, away: 0, shots: 0 });
    expect(derivedPenaltyOf([{ seq: 2, type: 'pk', side: 'home', scored: true }], new Set(), 2))
      .toEqual({ home: 0, away: 0, shots: 0 });
  });
});

describe('summary', () => {
  it('summaryShardIdOf 跨午夜與 null（不改 process.env.TZ）', () => {
    expect(summaryShardIdOf(null)).toBe('tbd');
    expect(summaryShardIdOf(Date.parse('2026-12-05T23:30:00+08:00'))).toBe('d20261205');
    expect(summaryShardIdOf(Date.parse('2026-12-05T16:30:00Z'))).toBe('d20261206');
    expect(summaryShardIdOf(Date.parse('2026-12-05T03:30:00Z'), '-05:00')).toBe('d20261204');
    expect(summaryShardIdOf(Date.parse('2026-12-05T16:30:00Z'), '+00:00')).toBe('d20261205');
  });

  it('summaryEntryOf：已取消場次帶取消原因 cr（截 100 字），其他狀態不帶（G1 Opus 終審 P2）', () => {
    const base = { divisionId: 'dv1', round: 1, matchNo: 1, home: { teamId: 'a', name: '甲' }, away: { teamId: 'b', name: '乙' }, score: { home: 0, away: 0 } };
    expect(summaryEntryOf({ ...base, status: 'cancelled', cancelReason: '場地積水' }, null).cr).toBe('場地積水');
    expect(summaryEntryOf({ ...base, status: 'cancelled', cancelReason: 'x'.repeat(150) }, null).cr).toHaveLength(100);
    expect('cr' in summaryEntryOf({ ...base, status: 'scheduled', cancelReason: '舊原因' }, null)).toBe(false);
  });

  it('summaryEntryOf 只留契約欄位，非整數比分當 0，名字截 30 字', () => {
    const long = '名'.repeat(31);
    const claps = '👍'.repeat(31);
    const entry = summaryEntryOf({
      divisionId: 'dv1',
      round: 2,
      matchNo: 4,
      venueName: 'A場',
      home: { teamId: 'en1', name: long, uid: 'nope' },
      away: { teamId: 'en2', name: claps },
      score: { home: 2.5, away: 3 },
      status: 'confirmed',
      walkoverSide: null,
      createdBy: 'u1',
      updatedBy: 'u2'
    }, 1_700_000_000_000);
    const expected: SummaryEntry = {
      dv: 'dv1',
      r: 2,
      no: 4,
      k: 1_700_000_000_000,
      v: 'A場',
      h: { id: 'en1', n: '名'.repeat(30) },
      a: { id: 'en2', n: '👍'.repeat(30) },
      s: [0, 3],
      st: 'confirmed',
      wo: null
    };
    expect(entry).toEqual(expected);
    expect(Object.keys(entry)).toEqual(['dv', 'r', 'no', 'k', 'v', 'h', 'a', 's', 'st', 'wo']);
    expect(Array.from(entry.a.n)).toHaveLength(30);

    const zeros = summaryEntryOf({
      score: { home: '2', away: -1 },
      home: { teamId: 'en1', name: '甲' },
      away: { name: 12 }
    }, null);
    expect(zeros.s).toEqual([0, -1]);
    expect(zeros.k).toBeNull();
    expect(zeros.h).toEqual({ id: 'en1', n: '甲' });
    expect(zeros.a).toEqual({ id: '', n: '' });
    expect(zeros.no).toBeNull();
    expect(zeros.v).toBeNull();
    expect(zeros.wo).toBeNull();
    expect('p' in zeros).toBe(false);
  });

  it('summaryEntryOf：penaltyScore 為整數對時帶 p，null 與非整數省略；JSON 增量', () => {
    const base = {
      divisionId: 'dv1', round: 1, matchNo: 1, venueName: 'A',
      home: { teamId: 'h', name: '主' }, away: { teamId: 'a', name: '客' },
      score: { home: 1, away: 1 }, status: 'finished', walkoverSide: null
    };
    const plain = summaryEntryOf({ ...base, penaltyScore: null }, 10);
    expect('p' in plain).toBe(false);
    expect('p' in summaryEntryOf(base, 10)).toBe(false);
    expect('p' in summaryEntryOf({ ...base, penaltyScore: { home: 4.5, away: 3 } }, 10)).toBe(false);
    const pk = summaryEntryOf({ ...base, penaltyScore: { home: 4, away: 3 } }, 10);
    expect(pk.p).toEqual([4, 3]);
    expect(Object.keys(pk)).toEqual(['dv', 'r', 'no', 'k', 'v', 'h', 'a', 's', 'st', 'wo', 'p']);
    const zero = summaryEntryOf({ ...base, penaltyScore: { home: 0, away: 0 } }, 10);
    expect(zero.p).toEqual([0, 0]);
    const wide = summaryEntryOf({ ...base, penaltyScore: { home: 10, away: 10 } }, 10);
    const bytes = (entry: SummaryEntry) => Buffer.byteLength(JSON.stringify(entry));
    expect(bytes(pk) - bytes(plain)).toBe(Buffer.byteLength(',"p":[4,3]'));
    expect(bytes(zero) - bytes(plain)).toBe(10);
    expect(bytes(wide) - bytes(plain)).toBe(12);
    const cancelled = summaryEntryOf({
      ...base, status: 'cancelled', cancelReason: '雨', penaltyScore: { home: 1, away: 0 }
    }, 10);
    expect(Object.keys(cancelled)).toEqual(['dv', 'r', 'no', 'k', 'v', 'h', 'a', 's', 'st', 'wo', 'cr', 'p']);
  });

  it('sameEntry 等值與不等值；空值只有兩邊都空才 true', () => {
    const entry = summaryEntryOf({
      divisionId: 'dv1', round: 1, matchNo: 1, venueName: 'A',
      home: { teamId: 'h', name: '主' }, away: { teamId: 'a', name: '客' },
      score: { home: 1, away: 0 }, status: 'scheduled', walkoverSide: null
    }, 10);
    const copy: SummaryEntry = {
      ...entry,
      h: { ...entry.h },
      a: { ...entry.a },
      s: [1, 0]
    };
    expect(sameEntry(entry, copy)).toBe(true);
    expect(sameEntry(entry, { ...copy, s: [1, 1] })).toBe(false);
    expect(sameEntry(entry, { ...copy, st: 'confirmed' })).toBe(false);
    expect(sameEntry(entry, { ...copy, wo: 'home' })).toBe(false);
    expect(sameEntry(entry, { ...copy, k: null })).toBe(false);
    expect(sameEntry(null, null)).toBe(true);
    expect(sameEntry(undefined, undefined)).toBe(true);
    expect(sameEntry(null, undefined)).toBe(true);
    expect(sameEntry(entry, null)).toBe(false);
    expect(sameEntry(undefined, entry)).toBe(false);
    expect(sameEntry(entry, { ...copy, extra: 1 } as SummaryEntry)).toBe(false);
  });
});

describe('§3.272 解決狀態與取消轉移', () => {
  it('RESOLVED_STATUSES 含取消，COUNTED_STATUSES 不含', () => {
    expect(RESOLVED_STATUSES).toEqual(['confirmed', 'walkover', 'cancelled']);
    expect(COUNTED_STATUSES).toEqual(['confirmed', 'walkover']);
    expect(CANCELLABLE_STATUSES).toEqual(['scheduled', 'postponed', 'finished']);
    expect([...RESOLVED_STATUSES].filter(s => countedForStanding({ status: s }))).toEqual(['confirmed', 'walkover']);
    expect(resolvedForEnd({})).toBe(false);
    expect(summaryEntryOf({ status: 'cancelled' }, null).st).toBe('cancelled');
  });

  it('狀態轉移表：取消、重置、計分、已解決', () => {
    const rows: Array<{ status: string; cancel: boolean; reset: boolean; counted: boolean; resolved: boolean }> = [
      { status: 'scheduled', cancel: true, reset: false, counted: false, resolved: false },
      { status: 'postponed', cancel: true, reset: false, counted: false, resolved: false },
      { status: 'finished', cancel: true, reset: true, counted: false, resolved: false },
      { status: 'live', cancel: false, reset: true, counted: false, resolved: false },
      { status: 'halftime', cancel: false, reset: true, counted: false, resolved: false },
      { status: 'confirmed', cancel: false, reset: true, counted: true, resolved: true },
      { status: 'walkover', cancel: false, reset: true, counted: true, resolved: true },
      { status: 'cancelled', cancel: false, reset: true, counted: false, resolved: true }
    ];
    for (const row of rows) {
      expect(canCancelMatch(row.status), row.status).toBe(row.cancel);
      expect(canResetMatch(row.status), row.status).toBe(row.reset);
      expect(countedForStanding({ status: row.status }), row.status).toBe(row.counted);
      expect(resolvedForEnd({ status: row.status }), row.status).toBe(row.resolved);
    }
    expect(statusAfterReset(1_700_000_000_000)).toBe('scheduled');
    expect(statusAfterReset(null)).toBe('postponed');
  });
});
