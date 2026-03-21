/* ================================================
   ColorCat — 角色動作：擊退、花朵互動
   依賴：color-cat-character-actions.js (ColorCatCharacter._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

// ── 被面板撞飛 ──
function startKnockback(sw) {
  if (ch.action === 'sleeping' || ch.action === 'knockback') return;
  _.releaseBall();
  if (ch.action === 'combo') { _.endCombo(); }
  _.knockbackPhase = 0; _.knockbackTimer = 0; _.knockbackRollDist = 0;
  _.knockbackSpeedX = 8;
  ch.action = 'knockback'; ch.facing = -1;
  ch.vy = _s() ? _s().physics.jumpVy : -3;
  ch.onGround = false;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateKnockback(sw) {
  if (_.knockbackPhase === 0) {
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
    var rollSpeed = 9 * Math.max(0, 1 - _.knockbackRollDist / 90);
    ch.x -= rollSpeed; _.knockbackRollDist += rollSpeed;
    if (ch.x < C.SPRITE_DRAW / 2) ch.x = C.SPRITE_DRAW / 2;
    if (rollSpeed < 0.3 || _.knockbackRollDist >= 90) {
      _.knockbackPhase = 2; _.knockbackTimer = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  } else {
    _.knockbackTimer++;
    if (_.knockbackTimer >= 90) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  }
  return false;
}

// ── 看花：走向花朵旁待機 + 愛心 ──
var WATCH_FLOWER_MIN = 150;

function startWatchFlower(sw) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_ || !scene_.getBloomedFlowers) return;
  var bloomed = scene_.getBloomedFlowers();
  if (bloomed.length === 0) return;
  var pool = [];
  for (var fi = 0; fi < bloomed.length; fi++) {
    pool.push(bloomed[fi]);
    if (bloomed[fi].gold) pool.push(bloomed[fi]);
  }
  var f = pool[Math.floor(Math.random() * pool.length)];
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'combo') { if (_.interruptCombo()) return; }
  _.watchFlowerRef = f;
  _.watchFlowerTimer = 0;
  _.watchFlowerDuration = WATCH_FLOWER_MIN + Math.floor(Math.random() * 90);
  var side = (ch.x < f.x) ? -1 : 1;
  _.watchFlowerTargetX = f.x + side * (10 + Math.random() * 5);
  ch.action = 'goToFlower';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateGoToFlower(sw) {
  var f = _.watchFlowerRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
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
  var flowerGone = !f || !scene_ || !scene_.isFlowerAlive(f);
  if (flowerGone && _.watchFlowerTimer >= WATCH_FLOWER_MIN) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.watchFlowerRef = null; _.aiResetCooldown();
    return false;
  }
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
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingAttackFlower = f;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') { if (_.interruptCombo()) return; }
  _.attackFlowerRef = f;
  _.attackFlowerPhase = 0;
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
    if (!scene_.isFlowerAlive(f)) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackFlowerRef = null; _.aiResetCooldown();
      return false;
    }
    var side = (ch.x < f.x) ? 1 : -1;
    var targetX = f.x - side * 15;
    var dist = targetX - ch.x;
    ch.facing = dist > 0 ? 1 : -1;
    if (Math.abs(dist) > 5) {
      ch.x += ch.facing * ch.speed;
    } else {
      ch.facing = (f.x > ch.x) ? 1 : -1;
      _.attackFlowerPhase = 1;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      ch._attackHit = false;
    }
  } else {
    var hitFrame = _s() ? _s().physics.hitFrame : 3;
    if (!ch._attackHit && ch.spriteFrame >= hitFrame) {
      ch._attackHit = true;
      if (scene_.knockFlower) scene_.knockFlower(f, ch.facing);
      // 20% 機率隨機召喚一隻敵人
      if (Math.random() < 0.2 && window.ColorCatEnemy) {
        var skinKeys = Object.keys(window.ColorCatEnemy.SKINS);
        var rndSkin = skinKeys[Math.floor(Math.random() * skinKeys.length)];
        window.ColorCatEnemy.spawn(rndSkin, sw);
      }
    }
    var defs = ColorCatSprite.getDefs();
    var atkDef = defs.attack;
    if (atkDef && ch.spriteFrame >= atkDef.frames - 1) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackFlowerRef = null; _.aiResetCooldown();
    }
  }
  return false;
}

_.startKnockback = startKnockback;
_.updateKnockback = updateKnockback;
_.startWatchFlower = startWatchFlower;
_.updateGoToFlower = updateGoToFlower;
_.updateWatchFlower = updateWatchFlower;
_.startAttackFlower = startAttackFlower;
_.updateAttackFlower = updateAttackFlower;

})();
