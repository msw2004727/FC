/* ================================================
   ColorCat — 場景核心（共享狀態、主迴圈、初始化、點擊、App 掛載）
   子模組透過 ColorCatScene._ 存取共享狀態並註冊函式
   依賴：color-cat-config.js, color-cat-ball.js, color-cat-character.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _sceneInterval = null;
var _canvas, _ctx, _sw, _dpr;

// ── 內部共享狀態（子模組透過 ColorCatScene._ 存取） ──
var _ = {
  // 紙箱設定
  BOX_X: 35, BOX_W: 51, BOX_H: 46, BOX_BOTTOM_Y: 0,
  // 旗子設定
  FLAG_POLE_X: 0, FLAG_POLE_TOP: 0, FLAG_POLE_H: 30,
  FLAG_W: 18, FLAG_H: 14,
  // 動畫計時器
  zzzTimer: 0, flagTimer: 0,
};

// 子模組函式插槽（載入時由各子模組填入實作）
_.drawBackground = function() {};
_.drawBox = function() {};
_.drawFlag = function() {};
_.drawWallShadow = function() {};
_.isBoxClicked = function() { return false; };
_.isFlagClicked = function() { return false; };
_.updatePanel = function() {};
_.drawPanel = function() {};
_.updateFlowers = function() {};
_.drawFlowers = function() {};
_.handleFlowerClick = function() { return false; };
_.addFlower = function() {};
_.handlePanelClick = function() { return false; };
_.updateSkyEvents = function() {};
_.drawSkyEvents = function() {};

// ===== 主迴圈 =====

function render() {
  var light = !C.isThemeDark();
  var sleeping = ColorCatCharacter.isSleeping();
  _.drawBackground(_ctx, _sw, light);
  _.drawSkyEvents(_ctx, light);
  _.drawFlowers(_ctx, light);
  _.drawBox(_ctx, light, sleeping);
  ColorCatBall.draw(_ctx, light);
  _.drawWallShadow(_ctx);
  _.drawFlag(_ctx, light);
  ColorCatCharacter.draw(_ctx, light);
  _.drawPanel(_ctx, _sw, light);
}

function update() {
  _.updateFlowers(_sw);
  var light = !C.isThemeDark();
  _.updateSkyEvents(_sw, light);
  // 面板滑動 + 碰撞判定（必須在 getEffectiveWidth / 角色位置夾限之前）
  if (_.updatePanel) _.updatePanel(_sw);
  var ew = _.getEffectiveWidth ? _.getEffectiveWidth(_sw) : _sw;
  // 球邊界先夾（確保角色追球時目標不在面板內）
  var bs = ColorCatBall.state;
  if (bs.x + bs.r > ew) {
    bs.x = ew - bs.r;
    if (bs.vx > 0) bs.vx = -bs.vx;
  }
  ColorCatBall.update(_sw);
  if (bs.x + bs.r > ew) { bs.x = ew - bs.r; if (bs.vx > 0) bs.vx = -bs.vx; }
  var kicked = ColorCatCharacter.update(ew, bs);
  if (kicked) {
    ColorCatBall.kick(ColorCatCharacter.state.facing, _sw);
  }
  // 角色不超過面板邊界（knockback 飛行中不夾，讓拋物線完整播放）
  var halfW = C.SPRITE_DRAW / 2;
  var chAct = ColorCatCharacter.state.action;
  if (chAct !== 'knockback' && chAct !== 'combo' && chAct !== 'jumpOff' && ColorCatCharacter.state.x > ew - halfW) {
    ColorCatCharacter.state.x = ew - halfW;
    // 避免在邊界原地踏步：攔截向右移動的動作（combo 自行管理位置，不攔截）
    if (ColorCatCharacter.state.facing === 1 &&
        chAct !== 'idle' && chAct !== 'sleeping' && chAct !== 'weak' &&
        chAct !== 'jumpOff' && chAct !== 'test' && chAct !== 'combo') {
      if (chAct === 'biteBall') ColorCatBall.setCarried(false);
      ColorCatCharacter.state.action = 'idle';
      ColorCatCharacter.state.facing = -1;
      ColorCatCharacter.state.spriteFrame = 0;
      ColorCatCharacter.state.spriteTimer = 0;
    }
  }
  render();
}

// ===== 點擊處理 =====

function isSunMoonClicked(cx, cy) {
  var sx = _sw - 20, sy = 18;
  var dx = cx - sx, dy = cy - sy;
  return Math.sqrt(dx * dx + dy * dy) < 18;
}

function handleClick(e) {
  var rect = _canvas.getBoundingClientRect();
  var cx = e.clientX - rect.left;
  var cy = e.clientY - rect.top;

  // 面板攔截（優先處理）
  if (_.handlePanelClick(cx, cy, _sw)) return;

  // 點擊花朵 → 採集 +EXP
  if (_.handleFlowerClick(cx, cy)) return;

  // 點擊太陽/月亮 → 爬邊牆
  if (isSunMoonClicked(cx, cy)) {
    ColorCatCharacter.startComboWall(_sw);
    return;
  }

  // 點擊旗子 → 爬紙箱
  var boxTopY = _.BOX_BOTTOM_Y - _.BOX_H;
  if (_.isFlagClicked(cx, cy)) {
    ColorCatCharacter.startComboBox(_sw, _.BOX_X, boxTopY, _.BOX_W);
    return;
  }

  // 點擊紙箱 → 進去睡覺
  var openingX = _.BOX_X + _.BOX_W / 2 + 12;
  if (_.isBoxClicked(cx, cy)) {
    if (ColorCatCharacter.isSleeping()) {
      ColorCatCharacter.wakeUp(openingX);
    } else {
      ColorCatCharacter.startGoToBox(openingX);
    }
    return;
  }

  // 點擊角色
  if (ColorCatCharacter.isClicked(cx, cy)) {
    ColorCatCharacter.tap(_sw);
    return;
  }

  // 點擊球
  if (ColorCatBall.isClicked(cx, cy)) {
    ColorCatCharacter.startChase();
  }
}

// ===== 初始化（互動版，含球+角色） =====

function initInteractiveScene(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  destroy();
  container.innerHTML = '';

  _dpr = window.devicePixelRatio || 1;
  _canvas = document.createElement('canvas');
  _sw = container.offsetWidth || 300;
  _canvas.width = _sw * _dpr;
  _canvas.height = C.SCENE_H * _dpr;
  _canvas.style.cssText = 'width:100%;height:' + C.SCENE_H + 'px;display:block;cursor:pointer;image-rendering:pixelated;';
  container.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
  _ctx.scale(_dpr, _dpr);

  _.BOX_BOTTOM_Y = C.CHAR_GROUND_Y - 6;
  _.FLAG_POLE_X = _.BOX_X - _.BOX_W / 4;
  _.FLAG_POLE_TOP = _.BOX_BOTTOM_Y - _.BOX_H - _.FLAG_POLE_H;

  ColorCatCharacter.init(_sw);
  ColorCatBall.init(_sw);

  // 提供場景資訊給角色 AI
  ColorCatCharacter.setSceneInfo({
    sw: _sw,
    boxX: _.BOX_X,
    boxTopY: _.BOX_BOTTOM_Y - _.BOX_H,
    boxW: _.BOX_W,
    openingX: _.BOX_X + _.BOX_W / 2 + 12,
  });

  _canvas.addEventListener('click', handleClick);

  // 視窗縮放
  var rt = null;
  window.addEventListener('resize', function() {
    clearTimeout(rt);
    rt = setTimeout(function() {
      _sw = container.offsetWidth || 300;
      _canvas.width = _sw * _dpr;
      _canvas.height = C.SCENE_H * _dpr;
      _ctx = _canvas.getContext('2d');
      _ctx.scale(_dpr, _dpr);
      ColorCatBall.state.x = Math.min(ColorCatBall.state.x, _sw - ColorCatBall.state.r);
      ColorCatCharacter.state.x = Math.min(ColorCatCharacter.state.x, _sw - 20);
    }, 150);
  });

  // 主題變更
  var _observer = new MutationObserver(function() {});
  _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  container._fcObserver = _observer;

  // 30fps 主迴圈
  _sceneInterval = setInterval(update, 33);
}

// ===== 初始化（靜態版，僅背景，用於正式版尚未開放互動時） =====

function initStaticScene(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  destroy();
  container.innerHTML = '';

  var dpr = window.devicePixelRatio || 1;
  var canvas = document.createElement('canvas');
  var cw = container.offsetWidth || 300;
  canvas.width = cw * dpr;
  canvas.height = C.SCENE_H * dpr;
  canvas.style.cssText = 'width:100%;height:' + C.SCENE_H + 'px;border-radius:var(--radius-sm);image-rendering:pixelated;display:block;';
  container.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  function renderStatic() {
    var light = !C.isThemeDark();
    _.drawBackground(ctx, cw, light);

    // "Coming soon." 文字
    var textY = (C.GROUND_Y + 6) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = light ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    ctx.font = '800 20px "Noto Sans TC", "SF Pro Display", -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = light ? 'rgba(30,60,40,0.82)' : 'rgba(255,255,255,0.78)';
    ctx.fillText('Coming soon.', cw / 2, textY - 4);
    ctx.shadowColor = 'transparent';
    ctx.font = '500 10px "Noto Sans TC", "SF Pro Display", -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = light ? 'rgba(30,60,40,0.6)' : 'rgba(255,255,255,0.45)';
    ctx.fillText('\u2500\u2500  \u656C\u8ACB\u671F\u5F85  \u2500\u2500', cw / 2, textY + 20);
    ctx.restore();
  }

  renderStatic();

  var _observer = new MutationObserver(function() { renderStatic(); });
  _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  var _resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      cw = container.offsetWidth || 300;
      canvas.width = cw * dpr;
      canvas.height = C.SCENE_H * dpr;
      ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      renderStatic();
    }, 150);
  });

  container._fcObserver = _observer;
}

// ===== 清理 =====

function destroy() {
  if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
  var el = document.getElementById('profile-slot-banner');
  if (el) {
    if (el._fcObserver) { el._fcObserver.disconnect(); el._fcObserver = null; }
    el.innerHTML = '';
  }
}

// ===== App 掛載 =====

if (typeof App !== 'undefined') {
  Object.assign(App, {
    _initProfileScene: function() { initStaticScene('profile-slot-banner'); },
    _destroyProfileScene: function() { destroy(); },
  });
}

window.ColorCatScene = {
  initInteractive: initInteractiveScene,
  initStatic: initStaticScene,
  destroy: destroy,
  init: initStaticScene,
  // TODO: 正式版由後台設定觸發長花，此 API 供外部（測試工具列 / 後台排程）呼叫
  addFlower: function() { _.addFlower(_sw); },
  _: _,
};

})();
