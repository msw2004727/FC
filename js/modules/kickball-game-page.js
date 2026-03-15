/* ================================================
   SportHub — Kickball Game Page Module (誰才是開球王)
   主站嵌入版開球遊戲，直接使用主站 auth / firebase
   ================================================ */

(function () {
  const LEADERBOARD_TOP_SIZE = 10;
  const INTRO_DISMISS_KEY = 'sporthub_kick_game_intro_dismissed';
  const LEADERBOARD_PERIOD_LABELS = { daily: '每日', weekly: '每周', monthly: '每月' };
  const THREE_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

  /* ── Utility ── */
  function formatDuration(seconds) {
    var sec = Math.max(0, Number(seconds) || 0);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function getCurrentAuthUid() {
    try { return (typeof auth !== 'undefined' && auth && auth.currentUser) ? String(auth.currentUser.uid) : ''; } catch (_) { return ''; }
  }
  function getPreferredPlayerDisplayName(user) {
    function isPlaceholder(n) { return /^玩家[\w-]{2,}$/u.test(String(n || '').trim()); }
    try {
      if (typeof LineAuth !== 'undefined' && LineAuth && typeof LineAuth.getProfile === 'function') {
        var p = LineAuth.getProfile();
        var ln = String(p && p.displayName ? p.displayName : '').trim();
        if (ln && !isPlaceholder(ln)) return ln;
      }
    } catch (_) {}
    var an = String(user && user.displayName ? user.displayName : '').trim();
    if (an && !isPlaceholder(an)) return an;
    return an || '';
  }
  function getTaipeiDateStr() {
    var t = new Date(Date.now() + 8 * 3600000);
    return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
  }
  function getTaipeiDateBucket(period) {
    var t = new Date(Date.now() + 8 * 3600000);
    var year = t.getUTCFullYear(), month = String(t.getUTCMonth() + 1).padStart(2, '0'), day = String(t.getUTCDate()).padStart(2, '0');
    if (period === 'monthly') return 'monthly_' + year + '-' + month;
    if (period === 'weekly') {
      var d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
      var dow = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dow);
      var ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      var wk = String(Math.ceil(((d - ys) / 86400000 + 1) / 7)).padStart(2, '0');
      return 'weekly_' + d.getUTCFullYear() + '-W' + wk;
    }
    return 'daily_' + year + '-' + month + '-' + day;
  }
  function isIntroSuppressed() { try { return localStorage.getItem(INTRO_DISMISS_KEY) === getTaipeiDateStr(); } catch (_) { return false; } }
  function suppressIntroToday() { try { localStorage.setItem(INTRO_DISMISS_KEY, getTaipeiDateStr()); } catch (_) {} }

  function buildRankIcon(rank) {
    if (rank === 1) return '<svg class="kg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f6c94c"/><path d="M12 5l2.1 4.2 4.6.7-3.3 3.2.8 4.6L12 15.5 7.8 17.7l.8-4.6-3.3-3.2 4.6-.7z" fill="#fff3c4"/></svg>';
    if (rank === 2) return '<svg class="kg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#adb7c4"/><path d="M12 6l5 4v8H7v-8z" fill="#e9eef5"/></svg>';
    if (rank === 3) return '<svg class="kg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#b98252"/><path d="M7 16l2.2-8h5.6l2.2 8z" fill="#f7d5b5"/></svg>';
    return '';
  }
  function normalizeRow(id, data) {
    var row = data || {};
    var rawDurSec = Number(row.bestDurationSec);
    var rawDurMs = Number(row.bestDurationMs);
    var durSec = Number.isFinite(rawDurSec) && rawDurSec > 0 ? Math.round(rawDurSec) : (Number.isFinite(rawDurMs) && rawDurMs > 0 ? Math.round(rawDurMs / 1000) : 0);
    return {
      id: String(id),
      uid: typeof row.uid === 'string' ? row.uid.trim() : '',
      nick: (typeof row.displayName === 'string' ? row.displayName.trim() : '') || ('\u73A9\u5BB6' + String(id).slice(-4)),
      distance: Number.isFinite(row.bestDistance) ? row.bestDistance : 0,
      maxSpeed: Number.isFinite(row.bestMaxSpeed) ? row.bestMaxSpeed : 0,
      durationSec: durSec,
      authProvider: typeof row.authProvider === 'string' ? row.authProvider : '',
    };
  }
  function isAnonymousRow(row) {
    if (!row) return true;
    var p = String(row.authProvider || '').toLowerCase();
    var n = String(row.nick || '').trim();
    return p === 'anonymous' || n === '匿名玩家' || n.toLowerCase() === 'anonymous';
  }
  function compareRows(a, b) {
    return b.distance - a.distance || b.maxSpeed - a.maxSpeed || a.durationSec - b.durationSec || a.nick.localeCompare(b.nick, 'zh-Hant');
  }
  function dedupeRows(rows) {
    var map = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var key = (r.uid || r.id || '').trim();
      if (!key) return;
      var prev = map.get(key);
      if (!prev || r.distance > prev.distance || (r.distance === prev.distance && r.maxSpeed > prev.maxSpeed)) map.set(key, r);
    });
    return Array.from(map.values());
  }

  /* ── Module State ── */
  var _animFrameId = null;
  var _gameInstance = null; // holds all Three.js objects
  var _lbPeriod = 'daily';
  var _lbOpen = false;
  var _lbSubmitPending = false;
  var _eventsBound = false;
  var _bestSession = null; // { distance, maxSpeed, durationMs }

  /* ── Three.js Loading ── */
  var _threeLoadPromise = null;
  function _loadThreeJs() {
    if (window.THREE) return Promise.resolve();
    if (_threeLoadPromise) return _threeLoadPromise;
    _threeLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = THREE_CDN_URL;
      s.onload = resolve;
      s.onerror = function () { _threeLoadPromise = null; reject(new Error('Three.js load failed')); };
      document.head.appendChild(s);
    });
    return _threeLoadPromise;
  }

  /* ── Leaderboard ── */
  function _renderLeaderboard(period) {
    var key = period in LEADERBOARD_PERIOD_LABELS ? period : 'daily';
    _lbPeriod = key;
    var rangeEl = document.getElementById('kg-leaderboard-range');
    var bodyEl = document.getElementById('kg-leaderboard-body');
    var playerRowEl = document.getElementById('kg-leaderboard-player-row');
    var tabs = document.querySelectorAll('#kg-leaderboard-modal .kg-lb-tab');
    if (rangeEl) rangeEl.textContent = LEADERBOARD_PERIOD_LABELS[key] + '\u6392\u884C\u524D ' + LEADERBOARD_TOP_SIZE + ' \u540D';
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-lb-period') === key;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!bodyEl) return;
    bodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">\u8F09\u5165\u4E2D\u2026</td></tr>';
    if (playerRowEl) { playerRowEl.classList.add('is-hidden'); playerRowEl.innerHTML = ''; }

    var bucket = getTaipeiDateBucket(key);
    firebase.firestore()
      .collection('kickGameRankings').doc(bucket)
      .collection('entries')
      .orderBy('bestDistance', 'desc').limit(50).get()
      .then(function (snap) {
        var rows = snap.docs.map(function (d) { return normalizeRow(d.id, d.data()); }).filter(function (r) { return !isAnonymousRow(r); });
        rows = dedupeRows(rows);
        var currentUid = getCurrentAuthUid();
        var localBest = _bestSession && _bestSession.distance > 0
          ? { distance: _bestSession.distance, maxSpeed: _bestSession.maxSpeed || 0, durationSec: Math.round((_bestSession.durationMs || 0) / 1000) }
          : null;
        var selfIds = new Set();
        if (currentUid) {
          selfIds.add(currentUid);
          var selfRow = rows.find(function (r) { return r.id === currentUid || r.uid === currentUid; });
          if (selfRow) {
            selfIds.add(selfRow.id);
            selfRow.nick = '\u4F60';
            if (localBest && localBest.distance > selfRow.distance) {
              selfRow.distance = localBest.distance;
              selfRow.maxSpeed = localBest.maxSpeed;
              selfRow.durationSec = localBest.durationSec;
            }
          } else if (localBest && _lbSubmitPending) {
            rows.push({ id: currentUid, uid: currentUid, nick: '\u4F60', distance: localBest.distance, maxSpeed: localBest.maxSpeed, durationSec: localBest.durationSec });
          }
        }
        rows.sort(compareRows);
        var ranked = rows.map(function (r, i) { return Object.assign({}, r, { rank: i + 1 }); });
        var topRows = ranked.slice(0, LEADERBOARD_TOP_SIZE);
        var playerRow = ranked.find(function (r) { return selfIds.has(r.id); }) || null;
        var extraPlayerRow = playerRow && playerRow.rank > LEADERBOARD_TOP_SIZE ? playerRow : null;
        if (topRows.length === 0) {
          bodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">\u5C1A\u7121\u6392\u884C\u8CC7\u6599</td></tr>';
          return;
        }
        bodyEl.innerHTML = topRows.map(function (row) {
          var rc = row.rank <= 3 ? ' class="kg-lb-row-top' + row.rank + '"' : '';
          var rl = row.rank <= 3
            ? '<span class="kg-lb-rank-badge">' + buildRankIcon(row.rank) + '<span>' + row.rank + '</span></span>'
            : '#' + row.rank;
          return '<tr' + rc + '>'
            + '<td class="kg-lb-rank">' + rl + '</td>'
            + '<td class="kg-lb-nick"><span class="kg-lb-name-pill" title="' + escapeHtml(row.nick) + '">' + escapeHtml(row.nick) + '</span></td>'
            + '<td class="kg-lb-dist">' + row.distance.toFixed(2) + ' m</td>'
            + '<td>' + row.maxSpeed.toFixed(1) + '</td>'
            + '<td>' + formatDuration(row.durationSec) + '</td>'
            + '</tr>';
        }).join('');
        if (!playerRowEl) return;
        if (extraPlayerRow) {
          var r = extraPlayerRow;
          playerRowEl.classList.remove('is-hidden');
          playerRowEl.innerHTML = '<h4>\u4F60\u7684\u540D\u6B21</h4>'
            + '<table style="width:100%;border-collapse:collapse;table-layout:fixed"><colgroup>'
            + '<col class="kg-lb-col-rank"><col class="kg-lb-col-nick"><col class="kg-lb-col-dist"><col class="kg-lb-col-speed"><col class="kg-lb-col-time">'
            + '</colgroup><tbody><tr>'
            + '<td class="kg-lb-rank">#' + r.rank + '</td>'
            + '<td class="kg-lb-nick"><span class="kg-lb-name-pill" title="' + escapeHtml(r.nick) + '">' + escapeHtml(r.nick) + '</span></td>'
            + '<td class="kg-lb-dist">' + r.distance.toFixed(2) + ' m</td>'
            + '<td>' + r.maxSpeed.toFixed(1) + '</td>'
            + '<td>' + formatDuration(r.durationSec) + '</td>'
            + '</tr></tbody></table>';
        } else {
          playerRowEl.classList.add('is-hidden');
          playerRowEl.innerHTML = '';
        }
      })
      .catch(function () {
        bodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">\u8B80\u53D6\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66</td></tr>';
      });
  }
  function _openLeaderboard(period) {
    var modal = document.getElementById('kg-leaderboard-modal');
    if (!modal) return;
    _renderLeaderboard(period || _lbPeriod);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    _lbOpen = true;
  }
  function _closeLeaderboard() {
    var modal = document.getElementById('kg-leaderboard-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    _lbOpen = false;
  }

  /* ── Score Submission ── */
  function _submitScore(payload) {
    var user = typeof auth !== 'undefined' ? auth.currentUser : null;
    if (!payload || payload.distance <= 0 || !user) return;
    _lbSubmitPending = true;
    firebase.app().functions('asia-east1').httpsCallable('submitKickGameScore')({
      distance: payload.distance,
      maxSpeed: payload.maxSpeed,
      kicks: payload.kicks || 3,
      durationMs: payload.durationMs,
      displayName: getPreferredPlayerDisplayName(user),
    }).catch(function () {}).finally(function () {
      _lbSubmitPending = false;
      if (_lbOpen) _renderLeaderboard(_lbPeriod);
    });
  }

  /* ════════════════════════════════════════════════
     Embedded Game Engine (refactored from standalone)
     All variables scoped inside this IIFE — no globals.
     ════════════════════════════════════════════════ */
  function _createGame(containerEl) {
    var THREE = window.THREE;
    var scene, camera, renderer, ball, ground, dirLight;
    var raycaster, mouse;
    var gameState = 'aiming';
    var aimTarget = { x: 0, y: 0 }, aimTime = 0, charging = false, power = 0, powerDir = 1;
    var shotsLeft = 3, bestDistance = 0, currentDistance = 0, resultTimer = null;
    var lastKickGrade = 'GOOD', distanceAtShotStart = 0, bonusDistance = 0;
    var shotCameraHold = 0, cameraModeBlend = 1, landingCameraDamp = 0, timeScale = 1, slowMoTimer = 0, cameraShakeTimer = 0, cameraShakeStrength = 0;
    var displayedDistance = 0, displayedSpeedKmh = 0, hasTriggeredLandingRing = false, hasKickedOnce = false;
    var SPEED_DISPLAY_FACTOR = 1.45;
    var ballRadius = 1.2, realBallDiameterMeters = 0.22, unitsPerMeter = (ballRadius * 2.0) / realBallDiameterMeters;
    var lastValidStart = new THREE.Vector3(0, ballRadius, 0), velocity = new THREE.Vector3(), spin = new THREE.Vector3();
    var cameraLookTarget = new THREE.Vector3(), cameraDesiredPosition = new THREE.Vector3();
    var gravity = 24.0, airDrag = 0.9965, magnusScale = 0.0024, sideSpinAirDecay = 0.996, spinAirDecay = 0.9975, lateralFriction = 0.975;
    var clock = new THREE.Clock(), FIXED_DT = 1 / 120, accumulator = 0;
    var terrainBumps = [];
    var windX = 0, windZ = 0, windStrength = 0, windAngle = 0;
    var maxSpeedThisGame = 0;
    var bestMaxSpeed = 0;
    var gameStartTime = 0;
    var destroyed = false;
    // Camera control state
    var camYaw = 0, camPitch = 0, camZoom = 0;
    var camDragging = false, camDragStartX = 0, camDragStartY = 0;
    var camPinchDist = 0, camTouchCX = 0, camTouchCY = 0, camTouching = false;

    // DOM refs inside container
    var maxHeightThisKick = 0, displayedHeight = 0;
    var msgEl, bestDistEl, bestSpeedEl, focusDistEl, focusHeightEl, focusSpeedEl, shotsLeftEl, windEl;
    var restartBtn, floatingUI, aimRadar, aimDot, powerWrap, powerFill, virtualBallEl;
    var flashOverlay, impactRing, gradePop, shotTypePop, firstTipEl;

    function _buildUI() {
      containerEl.innerHTML = ''
        + '<div id="kg-flash-overlay" style="position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,.82) 0%,rgba(255,255,255,.34) 34%,rgba(255,255,255,0) 74%);opacity:0;pointer-events:none;z-index:80;transition:opacity .14s ease-out"></div>'
        + '<div id="kg-impact-ring" style="position:absolute;width:80px;height:80px;margin-left:-40px;margin-top:-40px;border:3px solid rgba(255,255,255,.7);border-radius:50%;opacity:0;transform:scale(.35);pointer-events:none;z-index:45;transition:transform .22s ease-out,opacity .22s ease-out"></div>'
        + '<div id="kg-grade-pop" style="position:absolute;left:50%;top:24%;transform:translate(-50%,-50%) scale(.9);color:#fff;font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.72);opacity:0;pointer-events:none;transition:opacity .16s ease-out,transform .22s ease-out;z-index:85;font-size:clamp(30px,5.5vw,52px)"></div>'
        + '<div id="kg-shot-type-pop" style="position:absolute;left:50%;top:33%;transform:translate(-50%,-50%) scale(.9);color:#fff;font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.72);opacity:0;pointer-events:none;transition:opacity .16s ease-out,transform .22s ease-out;z-index:70;font-size:clamp(22px,4.2vw,36px)"></div>'
        + '<div id="kg-first-tip" style="position:absolute;left:50%;bottom:calc(12% + clamp(52px,13vw,72px) + 1.2em);transform:translateX(-50%);color:rgba(255,236,170,.94);font-size:clamp(18px,3.5vw,28px);font-weight:800;text-shadow:0 2px 10px rgba(0,0,0,.75);opacity:0;pointer-events:none;z-index:65;transition:opacity .2s ease-out;white-space:nowrap">\u9EDE\u7403\u9577\u6309\u958B\u59CB</div>'
        + '<div id="kg-floating-ui" style="position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:12px;z-index:20;pointer-events:none;opacity:0;transition:opacity .15s">'
        + '  <div id="kg-aim-radar" style="position:relative;width:100px;height:100px;border-radius:50%;border:4px solid rgba(255,255,255,.25);background:rgba(255,255,255,.03);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 0 12px rgba(0,0,0,.35);overflow:hidden">'
        + '    <div id="kg-aim-dot" style="position:absolute;width:20px;height:20px;border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(55,55,55,.62);border:3px solid rgba(255,255,255,.95);box-shadow:0 0 8px rgba(0,0,0,.28)"></div>'
        + '  </div>'
        + '  <div id="kg-power-wrap" style="width:156px;height:22px;border-radius:11px;overflow:hidden;border:2px solid #fff;background:rgba(0,0,0,.75);display:none">'
        + '    <div id="kg-power-fill" style="width:0%;height:100%;background:linear-gradient(90deg,#00bfff 0%,#0057a0 78%,#ff7a00 92%,#ff0000 100%)"></div>'
        + '  </div>'
        + '</div>'
        // Session Badge Card (top-center)
        + '<div id="kg-session-badge">'
        + '  <div class="kg-session-top-title">\u672C\u5C40\u8A18\u9304</div>'
        + '  <div class="kg-session-focus-row">'
        + '    <div class="kg-session-focus-box kg-session-focus-box-dist">'
        + '      <div class="kg-session-focus-label">\u8DDD\u96E2</div>'
        + '      <div class="kg-session-focus-value" id="kg-focus-dist">0.00</div>'
        + '      <div class="kg-session-focus-unit">m</div>'
        + '    </div>'
        + '    <div class="kg-session-focus-box kg-session-focus-box-height">'
        + '      <div class="kg-session-focus-label">\u9AD8\u5EA6</div>'
        + '      <div class="kg-session-focus-value" id="kg-focus-height">0.00</div>'
        + '      <div class="kg-session-focus-unit">m</div>'
        + '    </div>'
        + '    <div class="kg-session-focus-box kg-session-focus-box-speed">'
        + '      <div class="kg-session-focus-label">\u7403\u901F</div>'
        + '      <div class="kg-session-focus-value" id="kg-focus-speed">0.00</div>'
        + '      <div class="kg-session-focus-unit">km/h</div>'
        + '    </div>'
        + '  </div>'
        + '  <div class="kg-session-info">'
        + '    <span>\u5269\u9918\u8173\u6578: <span id="kg-shots-left">3</span></span>'
        + '    <span class="kg-session-sep">\uFF5C</span>'
        + '    <span id="kg-wind">\u7121\u98A8</span>'
        + '  </div>'
        + '  <div class="kg-session-title">\u7576\u524D\u6700\u4F73\u8A18\u9304</div>'
        + '  <div class="kg-session-best">'
        + '    <span id="kg-best-dist">--</span>m'
        + '    <span class="kg-session-sep">|</span>'
        + '    \u7403\u901F <span id="kg-best-speed">--</span>km/h'
        + '  </div>'
        + '</div>'
        // Floating message + restart
        + '<div id="kg-msg" style="position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);color:#fff;font-size:clamp(22px,5vw,34px);font-weight:bold;text-shadow:0 2px 10px rgba(0,0,0,.9);text-align:center;opacity:0;transition:opacity .22s;white-space:pre-line;z-index:10;pointer-events:none"></div>'
        + '<div style="position:absolute;bottom:70px;left:50%;transform:translateX(-50%);z-index:10"><button id="kg-restart" style="display:none;border:0;border-radius:10px;padding:14px 34px;background:#e53935;color:#fff;font-weight:bold;font-size:19px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)">\u91CD\u65B0\u6311\u6230</button></div>'
        // Virtual kick button (easier to tap on mobile)
        + '<div id="kg-virtual-ball" style="position:absolute;left:50%;bottom:12%;transform:translateX(-50%);width:clamp(52px,13vw,72px);height:clamp(52px,13vw,72px);border-radius:50%;background:radial-gradient(circle at 38% 36%,rgba(255,255,255,.38),rgba(255,255,255,.08) 55%,rgba(0,0,0,.12));border:2.5px solid rgba(255,255,255,.45);box-shadow:0 0 18px rgba(0,180,255,.25),inset 0 -3px 8px rgba(0,0,0,.18);cursor:pointer;z-index:18;pointer-events:auto;transition:opacity .18s;display:flex;align-items:center;justify-content:center;font-size:clamp(46px,12vw,66px);line-height:0;user-select:none;overflow:hidden;padding-bottom:2px">\u26BD</div>'
        // Bottom buttons: restart (left) + leaderboard (right)
        + '<div style="position:absolute;left:10px;bottom:8px;z-index:15"><button id="kg-restart-inline" class="kg-lb-btn kg-restart-bottom-btn" type="button">\u91CD\u65B0\u958B\u59CB</button></div>'
        + '<div style="position:absolute;right:10px;bottom:8px;z-index:15"><button id="kg-leaderboard-btn-inner" class="kg-lb-btn" type="button">\u958B\u7403\u699C</button></div>';

      msgEl = containerEl.querySelector('#kg-msg');
      bestDistEl = containerEl.querySelector('#kg-best-dist');
      bestSpeedEl = containerEl.querySelector('#kg-best-speed');
      focusDistEl = containerEl.querySelector('#kg-focus-dist');
      focusHeightEl = containerEl.querySelector('#kg-focus-height');
      focusSpeedEl = containerEl.querySelector('#kg-focus-speed');
      shotsLeftEl = containerEl.querySelector('#kg-shots-left');
      windEl = containerEl.querySelector('#kg-wind');
      restartBtn = containerEl.querySelector('#kg-restart');
      var restartInlineBtn = containerEl.querySelector('#kg-restart-inline');
      floatingUI = containerEl.querySelector('#kg-floating-ui');
      aimRadar = containerEl.querySelector('#kg-aim-radar');
      aimDot = containerEl.querySelector('#kg-aim-dot');
      powerWrap = containerEl.querySelector('#kg-power-wrap');
      powerFill = containerEl.querySelector('#kg-power-fill');
      flashOverlay = containerEl.querySelector('#kg-flash-overlay');
      impactRing = containerEl.querySelector('#kg-impact-ring');
      gradePop = containerEl.querySelector('#kg-grade-pop');
      shotTypePop = containerEl.querySelector('#kg-shot-type-pop');
      firstTipEl = containerEl.querySelector('#kg-first-tip');

      restartBtn.addEventListener('click', resetGame);
      restartInlineBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      restartInlineBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); resetGame(); });
      // Leaderboard button inside container
      var lbBtnInner = containerEl.querySelector('#kg-leaderboard-btn-inner');
      if (lbBtnInner) {
        lbBtnInner.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        lbBtnInner.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); _openLeaderboard(_lbPeriod); });
      }
      // Virtual ball button (tap shortcut for mobile)
      virtualBallEl = containerEl.querySelector('#kg-virtual-ball');
      if (virtualBallEl) {
        virtualBallEl.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          if (gameState === 'aiming') {
            gameState = 'charging'; charging = true; power = 0; powerDir = 1;
            aimRadar.classList.add('locked'); powerWrap.style.display = 'block';
          }
        });
      }
      containerEl.addEventListener('pointerdown', onPointerDown);
      containerEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      window.addEventListener('pointerup', _onPointerUp);
      // Camera controls: right-click orbit + wheel zoom (desktop), two-finger orbit + pinch (mobile)
      containerEl.addEventListener('mousedown', function (e) { if (e.button === 2) { camDragging = true; camDragStartX = e.clientX; camDragStartY = e.clientY; } });
      window.addEventListener('mousemove', _onCamMouseMove);
      window.addEventListener('mouseup', _onCamMouseUp);
      containerEl.addEventListener('wheel', _onCamWheel, { passive: false });
      containerEl.addEventListener('touchstart', _onCamTouchStart, { passive: false });
      containerEl.addEventListener('touchmove', _onCamTouchMove, { passive: false });
      containerEl.addEventListener('touchend', _onCamTouchEnd);
    }
    function _onCamMouseMove(e) { if (!camDragging || destroyed) return; camYaw += (e.clientX - camDragStartX) * 0.004; camPitch += (e.clientY - camDragStartY) * 0.003; camPitch = clamp(camPitch, -0.5, 0.8); camDragStartX = e.clientX; camDragStartY = e.clientY; }
    function _onCamMouseUp(e) { if (e.button === 2) camDragging = false; }
    function _onCamWheel(e) { if (destroyed) return; camZoom = clamp(camZoom + e.deltaY * 0.0008, -0.4, 0.5); e.preventDefault(); }
    function _onCamTouchStart(e) { if (e.touches.length >= 2) { e.preventDefault(); camTouching = true; var t0 = e.touches[0], t1 = e.touches[1]; camPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); camTouchCX = (t0.clientX + t1.clientX) / 2; camTouchCY = (t0.clientY + t1.clientY) / 2; } }
    function _onCamTouchMove(e) { if (e.touches.length >= 2) { e.preventDefault(); var t0 = e.touches[0], t1 = e.touches[1]; var d = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); var cx = (t0.clientX + t1.clientX) / 2, cy = (t0.clientY + t1.clientY) / 2; if (camPinchDist > 0) camZoom = clamp(camZoom - (d - camPinchDist) * 0.002, -0.4, 0.5); camYaw += (cx - camTouchCX) * 0.004; camPitch += (cy - camTouchCY) * 0.003; camPitch = clamp(camPitch, -0.5, 0.8); camPinchDist = d; camTouchCX = cx; camTouchCY = cy; } }
    function _onCamTouchEnd(e) { if (e.touches.length < 2) { camTouching = false; camPinchDist = 0; } }

    function showMessage(text, color, ms) {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.style.color = color || '#fff';
      msgEl.style.opacity = '1';
      setTimeout(function () { if (gameState !== 'gameover') msgEl.style.opacity = '0'; }, ms || 2200);
    }
    function showGrade(text, color) {
      gradePop.textContent = text; gradePop.style.color = color;
      gradePop.style.opacity = '1'; gradePop.style.transform = 'translate(-50%,-50%) scale(1.06)';
      setTimeout(function () { gradePop.style.opacity = '0'; gradePop.style.transform = 'translate(-50%,-50%) scale(1.14)'; }, 620);
    }
    function showShotType(text) {
      shotTypePop.textContent = text; shotTypePop.style.opacity = '1'; shotTypePop.style.transform = 'translate(-50%,-50%) scale(1)';
      setTimeout(function () { shotTypePop.style.opacity = '0'; shotTypePop.style.transform = 'translate(-50%,-50%) scale(1.04)'; }, 2000);
    }
    function triggerFlash(strength) {
      flashOverlay.style.opacity = String(Math.min(1, 0.42 + (strength || 1) * 0.34));
      setTimeout(function () { flashOverlay.style.opacity = '0'; }, 120);
    }
    function triggerImpactRing(worldPos) {
      var p = worldPos.clone().project(camera);
      var cw = containerEl.offsetWidth, ch = containerEl.offsetHeight;
      impactRing.style.left = ((p.x * 0.5 + 0.5) * cw) + 'px';
      impactRing.style.top = ((-(p.y * 0.5) + 0.5) * ch) + 'px';
      impactRing.style.opacity = '0.9'; impactRing.style.transform = 'scale(.35)';
      requestAnimationFrame(function () { impactRing.style.opacity = '0'; impactRing.style.transform = 'scale(1.45)'; });
    }
    function classifyShotType(cx, cy, speed) {
      var ax = Math.abs(cx);
      if (ax >= 0.42) return cx < 0 ? '\u53F3\u5F4E\u7403' : '\u5DE6\u5F4E\u7403';
      if (cy <= -0.28) return speed >= 95 ? '\u9AD8\u540A\u7832' : '\u9AD8\u540A\u7403';
      if (cy >= 0.3) return speed >= 90 ? '\u4F4E\u5E73\u7832' : '\u4F4E\u5E73\u7403';
      if (speed >= 92) return '\u91CD\u7832\u76F4\u7403';
      return '\u76F4\u7DDA\u62BD\u5C04';
    }
    function triggerJuice(grade, pv) {
      var pr = clamp(((pv || 100) - 90) / 10, 0, 1);
      if (grade === 'PERFECT') { triggerFlash(0.75 + pr * 0.25); showGrade('PERFECT', '#ffd54a'); cameraShakeTimer = 0.10 + pr * 0.07; cameraShakeStrength = 0.12 + pr * 0.14; slowMoTimer = 0.05 + pr * 0.04; }
      else if (grade === 'GREAT') { triggerFlash(0.48 + pr * 0.28); showGrade('GREAT', '#7ee787'); cameraShakeTimer = 0.07 + pr * 0.05; cameraShakeStrength = 0.06 + pr * 0.08; slowMoTimer = 0.032 + pr * 0.03; }
      else if ((pv || 0) >= 90) { triggerFlash(0.28 + pr * 0.24); showGrade('GOOD', '#fff'); cameraShakeTimer = 0.05 + pr * 0.04; cameraShakeStrength = 0.035 + pr * 0.045; slowMoTimer = 0.022 + pr * 0.02; }
    }

    // ── Textures ──
    var BALL_TEXTURE_URL = 'assets/ball/club-world-cup-2025/textures/Al_Rihla_baseColor.png';
    function loadBallTexture(material) {
      var loader = new THREE.TextureLoader();
      loader.load(BALL_TEXTURE_URL, function (tex) {
        tex.encoding = THREE.sRGBEncoding;
        tex.flipY = true;
        tex.needsUpdate = true;
        material.map = tex;
        material.needsUpdate = true;
      }, undefined, function () {
        // fallback: canvas-drawn texture
        var c = document.createElement('canvas'); c.width = 512; c.height = 512;
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = '#303030'; ctx.lineWidth = 10;
        for (var i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc(Math.random() * 512, Math.random() * 512, 58, 0, Math.PI * 2); ctx.stroke(); }
        material.map = new THREE.CanvasTexture(c);
        material.needsUpdate = true;
      });
    }
    function createGrassTexture() {
      var c = document.createElement('canvas'); c.width = 1024; c.height = 2048; var ctx = c.getContext('2d');
      var bandCount = 36, bandPx = c.height / bandCount, lA = '#2f8a36', lB = '#347c3a';
      for (var i = 0; i < bandCount; i++) { ctx.fillStyle = (i % 2 === 0) ? lA : lB; ctx.fillRect(0, i * bandPx, c.width, Math.ceil(bandPx)); }
      for (var j = 0; j < 2200; j++) { ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.03) + ')'; ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1 + Math.random() * 2); }
      var tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(8, 1); return tex;
    }
    function createSkyTexture() {
      var c = document.createElement('canvas'); c.width = 32; c.height = 512; var ctx = c.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#6eaee8'); g.addColorStop(0.42, '#90c0ea'); g.addColorStop(0.72, '#b6d6e7'); g.addColorStop(1, '#d7e4db');
      ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height); return new THREE.CanvasTexture(c);
    }

    // ── Terrain ──
    function getTerrainHeightAt(x, z) {
      var h = 0;
      for (var i = 0; i < terrainBumps.length; i++) { var b = terrainBumps[i], dx = x - b.x, dz = z - b.z, dist = Math.sqrt(dx * dx + dz * dz); if (dist < b.radius) h += b.height * (1 - dist / b.radius); }
      return h;
    }
    function getTerrainNormalAt(x, z) {
      var nx = 0, nz = 0;
      for (var i = 0; i < terrainBumps.length; i++) { var b = terrainBumps[i], dx = x - b.x, dz = z - b.z, dist = Math.sqrt(dx * dx + dz * dz); if (dist > 0.01 && dist < b.radius) { var f = b.height / (b.radius * dist); nx += f * dx; nz += f * dz; } }
      var len = Math.sqrt(nx * nx + 1 + nz * nz); return new THREE.Vector3(nx / len, 1 / len, nz / len);
    }
    function generateTerrainBumps() {
      terrainBumps = [];
      for (var i = 0; i < 8; i++) terrainBumps.push({ x: (Math.random() - 0.5) * 200, z: -(30 + Math.random() * 270) * unitsPerMeter, radius: 8 + Math.random() * 14, height: 0.18 + Math.random() * 0.22 });
    }

    // ── Build Scene ──
    function buildField() {
      ground = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, (10 + 350) * unitsPerMeter, 120, 120),
        new THREE.MeshLambertMaterial({ map: createGrassTexture(), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.z = -((350 * unitsPerMeter) / 2) + (10 * unitsPerMeter) / 2;
      ground.receiveShadow = true;
      scene.add(ground);
      // start line
      var sl = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1.2), new THREE.MeshBasicMaterial({ color: 0xfff38a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }));
      sl.rotation.x = -Math.PI / 2; sl.position.set(0, 0.04, 0); scene.add(sl);
      // center mark
      var cm = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }));
      cm.rotation.x = -Math.PI / 2; cm.position.set(0, 0.05, 0); scene.add(cm);
      // distance markers
      for (var m = 25; m <= 350; m += 25) {
        var z = -m * unitsPerMeter, nc = document.createElement('canvas'); nc.width = 2048; nc.height = 512;
        var nctx = nc.getContext('2d'); nctx.fillStyle = 'rgba(255,255,255,0.98)'; nctx.font = 'bold 420px Arial'; nctx.textAlign = 'center'; nctx.textBaseline = 'middle'; nctx.fillText(String(m), 1024, 256);
        var tex = new THREE.CanvasTexture(nc), mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
        for (var xx = -1820; xx <= 1820; xx += 165) {
          var mesh = new THREE.Mesh(new THREE.PlaneGeometry(290, 42), mat.clone()); mesh.rotation.x = -Math.PI / 2; mesh.position.set(xx, 0.045, z - 21); scene.add(mesh);
        }
      }
    }
    function initScene() {
      scene = new THREE.Scene();
      scene.background = createSkyTexture();
      scene.fog = new THREE.FogExp2(0xc9ddd9, 0.00125);
      camera = new THREE.PerspectiveCamera(60, containerEl.offsetWidth / containerEl.offsetHeight, 0.1, 5000);
      camera.position.set(0, 37.5, 216);
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(containerEl.offsetWidth, containerEl.offsetHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      containerEl.insertBefore(renderer.domElement, containerEl.firstChild);
      scene.add(new THREE.AmbientLight(0xffffff, 0.42));
      dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
      dirLight.position.set(70, 110, 45); dirLight.castShadow = true;
      dirLight.shadow.mapSize.set(1024, 1024);
      dirLight.shadow.camera.left = -180; dirLight.shadow.camera.right = 180; dirLight.shadow.camera.top = 180; dirLight.shadow.camera.bottom = -180;
      scene.add(dirLight); scene.add(dirLight.target);
      buildField();
      var ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
      loadBallTexture(ballMat);
      ball = new THREE.Mesh(new THREE.SphereGeometry(ballRadius, 32, 32), ballMat);
      ball.castShadow = true; ball.position.set(0, ballRadius, 0); scene.add(ball);
      raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();
    }

    // ── Input ──
    function onPointerDown(e) {
      if (e.button && e.button !== 0) return;
      var r = containerEl.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.intersectObject(ball).length && gameState === 'aiming') {
        gameState = 'charging'; charging = true; power = 0; powerDir = 1;
        aimRadar.classList.add('locked'); powerWrap.style.display = 'block';
      }
    }
    function _onPointerUp() {
      if (!charging || destroyed) return;
      charging = false; gameState = 'flying';
      shotCameraHold = 0.45; cameraModeBlend = 1; landingCameraDamp = 0; hasTriggeredLandingRing = false;
      var powerDiff = Math.abs(power - 100), aimAcc = 1 - Math.min(1, Math.hypot(aimTarget.x, aimTarget.y) / 1.2), grade = 'GOOD';
      if (powerDiff <= 3 && aimAcc >= 0.68) grade = 'PERFECT';
      else if (powerDiff <= 8 && aimAcc >= 0.42) grade = 'GREAT';
      if (!hasKickedOnce) { hasKickedOnce = true; if (firstTipEl) firstTipEl.style.opacity = '0'; }
      lastKickGrade = grade; triggerJuice(grade, power); kickBall();
    }

    // ── Game Logic ──
    function initWind() {
      var tiers = [0, 2.5, 5.0, 8.0]; windStrength = tiers[Math.floor(Math.random() * 4)];
      windAngle = Math.random() * Math.PI * 2;
      windX = Math.sin(windAngle) * windStrength; windZ = -Math.cos(windAngle) * windStrength;
      if (windStrength === 0) { windEl.textContent = '\u7121\u98A8'; return; }
      var arrows = ['\u2191','\u2197','\u2192','\u2198','\u2193','\u2199','\u2190','\u2196'];
      var idx = Math.round(windAngle * 4 / Math.PI) & 7;
      var tl = ['\u7121','\u5FAE','\u4E2D','\u5F37'];
      windEl.textContent = arrows[idx] + ' ' + tl[tiers.indexOf(windStrength)] + '\u98A8';
    }
    function resetBallAndState() {
      velocity.set(0, 0, 0); spin.set(0, 0, 0);
      ball.position.copy(lastValidStart);
      ball.position.y = getTerrainHeightAt(ball.position.x, ball.position.z) + ballRadius;
      ball.rotation.set(0, 0, 0);
      camera.position.set(ball.position.x, 37.5, ball.position.z + 216);
      cameraLookTarget.set(ball.position.x, ball.position.y + 0.3, ball.position.z - 0.6);
      cameraDesiredPosition.copy(camera.position);
      gameState = 'aiming'; shotCameraHold = 0; cameraModeBlend = 1; landingCameraDamp = 0;
      timeScale = 1; slowMoTimer = 0; cameraShakeTimer = 0; cameraShakeStrength = 0;
      hasTriggeredLandingRing = false;
      displayedDistance = Math.max(0, -ball.position.z) / unitsPerMeter; displayedSpeedKmh = 0; maxHeightThisKick = 0; displayedHeight = 0;
      aimRadar.classList.remove('locked'); powerWrap.style.display = 'none'; powerFill.style.width = '0%';
      if (firstTipEl) firstTipEl.style.opacity = hasKickedOnce ? '0' : '1';
    }
    function resetGame() {
      if (resultTimer) clearTimeout(resultTimer);
      shotsLeft = 3; currentDistance = 0; maxSpeedThisGame = 0; gameStartTime = Date.now();
      lastValidStart.set(0, ballRadius, 0);
      focusDistEl.textContent = '0.00';
      focusHeightEl.textContent = '0.00';
      focusSpeedEl.textContent = '0.00';
      shotsLeftEl.textContent = '3';
      restartBtn.style.display = 'none'; msgEl.style.opacity = '0';
      hasKickedOnce = false; bonusDistance = 0; lastKickGrade = 'GOOD'; distanceAtShotStart = 0;
      initWind(); generateTerrainBumps(); resetBallAndState();
    }
    function finishShot() {
      var rawShotDist = (currentDistance + bonusDistance) - distanceAtShotStart;
      var mult = lastKickGrade === 'PERFECT' ? (1.06 + Math.random() * 0.06) : lastKickGrade === 'GREAT' ? (1.02 + Math.random() * 0.04) : 1.0;
      bonusDistance += rawShotDist * (mult - 1.0);
      var totalDist = currentDistance + bonusDistance;
      shotsLeft -= 1;
      lastValidStart.set(0, ballRadius, ball.position.z);
      shotsLeftEl.textContent = String(shotsLeft);
      if (shotsLeft > 0) {
        var bonusStr = mult > 1.0 ? '\n+' + (rawShotDist * (mult - 1.0)).toFixed(2) + 'm ' + lastKickGrade + ' \u734E\u52F5' : '';
        showMessage('\u76EE\u524D\u63A8\u9032\u81F3 ' + totalDist.toFixed(2) + ' m\n\u6E96\u5099\u4E0B\u4E00\u8173' + bonusStr, '#00ff88', 1800);
        resultTimer = setTimeout(resetBallAndState, 1900);
      } else {
        gameState = 'gameover';
        var durationMs = Date.now() - gameStartTime;
        if (totalDist > bestDistance) {
          bestDistance = totalDist;
          if (maxSpeedThisGame > bestMaxSpeed) bestMaxSpeed = maxSpeedThisGame;
          bestDistEl.textContent = bestDistance.toFixed(2);
          bestSpeedEl.textContent = bestMaxSpeed.toFixed(2);
          showMessage('\uD83C\uDF89 \u65B0\u7D00\u9304\uFF01\n\u7E3D\u8A08 ' + totalDist.toFixed(2) + ' m', '#ffd700', 3000);
        } else {
          if (maxSpeedThisGame > bestMaxSpeed) {
            bestMaxSpeed = maxSpeedThisGame;
            bestSpeedEl.textContent = bestMaxSpeed.toFixed(2);
          }
          showMessage('\u6311\u6230\u7D50\u675F\n\u7E3D\u8A08 ' + totalDist.toFixed(2) + ' m', '#ffffff', 3000);
        }
        restartBtn.style.display = 'inline-block';
        // Report to parent module
        var payload = { distance: Math.round(totalDist * 100) / 100, maxSpeed: Math.round(maxSpeedThisGame * 100) / 100, kicks: 3, durationMs: durationMs };
        if (!_bestSession || payload.distance > _bestSession.distance) _bestSession = payload;
        _submitScore(payload);
      }
    }
    function kickBall() {
      distanceAtShotStart = currentDistance + bonusDistance;
      var p = power / 100, cx = clamp(aimTarget.x, -0.9, 0.9), cy = clamp(aimTarget.y, -0.9, 0.9);
      var offCenter = Math.min(1, Math.hypot(cx, cy)), efficiency = 1 - offCenter * 0.06;
      var upperCZ = Math.max(0, cy) * (1 - Math.min(1, Math.abs(cx) / 0.42));
      var fwd = ((108 + p * 168) * efficiency + upperCZ * (16 + p * 24)) * 1.0625;
      if (cy < 0) { var t = Math.abs(cy); fwd *= Math.max(0, 1 - t * t * 1.1); }
      var vBase = 20.4 + p * 26.4, vContact = (-cy) * (44.8 + p * 76.8), ucLift = upperCZ * (9.6 + p * 14.4), latStart = cx * (5.95 + p * 11.05);
      var rng = 0.98 + Math.random() * 0.04;
      velocity.set(latStart * rng, (vBase + vContact + ucLift) * rng, -fwd * rng);
      spin.x = (-cy) * (30 + p * 70) + upperCZ * (-5 - p * 7); spin.y = cx * (48 + p * 105); spin.z = 0;
      var launchSpeedKmh = (velocity.length() / unitsPerMeter) * 3.6 * SPEED_DISPLAY_FACTOR;
      if (launchSpeedKmh > maxSpeedThisGame) maxSpeedThisGame = launchSpeedKmh;
      showShotType(classifyShotType(cx, cy, launchSpeedKmh));
      showMessage('\u51FA\u8173\uFF01 \u529B\u9053 ' + Math.round(power) + '%', '#00ff88', 1300);
    }

    // ── Physics ──
    function applyPhysics(dt) {
      var magnus = new THREE.Vector3().crossVectors(spin, velocity).multiplyScalar(magnusScale);
      velocity.addScaledVector(magnus, dt);
      if (ball.position.y > getTerrainHeightAt(ball.position.x, ball.position.z) + ballRadius + 0.1) {
        velocity.x += windX * dt; velocity.z += windZ * dt;
      }
      velocity.y -= gravity * dt;
      velocity.multiplyScalar(Math.pow(airDrag, dt * 60));
      spin.x *= Math.pow(spinAirDecay, dt * 60); spin.y *= Math.pow(sideSpinAirDecay, dt * 60);
      ball.position.addScaledVector(velocity, dt);
      ball.rotation.x += (velocity.z / ballRadius) * dt + spin.x * 0.012 * dt;
      ball.rotation.y += spin.y * 0.014 * dt; ball.rotation.z -= (velocity.x / ballRadius) * dt;
      // Track max speed + height
      var curSpeed = (velocity.length() / unitsPerMeter) * 3.6 * SPEED_DISPLAY_FACTOR;
      if (curSpeed > maxSpeedThisGame) maxSpeedThisGame = curSpeed;
      var curHeightM = Math.max(0, (ball.position.y - ballRadius) / unitsPerMeter);
      if (curHeightM > maxHeightThisKick) maxHeightThisKick = curHeightM;
      var terrainY = getTerrainHeightAt(ball.position.x, ball.position.z) + ballRadius;
      if (!hasTriggeredLandingRing && ball.position.y <= terrainY + 0.25 && velocity.length() > 4) {
        hasTriggeredLandingRing = true; triggerImpactRing(ball.position.clone());
      }
      if (ball.position.y <= terrainY) {
        landingCameraDamp = 1; ball.position.y = terrainY;
        var sn = getTerrainNormalAt(ball.position.x, ball.position.z), vDotN = velocity.dot(sn);
        var backspin = Math.max(0, spin.x), topspin = Math.max(0, -spin.x);
        if (vDotN < 0) { var imp = Math.abs(vDotN), rest = imp > 1 ? clamp(0.48 + backspin * 0.0028 - topspin * 0.0036, 0.20, 0.60) : 0; velocity.addScaledVector(sn, -(1 + rest) * vDotN); }
        velocity.z *= clamp(0.9915 + topspin * 0.001 - backspin * 0.00018, 0.98, 0.9965);
        velocity.x *= lateralFriction; spin.x *= 0.91; spin.y *= 0.86;
        var vDotNA = velocity.dot(sn);
        if (vDotNA > 0 && vDotNA < 0.42) velocity.addScaledVector(sn, -vDotNA);
        if (vDotNA <= 0) { velocity.z *= 0.9945; velocity.x *= 0.975; }
        if (Math.hypot(velocity.x, velocity.z) < 0.30 && Math.abs(velocity.dot(sn)) < 0.30) {
          velocity.set(0, 0, 0); gameState = 'result'; finishShot();
        }
      }
    }
    function updateAim(dt) {
      aimTime += dt; var speed = 4;
      if (shotsLeft === 3) speed *= 0.58; else if (shotsLeft === 1) speed *= 1.9;
      aimTarget.x = Math.sin(aimTime * 1.35 * speed) * 0.85;
      aimTarget.y = Math.cos(aimTime * 1.72 * speed) * 0.85;
      aimDot.style.left = ((aimTarget.x + 1) * 50) + '%';
      aimDot.style.top = ((-aimTarget.y + 1) * 50) + '%';
    }
    function updatePower(dt) {
      power += powerDir * dt * 115;
      if (power >= 100) { power = 100; powerDir = -1; }
      if (power <= 0) { power = 0; powerDir = 1; }
      powerFill.style.width = power + '%';
    }
    function updateCamera() {
      var nh = Math.min(1, Math.max(0, (ball.position.y - ballRadius) / 30));
      var terrainBaseY = getTerrainHeightAt(ball.position.x, ball.position.z) + ballRadius;
      cameraModeBlend = gameState === 'flying' ? Math.max(0, cameraModeBlend - 0.11) : 1;
      if (landingCameraDamp > 0 && gameState !== 'flying') landingCameraDamp = Math.max(0, landingCameraDamp - 0.045);
      var aCX = ball.position.x * 0.015, aCY = 11.25 + nh * 1.1, aCZ = ball.position.z + 64.8;
      var aLX = ball.position.x * 0.92, aLY = Math.max(ballRadius, ball.position.y + 11.5), aLZ = ball.position.z - 0.35;
      var fCX = ball.position.x, fCY = Math.max(25.8, ball.position.y + 21.6 + nh * 8.4), fCZ = ball.position.z + 90;
      var fLX = ball.position.x, fLY = Math.max(ballRadius, ball.position.y + 1.15 + nh * 1.4), fLZ = ball.position.z - 1.8;
      var b = cameraModeBlend, b2 = 1 - b;
      var dX = aCX * b + fCX * b2, dY = aCY * b + fCY * b2, dZ = aCZ * b + fCZ * b2;
      var dLX = aLX * b + fLX * b2, dLY = aLY * b + fLY * b2, dLZ = aLZ * b + fLZ * b2;
      var ngb = clamp(1 - ((ball.position.y - terrainBaseY) / 7.5), 0, 1);
      ngb = Math.max(ngb, landingCameraDamp * 0.85);
      if (gameState === 'aiming' || gameState === 'charging') ngb = 0;
      if (ngb > 0) { dY = dY * (1 - ngb) + (terrainBaseY + 19.2) * ngb; dZ = dZ * (1 - ngb) + (ball.position.z + 37.5) * ngb; dLY = dLY * (1 - ngb) + (terrainBaseY + 0.22) * ngb; dLZ = dLZ * (1 - ngb) + (ball.position.z - 0.18) * ngb; }
      cameraDesiredPosition.set(dX, dY, dZ);
      // Apply camera orbit + zoom offsets
      if (camYaw !== 0 || camPitch !== 0 || camZoom !== 0) {
        var lt = new THREE.Vector3(dLX, dLY, dLZ);
        var off = cameraDesiredPosition.clone().sub(lt);
        var cr = off.length() * (1 + camZoom);
        var cosYaw = Math.cos(camYaw), sinYaw = Math.sin(camYaw);
        var ox = off.x * cosYaw - off.z * sinYaw, oz = off.x * sinYaw + off.z * cosYaw;
        off.x = ox; off.z = oz;
        var hd = Math.sqrt(off.x * off.x + off.z * off.z);
        var cp = clamp(Math.atan2(off.y, hd) + camPitch, 0.05, 1.3);
        off.y = cr * Math.sin(cp);
        var hs = hd > 0.001 ? (cr * Math.cos(cp)) / hd : 0;
        off.x *= hs; off.z *= hs;
        cameraDesiredPosition.copy(lt).add(off);
      }
      camera.position.lerp(cameraDesiredPosition, gameState === 'aiming' ? 0.12 : 0.085);
      cameraLookTarget.lerp(new THREE.Vector3(dLX, dLY, dLZ), gameState === 'aiming' ? 0.14 : 0.1);
      camera.lookAt(cameraLookTarget);
      if (cameraShakeTimer > 0) {
        camera.position.x += (Math.random() - 0.5) * cameraShakeStrength;
        camera.position.y += (Math.random() - 0.5) * cameraShakeStrength * 0.45;
        camera.position.z += (Math.random() - 0.5) * cameraShakeStrength * 0.25;
      }
      dirLight.position.set(camera.position.x + 40, Math.max(70, camera.position.y + 45), camera.position.z + 35);
      dirLight.target.position.copy(ball.position); dirLight.target.updateMatrixWorld();
    }
    function animate() {
      if (destroyed) return;
      _animFrameId = requestAnimationFrame(animate);
      var rawDt = Math.min(clock.getDelta(), 0.05);
      if (slowMoTimer > 0) slowMoTimer = Math.max(0, slowMoTimer - rawDt);
      timeScale = slowMoTimer > 0 ? 0.55 : 1;
      if (cameraShakeTimer > 0) { cameraShakeTimer = Math.max(0, cameraShakeTimer - rawDt); cameraShakeStrength *= 0.9; } else { cameraShakeStrength = 0; }
      var dt = rawDt * timeScale;
      var cw = containerEl.offsetWidth, ch = containerEl.offsetHeight;
      var world = new THREE.Vector3(ball.position.x, ball.position.y + 2.5, ball.position.z).project(camera);
      floatingUI.style.left = ((world.x * 0.5 + 0.5) * cw) + 'px';
      floatingUI.style.top = ((-(world.y * 0.5) + 0.5) * ch) + 'px';
      var isActive = gameState === 'flying' || gameState === 'result' || gameState === 'gameover';
      floatingUI.style.opacity = isActive ? '0' : '1';
      if (virtualBallEl) { var show = gameState === 'aiming'; virtualBallEl.style.opacity = show ? '1' : '0'; virtualBallEl.style.pointerEvents = show ? 'auto' : 'none'; }
      if (firstTipEl && !hasKickedOnce) {
        firstTipEl.style.opacity = (gameState === 'aiming') ? '1' : '0';
      }
      if (gameState === 'aiming') updateAim(dt);
      if (gameState === 'charging') updatePower(dt);
      if (gameState === 'flying' && shotCameraHold > 0) shotCameraHold = Math.max(0, shotCameraHold - rawDt);
      accumulator += dt;
      while (accumulator >= FIXED_DT) {
        if (gameState === 'flying') { applyPhysics(FIXED_DT); currentDistance = Math.max(0, -ball.position.z) / unitsPerMeter; }
        accumulator -= FIXED_DT;
      }
      displayedDistance += (currentDistance - displayedDistance) * 0.18;
      var currentSpeedKmh = (velocity.length() / unitsPerMeter) * 3.6 * SPEED_DISPLAY_FACTOR;
      displayedSpeedKmh += (currentSpeedKmh - displayedSpeedKmh) * 0.22;
      focusDistEl.textContent = (displayedDistance + bonusDistance).toFixed(2);
      displayedHeight += (maxHeightThisKick - displayedHeight) * 0.18;
      focusHeightEl.textContent = displayedHeight.toFixed(2);
      focusSpeedEl.textContent = displayedSpeedKmh.toFixed(2);
      // Camera snap-back when not actively controlling
      if (!camDragging && !camTouching) {
        camYaw *= 0.93; camPitch *= 0.93; camZoom *= 0.93;
        if (Math.abs(camYaw) < 0.001) camYaw = 0;
        if (Math.abs(camPitch) < 0.001) camPitch = 0;
        if (Math.abs(camZoom) < 0.001) camZoom = 0;
      }
      updateCamera();
      renderer.render(scene, camera);
    }
    function _onResize() {
      if (destroyed || !renderer) return;
      camera.aspect = containerEl.offsetWidth / containerEl.offsetHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerEl.offsetWidth, containerEl.offsetHeight);
    }

    // ── Top 10 Monthly Markers ──
    function loadTop3Markers() {
      var bucket = getTaipeiDateBucket('monthly');
      firebase.firestore().collection('kickGameRankings').doc(bucket).collection('entries')
        .orderBy('bestDistance', 'desc').limit(20).get()
        .then(function (snap) {
          if (destroyed) return;
          var rows = snap.docs.map(function (d) { return normalizeRow(d.id, d.data()); }).filter(function (r) { return !isAnonymousRow(r) && r.distance > 0; });
          rows = dedupeRows(rows).sort(compareRows).slice(0, 10);
          var topColors = [0xffd700, 0xc0c0c0, 0xcd7f32];
          rows.forEach(function (row, i) {
            var z = -row.distance * unitsPerMeter;
            var isTop3 = i < 3;
            var color = isTop3 ? topColors[i] : 0x4a90d9;
            var bH = isTop3 ? 18 + (2 - i) * 4 : 8;
            var beamOpacity = isTop3 ? 0.18 : 0.10;
            var ringOpacity = isTop3 ? 0.35 : 0.20;
            var beamWidth = isTop3 ? 1.5 : 0.8;
            var ringOuter = isTop3 ? 3.2 : 2.0;
            var ringInner = isTop3 ? 2.5 : 1.5;
            // Light beam (cross-shaped)
            var bMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: beamOpacity, side: THREE.DoubleSide, depthWrite: false });
            var bGeo = new THREE.PlaneGeometry(beamWidth, bH);
            var b1 = new THREE.Mesh(bGeo, bMat); b1.position.set(0, bH / 2, z); scene.add(b1);
            var b2 = b1.clone(); b2.rotation.y = Math.PI / 2; b2.position.copy(b1.position); scene.add(b2);
            // Ground ring
            var ringMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: ringOpacity, side: THREE.DoubleSide, depthWrite: false });
            var ring = new THREE.Mesh(new THREE.RingGeometry(ringInner, ringOuter, 32), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.06, z); scene.add(ring);
            // Text sprite
            var c = document.createElement('canvas'); c.width = 512; c.height = 96;
            var ctx = c.getContext('2d');
            ctx.fillStyle = isTop3 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.40)';
            ctx.fillRect(0, 0, 512, 96);
            ctx.fillStyle = '#fff'; ctx.font = (isTop3 ? 'bold 42px' : 'bold 34px') + ' Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('#' + (i + 1) + ' ' + row.nick + '  ' + row.distance.toFixed(1) + 'm', 256, 48);
            var sMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
            var spriteScale = isTop3 ? 36 : 28;
            var spriteH = isTop3 ? 6.75 : 5.25;
            var sprite = new THREE.Sprite(sMat); sprite.scale.set(spriteScale, spriteH, 1); sprite.position.set(0, bH + 3, z);
            scene.add(sprite);
          });
        }).catch(function () {});
    }

    // ── Init & Destroy ──
    _buildUI();
    initScene();
    loadTop3Markers();
    gameStartTime = Date.now();
    resetGame();
    animate();
    window.addEventListener('resize', _onResize);

    return {
      destroy: function () {
        destroyed = true;
        if (_animFrameId) cancelAnimationFrame(_animFrameId);
        window.removeEventListener('pointerup', _onPointerUp);
        window.removeEventListener('mousemove', _onCamMouseMove);
        window.removeEventListener('mouseup', _onCamMouseUp);
        window.removeEventListener('resize', _onResize);
        if (resultTimer) clearTimeout(resultTimer);
        if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
        containerEl.innerHTML = '';
      }
    };
  }

  /* ── Event Binding ── */
  function _bindEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    // Note: leaderboard open button is now bound inside _buildUI() (inside game container)
    var lbClose = document.getElementById('kg-leaderboard-close');
    if (lbClose) lbClose.addEventListener('click', _closeLeaderboard);
    var lbModal = document.getElementById('kg-leaderboard-modal');
    if (lbModal) lbModal.addEventListener('click', function (e) { if (e.target === lbModal) _closeLeaderboard(); });
    document.querySelectorAll('#kg-leaderboard-modal .kg-lb-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { _renderLeaderboard(tab.getAttribute('data-lb-period') || 'daily'); });
    });
    var introStart = document.getElementById('kg-intro-start');
    if (introStart) introStart.addEventListener('click', function () {
      var modal = document.getElementById('kg-intro-modal');
      var check = document.getElementById('kg-intro-dismiss');
      if (check && check.checked) suppressIntroToday();
      if (modal) modal.setAttribute('aria-hidden', 'true');
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _lbOpen) _closeLeaderboard(); });
  }

  /* ── App Module Methods ── */
  Object.assign(App, {
    async initKickGamePage() {
      var currentUser = typeof auth !== 'undefined' ? auth.currentUser : null;
      var loginCard = document.getElementById('kg-login-required');
      var gameSection = document.getElementById('kg-game-section');
      var loadingEl = document.getElementById('kg-main-loading');

      if (!ModeManager.isDemo() && !currentUser) {
        if (loginCard) loginCard.style.display = 'none';
        if (gameSection) gameSection.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'none';
        this.showToast('\u8ACB\u5148\u56DE\u4E3B\u9801\u5B8C\u6210 LINE \u767B\u5165\uFF0C\u518D\u9032\u5165\u904A\u6232');
        this.showPage('page-home', { resetHistory: true });
        return;
      }

      if (loginCard) loginCard.style.display = 'none';
      if (loadingEl) loadingEl.style.display = '';
      if (gameSection) gameSection.style.display = 'none';

      // Dynamic page title from config / Firestore
      var titleRow = document.querySelector('#page-kick-game .kg-page-title-row');
      if (titleRow) {
        var cfg = typeof ApiService !== 'undefined' && ApiService.getGameConfigByKey ? ApiService.getGameConfigByKey('kick-game') : null;
        var preset = Array.isArray(HOME_GAME_PRESETS) ? HOME_GAME_PRESETS.find(function(p) { return p && p.gameKey === 'kick-game'; }) : null;
        var title = (cfg && cfg.pageTitle) || (preset && preset.pageTitle) || titleRow.textContent;
        titleRow.textContent = title;
      }

      try {
        await _loadThreeJs();
      } catch (e) {
        if (loadingEl) loadingEl.textContent = '\u904A\u6232\u8F09\u5165\u5931\u6557\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762\u518D\u8A66';
        return;
      }

      if (loadingEl) loadingEl.style.display = 'none';
      if (gameSection) gameSection.style.display = '';

      _bindEvents();

      var container = document.getElementById('kick-game-container');
      if (container) {
        if (_gameInstance) { _gameInstance.destroy(); _gameInstance = null; }
        _gameInstance = _createGame(container);
      }

      // Show intro if not suppressed
      if (!isIntroSuppressed()) {
        var introModal = document.getElementById('kg-intro-modal');
        if (introModal) introModal.setAttribute('aria-hidden', 'false');
      }
    },

    destroyKickGamePage() {
      if (_gameInstance) { _gameInstance.destroy(); _gameInstance = null; }
      _closeLeaderboard();
      var introModal = document.getElementById('kg-intro-modal');
      if (introModal) introModal.setAttribute('aria-hidden', 'true');
    },
  });
})();
