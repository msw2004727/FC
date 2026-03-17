/* ================================================
   SportHub — Education: Stamp Card View
   ================================================
   集點卡視圖（預設，趣味性強）
   ================================================ */

Object.assign(App, {

  /**
   * 渲染集點卡
   */
  _renderEduStampCard() {
    const container = document.getElementById('edu-calendar-content');
    if (!container) return;

    const records = this._getEduAttendanceRecords();
    const teamId = this._eduCalendarTeamId;
    const studentId = this._eduCalendarStudentId;

    // 取得課程方案（如有）
    const plans = this.getEduCoursePlans(teamId);
    const studentData = studentId
      ? (this.getEduStudents(teamId).find(s => s.id === studentId))
      : null;

    // 依群組找方案
    const groupId = studentData && studentData.groupIds && studentData.groupIds[0];
    const plan = groupId ? plans.find(p => p.groupId === groupId && p.active !== false) : null;

    // 計算總堂數
    let totalSlots = 0;
    if (plan) {
      if (plan.planType === 'session') {
        totalSlots = plan.totalSessions || 10;
      } else {
        const dates = this.generateWeeklyDates(plan);
        totalSlots = dates.length || 10;
      }
    } else {
      totalSlots = Math.max(records.length, 10);
    }

    // 已出席日期 set
    const attendedDates = new Set(records.map(r => r.date));

    // 產生格子
    let slotsHtml = '';
    if (plan && plan.planType === 'weekly') {
      const dates = this.generateWeeklyDates(plan);
      slotsHtml = dates.map((date, idx) => {
        const attended = attendedDates.has(date);
        const dateParts = date.split('-');
        const shortDate = parseInt(dateParts[1]) + '/' + parseInt(dateParts[2]);
        return '<div class="edu-stamp-cell' + (attended ? ' edu-stamp-checked' : '') + '">' +
          '<div class="edu-stamp-num">' + (idx + 1) + '</div>' +
          (attended ? '<div class="edu-stamp-mark">&#x2714;</div>' : '') +
          '<div class="edu-stamp-date">' + shortDate + '</div>' +
        '</div>';
      }).join('');
    } else {
      // 堂數制或無方案：顯示序號格子
      for (let i = 0; i < totalSlots; i++) {
        const attended = i < records.length;
        const record = attended ? records[i] : null;
        const shortDate = (record && record.date) ? (() => {
          const parts = record.date.split('-');
          return parseInt(parts[1]) + '/' + parseInt(parts[2]);
        })() : '';
        slotsHtml += '<div class="edu-stamp-cell' + (attended ? ' edu-stamp-checked' : '') + '">' +
          '<div class="edu-stamp-num">' + (i + 1) + '</div>' +
          (attended ? '<div class="edu-stamp-mark">&#x2714;</div>' : '') +
          (shortDate ? '<div class="edu-stamp-date">' + shortDate + '</div>' : '') +
        '</div>';
      }
    }

    // 統計
    const totalAttended = records.length;
    const rate = totalSlots > 0 ? Math.round(totalAttended / totalSlots * 100) : 0;

    container.innerHTML = '<div class="edu-stamp-card">' +
      '<div class="edu-stamp-header">' +
        '<span class="edu-stamp-title">' + (plan ? escapeHTML(plan.name) : '出席集點卡') + '</span>' +
        '<span class="edu-stamp-stats">' + totalAttended + '/' + totalSlots + ' (' + rate + '%)</span>' +
      '</div>' +
      '<div class="edu-stamp-grid">' + slotsHtml + '</div>' +
    '</div>';
  },

});
