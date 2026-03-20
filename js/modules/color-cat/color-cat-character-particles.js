/* ================================================
   ColorCat — 角色粒子特效（跑步煙塵、虛弱喘氣）
   依賴：color-cat-character.js (ColorCatCharacter._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var _s = _._s;
var ch = _.char;

// ── 跑步煙塵 ──
var _dustParticles = [];
var _dustTimer = 0;

function isRunning() {
  if (ch.action === 'chase' || ch.action === 'dash' || ch.action === 'goToBox') return true;
  if (ch.action === 'biteBall') return true;
  if (ch.action === 'combo' && _.comboStep === 0) return true;
  if (_.testMode === 'run') return true;
  return false;
}

function spawnDust() {
  var footX = ch.x - ch.facing * 8;
  var footY = ch.y - _.FOOT_OFFSET - 4;
  for (var i = 0; i < 3; i++) {
    _dustParticles.push({
      x: footX + (Math.random() - 0.5) * 8,
      y: footY + (Math.random() - 0.5) * 4,
      vx: -ch.facing * (0.4 + Math.random() * 0.6),
      vy: -(0.4 + Math.random() * 0.5),
      life: 1, decay: 0.03 + Math.random() * 0.02,
      size: 2.5 + Math.random() * 2.5,
    });
  }
}

function updateDust() {
  if (isRunning() && ch.onGround) {
    _dustTimer++;
    if (_dustTimer >= (_s() ? _s().particles.dustSpawnInterval : 3)) {
      _dustTimer = 0; spawnDust();
    }
  } else { _dustTimer = 0; }
  for (var i = _dustParticles.length - 1; i >= 0; i--) {
    var p = _dustParticles[i];
    p.x += p.vx; p.y += p.vy;
    p.vy *= 0.95; p.life -= p.decay; p.size *= 0.97;
    if (p.life <= 0) _dustParticles.splice(i, 1);
  }
}

function drawDust(ctx, light) {
  if (_dustParticles.length === 0) return;
  ctx.save();
  for (var i = 0; i < _dustParticles.length; i++) {
    var p = _dustParticles[i];
    var alpha = p.life * 0.4;
    ctx.fillStyle = light
      ? 'rgba(180,160,130,' + alpha + ')'
      : 'rgba(200,190,170,' + alpha + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ── 虛弱喘氣 ──
var _breathParticles = [];
var _breathTimer = 0;

function updateBreath() {
  if (!_s()) return;
  var rt = _s().runtime;
  var pt = _s().particles;
  if (ch.action === 'weak' && rt.weakLevel > 0) {
    _breathTimer++;
    if (_breathTimer >= pt.breathWaveInterval) {
      _breathTimer = 0;
      var mult = pt.breathLevelMult[rt.weakLevel] || 1;
      var baseCount = pt.breathBaseCount + Math.floor(Math.random() * 2);
      var count = baseCount * mult;
      // 兔子倒地時嘴巴位置較低（接近地面）
      var bunnyDown = _.isBunny();
      var mouthX = bunnyDown
        ? ch.x + ch.facing * (C.SPRITE_DRAW * 0.25)
        : ch.x + ch.facing * (C.SPRITE_DRAW * 0.18);
      var mouthY = bunnyDown
        ? ch.y - 8
        : ch.y - C.SPRITE_DRAW * 0.35 - 3;
      for (var i = 0; i < count; i++) {
        _breathParticles.push({
          x: mouthX + (Math.random() - 0.3) * 4 * mult,
          y: mouthY + (Math.random() - 0.5) * 3 * mult,
          vx: ch.facing * (0.3 + Math.random() * 0.4),
          vy: -(0.2 + Math.random() * 0.3),
          life: 1, decay: 0.02 + Math.random() * 0.015,
          size: 1.5 + Math.random() * 2,
        });
      }
    }
  } else { _breathTimer = 0; }
  for (var i = _breathParticles.length - 1; i >= 0; i--) {
    var p = _breathParticles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.97; p.vy *= 0.95; p.size += 0.03;
    p.life -= p.decay;
    if (p.life <= 0) _breathParticles.splice(i, 1);
  }
}

function drawBreath(ctx) {
  if (_breathParticles.length === 0) return;
  ctx.save();
  for (var i = 0; i < _breathParticles.length; i++) {
    var p = _breathParticles[i];
    var alpha = p.life * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ── 看花愛心粒子 ──
var _heartParticles = [];
var _heartTimer = 0;

function updateHearts() {
  if (ch.action === 'watchFlower') {
    _heartTimer++;
    if (_heartTimer >= 22) {  // 每 ~0.7 秒噴一顆（拉遠間距）
      _heartTimer = 0;
      var headY = ch.y - C.SPRITE_DRAW * 0.6;
      _heartParticles.push({
        x: ch.x + (Math.random() - 0.5) * 14,
        y: headY,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -(0.8 + Math.random() * 0.6),
        life: 1, decay: 0.012 + Math.random() * 0.008,
        size: 12 + Math.random() * 8,
      });
    }
  } else { _heartTimer = 0; }
  for (var i = _heartParticles.length - 1; i >= 0; i--) {
    var p = _heartParticles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.98; p.vy *= 0.97;
    p.life -= p.decay;
    if (p.life <= 0) _heartParticles.splice(i, 1);
  }
}

function drawHearts(ctx) {
  if (_heartParticles.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (var i = 0; i < _heartParticles.length; i++) {
    var p = _heartParticles[i];
    ctx.globalAlpha = p.life * 0.8;
    ctx.font = p.size + 'px sans-serif';
    ctx.fillStyle = '#E8524A';
    // 用簡單的心形路徑
    var s = p.size * 0.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + s * 0.3);
    ctx.bezierCurveTo(p.x - s, p.y - s * 0.5, p.x - s * 0.5, p.y - s, p.x, p.y - s * 0.4);
    ctx.bezierCurveTo(p.x + s * 0.5, p.y - s, p.x + s, p.y - s * 0.5, p.x, p.y + s * 0.3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── 面板撞擊煙塵（跟隨角色，相對座標） ──
var _knockDust = [];

function spawnKnockbackBurst() {
  for (var i = 0; i < 15; i++) {
    _knockDust.push({
      ox: (Math.random() - 0.5) * 16,
      oy: -_.FOOT_OFFSET - 4 + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -(0.5 + Math.random() * 1.5),
      life: 1, decay: 0.02 + Math.random() * 0.02,
      size: 3.5 + Math.random() * 4,
    });
  }
}

function updateKnockDust() {
  for (var i = _knockDust.length - 1; i >= 0; i--) {
    var p = _knockDust[i];
    p.ox += p.vx; p.oy += p.vy;
    p.vy *= 0.95; p.vx *= 0.95; p.size *= 0.97;
    p.life -= p.decay;
    if (p.life <= 0) _knockDust.splice(i, 1);
  }
}

function drawKnockDust(ctx, light) {
  if (_knockDust.length === 0) return;
  ctx.save();
  for (var i = 0; i < _knockDust.length; i++) {
    var p = _knockDust[i];
    var alpha = p.life * 0.5;
    ctx.fillStyle = light
      ? 'rgba(180,160,130,' + alpha + ')'
      : 'rgba(200,190,170,' + alpha + ')';
    ctx.beginPath();
    ctx.arc(ch.x + p.ox, ch.y + p.oy, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

_.isRunning = isRunning;
_.updateDust = updateDust;
_.drawDust = drawDust;
_.updateBreath = updateBreath;
_.drawBreath = drawBreath;
_.updateHearts = updateHearts;
_.drawHearts = drawHearts;
_.spawnKnockbackBurst = spawnKnockbackBurst;
_.updateKnockDust = updateKnockDust;
_.drawKnockDust = drawKnockDust;

})();
