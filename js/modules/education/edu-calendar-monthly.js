/* ================================================
   SportHub — Education: Monthly Calendar (固定週期制)
   ================================================
   月曆格子視圖 — 用於固定週期（weekly）方案
   圈出出席日期，標記課程日
   ================================================ */

Object.assign(App, {

  /**
   * 建構固定週期制月曆 HTML
   * @param {Object} plan - weekly 課程方案
   * @param {Array} records - 該方案的出席紀錄
   * @returns {string} HTML
   */
  _buildWeeklyCalendarHtml(plan, records) {
    const monthStr = this._eduCalendarMonth;
    const [year, month] = monthStr.split('-').map(Number);
    const planName = plan ? escapeHTML(plan.name) : '出席月曆';
    const groupInfo = plan && plan.groupName ? '<span style="font-size:.7rem;color:var(--text-muted);margin-left:.3rem">' + escapeHTML(plan.groupName) + '</span>' : '';
    const scheduleInfo = plan && plan.timeSlot ? '<span style="font-size:.68rem;color:var(--text-muted);margin-left:.3rem">' + escapeHTML(plan.timeSlot) + '</span>' : '';

    // 該月出席日期
    const attendedDates = new Set(
      records.filter(r => r.date && r.date.startsWith(monthStr)).map(r => r.date)
    );

    // 該方案的課程日（用 weekdays 標記哪些天是上課日）
    const planWeekdays = new Set(plan && plan.weekdays ? plan.weekdays : []);
    const planStart = plan && plan.startDate ? plan.startDate : '';
    const planEnd = plan && plan.endDate ? plan.endDate : '';

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    const today = this._todayStr();

    // 星期標頭
    const weekHeaders = ['日', '一', '二', '三', '四', '五', '六']
      .map(d => '<div class="edu-cal-header">' + d + '</div>')
      .join('');

    // 日期格子
    let cellsHtml = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
      cellsHtml += '<div class="edu-cal-cell edu-cal-empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const isAttended = attendedDates.has(dateStr);
      const isToday = dateStr === today;
      const dayOfWeek = new Date(year, month - 1, day).getDay();
      const isCourseDay = planWeekdays.has(dayOfWeek) && dateStr >= planStart && dateStr <= planEnd;

      let cls = 'edu-cal-cell';
      if (isAttended) cls += ' edu-cal-attended';
      if (isToday) cls += ' edu-cal-today';
      if (isCourseDay && !isAttended) cls += ' edu-cal-course-day';

      cellsHtml += '<div class="' + cls + '">'
        + '<span class="edu-cal-day">' + day + '</span>'
        + (isAttended ? '<span class="edu-cal-stamp"></span><span class="edu-cal-seal">出席</span>' : '')
        + '</div>';
    }

    // 統計
    const totalInMonth = attendedDates.size;
    const totalAll = records.length;

    // 月份導航
    const monthLabel = year + ' 年 ' + month + ' 月';

    return '<div class="edu-monthly-calendar" style="margin-bottom:.6rem">'
      + '<div class="edu-cal-nav">'
      + '<button class="outline-btn small" onclick="App.changeEduCalendarMonth(-1)">&lt;</button>'
      + '<span class="edu-cal-month-label">' + planName + groupInfo + scheduleInfo + '</span>'
      + '<button class="outline-btn small" onclick="App.changeEduCalendarMonth(1)">&gt;</button>'
      + '</div>'
      + '<div style="text-align:center;font-size:.72rem;color:var(--text-muted);margin-bottom:.3rem">' + monthLabel + '</div>'
      + '<div class="edu-cal-grid">' + weekHeaders + cellsHtml + '</div>'
      + '<div class="edu-cal-summary">'
      + '本月出席：<strong>' + totalInMonth + '</strong> 天 ｜ '
      + '累計出席：<strong>' + totalAll + '</strong> 次'
      + '</div>'
      + '</div>';
  },

});
