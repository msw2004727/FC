/* ================================================
   SportHub — Kickball Renderer
   Three.js scene, field, textures, terrain, UI build
   ================================================ */
window._KickballRenderer = (function () {
  var H = window._KickballHelpers;
  var LB = window._KickballLeaderboard;

  var BALL_TEXTURE_URL = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_baseColor.png';

  /* ── Textures ── */
  function loadBallTexture(THREE, material) {
    var loader = new THREE.TextureLoader();
    loader.load(BALL_TEXTURE_URL, function (tex) {
      tex.encoding = THREE.sRGBEncoding;
      tex.flipY = true;
      tex.needsUpdate = true;
      material.map = tex;
      material.needsUpdate = true;
    }, undefined, function () {
      var c = document.createElement('canvas'); c.width = 512; c.height = 512;
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512);
      ctx.strokeStyle = '#303030'; ctx.lineWidth = 10;
      for (var i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc(Math.random() * 512, Math.random() * 512, 58, 0, Math.PI * 2); ctx.stroke(); }
      material.map = new THREE.CanvasTexture(c);
      material.needsUpdate = true;
    });
  }
  function createGrassTexture(THREE) {
    var c = document.createElement('canvas'); c.width = 1024; c.height = 2048; var ctx = c.getContext('2d');
    var bandCount = 36, bandPx = c.height / bandCount, lA = '#2f8a36', lB = '#347c3a';
    for (var i = 0; i < bandCount; i++) { ctx.fillStyle = (i % 2 === 0) ? lA : lB; ctx.fillRect(0, i * bandPx, c.width, Math.ceil(bandPx)); }
    for (var j = 0; j < 2200; j++) { ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.03) + ')'; ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1 + Math.random() * 2); }
    var tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(8, 1); return tex;
  }
  function createSkyTexture(THREE) {
    var c = document.createElement('canvas'); c.width = 32; c.height = 512; var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#6eaee8'); g.addColorStop(0.42, '#90c0ea'); g.addColorStop(0.72, '#b6d6e7'); g.addColorStop(1, '#d7e4db');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height); return new THREE.CanvasTexture(c);
  }

  /* ── Terrain ── */
  function getTerrainHeightAt(G, x, z) {
    var h = 0;
    for (var i = 0; i < G.terrainBumps.length; i++) { var b = G.terrainBumps[i], dx = x - b.x, dz = z - b.z, dist = Math.sqrt(dx * dx + dz * dz); if (dist < b.radius) h += b.height * (1 - dist / b.radius); }
    return h;
  }
  function getTerrainNormalAt(G, THREE, x, z) {
    var nx = 0, nz = 0;
    for (var i = 0; i < G.terrainBumps.length; i++) { var b = G.terrainBumps[i], dx = x - b.x, dz = z - b.z, dist = Math.sqrt(dx * dx + dz * dz); if (dist > 0.01 && dist < b.radius) { var f = b.height / (b.radius * dist); nx += f * dx; nz += f * dz; } }
    var len = Math.sqrt(nx * nx + 1 + nz * nz); return new THREE.Vector3(nx / len, 1 / len, nz / len);
  }
  function generateTerrainBumps(G) {
    G.terrainBumps = [];
    for (var i = 0; i < 8; i++) G.terrainBumps.push({ x: (Math.random() - 0.5) * 200, z: -(30 + Math.random() * 270) * G.unitsPerMeter, radius: 8 + Math.random() * 14, height: 0.18 + Math.random() * 0.22 });
  }

  /* ── Build Scene ── */
  function buildField(G, THREE) {
    G.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, (10 + 350) * G.unitsPerMeter, 120, 120),
      new THREE.MeshLambertMaterial({ map: createGrassTexture(THREE), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
    );
    G.ground.rotation.x = -Math.PI / 2;
    G.ground.position.z = -((350 * G.unitsPerMeter) / 2) + (10 * G.unitsPerMeter) / 2;
    G.ground.receiveShadow = true;
    G.scene.add(G.ground);
    var sl = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1.2), new THREE.MeshBasicMaterial({ color: 0xfff38a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }));
    sl.rotation.x = -Math.PI / 2; sl.position.set(0, 0.04, 0); G.scene.add(sl);
    var cm = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }));
    cm.rotation.x = -Math.PI / 2; cm.position.set(0, 0.05, 0); G.scene.add(cm);
    for (var m = 25; m <= 350; m += 25) {
      var z = -m * G.unitsPerMeter, nc = document.createElement('canvas'); nc.width = 2048; nc.height = 512;
      var nctx = nc.getContext('2d'); nctx.fillStyle = 'rgba(255,255,255,0.98)'; nctx.font = 'bold 420px Arial'; nctx.textAlign = 'center'; nctx.textBaseline = 'middle'; nctx.fillText(String(m), 1024, 256);
      var tex = new THREE.CanvasTexture(nc), mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
      for (var xx = -1820; xx <= 1820; xx += 165) {
        var mesh = new THREE.Mesh(new THREE.PlaneGeometry(290, 42), mat.clone()); mesh.rotation.x = -Math.PI / 2; mesh.position.set(xx, 0.045, z - 21); G.scene.add(mesh);
      }
    }
  }
  function initScene(G, THREE, containerEl) {
    G.scene = new THREE.Scene();
    G.scene.background = createSkyTexture(THREE);
    G.scene.fog = new THREE.FogExp2(0xc9ddd9, 0.00125);
    G.camera = new THREE.PerspectiveCamera(60, containerEl.offsetWidth / containerEl.offsetHeight, 0.1, 5000);
    G.camera.position.set(0, 37.5, 216);
    G.renderer = new THREE.WebGLRenderer({ antialias: true });
    G.renderer.setSize(containerEl.offsetWidth, containerEl.offsetHeight);
    G.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    G.renderer.shadowMap.enabled = true;
    G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerEl.insertBefore(G.renderer.domElement, containerEl.firstChild);
    G.scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    G.dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    G.dirLight.position.set(70, 110, 45); G.dirLight.castShadow = true;
    G.dirLight.shadow.mapSize.set(1024, 1024);
    G.dirLight.shadow.camera.left = -180; G.dirLight.shadow.camera.right = 180; G.dirLight.shadow.camera.top = 180; G.dirLight.shadow.camera.bottom = -180;
    G.scene.add(G.dirLight); G.scene.add(G.dirLight.target);
    buildField(G, THREE);
    var ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
    loadBallTexture(THREE, ballMat);
    G.ball = new THREE.Mesh(new THREE.SphereGeometry(G.ballRadius, 32, 32), ballMat);
    G.ball.castShadow = true; G.ball.position.set(0, G.ballRadius, 0); G.scene.add(G.ball);
    G.raycaster = new THREE.Raycaster(); G.mouse = new THREE.Vector2();
  }

  /* ── Top 10 Monthly Markers ── */
  function loadTop3Markers(G, THREE) {
    G._markerObjects.forEach(function (obj) { G.scene.remove(obj); if (obj.material) obj.material.dispose(); if (obj.geometry) obj.geometry.dispose(); });
    G._markerObjects = [];
    var bucket = H.getTaipeiDateBucket('monthly');
    firebase.firestore().collection('kickGameRankings').doc(bucket).collection('entries')
      .orderBy('bestDistance', 'desc').limit(20).get()
      .then(function (snap) {
        if (G.destroyed) return;
        var rows = snap.docs.map(function (d) { return H.normalizeRow(d.id, d.data()); }).filter(function (r) { return !H.isAnonymousRow(r) && r.distance > 0; });
        rows = H.dedupeRows(rows).sort(H.compareRows).slice(0, 10);
        var topColors = [0xffd700, 0xc0c0c0, 0xcd7f32];
        var _scatterSeeds = [0.73, -0.41, 0.18, -0.85, 0.56, -0.27, 0.92, -0.63, 0.35, -0.78];
        var scatterRange = 25;
        rows.forEach(function (row, i) {
          var z = -row.distance * G.unitsPerMeter;
          var xOff = _scatterSeeds[i % _scatterSeeds.length] * scatterRange;
          var isTop3 = i < 3;
          var color = isTop3 ? topColors[i] : 0x4a90d9;
          var bH = isTop3 ? 18 + (2 - i) * 4 : 8;
          var beamOpacity = isTop3 ? 0.18 : 0.10;
          var beamWidth = isTop3 ? 1.5 : 0.8;
          var ringOuter = isTop3 ? 3.2 : 2.0;
          var ringInner = isTop3 ? 2.5 : 1.5;
          var ringOpacity = isTop3 ? 0.35 : 0.20;
          var bMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: beamOpacity, side: THREE.DoubleSide, depthWrite: false });
          var bGeo = new THREE.PlaneGeometry(beamWidth, bH);
          var b1 = new THREE.Mesh(bGeo, bMat); b1.position.set(xOff, bH / 2, z); G.scene.add(b1); G._markerObjects.push(b1);
          var b2 = b1.clone(); b2.rotation.y = Math.PI / 2; b2.position.copy(b1.position); G.scene.add(b2); G._markerObjects.push(b2);
          var ringMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: ringOpacity, side: THREE.DoubleSide, depthWrite: false });
          var ring = new THREE.Mesh(new THREE.RingGeometry(ringInner, ringOuter, 32), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(xOff, 0.06, z); G.scene.add(ring); G._markerObjects.push(ring);
          var c = document.createElement('canvas'); c.width = 512; c.height = 96;
          var ctx = c.getContext('2d');
          ctx.fillStyle = isTop3 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.40)';
          ctx.fillRect(0, 0, 512, 96);
          ctx.fillStyle = '#fff'; ctx.font = (isTop3 ? 'bold 42px' : 'bold 34px') + ' Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('#' + (i + 1) + ' ' + row.nick + '  ' + row.distance.toFixed(1) + 'm', 256, 48);
          var sMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
          var spriteScale = isTop3 ? 36 : 28;
          var spriteH = isTop3 ? 6.75 : 5.25;
          var sprite = new THREE.Sprite(sMat); sprite.scale.set(spriteScale, spriteH, 1); sprite.position.set(xOff, bH + 3, z);
          G.scene.add(sprite); G._markerObjects.push(sprite);
        });
      }).catch(function () {});
  }

  return {
    initScene: initScene,
    loadTop3Markers: loadTop3Markers,
    getTerrainHeightAt: getTerrainHeightAt,
    getTerrainNormalAt: getTerrainNormalAt,
    generateTerrainBumps: generateTerrainBumps,
  };
})();
