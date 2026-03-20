/* ================================================
   ColorCat — 場景紙箱繪製（箱體、貓臉塗鴉、蓋子、Zzz）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var _ = window.ColorCatScene._;

function drawZzz(ctx, x, y, light) {
  _.zzzTimer += 0.02;
  ctx.save();

  // 三個 Z 由大到小、由低到高浮動
  for (var i = 0; i < 3; i++) {
    var phase = _.zzzTimer * 1.5 + i * 1.2;
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

function drawBox(ctx, light, sleeping) {
  var bx = _.BOX_X - _.BOX_W / 2;
  var by = _.BOX_BOTTOM_Y - _.BOX_H;
  var openX = bx + _.BOX_W; // 開口在右側
  var midY = by + _.BOX_H / 2;

  ctx.save();

  // ── 箱體 ──
  ctx.fillStyle = light ? '#C8A06E' : '#7A5C3A';
  ctx.fillRect(bx, by, _.BOX_W, _.BOX_H);

  // 箱體邊框
  ctx.strokeStyle = light ? '#8B6914' : '#4A3520';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, _.BOX_W - 1, _.BOX_H - 1);

  // 橫向中線膠帶
  ctx.fillStyle = light ? '#D4B896' : '#8B7355';
  ctx.fillRect(bx, midY - 2, _.BOX_W - 4, 4);

  // 摺痕
  ctx.strokeStyle = light ? 'rgba(139,105,20,0.3)' : 'rgba(74,53,32,0.5)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(bx + 3, by + 5); ctx.lineTo(bx + _.BOX_W - 6, by + 5);
  ctx.moveTo(bx + 3, by + _.BOX_H - 5); ctx.lineTo(bx + _.BOX_W - 6, by + _.BOX_H - 5);
  ctx.stroke();

  // 左側封底
  ctx.fillStyle = light ? '#A8864E' : '#5A4028';
  ctx.fillRect(bx, by, 3, _.BOX_H);

  // ── 箱體上的塗鴉貓臉 ──
  var skin = ColorCatCharacter.getSkin();
  var faceX = bx + _.BOX_W * 0.55;
  var faceY = midY + 1;
  var isWhite = skin === 'whiteCat';
  var inkColor = light ? 'rgba(90,60,30,0.55)' : 'rgba(220,200,170,0.45)';

  // 大圓臉（塗鴉線條）
  ctx.strokeStyle = inkColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(faceX, faceY, 12, 0, Math.PI * 2);
  ctx.stroke();

  // 耳朵（手繪三角）
  ctx.beginPath();
  ctx.moveTo(faceX - 10, faceY - 7);
  ctx.lineTo(faceX - 5, faceY - 16);
  ctx.lineTo(faceX - 1, faceY - 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(faceX + 10, faceY - 7);
  ctx.lineTo(faceX + 5, faceY - 16);
  ctx.lineTo(faceX + 1, faceY - 9);
  ctx.stroke();

  // 眼睛（小黑點）
  ctx.fillStyle = inkColor;
  ctx.beginPath();
  ctx.arc(faceX - 4, faceY - 2, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(faceX + 4, faceY - 2, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // 小白：加眼睛高光；小黑：加瞳孔反光
  if (isWhite) {
    ctx.fillStyle = light ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)';
  } else {
    ctx.fillStyle = light ? 'rgba(180,255,180,0.6)' : 'rgba(140,220,140,0.5)';
  }
  ctx.beginPath(); ctx.arc(faceX - 3.5, faceY - 2.8, 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(faceX + 4.5, faceY - 2.8, 0.6, 0, Math.PI * 2); ctx.fill();

  // 鼻子（小三角）
  ctx.fillStyle = inkColor;
  ctx.beginPath();
  ctx.moveTo(faceX, faceY + 1);
  ctx.lineTo(faceX - 1.5, faceY + 3);
  ctx.lineTo(faceX + 1.5, faceY + 3);
  ctx.fill();

  // 嘴巴（:3 貓嘴）
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(faceX, faceY + 3);
  ctx.quadraticCurveTo(faceX - 4, faceY + 7, faceX - 6, faceY + 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(faceX, faceY + 3);
  ctx.quadraticCurveTo(faceX + 4, faceY + 7, faceX + 6, faceY + 4);
  ctx.stroke();

  // 鬍鬚（隨意歪斜的線）
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(faceX - 12, faceY); ctx.lineTo(faceX - 5, faceY + 1);
  ctx.moveTo(faceX - 11, faceY + 3); ctx.lineTo(faceX - 5, faceY + 3);
  ctx.moveTo(faceX + 12, faceY); ctx.lineTo(faceX + 5, faceY + 1);
  ctx.moveTo(faceX + 11, faceY + 3); ctx.lineTo(faceX + 5, faceY + 3);
  ctx.stroke();

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
    ctx.moveTo(openX, by + _.BOX_H);
    ctx.lineTo(openX + 6, by + _.BOX_H);
    ctx.lineTo(openX + 8, midY + 1);
    ctx.lineTo(openX, midY + 1);
    ctx.closePath(); ctx.fill();

    // 蓋子邊框
    ctx.strokeStyle = light ? '#8B6914' : '#4A3520';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(openX + 6, by); ctx.lineTo(openX + 8, midY - 1);
    ctx.moveTo(openX + 6, by + _.BOX_H); ctx.lineTo(openX + 8, midY + 1);
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
    ctx.moveTo(openX, by + _.BOX_H);
    ctx.lineTo(openX + 8, by + _.BOX_H + 6);
    ctx.lineTo(openX + 8, by + _.BOX_H - 2);
    ctx.lineTo(openX, by + _.BOX_H - 4);
    ctx.closePath(); ctx.fill();

    // 蓋子邊框
    ctx.strokeStyle = light ? '#8B6914' : '#4A3520';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(openX, by); ctx.lineTo(openX + 8, by - 6);
    ctx.lineTo(openX + 8, by + 2);
    ctx.moveTo(openX, by + _.BOX_H); ctx.lineTo(openX + 8, by + _.BOX_H + 6);
    ctx.lineTo(openX + 8, by + _.BOX_H - 2);
    ctx.stroke();
  }

  ctx.restore();
}

function isBoxClicked(cx, cy) {
  var bx = _.BOX_X - _.BOX_W / 2;
  var by = _.BOX_BOTTOM_Y - _.BOX_H - 6; // 包含蓋子高度
  return cx >= bx - 4 && cx <= bx + _.BOX_W + 4 && cy >= by && cy <= _.BOX_BOTTOM_Y + 4;
}

_.drawBox = drawBox;
_.isBoxClicked = isBoxClicked;

})();
