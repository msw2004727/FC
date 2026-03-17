/**
 * shot-game-loop.js — Game loop, input handling, physics step, scoring
 * Part of ShotGameEngine split. Loaded BEFORE shot-game-engine.js.
 */
(function () {
  var SGI = window._ShotGameInternal = window._ShotGameInternal || {};
  var clamp = SGI.clamp;
  var FIXED_DT = SGI.FIXED_DT;
  var BALL_RADIUS = SGI.BALL_RADIUS;
  var GOAL_Z = SGI.GOAL_Z;
  var GOAL_WIDTH = SGI.GOAL_WIDTH;
  var GOAL_HEIGHT = SGI.GOAL_HEIGHT;

  var PENALTY_SPOT_Z = SGI.PENALTY_SPOT_Z;
  var GOAL_MIN_X = SGI.GOAL_MIN_X;
  var GOAL_MAX_X = SGI.GOAL_MAX_X;
  var GOAL_BURST_CHANCE_PER_SEC = SGI.GOAL_BURST_CHANCE_PER_SEC;
  var GOAL_BURST_MIN_STEPS = SGI.GOAL_BURST_MIN_STEPS;
  var GOAL_BURST_MAX_STEPS = SGI.GOAL_BURST_MAX_STEPS;
  var GOAL_BURST_MIN_MULT = SGI.GOAL_BURST_MIN_MULT;
  var GOAL_BURST_MAX_MULT = SGI.GOAL_BURST_MAX_MULT;
  var STREAK_MILESTONES = SGI.STREAK_MILESTONES;
  var FULL_CHARGE_SHAKE_MULTIPLIER = SGI.FULL_CHARGE_SHAKE_MULTIPLIER;
  var CROSSHAIR_SHAKE_SCALE = SGI.CROSSHAIR_SHAKE_SCALE;
  var OVERCHARGE_CURVE_MULTIPLIER = SGI.OVERCHARGE_CURVE_MULTIPLIER;
  var TRAIL_FRAMES = SGI.TRAIL_FRAMES;
  var resolveMessageColor = SGI.resolveMessageColor;
  var resolveMessageBandBackground = SGI.resolveMessageBandBackground;
  var disposeScene = SGI.disposeScene;
  SGI.createGameLoop = function (ctx) {
    var container = ctx.container, ui = ctx.ui, onScoreChange = ctx.onScoreChange, onGameOver = ctx.onGameOver;
    var scene = ctx.scene, camera = ctx.camera, renderer = ctx.renderer, ball = ctx.ball;
    var goalGroup = ctx.goalGroup, zones = ctx.zones, zoneLabels = ctx.zoneLabels;
    var trailGeometry = ctx.trailGeometry, trailMaterial = ctx.trailMaterial, groundMat = ctx.groundMat;
    var messageBandEl = ctx.messageBandEl, createdMessageBand = ctx.createdMessageBand;
    var syncTheme = ctx.syncTheme, readThemeIsDark = ctx.readThemeIsDark;
    var disposeBillboardTexture = ctx.disposeBillboardTexture, setBillboardAdImage = ctx.setBillboardAdImage;
    var billboardAdImageUrl = ctx.billboardAdImageUrl, mq = ctx.mq, onMqChange = ctx.onMqChange;
    var isEngineDestroyed = ctx.isEngineDestroyed;

    var velocity = new THREE.Vector3();
    var spin     = new THREE.Vector3();
    var raycaster = new THREE.Raycaster();
    var pointer   = new THREE.Vector2();
    var clock     = new THREE.Clock();

    var score = 0; var streak = 0; var maxStreak = 0; var shots = 0;
    var AIM_START_X = 0; var AIM_START_Y = GOAL_HEIGHT / 2;
    var state = 'aiming'; var charging = false; var power = 0;
    var aim = { x: AIM_START_X, y: AIM_START_Y }; var startPointer = { x: 0, y: 0 };
    var crosshairShakePx = { x: 0, y: 0 };
    var sessionStartedAt = Date.now(); var resultTimer = null; var flashTimer = null; var rafId = 0;
    var accumulator = 0; var flightTime = 0; var apex = BALL_RADIUS; var lastBallZ = PENALTY_SPOT_Z;
    var goalSpeed = 2.9; var goalDir = 1; var goalSpeedMult = 1.0; var curveBoost = 1;
    var goalBurstSteps = 0; var goalBurstMult = 1.0; var goalBurstDir = 1;
    var trailCount = 0;
    var resolveGoalFrameCollision = SGI.createGoalFrameCollisionResolver();
    var powerBarTopWorldPoint = new THREE.Vector3(); var powerBarBottomWorldPoint = new THREE.Vector3();
    var powerBarLegacyBottomPx = 74; var powerBarHeightPx = 20;

    function triggerScreenFlash() {
      container.classList.remove('flash-hit'); void container.offsetWidth; container.classList.add('flash-hit');
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { container.classList.remove('flash-hit'); flashTimer = null; }, 180);
    }
    function setMessage(text, color) {
      if (!ui.messageEl) return;
      ui.messageEl.textContent = text; ui.messageEl.style.color = resolveMessageColor(color, readThemeIsDark);
      ui.messageEl.style.opacity = text ? '1' : '0';
      if (messageBandEl) { messageBandEl.style.opacity = text ? '1' : '0'; messageBandEl.style.background = resolveMessageBandBackground(readThemeIsDark()); }
    }
    function tryShowMilestoneMessage() { if (!STREAK_MILESTONES.has(streak)) return false; setMessage('\uD83D\uDD25 \u00D7' + streak + ' \u9023\u9032\uFF01', '#ffd166'); triggerScreenFlash(); return true; }
    function refreshHud() { if (ui.scoreEl) ui.scoreEl.textContent = '\u5206\u6578\uFF1A' + score; if (ui.streakEl) ui.streakEl.textContent = '\u9023\u9032\uFF1A' + streak; if (onScoreChange) onScoreChange({ score: score, streak: streak, shots: shots, state: state }); }
    function parseCssPixel(value, fallback) { var parsed = parseFloat(value); return Number.isFinite(parsed) ? parsed : fallback; }
    function refreshPowerBarMetrics() {
      if (!ui.powerBarEl || typeof window.getComputedStyle !== 'function') return;
      var prevTop = ui.powerBarEl.style.top; var prevBottom = ui.powerBarEl.style.bottom;
      ui.powerBarEl.style.top = ''; ui.powerBarEl.style.bottom = '';
      var computed = window.getComputedStyle(ui.powerBarEl);
      powerBarLegacyBottomPx = parseCssPixel(computed.bottom, powerBarLegacyBottomPx); powerBarHeightPx = parseCssPixel(computed.height, powerBarHeightPx);
      ui.powerBarEl.style.top = prevTop; ui.powerBarEl.style.bottom = prevBottom;
    }
    function projectWorldY(worldPoint) { var projected = worldPoint.project(camera); return (-projected.y * 0.5 + 0.5) * container.clientHeight; }
    function updatePowerBarPosition() {
      if (!ui.powerBarEl || container.clientHeight <= 0) return;
      powerBarTopWorldPoint.copy(ball.position); powerBarTopWorldPoint.y += BALL_RADIUS;
      powerBarBottomWorldPoint.copy(ball.position); powerBarBottomWorldPoint.y -= BALL_RADIUS;
      var ballTopY = projectWorldY(powerBarTopWorldPoint); var ballBottomY = projectWorldY(powerBarBottomWorldPoint);
      var legacyBarTopY = container.clientHeight - powerBarLegacyBottomPx - powerBarHeightPx;
      var legacyGapPx = Math.max(0, legacyBarTopY - ballBottomY);
      var maxTopPx = Math.max(8, container.clientHeight - powerBarHeightPx - 8);
      var nextTopPx = clamp(ballTopY - legacyGapPx - powerBarHeightPx, 8, maxTopPx);
      ui.powerBarEl.style.top = nextTopPx + 'px'; ui.powerBarEl.style.bottom = 'auto';
    }
    function setChargeUiVisible(visible) {
      if (ui.powerBarEl) { ui.powerBarEl.style.display = visible ? 'block' : 'none'; if (visible) { refreshPowerBarMetrics(); updatePowerBarPosition(); } else { ui.powerBarEl.style.top = ''; ui.powerBarEl.style.bottom = ''; } }
      if (ui.crosshairEl) ui.crosshairEl.style.display = visible ? 'block' : 'none';
    }
    function updateCrosshair() {
      if (!ui.crosshairEl) return;
      var marker = new THREE.Vector3(aim.x, aim.y, GOAL_Z); marker.project(camera);
      ui.crosshairEl.style.left = ((marker.x * 0.5 + 0.5) * container.clientWidth) + 'px';
      ui.crosshairEl.style.top  = ((-marker.y * 0.5 + 0.5) * container.clientHeight) + 'px';
    }
    function resolveShotAimAtRelease() {
      if (!ui.crosshairEl) return { x: aim.x, y: aim.y };
      var w = Math.max(1, container.clientWidth); var h = Math.max(1, container.clientHeight);
      var marker = new THREE.Vector3(aim.x, aim.y, GOAL_Z); marker.project(camera);
      var baseX = (marker.x * 0.5 + 0.5) * w; var baseY = (-marker.y * 0.5 + 0.5) * h;
      var screenX = baseX + crosshairShakePx.x; var screenY = baseY + crosshairShakePx.y;
      var ndcX = (screenX / w) * 2 - 1; var ndcY = -((screenY / h) * 2 - 1);
      var worldPoint = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      var rayDir = worldPoint.sub(camera.position).normalize();
      if (Math.abs(rayDir.z) < 1e-6) return { x: aim.x, y: aim.y };
      var t = (GOAL_Z - camera.position.z) / rayDir.z;
      if (!Number.isFinite(t) || t <= 0) return { x: aim.x, y: aim.y };
      return { x: clamp(camera.position.x + rayDir.x * t, -18, 18), y: clamp(camera.position.y + rayDir.y * t, -3, 12) };
    }
    function clearTrail() { trailCount = 0; trailGeometry.setDrawRange(0, 0); trailGeometry.attributes.position.needsUpdate = true; trailGeometry.attributes.aAlpha.needsUpdate = true; }
    function pushTrailPoint(position) {
      var posArr = trailGeometry.attributes.position.array; var alphaArr = trailGeometry.attributes.aAlpha.array;
      if (trailCount < TRAIL_FRAMES) { var base = trailCount * 3; posArr[base] = position.x; posArr[base + 1] = position.y; posArr[base + 2] = position.z; trailCount += 1; }
      else { for (var i = 0; i < (TRAIL_FRAMES - 1) * 3; i += 1) posArr[i] = posArr[i + 3]; var base2 = (TRAIL_FRAMES - 1) * 3; posArr[base2] = position.x; posArr[base2 + 1] = position.y; posArr[base2 + 2] = position.z; }
      var denom = Math.max(1, trailCount - 1);
      for (var j = 0; j < trailCount; j += 1) alphaArr[j] = trailCount === 1 ? 1 : (j / denom);
      trailGeometry.setDrawRange(0, trailCount); trailGeometry.attributes.position.needsUpdate = true; trailGeometry.attributes.aAlpha.needsUpdate = true;
    }
    function resize() {
      var w = Math.max(1, container.clientWidth); var h = Math.max(1, container.clientHeight);
      camera.aspect = w / h; camera.fov = w < h ? 72 : 62; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      updateCrosshair(); refreshPowerBarMetrics();
      if (ui.powerBarEl && ui.powerBarEl.style.display === 'block') updatePowerBarPosition();
    }
    function resetShot() {
      if (resultTimer) clearTimeout(resultTimer);
      state = 'aiming'; charging = false; power = 0; crosshairShakePx = { x: 0, y: 0 };
      velocity.set(0, 0, 0); spin.set(0, 0, 0); curveBoost = 1;
      ball.position.set(0, BALL_RADIUS, PENALTY_SPOT_Z); lastBallZ = ball.position.z; clearTrail();
      if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; } container.classList.remove('flash-hit');
      if (ui.powerFillEl) ui.powerFillEl.style.width = '0%'; setChargeUiVisible(false);
      if (!ui.restartBtn || ui.restartBtn.style.display !== 'block') setMessage('', '#ffffff');
    }
    function endGame() {
      state = 'gameover'; charging = false; setChargeUiVisible(false);
      if (ui.restartBtn) ui.restartBtn.style.display = 'block';
      setMessage('\u904A\u6232\u7D50\u675F  \u5206\u6578 ' + score, '#ffd54f');
      if (onGameOver) onGameOver({ score: score, streak: maxStreak, bestStreak: maxStreak, shots: shots, durationMs: Date.now() - sessionStartedAt, endedAt: new Date().toISOString() });
    }
    function processGoalHit() {
      var x = ball.position.x - goalGroup.position.x; var y = ball.position.y;
      if (x < -GOAL_WIDTH / 2 + BALL_RADIUS || x > GOAL_WIDTH / 2 - BALL_RADIUS) return false;
      if (y < BALL_RADIUS || y > GOAL_HEIGHT - BALL_RADIUS) return false;
      var zoneHit = zones[4];
      for (var i = 0; i < zones.length; i += 1) { var z = zones[i]; if (x >= z.minX && x <= z.maxX && y >= z.minY && y <= z.maxY) { zoneHit = z; break; } }
      var styleBoost = clamp(Math.round((apex - 2.4) * 2 + power / 16), 0, 20);
      var gained = zoneHit.points + styleBoost;
      streak += 1; score += gained; state = 'result'; maxStreak = Math.max(maxStreak, streak);
      goalSpeed = 2.9 + Math.min(streak, 30) * 0.4;
      zoneHit.mesh.material.opacity = 0.75;
      setTimeout(function () { zoneHit.mesh.material.opacity = 0.14; }, 180);
      if (!tryShowMilestoneMessage()) setMessage('+' + gained + '\uFF08' + zoneHit.points + '+' + styleBoost + ' \u83EF\u9E97\uFF09', '#80ff80');
      refreshHud(); resultTimer = setTimeout(resetShot, 1200); return true;
    }
    function kick() {
      state = 'flying'; charging = false; shots += 1; flightTime = 0; apex = ball.position.y;
      var p = clamp(power / 100, 0, 1.3); var isOvercharge = power > 100;
      var overchargeCurveMult = isOvercharge ? OVERCHARGE_CURVE_MULTIPLIER : 1;
      var shotAim = resolveShotAimAtRelease();
      var target = new THREE.Vector3(shotAim.x, shotAim.y, GOAL_Z);
      var dir = target.clone().sub(ball.position).normalize();
      var speed = 22 + p * 24; velocity.copy(dir.multiplyScalar(speed)); velocity.y += 3 + p * 10;
      var sideSign = Math.abs(shotAim.x) > 0.05 ? Math.sign(-shotAim.x) : (Math.random() < 0.5 ? -1 : 1);
      var sideSpinBase = -shotAim.x * (0.24 + p * 0.26) + sideSign * Math.max(0, p - 0.95) * 0.16;
      var sideSpin = sideSpinBase * overchargeCurveMult;
      var verticalSpin = 0.22 + p * 0.34 + Math.max(0, p - 0.9) * 0.42;
      curveBoost = 1 + p * 1.05 + Math.max(0, p - 0.9) * 1.8;
      if (isOvercharge) { var over = clamp((power - 100) / 30, 0, 1); velocity.x += (Math.random() - 0.5) * 12 * over; velocity.y += (Math.random() - 0.5) * 8 * over; curveBoost += (0.7 + over * 0.9) * overchargeCurveMult; setMessage('\u8D85\u91CF\u7206\u767C\uFF01', '#ff8a80'); }
      spin.set(verticalSpin, sideSpin, 0); setChargeUiVisible(false); clearTrail(); pushTrailPoint(ball.position); refreshHud();
    }
    function onPointerDown(event) {
      if (state !== 'aiming' || event.button !== 0) return; event.preventDefault();
      var rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.intersectObject(ball, true).length === 0) return;
      charging = true; power = 0; crosshairShakePx = { x: 0, y: 0 }; startPointer = { x: event.clientX, y: event.clientY };
      aim = { x: AIM_START_X, y: AIM_START_Y }; setChargeUiVisible(true); updateCrosshair();
      window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp); window.addEventListener('pointercancel', onPointerCancel);
    }
    function onPointerMove(event) {
      if (!charging) return; event.preventDefault();
      var rect = container.getBoundingClientRect();
      aim.x = clamp(((event.clientX - startPointer.x) / rect.width) * 30, -18, 18);
      aim.y = clamp(AIM_START_Y - ((event.clientY - startPointer.y) / rect.height) * 14, -3, 12); updateCrosshair();
    }
    function onContextMenu(event) { event.preventDefault(); }
    function cleanupWindowListeners() { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); window.removeEventListener('pointercancel', onPointerCancel); }
    function onPointerUp() { cleanupWindowListeners(); if (charging) kick(); }
    function onPointerCancel() { cleanupWindowListeners(); charging = false; power = 0; crosshairShakePx = { x: 0, y: 0 }; setChargeUiVisible(false); }
    function restartGame() {
      if (resultTimer) clearTimeout(resultTimer);
      score = 0; streak = 0; shots = 0; state = 'aiming'; maxStreak = 0; sessionStartedAt = Date.now();
      goalSpeed = 2.9; goalDir = 1; goalSpeedMult = 1.0; curveBoost = 1;
      goalBurstSteps = 0; goalBurstMult = 1.0; goalBurstDir = 1; goalGroup.position.x = 0;
      if (ui.restartBtn) ui.restartBtn.style.display = 'none';
      refreshHud(); resetShot(); setMessage('\u958B\u59CB\uFF01', '#ffffff');
    }
    function step(dt) {
      if (state !== 'gameover') {
        goalSpeedMult += (1 - goalSpeedMult) * 0.08 + (Math.random() - 0.5) * 0.25;
        goalSpeedMult = clamp(goalSpeedMult, 0.35, 1.65);
        if (goalBurstSteps <= 0 && Math.random() < GOAL_BURST_CHANCE_PER_SEC * dt) {
          goalBurstSteps = GOAL_BURST_MIN_STEPS + Math.floor(Math.random() * (GOAL_BURST_MAX_STEPS - GOAL_BURST_MIN_STEPS + 1));
          goalBurstMult = GOAL_BURST_MIN_MULT + Math.random() * (GOAL_BURST_MAX_MULT - GOAL_BURST_MIN_MULT);
          goalBurstDir = Math.random() < 0.5 ? -1 : 1;
        }
        if (Math.random() < 0.04 * dt * 60) goalDir = Math.random() < 0.5 ? 1 : -1;
        if (goalGroup.position.x <= GOAL_MIN_X + 0.01 && goalDir < 0) goalDir = 1;
        if (goalGroup.position.x >= GOAL_MAX_X - 0.01 && goalDir > 0) goalDir = -1;
        var moveMult = goalSpeedMult;
        if (goalBurstSteps > 0) { goalDir = goalBurstDir; moveMult *= goalBurstMult; goalBurstSteps -= 1; if (goalBurstSteps <= 0) goalBurstMult = 1.0; }
        goalGroup.position.x += goalDir * goalSpeed * moveMult * dt;
        if (goalGroup.position.x <= GOAL_MIN_X) { goalGroup.position.x = GOAL_MIN_X; goalDir = 1; if (goalBurstSteps > 0) goalBurstDir = 1; }
        else if (goalGroup.position.x >= GOAL_MAX_X) { goalGroup.position.x = GOAL_MAX_X; goalDir = -1; if (goalBurstSteps > 0) goalBurstDir = -1; }
      }
      if (state !== 'flying' && state !== 'result') return;
      flightTime += dt;
      var magnusFactor = 0.015 * clamp(curveBoost, 1, 3.8);
      var magnus = new THREE.Vector3().crossVectors(velocity, spin).multiplyScalar(magnusFactor * dt);
      velocity.add(magnus); velocity.y -= 25.8 * dt; velocity.multiplyScalar(0.997);
      curveBoost += (1 - curveBoost) * 0.028;
      ball.position.addScaledVector(velocity, dt);
      ball.rotation.x += (velocity.z * dt) / BALL_RADIUS; ball.rotation.y += spin.y * dt; ball.rotation.z -= (velocity.x * dt) / BALL_RADIUS;
      apex = Math.max(apex, ball.position.y);
      if (ball.position.y <= BALL_RADIUS) { ball.position.y = BALL_RADIUS; velocity.y *= -0.58; velocity.x *= 0.985; velocity.z *= 0.985; spin.multiplyScalar(0.9); }
      var hitGoalFrame = state === 'flying' ? resolveGoalFrameCollision(ball.position, velocity, spin, goalGroup.position.x) : false;
      if (state === 'flying' && !hitGoalFrame && lastBallZ > GOAL_Z && ball.position.z <= GOAL_Z && processGoalHit()) { velocity.multiplyScalar(0.28); velocity.z = Math.abs(velocity.z); }
      lastBallZ = ball.position.z; pushTrailPoint(ball.position);
      if (state === 'flying') {
        var stopped = velocity.length() < 1 && ball.position.y <= BALL_RADIUS + 0.04;
        var out = ball.position.z < -110 || Math.abs(ball.position.x) > 64 || flightTime > 6.5;
        if (stopped || out) { streak = 0; refreshHud(); state = 'result'; setMessage('\u672A\u9032\u7403\u2026', '#ff8a80'); resultTimer = setTimeout(endGame, 1300); }
      }
    }
    function animate() {
      rafId = requestAnimationFrame(animate);
      var frameDt = Math.min(clock.getDelta(), 0.1);
      if (charging) {
        power = clamp(power + frameDt * 68, 0, 130); var displayPower = Math.min(power, 100);
        if (ui.powerFillEl) { ui.powerFillEl.style.width = displayPower + '%'; ui.powerFillEl.style.background = power > 100 ? '#ef4444' : 'linear-gradient(90deg,#22c55e,#facc15)'; }
        updatePowerBarPosition();
        if (ui.crosshairEl) {
          var baseShake = power < 100 ? power * 0.4 : 40 + (power - 100) * 1.8;
          var amplified = power >= 100 ? baseShake * FULL_CHARGE_SHAKE_MULTIPLIER : baseShake;
          var shake = amplified * CROSSHAIR_SHAKE_SCALE;
          crosshairShakePx = { x: (Math.random() - 0.5) * shake, y: (Math.random() - 0.5) * shake };
          ui.crosshairEl.style.transform = 'translate(-50%, -50%) translate(' + crosshairShakePx.x + 'px, ' + crosshairShakePx.y + 'px)';
        }
      } else if (ui.crosshairEl) { crosshairShakePx = { x: 0, y: 0 }; ui.crosshairEl.style.transform = 'translate(-50%, -50%)'; }
      accumulator = Math.min(accumulator + frameDt, 0.25);
      while (accumulator >= FIXED_DT) { step(FIXED_DT); accumulator -= FIXED_DT; }
      syncTheme(); renderer.render(scene, camera);
    }

    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', resize);
    if (ui.restartBtn) ui.restartBtn.addEventListener('click', restartGame);
    resize(); restartGame(); animate();

    return {
      setBillboardAdImage: function (url) { var nextUrl = typeof url === 'string' ? url.trim() : ''; if (nextUrl === billboardAdImageUrl) return; setBillboardAdImage(nextUrl); },
      destroy: function () {
        isEngineDestroyed.value = true;
        if (resultTimer) clearTimeout(resultTimer); if (flashTimer) clearTimeout(flashTimer);
        container.classList.remove('flash-hit'); cancelAnimationFrame(rafId);
        if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onMqChange);
        container.removeEventListener('contextmenu', onContextMenu); container.removeEventListener('pointerdown', onPointerDown);
        cleanupWindowListeners(); window.removeEventListener('resize', resize);
        if (ui.restartBtn) ui.restartBtn.removeEventListener('click', restartGame);
        if (createdMessageBand && messageBandEl && messageBandEl.parentNode === container) container.removeChild(messageBandEl);
        disposeBillboardTexture(); disposeScene(scene); renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        if (renderer.domElement && renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      },
    };
  };
})();
