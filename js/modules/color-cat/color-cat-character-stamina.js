/* ================================================
   ColorCat — 角色體力系統（消耗、恢復、虛弱等級）
   依賴：color-cat-character.js (ColorCatCharacter._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

function updateStamina() {
  if (!_s()) return;
  var st = _s().stamina;
  var rt = _s().runtime;
  var act = ch.action;

  // 動作不再消耗體力，體力僅作為 HP（被攻擊扣血）
  // 恢復邏輯保留，讓被攻擊後能回血
  if (act === 'sleeping') {
    st.current = Math.min(st.max, st.current + st.regenSleep);
  } else if (act === 'weak') {
    st.current = Math.min(st.max, st.current + st.regenWeak);
  } else if (act === 'chase' || act === 'goToBox' || act === 'dash' || act === 'weeding') {
    st.current = Math.min(st.max, st.current + st.regenWalk);
  } else {
    st.current = Math.min(st.max, st.current + st.regenIdle);
  }

  // 體力歸零觸發力竭（貓咪原地喘氣、兔子下落姿勢）
  if (act !== 'sleeping' && act !== 'weak' && act !== 'goToBox' && act !== 'knockback' && act !== 'ultimate' && act !== 'dying' && act !== 'hurt') {
    if (st.current <= 0) {
      st.current = 0;
      if (_.testMode) _.stopTest();
      _.releaseBall();
      // 攀牆中體力歸零：先完成落地再進入虛弱
      if (act === 'combo' && _.comboType === 'wall') {
        _.pendingWeak = true;
        _.comboStep = 4; ch.onGround = false; ch.vy = 0;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      } else {
        if (act === 'combo') _.endCombo();
        rt.weakLevel = 1;
        ch.action = 'weak'; ch.y = C.CHAR_GROUND_Y; ch.onGround = true;
        ch.spriteFrame = 0; ch.spriteTimer = 0;
      }
    }
  }

  // 力竭恢復：必須補滿 100% 才能恢復
  if (act === 'weak' && rt.weakLevel > 0) {
    if (st.current >= st.max) {
      if (_.isBunny()) {
        // 兔子：反轉倒地動畫站起
        rt.weakLevel = 0;
        _.weakRecovering = true;
      } else {
        rt.weakLevel = 0; ch.action = 'idle';
        ch.spriteFrame = 0; ch.spriteTimer = 0;
        _.aiResetCooldown();
      }
    }
  }

  // 體力=HP 同步（單一數值條）
  _.charHp = st.current;
  _.charMaxHp = st.max;
}

function drawStaminaBar(ctx) {
  if (ch.action === 'sleeping' || !_s()) return;
  var st = _s().stamina;
  if (st.current >= st.max) return;  // 體力滿時隱藏
  var barW = 24, barH = 3;
  var bx = ch.x - barW / 2;
  var by = ch.y - C.SPRITE_DRAW + 4;
  var pct = st.current / st.max;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(bx - 0.5, by - 0.5, barW + 1, barH + 1);

  var r, g;
  if (pct > 0.5) { r = Math.floor((1 - pct) * 2 * 255); g = 200; }
  else { r = 255; g = Math.floor(pct * 2 * 200); }
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',50)';
  ctx.fillRect(bx, by, barW * pct, barH);
}

_.updateStamina = updateStamina;
_.drawStaminaBar = drawStaminaBar;

})();
