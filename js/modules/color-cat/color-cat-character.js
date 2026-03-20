/* ================================================
   ColorCat — 角色核心（狀態、初始化、更新迴圈、公開 API）
   子模組透過 ColorCatCharacter._ 存取共享狀態並註冊函式
   依賴：color-cat-config.js, color-cat-stats.js, color-cat-sprite.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var S; function _s() { if (!S) S = window.ColorCatStats; return S; }

// ── 角色狀態 ──
var character = {
  x: 0, y: C.CHAR_GROUND_Y, vy: 0,
  get speed() { return _s() ? _s().movement.baseSpeed : 2.5; },
  facing: 1, action: 'idle', actionFrame: 0,
  spriteFrame: 0, spriteTimer: 0, onGround: true,
};

// ── 內部共享狀態（子模組透過 ColorCatCharacter._ 存取） ──
var _ = {
  char: character, _s: _s,
  testMode: null,
  comboType: '', comboStep: -1, comboTimer: 0, comboSceneW: 0,
  comboBoxInfo: null, boxJumpsLeft: 0,
  boxTargetX: 0, dashTargetX: 0, pendingGoToBox: 0,
  suppressGroundShadow: false,
  biteBallPhase: 0, biteBallTimer: 0, biteBallTargetX: 0,
  jumpOffPhase: 0, jumpOffWalkDist: 0,
  knockbackPhase: 0, knockbackTimer: 0, knockbackRollDist: 0, knockbackSpeedX: 5,
  watchFlowerRef: null, watchFlowerTimer: 0, watchFlowerDuration: 150, watchFlowerTargetX: 0,
  pendingWeak: false,
  aiTimer: 0, aiCooldown: 0, aiSceneInfo: null,
  COMBO_LEDGE_Y: 73, FOOT_OFFSET: 7,
  isBunny: function() {
    var sk = window.ColorCatSprite ? ColorCatSprite.getSkin() : 'whiteCat';
    var skin = C.SKINS[sk];
    return skin && skin.species === 'bunny';
  },
};

// 子模組函式插槽（載入時由各子模組填入實作）
_.updateStamina = function() {};
_.drawStaminaBar = function() {};
_.updateDust = function() {};
_.drawDust = function() {};
_.updateBreath = function() {};
_.drawBreath = function() {};
_.isRunning = function() { return false; };
_.aiResetCooldown = function() { _.aiCooldown = 120; _.aiTimer = 0; };
_.aiPickAction = function() {};
_.aiSetSceneInfo = function(info) { _.aiSceneInfo = info; };
_.startChase = function() {};
_.startGoToBox = function() {};
_.startComboWall = function() {};
_.startComboBox = function() {};
_.startBiteBall = function() {};
_.wakeUp = function() {};
_.tapCharacter = function() {};
_.testAction = function() {};
_.stopTest = function() {
  _.testMode = null; character.action = 'idle';
  character.spriteFrame = 0; character.spriteTimer = 0;
};
_.endCombo = function() {
  _.comboStep = -1; _.comboType = '';
  character.y = C.CHAR_GROUND_Y; character.onGround = true;
};
_.releaseBall = function() {};
_.updateSleeping = function() { return false; };
_.updateJumpOff = function() { return false; };
_.updateCombo = function() { return false; };
_.updateGoToBox = function() { return false; };
_.updateBiteBall = function() { return false; };
_.updateDash = function() { return false; };
_.updateChaseKickIdle = function() { return false; };
_.startKnockback = function() {};
_.updateKnockback = function() { return false; };
_.updateHearts = function() {};
_.drawHearts = function() {};
_.updateWatchFlower = function() { return false; };
_.updateGoToFlower = function() { return false; };
_.startWatchFlower = function() {};
_.spawnKnockbackBurst = function() {};
_.updateKnockDust = function() {};
_.drawKnockDust = function() {};

// ── 初始化 ──
function initCharacter(sceneWidth) {
  character.x = sceneWidth * 0.35;
  character.y = C.CHAR_GROUND_Y; character.vy = 0;
  character.action = 'idle'; character.onGround = true;
  character.spriteFrame = 0; character.spriteTimer = 0;
  if (_s()) { _s().stamina.current = _s().stamina.max; _s().runtime.weakLevel = 0; }
  ColorCatSprite.init();
  _.aiResetCooldown();
}

// ── 精靈 key 對應 ──
function getSpriteKey() {
  if (_.testMode) return _.testMode;
  if (character.action === 'combo') {
    if (_.comboType === 'wall') {
      if (_.comboStep === 0) return 'run';
      if (_.comboStep === 1) return 'jump';
      if (_.comboStep === 2) return _.isBunny() ? 'wall_slide' : 'ledge_idle';
      if (_.comboStep === 3) return _.isBunny() ? 'wall_slide' : 'ledge_land';
      if (_.comboStep === 4) return 'jump';
    } else if (_.comboType === 'box') {
      if (_.comboStep === 0) return 'run';
      if (_.comboStep === 1) return _.isBunny() ? 'jump' : 'climb';
      if (_.comboStep === 2) return 'idle';
      if (_.comboStep === 3) return 'jump';
    }
    return 'idle';
  }
  if (character.action === 'jumpOff') return _.jumpOffPhase === 1 ? 'run' : _.jumpOffPhase === 2 ? 'idle' : 'jump';
  if (character.action === 'chase') return 'run';
  if (character.action === 'dash') return 'roll';
  if (character.action === 'goToBox') return 'run';
  if (character.action === 'biteBall') return 'run';
  if (character.action === 'kick') return 'attack';
  if (character.action === 'sleeping') return 'idle';
  if (character.action === 'watchFlower') return 'idle';
  if (character.action === 'goToFlower') return 'run';
  if (character.action === 'weak') return _.isBunny() ? 'death' : 'idle';
  if (character.action === 'knockback') return _.knockbackPhase === 2 ? 'idle' : 'roll';
  if (!character.onGround) return 'jump';
  return 'idle';
}

// ── 主更新（每 frame 呼叫），回傳 true 表示踢到球 ──
function updateCharacter(sceneWidth, ballState) {
  var sw = sceneWidth;
  _.updateStamina();
  var defs = ColorCatSprite.getDefs();
  var key = getSpriteKey();
  var def = defs[key];

  // 精靈動畫 frame 推進
  if (def) {
    character.spriteTimer += def.speed;
    if (character.spriteTimer >= 1) {
      character.spriteTimer -= 1;
      // 兔子虛弱恢復：反轉播放倒地動畫
      if (_.weakRecovering) {
        character.spriteFrame--;
        if (character.spriteFrame <= 0) {
          _.weakRecovering = false;
          character.action = 'idle';
          character.spriteFrame = 0; character.spriteTimer = 0;
          _.aiResetCooldown();
        }
      } else {
        character.spriteFrame++;
        if (character.spriteFrame >= def.frames) {
          // 力竭倒地：停在最後一幀
          if (character.action === 'weak' && _.isBunny()) {
            character.spriteFrame = def.frames - 1;
          } else {
            character.spriteFrame = 0;
          }
          if (_.testMode) {
            var testDef = defs[_.testMode];
            if (testDef.type === 'once') { _.stopTest(); return false; }
          }
        }
      }
    }
  }

  // 垂直物理（combo/jumpOff 自行處理，跳過）
  if (!character.onGround && character.action !== 'combo' && character.action !== 'jumpOff' && character.action !== 'knockback') {
    var floorY = character._testBoxY || C.CHAR_GROUND_Y;
    if (_s()) character.vy += _s().physics.gravity;
    character.y += character.vy;
    if (character.y >= floorY) {
      character.y = floorY; character.vy = 0; character.onGround = true;
      if (character._testBoxY) {
        character._testBoxY = 0;
        character.action = 'combo'; _.comboType = 'box'; _.comboStep = 2; _.comboTimer = 0;
        character.spriteFrame = 0; character.spriteTimer = 0;
      }
    }
  }

  // 測試模式：移動類動作
  if (_.testMode) {
    var testDef = defs[_.testMode];
    if (testDef && testDef.type === 'move' && testDef.moveSpeed) {
      character.x += testDef.moveSpeed * character.facing;
      if (character.x < C.SPRITE_DRAW / 2) { character.x = C.SPRITE_DRAW / 2; character.facing = 1; }
      if (character.x > sw - C.SPRITE_DRAW / 2) { character.x = sw - C.SPRITE_DRAW / 2; character.facing = -1; }
    }
    return false;
  }

  // 行動委派至子模組
  if (character.action === 'sleeping') return _.updateSleeping(sw);
  if (character.action === 'jumpOff') return _.updateJumpOff(sw);
  if (character.action === 'combo') return _.updateCombo(sw, defs);
  if (character.action === 'goToBox') return _.updateGoToBox();
  if (character.action === 'biteBall') return _.updateBiteBall(sw, ballState);
  if (character.action === 'dash') return _.updateDash(sw);
  if (character.action === 'knockback') return _.updateKnockback(sw);
  if (character.action === 'watchFlower') return _.updateWatchFlower(sw);
  if (character.action === 'goToFlower') return _.updateGoToFlower(sw);
  return _.updateChaseKickIdle(sw, ballState, defs);
}

// ── 繪製（委派給子模組與 ColorCatSprite） ──
function drawCharacter(ctx, light) {
  _.updateDust();
  _.updateBreath();
  _.updateHearts();
  _.updateKnockDust();
  _.drawDust(ctx, light !== undefined ? light : true);
  _.drawKnockDust(ctx, light !== undefined ? light : true);
  if (character.action === 'sleeping') return;
  var key = getSpriteKey();
  var noShadow = _.suppressGroundShadow ||
    (character.action === 'combo' && _.comboType === 'box' && _.comboStep >= 1) ||
    character.action === 'jumpOff';
  ColorCatSprite.draw(ctx, key, character.spriteFrame, character.x, character.y, character.facing, noShadow);
  _.drawBreath(ctx);
  _.drawHearts(ctx);
  _.drawStaminaBar(ctx);
}

// ── 角色點擊判定 ──
function isCharClicked(cx, cy) {
  if (character.action === 'sleeping') return false;
  var halfW = C.SPRITE_DRAW / 2;
  var charTop = character.y - C.SPRITE_DRAW;
  return cx >= character.x - halfW && cx <= character.x + halfW &&
         cy >= charTop && cy <= character.y;
}

// ── 公開 API ──
window.ColorCatCharacter = {
  state: character,
  init: initCharacter,
  update: updateCharacter,
  draw: drawCharacter,
  startChase: function() { _.startChase(); },
  switchSkin: function(sk) { ColorCatSprite.switchSkin(sk); },
  testAction: function(key) { _.testAction(key); },
  stopTest: function() { _.stopTest(); },
  getSkin: function() { return ColorCatSprite.getSkin(); },
  getTestMode: function() { return _.testMode; },
  startGoToBox: function(boxX) { _.startGoToBox(boxX); },
  wakeUp: function(boxX) { _.wakeUp(boxX); },
  isSleeping: function() { return character.action === 'sleeping'; },
  isClicked: isCharClicked,
  tap: function(sw) { _.tapCharacter(sw); },
  startComboWall: function(sw) { _.startComboWall(sw); },
  startComboBox: function(sw, x, y, w) { _.startComboBox(sw, x, y, w); },
  startBiteBall: function(sw) { _.startBiteBall(sw); },
  startKnockback: function(sw) { _.startKnockback(sw); },
  getSpriteKey: getSpriteKey,
  setSuppressGroundShadow: function(v) { _.suppressGroundShadow = !!v; },
  setSceneInfo: function(info) { _.aiSetSceneInfo(info); },
  setWeak: function(level) {
    if (!_s()) return;
    var rt = _s().runtime;
    var lv = level === true ? 1 : (parseInt(level) || 0);
    if (lv > 0) {
      rt.weakLevel = Math.min(lv, 3);
      _s().stamina.current = 0;  // 體力歸零觸發力竭
      character.action = 'weak'; character.spriteFrame = 0; character.spriteTimer = 0;
    } else {
      rt.weakLevel = 0;
      if (character.action === 'weak') { character.action = 'idle'; character.spriteFrame = 0; character.spriteTimer = 0; }
    }
  },
  isWeak: function() { return character.action === 'weak'; },
  getWeakLevel: function() { return _s() ? _s().runtime.weakLevel : 0; },
  getStamina: function() { return _s() ? _s().stamina.current : 100; },
  getStaminaMax: function() { return _s() ? _s().stamina.max : 100; },
  getStats: function() { return _s(); },
  _: _,
};

})();
