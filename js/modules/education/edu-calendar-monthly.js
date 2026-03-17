/* ================================================
   SportHub — Education: Monthly Calendar View
   ================================================
   月曆格子視圖
   ================================================ */

Object.assign(App, {

  /**
   * 渲染月曆格子
   */
  _renderEduMonthlyCalendar() {
    const container = document.getElementById('edu-calendar-content');
    if (!container) return;

    const records = this._getEduAttendanceRecords();
    const monthStr = this._eduCalendarMonth; // 'YYYY-MM'
    const [year, month] = monthStr.split('-').map(Number);

    // 該月的出席日期
    const attendedDates = new Set(
      records
        .filter(r => r.date && r.date.startsWith(monthStr))
        .map(r => r.date)
    );

    // 該月有多少天
    const daysInMonth = new Date(year, month, 0).getDate();
    // 該月第一天是星期幾 (0=日)
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

    const today = this._todayStr();

    // 星期標頭
    const weekHeaders = ['日', '一', '二', '三', '四', '五', '六']
      .map(d => '<div class="edu-cal-header">' + d + '</div>')
      .join('');

    // 日期格子
    let cellsHtml = '';
    // 空白格
    for (let i = 0; i < firstDayOfWeek; i++) {
      cellsHtml += '<div class="edu-cal-cell edu-cal-empty"></div>';
    }
    // 日期
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const isAttended = attendedDates.has(dateStr);
      const isToday = dateStr === today;
      let cls = 'edu-cal-cell';
      if (isAttended) cls += ' edu-cal-attended';
      if (isToday) cls += ' edu-cal-today';
      cellsHtml += '<div class="' + cls + '">' +
        '<span class="edu-cal-day">' + day + '</span>' +
        (isAttended ? '<span class="edu-cal-dot"></span>' : '') +
      '</div>';
    }

    // 月份統計
    const totalInMonth = attendedDates.size;
    const totalRecords = records.length;

    // 月份導航
    const monthLabel = year + ' 年 ' + month + ' 月';
    const prevMonth = '<button class="outline-btn small" onclick="App.changeEduCalendarMonth(-1)">&lt;</button>';
    const nextMonth = '<button class="outline-btn small" onclick="App.changeEduCalendarMonth(1)">&gt;</button>';

    container.innerHTML = '<div class="edu-monthly-calendar">' +
      '<div class="edu-cal-nav">' +
        prevMonth +
        '<span class="edu-cal-month-label">' + monthLabel + '</span>' +
        nextMonth +
      '</div>' +
      '<div class="edu-cal-grid">' + weekHeaders + cellsHtml + '</div>' +
      '<div class="edu-cal-summary">' +
        '本月出席：<strong>' + totalInMonth + '</strong> 天 ｜ ' +
        '累計出席：<strong>' + totalRecords + '</strong> 次' +
      '</div>' +
    '</div>';
  },

});
