/* ================================================
   SportHub — FC Scene (Profile Banner)
   純場景背景，嵌入個人頁 #profile-slot-banner
   自動跟隨主站深淺主題，右上角顯示太陽/月亮
   ================================================ */
;(function(){
var SCENE_H = 127;

// ===== THEME DETECTION =====
function isThemeDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// ===== SUN / MOON ICONS (top-right corner) =====
function drawSunIcon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#FDB813';
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#FDB813'; ctx.lineWidth = 1.5;
  for (var i = 0; i < 8; i++) {
    var angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
    ctx.lineTo(x + Math.cos(angle) * 13, y + Math.sin(angle) * 13);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoonIcon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#F5E6B8';
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
  // Crescent cutout
  ctx.fillStyle = '#0a1628';
  ctx.beginPath(); ctx.arc(x + 4, y - 2, 7, 0, Math.PI*2); ctx.fill();
  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '6px serif';
  ctx.fillText('\u2726', x - 14, y - 4);
  ctx.fillText('\u2726', x - 8, y + 10);
  ctx.restore();
}

// ===== MAIN INIT =====
var _sceneInterval = null;

function initProfileScene(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Clean up previous instance
  if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
  container.innerHTML = '';

  // Canvas — responsive width, fixed height
  var canvas = document.createElement('canvas');
  var dpr = window.devicePixelRatio || 1;
  var cw = container.offsetWidth || 300;
  canvas.width = cw * dpr;
  canvas.height = SCENE_H * dpr;
  canvas.style.cssText = 'width:100%;height:' + SCENE_H + 'px;border-radius:var(--radius-sm);image-rendering:pixelated;display:block;';
  container.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var sw = cw;
  var groundY = SCENE_H - 20;

  function render() {
    var light = !isThemeDark();

    // Sky gradient
    var grad = ctx.createLinearGradient(0, 0, 0, SCENE_H);
    if (light) {
      grad.addColorStop(0, '#87CEEB'); grad.addColorStop(0.7, '#B0E0F0'); grad.addColorStop(1, '#4CAF50');
    } else {
      grad.addColorStop(0, '#0a1628'); grad.addColorStop(0.7, '#0f2035'); grad.addColorStop(1, '#1a3a1a');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sw, SCENE_H);

    // Ground
    ctx.fillStyle = light ? '#4CAF50' : '#1a3a1a';
    ctx.fillRect(0, groundY, sw, SCENE_H - groundY);
    ctx.fillStyle = light ? '#388E3C' : '#153015';
    for (var gx = 0; gx < sw; gx += 6) ctx.fillRect(gx, groundY, 3, 2);
    ctx.fillStyle = light ? '#66BB6A' : '#1e4a1e';
    for (var gx2 = 3; gx2 < sw; gx2 += 10) ctx.fillRect(gx2, groundY, 2, 1);

    // Field line
    ctx.fillStyle = light ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, groundY + 4, sw, 1);
    var ccx = sw / 2;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(ccx, groundY - 5, 1, 10);

    // Sun / Moon icon (top-right)
    if (light) {
      drawSunIcon(ctx, sw - 20, 18);
    } else {
      drawMoonIcon(ctx, sw - 20, 18);
    }
  }

  // Initial render
  render();

  // Re-render on theme change
  var _observer = new MutationObserver(function() { render(); });
  _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Handle resize
  function handleResize() {
    cw = container.offsetWidth || 300;
    sw = cw;
    canvas.width = cw * dpr;
    canvas.height = SCENE_H * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    render();
  }

  var _resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(handleResize, 150);
  });

  // Store observer for cleanup
  container._fcObserver = _observer;
}

function destroyProfileScene() {
  if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
  var el = document.getElementById('profile-slot-banner');
  if (el) {
    if (el._fcObserver) { el._fcObserver.disconnect(); el._fcObserver = null; }
    el.innerHTML = '';
  }
}

// ===== App Module =====
if (typeof App !== 'undefined') {
  Object.assign(App, {
    _initProfileScene: function() { initProfileScene('profile-slot-banner'); },
    _destroyProfileScene: function() { destroyProfileScene(); },
  });
}

window.FCScene = { init: initProfileScene, destroy: destroyProfileScene };
})();
