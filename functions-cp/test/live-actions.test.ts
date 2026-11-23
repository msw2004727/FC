/**
 * LIVE 賽務台純邏輯｜對應 docs/04 §5
 */
import {
  scoreFromTimeline, consistencyCheck, nextSeq,
  buildGoalEvent, buildCardEvent, buildSubEvent,
  suggestCardType, sentOffPlayerIds, onFieldCount, matchFairPlay,
  subCount, checkSubLimit, buildFinishPatch, finishSummary,
  eventText, sortEventsDesc, isPlayerRow, onFieldIds
} from '../src/engine/live-actions.js';

const ev = (over = {}) => ({
  matchId: 'm1', seq: 1, type: 'goal', side: 'home', teamId: 'tA',
  clockSec: 600, periodId: 'h1', voided: false, ...over
});

describe('比分推算', () => {
  test('一般進球與罰球進都算給該隊', () => {
    expect(scoreFromTimeline([
      ev({ seq: 1, type: 'goal', side: 'home' }),
      ev({ seq: 2, type: 'penalty_scored', side: 'away' })
    ])).toEqual({ home: 1, away: 1 });
  });

  test('⭐ 烏龍球記給對隊', () => {
    // side 記的是「把球踢進門的人屬於哪一隊」，分數要給對手
    expect(scoreFromTimeline([ev({ type: 'own_goal', side: 'home' })])).toEqual({ home: 0, away: 1 });
    expect(scoreFromTimeline([ev({ type: 'own_goal', side: 'away' })])).toEqual({ home: 1, away: 0 });
  });

  test('罰球失、卡片、換人不影響比分', () => {
    expect(scoreFromTimeline([
      ev({ type: 'penalty_missed' }), ev({ type: 'card', cardType: 'yellow' }),
      ev({ type: 'substitution' }), ev({ type: 'period_start', side: 'neutral' })
    ])).toEqual({ home: 0, away: 0 });
  });

  test('作廢的進球不算', () => {
    expect(scoreFromTimeline([ev({ voided: true })])).toEqual({ home: 0, away: 0 });
  });

  test('side 不合法時整筆略過，不會算到 undefined 隊', () => {
    expect(scoreFromTimeline([ev({ side: 'neutral' }), ev({ side: null })])).toEqual({ home: 0, away: 0 });
  });

  test('空輸入不炸', () => {
    expect(scoreFromTimeline(null)).toEqual({ home: 0, away: 0 });
    expect(scoreFromTimeline([])).toEqual({ home: 0, away: 0 });
  });
});

describe('一致性檢查（警示但允許送出）', () => {
  test('一致時 ok=true', () => {
    const r = consistencyCheck({ home: 1, away: 0 }, [ev()]);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('一致');
  });

  test('不一致時給出可讀的警示，且不阻擋', () => {
    const r = consistencyCheck({ home: 2, away: 1 }, [ev()]);
    expect(r.ok).toBe(false);
    expect(r.derived).toEqual({ home: 1, away: 0 });
    expect(r.message).toBe('事件加總為 1:0，與比分 2:1 不同，仍要送出嗎？');
  });

  test('沒記任何事件、只手動加分也算不一致（但仍可送出）', () => {
    expect(consistencyCheck({ home: 3, away: 0 }, []).ok).toBe(false);
  });
});

describe('序號', () => {
  test('取最大值 +1，空陣列從 1 開始', () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([{ seq: 3 }, { seq: 7 }, { seq: 5 }])).toBe(8);
  });

  test('作廢的事件也佔序號（不可重複使用）', () => {
    expect(nextSeq([{ seq: 4, voided: true }])).toBe(5);
  });
});

describe('事件建構', () => {
  const common = { matchId: 'm1', events: [], side: 'home', period: 'h1', clockSec: 1380, minute: 23, uid: 'u1', teamId: 'tA' };

  test('進球帶入球員資料', () => {
    const e = buildGoalEvent({ ...common, player: { memberId: 'p7', displayName: '王小明', jerseyNo: 7 } });
    expect(e).toMatchObject({
      type: 'goal', side: 'home', teamId: 'tA', playerId: 'p7',
      playerName: '王小明', jerseyNo: 7, goalType: 'open',
      createdBy: 'u1', voided: false, seq: 1, clockSec: 1380
    });
  });

  test('⭐ 快速模式：不指定球員也要能記分（兒童組常見）', () => {
    const e = buildGoalEvent({ ...common, player: null });
    expect(e.playerId).toBeNull();
    expect(e.type).toBe('goal');
    expect(scoreFromTimeline([e])).toEqual({ home: 1, away: 0 });
  });

  test('PK 進球的 goalType 自動帶 penalty', () => {
    expect(buildGoalEvent({ ...common, type: 'penalty_scored' }).goalType).toBe('penalty');
  });

  test('烏龍球的 goalType 自動帶 own', () => {
    expect(buildGoalEvent({ ...common, type: 'own_goal' }).goalType).toBe('own');
  });

  test('不填 createdAt（由呼叫端補 serverTimestamp，保持純函式）', () => {
    expect(buildGoalEvent({ ...common }).createdAt).toBeUndefined();
  });

  test('clockSec 一律取整且不為負', () => {
    expect(buildGoalEvent({ ...common, clockSec: -5 }).clockSec).toBe(0);
    expect(buildGoalEvent({ ...common, clockSec: 12.7 }).clockSec).toBe(13);
  });

  test('換人同時記下場與上場', () => {
    const e = buildSubEvent({
      ...common,
      outPlayer: { memberId: 'p7', displayName: '王小明', jerseyNo: 7 },
      inPlayer: { memberId: 'p15', displayName: '張小華', jerseyNo: 15 }
    });
    expect(e).toMatchObject({ type: 'substitution', playerId: 'p7', subInPlayerId: 'p15', subInJerseyNo: 15 });
  });
});

describe('卡片判定', () => {
  const card = (playerId, cardType, clockSec, over = {}) =>
    ev({ type: 'card', playerId, cardType, clockSec, ...over });

  test('⭐ 第二張黃牌會主動提示改記兩黃換紅', () => {
    const r = suggestCardType([card('p7', 'yellow', 300)], 'p7', 'yellow');
    expect(r.suggest).toBe('second_yellow');
    expect(r.reason).toContain('兩黃換紅');
  });

  test('第一張黃牌不提示', () => {
    expect(suggestCardType([], 'p7', 'yellow').suggest).toBeNull();
  });

  test('別的球員的黃牌不會誤觸提示', () => {
    expect(suggestCardType([card('p4', 'yellow', 300)], 'p7', 'yellow').suggest).toBeNull();
  });

  test('作廢的黃牌不算', () => {
    expect(suggestCardType([card('p7', 'yellow', 300, { voided: true })], 'p7', 'yellow').suggest).toBeNull();
  });

  test('直接開紅牌時不提示', () => {
    expect(suggestCardType([card('p7', 'yellow', 300)], 'p7', 'red').suggest).toBeNull();
  });

  test('紅牌與兩黃換紅都會被罰離場', () => {
    const off = sentOffPlayerIds([card('p7', 'red', 100), card('p9', 'second_yellow', 200), card('p4', 'yellow', 300)]);
    expect([...off].sort()).toEqual(['p7', 'p9']);
  });

  test('場上人數扣掉被罰離場的', () => {
    expect(onFieldCount(['p1', 'p4', 'p7'], [card('p7', 'red', 100)])).toBe(2);
  });

  test('本場行為分沿用引擎判定（兩黃換紅 −3、黃後紅 −5）', () => {
    expect(matchFairPlay([card('p7', 'yellow', 100), card('p7', 'second_yellow', 200)], 'tA')).toBe(-3);
    expect(matchFairPlay([card('p7', 'yellow', 100), card('p7', 'red', 200)], 'tA')).toBe(-5);
    expect(matchFairPlay([card('p7', 'red', 200)], 'tA')).toBe(-4);
    expect(matchFairPlay([card('p7', 'yellow', 100), card('p4', 'yellow', 200)], 'tA')).toBe(-2);
  });

  test('只算指定隊伍的行為分', () => {
    const evs = [card('p7', 'red', 100), card('p9', 'yellow', 200, { teamId: 'tB' })];
    expect(matchFairPlay(evs, 'tA')).toBe(-4);
    expect(matchFairPlay(evs, 'tB')).toBe(-1);
  });
});

describe('換人上限（警示但不阻擋）', () => {
  const sub = side => ev({ type: 'substitution', side });

  test('計算各隊已用次數', () => {
    const evs = [sub('home'), sub('home'), sub('away')];
    expect(subCount(evs, 'home')).toBe(2);
    expect(subCount(evs, 'away')).toBe(1);
  });

  test('達上限時給警示訊息，但沒有「禁止」的回傳值', () => {
    const r = checkSubLimit([sub('home'), sub('home')], 'home', 2);
    expect(r.over).toBe(true);
    expect(r.message).toContain('仍要繼續嗎');
    expect(r).not.toHaveProperty('blocked');
  });

  test('未設上限（5 人制不限）時永遠不警示', () => {
    expect(checkSubLimit([sub('home'), sub('home')], 'home', null).over).toBe(false);
  });
});

describe('完賽送出', () => {
  const base = { uid: 'u1', events: [ev({ seq: 1 }), ev({ seq: 2, side: 'away' })] };

  test('勝負與積分正確', () => {
    const p = buildFinishPatch({ ...base, score: { home: 2, away: 1 } });
    expect(p.result).toEqual({ winner: 'home', method: 'regulation', homePoints: 3, awayPoints: 0 });
    expect(p.status).toBe('finished');
    expect(p.period).toBe('ft');
    expect(p.lock.locked).toBe(true);
    expect(p.clock.running).toBe(false);
  });

  test('平手各得 1 分', () => {
    const p = buildFinishPatch({ ...base, score: { home: 1, away: 1 } });
    expect(p.result.winner).toBe('draw');
    expect(p.result.homePoints).toBe(1);
    expect(p.result.awayPoints).toBe(1);
  });

  test('PK 決勝：正規比分仍是平手，勝負由 penaltyScore 決定，積分榜視為平手', () => {
    const p = buildFinishPatch({ ...base, score: { home: 1, away: 1 }, penaltyScore: { home: 4, away: 3 } });
    expect(p.result.winner).toBe('home');
    expect(p.result.method).toBe('penalty');
    expect(p.score).toEqual({ home: 1, away: 1 });
    // 積分榜會依 score 判平手（docs/02 §10），這裡刻意不給勝隊 3 分
    expect(p.result.homePoints).toBe(3);
  });

  test('⭐ 事件加總與比分不符時標記 scoreMismatch，但仍組得出 patch（不阻擋）', () => {
    const p = buildFinishPatch({ ...base, score: { home: 5, away: 0 } });
    expect(p.scoreMismatch).toBe(true);
    expect(p.status).toBe('finished');
  });

  test('一致時 scoreMismatch=false', () => {
    expect(buildFinishPatch({ ...base, score: { home: 1, away: 1 } }).scoreMismatch).toBe(false);
  });

  test('確認畫面摘要', () => {
    const s = finishSummary({
      match: { home: { name: '臺中野狼' }, away: { name: '臺中猛虎' }, score: { home: 2, away: 1 }, htScore: { home: 1, away: 0 } },
      events: base.events
    });
    expect(s.home).toBe('臺中野狼');
    expect(s.score).toBe('2 - 1');
    expect(s.htScore).toBe('1-0');
    expect(s.goalCount).toBe(2);
    expect(s.consistency.ok).toBe(false);
  });
});

describe('事件顯示', () => {
  test('各型別都有可讀文字，且未指定球員時不顯示 undefined', () => {
    expect(eventText(ev({ type: 'goal', playerName: '王小明', jerseyNo: 7 }))).toBe('進球　#7 王小明');
    expect(eventText(ev({ type: 'goal', playerName: null }))).toBe('進球　未指定球員');
    expect(eventText(ev({ type: 'own_goal', playerName: '林阿明', jerseyNo: 4 }))).toContain('記給對隊');
    expect(eventText(ev({ type: 'card', cardType: 'second_yellow', playerName: '陳大同', jerseyNo: 9 })))
      .toBe('兩黃換紅　#9 陳大同');
    expect(eventText(ev({ type: 'period_end', periodId: 'h1' }))).toBe('上半場 結束');
  });

  test('沒有任何文字含 undefined 或 null', () => {
    for (const t of ['goal', 'own_goal', 'penalty_scored', 'penalty_missed', 'card', 'substitution', 'note']) {
      const s = eventText(ev({ type: t }));
      expect(s).not.toMatch(/undefined|null/);
    }
  });

  test('由新到舊排序', () => {
    const list = sortEventsDesc([
      ev({ seq: 1, clockSec: 100 }), ev({ seq: 3, clockSec: 900 }), ev({ seq: 2, clockSec: 500 })
    ]);
    expect(list.map(e => e.seq)).toEqual([3, 2, 1]);
  });

  test('同秒數時用 seq 決定先後（不會亂跳）', () => {
    const list = sortEventsDesc([ev({ seq: 1, clockSec: 100 }), ev({ seq: 2, clockSec: 100 })]);
    expect(list.map(e => e.seq)).toEqual([2, 1]);
  });
});

// ── 第三輪驗收（2026-09-07，記錄員 S-5）────────────────────────────

describe('出場名單的列也是球員', () => {
  test('⭐ role 是 start／bench 的列算球員——不然名單一經裁判確認，選單就一個人都不剩', () => {
    expect(isPlayerRow({ role: 'start' })).toBe(true);
    expect(isPlayerRow({ role: 'bench' })).toBe(true);
    expect(isPlayerRow({ role: 'player' })).toBe(true);
    expect(isPlayerRow({})).toBe(true);
    expect(isPlayerRow({ role: 'coach' })).toBe(false);
    expect(isPlayerRow({ kind: 'captain' })).toBe(false);
  });
});

describe('場上名單（換人選單用）', () => {
  const sheet = [
    { memberId: 'a', role: 'start' }, { memberId: 'b', role: 'start' },
    { memberId: 'c', role: 'bench' }, { memberId: 'd', role: 'bench' }
  ];
  const sub = (out, inn, over = {}) => ev({ type: 'substitution', side: 'home', playerId: out, subInPlayerId: inn, ...over });

  test('⭐ 先發在場上，替補在場下', () => {
    expect([...onFieldIds(sheet, [])].sort()).toEqual(['a', 'b']);
  });

  test('⭐ 換人之後：下場的離開、上場的加入', () => {
    const on = onFieldIds(sheet, [sub('a', 'c', { seq: 1, clockSec: 100 })]);
    expect([...on].sort()).toEqual(['b', 'c']);
  });

  test('換下去的人可以再換上來（學童組滾動換人），依時序算', () => {
    const on = onFieldIds(sheet, [
      sub('c', 'a', { seq: 2, clockSec: 300 }),   // 故意倒著給，要照時間排
      sub('a', 'c', { seq: 1, clockSec: 100 })
    ]);
    expect([...on].sort()).toEqual(['a', 'b']);
  });

  test('作廢的換人不算', () => {
    expect([...onFieldIds(sheet, [sub('a', 'c', { voided: true })])].sort()).toEqual(['a', 'b']);
  });

  test('⭐ 罰離場的人不在場上', () => {
    const on = onFieldIds(sheet, [ev({ type: 'card', cardType: 'red', playerId: 'a' })]);
    expect([...on]).toEqual(['b']);
  });

  test('⭐ 名單沒有先發／替補資訊（出場名單還沒確認）時回 null，不是空集合', () => {
    expect(onFieldIds([{ memberId: 'a', role: 'player' }], [])).toBeNull();
    expect(onFieldIds([], [])).toBeNull();
    expect(onFieldIds(null, null)).toBeNull();
  });
});
