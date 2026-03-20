/* ================================================
   ColorCat — 面板頁籤 0：基本資料（內嵌頭像、名字/稱號卡、六項數值）
   依賴：color-cat-scene.js (ColorCatScene._),
         color-cat-profile.js (ColorCatProfile)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;
var P; function _p() { if (!P) P = window.ColorCatProfile; return P; }

var PAD = 4;
var PX = '"Courier New", monospace';  // 像素風格字型

// ── 自適應字體大小（盡量大但不超出欄位） ──
function fitFontSize(ctx, text, maxW, maxH, bold) {
  var prefix = bold ? 'bold ' : '';
  var padX = 4;
  for (var sz = Math.floor(maxH * 0.75); sz >= 6; sz--) {
    ctx.font = prefix + sz + 'px ' + PX;
    if (ctx.measureText(text).width <= maxW - padX * 2) return sz;
  }
  return 6;
}

// ── 內嵌格繪製 ──
function drawInsetSlot(ctx, x, y, w, h, light) {
  ctx.fillStyle = light ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.4)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = light ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + w, y); ctx.lineTo(x, y); ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.strokeStyle = light ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y);
  ctx.stroke();
}

// ── 頭像（使用角色 idle 站立精靈圖） ──
function drawAvatar(ctx, ax, ay, size, light) {
  var img = ColorCatSprite.getImage('idle');
  if (!img) return;
  var defs = ColorCatSprite.getDefs();
  var def = defs['idle'];
  var fw = (def && def.fw) ? def.fw : C.SPRITE_SIZE;
  // 取第 0 幀
  var sx = 0, sy = 0, sw = fw, sh = C.SPRITE_SIZE;
  // 等比縮放置中
  var scale = Math.min(size / sw, size / sh);
  var dw = sw * scale, dh = sh * scale;
  var dx = ax + (size - dw) / 2, dy = ay + (size - dh) / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

function drawBasicInfo(ctx, px, pw, cy, light) {
  if (!_p()) return;
  var tc = light ? '#4A3520' : '#E8D4A8';
  var dc = light ? '#8B7355' : '#8A7B60';
  var h = C.SCENE_H;
  var availH = h - cy - 4;
  var usableW = pw - PAD * 2;

  // ── 上半：頭像 + 名字/稱號（約佔 1/2 高度） ──
  var avatarS = Math.floor(availH * 0.48);
  var topY = cy + 3;
  var gap = 3;

  // 頭像（內嵌方框）
  drawInsetSlot(ctx, px + PAD, topY, avatarS, avatarS, light);
  drawAvatar(ctx, px + PAD, topY, avatarS, light);

  // 名字卡 + 稱號卡（右側，填滿寬度，上下各半高）
  var cardX = px + PAD + avatarS + gap;
  var cardW = usableW - avatarS - gap;
  var cardH = Math.floor((avatarS - gap) / 2);

  // 名字卡（自適應最大字體）
  var nameText = _p().getName();
  drawInsetSlot(ctx, cardX, topY, cardW, cardH, light);
  ctx.fillStyle = tc;
  var nameSz = fitFontSize(ctx, nameText, cardW, cardH, true);
  ctx.font = 'bold ' + nameSz + 'px ' + PX;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(nameText, cardX + cardW / 2, topY + cardH / 2);

  // 稱號卡（自適應最大字體）
  var titleText = _p().getLevelText();
  var titleY = topY + cardH + gap;
  drawInsetSlot(ctx, cardX, titleY, cardW, cardH, light);
  ctx.fillStyle = dc;
  var titleSz = fitFontSize(ctx, titleText, cardW, cardH, false);
  ctx.font = titleSz + 'px ' + PX;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(titleText, cardX + cardW / 2, titleY + cardH / 2);

  // ── 下半：六項數值內嵌格（3×2） ──
  var stats = _p().getStats();
  var keys = _p().STAT_KEYS;
  var labels = _p().STAT_LABELS;
  var startY = topY + avatarS + 4;
  var remainH = h - startY - 3;
  var cols = 3, rows = 2, gapX = 3, gapY = 3;
  var slotW = Math.floor((usableW - (cols - 1) * gapX) / cols);
  var slotH = Math.floor((remainH - (rows - 1) * gapY) / rows);

  for (var i = 0; i < 6; i++) {
    var col = i % cols, row = Math.floor(i / cols);
    var sx = px + PAD + col * (slotW + gapX);
    var sy = startY + row * (slotH + gapY);

    drawInsetSlot(ctx, sx, sy, slotW, slotH, light);

    // 屬性名（上方）
    ctx.fillStyle = dc;
    ctx.font = '8px ' + PX;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(labels[keys[i]], sx + slotW / 2, sy + slotH * 0.3);

    // 數值（下方，大字粗體）
    ctx.fillStyle = tc;
    ctx.font = 'bold 13px ' + PX;
    ctx.fillText(stats[keys[i]], sx + slotW / 2, sy + slotH * 0.7);
  }
}

_.drawPanelTab0 = drawBasicInfo;

})();
