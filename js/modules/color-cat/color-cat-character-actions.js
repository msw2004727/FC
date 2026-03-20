/* ================================================
   ColorCat — 角色動作控制（開始/停止、移動更新）
   依賴：color-cat-character.js (ColorCatCharacter._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

// ── 放下球 ──
function releaseBall() {
  if (ch.action === 'biteBall') ColorCatBall.setCarried(false);
}

// ── 停止測試 ──
function stopTest() {
  _.testMode = null;
  ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 結束 combo ──
function endCombo() {
  _.comboStep = -1; _.comboType = '';
  ch.y = C.CHAR_GROUND_Y; ch.onGround = true;
}

// ── 測試動作 ──
function testAction(key) {
  var defs = ColorCatSprite.getDefs();
  var def = defs[key];
  if (!def) return;
  if (_.testMode === key) { stopTest(); return; }
  releaseBall();
  if (ch.action === 'combo' && _.comboType === 'box') {
    if (def.jumpVy) { ch._testBoxY = ch.y; }
    else {
      _.comboStep = -1; _.comboType = '';
      if (ch.y < C.CHAR_GROUND_Y) { ch.onGround = false; ch.vy = 0; }
      ch._testBoxY = 0;
    }
  } else { ch._testBoxY = 0; }
  _.testMode = key; ch.spriteFrame = 0; ch.spriteTimer = 0; ch.action = 'test';
  if (def.jumpVy) { ch.vy = def.jumpVy; ch.onGround = false; }
}

// ── 開始追球 ──
function startChase() {
  if (_.testMode) stopTest();
  releaseBall();
  if (ch.action === 'sleeping') {
    ch.action = 'chase'; ch.x = ch.x + C.SPRITE_DRAW / 3;
    ch.actionFrame = 0; ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') endCombo();
  ch.action = 'chase'; ch._chaseFacing = 0;
  ch.actionFrame = 0; ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 走向紙箱 ──
function startGoToBox(boxX) {
  if (_.testMode) stopTest();
  releaseBall();
  if (ch.action === 'sleeping') return;
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingGoToBox = boxX;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') endCombo();
  _.boxTargetX = boxX;
  ch.action = 'goToBox'; ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 點擊角色（短跑） ──
function tapCharacter(sceneWidth) {
  if (!_s()) return;
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    var bi = _.comboBoxInfo;
    var dir = Math.random() < 0.5 ? -1 : 1;
    var mv = _s().movement;
    var dist = mv.dashDistMinBox + Math.random() * (mv.dashDistMaxBox - mv.dashDistMinBox);
    _.dashTargetX = ch.x + dir * dist;
    var edgeL = bi.x - bi.halfW - 5, edgeR = bi.x + bi.halfW + 5;
    if (_.dashTargetX < edgeL) _.dashTargetX = edgeL;
    if (_.dashTargetX > edgeR) _.dashTargetX = edgeR;
    ch.facing = dir; ch.action = 'dash';
    ch.spriteFrame = 0; ch.spriteTimer = 0;
    ch._onBoxY = bi.topY + _.FOOT_OFFSET; return;
  }
  if (ch.action === 'chase' || ch.action === 'kick') ch.action = 'idle';
  if (ch.action !== 'idle') return;
  var dir2 = Math.random() < 0.5 ? -1 : 1;
  var mv2 = _s().movement;
  var dist2 = mv2.dashDistMinGround + Math.random() * (mv2.dashDistMaxGround - mv2.dashDistMinGround);
  _.dashTargetX = ch.x + dir2 * dist2;
  if (_.dashTargetX < 30) _.dashTargetX = 30;
  if (_.dashTargetX > sceneWidth - 30) _.dashTargetX = sceneWidth - 30;
  ch.facing = dir2; ch.action = 'dash';
  ch.spriteFrame = 0; ch.spriteTimer = 0; ch._onBoxY = 0;
}

// ── 從紙箱醒來 ──
function wakeUp(boxX) {
  if (ch.action !== 'sleeping') return;
  ch.action = 'idle'; ch.x = boxX + C.SPRITE_DRAW / 3;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 更新：睡覺中 ──
function updateSleeping() {
  if (!_.testMode && _.aiSceneInfo && _s()) {
    _.aiTimer++;
    var a = _s().ai;
    if (_.aiTimer >= a.sleepDurationMin + Math.floor(Math.random() * (a.sleepDurationMax - a.sleepDurationMin))) {
      wakeUp(_.aiSceneInfo.openingX); _.aiTimer = 0; _.aiResetCooldown();
    }
  }
  return false;
}

// ── 更新：從紙箱跳下 ──
function updateJumpOff() {
  if (!_s()) return false;
  ch.vy += _s().physics.gravity; ch.y += ch.vy;
  ch.x += _s().movement.jumpOffVx;
  if (ch.y >= C.CHAR_GROUND_Y) {
    ch.y = C.CHAR_GROUND_Y; ch.vy = 0; ch.onGround = true;
    if (_.pendingGoToBox) {
      _.boxTargetX = _.pendingGoToBox; _.pendingGoToBox = 0; ch.action = 'goToBox';
    } else { ch.action = 'chase'; ch.actionFrame = 0; }
    ch.spriteFrame = 0; ch.spriteTimer = 0;
  }
  return false;
}

// ── 更新：走向紙箱 ──
function updateGoToBox() {
  var boxDist = _.boxTargetX - ch.x;
  if (boxDist > 2) ch.facing = 1;
  else if (boxDist < -2) ch.facing = -1;
  if (Math.abs(boxDist) > 8) {
    ch.x += (boxDist > 0 ? 1 : -1) * ch.speed;
  } else {
    ch.action = 'sleeping'; ch.spriteFrame = 0; ch.spriteTimer = 0; _.aiTimer = 0;
  }
  return false;
}

// ── 更新：短跑 ──
function updateDash() {
  var dashDist = _.dashTargetX - ch.x;
  if (Math.abs(dashDist) > 3) {
    ch.x += (dashDist > 0 ? 1 : -1) * ch.speed;
  } else {
    if (ch._onBoxY) {
      ch.action = 'combo'; _.comboType = 'box'; _.comboStep = 2;
      ch.y = ch._onBoxY; ch._onBoxY = 0;
    } else { ch.action = 'idle'; }
    ch.spriteFrame = 0; ch.spriteTimer = 0;
  }
  if (ch._onBoxY) {
    ch.y = ch._onBoxY;
    var bi = _.comboBoxInfo;
    if (bi && (ch.x < bi.x - bi.halfW || ch.x > bi.x + bi.halfW)) {
      ch._onBoxY = 0; ch.action = 'jumpOff'; ch.onGround = false; ch.vy = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  }
  return false;
}

// 註冊到共享狀態
_.releaseBall = releaseBall;
_.stopTest = stopTest;
_.endCombo = endCombo;
_.testAction = testAction;
_.startChase = startChase;
_.startGoToBox = startGoToBox;
_.tapCharacter = tapCharacter;
_.wakeUp = wakeUp;
_.updateSleeping = updateSleeping;
_.updateJumpOff = updateJumpOff;
_.updateGoToBox = updateGoToBox;
_.updateDash = updateDash;

})();
