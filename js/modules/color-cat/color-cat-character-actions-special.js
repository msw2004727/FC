/* ================================================
   ColorCat — 角色動作：蝴蝶互動、大絕招
   依賴：color-cat-character-actions.js (ColorCatCharacter._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

// ── 輔助：隨機生成一隻敵人 ──
function _spawnRandomEnemy(sw) {
  var E = window.ColorCatEnemy;
  if (!E) return;
  var skinKeys = Object.keys(E.SKINS);
  var rndSkin = skinKeys[Math.floor(Math.random() * skinKeys.length)];
  E.spawn(rndSkin, sw);
}

// ── 攻擊蝴蝶：跑到蝴蝶下方 → 跳起攻擊 → 蝴蝶擊落 ──
function startAttackButterfly(b) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!b || !scene_ || !scene_.isButterflyAlive(b)) return;
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingAttackButterfly = b;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') { if (_.interruptCombo()) return; }
  _.attackButterflyRef = b;
  _.attackButterflyPhase = 0;
  ch.action = 'attackButterfly';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateAttackButterfly(sw) {
  var b = _.attackButterflyRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!b || !scene_ || !scene_.isButterflyAlive(b)) {
    if (!ch.onGround) {
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
    var dx = b.x - ch.x;
    ch.facing = dx > 0 ? 1 : -1;
    if (Math.abs(dx) > 12) {
      ch.x += ch.facing * ch.speed;
    } else {
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
    if (_s()) ch.vy += _s().physics.gravity;
    ch.y += ch.vy;
    var bx = b.x - ch.x;
    if (Math.abs(bx) > 3) ch.x += (bx > 0 ? 1 : -1) * 1.5;
    if (!ch._attackHit && Math.abs(ch.y - C.SPRITE_DRAW * 0.4 - b.y) < 15) {
      ch._attackHit = true;
      ch._butterflyKnocked = false;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      if (!_.isBunny()) {
        ch._butterflyKnocked = true;
        if (scene_.knockButterfly) scene_.knockButterfly(b);
        _spawnRandomEnemy(sw);
      }
    }
    var hitFrame = _s() ? _s().physics.hitFrame : 3;
    if (ch._attackHit && !ch._butterflyKnocked && ch.spriteFrame >= hitFrame) {
      ch._butterflyKnocked = true;
      if (scene_.knockButterfly) scene_.knockButterfly(b);
      _spawnRandomEnemy(sw);
    }
    if (ch.y >= C.CHAR_GROUND_Y) {
      ch.y = C.CHAR_GROUND_Y; ch.vy = 0; ch.onGround = true;
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackButterflyRef = null; _.aiResetCooldown();
    }
  }
  return false;
}

// ── 追蝴蝶：跑向蝴蝶 → 接近時蝴蝶逃走 → 追到離場 ──
var CHASE_BUTTERFLY_SPEED = 2.0;
var CHASE_BUTTERFLY_TRIGGER_DIST = 25;

function startChaseButterfly(sw) {
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_ || !scene_.getHoveringButterflies) return;
  var hovering = scene_.getHoveringButterflies();
  if (hovering.length === 0) return;
  var b = hovering[Math.floor(Math.random() * hovering.length)];
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'combo') { if (_.interruptCombo()) return; }
  _.chaseButterflyRef = b;
  ch.action = 'chaseButterfly';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateChaseButterfly(sw) {
  var b = _.chaseButterflyRef;
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!b || !scene_ || !scene_.isButterflyAlive(b)) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.chaseButterflyRef = null; _.aiResetCooldown();
    return false;
  }
  var dx = b.x - ch.x;
  ch.facing = dx > 0 ? 1 : -1;
  ch.x += ch.facing * CHASE_BUTTERFLY_SPEED;
  if (ch.x < C.SPRITE_DRAW / 2) ch.x = C.SPRITE_DRAW / 2;
  if (ch.x > sw - C.SPRITE_DRAW / 2) ch.x = sw - C.SPRITE_DRAW / 2;
  var dist = Math.abs(dx);
  if (dist < CHASE_BUTTERFLY_TRIGGER_DIST && b.phase === 'hover') {
    if (scene_.startButterflyFlee) scene_.startButterflyFlee(b);
  }
  return false;
}

// ── 大絕招：必殺技動畫 → 體力歸零 ──
function canUltimate() {
  return ch.action !== 'weak' && ch.action !== 'sleeping' &&
         ch.action !== 'knockback' && ch.action !== 'ultimate' &&
         ch.action !== 'dying' && ch.action !== 'hurt' && !_.testMode;
}

function startUltimate() {
  if (!canUltimate()) return;
  _.releaseBall();
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingUltimate = true;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') { if (_.interruptCombo()) return; }
  ch.action = 'ultimate'; _.ultAnimTimer = 0;
  ch._ultHit = false;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateUltimate(sw) {
  _.ultAnimTimer++;
  var defs = ColorCatSprite.getDefs();
  var def = defs.special_attack;
  var totalFrames = def ? Math.ceil(def.frames / def.speed) : 40;
  var hitFrame = _s() ? _s().physics.hitFrame : 3;
  if (!ch._ultHit && ch.spriteFrame >= hitFrame) {
    ch._ultHit = true;
    ultimateAreaAttack(sw, def);
  }
  if (_.ultAnimTimer >= totalFrames) {
    if (_s()) {
      _s().stamina.current = 0;
      _s().runtime.weakLevel = 1;
    }
    ch.action = 'weak'; ch.spriteFrame = 0; ch.spriteTimer = 0;
  }
  return false;
}

function ultimateAreaAttack(sw, def) {
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_) return;
  var fw = (def && def.fw) ? def.fw : C.SPRITE_SIZE;
  var fh = (def && def.fh) ? def.fh : C.SPRITE_SIZE;
  var halfW = fw * C.SPRITE_SCALE / 2;
  var drawH = fh * C.SPRITE_SCALE;
  var left = ch.x - halfW, right = ch.x + halfW, top = ch.y - drawH;
  if (scene_.getBloomedFlowers && scene_.knockFlower) {
    var bloomed = scene_.getBloomedFlowers();
    for (var i = 0; i < bloomed.length; i++) {
      var f = bloomed[i];
      if (f.x >= left && f.x <= right) {
        scene_.knockFlower(f, f.x >= ch.x ? 1 : -1);
        // 每朵花獨立 20% 機率召喚敵人
        if (Math.random() < 0.2) _spawnRandomEnemy(sw);
      }
    }
  }
  if (scene_.getAllAliveButterflies && scene_.knockButterfly) {
    var bflies = scene_.getAllAliveButterflies();
    for (var j = 0; j < bflies.length; j++) {
      var b = bflies[j];
      if (b.x >= left && b.x <= right && b.y >= top && b.y <= ch.y) {
        scene_.knockButterfly(b);
        // 蝴蝶必定召喚敵人
        _spawnRandomEnemy(sw);
      }
    }
  }
  var bs = window.ColorCatBall && ColorCatBall.state;
  if (bs && bs.x >= left && bs.x <= right) {
    ColorCatBall.kick(bs.x >= ch.x ? 1 : -1, sw);
  }
  var E = window.ColorCatEnemy;
  if (E) {
    var hits = E.getInRange(left, right);
    for (var k = 0; k < hits.length; k++) E.dealDamage(hits[k], 50);
  }
}

function drawChargeBar(ctx) {
  if (!_.ultCharging) return;
  var pct = _.ultChargeTimer / _.ultChargeDuration;
  var barW = 30, barH = 5;
  var bx = ch.x - barW / 2, by = ch.y - C.SPRITE_DRAW - 6;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
  ctx.save();
  ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 6 + pct * 10;
  var grad = ctx.createLinearGradient(bx, by, bx + barW, by);
  grad.addColorStop(0, '#FFD700'); grad.addColorStop(0.6, '#FFA500'); grad.addColorStop(1, '#FF4500');
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, barW * pct, barH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,215,0,' + (0.4 + pct * 0.6) + ')';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(bx - 1, by - 1, barW + 2, barH + 2);
}

_.startAttackButterfly = startAttackButterfly;
_.updateAttackButterfly = updateAttackButterfly;
_.startChaseButterfly = startChaseButterfly;
_.updateChaseButterfly = updateChaseButterfly;
_.canUltimate = canUltimate;
_.startUltimate = startUltimate;
_.updateUltimate = updateUltimate;
_.drawChargeBar = drawChargeBar;

})();
