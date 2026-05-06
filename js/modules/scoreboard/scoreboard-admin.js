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
    provider: {
      title: 'SportsAPI Pro 設定',
      items: [
        ['資料來源', '目前比分與賽程資料由 SportsAPI Pro 提供。前台不會直接打第三方 API。'],
        ['API key', 'API key 放在 Firebase Secret，前台與 Firestore 都不保存 key。'],
        ['首頁顯示', '控制首頁是否顯示比分區。關閉後首頁不顯示，但不代表資料來源被刪除。'],
        ['公開頁', '控制使用者能不能進入完整比分與賽程頁。首頁預覽和公開頁可以分開控制。'],
        ['快取策略', 'Cloud Function 先抓資料再寫入快取，前台讀快取，避免每個使用者刷新都消耗 API 額度。'],
      ],
    },
    usage: {
      title: 'API 狀態說明',
      items: [
        ['今日 requests', '今天已使用的 SportsAPI Pro request 數。數字越高代表越接近每日額度。'],
        ['每日上限', '目前方案或 API 狀態回傳的每日可用上限。沒有資料時通常代表尚未成功取得 /status。'],
        ['額度歸零', 'SportsAPI Pro 回傳的 reset_at 以 UTC 計算，換算台灣時間通常是每天早上 08:00 歸零。實際仍以 API 狀態回傳為準。'],
        ['剩餘額度', '今天大約還能使用的 request 數。低於安全值時建議減少開啟的運動或避免手動刷新。'],
        ['最近快取', '首頁比分快取最後產生的時間，不一定等於最後一次 API status 更新時間。'],
        ['刷新錯誤', '最近刷新流程累積的錯誤數。若持續增加，通常要檢查 API key、額度或供應商回應。'],
        ['快取賽事', '目前首頁快取中可顯示的賽事筆數。為 0 不一定是錯，可能是該時段沒有資料。'],
        ['手動刷新', '立即呼叫 Cloud Function 更新快取。請少量使用，避免快速消耗免費或付費額度。'],
      ],
    },
    translationTotal: {
      title: '比分中文詞庫說明',
      items: [
        ['已翻譯', '已確認會正式顯示中文的隊名、聯賽名、狀態或其他來源名稱。'],
        ['待翻譯', '系統看過但還沒有中文對照或保留原文決策的名稱。先處理高頻項目即可。'],
        ['保留原文', '小眾隊伍、青年隊、地方隊或非英文原文名稱，可以刻意保留原文，避免硬翻。'],
        ['需複查', '系統或人工標記需要再確認的詞條，適合之後集中處理。'],
        ['衝突', '同一來源名稱可能出現不同翻譯建議，應人工確認後再套用。'],
        ['覆蓋率', '已翻譯、保留原文或忽略的詞條占全部已出現詞條的比例，不需要硬追 100%。'],
        ['依運動細分', '把詞庫狀態拆成足球、籃球、網球等運動，方便只處理某一類高頻詞。'],
        ['高頻待翻', '依出現次數排序的待翻名稱，建議優先處理首頁常見或熱門聯賽。'],
        ['AI 翻譯指引', '忘記流程時可複製給 AI，讓 AI 依待翻清單產出保守的繁中建議。'],
      ],
    },
    enabledSports: {
      title: '運動項目設定說明',
      items: [
        ['啟用', '只有啟用的運動會排入後端抓取。免費額度有限，建議先開常用運動。'],
        ['首頁', '允許這個運動的比分或賽程出現在首頁小區塊。'],
        ['即時', '允許後端抓取這個運動的即時比分資料。'],
        ['賽程', '允許後端抓取這個運動的今日或最近賽程資料。'],
        ['詳情', '允許使用者點進賽事後讀取或產生基本詳情快取。'],
        ['排序', '數字越小越前面，會影響首頁與公開頁籤的顯示順序。'],
        ['API slug', '卡片上的英文代碼是供應商 API 路徑名稱，主要用來核對串接是否正確。'],
      ],
    },
    featured: {
      title: '重點聯賽設定說明',
      items: [
        ['用途', '把五大聯賽、歐冠、NBA、MLB、BWF 等重要賽事優先分組呈現。'],
        ['開關', '打開後該聯賽來源會進入首頁或公開頁的重點排序清單。'],
        ['排序', '數字越小越前面，適合把最常看的聯賽放在前面。'],
        ['資料比對', '目前先用關鍵字比對供應商回傳的聯賽名稱，後續可升級成 tournament ID。'],
        ['版面策略', '這區只是重點入口，不需要列出所有聯賽；完整運動範圍由上方運動項目控制。'],
      ],
    },
  };

  function infoButton(key) {
    return `<button class="scoreboard-info-btn" type="button" onclick="event.stopPropagation();App.showScoreboardInfo('${esc(key)}')" title="說明" aria-label="說明">?</button>`;
  }

  function fieldTitle(text, key) {
    return `<span class="scoreboard-field-title">${esc(text)}${infoButton(key)}</span>`;
  }

  function infoBodyHtml(info) {
    if (Array.isArray(info?.items)) {
      return '<ul class="scoreboard-info-list">' + info.items.map(([label, body]) => (
        `<li><b>${esc(label)}</b><span>${esc(body)}</span></li>`
      )).join('') + '</ul>';
    }
    return `<p>${esc(info?.body || '')}</p>`;
  }

  function checked(list, key) {
    return Array.isArray(list) && list.includes(key) ? 'checked' : '';
  }

  function findSportRow(sportKey) {
    return Array.from(document.querySelectorAll('.scoreboard-sport-row[data-sport]'))
      .find(row => row.dataset.sport === sportKey) || null;
  }

  function sportSettingSummary({ enabled, homepage, live, schedule, detail, order }) {
    const flags = [];
    if (homepage) flags.push('首頁');
    if (live) flags.push('即時');
    if (schedule) flags.push('賽程');
    if (detail) flags.push('詳情');
    const prefix = enabled ? (flags.length ? flags.join(' / ') : '已啟用') : '停用';
    return `${prefix} · #${Number(order || 99)}`;
  }

  function updateSportCard(row) {
    if (!row) return;
    const enabled = row.querySelector('.scoreboard-sport-enabled')?.checked === true;
    const homepage = row.querySelector('.scoreboard-sport-homepage')?.checked === true;
    const live = row.querySelector('.scoreboard-sport-live')?.checked === true;
    const schedule = row.querySelector('.scoreboard-sport-schedule')?.checked === true;
    const detail = row.querySelector('.scoreboard-sport-detail')?.checked === true;
    const order = row.querySelector('.scoreboard-sport-order')?.value || 99;
    row.classList.toggle('is-enabled', enabled);
    const status = row.querySelector('[data-sport-status]');
    const summary = row.querySelector('[data-sport-summary]');
    if (status) status.textContent = enabled ? '啟用' : '停用';
    if (summary) summary.textContent = sportSettingSummary({ enabled, homepage, live, schedule, detail, order });
  }

  function switchMarkup(className, isChecked, locked) {
    return `
      <span class="scoreboard-switch">
        <input type="checkbox" class="${esc(className)}" ${isChecked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        <span class="scoreboard-switch-slider" aria-hidden="true"></span>
      </span>
    `;
  }

  function homeSwitchMarkup(id, label, isChecked, locked) {
    return `
      <label class="scoreboard-home-toggle">
        <span>${esc(label)}</span>
        <span class="scoreboard-switch">
          <input type="checkbox" id="${esc(id)}" ${isChecked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <span class="scoreboard-switch-slider" aria-hidden="true"></span>
        </span>
      </label>
    `;
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
    const item = (label, value) => `
      <div class="scoreboard-meter-card">
        <span>${esc(label)}</span>
        <strong>${esc(value ?? '-')}</strong>
      </div>
    `;
    return `
      <section class="scoreboard-admin-panel">
        <div class="scoreboard-admin-title-row">
          <h3>API 狀態${infoButton('usage')}</h3>
          <button class="scoreboard-refresh-action" id="scoreboard-refresh-btn" type="button" onclick="App.refreshScoreboardNow()" ${canConfigure() ? '' : 'disabled'}>手動刷新</button>
        </div>
        <div class="scoreboard-meter-grid">
          ${item('今日 requests', quota.requestsToday)}
          ${item('每日上限', quota.dailyLimit)}
          ${item('剩餘額度', quota.remaining)}
          ${item('最近快取', generated)}
          ${item('刷新錯誤', refresh.errorCount ?? 0)}
          ${item('快取賽事', Number(snapshot.homepageMatches?.length || 0))}
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
    const item = (label, value) => `
      <div class="scoreboard-meter-card">
        <span>${esc(label)}</span>
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
          ${item('已翻譯', numberText(totals.approved || 0))}
          ${item('待翻譯', numberText(totals.pending || 0))}
          ${item('保留原文', numberText(totals.keep_original || 0))}
          ${item('需複查', numberText(totals.needs_review || 0))}
          ${item('衝突', numberText(totals.conflict || 0))}
          ${item('覆蓋率', percentText(stats.coverageRate))}
        </div>
        <div class="scoreboard-translation-split">
          <div>
            <div class="scoreboard-subtitle">依運動細分</div>
            <div class="scoreboard-translation-sport-list">
              ${sportRows || '<div class="scoreboard-empty compact">尚未累積翻譯統計。</div>'}
            </div>
          </div>
          <div>
            <div class="scoreboard-subtitle">高頻待翻</div>
            <div class="scoreboard-pending-list">
              ${pendingRows || '<div class="scoreboard-empty compact">目前沒有待翻譯名稱。</div>'}
            </div>
          </div>
        </div>
        <div class="scoreboard-ai-prompt">
          <div class="scoreboard-subtitle scoreboard-ai-prompt-head">
            <span>AI 翻譯指引</span>
            <button class="scoreboard-copy-btn" type="button" onclick="App.copyScoreboardAiPrompt(this)">一鍵複製</button>
          </div>
          <pre class="scoreboard-ai-prompt-text">${esc(prompt)}</pre>
        </div>
      </section>
    `;
  }

  function sportRows(config, locked) {
    const catalog = root.ScoreboardConfigUtils?.SPORT_CATALOG || [];
    return catalog.map(item => {
      const sport = config.sports?.[item.key] || {};
      const enabled = sport.enabled === true;
      const homepage = Array.isArray(config.homepageSports) && config.homepageSports.includes(item.key);
      const live = Array.isArray(config.liveSports) && config.liveSports.includes(item.key);
      const schedule = Array.isArray(config.scheduleSports) && config.scheduleSports.includes(item.key);
      const detail = Array.isArray(config.detailSports) && config.detailSports.includes(item.key);
      const order = sport.sortOrder || item.sortOrder;
      const summary = sportSettingSummary({ enabled, homepage, live, schedule, detail, order });
      return `
        <section class="scoreboard-source-row scoreboard-sport-row ${enabled ? 'is-enabled' : ''}" data-sport="${esc(item.key)}" data-locked="${locked ? 'true' : 'false'}">
          <button class="scoreboard-sport-card" type="button" onclick="App.openScoreboardSportSettings('${esc(item.key)}')">
            <div class="scoreboard-sport-card-head">
              <span class="scoreboard-sport-icon">${esc(item.icon || '🏟️')}</span>
              <span class="scoreboard-source-name">${esc(item.label)}</span>
              <span class="scoreboard-sport-watermark" aria-hidden="true">${esc(item.icon || '🏟️')}</span>
            </div>
            <div class="scoreboard-sport-card-meta">
              <span class="scoreboard-sport-status" data-sport-status>${enabled ? '啟用' : '停用'}</span>
              <span>${locked ? '檢視' : '設定'} →</span>
            </div>
            <div class="scoreboard-source-meta">${esc(item.apiSport)}</div>
            <div class="scoreboard-sport-summary" data-sport-summary>${esc(summary)}</div>
          </button>
          <div class="scoreboard-sport-state" hidden>
            <input type="checkbox" class="scoreboard-sport-enabled" ${enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <input type="checkbox" class="scoreboard-sport-homepage" ${homepage ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <input type="checkbox" class="scoreboard-sport-live" ${live ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <input type="checkbox" class="scoreboard-sport-schedule" ${schedule ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <input type="checkbox" class="scoreboard-sport-detail" ${detail ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <input class="scoreboard-sport-order" type="number" min="1" max="999" step="1" value="${esc(order)}" ${locked ? 'disabled' : ''}>
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
          <div class="scoreboard-feature-main">
            <strong>${esc(item.label)}</strong>
            <span>${esc(item.sport)}</span>
          </div>
          <label class="scoreboard-feature-switch" aria-label="${esc(item.label)} 啟用">
            ${switchMarkup('scoreboard-feature-enabled', source.enabled === true, locked)}
          </label>
          <label class="scoreboard-feature-order-wrap">
            <span>排序</span>
            <input class="scoreboard-feature-order" type="number" min="1" max="999" step="1" value="${esc(source.sortOrder || item.sortOrder)}" ${locked ? 'disabled' : ''}>
          </label>
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
          ${homeSwitchMarkup('scoreboard-homepage-enabled', '首頁顯示', config.homepageEnabled !== false, locked)}
          ${homeSwitchMarkup('scoreboard-public-enabled', '公開頁', config.publicPageEnabled !== false, locked)}
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
          <div class="edu-info-dialog-body scoreboard-info-dialog-body">${infoBodyHtml(info)}</div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    async copyScoreboardAiPrompt(trigger) {
      const source = trigger?.closest?.('.scoreboard-ai-prompt')?.querySelector?.('.scoreboard-ai-prompt-text');
      const text = source?.textContent || '';
      if (!text.trim()) {
        this.showToast?.('目前沒有可複製的 AI 翻譯指引');
        return;
      }
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          if (!copied) throw new Error('clipboard unavailable');
        }
        this.showToast?.('已複製 AI 翻譯指引');
      } catch (err) {
        console.error('[ScoreboardAdmin] copy AI prompt failed:', err);
        this.showToast?.('複製失敗，請手動選取文字');
      }
    },

    openScoreboardSportSettings(sportKey) {
      const row = findSportRow(sportKey);
      if (!row) return;
      const locked = row.dataset.locked === 'true';
      const label = row.querySelector('.scoreboard-source-name')?.textContent || sportKey;
      const apiSport = row.querySelector('.scoreboard-source-meta')?.textContent || sportKey;
      const read = cls => row.querySelector(cls)?.checked === true;
      const order = row.querySelector('.scoreboard-sport-order')?.value || 99;
      const overlay = document.createElement('div');
      overlay.className = 'scoreboard-config-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = `
        <div class="scoreboard-config-dialog" role="dialog" aria-modal="true" aria-label="${esc(label)} 設定" onclick="event.stopPropagation()">
          <div class="scoreboard-config-dialog-head">
            <div>
              <h3>${esc(label)}</h3>
              <span>${esc(apiSport)}</span>
            </div>
            <button class="scoreboard-dialog-close" type="button" onclick="this.closest('.scoreboard-config-overlay').remove()">×</button>
          </div>
          <div class="scoreboard-subtitle">${fieldTitle('設定項目', 'enabledSports')}</div>
          <div class="scoreboard-modal-toggle-grid">
            <label class="scoreboard-modal-toggle-row"><span>啟用</span>${switchMarkup('scoreboard-modal-enabled', read('.scoreboard-sport-enabled'), locked)}</label>
            <label class="scoreboard-modal-toggle-row"><span>首頁</span>${switchMarkup('scoreboard-modal-homepage', read('.scoreboard-sport-homepage'), locked)}</label>
            <label class="scoreboard-modal-toggle-row"><span>即時</span>${switchMarkup('scoreboard-modal-live', read('.scoreboard-sport-live'), locked)}</label>
            <label class="scoreboard-modal-toggle-row"><span>賽程</span>${switchMarkup('scoreboard-modal-schedule', read('.scoreboard-sport-schedule'), locked)}</label>
            <label class="scoreboard-modal-toggle-row"><span>詳情</span>${switchMarkup('scoreboard-modal-detail', read('.scoreboard-sport-detail'), locked)}</label>
            <label class="scoreboard-modal-toggle-row scoreboard-modal-order-row"><span>排序</span><input class="scoreboard-modal-order" type="number" min="1" max="999" step="1" value="${esc(order)}" ${locked ? 'disabled' : ''}></label>
          </div>
          <div class="scoreboard-dialog-actions">
            <button class="secondary-btn small" type="button" onclick="this.closest('.scoreboard-config-overlay').remove()">關閉</button>
            <button class="primary-btn small" type="button" onclick="App.applyScoreboardSportSettings('${esc(sportKey)}')" ${locked ? 'disabled' : ''}>套用設定</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    applyScoreboardSportSettings(sportKey) {
      const row = findSportRow(sportKey);
      const overlay = document.querySelector('.scoreboard-config-overlay');
      if (!row || !overlay) return;
      const setChecked = (stateClass, modalClass) => {
        const state = row.querySelector(stateClass);
        const modal = overlay.querySelector(modalClass);
        if (state && modal) state.checked = modal.checked;
      };
      setChecked('.scoreboard-sport-enabled', '.scoreboard-modal-enabled');
      setChecked('.scoreboard-sport-homepage', '.scoreboard-modal-homepage');
      setChecked('.scoreboard-sport-live', '.scoreboard-modal-live');
      setChecked('.scoreboard-sport-schedule', '.scoreboard-modal-schedule');
      setChecked('.scoreboard-sport-detail', '.scoreboard-modal-detail');
      const stateOrder = row.querySelector('.scoreboard-sport-order');
      const modalOrder = overlay.querySelector('.scoreboard-modal-order');
      if (stateOrder && modalOrder) {
        const next = Math.max(1, Math.min(999, Math.trunc(Number(modalOrder.value || stateOrder.value || 99))));
        stateOrder.value = Number.isFinite(next) ? next : stateOrder.value;
      }
      updateSportCard(row);
      overlay.remove();
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
