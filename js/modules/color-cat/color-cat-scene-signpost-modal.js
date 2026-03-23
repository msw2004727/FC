/* ================================================
   ColorCat — 路牌彈窗（爬山 / 旅遊 / 拜訪）
   點擊右下路牌觸發，毛玻璃風格
   依賴：color-cat-character.js, color-cat-scene.js
   ================================================ */
;(function() {

var _overlay = null;
var _styleEl = null;

var CSS = [
  '.cc-sp-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s ease;pointer-events:none}',
  '.cc-sp-overlay.open{opacity:1;pointer-events:auto}',
  '.cc-sp-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}',
  '.cc-sp-modal{position:relative;display:flex;flex-direction:column;gap:10px;background:#F5E6C8;border-radius:16px;padding:1.1rem 1.2rem;min-width:180px;max-width:70vw;box-shadow:0 8px 32px rgba(0,0,0,.15);font-family:"Noto Sans TC",-apple-system,sans-serif}',
  '[data-theme="dark"] .cc-sp-modal{background:#2E2418;color:#E8D4A8;box-shadow:0 8px 32px rgba(0,0,0,.6)}',
  '.cc-sp-title{text-align:center;font-size:.82rem;font-weight:700;color:#8B7355;margin-bottom:2px;letter-spacing:1px}',
  '[data-theme="dark"] .cc-sp-title{color:#8A7B60}',
  '.cc-sp-btn{display:block;width:100%;padding:.65rem 0;border:none;border-radius:10px;font-size:.92rem;font-weight:700;cursor:pointer;text-align:center;transition:background .2s,transform .1s}',
  '.cc-sp-btn:active{transform:scale(.96)}',
  '.cc-sp-btn--hike{background:#6B8E5A;color:#fff}',
  '.cc-sp-btn--travel{background:#4A7DB8;color:#fff}',
  '.cc-sp-btn--visit{background:#B8784A;color:#fff}',
  '[data-theme="dark"] .cc-sp-btn--hike{background:#4A6B3A}',
  '[data-theme="dark"] .cc-sp-btn--travel{background:#3A5A8A}',
  '[data-theme="dark"] .cc-sp-btn--visit{background:#8A5A3A}',
].join('\n');

function _injectStyles() {
  if (_styleEl) return;
  _styleEl = document.createElement('style');
  _styleEl.textContent = CSS;
  document.head.appendChild(_styleEl);
}

function _createOverlay() {
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'cc-sp-overlay';
  _overlay.innerHTML =
    '<div class="cc-sp-backdrop"></div>' +
    '<div class="cc-sp-modal">' +
      '<div class="cc-sp-title">\u51FA\u767C\u524D\u5F80...</div>' +
      '<button class="cc-sp-btn cc-sp-btn--hike" data-action="hike">\u2F30 \u722C\u5C71</button>' +
      '<button class="cc-sp-btn cc-sp-btn--travel" data-action="travel">\u2708 \u65C5\u904A</button>' +
      '<button class="cc-sp-btn cc-sp-btn--visit" data-action="visit">\u2F24 \u62DC\u8A2A</button>' +
    '</div>';

  _overlay.querySelector('.cc-sp-backdrop').addEventListener('click', close);

  var btns = _overlay.querySelectorAll('.cc-sp-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function() {
      var action = this.getAttribute('data-action');
      close();
      _dispatch(action);
    });
  }

  // 觸控穿透防護：backdrop 攔截，modal 內部允許
  _overlay.addEventListener('touchmove', function(e) {
    var modal = _overlay.querySelector('.cc-sp-modal');
    if (modal && modal.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
  }, { passive: false });
  _overlay.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });

  document.body.appendChild(_overlay);
}

function _dispatch(action) {
  var Ch = window.ColorCatCharacter;
  if (!Ch) return;
  var sw = (window.ColorCatScene && ColorCatScene.getSw) ? ColorCatScene.getSw() : 300;

  if (action === 'hike') {
    // 爬山：用現有的 runAway 動畫（含背景爬山剪影）
    Ch._.awayMode = 'hike';
    Ch.startRunAway(sw);
  } else if (action === 'travel') {
    // 旅遊：角色直接離場，無爬山動畫
    Ch._.awayMode = 'travel';
    _sendAway(Ch, sw);
  } else if (action === 'visit') {
    // 拜訪：角色直接離場，無爬山動畫
    Ch._.awayMode = 'visit';
    _sendAway(Ch, sw);
  }
}

/** 角色立即離場（不播放跑步動畫） */
function _sendAway(Ch, sw) {
  var C = window.ColorCatConfig;
  var ch = Ch.state;
  if (ch.action === 'weak' || ch.action === 'knockback' || ch.action === 'dying' || ch.action === 'hurt') return;
  if (Ch._.testMode) Ch._.stopTest();
  Ch._.releaseBall();
  if (ch.action === 'combo') { if (Ch._.interruptCombo) Ch._.interruptCombo(); }
  if (ch.action === 'sleeping') { Ch._.wakeUp(); Ch._.manualSleep = false; }
  ch.x = sw + (C ? C.SPRITE_DRAW : 32) + 10;
  ch.action = 'idle';
  ch.spriteFrame = 0; ch.spriteTimer = 0;
  Ch._.signpostAway = true;
}

function open() {
  if (!_overlay) _createOverlay();
  requestAnimationFrame(function() { _overlay.classList.add('open'); });
}

function close() {
  if (_overlay) _overlay.classList.remove('open');
}

window.ColorCatSignpostModal = {
  open: open,
  close: close,
};

})();
