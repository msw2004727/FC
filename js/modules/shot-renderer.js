/**
 * shot-renderer.js — Three.js scene construction helpers (field lines, goal, billboard)
 * Part of ShotGameEngine split. Loaded BEFORE shot-game-engine.js.
 */
(function () {
  var SGI = window._ShotGameInternal = window._ShotGameInternal || {};

  // ── Billboard constants ──
  SGI.ENABLE_GOAL_BILLBOARD = false;
  SGI.BILLBOARD_DEPTH_OFFSET = 10;
  SGI.BILLBOARD_SPACE_SCALE = Math.sqrt(8);
  SGI.BILLBOARD_WIDTH = 16.5 * SGI.BILLBOARD_SPACE_SCALE;
  SGI.BILLBOARD_HEIGHT = 4.8 * SGI.BILLBOARD_SPACE_SCALE;

  // ── Theme palettes ──
  SGI.THEME_DARK  = { sky: 0x0d1b2a, ground: 0x1b4520, trail: 0x9ed8ff };
  SGI.THEME_LIGHT = { sky: 0x88cff4, ground: 0x2f7d32, trail: 0x1d6fa8 };

  /**
   * Draw soccer field markings (goal line, penalty area, goal area, penalty spot, arc).
   */
  SGI.drawFieldLines = function (scene) {
    var GOAL_Z = SGI.GOAL_Z;
    var PENALTY_SPOT_Z = SGI.PENALTY_SPOT_Z;
    var mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    var thick = 0.3;
    var y = 0.02;
    function addLine(w, d, x, z) {
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, z);
      scene.add(mesh);
    }
    // Goal line
    addLine(80, thick, 0, GOAL_Z);

    // Penalty area (18-yard box)
    var bW = 40, bD = 36;
    addLine(thick, bD, -bW / 2, GOAL_Z + bD / 2);
    addLine(thick, bD,  bW / 2, GOAL_Z + bD / 2);
    addLine(bW + thick, thick, 0, GOAL_Z + bD);

    // Goal area (6-yard box)
    var gW = 20, gD = 11;
    addLine(thick, gD, -gW / 2, GOAL_Z + gD / 2);
    addLine(thick, gD,  gW / 2, GOAL_Z + gD / 2);
    addLine(gW + thick, thick, 0, GOAL_Z + gD);

    // Penalty spot
    var spot = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), mat);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, y, PENALTY_SPOT_Z);
    scene.add(spot);

    // Penalty arc (D)
    var arcR = 12;
    var edgeZ = GOAL_Z + bD;
    var dist  = edgeZ - PENALTY_SPOT_Z;
    if (dist < arcR) {
      var alpha  = Math.acos(dist / arcR);
      var arcGeo = new THREE.RingGeometry(arcR - thick / 2, arcR + thick / 2, 64, 1, -Math.PI / 2 - alpha, alpha * 2);
      var arcMesh = new THREE.Mesh(arcGeo, mat);
      arcMesh.rotation.x = -Math.PI / 2;
      arcMesh.position.set(0, y, PENALTY_SPOT_Z);
      scene.add(arcMesh);
    }
  };

  /**
   * Build the goal frame (posts, crossbar) and score zones with labels.
   * Returns { zones, zoneLabels }.
   */
  SGI.buildGoal = function (goalGroup, options) {
    var GOAL_POST_RADIUS = SGI.GOAL_POST_RADIUS;
    var GOAL_WIDTH = SGI.GOAL_WIDTH;
    var GOAL_HEIGHT = SGI.GOAL_HEIGHT;
    var SCORE_MAP = SGI.SCORE_MAP;
    var initialThemeDark = !!(options && options.isDark);

    function drawRoundedRect(ctx, x, y, width, height, radius) {
      var r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
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
      var canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      var texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      var material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      var sprite = new THREE.Sprite(material);
      var ctx = canvas.getContext('2d');
      var repaint = function (isDark) {
        if (!ctx) return;
        var theme = getScoreLabelTheme(isDark);
        var text = String(points);
        var panelWidth = canvas.width * 0.96;
        var panelHeight = canvas.height * 0.90;
        var panelX = (canvas.width - panelWidth) / 2;
        var panelY = (canvas.height - panelHeight) / 2;

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
      return { sprite: sprite, setTheme: repaint };
    }

    var zones = [];
    var zoneLabels = [];
    var postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    var postGeo  = new THREE.CylinderGeometry(GOAL_POST_RADIUS, GOAL_POST_RADIUS, GOAL_HEIGHT, 24);
    var crossGeo = new THREE.CylinderGeometry(GOAL_POST_RADIUS, GOAL_POST_RADIUS, GOAL_WIDTH + GOAL_POST_RADIUS * 2, 24);
    var leftPost  = new THREE.Mesh(postGeo,  postMat);
    var rightPost = new THREE.Mesh(postGeo,  postMat);
    var crossbar  = new THREE.Mesh(crossGeo, postMat);
    leftPost.position.set(-GOAL_WIDTH / 2, GOAL_HEIGHT / 2, 0);
    rightPost.position.set(GOAL_WIDTH / 2, GOAL_HEIGHT / 2, 0);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, GOAL_HEIGHT, 0);
    goalGroup.add(leftPost, rightPost, crossbar);

    var zoneW = GOAL_WIDTH / 3;
    var zoneH = GOAL_HEIGHT / 3;
    var zoneColors = [0xff5b5b, 0xffb74d, 0xffee58];
    for (var r = 0; r < 3; r += 1) {
      for (var c = 0; c < 3; c += 1) {
        var planeGeo = new THREE.PlaneGeometry(zoneW, zoneH);
        var planeMat = new THREE.MeshBasicMaterial({ color: zoneColors[r], transparent: true, opacity: 0.14, side: THREE.DoubleSide });
        var zone = new THREE.Mesh(planeGeo, planeMat);
        var relX = -GOAL_WIDTH / 2 + c * zoneW + zoneW / 2;
        var relY = GOAL_HEIGHT - r * zoneH - zoneH / 2;
        zone.position.set(relX, relY, 0);
        var edgeGeo = new THREE.EdgesGeometry(planeGeo);
        var edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
        zone.add(new THREE.LineSegments(edgeGeo, edgeMat));
        var labelSprite = buildZoneLabelSprite(SCORE_MAP[r][c]);
        labelSprite.sprite.position.set(0, 0, 0.04);
        labelSprite.sprite.scale.set(zoneW * 0.94, zoneH * 0.88, 1);
        zone.add(labelSprite.sprite);
        zoneLabels.push(labelSprite);
        goalGroup.add(zone);
        zones.push({ mesh: zone, points: SCORE_MAP[r][c], minX: relX - zoneW / 2, maxX: relX + zoneW / 2, minY: relY - zoneH / 2, maxY: relY + zoneH / 2 });
      }
    }
    return { zones: zones, zoneLabels: zoneLabels };
  };
})();
