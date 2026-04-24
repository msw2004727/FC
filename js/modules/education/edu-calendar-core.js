/* ================================================
   SportHub — Education: Calendar Core Logic
   ================================================
   依方案類型自動選格式：週期制→月曆、堂數制→集點卡
   多方案同時堆疊顯示
   ================================================ */

Object.assign(App, {

  _eduCalendarTeamId: null,
  _eduCalendarStudentId: null,
  _eduCalendarMonth: null,
  _eduAttendanceCache: {},
  _eduCalendarRequestSeq: 0,

  /**
   * 顯示出席紀錄（多方案堆疊）
   */
  async showEduCalendar(teamId, studentId) {
    const requestSeq = ++this._eduCalendarRequestSeq;
    this._eduCalendarTeamId = teamId;

    // 自動判斷學員
    if (!studentId) {
      const curUser = ApiService.getCurrentUser();
      if (curUser) {
        const students = await this._loadEduStudents(teamId);
        if (requestSeq !== this._eduCalendarRequestSeq) {
          if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
            console.log('[race-skip]', { fn: 'showEduCalendar', seq: requestSeq, latest: this._eduCalendarRequestSeq, stage: 'after-loadEduStudents' });
          }
          return { ok: false, reason: 'stale' };
        }
        const myStudent = students.find(s =>
          s.enrollStatus === 'active' &&
          ((s.selfUid && s.selfUid === curUser.uid) || (s.parentUid && s.parentUid === curUser.uid))
        );
        studentId = myStudent ? myStudent.id : null;
      }
    }

    this._eduCalendarStudentId = studentId;
    await this.showPage('page-edu-calendar');
    if (requestSeq !== this._eduCalendarRequestSeq || this.currentPage !== 'page-edu-calendar') {
      if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
        console.log('[race-skip]', { fn: 'showEduCalendar', seq: requestSeq, latest: this._eduCalendarRequestSeq, currentPage: this.currentPage });
      }
      return { ok: false, reason: 'stale' };
    }

    // 設定月份
    const now = new Date();
    this._eduCalendarMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    // 更新標題
    if (studentId) {
      const students = this.getEduStudents(teamId);
      const student = students.find(s => s.id === studentId);
      const titleEl = document.getElementById('edu-calendar-title');
      if (titleEl && student) titleEl.textContent = student.name + ' — 出席紀錄';
    }

    // 隱藏舊的切換按鈕（不再需要手動切換）
    const toggleEl = document.getElementById('edu-calendar-toggle');
    if (toggleEl) toggleEl.style.display = 'none';

    // 載入出席資料
    await this._loadEduAttendanceForCalendar(teamId, studentId);
    if (requestSeq !== this._eduCalendarRequestSeq) {
      if (window._raceDebug || (typeof localStorage !== 'undefined' && localStorage.getItem('_raceLog'))) {
        console.log('[race-skip]', { fn: 'showEduCalendar', seq: requestSeq, latest: this._eduCalendarRequestSeq, stage: 'after-loadEduAttendance' });
      }
      return { ok: false, reason: 'stale' };
    }

    // 渲染所有方案
    this._renderEduCalendarAll();
    return { ok: true };
  },

  async _loadEduAttendanceForCalendar(teamId, studentId) {
    const key = teamId + ':' + (studentId || 'all');
    try {
      const filters = { teamId };
      if (studentId) filters.studentId = studentId;
      const records = await FirebaseService.queryEduAttendance(filters);
      this._eduAttendanceCache[key] = records;
      return records;
    } catch (err) {
      console.error('[edu-calendar-core] load attendance failed:', err);
      return this._eduAttendanceCache[key] || [];
    }
  },

  _getEduAttendanceRecords() {
    const key = this._eduCalendarTeamId + ':' + (this._eduCalendarStudentId || 'all');
    return this._eduAttendanceCache[key] || [];
  },

  /**
   * 渲染所有方案（自動依類型選格式）
   */
  _renderEduCalendarAll() {
    const container = document.getElementById('edu-calendar-content');
    if (!container) return;

    const teamId = this._eduCalendarTeamId;
    const studentId = this._eduCalendarStudentId;
    const allRecords = this._getEduAttendanceRecords();
    const allPlans = this.getEduCoursePlans(teamId);
    const studentData = studentId
      ? this.getEduStudents(teamId).find(s => s.id === studentId)
      : null;
    const myGroupIds = (studentData && studentData.groupIds) || [];

    // 篩選該學員所屬分組的方案
    const myPlans = allPlans.filter(p =>
      p.active !== false && myGroupIds.includes(p.groupId)
    );

    if (!myPlans.length) {
      // 無方案 → 顯示總覽集點卡
      if (typeof this._renderEduStampCard === 'function') {
        this._renderEduStampCard(container, allRecords, null);
      }
      return;
    }

    // 每個方案一張卡片，堆疊顯示
    let html = '';
    for (const plan of myPlans) {
      // 篩選此方案/分組的出席紀錄
      const planRecords = allRecords.filter(r => r.groupId === plan.groupId);

      if (plan.planType === 'weekly') {
        // 固定週期制 → 月曆
        html += this._buildWeeklyCalendarHtml(plan, planRecords);
      } else {
        // 堂數制 → 集點卡
        html += this._buildSessionStampHtml(plan, planRecords);
      }
    }

    container.innerHTML = html;
  },

  /**
   * 月曆換月（重繪全部）
   */
  changeEduCalendarMonth(delta) {
    const [y, m] = this._eduCalendarMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this._eduCalendarMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    this._renderEduCalendarAll();
  },

});
