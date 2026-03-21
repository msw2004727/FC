/* ================================================
   ColorCat — 場景蝴蝶系統（生成、飛行、停留、逃離、擊落）
   依賴：color-cat-scene-flower.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;
var FLOWER_H = 14;

var MAX_BUTTERFLIES = 3;
var BUTTERFLY_INTERVAL_MIN = 450, BUTTERFLY_INTERVAL_MAX = 900;
var _butterflyTimer = 0;
var _butterflyNextAt = BUTTERFLY_INTERVAL_MIN + Math.floor(Math.random() * (BUTTERFLY_INTERVAL_MAX - BUTTERFLY_INTERVAL_MIN));
var butterflies = [];
var BUTTERFLY_COLORS = [
  ['#FF6B9D', '#FF9EC6'],
  ['#7CB3FF', '#A8D0FF'],
  ['#FFD700', '#FFE66D'],
  ['#B388FF', '#D1B3FF'],
  ['#FF8A65', '#FFAB91'],
];

function spawnButterfly(sw) {
  if (butterflies.length >= MAX_BUTTERFLIES) return;
  var bloomed = _.getBloomedFlowers();
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
    x: fromLeft ? -10 : sw + 10, y: 10 + Math.random() * 30,
    targetX: target.x + (Math.random() - 0.5) * 8,
    targetY: target.baseY - fh - 3,
    flowerRef: target, phase: 'fly', timer: 0,
    hoverDur: 120 + Math.floor(Math.random() * 120),
    wingPhase: Math.random() * Math.PI * 2,
    color1: colors[0], color2: colors[1],
    size: 2.5 + Math.random() * 1.5,
  });
}

function updateButterflies(sw) {
  var bloomed = _.getBloomedFlowers();
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
    b.wingPhase += 0.2; b.timer++;
    if (b.phase === 'fly') {
      var dx = b.targetX - b.x, dy = b.targetY - b.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 3) {
        var spd = Math.min(1.5, dist * 0.03);
        b.x += (dx / dist) * spd + Math.sin(b.timer * 0.08) * 0.5;
        b.y += (dy / dist) * spd + Math.cos(b.timer * 0.1) * 0.3;
      } else { b.phase = 'hover'; b.timer = 0; }
      if (!_.isFlowerAlive(b.flowerRef)) {
        b.phase = 'leave'; b.timer = 0;
        b.leaveDir = b.x < (sw / 2) ? -1 : 1;
      }
    } else if (b.phase === 'hover') {
      b.x = b.targetX + Math.sin(b.timer * 0.05) * 2;
      b.y = b.targetY + Math.cos(b.timer * 0.07) * 1.5;
      if (b.timer >= b.hoverDur || !_.isFlowerAlive(b.flowerRef)) {
        b.phase = 'leave'; b.timer = 0;
        b.leaveDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else if (b.phase === 'falling') {
      b.fallVy += 0.3; b.y += b.fallVy;
      b.x += Math.sin(b.timer * 0.3) * 0.5; b.wingPhase += 0.05;
      if (b.y >= C.GROUND_Y) {
        if (_._expEffects) _._expEffects.push({ x: b.x, y: b.y - 5, alpha: 1, vy: -0.8, exp: 1, gold: false });
        butterflies.splice(i, 1);
      }
    } else if (b.phase === 'flee') {
      if (!b.fleeSpeed) b.fleeSpeed = 2.5;
      b.fleeSpeed += 0.03;
      b.x += b.leaveDir * b.fleeSpeed;
      b.y -= 0.8 + Math.sin(b.timer * 0.12) * 0.4;
      if (b.x < -20 || b.x > sw + 20 || b.y < -20) butterflies.splice(i, 1);
    } else {
      if (!b.leaveSpeed) b.leaveSpeed = 1.5;
      b.leaveSpeed += 0.015;
      b.x += b.leaveDir * b.leaveSpeed;
      b.y -= 0.5 + Math.sin(b.timer * 0.1) * 0.3;
      if (b.x < -15 || b.x > sw + 15 || b.y < -15) butterflies.splice(i, 1);
    }
  }
}

function drawButterfly(ctx, b) {
  var wing = Math.sin(b.wingPhase) * 0.7, s = b.size;
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.fillStyle = b.color1;
  ctx.beginPath(); ctx.ellipse(-s * 0.6, 0, s * (0.6 + wing * 0.3), s * 0.9, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = b.color2;
  ctx.beginPath(); ctx.ellipse(s * 0.6, 0, s * (0.6 + wing * 0.3), s * 0.9, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.15, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.4); ctx.lineTo(-s * 0.4, -s * 1.1);
  ctx.moveTo(0, -s * 0.4); ctx.lineTo(s * 0.4, -s * 1.1);
  ctx.stroke(); ctx.restore();
}

function drawButterflies(ctx) {
  for (var i = 0; i < butterflies.length; i++) drawButterfly(ctx, butterflies[i]);
}

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
  b.phase = 'flee'; b.timer = 0; b.fleeSpeed = 2.5;
  b.leaveDir = b.x < 280 ? -1 : 1;
}

function isButterflyAlive(b) {
  for (var i = 0; i < butterflies.length; i++) {
    if (butterflies[i] === b) return true;
  }
  return false;
}

function handleButterflyClick(cx, cy) {
  for (var i = butterflies.length - 1; i >= 0; i--) {
    var b = butterflies[i];
    if (b.phase === 'falling') continue;
    var dx = cx - b.x, dy = cy - b.y;
    if (Math.sqrt(dx * dx + dy * dy) < 15) return b;
  }
  return null;
}

function knockButterfly(b) {
  if (!b) return;
  b.phase = 'falling'; b.timer = 0; b.fallVy = 0;
}

_.updateButterflies = updateButterflies;
_.drawButterflies = drawButterflies;
_.getHoveringButterflies = getHoveringButterflies;
_.startButterflyFlee = startButterflyFlee;
_.isButterflyAlive = isButterflyAlive;
_.handleButterflyClick = handleButterflyClick;
_.knockButterfly = knockButterfly;
_.getAllAliveButterflies = getAllAliveButterflies;

})();
