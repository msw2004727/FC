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

  var draining = (act === 'chase' || act === 'kick' || act === 'dash' ||
                  act === 'biteBall' || act === 'jumpOff' ||
                  (act === 'combo') || _.testMode);
  var walking = (act === 'goToBox');

  if (draining) {
    st.current = Math.max(0, st.current - st.drain);
  } else if (act === 'sleeping') {
    st.current = Math.min(st.max, st.current + st.regenSleep);
  } else if (act === 'weak') {
    st.current = Math.min(st.max, st.current + st.regenWeak);
  } else if (walking) {
    st.current = Math.min(st.max, st.current + st.regenWalk);
  } else {
    st.current = Math.min(st.max, st.current + st.regenIdle);
  }

  // 虛弱觸發
  var pct = st.current / st.max * 100;
  if (act !== 'sleeping' && act !== 'weak' && act !== 'goToBox') {
    if (pct <= st.weakThreshold2) {
      if (_.testMode) _.stopTest();
      _.releaseBall();
      if (act === 'combo') _.endCombo();
      rt.weakLevel = 2;
      ch.action = 'weak'; ch.y = C.CHAR_GROUND_Y; ch.onGround = true;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    } else if (pct <= st.weakThreshold1) {
      if (_.testMode) _.stopTest();
      _.releaseBall();
      if (act === 'combo') _.endCombo();
      rt.weakLevel = 1;
      ch.action = 'weak'; ch.y = C.CHAR_GROUND_Y; ch.onGround = true;
      ch.spriteFrame = 0; ch.spriteTimer = 0;
    }
  }

  // 虛弱2：必須全滿才能恢復
  if (act === 'weak' && rt.weakLevel === 2) {
    if (st.current >= st.max) {
      rt.weakLevel = 0; ch.action = 'idle';
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.aiResetCooldown();
    }
    return;
  }
  // 虛弱1：體力回到恢復門檻以上
  if (act === 'weak' && rt.weakLevel === 1) {
    if (pct > st.recoverThreshold) {
      rt.weakLevel = 0; ch.action = 'idle';
      ch.spriteFrame = 0; ch.spriteTimer = 0;
      _.aiResetCooldown();
    }
  }
}

function drawStaminaBar(ctx) {
  if (ch.action === 'sleeping' || !_s()) return;
  var st = _s().stamina;
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
