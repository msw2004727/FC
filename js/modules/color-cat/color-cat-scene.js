/* ================================================
   ColorCat — 場景主入口
   負責：背景繪製、主迴圈、點擊事件、App 掛載
   依賴：color-cat-config.js, color-cat-ball.js, color-cat-character.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _sceneInterval = null;
var _canvas, _ctx, _sw, _dpr;

// ── 紙箱設定 ──
var BOX_X = 35;               // 紙箱中心 X
var BOX_W = 51;                // 紙箱寬（橫放）
var BOX_H = 46;                // 紙箱高（橫放，加倍）
var BOX_BOTTOM_Y = 0;          // 紙箱底部 Y（init 時計算）
var _zzzTimer = 0;             // Zzz 動畫計時器
var _flagTimer = 0;            // 旗子飄揚計時器

// ── 旗子設定 ──
var FLAG_POLE_X = 0;           // 旗桿 X（init 時計算）
var FLAG_POLE_TOP = 0;         // 旗桿頂部 Y
var FLAG_POLE_H = 30;          // 旗桿高度
var FLAG_W = 18;               // 三角旗寬
var FLAG_H = 14;               // 三角旗高

// ===== 背景繪製 =====

function drawSun(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#FDB813';
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#FDB813'; ctx.lineWidth = 1.5;
  for (var i = 0; i < 8; i++) {
    var a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
    ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#F5E6B8';
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a1628';
  ctx.beginPath(); ctx.arc(x + 4, y - 2, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '6px serif';
  ctx.fillText('\u2726', x - 14, y - 4);
  ctx.fillText('\u2726', x - 8, y + 10);
  ctx.restore();
}

function drawBackground(ctx, sw, light) {
  // 天空漸層
  var grad = ctx.createLinearGradient(0, 0, 0, C.SCENE_H);
  if (light) {
    grad.addColorStop(0, '#87CEEB'); grad.addColorStop(0.7, '#B0E0F0'); grad.addColorStop(1, '#4CAF50');
  } else {
    grad.addColorStop(0, '#0a1628'); grad.addColorStop(0.7, '#0f2035'); grad.addColorStop(1, '#1a3a1a');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sw, C.SCENE_H);

  // 草地
  ctx.fillStyle = light ? '#4CAF50' : '#1a3a1a';
  ctx.fillRect(0, C.GROUND_Y, sw, C.SCENE_H - C.GROUND_Y);
  ctx.fillStyle = light ? '#388E3C' : '#153015';
  for (var gx = 0; gx < sw; gx += 6) ctx.fillRect(gx, C.GROUND_Y, 3, 2);
  ctx.fillStyle = light ? '#66BB6A' : '#1e4a1e';
  for (var gx2 = 3; gx2 < sw; gx2 += 10) ctx.fillRect(gx2, C.GROUND_Y, 2, 1);

  // 場地線
  ctx.fillStyle = light ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, C.GROUND_Y + 4, sw, 1);

  // 太陽/月亮
  if (light) drawSun(ctx, sw - 20, 18);
  else drawMoon(ctx, sw - 20, 18);
}

// ===== 紙箱繪製 =====

function drawBox(ctx, light, sleeping) {
  var bx = BOX_X - BOX_W / 2;
  var by = BOX_BOTTOM_Y - BOX_H;
  var openX = bx + BOX_W; // 開口在右側
  var midY = by + BOX_H / 2;
  // 開口尺寸（圓拱形洞口）
  var holeH = BOX_H * 0.7;
  var holeTop = midY - holeH / 2;
  var holeBot = midY + holeH / 2;

  ctx.save();

  // ── 箱體 ──
  ctx.fillStyle = light ? '#C8A06E' : '#7A5C3A';
  ctx.fillRect(bx, by, BOX_W, BOX_H);

  // 箱體邊框
  ctx.strokeStyle = light ? '#8B6914' : '#4A3520';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, BOX_W - 1, BOX_H - 1);

  // 橫向中線膠帶
  ctx.fillStyle = light ? '#D4B896' : '#8B7355';
  ctx.fillRect(bx, midY - 2, BOX_W - 4, 4);

  // 摺痕
  ctx.strokeStyle = light ? 'rgba(139,105,20,0.3)' : 'rgba(74,53,32,0.5)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(bx + 3, by + 5); ctx.lineTo(bx + BOX_W - 6, by + 5);
  ctx.moveTo(bx + 3, by + BOX_H - 5); ctx.lineTo(bx + BOX_W - 6, by + BOX_H - 5);
  ctx.stroke();

  // 左側封底
  ctx.fillStyle = light ? '#A8864E' : '#5A4028';
  ctx.fillRect(bx, by, 3, BOX_H);

  // ── 右側開口（圓拱形洞口） ──

  if (sleeping) {
    // 蓋子關閉 — 上下兩片蓋住洞口
    ctx.fillStyle = light ? '#B8935A' : '#6B4E30';
    // 上蓋（從箱頂向下蓋到中間）
    ctx.beginPath();
    ctx.moveTo(openX, by);
    ctx.lineTo(openX + 6, by);
    ctx.lineTo(openX + 8, midY - 1);
    ctx.lineTo(openX, midY - 1);
    ctx.closePath(); ctx.fill();
    // 下蓋（從箱底向上蓋到中間）
    ctx.beginPath();
    ctx.moveTo(openX, by + BOX_H);
    ctx.lineTo(openX + 6, by + BOX_H);
    ctx.lineTo(openX + 8, midY + 1);
    ctx.lineTo(openX, midY + 1);
    ctx.closePath(); ctx.fill();

    // 蓋子邊框
    ctx.strokeStyle = light ? '#8B6914' : '#4A3520';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(openX + 6, by); ctx.lineTo(openX + 8, midY - 1);
    ctx.moveTo(openX + 6, by + BOX_H); ctx.lineTo(openX + 8, midY + 1);
    ctx.stroke();
    // 中縫
    ctx.beginPath();
    ctx.moveTo(openX, midY); ctx.lineTo(openX + 8, midY);
    ctx.stroke();

    // Zzz
    drawZzz(ctx, openX + 6, by - 6, light);
  } else {
    // 蓋子打開 — 上蓋往上翻、下蓋往下翻
    ctx.fillStyle = light ? '#B8935A' : '#6B4E30';
    // 上蓋外翻
    ctx.beginPath();
    ctx.moveTo(openX, by);
    ctx.lineTo(openX + 8, by - 6);
    ctx.lineTo(openX + 8, by + 2);
    ctx.lineTo(openX, by + 4);
    ctx.closePath(); ctx.fill();
    // 下蓋外翻
    ctx.beginPath();
    ctx.moveTo(openX, by + BOX_H);
    ctx.lineTo(openX + 8, by + BOX_H + 6);
    ctx.lineTo(openX + 8, by + BOX_H - 2);
    ctx.lineTo(openX, by + BOX_H - 4);
    ctx.closePath(); ctx.fill();

    // 蓋子邊框
    ctx.strokeStyle = light ? '#8B6914' : '#4A3520';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(openX, by); ctx.lineTo(openX + 8, by - 6);
    ctx.lineTo(openX + 8, by + 2);
    ctx.moveTo(openX, by + BOX_H); ctx.lineTo(openX + 8, by + BOX_H + 6);
    ctx.lineTo(openX + 8, by + BOX_H - 2);
    ctx.stroke();
  }

  ctx.restore();
}

// ===== 旗子繪製 =====

function drawFlag(ctx, light) {
  _flagTimer += 0.03;
  var px = FLAG_POLE_X;
  var pTop = FLAG_POLE_TOP;
  var pBot = pTop + FLAG_POLE_H;

  ctx.save();

  // 旗桿
  ctx.strokeStyle = light ? '#8B7355' : '#6B5535';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, pBot);
  ctx.lineTo(px, pTop);
  ctx.stroke();

  // 旗桿頂部小球
  ctx.fillStyle = light ? '#D4A44A' : '#AA8030';
  ctx.beginPath();
  ctx.arc(px, pTop, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // 三角旗（飄揚效果）
  var wave1 = Math.sin(_flagTimer * 2) * 2;
  var wave2 = Math.sin(_flagTimer * 2 + 1.5) * 3;
  var fx = px + 1;
  var fy = pTop + 2;

  ctx.fillStyle = light ? '#E8524A' : '#C43830';
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  // 上邊（微波浪）
  ctx.quadraticCurveTo(fx + FLAG_W * 0.5, fy + wave1, fx + FLAG_W, fy + FLAG_H / 2 + wave2);
  // 下邊回來
  ctx.quadraticCurveTo(fx + FLAG_W * 0.5, fy + FLAG_H + wave1 * 0.5, fx, fy + FLAG_H);
  ctx.closePath();
  ctx.fill();

  // 旗子邊框
  ctx.strokeStyle = light ? '#B8322A' : '#8A2018';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(fx + FLAG_W * 0.5, fy + wave1, fx + FLAG_W, fy + FLAG_H / 2 + wave2);
  ctx.quadraticCurveTo(fx + FLAG_W * 0.5, fy + FLAG_H + wave1 * 0.5, fx, fy + FLAG_H);
  ctx.stroke();

  // 貓臉（簡易像素風）
  var faceX = fx + FLAG_W * 0.35 + wave1 * 0.3;
  var faceY = fy + FLAG_H / 2 + wave2 * 0.2;

  // 貓耳朵
  ctx.fillStyle = light ? '#FFF' : '#EEE';
  ctx.beginPath();
  ctx.moveTo(faceX - 3, faceY - 2);
  ctx.lineTo(faceX - 1.5, faceY - 5);
  ctx.lineTo(faceX, faceY - 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(faceX + 3, faceY - 2);
  ctx.lineTo(faceX + 1.5, faceY - 5);
  ctx.lineTo(faceX, faceY - 2);
  ctx.fill();

  // 臉（圓）
  ctx.fillStyle = light ? '#FFF' : '#EEE';
  ctx.beginPath();
  ctx.arc(faceX, faceY, 3, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = '#333';
  ctx.fillRect(faceX - 1.5, faceY - 1, 1, 1);
  ctx.fillRect(faceX + 0.5, faceY - 1, 1, 1);

  // 嘴巴
  ctx.fillRect(faceX - 0.5, faceY + 0.5, 1, 0.5);

  ctx.restore();
}

function isFlagClicked(cx, cy) {
  var fx = FLAG_POLE_X;
  var fy = FLAG_POLE_TOP;
  // 旗子+旗桿整體點擊區域
  return cx >= fx - 4 && cx <= fx + FLAG_W + 4 &&
         cy >= fy - 4 && cy <= fy + FLAG_POLE_H + 4;
}

function drawZzz(ctx, x, y, light) {
  _zzzTimer += 0.02;
  ctx.save();

  // 三個 Z 由大到小、由低到高浮動
  for (var i = 0; i < 3; i++) {
    var phase = _zzzTimer * 1.5 + i * 1.2;
    var floatY = Math.sin(phase) * 3.5;
    var alpha = 0.5 + Math.sin(phase + 0.5) * 0.3;
    var size = 12 - i * 2.5;
    ctx.font = 'bold ' + size + 'px monospace';
    ctx.fillStyle = light
      ? 'rgba(80,60,40,' + alpha + ')'
      : 'rgba(230,220,200,' + alpha + ')';
    ctx.fillText('Z', x + i * 8, y - i * 10 + floatY);
  }
  ctx.restore();
}

function isBoxClicked(cx, cy) {
  var bx = BOX_X - BOX_W / 2;
  var by = BOX_BOTTOM_Y - BOX_H - 6; // 包含蓋子高度
  return cx >= bx - 4 && cx <= bx + BOX_W + 4 && cy >= by && cy <= BOX_BOTTOM_Y + 4;
}

// ===== 主迴圈 =====

function render() {
  var light = !C.isThemeDark();
  var sleeping = ColorCatCharacter.isSleeping();
  drawBackground(_ctx, _sw, light);
  ColorCatBall.draw(_ctx, light);
  drawBox(_ctx, light, sleeping);
  drawFlag(_ctx, light);
  ColorCatCharacter.draw(_ctx);
}

function update() {
  ColorCatBall.update(_sw);
  var kicked = ColorCatCharacter.update(_sw, ColorCatBall.state);
  if (kicked) {
    ColorCatBall.kick(ColorCatCharacter.state.facing, _sw);
  }
  render();
}

// ===== 點擊處理 =====

// 太陽/月亮點擊判定
function isSunMoonClicked(cx, cy) {
  var sx = _sw - 20, sy = 18;
  var dx = cx - sx, dy = cy - sy;
  return Math.sqrt(dx * dx + dy * dy) < 18;
}

function handleClick(e) {
  var rect = _canvas.getBoundingClientRect();
  var cx = e.clientX - rect.left;
  var cy = e.clientY - rect.top;

  // 點擊太陽/月亮 → 爬邊牆
  if (isSunMoonClicked(cx, cy)) {
    ColorCatCharacter.startComboWall(_sw);
    return;
  }

  // 點擊旗子 → 爬紙箱
  var boxTopY = BOX_BOTTOM_Y - BOX_H;
  if (isFlagClicked(cx, cy)) {
    ColorCatCharacter.startComboBox(_sw, BOX_X, boxTopY);
    return;
  }

  // 點擊紙箱 → 進去睡覺
  var openingX = BOX_X + BOX_W / 2 + 12;
  if (isBoxClicked(cx, cy)) {
    if (ColorCatCharacter.isSleeping()) {
      ColorCatCharacter.wakeUp(openingX);
    } else {
      ColorCatCharacter.startGoToBox(openingX);
    }
    return;
  }

  // 點擊角色
  if (ColorCatCharacter.isClicked(cx, cy)) {
    ColorCatCharacter.tap(_sw);
    return;
  }

  // 點擊球
  if (ColorCatBall.isClicked(cx, cy)) {
    ColorCatCharacter.startChase();
  }
}

// ===== 初始化（互動版，含球+角色） =====

function initInteractiveScene(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  destroy();
  container.innerHTML = '';

  _dpr = window.devicePixelRatio || 1;
  _canvas = document.createElement('canvas');
  _sw = container.offsetWidth || 300;
  _canvas.width = _sw * _dpr;
  _canvas.height = C.SCENE_H * _dpr;
  _canvas.style.cssText = 'width:100%;height:' + C.SCENE_H + 'px;display:block;cursor:pointer;image-rendering:pixelated;';
  container.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
  _ctx.scale(_dpr, _dpr);

  BOX_BOTTOM_Y = C.CHAR_GROUND_Y - 2; // 紙箱底部對齊角色腳底
  FLAG_POLE_X = BOX_X - BOX_W / 4;    // 旗桿在箱子左側 1/4 處
  FLAG_POLE_TOP = BOX_BOTTOM_Y - BOX_H - FLAG_POLE_H; // 旗桿頂部

  ColorCatCharacter.init(_sw);
  ColorCatBall.init(_sw);

  _canvas.addEventListener('click', handleClick);

  // 視窗縮放
  var rt = null;
  window.addEventListener('resize', function() {
    clearTimeout(rt);
    rt = setTimeout(function() {
      _sw = container.offsetWidth || 300;
      _canvas.width = _sw * _dpr;
      _canvas.height = C.SCENE_H * _dpr;
      _ctx = _canvas.getContext('2d');
      _ctx.scale(_dpr, _dpr);
      ColorCatBall.state.x = Math.min(ColorCatBall.state.x, _sw - ColorCatBall.state.r);
      ColorCatCharacter.state.x = Math.min(ColorCatCharacter.state.x, _sw - 20);
    }, 150);
  });

  // 主題變更
  var _observer = new MutationObserver(function() {});
  _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  container._fcObserver = _observer;

  // 30fps 主迴圈
  _sceneInterval = setInterval(update, 33);
}

// ===== 初始化（靜態版，僅背景，用於正式版尚未開放互動時） =====

function initStaticScene(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  destroy();
  container.innerHTML = '';

  var dpr = window.devicePixelRatio || 1;
  var canvas = document.createElement('canvas');
  var cw = container.offsetWidth || 300;
  canvas.width = cw * dpr;
  canvas.height = C.SCENE_H * dpr;
  canvas.style.cssText = 'width:100%;height:' + C.SCENE_H + 'px;border-radius:var(--radius-sm);image-rendering:pixelated;display:block;';
  container.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  function renderStatic() {
    var light = !C.isThemeDark();
    drawBackground(ctx, cw, light);

    // "Coming soon." 文字
    var textY = (C.GROUND_Y + 6) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = light ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    ctx.font = '800 20px "Noto Sans TC", "SF Pro Display", -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = light ? 'rgba(30,60,40,0.82)' : 'rgba(255,255,255,0.78)';
    ctx.fillText('Coming soon.', cw / 2, textY - 4);
    ctx.shadowColor = 'transparent';
    ctx.font = '500 10px "Noto Sans TC", "SF Pro Display", -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = light ? 'rgba(30,60,40,0.6)' : 'rgba(255,255,255,0.45)';
    ctx.fillText('\u2500\u2500  \u656C\u8ACB\u671F\u5F85  \u2500\u2500', cw / 2, textY + 20);
    ctx.restore();
  }

  renderStatic();

  var _observer = new MutationObserver(function() { renderStatic(); });
  _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  var _resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      cw = container.offsetWidth || 300;
      canvas.width = cw * dpr;
      canvas.height = C.SCENE_H * dpr;
      ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      renderStatic();
    }, 150);
  });

  container._fcObserver = _observer;
}

// ===== 清理 =====

function destroy() {
  if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
  var el = document.getElementById('profile-slot-banner');
  if (el) {
    if (el._fcObserver) { el._fcObserver.disconnect(); el._fcObserver = null; }
    el.innerHTML = '';
  }
}

// ===== App 掛載 =====

if (typeof App !== 'undefined') {
  Object.assign(App, {
    // 正式版目前使用靜態場景，切換為互動版只需改這行
    _initProfileScene: function() { initStaticScene('profile-slot-banner'); },
    _destroyProfileScene: function() { destroy(); },
  });
}

window.ColorCatScene = {
  initInteractive: initInteractiveScene,
  initStatic: initStaticScene,
  destroy: destroy,
  // 向後相容
  init: initStaticScene,
};

})();
