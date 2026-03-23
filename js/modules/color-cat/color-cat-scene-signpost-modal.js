/* ================================================
   ColorCat — 路牌彈窗（爬山 / 旅遊 / 拜訪）
   角色跑出場景後觸發，選擇離場目的地
   點外部關閉 = 角色返回場景
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
      '<button class="cc-sp-btn cc-sp-btn--hike" data-action="hike">\u26F0\uFE0F \u722C\u5C71</button>' +
      '<button class="cc-sp-btn cc-sp-btn--travel" data-action="travel">\u2708\uFE0F \u65C5\u904A</button>' +
      '<button class="cc-sp-btn cc-sp-btn--visit" data-action="visit">\uD83D\uDC65 \u62DC\u8A2A</button>' +
    '</div>';

  // 點外部 = 關閉並返回場景
  _overlay.querySelector('.cc-sp-backdrop').addEventListener('click', _cancelAndReturn);

  var btns = _overlay.querySelectorAll('.cc-sp-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function() {
      var action = this.getAttribute('data-action');
      _closeOverlay();
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

/** 角色已在場外，選擇設定 awayMode */
function _dispatch(action) {
  var Ch = window.ColorCatCharacter;
  if (!Ch) return;
  Ch._.awayMode = action; // 'hike' / 'travel' / 'visit'
}

/** 關閉彈窗但不返回 */
function _closeOverlay() {
  if (_overlay) _overlay.classList.remove('open');
}

/** 關閉彈窗 + 角色返回場景（用戶點外部取消） */
function _cancelAndReturn() {
  _closeOverlay();
  var Ch = window.ColorCatCharacter;
  if (!Ch) return;
  var sw = (window.ColorCatScene && ColorCatScene.getSw) ? ColorCatScene.getSw() : 300;
  Ch._.awayMode = '';
  Ch.startReturnPanting(sw);
}

function open() {
  if (!_overlay) _createOverlay();
  requestAnimationFrame(function() { _overlay.classList.add('open'); });
}

window.ColorCatSignpostModal = {
  open: open,
  close: _cancelAndReturn,
};

})();
