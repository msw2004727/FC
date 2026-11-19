/**
 * 賽事規則解析。舊文件必須與 rankingRuleOf ＋ DEFAULT_WALKOVER ＋不壓球差相同。
 * 飛達盃 T05／T06／T07／T09 用 buildStanding 重跑，名次與現在一致。
 */
import { buildStanding, DEFAULT_WALKOVER, RANKING_RULES } from '../src/engine/index.js';
import {
  RULE_TEMPLATES, engineInputsOf, resolveRules, rulesDocumentOf, sameScoringInputs, validateRulesInput,
  type ResolvedRules
} from '../src/engine/rules.js';
import { rankingRuleOf } from '../src/cp/schedule-plan.js';
import { mk, mkAll, order } from './_helpers.js';

const h2h = () => rankingRuleOf('h2hFirst');
const gd = () => rankingRuleOf('goalDiffFirst');

function inputsOf(division: unknown) {
  return engineInputsOf(resolveRules(division));
}

function expectLegacy(division: unknown, preset: 'h2hFirst' | 'goalDiffFirst') {
  const inputs = inputsOf(division);
  const rule = rankingRuleOf(preset);
  expect(inputs.rule.points).toEqual(rule.points);
  expect(inputs.rule.criteria).toEqual(rule.criteria);
  expect(inputs.rule.fairPlay).toEqual(rule.fairPlay);
  expect(inputs.rule.rankingRuleId).toBe(rule.rankingRuleId);
  expect(inputs.rule.name).toBe(rule.name);
  expect(inputs.opts.walkover).toEqual(DEFAULT_WALKOVER);
  expect(inputs.opts.mercyRule).toEqual({ enabled: false });
  expect(inputs.opts.fairPlay).toBe(inputs.rule.fairPlay);
  expect(inputs.opts).not.toHaveProperty('cardEvents');
  expect(inputs.rule.criteria).not.toEqual([...RANKING_RULES.RR_FEDA_2026.criteria]);
}

function stand(teamIds: string[], matches: unknown[], division: unknown) {
  const { rule, opts } = inputsOf(division);
  return buildStanding({
    competitionId: 'ev', divisionId: 'div', stageId: 'group', groupId: 'A',
    teamIds, matches: matches as never, rule, opts
  });
}

function standRule(teamIds: string[], matches: unknown[], preset: 'h2hFirst' | 'goalDiffFirst') {
  return buildStanding({
    competitionId: 'ev', divisionId: 'div', stageId: 'group', groupId: 'A',
    teamIds, matches: matches as never, rule: rankingRuleOf(preset)
  });
}

function brief(doc: ReturnType<typeof stand>) {
  return {
    hasUnresolvedTie: doc.hasUnresolvedTie,
    rows: doc.rows.map(r => ({
      teamId: r.teamId,
      points: r.points,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDiff: r.goalDiff,
      win: r.win,
      draw: r.draw,
      loss: r.loss,
      tieBreakTrace: r.tieBreakTrace,
      hasUnresolvedTie: r.hasUnresolvedTie === true
    }))
  };
}

const T05 = mkAll([
  ['m1', 'A', 'B', 1, 0],
  ['m2', 'C', 'A', 2, 0],
  ['m3', 'A', 'D', 1, 0],
  ['m4', 'B', 'C', 2, 0],
  ['m5', 'B', 'D', 3, 0],
  ['m6', 'D', 'C', 1, 0]
]);
const T06 = mkAll([
  ['m1', 'A', 'B', 3, 0],
  ['m2', 'B', 'C', 1, 0],
  ['m3', 'C', 'A', 1, 0],
  ['m4', 'A', 'D', 1, 0],
  ['m5', 'B', 'D', 5, 0],
  ['m6', 'C', 'D', 1, 0]
]);
const T07 = mkAll([
  ['m1', 'A', 'B', 5, 0],
  ['m2', 'A', 'C', 1, 0],
  ['m3', 'B', 'C', 2, 2],
  ['m4', 'A', 'D', 0, 0],
  ['m5', 'E', 'A', 1, 0],
  ['m6', 'B', 'D', 6, 0],
  ['m7', 'B', 'E', 6, 0],
  ['m8', 'C', 'D', 1, 0],
  ['m9', 'C', 'E', 1, 0],
  ['m10', 'D', 'E', 1, 0]
]);
const T09 = [
  mk('m1', 'A', 'B', 0, 0, { status: 'walkover', walkoverSide: 'away', result: { winner: 'home', method: 'walkover' } }),
  mk('m2', 'A', 'C', 1, 1),
  mk('m3', 'B', 'C', 2, 0)
];

describe('舊文件缺 rules', () => {
  test('h2hFirst、缺 ranking、其他字串都等於對戰關係優先', () => {
    expectLegacy({ schedule: { ranking: 'h2hFirst' } }, 'h2hFirst');
    expectLegacy({}, 'h2hFirst');
    expectLegacy({ schedule: {} }, 'h2hFirst');
    expectLegacy({ schedule: { ranking: 'feda2026' } }, 'h2hFirst');
    expectLegacy({ schedule: { ranking: 'custom' } }, 'h2hFirst');
    expect(h2h().criteria).toEqual(inputsOf({}).rule.criteria);
  });

  test('goalDiffFirst 的清單與 rankingRuleOf 相同，不收成 h2hFirst', () => {
    const inputs = inputsOf({ schedule: { ranking: 'goalDiffFirst' } });
    expect(inputs.rule.criteria).toEqual(gd().criteria);
    expect(inputs.rule.points).toEqual(gd().points);
    expect(inputs.rule.fairPlay).toEqual(gd().fairPlay);
    expect(inputs.rule.criteria).not.toEqual(h2h().criteria);
    expect(inputs.opts.mercyRule).toEqual({ enabled: false });
  });

  test('有 matchMinutes 時一節制、全場等於該分鐘；人數只收五個值', () => {
    const r = resolveRules({ playersOnField: 9, schedule: { matchMinutes: 25, ranking: 'h2hFirst' } });
    expect(r.playersOnField).toBe(9);
    expect(r.time).toMatchObject({ periods: 1, halfMinutes: 25, halftime: { enabled: false, minutes: 0 } });
    expect(resolveRules({ playersOnField: 6 }).playersOnField).toBe(5);
    expect(resolveRules({}).time.halfMinutes).toBe(20);
  });
});

describe('飛達盃對照', () => {
  test('T05 名次、積分、球差、追蹤與現在相同', () => {
    const ids = ['A', 'B', 'C', 'D'];
    const doc = stand(ids, T05, { schedule: { ranking: 'h2hFirst' } });
    expect(brief(doc)).toEqual(brief(standRule(ids, T05, 'h2hFirst')));
    expect(order(doc.rows)).toEqual(['A', 'B', 'D', 'C']);
    expect(doc.hasUnresolvedTie).toBe(false);
    const by = Object.fromEntries(doc.rows.map(r => [r.teamId, r]));
    expect([by.A.points, by.B.points, by.A.goalDiff, by.B.goalDiff]).toEqual([6, 6, 0, 4]);
    expect(by.A.tieBreakTrace).toContain('decided@headToHeadPoints');
  });

  test('T06 名次 A、C、B、D', () => {
    const ids = ['A', 'B', 'C', 'D'];
    const doc = stand(ids, T06, {});
    expect(brief(doc)).toEqual(brief(standRule(ids, T06, 'h2hFirst')));
    expect(order(doc.rows)).toEqual(['A', 'C', 'B', 'D']);
  });

  test('T07 前三名 A、B、C，B 的追蹤先三隊群再對 C', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const doc = stand(ids, T07, { schedule: { ranking: '其他' } });
    expect(brief(doc)).toEqual(brief(standRule(ids, T07, 'h2hFirst')));
    expect(order(doc.rows).slice(0, 3)).toEqual(['A', 'B', 'C']);
    const b = doc.rows.find(r => r.teamId === 'B')!;
    expect(b.tieBreakTrace.some(t => t.includes('(群 A/B/C)'))).toBe(true);
    expect(b.tieBreakTrace.some(t => t.includes('(vs C)'))).toBe(true);
    expect(b.tieBreakTrace).toContain('decided@goalDiff');
  });

  test('T09 棄權 0:2：A 勝 1、4 分、進球 3；B 負 1、失球 2', () => {
    const ids = ['A', 'B', 'C'];
    const doc = stand(ids, T09, {});
    expect(brief(doc)).toEqual(brief(standRule(ids, T09, 'h2hFirst')));
    const by = Object.fromEntries(doc.rows.map(r => [r.teamId, r]));
    expect(by.A).toMatchObject({ win: 1, points: 4, goalsFor: 3 });
    expect(by.B).toMatchObject({ loss: 1, goalsAgainst: 2 });
  });
});

describe('goalDiffFirst 對照', () => {
  test('T05 全序 B、A、C、D', () => {
    const ids = ['A', 'B', 'C', 'D'];
    const division = { schedule: { ranking: 'goalDiffFirst' } };
    const doc = stand(ids, T05, division);
    expect(brief(doc)).toEqual(brief(standRule(ids, T05, 'goalDiffFirst')));
    expect(order(doc.rows)).toEqual(['B', 'A', 'C', 'D']);
  });

  test('T06 不再是 A、C、B、D，與 goalDiffFirst 引擎相同', () => {
    const ids = ['A', 'B', 'C', 'D'];
    const doc = stand(ids, T06, { schedule: { ranking: 'goalDiffFirst' } });
    const engine = standRule(ids, T06, 'goalDiffFirst');
    expect(order(doc.rows)).toEqual(order(engine.rows));
    expect(order(doc.rows)).not.toEqual(['A', 'C', 'B', 'D']);
    // 全組球差與進球：B（球差 +3、進 6）先於 A（球差 +3、進 4），再 C、D。
    expect(order(doc.rows)).toEqual(['B', 'A', 'C', 'D']);
    expect(brief(doc)).toEqual(brief(engine));
  });
});

describe('自訂計分', () => {
  test('勝分 2：贏的隊得 2 分', () => {
    const matches = mkAll([['m1', 'A', 'B', 1, 0]]);
    const doc = stand(['A', 'B'], matches, { rules: { points: { win: 2 } } });
    const by = Object.fromEntries(doc.rows.map(r => [r.teamId, r]));
    expect(by.A.points).toBe(2);
    expect(by.B.points).toBe(0);
    expect(by.A.win).toBe(1);
  });

  test('棄權 3:0、勝方 3 分、不計入得失球', () => {
    const matches = [mk('m1', 'A', 'B', 0, 0, { status: 'walkover', walkoverSide: 'away' })];
    const doc = stand(['A', 'B'], matches, {
      rules: { walkover: { scoreFor: 3, scoreAgainst: 0, awardPoints: 3, penaltyPoints: 0, countInGoalStats: false } }
    });
    const by = Object.fromEntries(doc.rows.map(r => [r.teamId, r]));
    expect(by.A).toMatchObject({ points: 3, win: 1, goalsFor: 0, goalsAgainst: 0, goalDiff: 0 });
    expect(by.B).toMatchObject({ points: 0, loss: 1, goalsFor: 0, goalsAgainst: 0 });
  });

  test('仁慈開啟 cap 3：球差壓到 3，進球仍是 5', () => {
    const matches = mkAll([['m1', 'A', 'B', 5, 0]]);
    const doc = stand(['A', 'B'], matches, { rules: { mercy: { enabled: true, cap: 3 } } });
    const by = Object.fromEntries(doc.rows.map(r => [r.teamId, r]));
    expect(by.A).toMatchObject({ points: 3, goalsFor: 5, goalsAgainst: 0, goalDiff: 3 });
    expect(by.B.goalDiff).toBe(-3);
  });

  test('有合法 criteria 才覆蓋排序；缺清單時仍看 schedule.ranking，已寫的勝分保留', () => {
    const withList = resolveRules({
      schedule: { ranking: 'h2hFirst' },
      rules: { tieBreak: { criteria: ['points', 'goalDiff', 'manual'], preset: 'custom' }, points: { win: 2 } }
    });
    expect(withList.tieBreak.criteria).toEqual(['points', 'goalDiff', 'manual']);
    expect(withList.tieBreak.preset).toBe('custom');
    expect(withList.points.win).toBe(2);

    const broken = resolveRules({
      schedule: { ranking: 'goalDiffFirst' },
      rules: { tieBreak: { criteria: ['goalDiff', 'points'] }, points: { win: 2 } }
    });
    expect(broken.tieBreak.criteria).toEqual(gd().criteria);
    expect(broken.points.win).toBe(2);
    expect(sameScoringInputs(
      resolveRules({ schedule: { ranking: 'h2hFirst' } }),
      resolveRules({ schedule: { ranking: 'h2hFirst', matchMinutes: 40 }, playersOnField: 11 })
    )).toBe(true);
  });
});

function withRules(patch: Partial<ResolvedRules> & Record<string, unknown>): ResolvedRules {
  return { ...structuredClone(RULE_TEMPLATES.five), ...patch };
}

describe('validateRulesInput', () => {
  test('三個範本通過，其餘是預設積分、對戰關係優先、自由換人、棄權 2:0', () => {
    for (const key of ['five', 'seven', 'eleven'] as const) {
      expect(validateRulesInput(RULE_TEMPLATES[key]).errors).toEqual([]);
      expect(validateRulesInput(RULE_TEMPLATES[key]).warnings).toEqual([]);
    }
    expect(RULE_TEMPLATES.five).toMatchObject({
      playersOnField: 5,
      time: { periods: 2, halfMinutes: 20, halftime: { enabled: true, minutes: 5 } }
    });
    expect(RULE_TEMPLATES.seven).toMatchObject({
      playersOnField: 7,
      time: { periods: 2, halfMinutes: 25, halftime: { enabled: true, minutes: 5 } }
    });
    expect(RULE_TEMPLATES.eleven).toMatchObject({
      playersOnField: 11,
      time: { periods: 2, halfMinutes: 35, halftime: { enabled: true, minutes: 10 } }
    });
    expect(RULE_TEMPLATES.five.points).toMatchObject({ win: 3, draw: 1, loss: 0 });
    expect(RULE_TEMPLATES.five.substitution).toMatchObject({ mode: 'unlimitedReturn', maxCount: null });
    expect(RULE_TEMPLATES.five.walkover).toMatchObject({ scoreFor: 2, scoreAgainst: 0, awardPoints: 3, penaltyPoints: 0, countInGoalStats: true });
    expect(RULE_TEMPLATES.five.tieBreak.criteria[0]).toBe('points');
  });

  test('範圍邊界', () => {
    const ok = withRules({
      points: { win: 0, draw: 0, loss: -20, note: null },
      walkover: { ...RULE_TEMPLATES.five.walkover, scoreFor: 99, awardPoints: 20, penaltyPoints: -20 }
    });
    expect(validateRulesInput(ok).errors).toEqual([]);
    const hi = withRules({ points: { win: 20, draw: 20, loss: 20, note: null } });
    expect(validateRulesInput(hi).errors).toEqual([]);

    expect(validateRulesInput(withRules({ points: { win: 21, draw: 1, loss: 0, note: null } })).errors)
      .toContainEqual({ field: 'points.win', reason: 'FIELD_RANGE' });
    expect(validateRulesInput(withRules({ points: { win: 1.5, draw: 1, loss: 0, note: null } })).errors)
      .toContainEqual({ field: 'points.win', reason: 'FIELD_TYPE' });
    expect(validateRulesInput(withRules({ points: { win: -1, draw: 1, loss: 0, note: null } })).errors)
      .toContainEqual({ field: 'points.win', reason: 'FIELD_RANGE' });
    expect(validateRulesInput(withRules({ points: { win: 3, draw: 1, loss: -21, note: null } })).errors)
      .toContainEqual({ field: 'points.loss', reason: 'FIELD_RANGE' });
    expect(validateRulesInput(withRules({ playersOnField: 6 })).errors)
      .toContainEqual({ field: 'playersOnField', reason: 'FIELD_ENUM' });

    const longHalf = withRules({
      time: { periods: 2, halfMinutes: 91, halftime: { enabled: false, minutes: 0 }, note: null }
    });
    expect(validateRulesInput(longHalf).errors).toContainEqual({ field: 'time.halfMinutes', reason: 'FIELD_RANGE' });
    const full = withRules({
      time: { periods: 1, halfMinutes: 180, halftime: { enabled: false, minutes: 0 }, note: null }
    });
    expect(validateRulesInput(full).errors).toEqual([]);
    const onePeriodBreak = withRules({
      time: { periods: 1, halfMinutes: 20, halftime: { enabled: true, minutes: 5 }, note: null }
    });
    expect(validateRulesInput(onePeriodBreak).errors).toEqual(expect.arrayContaining([
      { field: 'time.halftime.enabled', reason: 'FIELD_RANGE' },
      { field: 'time.halftime.minutes', reason: 'FIELD_RANGE' }
    ]));
    expect(validateRulesInput(withRules({ extra: true })).errors)
      .toContainEqual({ field: 'extra', reason: 'UNKNOWN_FIELD' });

    const note = '備'.repeat(200);
    const noteOk = withRules({ squad: { note } });
    expect(validateRulesInput(noteOk).errors).toEqual([]);
    expect(validateRulesInput(withRules({ squad: { note: '備'.repeat(201) } })).errors)
      .toContainEqual({ field: 'squad.note', reason: 'FIELD_LENGTH' });
    const messy = withRules({ squad: { note: '  甲\n\n\n乙  ' } });
    expect(validateRulesInput(messy).errors).toEqual([]);
  });

  test('criteria 第一項不是 points 被拒、重複被拒', () => {
    const first = withRules({
      tieBreak: { ...RULE_TEMPLATES.five.tieBreak, criteria: ['goalDiff', 'points', 'manual'] }
    });
    const firstErrors = validateRulesInput(first).errors;
    expect(firstErrors).toContainEqual({ field: 'tieBreak.criteria', reason: 'CRITERIA_POINTS_FIRST' });

    const dup = withRules({
      tieBreak: { ...RULE_TEMPLATES.five.tieBreak, criteria: ['points', 'goalDiff', 'points'] }
    });
    expect(validateRulesInput(dup).errors).toContainEqual({ field: 'tieBreak.criteria', reason: 'CRITERIA_DUPLICATE' });

    const unknown = withRules({
      tieBreak: { ...RULE_TEMPLATES.five.tieBreak, criteria: ['points', 'notACriterion'] }
    });
    expect(validateRulesInput(unknown).errors).toContainEqual({ field: 'tieBreak.criteria', reason: 'FIELD_ENUM' });
  });

  test('POINTS_ORDER 只警示不擋', () => {
    const lowWin = withRules({ points: { win: 1, draw: 2, loss: 0, note: null } });
    const a = validateRulesInput(lowWin);
    expect(a.errors).toEqual([]);
    expect(a.warnings).toEqual(['POINTS_ORDER']);

    const highLoss = withRules({ points: { win: 3, draw: 1, loss: 2, note: null } });
    const b = validateRulesInput(highLoss);
    expect(b.errors).toEqual([]);
    expect(b.warnings).toEqual(['POINTS_ORDER']);

    const both = withRules({ points: { win: 0, draw: 1, loss: 2, note: null } });
    expect(validateRulesInput(both).warnings).toEqual(['POINTS_ORDER']);
    expect(validateRulesInput(both).errors).toEqual([]);
  });

  test('preset 由 criteria 推導，不採用輸入', () => {
    const h2hCriteria = [...RULE_TEMPLATES.five.tieBreak.criteria];
    const gdCriteria = resolveRules({ schedule: { ranking: 'goalDiffFirst' } }).tieBreak.criteria;
    const shortcuts: Array<[string, readonly string[]]> = [
      ['h2hFirst', h2hCriteria],
      ['goalDiffFirst', gdCriteria],
      ['feda2026', RANKING_RULES.RR_FEDA_2026.criteria],
      ['youth', RANKING_RULES.RR_FEDA_YOUTH.criteria],
      ['fifa2026', RANKING_RULES.RR_FIFA_2026.criteria]
    ];
    for (const [name, criteria] of shortcuts) {
      const input = withRules({
        tieBreak: { preset: 'custom', criteria: [...criteria], h2hScope: 'miniLeagueThenRestart', note: null }
      });
      const stored = rulesDocumentOf(input);
      expect(stored?.rules.tieBreak.preset, name).toBe(name);
      const read = resolveRules({ rules: stored?.rules });
      expect(read.tieBreak.preset, name).toBe(name);
    }

    const customList = ['points', 'goalDiff', 'manual'] as const;
    const custom = rulesDocumentOf(withRules({
      tieBreak: { preset: 'feda2026', criteria: [...customList], h2hScope: 'miniLeagueThenRestart', note: null }
    }));
    expect(custom?.rules.tieBreak.preset).toBe('custom');
    expect(resolveRules({
      rules: { tieBreak: { preset: 'feda2026', criteria: [...h2hCriteria] } }
    }).tieBreak.preset).toBe('h2hFirst');

    const badPreset = withRules({
      tieBreak: { preset: 'not-a-preset' as 'custom', criteria: [...h2hCriteria], h2hScope: 'miniLeagueThenRestart', note: null }
    });
    expect(validateRulesInput(badPreset).errors).toContainEqual({ field: 'tieBreak.preset', reason: 'FIELD_ENUM' });
  });

  test('停賽與仁慈關閉時可省略門檻與 cap，開啟時必填', () => {
    const omit = withRules({});
    const sus = omit.suspension as unknown as Record<string, unknown>;
    delete sus.yellowThreshold;
    delete sus.yellowBanMatches;
    delete sus.directRedBanMatches;
    const mercy = omit.mercy as unknown as Record<string, unknown>;
    delete mercy.cap;
    expect(validateRulesInput(omit).errors).toEqual([]);
    const omitted = rulesDocumentOf(omit);
    expect(omitted?.rules.suspension).toMatchObject({
      enabled: false, yellowThreshold: 2, yellowBanMatches: 1, directRedBanMatches: 1
    });
    expect(omitted?.rules.mercy).toMatchObject({ enabled: false, cap: 7 });

    const nulled = withRules({});
    nulled.suspension.yellowThreshold = null as unknown as number;
    nulled.suspension.yellowBanMatches = null as unknown as number;
    nulled.suspension.directRedBanMatches = null as unknown as number;
    nulled.mercy.cap = null as unknown as number;
    const storedNull = rulesDocumentOf(nulled);
    expect(storedNull?.rules.suspension.yellowThreshold).toBe(2);
    expect(storedNull?.rules.suspension.yellowBanMatches).toBe(1);
    expect(storedNull?.rules.suspension.directRedBanMatches).toBe(1);
    expect(storedNull?.rules.mercy.cap).toBe(7);

    const explicit = withRules({});
    explicit.mercy.cap = 9;
    explicit.suspension.yellowThreshold = 4;
    const kept = rulesDocumentOf(explicit);
    expect(kept?.rules.mercy).toMatchObject({ enabled: false, cap: 9 });
    expect(kept?.rules.suspension.yellowThreshold).toBe(4);

    const susOn = withRules({});
    susOn.suspension.enabled = true;
    delete (susOn.suspension as unknown as Record<string, unknown>).yellowThreshold;
    expect(validateRulesInput(susOn).errors).toContainEqual({ field: 'suspension.yellowThreshold', reason: 'FIELD_REQUIRED' });

    const mercyOn = withRules({});
    mercyOn.mercy.enabled = true;
    mercyOn.mercy.cap = null as unknown as number;
    expect(validateRulesInput(mercyOn).errors).toContainEqual({ field: 'mercy.cap', reason: 'FIELD_REQUIRED' });

    const badCap = withRules({});
    badCap.mercy.cap = 99;
    expect(validateRulesInput(badCap).errors).toContainEqual({ field: 'mercy.cap', reason: 'FIELD_RANGE' });
  });

  test('球隊暫停缺值是關閉；寫了也不改計分', () => {
    const off = {
      enabled: false, per: 'half' as const, count: 1, seconds: 60, stopsClock: true, extraTimeCount: 0, note: null
    };
    const bare = resolveRules({});
    const gdBare = resolveRules({ schedule: { ranking: 'goalDiffFirst' } });
    expect(bare.timeout).toEqual(off);
    expect(gdBare.timeout).toEqual(off);
    expect(resolveRules({ playersOnField: 11, schedule: { matchMinutes: 40 } }).timeout).toEqual(off);

    const on = resolveRules({
      rules: {
        timeout: {
          enabled: true, per: 'period', count: 0, seconds: 180, stopsClock: false, extraTimeCount: 3,
          note: '  每節\n\n\n一次  '
        }
      }
    });
    expect(on.timeout).toEqual({
      enabled: true, per: 'period', count: 0, seconds: 180, stopsClock: false, extraTimeCount: 3, note: '每節\n\n一次'
    });
    expect(sameScoringInputs(bare, on)).toBe(true);
    expect(engineInputsOf(on)).toEqual(engineInputsOf(bare));
    expect(Object.keys(engineInputsOf(on).opts).sort()).toEqual(['fairPlay', 'mercyRule', 'walkover']);

    const partial = resolveRules({ rules: { timeout: { count: 2, per: 'nope', seconds: 45 } } });
    expect(partial.timeout).toEqual({ ...off, count: 2, seconds: 45 });
    expect(sameScoringInputs(gdBare, resolveRules({
      schedule: { ranking: 'goalDiffFirst' },
      rules: { timeout: { enabled: true, per: 'match', count: 5, seconds: 30 } }
    }))).toBe(true);

    const junk = resolveRules({
      rules: { timeout: { enabled: 'no', per: 'game', count: 6, seconds: 29, stopsClock: 'yes', extraTimeCount: -1, note: 1 } }
    });
    expect(junk.timeout).toEqual(off);

    const ids = ['A', 'B', 'C', 'D'];
    const withTimeout = { rules: { timeout: { enabled: true, count: 2, seconds: 90, stopsClock: false } } };
    expect(brief(stand(ids, T05, withTimeout))).toEqual(brief(standRule(ids, T05, 'h2hFirst')));
    expect(brief(stand(ids, T06, withTimeout))).toEqual(brief(standRule(ids, T06, 'h2hFirst')));
    expect(brief(stand(['A', 'B', 'C', 'D', 'E'], T07, withTimeout))).toEqual(brief(standRule(['A', 'B', 'C', 'D', 'E'], T07, 'h2hFirst')));
    expect(brief(stand(['A', 'B', 'C'], T09, withTimeout))).toEqual(brief(standRule(['A', 'B', 'C'], T09, 'h2hFirst')));
    expect(brief(stand(ids, T05, { schedule: { ranking: 'goalDiffFirst' }, ...withTimeout })))
      .toEqual(brief(standRule(ids, T05, 'goalDiffFirst')));
    expect(brief(stand(ids, T06, { schedule: { ranking: 'goalDiffFirst' }, ...withTimeout })))
      .toEqual(brief(standRule(ids, T06, 'goalDiffFirst')));
  });

  test('球隊暫停範圍：次數 0–5、秒數 30–180、加時 0–3', () => {
    const edge = withRules({});
    edge.timeout.count = 0;
    edge.timeout.seconds = 30;
    edge.timeout.extraTimeCount = 0;
    edge.timeout.per = 'half';
    expect(validateRulesInput(edge).errors).toEqual([]);
    edge.timeout.count = 5;
    edge.timeout.seconds = 180;
    edge.timeout.extraTimeCount = 3;
    edge.timeout.per = 'period';
    expect(validateRulesInput(edge).errors).toEqual([]);
    edge.timeout.per = 'match';
    expect(validateRulesInput(edge).errors).toEqual([]);

    const lowCount = withRules({});
    lowCount.timeout.count = -1;
    expect(validateRulesInput(lowCount).errors).toContainEqual({ field: 'timeout.count', reason: 'FIELD_RANGE' });
    const highCount = withRules({});
    highCount.timeout.count = 6;
    expect(validateRulesInput(highCount).errors).toContainEqual({ field: 'timeout.count', reason: 'FIELD_RANGE' });
    const lowSec = withRules({});
    lowSec.timeout.seconds = 29;
    expect(validateRulesInput(lowSec).errors).toContainEqual({ field: 'timeout.seconds', reason: 'FIELD_RANGE' });
    const highSec = withRules({});
    highSec.timeout.seconds = 181;
    expect(validateRulesInput(highSec).errors).toContainEqual({ field: 'timeout.seconds', reason: 'FIELD_RANGE' });
    const lowExtra = withRules({});
    lowExtra.timeout.extraTimeCount = -1;
    expect(validateRulesInput(lowExtra).errors).toContainEqual({ field: 'timeout.extraTimeCount', reason: 'FIELD_RANGE' });
    const highExtra = withRules({});
    highExtra.timeout.extraTimeCount = 4;
    expect(validateRulesInput(highExtra).errors).toContainEqual({ field: 'timeout.extraTimeCount', reason: 'FIELD_RANGE' });

    const frac = withRules({});
    frac.timeout.seconds = 60.5;
    expect(validateRulesInput(frac).errors).toContainEqual({ field: 'timeout.seconds', reason: 'FIELD_TYPE' });
    const badPer = withRules({});
    badPer.timeout.per = 'game' as 'half';
    expect(validateRulesInput(badPer).errors).toContainEqual({ field: 'timeout.per', reason: 'FIELD_ENUM' });
    const badBool = withRules({});
    badBool.timeout.stopsClock = 1 as unknown as boolean;
    expect(validateRulesInput(badBool).errors).toContainEqual({ field: 'timeout.stopsClock', reason: 'FIELD_TYPE' });
    const badEnabled = withRules({});
    badEnabled.timeout.enabled = 'yes' as unknown as boolean;
    expect(validateRulesInput(badEnabled).errors).toContainEqual({ field: 'timeout.enabled', reason: 'FIELD_TYPE' });

    const unk = withRules({});
    (unk.timeout as unknown as Record<string, unknown>).extra = true;
    expect(validateRulesInput(unk).errors).toContainEqual({ field: 'timeout.extra', reason: 'UNKNOWN_FIELD' });

    const note = withRules({});
    note.timeout.note = '備'.repeat(200);
    expect(validateRulesInput(note).errors).toEqual([]);
    expect(rulesDocumentOf(note)?.rules.timeout.note).toBe('備'.repeat(200));
    note.timeout.note = '備'.repeat(201);
    expect(validateRulesInput(note).errors).toContainEqual({ field: 'timeout.note', reason: 'FIELD_LENGTH' });
  });

  test('球隊暫停關閉時可省略其餘欄位，開啟時必填', () => {
    const omit = withRules({});
    omit.timeout.enabled = false;
    const raw = omit.timeout as unknown as Record<string, unknown>;
    delete raw.per;
    delete raw.count;
    delete raw.seconds;
    delete raw.stopsClock;
    delete raw.extraTimeCount;
    expect(validateRulesInput(omit).errors).toEqual([]);
    expect(rulesDocumentOf(omit)?.rules.timeout).toEqual({
      enabled: false, per: 'half', count: 1, seconds: 60, stopsClock: true, extraTimeCount: 0, note: null
    });

    const noteOnly = withRules({});
    noteOnly.timeout = { enabled: false, note: '  看錶  ' } as typeof noteOnly.timeout;
    expect(rulesDocumentOf(noteOnly)?.rules.timeout).toEqual({
      enabled: false, per: 'half', count: 1, seconds: 60, stopsClock: true, extraTimeCount: 0, note: '看錶'
    });

    const nulled = withRules({});
    nulled.timeout.enabled = false;
    nulled.timeout.per = null as unknown as 'half';
    nulled.timeout.count = null as unknown as number;
    nulled.timeout.seconds = null as unknown as number;
    nulled.timeout.stopsClock = null as unknown as boolean;
    nulled.timeout.extraTimeCount = null as unknown as number;
    expect(rulesDocumentOf(nulled)?.rules.timeout).toMatchObject({
      enabled: false, per: 'half', count: 1, seconds: 60, stopsClock: true, extraTimeCount: 0
    });

    const kept = withRules({});
    kept.timeout.enabled = false;
    kept.timeout.per = 'match';
    kept.timeout.count = 4;
    kept.timeout.seconds = 45;
    kept.timeout.stopsClock = false;
    kept.timeout.extraTimeCount = 2;
    const keptDoc = rulesDocumentOf(kept);
    expect(keptDoc?.rules.timeout).toMatchObject({
      enabled: false, per: 'match', count: 4, seconds: 45, stopsClock: false, extraTimeCount: 2
    });
    expect(sameScoringInputs(resolveRules({ rules: keptDoc?.rules }), resolveRules({}))).toBe(true);

    const badOff = withRules({});
    badOff.timeout.enabled = false;
    badOff.timeout.count = 9;
    expect(validateRulesInput(badOff).errors).toContainEqual({ field: 'timeout.count', reason: 'FIELD_RANGE' });

    const onCount = withRules({});
    delete (onCount.timeout as unknown as Record<string, unknown>).count;
    expect(validateRulesInput(onCount).errors).toContainEqual({ field: 'timeout.count', reason: 'FIELD_REQUIRED' });
    const onPer = withRules({});
    delete (onPer.timeout as unknown as Record<string, unknown>).per;
    expect(validateRulesInput(onPer).errors).toContainEqual({ field: 'timeout.per', reason: 'FIELD_REQUIRED' });
    const onStops = withRules({});
    onStops.timeout.stopsClock = null as unknown as boolean;
    expect(validateRulesInput(onStops).errors).toContainEqual({ field: 'timeout.stopsClock', reason: 'FIELD_REQUIRED' });
    const onExtra = withRules({});
    delete (onExtra.timeout as unknown as Record<string, unknown>).extraTimeCount;
    expect(validateRulesInput(onExtra).errors).toContainEqual({ field: 'timeout.extraTimeCount', reason: 'FIELD_REQUIRED' });
    const onSeconds = withRules({});
    delete (onSeconds.timeout as unknown as Record<string, unknown>).seconds;
    expect(validateRulesInput(onSeconds).errors).toContainEqual({ field: 'timeout.seconds', reason: 'FIELD_REQUIRED' });

    const missing = withRules({});
    delete (missing as unknown as Record<string, unknown>).timeout;
    expect(validateRulesInput(missing).errors).toContainEqual({ field: 'timeout', reason: 'FIELD_REQUIRED' });
  });

  test('範本：五人制暫停開啟，七人與十一人關閉', () => {
    const on = {
      enabled: true, per: 'half' as const, count: 1, seconds: 60, stopsClock: true, extraTimeCount: 0, note: null
    };
    const off = { ...on, enabled: false };
    expect(RULE_TEMPLATES.five.timeout).toEqual(on);
    expect(RULE_TEMPLATES.seven.timeout).toEqual(off);
    expect(RULE_TEMPLATES.eleven.timeout).toEqual(off);
    expect(validateRulesInput(RULE_TEMPLATES.five).errors).toEqual([]);
    const changed = structuredClone(RULE_TEMPLATES.eleven);
    changed.timeout = {
      enabled: true, per: 'match', count: 5, seconds: 180, stopsClock: false, extraTimeCount: 3, note: '加時可再要'
    };
    expect(sameScoringInputs(RULE_TEMPLATES.eleven, changed)).toBe(true);
    expect(sameScoringInputs(RULE_TEMPLATES.five, RULE_TEMPLATES.seven)).toBe(true);
    expect(engineInputsOf(changed)).toEqual(engineInputsOf(RULE_TEMPLATES.eleven));
  });

  test('仁慈關閉時只改 cap，計分輸入相同', () => {
    const off7 = resolveRules({ rules: { mercy: { enabled: false, cap: 7 } } });
    const off9 = resolveRules({ rules: { mercy: { enabled: false, cap: 9 } } });
    expect(sameScoringInputs(off7, off9)).toBe(true);
    expect(off7.mercy.cap).toBe(7);
    expect(off9.mercy.cap).toBe(9);
    const on7 = resolveRules({ rules: { mercy: { enabled: true, cap: 7 } } });
    const on9 = resolveRules({ rules: { mercy: { enabled: true, cap: 9 } } });
    expect(sameScoringInputs(on7, on9)).toBe(false);
  });
});
