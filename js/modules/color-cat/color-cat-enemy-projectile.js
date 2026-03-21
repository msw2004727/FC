/* ColorCat — 敵人投射物系統（箭矢、魔法彈、命中判定、粒子特效）
   依賴：color-cat-enemy.js, color-cat-config.js, color-cat-character.js */
;(function() {
var C = window.ColorCatConfig;
var E = window.ColorCatEnemy;

var _projs = [];   // 活躍投射物
var _hits = [];    // 命中/未命中粒子特效

// ── 投射物設定 ──
var PROJ = {
  arrow: { speed: 7, w: 18, h: 3, color: '#6B4226', headColor: '#B0B0B0', tailColor: '#8B6914' },
  magic: { speed: 4.5, r: 5, color: '#9B59B6', glowColor: 'rgba(155,89,182,0.3)', trailColor: '#C39BD3' },
};

// ── 發射投射物 ──
function spawnProjectile(e, dmg) {
  var p = E.PROFILES[e.skin]; if (!p) return;
  var cfg = PROJ[p.projType]; if (!cfg) return;
  var ch = ColorCatCharacter.state;
  var dir = ch.x > e.x ? 1 : -1;
  var spawnDist = Math.abs(ch.x - e.x);
  _projs.push({
    type: p.projType,
    x: e.x + dir * 10,
    y: e.y - E.VIS_H * 0.5,
    vx: dir * cfg.speed,
    dir: dir,
    dmg: dmg,
    spawnDist: spawnDist,
    targetX: ch.x,
    alive: true,
    timer: 0,
  });
}

// ── 更新投射物 ──
function updateProjectiles(sw) {
  var ch = ColorCatCharacter.state;
  var charDying = ch.action === 'dying' || ch.action === 'weak' || ch.action === 'sleeping';
  var halfW = C.SPRITE_DRAW / 2;

  for (var i = _projs.length - 1; i >= 0; i--) {
    var p = _projs[i];
    var prevX = p.x;
    p.x += p.vx;
    p.timer++;

    // 魔法彈拖尾粒子（僅 magic 類型）
    if (p.type === 'magic') {
      if (!p.trail) p.trail = [];
      if (p.timer % 4 === 0) {
        p.trail.push({
          x: p.x, y: p.y + (Math.random() - 0.5) * 4,
          life: 10, maxLife: 10, size: 2 + Math.random() * 1.5,
        });
      }
      for (var t = p.trail.length - 1; t >= 0; t--) {
        p.trail[t].life--;
        if (p.trail[t].life <= 0) p.trail.splice(t, 1);
      }
    }

    // 命中判定：投射物穿越角色 x 座標時
    var crossed = (p.dir > 0 && prevX < ch.x && p.x >= ch.x) ||
                  (p.dir < 0 && prevX > ch.x && p.x <= ch.x);
    if (crossed && !charDying) {
      // 距離命中率：近距離 90%、遠距離 5%
      var hitChance = Math.max(0.05, 0.90 - p.spawnDist / 500 * 0.85);
      if (Math.random() < hitChance) {
        // 命中
        ColorCatCharacter.takeDamage(p.dmg);
        spawnHitParticles(ch.x, p.y, p.type, true);
        _projs.splice(i, 1);
        continue;
      } else {
        // 未命中：箭矢無粒子直接穿越，魔法彈產生閃避粒子
        if (p.type === 'magic') spawnHitParticles(ch.x, p.y, p.type, false);
      }
    }

    // 離開畫面則移除
    if (p.x < -30 || p.x > sw + 30) {
      _projs.splice(i, 1);
    }
  }

  // 更新粒子
  for (var j = _hits.length - 1; j >= 0; j--) {
    var h = _hits[j];
    h.x += h.vx; h.y += h.vy;
    h.vy += 0.06; h.life--;
    if (h.life <= 0) _hits.splice(j, 1);
  }
}

// ── 命中/閃避粒子特效 ──
function spawnHitParticles(x, y, type, isHit) {
  if (type === 'arrow') {
    if (!isHit) return;
    // 箭矢命中：大量橘紅色爆裂粒子 + 木屑碎片
    for (var i = 0; i < 16; i++) {
      var angle = Math.random() * Math.PI * 2;
      var sp = 2 + Math.random() * 4;
      var life = 10 + Math.floor(Math.random() * 8);
      var colors = ['#FF4500', '#FF6633', '#CD853F', '#8B4513', '#FFD700'];
      _hits.push({
        x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp - 1.5,
        life: life, maxLife: life,
        size: 2 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        type: 'hit',
      });
    }
  } else {
    // 魔法命中/閃避：紫色粒子
    var count = isHit ? 12 : 5;
    var hitColor = isHit ? '#FF4444' : '#AAAAAA';
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var sp = isHit ? (1.5 + Math.random() * 3) : (0.5 + Math.random() * 1.5);
      var life = isHit ? (10 + Math.floor(Math.random() * 6)) : (5 + Math.floor(Math.random() * 3));
      _hits.push({
        x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp - 1,
        life: life, maxLife: life,
        size: isHit ? (2 + Math.random() * 3) : (1.5 + Math.random() * 2),
        color: Math.random() < 0.5 ? '#9B59B6' : hitColor,
        type: 'hit',
      });
    }
  }
}

// ── 繪製投射物 ──
function drawProjectiles(ctx) {
  // 繪製命中/閃避粒子
  for (var j = 0; j < _hits.length; j++) {
    var h = _hits[j];
    var alpha = h.life / h.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.size * alpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 繪製投射物本體 + 各自的拖尾
  for (var i = 0; i < _projs.length; i++) {
    var p = _projs[i];
    // 魔法彈拖尾
    if (p.type === 'magic' && p.trail) {
      for (var t = 0; t < p.trail.length; t++) {
        var tr = p.trail[t];
        ctx.save();
        ctx.globalAlpha = (tr.life / tr.maxLife) * 0.5;
        ctx.fillStyle = PROJ.magic.trailColor;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, tr.size * (tr.life / tr.maxLife), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    if (p.type === 'arrow') {
      drawArrow(ctx, p);
    } else if (p.type === 'magic') {
      drawMagic(ctx, p);
    }
    ctx.restore();
  }
}

// ── 箭矢繪製 ──
function drawArrow(ctx, p) {
  var cfg = PROJ.arrow;
  var x = p.x, y = p.y, dir = p.dir;

  // 箭桿（棕色）
  ctx.strokeStyle = cfg.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - dir * cfg.w / 2, y);
  ctx.lineTo(x + dir * cfg.w / 2, y);
  ctx.stroke();

  // 箭頭（銀色三角）
  ctx.fillStyle = cfg.headColor;
  ctx.beginPath();
  ctx.moveTo(x + dir * (cfg.w / 2 + 4), y);
  ctx.lineTo(x + dir * cfg.w / 2, y - 3);
  ctx.lineTo(x + dir * cfg.w / 2, y + 3);
  ctx.closePath();
  ctx.fill();

  // 箭羽（尾端小三角）
  ctx.fillStyle = cfg.tailColor;
  ctx.beginPath();
  var tx = x - dir * cfg.w / 2;
  ctx.moveTo(tx, y);
  ctx.lineTo(tx - dir * 4, y - 2.5);
  ctx.lineTo(tx - dir * 4, y + 2.5);
  ctx.closePath();
  ctx.fill();
}

// ── 魔法彈繪製 ──
function drawMagic(ctx, p) {
  var cfg = PROJ.magic;
  var x = p.x, y = p.y;
  // 緩慢脈動（頻率降低避免閃爍）
  var pulse = 1 + Math.sin(p.timer * 0.12) * 0.1;
  var r = cfg.r * pulse;

  // 外發光（固定透明度）
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = cfg.glowColor;
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fill();

  // 核心光球
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = cfg.color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // 內部亮點
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#E8D0F0';
  ctx.beginPath();
  ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

// ── 覆蓋 stub ──
E.spawnProjectile = spawnProjectile;
E.updateProjectiles = updateProjectiles;
E.drawProjectiles = drawProjectiles;

// 攔截 clearAll 以同步清除投射物
var _origClear = E.clearAll;
E.clearAll = function() { _origClear(); _projs.length = 0; _hits.length = 0; };

})();
