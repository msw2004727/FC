/* ================================================
   ColorCat — 角色 AI 行為（行動選擇、追球/踢球、閒置計時）
   依賴：color-cat-character.js (ColorCatCharacter._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

function aiResetCooldown() {
  if (!_s()) { _.aiCooldown = 120; _.aiTimer = 0; return; }
  var a = _s().ai;
  _.aiCooldown = a.cooldownMin + Math.floor(Math.random() * (a.cooldownMax - a.cooldownMin));
  _.aiTimer = 0;
}

function aiPickAction(sw, ballState) {
  if (!_.aiSceneInfo || !_s()) return;
  var info = _.aiSceneInfo;
  var a = _s().ai;
  var st = _s().stamina;
  var rt = _s().runtime;
  var pct = st.current / st.max * 100;

  var sleepBonus = 0;
  if (pct < 60) sleepBonus = (60 - pct) * a.sleepBonusMultiplier;
  var w = a.weights;
  var sleepW = w.sleep + sleepBonus;
  // 晚上兔子愛睡、白天貓咪愛睡（+50%）
  var isDark = C.isThemeDark();
  if (isDark && _.isBunny()) sleepW *= 1.5;
  else if (!isDark && !_.isBunny()) sleepW *= 1.5;

  // 有盛開花朵時加入看花權重
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  var hasFlowers = scene_ && scene_.getBloomedFlowers && scene_.getBloomedFlowers().length > 0;
  var watchFlowerW = hasFlowers ? (w.chase * 2.5) : 0;

  // 有停留蝴蝶時加入追蝴蝶權重
  var hasButterflies = scene_ && scene_.getHoveringButterflies && scene_.getHoveringButterflies().length > 0;
  var chaseButterflyW = hasButterflies ? (w.chase * 2) : 0;

  // 有存活敵人時攻擊敵人為最高優先（壓倒性權重：80% 機率攻擊敵人）
  var E = window.ColorCatEnemy;
  var hasEnemies = E && E.hasAlive();
  var baseTotal = w.biteBall + w.chase + w.dash + w.climbBox + w.climbWall + sleepW + watchFlowerW + chaseButterflyW;
  var attackEnemyW = hasEnemies ? (baseTotal * 4) : 0;

  var total = baseTotal + attackEnemyW;
  var roll = Math.random() * total;

  var cum = 0;
  cum += attackEnemyW;  if (roll < cum) { rt.totalActions++; var ni = E.findNearest(ch.x); if (ni >= 0) _.startAttackEnemy(ni); return; }
  cum += w.biteBall;    if (roll < cum) { rt.totalActions++; _.startBiteBall(sw); return; }
  cum += w.chase;       if (roll < cum) { rt.totalActions++; _.startChase(); return; }
  cum += w.dash;        if (roll < cum) { rt.totalActions++; _.tapCharacter(sw); return; }
  cum += w.climbBox;    if (roll < cum) { rt.totalActions++; _.startComboBox(sw, info.boxX, info.boxTopY, info.boxW); return; }
  cum += w.climbWall;   if (roll < cum) { rt.totalActions++; _.startComboWall(sw); return; }
  cum += watchFlowerW;  if (roll < cum) { rt.totalActions++; _.startWatchFlower(sw); return; }
  cum += chaseButterflyW; if (roll < cum) { rt.totalActions++; _.startChaseButterfly(sw); return; }
  rt.totalSleeps++;
  _.startGoToBox(info.openingX);
}

function aiSetSceneInfo(info) { _.aiSceneInfo = info; }

// ── 更新：追球 / 踢球 / 閒置 AI ──
function updateChaseKickIdle(sw, ballState, defs) {
  if (!_s()) return false;
  if (ch.action === 'chase') {
    var isDrag = window.ColorCatBall && ColorCatBall.isDragging();
    if (isDrag) {
      // 拖曳模式：持續更新朝向，避免倒著跑
      ch._chaseFacing = (ballState.x >= ch.x) ? 1 : -1;
      ch.facing = ch._chaseFacing;
      var dxDrag = ballState.x - ch.x;
      if (Math.abs(dxDrag) > 10) {
        ch.x += ch.facing * ch.speed;
      } else {
        // 接近球：跳起攻擊
        var floorY = C.CHAR_GROUND_Y - 6;
        var ballH = floorY - ballState.y - ballState.r;
        if (ballH > 15 && ch.onGround) {
          var jumpPower = Math.min(-7, -(Math.sqrt(2 * 0.15 * ballH) + 1));
          ch.vy = jumpPower;
          ch.onGround = false;
        }
        ch._chaseFacing = 0; ch.action = 'kick'; ch.actionFrame = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0; ch._kicked = false;
      }
    } else {
      // 一般追球：方向固定
      if (!ch._chaseFacing) ch._chaseFacing = (ballState.x >= ch.x) ? 1 : -1;
      var ko = _s().physics.kickOffset;
      var kickOffset = ch._chaseFacing >= 0 ? -ko : ko;
      var targetX = ballState.x + kickOffset;
      var dist = targetX - ch.x;
      ch.facing = ch._chaseFacing;
      if (Math.abs(dist) > 4) {
        ch.x += (dist > 0 ? 1 : -1) * ch.speed;
      } else {
        var floorY2 = C.CHAR_GROUND_Y - 6;
        var ballH2 = floorY2 - ballState.y - ballState.r;
        if (ballH2 > 15 && ch.onGround) {
          var jumpPower2 = Math.min(-7, -(Math.sqrt(2 * 0.15 * ballH2) + 1));
          ch.vy = jumpPower2;
          ch.onGround = false;
        }
        ch._chaseFacing = 0; ch.action = 'kick'; ch.actionFrame = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0; ch._kicked = false;
      }
    }
  } else if (ch.action === 'kick') {
    ch.actionFrame++;
    // 空中物理
    if (!ch.onGround) {
      ch.vy += 0.15;
      ch.y += ch.vy;
      if (ch.y >= C.CHAR_GROUND_Y) {
        ch.y = C.CHAR_GROUND_Y; ch.onGround = true; ch.vy = 0;
      }
    }
    var attackDef = defs.attack;
    var totalFrames = Math.ceil(attackDef.frames / attackDef.speed);
    var hitFrame = _s().physics.hitFrame;
    if (!ch._kicked && ch.spriteFrame >= hitFrame) {
      // 判定攻擊範圍：角色中心到球的距離
      var dx = Math.abs(ballState.x - ch.x);
      var dy = Math.abs(ballState.y - (ch.y - C.SPRITE_DRAW * 0.4));
      var hitDist = Math.sqrt(dx * dx + dy * dy);
      if (hitDist < C.SPRITE_DRAW * 0.6 + ballState.r) {
        ch._kicked = true; _s().runtime.totalKicks++;
        return true;
      }
    }
    if (ch.actionFrame > totalFrames) {
      var dragging = window.ColorCatBall && ColorCatBall.isDragging();
      var hasStamina = _s() && _s().stamina.current > 0;
      if (ch.onGround) {
        // 球被拖曳中且有體力 → 立即再追（不冷卻）
        if (dragging && hasStamina) {
          ch.action = 'chase'; ch.actionFrame = 0;
          ch.spriteFrame = 0; ch.spriteTimer = 0; ch._chaseFacing = 0;
        } else {
          ch.action = 'idle'; ch.actionFrame = 0;
          ch.spriteFrame = 0; ch.spriteTimer = 0;
        }
      } else if (ch.actionFrame > totalFrames + 60) {
        // 安全閥：空中超過 2 秒強制落地
        ch.y = C.CHAR_GROUND_Y; ch.onGround = true; ch.vy = 0;
        if (dragging && hasStamina) {
          ch.action = 'chase'; ch.actionFrame = 0;
          ch.spriteFrame = 0; ch.spriteTimer = 0; ch._chaseFacing = 0;
        } else {
          ch.action = 'idle'; ch.actionFrame = 0;
          ch.spriteFrame = 0; ch.spriteTimer = 0;
        }
      }
    }
  } else {
    // 球被拖曳中且有體力 → 立即追球（跳過冷卻）
    var draggingIdle = window.ColorCatBall && ColorCatBall.isDragging();
    var hasStaminaIdle = _s() && _s().stamina.current > 0;
    if (draggingIdle && hasStaminaIdle) {
      ch.action = 'chase'; ch.actionFrame = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0; ch._chaseFacing = 0;
      return false;
    }
    if (ballState.x > ch.x + 5) ch.facing = 1;
    else if (ballState.x < ch.x - 5) ch.facing = -1;
    if (!_.testMode && _.aiSceneInfo) {
      _.aiTimer++;
      // 有敵人時大幅縮短冷卻（戰鬥模式：0.5 秒重新接戰）
      var E = window.ColorCatEnemy;
      var combatCD = (E && E.hasAlive()) ? 15 : _.aiCooldown;
      if (_.aiTimer >= combatCD) {
        aiPickAction(sw, ballState);
        aiResetCooldown();
      }
    }
  }
  return false;
}

_.aiResetCooldown = aiResetCooldown;
_.aiPickAction = aiPickAction;
_.aiSetSceneInfo = aiSetSceneInfo;
_.updateChaseKickIdle = updateChaseKickIdle;

})();
