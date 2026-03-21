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

// ── 中斷 combo（攀牆時正常墜落而非瞬移地面） ──
function interruptCombo() {
  if (_.comboType === 'wall' && ch.y < C.CHAR_GROUND_Y - 5) {
    _.comboStep = 4; ch.vy = 0; ch.onGround = false;
    ch.spriteFrame = 0; ch.spriteTimer = 0;
    return true;  // 正在墜落，呼叫者應 return
  }
  endCombo();
  return false;
}

// ── 測試動作 ──
function testAction(key) {
  if (ch.action === 'weak' || ch.action === 'dying' || ch.action === 'hurt') return;
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
  if (ch.action === 'weak' || ch.action === 'dying' || ch.action === 'hurt') return;
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
  if (ch.action === 'combo') { if (interruptCombo()) return; }
  ch.action = 'chase'; ch._chaseFacing = 0;
  ch.actionFrame = 0; ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 走向紙箱 ──
function startGoToBox(boxX) {
  if (ch.action === 'weak' || ch.action === 'dying' || ch.action === 'hurt') return;
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
  if (ch.action === 'combo') { if (interruptCombo()) return; }
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
      // 待攻擊花朵
      if (_.pendingAttackFlower) {
        var pf = _.pendingAttackFlower; _.pendingAttackFlower = null;
        var scene_f = window.ColorCatScene && window.ColorCatScene._;
        if (pf && scene_f && scene_f.isFlowerAlive && scene_f.isFlowerAlive(pf)) {
          _.attackFlowerRef = pf; _.attackFlowerPhase = 0;
          ch.action = 'attackFlower'; ch.spriteFrame = 0; ch.spriteTimer = 0;
          return false;
        }
      }
      // 待攻擊蝴蝶
      if (_.pendingAttackButterfly) {
        var pb = _.pendingAttackButterfly; _.pendingAttackButterfly = null;
        var scene_b = window.ColorCatScene && window.ColorCatScene._;
        if (pb && scene_b && scene_b.isButterflyAlive && scene_b.isButterflyAlive(pb)) {
          _.attackButterflyRef = pb; _.attackButterflyPhase = 0;
          ch.action = 'attackButterfly'; ch.spriteFrame = 0; ch.spriteTimer = 0;
          return false;
        }
      }
      // 待大絕招
      if (_.pendingUltimate) {
        _.pendingUltimate = false;
        ch.action = 'ultimate'; _.ultAnimTimer = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
        return false;
      }
      // 待攻擊敵人
      if (_.pendingAttackEnemy >= 0) {
        var pe = _.pendingAttackEnemy; _.pendingAttackEnemy = -1;
        var E = window.ColorCatEnemy;
        if (E) {
          var enemies = E.getAll();
          if (enemies[pe] && !enemies[pe].dead) {
            _.attackEnemyIdx = pe; _.attackEnemyPhase = 0;
            ch.action = 'attackEnemy'; ch.spriteFrame = 0; ch.spriteTimer = 0;
            return false;
          }
        }
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
  if (ch.action === 'combo') { endCombo(); }  // knockback 強制落地（被面板撞飛）
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
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
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
  if (ch.action === 'combo') { if (interruptCombo()) return; }
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

// ── 攻擊花朵：跑到花旁 → 攻擊動畫 → 命中花朵打倒 ──
function startAttackFlower(f) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!f || !scene_ || !scene_.isFlowerAlive(f)) return;
  if (_.testMode) stopTest();
  releaseBall();
  // 在紙箱上 → 先跳下再攻擊
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingAttackFlower = f;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') { if (interruptCombo()) return; }
  _.attackFlowerRef = f;
  _.attackFlowerPhase = 0;  // 0=跑過去, 1=攻擊
  ch.action = 'attackFlower';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateAttackFlower(sw) {
  var f = _.attackFlowerRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!f || !scene_) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.attackFlowerRef = null; _.aiResetCooldown();
    return false;
  }
  if (_.attackFlowerPhase === 0) {
    // 花已消失 → 回閒置
    if (!scene_.isFlowerAlive(f)) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackFlowerRef = null; _.aiResetCooldown();
      return false;
    }
    // 跑向花旁（保持 15px 距離）
    var side = (ch.x < f.x) ? 1 : -1;
    var targetX = f.x - side * 15;
    var dist = targetX - ch.x;
    ch.facing = dist > 0 ? 1 : -1;
    if (Math.abs(dist) > 5) {
      ch.x += ch.facing * ch.speed;
    } else {
      // 到達 → 面向花朵，開始攻擊
      ch.facing = (f.x > ch.x) ? 1 : -1;
      _.attackFlowerPhase = 1;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      ch._attackHit = false;
    }
  } else {
    // 攻擊動畫播放中
    var hitFrame = _s() ? _s().physics.hitFrame : 3;
    if (!ch._attackHit && ch.spriteFrame >= hitFrame) {
      ch._attackHit = true;
      if (scene_.knockFlower) scene_.knockFlower(f, ch.facing);
    }
    // 攻擊動畫結束
    var defs = ColorCatSprite.getDefs();
    var atkDef = defs.attack;
    if (atkDef && ch.spriteFrame >= atkDef.frames - 1) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackFlowerRef = null; _.aiResetCooldown();
    }
  }
  return false;
}

// ── 攻擊蝴蝶：跑到蝴蝶下方 → 跳起攻擊 → 蝴蝶擊落 ──
function startAttackButterfly(b) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!b || !scene_ || !scene_.isButterflyAlive(b)) return;
  if (_.testMode) stopTest();
  releaseBall();
  // 在紙箱上 → 先跳下再攻擊
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingAttackButterfly = b;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') { if (interruptCombo()) return; }
  _.attackButterflyRef = b;
  _.attackButterflyPhase = 0;  // 0=跑過去, 1=跳起攻擊, 2=落地
  ch.action = 'attackButterfly';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateAttackButterfly(sw) {
  var b = _.attackButterflyRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!b || !scene_ || !scene_.isButterflyAlive(b)) {
    // 蝴蝶已消失 → 落地回閒置
    if (!ch.onGround) {
      // 繼續下落
      if (_s()) ch.vy += _s().physics.gravity;
      ch.y += ch.vy;
      if (ch.y >= C.CHAR_GROUND_Y) {
        ch.y = C.CHAR_GROUND_Y; ch.vy = 0; ch.onGround = true;
      } else { return false; }
    }
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.attackButterflyRef = null; _.aiResetCooldown();
    return false;
  }

  if (_.attackButterflyPhase === 0) {
    // 跑向蝴蝶 x 位置
    var dx = b.x - ch.x;
    ch.facing = dx > 0 ? 1 : -1;
    if (Math.abs(dx) > 12) {
      ch.x += ch.facing * ch.speed;
    } else {
      // 到達下方 → 計算跳躍力道（攻擊點 = ch.y - SPRITE_DRAW*0.4 等高蝴蝶）
      var gravity = _s() ? _s().physics.gravity : 0.5;
      var targetH = C.CHAR_GROUND_Y - b.y - C.SPRITE_DRAW * 0.4;
      if (targetH < 15) targetH = 15;
      ch.vy = -Math.sqrt(2 * gravity * targetH);
      ch.onGround = false;
      _.attackButterflyPhase = 1;
      ch._attackHit = false;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  } else if (_.attackButterflyPhase === 1) {
    // 跳躍中 → 到達蝴蝶高度時命中
    if (_s()) ch.vy += _s().physics.gravity;
    ch.y += ch.vy;
    // 追蹤蝴蝶 x（微調）
    var bx = b.x - ch.x;
    if (Math.abs(bx) > 3) ch.x += (bx > 0 ? 1 : -1) * 1.5;
    // 判定命中：角色高度接近蝴蝶
    if (!ch._attackHit && Math.abs(ch.y - C.SPRITE_DRAW * 0.4 - b.y) < 15) {
      ch._attackHit = true;
      ch._butterflyKnocked = false;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      // 貓咪 jump_attack 動畫出手快，立即擊落
      if (!_.isBunny()) {
        ch._butterflyKnocked = true;
        if (scene_.knockButterfly) scene_.knockButterfly(b);
      }
    }
    // 兔子：等攻擊動畫播到出手幀才擊落蝴蝶
    var hitFrame = _s() ? _s().physics.hitFrame : 3;
    if (ch._attackHit && !ch._butterflyKnocked && ch.spriteFrame >= hitFrame) {
      ch._butterflyKnocked = true;
      if (scene_.knockButterfly) scene_.knockButterfly(b);
    }
    // 落地
    if (ch.y >= C.CHAR_GROUND_Y) {
      ch.y = C.CHAR_GROUND_Y; ch.vy = 0; ch.onGround = true;
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackButterflyRef = null; _.aiResetCooldown();
    }
  }
  return false;
}

// ── 追蝴蝶：跑向蝴蝶 → 接近時蝴蝶逃走 → 追到離場 ──
var CHASE_BUTTERFLY_SPEED = 2.0;  // 必須 < 蝴蝶逃跑速度 (2.5+)
var CHASE_BUTTERFLY_TRIGGER_DIST = 25;  // 接近多少 px 時觸發蝴蝶逃跑

function startChaseButterfly(sw) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_ || !scene_.getHoveringButterflies) return;
  var hovering = scene_.getHoveringButterflies();
  if (hovering.length === 0) return;
  var b = hovering[Math.floor(Math.random() * hovering.length)];
  if (_.testMode) _.stopTest();
  releaseBall();
  if (ch.action === 'combo') { if (interruptCombo()) return; }
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

// ── 大絕招：蓄力 → 必殺技動畫 → 體力歸零 ──
function canUltimate() {
  return ch.action !== 'weak' && ch.action !== 'sleeping' &&
         ch.action !== 'knockback' && ch.action !== 'ultimate' &&
         ch.action !== 'dying' && ch.action !== 'hurt' && !_.testMode;
}

function startUltimate() {
  if (!canUltimate()) return;
  releaseBall();
  // 在紙箱上 → 先跳下再發動
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingUltimate = true;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') { if (interruptCombo()) return; }
  ch.action = 'ultimate'; _.ultAnimTimer = 0;
  ch._ultHit = false;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateUltimate(sw) {
  _.ultAnimTimer++;
  var defs = ColorCatSprite.getDefs();
  var def = defs.special_attack;
  var totalFrames = def ? Math.ceil(def.frames / def.speed) : 40;

  // 命中判定：攻擊動畫到達出手幀時，精靈圖範圍內所有物件受到攻擊
  var hitFrame = _s() ? _s().physics.hitFrame : 3;
  if (!ch._ultHit && ch.spriteFrame >= hitFrame) {
    ch._ultHit = true;
    ultimateAreaAttack(sw, def);
  }

  if (_.ultAnimTimer >= totalFrames) {
    // 大絕招結束 → 體力歸零 → 進入虛弱
    if (_s()) {
      _s().stamina.current = 0;
      _s().runtime.weakLevel = 1;
    }
    ch.action = 'weak'; ch.spriteFrame = 0; ch.spriteTimer = 0;
  }
  return false;
}

// 大絕招範圍攻擊：精靈圖範圍內花朵、蝴蝶、球全部受擊
function ultimateAreaAttack(sw, def) {
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_) return;

  // 計算精靈圖範圍
  var fw = (def && def.fw) ? def.fw : C.SPRITE_SIZE;
  var fh = (def && def.fh) ? def.fh : C.SPRITE_SIZE;
  var halfW = fw * C.SPRITE_SCALE / 2;
  var drawH = fh * C.SPRITE_SCALE;
  var left = ch.x - halfW;
  var right = ch.x + halfW;
  var top = ch.y - drawH;

  // 花朵：範圍內盛開的花全部打倒
  if (scene_.getBloomedFlowers && scene_.knockFlower) {
    var bloomed = scene_.getBloomedFlowers();
    for (var i = 0; i < bloomed.length; i++) {
      var f = bloomed[i];
      if (f.x >= left && f.x <= right) {
        scene_.knockFlower(f, f.x >= ch.x ? 1 : -1);
      }
    }
  }

  // 蝴蝶：範圍內所有存活蝴蝶全部擊落
  if (scene_.getAllAliveButterflies && scene_.knockButterfly) {
    var bflies = scene_.getAllAliveButterflies();
    for (var j = 0; j < bflies.length; j++) {
      var b = bflies[j];
      if (b.x >= left && b.x <= right && b.y >= top && b.y <= ch.y) {
        scene_.knockButterfly(b);
      }
    }
  }

  // 球：範圍內則踢飛
  var bs = window.ColorCatBall && ColorCatBall.state;
  if (bs && bs.x >= left && bs.x <= right) {
    var kickDir = bs.x >= ch.x ? 1 : -1;
    ColorCatBall.kick(kickDir, sw);
  }

  // 敵人：範圍內全部受傷
  var E = window.ColorCatEnemy;
  if (E) {
    var hits = E.getInRange(left, right);
    for (var k = 0; k < hits.length; k++) {
      E.dealDamage(hits[k], 50);
    }
  }
}

function drawChargeBar(ctx) {
  if (!_.ultCharging) return;
  var pct = _.ultChargeTimer / _.ultChargeDuration;
  var barW = 30, barH = 5;
  var bx = ch.x - barW / 2;
  var by = ch.y - C.SPRITE_DRAW - 6;

  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

  // 發光填充
  ctx.save();
  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur = 6 + pct * 10;
  var grad = ctx.createLinearGradient(bx, by, bx + barW, by);
  grad.addColorStop(0, '#FFD700');
  grad.addColorStop(0.6, '#FFA500');
  grad.addColorStop(1, '#FF4500');
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, barW * pct, barH);
  ctx.restore();

  // 邊框亮光
  ctx.strokeStyle = 'rgba(255,215,0,' + (0.4 + pct * 0.6) + ')';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(bx - 1, by - 1, barW + 2, barH + 2);
}

// 註冊到共享狀態
_.releaseBall = releaseBall;
_.stopTest = stopTest;
_.endCombo = endCombo;
_.interruptCombo = interruptCombo;
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
_.startAttackFlower = startAttackFlower;
_.updateAttackFlower = updateAttackFlower;
_.startAttackButterfly = startAttackButterfly;
_.updateAttackButterfly = updateAttackButterfly;
_.startChaseButterfly = startChaseButterfly;
_.updateChaseButterfly = updateChaseButterfly;
_.canUltimate = canUltimate;
_.startUltimate = startUltimate;
_.updateUltimate = updateUltimate;
_.drawChargeBar = drawChargeBar;

})();
