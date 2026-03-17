/* ================================================
   SportHub — Education: Calendar Core Logic
   ================================================
   行事曆共用邏輯：資料取得、視圖切換
   ================================================ */

Object.assign(App, {

  _eduCalendarTeamId: null,
  _eduCalendarStudentId: null,
  _eduCalendarView: 'stamp', // 'stamp' | 'monthly'
  _eduCalendarMonth: null, // for monthly view: 'YYYY-MM'
  _eduAttendanceCache: {},

  /**
   * 顯示行事曆
   */
  async showEduCalendar(teamId, studentId) {
    this._eduCalendarTeamId = teamId;
    this._eduCalendarView = 'stamp';

    // 自動判斷學員
    if (!studentId) {
      const curUser = ApiService.getCurrentUser();
      if (curUser) {
        const students = await this._loadEduStudents(teamId);
        const myStudent = students.find(s =>
          s.enrollStatus === 'active' &&
          ((s.selfUid && s.selfUid === curUser.uid) || (s.parentUid && s.parentUid === curUser.uid))
        );
        studentId = myStudent ? myStudent.id : null;
      }
    }

    this._eduCalendarStudentId = studentId;
    await this.showPage('page-edu-calendar');

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

    // 載入出席資料
    await this._loadEduAttendanceForCalendar(teamId, studentId);

    // 渲染
    this._renderEduCalendarView();
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
   * 切換視圖
   */
  switchEduCalendarView(view) {
    this._eduCalendarView = view;
    // 更新按鈕狀態
    document.querySelectorAll('.edu-view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    this._renderEduCalendarView();
  },

  _renderEduCalendarView() {
    if (this._eduCalendarView === 'stamp') {
      if (typeof this._renderEduStampCard === 'function') {
        this._renderEduStampCard();
      }
    } else {
      if (typeof this._renderEduMonthlyCalendar === 'function') {
        this._renderEduMonthlyCalendar();
      }
    }
  },

  /**
   * 月曆換月
   */
  changeEduCalendarMonth(delta) {
    const [y, m] = this._eduCalendarMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this._eduCalendarMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    this._renderEduCalendarView();
  },

});
