/* ================================================
   SportHub — Education: Course Plan Attendance Info
   ================================================
   簽到資訊彈窗（月曆式）
   從 edu-course-plan.js 拆分
   ================================================ */

Object.assign(App, {

  _attendInfoMonth: null,
  _attendInfoYear: null,

  async _showCourseAttendanceInfo(teamId, planId) {
    const now = new Date();
    this._attendInfoMonth = now.getMonth();
    this._attendInfoYear = now.getFullYear();
    this._attendInfoTeamId = teamId;
    this._attendInfoPlanId = planId;

    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.id = '_eduAttendInfoOverlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const plan = this.getEduCoursePlans(teamId).find(p => p.id === planId);
    overlay.innerHTML = '<div class="edu-info-dialog" style="max-width:420px">'
      + '<div class="edu-info-dialog-title">' + escapeHTML(plan?.name || '') + ' 簽到資訊</div>'
      + '<div id="_eduAttendCalBody">載入中...</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">關閉</button>'
      + '</div>';
    document.body.appendChild(overlay);
    await this._renderAttendInfoCalendar();
  },

  async _renderAttendInfoCalendar() {
    const body = document.getElementById('_eduAttendCalBody');
    if (!body) return;
    const teamId = this._attendInfoTeamId;
    const planId = this._attendInfoPlanId;
    const year = this._attendInfoYear;
    const month = this._attendInfoMonth;
    const students = this.getEduStudents(teamId);

    // 月份所有天的簽到紀錄
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let allRecords = [];
    try {
      allRecords = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId });
    } catch (_) {}

    // 按日期分組
    const byDate = {};
    allRecords.forEach(r => {
      if (!r.date) return;
      if (r.date < firstDay.toISOString().slice(0, 10) || r.date > lastDay.toISOString().slice(0, 10)) return;
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">'
      + '<button class="outline-btn" style="font-size:.75rem;padding:.2rem .5rem" onclick="App._attendInfoNav(-1)">◀</button>'
      + '<span style="font-weight:700;font-size:.92rem">' + year + '年 ' + monthNames[month] + '</span>'
      + '<button class="outline-btn" style="font-size:.75rem;padding:.2rem .5rem" onclick="App._attendInfoNav(1)">▶</button>'
      + '</div>';

    // 月曆
    html += '<div class="edu-cal-grid" style="grid-template-columns:repeat(7,1fr);display:grid;gap:2px;text-align:center">';
    ['日','一','二','三','四','五','六'].forEach(d => {
      html += '<div style="font-size:.68rem;color:var(--text-muted);font-weight:600;padding:.2rem 0">' + d + '</div>';
    });
    const startPad = firstDay.getDay();
    for (let i = 0; i < startPad; i++) html += '<div></div>';
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const dayRecords = byDate[dateStr] || [];
      const count = dayRecords.length;
      if (count > 0) {
        html += '<div class="edu-attend-cal-cell edu-attend-cal-has" onclick="App._showAttendDayDetail(\'' + dateStr + '\')" title="' + count + '人簽到">'
          + '<div class="edu-attend-cal-badge">' + count + '人</div></div>';
      } else {
        html += '<div class="edu-attend-cal-cell"><div class="edu-attend-cal-day" style="color:var(--text-muted)">' + d + '</div></div>';
      }
    }
    html += '</div>';
    body.innerHTML = html;
  },

  _attendInfoNav(dir) {
    this._attendInfoMonth += dir;
    if (this._attendInfoMonth > 11) { this._attendInfoMonth = 0; this._attendInfoYear++; }
    if (this._attendInfoMonth < 0) { this._attendInfoMonth = 11; this._attendInfoYear--; }
    this._renderAttendInfoCalendar();
  },

  async _showAttendDayDetail(dateStr) {
    const teamId = this._attendInfoTeamId;
    const planId = this._attendInfoPlanId;
    const students = this.getEduStudents(teamId);
    let records = [];
    try {
      records = await FirebaseService.queryEduAttendance({ teamId, coursePlanId: planId, date: dateStr });
    } catch (_) {}

    let listHtml = records.length
      ? records.map(r => {
          const stu = students.find(s => s.id === r.studentId);
          const age = stu && stu.birthday ? this.calcAge(stu.birthday) : null;
          const gender = stu?.gender === 'male' ? '♂' : stu?.gender === 'female' ? '♀' : '';
          const groupLabel = (stu?.groupNames || []).join('、') || '';
          return '<div style="padding:.4rem .5rem;border-bottom:1px solid var(--border);font-size:.85rem;display:flex;align-items:center;gap:.4rem">'
            + '<span style="font-weight:600">' + escapeHTML(r.studentName || '') + '</span>'
            + '<span style="font-size:.78rem;color:var(--text-muted)">' + gender + (age != null ? ' ' + age + '歲' : '') + '</span>'
            + '<span style="font-size:.72rem;color:var(--text-muted);margin-left:auto">' + escapeHTML(groupLabel) + '</span>'
            + '<span style="font-size:.72rem;color:var(--text-muted)">' + escapeHTML(r.time || '') + '</span></div>';
        }).join('')
      : '<div style="text-align:center;color:var(--text-muted);padding:.8rem">無簽到紀錄</div>';

    const overlay2 = document.createElement('div');
    overlay2.className = 'edu-info-overlay';
    overlay2.style.zIndex = '1210';
    overlay2.onclick = (e) => { if (e.target === overlay2) overlay2.remove(); };
    overlay2.innerHTML = '<div class="edu-info-dialog" style="max-width:380px">'
      + '<div class="edu-info-dialog-title">' + dateStr + ' 簽到名單（' + records.length + '人）</div>'
      + '<div style="max-height:300px;overflow-y:auto">' + listHtml + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.6rem" onclick="this.closest(\'.edu-info-overlay\').remove()">關閉</button>'
      + '</div>';
    document.body.appendChild(overlay2);
  },

});
