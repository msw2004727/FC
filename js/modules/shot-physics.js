/**
 * shot-physics.js — Ball physics constants, utility functions, collision helpers
 * Part of ShotGameEngine split. Loaded BEFORE shot-game-engine.js.
 */
(function () {
  const SGI = window._ShotGameInternal = window._ShotGameInternal || {};

  // ── Physics / layout constants ──
  SGI.FIXED_DT = 1 / 60;
  SGI.BALL_RADIUS = 0.55;
  SGI.GOAL_Z = -20;
  SGI.GOAL_WIDTH = 14;
  SGI.GOAL_HEIGHT = 7.2;
  SGI.GOAL_POST_RADIUS = 0.18;
  SGI.PENALTY_SPOT_Z = 12;
  SGI.TRAIL_FRAMES = 20;

  // ── Goal movement constants ──
  SGI.GOAL_BASE_SWING_BOUNDARY = 6.6;
  SGI.GOAL_SWING_RANGE_SCALE = 1.2;
  SGI.GOAL_MIN_X = -SGI.GOAL_BASE_SWING_BOUNDARY * SGI.GOAL_SWING_RANGE_SCALE;
  SGI.GOAL_MAX_X = SGI.GOAL_BASE_SWING_BOUNDARY * SGI.GOAL_SWING_RANGE_SCALE;
  SGI.GOAL_BURST_CHANCE_PER_SEC = 0.2;
  SGI.GOAL_BURST_MIN_STEPS = 6;
  SGI.GOAL_BURST_MAX_STEPS = 12;
  SGI.GOAL_BURST_MIN_MULT = 2.1;
  SGI.GOAL_BURST_MAX_MULT = 3.5;

  // ── Ball asset paths ──
  SGI.BALL_GLTF_ASSET = 'assets/ball/club-world-cup-2025/scene.gltf';
  SGI.BALL_FALLBACK_BASECOLOR = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_baseColor.png';
  SGI.BALL_FALLBACK_NORMAL = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_normal.png';
  SGI.BALL_FALLBACK_METAL_ROUGH = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_metallicRoughness.png';

  // ── Charge / crosshair constants ──
  SGI.FULL_CHARGE_SHAKE_MULTIPLIER = 5;
  SGI.CROSSHAIR_SHAKE_SCALE = 0.5;
  SGI.OVERCHARGE_CURVE_MULTIPLIER = 5;

  // ── Utility functions ──
  SGI.clamp = function (v, min, max) { return Math.max(min, Math.min(max, v)); };

  SGI.readThemeSnapshotIsDark = function () {
    var docEl = document && document.documentElement ? document.documentElement : null;
    var shotTheme = docEl && docEl.dataset ? docEl.dataset.shotTheme : '';
    if (shotTheme === 'dark') return true;
    if (shotTheme === 'light') return false;
    var siteThemeAttr = docEl && docEl.dataset ? docEl.dataset.theme : '';
    if (siteThemeAttr === 'dark') return true;
    if (siteThemeAttr === 'light') return false;
    try {
      var siteThemeStored = String(localStorage.getItem('sporthub_theme') || '').toLowerCase();
      if (siteThemeStored === 'dark') return true;
      if (siteThemeStored === 'light') return false;
    } catch (_) {}
    return typeof window.matchMedia === 'function'
      ? !!window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  };

  SGI.hasRenderableTextureImage = function (texture) {
    if (!texture || !texture.image) return false;
    var image = texture.image;
    if (typeof image.width === 'number' && typeof image.height === 'number') return image.width > 0 && image.height > 0;
    if (typeof image.videoWidth === 'number' && typeof image.videoHeight === 'number') return image.videoWidth > 0 && image.videoHeight > 0;
    return true;
  };

  SGI.disposeMaterial = function (material) {
    if (!material) return;
    Object.keys(material).forEach(function (k) { var v = material[k]; if (v && typeof v.dispose === 'function') v.dispose(); });
    if (typeof material.dispose === 'function') material.dispose();
  };

  SGI.disposeScene = function (scene) {
    scene.traverse(function (node) {
      if (node.geometry) node.geometry.dispose();
      if (Array.isArray(node.material)) node.material.forEach(SGI.disposeMaterial);
      else SGI.disposeMaterial(node.material);
    });
  };

  /**
   * Create a goal-frame collision resolver. Returns a function(ballPos, velocity, spin, goalGroupPosX) => boolean.
   * Uses pre-allocated vectors to avoid GC pressure.
   */
  SGI.createGoalFrameCollisionResolver = function () {
    var BALL_RADIUS = SGI.BALL_RADIUS;
    var GOAL_WIDTH = SGI.GOAL_WIDTH;
    var GOAL_HEIGHT = SGI.GOAL_HEIGHT;
    var GOAL_POST_RADIUS = SGI.GOAL_POST_RADIUS;
    var GOAL_Z = SGI.GOAL_Z;
    var clamp = SGI.clamp;
    var postOffset = new THREE.Vector3();
    var collisionNormal = new THREE.Vector3();
    var bestNormal = new THREE.Vector3();
    var crossbarStart = new THREE.Vector3();
    var crossbarEnd = new THREE.Vector3();
    var segmentDir = new THREE.Vector3();
    var nearestPoint = new THREE.Vector3();
    var normalComponent = new THREE.Vector3();
    var tangentComponent = new THREE.Vector3();

    function closestPointOnSegment(point, segStart, segEnd, target) {
      segmentDir.subVectors(segEnd, segStart); var lenSq = segmentDir.lengthSq();
      if (lenSq <= 1e-6) return target.copy(segStart);
      postOffset.subVectors(point, segStart); var t = clamp(postOffset.dot(segmentDir) / lenSq, 0, 1);
      return target.copy(segStart).addScaledVector(segmentDir, t);
    }

    function checkCapsule(ballPos, velocity, pX, pY0, pY1, pZ, targetDist, bestPen, fallbackNx, fallbackNy, fallbackNz) {
      crossbarStart.set(pX, pY0, pZ); crossbarEnd.set(pX, pY1, pZ);
      closestPointOnSegment(ballPos, crossbarStart, crossbarEnd, nearestPoint);
      postOffset.subVectors(ballPos, nearestPoint); var dist = postOffset.length(); var pen = targetDist - dist;
      if (pen > bestPen) {
        if (dist > 1e-6) collisionNormal.copy(postOffset).multiplyScalar(1 / dist);
        else if (velocity.lengthSq() > 1e-6) collisionNormal.copy(velocity).normalize().multiplyScalar(-1);
        else collisionNormal.set(fallbackNx, fallbackNy, fallbackNz);
        bestNormal.copy(collisionNormal); return pen;
      }
      return bestPen;
    }

    return function resolveGoalFrameCollision(ballPos, velocity, spin, goalGroupPosX) {
      var leftPostX = goalGroupPosX - GOAL_WIDTH / 2; var rightPostX = goalGroupPosX + GOAL_WIDTH / 2;
      var frameZ = GOAL_Z; var targetDist = BALL_RADIUS + GOAL_POST_RADIUS;
      var restitution = 0.58; var tangentDamping = 0.94; var collided = false;
      for (var iter = 0; iter < 2; iter += 1) {
        var bp = 0; bestNormal.set(0, 0, 0);
        bp = checkCapsule(ballPos, velocity, leftPostX, GOAL_POST_RADIUS, GOAL_HEIGHT - GOAL_POST_RADIUS, frameZ, targetDist, bp, -1, 0, 0);
        bp = checkCapsule(ballPos, velocity, rightPostX, GOAL_POST_RADIUS, GOAL_HEIGHT - GOAL_POST_RADIUS, frameZ, targetDist, bp, 1, 0, 0);
        // Crossbar (horizontal)
        crossbarStart.set(leftPostX, GOAL_HEIGHT, frameZ); crossbarEnd.set(rightPostX, GOAL_HEIGHT, frameZ);
        closestPointOnSegment(ballPos, crossbarStart, crossbarEnd, nearestPoint);
        postOffset.subVectors(ballPos, nearestPoint); var dist = postOffset.length(); var pen = targetDist - dist;
        if (pen > bp) { if (dist > 1e-6) collisionNormal.copy(postOffset).multiplyScalar(1 / dist); else if (velocity.lengthSq() > 1e-6) collisionNormal.copy(velocity).normalize().multiplyScalar(-1); else collisionNormal.set(0, -1, 0); bp = pen; bestNormal.copy(collisionNormal); }
        if (bp <= 0) break;
        collided = true; ballPos.addScaledVector(bestNormal, bp + 0.001);
        var normalSpeed = velocity.dot(bestNormal);
        if (normalSpeed < 0) { velocity.addScaledVector(bestNormal, -(1 + restitution) * normalSpeed); normalComponent.copy(bestNormal).multiplyScalar(velocity.dot(bestNormal)); tangentComponent.subVectors(velocity, normalComponent).multiplyScalar(tangentDamping); velocity.copy(normalComponent).add(tangentComponent); spin.multiplyScalar(0.92); }
      }
      return collided;
    };
  };
})();
