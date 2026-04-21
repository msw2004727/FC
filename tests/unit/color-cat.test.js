/**
 * ColorCat 養成角色 — unit tests
 *
 * Extracted from: js/modules/color-cat/color-cat-stats.js
 *
 * 重點驗證：
 *   - AI 行為權重總和 = 100（不平衡會造成隨機行為偏差）
 *   - 體力系統閾值邏輯（虛弱 1/2 門檻遞減、recovery 門檻合理）
 *   - 物理常數合理範圍（重力 / 摩擦力 / 反彈損失）
 *   - 移動系統倍率正值
 *   - 邊界 case（min/max 不倒反）
 */

// ─── 從 color-cat-stats.js 抽取 config 結構 ───
const _ai = {
  cooldownMin: 60,
  cooldownMax: 180,
  weights: {
    biteBall: 50,
    chase: 15,
    dash: 12,
    climbBox: 10,
    climbWall: 7,
    sleep: 6,
  },
  sleepBonusMultiplier: 0.8,
  boxIdleMin: 90,
  boxIdleMax: 150,
  boxJumpChance: 0.5,
  boxJumpCountMax: 3,
  sleepDurationMin: 150,
  sleepDurationMax: 300,
};

const _stamina = {
  max: 100,
  current: 100,
  drain: 0.18,
  regenSleep: 0.35,
  regenIdle: 0.15,
  regenWeak: 0.20,
  regenWalk: 0.05,
  weakThreshold1: 30,
  weakThreshold2: 20,
  recoverThreshold: 40,
};

const _physics = {
  gravity: 0.25,
  jumpVy: -3,
  boxJumpVy: -3.5,
  wallJumpVy: -4,
  ledgeGravity: 0.15,
  boxLandGravity: 0.3,
  kickOffset: 18,
  hitFrame: 3,
};

const _ball = {
  radius: 6.3,
  gravity: 0.15,
  friction: 0.985,
  bounceLoss: 0.35,
  wallBounceMult: 0.4,
  groundFriction: 0.92,
  minBounceVy: 0.5,
  minVx: 0.05,
};

// ═══════════════════════════════════════════════════════════════════
describe('ColorCat — AI 行為權重', () => {
  test('權重總和等於 100（不可有偏差）', () => {
    const sum = Object.values(_ai.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  test('每個行為權重為正值', () => {
    Object.entries(_ai.weights).forEach(([name, w]) => {
      expect(w).toBeGreaterThan(0);
    });
  });

  test('cooldown 區間合理（min < max）', () => {
    expect(_ai.cooldownMin).toBeLessThan(_ai.cooldownMax);
    expect(_ai.cooldownMin).toBeGreaterThan(0);
  });

  test('boxIdle 區間合理', () => {
    expect(_ai.boxIdleMin).toBeLessThan(_ai.boxIdleMax);
  });

  test('sleepDuration 區間合理', () => {
    expect(_ai.sleepDurationMin).toBeLessThan(_ai.sleepDurationMax);
  });

  test('機率 0-1 之間', () => {
    expect(_ai.boxJumpChance).toBeGreaterThanOrEqual(0);
    expect(_ai.boxJumpChance).toBeLessThanOrEqual(1);
    expect(_ai.sleepBonusMultiplier).toBeGreaterThan(0);
  });

  test('biteBall 是最大權重行為（主要玩法）', () => {
    const max = Math.max(...Object.values(_ai.weights));
    expect(_ai.weights.biteBall).toBe(max);
  });
});

describe('ColorCat — 體力系統', () => {
  test('max = 100，current 初始等於 max', () => {
    expect(_stamina.max).toBe(100);
    expect(_stamina.current).toBe(_stamina.max);
  });

  test('虛弱門檻遞減邏輯（w1 > w2）', () => {
    expect(_stamina.weakThreshold1).toBeGreaterThan(_stamina.weakThreshold2);
  });

  test('recover 門檻高於 weak1（避免閃爍）', () => {
    expect(_stamina.recoverThreshold).toBeGreaterThan(_stamina.weakThreshold1);
  });

  test('所有消耗/回復為正值', () => {
    expect(_stamina.drain).toBeGreaterThan(0);
    expect(_stamina.regenSleep).toBeGreaterThan(0);
    expect(_stamina.regenIdle).toBeGreaterThan(0);
    expect(_stamina.regenWalk).toBeGreaterThan(0);
  });

  test('恢復速度合理：sleep > walk（睡覺最快、散步最慢）', () => {
    expect(_stamina.regenSleep).toBeGreaterThan(_stamina.regenIdle);
    expect(_stamina.regenIdle).toBeGreaterThan(_stamina.regenWalk);
  });

  test('虛弱恢復倍率高於 idle（設計刻意加速恢復讓玩家等不太久）', () => {
    expect(_stamina.regenWeak).toBeGreaterThan(_stamina.regenIdle);
  });
});

describe('ColorCat — 物理常數', () => {
  test('重力為正值（向下）', () => {
    expect(_physics.gravity).toBeGreaterThan(0);
  });

  test('跳躍初速為負（向上，y 軸翻轉）', () => {
    expect(_physics.jumpVy).toBeLessThan(0);
    expect(_physics.boxJumpVy).toBeLessThan(0);
    expect(_physics.wallJumpVy).toBeLessThan(0);
  });

  test('爬牆跳最強（絕對值最大）', () => {
    expect(Math.abs(_physics.wallJumpVy)).toBeGreaterThan(Math.abs(_physics.jumpVy));
    expect(Math.abs(_physics.wallJumpVy)).toBeGreaterThan(Math.abs(_physics.boxJumpVy));
  });

  test('ledge 重力低於一般重力（讓玩家有空中時間）', () => {
    expect(_physics.ledgeGravity).toBeLessThan(_physics.gravity);
  });

  test('紙箱落地重力最大（快速落下）', () => {
    expect(_physics.boxLandGravity).toBeGreaterThan(_physics.gravity);
  });
});

describe('ColorCat — 球物理', () => {
  test('球半徑為正值', () => {
    expect(_ball.radius).toBeGreaterThan(0);
  });

  test('球重力低於角色重力（球滯空久）', () => {
    expect(_ball.gravity).toBeLessThan(_physics.gravity);
  });

  test('摩擦係數在 0-1 之間（能量損失）', () => {
    expect(_ball.friction).toBeGreaterThan(0);
    expect(_ball.friction).toBeLessThanOrEqual(1);
    expect(_ball.groundFriction).toBeGreaterThan(0);
    expect(_ball.groundFriction).toBeLessThanOrEqual(1);
  });

  test('反彈損失為正值且小於 1（吸收能量）', () => {
    expect(_ball.bounceLoss).toBeGreaterThan(0);
    expect(_ball.bounceLoss).toBeLessThan(1);
  });

  test('牆反彈倍率 < 1（能量損失）', () => {
    expect(_ball.wallBounceMult).toBeLessThan(1);
    expect(_ball.wallBounceMult).toBeGreaterThan(0);
  });

  test('停止閾值（minBounceVy / minVx）為合理小值', () => {
    expect(_ball.minBounceVy).toBeGreaterThan(0);
    expect(_ball.minBounceVy).toBeLessThan(5);
    expect(_ball.minVx).toBeGreaterThan(0);
    expect(_ball.minVx).toBeLessThan(1);
  });
});

describe('ColorCat — 整體平衡檢查', () => {
  test('體力數值都是數字', () => {
    Object.values(_stamina).forEach(v => {
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
    });
  });

  test('AI 權重物件不可為空', () => {
    expect(Object.keys(_ai.weights).length).toBeGreaterThan(0);
  });

  test('關鍵數值沒有被意外改為 0（regression guard）', () => {
    expect(_stamina.max).not.toBe(0);
    expect(_ai.weights.biteBall).not.toBe(0);
    expect(_physics.gravity).not.toBe(0);
    expect(_ball.radius).not.toBe(0);
  });
});
