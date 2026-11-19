/**
 * 比賽日：台北 05:00 換日。00:00～04:59 歸前一天。
 * 不改 process.env.TZ。
 */
import { describe, expect, it } from 'vitest';
import {
  civilYmd,
  matchDayOf,
  matchDayWindow,
  placeMatches,
  scheduleDayWindow
} from '../src/engine/index.js';
import { planRoundRobin, type PlanInput } from '../src/cp/schedule-plan.js';

const at = (iso: string) => Date.parse(iso);

function row(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    matchId: `m${String(i).padStart(2, '0')}`,
    teamIds: [`h${i}`, `a${i}`]
  }));
}

const venue = [{ venueId: 'v', name: 'A場', fieldType: '9v9', order: 0 }];

describe('matchDayOf', () => {
  it('00:00、04:59 歸前一天；05:00、23:59 算當天', () => {
    expect(matchDayOf(at('2026-06-15T00:00:00+08:00'))).toBe('2026-06-14');
    expect(matchDayOf(at('2026-06-15T04:59:00+08:00'))).toBe('2026-06-14');
    expect(matchDayOf(at('2026-06-15T05:00:00+08:00'))).toBe('2026-06-15');
    expect(matchDayOf(at('2026-06-15T23:59:00+08:00'))).toBe('2026-06-15');
  });

  it('跨月、跨年、閏年', () => {
    expect(matchDayOf(at('2026-03-01T04:59:00+08:00'))).toBe('2026-02-28');
    expect(matchDayOf(at('2026-03-01T05:00:00+08:00'))).toBe('2026-03-01');
    expect(matchDayOf(at('2026-01-01T00:00:00+08:00'))).toBe('2025-12-31');
    expect(matchDayOf(at('2026-01-01T04:59:00+08:00'))).toBe('2025-12-31');
    expect(matchDayOf(at('2025-12-31T23:59:00+08:00'))).toBe('2025-12-31');
    expect(matchDayOf(at('2026-01-01T05:00:00+08:00'))).toBe('2026-01-01');
    expect(matchDayOf(at('2024-03-01T04:59:00+08:00'))).toBe('2024-02-29');
    expect(matchDayOf(at('2024-02-29T05:00:00+08:00'))).toBe('2024-02-29');
    expect(matchDayOf(at('2024-02-29T23:59:00+08:00'))).toBe('2024-02-29');
    expect(matchDayOf(at('2024-03-01T05:00:00+08:00'))).toBe('2024-03-01');
  });

  it('不是有限數字就丟 TypeError', () => {
    expect(() => matchDayOf(Number.NaN)).toThrow(TypeError);
    expect(() => matchDayOf(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => matchDayOf(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('matchDayWindow', () => {
  it('當天 05:00 到隔天 05:00；非法日期回 null', () => {
    expect(matchDayWindow('2026-03-15')).toEqual({
      start: at('2026-03-15T05:00:00+08:00'),
      end: at('2026-03-16T05:00:00+08:00')
    });
    expect(matchDayWindow('2024-02-29')).toEqual({
      start: at('2024-02-29T05:00:00+08:00'),
      end: at('2024-03-01T05:00:00+08:00')
    });
    expect(matchDayWindow('2026-01-31')?.end).toBe(at('2026-02-01T05:00:00+08:00'));
    expect(matchDayWindow('2025-12-31')?.end).toBe(at('2026-01-01T05:00:00+08:00'));
    expect(matchDayWindow('2026-02-29')).toBeNull();
    expect(matchDayWindow('2026-02-31')).toBeNull();
    expect(matchDayWindow('2026-1-01')).toBeNull();
    expect(civilYmd('2024-02-29')).toBe(true);
    expect(civilYmd('2026-02-29')).toBe(false);
  });
});

describe('scheduleDayWindow', () => {
  it('同一天、跨午夜、剛好 24 小時；開賽上限是隔天 05:00', () => {
    const same = scheduleDayWindow('2026-12-05', '09:00', '18:00');
    expect(same).toEqual({
      startMs: at('2026-12-05T09:00:00+08:00'),
      endMs: at('2026-12-05T18:00:00+08:00'),
      kickoffBeforeMs: at('2026-12-06T05:00:00+08:00')
    });
    const night = scheduleDayWindow('2026-12-05', '22:00', '02:00');
    expect(night).toEqual({
      startMs: at('2026-12-05T22:00:00+08:00'),
      endMs: at('2026-12-06T02:00:00+08:00'),
      kickoffBeforeMs: at('2026-12-06T05:00:00+08:00')
    });
    const past = scheduleDayWindow('2026-12-05', '18:00', '09:00');
    expect(past?.endMs).toBe(at('2026-12-06T09:00:00+08:00'));
    expect(past?.kickoffBeforeMs).toBe(at('2026-12-06T05:00:00+08:00'));
    const full = scheduleDayWindow('2026-12-05', '09:00', '09:00');
    expect(full?.endMs).toBe(at('2026-12-06T09:00:00+08:00'));
    expect(full && full.endMs - full.startMs).toBe(86_400_000);
  });

  it('非法日期或時刻回 null；05:00 前開賽不因此被拒', () => {
    expect(scheduleDayWindow('2026-02-31', '09:00', '18:00')).toBeNull();
    expect(scheduleDayWindow('2026-02-29', '09:00', '18:00')).toBeNull();
    expect(scheduleDayWindow('2026-12-05', '9:00', '18:00')).toBeNull();
    const early = scheduleDayWindow('2026-12-05', '00:00', '04:00');
    expect(early?.startMs).toBe(at('2026-12-05T00:00:00+08:00'));
    expect(early && matchDayOf(early.startMs)).toBe('2026-12-04');
    expect(early?.kickoffBeforeMs).toBe(at('2026-12-06T05:00:00+08:00'));
  });
});

describe('placeMatches 開賽上限', () => {
  const start = at('2026-12-05T22:00:00+08:00');
  const cap = at('2026-12-06T05:00:00+08:00');
  const dayEnd = at('2026-12-06T08:00:00+08:00');

  function place(kickoffBeforeMs?: number) {
    return placeMatches({
      matches: row(15),
      venues: venue,
      dayStartMs: start,
      dayEndMs: dayEnd,
      slotMin: 5,
      durationMin: 30,
      bufferMin: 0,
      minRestMin: 0,
      playersOnField: 8,
      ...(kickoffBeforeMs == null ? {} : { kickoffBeforeMs })
    });
  }

  it('單場地 30 分：第 15 場會落在 05:00，有上限就留下；沒有上限就排入', () => {
    const capped = place(cap);
    expect(capped.unplaced).toHaveLength(1);
    expect(capped.placed.map(m => m.kickoffMs).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 14 }, (_, i) => start + i * 30 * 60_000));
    expect(capped.placed.every(m => m.kickoffMs < cap)).toBe(true);

    const open = place();
    expect(open.unplaced).toHaveLength(0);
    const kicks = open.placed.map(m => m.kickoffMs).sort((a, b) => a - b);
    expect(kicks[14]).toBe(cap);
  });

  it('04:00 開賽、90 分，可以踢過 05:00', () => {
    const kick = at('2026-12-06T04:00:00+08:00');
    const end = at('2026-12-06T08:00:00+08:00');
    const { placed, unplaced } = placeMatches({
      matches: [{ matchId: 'm', teamIds: ['h', 'a'] }],
      venues: venue,
      dayStartMs: kick,
      dayEndMs: end,
      kickoffBeforeMs: cap,
      slotMin: 5,
      durationMin: 90,
      bufferMin: 0,
      minRestMin: 0,
      playersOnField: 8
    });
    expect(unplaced).toEqual([]);
    expect(placed[0]?.kickoffMs).toBe(kick);
    expect(placed[0]!.kickoffMs + 90 * 60_000).toBeGreaterThan(cap);
    expect(placed[0]!.kickoffMs + 90 * 60_000).toBeLessThanOrEqual(end);
  });
});

describe('planRoundRobin 跨午夜', () => {
  const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ enId: `en${i + 1}`, name: `隊${i + 1}` }));

  function input(over: Partial<PlanInput>): PlanInput {
    return {
      dvId: 'dv1',
      teams: teams(4),
      legs: 1,
      matchMinutes: 20,
      bufferMinutes: 0,
      minRestMinutes: 0,
      days: [{ date: '2026-12-05', start: '22:00', end: '02:00' }],
      venues: [{ venueIdx: 0, name: 'A場' }, { venueIdx: 1, name: 'B場' }],
      playersOnField: 8,
      seed: 1,
      ...over
    };
  }

  it('22:00～02:00、4 隊 2 場地，六場都在這個比賽日', () => {
    const result = planRoundRobin(input({}));
    expect(result.unplacedCount).toBe(0);
    expect(result.matchCount).toBe(6);
    const start = at('2026-12-05T22:00:00+08:00');
    const end = at('2026-12-06T02:00:00+08:00');
    for (const m of result.matches) {
      expect(m.kickoffMs).toBeGreaterThanOrEqual(start);
      expect(m.kickoffMs).toBeLessThan(end);
      expect(m.kickoffMs! + 20 * 60_000).toBeLessThanOrEqual(end);
      expect(matchDayOf(m.kickoffMs!)).toBe('2026-12-05');
    }
  });

  it('6 隊單場地 30 分、22:00～08:00：第 15 場的 05:00 開賽排不進', () => {
    const result = planRoundRobin(input({
      teams: teams(6),
      matchMinutes: 30,
      days: [{ date: '2026-12-05', start: '22:00', end: '08:00' }],
      venues: [{ venueIdx: 0, name: 'A場' }]
    }));
    expect(result.matchCount).toBe(15);
    expect(result.unplacedCount).toBe(1);
    const cap = at('2026-12-06T05:00:00+08:00');
    const placed = result.matches.filter(m => m.kickoffMs != null);
    expect(placed).toHaveLength(14);
    expect(placed.every(m => m.kickoffMs! < cap)).toBe(true);
    expect(placed.some(m => m.kickoffMs === cap)).toBe(false);
  });
});
