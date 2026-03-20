/* ================================================
   ColorCat — 養成數值模組（成長 / 體力 / AI / 物理）
   負責：集中管理所有可成長、可調整的遊戲數值
   未來對接資料庫時，只需修改 load() / save() 即可
   依賴：無（其他模組讀取本模組）
   ================================================ */
;(function() {

// ═══════════════════════════════════════════════
// 1. 角色基礎屬性（養成成長用）
// ═══════════════════════════════════════════════
var _base = {
  name: '',
  skin: 'whiteCat',
  level: 1,
  exp: 0,
  expToNext: 100,
};

// ═══════════════════════════════════════════════
// 2. 體力系統
// ═══════════════════════════════════════════════
var _stamina = {
  max: 100,
  current: 100,
  drain: 0.18,              // 運動消耗 / frame
  regenSleep: 0.35,         // 睡覺恢復 / frame（最快）
  regenIdle: 0.15,          // 待機恢復
  regenWeak: 0.20,          // 虛弱恢復（加速兩倍）
  regenWalk: 0.05,          // 散步恢復（最慢）
  weakThreshold1: 30,       // ≤30% → 虛弱等級 1
  weakThreshold2: 20,       // ≤20% → 虛弱等級 2
  recoverThreshold: 40,     // 虛弱1 恢復門檻 >40%
  // 虛弱2 需全滿才恢復（hardcoded logic）
};

// ═══════════════════════════════════════════════
// 3. AI 行為權重與時間
// ═══════════════════════════════════════════════
var _ai = {
  cooldownMin: 60,           // 最短等待 frame（2s @30fps）
  cooldownMax: 180,          // 最長等待 frame（6s）
  // 行為權重（百分比，總和 = 100）
  weights: {
    biteBall: 50,
    chase: 15,
    dash: 12,
    climbBox: 10,
    climbWall: 7,
    sleep: 6,
  },
  sleepBonusMultiplier: 0.8, // 體力低時睡覺加權 (60 - pct%) * mult
  // 紙箱上行為
  boxIdleMin: 90,            // 站紙箱上最短等待 frame
  boxIdleMax: 150,           // 站紙箱上最長等待 frame
  boxJumpChance: 0.5,        // 站紙箱原地跳機率
  boxJumpCountMax: 3,        // 最多跳幾次
  // 睡覺持續
  sleepDurationMin: 150,     // 最短睡覺 frame（5s）
  sleepDurationMax: 300,     // 最長睡覺 frame（10s）
};

// ═══════════════════════════════════════════════
// 4. 移動與物理
// ═══════════════════════════════════════════════
var _movement = {
  baseSpeed: 2.5,            // 角色基礎速度
  chaseSpeedMult: 1.0,       // 追球速度倍率（speed * mult）
  biteBallSpeedMult: 1.2,    // 咬球跑速度倍率
  wallRunSpeedMult: 1.2,     // 跑向牆壁速度倍率
  climbSpeed: 0.8,           // 爬梯子速度
  jumpOffVx: 1.5,            // 從紙箱跳下水平速度
  dashDistMinGround: 40,     // 地面翻滾最短距離
  dashDistMaxGround: 90,     // 地面翻滾最長距離
  dashDistMinBox: 15,        // 紙箱上短跑最短
  dashDistMaxBox: 35,        // 紙箱上短跑最長
  biteBallRunDistMin: 60,    // 咬球跑最短距離
  biteBallRunDistMax: 140,   // 咬球跑最長距離
  biteBallMaxDuration: 120,  // 咬球最長持續 frame
};

var _physics = {
  gravity: 0.25,             // 一般重力
  jumpVy: -3,                // 從紙箱跳下初速
  boxJumpVy: -3.5,           // 紙箱上原地跳初速
  wallJumpVy: -4,            // 爬牆跳初速
  ledgeGravity: 0.15,        // 爬牆跳上去的重力
  boxLandGravity: 0.3,       // 紙箱上跳落重力
  kickOffset: 18,            // 踢球時角色與球的距離
  hitFrame: 3,               // 攻擊動畫第幾格出手
};

// ═══════════════════════════════════════════════
// 5. 球物理
// ═══════════════════════════════════════════════
var _ball = {
  radius: 6.3,
  gravity: 0.15,
  friction: 0.985,
  bounceLoss: 0.35,
  wallBounceMult: 5,         // 左右牆反彈倍率
  groundFriction: 0.92,      // 落地後水平摩擦
  minBounceVy: 0.5,          // 低於此值停止彈跳
  minVx: 0.05,               // 低於此值水平歸零
  kickPowerMin: 1.5,         // 正常踢力
  kickPowerMax: 3.5,
  kickPowerEdgeMin: 3,       // 邊緣踢力
  kickPowerEdgeMax: 6,
  kickAngleMin: 0.1,         // 踢球角度範圍（π倍數）
  kickAngleMax: 0.4,
  edgeMargin: 20,            // 邊緣判定距離
};

// ═══════════════════════════════════════════════
// 6. 粒子特效
// ═══════════════════════════════════════════════
var _particles = {
  // 跑步煙塵
  dustSpawnInterval: 3,       // 每 N frame 噴一組
  dustCountPerSpawn: 3,       // 每組粒子數
  dustDecayMin: 0.03,
  dustDecayMax: 0.05,
  dustSizeMin: 2.5,
  dustSizeMax: 5.0,
  // 喘氣白煙
  breathWaveInterval: 28,     // 每 N frame 噴一波
  breathBaseCount: 3,         // 基礎粒子數（+random 0~1）
  breathLevelMult: [0, 1, 2, 4], // 等級 0/1/2/3 的倍率
  breathDecayMin: 0.02,
  breathDecayMax: 0.035,
  breathSizeMin: 1.5,
  breathSizeMax: 3.5,
  // 踢球灰塵
  kickDustCountMin: 5,
  kickDustCountMax: 8,
};

// ═══════════════════════════════════════════════
// 7. 運行時狀態（非設定值，但需要持久化）
// ═══════════════════════════════════════════════
var _runtime = {
  weakLevel: 0,               // 0=正常, 1=輕微, 2=嚴重
  totalActions: 0,            // 累計動作次數（未來成就用）
  totalKicks: 0,              // 累計踢球次數
  totalSleeps: 0,             // 累計睡覺次數
};

// ═══════════════════════════════════════════════
// 資料庫對接介面（預留）
// ═══════════════════════════════════════════════

/** 從資料庫載入角色數值，覆蓋預設值 */
function loadFromDB(data) {
  if (!data) return;
  _mergeDeep(_base, data.base);
  _mergeDeep(_stamina, data.stamina);
  _mergeDeep(_ai, data.ai);
  _mergeDeep(_movement, data.movement);
  _mergeDeep(_physics, data.physics);
  _mergeDeep(_ball, data.ball);
  _mergeDeep(_particles, data.particles);
  _mergeDeep(_runtime, data.runtime);
}

/** 匯出所有數值為 JSON（存回資料庫） */
function toJSON() {
  return {
    base: _clone(_base),
    stamina: _clone(_stamina),
    ai: _clone(_ai),
    movement: _clone(_movement),
    physics: _clone(_physics),
    ball: _clone(_ball),
    particles: _clone(_particles),
    runtime: _clone(_runtime),
  };
}

/** 重置為預設值 */
function resetToDefaults() {
  _stamina.current = _stamina.max;
  _runtime.weakLevel = 0;
  _runtime.totalActions = 0;
  _runtime.totalKicks = 0;
  _runtime.totalSleeps = 0;
}

// ═══════════════════════════════════════════════
// 工具函式
// ═══════════════════════════════════════════════

/** 深度合併（只更新已存在的 key） */
function _mergeDeep(target, source) {
  if (!source || typeof source !== 'object') return;
  var keys = Object.keys(source);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (target.hasOwnProperty(k)) {
      if (typeof target[k] === 'object' && !Array.isArray(target[k]) &&
          typeof source[k] === 'object' && !Array.isArray(source[k])) {
        _mergeDeep(target[k], source[k]);
      } else {
        target[k] = source[k];
      }
    }
  }
}

/** 淺複製 */
function _clone(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.slice();
  var result = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var v = obj[keys[i]];
    result[keys[i]] = (typeof v === 'object' && v !== null) ? _clone(v) : v;
  }
  return result;
}

// ═══════════════════════════════════════════════
// 公開 API
// ═══════════════════════════════════════════════
window.ColorCatStats = {
  // 直接讀取的數值群組
  base: _base,
  stamina: _stamina,
  ai: _ai,
  movement: _movement,
  physics: _physics,
  ball: _ball,
  particles: _particles,
  runtime: _runtime,

  // DB 對接
  load: loadFromDB,
  toJSON: toJSON,
  reset: resetToDefaults,
};

})();
