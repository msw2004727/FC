(function () {
  const FIXED_DT = 1 / 60;
  const BALL_RADIUS = 0.55;
  const GOAL_Z = -20;
  const GOAL_WIDTH = 14;
  const GOAL_HEIGHT = 7.2;
  const SCORE_MAP = [[100, 50, 100], [50, 20, 50], [40, 10, 40]];

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function disposeMaterial(material) {
    if (!material) return;
    Object.keys(material).forEach((k) => { const v = material[k]; if (v && typeof v.dispose === 'function') v.dispose(); });
    if (typeof material.dispose === 'function') material.dispose();
  }
  function disposeScene(scene) {
    scene.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (Array.isArray(node.material)) node.material.forEach(disposeMaterial);
      else disposeMaterial(node.material);
    });
  }
  function buildGoal(goalGroup) {
    const zones = [];
    const postRadius = 0.18;
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HEIGHT, 24);
    const crossGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_WIDTH + postRadius * 2, 24);
    const leftPost = new THREE.Mesh(postGeo, postMat);
    const rightPost = new THREE.Mesh(postGeo, postMat);
    const crossbar = new THREE.Mesh(crossGeo, postMat);
    leftPost.position.set(-GOAL_WIDTH / 2, GOAL_HEIGHT / 2, 0);
    rightPost.position.set(GOAL_WIDTH / 2, GOAL_HEIGHT / 2, 0);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, GOAL_HEIGHT, 0);
    goalGroup.add(leftPost, rightPost, crossbar);

    const zoneW = GOAL_WIDTH / 3;
    const zoneH = GOAL_HEIGHT / 3;
    const zoneColors = [0xff5b5b, 0xffb74d, 0xffee58];
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        const planeGeo = new THREE.PlaneGeometry(zoneW, zoneH);
        const planeMat = new THREE.MeshBasicMaterial({ color: zoneColors[r], transparent: true, opacity: 0.14, side: THREE.DoubleSide });
        const zone = new THREE.Mesh(planeGeo, planeMat);
        const relX = -GOAL_WIDTH / 2 + c * zoneW + zoneW / 2;
        const relY = GOAL_HEIGHT - r * zoneH - zoneH / 2;
        zone.position.set(relX, relY, 0);
        const edgeGeo = new THREE.EdgesGeometry(planeGeo);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
        zone.add(new THREE.LineSegments(edgeGeo, edgeMat));
        goalGroup.add(zone);
        zones.push({ mesh: zone, points: SCORE_MAP[r][c], minX: relX - zoneW / 2, maxX: relX + zoneW / 2, minY: relY - zoneH / 2, maxY: relY + zoneH / 2 });
      }
    }
    return zones;
  }

  function create(options) {
    if (!window.THREE) throw new Error('THREE is required');
    if (!options || !options.container) throw new Error('ShotGameEngine requires container');
    const container = options.container;
    const ui = options.ui || {};
    const onScoreChange = typeof options.onScoreChange === 'function' ? options.onScoreChange : null;
    const onGameOver = typeof options.onGameOver === 'function' ? options.onGameOver : null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x88cff4);
    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
    camera.position.set(0, 6.8, 25.5);
    camera.lookAt(0, 3, GOAL_Z);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !options.lowFx;
    container.prepend(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.52);
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(18, 26, 14);
    sun.castShadow = !options.lowFx;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(ambient, sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), new THREE.MeshLambertMaterial({ color: 0x2f7d32 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 48), new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.64, metalness: 0.08 }));
    ball.castShadow = !options.lowFx;
    scene.add(ball);

    const goalGroup = new THREE.Group();
    goalGroup.position.set(0, 0, GOAL_Z);
    scene.add(goalGroup);
    const zones = buildGoal(goalGroup);
    const velocity = new THREE.Vector3();
    const spin = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clock = new THREE.Clock();

    let score = 0; let streak = 0; let shots = 0;
    let state = 'aiming'; let charging = false; let power = 0;
    let aim = { x: 0, y: 3 }; let startPointer = { x: 0, y: 0 };
    let sessionStartedAt = Date.now(); let resultTimer = null; let rafId = 0;
    let accumulator = 0; let flightTime = 0; let apex = BALL_RADIUS; let lastBallZ = 12;
    let goalSpeed = 2.9; let goalDir = 1; let goalRange = 5.8;

    function setMessage(text, color) {
      if (!ui.messageEl) return;
      ui.messageEl.textContent = text;
      ui.messageEl.style.color = color || '#ffffff';
      ui.messageEl.style.opacity = text ? '1' : '0';
    }
    function refreshHud() {
      if (ui.scoreEl) ui.scoreEl.textContent = `Score: ${score}`;
      if (ui.streakEl) ui.streakEl.textContent = `Streak: ${streak}`;
      if (onScoreChange) onScoreChange({ score, streak, shots, state });
    }
    function setChargeUiVisible(visible) {
      if (ui.powerBarEl) ui.powerBarEl.style.display = visible ? 'block' : 'none';
      if (ui.crosshairEl) ui.crosshairEl.style.display = visible ? 'block' : 'none';
    }
    function updateCrosshair() {
      if (!ui.crosshairEl) return;
      const marker = new THREE.Vector3(goalGroup.position.x + aim.x, aim.y, GOAL_Z);
      marker.project(camera);
      ui.crosshairEl.style.left = `${(marker.x * 0.5 + 0.5) * container.clientWidth}px`;
      ui.crosshairEl.style.top = `${(-marker.y * 0.5 + 0.5) * container.clientHeight}px`;
    }
    function resize() {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.fov = w < h ? 72 : 62;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      updateCrosshair();
    }
    function resetShot() {
      if (resultTimer) clearTimeout(resultTimer);
      state = 'aiming'; charging = false; power = 0;
      velocity.set(0, 0, 0); spin.set(0, 0, 0);
      ball.position.set(0, BALL_RADIUS, 12);
      lastBallZ = ball.position.z;
      if (ui.powerFillEl) ui.powerFillEl.style.width = '0%';
      setChargeUiVisible(false);
      if (!ui.restartBtn || ui.restartBtn.style.display !== 'block') setMessage('', '#ffffff');
    }
    function endGame() {
      state = 'gameover'; charging = false;
      setChargeUiVisible(false);
      if (ui.restartBtn) ui.restartBtn.style.display = 'block';
      setMessage(`Game Over  Score ${score}`, '#ffd54f');
      if (onGameOver) onGameOver({ score, streak, shots, durationMs: Date.now() - sessionStartedAt, endedAt: new Date().toISOString() });
    }
    function processGoalHit() {
      const x = ball.position.x - goalGroup.position.x;
      const y = ball.position.y;
      if (x < -GOAL_WIDTH / 2 + BALL_RADIUS || x > GOAL_WIDTH / 2 - BALL_RADIUS) return false;
      if (y < BALL_RADIUS || y > GOAL_HEIGHT - BALL_RADIUS) return false;
      let zoneHit = zones[4];
      for (let i = 0; i < zones.length; i += 1) {
        const z = zones[i];
        if (x >= z.minX && x <= z.maxX && y >= z.minY && y <= z.maxY) { zoneHit = z; break; }
      }
      const styleBoost = clamp(Math.round((apex - 2.4) * 2 + power / 16), 0, 20);
      const gained = zoneHit.points + styleBoost;
      streak += 1; score += gained; state = 'result';
      goalSpeed = 2.9 + Math.min(streak, 25) * 0.32;
      zoneHit.mesh.material.opacity = 0.75;
      setTimeout(() => { zoneHit.mesh.material.opacity = 0.14; }, 180);
      setMessage(`+${gained} (${zoneHit.points}+${styleBoost})`, '#80ff80');
      refreshHud();
      resultTimer = setTimeout(resetShot, 1200);
      return true;
    }
    function kick() {
      state = 'flying'; charging = false; shots += 1; flightTime = 0; apex = ball.position.y;
      const p = clamp(power / 100, 0, 1.3);
      const target = new THREE.Vector3(goalGroup.position.x + aim.x, aim.y, GOAL_Z);
      const dir = target.clone().sub(ball.position).normalize();
      const speed = 22 + p * 24;
      velocity.copy(dir.multiplyScalar(speed));
      velocity.y += 3 + p * 10;
      if (power > 100) {
        const over = clamp((power - 100) / 30, 0, 1);
        velocity.x += (Math.random() - 0.5) * 12 * over;
        velocity.y += (Math.random() - 0.5) * 8 * over;
        setMessage('Overcharge drift', '#ff8a80');
      }
      spin.set(0.22 + p * 0.24, -aim.x * 0.24, 0);
      setChargeUiVisible(false);
      refreshHud();
    }
    function onPointerDown(event) {
      if (state !== 'aiming' || event.button !== 0) return;
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.intersectObject(ball).length === 0) return;
      charging = true; power = 0; startPointer = { x: event.clientX, y: event.clientY }; aim = { x: 0, y: 3 };
      setChargeUiVisible(true); updateCrosshair();
      if (container.setPointerCapture) container.setPointerCapture(event.pointerId);
    }
    function onPointerMove(event) {
      if (!charging) return;
      const rect = container.getBoundingClientRect();
      aim.x = clamp(((event.clientX - startPointer.x) / rect.width) * 18, -GOAL_WIDTH / 2 + 0.4, GOAL_WIDTH / 2 - 0.4);
      aim.y = clamp(3 - ((event.clientY - startPointer.y) / rect.height) * 12, 0.8, GOAL_HEIGHT - 0.3);
      updateCrosshair();
    }
    function onPointerUp() { if (charging) kick(); }
    function restartGame() {
      if (resultTimer) clearTimeout(resultTimer);
      score = 0; streak = 0; shots = 0; state = 'aiming';
      sessionStartedAt = Date.now(); goalSpeed = 2.9; goalDir = 1; goalRange = 5.8; goalGroup.position.x = 0;
      if (ui.restartBtn) ui.restartBtn.style.display = 'none';
      refreshHud(); resetShot(); setMessage('Start', '#ffffff');
    }
    function step(dt) {
      if (state !== 'gameover') {
        goalGroup.position.x += goalDir * goalSpeed * dt;
        if (Math.abs(goalGroup.position.x) >= goalRange) { goalDir *= -1; goalRange = 4.2 + Math.random() * 3.5; }
      }
      if (state !== 'flying' && state !== 'result') return;
      flightTime += dt;
      const magnus = new THREE.Vector3().crossVectors(velocity, spin).multiplyScalar(0.015 * dt);
      velocity.add(magnus); velocity.y -= 25.8 * dt; velocity.multiplyScalar(0.997);
      ball.position.addScaledVector(velocity, dt);
      ball.rotation.x += (velocity.z * dt) / BALL_RADIUS; ball.rotation.y += spin.y * dt; ball.rotation.z -= (velocity.x * dt) / BALL_RADIUS;
      apex = Math.max(apex, ball.position.y);
      if (ball.position.y <= BALL_RADIUS) { ball.position.y = BALL_RADIUS; velocity.y *= -0.58; velocity.x *= 0.985; velocity.z *= 0.985; spin.multiplyScalar(0.9); }
      if (state === 'flying' && lastBallZ > GOAL_Z && ball.position.z <= GOAL_Z && processGoalHit()) { velocity.multiplyScalar(0.28); velocity.z = Math.abs(velocity.z); }
      lastBallZ = ball.position.z;
      if (state === 'flying') {
        const stopped = velocity.length() < 1 && ball.position.y <= BALL_RADIUS + 0.04;
        const out = ball.position.z < -110 || Math.abs(ball.position.x) > 64 || flightTime > 6.5;
        if (stopped || out) { streak = 0; refreshHud(); state = 'result'; setMessage('Miss', '#ff8a80'); resultTimer = setTimeout(endGame, 1300); }
      }
    }
    function animate() {
      rafId = requestAnimationFrame(animate);
      const frameDt = Math.min(clock.getDelta(), 0.1);
      if (charging) {
        power = clamp(power + frameDt * 68, 0, 130);
        const displayPower = Math.min(power, 100);
        if (ui.powerFillEl) {
          ui.powerFillEl.style.width = `${displayPower}%`;
          ui.powerFillEl.style.background = power > 100 ? '#ef4444' : 'linear-gradient(90deg,#22c55e,#facc15)';
        }
        if (ui.crosshairEl) {
          const shake = power <= 100 ? power * 0.04 : 4 + (power - 100) * 0.18;
          ui.crosshairEl.style.transform = `translate(-50%, -50%) translate(${(Math.random() - 0.5) * shake}px, ${(Math.random() - 0.5) * shake}px)`;
        }
      } else if (ui.crosshairEl) ui.crosshairEl.style.transform = 'translate(-50%, -50%)';
      accumulator = Math.min(accumulator + frameDt, 0.25);
      while (accumulator >= FIXED_DT) { step(FIXED_DT); accumulator -= FIXED_DT; }
      renderer.render(scene, camera);
    }

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('pointerleave', onPointerUp);
    window.addEventListener('resize', resize);
    if (ui.restartBtn) ui.restartBtn.addEventListener('click', restartGame);
    resize(); restartGame(); animate();

    return {
      destroy() {
        if (resultTimer) clearTimeout(resultTimer);
        cancelAnimationFrame(rafId);
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerUp);
        container.removeEventListener('pointerleave', onPointerUp);
        window.removeEventListener('resize', resize);
        if (ui.restartBtn) ui.restartBtn.removeEventListener('click', restartGame);
        disposeScene(scene); renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        if (renderer.domElement && renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      },
    };
  }

  window.ShotGameEngine = { create };
})();
