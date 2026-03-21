/* ================================================
   ColorCat — 場景花朵系統（生長動畫、採集、EXP 特效）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 常數 ──
var MAX_FLOWERS = 48;
var SPROUT_PHASE = 12;   // 冒土階段幀數
var STEM_PHASE   = 28;   // 莖生長結束
var LEAF_PHASE   = 38;   // 葉子展開結束
var BLOOM_PHASE  = 50;   // 開花結束（完全綻放）
var FLOWER_H     = 14;   // 花朵基礎高度
var FADE_FRAMES  = 25;   // 採集後淡出幀數
var WILT_TILT_FRAMES = 18; // 枯萎傾倒幀數

// TODO: 未來與用戶 EXP 系統對接時，改為呼叫 ApiService 或 EXP 模組
var EXP_NORMAL = 5;    // 普通紅花 EXP
var EXP_GOLD   = 10;   // 金色花 EXP

// （長花按鈕已移至外部測試工具列，正式版由後台設定觸發長花時間）

// ── 金花機率：每 5~10 朵之間隨機出現一朵金花，出現後重置計數 ──
var _goldCounter = 0;
var _nextGoldAt  = randGoldAt();
function randGoldAt() { return 5 + Math.floor(Math.random() * 6); }

// ── 枯萎模式（每次點按鈕枯萎一朵，全部枯萎後恢復長花） ──
var WILT_THRESHOLD = 24;
var _wilting = false;

// ── 資料 ──
var flowers = [];
var expEffects = [];   // { x, y, alpha, vy, exp, gold }
var sproutFx = [];     // 冒土粒子 { x, y, vy, alpha, size }

// ── 自動長花計時器 ──
var autoGrowTimer = 0;
var AUTO_GROW_INTERVAL = 450;  // 每 15 秒（450 frames @30fps）

// ── 新增花朵 / 枯萎一朵 ──
function addFlower(sw) {
  if (_wilting) {
    // 枯萎模式：每次點擊枯萎最前面一朵活花
    for (var w = 0; w < flowers.length; w++) {
      if (flowers[w].state === 'growing' || flowers[w].state === 'bloomed') {
        flowers[w].state = 'wilting'; flowers[w].timer = 0;
        flowers[w].wiltDir = Math.random() < 0.5 ? -1 : 1;
        return;
      }
    }
    return; // 全部已在枯萎/消失中，等動畫結束
  }
  // 超過閾值 → 進入枯萎模式（本次點擊就枯萎第一朵）
  if (flowers.length >= WILT_THRESHOLD) {
    _wilting = true;
    addFlower(sw);
    return;
  }
  if (flowers.length >= MAX_FLOWERS) return;
  var minX = 70, maxX = sw - 60;
  if (maxX < minX + 30) maxX = minX + 30;
  var fx = minX + Math.random() * (maxX - minX);
  // 金花判定
  _goldCounter++;
  var isGold = _goldCounter >= _nextGoldAt;
  if (isGold) { _goldCounter = 0; _nextGoldAt = randGoldAt(); }
  // 隨機高度：基礎高度 ±50%（0.5x ~ 1.5x）
  var hScale = 0.5 + Math.random();
  flowers.push({ x: fx, baseY: C.GROUND_Y, state: 'growing', timer: 0, gold: isGold, hScale: hScale });
  // 冒土粒子（3~5 顆小土粒往上彈）
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
  // 枯萎模式：所有花都消失後恢復長花
  if (_wilting && flowers.length === 0) {
    _wilting = false;
  }
  // 花朵
  for (var i = flowers.length - 1; i >= 0; i--) {
    var f = flowers[i];
    if (f.state === 'growing') {
      f.timer++;
      if (f.timer >= BLOOM_PHASE) f.state = 'bloomed';
    } else if (f.state === 'wilting') {
      f.timer++;
      if (f.timer >= WILT_TILT_FRAMES) {
        f.state = 'collected'; f.timer = 0;
      }
    } else if (f.state === 'collected') {
      f.timer++;
      if (f.timer >= FADE_FRAMES) { flowers.splice(i, 1); }
    }
  }
  // EXP 特效
  for (var j = expEffects.length - 1; j >= 0; j--) {
    var e = expEffects[j];
    e.y += e.vy;
    e.alpha -= 0.02;
    if (e.alpha <= 0) expEffects.splice(j, 1);
  }
  // 冒土粒子
  for (var k = sproutFx.length - 1; k >= 0; k--) {
    var p = sproutFx[k];
    p.y += p.vy; p.vy += 0.12; p.alpha -= 0.03;
    if (p.alpha <= 0) sproutFx.splice(k, 1);
  }

  // 蝴蝶
  if (sw) updateButterflies(sw);

  // 自動長花（每 15 秒）
  if (!_wilting && sw) {
    autoGrowTimer++;
    if (autoGrowTimer >= AUTO_GROW_INTERVAL) {
      autoGrowTimer = 0;
      if (flowers.length < MAX_FLOWERS) {
        addFlower(sw);
      }
    }
  }
}

// ── 繪製單朵花 ──
function drawSingleFlower(ctx, f, light) {
  var t = f.timer;
  var collected = f.state === 'collected';
  var isWilting = f.state === 'wilting';
  var fh = FLOWER_H * (f.hScale || 1); // 套用隨機高度
  if (collected) ctx.globalAlpha = Math.max(0, 1 - t / FADE_FRAMES);

  // 枯萎傾倒：繞根部旋轉
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

  // 各階段進度 0~1
  var sproutP = Math.min(1, t / SPROUT_PHASE);
  var stemP   = Math.max(0, Math.min(1, (t - SPROUT_PHASE) / (STEM_PHASE - SPROUT_PHASE)));
  var leafP   = Math.max(0, Math.min(1, (t - STEM_PHASE) / (LEAF_PHASE - STEM_PHASE)));
  var bloomP  = Math.max(0, Math.min(1, (t - LEAF_PHASE) / (BLOOM_PHASE - LEAF_PHASE)));
  if (f.state === 'bloomed' || collected || isWilting) {
    sproutP = 1; stemP = 1; leafP = 1; bloomP = 1;
  }

  // ── 冒土小丘（前期） ──
  if (sproutP > 0 && sproutP < 1) {
    var bumpH = 2 * sproutP;
    ctx.fillStyle = light ? '#8B7355' : '#5A4028';
    ctx.beginPath();
    ctx.ellipse(f.x, baseY, 4, bumpH, 0, Math.PI, 0);
    ctx.fill();
  }

  // ── 莖 ──
  var stemH = fh * stemP * sproutP;
  if (stemH > 0.5) {
    var topY = baseY - stemH;
    ctx.strokeStyle = light ? '#4A8B3F' : '#2D5A28';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(f.x, baseY);
    ctx.lineTo(f.x, topY);
    ctx.stroke();

    // ── 葉子（兩片） ──
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

    // ── 花瓣 + 花芯（金花 vs 紅花） ──
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
        for (var p = 0; p < 5; p++) {
          var a = (p / 5) * Math.PI * 2 - Math.PI / 2;
          var px = cx + Math.cos(a) * pr * 0.7;
          var py = cy + Math.sin(a) * pr * 0.7;
          ctx.beginPath(); ctx.arc(px, py, pr * 0.5, 0, Math.PI * 2); ctx.fill();
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
  // 冒土粒子
  for (var k = 0; k < sproutFx.length; k++) {
    var p = sproutFx[k];
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = light ? '#8B7355' : '#5A4028';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 花朵
  for (var i = 0; i < flowers.length; i++) {
    drawSingleFlower(ctx, flowers[i], light);
  }

  // 蝴蝶
  drawButterflies(ctx);

  // EXP 浮動特效
  for (var j = 0; j < expEffects.length; j++) {
    var e = expEffects[j];
    ctx.save();
    ctx.globalAlpha = Math.max(0, e.alpha);
    ctx.font = 'bold 9px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeText('+' + e.exp + ' EXP', e.x, e.y);
    ctx.fillStyle = e.gold ? '#FF8C00' : '#FFD700';
    ctx.fillText('+' + e.exp + ' EXP', e.x, e.y);
    ctx.restore();
  }
}

// 點擊花朵 → 回傳花朵引用（由角色攻擊後才採集）
function handleFlowerClick(cx, cy) {
  for (var i = flowers.length - 1; i >= 0; i--) {
    var f = flowers[i];
    if (f.state !== 'bloomed') continue;
    var fh = FLOWER_H * (f.hScale || 1);
    var topY = f.baseY - fh;
    var dx = cx - f.x, dy = cy - topY;
    if (Math.sqrt(dx * dx + dy * dy) < 12) {
      return f;  // 回傳引用，由角色攻擊後再呼叫 knockFlower
    }
  }
  return null;
}

// 角色攻擊命中 → 花朵被打倒 + 獲得 EXP
function knockFlower(f, dir) {
  if (!f || f.state !== 'bloomed') return;
  f.state = 'wilting'; f.timer = 0;
  f.wiltDir = dir || 1;
  var fh = FLOWER_H * (f.hScale || 1);
  var topY = f.baseY - fh;
  var exp = f.gold ? EXP_GOLD : EXP_NORMAL;
  expEffects.push({ x: f.x, y: topY - 5, alpha: 1, vy: -0.8, exp: exp, gold: f.gold });
}

// 點擊蝴蝶 → 回傳蝴蝶引用
function handleButterflyClick(cx, cy) {
  for (var i = butterflies.length - 1; i >= 0; i--) {
    var b = butterflies[i];
    if (b.phase === 'falling') continue;
    var dx = cx - b.x, dy = cy - b.y;
    if (Math.sqrt(dx * dx + dy * dy) < 15) {
      return b;
    }
  }
  return null;
}

// 蝴蝶被擊落 → 掉落 + EXP
function knockButterfly(b) {
  if (!b) return;
  b.phase = 'falling'; b.timer = 0;
  b.fallVy = 0;
}

// ── 蝴蝶系統 ──
var MAX_BUTTERFLIES = 3;
var BUTTERFLY_INTERVAL_MIN = 450;   // 15 秒
var BUTTERFLY_INTERVAL_MAX = 900;   // 30 秒
var _butterflyTimer = 0;
var _butterflyNextAt = BUTTERFLY_INTERVAL_MIN + Math.floor(Math.random() * (BUTTERFLY_INTERVAL_MAX - BUTTERFLY_INTERVAL_MIN));
var butterflies = [];
// 蝴蝶顏色組
var BUTTERFLY_COLORS = [
  ['#FF6B9D', '#FF9EC6'],  // 粉
  ['#7CB3FF', '#A8D0FF'],  // 藍
  ['#FFD700', '#FFE66D'],  // 黃
  ['#B388FF', '#D1B3FF'],  // 紫
  ['#FF8A65', '#FFAB91'],  // 橘
];

function spawnButterfly(sw) {
  if (butterflies.length >= MAX_BUTTERFLIES) return;
  var bloomed = getBloomedFlowers();
  // 只選標準大小以上的花（hScale >= 1.0）
  var tall = [];
  for (var bi = 0; bi < bloomed.length; bi++) {
    if ((bloomed[bi].hScale || 1) >= 1.0) tall.push(bloomed[bi]);
  }
  if (tall.length === 0) return;
  var target = tall[Math.floor(Math.random() * tall.length)];
  var fh = FLOWER_H * (target.hScale || 1);
  var fromLeft = Math.random() < 0.5;
  var colors = BUTTERFLY_COLORS[Math.floor(Math.random() * BUTTERFLY_COLORS.length)];
  butterflies.push({
    x: fromLeft ? -10 : sw + 10,
    y: 10 + Math.random() * 30,
    targetX: target.x + (Math.random() - 0.5) * 8,
    targetY: target.baseY - fh - 3,
    flowerRef: target,
    phase: 'fly',      // fly → hover → leave
    timer: 0,
    hoverDur: 120 + Math.floor(Math.random() * 120),  // 4~8 秒停留
    wingPhase: Math.random() * Math.PI * 2,
    color1: colors[0], color2: colors[1],
    size: 2.5 + Math.random() * 1.5,
  });
}

function updateButterflies(sw) {
  // 計時生成
  var bloomed = getBloomedFlowers();
  if (bloomed.length > 0 && butterflies.length < MAX_BUTTERFLIES) {
    _butterflyTimer++;
    if (_butterflyTimer >= _butterflyNextAt) {
      _butterflyTimer = 0;
      _butterflyNextAt = BUTTERFLY_INTERVAL_MIN + Math.floor(Math.random() * (BUTTERFLY_INTERVAL_MAX - BUTTERFLY_INTERVAL_MIN));
      spawnButterfly(sw);
    }
  }
  for (var i = butterflies.length - 1; i >= 0; i--) {
    var b = butterflies[i];
    b.wingPhase += 0.2;
    b.timer++;
    if (b.phase === 'fly') {
      // 飛向花朵（曲線）
      var dx = b.targetX - b.x, dy = b.targetY - b.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 3) {
        var spd = Math.min(1.5, dist * 0.03);
        b.x += (dx / dist) * spd + Math.sin(b.timer * 0.08) * 0.5;
        b.y += (dy / dist) * spd + Math.cos(b.timer * 0.1) * 0.3;
      } else {
        b.phase = 'hover'; b.timer = 0;
      }
      // 花消失 → 飛離
      if (!isFlowerAlive(b.flowerRef)) {
        b.phase = 'leave'; b.timer = 0;
        b.leaveDir = b.x < (sw / 2) ? -1 : 1;
      }
    } else if (b.phase === 'hover') {
      // 停在花朵上微微飄動
      b.x = b.targetX + Math.sin(b.timer * 0.05) * 2;
      b.y = b.targetY + Math.cos(b.timer * 0.07) * 1.5;
      if (b.timer >= b.hoverDur || !isFlowerAlive(b.flowerRef)) {
        b.phase = 'leave'; b.timer = 0;
        b.leaveDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else if (b.phase === 'falling') {
      // 被擊落：旋轉掉落
      b.fallVy += 0.3;
      b.y += b.fallVy;
      b.x += Math.sin(b.timer * 0.3) * 0.5;  // 微微左右搖擺
      b.wingPhase += 0.05;  // 翅膀減速
      if (b.y >= C.GROUND_Y) {
        // 落地 → EXP +1
        expEffects.push({ x: b.x, y: b.y - 5, alpha: 1, vy: -0.8, exp: 1, gold: false });
        butterflies.splice(i, 1);
      }
    } else if (b.phase === 'flee') {
      // 被角色追趕 → 加速逃離
      if (!b.fleeSpeed) b.fleeSpeed = 2.5;
      b.fleeSpeed += 0.03;  // 逐幀加速
      b.x += b.leaveDir * b.fleeSpeed;
      b.y -= 0.8 + Math.sin(b.timer * 0.12) * 0.4;
      if (b.x < -20 || b.x > sw + 20 || b.y < -20) {
        butterflies.splice(i, 1);
      }
    } else {
      // 飛離畫面（自然離場也加速）
      if (!b.leaveSpeed) b.leaveSpeed = 1.5;
      b.leaveSpeed += 0.015;
      b.x += b.leaveDir * b.leaveSpeed;
      b.y -= 0.5 + Math.sin(b.timer * 0.1) * 0.3;
      if (b.x < -15 || b.x > sw + 15 || b.y < -15) {
        butterflies.splice(i, 1);
      }
    }
  }
}

function drawButterfly(ctx, b) {
  var wing = Math.sin(b.wingPhase) * 0.7;
  var s = b.size;
  ctx.save();
  ctx.translate(b.x, b.y);
  // 左翅
  ctx.fillStyle = b.color1;
  ctx.beginPath();
  ctx.ellipse(-s * 0.6, 0, s * (0.6 + wing * 0.3), s * 0.9, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // 右翅
  ctx.fillStyle = b.color2;
  ctx.beginPath();
  ctx.ellipse(s * 0.6, 0, s * (0.6 + wing * 0.3), s * 0.9, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // 身體
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.15, s * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 觸角
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.4); ctx.lineTo(-s * 0.4, -s * 1.1);
  ctx.moveTo(0, -s * 0.4); ctx.lineTo(s * 0.4, -s * 1.1);
  ctx.stroke();
  ctx.restore();
}

function drawButterflies(ctx) {
  for (var i = 0; i < butterflies.length; i++) {
    drawButterfly(ctx, butterflies[i]);
  }
}

// ── 查詢停留中的蝴蝶（供角色 AI 用） ──
function getHoveringButterflies() {
  var arr = [];
  for (var i = 0; i < butterflies.length; i++) {
    if (butterflies[i].phase === 'hover') arr.push(butterflies[i]);
  }
  return arr;
}

function getAllAliveButterflies() {
  var arr = [];
  for (var i = 0; i < butterflies.length; i++) {
    if (butterflies[i].phase !== 'falling') arr.push(butterflies[i]);
  }
  return arr;
}

function startButterflyFlee(b) {
  if (!b || b.phase === 'flee' || b.phase === 'leave') return;
  b.phase = 'flee'; b.timer = 0;
  b.fleeSpeed = 2.5;
  // 逃離方向：遠離畫面中心
  b.leaveDir = b.x < 280 ? -1 : 1;
}

function isButterflyAlive(b) {
  for (var i = 0; i < butterflies.length; i++) {
    if (butterflies[i] === b) return true;
  }
  return false;
}

// ── 查詢盛開花朵（供角色 AI 用） ──
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

// 註冊到共享狀態
_.updateFlowers = updateFlowers;
_.drawFlowers = drawFlowers;
_.handleFlowerClick = handleFlowerClick;
_.addFlower = addFlower;
_.getBloomedFlowers = getBloomedFlowers;
_.isFlowerAlive = isFlowerAlive;
_.getHoveringButterflies = getHoveringButterflies;
_.startButterflyFlee = startButterflyFlee;
_.isButterflyAlive = isButterflyAlive;
_.knockFlower = knockFlower;
_.handleButterflyClick = handleButterflyClick;
_.knockButterfly = knockButterfly;
_.getAllAliveButterflies = getAllAliveButterflies;

})();
