/* ================================================
   ColorCat — 場景背景繪製（天空、草地、太陽/月亮、鳥群/流星）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 天空動畫常數（@30fps） ──
// TODO: 未來由後台設定間隔
var BIRD_INTERVAL_MIN   = 300;   // 鳥群：10 秒
var BIRD_INTERVAL_MAX   = 900;   // 鳥群：30 秒
var METEOR_INTERVAL_MIN = 150;   // 流星：5 秒
var METEOR_INTERVAL_MAX = 300;   // 流星：10 秒

function randInterval(min, max) { return min + Math.floor(Math.random() * (max - min)); }
var _skyTimer = 0;
var _skyNextAt = randInterval(METEOR_INTERVAL_MIN, METEOR_INTERVAL_MAX);
var _skyEvents = [];  // { type:'birds'|'meteor', x, y, vx, vy, timer, maxTimer, ... }

function drawSun(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#FDB813';
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#FDB813'; ctx.lineWidth = 1.5;
  for (var i = 0; i < 8; i++) {
    var a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
    ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#F5E6B8';
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a1628';
  ctx.beginPath(); ctx.arc(x + 4, y - 2, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '6px serif';
  ctx.fillText('\u2726', x - 14, y - 4);
  ctx.fillText('\u2726', x - 8, y + 10);
  ctx.restore();
}

function drawBackground(ctx, sw, light) {
  // 天空漸層
  var grad = ctx.createLinearGradient(0, 0, 0, C.SCENE_H);
  if (light) {
    grad.addColorStop(0, '#87CEEB'); grad.addColorStop(0.7, '#B0E0F0'); grad.addColorStop(1, '#4CAF50');
  } else {
    grad.addColorStop(0, '#0a1628'); grad.addColorStop(0.7, '#0f2035'); grad.addColorStop(1, '#1a3a1a');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sw, C.SCENE_H);

  // 草地
  ctx.fillStyle = light ? '#4CAF50' : '#1a3a1a';
  ctx.fillRect(0, C.GROUND_Y, sw, C.SCENE_H - C.GROUND_Y);
  ctx.fillStyle = light ? '#388E3C' : '#153015';
  for (var gx = 0; gx < sw; gx += 6) ctx.fillRect(gx, C.GROUND_Y, 3, 2);
  ctx.fillStyle = light ? '#66BB6A' : '#1e4a1e';
  for (var gx2 = 3; gx2 < sw; gx2 += 10) ctx.fillRect(gx2, C.GROUND_Y, 2, 1);

  // 場地線
  ctx.fillStyle = light ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, C.GROUND_Y + 4, sw, 1);

  // 太陽/月亮
  if (light) drawSun(ctx, sw - 20, 18);
  else drawMoon(ctx, sw - 20, 18);
}

// ── 天空動畫：鳥群（白天）/ 流星（夜晚） ──

function spawnSkyEvent(sw, light) {
  if (light) {
    // 鳥群：2~8 隻，隨機排列（V形、散佈、斜列），從左或右飛入
    var fromLeft = Math.random() < 0.5;
    var baseY = 8 + Math.random() * 30;
    var count = 2 + Math.floor(Math.random() * 7);
    var speed = 0.6 + Math.random() * 0.8;
    var dir = fromLeft ? 1 : -1;
    var startX = fromLeft ? -30 : sw + 30;
    var formation = Math.random();  // 0~0.33 V形, 0.33~0.66 斜列, 0.66~1 散佈
    _skyEvents.push({
      type: 'birds', x: startX, y: baseY, vx: speed * dir, count: count,
      timer: 0, maxTimer: Math.ceil((sw + 80) / speed),
      offsets: (function() {
        var o = [];
        for (var i = 0; i < count; i++) {
          var dx, dy;
          if (formation < 0.33) {
            // V 形：左右交替展開
            var side = (i % 2 === 0) ? -1 : 1;
            var rank = Math.ceil(i / 2);
            dx = -dir * rank * (6 + Math.random() * 3);
            dy = side * rank * (4 + Math.random() * 2);
          } else if (formation < 0.66) {
            // 斜列
            dx = -dir * i * (5 + Math.random() * 3);
            dy = i * (2 + Math.random() * 2) - count * 1.5;
          } else {
            // 散佈
            dx = (Math.random() - 0.5) * count * 6;
            dy = (Math.random() - 0.5) * count * 4;
          }
          o.push({ dx: dx, dy: dy });
        }
        return o;
      })()
    });
  } else {
    // 流星：從右上往左下劃過
    var sx = sw * 0.3 + Math.random() * sw * 0.6;
    var sy = 2 + Math.random() * 15;
    _skyEvents.push({
      type: 'meteor', x: sx, y: sy,
      vx: -(2.5 + Math.random() * 1.5), vy: 1.2 + Math.random() * 0.8,
      timer: 0, maxTimer: 40 + Math.floor(Math.random() * 20),
      brightness: 0.7 + Math.random() * 0.3
    });
  }
}

function updateSkyEvents(sw, light) {
  _skyTimer++;
  if (_skyTimer >= _skyNextAt) {
    _skyTimer = 0;
    _skyNextAt = light
      ? randInterval(BIRD_INTERVAL_MIN, BIRD_INTERVAL_MAX)
      : randInterval(METEOR_INTERVAL_MIN, METEOR_INTERVAL_MAX);
    spawnSkyEvent(sw, light);
  }
  for (var i = _skyEvents.length - 1; i >= 0; i--) {
    var e = _skyEvents[i];
    e.x += e.vx;
    if (e.vy) e.y += e.vy;
    e.timer++;
    if (e.timer >= e.maxTimer) _skyEvents.splice(i, 1);
  }
}

function drawBirds(ctx, e) {
  ctx.save();
  ctx.strokeStyle = 'rgba(40,40,40,0.5)';
  ctx.lineWidth = 0.8;
  var wingPhase = Math.sin(e.timer * 0.25);
  for (var i = 0; i < e.count; i++) {
    var bx = e.x + e.offsets[i].dx * (1 + i * 0.3);
    var by = e.y + e.offsets[i].dy;
    ctx.beginPath();
    ctx.moveTo(bx - 3, by + wingPhase * 1.5);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + 3, by + wingPhase * 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMeteor(ctx, e) {
  ctx.save();
  var fade = 1 - e.timer / e.maxTimer;
  var tailLen = 18;
  var grad = ctx.createLinearGradient(e.x, e.y, e.x - e.vx * tailLen * 0.3, e.y - e.vy * tailLen * 0.3);
  grad.addColorStop(0, 'rgba(255,255,240,' + (fade * e.brightness) + ')');
  grad.addColorStop(1, 'rgba(255,255,240,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x - e.vx * tailLen * 0.3, e.y - e.vy * tailLen * 0.3);
  ctx.stroke();
  // 亮點
  ctx.fillStyle = 'rgba(255,255,255,' + (fade * e.brightness) + ')';
  ctx.beginPath(); ctx.arc(e.x, e.y, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawSkyEvents(ctx, light) {
  for (var i = 0; i < _skyEvents.length; i++) {
    var e = _skyEvents[i];
    if (e.type === 'birds' && light) drawBirds(ctx, e);
    else if (e.type === 'meteor' && !light) drawMeteor(ctx, e);
  }
}

_.drawBackground = drawBackground;
_.updateSkyEvents = updateSkyEvents;
_.drawSkyEvents = drawSkyEvents;

})();
