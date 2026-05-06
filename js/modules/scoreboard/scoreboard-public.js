/* ================================================
   ToosterX - Public Scoreboard
   Cached scores and recent schedule page.
   ================================================ */

(function(root) {
  const app = (typeof App !== 'undefined') ? App : root.App;
  if (!app) return;
  root.App = app;

  function esc(value) {
    if (typeof root.escapeHTML === 'function') return root.escapeHTML(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function firebaseService() {
    return (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
  }

  function apiService() {
    return (typeof ApiService !== 'undefined') ? ApiService : root.ApiService;
  }

  function firestoreDb() {
    return (typeof db !== 'undefined') ? db : root.db;
  }

  function numberText(value) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? Math.floor(num).toLocaleString('zh-TW') : '0';
  }

  function scoreText(match) {
    const home = match?.homeScore;
    const away = match?.awayScore;
    if (home == null && away == null) return match?.timeLabel || '未開賽';
    return `${home ?? '-'} : ${away ?? '-'}`;
  }

  function sportLabel(config, sport) {
    return config?.sports?.[sport]?.label
      || root.ScoreboardConfigUtils?.SPORT_CATALOG?.find(item => item.key === sport)?.label
      || sport;
  }

  function allMatches(snapshot) {
    const live = Array.isArray(snapshot?.liveMatches) ? snapshot.liveMatches : [];
    const schedule = Array.isArray(snapshot?.recentSchedule) ? snapshot.recentSchedule : [];
    const map = new Map();
    [...live, ...schedule].forEach(match => {
      const key = match.detailCacheKey || `${match.sport}_${match.id}`;
      if (!map.has(key)) map.set(key, match);
    });
    return Array.from(map.values());
  }

  function matchesForSport(snapshot, sport) {
    return allMatches(snapshot).filter(match => match.sport === sport);
  }

  function matchRow(match) {
    const statusClass = match.isLive ? ' live' : '';
    return `
      <button class="scoreboard-match-row" type="button" onclick="App.openScoreboardMatchDetail('${esc(match.sport)}','${esc(match.id)}')">
        <span class="scoreboard-match-time">${esc(match.dateLabel || '')}<strong>${esc(match.timeLabel || '')}</strong></span>
        <span class="scoreboard-match-main">
          <b>${esc(match.title || `${match.homeTeam || ''} vs ${match.awayTeam || ''}`)}</b>
          <small>${esc(match.league || match.subtitle || '')}</small>
        </span>
        <span class="scoreboard-match-score${statusClass}">${esc(scoreText(match))}</span>
      </button>
    `;
  }

  function renderTabs(config, snapshot, activeSport) {
    const tabSports = (config.defaultSportTabs || config.enabledSports || [])
      .filter(sport => config.sports?.[sport]?.enabled !== false);
    const sports = tabSports.length ? tabSports : Object.keys(config.sports || {}).filter(key => config.sports[key]?.enabled);
    return `
      <div class="scoreboard-sport-tabs" role="tablist">
        ${sports.map(sport => {
          const count = matchesForSport(snapshot, sport).length;
          return `<button class="${sport === activeSport ? 'active' : ''}" type="button" role="tab" onclick="App.renderScoreboardPublic('${esc(sport)}')">${esc(sportLabel(config, sport))}<span>${numberText(count)}</span></button>`;
        }).join('')}
      </div>
    `;
  }

  function renderPublic(config, snapshot, activeSport) {
    const rootEl = document.getElementById('scoreboard-public-root');
    if (!rootEl) return;
    if (!config || config.publicPageEnabled === false) {
      rootEl.innerHTML = '<div class="scoreboard-empty">賽事比分頁目前未開放。</div>';
      return;
    }
    const sports = (config.defaultSportTabs || config.enabledSports || []).filter(key => config.sports?.[key]?.enabled);
    const sport = activeSport && config.sports?.[activeSport]?.enabled ? activeSport : sports[0];
    if (!sport) {
      rootEl.innerHTML = '<div class="scoreboard-empty">目前尚未啟用任何運動比分。</div>';
      return;
    }
    const matches = matchesForSport(snapshot, sport);
    const live = matches.filter(match => match.isLive);
    const schedule = matches.filter(match => !match.isLive);
    rootEl.innerHTML = `
      ${renderTabs(config, snapshot, sport)}
      <section class="scoreboard-public-panel">
        <div class="scoreboard-public-title-row">
          <h3>即時比分</h3>
          <span>${numberText(live.length)} 場</span>
        </div>
        <div class="scoreboard-public-list">
          ${live.length ? live.map(matchRow).join('') : '<div class="scoreboard-empty compact">目前沒有即時比分。</div>'}
        </div>
      </section>
      <section class="scoreboard-public-panel">
        <div class="scoreboard-public-title-row">
          <h3>最近賽程</h3>
          <span>${numberText(schedule.length)} 場</span>
        </div>
        <div class="scoreboard-public-list">
          ${schedule.length ? schedule.map(matchRow).join('') : '<div class="scoreboard-empty compact">目前沒有可顯示的賽程。</div>'}
        </div>
      </section>
    `;
    app._scoreboardActiveSport = sport;
  }

  async function loadSnapshot() {
    const service = firebaseService();
    const cached = service?.getCachedDoc?.('scoreboardSnapshots', 'home');
    if (cached) return cached;
    const loaded = await service?.ensureSingleDocLoaded?.('scoreboardSnapshots', 'home');
    return loaded || {};
  }

  function findMatch(sport, matchId) {
    const snapshot = app._scoreboardSnapshot || {};
    return allMatches(snapshot).find(match => String(match.sport) === String(sport) && String(match.id) === String(matchId));
  }

  async function readCachedDetail(cacheKey) {
    if (!cacheKey || !firestoreDb()) return null;
    try {
      const snap = await firestoreDb().collection('scoreboardMatchDetails').doc(cacheKey).get();
      return snap.exists ? snap.data() : null;
    } catch (_) {
      return null;
    }
  }

  function showDetailModal(match, detail, loadingText) {
    const existing = document.getElementById('scoreboard-detail-overlay');
    if (existing) existing.remove();
    const summary = detail?.summary || {};
    const stats = Array.isArray(detail?.statistics) ? detail.statistics.slice(0, 8) : [];
    const incidents = Array.isArray(detail?.incidents) ? detail.incidents.slice(0, 8) : [];
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'scoreboard-detail-overlay';
    overlay.onclick = (event) => { if (event.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div class="modal scoreboard-detail-modal">
        <div class="modal-header">
          <h3>${esc(summary.title || match?.title || '賽事詳情')}</h3>
          <button class="modal-close" type="button" onclick="document.getElementById('scoreboard-detail-overlay')?.remove()">×</button>
        </div>
        <div class="modal-body">
          ${loadingText ? `<div class="scoreboard-empty compact">${esc(loadingText)}</div>` : ''}
          <div class="scoreboard-detail-score">
            <span>${esc(summary.homeTeam || match?.homeTeam || '-')}</span>
            <strong>${esc(scoreText(match))}</strong>
            <span>${esc(summary.awayTeam || match?.awayTeam || '-')}</span>
          </div>
          <div class="scoreboard-detail-meta">
            <span>${esc(summary.league || match?.league || '')}</span>
            <span>${esc(summary.status || match?.status || '')}</span>
            <span>${esc(summary.venue || '')}</span>
          </div>
          ${stats.length ? `<h4>數據</h4><div class="scoreboard-detail-table">${stats.map(item => `<div><span>${esc(item.name || item.group)}</span><b>${esc(item.home ?? '-')} / ${esc(item.away ?? '-')}</b></div>`).join('')}</div>` : ''}
          ${incidents.length ? `<h4>賽事事件</h4><div class="scoreboard-detail-table">${incidents.map(item => `<div><span>${esc(item.time || item.type)}</span><b>${esc(item.player || item.text || item.type)}</b></div>`).join('')}</div>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  Object.assign(app, {
    async renderScoreboardPublic(activeSport) {
      const rootEl = document.getElementById('scoreboard-public-root');
      if (rootEl) rootEl.innerHTML = '<div class="scoreboard-public-loading">載入中...</div>';
      try {
        const config = await this.loadScoreboardConfig?.();
        const snapshot = await loadSnapshot();
        this._scoreboardConfig = config;
        this._scoreboardSnapshot = snapshot;
        const pending = this._scoreboardPendingContext || {};
        this._scoreboardPendingContext = null;
        renderPublic(config, snapshot, activeSport || pending.sport || this._scoreboardActiveSport);
        if (pending.matchId) {
          setTimeout(() => this.openScoreboardMatchDetail?.(pending.sport, pending.matchId), 0);
        }
        this._markPageSnapshotReady?.('page-match-calendar');
      } catch (err) {
        console.warn('[ScoreboardPublic] render failed:', err);
        if (rootEl) rootEl.innerHTML = '<div class="scoreboard-empty">賽事比分載入失敗，請稍後再試。</div>';
      }
    },

    async openScoreboardPage(sport, matchId) {
      this._scoreboardPendingContext = { sport, matchId };
      await this.showPage?.('page-match-calendar');
    },

    async openScoreboardMatchDetail(sport, matchId) {
      const match = findMatch(sport, matchId);
      if (!match) return;
      showDetailModal(match, null, '讀取詳情中...');
      const cacheKey = match.detailCacheKey || `${sport}_${matchId}`.replace(/[^a-z0-9_-]/gi, '_');
      let detail = await readCachedDetail(cacheKey);
      const currentUser = apiService()?.getCurrentUser?.() || firebaseService()?._cache?.currentUser || null;
      if (!detail && currentUser && root.firebase?.app) {
        try {
          const callable = root.firebase.app().functions('asia-east1').httpsCallable('fetchSportsApiProMatchDetail', { timeout: 90000 });
          const res = await callable({ sport, matchId });
          detail = res?.data?.detail || null;
        } catch (err) {
          console.warn('[ScoreboardPublic] detail callable skipped:', err?.message || err);
        }
      }
      showDetailModal(match, detail, detail ? '' : '目前只有基本比分摘要，詳細數據稍後補上。');
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
