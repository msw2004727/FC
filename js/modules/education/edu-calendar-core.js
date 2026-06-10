/* ================================================
   SportHub Education: Student Attendance Overview
   ================================================ */

Object.assign(App, {

  _eduCalendarTeamId: null,
  _eduCalendarStudentId: null,
  _eduAttendanceOverview: null,
  _eduAttendanceFilters: { planId: 'all', month: 'all', status: 'all' },
  _eduCalendarRequestSeq: 0,

  async showEduCalendar(teamId, studentId) {
    const requestSeq = ++this._eduCalendarRequestSeq;
    this._eduCalendarTeamId = teamId;

    if (!studentId) {
      const curUser = ApiService.getCurrentUser();
      if (curUser) {
        const students = await this._loadEduStudents(teamId);
        if (this._isEduCalendarStale(requestSeq)) return { ok: false, reason: 'stale' };
        const myStudent = students.find(s =>
          s.enrollStatus === 'active' &&
          ((s.selfUid && s.selfUid === curUser.uid) || (s.parentUid && s.parentUid === curUser.uid))
        );
        studentId = myStudent ? myStudent.id : null;
      }
    }

    this._eduCalendarStudentId = studentId;
    await this.showPage('page-edu-calendar');
    if (this._isEduCalendarStale(requestSeq, true)) return { ok: false, reason: 'stale' };

    const titleEl = document.getElementById('edu-calendar-title');
    if (titleEl) titleEl.textContent = '我的學員出缺席紀錄';
    const toggleEl = document.getElementById('edu-calendar-toggle');
    if (toggleEl) toggleEl.style.display = 'none';

    const container = document.getElementById('edu-calendar-content');
    if (container) container.innerHTML = this._renderEduAttendanceLoading();

    if (!studentId) {
      if (container) {
        container.innerHTML = '<div class="edu-attendance-empty"><strong>找不到可查看的學員</strong><span>請先完成學員報名或切換到已綁定的學員帳號。</span></div>';
      }
      return { ok: false, reason: 'no-student' };
    }

    try {
      const overview = await FirebaseService.getEduStudentAttendanceOverview({ teamId, studentId });
      if (this._isEduCalendarStale(requestSeq, true)) return { ok: false, reason: 'stale' };
      this._eduAttendanceOverview = overview || null;
      const currentMonth = this._getEduAttendanceCurrentMonth();
      const months = overview?.months || [];
      this._eduAttendanceFilters = {
        planId: 'all',
        month: months.includes(currentMonth) ? currentMonth : 'all',
        status: 'all',
      };
      if (titleEl && overview?.student?.name) {
        titleEl.textContent = overview.student.name + ' - 出缺席紀錄';
      }
      this._renderEduCalendarAll();
      return { ok: true };
    } catch (err) {
      console.error('[edu-calendar-core] overview load failed:', err);
      if (container) {
        container.innerHTML = '<div class="edu-attendance-empty edu-attendance-error"><strong>出缺席紀錄載入失敗</strong><span>請重新開啟頁面，若仍異常請聯繫俱樂部職員。</span></div>';
      }
      return { ok: false, reason: 'load-failed' };
    }
  },

  _isEduCalendarStale(requestSeq, checkPage) {
    const stale = requestSeq !== this._eduCalendarRequestSeq
      || (checkPage && this.currentPage !== 'page-edu-calendar');
    if (stale && (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog')))) {
      console.log('[race-skip]', {
        fn: 'showEduCalendar',
        seq: requestSeq,
        latest: this._eduCalendarRequestSeq,
        currentPage: this.currentPage,
      });
    }
    return stale;
  },

  _renderEduAttendanceLoading() {
    return '<div class="edu-loading edu-attendance-loading" role="status" aria-live="polite" aria-busy="true">'
      + '<div class="edu-loading-bar"><div class="edu-loading-fill"></div></div>'
      + '<div class="edu-loading-text">正在整理出缺席紀錄...</div>'
      + '<div class="edu-loading-skeleton" aria-hidden="true">'
        + '<div class="edu-loading-skeleton-row"></div>'
        + '<div class="edu-loading-skeleton-row"></div>'
      + '</div>'
      + '</div>';
  },

  _getEduAttendanceCurrentMonth() {
    const today = typeof this._todayStr === 'function'
      ? this._todayStr()
      : new Date().toISOString().slice(0, 10);
    return String(today || '').slice(0, 7);
  },

  _renderEduCalendarAll() {
    const container = document.getElementById('edu-calendar-content');
    if (!container) return;
    const overview = this._eduAttendanceOverview;
    if (!overview) {
      container.innerHTML = '<div class="edu-attendance-empty"><strong>尚無出缺席資料</strong><span>完成課堂簽到、請假或課堂排程後，這裡會自動整理紀錄。</span></div>';
      return;
    }

    const filters = this._eduAttendanceFilters || { planId: 'all', month: 'all', status: 'all' };
    const lessons = this._getFilteredEduAttendanceLessons(overview.lessons || [], filters);
    const summary = this._buildEduAttendanceFilteredSummary(lessons);
    container.innerHTML = '<section class="edu-attendance-overview">'
      + this._renderEduAttendanceHero(overview, summary)
      + this._renderEduAttendanceFilters(overview, filters)
      + this._renderEduAttendanceList(lessons)
      + '</section>';
  },

  _getFilteredEduAttendanceLessons(lessons, filters) {
    return (lessons || []).filter(lesson => {
      if (filters.planId !== 'all' && lesson.planId !== filters.planId) return false;
      if (filters.month !== 'all' && (!lesson.date || lesson.date.slice(0, 7) !== filters.month)) return false;
      if (filters.status !== 'all' && lesson.status !== filters.status) return false;
      return true;
    });
  },

  _buildEduAttendanceFilteredSummary(lessons) {
    const summary = { total: 0, pastTotal: 0, attended: 0, leave: 0, missing: 0, upcoming: 0, attendanceRate: 0 };
    (lessons || []).forEach(lesson => {
      summary.total += 1;
      if (lesson.status === 'upcoming') {
        summary.upcoming += 1;
        return;
      }
      summary.pastTotal += 1;
      if (lesson.status === 'attended') summary.attended += 1;
      else if (lesson.status === 'leave') summary.leave += 1;
      else summary.missing += 1;
    });
    summary.attendanceRate = summary.pastTotal ? Math.round(summary.attended / summary.pastTotal * 100) : 0;
    return summary;
  },

  _renderEduAttendanceHero(overview, summary) {
    const student = overview.student || {};
    const groups = Array.isArray(student.groupNames) && student.groupNames.length
      ? '<span class="edu-attendance-student-groups">' + student.groupNames.map(name => escapeHTML(name)).join(' / ') + '</span>'
      : '';
    const rate = Number(summary.attendanceRate || 0);
    return '<div class="edu-attendance-hero">'
      + '<div class="edu-attendance-hero-main">'
        + '<span class="edu-attendance-eyebrow">我的學員</span>'
        + '<h3>' + escapeHTML(student.name || '學員') + '</h3>'
        + groups
      + '</div>'
      + '<div class="edu-attendance-rate" aria-label="出席率 ' + rate + '%">'
        + '<span>出席率</span>'
        + '<strong>' + rate + '%</strong>'
        + '<div class="edu-attendance-rate-bar"><i style="width:' + Math.max(0, Math.min(100, rate)) + '%"></i></div>'
      + '</div>'
      + '<div class="edu-attendance-stat-grid">'
        + this._renderEduAttendanceStat('已出席', summary.attended, 'attended')
        + this._renderEduAttendanceStat('請假', summary.leave, 'leave')
        + this._renderEduAttendanceStat('未簽到', summary.missing, 'missing')
        + this._renderEduAttendanceStat('尚未開始', summary.upcoming, 'upcoming')
      + '</div>'
    + '</div>';
  },

  _renderEduAttendanceStat(label, value, status) {
    return '<div class="edu-attendance-stat edu-attendance-stat-' + escapeHTML(status) + '">'
      + '<span>' + escapeHTML(label) + '</span>'
      + '<strong>' + Number(value || 0) + '</strong>'
      + '</div>';
  },

  _renderEduAttendanceFilters(overview, filters) {
    const plans = Array.isArray(overview.plans) ? overview.plans : [];
    const months = Array.isArray(overview.months) ? overview.months : [];
    const planOptions = '<option value="all">全部課程</option>' + plans.map(plan =>
      '<option value="' + escapeHTML(plan.id) + '"' + (filters.planId === plan.id ? ' selected' : '') + '>'
        + escapeHTML(plan.name || '未命名課程')
      + '</option>'
    ).join('');
    const monthOptions = '<option value="all">全部月份</option>' + months.map(month =>
      '<option value="' + escapeHTML(month) + '"' + (filters.month === month ? ' selected' : '') + '>'
        + escapeHTML(month.replace('-', ' / '))
      + '</option>'
    ).join('');
    const statusOptions = [
      ['all', '全部狀態'],
      ['attended', '已出席'],
      ['leave', '請假'],
      ['missing', '未簽到'],
      ['upcoming', '尚未開始'],
    ].map(item =>
      '<option value="' + item[0] + '"' + (filters.status === item[0] ? ' selected' : '') + '>' + item[1] + '</option>'
    ).join('');
    return '<div class="edu-attendance-filters">'
      + '<label><span>課程</span><select onchange="App.updateEduAttendanceFilter(\'planId\',this.value)">' + planOptions + '</select></label>'
      + '<label><span>月份</span><select onchange="App.updateEduAttendanceFilter(\'month\',this.value)">' + monthOptions + '</select></label>'
      + '<label><span>狀態</span><select onchange="App.updateEduAttendanceFilter(\'status\',this.value)">' + statusOptions + '</select></label>'
      + '</div>';
  },

  updateEduAttendanceFilter(key, value) {
    if (!['planId', 'month', 'status'].includes(key)) return;
    this._eduAttendanceFilters = {
      ...(this._eduAttendanceFilters || { planId: 'all', month: 'all', status: 'all' }),
      [key]: value || 'all',
    };
    this._renderEduCalendarAll();
  },

  _renderEduAttendanceList(lessons) {
    if (!lessons.length) {
      return '<div class="edu-attendance-empty"><strong>沒有符合條件的紀錄</strong><span>可以切換課程、月份或狀態查看其他資料。</span></div>';
    }
    const rows = lessons.map(lesson => this._renderEduAttendanceRow(lesson)).join('');
    return '<div class="edu-attendance-list">'
      + '<div class="edu-attendance-list-head"><strong>課堂明細</strong><span>' + lessons.length + ' 筆</span></div>'
      + rows
      + '</div>';
  },

  _renderEduAttendanceRow(lesson) {
    const meta = this._getEduAttendanceStatusMeta(lesson.status);
    const time = [lesson.startTime, lesson.endTime].filter(Boolean).join(' - ');
    const sub = [
      this._formatEduAttendanceDate(lesson.date),
      time,
      lesson.location,
    ].filter(Boolean).join(' · ');
    return '<article class="edu-attendance-row edu-attendance-row-' + escapeHTML(meta.cls) + '">'
      + '<div class="edu-attendance-row-date">'
        + '<strong>' + escapeHTML(this._formatEduAttendanceDay(lesson.date)) + '</strong>'
        + '<span>' + escapeHTML(this._formatEduAttendanceMonth(lesson.date)) + '</span>'
      + '</div>'
      + '<div class="edu-attendance-row-main">'
        + '<div class="edu-attendance-row-title">'
          + '<strong>' + escapeHTML(lesson.planName || '課程') + '</strong>'
          + '<span class="edu-attendance-status edu-attendance-status-' + escapeHTML(meta.cls) + '">' + escapeHTML(meta.label) + '</span>'
        + '</div>'
        + '<div class="edu-attendance-row-sub">' + escapeHTML(lesson.sessionTitle || '課堂') + '</div>'
        + (sub ? '<div class="edu-attendance-row-meta">' + escapeHTML(sub) + '</div>' : '')
      + '</div>'
    + '</article>';
  },

  _getEduAttendanceStatusMeta(status) {
    if (status === 'attended') return { label: '已出席', cls: 'attended' };
    if (status === 'leave') return { label: '請假', cls: 'leave' };
    if (status === 'upcoming') return { label: '尚未開始', cls: 'upcoming' };
    return { label: '未簽到', cls: 'missing' };
  },

  _formatEduAttendanceDate(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length < 3) return dateStr;
    return Number(parts[1]) + '/' + Number(parts[2]);
  },

  _formatEduAttendanceDay(dateStr) {
    if (!dateStr) return '-';
    const parts = String(dateStr).split('-');
    return parts.length >= 3 ? String(Number(parts[2])) : dateStr;
  },

  _formatEduAttendanceMonth(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    return parts.length >= 2 ? Number(parts[1]) + '月' : '';
  },

  changeEduCalendarMonth(delta) {
    const months = this._eduAttendanceOverview?.months || [];
    if (!months.length) return;
    const current = this._eduAttendanceFilters?.month || 'all';
    const index = months.indexOf(current);
    const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(months.length - 1, index + delta));
    this.updateEduAttendanceFilter('month', months[nextIndex]);
  },

});
