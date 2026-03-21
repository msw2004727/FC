/* ================================================
   ColorCat — 角色戰鬥系統（HP、受傷、死亡、攻擊敵人）
   依賴：color-cat-character.js, color-cat-enemy.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

// ── 受傷（體力=HP，扣同一個值） ──
function takeDamage(dmg) {
  if (ch.action === 'dying' || ch.action === 'sleeping') return;
  if (_.ultCharging) return; // 蓄力大絕招時免疫傷害
  if (!_s()) return;
  var st = _s().stamina;
  st.current = Math.max(0, st.current - dmg);
  _.charHp = st.current;
  // 飄字
  if (window.ColorCatDamageNumber) {
    window.ColorCatDamageNumber.spawn(ch.x, ch.y - C.SPRITE_DRAW + 10, dmg, '#FF3333');
  }
  if (st.current <= 0) {
    startDying();
  } else if (ch.action !== 'hurt') {
    // 播放受傷動畫（中斷當前動作）
    if (_.testMode) _.stopTest();
    _.releaseBall();
    if (ch.action === 'combo') _.endCombo();
    ch.action = 'hurt'; _.hurtTimer = 0;
    ch.y = C.CHAR_GROUND_Y; ch.onGround = true;
    ch.spriteFrame = 0; ch.spriteTimer = 0;
  }
}

// ── 受傷動畫更新 ──
function updateHurt() {
  _.hurtTimer++;
  var defs = ColorCatSprite.getDefs();
  var def = defs.take_damage;
  var totalFrames = def ? Math.ceil(def.frames / def.speed) : 27;
  if (_.hurtTimer >= totalFrames) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.aiResetCooldown();
  }
  return false;
}

// ── 開始死亡 ──
function startDying() {
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'combo') _.endCombo();
  _.dyingDeathX = ch.x;
  _.dyingPhase = 0; _.dyingTimer = 0; _.dyingAlpha = 1;
  ch.action = 'dying'; ch.y = C.CHAR_GROUND_Y; ch.onGround = true;
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

// ── 更新死亡流程 ──
// phase 0: 播放死亡動畫直到停在最後一幀
// phase 1: 倒數 5 秒 (150 frames)
// phase 2: 淡出 1 秒 (30 frames)
// phase 3: 重生（從紙箱出來）
function updateDying(sw) {
  var defs = ColorCatSprite.getDefs();
  var def = defs.death;

  if (_.dyingPhase === 0) {
    if (def && ch.spriteFrame >= def.frames - 1) {
      _.dyingPhase = 1; _.dyingTimer = 0;
      // 貓：死亡動畫直接消失，立即放墓碑；兔：倒數完才放
      if (!_.isBunny()) {
        var scene_ = window.ColorCatScene && window.ColorCatScene._;
        if (scene_ && scene_.addGrave) scene_.addGrave(_.dyingDeathX);
      }
    }
  } else if (_.dyingPhase === 1) {
    _.dyingTimer++;
    if (_.dyingTimer >= 300) {
      _.dyingPhase = 2; _.dyingTimer = 0;
    }
  } else if (_.dyingPhase === 2) {
    _.dyingTimer++;
    _.dyingAlpha = Math.max(0, 1 - _.dyingTimer / 30);
    if (_.dyingAlpha <= 0) {
      _.dyingPhase = 3;
      // 兔：淡出完成後放墓碑
      if (_.isBunny()) {
        var scene_ = window.ColorCatScene && window.ColorCatScene._;
        if (scene_ && scene_.addGrave) scene_.addGrave(_.dyingDeathX);
      }
    }
  } else {
    // 重生：回滿血，在紙箱內以睡覺狀態登場
    if (_s()) {
      _s().stamina.current = _s().stamina.max;
      _s().runtime.weakLevel = 0;
    }
    _.charHp = _s() ? _s().stamina.max : 100;
    _.charMaxHp = _s() ? _s().stamina.max : 100;
    _.dyingAlpha = 1;
    var scene_ = window.ColorCatScene && window.ColorCatScene._;
    var openX = scene_ ? scene_.BOX_X + scene_.BOX_W / 2 + 12 : ch.x;
    ch.x = openX;
    ch.y = C.CHAR_GROUND_Y; ch.onGround = true;
    ch.action = 'sleeping'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.aiTimer = 0;
    _.aiResetCooldown();
  }
  return false;
}

// ── 攻擊敵人：跑到敵人旁 → 攻擊動畫 → 命中傷害 ──
function startAttackEnemy(idx) {
  if (ch.action === 'weak' || ch.action === 'knockback' ||
      ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt') return;
  var E = window.ColorCatEnemy;
  if (!E) return;
  var enemies = E.getAll();
  var e = enemies[idx];
  if (!e || e.dead) return;
  if (_.testMode) _.stopTest();
  _.releaseBall();
  // 在紙箱上 → 先跳下
  if (ch.action === 'combo' && _.comboType === 'box' && _.comboStep === 2) {
    _.pendingAttackEnemy = idx;
    _.comboStep = -1; _.comboType = '';
    ch.action = 'jumpOff'; ch.facing = 1;
    ch.vy = _s() ? _s().physics.jumpVy : -3; ch.onGround = false;
    _.jumpOffPhase = 0;
    ch.spriteFrame = 0; ch.spriteTimer = 0; return;
  }
  if (ch.action === 'combo') { if (_.interruptCombo()) return; }
  _.attackEnemyIdx = idx;
  _.attackEnemyPhase = 0;
  ch.action = 'attackEnemy';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateAttackEnemy(sw) {
  var E = window.ColorCatEnemy;
  if (!E) { ch.action = 'idle'; return false; }
  var enemies = E.getAll();
  var e = enemies[_.attackEnemyIdx];

  if (!e || e.dead) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.attackEnemyIdx = -1; _.aiResetCooldown();
    return false;
  }

  if (_.attackEnemyPhase === 0) {
    var dx = e.x - ch.x;
    ch.facing = dx > 0 ? 1 : -1;
    if (Math.abs(dx) > 20) {
      ch.x += ch.facing * ch.speed;
    } else {
      ch.facing = (e.x > ch.x) ? 1 : -1;
      _.attackEnemyPhase = 1;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      ch._attackHit = false;
    }
  } else {
    var hitFrame = _s() ? _s().physics.hitFrame : 3;
    if (!ch._attackHit && ch.spriteFrame >= hitFrame) {
      ch._attackHit = true;
      E.dealDamage(_.attackEnemyIdx, 25);
    }
    var defs = ColorCatSprite.getDefs();
    var atkDef = defs.attack;
    if (atkDef && ch.spriteFrame >= atkDef.frames - 1) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackEnemyIdx = -1; _.aiResetCooldown();
    }
  }
  return false;
}

// ── HP 條（HP < 滿時顯示） ──
function drawHpBar(ctx) {
  if (ch.action === 'sleeping' || ch.action === 'dying') return;
  if (_.charHp >= _.charMaxHp) return;
  var barW = 24, barH = 3;
  var bx = ch.x - barW / 2;
  var by = ch.y - C.SPRITE_DRAW - 2;
  var pct = _.charHp / _.charMaxHp;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(bx - 0.5, by - 0.5, barW + 1, barH + 1);

  var r = pct > 0.5 ? Math.floor((1 - pct) * 510) : 255;
  var g = pct > 0.5 ? 200 : Math.floor(pct * 400);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',50)';
  ctx.fillRect(bx, by, barW * pct, barH);
}

// ── 死亡倒數文字 ──
function drawDyingCountdown(ctx) {
  if (ch.action !== 'dying' || _.dyingPhase !== 1) return;
  var sec = Math.ceil((300 - _.dyingTimer) / 30);
  ctx.save();
  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.textAlign = 'center';
  var ty = ch.y - C.SPRITE_DRAW - 6;
  ctx.strokeText(sec, ch.x, ty);
  ctx.fillText(sec, ch.x, ty);
  ctx.restore();
}

// ── 攻擊墓碑：跑到墓碑旁 → 攻擊 → 崩解 ──
function startAttackGrave(idx) {
  if (ch.action === 'dying' || ch.action === 'sleeping' ||
      ch.action === 'weak' || ch.action === 'hurt') return;
  if (_.testMode) _.stopTest();
  _.releaseBall();
  if (ch.action === 'combo') { _.interruptCombo(); }
  _.attackGraveIdx = idx;
  _.attackGravePhase = 0;
  ch.action = 'attackGrave';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
}

function updateAttackGrave(sw) {
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  if (!scene_) { ch.action = 'idle'; return false; }
  var gx = scene_.getGravePos(_.attackGraveIdx);
  if (gx < 0) {
    ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
    _.attackGraveIdx = -1; _.aiResetCooldown(); return false;
  }
  if (_.attackGravePhase === 0) {
    var dx = gx - ch.x;
    ch.facing = dx > 0 ? 1 : -1;
    if (Math.abs(dx) > 15) {
      ch.x += ch.facing * ch.speed;
    } else {
      ch.facing = (gx > ch.x) ? 1 : -1;
      _.attackGravePhase = 1;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      ch._graveHit = false;
    }
  } else {
    var hitFrame = _s() ? _s().physics.hitFrame : 3;
    if (!ch._graveHit && ch.spriteFrame >= hitFrame) {
      ch._graveHit = true;
      scene_.destroyGrave(_.attackGraveIdx);
    }
    var defs = ColorCatSprite.getDefs();
    var atkDef = defs.attack;
    if (atkDef && ch.spriteFrame >= atkDef.frames - 1) {
      ch.action = 'idle'; ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.attackGraveIdx = -1; _.aiResetCooldown();
    }
  }
  return false;
}

// 註冊到共享狀態
_.takeDamage = takeDamage;
_.updateHurt = updateHurt;
_.startDying = startDying;
_.updateDying = updateDying;
_.drawDyingCountdown = drawDyingCountdown;
_.drawHpBar = drawHpBar;
_.startAttackEnemy = startAttackEnemy;
_.updateAttackEnemy = updateAttackEnemy;
_.startAttackGrave = startAttackGrave;
_.updateAttackGrave = updateAttackGrave;

})();
