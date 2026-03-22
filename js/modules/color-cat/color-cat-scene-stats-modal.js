/* ================================================
   ColorCat — 戰績統計彈窗（卡片式毛玻璃 HTML 彈窗）
   點擊紙箱觸發，顯示摘花/擊殺/對戰統計
   依賴：color-cat-stats.js, color-cat-enemy.js
   ================================================ */
;(function() {

var _overlay = null;
var _styleEl = null;
var _toastTimer = null;
var _iconCache = {};

// ── CSS ──
var CSS = [
  // overlay + backdrop
  '.gg-stats-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s ease;pointer-events:none}',
  '.gg-stats-overlay.open{opacity:1;pointer-events:auto}',
  '.gg-stats-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}',
  // modal
  '.gg-stats-modal{position:relative;background:#fff;border-radius:16px;padding:.9rem 1rem 1rem;min-width:240px;max-width:88vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.15);font-family:"Noto Sans TC",-apple-system,sans-serif}',
  '[data-theme="dark"] .gg-stats-modal{background:#1e1e1e;color:#e8e8e8;box-shadow:0 8px 32px rgba(0,0,0,.6)}',
  // title + divider
  '.gg-stats-title{text-align:center;font-size:.95rem;font-weight:700;margin-bottom:.5rem;letter-spacing:.5px}',
  '.gg-stats-divider{text-align:center;font-size:.68rem;color:#555;margin:3.25rem 0 .35rem;letter-spacing:2px}',
  '[data-theme="dark"] .gg-stats-divider{color:#aaa}',
  // grid
  '.gg-stats-grid{display:grid;gap:5px}',
  '.gg-stats-grid.cols-2{grid-template-columns:repeat(2,1fr)}',
  '.gg-stats-grid.cols-3{grid-template-columns:repeat(3,1fr)}',
  // card
  '.gg-stats-card{display:flex;flex-direction:column;align-items:center;padding:4px 3px 5px;background:#f8f8f8;border-radius:10px;border:1px solid #eee}',
  '[data-theme="dark"] .gg-stats-card{background:#2a2a2a;border-color:#3a3a3a}',
  '.gg-stats-card canvas{display:block;width:100%;aspect-ratio:1;image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;image-rendering:pixelated}',
  '.gg-stats-card .label{font-size:.68rem;margin-top:1px;text-align:center;line-height:1.15;color:#555}',
  '[data-theme="dark"] .gg-stats-card .label{color:#aaa}',
  '.gg-stats-card .count{font-weight:700;font-size:.75rem;color:#333;line-height:1.2}',
  '[data-theme="dark"] .gg-stats-card .count{color:#ddd}',
  '.gg-stats-card .boss{font-size:.58rem;color:#e67e22;font-weight:600;line-height:1}',
  // flower card: 不放大
  '.gg-stats-card.flower canvas{width:48px;height:48px}',
  // enemy card: 文字緊貼圖片
  '.gg-stats-card.enemy .label{margin-top:-2px}',
  // pvp row-card
  '.gg-stats-pvp{display:flex;align-items:center;gap:.4rem;padding:.4rem .7rem;background:#f8f8f8;border-radius:10px;border:1px solid #eee;font-size:.78rem}',
  '[data-theme="dark"] .gg-stats-pvp{background:#2a2a2a;border-color:#3a3a3a}',
  '.gg-stats-pvp .name{flex:1}',
  '.gg-stats-pvp .count{font-weight:600;color:#333}',
  '[data-theme="dark"] .gg-stats-pvp .count{color:#ccc}',
  // close
  '.gg-stats-close{display:block;margin:.6rem auto 0;padding:.35rem 1.8rem;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;cursor:pointer;font-size:.78rem;font-family:inherit}',
  '[data-theme="dark"] .gg-stats-close{background:#333;border-color:#555;color:#eee}',
  '.gg-stats-close:hover{background:#e0e0e0}',
  '[data-theme="dark"] .gg-stats-close:hover{background:#444}',
  // toast
  '.gg-danger-toast{position:fixed;top:18%;left:50%;transform:translateX(-50%);background:rgba(220,38,38,.92);color:#fff;padding:.55rem 1.2rem;border-radius:10px;font-size:.8rem;z-index:10002;font-family:"Noto Sans TC",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:nowrap;animation:gg-toast-anim 2.2s ease forwards}',
  '@keyframes gg-toast-anim{0%{opacity:0;transform:translateX(-50%) translateY(8px)}10%{opacity:1;transform:translateX(-50%) translateY(0)}70%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-6px)}}',
].join('\n');

function _injectStyles() {
  if (_styleEl) return;
  _styleEl = document.createElement('style');
  _styleEl.textContent = CSS;
  document.head.appendChild(_styleEl);
}

// ── 花朵圖示（高解析程式繪製 48×48） ──
function _drawFlowerIcon(canvas, isGold) {
  canvas.width = 48; canvas.height = 48;
  var ctx = canvas.getContext('2d');
  var cx = 24, cy = 18;
  // 莖
  ctx.strokeStyle = '#4A8B3F'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx, 46); ctx.lineTo(cx, cy + 6); ctx.stroke();
  // 葉
  ctx.fillStyle = '#5DA849';
  ctx.save(); ctx.translate(cx - 2, 33); ctx.rotate(-0.5);
  ctx.beginPath(); ctx.ellipse(0, 0, 3, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(cx + 2, 33); ctx.rotate(0.5);
  ctx.beginPath(); ctx.ellipse(0, 0, 3, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  // 花瓣
  var pr = 9;
  ctx.fillStyle = isGold ? '#FFD700' : '#E8524A';
  for (var p = 0; p < 5; p++) {
    var a = (p / 5) * Math.PI * 2 - Math.PI / 2;
    var px = cx + Math.cos(a) * pr * 0.7;
    var py = cy + Math.sin(a) * pr * 0.7;
    ctx.beginPath(); ctx.arc(px, py, pr * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  // 花心
  ctx.fillStyle = isGold ? '#FF8C00' : '#FFD700';
  ctx.beginPath(); ctx.arc(cx, cy, pr * 0.35, 0, Math.PI * 2); ctx.fill();
}

// ── 敵人圖示（精靈圖裁切，高解析銳利） ──
function _loadEnemyIcon(skinKey, cb) {
  if (_iconCache[skinKey]) { cb(_iconCache[skinKey]); return; }
  var E = window.ColorCatEnemy;
  if (!E || !E.SKINS[skinKey]) { cb(null); return; }
  if (E._cache[skinKey] && E._cache[skinKey].idle) {
    _iconCache[skinKey] = E._cache[skinKey].idle;
    cb(_iconCache[skinKey]); return;
  }
  var folder = E.SKINS[skinKey].folder;
  var img = new Image();
  img.onload = function() { _iconCache[skinKey] = img; cb(img); };
  img.onerror = function() { cb(null); };
  img.src = 'img/sprites/' + folder + '/No_Shadows/' + folder + '_Idle-Sheet.png';
}

function _drawEnemyIcon(canvas, img) {
  // 從 96×96 精靈幀裁切 64×64 角色區域，放大至 192×192 保持銳利
  canvas.width = 192; canvas.height = 192;
  if (!img) return;
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 16, 24, 64, 64, 0, 0, 192, 192);
}

// ── 建立 Overlay ──
function _createOverlay() {
  _injectStyles();
  _overlay = document.createElement('div');
  _overlay.className = 'gg-stats-overlay';
  _overlay.innerHTML =
    '<div class="gg-stats-backdrop"></div>' +
    '<div class="gg-stats-modal">' +
      '<div class="gg-stats-title">\u6230\u7E3E\u7D71\u8A08</div>' +
      '<div id="gg-stats-content"></div>' +
      '<button class="gg-stats-close">\u95DC\u9589</button>' +
    '</div>';
  _overlay.querySelector('.gg-stats-backdrop').addEventListener('click', close);
  _overlay.querySelector('.gg-stats-close').addEventListener('click', close);
  document.body.appendChild(_overlay);
}

// ── 花朵卡片 ──
function _flowerCard(isGold, count) {
  var card = document.createElement('div');
  card.className = 'gg-stats-card flower';
  var cvs = document.createElement('canvas');
  _drawFlowerIcon(cvs, isGold);
  var lbl = document.createElement('div');
  lbl.className = 'label';
  lbl.textContent = isGold ? '\u9EC3\u82B1' : '\u7D05\u82B1';
  var ct = document.createElement('div');
  ct.className = 'count';
  ct.textContent = count;
  card.appendChild(cvs); card.appendChild(lbl); card.appendChild(ct);
  return card;
}

// ── 敵人卡片 ──
function _enemyCard(skinKey, name, count, bossCount) {
  var card = document.createElement('div');
  card.className = 'gg-stats-card enemy';
  var cvs = document.createElement('canvas');
  _loadEnemyIcon(skinKey, function(img) { _drawEnemyIcon(cvs, img); });
  var lbl = document.createElement('div');
  lbl.className = 'label';
  lbl.textContent = name;
  var ct = document.createElement('div');
  ct.className = 'count';
  ct.textContent = count;
  card.appendChild(cvs); card.appendChild(lbl); card.appendChild(ct);
  if (bossCount > 0) {
    var bs = document.createElement('div');
    bs.className = 'boss';
    bs.textContent = 'Boss ' + bossCount;
    card.appendChild(bs);
  }
  return card;
}

// ── 渲染統計內容 ──
function _renderContent() {
  var el = document.getElementById('gg-stats-content');
  if (!el) return;
  el.innerHTML = '';
  var rt = window.ColorCatStats ? ColorCatStats.runtime : {};
  var E = window.ColorCatEnemy;

  // 花朵（同一行 2 欄）
  var flowerGrid = document.createElement('div');
  flowerGrid.className = 'gg-stats-grid cols-2';
  flowerGrid.appendChild(_flowerCard(false, rt.flowersRed || 0));
  flowerGrid.appendChild(_flowerCard(true, rt.flowersGold || 0));
  el.appendChild(flowerGrid);

  // 擊殺紀錄
  var d1 = document.createElement('div');
  d1.className = 'gg-stats-divider';
  d1.textContent = '\u2500\u2500 \u64CA\u6BBA\u7D00\u9304 \u2500\u2500';
  el.appendChild(d1);

  if (E && E.SKINS) {
    var enemyGrid = document.createElement('div');
    enemyGrid.className = 'gg-stats-grid cols-3';
    var sks = Object.keys(E.SKINS);
    for (var i = 0; i < sks.length; i++) {
      var sk = sks[i];
      var kc = (rt.enemyKills && rt.enemyKills[sk]) || 0;
      var bc = (rt.enemyBossKills && rt.enemyBossKills[sk]) || 0;
      enemyGrid.appendChild(_enemyCard(sk, E.SKINS[sk].name, kc, bc));
    }
    el.appendChild(enemyGrid);
  }

  // 對戰紀錄
  var d2 = document.createElement('div');
  d2.className = 'gg-stats-divider';
  d2.textContent = '\u2500\u2500 \u5C0D\u6230\u7D00\u9304 \u2500\u2500';
  el.appendChild(d2);

  var pvp = document.createElement('div');
  pvp.className = 'gg-stats-pvp';
  var pvpIcon = document.createElement('span');
  pvpIcon.style.cssText = 'font-size:1rem;flex-shrink:0';
  pvpIcon.textContent = '\u2694';
  var pvpNm = document.createElement('span');
  pvpNm.className = 'name';
  pvpNm.textContent = '\u64CA\u6557\u73A9\u5BB6';
  var pvpCt = document.createElement('span');
  pvpCt.className = 'count';
  pvpCt.textContent = rt.playerKills || 0;
  pvp.appendChild(pvpIcon); pvp.appendChild(pvpNm); pvp.appendChild(pvpCt);
  el.appendChild(pvp);
}

// ── 開啟 ──
function open() {
  if (!_overlay) _createOverlay();
  _renderContent();
  requestAnimationFrame(function() { _overlay.classList.add('open'); });
}

// ── 關閉 ──
function close() {
  if (_overlay) _overlay.classList.remove('open');
}

// ── 危險提示 Toast ──
function showDangerToast() {
  _injectStyles();
  var old = document.querySelector('.gg-danger-toast');
  if (old) old.remove();
  clearTimeout(_toastTimer);
  var t = document.createElement('div');
  t.className = 'gg-danger-toast';
  t.textContent = '\u26A0 \u5468\u570D\u6709\u6575\u4EBA\uFF0C\u76EE\u524D\u7121\u6CD5\u67E5\u770B\u7D71\u8A08\uFF01';
  document.body.appendChild(t);
  _toastTimer = setTimeout(function() { if (t.parentNode) t.remove(); }, 2300);
}

window.ColorCatStatsModal = {
  open: open,
  close: close,
  showDangerToast: showDangerToast,
};

})();
