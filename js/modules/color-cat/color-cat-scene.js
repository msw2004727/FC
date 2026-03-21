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
_.handleFlowerClick = function() { return null; };
_.handleButterflyClick = function() { return null; };
_.addFlower = function() {};
_.handlePanelClick = function() { return false; };
_.updateSkyEvents = function() {};
_.drawSkyEvents = function() {};
_.addGrave = function() {};
_.drawGraves = function() {};
_.updateGraves = function() {};
_.getClickedGrave = function() { return -1; };
_.destroyGrave = function() {};
_.getGravePos = function() { return -1; };
// 濃霧效果插槽（由 scene-fog.js 填入）
_.updateFog = function() {};
_.drawFog = function() {};
_.toggleFog = function() {};

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
  if (window.ColorCatEnemy) ColorCatEnemy.drawBoxShadows(_ctx);
  _.drawFlag(_ctx, light);
  _.drawGraves(_ctx, light);
  if (window.ColorCatEnemy) ColorCatEnemy.draw(_ctx);
  if (window.ColorCatEnemy) ColorCatEnemy.drawProjectiles(_ctx);
  ColorCatCharacter.draw(_ctx, light);
  if (window.ColorCatDamageNumber) ColorCatDamageNumber.draw(_ctx);
  _.drawFog(_ctx, _sw);
  _.drawPanel(_ctx, _sw, light);
}

function update() {
  _.updateFlowers(_sw);
  _.updateGraves();
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
  // 大絕招蓄力計時
  var char_ = ColorCatCharacter._;
  if (char_.ultCharging) {
    char_.ultChargeTimer++;
    if (char_.ultChargeTimer >= char_.ultChargeDuration) {
      char_.ultCharging = false;
      char_.ultChargeTimer = 0;
      _ultBlockClick = true;
      ColorCatCharacter.startUltimate();
    }
  }
  if (window.ColorCatEnemy) { ColorCatEnemy.update(ew); ColorCatEnemy.updateProjectiles(ew); }
  if (window.ColorCatDamageNumber) ColorCatDamageNumber.update();
  _.updateFog(_sw);
  var kicked = ColorCatCharacter.update(ew, bs);
  if (kicked) {
    // 踢球時解除拖曳
    if (_ballDragging || ColorCatBall.isDragging()) {
      _ballDragging = false;
      ColorCatBall.releaseDrag();
    }
    ColorCatBall.kick(ColorCatCharacter.state.facing, _sw);
  }
  // 角色不超過面板邊界（knockback 飛行中不夾，讓拋物線完整播放）
  var halfW = C.SPRITE_DRAW / 2;
  var chAct = ColorCatCharacter.state.action;
  if (chAct !== 'knockback' && chAct !== 'combo' && chAct !== 'jumpOff' && chAct !== 'ultimate' && chAct !== 'dying' && chAct !== 'hurt' && chAct !== 'attackEnemy' && chAct !== 'attackGrave' && ColorCatCharacter.state.x > ew - halfW) {
    ColorCatCharacter.state.x = ew - halfW;
    // 避免在邊界原地踏步：攔截向右移動的動作（combo 自行管理位置，不攔截）
    if (ColorCatCharacter.state.facing === 1 &&
        chAct !== 'idle' && chAct !== 'sleeping' && chAct !== 'weak' &&
        chAct !== 'jumpOff' && chAct !== 'test' && chAct !== 'combo' &&
        chAct !== 'attackFlower' && chAct !== 'attackButterfly' && chAct !== 'ultimate' &&
        chAct !== 'dying' && chAct !== 'attackEnemy' && chAct !== 'attackGrave') {
      if (chAct === 'biteBall') ColorCatBall.setCarried(false);
      ColorCatCharacter.state.action = 'idle';
      ColorCatCharacter.state.facing = -1;
      ColorCatCharacter.state.spriteFrame = 0;
      ColorCatCharacter.state.spriteTimer = 0;
    }
  }
  render();
}

// ===== 長按蓄力（大絕招）+ 球拖曳 =====

var _ultBlockClick = false;
var _ballDragging = false;

function _getPointer(e) {
  var rect = _canvas.getBoundingClientRect();
  if (e.touches) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function handlePressStart(e) {
  var p = _getPointer(e);
  // 優先判定球拖曳
  if (ColorCatBall.isClicked(p.x, p.y)) {
    _ballDragging = true;
    ColorCatBall.setDragging(true);
    ColorCatBall.dragTo(p.x, p.y);
    ColorCatCharacter.startChase();
    return;
  }
  // 大絕招蓄力
  if (ColorCatCharacter.isClicked(p.x, p.y) && ColorCatCharacter.canUltimate()) {
    var char_ = ColorCatCharacter._;
    char_.ultCharging = true;
    char_.ultChargeTimer = 0;
  }
}

function handleDragMove(e) {
  if (!_ballDragging) return;
  if (e.cancelable) e.preventDefault();
  var p = _getPointer(e);
  ColorCatBall.dragTo(p.x, p.y);
}

function handlePressEnd() {
  if (_ballDragging) {
    _ballDragging = false;
    ColorCatBall.releaseDrag();
    _ultBlockClick = true; // 攔截此次 click
    return;
  }
  var char_ = ColorCatCharacter._;
  if (char_.ultCharging) {
    if (char_.ultChargeTimer > 10) _ultBlockClick = true;
    char_.ultCharging = false;
    char_.ultChargeTimer = 0;
  }
}

// ===== 點擊處理 =====

function isSunMoonClicked(cx, cy) {
  var sx = _sw - 20, sy = 18;
  var dx = cx - sx, dy = cy - sy;
  return Math.sqrt(dx * dx + dy * dy) < 18;
}

function handleClick(e) {
  // 大絕招蓄力完成 / 蓄力中斷 → 攔截此次 click
  if (_ultBlockClick) { _ultBlockClick = false; return; }

  var rect = _canvas.getBoundingClientRect();
  var cx = e.clientX - rect.left;
  var cy = e.clientY - rect.top;

  // 面板攔截（優先處理）
  if (_.handlePanelClick(cx, cy, _sw)) return;

  // 點擊蝴蝶 → 角色追擊蝴蝶
  if (_.handleButterflyClick) {
    var clickedB = _.handleButterflyClick(cx, cy);
    if (clickedB) {
      ColorCatCharacter.startAttackButterfly(clickedB);
      return;
    }
  }

  // 點擊花朵 → 角色跑去攻擊花朵
  var clickedFlower = _.handleFlowerClick(cx, cy);
  if (clickedFlower) {
    ColorCatCharacter.startAttackFlower(clickedFlower);
    return;
  }

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

  // 點擊墓地 → 角色跑去攻擊墓地
  var graveIdx = _.getClickedGrave(cx, cy);
  if (graveIdx >= 0) {
    ColorCatCharacter.startAttackGrave(graveIdx);
    return;
  }

  // 點擊敵人 → 角色跑去攻擊敵人
  if (window.ColorCatEnemy) {
    var enemyIdx = ColorCatEnemy.getClicked(cx, cy);
    if (enemyIdx >= 0) {
      ColorCatCharacter.startAttackEnemy(enemyIdx);
      return;
    }
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
  // 長按蓄力事件
  _canvas.addEventListener('mousedown', handlePressStart);
  _canvas.addEventListener('mouseup', handlePressEnd);
  _canvas.addEventListener('mouseleave', handlePressEnd);
  _canvas.addEventListener('touchstart', handlePressStart, { passive: true });
  _canvas.addEventListener('touchend', handlePressEnd);
  _canvas.addEventListener('touchcancel', handlePressEnd);
  _canvas.addEventListener('mousemove', handleDragMove);
  _canvas.addEventListener('touchmove', function(e) {
    if (_ballDragging || ColorCatCharacter._.ultCharging) e.preventDefault();
    handleDragMove(e);
  }, { passive: false });

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
      _canvas.style.width = _sw + 'px';
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

function _drawStaticBg(ctx, cw, light) {
  // 天空漸層（不畫山和樹）
  var grad = ctx.createLinearGradient(0, 0, 0, C.SCENE_H);
  if (light) {
    grad.addColorStop(0, '#87CEEB'); grad.addColorStop(0.7, '#B0E0F0'); grad.addColorStop(1, '#4CAF50');
  } else {
    grad.addColorStop(0, '#0a1628'); grad.addColorStop(0.7, '#0f2035'); grad.addColorStop(1, '#1a3a1a');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, C.SCENE_H);
  // 草地
  ctx.fillStyle = light ? '#4CAF50' : '#1a3a1a';
  ctx.fillRect(0, C.GROUND_Y, cw, C.SCENE_H - C.GROUND_Y);
  ctx.fillStyle = light ? '#388E3C' : '#153015';
  for (var gx = 0; gx < cw; gx += 6) ctx.fillRect(gx, C.GROUND_Y, 3, 2);
  // 太陽/月亮
  if (light) {
    ctx.save(); ctx.fillStyle = '#FDB813';
    ctx.beginPath(); ctx.arc(cw - 20, 18, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#FDB813'; ctx.lineWidth = 1.5;
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cw-20+Math.cos(a)*9, 18+Math.sin(a)*9);
      ctx.lineTo(cw-20+Math.cos(a)*13, 18+Math.sin(a)*13); ctx.stroke();
    }
    ctx.restore();
  }
}

function _drawKey(ctx, cx, cy, light) {
  ctx.save();
  ctx.strokeStyle = light ? 'rgba(180,140,60,0.7)' : 'rgba(220,190,100,0.6)';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  // 鑰匙圈（圓頭）
  ctx.beginPath(); ctx.arc(cx, cy - 4, 5, 0, Math.PI * 2); ctx.stroke();
  // 鑰匙桿
  ctx.beginPath(); ctx.moveTo(cx, cy + 1); ctx.lineTo(cx, cy + 12); ctx.stroke();
  // 鑰匙齒
  ctx.beginPath(); ctx.moveTo(cx, cy + 9); ctx.lineTo(cx + 3, cy + 9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + 12); ctx.lineTo(cx + 3, cy + 12); ctx.stroke();
  ctx.restore();
}

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
  canvas.style.cssText = 'width:100%;height:' + C.SCENE_H + 'px;border-radius:var(--radius-sm);image-rendering:pixelated;display:block;cursor:pointer;';
  container.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var _keyX, _keyY;

  function renderStatic() {
    var light = !C.isThemeDark();
    _drawStaticBg(ctx, cw, light);

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

    // 鑰匙圖示
    _keyX = cw / 2;
    _keyY = textY + 38;
    _drawKey(ctx, _keyX, _keyY, light);
  }

  renderStatic();

  // 點擊鑰匙 → 輸入密碼解鎖互動模式
  canvas.addEventListener('click', function(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    if (Math.abs(cx - _keyX) < 14 && Math.abs(cy - _keyY) < 18) {
      var pw = prompt('請輸入測試密碼');
      if (pw === '8888') {
        destroy();
        initInteractiveScene(containerId);
      }
    }
  });

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
