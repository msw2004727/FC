(function () {
  const FIXED_DT = 1 / 60;
  const BALL_RADIUS = 0.55;
  const GOAL_Z = -20;
  const GOAL_WIDTH = 14;
  const GOAL_HEIGHT = 7.2;
  const GOAL_POST_RADIUS = 0.18;
  const PENALTY_SPOT_Z = 12;
  const SCORE_MAP = [[100, 50, 100], [50, 20, 50], [40, 10, 40]];
  const TRAIL_FRAMES = 20;
  const STREAK_MILESTONES = new Set([5, 10, 20, 30]);
  const BALL_TEX_BASECOLOR = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_baseColor.png';
  const BALL_TEX_NORMAL = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_normal.png';
  const BALL_TEX_METAL_ROUGH = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_metallicRoughness.png';
  const GOAL_BASE_SWING_BOUNDARY = 6.6;
  const GOAL_SWING_RANGE_SCALE = 1.2;
  const GOAL_MIN_X = -GOAL_BASE_SWING_BOUNDARY * GOAL_SWING_RANGE_SCALE;
  const GOAL_MAX_X = GOAL_BASE_SWING_BOUNDARY * GOAL_SWING_RANGE_SCALE;
  const GOAL_BURST_CHANCE_PER_SEC = 0.2;
  const GOAL_BURST_MIN_STEPS = 6;
  const GOAL_BURST_MAX_STEPS = 12;
  const GOAL_BURST_MIN_MULT = 2.1;
  const GOAL_BURST_MAX_MULT = 3.5;
  const ENABLE_GOAL_BILLBOARD = false;
  const BILLBOARD_DEPTH_OFFSET = 10;
  const BILLBOARD_SPACE_SCALE = Math.sqrt(8);
  const BILLBOARD_WIDTH = 16.5 * BILLBOARD_SPACE_SCALE;
  const BILLBOARD_HEIGHT = 4.8 * BILLBOARD_SPACE_SCALE;
  const BALL_TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'];

  const THEME_DARK  = { sky: 0x0d1b2a, ground: 0x1b4520, trail: 0x9ed8ff };
  const THEME_LIGHT = { sky: 0x88cff4, ground: 0x2f7d32, trail: 0x1d6fa8 };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function readThemeSnapshotIsDark() {
    const docTheme = document && document.documentElement && document.documentElement.dataset
      ? document.documentElement.dataset.shotTheme
      : '';
    if (docTheme === 'dark') return true;
    if (docTheme === 'light') return false;
    return typeof window.matchMedia === 'function'
      ? !!window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  }
  function hasRenderableTextureImage(texture) {
    if (!texture || !texture.image) return false;
    const image = texture.image;
    if (typeof image.width === 'number' && typeof image.height === 'number') return image.width > 0 && image.height > 0;
    if (typeof image.videoWidth === 'number' && typeof image.videoHeight === 'number') return image.videoWidth > 0 && image.videoHeight > 0;
    return true;
  }
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

  function drawFieldLines(scene) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const thick = 0.3;
    const y = 0.02;
    function addLine(w, d, x, z) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, z);
      scene.add(mesh);
    }
    // 底線（Goal line）
    addLine(80, thick, 0, GOAL_Z);

    // 大禁區（Penalty area / 18-yard box）
    const bW = 40, bD = 36;
    addLine(thick, bD, -bW / 2, GOAL_Z + bD / 2);
    addLine(thick, bD,  bW / 2, GOAL_Z + bD / 2);
    addLine(bW + thick, thick, 0, GOAL_Z + bD);

    // 小禁區（Goal area / 6-yard box）
    const gW = 20, gD = 11;
    addLine(thick, gD, -gW / 2, GOAL_Z + gD / 2);
    addLine(thick, gD,  gW / 2, GOAL_Z + gD / 2);
    addLine(gW + thick, thick, 0, GOAL_Z + gD);

    // 12 碼點（Penalty spot）
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), mat);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, y, PENALTY_SPOT_Z);
    scene.add(spot);

    // 禁區弧（Penalty arc / D）
    const arcR = 12;
    const edgeZ = GOAL_Z + bD;                  // = 16
    const dist  = edgeZ - PENALTY_SPOT_Z;        // = 4
    if (dist < arcR) {
      const alpha  = Math.acos(dist / arcR);
      const arcGeo = new THREE.RingGeometry(arcR - thick / 2, arcR + thick / 2, 64, 1, -Math.PI / 2 - alpha, alpha * 2);
      const arcMesh = new THREE.Mesh(arcGeo, mat);
      arcMesh.rotation.x = -Math.PI / 2;
      arcMesh.position.set(0, y, PENALTY_SPOT_Z);
      scene.add(arcMesh);
    }
  }

  function buildGoal(goalGroup, options) {
    const initialThemeDark = !!(options && options.isDark);
    function drawRoundedRect(ctx, x, y, width, height, radius) {
      const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + width - r, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + r);
      ctx.lineTo(x + width, y + height - r);
      ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      ctx.lineTo(x + r, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
    function getScoreLabelTheme(isDark) {
      if (isDark) {
        return {
          panelFill: 'rgba(7, 18, 30, 0.64)',
          panelStroke: 'rgba(173, 216, 255, 0.42)',
          textFill: '#f8fbff',
          textStroke: 'rgba(0, 0, 0, 0.84)',
        };
      }
      return {
        panelFill: 'rgba(255, 255, 255, 0.66)',
        panelStroke: 'rgba(12, 30, 45, 0.28)',
        textFill: '#12263a',
        textStroke: 'rgba(255, 255, 255, 0.84)',
      };
    }
    function buildZoneLabelSprite(points) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      const ctx = canvas.getContext('2d');
      const repaint = (isDark) => {
        if (!ctx) return;
        const theme = getScoreLabelTheme(isDark);
        const text = String(points);
        const panelWidth = canvas.width * 0.96;
        const panelHeight = canvas.height * 0.90;
        const panelX = (canvas.width - panelWidth) / 2;
        const panelY = (canvas.height - panelHeight) / 2;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 22);
        ctx.fillStyle = theme.panelFill;
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = theme.panelStroke;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 78px "Outfit", "Noto Sans TC", sans-serif';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 14;
        ctx.strokeStyle = theme.textStroke;
        ctx.strokeText(text, canvas.width / 2, canvas.height / 2 + 3);
        ctx.fillStyle = theme.textFill;
        ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 3);
        texture.needsUpdate = true;
      };
      repaint(initialThemeDark);
      return { sprite, setTheme: repaint };
    }

    const zones = [];
    const zoneLabels = [];
    const postRadius = GOAL_POST_RADIUS;
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    const postGeo  = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HEIGHT, 24);
    const crossGeo = new THREE.CylinderGeometry(postRadius, postRadius, GOAL_WIDTH + postRadius * 2, 24);
    const leftPost  = new THREE.Mesh(postGeo,  postMat);
    const rightPost = new THREE.Mesh(postGeo,  postMat);
    const crossbar  = new THREE.Mesh(crossGeo, postMat);
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
        const labelSprite = buildZoneLabelSprite(SCORE_MAP[r][c]);
        labelSprite.sprite.position.set(0, 0, 0.04);
        labelSprite.sprite.scale.set(zoneW * 0.94, zoneH * 0.88, 1);
        zone.add(labelSprite.sprite);
        zoneLabels.push(labelSprite);
        goalGroup.add(zone);
        zones.push({ mesh: zone, points: SCORE_MAP[r][c], minX: relX - zoneW / 2, maxX: relX + zoneW / 2, minY: relY - zoneH / 2, maxY: relY + zoneH / 2 });
      }
    }
    return { zones, zoneLabels };
  }

  function create(options) {
    if (!window.THREE) throw new Error('THREE is required');
    if (!options || !options.container) throw new Error('ShotGameEngine requires container');
    const container  = options.container;
    const ui         = options.ui || {};
    const onScoreChange = typeof options.onScoreChange === 'function' ? options.onScoreChange : null;
    const onGameOver    = typeof options.onGameOver    === 'function' ? options.onGameOver    : null;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
    camera.position.set(0, 6.8, 25.5);
    camera.lookAt(0, 3, GOAL_Z);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !options.lowFx;
    container.prepend(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.52);
    const sun     = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(18, 26, 14);
    sun.castShadow = !options.lowFx;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(ambient, sun);

    const groundMat = new THREE.MeshLambertMaterial({ color: 0x2f7d32 });
    const ground    = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    drawFieldLines(scene);

    const textureLoader = new THREE.TextureLoader();
    if (typeof textureLoader.setCrossOrigin === 'function') textureLoader.setCrossOrigin('anonymous');
    const maxAnisotropy = renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function'
      ? Math.min(8, renderer.capabilities.getMaxAnisotropy())
      : 1;
    function loadBallTexture(path, isColor, onLoaded) {
      try {
        textureLoader.load(
          path,
          (texture) => {
            if (!hasRenderableTextureImage(texture)) {
              console.warn(`[ShotGame] texture image missing: ${path}`);
              return;
            }
            texture.flipY = false;
            texture.anisotropy = maxAnisotropy;
            if (isColor) texture.encoding = THREE.sRGBEncoding;
            if (typeof onLoaded === 'function') onLoaded(texture);
          },
          undefined,
          () => { console.warn(`[ShotGame] texture load failed: ${path}`); },
        );
      } catch (_) {
        console.warn(`[ShotGame] texture load exception: ${path}`);
      }
    }
    function sanitizeBallMaterialTextures(material) {
      let changed = false;
      for (let i = 0; i < BALL_TEXTURE_SLOTS.length; i += 1) {
        const slot = BALL_TEXTURE_SLOTS[i];
        const texture = material[slot];
        if (texture && !hasRenderableTextureImage(texture)) {
          material[slot] = null;
          changed = true;
        }
      }
      if (changed) material.needsUpdate = true;
      return changed;
    }
    const ballMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 1,
    });
    loadBallTexture(BALL_TEX_BASECOLOR, true, (texture) => {
      ballMaterial.map = texture;
      ballMaterial.needsUpdate = true;
    });
    loadBallTexture(BALL_TEX_NORMAL, false, (texture) => {
      ballMaterial.normalMap = texture;
      ballMaterial.needsUpdate = true;
    });
    loadBallTexture(BALL_TEX_METAL_ROUGH, false, (texture) => {
      ballMaterial.roughnessMap = texture;
      ballMaterial.metalnessMap = texture;
      ballMaterial.needsUpdate = true;
    });
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 48, 48),
      ballMaterial
    );
    ball.castShadow = !options.lowFx;
    scene.add(ball);

    const trailPositions = new Float32Array(TRAIL_FRAMES * 3);
    const trailAlphas = new Float32Array(TRAIL_FRAMES);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(trailAlphas, 1));
    trailGeometry.setDrawRange(0, 0);
    const trailMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { uColor: { value: new THREE.Color(0x9ed8ff) } },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(uColor, vAlpha);
        }
      `,
    });
    const trailLine = new THREE.Line(trailGeometry, trailMaterial);
    trailLine.frustumCulled = false;
    scene.add(trailLine);

    const goalGroup = new THREE.Group();
    goalGroup.position.set(0, 0, GOAL_Z);
    scene.add(goalGroup);
    const goalVisual = buildGoal(goalGroup, { isDark: readThemeSnapshotIsDark() });
    const zones = goalVisual.zones;
    const zoneLabels = goalVisual.zoneLabels;

    let billboardArtMaterial = null;
    let billboardTexture = null;
    let billboardTextureRequestId = 0;
    let billboardAdImageUrl = '';
    function disposeBillboardTexture() {
      if (!billboardTexture) return;
      billboardTexture.dispose();
      billboardTexture = null;
    }
    function applyBillboardPlaceholderTheme() {
      if (!billboardArtMaterial) return;
      const isDark = currentThemeDark == null ? readThemeIsDark() : currentThemeDark;
      billboardArtMaterial.map = null;
      billboardArtMaterial.color.setHex(isDark ? 0x152638 : 0xe7f1ff);
      billboardArtMaterial.needsUpdate = true;
    }
    function setBillboardAdImage(url) {
      const nextUrl = typeof url === 'string' ? url.trim() : '';
      billboardAdImageUrl = nextUrl;
      if (!ENABLE_GOAL_BILLBOARD) return;
      const requestId = ++billboardTextureRequestId;
      if (!nextUrl) {
        disposeBillboardTexture();
        applyBillboardPlaceholderTheme();
        return;
      }
      try {
        textureLoader.load(
          nextUrl,
          (texture) => {
            if (requestId !== billboardTextureRequestId) {
              texture.dispose();
              return;
            }
            if (!hasRenderableTextureImage(texture)) {
              texture.dispose();
              disposeBillboardTexture();
              applyBillboardPlaceholderTheme();
              return;
            }
            disposeBillboardTexture();
            texture.anisotropy = maxAnisotropy;
            texture.encoding = THREE.sRGBEncoding;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            billboardTexture = texture;
            billboardArtMaterial.color.setHex(0xffffff);
            billboardArtMaterial.map = texture;
            billboardArtMaterial.needsUpdate = true;
          },
          undefined,
          () => {
            if (requestId !== billboardTextureRequestId) return;
            disposeBillboardTexture();
            applyBillboardPlaceholderTheme();
          },
        );
      } catch (_) {
        if (requestId !== billboardTextureRequestId) return;
        disposeBillboardTexture();
        applyBillboardPlaceholderTheme();
      }
    }
    if (ENABLE_GOAL_BILLBOARD) {
      const billboardGroup = new THREE.Group();
      billboardGroup.position.set(0, 4.2 * BILLBOARD_SPACE_SCALE, GOAL_Z - BILLBOARD_DEPTH_OFFSET);
      scene.add(billboardGroup);

      const billboardFrame = new THREE.Mesh(
        new THREE.PlaneGeometry(BILLBOARD_WIDTH, BILLBOARD_HEIGHT),
        new THREE.MeshStandardMaterial({ color: 0x31485c, roughness: 0.78, metalness: 0.12 })
      );
      billboardGroup.add(billboardFrame);

      const billboardArtInsetX = 0.72 * BILLBOARD_SPACE_SCALE;
      const billboardArtInsetY = 0.66 * BILLBOARD_SPACE_SCALE;
      billboardArtMaterial = new THREE.MeshBasicMaterial({ color: 0xe7f1ff });
      const billboardArt = new THREE.Mesh(
        new THREE.PlaneGeometry(BILLBOARD_WIDTH - billboardArtInsetX, BILLBOARD_HEIGHT - billboardArtInsetY),
        billboardArtMaterial
      );
      billboardArt.position.z = 0.03;
      billboardGroup.add(billboardArt);

      const billboardPostRadius = 0.14 * BILLBOARD_SPACE_SCALE;
      const billboardPostHeight = 3.8 * BILLBOARD_SPACE_SCALE;
      const billboardPostInsetX = 0.6 * BILLBOARD_SPACE_SCALE;
      const billboardPostOffsetZ = -0.1 * BILLBOARD_SPACE_SCALE;
      const billboardPostMaterial = new THREE.MeshStandardMaterial({ color: 0x253748, roughness: 0.7, metalness: 0.22 });
      const billboardPostGeo = new THREE.CylinderGeometry(billboardPostRadius, billboardPostRadius, billboardPostHeight, 16);
      const billboardPostOffsetY = -(BILLBOARD_HEIGHT / 2 + 1.7 * BILLBOARD_SPACE_SCALE);
      const billboardPostLeft = new THREE.Mesh(billboardPostGeo, billboardPostMaterial);
      const billboardPostRight = new THREE.Mesh(billboardPostGeo, billboardPostMaterial);
      billboardPostLeft.position.set(-(BILLBOARD_WIDTH / 2 - billboardPostInsetX), billboardPostOffsetY, billboardPostOffsetZ);
      billboardPostRight.position.set(BILLBOARD_WIDTH / 2 - billboardPostInsetX, billboardPostOffsetY, billboardPostOffsetZ);
      billboardGroup.add(billboardPostLeft, billboardPostRight);

      const billboardCrossbarRadius = 0.11 * BILLBOARD_SPACE_SCALE;
      const billboardCrossbarInsetX = 1.2 * BILLBOARD_SPACE_SCALE;
      const billboardCrossbar = new THREE.Mesh(
        new THREE.CylinderGeometry(billboardCrossbarRadius, billboardCrossbarRadius, BILLBOARD_WIDTH - billboardCrossbarInsetX, 12),
        billboardPostMaterial
      );
      billboardCrossbar.rotation.z = Math.PI / 2;
      billboardCrossbar.position.set(0, billboardPostOffsetY + 0.08 * BILLBOARD_SPACE_SCALE, billboardPostOffsetZ);
      billboardGroup.add(billboardCrossbar);
    }

    const velocity = new THREE.Vector3();
    const spin     = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const pointer   = new THREE.Vector2();
    const clock     = new THREE.Clock();

    let score = 0; let streak = 0; let maxStreak = 0; let shots = 0;
    const AIM_START_X = 0;
    const AIM_START_Y = GOAL_HEIGHT / 2;
    let state = 'aiming'; let charging = false; let power = 0;
    let aim = { x: AIM_START_X, y: AIM_START_Y }; let startPointer = { x: 0, y: 0 };
    let sessionStartedAt = Date.now(); let resultTimer = null; let flashTimer = null; let rafId = 0;
    let accumulator = 0; let flightTime = 0; let apex = BALL_RADIUS; let lastBallZ = PENALTY_SPOT_Z;
    let goalSpeed = 2.9; let goalDir = 1; let goalSpeedMult = 1.0;
    let curveBoost = 1;
    let goalBurstSteps = 0; let goalBurstMult = 1.0; let goalBurstDir = 1;
    let trailCount = 0;
    const postOffset = new THREE.Vector3();
    const collisionNormal = new THREE.Vector3();
    const bestNormal = new THREE.Vector3();
    const crossbarStart = new THREE.Vector3();
    const crossbarEnd = new THREE.Vector3();
    const segmentDir = new THREE.Vector3();
    const nearestPoint = new THREE.Vector3();
    const normalComponent = new THREE.Vector3();
    const tangentComponent = new THREE.Vector3();
    let createdMessageBand = false;
    let messageBandEl = null;
    if (container && typeof container.querySelector === 'function') {
      messageBandEl = container.querySelector('.sg-message-band');
      if (!messageBandEl) {
        messageBandEl = document.createElement('div');
        messageBandEl.className = 'sg-message-band';
        messageBandEl.style.position = 'absolute';
        messageBandEl.style.left = '50%';
        messageBandEl.style.top = '36%';
        messageBandEl.style.transform = 'translateX(-50%)';
        messageBandEl.style.width = 'min(76vw, 560px)';
        messageBandEl.style.height = 'clamp(36px, 6.4vw, 58px)';
        messageBandEl.style.borderRadius = '999px';
        messageBandEl.style.zIndex = '4';
        messageBandEl.style.opacity = '0';
        messageBandEl.style.pointerEvents = 'none';
        messageBandEl.style.transition = 'opacity 0.2s ease, background 0.2s ease';
        messageBandEl.style.backdropFilter = 'blur(2px)';
        if (ui.messageEl && ui.messageEl.parentNode === container) {
          container.insertBefore(messageBandEl, ui.messageEl);
        } else {
          container.appendChild(messageBandEl);
        }
        createdMessageBand = true;
      }
    }

    // ── 主題切換 ──
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    let currentThemeDark = null;
    function applyTheme(isDark) {
      const t = isDark ? THEME_DARK : THEME_LIGHT;
      scene.background = new THREE.Color(t.sky);
      groundMat.color.setHex(t.ground);
      trailMaterial.uniforms.uColor.value.setHex(t.trail);
    }
    function readThemeIsDark() {
      const snapshot = readThemeSnapshotIsDark();
      if (mq && typeof mq.matches === 'boolean' && !(document && document.documentElement && document.documentElement.dataset && document.documentElement.dataset.shotTheme)) {
        return !!mq.matches;
      }
      return snapshot;
    }
    function resolveMessageBandBackground(isDark) {
      if (isDark) {
        return 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(6,16,29,0.64) 23%, rgba(6,16,29,0.64) 77%, rgba(0,0,0,0) 100%)';
      }
      return 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(13,30,45,0.22) 23%, rgba(13,30,45,0.22) 77%, rgba(255,255,255,0) 100%)';
    }
    function syncMessageBandTheme(isDark) {
      if (!messageBandEl) return;
      messageBandEl.style.background = resolveMessageBandBackground(isDark);
    }
    function syncZoneLabelTheme(isDark) {
      if (!Array.isArray(zoneLabels)) return;
      for (let i = 0; i < zoneLabels.length; i += 1) {
        const label = zoneLabels[i];
        if (label && typeof label.setTheme === 'function') label.setTheme(isDark);
      }
    }
    function syncTheme() {
      const isDark = readThemeIsDark();
      if (isDark === currentThemeDark) return;
      currentThemeDark = isDark;
      applyTheme(isDark);
      syncZoneLabelTheme(isDark);
      if (ui.messageEl) ui.messageEl.style.textShadow = isDark
        ? '0 2px 9px rgba(0, 0, 0, 0.68)'
        : '0 2px 10px rgba(255, 255, 255, 0.58)';
      syncMessageBandTheme(isDark);
      if (billboardArtMaterial && !billboardArtMaterial.map) applyBillboardPlaceholderTheme();
    }
    function onMqChange() { syncTheme(); }
    if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', onMqChange);
    syncTheme();
    setBillboardAdImage(options && options.billboardImageUrl ? options.billboardImageUrl : '');

    function triggerScreenFlash() {
      container.classList.remove('flash-hit');
      // Force style flush so repeated milestones can retrigger the flash transition.
      void container.offsetWidth;
      container.classList.add('flash-hit');
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        container.classList.remove('flash-hit');
        flashTimer = null;
      }, 180);
    }
    function tryShowMilestoneMessage() {
      if (!STREAK_MILESTONES.has(streak)) return false;
      setMessage(`🔥 ×${streak} 連進！`, '#ffd166');
      triggerScreenFlash();
      return true;
    }
    function closestPointOnSegment(point, segStart, segEnd, target) {
      segmentDir.subVectors(segEnd, segStart);
      const lenSq = segmentDir.lengthSq();
      if (lenSq <= 1e-6) return target.copy(segStart);
      postOffset.subVectors(point, segStart);
      const t = clamp(postOffset.dot(segmentDir) / lenSq, 0, 1);
      return target.copy(segStart).addScaledVector(segmentDir, t);
    }
    function resolveGoalFrameCollision() {
      const frameX = goalGroup.position.x;
      const leftPostX = frameX - GOAL_WIDTH / 2;
      const rightPostX = frameX + GOAL_WIDTH / 2;
      const frameZ = GOAL_Z;
      const targetDist = BALL_RADIUS + GOAL_POST_RADIUS;
      const restitution = 0.58;
      const tangentDamping = 0.94;
      let collided = false;

      for (let iter = 0; iter < 2; iter += 1) {
        let bestPenetration = 0;
        bestNormal.set(0, 0, 0);

        // Left post as capsule (vertical segment + radius)
        crossbarStart.set(leftPostX, GOAL_POST_RADIUS, frameZ);
        crossbarEnd.set(leftPostX, GOAL_HEIGHT - GOAL_POST_RADIUS, frameZ);
        closestPointOnSegment(ball.position, crossbarStart, crossbarEnd, nearestPoint);
        postOffset.subVectors(ball.position, nearestPoint);
        let dist = postOffset.length();
        let penetration = targetDist - dist;
        if (penetration > bestPenetration) {
          if (dist > 1e-6) collisionNormal.copy(postOffset).multiplyScalar(1 / dist);
          else if (velocity.lengthSq() > 1e-6) collisionNormal.copy(velocity).normalize().multiplyScalar(-1);
          else collisionNormal.set(-1, 0, 0);
          bestPenetration = penetration;
          bestNormal.copy(collisionNormal);
        }

        // Right post as capsule (vertical segment + radius)
        crossbarStart.set(rightPostX, GOAL_POST_RADIUS, frameZ);
        crossbarEnd.set(rightPostX, GOAL_HEIGHT - GOAL_POST_RADIUS, frameZ);
        closestPointOnSegment(ball.position, crossbarStart, crossbarEnd, nearestPoint);
        postOffset.subVectors(ball.position, nearestPoint);
        dist = postOffset.length();
        penetration = targetDist - dist;
        if (penetration > bestPenetration) {
          if (dist > 1e-6) collisionNormal.copy(postOffset).multiplyScalar(1 / dist);
          else if (velocity.lengthSq() > 1e-6) collisionNormal.copy(velocity).normalize().multiplyScalar(-1);
          else collisionNormal.set(1, 0, 0);
          bestPenetration = penetration;
          bestNormal.copy(collisionNormal);
        }

        // Crossbar as capsule (horizontal segment + radius)
        crossbarStart.set(leftPostX, GOAL_HEIGHT, frameZ);
        crossbarEnd.set(rightPostX, GOAL_HEIGHT, frameZ);
        closestPointOnSegment(ball.position, crossbarStart, crossbarEnd, nearestPoint);
        postOffset.subVectors(ball.position, nearestPoint);
        dist = postOffset.length();
        penetration = targetDist - dist;
        if (penetration > bestPenetration) {
          if (dist > 1e-6) collisionNormal.copy(postOffset).multiplyScalar(1 / dist);
          else if (velocity.lengthSq() > 1e-6) collisionNormal.copy(velocity).normalize().multiplyScalar(-1);
          else collisionNormal.set(0, -1, 0);
          bestPenetration = penetration;
          bestNormal.copy(collisionNormal);
        }

        if (bestPenetration <= 0) break;
        collided = true;
        ball.position.addScaledVector(bestNormal, bestPenetration + 0.001);
        const normalSpeed = velocity.dot(bestNormal);
        if (normalSpeed < 0) {
          velocity.addScaledVector(bestNormal, -(1 + restitution) * normalSpeed);
          normalComponent.copy(bestNormal).multiplyScalar(velocity.dot(bestNormal));
          tangentComponent.subVectors(velocity, normalComponent).multiplyScalar(tangentDamping);
          velocity.copy(normalComponent).add(tangentComponent);
          spin.multiplyScalar(0.92);
        }
      }

      return collided;
    }
    function clearTrail() {
      trailCount = 0;
      trailGeometry.setDrawRange(0, 0);
      trailGeometry.attributes.position.needsUpdate = true;
      trailGeometry.attributes.aAlpha.needsUpdate = true;
    }
    function pushTrailPoint(position) {
      const posArr = trailGeometry.attributes.position.array;
      const alphaArr = trailGeometry.attributes.aAlpha.array;
      if (trailCount < TRAIL_FRAMES) {
        const base = trailCount * 3;
        posArr[base] = position.x;
        posArr[base + 1] = position.y;
        posArr[base + 2] = position.z;
        trailCount += 1;
      } else {
        for (let i = 0; i < (TRAIL_FRAMES - 1) * 3; i += 1) posArr[i] = posArr[i + 3];
        const base = (TRAIL_FRAMES - 1) * 3;
        posArr[base] = position.x;
        posArr[base + 1] = position.y;
        posArr[base + 2] = position.z;
      }
      const denom = Math.max(1, trailCount - 1);
      for (let i = 0; i < trailCount; i += 1) alphaArr[i] = trailCount === 1 ? 1 : (i / denom);
      trailGeometry.setDrawRange(0, trailCount);
      trailGeometry.attributes.position.needsUpdate = true;
      trailGeometry.attributes.aAlpha.needsUpdate = true;
    }

    const LIGHT_THEME_MESSAGE_COLORS = Object.freeze({
      '#ffffff': '#13283b',
      '#ffd166': '#6b4b00',
      '#ffd54f': '#755300',
      '#80ff80': '#1e6a33',
      '#ff8a80': '#7a1f2c',
    });
    function resolveMessageColor(inputColor) {
      const fallback = '#ffffff';
      const rawColor = (typeof inputColor === 'string' && inputColor.trim())
        ? inputColor.trim().toLowerCase()
        : fallback;
      if (readThemeIsDark()) return rawColor;
      return LIGHT_THEME_MESSAGE_COLORS[rawColor] || '#13283b';
    }
    function setMessage(text, color) {
      if (!ui.messageEl) return;
      ui.messageEl.textContent = text;
      ui.messageEl.style.color = resolveMessageColor(color);
      ui.messageEl.style.opacity = text ? '1' : '0';
      if (messageBandEl) {
        messageBandEl.style.opacity = text ? '1' : '0';
        messageBandEl.style.background = resolveMessageBandBackground(readThemeIsDark());
      }
    }
    function refreshHud() {
      if (ui.scoreEl)  ui.scoreEl.textContent  = `分數：${score}`;
      if (ui.streakEl) ui.streakEl.textContent = `連進：${streak}`;
      if (onScoreChange) onScoreChange({ score, streak, shots, state });
    }
    function setChargeUiVisible(visible) {
      if (ui.powerBarEl) ui.powerBarEl.style.display = visible ? 'block' : 'none';
      if (ui.crosshairEl) ui.crosshairEl.style.display = visible ? 'block' : 'none';
    }
    function updateCrosshair() {
      if (!ui.crosshairEl) return;
      const marker = new THREE.Vector3(aim.x, aim.y, GOAL_Z);
      marker.project(camera);
      ui.crosshairEl.style.left = `${(marker.x * 0.5 + 0.5) * container.clientWidth}px`;
      ui.crosshairEl.style.top  = `${(-marker.y * 0.5 + 0.5) * container.clientHeight}px`;
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
      curveBoost = 1;
      ball.position.set(0, BALL_RADIUS, PENALTY_SPOT_Z);
      lastBallZ = ball.position.z;
      clearTrail();
      if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
      container.classList.remove('flash-hit');
      if (ui.powerFillEl) ui.powerFillEl.style.width = '0%';
      setChargeUiVisible(false);
      if (!ui.restartBtn || ui.restartBtn.style.display !== 'block') setMessage('', '#ffffff');
    }
    function endGame() {
      state = 'gameover'; charging = false;
      setChargeUiVisible(false);
      if (ui.restartBtn) ui.restartBtn.style.display = 'block';
      setMessage(`遊戲結束  分數 ${score}`, '#ffd54f');
      if (onGameOver) onGameOver({
        score,
        streak: maxStreak,
        bestStreak: maxStreak,
        shots,
        durationMs: Date.now() - sessionStartedAt,
        endedAt: new Date().toISOString(),
      });
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
      maxStreak = Math.max(maxStreak, streak);
      goalSpeed = 2.9 + Math.min(streak, 30) * 0.4;
      zoneHit.mesh.material.opacity = 0.75;
      setTimeout(() => { zoneHit.mesh.material.opacity = 0.14; }, 180);
      if (!tryShowMilestoneMessage()) setMessage(`+${gained}（${zoneHit.points}+${styleBoost} 華麗）`, '#80ff80');
      refreshHud();
      resultTimer = setTimeout(resetShot, 1200);
      return true;
    }
    function kick() {
      state = 'flying'; charging = false; shots += 1; flightTime = 0; apex = ball.position.y;
      const p = clamp(power / 100, 0, 1.3);
      const target = new THREE.Vector3(aim.x, aim.y, GOAL_Z);
      const dir = target.clone().sub(ball.position).normalize();
      const speed = 22 + p * 24;
      velocity.copy(dir.multiplyScalar(speed));
      velocity.y += 3 + p * 10;
      const sideSign = Math.abs(aim.x) > 0.05 ? Math.sign(-aim.x) : (Math.random() < 0.5 ? -1 : 1);
      const sideSpin = -aim.x * (0.24 + p * 0.26) + sideSign * Math.max(0, p - 0.95) * 0.16;
      const verticalSpin = 0.22 + p * 0.34 + Math.max(0, p - 0.9) * 0.42;
      curveBoost = 1 + p * 1.05 + Math.max(0, p - 0.9) * 1.8;
      if (power > 100) {
        const over = clamp((power - 100) / 30, 0, 1);
        velocity.x += (Math.random() - 0.5) * 12 * over;
        velocity.y += (Math.random() - 0.5) * 8 * over;
        curveBoost += 0.7 + over * 0.9;
        setMessage('超量爆發！', '#ff8a80');
      }
      spin.set(verticalSpin, sideSpin, 0);
      setChargeUiVisible(false);
      clearTrail();
      pushTrailPoint(ball.position);
      refreshHud();
    }
    function onPointerDown(event) {
      if (state !== 'aiming' || event.button !== 0) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.intersectObject(ball).length === 0) return;
      charging = true;
      power = 0;
      startPointer = { x: event.clientX, y: event.clientY };
      // Start every shot from screen-center crosshair so aiming is not "attached" to moving goal frame.
      aim = { x: AIM_START_X, y: AIM_START_Y };
      setChargeUiVisible(true); updateCrosshair();
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    }
    function onPointerMove(event) {
      if (!charging) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      aim.x = clamp(((event.clientX - startPointer.x) / rect.width) * 30, -18, 18);
      aim.y = clamp(AIM_START_Y - ((event.clientY - startPointer.y) / rect.height) * 14, -3, 12);
      updateCrosshair();
    }
    function onContextMenu(event) { event.preventDefault(); }
    function cleanupWindowListeners() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    }
    function onPointerUp() { cleanupWindowListeners(); if (charging) kick(); }
    function onPointerCancel() { cleanupWindowListeners(); charging = false; power = 0; setChargeUiVisible(false); }
    function restartGame() {
      if (resultTimer) clearTimeout(resultTimer);
      score = 0; streak = 0; shots = 0; state = 'aiming';
      maxStreak = 0;
      sessionStartedAt = Date.now();
      goalSpeed = 2.9; goalDir = 1; goalSpeedMult = 1.0;
      curveBoost = 1;
      goalBurstSteps = 0; goalBurstMult = 1.0; goalBurstDir = 1;
      goalGroup.position.x = 0;
      if (ui.restartBtn) ui.restartBtn.style.display = 'none';
      refreshHud(); resetShot(); setMessage('開始！', '#ffffff');
    }
    function step(dt) {
      if (state !== 'gameover') {
        // 速度倍率做 Ornstein–Uhlenbeck 漂移（在 1.0 附近隨機震盪）
        goalSpeedMult += (1 - goalSpeedMult) * 0.08 + (Math.random() - 0.5) * 0.25;
        goalSpeedMult = clamp(goalSpeedMult, 0.35, 1.65);
        if (goalBurstSteps <= 0 && Math.random() < GOAL_BURST_CHANCE_PER_SEC * dt) {
          goalBurstSteps = GOAL_BURST_MIN_STEPS + Math.floor(Math.random() * (GOAL_BURST_MAX_STEPS - GOAL_BURST_MIN_STEPS + 1));
          goalBurstMult = GOAL_BURST_MIN_MULT + Math.random() * (GOAL_BURST_MAX_MULT - GOAL_BURST_MIN_MULT);
          goalBurstDir = Math.random() < 0.5 ? -1 : 1;
        }
        // 每秒約 4% 機率隨機改變方向（非邊界觸發）
        if (Math.random() < 0.04 * dt * 60) goalDir = Math.random() < 0.5 ? 1 : -1;

        // 邊界保護：若已在邊緣且方向仍往外，先拉回正確方向，避免卡邊抖動。
        if (goalGroup.position.x <= GOAL_MIN_X + 0.01 && goalDir < 0) goalDir = 1;
        if (goalGroup.position.x >= GOAL_MAX_X - 0.01 && goalDir > 0) goalDir = -1;
        let moveMult = goalSpeedMult;
        if (goalBurstSteps > 0) {
          goalDir = goalBurstDir;
          moveMult *= goalBurstMult;
          goalBurstSteps -= 1;
          if (goalBurstSteps <= 0) goalBurstMult = 1.0;
        }
        goalGroup.position.x += goalDir * goalSpeed * moveMult * dt;
        if (goalGroup.position.x <= GOAL_MIN_X) {
          goalGroup.position.x = GOAL_MIN_X;
          goalDir = 1;
          if (goalBurstSteps > 0) goalBurstDir = 1;
        } else if (goalGroup.position.x >= GOAL_MAX_X) {
          goalGroup.position.x = GOAL_MAX_X;
          goalDir = -1;
          if (goalBurstSteps > 0) goalBurstDir = -1;
        }
      }
      if (state !== 'flying' && state !== 'result') return;
      flightTime += dt;
      const magnusFactor = 0.015 * clamp(curveBoost, 1, 3.8);
      const magnus = new THREE.Vector3().crossVectors(velocity, spin).multiplyScalar(magnusFactor * dt);
      velocity.add(magnus); velocity.y -= 25.8 * dt; velocity.multiplyScalar(0.997);
      curveBoost += (1 - curveBoost) * 0.028;
      ball.position.addScaledVector(velocity, dt);
      ball.rotation.x += (velocity.z * dt) / BALL_RADIUS; ball.rotation.y += spin.y * dt; ball.rotation.z -= (velocity.x * dt) / BALL_RADIUS;
      apex = Math.max(apex, ball.position.y);
      if (ball.position.y <= BALL_RADIUS) { ball.position.y = BALL_RADIUS; velocity.y *= -0.58; velocity.x *= 0.985; velocity.z *= 0.985; spin.multiplyScalar(0.9); }
      const hitGoalFrame = state === 'flying' ? resolveGoalFrameCollision() : false;
      if (state === 'flying' && !hitGoalFrame && lastBallZ > GOAL_Z && ball.position.z <= GOAL_Z && processGoalHit()) { velocity.multiplyScalar(0.28); velocity.z = Math.abs(velocity.z); }
      lastBallZ = ball.position.z;
      pushTrailPoint(ball.position);
      if (state === 'flying') {
        const stopped = velocity.length() < 1 && ball.position.y <= BALL_RADIUS + 0.04;
        const out = ball.position.z < -110 || Math.abs(ball.position.x) > 64 || flightTime > 6.5;
        if (stopped || out) { streak = 0; refreshHud(); state = 'result'; setMessage('未進球…', '#ff8a80'); resultTimer = setTimeout(endGame, 1300); }
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
          const shake = power <= 100 ? power * 0.4 : 40 + (power - 100) * 1.8;
          ui.crosshairEl.style.transform = `translate(-50%, -50%) translate(${(Math.random() - 0.5) * shake}px, ${(Math.random() - 0.5) * shake}px)`;
        }
      } else if (ui.crosshairEl) ui.crosshairEl.style.transform = 'translate(-50%, -50%)';
      accumulator = Math.min(accumulator + frameDt, 0.25);
      while (accumulator >= FIXED_DT) { step(FIXED_DT); accumulator -= FIXED_DT; }
      syncTheme();
      sanitizeBallMaterialTextures(ballMaterial);
      renderer.render(scene, camera);
    }

    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', resize);
    if (ui.restartBtn) ui.restartBtn.addEventListener('click', restartGame);
    resize(); restartGame(); animate();

    return {
      setBillboardAdImage(url) {
        const nextUrl = typeof url === 'string' ? url.trim() : '';
        if (nextUrl === billboardAdImageUrl) return;
        setBillboardAdImage(nextUrl);
      },
      destroy() {
        if (resultTimer) clearTimeout(resultTimer);
        if (flashTimer) clearTimeout(flashTimer);
        container.classList.remove('flash-hit');
        cancelAnimationFrame(rafId);
        if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onMqChange);
        container.removeEventListener('contextmenu', onContextMenu);
        container.removeEventListener('pointerdown', onPointerDown);
        cleanupWindowListeners();
        window.removeEventListener('resize', resize);
        if (ui.restartBtn) ui.restartBtn.removeEventListener('click', restartGame);
        if (createdMessageBand && messageBandEl && messageBandEl.parentNode === container) {
          container.removeChild(messageBandEl);
        }
        messageBandEl = null;
        disposeBillboardTexture();
        disposeScene(scene); renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        if (renderer.domElement && renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      },
    };
  }

  window.ShotGameEngine = { create };
})();
