/* ================================================
   SportHub — Kickball Game Page Module (誰才是開球王)
   主站嵌入版開球遊戲，直接使用主站 auth / firebase
   Delegates to: kickball-helpers, kickball-leaderboard,
   kickball-renderer, kickball-physics, kickball-ui
   ================================================ */

(function () {
  var H = window._KickballHelpers;
  var LB = window._KickballLeaderboard;
  var REN = window._KickballRenderer;
  var PHY = window._KickballPhysics;
  var UI = window._KickballUI;

  /* ── Module State ── */
  var _animFrameId = null;
  var _gameInstance = null;
  var _eventsBound = false;

  /* ── Three.js Loading ── */
  var _threeLoadPromise = null;
  function _loadThreeJs() {
    if (window.THREE) return Promise.resolve();
    if (_threeLoadPromise) return _threeLoadPromise;
    _threeLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = H.THREE_CDN_URL;
      s.onload = resolve;
      s.onerror = function () { _threeLoadPromise = null; reject(new Error('Three.js load failed')); };
      document.head.appendChild(s);
    });
    return _threeLoadPromise;
  }

  /* ════════════════════════════════════════════════
     Embedded Game Engine
     ════════════════════════════════════════════════ */
  function _createGame(containerEl) {
    var THREE = window.THREE;
    // Game state context shared across modules
    var G = {
      containerEl: containerEl,
      scene: null, camera: null, renderer: null, ball: null, ground: null, dirLight: null,
      raycaster: null, mouse: null,
      gameState: 'aiming',
      aimTarget: { x: 0, y: 0 }, aimTime: 0, charging: false, power: 0, powerDir: 1,
      shotsLeft: 3, bestDistance: 0, currentDistance: 0, resultTimer: null,
      lastKickGrade: 'GOOD', distanceAtShotStart: 0, bonusDistance: 0, shotDistances: [],
      shotCameraHold: 0, cameraModeBlend: 1, landingCameraDamp: 0, timeScale: 1, slowMoTimer: 0, cameraShakeTimer: 0, cameraShakeStrength: 0,
      displayedDistance: 0, displayedSpeedKmh: 0, hasTriggeredLandingRing: false, hasKickedOnce: false,
      SPEED_DISPLAY_FACTOR: 1.45,
      ballRadius: 1.2,
      unitsPerMeter: (1.2 * 2.0) / 0.22,
      lastValidStart: new THREE.Vector3(0, 1.2, 0),
      velocity: new THREE.Vector3(), spin: new THREE.Vector3(),
      cameraLookTarget: new THREE.Vector3(), cameraDesiredPosition: new THREE.Vector3(),
      gravity: 24.0, airDrag: 0.9965, magnusScale: 0.0024, sideSpinAirDecay: 0.996, spinAirDecay: 0.9975, lateralFriction: 0.975,
      clock: new THREE.Clock(), FIXED_DT: 1 / 120, accumulator: 0,
      terrainBumps: [],
      windX: 0, windZ: 0, windStrength: 0, windAngle: 0,
      maxSpeedThisGame: 0, bestMaxSpeed: 0, gameStartTime: 0,
      destroyed: false,
      camYaw: 0, camPitch: 0, camZoom: 0,
      camDragging: false, camDragStartX: 0, camDragStartY: 0,
      camPinchDist: 0, camTouchCX: 0, camTouchCY: 0, camTouching: false,
      maxHeightThisKick: 0, displayedHeight: 0,
      _markerObjects: [],
      _restartCdTimer: null,
      _gameInstanceRef: null,
      // DOM refs (populated by _buildUI)
      msgEl: null, bestDistEl: null, bestSpeedEl: null, focusDistEl: null, focusHeightEl: null, focusSpeedEl: null,
      shotsLeftEl: null, windEl: null, restartBtn: null, restartInlineBtn: null, floatingUI: null,
      aimRadar: null, aimDot: null, powerWrap: null, powerFill: null, virtualBallEl: null,
      flashOverlay: null, impactRing: null, gradePop: null, shotTypePop: null, firstTipEl: null, shotLogEl: null,
    };

    function _buildUI() {
      UI.buildGameUI(containerEl, G);
      _bindUIEvents();
    }

    function _bindUIEvents() {
      G.restartBtn.addEventListener('click', function () { if (!G.restartBtn.disabled) PHY.resetGame(G); });
      G.restartInlineBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      G.restartInlineBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (!G.restartInlineBtn.disabled) PHY.resetGame(G); });
      var lbBtnInner = containerEl.querySelector('#kg-leaderboard-btn-inner');
      if (lbBtnInner) {
        lbBtnInner.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        lbBtnInner.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); LB.openLeaderboard(LB.lbPeriod); });
      }
      if (G.virtualBallEl) {
        G.virtualBallEl.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          if (G.gameState === 'aiming') {
            G.gameState = 'charging'; G.charging = true; G.power = 0; G.powerDir = 1;
            G.aimRadar.classList.add('locked'); G.powerWrap.style.display = 'block';
          }
        });
      }
      containerEl.addEventListener('pointerdown', function (e) { PHY.onPointerDown(G, e); });
      containerEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      window.addEventListener('pointerup', _onPointerUp);
      containerEl.addEventListener('mousedown', function (e) { if (e.button === 2) { G.camDragging = true; G.camDragStartX = e.clientX; G.camDragStartY = e.clientY; } });
      window.addEventListener('mousemove', _onCamMouseMove);
      window.addEventListener('mouseup', _onCamMouseUp);
      containerEl.addEventListener('wheel', _onCamWheel, { passive: false });
      containerEl.addEventListener('touchstart', _onCamTouchStart, { passive: false });
      containerEl.addEventListener('touchmove', _onCamTouchMove, { passive: false });
      containerEl.addEventListener('touchend', _onCamTouchEnd);
    }

    // Camera control handlers
    function _onPointerUp() { PHY.onPointerUp(G); }
    function _onCamMouseMove(e) { if (!G.camDragging || G.destroyed) return; G.camYaw += (e.clientX - G.camDragStartX) * 0.004; G.camPitch += (e.clientY - G.camDragStartY) * 0.003; G.camPitch = H.clamp(G.camPitch, -0.5, 0.8); G.camDragStartX = e.clientX; G.camDragStartY = e.clientY; }
    function _onCamMouseUp(e) { if (e.button === 2) G.camDragging = false; }
    function _onCamWheel(e) { if (G.destroyed) return; G.camZoom = H.clamp(G.camZoom + e.deltaY * 0.0008, -0.4, 0.5); e.preventDefault(); }
    function _onCamTouchStart(e) { if (e.touches.length >= 2) { e.preventDefault(); G.camTouching = true; var t0 = e.touches[0], t1 = e.touches[1]; G.camPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); G.camTouchCX = (t0.clientX + t1.clientX) / 2; G.camTouchCY = (t0.clientY + t1.clientY) / 2; } }
    function _onCamTouchMove(e) { if (e.touches.length >= 2) { e.preventDefault(); var t0 = e.touches[0], t1 = e.touches[1]; var d = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); var cx = (t0.clientX + t1.clientX) / 2, cy = (t0.clientY + t1.clientY) / 2; if (G.camPinchDist > 0) G.camZoom = H.clamp(G.camZoom - (d - G.camPinchDist) * 0.002, -0.4, 0.5); G.camYaw += (cx - G.camTouchCX) * 0.004; G.camPitch += (cy - G.camTouchCY) * 0.003; G.camPitch = H.clamp(G.camPitch, -0.5, 0.8); G.camPinchDist = d; G.camTouchCX = cx; G.camTouchCY = cy; } }
    function _onCamTouchEnd(e) { if (e.touches.length < 2) { G.camTouching = false; G.camPinchDist = 0; } }

    // Animation loop
    function animate() {
      if (G.destroyed) return;
      _animFrameId = requestAnimationFrame(animate);
      var rawDt = Math.min(G.clock.getDelta(), 0.05);
      if (G.slowMoTimer > 0) G.slowMoTimer = Math.max(0, G.slowMoTimer - rawDt);
      G.timeScale = G.slowMoTimer > 0 ? 0.55 : 1;
      if (G.cameraShakeTimer > 0) { G.cameraShakeTimer = Math.max(0, G.cameraShakeTimer - rawDt); G.cameraShakeStrength *= 0.9; } else { G.cameraShakeStrength = 0; }
      var dt = rawDt * G.timeScale;
      var cw = containerEl.offsetWidth, ch = containerEl.offsetHeight;
      var world = new THREE.Vector3(G.ball.position.x, G.ball.position.y + 2.5, G.ball.position.z).project(G.camera);
      G.floatingUI.style.left = ((world.x * 0.5 + 0.5) * cw) + 'px';
      G.floatingUI.style.top = ((-(world.y * 0.5) + 0.5) * ch) + 'px';
      var isActive = G.gameState === 'flying' || G.gameState === 'result' || G.gameState === 'gameover';
      G.floatingUI.style.opacity = isActive ? '0' : '1';
      if (G.virtualBallEl) { var show = G.gameState === 'aiming'; G.virtualBallEl.style.opacity = show ? '1' : '0'; G.virtualBallEl.style.pointerEvents = show ? 'auto' : 'none'; }
      if (G.firstTipEl && !G.hasKickedOnce) { G.firstTipEl.style.opacity = (G.gameState === 'aiming') ? '1' : '0'; }
      if (G.gameState === 'aiming') PHY.updateAim(G, dt);
      if (G.gameState === 'charging') PHY.updatePower(G, dt);
      if (G.gameState === 'flying' && G.shotCameraHold > 0) G.shotCameraHold = Math.max(0, G.shotCameraHold - rawDt);
      G.accumulator += dt;
      while (G.accumulator >= G.FIXED_DT) {
        if (G.gameState === 'flying') { PHY.applyPhysics(G, THREE, G.FIXED_DT); G.currentDistance = Math.max(0, -G.ball.position.z) / G.unitsPerMeter; }
        G.accumulator -= G.FIXED_DT;
      }
      G.displayedDistance += (G.currentDistance - G.displayedDistance) * 0.18;
      var currentSpeedKmh = (G.velocity.length() / G.unitsPerMeter) * 3.6 * G.SPEED_DISPLAY_FACTOR;
      G.displayedSpeedKmh += (currentSpeedKmh - G.displayedSpeedKmh) * 0.22;
      G.focusDistEl.textContent = (G.displayedDistance + G.bonusDistance).toFixed(2);
      G.displayedHeight += (G.maxHeightThisKick - G.displayedHeight) * 0.18;
      G.focusHeightEl.textContent = G.displayedHeight.toFixed(2);
      G.focusSpeedEl.textContent = G.displayedSpeedKmh.toFixed(2);
      if (!G.camDragging && !G.camTouching) {
        G.camYaw *= 0.93; G.camPitch *= 0.93; G.camZoom *= 0.93;
        if (Math.abs(G.camYaw) < 0.001) G.camYaw = 0;
        if (Math.abs(G.camPitch) < 0.001) G.camPitch = 0;
        if (Math.abs(G.camZoom) < 0.001) G.camZoom = 0;
      }
      PHY.updateCamera(G, THREE);
      G.renderer.render(G.scene, G.camera);
    }
    function _onResize() {
      if (G.destroyed || !G.renderer) return;
      G.camera.aspect = containerEl.offsetWidth / containerEl.offsetHeight;
      G.camera.updateProjectionMatrix();
      G.renderer.setSize(containerEl.offsetWidth, containerEl.offsetHeight);
    }

    // Init
    _buildUI();
    REN.initScene(G, THREE, containerEl);
    var instance = {
      destroy: function () {
        G.destroyed = true;
        if (G._restartCdTimer) clearInterval(G._restartCdTimer);
        if (_animFrameId) cancelAnimationFrame(_animFrameId);
        window.removeEventListener('pointerup', _onPointerUp);
        window.removeEventListener('mousemove', _onCamMouseMove);
        window.removeEventListener('mouseup', _onCamMouseUp);
        window.removeEventListener('resize', _onResize);
        if (G.resultTimer) clearTimeout(G.resultTimer);
        if (G.renderer) { G.renderer.dispose(); G.renderer.forceContextLoss(); }
        containerEl.textContent = '';
      },
      refreshMarkers: function () { REN.loadTop3Markers(G, THREE); }
    };
    G._gameInstanceRef = instance;
    REN.loadTop3Markers(G, THREE);
    G.gameStartTime = Date.now();
    PHY.resetGame(G);
    animate();
    window.addEventListener('resize', _onResize);
    return instance;
  }

  /* ── Event Binding ── */
  function _bindEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    var lbClose = document.getElementById('kg-leaderboard-close');
    if (lbClose) lbClose.addEventListener('click', LB.closeLeaderboard);
    var lbModal = document.getElementById('kg-leaderboard-modal');
    if (lbModal) lbModal.addEventListener('click', function (e) { if (e.target === lbModal) LB.closeLeaderboard(); });
    document.querySelectorAll('#kg-leaderboard-modal .kg-lb-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { LB.renderLeaderboard(tab.getAttribute('data-lb-period') || 'daily'); });
    });
    var introStart = document.getElementById('kg-intro-start');
    if (introStart) introStart.addEventListener('click', function () {
      var modal = document.getElementById('kg-intro-modal');
      var check = document.getElementById('kg-intro-dismiss');
      if (check && check.checked) H.suppressIntroToday();
      if (modal) modal.setAttribute('aria-hidden', 'true');
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && LB.lbOpen) LB.closeLeaderboard(); });
  }

  /* ── App Module Methods ── */
  Object.assign(App, {
    async initKickGamePage() {
      var currentUser = typeof auth !== 'undefined' ? auth.currentUser : null;
      var loginCard = document.getElementById('kg-login-required');
      var gameSection = document.getElementById('kg-game-section');
      var loadingEl = document.getElementById('kg-main-loading');

      if (!ModeManager.isDemo() && !currentUser) {
        if (loginCard) loginCard.style.display = 'none';
        if (gameSection) gameSection.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'none';
        this.showToast('\u8ACB\u5148\u56DE\u4E3B\u9801\u5B8C\u6210 LINE \u767B\u5165\uFF0C\u518D\u9032\u5165\u904A\u6232');
        this.showPage('page-home', { resetHistory: true });
        return;
      }

      if (loginCard) loginCard.style.display = 'none';
      if (loadingEl) loadingEl.style.display = '';
      if (gameSection) gameSection.style.display = 'none';

      var titleRow = document.querySelector('#page-kick-game .kg-page-title-row');
      if (titleRow) {
        var cfg = typeof ApiService !== 'undefined' && ApiService.getGameConfigByKey ? ApiService.getGameConfigByKey('kick-game') : null;
        var preset = Array.isArray(HOME_GAME_PRESETS) ? HOME_GAME_PRESETS.find(function(p) { return p && p.gameKey === 'kick-game'; }) : null;
        var title = (cfg && cfg.pageTitle) || (preset && preset.pageTitle) || titleRow.textContent;
        var vTag = titleRow.querySelector('#kg-version-tag');
        titleRow.textContent = title;
        if (vTag) titleRow.appendChild(vTag);
      }
      var vTagEl = document.getElementById('kg-version-tag');
      if (vTagEl) vTagEl.textContent = 'v' + (typeof CACHE_VERSION !== 'undefined' ? CACHE_VERSION : '');

      try {
        await _loadThreeJs();
      } catch (e) {
        if (loadingEl) loadingEl.textContent = '\u904A\u6232\u8F09\u5165\u5931\u6557\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\u518D\u8A66';
        return;
      }

      if (loadingEl) loadingEl.style.display = 'none';
      if (gameSection) gameSection.style.display = '';

      _bindEvents();

      var container = document.getElementById('kick-game-container');
      if (container) {
        if (_gameInstance) { _gameInstance.destroy(); _gameInstance = null; }
        _gameInstance = _createGame(container);
      }

      if (!H.isIntroSuppressed()) {
        var introModal = document.getElementById('kg-intro-modal');
        if (introModal) introModal.setAttribute('aria-hidden', 'false');
      }
    },

    destroyKickGamePage() {
      if (_gameInstance) { _gameInstance.destroy(); _gameInstance = null; }
      LB.closeLeaderboard();
      var introModal = document.getElementById('kg-intro-modal');
      if (introModal) introModal.setAttribute('aria-hidden', 'true');
    },
  });
})();
