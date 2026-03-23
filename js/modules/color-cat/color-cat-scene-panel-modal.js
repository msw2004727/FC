/* ================================================
   ColorCat — 面板放大彈窗（HTML 毛玻璃彈窗，與畫布面板同步）
   點擊已展開面板內容區觸發，顯示基本/狀態/裝備頁籤
   依賴：color-cat-profile.js, color-cat-sprite.js
   ================================================ */
;(function() {

var _overlay = null;
var _styleEl = null;
var _tab = 0;

// ── CSS ──
var CSS = [
  // overlay + backdrop（毛玻璃）
  '.cc-panel-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s ease;pointer-events:none}',
  '.cc-panel-overlay.open{opacity:1;pointer-events:auto}',
  '.cc-panel-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}',
  // modal
  '.cc-panel-modal{position:relative;display:flex;flex-direction:column;background:#F5E6C8;border-radius:16px;padding:0;min-width:260px;max-width:88vw;max-height:80vh;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.15);font-family:"Noto Sans TC",-apple-system,sans-serif;touch-action:none}',
  '[data-theme="dark"] .cc-panel-modal{background:#2E2418;color:#E8D4A8;box-shadow:0 8px 32px rgba(0,0,0,.6)}',
  // tabs
  '.cc-panel-tabs{display:flex;border-bottom:2px solid #C4A46E;padding:0}',
  '[data-theme="dark"] .cc-panel-tabs{border-bottom-color:#5A4830}',
  '.cc-panel-tab{flex:1;padding:.55rem .3rem;text-align:center;font-size:.82rem;font-weight:700;cursor:pointer;color:#8B7355;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .2s,border-color .2s}',
  '[data-theme="dark"] .cc-panel-tab{color:#8A7B60}',
  '.cc-panel-tab.active{color:#4A3520;border-bottom-color:#4A3520}',
  '[data-theme="dark"] .cc-panel-tab.active{color:#E8D4A8;border-bottom-color:#E8D4A8}',
  // content
  '.cc-panel-body{padding:.8rem;overflow-y:auto;flex:1}',
  // close
  '.cc-panel-close{position:absolute;top:8px;right:8px;width:28px;height:28px;border:2px solid #C4A46E;border-radius:50%;background:none;cursor:pointer;font-size:1rem;line-height:1;color:#8B7355;display:flex;align-items:center;justify-content:center;padding:0}',
  '[data-theme="dark"] .cc-panel-close{border-color:#5A4830;color:#8A7B60}',
  '.cc-panel-close:hover{background:rgba(0,0,0,.08);border-color:#8B7355;color:#4A3520}',
  '[data-theme="dark"] .cc-panel-close:hover{background:rgba(255,255,255,.1);border-color:#AA9060;color:#E8D4A8}',
  // 基本資料卡片
  '.cc-panel-card{display:flex;gap:.6rem;margin-bottom:.8rem}',
  '.cc-panel-avatar{width:80px;height:80px;background:rgba(0,0,0,.06);border-radius:8px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center}',
  '[data-theme="dark"] .cc-panel-avatar{background:rgba(0,0,0,.4)}',
  '.cc-panel-avatar canvas{image-rendering:pixelated;image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges}',
  '.cc-panel-info{flex:1;display:flex;flex-direction:column;gap:.3rem}',
  '.cc-panel-name{font-size:1.1rem;font-weight:800;color:#4A3520}',
  '[data-theme="dark"] .cc-panel-name{color:#E8D4A8}',
  '.cc-panel-title{font-size:.78rem;color:#8B7355}',
  '[data-theme="dark"] .cc-panel-title{color:#8A7B60}',
  // 數值格
  '.cc-panel-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
  '.cc-panel-stat{background:rgba(0,0,0,.06);border-radius:6px;padding:.4rem .2rem;text-align:center}',
  '[data-theme="dark"] .cc-panel-stat{background:rgba(0,0,0,.4)}',
  '.cc-panel-stat .lbl{font-size:.68rem;color:#8B7355;margin-bottom:2px}',
  '[data-theme="dark"] .cc-panel-stat .lbl{color:#8A7B60}',
  '.cc-panel-stat .val{font-size:1.1rem;font-weight:700;color:#4A3520;font-family:"Courier New",monospace}',
  '[data-theme="dark"] .cc-panel-stat .val{color:#E8D4A8}',
  // 狀態卡片
  '.cc-panel-section{margin-bottom:.6rem}',
  '.cc-panel-section-title{font-size:.72rem;font-weight:700;color:#8B7355;margin-bottom:.25rem;letter-spacing:.5px}',
  '[data-theme="dark"] .cc-panel-section-title{color:#8A7B60}',
  '.cc-panel-section-value{background:rgba(255,255,255,.6);border:1px solid #C4A46E;border-radius:8px;padding:.45rem .6rem;text-align:center;font-size:.85rem;color:#4A3520}',
  '[data-theme="dark"] .cc-panel-section-value{background:rgba(0,0,0,.3);border-color:#5A4830;color:#E8D4A8}',
  // 裝備格
  '.cc-panel-equips{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
  '.cc-panel-equip{text-align:center}',
  '.cc-panel-equip-slot{width:100%;aspect-ratio:1;background:rgba(0,0,0,.06);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:3px}',
  '[data-theme="dark"] .cc-panel-equip-slot{background:rgba(0,0,0,.4)}',
  '.cc-panel-equip-name{font-size:.68rem;color:#8B7355}',
  '[data-theme="dark"] .cc-panel-equip-name{color:#8A7B60}',
].join('\n');

function _injectStyles() {
  if (_styleEl) return;
  _styleEl = document.createElement('style');
  _styleEl.textContent = CSS;
  document.head.appendChild(_styleEl);
}

// ── 建立 Overlay ──
function _createOverlay() {
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'cc-panel-overlay';
  _overlay.innerHTML =
    '<div class="cc-panel-backdrop"></div>' +
    '<div class="cc-panel-modal">' +
      '<div class="cc-panel-tabs">' +
        '<div class="cc-panel-tab active" data-tab="0">\u57FA\u672C</div>' +
        '<div class="cc-panel-tab" data-tab="1">\u72C0\u614B</div>' +
        '<div class="cc-panel-tab" data-tab="2">\u88DD\u5099</div>' +
      '</div>' +
      '<div class="cc-panel-body" id="cc-panel-body"></div>' +
      '<button class="cc-panel-close">\u00D7</button>' +
    '</div>';
  _overlay.querySelector('.cc-panel-backdrop').addEventListener('click', close);
  _overlay.querySelector('.cc-panel-close').addEventListener('click', close);
  // 頁籤切換
  var tabs = _overlay.querySelectorAll('.cc-panel-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function() {
      _tab = parseInt(this.getAttribute('data-tab'));
      _updateTabs();
      _renderContent();
    });
  }
  // 阻止觸控穿透
  _overlay.addEventListener('touchmove', function(e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  _overlay.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });
  document.body.appendChild(_overlay);
}

function _updateTabs() {
  if (!_overlay) return;
  var tabs = _overlay.querySelectorAll('.cc-panel-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', i === _tab);
  }
}

// ── 渲染頁籤內容 ──
function _renderContent() {
  var el = document.getElementById('cc-panel-body');
  if (!el) return;
  el.innerHTML = '';
  if (_tab === 0) _renderTab0(el);
  else if (_tab === 1) _renderTab1(el);
  else _renderTab2(el);
}

// ── Tab0：基本資料 ──
function _renderTab0(el) {
  var P = window.ColorCatProfile;
  if (!P) return;

  // 頭像 + 名字
  var card = document.createElement('div');
  card.className = 'cc-panel-card';

  var avatarWrap = document.createElement('div');
  avatarWrap.className = 'cc-panel-avatar';
  var cvs = document.createElement('canvas');
  cvs.width = 80; cvs.height = 80;
  _drawAvatarToCanvas(cvs);
  avatarWrap.appendChild(cvs);

  var info = document.createElement('div');
  info.className = 'cc-panel-info';
  var nameEl = document.createElement('div');
  nameEl.className = 'cc-panel-name';
  nameEl.textContent = P.getName();
  var titleEl = document.createElement('div');
  titleEl.className = 'cc-panel-title';
  titleEl.textContent = P.getLevelText();
  info.appendChild(nameEl);
  info.appendChild(titleEl);
  card.appendChild(avatarWrap);
  card.appendChild(info);
  el.appendChild(card);

  // 六項數值
  var stats = P.getStats();
  var keys = P.STAT_KEYS;
  var labels = P.STAT_LABELS;
  var grid = document.createElement('div');
  grid.className = 'cc-panel-stats';
  for (var i = 0; i < keys.length; i++) {
    var stat = document.createElement('div');
    stat.className = 'cc-panel-stat';
    var lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = labels[keys[i]];
    var val = document.createElement('div');
    val.className = 'val';
    val.textContent = stats[keys[i]];
    stat.appendChild(lbl);
    stat.appendChild(val);
    grid.appendChild(stat);
  }
  el.appendChild(grid);
}

// ── Tab1：狀態 ──
function _renderTab1(el) {
  var P = window.ColorCatProfile;
  if (!P) return;
  var items = [
    { title: '\u72C0\u614B', value: P.getStatus() },
    { title: '\u500B\u6027', value: P.getMBTI() },
    { title: '\u5FC3\u60C5', value: P.getMood() },
  ];
  for (var i = 0; i < items.length; i++) {
    var sec = document.createElement('div');
    sec.className = 'cc-panel-section';
    var t = document.createElement('div');
    t.className = 'cc-panel-section-title';
    t.textContent = '-- ' + items[i].title + ' --';
    var v = document.createElement('div');
    v.className = 'cc-panel-section-value';
    v.textContent = items[i].value;
    sec.appendChild(t);
    sec.appendChild(v);
    el.appendChild(sec);
  }
}

// ── Tab2：裝備 ──
function _renderTab2(el) {
  var P = window.ColorCatProfile;
  if (!P) return;
  var slots = ['top', 'gloves', 'hat', 'pants', 'shoes', 'accessory'];
  var labels = P.EQUIP_LABELS;
  var equipped = P.getEquipped();
  var grid = document.createElement('div');
  grid.className = 'cc-panel-equips';
  for (var i = 0; i < slots.length; i++) {
    var wrap = document.createElement('div');
    wrap.className = 'cc-panel-equip';
    var slot = document.createElement('div');
    slot.className = 'cc-panel-equip-slot';
    var item = equipped[slots[i]];
    slot.textContent = item ? (item.icon || '?') : '';
    var name = document.createElement('div');
    name.className = 'cc-panel-equip-name';
    name.textContent = labels[slots[i]];
    wrap.appendChild(slot);
    wrap.appendChild(name);
    grid.appendChild(wrap);
  }
  el.appendChild(grid);
}

// ── 頭像繪製 ──
function _drawAvatarToCanvas(canvas) {
  var img = window.ColorCatSprite && ColorCatSprite.getImage('idle');
  if (!img) return;
  var C = window.ColorCatConfig;
  var defs = ColorCatSprite.getDefs();
  var def = defs['idle'];
  var fw = (def && def.fw) ? def.fw : C.SPRITE_SIZE;
  var sh = C.SPRITE_SIZE;
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  var scale = Math.min(80 / fw, 80 / sh);
  var dw = fw * scale, dh = sh * scale;
  var dx = (80 - dw) / 2, dy = (80 - dh) / 2;
  ctx.drawImage(img, 0, 0, fw, sh, dx, dy, dw, dh);
}

// ── 開啟 ──
function open(tab) {
  if (!_overlay) _createOverlay();
  _tab = tab || 0;
  _updateTabs();
  _renderContent();
  requestAnimationFrame(function() { _overlay.classList.add('open'); });
}

// ── 關閉 ──
function close() {
  if (_overlay) _overlay.classList.remove('open');
}

window.ColorCatPanelModal = {
  open: open,
  close: close,
};

})();
