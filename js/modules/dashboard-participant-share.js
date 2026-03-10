/* ================================================
   SportHub — Dashboard Participant Share
   臨時活動參與查詢報表（建立 + 公開頁渲染）
   ================================================ */

Object.assign(App, {

  _getParticipantQueryShareIdFromUrl() {
    try {
      return String(new URL(window.location.href).searchParams.get('rid') || '').trim();
    } catch (_) {
      return '';
    }
  },

  _formatParticipantQueryShareDateTime(value) {
    const date = value instanceof Date ? value : new Date(value || '');
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  },

  _renderDashboardParticipantShareNotice(state) {
    if (!state?.shareError && !state?.shareUrl) return '';

    if (state.shareError) {
      return `<div class="dash-query-state error">${escapeHTML(state.shareError)}</div>`;
    }

    const expiresAt = this._formatParticipantQueryShareDateTime(state.shareExpiresAt);
    return `
      <div class="dash-query-share-box">
        <div class="dash-query-share-title">臨時網址已建立</div>
        <div class="dash-query-share-meta">這份報表是查詢當下快照，不會跟著原始資料更新，連結將於 ${escapeHTML(expiresAt || '7 天後')} 失效。</div>
        <div class="dash-query-share-link">${escapeHTML(state.shareUrl)}</div>
        <div class="dash-query-share-actions">
          <button class="outline-btn" onclick="App.copyDashboardParticipantQueryShareUrl()">複製連結</button>
          <button class="outline-btn" onclick="window.open('${escapeHTML(state.shareUrl)}','_blank','noopener')">開新頁查看</button>
        </div>
      </div>
    `;
  },

  async createDashboardParticipantQueryShare() {
    const state = this._ensureDashboardParticipantSearchState?.();
    if (!state?.result || Number(state.result.matchedEventCount || 0) <= 0) {
      this.showToast('目前沒有可建立臨時網址的查詢結果');
      return;
    }

    let popup = null;
    try {
      popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
    } catch (_) {
      popup = null;
    }

    state.shareLoading = true;
    state.shareError = '';
    state.shareUrl = '';
    state.shareExpiresAt = '';
    this.renderDashboard?.();

    try {
      const share = await ApiService.createParticipantQueryShare(state.result, { expiresInDays: 7 });
      state.shareUrl = String(share?.url || '').trim();
      state.shareExpiresAt = String(share?.expiresAt || '').trim();
      this.renderDashboard?.();

      try {
        if (popup) popup.location.replace(state.shareUrl);
      } catch (_) {}

      if (popup && !popup.closed) {
        this.showToast('已產生 7 天臨時網址，並開啟新頁');
      } else {
        this.showToast('已產生 7 天臨時網址');
      }
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      state.shareError = err?.message || '建立臨時網址失敗';
      this.renderDashboard?.();
      this.showToast(state.shareError);
    } finally {
      state.shareLoading = false;
      this.renderDashboard?.();
    }
  },

  async copyDashboardParticipantQueryShareUrl() {
    const state = this._ensureDashboardParticipantSearchState?.();
    const url = String(state?.shareUrl || '').trim();
    if (!url) {
      this.showToast('目前沒有可複製的臨時網址');
      return;
    }

    try {
      await this._copyDashboardParticipantText(url);
      this.showToast('臨時網址已複製到剪貼簿');
    } catch (_) {
      this.showToast('複製失敗');
    }
  },

  _renderParticipantQuerySharePageState(container, html) {
    if (container) container.innerHTML = html;
  },

  _buildParticipantQueryShareRows(items = []) {
    return items.map((item, index) => {
      const eventsHtml = (item.matchedEvents || []).map(event => `
        <div class="dash-query-event-line">
          <span class="dash-query-event-title">${escapeHTML(event.title || '')}</span>
          <span class="dash-query-event-date">${escapeHTML(event.date || '')}</span>
        </div>
      `).join('');

      return `
        <tr>
          <td>${index + 1}</td>
          <td><div class="dash-query-user-name">${escapeHTML(item.userName || '未知使用者')}</div></td>
          <td>${Number(item.count || 0)}</td>
          <td>${escapeHTML(item.latestParticipationDate || '-')}</td>
          <td><div class="dash-query-event-list">${eventsHtml}</div></td>
        </tr>
      `;
    }).join('');
  },

  _renderParticipantQueryShareBody(report) {
    const expiresAt = this._formatParticipantQueryShareDateTime(report?.expiresAt);
    const summaryHtml = `
      <div class="dash-query-summary">
        <div class="dash-query-summary-card">
          <div class="dash-query-summary-num">${report.matchedEventCount}</div>
          <div class="dash-query-summary-label">符合活動</div>
        </div>
        <div class="dash-query-summary-card">
          <div class="dash-query-summary-num">${report.matchedUserCount}</div>
          <div class="dash-query-summary-label">符合用戶</div>
        </div>
        <div class="dash-query-summary-card">
          <div class="dash-query-summary-num">${report.totalParticipationCount}</div>
          <div class="dash-query-summary-label">參與次數</div>
        </div>
      </div>
    `;

    const emptyHtml = !report.items.length
      ? '<div class="dash-query-state muted">這份臨時報表沒有可顯示的用戶資料。</div>'
      : `
        <div class="dash-query-table-wrap">
          <table class="dash-query-table">
            <thead>
              <tr>
                <th>#</th>
                <th>用戶名稱</th>
                <th>次數</th>
                <th>最近參與</th>
                <th>符合活動</th>
              </tr>
            </thead>
            <tbody>${this._buildParticipantQueryShareRows(report.items)}</tbody>
          </table>
        </div>
      `;

    return `
      <div class="participant-share-page">
        <div class="info-card">
          <div class="info-title">活動參與臨時報表</div>
          <div class="participant-share-meta">活動關鍵字：<strong>${escapeHTML(report.keyword || '-')}</strong></div>
          <div class="participant-share-meta">日期區間：${escapeHTML(report.startDate || '-')} 至 ${escapeHTML(report.endDate || '-')}</div>
          <div class="participant-share-meta">連結失效時間：${escapeHTML(expiresAt || '-')}</div>
          <div class="participant-share-note">這是查詢當下的快照頁，不會隨原始活動或簽到資料變動而更新。為避免個資外流，本頁不顯示 UID。</div>
        </div>
        ${summaryHtml}
        ${emptyHtml}
      </div>
    `;
  },

  async renderParticipantQuerySharePage() {
    const container = document.getElementById('participant-share-content');
    if (!container) return;

    const shareId = this._getParticipantQueryShareIdFromUrl();
    if (!shareId) {
      this._renderParticipantQuerySharePageState(container, '<div class="dash-query-state error">缺少臨時報表識別碼，無法顯示內容。</div>');
      return;
    }

    this._renderParticipantQuerySharePageState(container, '<div class="dash-query-state">正在載入臨時報表...</div>');

    try {
      const report = await ApiService.getParticipantQueryShare(shareId);
      this._renderParticipantQuerySharePageState(container, this._renderParticipantQueryShareBody(report));
    } catch (err) {
      this._renderParticipantQuerySharePageState(
        container,
        `<div class="dash-query-state error">${escapeHTML(err?.message || '載入臨時報表失敗')}</div>`
      );
    }
  },

});
