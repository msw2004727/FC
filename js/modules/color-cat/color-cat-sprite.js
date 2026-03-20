/* ================================================
   ColorCat — 精靈圖載入、裁切與繪製
   負責：圖片載入、皮膚切換、SPRITE_DEFS 建立、drawImage 裁切
   依賴：color-cat-config.js (ColorCatConfig)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;

// ── 精靈圖快取 ──
var sprites = {};
var spritesLoaded = false;
var currentSkin = 'whiteCat';
var SPRITE_DEFS = {};

// ── SPRITE_DEFS 重建 ──
function rebuildSpriteDefs() {
  var keys = Object.keys(C.ACTION_DEFS);
  SPRITE_DEFS = {};
  keys.forEach(function(key) {
    var ad = C.ACTION_DEFS[key];
    SPRITE_DEFS[key] = {
      file: C.getSpriteFilePath(currentSkin, ad),
      frames: ad.frames,
      speed: ad.speed,
      type: ad.type,
      label: ad.label,
      moveSpeed: ad.moveSpeed,
      jumpVy: ad.jumpVy,
      fw: ad.fw,
    };
  });
}

// ── 載入皮膚精靈圖 ──
function loadSkinSprites(skinKey, callback) {
  spritesLoaded = false;
  sprites = {};
  var keys = Object.keys(C.ACTION_DEFS);
  var loaded = 0;
  var total = keys.length;
  keys.forEach(function(key) {
    var img = new Image();
    img.onload = function() {
      sprites[key] = img;
      loaded++;
      if (loaded === total) { spritesLoaded = true; if (callback) callback(); }
    };
    img.onerror = function() {
      loaded++;
      if (loaded === total) { spritesLoaded = true; if (callback) callback(); }
    };
    img.src = C.getSpriteFilePath(skinKey, C.ACTION_DEFS[key]);
  });
}

// ── 切換皮膚 ──
function switchSkin(skinKey) {
  if (!C.SKINS[skinKey] || skinKey === currentSkin) return;
  currentSkin = skinKey;
  rebuildSpriteDefs();
  loadSkinSprites(skinKey);
}

// ── 初始載入 ──
function initSprites() {
  rebuildSpriteDefs();
  loadSkinSprites(currentSkin);
}

// ── 繪製角色精靈圖 ──
function drawSprite(ctx, spriteKey, spriteFrame, x, footY, facing, noShadow) {
  ctx.save();

  // 陰影
  if (!noShadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(x, C.GROUND_Y + 14, C.SPRITE_DRAW * 0.25, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  var img = sprites[spriteKey];

  if (!spritesLoaded || !img) {
    // 未載入時顯示佔位方塊
    ctx.fillStyle = '#f06';
    ctx.fillRect(x - 8, footY - 24, 16, 24);
    ctx.restore();
    return;
  }

  var drawY = footY - C.SPRITE_DRAW;

  // 翻轉面向
  ctx.translate(x, drawY + C.SPRITE_DRAW / 2);
  if (facing < 0) ctx.scale(-1, 1);
  ctx.translate(-x, -(drawY + C.SPRITE_DRAW / 2));

  // 裁切並繪製當前 frame
  var sDef = SPRITE_DEFS[spriteKey];
  var frameW = (sDef && sDef.fw) ? sDef.fw : C.SPRITE_SIZE;
  var frame = spriteFrame % (sDef ? sDef.frames : 1);
  var drawW = frameW * C.SPRITE_SCALE;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    img,
    frame * frameW, 0,     // 來源裁切位置
    frameW, C.SPRITE_SIZE, // 來源裁切大小
    x - drawW / 2, drawY,  // 目標位置
    drawW, C.SPRITE_DRAW    // 目標大小
  );

  ctx.restore();
}

// ── 繪製剪影（用於牆面投影） ──
var _silCanvas = null;
var _silCtx = null;

function drawSilhouette(ctx, spriteKey, spriteFrame, x, footY, facing, alpha) {
  var img = sprites[spriteKey];
  if (!spritesLoaded || !img) return;

  var sDef = SPRITE_DEFS[spriteKey];
  var frameW = (sDef && sDef.fw) ? sDef.fw : C.SPRITE_SIZE;
  var frame = spriteFrame % (sDef ? sDef.frames : 1);
  var drawW = frameW * C.SPRITE_SCALE;
  var drawY = footY - C.SPRITE_DRAW;

  // 離屏畫布：繪製精靈圖後轉為純黑剪影
  if (!_silCanvas) {
    _silCanvas = document.createElement('canvas');
    _silCtx = _silCanvas.getContext('2d');
  }
  _silCanvas.width = drawW;
  _silCanvas.height = C.SPRITE_DRAW;
  var oc = _silCtx;

  oc.save();
  oc.imageSmoothingEnabled = false;
  if (facing < 0) { oc.translate(drawW, 0); oc.scale(-1, 1); }
  oc.drawImage(img, frame * frameW, 0, frameW, C.SPRITE_SIZE, 0, 0, drawW, C.SPRITE_DRAW);
  oc.restore();

  // source-in：只保留已繪畫像素，填黑
  oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = '#000';
  oc.fillRect(0, 0, drawW, C.SPRITE_DRAW);

  // 繪製到主畫布（斜切：頂部往左偏 2px）
  var skewPx = -2;
  var skewAngle = skewPx / C.SPRITE_DRAW; // tan(θ) ≈ θ
  ctx.save();
  ctx.globalAlpha = alpha || 0.2;
  ctx.transform(1, 0, skewAngle, 1, x - drawW / 2, drawY);
  ctx.drawImage(_silCanvas, 0, 0);
  ctx.restore();
}

// ── 公開 API ──
window.ColorCatSprite = {
  init: initSprites,
  switchSkin: switchSkin,
  draw: drawSprite,
  drawSilhouette: drawSilhouette,
  getDefs: function() { return SPRITE_DEFS; },
  getSkin: function() { return currentSkin; },
  isLoaded: function() { return spritesLoaded; },
};

})();
