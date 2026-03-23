/* ================================================
   ColorCat — 雜草系統（放置魚缸 — 離線長草）
   玩家太久沒回來，畫面上會長滿雜草。
   點擊鋤草按鈕 → 角色跑過底邊清除。
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 常數 ──
var MAX_GRASS   = 50;
var GROW_PHASE  = 30;          // 長出動畫幀數（~1 秒 @30fps）
var FADE_FRAMES = 20;          // 倒下淡出幀數
var AUTO_GROW_INTERVAL = 450;  // 與花朵相同（可未來獨立調整）

// ── 雜草種類定義 ──
var GRASS_TYPES = [
  { name: 'blade',  weight: 70 },   // 普通一支草
  { name: 'reed',   weight: 15 },   // 蘆葦草（細莖 + 頂端穗）
  { name: 'tall',   weight: 15 },   // 高草
];
var _totalWeight = 0;
for (var tw = 0; tw < GRASS_TYPES.length; tw++) _totalWeight += GRASS_TYPES[tw].weight;

function _pickType() {
  var r = Math.random() * _totalWeight, acc = 0;
  for (var i = 0; i < GRASS_TYPES.length; i++) {
    acc += GRASS_TYPES[i].weight;
    if (r < acc) return GRASS_TYPES[i].name;
  }
  return 'blade';
}

// ── 顏色池（深淺綠） ──
var COLORS_LIGHT = ['#2E7D32','#388E3C','#43A047','#4CAF50','#558B2F','#689F38','#7CB342'];
var COLORS_DARK  = ['#1B5E20','#2E7D32','#33691E','#388E3C','#1a3a1a','#254d25','#2d6a2d'];

function _pickColor() {
  var pool = C.isThemeDark() ? COLORS_DARK : COLORS_LIGHT;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 資料 ──
var grasses = [];
var _autoTimer = 0;

// ── 除草動畫狀態 ──
var _weeding = false;
var _weedRunX = 0;
var _weedTargetX = 0;
var _weedPhase = 0;       // 0=跑到近邊, 1=跑到遠邊, 2=完成
var _weedSpeed = 4;
var _weedOrigX = 0;       // 角色原始 x（除草結束後回歸）
var _weedOrigAction = '';

// ── 新增雜草 ──
function addGrass(sw) {
  if (grasses.length >= MAX_GRASS) return;
  var minX = 70, maxX = sw - 60;
  if (maxX < minX + 30) maxX = minX + 30;
  var x = minX + Math.random() * (maxX - minX);
  var height = 6 + Math.random() * 12;          // 6~18 px 高度變化
  var type = _pickType();
  if (type === 'reed') height = 14 + Math.random() * 10;   // 蘆葦草較高
  if (type === 'tall') height = 14 + Math.random() * 8;    // 高草
  // seed: 固定隨機值，避免每幀重算導致抖動
  var seed = Math.random();
  grasses.push({
    x: x,
    baseY: C.CHAR_GROUND_Y,
    height: height,
    type: type,
    color: _pickColor(),
    state: 'growing',    // growing → grown → clearing
    timer: 0,
    fallDir: 0,          // 倒下方向（除草時設定）
    seed: seed,
    bendDir: seed > 0.5 ? 1 : -1,  // 彎曲方向（固定）
  });
}

// ── 離線補長 ──
function catchUpOffline(elapsedMs, sw) {
  if (!elapsedMs || elapsedMs <= 0) return;
  // 每 AUTO_GROW_INTERVAL 幀（33ms/幀）長一根
  var frameDuration = 33;
  var framesElapsed = Math.floor(elapsedMs / frameDuration);
  var growCount = Math.floor(framesElapsed / AUTO_GROW_INTERVAL);
  growCount = Math.min(growCount, MAX_GRASS - grasses.length);
  for (var i = 0; i < growCount; i++) {
    addGrass(sw);
    // 離線長的草直接設為 grown
    var g = grasses[grasses.length - 1];
    g.state = 'grown';
    g.timer = GROW_PHASE;
  }
}

// ── 每幀更新 ──
function updateGrass(sw) {
  // 長草動畫
  for (var i = grasses.length - 1; i >= 0; i--) {
    var g = grasses[i];
    if (g.state === 'growing') {
      g.timer++;
      if (g.timer >= GROW_PHASE) g.state = 'grown';
    } else if (g.state === 'clearing') {
      g.timer++;
      if (g.timer >= FADE_FRAMES) grasses.splice(i, 1);
    }
  }
  // 自動長草
  if (!_weeding) {
    _autoTimer++;
    if (_autoTimer >= AUTO_GROW_INTERVAL) {
      _autoTimer = 0;
      if (grasses.length < MAX_GRASS) addGrass(sw);
    }
  }
  // 除草動畫
  if (_weeding) _updateWeeding(sw);
}

// ── 除草動畫邏輯 ──
function _updateWeeding(sw) {
  var ch = window.ColorCatCharacter;
  if (!ch) { _weeding = false; return; }
  var state = ch.state;

  if (_weedPhase === 0) {
    // Phase 0：面朝近邊方向，跑到近邊（不清草，只是移動到起點）
    var dir = _weedTargetX < state.x ? -1 : 1;
    state.facing = dir;
    state.x += dir * _weedSpeed;
    if ((dir < 0 && state.x <= _weedTargetX) || (dir > 0 && state.x >= _weedTargetX)) {
      state.x = _weedTargetX;
      // 到達近邊，面朝遠邊開始清掃
      _weedPhase = 1;
      _weedTargetX = _weedTargetX < sw / 2 ? sw - 30 : 30;
      state.facing = _weedTargetX > state.x ? 1 : -1;
    }
  } else if (_weedPhase === 1) {
    // Phase 1：面朝遠邊衝刺，沿路清草 + 收割花
    var dir2 = _weedTargetX < state.x ? -1 : 1;
    state.facing = dir2;
    state.x += dir2 * _weedSpeed;
    _clearAtX(state.x, dir2);
    if ((dir2 < 0 && state.x <= _weedTargetX) || (dir2 > 0 && state.x >= _weedTargetX)) {
      state.x = _weedTargetX;
      _weedPhase = 2;
    }
  } else {
    // 除草完成
    _weeding = false;
    state.action = 'idle';
  }
}

function _clearAtX(charX, dir) {
  // 清除雜草
  for (var i = 0; i < grasses.length; i++) {
    var g = grasses[i];
    if (g.state === 'clearing') continue;
    if (Math.abs(g.x - charX) < 12) {
      g.state = 'clearing';
      g.timer = 0;
      g.fallDir = dir;
    }
  }
  // 同時收割花朵
  if (_.knockFlower) {
    var bloomed = _.getBloomedFlowers ? _.getBloomedFlowers() : [];
    for (var j = 0; j < bloomed.length; j++) {
      var f = bloomed[j];
      if (Math.abs(f.x - charX) < 12) {
        _.knockFlower(f, dir, false);
      }
    }
  }
}

// ── 開始除草 ──
function startWeeding(sw) {
  if (_weeding) return;
  var ch = window.ColorCatCharacter;
  if (!ch) return;
  // 禁止在特殊狀態下除草
  var act = ch.state.action;
  var forbidden = ['sleeping','dying','combo','hurt','knockback','ultimate','jumpOff','runAway','returnPanting','attackEnemy','attackGrave'];
  for (var f = 0; f < forbidden.length; f++) {
    if (act === forbidden[f]) return;
  }
  // 需要有草或有已開花的花才觸發
  var aliveGrass = 0;
  for (var c = 0; c < grasses.length; c++) {
    if (grasses[c].state !== 'clearing') aliveGrass++;
  }
  var bloomedFlowers = _.getBloomedFlowers ? _.getBloomedFlowers().length : 0;
  if (aliveGrass === 0 && bloomedFlowers === 0) return;

  _weeding = true;
  _weedPhase = 0;
  _weedOrigX = ch.state.x;
  ch.state.action = 'weeding';   // 專用動作，不受 AI 干擾

  // 決定先跑到哪個邊（離角色較近的邊）
  var leftEdge = 30, rightEdge = sw - 30;
  if (ch.state.x - leftEdge < rightEdge - ch.state.x) {
    _weedTargetX = leftEdge;
  } else {
    _weedTargetX = rightEdge;
  }
}

function isWeeding() { return _weeding; }

// ── 繪製單根草 ──
function _drawSingleGrass(ctx, g, light) {
  var progress = g.state === 'growing' ? g.timer / GROW_PHASE : 1;
  var h = g.height * progress;
  var alpha = 1;
  var tiltAngle = 0;

  if (g.state === 'clearing') {
    var clearP = g.timer / FADE_FRAMES;
    alpha = 1 - clearP;
    tiltAngle = g.fallDir * clearP * (Math.PI / 2);
  }

  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // 倒下旋轉
  if (tiltAngle !== 0) {
    ctx.translate(g.x, g.baseY);
    ctx.rotate(tiltAngle);
    ctx.translate(-g.x, -g.baseY);
  }

  var baseY = g.baseY;
  var color = g.color;

  if (g.type === 'blade') {
    // 單支草葉 — 微彎曲線（用 seed 決定彎曲，不用 Math.random）
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(g.x, baseY);
    var tipX = g.x + g.bendDir * 2;
    var cpX = g.x + g.bendDir * 3 * g.seed;
    ctx.quadraticCurveTo(cpX, baseY - h * 0.6, tipX, baseY - h);
    ctx.stroke();
  } else if (g.type === 'reed') {
    // 蘆葦草 — 細莖微彎 + 頂端橢圓穗
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    // 細莖（微彎）
    var rBendX = g.x + g.bendDir * 2 * g.seed;
    ctx.beginPath();
    ctx.moveTo(g.x, baseY);
    ctx.quadraticCurveTo(g.x, baseY - h * 0.6, rBendX, baseY - h);
    ctx.stroke();
    // 頂端穗（橢圓形，棕色）
    ctx.fillStyle = light ? '#8D6E63' : '#6D4C41';
    ctx.beginPath();
    ctx.ellipse(rBendX, baseY - h - 3, 1.8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (g.type === 'tall') {
    // 高草 — 粗一些，頂端微彎
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(g.x, baseY);
    var bendX = g.x + g.bendDir * 3;
    ctx.quadraticCurveTo(g.x, baseY - h * 0.7, bendX, baseY - h);
    ctx.stroke();
    // 頂端穗
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bendX - 2, baseY - h + 1);
    ctx.lineTo(bendX, baseY - h - 3);
    ctx.lineTo(bendX + 2, baseY - h + 1);
    ctx.stroke();
  }

  ctx.restore();
}

// ── 繪製所有雜草 ──
function drawGrass(ctx, light) {
  for (var i = 0; i < grasses.length; i++) {
    _drawSingleGrass(ctx, grasses[i], light);
  }
}

// ── 鋤草按鈕（左上角，取代刷新按鈕） ──
var WEED_BTN_X = 20, WEED_BTN_Y = 18;

function drawWeedBtn(ctx, light) {
  // 有草或有已開花的花時顯示
  var alive = 0;
  for (var c = 0; c < grasses.length; c++) {
    if (grasses[c].state !== 'clearing') alive++;
  }
  var bloomCount = _.getBloomedFlowers ? _.getBloomedFlowers().length : 0;
  if (alive === 0 && bloomCount === 0 && !_weeding) return;

  ctx.save();
  var x = WEED_BTN_X, y = WEED_BTN_Y;
  var col = light ? 'rgba(50,50,50,0.55)' : 'rgba(200,200,200,0.55)';

  // 鋤頭圖示：一根斜線（把手）+ 短橫線（刃）
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  // 把手（斜）
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 7);
  ctx.lineTo(x + 4, y - 5);
  ctx.stroke();
  // 刃（橫）
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x + 1, y - 5);
  ctx.lineTo(x + 7, y - 3);
  ctx.stroke();

  ctx.restore();
}

function isWeedBtnClicked(cx, cy) {
  var dx = cx - WEED_BTN_X, dy = cy - WEED_BTN_Y;
  return dx * dx + dy * dy < 15 * 15;
}

// ── 匯出/匯入（存檔用） ──
function exportGrass() {
  var arr = [];
  for (var i = 0; i < grasses.length; i++) {
    var g = grasses[i];
    if (g.state === 'growing' || g.state === 'grown') {
      arr.push({ x: g.x, baseY: g.baseY, height: g.height, type: g.type, color: g.color, seed: g.seed });
    }
  }
  return arr;
}

function importGrass(data) {
  grasses.length = 0;
  _weeding = false;
  _autoTimer = 0;
  if (!data || !data.length) return;
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    var sd = d.seed != null ? d.seed : Math.random();
    grasses.push({
      x: d.x, baseY: d.baseY || C.CHAR_GROUND_Y,
      height: d.height || 10, type: d.type || 'blade',
      color: d.color || '#4CAF50',
      state: 'grown', timer: GROW_PHASE, fallDir: 0,
      seed: sd, bendDir: sd > 0.5 ? 1 : -1,
    });
  }
}

function getGrassCount() {
  var n = 0;
  for (var i = 0; i < grasses.length; i++) {
    if (grasses[i].state !== 'clearing') n++;
  }
  return n;
}

// ── 註冊至場景共享狀態 ──
_.updateGrass = updateGrass;
_.drawGrass = drawGrass;
_.drawWeedBtn = drawWeedBtn;
_.isWeedBtnClicked = isWeedBtnClicked;
_.exportGrass = exportGrass;
_.importGrass = importGrass;
_.startWeeding = startWeeding;
_.isWeeding = isWeeding;
_.catchUpGrass = catchUpOffline;
_.getGrassCount = getGrassCount;
_.resetWeeding = function() { _weeding = false; _weedPhase = 0; };

})();
