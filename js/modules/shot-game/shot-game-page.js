/* ================================================
   SportHub — Shot Game Page Module
   主站嵌入版射門遊戲，直接使用主站 auth / firebase
   Depends on: shot-page-ui.js (loaded first via ScriptLoader)
   ================================================ */

(function () {
  var UI = window._ShotPageUI;

  /* ── Script Loading ── */
  let _threeLoadPromise = null;
  let _gltfLoaderPromise = null;
  const THREE_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const GLTF_LOADER_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/examples/js/loaders/GLTFLoader.js';
  const GLTF_LOADER_FALLBACK_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';

  function _appendScript(src, failMessage) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(failMessage));
      document.head.appendChild(s);
    });
  }

  function _ensureGltfLoaderBestEffort() {
    if (window.THREE && window.THREE.GLTFLoader) return Promise.resolve();
    if (_gltfLoaderPromise) return _gltfLoaderPromise;
    _gltfLoaderPromise = (async () => {
      const candidates = [GLTF_LOADER_CDN_URL, GLTF_LOADER_FALLBACK_URL];
      for (let i = 0; i < candidates.length; i += 1) {
        if (window.THREE && window.THREE.GLTFLoader) return;
        const src = candidates[i];
        try {
          await _appendScript(src, `GLTFLoader load failed: ${src}`);
          if (window.THREE && window.THREE.GLTFLoader) return;
        } catch (_) {}
      }
      console.warn('[ShotGame] GLTFLoader unavailable in page mode, fallback sphere ball will be used.');
    })();
    return _gltfLoaderPromise;
  }

  function _loadThreeJs() {
    if (window.THREE) return _ensureGltfLoaderBestEffort();
    if (_threeLoadPromise) return _threeLoadPromise;
    _threeLoadPromise = _appendScript(THREE_CDN_URL, 'Three.js load failed')
      .then(() => {
        return _ensureGltfLoaderBestEffort();
      })
      .catch((err) => {
        _threeLoadPromise = null;
        throw err;
      });
    return _threeLoadPromise;
  }

  function _getShotGameAssetVersion() {
    try {
      if (typeof CACHE_VERSION === 'string' && CACHE_VERSION) return CACHE_VERSION;
    } catch (_) {}
    return '';
  }

  function _loadScriptSimple(path) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const v = _getShotGameAssetVersion();
      s.src = v ? `${path}?v=${encodeURIComponent(v)}` : path;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function _loadEngine() {
    if (window.ShotGameEngine) return Promise.resolve();
    const deps = [
      'js/modules/shot-game/shot-physics.js',
      'js/modules/shot-game/shot-renderer.js',
      'js/modules/shot-game/shot-scoring.js',
      'js/modules/shot-game/shot-game-loop.js',
    ];
    const loadDep = (typeof ScriptLoader !== 'undefined')
      ? (p) => ScriptLoader._load(p)
      : _loadScriptSimple;
    return Promise.all(deps.map(loadDep)).then(() => {
      return (typeof ScriptLoader !== 'undefined')
        ? ScriptLoader._load('js/modules/shot-game/shot-game-engine.js')
        : _loadScriptSimple('js/modules/shot-game/shot-game-engine.js');
    });
  }

  /* ── Module State ── */
  let _engine = null;
  let _bestSession = null;
  let _liveScore = 0;
  let _liveStreak = 0;
  let _lbPeriod = 'daily';
  let _lbOpen = false;
  let _lbSubmitPending = false;
  let _eventsBound = false;
  let _billboardAdImageUrl = '';

  /* ── Leaderboard ── */
  async function _renderLeaderboard(period) {
    const key = period in UI.LEADERBOARD_PERIOD_LABELS ? period : 'daily';
    _lbPeriod = key;
    const rangeEl = document.getElementById('sg-leaderboard-range');
    const bodyEl = document.getElementById('sg-leaderboard-body');
    const playerRowEl = document.getElementById('sg-leaderboard-player-row');
    const tabs = document.querySelectorAll('#sg-leaderboard-modal .sg-lb-tab');
    if (rangeEl) rangeEl.textContent = `${UI.LEADERBOARD_PERIOD_LABELS[key]}排行前 ${UI.LEADERBOARD_TOP_SIZE} 名`;
    tabs.forEach(tab => { const a = tab.getAttribute('data-lb-period') === key; tab.classList.toggle('is-active', a); tab.setAttribute('aria-selected', a ? 'true' : 'false'); });
    if (!bodyEl) return;
    bodyEl.textContent = '';
    UI.appendStatusRow(bodyEl, '載入中…');
    if (playerRowEl) { playerRowEl.classList.add('is-hidden'); playerRowEl.textContent = ''; }
    let rows = [];
    try {
      const bucket = UI.getTaipeiDateBucket(key);
      const snap = await firebase.firestore().collection('shotGameRankings').doc(bucket).collection('entries').orderBy('bestScore', 'desc').limit(50).get();
      rows = snap.docs.map(d => UI.normalizeLeaderboardRow(d.id, d.data())).filter(r => !UI.isAnonymousLeaderboardRow(r));
    } catch (_) { bodyEl.textContent = ''; UI.appendStatusRow(bodyEl, '讀取失敗，請稍後再試'); return; }
    rows = UI.dedupeLeaderboardRows(rows);
    const { topRows, extraPlayerRow } = UI.buildLeaderboardView(rows, _bestSession, _lbSubmitPending);
    if (topRows.length === 0) { bodyEl.textContent = ''; UI.appendStatusRow(bodyEl, '尚無排行資料'); return; }
    bodyEl.textContent = '';
    topRows.forEach(row => UI.appendLeaderboardRow(bodyEl, row));
    if (!playerRowEl) return;
    if (extraPlayerRow) { UI.renderExtraPlayerRow(playerRowEl, extraPlayerRow); }
    else { playerRowEl.classList.add('is-hidden'); playerRowEl.textContent = ''; }
  }

  function _openLeaderboard(period) {
    const modal = document.getElementById('sg-leaderboard-modal');
    if (!modal) return;
    _renderLeaderboard(period || _lbPeriod);
    modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false'); _lbOpen = true;
  }
  function _closeLeaderboard() {
    const modal = document.getElementById('sg-leaderboard-modal');
    if (!modal) return;
    modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); _lbOpen = false;
  }
  function _openIntro() { if (UI.isIntroSuppressed()) return; const m = document.getElementById('sg-intro-modal'); if (m) m.setAttribute('aria-hidden', 'false'); }
  function _closeIntro() { const m = document.getElementById('sg-intro-modal'), c = document.getElementById('sg-intro-dismiss'); if (!m) return; if (c && c.checked) UI.suppressIntroToday(); m.setAttribute('aria-hidden', 'true'); }
  function _syncHudPanelHeight() { const c = document.getElementById('shot-game-container'), b = document.getElementById('session-badge'); if (c && b) b.style.height = 'auto'; }

  function _updateSessionBadge() {
    const badge = document.getElementById('session-badge');
    if (!badge) return;
    if (!badge.querySelector('.sg-session-title')) { badge.textContent = ''; UI.buildSessionBadgeDOM(badge); }
    const hasBest = !!_bestSession;
    const set = (sel, val) => { const e = badge.querySelector(sel); if (e) e.textContent = String(val); };
    set('.sg-session-best-score', hasBest ? Math.max(0, Math.round(Number(_bestSession.score) || 0)) : '--');
    set('.sg-session-best-shots', hasBest ? Math.max(0, Math.round(Number(_bestSession.shots) || 0)) : '--');
    set('.sg-session-best-time', hasBest ? Math.max(0, Math.round(Number(_bestSession.durationMs || 0) / 1000)) : '--');
    set('.sg-session-focus-score', Math.max(0, Math.round(Number(_liveScore) || 0)));
    set('.sg-session-focus-streak', Math.max(0, Math.round(Number(_liveStreak) || 0)));
    _syncHudPanelHeight();
  }

  function _isBetter(a, b) { if (!b) return true; if (a.score !== b.score) return a.score > b.score; if (a.shots !== b.shots) return a.shots < b.shots; return a.durationMs < b.durationMs; }

  async function _submitScoreToRanking(sp) {
    const user = typeof auth !== 'undefined' ? auth.currentUser : null;
    if (!sp || sp.score <= 0 || !user) return;
    _lbSubmitPending = true;
    try { await firebase.app().functions('asia-east1').httpsCallable('submitShotGameScore')({ score: sp.score, shots: sp.shots, streak: sp.streak, durationMs: sp.durationMs, displayName: UI.getPreferredPlayerDisplayName(user) }); }
    catch (_) {} finally { _lbSubmitPending = false; if (_lbOpen) _renderLeaderboard(_lbPeriod); }
  }

  function _startGame() {
    if (_engine) { _engine.destroy(); _engine = null; }
    const container = document.getElementById('shot-game-container');
    if (!container || !window.ShotGameEngine) return;
    _liveScore = 0; _liveStreak = 0; _updateSessionBadge();
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(_syncHudPanelHeight).catch(() => {}); } else { _syncHudPanelHeight(); }
    const $ = id => document.getElementById(id);
    _engine = window.ShotGameEngine.create({
      container, lowFx: new URLSearchParams(location.search).get('low') === '1', billboardImageUrl: _billboardAdImageUrl,
      ui: { scoreEl: $('sg-score'), streakEl: $('sg-streak'), powerBarEl: $('sg-power'), powerFillEl: $('sg-power-fill'), crosshairEl: $('sg-crosshair'), messageEl: $('sg-message'), restartBtn: $('sg-restart') },
      onScoreChange(p) { _liveScore = Number(p && p.score != null ? p.score : 0); _liveStreak = Number(p && p.streak != null ? p.streak : 0); _updateSessionBadge(); },
      onGameOver(p) {
        const n = { score: Number(p && p.score ? p.score : 0), shots: Number(p && p.shots ? p.shots : 0), streak: Number(p && p.bestStreak != null ? p.bestStreak : (p ? p.streak : 0)), durationMs: Number(p && p.durationMs ? p.durationMs : 0) };
        if (_isBetter(n, _bestSession)) _bestSession = n;
        _updateSessionBadge(); _submitScoreToRanking(n); if (_lbOpen) _renderLeaderboard(_lbPeriod);
      },
    });
    _updateSessionBadge(); _openIntro();
  }

  function _bindEvents() {
    if (_eventsBound) return; _eventsBound = true;
    const $ = id => document.getElementById(id);
    const lbBtn = $('sg-leaderboard-btn');
    if (lbBtn) { lbBtn.addEventListener('pointerdown', e => e.stopPropagation()); lbBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); _openLeaderboard(_lbPeriod); }); }
    const lbClose = $('sg-leaderboard-close');
    if (lbClose) lbClose.addEventListener('click', _closeLeaderboard);
    const lbModal = $('sg-leaderboard-modal');
    if (lbModal) lbModal.addEventListener('click', e => { if (e.target === lbModal) _closeLeaderboard(); });
    document.querySelectorAll('#sg-leaderboard-modal .sg-lb-tab').forEach(tab => { tab.addEventListener('click', () => _renderLeaderboard(tab.getAttribute('data-lb-period') || 'daily')); });
    const introStart = $('sg-intro-start');
    if (introStart) introStart.addEventListener('click', _closeIntro);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && _lbOpen) _closeLeaderboard(); });
    window.addEventListener('resize', _syncHudPanelHeight);
    window.addEventListener('beforeunload', () => { if (_engine) _engine.destroy(); });
  }

  /* ── Ad Loading ── */
  async function _loadAd() {
    const container = document.getElementById('sg-ad-container');
    const norm = (ad) => (ad && typeof ad.image === 'string' ? ad.image.trim() : '');
    const toMs = (v) => { if (!v) return 0; if (typeof v === 'number' && Number.isFinite(v)) return v; if (typeof v.toMillis === 'function') return Number(v.toMillis()) || 0; if (typeof v.toDate === 'function') { const d = v.toDate(); return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : 0; } const p = Number(new Date(v).getTime()); return Number.isFinite(p) ? p : 0; };
    const isAct = (ad) => !!(ad && ad.status === 'active' && norm(ad));
    const pick = (ads) => { if (!Array.isArray(ads) || !ads.length) return null; return ads.filter(isAct).map(ad => ({ ...ad, _ts: Math.max(toMs(ad.updatedAt), toMs(ad.publishAt), toMs(ad.createdAt)) })).sort((a, b) => b._ts - a._ts)[0] || null; };
    const resolve = async () => {
      try { if (typeof ApiService !== 'undefined' && ApiService && typeof ApiService.getShotGameAd === 'function') { const c = ApiService.getShotGameAd(); if (isAct(c)) return c; } } catch (_) {}
      if (!window.firebase || typeof firebase.firestore !== 'function') return null;
      const db = firebase.firestore();
      const d = await db.collection('banners').doc('sga1').get();
      if (d.exists) { const dd = d.data() || {}; if (isAct(dd)) return dd; }
      const ss = await db.collection('banners').where('slot', '==', 'sga1').limit(12).get();
      const sb = pick(ss.docs.map(x => x.data() || {}));
      if (sb) return sb;
      const ts = await db.collection('banners').where('type', '==', 'shotgame').limit(12).get();
      return pick(ts.docs.map(x => x.data() || {}));
    };
    const clear = () => { _billboardAdImageUrl = ''; if (_engine && typeof _engine.setBillboardAdImage === 'function') _engine.setBillboardAdImage(''); if (container) container.textContent = ''; };
    try {
      const ad = await resolve();
      if (!isAct(ad)) { clear(); return; }
      const url = norm(ad), lnk = typeof ad.linkUrl === 'string' ? ad.linkUrl.trim() : '';
      _billboardAdImageUrl = url;
      if (_engine && typeof _engine.setBillboardAdImage === 'function') _engine.setBillboardAdImage(url);
      if (!container) return;
      container.textContent = '';
      const img = document.createElement('img'); img.src = url; img.alt = '廣告';
      if (lnk) { const a = document.createElement('a'); a.href = lnk; a.target = 'sporthub_ad'; a.rel = 'noopener noreferrer'; a.appendChild(img); container.appendChild(a); }
      else { container.appendChild(img); }
    } catch (_) { clear(); }
  }

  /* ── App Module Methods ── */
  Object.assign(App, {
    async initShotGamePage() {
      const currentUser = typeof auth !== 'undefined' ? auth.currentUser : null;
      const loginCard = document.getElementById('sg-login-required');
      const gameSection = document.getElementById('game-section');
      const loadingEl = document.getElementById('sg-main-loading');
      if (!currentUser) {
        if (loginCard) loginCard.style.display = 'none';
        if (gameSection) gameSection.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'none';
        this.showToast('請先回主頁完成 LINE 登入，再進入射門遊戲');
        this.showPage('page-home', { resetHistory: true });
        return;
      }
      if (loginCard) loginCard.style.display = 'none';
      if (loadingEl) loadingEl.style.display = '';
      if (gameSection) gameSection.style.display = 'none';
      const titleRow = document.querySelector('#page-game .sg-page-title-row');
      if (titleRow) {
        const cfg = typeof ApiService !== 'undefined' && ApiService.getGameConfigByKey ? ApiService.getGameConfigByKey('shot-game') : null;
        const preset = Array.isArray(HOME_GAME_PRESETS) ? HOME_GAME_PRESETS.find(p => p && p.gameKey === 'shot-game') : null;
        titleRow.textContent = (cfg && cfg.pageTitle) || (preset && preset.pageTitle) || titleRow.textContent;
      }
      try { await _loadThreeJs(); await _loadEngine(); } catch (e) {
        if (loadingEl) loadingEl.textContent = '遊戲載入失敗，請重新整理頁面再試';
        return;
      }
      if (loadingEl) loadingEl.style.display = 'none';
      if (gameSection) gameSection.style.display = '';
      _bindEvents();
      _startGame();
      _loadAd();
    },
    destroyShotGamePage() {
      if (_engine) { _engine.destroy(); _engine = null; }
      _closeLeaderboard();
      const introModal = document.getElementById('sg-intro-modal');
      if (introModal) introModal.setAttribute('aria-hidden', 'true');
    },
  });
})();
