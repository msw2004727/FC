/* ================================================
   ColorCat — 場景核心（共享狀態、主迴圈、初始化、點擊、App 掛載）
   子模組透過 ColorCatScene._ 存取共享狀態並註冊函式
   依賴：color-cat-config.js, color-cat-ball.js, color-cat-character.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _sceneInterval = null;
var _canvas, _ctx, _sw, _sh, _dpr;
var _container = null;
var _containerId = null;
var _isLandscape = false;
var _forcedPortrait = false;   // 使用者按返回按鈕後鎖定直放，直到實際翻回直放再解除
var _returnBtn = null;
var _profileUnlocked = false;  // 密碼解鎖後記住，避免切頁回來被重置

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
// 天氣系統插槽（由 scene-weather.js 填入）
_.initWeather = function() {};
_.updateWeather = function() {};
_.drawWeather = function() {};
_.exportWeather = function() { return null; };
_.getWeatherType = function() { return 'clear'; };
// 重新整理按鈕插槽（由 scene-bg.js 填入）
_.drawRefreshBtn = function() {};
_.isRefreshBtnClicked = function() { return false; };
// 雜草系統插槽（由 scene-grass.js 填入）
_.updateGrass = function() {};
_.drawGrass = function() {};
_.drawWeedBtn = function() {};
_.isWeedBtnClicked = function() { return false; };
_.exportGrass = function() { return []; };
_.importGrass = function() {};
_.startWeeding = function() {};
_.isWeeding = function() { return false; };
_.catchUpGrass = function() {};
_.getGrassCount = function() { return 0; };

// ===== 主迴圈 =====

function render() {
  var light = !C.isThemeDark();
  var sleeping = ColorCatCharacter.isSleeping();
  _.drawBackground(_ctx, _sw, light);
  _.drawSkyEvents(_ctx, light);
  _.drawWeather(_ctx, _sw, light);
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
  _.drawGrass(_ctx, light);
  _.drawFog(_ctx, _sw);
  _.drawPanel(_ctx, _sw, light);
}

function update() {
  _.updateFlowers(_sw);
  _.updateGraves();
  _.updateWeather(_sw);
  _.updateGrass(_sw);
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
  if (chAct !== 'knockback' && chAct !== 'combo' && chAct !== 'jumpOff' && chAct !== 'ultimate' && chAct !== 'dying' && chAct !== 'hurt' && chAct !== 'attackEnemy' && chAct !== 'attackGrave' && chAct !== 'runAway' && chAct !== 'returnPanting' && chAct !== 'weeding' && ColorCatCharacter.state.x > ew - halfW) {
    ColorCatCharacter.state.x = ew - halfW;
    // 避免在邊界原地踏步：攔截向右移動的動作（combo 自行管理位置，不攔截）
    if (ColorCatCharacter.state.facing === 1 &&
        chAct !== 'idle' && chAct !== 'sleeping' && chAct !== 'weak' &&
        chAct !== 'jumpOff' && chAct !== 'test' && chAct !== 'combo' &&
        chAct !== 'attackFlower' && chAct !== 'attackGrass' && chAct !== 'attackButterfly' && chAct !== 'ultimate' &&
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
  var sf = C.scaleFactor || 1;
  if (e.touches) return { x: (e.touches[0].clientX - rect.left) / sf, y: (e.touches[0].clientY - rect.top) / sf };
  return { x: (e.clientX - rect.left) / sf, y: (e.clientY - rect.top) / sf };
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
  var sf = C.scaleFactor || 1;
  var cx = (e.clientX - rect.left) / sf;
  var cy = (e.clientY - rect.top) / sf;

  // 鋤草按鈕（左上角，取代刷新按鈕）
  if (_.isWeedBtnClicked && _.isWeedBtnClicked(cx, cy) && !_.isWeeding()) {
    _.startWeeding(_sw);
    return;
  }

  // 面板攔截（優先處理）
  if (_.handlePanelClick(cx, cy, _sw)) return;

  // 點擊路標 → 角色跑出/跑回場景（優先於其他角色互動）
  if (_.isSignpostClicked && _.isSignpostClicked(cx, cy, _sw)) {
    var char_ = ColorCatCharacter._;
    if (char_.signpostAway) {
      ColorCatCharacter.startReturnPanting(_sw);
    } else {
      ColorCatCharacter.startRunAway(_sw);
    }
    return;
  }

  // 角色離場中 → 除路標、樹、面板外不回應任何點擊
  if (ColorCatCharacter._.signpostAway) {
    // 點擊樹 → 觸發/撤回濃霧（非角色互動，允許）
    if (_.isTreeClicked && _.isTreeClicked(cx, cy, _sw)) {
      if (_.toggleFog) _.toggleFog();
    }
    return;
  }

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

  // 點擊雜草 → 角色跑去攻擊雜草
  if (_.handleGrassClick) {
    var clickedGrass = _.handleGrassClick(cx, cy);
    if (clickedGrass) {
      ColorCatCharacter.startAttackGrass(clickedGrass);
      return;
    }
  }

  // 點擊樹 → 觸發/撤回濃霧
  if (_.isTreeClicked && _.isTreeClicked(cx, cy, _sw)) {
    if (_.toggleFog) _.toggleFog();
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

  // 點擊紙箱 → 查看統計 + 進去睡覺（有敵人時提示危險）
  var openingX = _.BOX_X + _.BOX_W / 2 + 12;
  if (_.isBoxClicked(cx, cy)) {
    if (ColorCatCharacter.isSleeping()) {
      ColorCatCharacter.wakeUp(openingX);
      return;
    }
    if (window.ColorCatEnemy && ColorCatEnemy.hasAlive()) {
      if (window.ColorCatStatsModal) ColorCatStatsModal.showDangerToast();
      return;
    }
    ColorCatCharacter.startGoToBox(openingX);
    ColorCatCharacter._.manualSleep = true;
    if (window.ColorCatStatsModal) ColorCatStatsModal.open();
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

// ===== 畫布尺寸 / 橫放偵測 / 縮放 =====

function _resizeCanvas() {
  if (!_canvas || !_container) return;
  var prevLandscape = _isLandscape;
  var physicalLandscape = window.innerWidth > window.innerHeight;
  // 使用者手動按返回 → 鎖定直放，直到實際翻回直放後再允許橫放
  if (_forcedPortrait) {
    if (!physicalLandscape) _forcedPortrait = false; // 翻回直放，解鎖
    _isLandscape = false;
  } else {
    _isLandscape = physicalLandscape;
  }
  _dpr = window.devicePixelRatio || 1;

  if (_isLandscape) {
    var actualW = window.innerWidth;
    var actualH = window.innerHeight;
    C.scaleFactor = actualW / 560;
    _sw = 560;
    _sh = actualH / C.scaleFactor;
    C.updateSceneSize(_sw, _sh);

    _canvas.width = actualW * _dpr;
    _canvas.height = actualH * _dpr;
    _canvas.style.cssText = 'width:' + actualW + 'px;height:' + actualH + 'px;display:block;cursor:pointer;image-rendering:pixelated;';
    _container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;max-width:none;border-radius:0;';
  } else {
    C.scaleFactor = 1;
    _sw = _container.parentElement ? _container.parentElement.offsetWidth : (_container.offsetWidth || 300);
    _sh = 127;
    C.updateSceneSize(_sw, _sh);

    _canvas.width = _sw * _dpr;
    _canvas.height = _sh * _dpr;
    _canvas.style.cssText = 'width:100%;height:' + _sh + 'px;display:block;cursor:pointer;image-rendering:pixelated;';
    _container.style.cssText = '';
  }

  _ctx = _canvas.getContext('2d');
  _ctx.setTransform(C.scaleFactor * _dpr, 0, 0, C.scaleFactor * _dpr, 0, 0);

  // 更新場景物件位置
  _.BOX_BOTTOM_Y = C.CHAR_GROUND_Y - 6;
  _.FLAG_POLE_TOP = _.BOX_BOTTOM_Y - _.BOX_H - _.FLAG_POLE_H;

  // 夾限角色和球位置
  ColorCatBall.state.x = Math.min(ColorCatBall.state.x, _sw - ColorCatBall.state.r);
  ColorCatBall.state.y = Math.min(ColorCatBall.state.y, C.CHAR_GROUND_Y - ColorCatBall.state.r);
  ColorCatCharacter.state.x = Math.min(ColorCatCharacter.state.x, _sw - 20);
  ColorCatCharacter.state.y = C.CHAR_GROUND_Y;

  // 更新角色 AI 場景資訊
  ColorCatCharacter.setSceneInfo({
    sw: _sw,
    boxX: _.BOX_X,
    boxTopY: _.BOX_BOTTOM_Y - _.BOX_H,
    boxW: _.BOX_W,
    openingX: _.BOX_X + _.BOX_W / 2 + 12,
  });

  // 橫放 UI：隱藏周圍元素、顯示返回按鈕
  _toggleLandscapeUI(_isLandscape);

  // 首次進入橫放時嘗試載入 2x 精靈圖
  if (_isLandscape && !prevLandscape && window.ColorCatSprite && !ColorCatSprite.has2x()) {
    ColorCatSprite.load2x(ColorCatSprite.getSkin());
  }
}

// ===== 橫放 UI 控制（Step 4） =====

function _toggleLandscapeUI(landscape) {
  // 隱藏 / 顯示工具列、標題、其他頁面元素
  var toolbars = document.querySelectorAll('.toolbar, h2');
  for (var i = 0; i < toolbars.length; i++) {
    toolbars[i].style.display = landscape ? 'none' : '';
  }

  // 在主站（profile 頁）隱藏導覽列和底部元素
  var navBar = document.querySelector('.bottom-nav');
  if (navBar) navBar.style.display = landscape ? 'none' : '';
  var header = document.querySelector('.header');
  if (header) header.style.display = landscape ? 'none' : '';

  // 返回按鈕
  if (landscape) {
    if (!_returnBtn) {
      _returnBtn = document.createElement('button');
      _returnBtn.textContent = '\u2716';
      _returnBtn.style.cssText = 'position:fixed;top:8px;right:12px;z-index:10000;width:32px;height:32px;border:none;border-radius:50%;background:rgba(0,0,0,0.45);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
      _returnBtn.onclick = function() {
        // 強制恢復直放模式，鎖定直到使用者實際翻回直放
        _isLandscape = false;
        _forcedPortrait = true;
        C.scaleFactor = 1;
        _sw = _container.parentElement ? _container.parentElement.offsetWidth : (_container.offsetWidth || 300);
        _sh = 127;
        C.updateSceneSize(_sw, _sh);
        _canvas.width = _sw * _dpr;
        _canvas.height = _sh * _dpr;
        _canvas.style.cssText = 'width:100%;height:' + _sh + 'px;display:block;cursor:pointer;image-rendering:pixelated;';
        _container.style.cssText = '';
        _ctx = _canvas.getContext('2d');
        _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
        _.BOX_BOTTOM_Y = C.CHAR_GROUND_Y - 6;
        _.FLAG_POLE_TOP = _.BOX_BOTTOM_Y - _.BOX_H - _.FLAG_POLE_H;
        ColorCatBall.state.x = Math.min(ColorCatBall.state.x, _sw - ColorCatBall.state.r);
        ColorCatCharacter.state.x = Math.min(ColorCatCharacter.state.x, _sw - 20);
        ColorCatCharacter.state.y = C.CHAR_GROUND_Y;
        ColorCatCharacter.setSceneInfo({ sw: _sw, boxX: _.BOX_X, boxTopY: _.BOX_BOTTOM_Y - _.BOX_H, boxW: _.BOX_W, openingX: _.BOX_X + _.BOX_W / 2 + 12 });
        _toggleLandscapeUI(false);
      };
      document.body.appendChild(_returnBtn);
    }
    _returnBtn.style.display = 'flex';
  } else {
    if (_returnBtn) _returnBtn.style.display = 'none';
  }
}

// ===== 初始化（互動版，含球+角色） =====

function initInteractiveScene(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  destroy();
  container.innerHTML = '';
  _container = container;
  _containerId = containerId;

  _dpr = window.devicePixelRatio || 1;
  _canvas = document.createElement('canvas');
  _sw = container.offsetWidth || 300;
  _sh = C.SCENE_H;
  _canvas.width = _sw * _dpr;
  _canvas.height = _sh * _dpr;
  _canvas.style.cssText = 'width:100%;height:' + _sh + 'px;display:block;cursor:pointer;image-rendering:pixelated;';
  container.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');
  _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);

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

  // 視窗縮放 / 橫放偵測
  var rt = null;
  window.addEventListener('resize', function() {
    clearTimeout(rt);
    rt = setTimeout(_resizeCanvas, 150);
  });

  // 主題變更
  var _observer = new MutationObserver(function() {});
  _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  container._fcObserver = _observer;

  // 天氣初始化（從 runtime 或預設）
  var weatherSaved = window.ColorCatStats && ColorCatStats.runtime.weather;
  _.initWeather(weatherSaved || null);

  // 雲端存檔系統初始化（含雙開偵測）
  if (window.ColorCatCloudSave) {
    var canStart = ColorCatCloudSave.init();
    if (!canStart) {
      // 雙開偵測觸發，場景不啟動
      if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
      return;
    }
    ColorCatCloudSave.loadFromCloud().then(function(data) {
      if (!data) return;
      // 還原角色數值
      if (window.ColorCatStats) ColorCatStats.loadFullSave(data);
      // 還原場景物件
      if (data.scene) {
        if (data.scene.flowers && _.importFlowers) _.importFlowers(data.scene.flowers);
        if (data.scene.ball && window.ColorCatBall) ColorCatBall.importState(data.scene.ball);
        if (data.scene.graves && _.importGraves) _.importGraves(data.scene.graves);
        if (data.scene.grass && _.importGrass) _.importGrass(data.scene.grass);
        if (data.scene.weather) _.initWeather(data.scene.weather);
      }
      // 離線補長雜草（根據 savedAt 計算離線時間）
      if (_.catchUpGrass) {
        var savedMs = data.savedAt && data.savedAt.toMillis ? data.savedAt.toMillis() : (data.savedAt || 0);
        if (savedMs > 0) _.catchUpGrass(Date.now() - savedMs, _sw);
      }
      // 還原角色皮膚
      if (data.character && data.character.skin && window.ColorCatCharacter) {
        ColorCatCharacter.switchSkin(data.character.skin);
      }
      // 同步 MBTI
      if (data.character && data.character.mbti && window.ColorCatProfile) {
        ColorCatProfile.setMBTI(data.character.mbti);
      }
      console.log('[Scene] cloud save restored, flowers:', data.scene ? (data.scene.flowers || []).length : 0);
    }).catch(function(e) { console.warn('[Scene] cloud load error:', e); });
  }

  // 30fps 主迴圈
  _sceneInterval = setInterval(update, 33);
}

// ===== 初始化（靜態版，僅背景，用於正式版尚未開放互動時） =====

// 靜態星星（個人頁用，不動畫）
var _staticStars = (function() {
  var arr = [];
  for (var i = 0; i < 30; i++) {
    arr.push({ xr: Math.random(), y: 3 + Math.random() * 52, r: 0.3 + Math.random() * 0.7, a: 0.3 + Math.random() * 0.5 });
  }
  return arr;
})();

function _drawStaticBg(ctx, cw, light) {
  var grad = ctx.createLinearGradient(0, 0, 0, C.SCENE_H);
  if (light) {
    grad.addColorStop(0, '#87CEEB'); grad.addColorStop(0.7, '#B0E0F0'); grad.addColorStop(1, '#4CAF50');
  } else {
    grad.addColorStop(0, '#0a1628'); grad.addColorStop(0.7, '#0f2035'); grad.addColorStop(1, '#1a3a1a');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, C.SCENE_H);
  // 星星（夜間）
  if (!light) {
    for (var si = 0; si < _staticStars.length; si++) {
      var s = _staticStars[si];
      ctx.fillStyle = 'rgba(255,255,255,' + s.a + ')';
      ctx.beginPath(); ctx.arc(s.xr * cw, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }
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
  } else {
    ctx.save();
    ctx.fillStyle = '#F5E6B8';
    ctx.beginPath(); ctx.arc(cw - 20, 18, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a1628';
    ctx.beginPath(); ctx.arc(cw - 16, 16, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function _drawKey(ctx, cx, cy, light) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = light ? 'rgba(255,215,0,0.6)' : 'rgba(255,220,80,0.5)';
  ctx.shadowBlur = 4;
  var grad = ctx.createLinearGradient(cx - 4, cy - 1, cx + 4, cy + 14);
  grad.addColorStop(0, light ? '#e8c840' : '#f0d060');
  grad.addColorStop(0.45, light ? '#f5e080' : '#ffe890');
  grad.addColorStop(1, light ? '#c8a020' : '#d4b040');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.2;
  // 鑰匙圈（圓頭）
  ctx.beginPath(); ctx.arc(cx, cy - 1.4, 4.7, 0, Math.PI * 2); ctx.stroke();
  // 鑰匙桿
  ctx.beginPath(); ctx.moveTo(cx, cy + 2.8); ctx.lineTo(cx, cy + 12.2); ctx.stroke();
  // 鑰匙齒
  ctx.beginPath(); ctx.moveTo(cx, cy + 8.8); ctx.lineTo(cx + 3, cy + 8.8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy + 12.2); ctx.lineTo(cx + 3, cy + 12.2); ctx.stroke();
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

    // 鑰匙圖示（左上角，與右上角太陽/月亮對稱）
    _keyX = 20;
    _keyY = 12;
    _drawKey(ctx, _keyX, _keyY, light);
  }

  renderStatic();

  // 點擊鑰匙 → 輸入密碼解鎖互動模式
  canvas.addEventListener('click', function(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    if (Math.abs(cx - _keyX) < 16 && Math.abs(cy - _keyY - 5) < 16) {
      var pw = prompt('請輸入測試密碼');
      if (pw === '8888') {
        _profileUnlocked = true;
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

// ===== 重新整理（隨機換角色 + 重置場景） =====

function resetScene() {
  if (!_containerId) return;
  // 隨機選一隻不同的角色皮膚
  var C_ = window.ColorCatConfig;
  var skinKeys = Object.keys(C_.SKINS);
  var curSkin = ColorCatCharacter.getSkin();
  var candidates = skinKeys.filter(function(k) { return k !== curSkin; });
  var newSkin = candidates[Math.floor(Math.random() * candidates.length)];
  ColorCatCharacter.switchSkin(newSkin);
  // 隨機指派新 MBTI 人格
  if (window.ColorCatStats && ColorCatStats.randomizeMBTI) {
    ColorCatStats.randomizeMBTI();
  }
  // 清除敵人
  if (window.ColorCatEnemy) ColorCatEnemy.clearAll();
  // 重新初始化場景
  initInteractiveScene(_containerId);
}

// ===== 清理 =====

function destroy() {
  if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
  // 銷毀雲端存檔（觸發最後一次存檔）
  if (window.ColorCatCloudSave) ColorCatCloudSave.destroy();
  // 清除除草動畫狀態
  if (_.resetWeeding) _.resetWeeding();
  // 清理返回按鈕
  if (_returnBtn) { _returnBtn.remove(); _returnBtn = null; }
  // 恢復橫放 UI
  if (_isLandscape) _toggleLandscapeUI(false);
  _isLandscape = false;
  _forcedPortrait = false;
  C.scaleFactor = 1;
  C.updateSceneSize(560, 127);
  _container = null;
  var el = document.getElementById('profile-slot-banner');
  if (el) {
    if (el._fcObserver) { el._fcObserver.disconnect(); el._fcObserver = null; }
    el.innerHTML = '';
  }
}

// ===== App 掛載 =====

if (typeof App !== 'undefined') {
  Object.assign(App, {
    _initProfileScene: function() {
      if (_profileUnlocked) {
        initInteractiveScene('profile-slot-banner');
      } else {
        initStaticScene('profile-slot-banner');
      }
    },
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
