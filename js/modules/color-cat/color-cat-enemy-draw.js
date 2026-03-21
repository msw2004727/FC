/* ColorCat — 敵人繪製模組（精靈圖、陰影、紙箱剪影、HP 條）
   依賴：color-cat-enemy.js, color-cat-config.js, color-cat-scene.js */
;(function() {
var C = window.ColorCatConfig;
var E = window.ColorCatEnemy;
var SZ = E.SZ, SCALE = E.SCALE, FRAME = E.FRAME;
var FOOT_ROW = E.FOOT_ROW, FOOT_OFFSET = E.FOOT_OFFSET;
var VIS_H = E.VIS_H, VIS_W = E.VIS_W;

// ── 紙箱剪影用離屏畫布 ──
var _silCanvas = null, _silCtx = null;

function getBoxBounds() {
  var s = window.ColorCatScene && window.ColorCatScene._;
  if (!s) return null;
  var bx = s.BOX_X - s.BOX_W / 2;
  return { left: bx, right: bx + s.BOX_W, top: s.BOX_BOTTOM_Y - s.BOX_H, w: s.BOX_W, h: s.BOX_H };
}

function isOnBox(e, box) {
  if (!box) return false;
  return (e.x + VIS_W / 2 > box.left && e.x - VIS_W / 2 < box.right);
}

// ── 繪製所有敵人 ──
function drawAll(ctx) {
  var enemies = E.getAll();
  var box = getBoxBounds();
  for (var i = 0; i < enemies.length; i++) drawOne(ctx, enemies[i], box);
  drawDust(ctx);
}

function drawDust(ctx) {
  var dust = E.getDust();
  for (var i = 0; i < dust.length; i++) {
    var d = dust[i], alpha = d.life / d.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = '#c4a882';
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.size, d.size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawOne(ctx, e, box) {
  var imgs = E._cache[e.skin]; if (!imgs) return;
  var actKey = e.action === 'spawning' ? 'death' : (e.action === 'falling' ? 'jump_fall' : e.action);
  var img = imgs[actKey] || imgs.idle; if (!img) return;
  var ad = E.ACTIONS[actKey] || E.ACTIONS.idle;
  var frame = e.sf % ad.frames;
  var es = e.elite ? 1.25 : 1;
  var dw = FRAME * es, dh = FRAME * es;
  var dy = e.y - FOOT_ROW * SCALE * es + FOOT_OFFSET * es;
  var onBox = !e.dead && isOnBox(e, box);

  // 地面陰影（與主角相同風格，紙箱位置時隱藏）
  if (!onBox && e.action !== 'falling' && !e.inKnockback) {
    ctx.save();
    if (e.fadeAlpha < 1) ctx.globalAlpha = e.fadeAlpha * 0.15;
    else ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(e.x, C.GROUND_Y + 14, VIS_W * 0.35 * es, 3 * es, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 精靈圖
  ctx.save();
  if (e.fadeAlpha < 1) ctx.globalAlpha = e.fadeAlpha;
  ctx.translate(e.x, dy + dh / 2);
  if (e.facing < 0) ctx.scale(-1, 1);
  ctx.translate(-e.x, -(dy + dh / 2));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, frame * SZ, 0, SZ, SZ, e.x - dw / 2, dy, dw, dh);
  ctx.restore();

  // HP 條
  if (!e.dead && e.hp < e.maxHp) drawBar(ctx, e.x, e.y - VIS_H * es - 4, e.hp, e.maxHp);

  // 驚嘆號（濃霧驚嚇）
  if (e.scared && e.scaredTimer > 0) {
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#FF3333';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    var ey = e.y - VIS_H * es - 8;
    ctx.strokeText('!', e.x, ey);
    ctx.fillText('!', e.x, ey);
    ctx.restore();
  }
}

function drawBar(ctx, x, y, hp, max) {
  var w = 24, h = 3, bx = x - w / 2, pct = hp / max;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(bx - 0.5, y - 0.5, w + 1, h + 1);
  var r = pct > 0.5 ? Math.floor((1 - pct) * 510) : 255;
  var g = pct > 0.5 ? 200 : Math.floor(pct * 400);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',50)';
  ctx.fillRect(bx, y, w * pct, h);
}

// ── 紙箱牆面剪影（在紙箱繪製之後、敵人精靈圖之前呼叫） ──
function drawBoxShadows(ctx) {
  var box = getBoxBounds(); if (!box) return;
  var enemies = E.getAll();
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i]; if (e.dead) continue;
    if (!isOnBox(e, box)) continue;
    var imgs = E._cache[e.skin]; if (!imgs) continue;
    var bActKey = e.action === 'spawning' ? 'death' : (e.action === 'falling' ? 'jump_fall' : e.action);
    var img = imgs[bActKey] || imgs.idle; if (!img) continue;
    var ad = E.ACTIONS[bActKey] || E.ACTIONS.idle;
    var frame = e.sf % ad.frames;

    // 離屏畫布：繪製精靈圖後轉為純黑剪影
    if (!_silCanvas) { _silCanvas = document.createElement('canvas'); _silCtx = _silCanvas.getContext('2d'); }
    _silCanvas.width = FRAME; _silCanvas.height = FRAME;
    var oc = _silCtx;
    oc.save(); oc.imageSmoothingEnabled = false;
    if (e.facing < 0) { oc.translate(FRAME, 0); oc.scale(-1, 1); }
    oc.drawImage(img, frame * SZ, 0, SZ, SZ, 0, 0, FRAME, FRAME);
    oc.restore();
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = '#000'; oc.fillRect(0, 0, FRAME, FRAME);

    // 繪製到主畫布（斜切 + 裁切至紙箱範圍）
    var dy = e.y - FOOT_ROW * SCALE + FOOT_OFFSET;
    ctx.save();
    ctx.beginPath(); ctx.rect(box.left, box.top, box.w, box.h); ctx.clip();
    ctx.globalAlpha = (e.fadeAlpha < 1 ? e.fadeAlpha : 1) * 0.35;
    var skew = -2 / FRAME;
    ctx.transform(1, 0, skew, 1, e.x - FRAME / 2 - 1, dy);
    ctx.drawImage(_silCanvas, 0, 0);
    ctx.restore();
  }
}

// 覆蓋 stub 函式
E.draw = drawAll;
E.drawBoxShadows = drawBoxShadows;

})();
