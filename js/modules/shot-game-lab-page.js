(function () {
  const DEFAULT_STORAGE_KEY = 'sporthub_shot_game_lab_metrics_v1';
  const MAX_SESSIONS = 300;

  function parseJson(text, fallback) {
    try { return JSON.parse(text); } catch (_) { return fallback; }
  }
  function isoTime(value) {
    try { return new Date(value).toISOString(); } catch (_) { return new Date().toISOString(); }
  }
  function normalizeStore(input) {
    const base = (input && typeof input === 'object') ? input : {};
    const sessions = Array.isArray(base.sessions) ? base.sessions.filter((row) => row && typeof row === 'object') : [];
    return { version: 1, sessions: sessions.slice(-MAX_SESSIONS) };
  }
  function readStore(storageKey) {
    const raw = localStorage.getItem(storageKey);
    return normalizeStore(parseJson(raw, { version: 1, sessions: [] }));
  }
  function writeStore(storageKey, store) {
    localStorage.setItem(storageKey, JSON.stringify(normalizeStore(store)));
  }
  function recordSession(storageKey, payload) {
    const store = readStore(storageKey);
    const session = {
      score: Number(payload.score || 0),
      streak: Number(payload.streak || 0),
      shots: Number(payload.shots || 0),
      durationMs: Number(payload.durationMs || 0),
      endedAt: isoTime(payload.endedAt || Date.now()),
    };
    store.sessions.push(session);
    if (store.sessions.length > MAX_SESSIONS) store.sessions.splice(0, store.sessions.length - MAX_SESSIONS);
    writeStore(storageKey, store);
    return store;
  }
  function summarize(store) {
    const sessions = store.sessions || [];
    const plays = sessions.length;
    const bestScore = sessions.reduce((max, row) => Math.max(max, Number(row.score || 0)), 0);
    const avgDurationMs = plays ? Math.round(sessions.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) / plays) : 0;
    const avgScore = plays ? Math.round((sessions.reduce((sum, row) => sum + Number(row.score || 0), 0) / plays) * 10) / 10 : 0;
    const totalShots = sessions.reduce((sum, row) => sum + Number(row.shots || 0), 0);
    const lastPlayedAt = plays ? sessions[plays - 1].endedAt : null;
    return { plays, bestScore, avgDurationMs, avgScore, totalShots, lastPlayedAt };
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
      const storageKey = String(options && options.storageKey ? options.storageKey : DEFAULT_STORAGE_KEY);
      const gate = document.getElementById('token-gate');
      const gameSection = document.getElementById('game-section');
      const gameContainer = document.getElementById('shot-game-container');
      const tokenInput = document.getElementById('token-input');
      const tokenSubmit = document.getElementById('token-submit');
      const tokenFeedback = document.getElementById('token-feedback');
      const summaryEl = document.getElementById('metrics-summary');
      const exportBtn = document.getElementById('metrics-export');
      const resetBtn = document.getElementById('metrics-reset');
      const exportOutput = document.getElementById('metrics-export-output');
      const sessionBadge = document.getElementById('session-badge');
      const lowFx = new URLSearchParams(location.search).get('low') === '1';
      let engine = null;
      let bestSessionSinceOpen = null;

      if (!gate || !gameSection || !gameContainer) {
        throw new Error('Missing required game lab elements');
      }

      const renderSummary = () => {
        const store = readStore(storageKey);
        const summary = summarize(store);
        if (summaryEl) {
          summaryEl.textContent = JSON.stringify({
            plays: summary.plays,
            bestScore: summary.bestScore,
            avgDurationMs: summary.avgDurationMs,
            avgScore: summary.avgScore,
            totalShots: summary.totalShots,
            lastPlayedAt: summary.lastPlayedAt,
          }, null, 2);
        }
      };

      const showGate = (message) => {
        gate.style.display = '';
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

      const exportStore = async () => {
        const store = readStore(storageKey);
        const payload = { exportedAt: new Date().toISOString(), summary: summarize(store), sessions: store.sessions };
        const text = JSON.stringify(payload, null, 2);
        if (exportOutput) exportOutput.value = text;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            if (tokenFeedback) tokenFeedback.textContent = '已匯出並複製至剪貼簿';
          } else if (tokenFeedback) tokenFeedback.textContent = '已匯出至下方文字框';
        } catch (_) {
          if (tokenFeedback) tokenFeedback.textContent = '已匯出至下方文字框';
        }
      };

      const resetStore = () => {
        localStorage.removeItem(storageKey);
        renderSummary();
        bestSessionSinceOpen = null;
        setSessionBadge();
        if (exportOutput) exportOutput.value = '';
        if (tokenFeedback) tokenFeedback.textContent = '本地數據已清除';
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
            const store = recordSession(storageKey, payload);
            renderSummary(store);
            const normalized = {
              score: Number(payload && payload.score ? payload.score : 0),
              shots: Number(payload && payload.shots ? payload.shots : 0),
              durationMs: Number(payload && payload.durationMs ? payload.durationMs : 0),
            };
            if (isBetterSession(normalized, bestSessionSinceOpen)) bestSessionSinceOpen = normalized;
            setSessionBadge();
          },
        });
        renderSummary();
        setSessionBadge();
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
      if (exportBtn) exportBtn.addEventListener('click', exportStore);
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (window.confirm('確定清除本地測試數據？')) resetStore();
        });
      }
      window.addEventListener('beforeunload', () => { if (engine) engine.destroy(); });

      renderSummary();
      const tokenFromUrl = new URLSearchParams(location.search).get(tokenQueryKey) || '';
      if (tokenFromUrl) unlockWithToken(tokenFromUrl, false);
      else showGate('請輸入測試 Token 繼續');
    },
  };

  window.ShotGameLabPage = ShotGameLabPage;
})();
