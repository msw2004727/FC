/* ================================================
   SportHub — Education: Stamp Card (堂數制)
   ================================================
   集點卡視圖 — 用於堂數制（session）方案
   ================================================ */

Object.assign(App, {

  /**
   * 建構堂數制集點卡 HTML
   * @param {Object|null} plan - 課程方案
   * @param {Array} records - 該方案的出席紀錄
   * @returns {string} HTML
   */
  _buildSessionStampHtml(plan, records) {
    const totalSlots = (plan && plan.totalSessions) || Math.max(records.length, 10);
    const totalAttended = records.length;
    const rate = totalSlots > 0 ? Math.round(totalAttended / totalSlots * 100) : 0;
    const planName = plan ? escapeHTML(plan.name) : '出席集點卡';
    const groupInfo = plan && plan.groupName ? '<span style="font-size:.7rem;color:var(--text-muted);margin-left:.3rem">' + escapeHTML(plan.groupName) + '</span>' : '';

    let slotsHtml = '';
    for (let i = 0; i < totalSlots; i++) {
      const attended = i < totalAttended;
      const record = attended ? records[i] : null;
      const shortDate = (record && record.date) ? (() => {
        const parts = record.date.split('-');
        return parseInt(parts[1]) + '/' + parseInt(parts[2]);
      })() : '';
      slotsHtml += '<div class="edu-stamp-cell' + (attended ? ' edu-stamp-checked' : '') + '">'
        + '<div class="edu-stamp-num">' + (i + 1) + '</div>'
        + (attended ? '<div class="edu-stamp-mark">&#x2714;</div>' : '')
        + (shortDate ? '<div class="edu-stamp-date">' + shortDate + '</div>' : '')
        + '</div>';
    }

    return '<div class="edu-stamp-card" style="margin-bottom:.6rem">'
      + '<div class="edu-stamp-header">'
      + '<span class="edu-stamp-title">' + planName + groupInfo + '</span>'
      + '<span class="edu-stamp-stats">' + totalAttended + '/' + totalSlots + ' (' + rate + '%)</span>'
      + '</div>'
      + '<div class="edu-stamp-grid">' + slotsHtml + '</div>'
      + '</div>';
  },

  /**
   * 無方案 fallback：用全部紀錄建集點卡（直接寫入 container）
   */
  _renderEduStampCard(container, records, plan) {
    container.innerHTML = this._buildSessionStampHtml(plan, records);
  },

});
