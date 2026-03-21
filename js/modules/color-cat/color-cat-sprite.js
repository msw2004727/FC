/* ================================================
   ColorCat — 精靈圖載入、裁切與繪製
   負責：圖片載入、皮膚切換、SPRITE_DEFS 建立、drawImage 裁切
   依賴：color-cat-config.js (ColorCatConfig)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;

// ── 精靈圖快取 ──
var sprites = {};
var sprites2x = {};     // 2x 高解析度版本（可選）
var spritesLoaded = false;
var _has2x = false;     // 是否成功載入 2x 精靈圖
var currentSkin = 'whiteCat';
var SPRITE_DEFS = {};

// ── SPRITE_DEFS 重建 ──
function rebuildSpriteDefs() {
  var keys = Object.keys(C.ACTION_DEFS);
  var skin = C.SKINS[currentSkin];
  var isBunny = skin && skin.species === 'bunny';
  SPRITE_DEFS = {};
  keys.forEach(function(key) {
    var ad = C.ACTION_DEFS[key];
    var frames = ad.frames;
    var fw = ad.fw;
    // 兔子覆蓋 frames / fw
    if (isBunny && C.BUNNY_ACTION_MAP[key]) {
      var bm = C.BUNNY_ACTION_MAP[key];
      frames = bm.frames;
      if (bm.fw) fw = bm.fw;
      else if (fw && !bm.fw) fw = undefined; // 兔子無 fw 則清除
    }
    var fh = undefined;
    if (isBunny && C.BUNNY_ACTION_MAP[key] && C.BUNNY_ACTION_MAP[key].fh) {
      fh = C.BUNNY_ACTION_MAP[key].fh;
    }
    SPRITE_DEFS[key] = {
      file: C.getSpriteFilePath(currentSkin, ad, key),
      frames: frames,
      speed: ad.speed,
      type: ad.type,
      label: ad.label,
      moveSpeed: ad.moveSpeed,
      jumpVy: ad.jumpVy,
      fw: fw,
      fh: fh,
    };
  });
}

// ── 載入皮膚精靈圖 ──
function loadSkinSprites(skinKey, callback) {
  spritesLoaded = false;
  sprites = {};
  sprites2x = {};
  _has2x = false;
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
    img.src = C.getSpriteFilePath(skinKey, C.ACTION_DEFS[key], key);
  });
}

// ── 載入 2x 高解析度精靈圖（橫放時呼叫，失敗自動降級 1x） ──
function load2xSprites(skinKey) {
  var skin = C.SKINS[skinKey];
  if (!skin) return;
  var keys = Object.keys(C.ACTION_DEFS);
  var loaded2x = 0, success2x = 0;
  keys.forEach(function(key) {
    var path1x = C.getSpriteFilePath(skinKey, C.ACTION_DEFS[key], key);
    // 2x 路徑：img/sprites/2x/{folder}/{filename}
    var path2x = path1x.replace('img/sprites/', 'img/sprites/2x/');
    var img = new Image();
    img.onload = function() {
      sprites2x[key] = img;
      loaded2x++; success2x++;
      if (loaded2x === keys.length) _has2x = success2x > 0;
    };
    img.onerror = function() {
      loaded2x++;
      if (loaded2x === keys.length) _has2x = success2x > 0;
    };
    img.src = path2x;
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

  // 2x 精靈圖優先（scaleFactor > 1.2 且有 2x 圖時使用）
  var use2x = _has2x && (C.scaleFactor || 1) > 1.2 && sprites2x[spriteKey];
  var img = use2x ? sprites2x[spriteKey] : sprites[spriteKey];

  if (!spritesLoaded || !img) {
    // 未載入時顯示佔位方塊
    ctx.fillStyle = '#f06';
    ctx.fillRect(x - 8, footY - 24, 16, 24);
    ctx.restore();
    return;
  }

  // 裁切並繪製當前 frame
  var sDef = SPRITE_DEFS[spriteKey];
  var frameW = (sDef && sDef.fw) ? sDef.fw : C.SPRITE_SIZE;
  var frameH = (sDef && sDef.fh) ? sDef.fh : C.SPRITE_SIZE;
  var srcFW = use2x ? frameW * 2 : frameW;   // 2x 圖來源尺寸加倍
  var srcFH = use2x ? frameH * 2 : frameH;
  var frame = spriteFrame % (sDef ? sDef.frames : 1);
  var drawW = frameW * C.SPRITE_SCALE;
  var drawH = frameH * C.SPRITE_SCALE;
  var drawY = footY - drawH;

  // 翻轉面向
  ctx.translate(x, drawY + drawH / 2);
  if (facing < 0) ctx.scale(-1, 1);
  ctx.translate(-x, -(drawY + drawH / 2));

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    img,
    frame * srcFW, 0,      // 來源裁切位置
    srcFW, srcFH,          // 來源裁切大小（2x 時為雙倍）
    x - drawW / 2, drawY,  // 目標位置（虛擬座標）
    drawW, drawH            // 目標大小（虛擬座標）
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
  load2x: load2xSprites,
  draw: drawSprite,
  drawSilhouette: drawSilhouette,
  getDefs: function() { return SPRITE_DEFS; },
  getSkin: function() { return currentSkin; },
  isLoaded: function() { return spritesLoaded; },
  has2x: function() { return _has2x; },
  getImage: function(key) { return sprites[key] || null; },
};

})();
