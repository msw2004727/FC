/* ================================================
   ColorCat — 場景旗子繪製 + 紙箱牆面影子
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

function drawFlag(ctx, light) {
  _.flagTimer += 0.03;
  var px = _.FLAG_POLE_X;
  var pTop = _.FLAG_POLE_TOP;
  var pBot = pTop + _.FLAG_POLE_H;

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
  var wave1 = Math.sin(_.flagTimer * 2) * 2;
  var wave2 = Math.sin(_.flagTimer * 2 + 1.5) * 3;
  var fx = px + 1;
  var fy = pTop + 2;

  ctx.fillStyle = light ? '#E8524A' : '#C43830';
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(fx + _.FLAG_W * 0.5, fy + wave1, fx + _.FLAG_W, fy + _.FLAG_H / 2 + wave2);
  ctx.quadraticCurveTo(fx + _.FLAG_W * 0.5, fy + _.FLAG_H + wave1 * 0.5, fx, fy + _.FLAG_H);
  ctx.closePath();
  ctx.fill();

  // 旗子邊框
  ctx.strokeStyle = light ? '#B8322A' : '#8A2018';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.quadraticCurveTo(fx + _.FLAG_W * 0.5, fy + wave1, fx + _.FLAG_W, fy + _.FLAG_H / 2 + wave2);
  ctx.quadraticCurveTo(fx + _.FLAG_W * 0.5, fy + _.FLAG_H + wave1 * 0.5, fx, fy + _.FLAG_H);
  ctx.stroke();

  // 貓臉（依當前角色皮膚切換）
  var skin = ColorCatCharacter.getSkin();
  var isWhite = skin === 'whiteCat';
  var faceX = fx + _.FLAG_W * 0.35 + wave1 * 0.3;
  var faceY = fy + _.FLAG_H / 2 + wave2 * 0.2;
  var catFace = isWhite ? (light ? '#FFF' : '#EEE') : (light ? '#333' : '#222');
  var catEye = isWhite ? '#333' : (light ? '#EEE' : '#CCC');

  // 貓耳朵
  ctx.fillStyle = catFace;
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
  ctx.fillStyle = catFace;
  ctx.beginPath();
  ctx.arc(faceX, faceY, 3, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = catEye;
  ctx.fillRect(faceX - 1.5, faceY - 1, 1, 1);
  ctx.fillRect(faceX + 0.5, faceY - 1, 1, 1);

  // 嘴巴
  ctx.fillStyle = catEye;
  ctx.fillRect(faceX - 0.5, faceY + 0.5, 1, 0.5);

  ctx.restore();
}

function isFlagClicked(cx, cy) {
  var fx = _.FLAG_POLE_X;
  var fy = _.FLAG_POLE_TOP;
  return cx >= fx - 4 && cx <= fx + _.FLAG_W + 4 &&
         cy >= fy - 4 && cy <= fy + _.FLAG_POLE_H + 4;
}

// ── 紙箱牆面影子 ──
function drawWallShadow(ctx) {
  var ch = ColorCatCharacter.state;
  if (ch.action === 'sleeping') return;

  var bx = _.BOX_X - _.BOX_W / 2;
  var by = _.BOX_BOTTOM_Y - _.BOX_H;
  var boxRight = bx + _.BOX_W;
  var halfSprite = C.SPRITE_DRAW / 2;

  var charLeft = ch.x - halfSprite;
  var charRight = ch.x + halfSprite;
  if (charRight < bx || charLeft > boxRight) {
    ColorCatCharacter.setSuppressGroundShadow(false);
    return;
  }

  ColorCatCharacter.setSuppressGroundShadow(true);

  var key = ColorCatCharacter.getSpriteKey();
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, _.BOX_W, _.BOX_H);
  ctx.clip();
  ColorCatSprite.drawSilhouette(ctx, key, ch.spriteFrame, ch.x - 1, ch.y, ch.facing, 0.35);
  ctx.restore();
}

_.drawFlag = drawFlag;
_.isFlagClicked = isFlagClicked;
_.drawWallShadow = drawWallShadow;

})();
