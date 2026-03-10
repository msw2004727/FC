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
    const copyDisabled = (!state.result || !state.result.items || !state.result.items.length || state.loading) ? 'disabled' : '';

    return `
      <div class="info-card dash-query-card">
        <div class="info-title">活動參與查詢</div>
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
          <button class="outline-btn" onclick="App.copyDashboardParticipantSearchResult()" ${copyDisabled}>複製結果</button>
        </div>
        ${this._renderDashboardParticipantSearchResult(state)}
      </div>
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

    const rows = result.items.map((item, index) => {
      const eventsHtml = item.matchedEvents.map(ev => `
        <div class="dash-query-event-line">
          <span class="dash-query-event-title">${escapeHTML(ev.title)}</span>
          <span class="dash-query-event-date">${escapeHTML(ev.date || '')}</span>
        </div>
      `).join('');
      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <div class="dash-query-user-name">${escapeHTML(item.userName || item.uid)}</div>
            <div class="dash-query-user-uid">${escapeHTML(item.uid)}</div>
          </td>
          <td>${item.count}</td>
          <td>${escapeHTML(item.latestParticipationDate || '-')}</td>
          <td><div class="dash-query-event-list">${eventsHtml}</div></td>
        </tr>
      `;
    }).join('');

    return `
      ${summaryHtml}
      <div class="dash-query-table-wrap">
        <table class="dash-query-table">
          <thead>
            <tr>
              <th>#</th>
              <th>用戶</th>
              <th>次數</th>
              <th>最近參與</th>
              <th>符合活動</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
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

  async copyDashboardParticipantSearchResult() {
    const state = this._ensureDashboardParticipantSearchState();
    if (!state.result || !state.result.items || !state.result.items.length) {
      this.showToast('目前沒有可複製的結果');
      return;
    }

    const text = this._buildDashboardParticipantSearchCopyText(state.result);
    try {
      await this._copyDashboardParticipantSearchText(text);
      this.showToast('查詢結果已複製到剪貼簿');
    } catch (_) {
      this.showToast('複製失敗');
    }
  },

  _buildDashboardParticipantSearchCopyText(result) {
    const header = [
      `活動關鍵字\t${result.keyword}`,
      `開始日期\t${result.startDate}`,
      `結束日期\t${result.endDate}`,
      `符合活動\t${result.matchedEventCount}`,
      `符合用戶\t${result.matchedUserCount}`,
      `參與次數\t${result.totalParticipationCount}`,
      '',
      '排名\t用戶名稱\tUID\t參與次數\t最近參與\t符合活動',
    ];

    const rows = result.items.map((item, index) => {
      const titles = item.matchedEvents.map(ev => `${ev.title}（${ev.date || '-'}）`).join('｜');
      return [
        index + 1,
        item.userName || item.uid,
        item.uid,
        item.count,
        item.latestParticipationDate || '-',
        titles,
      ].join('\t');
    });

    return header.concat(rows).join('\n');
  },

  _copyDashboardParticipantSearchText(text) {
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
