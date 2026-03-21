/* ColorCat — 墓地系統（主角死亡留下墓碑、可被打碎、崩解粒子）
   依賴：color-cat-config.js, color-cat-scene.js */
;(function() {
var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;
var GW = 12, GH = 16;
function BASE_Y() { return C.GROUND_Y + 10; }

var _graves = [];
var _particles = [];

function addGrave(x) {
  _graves.push({ x: x, crumbling: false, crumbleTimer: 0 });
}

function getGravePos(idx) {
  var g = _graves[idx];
  return (g && !g.crumbling) ? g.x : -1;
}

function getClickedGrave(cx, cy) {
  for (var i = _graves.length - 1; i >= 0; i--) {
    var g = _graves[i]; if (g.crumbling) continue;
    if (cx >= g.x - GW/2 - 3 && cx <= g.x + GW/2 + 3 &&
        cy >= BASE_Y() - GH && cy <= BASE_Y() + 5) return i;
  }
  return -1;
}

function destroyGrave(idx) {
  var g = _graves[idx];
  if (!g || g.crumbling) return;
  g.crumbling = true; g.crumbleTimer = 0;
  // 崩解粒子（石塊碎片）
  for (var i = 0; i < 22; i++) {
    var life = 22 + Math.floor(Math.random() * 14);
    _particles.push({
      x: g.x + (Math.random()-0.5) * GW,
      y: BASE_Y() - Math.random() * GH,
      vx: (Math.random()-0.5) * 4.5,
      vy: -(1.2 + Math.random() * 2.8),
      life: life, maxLife: life,
      size: 1.5 + Math.random() * 2.5,
      color: Math.random() > 0.4 ? '#999' : '#777',
    });
  }
}

function updateGraves() {
  for (var i = _graves.length - 1; i >= 0; i--) {
    if (_graves[i].crumbling) {
      _graves[i].crumbleTimer++;
      if (_graves[i].crumbleTimer > 30) _graves.splice(i, 1);
    }
  }
  for (var i = _particles.length - 1; i >= 0; i--) {
    var p = _particles[i]; p.x += p.vx; p.y += p.vy;
    p.vy += 0.12; p.life--;
    if (p.life <= 0) _particles.splice(i, 1);
  }
}

function drawGraves(ctx, light) {
  for (var i = 0; i < _graves.length; i++) {
    var g = _graves[i];
    if (g.crumbling) {
      var alpha = Math.max(0, 1 - g.crumbleTimer / 12);
      if (alpha > 0) { ctx.save(); ctx.globalAlpha = alpha; drawStone(ctx, g.x, light); ctx.restore(); }
    } else {
      drawStone(ctx, g.x, light);
    }
  }
  for (var i = 0; i < _particles.length; i++) {
    var p = _particles[i];
    ctx.save();
    ctx.globalAlpha = (p.life / p.maxLife) * 0.85;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    ctx.restore();
  }
}

function drawStone(ctx, x, light) {
  var hw = GW / 2;
  // 土堆
  ctx.fillStyle = light ? '#8B7355' : '#5a4a30';
  ctx.beginPath();
  ctx.ellipse(x, BASE_Y() + 2, hw + 3, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // 石碑主體
  ctx.fillStyle = light ? '#9a9a9a' : '#707070';
  ctx.fillRect(x - hw, BASE_Y() - GH + 5, GW, GH - 5);
  // 圓頂
  ctx.beginPath();
  ctx.arc(x, BASE_Y() - GH + 5, hw, Math.PI, 0);
  ctx.fill();
  // 十字架
  ctx.fillStyle = light ? '#c0c0c0' : '#555';
  ctx.fillRect(x - 1, BASE_Y() - GH + 3, 2, 8);
  ctx.fillRect(x - 3, BASE_Y() - GH + 5, 6, 2);
}

// 註冊到場景共享狀態
_.addGrave = addGrave;
_.drawGraves = drawGraves;
_.updateGraves = updateGraves;
_.getClickedGrave = getClickedGrave;
_.destroyGrave = destroyGrave;
_.getGravePos = getGravePos;

})();
