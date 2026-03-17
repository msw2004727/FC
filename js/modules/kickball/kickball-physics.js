/* ================================================
   SportHub — Kickball Physics & Game Logic
   Ball physics, input, camera, game loop
   ================================================ */
window._KickballPhysics = (function () {
  var H = window._KickballHelpers;
  var LB = window._KickballLeaderboard;
  var R = window._KickballRenderer;
  var UI = window._KickballUI;

  /* ── Input ── */
  function onPointerDown(G, e) {
    if (e.button && e.button !== 0) return;
    var r = G.containerEl.getBoundingClientRect();
    G.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    G.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    G.raycaster.setFromCamera(G.mouse, G.camera);
    if (G.raycaster.intersectObject(G.ball).length && G.gameState === 'aiming') {
      G.gameState = 'charging'; G.charging = true; G.power = 0; G.powerDir = 1;
      G.aimRadar.classList.add('locked'); G.powerWrap.style.display = 'block';
    }
  }
  function onPointerUp(G) {
    if (!G.charging || G.destroyed) return;
    G.charging = false; G.gameState = 'flying';
    G.shotCameraHold = 0.45; G.cameraModeBlend = 1; G.landingCameraDamp = 0; G.hasTriggeredLandingRing = false;
    var powerDiff = Math.abs(G.power - 100), aimAcc = 1 - Math.min(1, Math.hypot(G.aimTarget.x, G.aimTarget.y) / 1.2), grade = 'GOOD';
    if (powerDiff <= 3 && aimAcc >= 0.68) grade = 'PERFECT';
    else if (powerDiff <= 8 && aimAcc >= 0.42) grade = 'GREAT';
    if (!G.hasKickedOnce) { G.hasKickedOnce = true; if (G.firstTipEl) G.firstTipEl.style.opacity = '0'; }
    G.lastKickGrade = grade; UI.triggerJuice(G, grade, G.power); kickBall(G);
    startRestartCooldown(G);
  }

  /* ── Game Logic ── */
  function initWind(G) {
    var tiers = [0, 2.5, 5.0, 8.0]; G.windStrength = tiers[Math.floor(Math.random() * 4)];
    G.windAngle = Math.random() * Math.PI * 2;
    G.windX = Math.sin(G.windAngle) * G.windStrength; G.windZ = -Math.cos(G.windAngle) * G.windStrength;
    if (G.windStrength === 0) { G.windEl.textContent = '\u7121\u98A8'; return; }
    var arrows = ['\u2191','\u2197','\u2192','\u2198','\u2193','\u2199','\u2190','\u2196'];
    var idx = Math.round(G.windAngle * 4 / Math.PI) & 7;
    var tl = ['\u7121','\u5FAE','\u4E2D','\u5F37'];
    G.windEl.textContent = arrows[idx] + ' ' + tl[tiers.indexOf(G.windStrength)] + '\u98A8';
  }
  function resetBallAndState(G) {
    G.velocity.set(0, 0, 0); G.spin.set(0, 0, 0);
    G.ball.position.copy(G.lastValidStart);
    G.ball.position.y = R.getTerrainHeightAt(G, G.ball.position.x, G.ball.position.z) + G.ballRadius;
    G.ball.rotation.set(0, 0, 0);
    G.camera.position.set(G.ball.position.x, 37.5, G.ball.position.z + 216);
    G.cameraLookTarget.set(G.ball.position.x, G.ball.position.y + 0.3, G.ball.position.z - 0.6);
    G.cameraDesiredPosition.copy(G.camera.position);
    G.gameState = 'aiming'; G.shotCameraHold = 0; G.cameraModeBlend = 1; G.landingCameraDamp = 0;
    G.timeScale = 1; G.slowMoTimer = 0; G.cameraShakeTimer = 0; G.cameraShakeStrength = 0;
    G.hasTriggeredLandingRing = false;
    G.displayedDistance = Math.max(0, -G.ball.position.z) / G.unitsPerMeter; G.displayedSpeedKmh = 0; G.maxHeightThisKick = 0; G.displayedHeight = 0;
    G.aimRadar.classList.remove('locked'); G.powerWrap.style.display = 'none'; G.powerFill.style.width = '0%';
    if (G.firstTipEl) G.firstTipEl.style.opacity = G.hasKickedOnce ? '0' : '1';
  }
  function startRestartCooldown(G) {
    var sec = 10;
    G.restartInlineBtn.disabled = true;
    G.restartInlineBtn.style.opacity = '0.45';
    G.restartInlineBtn.textContent = '\u91CD\u65B0\u958B\u59CB(' + sec + 's)';
    if (G._restartCdTimer) clearInterval(G._restartCdTimer);
    G._restartCdTimer = setInterval(function () {
      sec -= 1;
      if (sec <= 0) {
        clearInterval(G._restartCdTimer); G._restartCdTimer = null;
        G.restartInlineBtn.disabled = false;
        G.restartInlineBtn.style.opacity = '1';
        G.restartInlineBtn.textContent = '\u91CD\u65B0\u958B\u59CB';
      } else {
        G.restartInlineBtn.textContent = '\u91CD\u65B0\u958B\u59CB(' + sec + 's)';
      }
    }, 1000);
  }
  function stopRestartCooldown(G) {
    if (G._restartCdTimer) { clearInterval(G._restartCdTimer); G._restartCdTimer = null; }
    G.restartInlineBtn.disabled = false;
    G.restartInlineBtn.style.opacity = '1';
    G.restartInlineBtn.textContent = '\u91CD\u65B0\u958B\u59CB';
  }
  function resetGame(G) {
    startRestartCooldown(G);
    if (G.resultTimer) clearTimeout(G.resultTimer);
    G.shotsLeft = 3; G.currentDistance = 0; G.maxSpeedThisGame = 0; G.gameStartTime = Date.now();
    G.lastValidStart.set(0, G.ballRadius, 0);
    G.focusDistEl.textContent = '0.00';
    G.focusHeightEl.textContent = '0.00';
    G.focusSpeedEl.textContent = '0.00';
    G.shotsLeftEl.textContent = '3';
    G.restartBtn.style.display = 'none'; G.msgEl.style.opacity = '0';
    G.hasKickedOnce = false; G.bonusDistance = 0; G.lastKickGrade = 'GOOD'; G.distanceAtShotStart = 0;
    G.shotDistances = []; renderShotLog(G);
    initWind(G); R.generateTerrainBumps(G); resetBallAndState(G);
  }
  function renderShotLog(G) {
    if (!G.shotLogEl) return;
    if (G.shotDistances.length === 0) { G.shotLogEl.style.display = 'none'; return; }
    var nums = ['\u2460', '\u2461', '\u2462'];
    G.shotLogEl.textContent = '';
    G.shotDistances.forEach(function (d, i) {
      var div = document.createElement('div');
      div.textContent = nums[i] + ' ' + d.toFixed(1) + 'm';
      G.shotLogEl.appendChild(div);
    });
    G.shotLogEl.style.display = '';
  }
  function finishShot(G, gameInstanceRef) {
    var rawShotDist = (G.currentDistance + G.bonusDistance) - G.distanceAtShotStart;
    var mult = G.lastKickGrade === 'PERFECT' ? (1.06 + Math.random() * 0.06) : G.lastKickGrade === 'GREAT' ? (1.02 + Math.random() * 0.04) : 1.0;
    G.bonusDistance += rawShotDist * (mult - 1.0);
    G.shotDistances.push(rawShotDist * mult);
    renderShotLog(G);
    var totalDist = G.currentDistance + G.bonusDistance;
    G.shotsLeft -= 1;
    G.lastValidStart.set(0, G.ballRadius, G.ball.position.z);
    G.shotsLeftEl.textContent = String(G.shotsLeft);
    if (G.shotsLeft > 0) {
      var bonusStr = mult > 1.0 ? ' (+' + (rawShotDist * (mult - 1.0)).toFixed(1) + 'm ' + G.lastKickGrade + ')' : '';
      UI.showMessage(G, totalDist.toFixed(2) + 'm' + bonusStr, '#00ff88', 1800);
      G.resultTimer = setTimeout(function () { resetBallAndState(G); }, 1900);
    } else {
      G.gameState = 'gameover';
      var durationMs = Date.now() - G.gameStartTime;
      if (totalDist > G.bestDistance) {
        G.bestDistance = totalDist;
        if (G.maxSpeedThisGame > G.bestMaxSpeed) G.bestMaxSpeed = G.maxSpeedThisGame;
        G.bestDistEl.textContent = G.bestDistance.toFixed(2);
        G.bestSpeedEl.textContent = G.bestMaxSpeed.toFixed(2);
        UI.showMessage(G, '\uD83C\uDF89 \u65B0\u7D00\u9304 ' + totalDist.toFixed(2) + 'm', '#ffd700', 3000);
      } else {
        if (G.maxSpeedThisGame > G.bestMaxSpeed) {
          G.bestMaxSpeed = G.maxSpeedThisGame;
          G.bestSpeedEl.textContent = G.bestMaxSpeed.toFixed(2);
        }
        UI.showMessage(G, '\u7E3D\u8A08 ' + totalDist.toFixed(2) + 'm', '#ffffff', 3000);
      }
      G.restartBtn.style.display = 'inline-block';
      var payload = { distance: Math.round(totalDist * 100) / 100, maxSpeed: Math.round(G.maxSpeedThisGame * 100) / 100, kicks: 3, durationMs: durationMs };
      if (!LB.bestSession || payload.distance > LB.bestSession.distance) LB.bestSession = payload;
      LB.submitScore(payload, gameInstanceRef);
    }
  }
  function kickBall(G) {
    G.distanceAtShotStart = G.currentDistance + G.bonusDistance;
    var p = G.power / 100, cx = H.clamp(G.aimTarget.x, -0.9, 0.9), cy = H.clamp(G.aimTarget.y, -0.9, 0.9);
    var offCenter = Math.min(1, Math.hypot(cx, cy)), efficiency = 1 - offCenter * 0.06;
    var upperCZ = Math.max(0, cy) * (1 - Math.min(1, Math.abs(cx) / 0.42));
    var fwd = ((108 + p * 168) * efficiency + upperCZ * (16 + p * 24)) * 1.0625;
    if (cy < 0) { var t = Math.abs(cy); fwd *= Math.max(0, 1 - t * t * 1.1); }
    var vBase = 20.4 + p * 26.4, vContact = (-cy) * (44.8 + p * 76.8), ucLift = upperCZ * (9.6 + p * 14.4), latStart = cx * (5.95 + p * 11.05);
    var rng = 0.98 + Math.random() * 0.04;
    G.velocity.set(latStart * rng, (vBase + vContact + ucLift) * rng, -fwd * rng);
    G.spin.x = (-cy) * (30 + p * 70) + upperCZ * (-5 - p * 7); G.spin.y = cx * (48 + p * 105); G.spin.z = 0;
    var launchSpeedKmh = (G.velocity.length() / G.unitsPerMeter) * 3.6 * G.SPEED_DISPLAY_FACTOR;
    if (launchSpeedKmh > G.maxSpeedThisGame) G.maxSpeedThisGame = launchSpeedKmh;
    UI.showShotType(G, UI.classifyShotType(cx, cy, launchSpeedKmh));
    UI.showMessage(G, '\u51FA\u8173\uFF01 \u529B\u9053 ' + Math.round(G.power) + '%', '#00ff88', 1300);
  }

  /* ── Physics Step ── */
  function applyPhysics(G, THREE, dt) {
    var magnus = new THREE.Vector3().crossVectors(G.spin, G.velocity).multiplyScalar(G.magnusScale);
    G.velocity.addScaledVector(magnus, dt);
    if (G.ball.position.y > R.getTerrainHeightAt(G, G.ball.position.x, G.ball.position.z) + G.ballRadius + 0.1) {
      G.velocity.x += G.windX * dt; G.velocity.z += G.windZ * dt;
    }
    G.velocity.y -= G.gravity * dt;
    G.velocity.multiplyScalar(Math.pow(G.airDrag, dt * 60));
    G.spin.x *= Math.pow(G.spinAirDecay, dt * 60); G.spin.y *= Math.pow(G.sideSpinAirDecay, dt * 60);
    G.ball.position.addScaledVector(G.velocity, dt);
    G.ball.rotation.x += (G.velocity.z / G.ballRadius) * dt + G.spin.x * 0.012 * dt;
    G.ball.rotation.y += G.spin.y * 0.014 * dt; G.ball.rotation.z -= (G.velocity.x / G.ballRadius) * dt;
    var curSpeed = (G.velocity.length() / G.unitsPerMeter) * 3.6 * G.SPEED_DISPLAY_FACTOR;
    if (curSpeed > G.maxSpeedThisGame) G.maxSpeedThisGame = curSpeed;
    var curHeightM = Math.max(0, (G.ball.position.y - G.ballRadius) / G.unitsPerMeter);
    if (curHeightM > G.maxHeightThisKick) G.maxHeightThisKick = curHeightM;
    var terrainY = R.getTerrainHeightAt(G, G.ball.position.x, G.ball.position.z) + G.ballRadius;
    if (!G.hasTriggeredLandingRing && G.ball.position.y <= terrainY + 0.25 && G.velocity.length() > 4) {
      G.hasTriggeredLandingRing = true; UI.triggerImpactRing(G, G.ball.position.clone());
    }
    if (G.ball.position.y <= terrainY) {
      G.landingCameraDamp = 1; G.ball.position.y = terrainY;
      var sn = R.getTerrainNormalAt(G, THREE, G.ball.position.x, G.ball.position.z), vDotN = G.velocity.dot(sn);
      var backspin = Math.max(0, G.spin.x), topspin = Math.max(0, -G.spin.x);
      if (vDotN < 0) { var imp = Math.abs(vDotN), rest = imp > 1 ? H.clamp(0.48 + backspin * 0.0028 - topspin * 0.0036, 0.20, 0.60) : 0; G.velocity.addScaledVector(sn, -(1 + rest) * vDotN); }
      G.velocity.z *= H.clamp(0.9915 + topspin * 0.001 - backspin * 0.00018, 0.98, 0.9965);
      G.velocity.x *= G.lateralFriction; G.spin.x *= 0.91; G.spin.y *= 0.86;
      var vDotNA = G.velocity.dot(sn);
      if (vDotNA > 0 && vDotNA < 0.42) G.velocity.addScaledVector(sn, -vDotNA);
      if (vDotNA <= 0) { G.velocity.z *= 0.9945; G.velocity.x *= 0.975; }
      if (Math.hypot(G.velocity.x, G.velocity.z) < 0.30 && Math.abs(G.velocity.dot(sn)) < 0.30) {
        G.velocity.set(0, 0, 0); G.gameState = 'result'; finishShot(G, G._gameInstanceRef);
      }
    }
  }
  function updateAim(G, dt) {
    G.aimTime += dt; var speed = 4;
    if (G.shotsLeft === 3) speed *= 0.58; else if (G.shotsLeft === 1) speed *= 1.9;
    G.aimTarget.x = Math.sin(G.aimTime * 1.35 * speed) * 0.85;
    G.aimTarget.y = Math.cos(G.aimTime * 1.72 * speed) * 0.85;
    G.aimDot.style.left = ((G.aimTarget.x + 1) * 50) + '%';
    G.aimDot.style.top = ((-G.aimTarget.y + 1) * 50) + '%';
  }
  function updatePower(G, dt) {
    G.power += G.powerDir * dt * 115;
    if (G.power >= 100) { G.power = 100; G.powerDir = -1; }
    if (G.power <= 0) { G.power = 0; G.powerDir = 1; }
    G.powerFill.style.width = G.power + '%';
  }
  function updateCamera(G, THREE) {
    var nh = Math.min(1, Math.max(0, (G.ball.position.y - G.ballRadius) / 30));
    var terrainBaseY = R.getTerrainHeightAt(G, G.ball.position.x, G.ball.position.z) + G.ballRadius;
    G.cameraModeBlend = G.gameState === 'flying' ? Math.max(0, G.cameraModeBlend - 0.11) : 1;
    if (G.landingCameraDamp > 0 && G.gameState !== 'flying') G.landingCameraDamp = Math.max(0, G.landingCameraDamp - 0.045);
    var aCX = G.ball.position.x * 0.015, aCY = 11.25 + nh * 1.1, aCZ = G.ball.position.z + 64.8;
    var aLX = G.ball.position.x * 0.92, aLY = Math.max(G.ballRadius, G.ball.position.y + 11.5), aLZ = G.ball.position.z - 0.35;
    var fCX = G.ball.position.x, fCY = Math.max(25.8, G.ball.position.y + 21.6 + nh * 8.4), fCZ = G.ball.position.z + 90;
    var fLX = G.ball.position.x, fLY = Math.max(G.ballRadius, G.ball.position.y + 1.15 + nh * 1.4), fLZ = G.ball.position.z - 1.8;
    var b = G.cameraModeBlend, b2 = 1 - b;
    var dX = aCX * b + fCX * b2, dY = aCY * b + fCY * b2, dZ = aCZ * b + fCZ * b2;
    var dLX = aLX * b + fLX * b2, dLY = aLY * b + fLY * b2, dLZ = aLZ * b + fLZ * b2;
    var ngb = H.clamp(1 - ((G.ball.position.y - terrainBaseY) / 7.5), 0, 1);
    ngb = Math.max(ngb, G.landingCameraDamp * 0.85);
    if (G.gameState === 'aiming' || G.gameState === 'charging') ngb = 0;
    if (ngb > 0) { dY = dY * (1 - ngb) + (terrainBaseY + 19.2) * ngb; dZ = dZ * (1 - ngb) + (G.ball.position.z + 37.5) * ngb; dLY = dLY * (1 - ngb) + (terrainBaseY + 0.22) * ngb; dLZ = dLZ * (1 - ngb) + (G.ball.position.z - 0.18) * ngb; }
    G.cameraDesiredPosition.set(dX, dY, dZ);
    if (G.camYaw !== 0 || G.camPitch !== 0 || G.camZoom !== 0) {
      var lt = new THREE.Vector3(dLX, dLY, dLZ);
      var off = G.cameraDesiredPosition.clone().sub(lt);
      var cr = off.length() * (1 + G.camZoom);
      var cosYaw = Math.cos(G.camYaw), sinYaw = Math.sin(G.camYaw);
      var ox = off.x * cosYaw - off.z * sinYaw, oz = off.x * sinYaw + off.z * cosYaw;
      off.x = ox; off.z = oz;
      var hd = Math.sqrt(off.x * off.x + off.z * off.z);
      var cp = H.clamp(Math.atan2(off.y, hd) + G.camPitch, 0.05, 1.3);
      off.y = cr * Math.sin(cp);
      var hs = hd > 0.001 ? (cr * Math.cos(cp)) / hd : 0;
      off.x *= hs; off.z *= hs;
      G.cameraDesiredPosition.copy(lt).add(off);
    }
    G.camera.position.lerp(G.cameraDesiredPosition, G.gameState === 'aiming' ? 0.12 : 0.085);
    G.cameraLookTarget.lerp(new THREE.Vector3(dLX, dLY, dLZ), G.gameState === 'aiming' ? 0.14 : 0.1);
    G.camera.lookAt(G.cameraLookTarget);
    if (G.cameraShakeTimer > 0) {
      G.camera.position.x += (Math.random() - 0.5) * G.cameraShakeStrength;
      G.camera.position.y += (Math.random() - 0.5) * G.cameraShakeStrength * 0.45;
      G.camera.position.z += (Math.random() - 0.5) * G.cameraShakeStrength * 0.25;
    }
    G.dirLight.position.set(G.camera.position.x + 40, Math.max(70, G.camera.position.y + 45), G.camera.position.z + 35);
    G.dirLight.target.position.copy(G.ball.position); G.dirLight.target.updateMatrixWorld();
  }

  return {
    onPointerDown: onPointerDown,
    onPointerUp: onPointerUp,
    initWind: initWind,
    resetBallAndState: resetBallAndState,
    startRestartCooldown: startRestartCooldown,
    stopRestartCooldown: stopRestartCooldown,
    resetGame: resetGame,
    applyPhysics: applyPhysics,
    updateAim: updateAim,
    updatePower: updatePower,
    updateCamera: updateCamera,
  };
})();
