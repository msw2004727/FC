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

  // 取得 MBTI 權重乘數
  var mbtiW = null;
  if (rt.mbti && window.ColorCatMBTI) {
    mbtiW = ColorCatMBTI.getWeights(rt.mbti);
  }
  // 套用 MBTI 乘數的輔助函式
  function mw(key, base) { return mbtiW && mbtiW[key] ? base * mbtiW[key] : base; }

  var sleepW = mw('sleep', w.sleep) + sleepBonus;
  // 晚上兔子愛睡、白天貓咪愛睡（+50%）
  var isDark = C.isThemeDark();
  if (isDark && _.isBunny()) sleepW *= 1.5;
  else if (!isDark && !_.isBunny()) sleepW *= 1.5;

  // 有盛開花朵時加入看花權重（受 MBTI watchFlower 乘數影響）
  var scene_ = window.ColorCatScene && window.ColorCatScene._;
  var hasFlowers = scene_ && scene_.getBloomedFlowers && scene_.getBloomedFlowers().length > 0;
  var watchFlowerW = hasFlowers ? mw('watchFlower', w.chase * 2.5) : 0;

  // 有停留蝴蝶時加入追蝴蝶權重（受 MBTI chaseButterfly 乘數影響）
  var hasButterflies = scene_ && scene_.getHoveringButterflies && scene_.getHoveringButterflies().length > 0;
  var chaseButterflyW = hasButterflies ? mw('chaseButterfly', w.chase * 2) : 0;

  // 濃霧時角色想回紙箱睡覺（90% 機率）
  var isFog = scene_ && scene_.isFogActive && scene_.isFogActive();
  if (isFog) {
    var otherW = w.biteBall + w.chase + w.dash + w.climbBox + w.climbWall + watchFlowerW + chaseButterflyW;
    sleepW = otherW * 9;  // sleep:other = 9:1 = 90%
  }

  // 敵人全滅時自動重置手動模式
  var E = window.ColorCatEnemy;
  var hasEnemies = E && E.hasAlive();
  if (!hasEnemies && _.manualOverride) _.manualOverride = false;

  // 有存活敵人且非手動模式 → 100% 攻擊最近敵人
  if (hasEnemies && !_.manualOverride) {
    rt.totalActions++;
    var ni = E.findNearest(ch.x);
    if (ni >= 0) _.startAttackEnemy(ni);
    return;
  }

  var wBiteBall = mw('biteBall', w.biteBall);
  var wChase    = mw('chase', w.chase);
  var wDash     = mw('dash', w.dash);
  var wClimbBox = mw('climbBox', w.climbBox);
  var wClimbWall= mw('climbWall', w.climbWall);

  var baseTotal = wBiteBall + wChase + wDash + wClimbBox + wClimbWall + sleepW + watchFlowerW + chaseButterflyW;

  var total = baseTotal;
  var roll = Math.random() * total;

  var cum = 0;
  cum += wBiteBall;     if (roll < cum) { rt.totalActions++; _.startBiteBall(sw); return; }
  cum += wChase;        if (roll < cum) { rt.totalActions++; _.startChase(); return; }
  cum += wDash;         if (roll < cum) { rt.totalActions++; _.tapCharacter(sw); return; }
  cum += wClimbBox;     if (roll < cum) { rt.totalActions++; _.startComboBox(sw, info.boxX, info.boxTopY, info.boxW); return; }
  cum += wClimbWall;    if (roll < cum) { rt.totalActions++; _.startComboWall(sw); return; }
  cum += watchFlowerW;  if (roll < cum) { rt.totalActions++; _.startWatchFlower(sw); return; }
  cum += chaseButterflyW; if (roll < cum) { rt.totalActions++; _.startChaseButterfly(sw); return; }
  rt.totalSleeps++;
  _.startGoToBox(info.openingX);
}

function aiSetSceneInfo(info) { _.aiSceneInfo = info; }

// ── 拖曳追球常數 ──
var DRAG_JUMP_DIST = 50;     // 起跳距離 px
var DRAG_ATTACK_DIST = 22;   // 切換攻擊距離 px
var DRAG_MAX_VY = -3.5;      // 最大跳躍力（限制高度 ~41px）
var DRAG_ABOVE_THRESHOLD = 20; // 正上方判定範圍（±px），避免左右甩動

// ── 更新：追球 / 踢球 / 閒置 AI ──
function updateChaseKickIdle(sw, ballState, defs) {
  if (!_s()) return false;
  var _isDrag = window.ColorCatBall && ColorCatBall.isDragging();

  if (ch.action === 'chase') {
    if (_isDrag) {
      // ── 拖曳模式 ──
      var dxDrag = Math.abs(ballState.x - ch.x);
      var isAbove = dxDrag <= DRAG_ABOVE_THRESHOLD;

      if (isAbove) {
        // ── 球在正上方：不移動，原地跳 → 接近後攻擊 ──
        // 面向保持不變（避免甩動）
        if (ch.onGround) {
          var floorY0 = C.CHAR_GROUND_Y - 6;
          var ballH0 = floorY0 - ballState.y - ballState.r;
          if (ballH0 > 5) {
            var jp0 = Math.max(DRAG_MAX_VY, -(Math.sqrt(2 * 0.15 * Math.max(ballH0, 20)) + 0.5));
            ch.vy = jp0; ch.onGround = false;
          } else {
            // 球很低，直接攻擊
            ch._dragKickPhase = 0;
            ch.action = 'kick'; ch.actionFrame = 0;
            ch.spriteFrame = 0; ch.spriteTimer = 0; ch._kicked = false;
          }
        }
        // 空中：檢查是否接近球可以攻擊
        if (!ch.onGround) {
          var dy0 = Math.abs(ballState.y - (ch.y - C.SPRITE_DRAW * 0.4));
          var dist0 = Math.sqrt(dxDrag * dxDrag + dy0 * dy0);
          if (dist0 < DRAG_ATTACK_DIST + ballState.r) {
            ch.facing = (ballState.x >= ch.x) ? 1 : -1;
            ch._dragKickPhase = 1; ch._kickFacing = ch.facing;
            ch.action = 'kick'; ch.actionFrame = 0;
            ch.spriteFrame = 0; ch.spriteTimer = 0; ch._kicked = false;
          }
        }
      } else {
        // ── 球不在正上方：跑向球 → 到距離後起跳 ──
        ch.facing = (ballState.x >= ch.x) ? 1 : -1;
        if (dxDrag > DRAG_JUMP_DIST) {
          ch.x += ch.facing * ch.speed * 1.3;
        } else {
          // 起跳距離內：跳向球
          if (ch.onGround) {
            var floorY = C.CHAR_GROUND_Y - 6;
            var ballH = floorY - ballState.y - ballState.r;
            var jp = ballH > 10
              ? Math.max(DRAG_MAX_VY, -(Math.sqrt(2 * 0.15 * Math.max(ballH, 20)) + 0.5))
              : -2.5;
            ch.vy = jp; ch.onGround = false;
          }
          ch._dragKickPhase = 0;
          ch.action = 'kick'; ch.actionFrame = 0;
          ch.spriteFrame = 0; ch.spriteTimer = 0; ch._kicked = false;
        }
      }
    } else {
      // ── 一般追球：方向固定 ──
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
          ch.vy = jumpPower2; ch.onGround = false;
        }
        ch._chaseFacing = 0; ch._dragKickPhase = undefined;
        ch.action = 'kick'; ch.actionFrame = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0; ch._kicked = false;
      }
    }
  } else if (ch.action === 'kick') {
    ch.actionFrame++;
    // 空中物理（kick 排除 character.js 通用重力）
    if (!ch.onGround) {
      ch.vy += 0.15; ch.y += ch.vy;
      if (ch.y >= C.CHAR_GROUND_Y) {
        ch.y = C.CHAR_GROUND_Y; ch.onGround = true; ch.vy = 0;
      }
    }
    if (ch._dragKickPhase !== undefined) {
      // ── 拖曳 kick（兩階段，拖曳結束後仍播完動畫） ──
      if (ch._dragKickPhase === 0) {
        // 跳躍階段：朝球飛行，接近時切攻擊
        var dx0 = Math.abs(ballState.x - ch.x);
        var isAbove0 = dx0 <= DRAG_ABOVE_THRESHOLD;
        if (!isAbove0) {
          ch.facing = (ballState.x >= ch.x) ? 1 : -1;
          ch.x += ch.facing * ch.speed * 0.8;
        }
        // 不更新 dx0，用原值判定距離
        var dy0 = Math.abs(ballState.y - (ch.y - C.SPRITE_DRAW * 0.4));
        var dist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
        if (dist0 < DRAG_ATTACK_DIST + ballState.r) {
          ch.facing = (ballState.x >= ch.x) ? 1 : -1;
          ch._dragKickPhase = 1; ch._kickFacing = ch.facing;
          ch.spriteFrame = 0; ch.spriteTimer = 0; ch.actionFrame = 0;
        } else if (ch.onGround && ch.actionFrame > 8) {
          // 落地未打到：回到 chase 重新跳
          ch._dragKickPhase = undefined;
          if (_isDrag && _s().stamina.current > 0) {
            ch.action = 'chase'; ch.actionFrame = 0;
            ch.spriteFrame = 0; ch.spriteTimer = 0;
          } else { ch.action = 'idle'; ch.actionFrame = 0; ch.spriteFrame = 0; ch.spriteTimer = 0; }
        }
      } else {
        // 攻擊階段：方向鎖定，命中判定，動畫播完才結束
        ch.facing = ch._kickFacing;
        var hitFrame = _s().physics.hitFrame;
        if (!ch._kicked && ch.spriteFrame >= hitFrame) {
          var dx1 = Math.abs(ballState.x - ch.x);
          var dy1 = Math.abs(ballState.y - (ch.y - C.SPRITE_DRAW * 0.4));
          var hd = Math.sqrt(dx1 * dx1 + dy1 * dy1);
          if (hd < C.SPRITE_DRAW * 0.6 + ballState.r) {
            ch._kicked = true; _s().runtime.totalKicks++;
            return true;   // 踢飛球（場景釋放拖曳 + 踢球，_dragKickPhase 保留讓動畫播完）
          }
        }
        var atkTotal = Math.ceil(defs.attack.frames / defs.attack.speed);
        if (ch.onGround && ch.actionFrame > atkTotal) {
          ch._dragKickPhase = undefined;
          if (_isDrag && _s().stamina.current > 0) {
            ch.action = 'chase'; ch.actionFrame = 0;
            ch.spriteFrame = 0; ch.spriteTimer = 0;
          } else { ch.action = 'idle'; ch.actionFrame = 0; ch.spriteFrame = 0; ch.spriteTimer = 0; }
        } else if (ch.actionFrame > atkTotal + 60) {
          ch.y = C.CHAR_GROUND_Y; ch.onGround = true; ch.vy = 0;
          ch._dragKickPhase = undefined;
          ch.action = 'idle'; ch.actionFrame = 0; ch.spriteFrame = 0; ch.spriteTimer = 0;
        }
      }
    } else {
      // ── 一般 kick（非拖曳） ──
      ch._dragKickPhase = undefined;
      var attackDef = defs.attack;
      var totalFrames = Math.ceil(attackDef.frames / attackDef.speed);
      var hitFrame2 = _s().physics.hitFrame;
      if (!ch._kicked && ch.spriteFrame >= hitFrame2) {
        var dx2 = Math.abs(ballState.x - ch.x);
        var dy2 = Math.abs(ballState.y - (ch.y - C.SPRITE_DRAW * 0.4));
        var hd2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (hd2 < C.SPRITE_DRAW * 0.6 + ballState.r) {
          ch._kicked = true; _s().runtime.totalKicks++;
          return true;
        }
      }
      if (ch.actionFrame > totalFrames) {
        if (ch.onGround) {
          ch.action = 'idle'; ch.actionFrame = 0;
          ch.spriteFrame = 0; ch.spriteTimer = 0;
        } else if (ch.actionFrame > totalFrames + 60) {
          ch.y = C.CHAR_GROUND_Y; ch.onGround = true; ch.vy = 0;
          ch.action = 'idle'; ch.actionFrame = 0;
          ch.spriteFrame = 0; ch.spriteTimer = 0;
        }
      }
    }
  } else {
    // 拖曳中且有體力 → 立即追球
    if (_isDrag && _s() && _s().stamina.current > 0) {
      ch.action = 'chase'; ch.actionFrame = 0;
      ch.spriteFrame = 0; ch.spriteTimer = 0; ch._chaseFacing = 0;
      return false;
    }
    if (ballState.x > ch.x + 5) ch.facing = 1;
    else if (ballState.x < ch.x - 5) ch.facing = -1;
    if (!_.testMode && _.aiSceneInfo) {
      _.aiTimer++;
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
