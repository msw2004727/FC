/* ================================================
   ColorCat — 面板頁籤 2：裝備欄（六格內嵌效果）
   依賴：color-cat-scene.js (ColorCatScene._),
         color-cat-profile.js (ColorCatProfile)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;
var P; function _p() { if (!P) P = window.ColorCatProfile; return P; }

var PAD = 4;

function drawInsetSlot(ctx, x, y, w, h, light) {
  // 內嵌底色
  ctx.fillStyle = light ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.4)';
  ctx.fillRect(x, y, w, h);

  // 內嵌邊框：左上深、右下淺
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

function drawEquipment(ctx, px, pw, cy, light) {
  if (!_p()) return;
  var dc = light ? '#8B7355' : '#8A7B60';
  var tc = light ? '#4A3520' : '#E8D4A8';
  // 顯示順序：上衣、手套、帽子 / 褲子、鞋子、飾品
  var slots = ['top', 'gloves', 'hat', 'pants', 'shoes', 'accessory'];
  var labels = _p().EQUIP_LABELS;
  var equipped = _p().getEquipped();

  var cols = 3, rows = 2;
  var gapX = 4, gapY = 3;
  var labelH = 10;
  var usableW = pw - PAD * 2;
  var usableH = C.SCENE_H - cy - 4;
  var slotW = Math.floor((usableW - (cols - 1) * gapX) / cols);
  var rowH = Math.floor((usableH - (rows - 1) * gapY) / rows);
  var slotH = rowH - labelH;

  var totalW = cols * slotW + (cols - 1) * gapX;
  var sx = px + Math.floor((pw - totalW) / 2);
  var sy = cy + PAD;

  ctx.font = '8px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';

  for (var i = 0; i < 6; i++) {
    var col = i % cols, row = Math.floor(i / cols);
    var x = sx + col * (slotW + gapX);
    var y = sy + row * (rowH + gapY);

    drawInsetSlot(ctx, x, y, slotW, slotH, light);

    // 已裝備圖示
    var item = equipped[slots[i]];
    if (item) {
      ctx.fillStyle = tc; ctx.font = 'bold 12px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.icon || '?', x + slotW / 2, y + slotH / 2);
      ctx.textBaseline = 'top';
    }

    // 欄位名稱
    ctx.fillStyle = dc; ctx.font = '8px "Noto Sans TC", sans-serif';
    ctx.fillText(labels[slots[i]], x + slotW / 2, y + slotH + 1);
  }
}

_.drawPanelTab2 = drawEquipment;

})();
