/**
 * 晉級解算｜T11
 * 對應 docs/02 §7、§8
 */
import {
  resolveTeamSource, explainTeamSource, resolveStage,
  computeFinalRanking, isSlotWritable, canResolve, describeTeamSource
} from '../src/engine/advancement.js';
import { FORMATS } from '../src/engine/formats.js';

const DIV = 'adult-open';

const standing = (groupId, teamIds, over = {}) => ({
  standingId: `${DIV}__group__${groupId}`,
  divisionId: DIV, stageId: 'group', groupId,
  rows: teamIds.map((teamId, i) => ({ rank: i + 1, teamId, name: teamId })),
  hasUnresolvedTie: false,
  ...over
});

const slotMatch = (matchKey, over = {}) => ({
  matchId: `AO-P-${matchKey}`, matchKey,
  divisionId: DIV, stageId: 'placement',
  home: { teamId: null }, away: { teamId: null },
  teamIds: [], status: 'scheduled', score: { home: 0, away: 0 },
  ...over
});

const baseCtx = () => ({
  divisionId: DIV,
  standings: {
    [`${DIV}__group__A`]: standing('A', ['t1', 't4', 't5', 't8']),
    [`${DIV}__group__B`]: standing('B', ['t2', 't3', 't6', 't7'])
  },
  teams: {
    t1: { shortName: '野狼', abbr: 'WLF', logoUrl: 'x.png' },
    t2: { shortName: '猛虎', abbr: 'TGR' },
    t3: { shortName: '獵鷹' }, t4: { shortName: '黑熊' },
    t5: { shortName: '飛燕' }, t6: { shortName: '銀狐' },
    t7: { shortName: '青龍' }, t8: { shortName: '白鯊' }
  },
  matchesByKey: {
    SF1: slotMatch('SF1'), SF2: slotMatch('SF2'),
    PF1: slotMatch('PF1'), PF2: slotMatch('PF2')
  }
});

describe('T11 TeamSource 求值', () => {
  test('standing：A 組第 1 名 → t1', () => {
    expect(resolveTeamSource({ type: 'standing', stageId: 'group', groupId: 'A', rank: 1 }, baseCtx())).toBe('t1');
    expect(resolveTeamSource({ type: 'standing', stageId: 'group', groupId: 'B', rank: 2 }, baseCtx())).toBe('t3');
  });

  test('matchWinner / matchLoser', () => {
    const ctx = baseCtx();
    ctx.matchesByKey.SF1 = slotMatch('SF1', {
      home: { teamId: 't1' }, away: { teamId: 't3' },
      status: 'finished', score: { home: 2, away: 1 },
      result: { winner: 'home', method: 'regulation' }
    });
    expect(resolveTeamSource({ type: 'matchWinner', matchKey: 'SF1' }, ctx)).toBe('t1');
    expect(resolveTeamSource({ type: 'matchLoser', matchKey: 'SF1' }, ctx)).toBe('t3');
  });

  test('fixed 直接回傳指定隊伍', () => {
    expect(resolveTeamSource({ type: 'fixed', teamId: 't9' }, baseCtx())).toBe('t9');
  });

  test('積分榜有待裁定的同分時，一律不解算', () => {
    const ctx = baseCtx();
    ctx.standings[`${DIV}__group__A`].hasUnresolvedTie = true;
    const r = explainTeamSource({ type: 'standing', stageId: 'group', groupId: 'A', rank: 1 }, ctx);
    expect(r.teamId).toBeNull();
    expect(r.reason).toContain('待裁定');
  });

  test('場次未完賽 → 回傳 null 並說明原因', () => {
    const r = explainTeamSource({ type: 'matchWinner', matchKey: 'SF1' }, baseCtx());
    expect(r.teamId).toBeNull();
    expect(r.reason).toContain('尚未完賽');
  });

  test('淘汰賽平手（PK 未登錄）不猜勝隊', () => {
    const ctx = baseCtx();
    ctx.matchesByKey.SF1 = slotMatch('SF1', {
      home: { teamId: 't1' }, away: { teamId: 't3' },
      status: 'finished', result: { winner: 'draw', method: 'regulation' }
    });
    const r = explainTeamSource({ type: 'matchWinner', matchKey: 'SF1' }, ctx);
    expect(r.teamId).toBeNull();
    expect(r.reason).toContain('未產生勝負');
  });

  test('PK 決勝的場次可以解算（result.winner 已填）', () => {
    const ctx = baseCtx();
    ctx.matchesByKey.SF1 = slotMatch('SF1', {
      home: { teamId: 't1' }, away: { teamId: 't3' },
      status: 'finished', score: { home: 1, away: 1 },
      penaltyScore: { home: 4, away: 3 },
      result: { winner: 'home', method: 'penalty' }
    });
    expect(resolveTeamSource({ type: 'matchWinner', matchKey: 'SF1' }, ctx)).toBe('t1');
  });
});

describe('T11 placeholder 正確替換為實際隊伍', () => {
  test('交叉賽四場全部填好，並帶入隊名與隊徽', () => {
    const ctx = baseCtx();
    const r = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);

    expect(r.blocked).toEqual([]);
    expect(r.allResolved).toBe(true);
    expect(r.resolvedCount).toBe(4);

    const byKey = Object.fromEntries(r.updates.map(u => [u.matchKey, u.patch]));
    expect([byKey.SF1.home.teamId, byKey.SF1.away.teamId]).toEqual(['t1', 't3']); // A1 vs B2
    expect([byKey.SF2.home.teamId, byKey.SF2.away.teamId]).toEqual(['t2', 't4']); // B1 vs A2
    expect([byKey.PF1.home.teamId, byKey.PF1.away.teamId]).toEqual(['t5', 't7']); // A3 vs B4
    expect([byKey.PF2.home.teamId, byKey.PF2.away.teamId]).toEqual(['t6', 't8']); // B3 vs A4

    expect(byKey.SF1.home.name).toBe('野狼');
    expect(byKey.SF1.home.logoUrl).toBe('x.png');
    expect(byKey.SF1.home.placeholder).toBeNull();
    expect(byKey.SF1.teamIds).toEqual(['t1', 't3']);
    expect(byKey.SF1.status).toBe('ready');
  });

  test('解算後每個 slot 都留下判定依據', () => {
    const r = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', baseCtx());
    const sf1 = r.updates.find(u => u.matchKey === 'SF1');
    expect(sf1.trace).toEqual({ home: 'A組第1名', away: 'B組第2名' });
  });

  test('缺一份積分榜時只擋住受影響的場次，其餘照樣解算', () => {
    const ctx = baseCtx();
    delete ctx.standings[`${DIV}__group__B`];
    const r = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);
    expect(r.allResolved).toBe(false);
    expect(r.blocked.length).toBe(4);            // 四場都各有一邊取自 B 組
    expect(r.blocked[0].reason).toContain('找不到積分榜');
  });

  test('重複解算時，已填好且結果相同的場次標記為 noop', () => {
    const ctx = baseCtx();
    ctx.matchesByKey.SF1 = slotMatch('SF1', {
      home: { teamId: 't1' }, away: { teamId: 't3' }, teamIds: ['t1', 't3']
    });
    const r = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);
    expect(r.updates.find(u => u.matchKey === 'SF1').noop).toBe(true);
  });

  test('⭐ 把第一次的解算結果套回去再跑一次，必須完全成功（冪等）', () => {
    // 解算成功會把場次寫成 status:'ready'。若 'ready' 不算可寫入狀態，
    // 第二次解算會全數 blocked，Function 重放就永遠失敗。
    const ctx = baseCtx();
    const first = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);
    expect(first.allResolved).toBe(true);

    for (const u of first.updates) {
      const m = Object.values(ctx.matchesByKey).find(x => x.matchId === u.matchId);
      Object.assign(m, u.patch);
    }
    expect(Object.values(ctx.matchesByKey).every(m => m.status === 'ready')).toBe(true);

    const second = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);
    expect(second.blocked).toEqual([]);
    expect(second.allResolved).toBe(true);
    expect(second.updates.every(u => u.noop === true)).toBe(true);
  });

  test('⭐ 分組賽改判後，尚未開打的 ready 場次要能改填新的隊伍（§10）', () => {
    const ctx = baseCtx();
    const first = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);
    for (const u of first.updates) {
      Object.assign(Object.values(ctx.matchesByKey).find(x => x.matchId === u.matchId), u.patch);
    }
    // A 組第 1、2 名對調
    ctx.standings[`${DIV}__group__A`] = standing('A', ['t4', 't1', 't5', 't8']);

    const again = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);
    expect(again.blocked).toEqual([]);
    const sf1 = again.updates.find(u => u.matchKey === 'SF1');
    expect(sf1.noop).toBe(false);
    expect(sf1.patch.home.teamId).toBe('t4');
  });

  test('循環賽階段沒有 slots，不可回報「解算完成」', () => {
    const r = resolveStage(FORMATS.F8_GROUP_CROSS, 'group', baseCtx());
    expect(r.allResolved).toBe(false);
    expect(r.notApplicable).toBe(true);
  });
});

describe('§7.3 下游已有比分時必須擋下重跑', () => {
  test('已開打或已有比分的場次不可寫入', () => {
    expect(isSlotWritable(slotMatch('SF1'))).toBe(true);
    expect(isSlotWritable(slotMatch('SF1', { status: 'checkin' }))).toBe(true);
    expect(isSlotWritable(slotMatch('SF1', { status: 'live' }))).toBe(false);
    expect(isSlotWritable(slotMatch('SF1', { score: { home: 1, away: 0 } }))).toBe(false);
    expect(isSlotWritable(slotMatch('SF1', { status: 'finished' }))).toBe(false);
  });

  test('resolveStage 對這類場次回報「請先清除比分」', () => {
    const ctx = baseCtx();
    ctx.matchesByKey.SF1 = slotMatch('SF1', { status: 'live', score: { home: 1, away: 0 } });
    const r = resolveStage(FORMATS.F8_GROUP_CROSS, 'placement', ctx);
    const b = r.blocked.find(x => x.matchKey === 'SF1');
    expect(b.reason).toContain('需先清除比分');
    expect(r.allResolved).toBe(false);
  });
});

describe('§7.1 解算前置條件', () => {
  test('尚有未完賽場次時不可解算', () => {
    const ctx = { ...baseCtx(), stageMatches: { group: [{ status: 'live' }, { status: 'finished' }] } };
    const r = canResolve(FORMATS.F8_GROUP_CROSS, 'group', ctx);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('尚有 1 場未完賽');
  });

  test('Admin 鎖定時不可解算', () => {
    const ctx = { ...baseCtx(), stageMatches: { group: [{ status: 'confirmed' }] } };
    expect(canResolve(FORMATS.F8_GROUP_CROSS, 'group', ctx, { manualHold: true }).ready).toBe(false);
  });

  test('有待裁定同分時不可解算', () => {
    const ctx = { ...baseCtx(), stageMatches: { group: [{ status: 'confirmed' }] } };
    ctx.standings[`${DIV}__group__A`].hasUnresolvedTie = true;
    const r = canResolve(FORMATS.F8_GROUP_CROSS, 'group', ctx);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('待裁定');
  });

  test('⭐ 缺資料時必須拒絕，不可 fail-open', () => {
    // 呼叫端漏帶欄位、傳空陣列、或 stageId 打錯，都不能被當成「全部打完了」
    for (const ctx of [
      baseCtx(),                                                   // 完全沒有 stageMatches
      { ...baseCtx(), stageMatches: {} },
      { ...baseCtx(), stageMatches: { group: [] } },
      { ...baseCtx(), stageMatches: { grouop: [{ status: 'live' }] } }   // 拼錯
    ]) {
      const r = canResolve(FORMATS.F8_GROUP_CROSS, 'group', ctx);
      expect(r.ready).toBe(false);
      expect(r.reason).toContain('缺少');
    }
  });

  test('全部完賽且無同分 → 可解算', () => {
    const ctx = { ...baseCtx(), stageMatches: { group: [{ status: 'confirmed' }] } };
    expect(canResolve(FORMATS.F8_GROUP_CROSS, 'group', ctx).ready).toBe(true);
  });
});

describe('最終排名（§8.1）', () => {
  test('決賽尚未打完時回報缺哪幾名', () => {
    const { ranking, complete, missing } = computeFinalRanking(FORMATS.F8_GROUP_CROSS, baseCtx());
    expect(complete).toBe(false);
    expect(ranking).toEqual([]);
    expect(missing.map(m => m.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('公開端佔位文字', () => {
  test('未解算時顯示可讀的說明', () => {
    expect(describeTeamSource({ type: 'standing', groupId: 'A', rank: 1 })).toBe('A組第1名');
    expect(describeTeamSource({ type: 'matchWinner', matchKey: 'SF1' }, { SF1: '準決賽①' })).toBe('準決賽①勝隊');
    expect(describeTeamSource({ type: 'matchLoser', matchKey: 'SF1' })).toBe('SF1敗隊');
    expect(describeTeamSource(null)).toBe('待定');
  });
});
