/* ================================================
   SportHub — Education: Shared Helpers
   ================================================
   共用工具：isEducationClub()、權限檢查、年齡計算、ID 生成
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  教育區塊說明彈窗
  // ══════════════════════════════════

  _showEduInfoPopup(type) {
    const info = {
      group: {
        title: '學員分組說明',
        body: '<p>學員分組用於將報名的學員依條件分類管理：</p>'
          + '<ul>'
          + '<li><b>自動分組</b> — 建立分組時可設定年齡範圍與性別條件，新學員申請加入後系統會自動將符合條件的學員歸入對應分組。</li>'
          + '<li><b>手動分組</b> — 俱樂部職員也可以手動將學員指定到任意分組，不受條件限制。</li>'
          + '<li><b>多元分組</b> — 可依照程度、年齡層、時段等需求建立不同分組，由職員自由分類管理。</li>'
          + '</ul>'
          + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.5rem">不符合任何分組條件的學員會自動歸入「待審核名單」，等待職員手動分配。</p>',
      },
      course: {
        title: '課程方案說明',
        body: '<p>課程方案分為兩種計費模式：</p>'
          + '<div style="background:var(--accent-bg);border-radius:var(--radius);padding:.6rem .8rem;margin:.5rem 0">'
          + '<b>堂數制</b>'
          + '<p style="margin:.3rem 0 0;font-size:.82rem">購買固定堂數，在指定期間內自由安排上課時間，用完為止。適合時間不固定的學員，彈性較高。</p>'
          + '<p style="margin:.2rem 0 0;font-size:.78rem;color:var(--text-muted)">例：購買 10 堂，3 個月內使用完畢。</p>'
          + '</div>'
          + '<div style="background:var(--accent-bg);border-radius:var(--radius);padding:.6rem .8rem;margin:.5rem 0">'
          + '<b>固定週期制</b>'
          + '<p style="margin:.3rem 0 0;font-size:.82rem">在指定期間內，每週固定星期上課。適合需要規律訓練節奏的學員，出席較穩定。</p>'
          + '<p style="margin:.2rem 0 0;font-size:.78rem;color:var(--text-muted)">例：每週二、四上課，為期 3 個月。</p>'
          + '</div>',
      },
      member: {
        title: '我們這一家',
        body: '<p>此區域顯示您在本俱樂部報名的所有學員，包含：</p>'
          + '<ul>'
          + '<li><b>本人報名</b> — 您以自己的身分申請加入俱樂部。</li>'
          + '<li><b>代理報名</b> — 您為家人或孩子代為申請加入。</li>'
          + '</ul>'
          + '<p style="margin-top:.5rem">學員在教練審核通過後即正式加入俱樂部，可參與課程與簽到。審核中的學員會顯示「待審核」狀態。</p>'
          + '<p style="margin-top:.3rem">學員名下會顯示目前參加中的課程標籤，方便您一覽課程安排。</p>',
      },
    };
    const item = info[type];
    if (!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + item.title + '</div>'
      + '<div class="edu-info-dialog-body">' + item.body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  // ══════════════════════════════════
  //  按鈕處理中狀態（防重複提交 + 用戶回饋）
  // ══════════════════════════════════

  /**
   * 將按鈕設為「處理中」狀態（灰色 + 禁用 + 顯示處理中文字）
   * @param {HTMLElement|string} btnOrSelector - 按鈕元素或 CSS selector
   * @returns {{ restore: Function }} 呼叫 restore() 恢復原狀
   */
  _setEduBtnLoading(btnOrSelector) {
    const btn = typeof btnOrSelector === 'string'
      ? document.querySelector(btnOrSelector) : btnOrSelector;
    if (!btn) return { restore() {} };
    const origText = btn.textContent;
    const origDisabled = btn.disabled;
    btn.disabled = true;
    btn.textContent = '處理中...';
    btn.style.opacity = '0.55';
    btn.style.pointerEvents = 'none';
    return {
      restore() {
        btn.disabled = origDisabled;
        btn.textContent = origText;
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
      }
    };
  },

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
   * 根據年齡+性別自動匹配分組（智慧匹配：性別優先 + 最接近 ageMax）
   * @param {number} age - 學員年齡
   * @param {string} gender - 學員性別 'male'/'female'
   * @param {Array} groups - 分組列表
   * @returns {Array} 匹配的分組 ID 列表
   */
  autoMatchGroups(age, gender, groups) {
    if (age == null || !Array.isArray(groups)) return [];

    // 1. 過濾 active + 性別匹配
    const candidates = groups.filter(g =>
      g.active !== false &&
      (!g.gender || g.gender === 'all' || g.gender === gender)
    );

    // 2. 分池：有年齡條件 vs 無年齡條件
    const noCondition = candidates.filter(g => g.ageMin == null && g.ageMax == null);
    const hasCondition = candidates.filter(g => g.ageMin != null || g.ageMax != null);

    // 3. 篩出年齡在範圍內的
    const inRange = hasCondition.filter(g =>
      (g.ageMin == null || age >= g.ageMin) &&
      (g.ageMax == null || age <= g.ageMax)
    );

    // 4. 有限 ageMax 的中找最小值（最接近學員年齡的上限）
    const withFiniteMax = inRange.filter(g => g.ageMax != null);
    const openEnded = inRange.filter(g => g.ageMax == null);

    let closestGroups = [];
    if (withFiniteMax.length > 0) {
      const minAgeMax = Math.min.apply(null, withFiniteMax.map(g => g.ageMax));
      closestGroups = withFiniteMax.filter(g => g.ageMax === minAgeMax);
    }

    // 5. 結果：最接近的 + 開放上限的 + 無條件的
    const result = [].concat(closestGroups, openEnded, noCondition);
    return result.map(g => g.id);
  },

  /**
   * 取得未匹配任何分組的 pending 學員（用於虛擬待審核名單）
   */
  getUnmatchedPendingStudents(teamId) {
    const students = this.getEduStudents(teamId);
    return students.filter(s =>
      s.enrollStatus === 'pending' &&
      (!s.groupIds || s.groupIds.length === 0)
    );
  },

  /**
   * 新建分組後，將未匹配的 pending 學員自動移入符合條件的分組
   */
  async _reassignUnmatchedStudents(teamId, newGroup) {
    const unmatched = this.getUnmatchedPendingStudents(teamId);
    if (!unmatched.length) return;

    for (const s of unmatched) {
      // 檢查性別
      if (newGroup.gender && newGroup.gender !== 'all' && newGroup.gender !== s.gender) continue;
      // 檢查年齡
      const age = this.calcAge(s.birthday);
      if (age != null) {
        if (newGroup.ageMin != null && age < newGroup.ageMin) continue;
        if (newGroup.ageMax != null && age > newGroup.ageMax) continue;
      }
      // 符合 → 加入此分組（仍為 pending）
      const newGroupIds = [...(s.groupIds || []), newGroup.id];
      const newGroupNames = [...(s.groupNames || []), newGroup.name];
      try {
        await FirebaseService.updateEduStudent(teamId, s.id, {
          groupIds: newGroupIds,
          groupNames: newGroupNames,
        });
        s.groupIds = newGroupIds;
        s.groupNames = newGroupNames;
      } catch (_) {}
    }
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
