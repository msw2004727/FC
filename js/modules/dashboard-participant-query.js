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
      collapsed: true,
    };
  },

  _ensureDashboardParticipantSearchState() {
    if (!this._dashboardParticipantSearchState) {
      this._dashboardParticipantSearchState = this._getDashboardParticipantSearchDefaultState();
    }
    return this._dashboardParticipantSearchState;
  },

  _getDashboardParticipantSearchPanelHint(state) {
    return state?.collapsed ? '展開搜尋條件與查詢結果' : '收起搜尋條件與查詢結果';
  },

  _getDashboardParticipantSearchPanelSummary(state) {
    const keyword = String(state?.keyword || '').trim();
    const startDate = String(state?.startDate || '').trim();
    const endDate = String(state?.endDate || '').trim();
    const rangeText = startDate && endDate ? `${startDate} 至 ${endDate}` : '未設定日期區間';

    if (keyword) {
      return `關鍵字：${keyword} · ${rangeText}`;
    }
    return `日期區間：${rangeText}`;
  },

  _getDashboardParticipantSearchPanelMeta(state) {
    if (state.loading) return '查詢中';
    if (state.shareLoading) return '產生網址中';
    if (state.error) return '查詢失敗';
    if (!state.result) return '尚未查詢';
    return `${Number(state.result.matchedEventCount || 0)} 活動 / ${Number(state.result.matchedUserCount || 0)} 用戶 / ${Number(state.result.totalParticipationCount || 0)} 次`;
  },

  _hasDashboardParticipantSearchHighlight(state) {
    return Boolean(
      String(state?.keyword || '').trim() ||
      state?.loading ||
      state?.error ||
      state?.result ||
      state?.shareLoading ||
      state?.shareError ||
      state?.shareUrl
    );
  },

  _renderDashboardParticipantSearchCard() {
    const state = this._ensureDashboardParticipantSearchState();
    const keyword = escapeHTML(state.keyword || '');
    const startDate = escapeHTML(state.startDate || '');
    const endDate = escapeHTML(state.endDate || '');
    const searchDisabled = state.loading ? 'disabled' : '';
    const shareDisabled = (!state.result || Number(state.result.matchedEventCount || 0) <= 0 || state.loading || state.shareLoading) ? 'disabled' : '';
    const openAttr = state.collapsed ? '' : ' open';
    const detailsClass = this._hasDashboardParticipantSearchHighlight(state) ? ' has-active-filters' : '';
    const hintText = escapeHTML(this._getDashboardParticipantSearchPanelHint(state));
    const summaryText = escapeHTML(this._getDashboardParticipantSearchPanelSummary(state));
    const summaryMeta = escapeHTML(this._getDashboardParticipantSearchPanelMeta(state));

    return `
      <details class="info-card dash-query-card dash-query-details${detailsClass}"${openAttr} ontoggle="App.syncDashboardParticipantSearchCollapse(this)">
        <summary class="dash-query-panel-summary">
          <span class="dash-query-panel-copy">
            <span class="dash-query-panel-title">活動參與查詢</span>
            <span class="dash-query-panel-text">${hintText}</span>
          </span>
          <span class="dash-query-panel-meta">
            <span class="dash-query-panel-meta-primary">${summaryMeta}</span>
            <span class="dash-query-panel-meta-secondary">${summaryText}</span>
          </span>
          <span class="dash-query-arrow" aria-hidden="true">▶</span>
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
    const state = this._ensureDashboardParticipantSearchState();
    this._dashboardParticipantSearchState = {
      ...this._getDashboardParticipantSearchDefaultState(),
      collapsed: state.collapsed,
    };
    this.renderDashboard();
  },

  syncDashboardParticipantSearchCollapse(details) {
    const state = this._ensureDashboardParticipantSearchState();
    state.collapsed = !(details && details.open);
  },

  toggleDashboardParticipantSearchCard() {
    const details = document.querySelector('.dash-query-details');
    if (!details) return;
    details.open = !details.open;
    this.syncDashboardParticipantSearchCollapse(details);
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
