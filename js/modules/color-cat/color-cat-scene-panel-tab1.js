/* ================================================
   ColorCat — 面板頁籤 1：詳細狀態（狀態、個性、心情卡片）
   依賴：color-cat-scene.js (ColorCatScene._),
         color-cat-profile.js (ColorCatProfile)
   ================================================ */
;(function() {

var _ = window.ColorCatScene._;
var P; function _p() { if (!P) P = window.ColorCatProfile; return P; }

var PAD = 4;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSection(ctx, px, pw, y, title, value, light) {
  var tc = light ? '#4A3520' : '#E8D4A8';
  var border = light ? '#C4A46E' : '#5A4830';
  var usableW = pw - PAD * 2;
  var cardH = 18;

  // 段落標題
  ctx.fillStyle = tc;
  ctx.font = 'bold 8px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('-- ' + title + ' --', px + PAD, y);

  // 卡片
  var cardY = y + 12;
  ctx.fillStyle = light ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.3)';
  roundRect(ctx, px + PAD, cardY, usableW, cardH, 3);
  ctx.fill();
  ctx.strokeStyle = border; ctx.lineWidth = 0.7;
  roundRect(ctx, px + PAD, cardY, usableW, cardH, 3);
  ctx.stroke();

  ctx.fillStyle = tc;
  ctx.font = '8px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(value, px + PAD + usableW / 2, cardY + cardH / 2);

  return cardY + cardH + 6;
}

function drawStatus(ctx, px, pw, cy, light) {
  if (!_p()) return;
  var y = cy + 4;
  y = drawSection(ctx, px, pw, y, '狀態', _p().getStatus(), light);
  y = drawSection(ctx, px, pw, y, '個性', _p().getMBTI(), light);
  drawSection(ctx, px, pw, y, '心情', _p().getMood(), light);
}

_.drawPanelTab1 = drawStatus;

})();
