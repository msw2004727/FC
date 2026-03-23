/* ================================================
   ColorCat — Scene Weather System
   Rain / Snow / Fog / Thunderstorm / Cloudy / Clear
   Depends: color-cat-config.js, color-cat-scene.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── Weather types & weights (cumulative) ──
var TYPES = ['clear','cloudy','rain','thunderstorm','snow','fog'];
var CUM_W = [0.40, 0.65, 0.80, 0.85, 0.95, 1.00];

// ── Constants ──
var CHANGE_MIN = 2 * 3600000, CHANGE_MAX = 6 * 3600000; // 2-6 hours ms
var RAIN_MAX = 60, SNOW_MAX = 40;
var LIGHTNING_MIN = 180, LIGHTNING_MAX = 480; // frames (~3-8s @60fps)
var LIGHTNING_DUR = 3;

// ── State ──
var _w = null;          // { type, intensity, changedAt }
var _rain = [];         // particle pool
var _snow = [];         // particle pool
var _lnTimer = 0;       // frames until next lightning
var _lnFlash = 0;       // remaining flash frames
var _nextChange = 0;    // ms timestamp for next weather change

// ── Helpers ──
function randRange(a, b) { return a + Math.random() * (b - a); }

function pickType() {
  var r = Math.random();
  for (var i = 0; i < CUM_W.length; i++) { if (r < CUM_W[i]) return TYPES[i]; }
  return 'clear';
}

function scheduleNext() {
  _nextChange = Date.now() + randRange(CHANGE_MIN, CHANGE_MAX);
}

function resetLightning() {
  _lnTimer = Math.floor(randRange(LIGHTNING_MIN, LIGHTNING_MAX));
  _lnFlash = 0;
}

// ── Particle init helpers (pool once, reuse) ──
function initRainP(p, sw) {
  p.x = Math.random() * (sw + 30) - 15;
  p.y = -Math.random() * C.SCENE_H;
  p.spd = 3.5 + Math.random() * 2.5;
  p.len = 4 + Math.random() * 4;
}

function initSnowP(p, sw) {
  p.x = Math.random() * (sw + 20) - 10;
  p.y = -Math.random() * C.SCENE_H;
  p.spd = 0.4 + Math.random() * 0.8;
  p.r = 1 + Math.random() * 2;
  p.drift = (Math.random() - 0.5) * 0.6;
  p.phase = Math.random() * 6.28;
}

function buildPool(arr, max, sw, fn) {
  arr.length = 0;
  for (var i = 0; i < max; i++) { var p = {}; fn(p, sw); arr.push(p); }
}

// ── Public API ──

_.initWeather = function(saved) {
  if (saved && saved.type && TYPES.indexOf(saved.type) !== -1) {
    _w = { type: saved.type, intensity: saved.intensity || 0.5, changedAt: saved.changedAt || Date.now() };
  } else {
    _w = { type: pickType(), intensity: 0.3 + Math.random() * 0.5, changedAt: Date.now() };
  }
  _rain.length = 0; _snow.length = 0;
  resetLightning();
  scheduleNext();
};

_.updateWeather = function(sw) {
  if (!_w) return;
  // Time-based weather change
  if (Date.now() >= _nextChange) {
    var prev = _w.type;
    _w.type = pickType();
    _w.intensity = 0.3 + Math.random() * 0.5;
    _w.changedAt = Date.now();
    if (_w.type !== prev) { _rain.length = 0; _snow.length = 0; }
    resetLightning();
    scheduleNext();
  }
  var t = _w.type;
  // Rain particles
  if (t === 'rain' || t === 'thunderstorm') {
    var need = Math.floor(RAIN_MAX * _w.intensity);
    if (_rain.length < need) buildPool(_rain, need, sw, initRainP);
    for (var i = 0; i < _rain.length; i++) {
      var p = _rain[i];
      p.y += p.spd;
      p.x -= 0.8;
      if (p.y > C.GROUND_Y) initRainP(p, sw);
    }
  }
  // Snow particles
  if (t === 'snow') {
    var sn = Math.floor(SNOW_MAX * _w.intensity);
    if (_snow.length < sn) buildPool(_snow, sn, sw, initSnowP);
    for (var j = 0; j < _snow.length; j++) {
      var s = _snow[j];
      s.y += s.spd;
      s.phase += 0.02;
      s.x += s.drift + Math.sin(s.phase) * 0.3;
      if (s.y > C.GROUND_Y) initSnowP(s, sw);
    }
  }
  // Lightning
  if (t === 'thunderstorm') {
    if (_lnFlash > 0) { _lnFlash--; }
    else {
      _lnTimer--;
      if (_lnTimer <= 0) { _lnFlash = LIGHTNING_DUR; resetLightning(); }
    }
  }
};

_.drawWeather = function(ctx, sw, light) {
  if (!_w) return;
  var t = _w.type;
  var dark = C.isThemeDark();

  // Cloudy overlay
  if (t === 'cloudy') {
    ctx.fillStyle = dark ? 'rgba(30,30,40,0.15)' : 'rgba(150,160,170,0.12)';
    ctx.fillRect(0, 0, sw, C.SCENE_H);
  }
  // Fog overlay
  if (t === 'fog') {
    var fa = 0.18 + _w.intensity * 0.22;
    ctx.fillStyle = dark ? 'rgba(20,25,35,' + fa + ')' : 'rgba(210,215,220,' + fa + ')';
    ctx.fillRect(0, 0, sw, C.SCENE_H);
  }
  // Rain
  if ((t === 'rain' || t === 'thunderstorm') && _rain.length) {
    ctx.strokeStyle = dark ? 'rgba(180,200,255,0.45)' : 'rgba(100,130,180,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < _rain.length; i++) {
      var p = _rain[i];
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 0.8, p.y + p.len);
    }
    ctx.stroke();
  }
  // Thunderstorm darkening + lightning flash
  if (t === 'thunderstorm') {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, sw, C.SCENE_H);
    if (_lnFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,240,' + (0.25 + (_lnFlash / LIGHTNING_DUR) * 0.35) + ')';
      ctx.fillRect(0, 0, sw, C.SCENE_H);
    }
  }
  // Snow
  if (t === 'snow' && _snow.length) {
    ctx.fillStyle = dark ? 'rgba(220,225,240,0.7)' : 'rgba(255,255,255,0.85)';
    for (var j = 0; j < _snow.length; j++) {
      var s = _snow[j];
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fill();
    }
  }
};

_.exportWeather = function() {
  if (!_w) return null;
  return { type: _w.type, intensity: _w.intensity, changedAt: _w.changedAt };
};

_.getWeatherType = function() {
  return _w ? _w.type : 'clear';
};

})();
