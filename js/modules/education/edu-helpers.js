/* ================================================
   SportHub — Education: Shared Helpers
   ================================================
   共用工具：isEducationClub()、權限檢查、年齡計算、ID 生成
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Type Detection
  // ══════════════════════════════════

  /**
   * 判斷俱樂部是否為教育型
   * @param {string|object} teamOrId - team object 或 teamId
   * @returns {boolean}
   */
  isEducationClub(teamOrId) {
    if (!teamOrId) return false;
    const team = typeof teamOrId === 'string'
      ? ApiService.getTeam(teamOrId)
      : teamOrId;
    return team && team.type === 'education';
  },

  /**
   * 判斷俱樂部是否為一般型（非教育型）
   */
  isGeneralClub(teamOrId) {
    if (!teamOrId) return true;
    const team = typeof teamOrId === 'string'
      ? ApiService.getTeam(teamOrId)
      : teamOrId;
    return !team || team.type !== 'education';
  },

  // ══════════════════════════════════
  //  Permission Checks
  // ══════════════════════════════════

  /**
   * 判斷當前用戶是否為該教育型俱樂部的幹部（可管理分組/學員/課程/簽到）
   * 複用既有 isCurrentUserTeamCaptainOrLeader 邏輯
   */
  isEduClubStaff(teamOrId) {
    const team = typeof teamOrId === 'string'
      ? ApiService.getTeam(teamOrId)
      : teamOrId;
    if (!team) return false;
    // 全域管理員視同俱樂部幹部
    const curUser = ApiService.getCurrentUser?.();
    if (curUser && (curUser.role === 'admin' || curUser.role === 'super_admin')) return true;
    return this._canManageTeamMembers(team);
  },

  /**
   * 判斷當前用戶是否可查看某學員（幹部 or 本人/家長）
   */
  canViewStudent(student) {
    if (!student) return false;
    const curUser = ApiService.getCurrentUser();
    if (!curUser) return false;
    const myUid = curUser.uid;
    // 幹部可看全部
    if (student.teamId && this.isEduClubStaff(student.teamId)) return true;
    // 學員本人
    if (student.selfUid && student.selfUid === myUid) return true;
    // 家長
    if (student.parentUid && student.parentUid === myUid) return true;
    return false;
  },

  // ══════════════════════════════════
  //  Age Calculation
  // ══════════════════════════════════

  /**
   * 根據生日計算年齡
   * @param {string} birthday - 'YYYY-MM-DD'
   * @param {string} [referenceDate] - 參考日期，預設今天
   * @returns {number|null}
   */
  calcAge(birthday, referenceDate) {
    if (!birthday) return null;
    const parts = birthday.split('-');
    if (parts.length !== 3) return null;
    const birthYear = parseInt(parts[0], 10);
    const birthMonth = parseInt(parts[1], 10);
    const birthDay = parseInt(parts[2], 10);
    if (isNaN(birthYear) || isNaN(birthMonth) || isNaN(birthDay)) return null;

    const ref = referenceDate ? new Date(referenceDate) : new Date();
    let age = ref.getFullYear() - birthYear;
    const monthDiff = (ref.getMonth() + 1) - birthMonth;
    if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birthDay)) {
      age--;
    }
    return age;
  },

  /**
   * 根據年齡自動匹配分組
   * @param {number} age - 學員年齡
   * @param {Array} groups - 分組列表
   * @returns {Array} 匹配的分組 ID 列表
   */
  autoMatchGroups(age, groups) {
    if (age == null || !Array.isArray(groups)) return [];
    return groups
      .filter(g => {
        if (!g.active) return false;
        if (g.ageMin == null && g.ageMax == null) return false;
        if (g.ageMin != null && age < g.ageMin) return false;
        if (g.ageMax != null && age > g.ageMax) return false;
        return true;
      })
      .map(g => g.id);
  },

  // ══════════════════════════════════
  //  ID Generators
  // ══════════════════════════════════

  _generateEduId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  },

  // ══════════════════════════════════
  //  Date Helpers
  // ══════════════════════════════════

  /**
   * 取得今天的日期字串 'YYYY-MM-DD'
   */
  _todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  },

  /**
   * 取得目前時間字串 'HH:MM'
   */
  _nowTimeStr() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  /**
   * 取得星期幾 (0=日, 1=一, ..., 6=六)
   */
  _getWeekday(dateStr) {
    const d = new Date(dateStr);
    return d.getDay();
  },

  /**
   * 產生週期制課程的所有日期
   * @param {Object} plan - coursePlan with weekdays, startDate, endDate
   * @returns {string[]} 日期字串陣列 'YYYY-MM-DD'
   */
  generateWeeklyDates(plan) {
    if (!plan || !plan.weekdays || !plan.startDate || !plan.endDate) return [];
    const dates = [];
    const start = new Date(plan.startDate);
    const end = new Date(plan.endDate);
    const weekdays = new Set(plan.weekdays);

    const current = new Date(start);
    while (current <= end) {
      if (weekdays.has(current.getDay())) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const d = String(current.getDate()).padStart(2, '0');
        dates.push(y + '-' + m + '-' + d);
      }
      current.setDate(current.getDate() + 1);
    }
    return dates;
  },

  /**
   * 星期數字轉中文
   */
  _weekdayLabel(day) {
    return ['日', '一', '二', '三', '四', '五', '六'][day] || '';
  },

});
