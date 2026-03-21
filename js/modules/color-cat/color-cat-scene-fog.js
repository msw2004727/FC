/* ================================================
   ColorCat — 場景濃霧效果（均勻雲幕從左右往中間擴散）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 狀態 ──
var _active = false;
var _leftEdge = 0;      // 左側霧幕前緣 x
var _rightEdge = 0;     // 右側霧幕前緣 x
var _density = 0;       // 整體霧氣濃度 0~1
var _timer = 0;
var _lastSw = 300;
var _wisps = [];

// ── 常數 ──
var MAX_DENSITY = 0.88;
var SPREAD_SPD = 1.2;   // 霧幕擴散速度 px/frame
var TRANS_W = 50;        // 漸層過渡帶寬度
var WISP_N = 8;          // 飄動帶數量

// ── 切換 ──
function toggle() {
  _active = !_active;
  if (_active) {
    // 嚇跑所有敵人
    if (window.ColorCatEnemy && window.ColorCatEnemy.scareAll) {
      window.ColorCatEnemy.scareAll();
    }
    _leftEdge = 0;
    _rightEdge = _lastSw;
    _timer = 0;
    _wisps = [];
    for (var i = 0; i < WISP_N; i++) {
      _wisps.push({
        y: (i + 0.5) * C.SCENE_H / WISP_N + (Math.random() - 0.5) * 10,
        h: 12 + Math.random() * 16,
        xOff: 0,
        spd: (i % 2 === 0 ? 1 : -1) * (0.15 + Math.random() * 0.25),
        wPhase: Math.random() * Math.PI * 2,
        wFreq: 0.018 + Math.random() * 0.012,
        wAmp: 0.25 + Math.random() * 0.35,
        alpha: 0.06 + Math.random() * 0.1
      });
    }
  }
}

function isActive() { return _active; }

// ── 更新 ──
function updateFog(sw) {
  _lastSw = sw;

  if (_active) {
    var center = sw / 2;
    if (_leftEdge < center + TRANS_W) _leftEdge += SPREAD_SPD;
    if (_rightEdge > center - TRANS_W) _rightEdge -= SPREAD_SPD;
    _density = Math.min(MAX_DENSITY, _density + 0.005);
  } else {
    _leftEdge = Math.max(0, _leftEdge - SPREAD_SPD * 2.5);
    _rightEdge = Math.min(sw, _rightEdge + SPREAD_SPD * 2.5);
    _density = Math.max(0, _density - 0.015);
    if (_density <= 0) { _wisps.length = 0; return; }
  }

  _timer++;

  // 更新飄動帶
  for (var i = 0; i < _wisps.length; i++) {
    var w = _wisps[i];
    w.xOff += w.spd;
    w.wPhase += w.wFreq;
    w.y += Math.sin(w.wPhase) * w.wAmp;
    if (w.y < -w.h) w.y = C.SCENE_H;
    if (w.y > C.SCENE_H + w.h) w.y = 0;
  }
}

// ── 繪製單側霧幕（漸層過渡） ──
function drawCurtain(ctx, sw, h, fogRGB, fromLeft) {
  var edge = fromLeft ? _leftEdge : _rightEdge;
  if (fromLeft ? edge <= 0 : edge >= sw) return;

  var solidEnd, gradStart, gradEnd;
  if (fromLeft) {
    solidEnd = Math.max(0, edge - TRANS_W);
    gradStart = solidEnd;
    gradEnd = edge;
  } else {
    solidEnd = Math.min(sw, edge + TRANS_W);
    gradStart = edge;
    gradEnd = solidEnd;
  }

  // 實心區
  var solidColor = 'rgba(' + fogRGB + ',' + _density + ')';
  if (fromLeft && solidEnd > 0) {
    ctx.fillStyle = solidColor;
    ctx.fillRect(0, 0, solidEnd, h);
  } else if (!fromLeft && solidEnd < sw) {
    ctx.fillStyle = solidColor;
    ctx.fillRect(solidEnd, 0, sw - solidEnd, h);
  }

  // 漸層過渡帶
  var gl = ctx.createLinearGradient(gradStart, 0, gradEnd, 0);
  if (fromLeft) {
    gl.addColorStop(0, 'rgba(' + fogRGB + ',' + _density + ')');
    gl.addColorStop(1, 'rgba(' + fogRGB + ',0)');
  } else {
    gl.addColorStop(0, 'rgba(' + fogRGB + ',0)');
    gl.addColorStop(1, 'rgba(' + fogRGB + ',' + _density + ')');
  }
  ctx.fillStyle = gl;
  ctx.fillRect(gradStart, 0, gradEnd - gradStart, h);
}

// ── 繪製霧氣 ──
function drawFog(ctx, sw) {
  if (_density <= 0) return;

  var h = C.SCENE_H;
  var light = !C.isThemeDark();
  var fogRGB = light ? '200,210,220' : '15,20,30';

  // 左右霧幕
  drawCurtain(ctx, sw, h, fogRGB, true);
  drawCurtain(ctx, sw, h, fogRGB, false);

  // 飄動帶（僅在霧幕範圍內繪製，營造雲霧飄動感）
  if (_wisps.length === 0) return;
  ctx.save();
  ctx.beginPath();
  if (_leftEdge < _rightEdge) {
    // 霧幕尚未合攏：只在左右已覆蓋區域內繪製
    ctx.rect(0, 0, _leftEdge + 5, h);
    ctx.rect(_rightEdge - 5, 0, sw - _rightEdge + 5, h);
  } else {
    // 已合攏：全畫面
    ctx.rect(0, 0, sw, h);
  }
  ctx.clip();

  for (var i = 0; i < _wisps.length; i++) {
    var w = _wisps[i];
    var wa = w.alpha * Math.min(1, _density / 0.3);
    if (wa < 0.01) continue;

    var ww = sw * 0.65 + Math.sin(_timer * 0.008 + i * 1.3) * sw * 0.15;
    var wx = w.xOff - ww / 2 + sw / 2;

    var wg = ctx.createLinearGradient(wx, 0, wx + ww, 0);
    wg.addColorStop(0,   'rgba(' + fogRGB + ',0)');
    wg.addColorStop(0.15,'rgba(' + fogRGB + ',' + wa + ')');
    wg.addColorStop(0.5, 'rgba(' + fogRGB + ',' + (wa * 1.3) + ')');
    wg.addColorStop(0.85,'rgba(' + fogRGB + ',' + wa + ')');
    wg.addColorStop(1,   'rgba(' + fogRGB + ',0)');
    ctx.fillStyle = wg;
    ctx.fillRect(wx, w.y - w.h / 2, ww, w.h);
  }
  ctx.restore();
}

// ── 註冊 ──
_.updateFog = updateFog;
_.drawFog = drawFog;
_.toggleFog = toggle;
_.isFogActive = isActive;

})();
