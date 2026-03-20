/* ================================================
   ColorCat — 場景背景繪製（天空、草地、太陽/月亮）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

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

_.drawBackground = drawBackground;

})();
