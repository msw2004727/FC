/* ================================================
   ColorCat — 場景背景繪製（天空、草地、太陽/月亮、鳥群/流星）
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 天空動畫常數（@30fps） ──
var BIRD_INTERVAL_MIN = 300, BIRD_INTERVAL_MAX = 900;
var METEOR_INTERVAL_MIN = 150, METEOR_INTERVAL_MAX = 300;
function randInterval(min, max) { return min + Math.floor(Math.random() * (max - min)); }
var _skyTimer = 0, _skyNextAt = randInterval(METEOR_INTERVAL_MIN, METEOR_INTERVAL_MAX);
var _skyEvents = [];

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
  ctx.restore();
}

// ── 山巒（兩層景深） ──
var FAR_PEAKS = [
  [0,78],[0.12,48],[0.25,80],[0.45,40],[0.65,78],[0.82,46],[1,74]
];
var NEAR_PEAKS = [
  [0,86],[0.08,78],[0.16,88],[0.25,74],[0.35,86],
  [0.45,72],[0.55,85],[0.65,70],[0.75,84],
  [0.85,74],[0.95,84],[1,88]
];

function drawMountainLayer(ctx, sw, peaks, color) {
  ctx.beginPath();
  ctx.moveTo(0, C.GROUND_Y);
  for (var i = 0; i < peaks.length; i++) {
    ctx.lineTo(peaks[i][0] * sw, peaks[i][1]);
  }
  ctx.lineTo(sw, C.GROUND_Y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// ── 山頂積雪 ──
function drawSnowCaps(ctx, sw, peaks, light) {
  ctx.fillStyle = light ? 'rgba(255,255,255,0.55)' : 'rgba(180,200,220,0.25)';
  for (var i = 1; i < peaks.length - 1; i++) {
    var py = peaks[i][1], prevY = peaks[i - 1][1], nextY = peaks[i + 1][1];
    if (py >= prevY || py >= nextY) continue; // 僅山頂（局部最低 y）
    var px = peaks[i][0] * sw;
    var snowH = Math.max(2, (90 - py) * 0.12);
    var leftDx = (px - peaks[i - 1][0] * sw) / (prevY - py) * snowH;
    var rightDx = (peaks[i + 1][0] * sw - px) / (nextY - py) * snowH;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - leftDx, py + snowH);
    ctx.lineTo(px + rightDx, py + snowH);
    ctx.closePath();
    ctx.fill();
  }
}

// ── 角色離場後的遠山剪影 ──
var _silhouette = { progress: 0, active: false, atPeak: false, legPhase: 0 };
// 中間最高峰 [0.45, 40]，起點在近遠山交會處 (xr≈0.27, y≈76)
var SIL_START_XR = 0.27, SIL_START_Y = 76;
var SIL_END_XR = 0.45, SIL_END_Y = 40;
var SIL_SPEED = 0.0005;

function updateSilhouette() {
  var char_ = window.ColorCatCharacter && window.ColorCatCharacter._;
  if (!char_ || !char_.signpostAway || char_.awayMode !== 'hike') {
    _silhouette.active = false;
    _silhouette.progress = 0;
    _silhouette.atPeak = false;
    return;
  }
  _silhouette.active = true;
  if (!_silhouette.atPeak) {
    _silhouette.progress += SIL_SPEED;
    _silhouette.legPhase += 0.12;
    if (_silhouette.progress >= 1) {
      _silhouette.progress = 1;
      _silhouette.atPeak = true;
    }
  }
}

function drawSilhouette(ctx, sw) {
  if (!_silhouette.active) return;
  var p = _silhouette.progress;
  var x = (SIL_START_XR + (SIL_END_XR - SIL_START_XR) * p) * sw;
  var y = SIL_START_Y + (SIL_END_Y - SIL_START_Y) * p;
  var h = 2;
  // 模糊化處理
  ctx.save();
  ctx.filter = 'blur(0.6px)';
  var col = 'rgba(0,0,0,0.45)';
  // 頭
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y - h, 0.5, 0, Math.PI * 2); ctx.fill();
  // 身體
  ctx.strokeStyle = col; ctx.lineWidth = 0.4;
  ctx.beginPath(); ctx.moveTo(x, y - h + 0.4); ctx.lineTo(x, y - 0.5); ctx.stroke();
  // 腿（走路擺動）
  var legSwing = _silhouette.atPeak ? 0 : Math.sin(_silhouette.legPhase) * 0.6;
  ctx.beginPath();
  ctx.moveTo(x, y - 0.5); ctx.lineTo(x - 0.5 + legSwing, y);
  ctx.moveTo(x, y - 0.5); ctx.lineTo(x + 0.5 - legSwing, y);
  ctx.stroke();
  ctx.restore();
}

function drawMountains(ctx, sw, light) {
  drawMountainLayer(ctx, sw, FAR_PEAKS, light ? 'rgba(140,165,195,0.3)' : 'rgba(30,42,62,0.45)');
  drawSnowCaps(ctx, sw, FAR_PEAKS, light);
  // 遠山剪影（在遠山之上、近山之下）
  updateSilhouette();
  drawSilhouette(ctx, sw);
  drawMountainLayer(ctx, sw, NEAR_PEAKS, light ? '#9BB8D4' : '#1A3048');
}

// ── 星星（夜間，預生成固定位置） ──
var _stars = (function() {
  var arr = [];
  for (var i = 0; i < 40; i++) {
    arr.push({
      xr: Math.random(),           // x 比例（0~1），乘以 sw 得實際位置
      y: 3 + Math.random() * 52,   // y 3~55（天空區，山巒會自然遮擋）
      r: 0.3 + Math.random() * 0.7, // 半徑 0.3~1.0
      a: 0.3 + Math.random() * 0.6, // 基礎亮度 0.3~0.9
      twinkleSpd: 0.02 + Math.random() * 0.04, // 閃爍速度
      twinkleOff: Math.random() * Math.PI * 2,  // 閃爍相位
    });
  }
  return arr;
})();
var _starTimer = 0;

function drawStars(ctx, sw) {
  _starTimer++;
  for (var i = 0; i < _stars.length; i++) {
    var s = _stars[i];
    var twinkle = 0.5 + 0.5 * Math.sin(_starTimer * s.twinkleSpd + s.twinkleOff);
    var alpha = s.a * (0.6 + 0.4 * twinkle);
    ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
    ctx.beginPath();
    ctx.arc(s.xr * sw, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
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

  // 星星（夜間，畫在山巒前讓山巒自然遮擋）
  if (!light) drawStars(ctx, sw);

  // 流星（夜間，山巒後面）
  if (!light) drawMeteorsBehind(ctx);

  // 山巒（天空之上、草地之下）
  drawMountains(ctx, sw, light);

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

  // 樹（右側背景）
  drawTree(ctx, sw, light);

  // 路標（草地、樹之後，欄位之前）
  drawSignpost(ctx, sw, light);

  // 太陽/月亮
  if (light) drawSun(ctx, sw - 20, 18);
  else drawMoon(ctx, sw - 20, 18);

  // 鋤草按鈕（左上角，取代刷新按鈕）
  if (_.drawWeedBtn) _.drawWeedBtn(ctx, light);
}

// ── 背景樹叢（三棵，稍微重疊、高低不同） ──
var _trees = [
  { xr: 0.824, trunkH: 20, crownRx: 15, crownRy: 22 }, // 左（最高）
  { xr: 0.87, trunkH: 17, crownRx: 13, crownRy: 19 },  // 中（稍矮）
  { xr: 0.91, trunkH: 22, crownRx: 14, crownRy: 21 },  // 右（中高）
];
function drawTree(ctx, sw, light) {
  var gY = C.GROUND_Y;
  var trunkC = light ? '#6D4C2E' : '#2A1F14';
  var crownD = light ? '#2E7D32' : '#0E2E10';
  var crownL = light ? '#43A047' : '#1B4A1E';
  for (var i = 0; i < _trees.length; i++) {
    var t = _trees[i], tx = sw * t.xr;
    var cy = gY - t.trunkH - t.crownRy + 6;
    ctx.fillStyle = trunkC;
    ctx.fillRect(tx - 2.5, gY - t.trunkH, 5, t.trunkH);
    ctx.fillStyle = crownD;
    ctx.beginPath(); ctx.ellipse(tx, cy + 2, t.crownRx + 2, t.crownRy + 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = crownL;
    ctx.beginPath(); ctx.ellipse(tx - 1, cy, t.crownRx, t.crownRy, 0, 0, Math.PI * 2); ctx.fill();
  }
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

// 流星：山巒後面（在 drawBackground 中呼叫）
function drawMeteorsBehind(ctx) {
  for (var i = 0; i < _skyEvents.length; i++) {
    var e = _skyEvents[i];
    if (e.type === 'meteor') drawMeteor(ctx, e);
  }
}

// 鳥群：山巒前面（在 render 中呼叫）
function drawSkyEvents(ctx, light) {
  for (var i = 0; i < _skyEvents.length; i++) {
    var e = _skyEvents[i];
    if (e.type === 'birds' && light) drawBirds(ctx, e);
  }
}

// ── 樹點擊判定（橢圓樹冠範圍） ──
function isTreeClicked(cx, cy, sw) {
  var gY = C.GROUND_Y;
  for (var i = 0; i < _trees.length; i++) {
    var t = _trees[i], tx = sw * t.xr;
    var tcy = gY - t.trunkH - t.crownRy + 6;
    var dx = (cx - tx) / t.crownRx;
    var dy = (cy - tcy) / t.crownRy;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

// ── 木頭路標（右側太陽下方，箭頭指右） ──
function drawSignpost(ctx, sw, light) {
  var postX = sw - 20;
  var postTop = 93;
  var postBottom = C.CHAR_GROUND_Y - 8;  // 深入草地
  var postW = 3.5;

  // 木柱
  var trunkC = light ? '#6D4C2E' : '#3A2A18';
  ctx.fillStyle = trunkC;
  ctx.fillRect(postX - postW / 2, postTop, postW, postBottom - postTop);

  // 柱頂小圓帽
  ctx.fillStyle = light ? '#5A3D20' : '#2E1C0E';
  ctx.beginPath();
  ctx.arc(postX, postTop, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // 箭頭招牌
  var boardY = postTop + 4;
  var boardH = 9;
  var boardLeft = postX - 3;
  var boardRight = sw - 8;
  var arrowTip = sw - 3;

  ctx.fillStyle = light ? '#A0784A' : '#5A3D24';
  ctx.beginPath();
  ctx.moveTo(boardLeft, boardY);
  ctx.lineTo(boardRight, boardY);
  ctx.lineTo(arrowTip, boardY + boardH / 2);
  ctx.lineTo(boardRight, boardY + boardH);
  ctx.lineTo(boardLeft, boardY + boardH);
  ctx.closePath();
  ctx.fill();

  // 招牌邊框
  ctx.strokeStyle = light ? '#5A3D20' : '#2E1C0E';
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // 木紋線
  ctx.strokeStyle = light ? 'rgba(90,61,32,0.25)' : 'rgba(80,60,30,0.2)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(boardLeft + 2, boardY + 3);
  ctx.lineTo(boardRight - 2, boardY + 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(boardLeft + 2, boardY + 6);
  ctx.lineTo(boardRight - 2, boardY + 6);
  ctx.stroke();
}

// ── 重新整理按鈕（左上角，與太陽/月亮對稱） ──
var REFRESH_X = 20, REFRESH_Y = 18;

function drawRefreshBtn(ctx, light) {
  ctx.save();
  var x = REFRESH_X, y = REFRESH_Y, r = 6;
  var col = light ? 'rgba(50,50,50,0.45)' : 'rgba(200,200,200,0.45)';
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 圓弧（約 306° 順時鐘，缺口在右上方）
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 1.7);
  ctx.stroke();
  // 箭頭（弧末端，指向順時鐘方向）
  var ea = Math.PI * 1.7;
  var tipX = x + r * Math.cos(ea), tipY = y + r * Math.sin(ea);
  ctx.beginPath();
  ctx.moveTo(tipX - 1.5, tipY - 3);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - 3.3, tipY - 0.5);
  ctx.stroke();
  ctx.restore();
}

function isRefreshBtnClicked(cx, cy) {
  var dx = cx - REFRESH_X, dy = cy - REFRESH_Y;
  return dx * dx + dy * dy < 15 * 15;
}

// ── 路標點擊判定 ──
function isSignpostClicked(cx, cy, sw) {
  var postX = sw - 20;
  var postTop = 93;
  return cx >= postX - 8 && cx <= sw - 2 && cy >= postTop - 3 && cy <= C.GROUND_Y + 5;
}

_.drawBackground = drawBackground;
_.updateSkyEvents = updateSkyEvents;
_.drawSkyEvents = drawSkyEvents;
_.isTreeClicked = isTreeClicked;
_.isSignpostClicked = isSignpostClicked;
_.drawRefreshBtn = drawRefreshBtn;
_.isRefreshBtnClicked = isRefreshBtnClicked;

})();
