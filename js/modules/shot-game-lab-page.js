(function () {
  const LEADERBOARD_TOP_SIZE = 10;
  const LEADERBOARD_POOL_SIZE = 60;
  const LEADERBOARD_PERIOD_LABELS = {
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
  };
  const PERIOD_CONFIG = {
    daily: { baseScore: 1980, scoreStep: 39, streakBase: 22, timeBase: 62 },
    weekly: { baseScore: 2580, scoreStep: 43, streakBase: 27, timeBase: 74 },
    monthly: { baseScore: 3220, scoreStep: 47, streakBase: 32, timeBase: 86 },
  };
  const MOCK_NAME_POOL = [
    '超級射門王AlphaWolf',
    '今晚一定進球的阿哲隊長',
    'TooSterxHub挑戰者_小旋風',
    'MinaTheLegendaryShooter',
    '左上死角專打選手_布丁',
    '晨安今天也要踢進去',
    '守門員看到就頭痛',
    'KikiPowerKickUnlimited',
    '宇宙最強門前終結者',
    '快狠準射手Rex',
    'Jay今天狀態超級好',
    '連進傳說保持者',
    '阿杰本季大爆發',
    '喵喵喵喵連進模式',
    'Kevin超遠距離破門',
    'TomLongNameForEllipsisTest',
    '神級勁射二號機',
    'Momo_IncredibleFinisher',
    'Nina火力全開測試用名稱',
    '小白第一腳就破網',
  ];

  function formatDuration(seconds) {
    const sec = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(sec / 60);
    const remain = sec % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  }
  function hashSeed(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function createRng(seed) {
    let s = seed >>> 0;
    return function next() {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
  function compareLeaderboardRows(a, b) {
    return (
      b.score - a.score
      || b.streak - a.streak
      || a.durationSec - b.durationSec
      || a.nick.localeCompare(b.nick, 'zh-Hant')
    );
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
    if (rank === 1) {
      return '<svg class="lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f6c94c"/><path d="M12 5l2.1 4.2 4.6.7-3.3 3.2.8 4.6L12 15.5 7.8 17.7l.8-4.6-3.3-3.2 4.6-.7z" fill="#fff3c4"/></svg>';
    }
    if (rank === 2) {
      return '<svg class="lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#adb7c4"/><path d="M12 6l5 4v8H7v-8z" fill="#e9eef5"/></svg>';
    }
    if (rank === 3) {
      return '<svg class="lb-rank-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#b98252"/><path d="M7 16l2.2-8h5.6l2.2 8z" fill="#f7d5b5"/></svg>';
    }
    return '';
  }
  function buildMockLeaderboard(period) {
    const key = period in PERIOD_CONFIG ? period : 'daily';
    const cfg = PERIOD_CONFIG[key];
    const rng = createRng(hashSeed(`shot-game-leaderboard:${key}`));
    const rows = [];

    for (let i = 0; i < LEADERBOARD_POOL_SIZE; i += 1) {
      const baseName = MOCK_NAME_POOL[i % MOCK_NAME_POOL.length];
      const nickSuffix = String(1000 + Math.floor(rng() * 9000));
      const scoreDrop = i * (cfg.scoreStep + Math.floor(rng() * 8));
      const score = Math.max(100, cfg.baseScore - scoreDrop - Math.floor(rng() * 28));
      const streak = Math.max(1, cfg.streakBase - Math.floor(i * 0.7) + Math.floor(rng() * 5));
      const durationSec = cfg.timeBase + i * 4 + Math.floor(rng() * 42);
      const nick = rng() < 0.7 ? `${baseName}_${nickSuffix}` : `${baseName}${nickSuffix}`;
      rows.push({
        id: `mock-${key}-${i}`,
        nick,
        score,
        streak,
        durationSec,
      });
    }

    rows.sort(compareLeaderboardRows);
    return rows.map((row) => ({
      id: row.id,
      nick: row.nick,
      score: row.score,
      streak: row.streak,
      durationSec: row.durationSec,
    }));
  }
  const INTRO_DISMISS_KEY = 'sporthub_shot_game_intro_dismissed';
  function getTaipeiDateStr() {
    const t = new Date(Date.now() + 8 * 3600000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(t.getUTCDate()).padStart(2,'0')}`;
  }
  function isIntroSuppressed() {
    try { return localStorage.getItem(INTRO_DISMISS_KEY) === getTaipeiDateStr(); } catch(_) { return false; }
  }
  function suppressIntroToday() {
    try { localStorage.setItem(INTRO_DISMISS_KEY, getTaipeiDateStr()); } catch(_) {}
  }

  function getTaipeiDateBucket(period) {
    const offsetMs = 8 * 60 * 60 * 1000;
    const t = new Date(Date.now() + offsetMs);
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

  async function sha256Hex(input) {
    const bytes = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const ShotGameLabPage = {
    init(options) {
      const requiredTokenHash = String(options && options.requiredTokenHash ? options.requiredTokenHash : '').toLowerCase();
      const tokenQueryKey = String(options && options.tokenQueryKey ? options.tokenQueryKey : 't');
      const gate = document.getElementById('token-gate');
      const gameSection = document.getElementById('game-section');
      const gameContainer = document.getElementById('shot-game-container');
      const tokenInput = document.getElementById('token-input');
      const tokenSubmit = document.getElementById('token-submit');
      const tokenFeedback = document.getElementById('token-feedback');
      const sessionBadge = document.getElementById('session-badge');
      const leaderboardBtn = document.getElementById('sg-leaderboard-btn');
      const leaderboardModal = document.getElementById('sg-leaderboard-modal');
      const leaderboardClose = document.getElementById('sg-leaderboard-close');
      const leaderboardRange = document.getElementById('sg-leaderboard-range');
      const leaderboardBody = document.getElementById('sg-leaderboard-body');
      const leaderboardPlayerRow = document.getElementById('sg-leaderboard-player-row');
      const leaderboardTabs = Array.from(document.querySelectorAll('.lb-tab'));
      const introModal = document.getElementById('sg-intro-modal');
      const introDismissCheck = document.getElementById('sg-intro-dismiss');
      const introStartBtn = document.getElementById('sg-intro-start');
      const lowFx = new URLSearchParams(location.search).get('low') === '1';
      let engine = null;
      let bestSessionSinceOpen = null;
      let currentScore = 0;
      let currentStreak = 0;
      let leaderboardPeriod = 'daily';
      let leaderboardOpen = false;
      let leaderboardSubmitPending = false;

      const leaderboardData = {
        daily: buildMockLeaderboard('daily'),
        weekly: buildMockLeaderboard('weekly'),
        monthly: buildMockLeaderboard('monthly'),
      };

      if (!gate || !gameSection || !gameContainer) {
        throw new Error('Missing required game lab elements');
      }

      const showGate = (message) => {
        gate.style.display = 'block';
        gameSection.style.display = 'none';
        if (tokenFeedback) tokenFeedback.textContent = message || 'Enter test token to continue';
      };
      const showGame = () => {
        gate.style.display = 'none';
        gameSection.style.display = 'block';
      };
      const showLoginRequiredCard = (message) => {
        const tokenForm = document.getElementById('token-form');
        const loginCard = document.getElementById('login-required-card');
        if (tokenForm) tokenForm.style.display = 'none';
        if (loginCard) loginCard.style.display = '';
        gate.style.display = 'block';
        gameSection.style.display = 'none';
        if (tokenFeedback) tokenFeedback.textContent = message || '請先登入才能遊玩';
      };
      const isAnonymousAuthUser = (user) => {
        if (!user) return false;
        if (user.isAnonymous) return true;
        const providers = Array.isArray(user.providerData) ? user.providerData : [];
        return providers.some((provider) => String(provider && provider.providerId ? provider.providerId : '').toLowerCase() === 'anonymous');
      };
      const isRankingEligibleUser = (user) => !!user && !isAnonymousAuthUser(user);

      const isBetterSession = (incoming, currentBest) => {
        if (!currentBest) return true;
        if (incoming.score !== currentBest.score) return incoming.score > currentBest.score;
        if (incoming.shots !== currentBest.shots) return incoming.shots < currentBest.shots;
        return incoming.durationMs < currentBest.durationMs;
      };
      const syncHudPanelHeight = () => {
        if (!gameContainer || !sessionBadge) return;
        const guide = gameContainer.querySelector('.goal-guide');
        if (!guide) return;
        const guideHeight = Math.ceil(guide.getBoundingClientRect().height);
        if (guideHeight > 0) sessionBadge.style.height = `${guideHeight}px`;
      };
      const ensureSessionBadgeTemplate = () => {
        if (!sessionBadge || sessionBadge.querySelector('.sg-session-title')) return;
        sessionBadge.innerHTML = `
          <div class="sg-session-title">當前最佳記錄</div>
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
          <div class="sg-session-best">
            <span class="sg-session-best-score">--</span>分
            <span class="sg-session-sep">|</span>
            <span class="sg-session-best-shots">--</span>射門
            <span class="sg-session-sep">|</span>
            <span class="sg-session-best-time">--</span>秒
          </div>
          <div class="sg-session-divider" aria-hidden="true"></div>
          <div class="sg-session-live">
            分數:<span class="sg-session-live-score">0</span>
            <span class="sg-session-sep">|</span>
            連進:<span class="sg-session-live-streak">0</span>
          </div>
        `;
      };
      const setSessionBadge = () => {
        if (!sessionBadge) return;
        ensureSessionBadgeTemplate();
        const bestScoreEl = sessionBadge.querySelector('.sg-session-best-score');
        const bestShotsEl = sessionBadge.querySelector('.sg-session-best-shots');
        const bestTimeEl = sessionBadge.querySelector('.sg-session-best-time');
        const focusScoreEl = sessionBadge.querySelector('.sg-session-focus-score');
        const focusStreakEl = sessionBadge.querySelector('.sg-session-focus-streak');
        const liveScoreEl = sessionBadge.querySelector('.sg-session-live-score');
        const liveStreakEl = sessionBadge.querySelector('.sg-session-live-streak');

        const hasBest = !!bestSessionSinceOpen;
        const bestScore = hasBest ? Math.max(0, Math.round(Number(bestSessionSinceOpen.score) || 0)) : '--';
        const bestShots = hasBest ? Math.max(0, Math.round(Number(bestSessionSinceOpen.shots) || 0)) : '--';
        const bestTime = hasBest ? Math.max(0, Math.round(Number(bestSessionSinceOpen.durationMs || 0) / 1000)) : '--';
        const liveScore = Math.max(0, Math.round(Number(currentScore) || 0));
        const liveStreak = Math.max(0, Math.round(Number(currentStreak) || 0));

        if (bestScoreEl) bestScoreEl.textContent = String(bestScore);
        if (bestShotsEl) bestShotsEl.textContent = String(bestShots);
        if (bestTimeEl) bestTimeEl.textContent = String(bestTime);
        if (focusScoreEl) focusScoreEl.textContent = String(liveScore);
        if (focusStreakEl) focusStreakEl.textContent = String(liveStreak);
        if (liveScoreEl) liveScoreEl.textContent = String(liveScore);
        if (liveStreakEl) liveStreakEl.textContent = String(liveStreak);
        syncHudPanelHeight();
      };
      const buildLeaderboardView = (period) => {
        const rows = dedupeLeaderboardRows((leaderboardData[period] || []).map((row) => ({ ...row })));
        const currentUid = getCurrentAuthUid();
        const localBestRow = bestSessionSinceOpen && bestSessionSinceOpen.score > 0
          ? {
            score: bestSessionSinceOpen.score,
            streak: Math.max(0, Number(bestSessionSinceOpen.streak || 0)),
            durationSec: Math.max(0, Math.round(Number(bestSessionSinceOpen.durationMs || 0) / 1000)),
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
          } else if (localBestRow && leaderboardSubmitPending) {
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
        rows.sort(compareLeaderboardRows);
        const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
        const topRows = ranked.slice(0, LEADERBOARD_TOP_SIZE);
        const playerRow = ranked.find((row) => selfIds.has(row.id)) || null;
        const extraPlayerRow = playerRow && playerRow.rank > LEADERBOARD_TOP_SIZE ? playerRow : null;
        return { topRows, extraPlayerRow };
      };

      const renderLeaderboard = async (period) => {
        if (!leaderboardBody) return;
        const key = period in LEADERBOARD_PERIOD_LABELS ? period : 'daily';
        leaderboardPeriod = key;

        if (leaderboardRange) leaderboardRange.textContent = `${LEADERBOARD_PERIOD_LABELS[key]}排行前 ${LEADERBOARD_TOP_SIZE} 名`;
        leaderboardTabs.forEach((tab) => {
          const active = tab.getAttribute('data-lb-period') === key;
          tab.classList.toggle('is-active', active);
          tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        // 顯示載入中
        leaderboardBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">載入中…</td></tr>';
        if (leaderboardPlayerRow) { leaderboardPlayerRow.classList.add('is-hidden'); leaderboardPlayerRow.innerHTML = ''; }

        // 從 Firestore 直接讀取排行榜資料
        try {
          const bucket = getTaipeiDateBucket(key);
          const snap = await firebase.firestore()
            .collection('shotGameRankings').doc(bucket)
            .collection('entries')
            .orderBy('bestScore', 'desc').limit(50).get();
          leaderboardData[key] = snap.docs
            .map(d => normalizeLeaderboardRow(d.id, d.data()))
            .filter(row => !isAnonymousLeaderboardRow(row));
        } catch (_) {
          leaderboardBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">讀取失敗，請稍後再試</td></tr>';
          return;
        }

        if ((leaderboardData[key] || []).length === 0 && !bestSessionSinceOpen) {
          leaderboardBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;opacity:0.6">尚無排行資料</td></tr>';
          return;
        }

        const view = buildLeaderboardView(key);
        const rows = view.topRows;
        leaderboardBody.innerHTML = rows.map((row) => {
          const rowClass = row.rank <= 3 ? ` class="lb-row-top${row.rank}"` : '';
          const rankLabel = row.rank <= 3
            ? `<span class="lb-rank-badge">${buildRankIcon(row.rank)}<span>${row.rank}</span></span>`
            : `#${row.rank}`;
          return `
          <tr${rowClass}>
            <td class="lb-rank">${rankLabel}</td>
            <td class="lb-nick"><span class="lb-name-pill" title="${escapeHtml(row.nick)}">${escapeHtml(row.nick)}</span></td>
            <td class="lb-score">${row.score}</td>
            <td>${row.streak}</td>
            <td>${formatDuration(row.durationSec)}</td>
          </tr>
        `;
        }).join('');

        if (!leaderboardPlayerRow) return;
        if (view.extraPlayerRow) {
          const row = view.extraPlayerRow;
          leaderboardPlayerRow.classList.remove('is-hidden');
          leaderboardPlayerRow.innerHTML = `
            <h4>你的名次</h4>
            <table aria-label="玩家名次">
              <colgroup>
                <col class="lb-col-rank">
                <col class="lb-col-nick">
                <col class="lb-col-score">
                <col class="lb-col-streak">
                <col class="lb-col-time">
              </colgroup>
              <tbody>
                <tr>
                  <td class="lb-rank">#${row.rank}</td>
                  <td class="lb-nick"><span class="lb-name-pill" title="${escapeHtml(row.nick)}">${escapeHtml(row.nick)}</span></td>
                  <td class="lb-score">${row.score}</td>
                  <td>${row.streak}</td>
                  <td>${formatDuration(row.durationSec)}</td>
                </tr>
              </tbody>
            </table>
          `;
        } else {
          leaderboardPlayerRow.classList.add('is-hidden');
          leaderboardPlayerRow.innerHTML = '';
        }
      };
      const openIntro = () => {
        if (isIntroSuppressed() || !introModal) return;
        introModal.setAttribute('aria-hidden', 'false');
      };
      const closeIntro = () => {
        if (!introModal) return;
        if (introDismissCheck && introDismissCheck.checked) suppressIntroToday();
        introModal.setAttribute('aria-hidden', 'true');
      };

      const openLeaderboard = (period) => {
        if (!leaderboardModal) return;
        renderLeaderboard(period || leaderboardPeriod);
        leaderboardModal.classList.add('is-open');
        leaderboardModal.setAttribute('aria-hidden', 'false');
        leaderboardOpen = true;
      };
      const closeLeaderboard = () => {
        if (!leaderboardModal) return;
        leaderboardModal.classList.remove('is-open');
        leaderboardModal.setAttribute('aria-hidden', 'true');
        leaderboardOpen = false;
      };
      const submitScoreToRanking = async (scorePayload) => {
        const gameUser = (typeof auth !== 'undefined') ? auth.currentUser : null;
        if (!scorePayload || scorePayload.score <= 0 || !isRankingEligibleUser(gameUser)) return;
        leaderboardSubmitPending = true;
        try {
          await firebase.app().functions('asia-east1').httpsCallable('submitShotGameScore')({
            score: scorePayload.score,
            shots: scorePayload.shots,
            streak: scorePayload.streak,
            durationMs: scorePayload.durationMs,
            displayName: getPreferredPlayerDisplayName(gameUser),
          });
        } catch (err) {
          console.warn('[ShotGameLab] submitShotGameScore failed:', err && err.code ? err.code : '', err && err.message ? err.message : err);
          if (err && err.code === 'functions/permission-denied') {
            showLoginRequiredCard('目前登入狀態無法寫入射手榜，請先回主站重新登入 LINE');
          }
        } finally {
          leaderboardSubmitPending = false;
          if (leaderboardOpen) await renderLeaderboard(leaderboardPeriod);
        }
      };

      const startGame = () => {
        if (engine) engine.destroy();
        currentScore = 0;
        currentStreak = 0;
        setSessionBadge();
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(syncHudPanelHeight).catch(() => {});
        } else {
          syncHudPanelHeight();
        }
        engine = window.ShotGameEngine.create({
          container: gameContainer,
          lowFx,
          ui: {
            scoreEl: document.getElementById('sg-score'),
            streakEl: document.getElementById('sg-streak'),
            powerBarEl: document.getElementById('sg-power'),
            powerFillEl: document.getElementById('sg-power-fill'),
            crosshairEl: document.getElementById('sg-crosshair'),
            messageEl: document.getElementById('sg-message'),
            restartBtn: document.getElementById('sg-restart'),
          },
          onScoreChange: (payload) => {
            currentScore = Number(payload && payload.score != null ? payload.score : 0);
            currentStreak = Number(payload && payload.streak != null ? payload.streak : 0);
            setSessionBadge();
          },
          onGameOver: (payload) => {
            const payloadStreak = payload && payload.bestStreak != null ? payload.bestStreak : (payload ? payload.streak : 0);
            const normalized = {
              score: Number(payload && payload.score ? payload.score : 0),
              shots: Number(payload && payload.shots ? payload.shots : 0),
              streak: Number(payloadStreak || 0),
              durationMs: Number(payload && payload.durationMs ? payload.durationMs : 0),
            };
            if (isBetterSession(normalized, bestSessionSinceOpen)) bestSessionSinceOpen = normalized;
            setSessionBadge();

            submitScoreToRanking(normalized);

            if (leaderboardOpen) renderLeaderboard(leaderboardPeriod);
          },
        });
        setSessionBadge();
        openIntro();
      };

      const validateToken = async (rawToken) => {
        if (!rawToken || !requiredTokenHash) return false;
        const hash = await sha256Hex(rawToken.trim());
        return hash.toLowerCase() === requiredTokenHash;
      };

      const unlockWithToken = async (rawToken, updateUrl) => {
        if (tokenSubmit) tokenSubmit.disabled = true;
        try {
          const ok = await validateToken(rawToken);
          if (!ok) {
            showGate('Token 無效，請確認後再試');
            return false;
          }
          if (updateUrl) {
            const url = new URL(location.href);
            url.searchParams.set(tokenQueryKey, rawToken.trim());
            history.replaceState(null, '', url.pathname + url.search + url.hash);
          }
          // 等待 Firebase auth 狀態恢復（最多 5 秒）
          if (typeof _firebaseAuthReadyPromise !== 'undefined') {
            try {
              await Promise.race([_firebaseAuthReadyPromise, new Promise(r => setTimeout(r, 5000))]);
            } catch(_) {}
          }
          // 確認已登入
          const currentUser = (typeof auth !== 'undefined') ? auth.currentUser : null;
          if (!isRankingEligibleUser(currentUser)) {
            showLoginRequiredCard(
              currentUser
                ? '請先以 LINE 帳號登入（非匿名）才能寫入射手榜'
                : '請先登入才能遊玩'
            );
            return false;
          }
          showGame();
          startGame();
          if (tokenFeedback) tokenFeedback.textContent = 'Token 驗證成功';
          return true;
        } catch (_) {
          showGate('Token 驗證失敗，請重試');
          return false;
        } finally {
          if (tokenSubmit) tokenSubmit.disabled = false;
        }
      };

      if (tokenSubmit) {
        tokenSubmit.addEventListener('click', () => {
          unlockWithToken(tokenInput ? tokenInput.value : '', true);
        });
      }
      if (tokenInput) {
        tokenInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') unlockWithToken(tokenInput.value, true);
        });
      }
      if (leaderboardBtn) {
        leaderboardBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
        leaderboardBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openLeaderboard(leaderboardPeriod);
        });
      }
      if (introStartBtn) introStartBtn.addEventListener('click', closeIntro);
      if (leaderboardClose) leaderboardClose.addEventListener('click', closeLeaderboard);
      if (leaderboardModal) {
        leaderboardModal.addEventListener('click', (event) => {
          if (event.target === leaderboardModal) closeLeaderboard();
        });
      }
      leaderboardTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          renderLeaderboard(tab.getAttribute('data-lb-period') || 'daily');
        });
      });
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && leaderboardOpen) closeLeaderboard();
      });
      window.addEventListener('resize', syncHudPanelHeight);
      window.addEventListener('beforeunload', () => { if (engine) engine.destroy(); });

      renderLeaderboard(leaderboardPeriod);
      setSessionBadge();
      const tokenFromUrl = new URLSearchParams(location.search).get(tokenQueryKey) || '';
      if (tokenFromUrl) unlockWithToken(tokenFromUrl, false);
      else showGate('請輸入測試 Token 繼續');
    },
  };

  window.ShotGameLabPage = ShotGameLabPage;
})();
