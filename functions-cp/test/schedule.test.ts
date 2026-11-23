/**
 * T44 賽程產生與排定
 * ------------------------------------------------------------------
 * 規格：docs/05 §6、docs/02 §4；競賽規章第十四條（賽程抽籤）
 *
 * 這一組測試盯的是三件「錯了不會報錯，只會安靜地排出一份壞賽程」的事：
 *   1. 抽籤要**重放得出來**（種子相同 → 結果相同），不然抽籤沒有證據
 *   2. 排出來的賽程不可以有兩場比賽同時同地、或一支球隊同時在兩片場地
 *   3. 名次賽不可以排在它的來源之前（冠軍賽照樣顯示「A組第1名」，
 *      只是那個名次到開賽時還不存在）
 */

import {
  taipeiMs, drawOrder, buildGroups, genericFormat, pickFormatFor,
  buildMatches, placeMatches, shiftMatches, assignMatchNos, checkSchedule,
  fieldFits, slotSpanMin, kickoffMsOf
} from '../src/engine/schedule.js';
import { FORMATS } from '../src/engine/formats.js';

const teams = n => Array.from({ length: n }, (_, i) => ({
  teamId: `t-${i + 1}`, name: `第${i + 1}隊足球隊`, shortName: `第${i + 1}隊`
}));

const DIV = {
  divisionId: 'adult-open', code: 'AO', name: '成人公開組',
  matchDurationMin: 30, playersOnField: 9
};
const DIV5 = {
  divisionId: 'u10', code: 'U10', name: 'U10兒童組',
  matchDurationMin: 25, playersOnField: 5
};
const VENUES = [
  { venueId: 'venue-a', name: 'A場', fieldType: '9v9', order: 1 },
  { venueId: 'venue-b', name: 'B場', fieldType: '9v9', order: 2 },
  { venueId: 'venue-c', name: 'C場', fieldType: '5v5', order: 3 }
];

const DAY = '2026-10-11';
const START = taipeiMs(DAY, '08:30');
const END = taipeiMs(DAY, '18:00');

// ══════════════════════════════════════════════════════════════════

describe('T44-A 抽籤', () => {
  test('⭐ 同一個種子一定得到同一個順序（抽籤要重放得出來）', () => {
    const a = drawOrder(teams(8), 20261009);
    const b = drawOrder(teams(8), 20261009);
    expect(a.map(t => t.teamId)).toEqual(b.map(t => t.teamId));
  });

  test('不同種子會得到不同順序', () => {
    const a = drawOrder(teams(8), 1).map(t => t.teamId).join();
    const b = drawOrder(teams(8), 2).map(t => t.teamId).join();
    expect(a).not.toBe(b);
  });

  test('⭐ 一隊都不能少、也不能重複', () => {
    const out = drawOrder(teams(11), 7);
    expect(out).toHaveLength(11);
    expect(new Set(out.map(t => t.teamId)).size).toBe(11);
  });

  test('不動原本的陣列', () => {
    const src = teams(6);
    const before = src.map(t => t.teamId);
    drawOrder(src, 99);
    expect(src.map(t => t.teamId)).toEqual(before);
  });

  test('⭐ 種子不是整數就丟錯（引擎不自己生亂數，R-ENG-004）', () => {
    expect(() => drawOrder(teams(4))).toThrow(TypeError);
    expect(() => drawOrder(teams(4), 1.5)).toThrow(TypeError);
    expect(() => drawOrder(teams(4), '123')).toThrow(TypeError);
  });
});

describe('T44-B 分組', () => {
  test('蛇形：1 2 3 4 5 6 7 8 → A B B A A B B A', () => {
    const [A, B] = buildGroups(teams(8), 2);
    expect(A.map(t => t.teamId)).toEqual(['t-1', 't-4', 't-5', 't-8']);
    expect(B.map(t => t.teamId)).toEqual(['t-2', 't-3', 't-6', 't-7']);
  });

  test('⭐ 依「傳進來的順序」分，不是依 teams 身上的 seed 欄位', () => {
    // 抽籤的結果就是順序。若這裡改回去讀 t.seed 排序，抽完的結果會被
    // 報名時寫入的舊 seed 蓋掉——畫面顯示抽籤成功，分組卻是別的
    const ordered = teams(4).reverse().map((t, i) => ({ ...t, seed: 99 - i }));
    const [A] = buildGroups(ordered, 2);
    expect(A[0].teamId).toBe('t-4');
  });

  test('奇數隊：兩組差一隊', () => {
    const [A, B] = buildGroups(teams(7), 2);
    expect(A.length + B.length).toBe(7);
    expect(Math.abs(A.length - B.length)).toBe(1);
  });
});

describe('T44-C 通用範本', () => {
  test('現成範本優先：8 隊找得到 F8_GROUP_CROSS', () => {
    expect(pickFormatFor(8, FORMATS)?.formatId).toBe('F8_GROUP_CROSS');
    expect(pickFormatFor(4, FORMATS)?.formatId).toBe('F4_RR_FINAL');
  });

  test('⭐ 找不到就回 null，不猜一個隊數不合的範本', () => {
    expect(pickFormatFor(7, FORMATS)).toBeNull();
    expect(pickFormatFor(5, FORMATS)).toBeNull();
  });

  test('5 隊：單循環 10 場，名次全部由積分榜決定', () => {
    const f = genericFormat(5);
    expect(f.teamCount).toBe(5);
    expect(f.stages).toHaveLength(1);
    expect(f.finalRankingMap).toHaveLength(5);
    expect(f.finalRankingMap.every(x => x.from.type === 'standing')).toBe(true);

    const { matches } = buildMatches({ division: DIV, format: f, groups: buildGroups(teams(5), 1) });
    expect(matches).toHaveLength(10);
  });

  test('7 隊：兩組循環 ＋ 同名次對決，場次數對得起來', () => {
    const f = genericFormat(7);
    const groups = buildGroups(teams(7), 2);
    const sizes = groups.map(g => g.length).sort();
    const rr = sizes.reduce((n, s) => n + (s * (s - 1)) / 2, 0);
    const { matches } = buildMatches({ division: DIV, format: f, groups });
    expect(matches).toHaveLength(rr + 3);        // 3 場同名次對決（min(3,4)）
  });

  test('⭐ finalRankingMap 涵蓋 1..N 且不重複（少一個名次＝頒獎當天發不出獎）', () => {
    for (const n of [4, 5, 6, 7, 8, 9, 11]) {
      const f = genericFormat(n);
      const ranks = f.finalRankingMap.map(x => x.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  test('⭐ 隊數不齊時在說明裡講明白有一隊少打一場', () => {
    expect(genericFormat(7).description).toContain('少打一場');
    expect(genericFormat(8).description).not.toContain('少打一場');
  });

  test('隊數不合理就丟錯', () => {
    expect(() => genericFormat(1)).toThrow(RangeError);
    expect(() => genericFormat(6.5)).toThrow(RangeError);
    expect(() => genericFormat(3, { groupCount: 2 })).toThrow(RangeError);
    expect(() => genericFormat(8, { groupCount: 3 })).toThrow(RangeError);
  });
});

describe('T44-D 對戰表', () => {
  test('matchId 用組別碼與階段碼，可讀', () => {
    const { matches } = buildMatches({
      division: DIV, format: FORMATS.F8_GROUP_CROSS, groups: buildGroups(teams(8), 2)
    });
    expect(matches.some(m => m.matchId === 'AO-G-A-01')).toBe(true);
    expect(matches.some(m => m.matchId === 'AO-F-F1')).toBe(true);
    expect(matches).toHaveLength(20);
  });

  test('淘汰賽場次帶 placeholder，沒有 teamId', () => {
    const { matches } = buildMatches({
      division: DIV, format: FORMATS.F8_GROUP_CROSS, groups: buildGroups(teams(8), 2)
    });
    const f1 = matches.find(m => m.matchKey === 'F1');
    expect(f1.home.teamId).toBeNull();
    expect(f1.home.placeholder.type).toBe('matchWinner');
    expect(f1.home.displayName).toContain('勝隊');
    expect(f1.teamIds).toEqual([]);
  });

  test('⭐ 隊數與範本不符一律丟錯，不排出少一場的賽程', () => {
    expect(() => buildMatches({
      division: DIV, format: FORMATS.F8_GROUP_CROSS, groups: buildGroups(teams(7), 2)
    })).toThrow(/需要 8 隊/);
  });

  test('⭐ 組別沒有 code 就丟錯，不猜一個前綴', () => {
    expect(() => buildMatches({
      division: { divisionId: 'x' }, format: genericFormat(4), groups: buildGroups(teams(4), 1)
    })).toThrow(/code/);
  });

  test('報名進來的球隊沒有 abbr／隊色也排得出來', () => {
    const bare = [{ teamId: 'a', name: '甲隊' }, { teamId: 'b', name: '乙隊' }];
    const { matches } = buildMatches({
      division: DIV, format: genericFormat(2, { groupCount: 1 }), groups: [bare]
    });
    expect(matches[0].home.name).toBe('甲隊');
    expect(matches[0].home.abbr).toBeNull();
    expect(matches[0].home.colorPrimary).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════

/** 把 placeMatches 的輸出接回 checkSchedule 看得懂的形狀 */
const asMatches = placed => placed.map(m => ({ ...m, kickoffAt: m.kickoffMs }));

describe('T44-E 排時段與場地', () => {
  const gen = (n, div = DIV) => buildMatches({
    division: div, format: genericFormat(n), groups: buildGroups(teams(n), 2)
  }).matches;

  test('排得出來，而且沒有任何衝突', () => {
    const { placed, unplaced } = placeMatches({
      matches: gen(8), venues: VENUES.slice(0, 2),
      dayStartMs: START, dayEndMs: END,
      slotMin: 40, durationMin: 30, bufferMin: 10,
      playersOnField: 9, minRestMin: 20
    });
    expect(unplaced).toHaveLength(0);
    const { findings } = checkSchedule({
      matches: asMatches(placed), venues: VENUES, divisions: [DIV], minRestMin: 20
    });
    expect(findings.filter(f => f.level === 'error')).toEqual([]);
  });

  test('⭐ 9 人制不會被排進 5v5 場地', () => {
    const { placed } = placeMatches({
      matches: gen(6), venues: VENUES,
      dayStartMs: START, dayEndMs: END,
      slotMin: 40, durationMin: 30, bufferMin: 10, playersOnField: 9, minRestMin: 0
    });
    expect(placed.every(m => m.venueId !== 'venue-c')).toBe(true);
  });

  test('5 人制排得進大場（種子本來就這樣排）', () => {
    expect(fieldFits(5, { fieldType: '9v9' })).toBe(true);
    expect(fieldFits(9, { fieldType: '5v5' })).toBe(false);
    expect(fieldFits(9, { fieldType: '9v9' })).toBe(true);
  });

  test('⭐ 會避開別的組別已經排好的場次（不然兩組會撞在同一片場地上）', () => {
    const occupied = [{
      venueId: 'venue-a', startMs: START, endMs: START + 40 * 60000, teamIds: ['other-1']
    }];
    const { placed } = placeMatches({
      matches: gen(6), occupied, venues: [VENUES[0]],
      dayStartMs: START, dayEndMs: END,
      slotMin: 40, durationMin: 30, bufferMin: 10, playersOnField: 9, minRestMin: 0
    });
    expect(placed.every(m => m.kickoffMs >= START + 40 * 60000)).toBe(true);
  });

  test('⭐ 當天排不下就回報 unplaced，不排到半夜', () => {
    const { placed, unplaced } = placeMatches({
      matches: gen(8), venues: [VENUES[0]],
      dayStartMs: START, dayEndMs: taipeiMs(DAY, '10:00'),
      slotMin: 40, durationMin: 30, bufferMin: 10, playersOnField: 9, minRestMin: 20
    });
    expect(unplaced.length).toBeGreaterThan(0);
    expect(placed.every(m => m.kickoffMs + 30 * 60000 <= taipeiMs(DAY, '10:00'))).toBe(true);
    expect(unplaced[0].reason).toContain('排不下');
  });

  test('沒有場地時全部回報 unplaced', () => {
    const { placed, unplaced } = placeMatches({
      matches: gen(6), venues: [],
      dayStartMs: START, dayEndMs: END,
      slotMin: 40, durationMin: 30, bufferMin: 10, playersOnField: 9
    });
    expect(placed).toHaveLength(0);
    expect(unplaced).toHaveLength(9);
  });

  test('休息下限會被遵守', () => {
    const { placed } = placeMatches({
      matches: gen(6), venues: VENUES.slice(0, 2),
      dayStartMs: START, dayEndMs: END,
      slotMin: 35, durationMin: 25, bufferMin: 10, playersOnField: 5, minRestMin: 60
    });
    const { findings } = checkSchedule({
      matches: asMatches(placed), venues: VENUES, divisions: [DIV5], minRestMin: 60
    });
    expect(findings.filter(f => f.code === 'SHORT_REST')).toEqual([]);
  });

  test('slotSpanMin ＝ 比賽時間 ＋ 緩衝', () => {
    expect(slotSpanMin(30, 10)).toBe(40);
    expect(slotSpanMin(25, 0)).toBe(25);
  });
});

// ══════════════════════════════════════════════════════════════════

describe('T44-F 衝突檢查', () => {
  const at = (hhmm, over = {}) => ({
    matchId: `m-${hhmm}-${over.venueId ?? 'a'}`, divisionId: 'adult-open',
    stageId: 'group', label: '測試', venueId: 'venue-a',
    kickoffAt: taipeiMs(DAY, hhmm), teamIds: [], ...over
  });
  const run = (matches, opts = {}) => checkSchedule({
    matches, venues: VENUES, divisions: [DIV, DIV5], minRestMin: 20, ...opts
  });

  test('⭐ 沒排時間或沒排場地是 error（發布之前一定要全部排好）', () => {
    const r = run([at('09:00', { kickoffAt: null }), at('10:00', { venueId: null })]);
    expect(r.findings.find(f => f.code === 'NO_SLOT')?.level).toBe('error');
    expect(r.canPublish).toBe(false);
  });

  test('⭐ 同一場地時間重疊是 error', () => {
    const r = run([
      at('09:00', { matchId: 'A', teamIds: ['t1', 't2'] }),
      at('09:15', { matchId: 'B', teamIds: ['t3', 't4'] })
    ]);
    const f = r.findings.find(x => x.code === 'VENUE_OVERLAP');
    expect(f?.level).toBe('error');
    expect(f.matchIds.sort()).toEqual(['A', 'B']);
  });

  test('⭐ 同一隊同時要打兩場是 error', () => {
    const r = run([
      at('09:00', { matchId: 'A', teamIds: ['t1', 't2'] }),
      at('09:15', { matchId: 'B', venueId: 'venue-b', teamIds: ['t1', 't9'] })
    ]);
    expect(r.findings.find(f => f.code === 'TEAM_OVERLAP')?.level).toBe('error');
  });

  test('⭐ 9 人制排進 5v5 場地是 error', () => {
    const r = run([at('09:00', { venueId: 'venue-c', teamIds: ['t1', 't2'] })]);
    expect(r.findings.find(f => f.code === 'FIELD_TOO_SMALL')?.level).toBe('error');
  });

  test('指到不存在的場地是 error', () => {
    const r = run([at('09:00', { venueId: 'venue-zz', teamIds: ['t1', 't2'] })]);
    expect(r.findings.find(f => f.code === 'UNKNOWN_VENUE')?.level).toBe('error');
  });

  test('休息不足是 warn，不擋發布（規章沒有這一條）', () => {
    const r = run([
      at('09:00', { matchId: 'A', teamIds: ['t1', 't2'] }),
      at('09:40', { matchId: 'B', venueId: 'venue-b', teamIds: ['t1', 't9'] })
    ]);
    const f = r.findings.find(x => x.code === 'SHORT_REST');
    expect(f?.level).toBe('warn');
    expect(f.source).toBe('建議');
    expect(r.canPublish).toBe(true);
  });

  test('⭐ 空等只看相鄰兩場：一天打三場不該被報成「等了五小時」', () => {
    // 第一場與第三場之間本來就隔很久，中間還有一場。全配對比較會吐出
    // 一條沒有意義的警告，然後主辦就再也不看警告了
    const r = run([
      at('09:00', { matchId: 'A', teamIds: ['t1', 't2'] }),
      at('12:00', { matchId: 'B', venueId: 'venue-b', teamIds: ['t1', 't3'] }),
      at('15:00', { matchId: 'C', venueId: 'venue-b', teamIds: ['t1', 't4'] })
    ], { maxGapMin: 240 });
    expect(r.findings.filter(f => f.code === 'LONG_GAP')).toHaveLength(0);
  });

  test('真的空等太久還是要報', () => {
    const r = run([
      at('09:00', { matchId: 'A', teamIds: ['t1', 't2'] }),
      at('16:00', { matchId: 'B', venueId: 'venue-b', teamIds: ['t1', 't3'] })
    ], { maxGapMin: 240 });
    expect(r.findings.find(f => f.code === 'LONG_GAP')?.level).toBe('warn');
  });

  test('⭐ 名次賽排在來源之前是 error（來源那個名次到開賽時還不存在）', () => {
    const r = run([
      at('14:00', {
        matchId: 'F1', stageId: 'final', matchKey: 'F1', teamIds: [],
        home: { teamId: null, placeholder: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 } },
        away: { teamId: null, placeholder: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 } }
      }),
      at('15:00', { matchId: 'G9', venueId: 'venue-b', teamIds: ['t1', 't2'] })
    ]);
    const f = r.findings.find(x => x.code === 'SOURCE_AFTER');
    expect(f?.level).toBe('error');
    expect(r.canPublish).toBe(false);
  });

  test('名次賽排在分組賽之後就沒事', () => {
    const r = run([
      at('09:00', { matchId: 'G9', teamIds: ['t1', 't2'] }),
      at('11:00', {
        matchId: 'F1', stageId: 'final', matchKey: 'F1', teamIds: [],
        home: { teamId: null, placeholder: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 } },
        away: { teamId: null, placeholder: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 } }
      })
    ]);
    expect(r.findings.filter(f => f.code === 'SOURCE_AFTER')).toEqual([]);
  });

  test('⭐ 決賽排在準決賽之前也要抓（matchWinner 那一路）', () => {
    const r = run([
      at('09:00', {
        matchId: 'FINAL', stageId: 'final', matchKey: 'CH', teamIds: [],
        home: { teamId: null, placeholder: { type: 'matchWinner', matchKey: 'SF1' } },
        away: { teamId: null, placeholder: { type: 'matchLoser', matchKey: 'SF1' } }
      }),
      at('11:00', { matchId: 'SEMI', venueId: 'venue-b', stageId: 'final', matchKey: 'SF1', teamIds: ['t1', 't2'] })
    ]);
    expect(r.findings.find(f => f.code === 'SOURCE_AFTER')?.level).toBe('error');
  });

  test('空的賽程可以發布（還沒產生的組別不該擋住別組）', () => {
    expect(checkSchedule({}).canPublish).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════

describe('T44-G 場次編號', () => {
  const m = (id, hhmm, no) => ({ matchId: id, kickoffAt: hhmm ? taipeiMs(DAY, hhmm) : null, matchNo: no });

  test('依開賽時間重編 1..N', () => {
    const out = assignMatchNos([m('C', '11:00'), m('A', '09:00'), m('B', '10:00')]);
    expect(out).toEqual([
      { matchId: 'A', matchNo: 1 }, { matchId: 'B', matchNo: 2 }, { matchId: 'C', matchNo: 3 }
    ]);
  });

  test('已經對的就不回傳（不必要的寫入等於白花稽核紀錄）', () => {
    expect(assignMatchNos([m('A', '09:00', 1), m('B', '10:00', 2)])).toEqual([]);
  });

  test('沒排時間的排最後', () => {
    const out = assignMatchNos([m('X', null), m('A', '09:00')]);
    expect(out).toEqual([{ matchId: 'A', matchNo: 1 }, { matchId: 'X', matchNo: 2 }]);
  });

  test('⭐ 已經開打就不重編，只給沒有號碼的接下去（紙本與廣播對得上）', () => {
    const out = assignMatchNos(
      [m('C', '08:00'), m('A', '09:00', 1), m('B', '10:00', 2)],
      { frozen: true }
    );
    expect(out).toEqual([{ matchId: 'C', matchNo: 3 }]);
  });
});

describe('T44-H 整體順延（雨天）', () => {
  const m = (id, hhmm, status = 'scheduled') => ({
    matchId: id, kickoffAt: taipeiMs(DAY, hhmm), status
  });

  test('指定時間點之後的往後推', () => {
    const { updates } = shiftMatches(
      [m('A', '09:00'), m('B', '11:00'), m('C', '13:00')],
      { fromMs: taipeiMs(DAY, '11:00'), deltaMin: 30 }
    );
    expect(updates.map(u => u.matchId)).toEqual(['B', 'C']);
    expect(updates[0].kickoffMs).toBe(taipeiMs(DAY, '11:30'));
  });

  test('⭐ 已經開打的不動（時鐘會跟排定時間對不起來）', () => {
    const { updates, skipped } = shiftMatches(
      [m('A', '11:00', 'live'), m('B', '12:00', 'finished'), m('C', '13:00')],
      { fromMs: taipeiMs(DAY, '10:00'), deltaMin: 30 }
    );
    expect(updates.map(u => u.matchId)).toEqual(['C']);
    expect(skipped.map(s => s.matchId).sort()).toEqual(['A', 'B']);
  });

  test('往前提也可以（雨停了）', () => {
    const { updates } = shiftMatches([m('A', '13:00')], { fromMs: 0, deltaMin: -30 });
    expect(updates[0].kickoffMs).toBe(taipeiMs(DAY, '12:30'));
  });

  test('0 分鐘或非整數丟錯', () => {
    expect(() => shiftMatches([], { fromMs: 0, deltaMin: 0 })).toThrow(RangeError);
    expect(() => shiftMatches([], { fromMs: 0, deltaMin: 1.5 })).toThrow(RangeError);
  });
});

describe('T44-I 時間工具', () => {
  test('taipeiMs 固定用 +08:00，不看執行環境時區', () => {
    expect(taipeiMs('2026-10-11', '08:30')).toBe(Date.parse('2026-10-11T00:30:00Z'));
  });

  test('格式不對回 null，不回一個 NaN 讓它散播出去', () => {
    expect(taipeiMs('2026/10/11', '08:30')).toBeNull();
    expect(taipeiMs('2026-10-11', '8:30')).toBeNull();
    expect(taipeiMs(null)).toBeNull();
  });

  test('kickoffMsOf 吃得下 Timestamp／Date／數字', () => {
    expect(kickoffMsOf({ kickoffAt: 1000 })).toBe(1000);
    expect(kickoffMsOf({ kickoffAt: new Date(2000) })).toBe(2000);
    expect(kickoffMsOf({ kickoffAt: { seconds: 3, nanoseconds: 500e6 } })).toBe(3500);
    expect(kickoffMsOf({ kickoffAt: { toMillis: () => 4000 } })).toBe(4000);
    expect(kickoffMsOf({})).toBeNull();
  });
});
