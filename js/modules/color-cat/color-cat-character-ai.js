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
  var watchFlowerW = hasFlowers ? (w.chase * 0.8) : 0;

  var total = w.biteBall + w.chase + w.dash + w.climbBox + w.climbWall + sleepW + watchFlowerW;
  var roll = Math.random() * total;

  var cum = 0;
  cum += w.biteBall;    if (roll < cum) { rt.totalActions++; _.startBiteBall(sw); return; }
  cum += w.chase;       if (roll < cum) { rt.totalActions++; _.startChase(); return; }
  cum += w.dash;        if (roll < cum) { rt.totalActions++; _.tapCharacter(sw); return; }
  cum += w.climbBox;    if (roll < cum) { rt.totalActions++; _.startComboBox(sw, info.boxX, info.boxTopY, info.boxW); return; }
  cum += w.climbWall;   if (roll < cum) { rt.totalActions++; _.startComboWall(sw); return; }
  cum += watchFlowerW;  if (roll < cum) { rt.totalActions++; _.startWatchFlower(sw); return; }
  rt.totalSleeps++;
  _.startGoToBox(info.openingX);
}

function aiSetSceneInfo(info) { _.aiSceneInfo = info; }

// ── 更新：追球 / 踢球 / 閒置 AI ──
function updateChaseKickIdle(sw, ballState, defs) {
  if (!_s()) return false;
  if (ch.action === 'chase') {
    if (!ch._chaseFacing) ch._chaseFacing = (ballState.x >= ch.x) ? 1 : -1;
    var ko = _s().physics.kickOffset;
    var kickOffset = ch._chaseFacing >= 0 ? -ko : ko;
    var targetX = ballState.x + kickOffset;
    var dist = targetX - ch.x;
    ch.facing = ch._chaseFacing;
    if (Math.abs(dist) > 4) {
      ch.x += (dist > 0 ? 1 : -1) * ch.speed;
    } else {
      ch._chaseFacing = 0; ch.action = 'kick'; ch.actionFrame = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0; ch._kicked = false;
    }
  } else if (ch.action === 'kick') {
    ch.actionFrame++;
    var attackDef = defs.attack;
    var totalFrames = Math.ceil(attackDef.frames / attackDef.speed);
    var hitFrame = _s().physics.hitFrame;
    if (!ch._kicked && ch.spriteFrame >= hitFrame) {
      ch._kicked = true; _s().runtime.totalKicks++;
      return true;
    }
    if (ch.actionFrame > totalFrames) {
      ch.action = 'idle'; ch.actionFrame = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  } else {
    if (ballState.x > ch.x + 5) ch.facing = 1;
    else if (ballState.x < ch.x - 5) ch.facing = -1;
    if (!_.testMode && _.aiSceneInfo) {
      _.aiTimer++;
      if (_.aiTimer >= _.aiCooldown) {
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
