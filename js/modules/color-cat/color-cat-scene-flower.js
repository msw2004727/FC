/* ================================================
   ColorCat — 場景花朵系統（生長動畫、採集、EXP 特效）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 常數 ──
var MAX_FLOWERS = 48;
var SPROUT_PHASE = 12;
var STEM_PHASE   = 28;
var LEAF_PHASE   = 38;
var BLOOM_PHASE  = 50;
var FLOWER_H     = 14;
var FADE_FRAMES  = 25;
var WILT_TILT_FRAMES = 18;

// TODO: 未來與用戶 EXP 系統對接時，改為呼叫 ApiService 或 EXP 模組
var EXP_NORMAL = 5;
var EXP_GOLD   = 10;

// ── 金花機率：每 5~10 朵之間隨機出現一朵金花 ──
var _goldCounter = 0;
var _nextGoldAt  = randGoldAt();
function randGoldAt() { return 5 + Math.floor(Math.random() * 6); }

// ── 枯萎模式 ──
var WILT_THRESHOLD = 24;
var _wilting = false;

// ── 資料 ──
var flowers = [];
var expEffects = [];
var sproutFx = [];

// ── 自動長花計時器 ──
var autoGrowTimer = 0;
var AUTO_GROW_INTERVAL = 450;

// ── 新增花朵 / 枯萎一朵 ──
function addFlower(sw) {
  if (_wilting) {
    for (var w = 0; w < flowers.length; w++) {
      if (flowers[w].state === 'growing' || flowers[w].state === 'bloomed') {
        flowers[w].state = 'wilting'; flowers[w].timer = 0;
        flowers[w].wiltDir = Math.random() < 0.5 ? -1 : 1;
        return;
      }
    }
    return;
  }
  if (flowers.length >= WILT_THRESHOLD) {
    _wilting = true;
    addFlower(sw);
    return;
  }
  if (flowers.length >= MAX_FLOWERS) return;
  var minX = 70, maxX = sw - 60;
  if (maxX < minX + 30) maxX = minX + 30;
  var fx = minX + Math.random() * (maxX - minX);
  _goldCounter++;
  var isGold = _goldCounter >= _nextGoldAt;
  if (isGold) { _goldCounter = 0; _nextGoldAt = randGoldAt(); }
  var hScale = 0.5 + Math.random();
  flowers.push({ x: fx, baseY: C.GROUND_Y, state: 'growing', timer: 0, gold: isGold, hScale: hScale });
  var count = 3 + Math.floor(Math.random() * 3);
  for (var i = 0; i < count; i++) {
    sproutFx.push({
      x: fx + (Math.random() - 0.5) * 8,
      y: C.GROUND_Y,
      vy: -(1 + Math.random() * 1.5),
      alpha: 0.8,
      size: 1 + Math.random(),
    });
  }
}

// ── 每幀更新 ──
function updateFlowers(sw) {
  if (_wilting && flowers.length === 0) _wilting = false;
  for (var i = flowers.length - 1; i >= 0; i--) {
    var f = flowers[i];
    if (f.state === 'growing') {
      f.timer++;
      if (f.timer >= BLOOM_PHASE) f.state = 'bloomed';
    } else if (f.state === 'wilting') {
      f.timer++;
      if (f.timer >= WILT_TILT_FRAMES) { f.state = 'collected'; f.timer = 0; }
    } else if (f.state === 'collected') {
      f.timer++;
      if (f.timer >= FADE_FRAMES) { flowers.splice(i, 1); }
    }
  }
  for (var j = expEffects.length - 1; j >= 0; j--) {
    var e = expEffects[j];
    e.y += e.vy; e.alpha -= 0.02;
    if (e.alpha <= 0) expEffects.splice(j, 1);
  }
  for (var k = sproutFx.length - 1; k >= 0; k--) {
    var p = sproutFx[k];
    p.y += p.vy; p.vy += 0.12; p.alpha -= 0.03;
    if (p.alpha <= 0) sproutFx.splice(k, 1);
  }
  // 蝴蝶（由 scene-butterfly.js 註冊）
  if (sw && _.updateButterflies) _.updateButterflies(sw);
  // 自動長花
  if (!_wilting && sw) {
    autoGrowTimer++;
    if (autoGrowTimer >= AUTO_GROW_INTERVAL) {
      autoGrowTimer = 0;
      if (flowers.length < MAX_FLOWERS) addFlower(sw);
    }
  }
}

// ── 繪製單朵花 ──
function drawSingleFlower(ctx, f, light) {
  var t = f.timer;
  var collected = f.state === 'collected';
  var isWilting = f.state === 'wilting';
  var fh = FLOWER_H * (f.hScale || 1);
  if (collected) ctx.globalAlpha = Math.max(0, 1 - t / FADE_FRAMES);
  var hasTilt = f.wiltDir !== undefined;
  if (hasTilt && (isWilting || collected)) {
    var tiltP = isWilting ? Math.min(1, t / WILT_TILT_FRAMES) : 1;
    var tiltAngle = f.wiltDir * tiltP * (Math.PI / 2.2);
    ctx.save();
    ctx.translate(f.x, f.baseY);
    ctx.rotate(tiltAngle);
    ctx.translate(-f.x, -f.baseY);
  }
  var baseY = f.baseY;
  var sproutP = Math.min(1, t / SPROUT_PHASE);
  var stemP   = Math.max(0, Math.min(1, (t - SPROUT_PHASE) / (STEM_PHASE - SPROUT_PHASE)));
  var leafP   = Math.max(0, Math.min(1, (t - STEM_PHASE) / (LEAF_PHASE - STEM_PHASE)));
  var bloomP  = Math.max(0, Math.min(1, (t - LEAF_PHASE) / (BLOOM_PHASE - LEAF_PHASE)));
  if (f.state === 'bloomed' || collected || isWilting) {
    sproutP = 1; stemP = 1; leafP = 1; bloomP = 1;
  }
  if (sproutP > 0 && sproutP < 1) {
    var bumpH = 2 * sproutP;
    ctx.fillStyle = light ? '#8B7355' : '#5A4028';
    ctx.beginPath();
    ctx.ellipse(f.x, baseY, 4, bumpH, 0, Math.PI, 0);
    ctx.fill();
  }
  var stemH = fh * stemP * sproutP;
  if (stemH > 0.5) {
    var topY = baseY - stemH;
    ctx.strokeStyle = light ? '#4A8B3F' : '#2D5A28';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(f.x, baseY);
    ctx.lineTo(f.x, topY);
    ctx.stroke();
    if (leafP > 0) {
      var ls = 4 * leafP * (f.hScale || 1);
      var ly = baseY - stemH * 0.45;
      ctx.fillStyle = light ? '#5DA849' : '#3D7A30';
      ctx.save(); ctx.translate(f.x - 1, ly); ctx.rotate(-0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, ls * 0.4, ls, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.translate(f.x + 1, ly); ctx.rotate(0.5);
      ctx.beginPath(); ctx.ellipse(0, 0, ls * 0.4, ls, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (bloomP > 0) {
      var pr = 3 * bloomP * (f.hScale || 1);
      var cx = f.x, cy = topY;
      if (f.gold) {
        ctx.fillStyle = light ? '#FFD700' : '#CCA000';
        for (var p = 0; p < 5; p++) {
          var a = (p / 5) * Math.PI * 2 - Math.PI / 2;
          var px = cx + Math.cos(a) * pr * 0.7;
          var py = cy + Math.sin(a) * pr * 0.7;
          ctx.beginPath(); ctx.arc(px, py, pr * 0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = light ? '#FF8C00' : '#B8620A';
        ctx.beginPath(); ctx.arc(cx, cy, pr * 0.3, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = light ? '#E8524A' : '#C43830';
        for (var p2 = 0; p2 < 5; p2++) {
          var a2 = (p2 / 5) * Math.PI * 2 - Math.PI / 2;
          var px2 = cx + Math.cos(a2) * pr * 0.7;
          var py2 = cy + Math.sin(a2) * pr * 0.7;
          ctx.beginPath(); ctx.arc(px2, py2, pr * 0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = light ? '#FFD700' : '#CCA000';
        ctx.beginPath(); ctx.arc(cx, cy, pr * 0.3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  if (hasTilt && (isWilting || collected)) ctx.restore();
  if (collected) ctx.globalAlpha = 1;
}

// ── 繪製所有花朵 + 特效 ──
function drawFlowers(ctx, light) {
  for (var k = 0; k < sproutFx.length; k++) {
    var p = sproutFx[k];
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = light ? '#8B7355' : '#5A4028';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (var i = 0; i < flowers.length; i++) drawSingleFlower(ctx, flowers[i], light);
  // 蝴蝶（由 scene-butterfly.js 註冊）
  if (_.drawButterflies) _.drawButterflies(ctx);
  // EXP 浮動特效
  for (var j = 0; j < expEffects.length; j++) {
    var e = expEffects[j];
    ctx.save();
    ctx.globalAlpha = Math.max(0, e.alpha);
    ctx.font = 'bold 9px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeText('+' + e.exp, e.x, e.y);
    ctx.fillStyle = e.gold ? '#FF8C00' : '#FFD700';
    ctx.fillText('+' + e.exp, e.x, e.y);
    ctx.restore();
  }
}

function handleFlowerClick(cx, cy) {
  for (var i = flowers.length - 1; i >= 0; i--) {
    var f = flowers[i];
    if (f.state !== 'bloomed') continue;
    var fh = FLOWER_H * (f.hScale || 1);
    var topY = f.baseY - fh;
    var dx = cx - f.x, dy = cy - topY;
    if (Math.sqrt(dx * dx + dy * dy) < 12) return f;
  }
  return null;
}

function knockFlower(f, dir, noExp) {
  if (!f || f.state !== 'bloomed') return;
  f.state = 'wilting'; f.timer = 0;
  f.wiltDir = dir || 1;
  if (!noExp) {
    var fh = FLOWER_H * (f.hScale || 1);
    var topY = f.baseY - fh;
    expEffects.push({ x: f.x, y: topY - 5, alpha: 1, vy: -0.8, exp: 1, gold: f.gold });
    // 累計摘花
    if (window.ColorCatStats) {
      if (f.gold) ColorCatStats.runtime.flowersGold++;
      else ColorCatStats.runtime.flowersRed++;
      ColorCatStats.saveLocal();
    }
    if (window.ColorCatCloudSave) ColorCatCloudSave.markDirty();
  }
}

function getBloomedFlowers() {
  var arr = [];
  for (var i = 0; i < flowers.length; i++) {
    if (flowers[i].state === 'bloomed') arr.push(flowers[i]);
  }
  return arr;
}

function isFlowerAlive(f) {
  return f && (f.state === 'growing' || f.state === 'bloomed');
}

// ── 匯出/匯入（存檔用） ──
function exportFlowers() {
  var arr = [];
  for (var i = 0; i < flowers.length; i++) {
    var f = flowers[i];
    if (f.state === 'growing' || f.state === 'bloomed') {
      arr.push({ x: f.x, baseY: f.baseY, state: f.state, timer: f.timer, gold: f.gold, hScale: f.hScale });
    }
  }
  return arr;
}

function importFlowers(data) {
  flowers.length = 0;
  _wilting = false;
  if (!data || !data.length) return;
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    flowers.push({ x: d.x, baseY: d.baseY || C.GROUND_Y, state: d.state || 'bloomed', timer: d.timer || 50, gold: !!d.gold, hScale: d.hScale || 1 });
  }
  if (flowers.length >= WILT_THRESHOLD) _wilting = true;
}

_._expEffects = expEffects;
_.exportFlowers = exportFlowers;
_.importFlowers = importFlowers;
_.updateFlowers = updateFlowers;
_.drawFlowers = drawFlowers;
_.handleFlowerClick = handleFlowerClick;
_.addFlower = addFlower;
_.getBloomedFlowers = getBloomedFlowers;
_.isFlowerAlive = isFlowerAlive;
_.knockFlower = knockFlower;

})();
