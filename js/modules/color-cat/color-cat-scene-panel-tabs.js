/* ================================================
   ColorCat — 面板頁籤內容繪製（基本資料、狀態、裝備）
   依賴：color-cat-scene.js (ColorCatScene._),
         color-cat-profile.js (ColorCatProfile)
   ================================================ */
;(function() {

var _ = window.ColorCatScene._;
var P; function _p() { if (!P) P = window.ColorCatProfile; return P; }

var PAD = 4;

// ═══════════════════════════════════
//  頁籤 0：基本資料
// ═══════════════════════════════════

function drawBasicInfo(ctx, px, pw, cy, light) {
  if (!_p()) return;
  var tc = light ? '#4A3520' : '#E8D4A8';
  var dc = light ? '#8B7355' : '#8A7B60';
  var avatarS = 24, ax = px + PAD + 2, ay = cy + 3;

  // 頭像框
  ctx.strokeStyle = light ? '#C4A46E' : '#5A4830';
  ctx.lineWidth = 1;
  ctx.strokeRect(ax, ay, avatarS, avatarS);

  // 迷你貓臉
  var skin = ColorCatCharacter.getSkin();
  var isW = skin === 'whiteCat';
  var fcx = ax + avatarS / 2, fcy = ay + avatarS / 2;
  ctx.fillStyle = isW ? (light ? '#FFF' : '#EEE') : (light ? '#333' : '#222');
  ctx.beginPath(); ctx.arc(fcx, fcy, 8, 0, Math.PI * 2); ctx.fill();
  // 耳
  ctx.beginPath(); ctx.moveTo(fcx - 6, fcy - 5); ctx.lineTo(fcx - 3, fcy - 11); ctx.lineTo(fcx, fcy - 5); ctx.fill();
  ctx.beginPath(); ctx.moveTo(fcx + 6, fcy - 5); ctx.lineTo(fcx + 3, fcy - 11); ctx.lineTo(fcx, fcy - 5); ctx.fill();
  // 眼
  ctx.fillStyle = isW ? '#333' : '#EEE';
  ctx.beginPath(); ctx.arc(fcx - 3, fcy - 1, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(fcx + 3, fcy - 1, 1.2, 0, Math.PI * 2); ctx.fill();
  // 鼻
  ctx.fillStyle = isW ? '#FFB6C1' : '#FF9999';
  ctx.beginPath(); ctx.moveTo(fcx, fcy + 1); ctx.lineTo(fcx - 1.5, fcy + 3); ctx.lineTo(fcx + 1.5, fcy + 3); ctx.fill();

  // 名字 & 等級
  ctx.fillStyle = tc;
  ctx.font = 'bold 9px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(_p().getName(), ax + avatarS + 5, ay + 1);
  ctx.fillStyle = dc; ctx.font = '7px "Noto Sans TC", sans-serif';
  ctx.fillText(_p().getLevelText(), ax + avatarS + 5, ay + 13);

  // 五項數值
  var stats = _p().getStats();
  var keys = ['stamina', 'agility', 'speed', 'luck', 'constitution'];
  var labels = ['體力', '敏捷', '速度', '幸運', '體質'];
  var colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E53935'];
  var sy = ay + avatarS + 5;
  var barW = pw - 44;

  for (var i = 0; i < 5; i++) {
    var ry = sy + i * 14;
    ctx.fillStyle = dc; ctx.font = '7px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(labels[i], px + PAD, ry + 2);
    // 底
    var bx = px + 28;
    ctx.fillStyle = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, ry, barW, 4);
    // 填充
    ctx.fillStyle = colors[i];
    ctx.fillRect(bx, ry, barW * stats[keys[i]] / 100, 4);
    // 數值
    ctx.fillStyle = dc; ctx.font = '6px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(stats[keys[i]], px + pw - PAD, ry + 2);
  }
}

// ═══════════════════════════════════
//  頁籤 1：狀態
// ═══════════════════════════════════

function drawStatus(ctx, px, pw, cy, light) {
  if (!_p()) return;
  var tc = light ? '#4A3520' : '#E8D4A8';
  var dc = light ? '#8B7355' : '#8A7B60';
  var y = cy + 4;

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  ctx.fillStyle = tc; ctx.font = 'bold 8px "Noto Sans TC", sans-serif';
  ctx.fillText('-- 詳細狀態 --', px + PAD, y); y += 13;
  ctx.fillStyle = dc; ctx.font = '7px "Noto Sans TC", sans-serif';
  ctx.fillText('動作：' + _p().getActionLabel(), px + PAD + 4, y); y += 11;
  var S = window.ColorCatStats;
  if (S) {
    var pct = Math.round(S.stamina.current / S.stamina.max * 100);
    ctx.fillText('體力：' + pct + ' / 100', px + PAD + 4, y);
  }
  y += 16;

  ctx.fillStyle = tc; ctx.font = 'bold 8px "Noto Sans TC", sans-serif';
  ctx.fillText('-- 個性 --', px + PAD, y); y += 13;
  ctx.fillStyle = dc; ctx.font = '7px "Noto Sans TC", sans-serif';
  ctx.fillText(_p().getPersonality(), px + PAD + 4, y); y += 16;

  ctx.fillStyle = tc; ctx.font = 'bold 8px "Noto Sans TC", sans-serif';
  ctx.fillText('-- 心情 --', px + PAD, y); y += 13;
  ctx.fillStyle = dc; ctx.font = '7px "Noto Sans TC", sans-serif';
  ctx.fillText(_p().getMood(), px + PAD + 4, y);
}

// ═══════════════════════════════════
//  頁籤 2：裝備
// ═══════════════════════════════════

function drawEquipment(ctx, px, pw, cy, light) {
  if (!_p()) return;
  var dc = light ? '#8B7355' : '#8A7B60';
  var border = light ? '#C4A46E' : '#5A4830';
  var labels = _p().getEquipLabels();
  var slots = _p().getEquipSlots();
  var equipped = _p().getEquipped();
  var cols = 3, slotS = 22, gap = 4, labelH = 10;
  var totalW = cols * slotS + (cols - 1) * gap;
  var sx = px + Math.floor((pw - totalW) / 2);
  var sy = cy + 6;

  ctx.font = '6px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';

  for (var i = 0; i < 6; i++) {
    var col = i % cols, row = Math.floor(i / cols);
    var x = sx + col * (slotS + gap);
    var y = sy + row * (slotS + labelH + gap + 2);

    // 空格虛線框
    ctx.strokeStyle = border; ctx.lineWidth = 0.7;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(x, y, slotS, slotS);
    ctx.setLineDash([]);

    // 底色
    ctx.fillStyle = light ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(x, y, slotS, slotS);

    // 已裝備提示
    var item = equipped[slots[i]];
    if (item) {
      ctx.fillStyle = dc; ctx.font = '7px sans-serif';
      ctx.fillText(item.icon || '?', x + slotS / 2, y + 6);
    }

    // 欄位名稱
    ctx.fillStyle = dc; ctx.font = '6px "Noto Sans TC", sans-serif';
    ctx.fillText(labels[slots[i]], x + slotS / 2, y + slotS + 1);
  }
}

// 註冊
_.drawPanelTab0 = drawBasicInfo;
_.drawPanelTab1 = drawStatus;
_.drawPanelTab2 = drawEquipment;

})();
