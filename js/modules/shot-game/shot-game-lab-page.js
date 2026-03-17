/* ================================================
   Shot Game Lab — Page Init & Lifecycle
   Token 驗證、遊戲啟動、事件綁定
   Depends on: shot-lab-ui.js, shot-lab-controls.js
   ================================================ */
(function () {
  var UI = window._ShotLabUI;
  var Data = window._ShotLabData;

  var ShotGameLabPage = {
    init: function (options) {
      var requiredTokenHash = String(options && options.requiredTokenHash ? options.requiredTokenHash : '').toLowerCase();
      var tokenQueryKey = String(options && options.tokenQueryKey ? options.tokenQueryKey : 't');
      var $ = function (id) { return document.getElementById(id); };
      var gate = $('token-gate'), gameSection = $('game-section'), gameContainer = $('shot-game-container');
      var tokenInput = $('token-input'), tokenSubmit = $('token-submit'), tokenFeedback = $('token-feedback');
      var sessionBadge = $('session-badge'), leaderboardBtn = $('sg-leaderboard-btn');
      var leaderboardModal = $('sg-leaderboard-modal'), leaderboardClose = $('sg-leaderboard-close');
      var leaderboardRange = $('sg-leaderboard-range'), leaderboardBody = $('sg-leaderboard-body');
      var leaderboardPlayerRow = $('sg-leaderboard-player-row');
      var leaderboardTabs = Array.from(document.querySelectorAll('.lb-tab'));
      var introModal = $('sg-intro-modal'), introDismissCheck = $('sg-intro-dismiss'), introStartBtn = $('sg-intro-start');
      var lowFx = new URLSearchParams(location.search).get('low') === '1';
      var engine = null;
      var bestSessionSinceOpen = null;
      var currentScore = 0;
      var currentStreak = 0;
      var leaderboardPeriod = 'daily';
      var leaderboardOpen = false;
      var leaderboardSubmitPending = false;

      var leaderboardData = {
        daily: Data.buildMockLeaderboard('daily'),
        weekly: Data.buildMockLeaderboard('weekly'),
        monthly: Data.buildMockLeaderboard('monthly'),
      };

      if (!gate || !gameSection || !gameContainer) {
        throw new Error('Missing required game lab elements');
      }

      var showGate = function (msg) { gate.style.display = 'block'; gameSection.style.display = 'none'; if (tokenFeedback) tokenFeedback.textContent = msg || 'Enter test token to continue'; };
      var showGame = function () { gate.style.display = 'none'; gameSection.style.display = 'block'; };
      var showLoginRequiredCard = function (msg) {
        var tf = document.getElementById('token-form'), lc = document.getElementById('login-required-card');
        if (tf) tf.style.display = 'none'; if (lc) lc.style.display = '';
        gate.style.display = 'block'; gameSection.style.display = 'none';
        if (tokenFeedback) tokenFeedback.textContent = msg || '\u8ACB\u5148\u767B\u5165\u624D\u80FD\u904A\u73A9';
      };
      var isAnonymousAuthUser = function (user) {
        if (!user) return false;
        if (user.isAnonymous) return true;
        var providers = Array.isArray(user.providerData) ? user.providerData : [];
        return providers.some(function (provider) { return String(provider && provider.providerId ? provider.providerId : '').toLowerCase() === 'anonymous'; });
      };
      var isRankingEligibleUser = function (user) { return !!user && !isAnonymousAuthUser(user); };

      var isBetterSession = function (incoming, currentBest) {
        if (!currentBest) return true;
        if (incoming.score !== currentBest.score) return incoming.score > currentBest.score;
        if (incoming.shots !== currentBest.shots) return incoming.shots < currentBest.shots;
        return incoming.durationMs < currentBest.durationMs;
      };
      var syncHudPanelHeight = function () {
        if (!gameContainer || !sessionBadge) return;
        sessionBadge.style.height = 'auto';
      };
      var setSessionBadge = function () {
        if (!sessionBadge) return;
        UI.ensureSessionBadgeTemplate(sessionBadge);
        var bestScoreEl = sessionBadge.querySelector('.sg-session-best-score');
        var bestShotsEl = sessionBadge.querySelector('.sg-session-best-shots');
        var bestTimeEl = sessionBadge.querySelector('.sg-session-best-time');
        var focusScoreEl = sessionBadge.querySelector('.sg-session-focus-score');
        var focusStreakEl = sessionBadge.querySelector('.sg-session-focus-streak');

        var hasBest = !!bestSessionSinceOpen;
        var bestScore = hasBest ? Math.max(0, Math.round(Number(bestSessionSinceOpen.score) || 0)) : '--';
        var bestShots = hasBest ? Math.max(0, Math.round(Number(bestSessionSinceOpen.shots) || 0)) : '--';
        var bestTime = hasBest ? Math.max(0, Math.round(Number(bestSessionSinceOpen.durationMs || 0) / 1000)) : '--';
        var liveScore = Math.max(0, Math.round(Number(currentScore) || 0));
        var liveStreak = Math.max(0, Math.round(Number(currentStreak) || 0));

        if (bestScoreEl) bestScoreEl.textContent = String(bestScore);
        if (bestShotsEl) bestShotsEl.textContent = String(bestShots);
        if (bestTimeEl) bestTimeEl.textContent = String(bestTime);
        if (focusScoreEl) focusScoreEl.textContent = String(liveScore);
        if (focusStreakEl) focusStreakEl.textContent = String(liveStreak);
        syncHudPanelHeight();
      };

      var renderLeaderboard = async function (period) {
        if (!leaderboardBody) return;
        var key = period in Data.LEADERBOARD_PERIOD_LABELS ? period : 'daily';
        leaderboardPeriod = key;

        if (leaderboardRange) leaderboardRange.textContent = Data.LEADERBOARD_PERIOD_LABELS[key] + '\u6392\u884C\u524D ' + Data.LEADERBOARD_TOP_SIZE + ' \u540D';
        leaderboardTabs.forEach(function (tab) {
          var active = tab.getAttribute('data-lb-period') === key;
          tab.classList.toggle('is-active', active);
          tab.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        leaderboardBody.textContent = '';
        UI.appendStatusRow(leaderboardBody, '\u8F09\u5165\u4E2D\u2026');
        if (leaderboardPlayerRow) { leaderboardPlayerRow.classList.add('is-hidden'); leaderboardPlayerRow.textContent = ''; }

        try {
          var bucket = Data.getTaipeiDateBucket(key);
          var snap = await firebase.firestore()
            .collection('shotGameRankings').doc(bucket)
            .collection('entries')
            .orderBy('bestScore', 'desc').limit(50).get();
          leaderboardData[key] = snap.docs
            .map(function (d) { return Data.normalizeLeaderboardRow(d.id, d.data()); })
            .filter(function (row) { return !Data.isAnonymousLeaderboardRow(row); });
        } catch (_) {
          leaderboardBody.textContent = '';
          UI.appendStatusRow(leaderboardBody, '\u8B80\u53D6\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66');
          return;
        }

        if ((leaderboardData[key] || []).length === 0 && !bestSessionSinceOpen) {
          leaderboardBody.textContent = '';
          UI.appendStatusRow(leaderboardBody, '\u5C1A\u7121\u6392\u884C\u8CC7\u6599');
          return;
        }

        var view = Data.buildLeaderboardView(leaderboardData, bestSessionSinceOpen, leaderboardSubmitPending, key);
        UI.renderLeaderboardRows(leaderboardBody, view.topRows);
        UI.renderPlayerRow(leaderboardPlayerRow, view.extraPlayerRow);
      };

      var openIntro = function () {
        if (Data.isIntroSuppressed() || !introModal) return;
        introModal.setAttribute('aria-hidden', 'false');
      };
      var closeIntro = function () {
        if (!introModal) return;
        if (introDismissCheck && introDismissCheck.checked) Data.suppressIntroToday();
        introModal.setAttribute('aria-hidden', 'true');
      };
      var openLeaderboard = function (period) {
        if (!leaderboardModal) return;
        renderLeaderboard(period || leaderboardPeriod);
        leaderboardModal.classList.add('is-open');
        leaderboardModal.setAttribute('aria-hidden', 'false');
        leaderboardOpen = true;
      };
      var closeLeaderboard = function () {
        if (!leaderboardModal) return;
        leaderboardModal.classList.remove('is-open');
        leaderboardModal.setAttribute('aria-hidden', 'true');
        leaderboardOpen = false;
      };

      var submitScoreToRanking = async function (scorePayload) {
        var gameUser = (typeof auth !== 'undefined') ? auth.currentUser : null;
        if (!scorePayload || scorePayload.score <= 0 || !isRankingEligibleUser(gameUser)) return;
        leaderboardSubmitPending = true;
        try {
          await firebase.app().functions('asia-east1').httpsCallable('submitShotGameScore')({
            score: scorePayload.score,
            shots: scorePayload.shots,
            streak: scorePayload.streak,
            durationMs: scorePayload.durationMs,
            displayName: Data.getPreferredPlayerDisplayName(gameUser),
          });
        } catch (err) {
          console.warn('[ShotGameLab] submitShotGameScore failed:', err && err.code ? err.code : '', err && err.message ? err.message : err);
          if (err && err.code === 'functions/permission-denied') {
            showLoginRequiredCard('\u76EE\u524D\u767B\u5165\u72C0\u614B\u7121\u6CD5\u5BEB\u5165\u5C04\u624B\u699C\uFF0C\u8ACB\u5148\u56DE\u4E3B\u7AD9\u91CD\u65B0\u767B\u5165 LINE');
          }
        } finally {
          leaderboardSubmitPending = false;
          if (leaderboardOpen) await renderLeaderboard(leaderboardPeriod);
        }
      };

      var getBillboardAdImageUrl = function () {
        try {
          return typeof window.__shotGameAdImageUrl === 'string' ? window.__shotGameAdImageUrl.trim() : '';
        } catch (_) { return ''; }
      };
      var syncBillboardAdImage = function () {
        if (!engine || typeof engine.setBillboardAdImage !== 'function') return;
        engine.setBillboardAdImage(getBillboardAdImageUrl());
      };

      var startGame = function () {
        if (engine) engine.destroy();
        currentScore = 0;
        currentStreak = 0;
        setSessionBadge();
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(syncHudPanelHeight).catch(function () {});
        } else {
          syncHudPanelHeight();
        }
        engine = window.ShotGameEngine.create({
          container: gameContainer,
          lowFx: lowFx,
          billboardImageUrl: getBillboardAdImageUrl(),
          ui: {
            scoreEl: document.getElementById('sg-score'),
            streakEl: document.getElementById('sg-streak'),
            powerBarEl: document.getElementById('sg-power'),
            powerFillEl: document.getElementById('sg-power-fill'),
            crosshairEl: document.getElementById('sg-crosshair'),
            messageEl: document.getElementById('sg-message'),
            restartBtn: document.getElementById('sg-restart'),
          },
          onScoreChange: function (payload) {
            currentScore = Number(payload && payload.score != null ? payload.score : 0);
            currentStreak = Number(payload && payload.streak != null ? payload.streak : 0);
            setSessionBadge();
          },
          onGameOver: function (payload) {
            var payloadStreak = payload && payload.bestStreak != null ? payload.bestStreak : (payload ? payload.streak : 0);
            var normalized = {
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
        syncBillboardAdImage();
        setSessionBadge();
        openIntro();
      };

      var validateToken = async function (rawToken) {
        if (!rawToken || !requiredTokenHash) return false;
        var hash = await Data.sha256Hex(rawToken.trim());
        return hash.toLowerCase() === requiredTokenHash;
      };

      var unlockWithToken = async function (rawToken, updateUrl) {
        if (tokenSubmit) tokenSubmit.disabled = true;
        try {
          var ok = await validateToken(rawToken);
          if (!ok) { showGate('Token \u7121\u6548\uFF0C\u8ACB\u78BA\u8A8D\u5F8C\u518D\u8A66'); return false; }
          if (updateUrl) {
            var url = new URL(location.href);
            url.searchParams.set(tokenQueryKey, rawToken.trim());
            history.replaceState(null, '', url.pathname + url.search + url.hash);
          }
          if (typeof _firebaseAuthReadyPromise !== 'undefined') {
            try { await Promise.race([_firebaseAuthReadyPromise, new Promise(function (r) { setTimeout(r, 5000); })]); } catch (_) {}
          }
          var currentUser = (typeof auth !== 'undefined') ? auth.currentUser : null;
          if (!isRankingEligibleUser(currentUser)) {
            showLoginRequiredCard(currentUser ? '\u8ACB\u5148\u4EE5 LINE \u5E33\u865F\u767B\u5165\uFF08\u975E\u533F\u540D\uFF09\u624D\u80FD\u5BEB\u5165\u5C04\u624B\u699C' : '\u8ACB\u5148\u767B\u5165\u624D\u80FD\u904A\u73A9');
            return false;
          }
          showGame();
          startGame();
          if (tokenFeedback) tokenFeedback.textContent = 'Token \u9A57\u8B49\u6210\u529F';
          return true;
        } catch (_) {
          showGate('Token \u9A57\u8B49\u5931\u6557\uFF0C\u8ACB\u91CD\u8A66');
          return false;
        } finally {
          if (tokenSubmit) tokenSubmit.disabled = false;
        }
      };

      // Event bindings
      if (tokenSubmit) tokenSubmit.addEventListener('click', function () { unlockWithToken(tokenInput ? tokenInput.value : '', true); });
      if (tokenInput) tokenInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlockWithToken(tokenInput.value, true); });
      if (leaderboardBtn) { leaderboardBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); }); leaderboardBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openLeaderboard(leaderboardPeriod); }); }
      if (introStartBtn) introStartBtn.addEventListener('click', closeIntro);
      if (leaderboardClose) leaderboardClose.addEventListener('click', closeLeaderboard);
      if (leaderboardModal) leaderboardModal.addEventListener('click', function (e) { if (e.target === leaderboardModal) closeLeaderboard(); });
      leaderboardTabs.forEach(function (tab) { tab.addEventListener('click', function () { renderLeaderboard(tab.getAttribute('data-lb-period') || 'daily'); }); });
      window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && leaderboardOpen) closeLeaderboard(); });
      window.addEventListener('shotgame-ad-updated', syncBillboardAdImage);
      window.addEventListener('resize', syncHudPanelHeight);
      window.addEventListener('beforeunload', function () { window.removeEventListener('shotgame-ad-updated', syncBillboardAdImage); if (engine) engine.destroy(); });

      renderLeaderboard(leaderboardPeriod);
      setSessionBadge();
      var tokenFromUrl = new URLSearchParams(location.search).get(tokenQueryKey) || '';
      if (tokenFromUrl) unlockWithToken(tokenFromUrl, false);
      else showGate('\u8ACB\u8F38\u5165\u6E2C\u8A66 Token \u7E7C\u7E8C');
    },
  };

  window.ShotGameLabPage = ShotGameLabPage;
})();
