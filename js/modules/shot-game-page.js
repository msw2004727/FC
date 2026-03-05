/* ================================================
   SportHub — Shot Game Page Module
   主站嵌入版射門遊戲，直接使用主站 auth / firebase
   ================================================ */

(function () {
  const LEADERBOARD_TOP_SIZE = 10;
  const INTRO_DISMISS_KEY = 'sporthub_shot_game_intro_dismissed';
  const LEADERBOARD_PERIOD_LABELS = { daily: '每日', weekly: '每周', monthly: '每月' };

  /* ── Utility Functions ── */
  function formatDuration(seconds) {
    const sec = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function compareRows(a, b) {
    return b.score - a.score || b.streak - a.streak || a.durationSec - b.durationSec || a.nick.localeCompare(b.nick, 'zh-Hant');
  }
  function isLocalSessionBetter(localRow, remoteRow) {
    if (!localRow || !remoteRow) return false;
    if (localRow.score !== remoteRow.score) return localRow.score > remoteRow.score;
    if (localRow.streak !== remoteRow.streak) return localRow.streak > remoteRow.streak;
    return localRow.durationSec < remoteRow.durationSec;
  }
  function getCurrentAuthUid() {
    try {
      if (typeof auth === 'undefined' || !auth || !auth.currentUser || !auth.currentUser.uid) return '';
      return String(auth.currentUser.uid);
    } catch (_) {
      return '';
    }
  }
  function getPreferredPlayerDisplayName(user) {
    function isPlaceholderName(name) {
      return /^玩家[\w-]{2,}$/u.test(String(name || '').trim());
    }
    try {
      if (typeof LineAuth !== 'undefined' && LineAuth && typeof LineAuth.getProfile === 'function') {
        const profile = LineAuth.getProfile();
        const lineName = String(profile && profile.displayName ? profile.displayName : '').trim();
        if (lineName && !isPlaceholderName(lineName)) return lineName;
      }
    } catch (_) {}
    const authName = String(user && user.displayName ? user.displayName : '').trim();
    if (authName && !isPlaceholderName(authName)) return authName;
    if (authName) return authName;
    return '';
  }
  function getLeaderboardIdentity(row) {
    if (!row) return '';
    const uid = typeof row.uid === 'string' ? row.uid.trim() : '';
    if (uid) return uid;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    return id;
  }
  function pickPreferredLeaderboardRow(incoming, current) {
    if (!current) return incoming;
    if (isLocalSessionBetter(incoming, current)) return incoming;
    if (isLocalSessionBetter(current, incoming)) return current;
    const incomingCanonical = incoming.uid && incoming.id === incoming.uid;
    const currentCanonical = current.uid && current.id === current.uid;
    if (incomingCanonical && !currentCanonical) return incoming;
    return current;
  }
  function dedupeLeaderboardRows(rows) {
    const rowMap = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const identity = getLeaderboardIdentity(row);
      if (!identity) return;
      const existing = rowMap.get(identity);
      rowMap.set(identity, pickPreferredLeaderboardRow(row, existing));
    });
    return Array.from(rowMap.values());
  }

  function normalizeLeaderboardRow(id, data) {
    const row = data || {};
    const rawUid = typeof row.uid === 'string' ? row.uid.trim() : '';
    const rawName = typeof row.displayName === 'string' ? row.displayName.trim() : '';
    const rawDurationSec = Number(row.bestDurationSec);
    const rawDurationMs = Number(row.bestDurationMs);
    const durationSec = Number.isFinite(rawDurationSec) && rawDurationSec > 0
      ? Math.round(rawDurationSec)
      : (
        Number.isFinite(rawDurationMs) && rawDurationMs > 0
          ? Math.round(rawDurationMs / 1000)
          : 0
      );

    return {
      id: String(id),
      uid: rawUid,
      nick: rawName || `玩家${String(id).slice(-4)}`,
      score: Number.isFinite(row.bestScore) ? row.bestScore : 0,
      streak: Number.isFinite(row.bestStreak) ? row.bestStreak : 0,
      durationSec,
      authProvider: typeof row.authProvider === 'string' ? row.authProvider : '',
    };
  }

  function isAnonymousLeaderboardRow(row) {
    if (!row) return true;
    const provider = String(row.authProvider || '').toLowerCase();
    const nick = String(row.nick || '').trim();
    if (provider === 'anonymous') return true;
    if (nick === '匿名玩家' || nick.toLowerCase() === 'anonymous') return true;
    return false;
  }

  function buildRankIcon(rank) {
    if (rank === 1) return '<svg class="sg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f6c94c"/><path d="M12 5l2.1 4.2 4.6.7-3.3 3.2.8 4.6L12 15.5 7.8 17.7l.8-4.6-3.3-3.2 4.6-.7z" fill="#fff3c4"/></svg>';
    if (rank === 2) return '<svg class="sg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#adb7c4"/><path d="M12 6l5 4v8H7v-8z" fill="#e9eef5"/></svg>';
    if (rank === 3) return '<svg class="sg-lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#b98252"/><path d="M7 16l2.2-8h5.6l2.2 8z" fill="#f7d5b5"/></svg>';
    return '';
  }

  function getTaipeiDateStr() {
    const t = new Date(Date.now() + 8 * 3600000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  }

  function isIntroSuppressed() {
    try { return localStorage.getItem(INTRO_DISMISS_KEY) === getTaipeiDateStr(); } catch (_) { return false; }
  }

  function suppressIntroToday() {
    try { localStorage.setItem(INTRO_DISMISS_KEY, getTaipeiDateStr()); } catch (_) {}
  }

  function getTaipeiDateBucket(period) {
    const t = new Date(Date.now() + 8 * 3600 * 1000);
    const year = t.getUTCFullYear();
    const month = String(t.getUTCMonth() + 1).padStart(2, '0');
    const day = String(t.getUTCDate()).padStart(2, '0');
    if (period === 'monthly') return `monthly_${year}-${month}`;
    if (period === 'weekly') {
      const d = new Date(Date.UTC(year, t.getUTCMonth(), t.getUTCDate()));
      const dow = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dow);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, '0');
      return `weekly_${d.getUTCFullYear()}-W${week}`;
    }
    return `daily_${year}-${month}-${day}`;
  }

  /* ── Script Loading ── */
  let _threeLoadPromise = null;
  let _gltfLoaderPromise = null;
  const THREE_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const GLTF_LOADER_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/examples/js/loaders/GLTFLoader.js';

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
    _gltfLoaderPromise = _appendScript(GLTF_LOADER_CDN_URL, 'GLTFLoader load failed')
      .catch((err) => {
        console.warn('[ShotGame] GLTFLoader unavailable in page mode, fallback sphere ball will be used.', err);
      });
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

  function _loadEngine() {
    if (window.ShotGameEngine) return Promise.resolve();
    return (typeof ScriptLoader !== 'undefined')
      ? ScriptLoader._load('js/modules/shot-game-engine.js')
      : new Promise((resolve, reject) => {
          const s = document.createElement('script');
          const v = _getShotGameAssetVersion();
          s.src = v
            ? `js/modules/shot-game-engine.js?v=${encodeURIComponent(v)}`
            : 'js/modules/shot-game-engine.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
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
    const key = period in LEADERBOARD_PERIOD_LABELS ? period : 'daily';
    _lbPeriod = key;

    const rangeEl = document.getElementById('sg-leaderboard-range');
    const bodyEl = document.getElementById('sg-leaderboard-body');
    const playerRowEl = document.getElementById('sg-leaderboard-player-row');
    const tabs = document.querySelectorAll('#sg-leaderboard-modal .sg-lb-tab');

    if (rangeEl) rangeEl.textContent = `${LEADERBOARD_PERIOD_LABELS[key]}排行前 ${LEADERBOARD_TOP_SIZE} 名`;
    tabs.forEach(tab => {
      const active = tab.getAttribute('data-lb-period') === key;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (!bodyEl) return;
    bodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">載入中…</td></tr>';
    if (playerRowEl) { playerRowEl.classList.add('is-hidden'); playerRowEl.innerHTML = ''; }

    let rows = [];
    try {
      const bucket = getTaipeiDateBucket(key);
      const snap = await firebase.firestore()
        .collection('shotGameRankings').doc(bucket)
        .collection('entries')
        .orderBy('bestScore', 'desc').limit(50).get();
      rows = snap.docs
        .map(d => normalizeLeaderboardRow(d.id, d.data()))
        .filter(row => !isAnonymousLeaderboardRow(row));
    } catch (_) {
      bodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">讀取失敗，請稍後再試</td></tr>';
      return;
    }

    rows = dedupeLeaderboardRows(rows);
    const currentUid = getCurrentAuthUid();
    const localBestRow = _bestSession && _bestSession.score > 0
      ? {
        score: _bestSession.score,
        streak: _bestSession.streak || 0,
        durationSec: Math.round((_bestSession.durationMs || 0) / 1000),
      }
      : null;
    const selfIds = new Set();
    if (currentUid) {
      selfIds.add(currentUid);
      const selfPersistedRow = rows.find((row) => row.id === currentUid || row.uid === currentUid);
      if (selfPersistedRow) {
        selfIds.add(selfPersistedRow.id);
        selfPersistedRow.nick = '你';
        if (localBestRow && isLocalSessionBetter(localBestRow, selfPersistedRow)) {
          selfPersistedRow.score = localBestRow.score;
          selfPersistedRow.streak = localBestRow.streak;
          selfPersistedRow.durationSec = localBestRow.durationSec;
        }
      } else if (localBestRow && _lbSubmitPending) {
        rows.push({
          id: currentUid,
          uid: currentUid,
          nick: '你',
          score: localBestRow.score,
          streak: localBestRow.streak,
          durationSec: localBestRow.durationSec,
        });
      }
    } else if (localBestRow) {
      selfIds.add('player-self');
      rows.push({
        id: 'player-self',
        nick: '你',
        score: localBestRow.score,
        streak: localBestRow.streak,
        durationSec: localBestRow.durationSec,
      });
    }
    rows.sort(compareRows);
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    const topRows = ranked.slice(0, LEADERBOARD_TOP_SIZE);
    const playerRow = ranked.find(r => selfIds.has(r.id)) || null;
    const extraPlayerRow = playerRow && playerRow.rank > LEADERBOARD_TOP_SIZE ? playerRow : null;

    if (topRows.length === 0) {
      bodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">尚無排行資料</td></tr>';
      return;
    }

    bodyEl.innerHTML = topRows.map(row => {
      const rowClass = row.rank <= 3 ? ` class="sg-lb-row-top${row.rank}"` : '';
      const rankLabel = row.rank <= 3
        ? `<span class="sg-lb-rank-badge">${buildRankIcon(row.rank)}<span>${row.rank}</span></span>`
        : `#${row.rank}`;
      return `<tr${rowClass}>
        <td class="sg-lb-rank">${rankLabel}</td>
        <td class="sg-lb-nick"><span class="sg-lb-name-pill" title="${escapeHtml(row.nick)}">${escapeHtml(row.nick)}</span></td>
        <td class="sg-lb-score">${row.score}</td>
        <td>${row.streak}</td>
        <td>${formatDuration(row.durationSec)}</td>
      </tr>`;
    }).join('');

    if (!playerRowEl) return;
    if (extraPlayerRow) {
      const row = extraPlayerRow;
      playerRowEl.classList.remove('is-hidden');
      playerRowEl.innerHTML = `<h4>你的名次</h4>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <colgroup>
            <col class="sg-lb-col-rank"><col class="sg-lb-col-nick">
            <col class="sg-lb-col-score"><col class="sg-lb-col-streak"><col class="sg-lb-col-time">
          </colgroup>
          <tbody><tr>
            <td class="sg-lb-rank">#${row.rank}</td>
            <td class="sg-lb-nick"><span class="sg-lb-name-pill" title="${escapeHtml(row.nick)}">${escapeHtml(row.nick)}</span></td>
            <td class="sg-lb-score">${row.score}</td>
            <td>${row.streak}</td>
            <td>${formatDuration(row.durationSec)}</td>
          </tr></tbody>
        </table>`;
    } else {
      playerRowEl.classList.add('is-hidden');
      playerRowEl.innerHTML = '';
    }
  }

  function _openLeaderboard(period) {
    const modal = document.getElementById('sg-leaderboard-modal');
    if (!modal) return;
    _renderLeaderboard(period || _lbPeriod);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    _lbOpen = true;
  }

  function _closeLeaderboard() {
    const modal = document.getElementById('sg-leaderboard-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    _lbOpen = false;
  }

  function _openIntro() {
    if (isIntroSuppressed()) return;
    const modal = document.getElementById('sg-intro-modal');
    if (modal) modal.setAttribute('aria-hidden', 'false');
  }

  function _closeIntro() {
    const modal = document.getElementById('sg-intro-modal');
    const check = document.getElementById('sg-intro-dismiss');
    if (!modal) return;
    if (check && check.checked) suppressIntroToday();
    modal.setAttribute('aria-hidden', 'true');
  }

  function _syncHudPanelHeight() {
    const container = document.getElementById('shot-game-container');
    const badge = document.getElementById('session-badge');
    if (!container || !badge) return;
    badge.style.height = 'auto';
  }

  function _updateSessionBadge() {
    const badge = document.getElementById('session-badge');
    if (!badge) return;
    if (!badge.querySelector('.sg-session-title')) {
      badge.innerHTML = `
        <div class="sg-session-top-title">本局記錄</div>
        <div class="sg-session-focus-row">
          <div class="sg-session-focus-box sg-session-focus-box-score">
            <div class="sg-session-focus-label">分數</div>
            <div class="sg-session-focus-value sg-session-focus-score">0</div>
          </div>
          <div class="sg-session-focus-box sg-session-focus-box-streak">
            <div class="sg-session-focus-label">連進</div>
            <div class="sg-session-focus-value sg-session-focus-streak">0</div>
          </div>
        </div>
        <div class="sg-session-title">當前最佳記錄</div>
        <div class="sg-session-best">
          <span class="sg-session-best-score">--</span>分
          <span class="sg-session-sep">|</span>
          <span class="sg-session-best-shots">--</span>射門
          <span class="sg-session-sep">|</span>
          <span class="sg-session-best-time">--</span>秒
        </div>
      `;
    }
    const bestScoreEl = badge.querySelector('.sg-session-best-score');
    const bestShotsEl = badge.querySelector('.sg-session-best-shots');
    const bestTimeEl = badge.querySelector('.sg-session-best-time');
    const focusScoreEl = badge.querySelector('.sg-session-focus-score');
    const focusStreakEl = badge.querySelector('.sg-session-focus-streak');

    const hasBest = !!_bestSession;
    const bestScore = hasBest ? Math.max(0, Math.round(Number(_bestSession.score) || 0)) : '--';
    const bestShots = hasBest ? Math.max(0, Math.round(Number(_bestSession.shots) || 0)) : '--';
    const bestTime = hasBest ? Math.max(0, Math.round(Number(_bestSession.durationMs || 0) / 1000)) : '--';
    const liveScore = Math.max(0, Math.round(Number(_liveScore) || 0));
    const liveStreak = Math.max(0, Math.round(Number(_liveStreak) || 0));

    if (bestScoreEl) bestScoreEl.textContent = String(bestScore);
    if (bestShotsEl) bestShotsEl.textContent = String(bestShots);
    if (bestTimeEl) bestTimeEl.textContent = String(bestTime);
    if (focusScoreEl) focusScoreEl.textContent = String(liveScore);
    if (focusStreakEl) focusStreakEl.textContent = String(liveStreak);
    _syncHudPanelHeight();
  }

  function _isBetter(incoming, best) {
    if (!best) return true;
    if (incoming.score !== best.score) return incoming.score > best.score;
    if (incoming.shots !== best.shots) return incoming.shots < best.shots;
    return incoming.durationMs < best.durationMs;
  }

  /* ── Game Start ── */
  async function _submitScoreToRanking(scorePayload) {
    const user = typeof auth !== 'undefined' ? auth.currentUser : null;
    if (!scorePayload || scorePayload.score <= 0 || !user) return;
    _lbSubmitPending = true;
    try {
      await firebase.app().functions('asia-east1').httpsCallable('submitShotGameScore')({
        score: scorePayload.score,
        shots: scorePayload.shots,
        streak: scorePayload.streak,
        durationMs: scorePayload.durationMs,
        displayName: getPreferredPlayerDisplayName(user),
      });
    } catch (_) {
      // Ignore ranking write errors in page module and keep gameplay uninterrupted.
    } finally {
      _lbSubmitPending = false;
      if (_lbOpen) _renderLeaderboard(_lbPeriod);
    }
  }
  function _startGame() {
    if (_engine) { _engine.destroy(); _engine = null; }
    const container = document.getElementById('shot-game-container');
    if (!container || !window.ShotGameEngine) return;
    _liveScore = 0;
    _liveStreak = 0;
    _updateSessionBadge();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(_syncHudPanelHeight).catch(() => {});
    } else {
      _syncHudPanelHeight();
    }

    const lowFx = new URLSearchParams(location.search).get('low') === '1';

    _engine = window.ShotGameEngine.create({
      container,
      lowFx,
      billboardImageUrl: _billboardAdImageUrl,
      ui: {
        scoreEl: document.getElementById('sg-score'),
        streakEl: document.getElementById('sg-streak'),
        powerBarEl: document.getElementById('sg-power'),
        powerFillEl: document.getElementById('sg-power-fill'),
        crosshairEl: document.getElementById('sg-crosshair'),
        messageEl: document.getElementById('sg-message'),
        restartBtn: document.getElementById('sg-restart'),
      },
      onScoreChange(payload) {
        _liveScore = Number(payload && payload.score != null ? payload.score : 0);
        _liveStreak = Number(payload && payload.streak != null ? payload.streak : 0);
        _updateSessionBadge();
      },
      onGameOver(payload) {
        const normalized = {
          score: Number(payload && payload.score ? payload.score : 0),
          shots: Number(payload && payload.shots ? payload.shots : 0),
          streak: Number(payload && payload.bestStreak != null ? payload.bestStreak : (payload ? payload.streak : 0)),
          durationMs: Number(payload && payload.durationMs ? payload.durationMs : 0),
        };
        if (_isBetter(normalized, _bestSession)) _bestSession = normalized;
        _updateSessionBadge();

        _submitScoreToRanking(normalized);
        if (_lbOpen) _renderLeaderboard(_lbPeriod);
      },
    });

    _updateSessionBadge();
    _openIntro();
  }

  /* ── Event Binding (once per session) ── */
  function _bindEvents() {
    if (_eventsBound) return;
    _eventsBound = true;

    const lbBtn = document.getElementById('sg-leaderboard-btn');
    if (lbBtn) {
      lbBtn.addEventListener('pointerdown', e => e.stopPropagation());
      lbBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); _openLeaderboard(_lbPeriod); });
    }

    const lbClose = document.getElementById('sg-leaderboard-close');
    if (lbClose) lbClose.addEventListener('click', _closeLeaderboard);

    const lbModal = document.getElementById('sg-leaderboard-modal');
    if (lbModal) lbModal.addEventListener('click', e => { if (e.target === lbModal) _closeLeaderboard(); });

    document.querySelectorAll('#sg-leaderboard-modal .sg-lb-tab').forEach(tab => {
      tab.addEventListener('click', () => _renderLeaderboard(tab.getAttribute('data-lb-period') || 'daily'));
    });

    const introStart = document.getElementById('sg-intro-start');
    if (introStart) introStart.addEventListener('click', _closeIntro);

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _lbOpen) _closeLeaderboard();
    });
    window.addEventListener('resize', _syncHudPanelHeight);

    window.addEventListener('beforeunload', () => { if (_engine) _engine.destroy(); });
  }

  /* ── Ad Loading ── */
  async function _loadAd() {
    const container = document.getElementById('sg-ad-container');
    const normalizeImageUrl = (ad) => (ad && typeof ad.image === 'string' ? ad.image.trim() : '');
    const toMillis = (value) => {
      if (!value) return 0;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
      if (typeof value.toDate === 'function') {
        const date = value.toDate();
        const ts = date instanceof Date ? date.getTime() : Number.NaN;
        return Number.isFinite(ts) ? ts : 0;
      }
      const parsed = Number(new Date(value).getTime());
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const isActiveShotAd = (ad) => !!(ad && ad.status === 'active' && normalizeImageUrl(ad));
    const pickBestShotAd = (ads) => {
      if (!Array.isArray(ads) || ads.length === 0) return null;
      const normalized = ads
        .filter(isActiveShotAd)
        .map((ad) => ({
          ...ad,
          _ts: Math.max(
            toMillis(ad.updatedAt),
            toMillis(ad.publishAt),
            toMillis(ad.createdAt)
          ),
        }))
        .sort((a, b) => b._ts - a._ts);
      return normalized[0] || null;
    };
    const resolveShotGameAd = async () => {
      try {
        if (typeof ApiService !== 'undefined' && ApiService && typeof ApiService.getShotGameAd === 'function') {
          const cached = ApiService.getShotGameAd();
          if (isActiveShotAd(cached)) return cached;
        }
      } catch (_) {}
      if (!window.firebase || typeof firebase.firestore !== 'function') return null;
      const db = firebase.firestore();
      const direct = await db.collection('banners').doc('sga1').get();
      if (direct.exists) {
        const directData = direct.data() || {};
        if (isActiveShotAd(directData)) return directData;
      }
      const slotSnap = await db.collection('banners').where('slot', '==', 'sga1').limit(12).get();
      const slotBest = pickBestShotAd(slotSnap.docs.map((doc) => doc.data() || {}));
      if (slotBest) return slotBest;
      const typeSnap = await db.collection('banners').where('type', '==', 'shotgame').limit(12).get();
      return pickBestShotAd(typeSnap.docs.map((doc) => doc.data() || {}));
    };
    const clearAd = () => {
      _billboardAdImageUrl = '';
      if (_engine && typeof _engine.setBillboardAdImage === 'function') _engine.setBillboardAdImage('');
      if (container) container.innerHTML = '';
    };

    try {
      const ad = await resolveShotGameAd();
      if (!isActiveShotAd(ad)) {
        clearAd();
        return;
      }
      const imageUrl = normalizeImageUrl(ad);
      const linkUrl = typeof ad.linkUrl === 'string' ? ad.linkUrl.trim() : '';
      _billboardAdImageUrl = imageUrl;
      if (_engine && typeof _engine.setBillboardAdImage === 'function') _engine.setBillboardAdImage(imageUrl);
      if (!container) return;
      const safeImg = imageUrl.replace(/"/g, '&quot;');
      const safeLnk = linkUrl.replace(/"/g, '&quot;');
      container.innerHTML = safeLnk
        ? `<a href="${safeLnk}" target="_blank" rel="noopener noreferrer"><img src="${safeImg}" alt="廣告"></a>`
        : `<img src="${safeImg}" alt="廣告">`;
    } catch (_) {
      clearAd();
    }
  }

  /* ── App Module Methods ── */
  Object.assign(App, {
    async initShotGamePage() {
      const currentUser = typeof auth !== 'undefined' ? auth.currentUser : null;
      const loginCard = document.getElementById('sg-login-required');
      const gameSection = document.getElementById('game-section');
      const loadingEl = document.getElementById('sg-main-loading');

      // Production: require login
      if (!ModeManager.isDemo() && !currentUser) {
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

      // Lazy-load Three.js + engine
      try {
        await _loadThreeJs();
        await _loadEngine();
      } catch (e) {
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
