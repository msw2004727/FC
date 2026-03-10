Object.assign(App, {

  _getDashboardParticipantSearchDefaultState() {
    const end = new Date();
    const start = new Date(end.getTime() - 89 * 86400000);
    const fmt = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    return {
      keyword: '',
      startDate: fmt(start),
      endDate: fmt(end),
      loading: false,
      error: '',
      result: null,
      shareLoading: false,
      shareError: '',
      shareUrl: '',
      shareExpiresAt: '',
      collapsed: false,
    };
  },

  _ensureDashboardParticipantSearchState() {
    if (!this._dashboardParticipantSearchState) {
      this._dashboardParticipantSearchState = this._getDashboardParticipantSearchDefaultState();
    }
    return this._dashboardParticipantSearchState;
  },

  _renderDashboardParticipantSearchCard() {
    const state = this._ensureDashboardParticipantSearchState();
    const keyword = escapeHTML(state.keyword || '');
    const startDate = escapeHTML(state.startDate || '');
    const endDate = escapeHTML(state.endDate || '');
    const searchDisabled = state.loading ? 'disabled' : '';
    const shareDisabled = (!state.result || Number(state.result.matchedEventCount || 0) <= 0 || state.loading || state.shareLoading) ? 'disabled' : '';

    const openAttr = state.collapsed ? '' : 'open';

    return `
      <details class="info-card dash-query-card" id="dash-participant-query-details" ${openAttr}>
        <summary class="dash-query-header">
          <span>活動參與查詢</span>
          <span class="dash-query-summary-arrow">▶</span>
        </summary>
        <div class="dash-query-body">
          <div class="dash-query-help">輸入活動標題模糊關鍵字與活動日期區間，統計有簽到過該批活動的用戶與參與次數。</div>
          <div class="dash-query-form">
            <label class="dash-query-field">
              <span>活動關鍵字</span>
              <input type="text" id="dash-participant-keyword" placeholder="例如：大安、週六、友誼賽" value="${keyword}" ${searchDisabled}>
            </label>
            <label class="dash-query-field">
              <span>開始日期</span>
              <input type="date" id="dash-participant-start" value="${startDate}" ${searchDisabled}>
            </label>
            <label class="dash-query-field">
              <span>結束日期</span>
              <input type="date" id="dash-participant-end" value="${endDate}" ${searchDisabled}>
            </label>
          </div>
          <div class="dash-query-actions">
            <button class="primary-btn" onclick="App.runDashboardParticipantSearch()" ${searchDisabled}>${state.loading ? '查詢中...' : '查詢'}</button>
            <button class="outline-btn" onclick="App.clearDashboardParticipantSearch()" ${searchDisabled}>清除</button>
            <button class="outline-btn" onclick="App.createDashboardParticipantQueryShare()" ${shareDisabled}>${state.shareLoading ? '產生中...' : '產生臨時網址'}</button>
          </div>
          ${this._renderDashboardParticipantShareNotice ? this._renderDashboardParticipantShareNotice(state) : ''}
          ${this._renderDashboardParticipantSearchResult(state)}
        </div>
      </details>
    `;
  },

  _renderDashboardParticipantSearchResult(state) {
    if (state.loading) {
      return '<div class="dash-query-state">查詢中，正在從 Firestore 讀取符合的活動與簽到紀錄...</div>';
    }
    if (state.error) {
      return `<div class="dash-query-state error">${escapeHTML(state.error)}</div>`;
    }
    if (!state.result) {
      return '<div class="dash-query-state muted">尚未查詢。</div>';
    }

    const result = state.result;
    const summaryHtml = `
      <div class="dash-query-summary">
        <div class="dash-query-summary-card">
          <div class="dash-query-summary-num">${result.matchedEventCount}</div>
          <div class="dash-query-summary-label">符合活動</div>
        </div>
        <div class="dash-query-summary-card">
          <div class="dash-query-summary-num">${result.matchedUserCount}</div>
          <div class="dash-query-summary-label">符合用戶</div>
        </div>
        <div class="dash-query-summary-card">
          <div class="dash-query-summary-num">${result.totalParticipationCount}</div>
          <div class="dash-query-summary-label">參與次數</div>
        </div>
      </div>
    `;

    if (!result.items.length) {
      const emptyText = result.matchedEventCount > 0 ? '有符合活動，但找不到簽到用戶。' : '找不到符合活動。';
      return summaryHtml + `<div class="dash-query-state muted">${emptyText}</div>`;
    }

    return `
      ${summaryHtml}
      <div class="dash-query-state muted">詳細名單已改放臨時網址頁查看。</div>
    `;
  },

  async runDashboardParticipantSearch() {
    const state = this._ensureDashboardParticipantSearchState();
    state.keyword = (document.getElementById('dash-participant-keyword')?.value || '').trim();
    state.startDate = document.getElementById('dash-participant-start')?.value || '';
    state.endDate = document.getElementById('dash-participant-end')?.value || '';

    if (!state.keyword) {
      this.showToast('請輸入活動關鍵字');
      return;
    }
    if (!state.startDate || !state.endDate) {
      this.showToast('請選擇開始與結束日期');
      return;
    }

    state.loading = true;
    state.error = '';
    state.result = null;
    state.shareError = '';
    state.shareUrl = '';
    state.shareExpiresAt = '';
    this.renderDashboard();

    try {
      state.result = await ApiService.queryEventParticipantStats({
        keyword: state.keyword,
        startDate: state.startDate,
        endDate: state.endDate,
      });
    } catch (err) {
      state.error = err?.message || '查詢失敗';
    } finally {
      state.loading = false;
      this.renderDashboard();
    }
  },

  clearDashboardParticipantSearch() {
    this._dashboardParticipantSearchState = this._getDashboardParticipantSearchDefaultState();
    this.renderDashboard();
  },

  _bindDashboardParticipantSearchDetailsEvents() {
    const details = document.getElementById('dash-participant-query-details');
    if (!details || details.dataset.bound === '1') return;
    details.dataset.bound = '1';
    details.addEventListener('toggle', () => {
      const state = this._ensureDashboardParticipantSearchState();
      state.collapsed = !details.open;
    });
  },

  _copyDashboardParticipantText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();

      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) resolve();
        else reject(new Error('copy_failed'));
      } catch (err) {
        document.body.removeChild(textarea);
        reject(err);
      }
    });
  },

});
