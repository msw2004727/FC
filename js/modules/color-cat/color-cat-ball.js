/* ================================================
   ColorCat — 球物理與繪製
   依賴：color-cat-config.js, color-cat-stats.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _bs; // 延遲取得 ColorCatStats.ball
function _b() { if (!_bs) _bs = window.ColorCatStats && window.ColorCatStats.ball; return _bs || {}; }

// ── 球物件（物理值由 stats 提供） ──
var ball = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  get r() { return _b().radius || 6.3; },
  get gravity() { return _b().gravity || 0.15; },
  get friction() { return _b().friction || 0.985; },
  get bounceLoss() { return _b().bounceLoss || 0.35; },
  spin: 0,
};

// ── 連續撞牆衰減 ──
var _wallBounceCount = 0;  // 連續撞牆次數，停下時重置

// ── 灰塵粒子 ──
var dustParticles = [];

// ── 初始化 ──
function initBall(sceneWidth) {
  ball.x = sceneWidth * 0.65;
  ball.y = C.CHAR_GROUND_Y - ball.r - 6;
  ball.vx = 0;
  ball.vy = 0;
  ball.spin = 0;
}

// ── 物理更新 ──
function updateBall(sceneWidth) {
  var sw = sceneWidth;
  var floorY = C.CHAR_GROUND_Y - 6;

  ball.vy += ball.gravity;
  ball.x += ball.vx;
  ball.y += ball.vy;
  ball.vx *= ball.friction;

  // 滾動角度與水平速度連動
  ball.spin += ball.vx / ball.r;

  // 地面彈跳
  if (ball.y + ball.r >= floorY) {
    ball.y = floorY - ball.r;
    ball.vy = -ball.vy * ball.bounceLoss;
    ball.vx *= (_b().groundFriction || 0.92);
    if (Math.abs(ball.vy) < (_b().minBounceVy || 0.5)) ball.vy = 0;
  }

  // 天花板
  if (ball.y - ball.r < 0) {
    ball.y = ball.r;
    ball.vy = -ball.vy * ball.bounceLoss;
  }

  // 左右牆壁反彈（連續撞牆每次衰減 50%）
  var hitWall = false;
  if (ball.x - ball.r < 0) {
    ball.x = ball.r;
    hitWall = true;
    _wallBounceCount++;
    ball.vx = Math.abs(ball.vx) * Math.pow(0.5, _wallBounceCount);
  }
  if (ball.x + ball.r > sw) {
    ball.x = sw - ball.r;
    hitWall = true;
    _wallBounceCount++;
    ball.vx = -Math.abs(ball.vx) * Math.pow(0.5, _wallBounceCount);
  }

  // 極小速度歸零 + 重置撞牆計數
  if (Math.abs(ball.vx) < (_b().minVx || 0.05)) {
    ball.vx = 0;
    _wallBounceCount = 0;
  } else if (!hitWall) {
    _wallBounceCount = 0;
  }

  // 更新灰塵粒子
  updateDust();
}

// ── 產生踢球灰塵 ──
function spawnKickDust(x, y, dir) {
  var count = 5 + Math.floor(Math.random() * 4); // 5~8 顆粒子
  for (var i = 0; i < count; i++) {
    dustParticles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 4,
      vx: -dir * (0.3 + Math.random() * 1.2),      // 反方向噴出
      vy: -(0.5 + Math.random() * 1.5),             // 向上飄
      life: 1.0,                                      // 1.0 → 0 消失
      decay: 0.03 + Math.random() * 0.03,            // 衰減速率
      size: 1.5 + Math.random() * 2.5,               // 粒子大小
    });
  }
}

// ── 更新灰塵粒子 ──
function updateDust() {
  for (var i = dustParticles.length - 1; i >= 0; i--) {
    var p = dustParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.03;        // 微重力讓粒子弧形下落
    p.vx *= 0.96;        // 空氣阻力
    p.size *= 0.98;      // 逐漸縮小
    p.life -= p.decay;
    if (p.life <= 0) {
      dustParticles.splice(i, 1);
    }
  }
}

// ── 繪製灰塵粒子 ──
function drawDust(ctx, light) {
  if (dustParticles.length === 0) return;
  ctx.save();
  for (var i = 0; i < dustParticles.length; i++) {
    var p = dustParticles[i];
    var alpha = p.life * 0.6;
    ctx.fillStyle = light
      ? 'rgba(139,119,101,' + alpha + ')'   // 淺色主題：土色灰塵
      : 'rgba(200,190,170,' + alpha + ')';   // 深色主題：淺米灰塵
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── 被踢 ──
function kickBall(facingDir, sceneWidth) {
  var bs = _b();
  var edgeMargin = bs.edgeMargin || 20;
  var nearEdge = ball.x < edgeMargin || ball.x > sceneWidth - edgeMargin;
  var power = nearEdge
    ? ((bs.kickPowerEdgeMin || 3) + Math.random() * ((bs.kickPowerEdgeMax || 6) - (bs.kickPowerEdgeMin || 3)))
    : ((bs.kickPowerMin || 1.5) + Math.random() * ((bs.kickPowerMax || 3.5) - (bs.kickPowerMin || 1.5)));
  var angle = -Math.PI * ((bs.kickAngleMin || 0.1) + Math.random() * ((bs.kickAngleMax || 0.4) - (bs.kickAngleMin || 0.1)));

  // 角落時強制往中間踢
  var dir = facingDir;
  if (ball.x < edgeMargin) dir = 1;
  else if (ball.x > sceneWidth - edgeMargin) dir = -1;

  ball.vx = Math.cos(angle) * power * dir;
  ball.vy = Math.sin(angle) * power;

  // 踢球瞬間產生灰塵
  spawnKickDust(ball.x, C.CHAR_GROUND_Y - 4, dir);
}

// ── 點擊判定 ──
function isBallClicked(cx, cy) {
  var dx = cx - ball.x;
  var dy = cy - ball.y;
  return Math.sqrt(dx * dx + dy * dy) < ball.r + 12;
}

// ── 繪製 ──
function drawBall(ctx, light) {
  ctx.save();

  // 影子
  var shadowScale = Math.max(0.3, 1 - (C.CHAR_GROUND_Y - ball.y) / 80);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(ball.x, C.CHAR_GROUND_Y, ball.r * shadowScale + 2, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 球體
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.spin);

  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.fill();

  // 五邊形花紋
  ctx.fillStyle = '#333';
  for (var i = 0; i < 5; i++) {
    var pa = (i / 5) * Math.PI * 2 - Math.PI / 2;
    var px = Math.cos(pa) * ball.r * 0.5;
    var py = Math.sin(pa) * ball.r * 0.5;
    ctx.beginPath(); ctx.arc(px, py, ball.r * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  // 外圈
  ctx.strokeStyle = light ? '#999' : '#555';
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.arc(0, 0, ball.r, 0, Math.PI * 2); ctx.stroke();

  ctx.restore();

  // 灰塵粒子（在球之後繪製，避免被球遮蓋）
  drawDust(ctx, light);
}

// ── 咬球模式 ──
var _carried = false;

function setCarried(on) { _carried = !!on; }
function isCarried() { return _carried; }

function setPosition(x, y) {
  ball.x = x;
  ball.y = y;
  ball.vx = 0;
  ball.vy = 0;
}

// ── 公開 API ──
window.ColorCatBall = {
  state: ball,
  init: initBall,
  update: function(sw) { if (!_carried) updateBall(sw); },
  kick: kickBall,
  isClicked: isBallClicked,
  draw: drawBall,
  setCarried: setCarried,
  isCarried: isCarried,
  setPosition: setPosition,
};

})();
