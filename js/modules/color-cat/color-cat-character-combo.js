/* ================================================
   ColorCat — 角色連續動作（爬邊牆、爬紙箱、咬球跑）
   依賴：color-cat-character.js (ColorCatCharacter._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

// ── 開始咬球跑 ──
function startBiteBall() {
  if (_.testMode) _.stopTest();
  if (ch.action === 'combo') _.endCombo();
  ch.action = 'biteBall'; _.biteBallPhase = 0; _.biteBallTimer = 0;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 開始爬邊牆 ──
function startComboWall(sceneWidth) {
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'chase' || ch.action === 'kick') ch.action = 'idle';
  if (ch.action !== 'idle') return;
  _.comboType = 'wall'; _.comboSceneW = sceneWidth;
  _.comboStep = 0; _.comboTimer = 0;
  ch.action = 'combo'; ch.facing = 1;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 開始爬紙箱 ──
function startComboBox(sceneWidth, boxX, boxTopY, boxW) {
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) return;
  if (ch.action === 'chase' || ch.action === 'kick') ch.action = 'idle';
  if (ch.action !== 'idle') return;
  _.comboType = 'box'; _.comboSceneW = sceneWidth;
  _.comboBoxInfo = { x: boxX, topY: boxTopY, halfW: (boxW || 51) / 2 };
  _.comboStep = 0; _.comboTimer = 0;
  ch.action = 'combo'; ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 更新：combo（牆 + 紙箱） ──
function updateCombo(sw, defs) {
  if (!_s()) return false;
  if (_.comboType === 'wall') {
    var rightEdge = sw - 9;
    if (_.comboStep === 0) {
      ch.facing = 1;
      if (ch.x < rightEdge) { ch.x += ch.speed * _s().movement.wallRunSpeedMult; }
      else {
        ch.x = rightEdge; _.comboStep = 1;
        ch.vy = _s().physics.wallJumpVy; ch.onGround = false;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    } else if (_.comboStep === 1) {
      ch.vy += _s().physics.ledgeGravity; ch.y += ch.vy;
      if (ch.y <= _.COMBO_LEDGE_Y || ch.vy >= 0) {
        ch.y = _.COMBO_LEDGE_Y; ch.vy = 0;
        _.comboStep = 2; _.comboTimer = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    } else if (_.comboStep === 2) {
      ch.y = _.COMBO_LEDGE_Y; _.comboTimer++;
      if (_.comboTimer >= 60) {
        _.comboStep = 3; _.comboTimer = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    } else if (_.comboStep === 3) {
      ch.y = _.COMBO_LEDGE_Y; _.comboTimer++;
      var landDef = defs.ledge_land;
      var landTotal = landDef ? Math.ceil(landDef.frames / landDef.speed) : 20;
      if (_.comboTimer >= landTotal) {
        _.comboStep = 4; ch.onGround = false; ch.vy = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    } else if (_.comboStep === 4) {
      ch.vy += _s().physics.gravity; ch.y += ch.vy;
      if (ch.y >= C.CHAR_GROUND_Y) {
        ch.y = C.CHAR_GROUND_Y; ch.vy = 0; ch.onGround = true;
        ch.action = 'idle'; _.comboStep = -1;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    }
  } else if (_.comboType === 'box') {
    var bi = _.comboBoxInfo;
    var standY = bi.topY + _.FOOT_OFFSET;
    if (_.comboStep === 0) {
      var targetX = bi.x;
      var bDist = targetX - ch.x;
      if (bDist > 2) ch.facing = 1; else if (bDist < -2) ch.facing = -1;
      if (Math.abs(bDist) > 4) { ch.x += (bDist > 0 ? 1 : -1) * ch.speed; }
      else {
        ch.x = targetX; _.comboStep = 1; ch.facing = 1;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    } else if (_.comboStep === 1) {
      ch.y -= _s().movement.climbSpeed;
      if (ch.y <= standY) {
        ch.y = standY; _.comboStep = 2; _.comboTimer = 0; _.boxJumpsLeft = 0;
        ch.facing = 1; ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    } else if (_.comboStep === 2) {
      ch.y = standY; ch.facing = 1;
      if (!_.testMode) {
        _.comboTimer++;
        var ai = _s().ai;
        if (_.comboTimer >= ai.boxIdleMin + Math.floor(Math.random() * (ai.boxIdleMax - ai.boxIdleMin))) {
          if (_.boxJumpsLeft === 0 && Math.random() < ai.boxJumpChance) {
            _.boxJumpsLeft = 1 + Math.floor(Math.random() * ai.boxJumpCountMax);
          }
          if (_.boxJumpsLeft > 0) {
            _.comboStep = 3; ch.vy = _s().physics.boxJumpVy;
            ch.spriteFrame = 0; ch.spriteTimer = 0; _.comboTimer = 0;
            return false;
          }
          _.comboStep = -1; _.comboType = '';
          ch.action = 'jumpOff'; ch.facing = 1; ch.vy = -3; ch.onGround = false;
          ch.spriteFrame = 0; ch.spriteTimer = 0;
          _.aiResetCooldown(); return false;
        }
      }
      var edgeL = bi.x - bi.halfW, edgeR = bi.x + bi.halfW;
      if (ch.x < edgeL || ch.x > edgeR) {
        _.comboStep = -1; _.comboType = '';
        ch.onGround = false; ch.vy = 0; ch.action = 'jumpOff';
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    } else if (_.comboStep === 3) {
      ch.vy += _s().physics.boxLandGravity; ch.y += ch.vy;
      if (ch.y >= standY) {
        ch.y = standY; ch.vy = 0; _.boxJumpsLeft--;
        _.comboStep = 2; _.comboTimer = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    }
  }
  return false;
}

// ── 更新：咬球跑 ──
function updateBiteBall(sw, ballState) {
  if (!_s()) return false;
  if (_.biteBallPhase === 0) {
    var toBall = ballState.x - ch.x;
    ch.facing = toBall >= 0 ? 1 : -1;
    if (Math.abs(toBall) > 6) {
      ch.x += ch.facing * ch.speed * _s().movement.biteBallSpeedMult;
    } else {
      _.biteBallPhase = 1; _.biteBallTimer = 0;
      ColorCatBall.setCarried(true);
      var bmv = _s().movement;
      var runDist = bmv.biteBallRunDistMin + Math.random() * (bmv.biteBallRunDistMax - bmv.biteBallRunDistMin);
      var runDir = Math.random() < 0.5 ? 1 : -1;
      _.biteBallTargetX = ch.x + runDir * runDist;
      if (_.biteBallTargetX < 30) _.biteBallTargetX = 30;
      if (_.biteBallTargetX > sw - 30) _.biteBallTargetX = sw - 30;
      ch.facing = _.biteBallTargetX > ch.x ? 1 : -1;
    }
  } else if (_.biteBallPhase === 1) {
    var toTarget = _.biteBallTargetX - ch.x;
    ch.facing = toTarget >= 0 ? 1 : -1;
    var mouthX = ch.x + ch.facing * 20;
    var mouthY = ch.y - C.SPRITE_DRAW * 0.3;
    ColorCatBall.setPosition(mouthX, mouthY);
    if (Math.abs(toTarget) > 5) { ch.x += ch.facing * ch.speed; _.biteBallTimer++; }
    if (Math.abs(toTarget) <= 5 || _.biteBallTimer > _s().movement.biteBallMaxDuration) {
      _.biteBallPhase = 2;
    }
  } else {
    ColorCatBall.setCarried(false);
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.aiResetCooldown();
  }
  return false;
}

_.startBiteBall = startBiteBall;
_.startComboWall = startComboWall;
_.startComboBox = startComboBox;
_.updateCombo = updateCombo;
_.updateBiteBall = updateBiteBall;

})();
