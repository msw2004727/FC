(function () {
  var SGI = window._ShotGameInternal;
  var BALL_RADIUS = SGI.BALL_RADIUS;
  var GOAL_Z = SGI.GOAL_Z;
  var PENALTY_SPOT_Z = SGI.PENALTY_SPOT_Z;
  var TRAIL_FRAMES = SGI.TRAIL_FRAMES;
  var ENABLE_GOAL_BILLBOARD = SGI.ENABLE_GOAL_BILLBOARD;
  var BILLBOARD_DEPTH_OFFSET = SGI.BILLBOARD_DEPTH_OFFSET;
  var BILLBOARD_SPACE_SCALE = SGI.BILLBOARD_SPACE_SCALE;
  var BILLBOARD_WIDTH = SGI.BILLBOARD_WIDTH;
  var BILLBOARD_HEIGHT = SGI.BILLBOARD_HEIGHT;
  var THEME_DARK = SGI.THEME_DARK;
  var THEME_LIGHT = SGI.THEME_LIGHT;
  var clamp = SGI.clamp;
  var readThemeSnapshotIsDark = SGI.readThemeSnapshotIsDark;
  var hasRenderableTextureImage = SGI.hasRenderableTextureImage;
  var disposeScene = SGI.disposeScene;
  var drawFieldLines = SGI.drawFieldLines;
  var buildGoal = SGI.buildGoal;
  var resolveMessageBandBackground = SGI.resolveMessageBandBackground;
  var BALL_GLTF_ASSET = SGI.BALL_GLTF_ASSET;
  var BALL_FALLBACK_BASECOLOR = SGI.BALL_FALLBACK_BASECOLOR;
  var BALL_FALLBACK_NORMAL = SGI.BALL_FALLBACK_NORMAL;
  var BALL_FALLBACK_METAL_ROUGH = SGI.BALL_FALLBACK_METAL_ROUGH;

  function create(options) {
    if (!window.THREE) throw new Error('THREE is required');
    if (!options || !options.container) throw new Error('ShotGameEngine requires container');
    var container = options.container;
    var ui = options.ui || {};
    var onScoreChange = typeof options.onScoreChange === 'function' ? options.onScoreChange : null;
    var onGameOver = typeof options.onGameOver === 'function' ? options.onGameOver : null;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
    camera.position.set(0, 6.8, 25.5); camera.lookAt(0, 3, GOAL_Z);
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !options.lowFx;
    container.prepend(renderer.domElement);

    var ambient = new THREE.AmbientLight(0xffffff, 0.52);
    var sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(18, 26, 14); sun.castShadow = !options.lowFx; sun.shadow.mapSize.set(1024, 1024);
    scene.add(ambient, sun);

    var groundMat = new THREE.MeshLambertMaterial({ color: 0x2f7d32 });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    drawFieldLines(scene);

    var textureLoader = new THREE.TextureLoader();
    if (typeof textureLoader.setCrossOrigin === 'function') textureLoader.setCrossOrigin('anonymous');
    var maxAnisotropy = renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function'
      ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    var isEngineDestroyed = { value: false };
    function configureBallTexture(texture, isColor) {
      if (!texture) return; texture.anisotropy = maxAnisotropy; texture.flipY = false;
      if (isColor) texture.encoding = THREE.sRGBEncoding; texture.needsUpdate = true;
    }
    function loadFallbackBallTexture(path, isColor, onLoaded) {
      try { textureLoader.load(path, function (texture) {
        if (!hasRenderableTextureImage(texture)) { console.warn('[ShotGame] fallback texture image missing: ' + path); return; }
        configureBallTexture(texture, isColor); texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1); texture.offset.set(0, 0); texture.needsUpdate = true;
        if (typeof onLoaded === 'function') onLoaded(texture);
      }, undefined, function () { console.warn('[ShotGame] fallback texture load failed: ' + path); });
      } catch (_) { console.warn('[ShotGame] fallback texture load exception: ' + path); }
    }
    function applyBallMaterialSettings(root) {
      root.traverse(function (node) {
        if (!node || !node.isMesh || !node.material) return;
        var materials = Array.isArray(node.material) ? node.material : [node.material];
        for (var i = 0; i < materials.length; i += 1) { var m = materials[i]; if (!m) continue;
          configureBallTexture(m.map, true); configureBallTexture(m.emissiveMap, true);
          configureBallTexture(m.normalMap, false); configureBallTexture(m.roughnessMap, false);
          configureBallTexture(m.metalnessMap, false); m.needsUpdate = true; }
      });
    }
    function applyBallShadowSettings(root) { root.traverse(function (n) { if (!n || !n.isMesh) return; n.castShadow = !options.lowFx; n.receiveShadow = false; }); }
    function centerAndScaleBallModel(root) {
      var box = new THREE.Box3().setFromObject(root); var size = new THREE.Vector3(); box.getSize(size);
      var maxDim = Math.max(size.x, size.y, size.z); if (maxDim <= 0) return;
      root.scale.setScalar((BALL_RADIUS * 2) / maxDim);
      var sc = new THREE.Vector3(); new THREE.Box3().setFromObject(root).getCenter(sc); root.position.sub(sc);
    }
    var ball = new THREE.Object3D(); ball.position.set(0, BALL_RADIUS, PENALTY_SPOT_Z); scene.add(ball);
    var fallbackBallMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 });
    loadFallbackBallTexture(BALL_FALLBACK_BASECOLOR, true, function (t) { fallbackBallMaterial.map = t; fallbackBallMaterial.needsUpdate = true; });
    loadFallbackBallTexture(BALL_FALLBACK_NORMAL, false, function (t) { fallbackBallMaterial.normalMap = t; fallbackBallMaterial.needsUpdate = true; });
    loadFallbackBallTexture(BALL_FALLBACK_METAL_ROUGH, false, function (t) { fallbackBallMaterial.roughnessMap = t; fallbackBallMaterial.metalnessMap = t; fallbackBallMaterial.needsUpdate = true; });
    var fallbackBall = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 48), fallbackBallMaterial);
    fallbackBall.castShadow = !options.lowFx; fallbackBall.receiveShadow = false; ball.add(fallbackBall);
    var ballVisualRoot = fallbackBall;
    if (THREE.GLTFLoader) { try { var gltfLoader = new THREE.GLTFLoader(); gltfLoader.load(BALL_GLTF_ASSET, function (gltf) {
      var modelRoot = gltf && gltf.scene ? gltf.scene : null; if (!modelRoot) return;
      centerAndScaleBallModel(modelRoot); applyBallShadowSettings(modelRoot); applyBallMaterialSettings(modelRoot);
      if (isEngineDestroyed.value) { disposeScene(modelRoot); return; }
      if (ballVisualRoot && ballVisualRoot.parent === ball) { ball.remove(ballVisualRoot); if (ballVisualRoot !== modelRoot) disposeScene(ballVisualRoot); }
      ball.add(modelRoot); ballVisualRoot = modelRoot;
    }, undefined, function () { console.warn('[ShotGame] glTF load failed: ' + BALL_GLTF_ASSET); }); } catch (_) { console.warn('[ShotGame] glTF load exception: ' + BALL_GLTF_ASSET); } }

    var trailPositions = new Float32Array(TRAIL_FRAMES * 3);
    var trailAlphas = new Float32Array(TRAIL_FRAMES);
    var trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(trailAlphas, 1));
    trailGeometry.setDrawRange(0, 0);
    var trailMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: { uColor: { value: new THREE.Color(0x9ed8ff) } },
      vertexShader: 'attribute float aAlpha; varying float vAlpha; void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vAlpha; void main() { if (vAlpha <= 0.0) discard; gl_FragColor = vec4(uColor, vAlpha); }',
    });
    var trailLine = new THREE.Line(trailGeometry, trailMaterial); trailLine.frustumCulled = false; scene.add(trailLine);

    var goalGroup = new THREE.Group(); goalGroup.position.set(0, 0, GOAL_Z); scene.add(goalGroup);
    var goalVisual = buildGoal(goalGroup, { isDark: readThemeSnapshotIsDark() });

    // ── Billboard ──
    var billboardArtMaterial = null; var billboardTexture = null; var billboardTextureRequestId = 0; var billboardAdImageUrl = '';
    function disposeBillboardTexture() { if (!billboardTexture) return; billboardTexture.dispose(); billboardTexture = null; }
    function applyBillboardPlaceholderTheme() { if (!billboardArtMaterial) return; var isDark = currentThemeDark == null ? readThemeIsDark() : currentThemeDark; billboardArtMaterial.map = null; billboardArtMaterial.color.setHex(isDark ? 0x152638 : 0xe7f1ff); billboardArtMaterial.needsUpdate = true; }
    function setBillboardAdImage(url) {
      var nextUrl = typeof url === 'string' ? url.trim() : ''; billboardAdImageUrl = nextUrl;
      if (!ENABLE_GOAL_BILLBOARD) return; var requestId = ++billboardTextureRequestId;
      if (!nextUrl) { disposeBillboardTexture(); applyBillboardPlaceholderTheme(); return; }
      try { textureLoader.load(nextUrl, function (texture) {
        if (requestId !== billboardTextureRequestId) { texture.dispose(); return; }
        if (!hasRenderableTextureImage(texture)) { texture.dispose(); disposeBillboardTexture(); applyBillboardPlaceholderTheme(); return; }
        disposeBillboardTexture(); texture.anisotropy = maxAnisotropy; texture.encoding = THREE.sRGBEncoding;
        texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
        billboardTexture = texture; billboardArtMaterial.color.setHex(0xffffff); billboardArtMaterial.map = texture; billboardArtMaterial.needsUpdate = true;
      }, undefined, function () { if (requestId !== billboardTextureRequestId) return; disposeBillboardTexture(); applyBillboardPlaceholderTheme(); });
      } catch (_) { if (requestId !== billboardTextureRequestId) return; disposeBillboardTexture(); applyBillboardPlaceholderTheme(); }
    }
    if (ENABLE_GOAL_BILLBOARD) {
      var bbG = new THREE.Group(); bbG.position.set(0, 4.2 * BILLBOARD_SPACE_SCALE, GOAL_Z - BILLBOARD_DEPTH_OFFSET); scene.add(bbG);
      bbG.add(new THREE.Mesh(new THREE.PlaneGeometry(BILLBOARD_WIDTH, BILLBOARD_HEIGHT), new THREE.MeshStandardMaterial({ color: 0x31485c, roughness: 0.78, metalness: 0.12 })));
      billboardArtMaterial = new THREE.MeshBasicMaterial({ color: 0xe7f1ff });
      var bbArt = new THREE.Mesh(new THREE.PlaneGeometry(BILLBOARD_WIDTH - 0.72 * BILLBOARD_SPACE_SCALE, BILLBOARD_HEIGHT - 0.66 * BILLBOARD_SPACE_SCALE), billboardArtMaterial);
      bbArt.position.z = 0.03; bbG.add(bbArt);
      var bpR = 0.14 * BILLBOARD_SPACE_SCALE, bpH = 3.8 * BILLBOARD_SPACE_SCALE, bpIX = 0.6 * BILLBOARD_SPACE_SCALE, bpOZ = -0.1 * BILLBOARD_SPACE_SCALE;
      var bpMat = new THREE.MeshStandardMaterial({ color: 0x253748, roughness: 0.7, metalness: 0.22 });
      var bpGeo = new THREE.CylinderGeometry(bpR, bpR, bpH, 16);
      var bpOY = -(BILLBOARD_HEIGHT / 2 + 1.7 * BILLBOARD_SPACE_SCALE);
      var bpL = new THREE.Mesh(bpGeo, bpMat); var bpRt = new THREE.Mesh(bpGeo, bpMat);
      bpL.position.set(-(BILLBOARD_WIDTH / 2 - bpIX), bpOY, bpOZ); bpRt.position.set(BILLBOARD_WIDTH / 2 - bpIX, bpOY, bpOZ); bbG.add(bpL, bpRt);
      var bcR = 0.11 * BILLBOARD_SPACE_SCALE, bcIX = 1.2 * BILLBOARD_SPACE_SCALE;
      var bc = new THREE.Mesh(new THREE.CylinderGeometry(bcR, bcR, BILLBOARD_WIDTH - bcIX, 12), bpMat);
      bc.rotation.z = Math.PI / 2; bc.position.set(0, bpOY + 0.08 * BILLBOARD_SPACE_SCALE, bpOZ); bbG.add(bc);
    }

    // ── Theme ──
    var mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var currentThemeDark = null;
    function readThemeIsDark() { return readThemeSnapshotIsDark(); }
    function applyTheme(isDark) { var t = isDark ? THEME_DARK : THEME_LIGHT; scene.background = new THREE.Color(t.sky); groundMat.color.setHex(t.ground); trailMaterial.uniforms.uColor.value.setHex(t.trail); }
    function syncZoneLabelTheme(isDark) { var zl = goalVisual.zoneLabels; if (!Array.isArray(zl)) return; for (var i = 0; i < zl.length; i += 1) { var l = zl[i]; if (l && typeof l.setTheme === 'function') l.setTheme(isDark); } }

    // ── Message band ──
    var createdMessageBand = false; var messageBandEl = null;
    if (container && typeof container.querySelector === 'function') {
      messageBandEl = container.querySelector('.sg-message-band');
      if (!messageBandEl) {
        messageBandEl = document.createElement('div'); messageBandEl.className = 'sg-message-band';
        messageBandEl.style.cssText = 'position:absolute;left:50%;top:36%;transform:translateX(-50%);width:min(76vw,560px);height:clamp(36px,6.4vw,58px);border-radius:999px;z-index:4;opacity:0;pointer-events:none;transition:opacity 0.2s ease,background 0.2s ease;backdrop-filter:blur(2px)';
        if (ui.messageEl && ui.messageEl.parentNode === container) container.insertBefore(messageBandEl, ui.messageEl);
        else container.appendChild(messageBandEl);
        createdMessageBand = true;
      }
    }
    function syncMessageBandTheme(isDark) { if (!messageBandEl) return; messageBandEl.style.background = resolveMessageBandBackground(isDark); }
    function syncTheme() {
      var isDark = readThemeIsDark(); if (isDark === currentThemeDark) return; currentThemeDark = isDark;
      applyTheme(isDark); syncZoneLabelTheme(isDark);
      if (ui.messageEl) ui.messageEl.style.textShadow = isDark ? '0 2px 9px rgba(0,0,0,0.68)' : '0 2px 10px rgba(255,255,255,0.58)';
      syncMessageBandTheme(isDark);
      if (billboardArtMaterial && !billboardArtMaterial.map) applyBillboardPlaceholderTheme();
    }
    function onMqChange() { syncTheme(); }
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', onMqChange);
    syncTheme();
    setBillboardAdImage(options && options.billboardImageUrl ? options.billboardImageUrl : '');

    return SGI.createGameLoop({
      container: container, ui: ui, onScoreChange: onScoreChange, onGameOver: onGameOver,
      scene: scene, camera: camera, renderer: renderer, ball: ball,
      goalGroup: goalGroup, zones: goalVisual.zones, zoneLabels: goalVisual.zoneLabels,
      trailGeometry: trailGeometry, trailMaterial: trailMaterial, groundMat: groundMat,
      messageBandEl: messageBandEl, createdMessageBand: createdMessageBand,
      syncTheme: syncTheme, readThemeIsDark: readThemeIsDark,
      disposeBillboardTexture: disposeBillboardTexture, setBillboardAdImage: setBillboardAdImage,
      billboardAdImageUrl: billboardAdImageUrl, mq: mq, onMqChange: onMqChange,
      isEngineDestroyed: isEngineDestroyed,
    });
  }

  window.ShotGameEngine = { create: create };
})();
