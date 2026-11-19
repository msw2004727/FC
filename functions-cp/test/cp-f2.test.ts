/**
 * §3.272 F2 純函式（不需模擬器）：重疊、60 天上限、台北日期、公告文案。
 */
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { SCHEDULE_LIMITS, MATCH_HOST_ACTIONS } from '../src/cp/match-host.js';
import { appendSystemNotice, type Notice } from '../src/cp/notice.js';
import {
  DAY_MATCH_MAX,
  EXTEND_DAYS,
  LOOKBACK_MIN,
  TX_WRITE_SOFT_MAX,
  addDaysYmd,
  conflictWindowOfKickoff,
  findSlotConflict,
  firstMoveConflict,
  isYmd,
  kickoffBounds,
  kickoffOutOfRange,
  nextLastMatchDayStart,
  rangesOverlap,
  rescheduleNoticeText,
  shiftDayNoticeText,
  shiftKickoffToDate,
  slotEndMs,
  swapNoticeText,
  taipeiDayWindow,
  taipeiHm,
  taipeiYmd,
  type SlotView
} from '../src/cp/schedule-flex.js';

function at(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

function slot(over: Partial<SlotView> & Pick<SlotView, 'mtId'>): SlotView {
  return { startMs: 0, endMs: 100, teamIds: ['t'], venueIdx: 0, ...over };
}

describe('重疊', () => {
  it('端點相接不算；差 1 毫秒算；比賽加緩衝', () => {
    expect(rangesOverlap(0, 100, 100, 200)).toBe(false);
    expect(rangesOverlap(0, 100, 99, 200)).toBe(true);
    const start = Date.parse('2026-01-10T10:00:00+08:00');
    const end = slotEndMs(start, 20, 5);
    expect(end - start).toBe(25 * 60_000);
    const a = slot({ mtId: 'mt_a', startMs: start, endMs: end, teamIds: ['en_a'] });
    const beside = slot({ mtId: 'mt_b', startMs: end, endMs: slotEndMs(end, 20, 5), teamIds: ['en_a'] });
    expect(findSlotConflict(a, [beside])).toBeNull();
    const over = slot({
      mtId: 'mt_b', startMs: end - 60_000, endMs: slotEndMs(end - 60_000, 20, 5), teamIds: ['en_a']
    });
    expect(findSlotConflict(a, [over])).toEqual({ mtId: 'mt_b', type: 'team' });
  });

  it('自己略過；空場地不撞場地；隊伍優先於場地；取最小 mtId', () => {
    const self = slot({ mtId: 'mt_s', teamIds: ['t1'] });
    expect(findSlotConflict(self, [self])).toBeNull();
    expect(findSlotConflict(
      slot({ mtId: 'mt_a', teamIds: ['h'], venueIdx: null }),
      [slot({ mtId: 'mt_b', teamIds: ['x'], venueIdx: null })]
    )).toBeNull();
    expect(findSlotConflict(
      slot({ mtId: 'mt_s', teamIds: ['t1'], venueIdx: 0 }),
      [
        slot({ mtId: 'mt_a', teamIds: ['t9'], venueIdx: 0 }),
        slot({ mtId: 'mt_b', teamIds: ['t1'], venueIdx: 1 })
      ]
    )).toEqual({ mtId: 'mt_b', type: 'team' });
    expect(findSlotConflict(
      slot({ mtId: 'mt_s', teamIds: ['t1'] }),
      [slot({ mtId: 'mt_m', teamIds: ['t1'] }), slot({ mtId: 'mt_c', teamIds: ['t1'] })]
    )).toEqual({ mtId: 'mt_c', type: 'team' });
    expect(findSlotConflict(
      slot({ mtId: 'mt_s', teamIds: ['h'], venueIdx: 1 }),
      [slot({ mtId: 'mt_v', teamIds: ['x'], venueIdx: 1 })]
    )).toEqual({ mtId: 'mt_v', type: 'venue' });
  });

  it('比賽與緩衝各自不是正整數就不佔；長度 0 不重疊。順延不互比，對調會把對方算進去', () => {
    expect(slotEndMs(0, 0, 0)).toBe(0);
    expect(slotEndMs(0, 20, 0)).toBe(20 * 60_000);
    expect(slotEndMs(0, 0, 10)).toBe(10 * 60_000);
    const zero = slot({ mtId: 'mt_z', endMs: slotEndMs(0, 0, 0), teamIds: ['t'] });
    expect(findSlotConflict(zero, [slot({ mtId: 'mt_o', teamIds: ['t'] })])).toBeNull();
    const a = slot({ mtId: 'mt_a', endMs: 100, teamIds: ['t'] });
    const b = slot({ mtId: 'mt_b', startMs: 50, endMs: 150, teamIds: ['t'], venueIdx: 1 });
    expect(firstMoveConflict([a, b], [])).toBeNull();
    expect(firstMoveConflict([b, a], [a, b])).toEqual({ mtId: 'mt_b', type: 'team' });
  });
});

describe('上限與台北日', () => {
  const first = Date.parse('2026-03-01T08:00:00+08:00');
  const origin = Date.parse('2026-03-01T18:00:00+08:00');

  it('原末場日加 60 天含當天，上限比賽日的隔天 05:00 起拒絕', () => {
    expect(EXTEND_DAYS).toBe(60);
    expect(addDaysYmd('2026-03-01', 60)).toBe('2026-04-30');
    const bounds = kickoffBounds(first, origin);
    expect(bounds.minYmd).toBe('2026-03-01');
    expect(bounds.maxYmd).toBe('2026-04-30');
    expect(bounds.lo).toBe(Date.parse('2026-03-01T05:00:00+08:00'));
    expect(bounds.hi).toBe(Date.parse('2026-05-01T05:00:00+08:00'));
    expect(kickoffOutOfRange(bounds.lo, first, origin)).toBeNull();
    expect(kickoffOutOfRange(bounds.hi - 1, first, origin)).toBeNull();
    expect(kickoffOutOfRange(bounds.hi, first, origin)).toEqual({ min: '2026-03-01', max: '2026-04-30' });
    expect(kickoffOutOfRange(bounds.lo - 1, first, origin)).toEqual({ min: '2026-03-01', max: '2026-04-30' });
    // 5/1 01:30 仍屬 4/30 比賽日；5/1 05:00 與 3/1 02:00（比賽日 2/28）在窗外
    expect(kickoffOutOfRange(Date.parse('2026-05-01T01:30:00+08:00'), first, origin)).toBeNull();
    expect(kickoffOutOfRange(Date.parse('2026-05-01T05:00:00+08:00'), first, origin))
      .toEqual({ min: '2026-03-01', max: '2026-04-30' });
    expect(kickoffOutOfRange(Date.parse('2026-03-01T02:00:00+08:00'), first, origin))
      .toEqual({ min: '2026-03-01', max: '2026-04-30' });
  });

  it('末場日只往後、不提前，同一日不改', () => {
    const cur = Date.parse('2026-03-10T15:00:00+08:00');
    expect(nextLastMatchDayStart(cur, [
      Date.parse('2026-03-10T23:00:00+08:00'),
      Date.parse('2026-03-09T23:00:00+08:00'),
      null
    ])).toBeNull();
    expect(nextLastMatchDayStart(cur, [
      Date.parse('2026-03-11T01:00:00+08:00'),
      Date.parse('2026-03-12T09:00:00+08:00')
    ])).toBe(Date.parse('2026-03-12T00:00:00+08:00'));
  });

  it('凌晨開賽算前一個比賽日，不把末場再延一天', () => {
    const mar10 = Date.parse('2026-03-10T15:00:00+08:00');
    expect(nextLastMatchDayStart(mar10, [Date.parse('2026-03-11T01:30:00+08:00')])).toBeNull();
    const mar12Midnight = Date.parse('2026-03-12T00:00:00+08:00');
    expect(nextLastMatchDayStart(mar12Midnight, [Date.parse('2026-03-13T01:30:00+08:00')])).toBeNull();
    expect(nextLastMatchDayStart(mar12Midnight, [Date.parse('2026-03-13T05:00:00+08:00')]))
      .toBe(Date.parse('2026-03-13T00:00:00+08:00'));
  });

  it('台北日界、時刻，以及順延只換日期', () => {
    expect(taipeiYmd(Date.parse('2026-12-05T16:00:00Z'))).toBe('2026-12-06');
    expect(taipeiYmd(Date.parse('2026-12-05T15:59:00Z'))).toBe('2026-12-05');
    expect(taipeiYmd(Date.parse('2026-01-09T16:00:00Z'))).toBe('2026-01-10');
    expect(taipeiHm(Date.parse('2026-01-10T14:00:00+08:00'))).toBe('14:00');
    expect(taipeiHm(Date.parse('2026-01-10T09:05:00+08:00'))).toBe('09:05');
    const kick = Date.parse('2026-01-09T14:00:00+08:00');
    expect(shiftKickoffToDate(kick, '2026-01-09', '2026-01-16')).toBe(Date.parse('2026-01-16T14:00:00+08:00'));
    const noon = Date.parse('2026-01-10T12:00:00+08:00');
    expect(conflictWindowOfKickoff(noon)).toEqual({
      start: Date.parse('2026-01-10T01:00:00+08:00'),
      end: Date.parse('2026-01-11T05:00:00+08:00')
    });
    expect(taipeiDayWindow('2026-01-10')).toEqual({
      start: Date.parse('2026-01-10T05:00:00+08:00'),
      end: Date.parse('2026-01-11T05:00:00+08:00')
    });
    expect(taipeiDayWindow('2026-02-31')).toBeNull();
    const late = Date.parse('2026-01-10T23:00:00+08:00');
    const early = Date.parse('2026-01-11T01:30:00+08:00');
    const wLate = conflictWindowOfKickoff(late);
    const wEarly = conflictWindowOfKickoff(early);
    expect(wLate.start).toBe(wEarly.start);
    expect(early).toBeGreaterThanOrEqual(wLate.start);
    expect(early).toBeLessThan(wLate.end);
    expect(late).toBeGreaterThanOrEqual(wEarly.start);
    expect(late).toBeLessThan(wEarly.end);
    expect(LOOKBACK_MIN).toBe(240);
  });

  it('合法日曆日：閏年 2/29 可以，2/31 與平年 2/29 不行', () => {
    expect(isYmd('2024-02-29')).toBe(true);
    expect(isYmd('2026-01-09')).toBe(true);
    expect(isYmd('2026-02-31')).toBe(false);
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2026-1-09')).toBe(false);
    expect(isYmd('')).toBe(false);
  });

  it('當日上限對齊單組場次上限，寫入低於 490', () => {
    expect(DAY_MATCH_MAX).toBe(SCHEDULE_LIMITS.matchesMax);
    expect(DAY_MATCH_MAX + 2).toBeLessThanOrEqual(TX_WRITE_SOFT_MAX);
    expect(typeof MATCH_HOST_ACTIONS.rescheduleMatch).toBe('function');
    expect(typeof MATCH_HOST_ACTIONS.shiftMatchDay).toBe('function');
    expect(typeof MATCH_HOST_ACTIONS.swapMatches).toBe('function');
  });
});

describe('公告文案', () => {
  it('改期、順延、對調用卡片上的句子', () => {
    const from = Date.parse('2026-01-10T14:00:00+08:00');
    const to = Date.parse('2026-01-24T14:00:00+08:00');
    expect(rescheduleNoticeText({
      kickoffMs: from, homeName: '甲隊', awayName: '乙隊', toMs: to, venueName: '2號場'
    })).toBe('1/10 甲隊對乙隊改至 1/24 14:00 2號場');
    expect(rescheduleNoticeText({
      kickoffMs: from, homeName: '甲隊', awayName: '乙隊', toMs: null, venueName: '2號場'
    })).toBe('1/10 甲隊對乙隊改至待定');
    expect(rescheduleNoticeText({
      kickoffMs: null, homeName: '甲隊', awayName: '乙隊', toMs: to, venueName: null
    })).toBe('甲隊對乙隊改至 1/24 14:00');
    expect(rescheduleNoticeText({
      kickoffMs: from, homeName: '甲隊', awayName: '乙隊', toMs: to, venueName: '  '
    })).toBe('1/10 甲隊對乙隊改至 1/24 14:00');
    expect(rescheduleNoticeText({
      kickoffMs: Date.parse('2026-01-10T01:30:00+08:00'),
      homeName: '甲隊', awayName: '乙隊',
      toMs: Date.parse('2026-01-10T23:00:00+08:00'),
      venueName: null
    })).toBe('1/9 甲隊對乙隊改至 1/10 23:00');
    expect(shiftDayNoticeText('2026-01-09', '2026-01-16')).toBe('1/9 全天賽程順延至 1/16');
    expect(shiftDayNoticeText('2026-02-31', '2026-01-16')).toBe('');
    expect(swapNoticeText(
      { kickoffMs: from, homeName: '甲隊', awayName: '乙隊' },
      { kickoffMs: Date.parse('2026-01-11T16:00:00+08:00'), homeName: '丙隊', awayName: '丁隊' }
    )).toBe('兩場對調：1/10 14:00 甲隊對乙隊 與 1/11 16:00 丙隊對丁隊');
  });

  it('系統公告與末場延後併成同一筆賽事更新', () => {
    const updates: Array<Record<string, unknown>> = [];
    const tx = { update(_ref: unknown, data: Record<string, unknown>) { updates.push(data); } };
    const out = appendSystemNotice(tx as unknown as Transaction, {
      ref: {} as DocumentReference,
      notices: [],
      at: at(9_000),
      by: '0123456789abcdef'
    }, { kind: 'system', text: '1/9 全天賽程順延至 1/16' }, {
      lastMatchAt: 123, stateVersion: 9, notices: ['不要']
    });
    expect(out.id).toMatch(/^nt_[A-Za-z0-9]{20}$/);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.lastMatchAt).toBe(123);
    expect(updates[0]?.stateVersion).toBe(9);
    const notices = updates[0]?.notices as Notice[];
    expect(notices.map(n => n.text)).toEqual(['1/9 全天賽程順延至 1/16']);
    expect(updates[0]?.updatedAt).toBeTruthy();
  });
});

describe('F2 初審修正（Flash）', () => {
  it('撞期查詢窗涵蓋晚場跨午夜', () => {
    const k = Date.parse('2027-01-09T23:00:00+08:00');
    const w = conflictWindowOfKickoff(k);
    expect(w.end).toBeGreaterThanOrEqual(k + LOOKBACK_MIN * 60_000);
    expect(w.end).toBeGreaterThan(Date.parse('2027-01-10T00:30:00+08:00'));
  });
  it('長度不為正的區間不算重疊（含落在另一區間內部）', () => {
    expect(rangesOverlap(50, 50, 0, 100)).toBe(false);
    expect(rangesOverlap(0, 100, 50, 50)).toBe(false);
    expect(rangesOverlap(0, 100, 50, 60)).toBe(true);
  });
});

