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
  if (ch.action === 'weak') return;
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
  if (ch.action === 'weak') return;
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
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') endCombo();
  ch.action = 'chase'; ch._chaseFacing = 0;
  ch.actionFrame = 0; ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 走向紙箱 ──
function startGoToBox(boxX) {
  if (ch.action === 'weak') return;
  if (_.testMode) stopTest();
  releaseBall();
  if (ch.action === 'sleeping') return;
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingGoToBox = boxX;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
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
// phase 0: 跳躍弧線（重力+水平移動）
// phase 1: 落地後向右散步一段距離，再銜接下一個動作
function updateJumpOff() {
  if (!_s()) return false;
  if (_.jumpOffPhase === 0) {
    ch.vy += _s().physics.gravity; ch.y += ch.vy;
    ch.x += _s().movement.jumpOffVx;
    if (ch.y >= C.CHAR_GROUND_Y) {
      ch.y = C.CHAR_GROUND_Y; ch.vy = 0; ch.onGround = true;
      if (_.pendingGoToBox) {
        _.boxTargetX = _.pendingGoToBox; _.pendingGoToBox = 0;
        ch.action = 'goToBox'; ch.spriteFrame = 0; ch.spriteTimer = 0;
        return false;
      }
      // 落地後進入散步階段
      _.jumpOffPhase = 1; _.jumpOffWalkDist = 0;
      ch.facing = 1; ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  } else if (_.jumpOffPhase === 1) {
    // 散步離開
    var walkSpeed = ch.speed * 0.7;
    ch.x += ch.facing * walkSpeed;
    _.jumpOffWalkDist += walkSpeed;
    if (_.jumpOffWalkDist >= 40) {
      _.jumpOffPhase = 0;
      ch.action = 'chase'; ch.actionFrame = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  } else if (_.jumpOffPhase === 2) {
    // 攀牆落地：原地面左待機 1 秒（30 frames @30fps）
    ch.facing = -1;
    _.jumpOffWalkDist++;
    if (_.jumpOffWalkDist >= 30) {
      _.jumpOffPhase = 1; _.jumpOffWalkDist = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
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
      _.jumpOffPhase = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  }
  return false;
}

// ── 被面板撞飛 ──
// phase 0: 向左拋物線飛行（roll 精靈水平翻轉）
// phase 1: 落地翻滾減速
// phase 2: 喘氣靜止 3 秒
function startKnockback(sw) {
  if (ch.action === 'sleeping' || ch.action === 'knockback') return;
  releaseBall();
  if (ch.action === 'combo') endCombo();
  _.knockbackPhase = 0; _.knockbackTimer = 0; _.knockbackRollDist = 0;
  _.knockbackSpeedX = 8;
  ch.action = 'knockback'; ch.facing = -1;
  ch.vy = _s() ? _s().physics.jumpVy : -3;   // 拋物線弧度
  ch.onGround = false;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateKnockback(sw) {
  if (_.knockbackPhase === 0) {
    // 拋物線飛行：自身水平速度 + 不超過欄位邊緣
    if (_s()) ch.vy += _s().physics.gravity;
    ch.y += ch.vy;
    ch.x -= _.knockbackSpeedX;
    var edgeX = sw - C.SPRITE_DRAW / 2;
    if (ch.x > edgeX) ch.x = edgeX;
    if (ch.x < C.SPRITE_DRAW / 2) ch.x = C.SPRITE_DRAW / 2;
    if (ch.y >= C.CHAR_GROUND_Y) {
      ch.y = C.CHAR_GROUND_Y; ch.vy = 0; ch.onGround = true;
      _.knockbackPhase = 1; _.knockbackRollDist = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  } else if (_.knockbackPhase === 1) {
    // 翻滾減速（距離 3 倍）
    var rollSpeed = 9 * Math.max(0, 1 - _.knockbackRollDist / 90);
    ch.x -= rollSpeed; _.knockbackRollDist += rollSpeed;
    if (ch.x < C.SPRITE_DRAW / 2) ch.x = C.SPRITE_DRAW / 2;
    if (rollSpeed < 0.3 || _.knockbackRollDist >= 90) {
      _.knockbackPhase = 2; _.knockbackTimer = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  } else {
    // 喘氣 3 秒（90 frames @30fps）
    _.knockbackTimer++;
    if (_.knockbackTimer >= 90) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  }
  return false;
}

// ── 看花：走向花朵旁待機 + 愛心 ──
var WATCH_FLOWER_MIN = 150;  // 最少 5 秒（150 frames @30fps）

function startWatchFlower(sw) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_ || !scene_.getBloomedFlowers) return;
  var bloomed = scene_.getBloomedFlowers();
  if (bloomed.length === 0) return;
  // 金花權重 2 倍（多 100% 機率被選中）
  var pool = [];
  for (var fi = 0; fi < bloomed.length; fi++) {
    pool.push(bloomed[fi]);
    if (bloomed[fi].gold) pool.push(bloomed[fi]);
  }
  var f = pool[Math.floor(Math.random() * pool.length)];
  if (_.testMode) _.stopTest();
  releaseBall();
  if (ch.action === 'combo') endCombo();
  _.watchFlowerRef = f;
  _.watchFlowerTimer = 0;
  _.watchFlowerDuration = WATCH_FLOWER_MIN + Math.floor(Math.random() * 90);  // 5~8 秒
  // 目標：花旁邊 10~15px
  var side = (ch.x < f.x) ? -1 : 1;
  _.watchFlowerTargetX = f.x + side * (10 + Math.random() * 5);
  ch.action = 'goToFlower';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateGoToFlower(sw) {
  var f = _.watchFlowerRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  // 花消失 → 回閒置
  if (!f || !scene_ || !scene_.isFlowerAlive(f)) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.watchFlowerRef = null;
    return false;
  }
  var dist = _.watchFlowerTargetX - ch.x;
  if (Math.abs(dist) > 4) {
    ch.facing = dist > 0 ? 1 : -1;
    ch.x += ch.facing * ch.speed;
  } else {
    // 到達花旁，轉為看花
    ch.facing = (f.x > ch.x) ? 1 : -1;
    ch.action = 'watchFlower';
    _.watchFlowerTimer = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0;
  }
  return false;
}

function updateWatchFlower(sw) {
  var f = _.watchFlowerRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  _.watchFlowerTimer++;
  // 花消失或被摘 + 已過最低時間 → 結束
  var flowerGone = !f || !scene_ || !scene_.isFlowerAlive(f);
  if (flowerGone && _.watchFlowerTimer >= WATCH_FLOWER_MIN) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.watchFlowerRef = null; _.aiResetCooldown();
    return false;
  }
  // 自然結束（5~8 秒）
  if (_.watchFlowerTimer >= _.watchFlowerDuration) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.watchFlowerRef = null; _.aiResetCooldown();
  }
  return false;
}

// ── 追蝴蝶：跑向蝴蝶 → 接近時蝴蝶逃走 → 追到離場 ──
var CHASE_BUTTERFLY_SPEED = 2.0;  // 必須 < 蝴蝶逃跑速度 (2.5+)
var CHASE_BUTTERFLY_TRIGGER_DIST = 25;  // 接近多少 px 時觸發蝴蝶逃跑

function startChaseButterfly(sw) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_ || !scene_.getHoveringButterflies) return;
  var hovering = scene_.getHoveringButterflies();
  if (hovering.length === 0) return;
  var b = hovering[Math.floor(Math.random() * hovering.length)];
  if (_.testMode) _.stopTest();
  releaseBall();
  if (ch.action === 'combo') endCombo();
  _.chaseButterflyRef = b;
  ch.action = 'chaseButterfly';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateChaseButterfly(sw) {
  var b = _.chaseButterflyRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  // 蝴蝶已離場（被移除） → 結束追逐
  if (!b || !scene_ || !scene_.isButterflyAlive(b)) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.chaseButterflyRef = null; _.aiResetCooldown();
    return false;
  }
  // 跑向蝴蝶
  var dx = b.x - ch.x;
  ch.facing = dx > 0 ? 1 : -1;
  ch.x += ch.facing * CHASE_BUTTERFLY_SPEED;
  // 邊界限制
  if (ch.x < C.SPRITE_DRAW / 2) ch.x = C.SPRITE_DRAW / 2;
  if (ch.x > sw - C.SPRITE_DRAW / 2) ch.x = sw - C.SPRITE_DRAW / 2;
  // 接近蝴蝶 → 觸發逃跑
  var dist = Math.abs(dx);
  if (dist < CHASE_BUTTERFLY_TRIGGER_DIST && b.phase === 'hover') {
    if (scene_.startButterflyFlee) scene_.startButterflyFlee(b);
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
_.startKnockback = startKnockback;
_.updateKnockback = updateKnockback;
_.startWatchFlower = startWatchFlower;
_.updateGoToFlower = updateGoToFlower;
_.updateWatchFlower = updateWatchFlower;
_.startChaseButterfly = startChaseButterfly;
_.updateChaseButterfly = updateChaseButterfly;

})();
