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
      let leaderboardPeriod = 'daily';
      let leaderboardOpen = false;

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

      const isBetterSession = (incoming, currentBest) => {
        if (!currentBest) return true;
        if (incoming.score !== currentBest.score) return incoming.score > currentBest.score;
        if (incoming.shots !== currentBest.shots) return incoming.shots < currentBest.shots;
        return incoming.durationMs < currentBest.durationMs;
      };
      const setSessionBadge = () => {
        if (!sessionBadge) return;
        if (!bestSessionSinceOpen) {
          sessionBadge.textContent = '當前最佳：尚無紀錄';
          return;
        }
        sessionBadge.textContent = `當前最佳：${bestSessionSinceOpen.score} 分｜${bestSessionSinceOpen.shots} 射門｜${Math.round(bestSessionSinceOpen.durationMs / 1000)} 秒`;
      };
      const buildLeaderboardView = (period) => {
        const rows = (leaderboardData[period] || []).map((row) => ({ ...row }));
        if (bestSessionSinceOpen && bestSessionSinceOpen.score > 0) {
          rows.push({
            id: 'player-self',
            nick: '你',
            score: bestSessionSinceOpen.score,
            streak: Math.max(0, Number(bestSessionSinceOpen.streak || 0)),
            durationSec: Math.max(0, Math.round(Number(bestSessionSinceOpen.durationMs || 0) / 1000)),
          });
        }
        rows.sort(compareLeaderboardRows);
        const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
        const topRows = ranked.slice(0, LEADERBOARD_TOP_SIZE);
        const playerRow = ranked.find((row) => row.id === 'player-self') || null;
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
          leaderboardData[key] = snap.docs.map(d => {
            const e = d.data();
            return {
              id: d.id,
              nick: e.displayName || '匿名玩家',
              score: e.bestScore || 0,
              streak: e.bestStreak || 0,
              durationSec: 0,
            };
          });
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

      const startGame = () => {
        if (engine) engine.destroy();
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

            // 非同步提交分數至 Cloud Function（失敗靜默，不阻塞遊戲流程）
            const gameUser = (typeof auth !== 'undefined') ? auth.currentUser : null;
            if (normalized.score > 0 && gameUser) {
              firebase.app().functions('asia-east1').httpsCallable('submitShotGameScore')({
                score: normalized.score,
                shots: normalized.shots,
                streak: normalized.streak,
                durationMs: normalized.durationMs,
                displayName: gameUser.displayName || '匿名玩家',
              }).then(() => {
                if (leaderboardOpen) renderLeaderboard(leaderboardPeriod);
              }).catch(() => {});
            }

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
          if (!currentUser) {
            const tokenForm = document.getElementById('token-form');
            const loginCard = document.getElementById('login-required-card');
            if (tokenForm) tokenForm.style.display = 'none';
            if (loginCard) loginCard.style.display = '';
            gate.style.display = 'block';
            gameSection.style.display = 'none';
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
