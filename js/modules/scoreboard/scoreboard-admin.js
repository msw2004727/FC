/* ================================================
   ToosterX - Scoreboard Admin
   SportsAPI Pro switches, ordering and usage status.
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

  function apiService() {
    return (typeof ApiService !== 'undefined') ? ApiService : root.ApiService;
  }

  function firebaseService() {
    return (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
  }

  function firestoreDb() {
    return (typeof db !== 'undefined') ? db : root.db;
  }

  function canConfigure() {
    const currentUser = apiService()?.getCurrentUser?.() || firebaseService()?._cache?.currentUser || null;
    const roleKey = app._getEffectiveRoleKey?.(currentUser?.role);
    return app.hasPermission?.('admin.scoreboard.configure') || roleKey === 'super_admin';
  }

  const INFO = {
    provider: { title: '資料來源', body: '目前使用 SportsAPI Pro。API key 放在 Firebase Secret，前台和 Firestore 都不會保存 key。' },
    homepage: { title: '首頁顯示', body: '關閉後首頁不顯示比分區，但公開賽程頁仍可依公開頁開關決定是否顯示。' },
    publicPage: { title: '公開賽程頁', body: '控制使用者能不能進入完整比分與賽程頁。首頁預覽可另外開關。' },
    enabledSports: { title: '啟用運動', body: '只有開啟的運動會被後端排入抓取。免費額度有限，先開常用項目最穩。' },
    homepageSports: { title: '首頁顯示', body: '決定這個運動的賽事是否能出現在首頁小區塊。' },
    liveSports: { title: '即時比分', body: '開啟後後端會抓這個運動的 live endpoint。' },
    scheduleSports: { title: '最近賽程', body: '開啟後後端會抓這個運動的今日或最近賽程。' },
    detailSports: { title: '基本詳情', body: '開啟後使用者點賽事時，可以讀取或產生這場比賽的基本詳情快取。' },
    sortOrder: { title: '排序', body: '數字越小越前面。首頁和公開頁籤會優先照這個順序排列。' },
    featured: { title: '重點聯賽', body: '用來把五大聯賽、歐冠、NBA 等賽事分組顯示。後續若要改成 tournament ID，也會接在這裡。' },
    usage: { title: '用量', body: '這裡顯示 SportsAPI Pro /status 回傳的剩餘額度與今日 request 數；沒有資料時代表尚未成功刷新。' },
    refresh: { title: '手動刷新', body: '立即呼叫 Cloud Function 更新快取。為避免打爆免費額度，按鈕有短暫冷卻。' },
    translationTotal: { title: '已翻譯詞條', body: '已確認會正式顯示中文的隊名、聯賽名、狀態或其他來源名稱。內建熱門詞庫和人工確認詞庫都會被套用。' },
    translationPending: { title: '待翻譯詞條', body: '系統在比分資料裡看過，但目前還沒有中文對照或保留原文決策的名稱。待翻多不代表錯誤，先處理高頻項目即可。' },
    translationKeepOriginal: { title: '保留原文', body: '不確定、太小眾、地方隊、青年隊或非英文原文名稱，可以刻意保留原文，避免硬翻造成誤解。' },
    translationCoverage: { title: '覆蓋率', body: '已翻譯、保留原文、忽略的詞條占全部已出現詞條的比例。不是越接近 100% 越好，因為有些名稱保留原文更準確。' },
    translationBySport: { title: '依運動細分', body: '把翻譯狀態依足球、籃球、網球等運動拆開看，方便只處理某一種運動的高頻待翻名稱。' },
    translationTopPending: { title: '高頻待翻', body: '依出現次數排序的待翻名稱。建議優先處理首頁常見、熱門聯賽與知名隊伍。' },
    translationPrompt: { title: 'AI 維護指引', body: '之後忘記怎麼維護時，可以複製這段提示給 AI。流程會先讀待翻清單與統計，再產生保守的繁中建議。' },
  };

  function infoButton(key) {
    return `<button class="scoreboard-info-btn" type="button" onclick="event.stopPropagation();App.showScoreboardInfo('${esc(key)}')" title="說明" aria-label="說明">?</button>`;
  }

  function fieldTitle(text, key) {
    return `<span class="scoreboard-field-title">${esc(text)}${infoButton(key)}</span>`;
  }

  function checked(list, key) {
    return Array.isArray(list) && list.includes(key) ? 'checked' : '';
  }

  function todayKey() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}${parts.month}${parts.day}`;
  }

  async function readAdminStatus() {
    const dbRef = firestoreDb();
    if (!dbRef) return {};
    const result = {};
    try {
      const usage = await dbRef.collection('sportsApiProUsage').doc(todayKey()).get();
      result.usage = usage.exists ? usage.data() : null;
    } catch (err) {
      result.usageError = err;
    }
    try {
      const snap = await dbRef.collection('scoreboardSnapshots').doc('home').get();
      result.snapshot = snap.exists ? snap.data() : null;
    } catch (err) {
      result.snapshotError = err;
    }
    try {
      const stats = await dbRef.collection('scoreboardTranslationStats').doc('summary').get();
      result.translationStats = stats.exists ? stats.data() : null;
    } catch (err) {
      result.translationStatsError = err;
    }
    return result;
  }

  function usagePanel(status) {
    const usage = status?.usage || {};
    const quota = usage.usage || {};
    const refresh = usage.lastRefresh || {};
    const snapshot = status?.snapshot || {};
    const generated = snapshot.generatedAt?.toDate?.()?.toLocaleString?.('zh-TW') || '-';
    const item = (label, value, key) => `
      <div class="scoreboard-meter-card">
        <span>${fieldTitle(label, key)}</span>
        <strong>${esc(value ?? '-')}</strong>
      </div>
    `;
    return `
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>API 狀態${infoButton('usage')}</h3>
          <button class="secondary-btn small" id="scoreboard-refresh-btn" type="button" onclick="App.refreshScoreboardNow()" ${canConfigure() ? '' : 'disabled'}>手動刷新${infoButton('refresh')}</button>
        </div>
        <div class="scoreboard-meter-grid">
          ${item('今日 requests', quota.requestsToday, 'usage')}
          ${item('每日上限', quota.dailyLimit, 'usage')}
          ${item('剩餘額度', quota.remaining, 'usage')}
          ${item('最近快取', generated, 'usage')}
          ${item('刷新錯誤', refresh.errorCount ?? 0, 'usage')}
          ${item('快取賽事', Number(snapshot.homepageMatches?.length || 0), 'usage')}
        </div>
      </section>
    `;
  }

  function numberText(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString('zh-TW');
  }

  function percentText(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0%';
    return `${Math.round(num * 10) / 10}%`;
  }

  function translationPanel(status) {
    const stats = status?.translationStats || {};
    const totals = stats.totals || {};
    const bySport = stats.bySport || {};
    const topPending = Array.isArray(stats.topPending) ? stats.topPending : [];
    const prompt = stats.aiPrompt || [
      '請依 docs/scoreboard-translation-workflow-plan.md 執行比分中文詞庫維護流程。',
      '先讀 scoreboardTranslationCandidates 與 scoreboardTranslationStats，依出現次數排序回報待翻數量與高頻待翻名稱。',
      '產生繁體中文建議時請保守處理；小眾隊伍、青年隊、地方隊或不確定的非英文名稱請標記 keep_original，不要硬翻。',
      '不要覆蓋已確認翻譯，除非我明確要求。',
    ].join('\n');
    const item = (label, value, key) => `
      <div class="scoreboard-meter-card">
        <span>${fieldTitle(label, key)}</span>
        <strong>${esc(value ?? 0)}</strong>
      </div>
    `;
    const sportRows = Object.entries(bySport)
      .sort((a, b) => Number(b[1]?.pending || 0) - Number(a[1]?.pending || 0) || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([sport, row]) => `
        <div class="scoreboard-translation-sport-row">
          <b>${esc(sport)}</b>
          <span>已翻 ${numberText(row.approved || 0)}</span>
          <span>待翻 ${numberText(row.pending || 0)}</span>
          <span>保留 ${numberText(row.keep_original || 0)}</span>
          <span>${percentText(row.coverageRate)}</span>
        </div>
      `).join('');
    const pendingRows = topPending.slice(0, 10).map(item => `
      <div class="scoreboard-pending-term">
        <b>${esc(item.sourceName || '-')}</b>
        <span>${esc(item.sport || '-')} · ${esc(item.type || '-')} · ${numberText(item.occurrenceCount || 0)} 次</span>
      </div>
    `).join('');
    const updated = stats.lastStatsAt?.toDate?.()?.toLocaleString?.('zh-TW') || '-';
    return `
      <section class="scoreboard-admin-panel scoreboard-translation-panel">
        <div class="scoreboard-admin-title-row">
          <h3>比分中文詞庫${infoButton('translationTotal')}</h3>
          <span>統計更新：${esc(updated)}</span>
        </div>
        <div class="scoreboard-meter-grid">
          ${item('已翻譯', numberText(totals.approved || 0), 'translationTotal')}
          ${item('待翻譯', numberText(totals.pending || 0), 'translationPending')}
          ${item('保留原文', numberText(totals.keep_original || 0), 'translationKeepOriginal')}
          ${item('需複查', numberText(totals.needs_review || 0), 'translationPending')}
          ${item('衝突', numberText(totals.conflict || 0), 'translationPending')}
          ${item('覆蓋率', percentText(stats.coverageRate), 'translationCoverage')}
        </div>
        <div class="scoreboard-translation-split">
          <div>
            <div class="scoreboard-subtitle">${fieldTitle('依運動細分', 'translationBySport')}</div>
            <div class="scoreboard-translation-sport-list">
              ${sportRows || '<div class="scoreboard-empty compact">尚未累積翻譯統計。</div>'}
            </div>
          </div>
          <div>
            <div class="scoreboard-subtitle">${fieldTitle('高頻待翻', 'translationTopPending')}</div>
            <div class="scoreboard-pending-list">
              ${pendingRows || '<div class="scoreboard-empty compact">目前沒有待翻譯名稱。</div>'}
            </div>
          </div>
        </div>
        <div class="scoreboard-ai-prompt">
          <div class="scoreboard-subtitle">${fieldTitle('AI 翻譯指引', 'translationPrompt')}</div>
          <pre class="scoreboard-ai-prompt-text">${esc(prompt)}</pre>
        </div>
      </section>
    `;
  }

  function sportRows(config, locked) {
    const catalog = root.ScoreboardConfigUtils?.SPORT_CATALOG || [];
    return catalog.map(item => {
      const sport = config.sports?.[item.key] || {};
      return `
        <section class="scoreboard-source-row scoreboard-sport-row" data-sport="${esc(item.key)}">
          <div class="scoreboard-source-main">
            <div>
              <div class="scoreboard-source-name">${esc(item.label)}</div>
              <div class="scoreboard-source-meta">SportsAPI Pro V2 · ${esc(item.apiSport)}</div>
            </div>
            <label class="scoreboard-source-toggle">
              <input type="checkbox" class="scoreboard-sport-enabled" ${sport.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}>
              <span>啟用${infoButton('enabledSports')}</span>
            </label>
          </div>
          <div class="scoreboard-toggle-grid">
            <label class="scoreboard-toggle-option"><input type="checkbox" class="scoreboard-sport-homepage" ${checked(config.homepageSports, item.key)} ${locked ? 'disabled' : ''}>${fieldTitle('首頁', 'homepageSports')}</label>
            <label class="scoreboard-toggle-option"><input type="checkbox" class="scoreboard-sport-live" ${checked(config.liveSports, item.key)} ${locked ? 'disabled' : ''}>${fieldTitle('即時', 'liveSports')}</label>
            <label class="scoreboard-toggle-option"><input type="checkbox" class="scoreboard-sport-schedule" ${checked(config.scheduleSports, item.key)} ${locked ? 'disabled' : ''}>${fieldTitle('賽程', 'scheduleSports')}</label>
            <label class="scoreboard-toggle-option"><input type="checkbox" class="scoreboard-sport-detail" ${checked(config.detailSports, item.key)} ${locked ? 'disabled' : ''}>${fieldTitle('詳情', 'detailSports')}</label>
            <label class="scoreboard-toggle-option scoreboard-toggle-order">${fieldTitle('排序', 'sortOrder')}<input class="scoreboard-sport-order" type="number" min="1" max="999" step="1" value="${esc(sport.sortOrder || item.sortOrder)}" ${locked ? 'disabled' : ''}></label>
          </div>
        </section>
      `;
    }).join('');
  }

  function featuredRows(config, locked) {
    const catalog = root.ScoreboardConfigUtils?.FEATURED_SOURCE_CATALOG || [];
    return catalog.map(item => {
      const source = config.featuredSources?.[item.id] || {};
      return `
        <section class="scoreboard-feature-row" data-featured="${esc(item.id)}">
          <label class="scoreboard-source-toggle">
            <input type="checkbox" class="scoreboard-feature-enabled" ${source.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span>${esc(item.label)}${infoButton('featured')}</span>
          </label>
          <span>${esc(item.sport)}</span>
          <input class="scoreboard-feature-order" type="number" min="1" max="999" step="1" value="${esc(source.sortOrder || item.sortOrder)}" ${locked ? 'disabled' : ''}>
        </section>
      `;
    }).join('');
  }

  function renderAdmin(config, status) {
    const page = document.getElementById('page-admin-scoreboard');
    if (!page) return;
    const locked = !canConfigure();
    page.innerHTML = `
      <div class="page-header">
        <button class="back-btn" onclick="App.goBack()">‹</button>
        <h2>賽事比分控制</h2>
      </div>
      <section class="scoreboard-admin-intro">
        <div>
          <h3>SportsAPI Pro${infoButton('provider')}</h3>
          <p>控制首頁與公開賽程頁顯示，不保存 API key，不讓前台直接打第三方 API。</p>
        </div>
        <div class="scoreboard-admin-switches">
          <label class="scoreboard-home-toggle">
            <input type="checkbox" id="scoreboard-homepage-enabled" ${config.homepageEnabled !== false ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span>首頁顯示${infoButton('homepage')}</span>
          </label>
          <label class="scoreboard-home-toggle">
            <input type="checkbox" id="scoreboard-public-enabled" ${config.publicPageEnabled !== false ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span>公開頁${infoButton('publicPage')}</span>
          </label>
        </div>
      </section>
      ${usagePanel(status)}
      ${translationPanel(status)}
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>運動項目${infoButton('enabledSports')}</h3>
          <span>依 SportsAPI Pro 支援項目預留，先開常用運動以控制免費額度。</span>
        </div>
        <div id="scoreboard-sport-list" class="scoreboard-source-list">${sportRows(config, locked)}</div>
      </section>
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>重點聯賽${infoButton('featured')}</h3>
          <span>首頁與公開頁可用來優先呈現五大聯賽、歐冠、NBA 等。</span>
        </div>
        <div class="scoreboard-feature-list">${featuredRows(config, locked)}</div>
      </section>
      <button class="primary-btn full-width" id="scoreboard-save-btn" onclick="App.saveScoreboardAdminConfig()" ${locked ? 'disabled' : ''}>儲存設定</button>
      ${locked ? '<div class="scoreboard-locked-note">目前帳號只能查看，沒有調整賽事比分控制的權限。</div>' : ''}
    `;
  }

  function orderedCheckedRows(selector, checkboxSelector, orderSelector, datasetName) {
    return Array.from(document.querySelectorAll(selector))
      .filter(row => row.querySelector(checkboxSelector)?.checked === true)
      .sort((a, b) => Number(a.querySelector(orderSelector)?.value || 99) - Number(b.querySelector(orderSelector)?.value || 99))
      .map(row => row.dataset[datasetName])
      .filter(Boolean);
  }

  function collectAdminConfig() {
    const sportsOrder = Array.from(document.querySelectorAll('.scoreboard-sport-row[data-sport]'))
      .sort((a, b) => Number(a.querySelector('.scoreboard-sport-order')?.value || 99) - Number(b.querySelector('.scoreboard-sport-order')?.value || 99))
      .map(row => row.dataset.sport)
      .filter(Boolean);
    const enabledSports = orderedCheckedRows('.scoreboard-sport-row[data-sport]', '.scoreboard-sport-enabled', '.scoreboard-sport-order', 'sport');
    const homepageSports = orderedCheckedRows('.scoreboard-sport-row[data-sport]', '.scoreboard-sport-homepage', '.scoreboard-sport-order', 'sport');
    const liveSports = orderedCheckedRows('.scoreboard-sport-row[data-sport]', '.scoreboard-sport-live', '.scoreboard-sport-order', 'sport');
    const scheduleSports = orderedCheckedRows('.scoreboard-sport-row[data-sport]', '.scoreboard-sport-schedule', '.scoreboard-sport-order', 'sport');
    const detailSports = orderedCheckedRows('.scoreboard-sport-row[data-sport]', '.scoreboard-sport-detail', '.scoreboard-sport-order', 'sport');
    const featuredSourceOrder = Array.from(document.querySelectorAll('.scoreboard-feature-row[data-featured]'))
      .sort((a, b) => Number(a.querySelector('.scoreboard-feature-order')?.value || 99) - Number(b.querySelector('.scoreboard-feature-order')?.value || 99))
      .map(row => row.dataset.featured)
      .filter(Boolean);
    const enabledFeaturedSources = orderedCheckedRows('.scoreboard-feature-row[data-featured]', '.scoreboard-feature-enabled', '.scoreboard-feature-order', 'featured');
    return {
      schemaVersion: 2,
      homepageEnabled: document.getElementById('scoreboard-homepage-enabled')?.checked !== false,
      publicPageEnabled: document.getElementById('scoreboard-public-enabled')?.checked !== false,
      enabledSports,
      homepageSports,
      liveSports,
      scheduleSports,
      detailSports,
      sportsOrder,
      defaultSportTabs: enabledSports.slice(0, 8),
      enabledFeaturedSources,
      featuredSourceOrder,
      homepageOrder: enabledFeaturedSources,
    };
  }

  Object.assign(app, {
    async renderScoreboardAdmin() {
      const page = document.getElementById('page-admin-scoreboard');
      if (!page) return;
      page.innerHTML = '<div class="page-header"><button class="back-btn" onclick="App.goBack()">‹</button><h2>賽事比分控制</h2></div><div style="padding:.8rem;color:var(--text-muted)">載入中...</div>';
      try {
        const config = await this.loadScoreboardConfig();
        const status = await readAdminStatus();
        renderAdmin(config, status);
        this._markPageSnapshotReady?.('page-admin-scoreboard');
      } catch (err) {
        page.innerHTML = '<div class="page-header"><button class="back-btn" onclick="App.goBack()">‹</button><h2>賽事比分控制</h2></div><div style="padding:.8rem;color:var(--danger)">載入失敗：' + esc(err.message || err) + '</div>';
      }
    },

    async saveScoreboardAdminConfig() {
      if (!canConfigure()) {
        this.showToast?.('目前帳號沒有調整賽事比分控制的權限');
        return;
      }
      const btn = document.getElementById('scoreboard-save-btn');
      if (btn) btn.disabled = true;
      try {
        const saved = await this.saveScoreboardConfig(collectAdminConfig());
        this.showToast?.('賽事比分設定已儲存');
        renderAdmin(saved, await readAdminStatus());
        this.renderHomeScoreboardPreview?.();
      } catch (err) {
        console.error('[ScoreboardAdmin] save failed:', err);
        this.showToast?.('儲存失敗，請稍後再試');
      } finally {
        const currentBtn = document.getElementById('scoreboard-save-btn');
        if (currentBtn) currentBtn.disabled = false;
      }
    },

    async refreshScoreboardNow() {
      if (!canConfigure()) {
        this.showToast?.('目前帳號沒有手動刷新的權限');
        return;
      }
      const btn = document.getElementById('scoreboard-refresh-btn');
      if (btn) btn.disabled = true;
      try {
        const callable = root.firebase.app().functions('asia-east1').httpsCallable('refreshSportsApiProScoreboard', { timeout: 180000 });
        const res = await callable({});
        this.showToast?.(`已刷新：${Number(res?.data?.liveCount || 0)} 場即時、${Number(res?.data?.scheduleCount || 0)} 場賽程`);
        await this.renderScoreboardAdmin();
        this.renderHomeScoreboardPreview?.();
      } catch (err) {
        console.error('[ScoreboardAdmin] manual refresh failed:', err);
        this.showToast?.('手動刷新失敗，請確認 Secret 或 API 額度');
      } finally {
        const currentBtn = document.getElementById('scoreboard-refresh-btn');
        if (currentBtn) currentBtn.disabled = false;
      }
    },

    showScoreboardInfo(key) {
      const info = INFO[key] || { title: '說明', body: '這個設定只影響賽事比分顯示，不會保存 API key。' };
      const overlay = document.createElement('div');
      overlay.className = 'edu-info-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = `
        <div class="edu-info-dialog">
          <button class="edu-info-close" type="button" onclick="this.closest('.edu-info-overlay').remove()">×</button>
          <div class="edu-info-dialog-title">${esc(info.title)}</div>
          <div style="font-size:.82rem;line-height:1.65;color:var(--text-secondary)">${esc(info.body)}</div>
        </div>
      `;
      document.body.appendChild(overlay);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
