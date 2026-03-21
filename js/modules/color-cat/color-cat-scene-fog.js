/* ================================================
   ColorCat — 場景濃霧效果（雲霧從左右飄入、密度控制、飄動動畫）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 狀態 ──
var _active = false;
var _density = 0;         // 整體霧氣密度 0~1
var _clouds = [];
var _timer = 0;

// ── 常數 ──
var MAX_DENSITY = 0.88;
var FADE_IN = 0.005;
var FADE_OUT = 0.012;
var MAX_CLOUDS = 28;

// ── 切換 ──
function toggle() {
  _active = !_active;
  if (_active) _timer = 0;
}

// ── 生成雲霧粒子 ──
function spawnCloud(sw, side) {
  if (!side) side = Math.random() < 0.5 ? -1 : 1;
  var r = 30 + Math.random() * 60;
  _clouds.push({
    x: side < 0 ? -r * 0.3 : sw + r * 0.3,
    y: Math.random() * C.SCENE_H,
    r: r,
    enterVx: -side * (0.3 + Math.random() * 0.4),
    driftVx: (Math.random() - 0.5) * 0.3,
    phase: Math.random() * Math.PI * 2,
    freqY: 0.015 + Math.random() * 0.025,
    ampY: 0.2 + Math.random() * 0.35,
    alpha: 0.2 + Math.random() * 0.4,
    settled: false,
    pulsePhase: Math.random() * Math.PI * 2,
    pulseSpd: 0.01 + Math.random() * 0.015
  });
}

// ── 更新 ──
function updateFog(sw) {
  if (_active) {
    _density = Math.min(MAX_DENSITY, _density + FADE_IN);
  } else {
    _density = Math.max(0, _density - FADE_OUT);
    if (_density <= 0) { _clouds.length = 0; return; }
  }

  _timer++;

  // 啟動時快速從左右兩側生成雲霧
  if (_active && _timer <= 20 && _timer % 2 === 0) {
    spawnCloud(sw, -1);
    spawnCloud(sw, 1);
  }
  // 持續補充
  if (_active && _clouds.length < MAX_CLOUDS && _timer % 10 === 0) {
    spawnCloud(sw);
  }

  var centerX = sw / 2;
  for (var i = _clouds.length - 1; i >= 0; i--) {
    var c = _clouds[i];
    c.phase += 1;

    if (!c.settled) {
      // 向中心飄入
      c.x += c.enterVx;
      if (Math.abs(c.x - centerX) < sw * 0.25) c.settled = true;
    } else {
      // 已定位：慢速水平飄動（風感）
      c.x += c.driftVx;
      // 飄出邊界 → 回到另一側
      if (c.x > sw + c.r * 1.2) c.x = -c.r;
      else if (c.x < -c.r * 1.2) c.x = sw + c.r;
    }

    // 垂直正弦飄動
    c.y += Math.sin(c.phase * c.freqY) * c.ampY;
    if (c.y < -c.r) c.y = -c.r;
    if (c.y > C.SCENE_H + c.r) c.y = C.SCENE_H + c.r;

    // 透明度脈動
    c.pulsePhase += c.pulseSpd;

    // 關閉時淡出
    if (!_active) {
      c.alpha -= 0.006;
      if (c.alpha <= 0) { _clouds.splice(i, 1); }
    }
  }
}

// ── 繪製霧氣 ──
function drawFog(ctx, sw) {
  if (_density <= 0 && _clouds.length === 0) return;

  var h = C.SCENE_H;
  var light = !C.isThemeDark();

  // 底層全畫面半透明覆蓋
  if (_density > 0.01) {
    var ba = _density * 0.5;
    ctx.fillStyle = light
      ? 'rgba(200,210,220,' + ba + ')'
      : 'rgba(15,20,30,' + ba + ')';
    ctx.fillRect(0, 0, sw, h);
  }

  // 雲霧粒子（放射漸層）
  for (var i = 0; i < _clouds.length; i++) {
    var c = _clouds[i];
    var pulse = 1 + Math.sin(c.pulsePhase) * 0.08;
    var a = c.alpha * Math.min(1, _density / 0.25) * pulse;
    if (a < 0.01) continue;

    var grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
    if (light) {
      grad.addColorStop(0,    'rgba(215,220,230,' + a + ')');
      grad.addColorStop(0.35, 'rgba(210,215,228,' + (a * 0.85) + ')');
      grad.addColorStop(0.65, 'rgba(205,210,222,' + (a * 0.45) + ')');
      grad.addColorStop(1,    'rgba(200,205,218,0)');
    } else {
      grad.addColorStop(0,    'rgba(30,40,55,' + a + ')');
      grad.addColorStop(0.35, 'rgba(25,35,50,' + (a * 0.85) + ')');
      grad.addColorStop(0.65, 'rgba(22,30,45,' + (a * 0.45) + ')');
      grad.addColorStop(1,    'rgba(18,25,40,0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
  }
}

// ── 霧氣按鈕（小雲朵圖示，左上角） ──
var BTN = { x: 8, y: 5, w: 24, h: 16 };

function drawFogButton(ctx, sw, light) {
  ctx.save();
  var b = BTN, cr = 3;

  // 按鈕底色
  ctx.fillStyle = _active
    ? (light ? 'rgba(80,120,170,0.8)' : 'rgba(60,100,150,0.8)')
    : (light ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)');
  ctx.beginPath();
  ctx.moveTo(b.x + cr, b.y);
  ctx.lineTo(b.x + b.w - cr, b.y);
  ctx.quadraticCurveTo(b.x + b.w, b.y, b.x + b.w, b.y + cr);
  ctx.lineTo(b.x + b.w, b.y + b.h - cr);
  ctx.quadraticCurveTo(b.x + b.w, b.y + b.h, b.x + b.w - cr, b.y + b.h);
  ctx.lineTo(b.x + cr, b.y + b.h);
  ctx.quadraticCurveTo(b.x, b.y + b.h, b.x, b.y + b.h - cr);
  ctx.lineTo(b.x, b.y + cr);
  ctx.quadraticCurveTo(b.x, b.y, b.x + cr, b.y);
  ctx.fill();

  // 雲朵圖示
  var cx = b.x + b.w / 2;
  var cy = b.y + b.h / 2 + 0.5;
  ctx.fillStyle = _active ? '#fff' : (light ? 'rgba(60,60,60,0.6)' : 'rgba(255,255,255,0.6)');
  ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - 3.5, cy + 0.8, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 3.5, cy + 0.8, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - 1.5, cy - 2, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 2, cy - 1.5, 2.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - 6, cy + 1, 12, 2.5);

  ctx.restore();
}

function isFogBtnClicked(cx, cy) {
  var b = BTN;
  return cx >= b.x - 3 && cx <= b.x + b.w + 3 &&
         cy >= b.y - 3 && cy <= b.y + b.h + 3;
}

// ── 註冊 ──
_.updateFog = updateFog;
_.drawFog = drawFog;
_.drawFogButton = drawFogButton;
_.isFogBtnClicked = isFogBtnClicked;
_.toggleFog = toggle;

})();
