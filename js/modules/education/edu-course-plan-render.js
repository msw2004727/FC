/* ================================================
   SportHub — Education: Course Plan Render
   ================================================
   課程方案列表渲染（方案卡片、報名按鈕、管理按鈕、排序按鈕）
   從 edu-course-plan.js 拆分
   ================================================ */

Object.assign(App, {

  async renderEduCoursePlanList(teamId, isStaff) {
    const container = document.getElementById('edu-course-plan-list');
    if (!container) return;

    // 若未傳入 isStaff，自動判斷
    if (isStaff === undefined) isStaff = this.isEduClubStaff(teamId);

    const plans = await this._loadEduCoursePlans(teamId);
    const activePlans = plans.filter(p => p.active !== false)
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });

    if (!activePlans.length) {
      container.innerHTML = '<div class="edu-empty-state">尚未建立課程方案</div>';
      return;
    }

    // 取得當前用戶的報名狀態（用於學員視角按鈕）
    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid;
    const students = this.getEduStudents(teamId);

    // 載入各方案的報名紀錄 + 計算含分組學員的實際人數
    for (const p of activePlans) {
      try {
        const key = this._getCourseEnrollCacheKey?.(teamId, p.id);
        if (key && !this._courseEnrollCache?.[key]) {
          p._enrollments = await this._loadCourseEnrollments?.(teamId, p.id) || [];
        } else {
          p._enrollments = (key && this._courseEnrollCache?.[key]) || [];
        }
      } catch (_) { p._enrollments = []; }
      // 計算實際人數：approved enrollments + 分組內 active 學員（不重複）
      const enrolledIds = new Set(p._enrollments.filter(e => e.status === 'approved').map(e => e.studentId));
      if (p.groupId) {
        students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
          .forEach(s => enrolledIds.add(s.id));
      }
      p._effectiveCount = enrolledIds.size;
    }

    container.innerHTML = activePlans.map(p => {
      const typeLabel = p.planType === 'weekly' ? '固定週期' : '堂數制';
      // 卡片底色依方案類型
      const cardBg = p.planType === 'weekly'
        ? 'background:linear-gradient(135deg,rgba(13,148,136,.08),rgba(13,148,136,.03))'
        : 'background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(124,58,237,.03))';
      const todayCheck = new Date().toISOString().slice(0, 10);
      const planEnded = p.endDate && p.endDate < todayCheck;
      const statusBadge = planEnded
        ? '<span class="edu-cp-status" style="background:rgba(148,163,184,.15);color:#94a3b8">已結束</span>'
        : p.allowSignup
          ? '<span class="edu-cp-status edu-cp-status-open">招生中</span>'
          : '';

      // 封面圖（右側 1/3，寬圖比例 4:3）
      const coverHtml = '<div class="edu-cp-cover">'
        + (p.coverImage ? '<img src="' + escapeHTML(p.coverImage) + '" alt="">' : '<span style="font-size:.72rem;color:var(--text-muted)">無封面</span>')
        + '</div>';

      // 課程是否已結束
      const today = new Date().toISOString().slice(0, 10);
      const isEnded = p.endDate && p.endDate < today;

      // 資訊小卡片（由上至下：日期 > 週幾/堂數 > 費用 > 人數）
      const chips = [];
      if (p.startDate) chips.push(escapeHTML(p.startDate) + ' ~ ' + escapeHTML(p.endDate || ''));
      if (p.planType === 'weekly') {
        const wdNames = (p.weekdays || []).map(d => '週' + this._weekdayLabel(d)).join('、');
        chips.push(wdNames + (p.timeSlot ? ' ' + escapeHTML(p.timeSlot) : ''));
      } else {
        chips.push('共 ' + (p.totalSessions || 0) + ' 堂');
      }
      if (p.price) chips.push('$' + p.price.toLocaleString());
      chips.push((p._effectiveCount || 0) + (p.maxCapacity ? '/' + p.maxCapacity : '') + ' 人');
      const infoHtml = '<div class="edu-cp-chips">' + chips.map(c => '<span class="edu-cp-chip">' + c + '</span>').join('') + '</div>';

      // 學員報名按鈕
      let signupBtn = '';
      if (p.allowSignup) {
        if (isEnded) {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem;opacity:.45" disabled>課程已結束</button>';
        } else {
        const isFull = p.maxCapacity && (p._effectiveCount || 0) >= p.maxCapacity;
        // 檢查用戶名下所有學員是否都已報名（含分組自動導入的）
        const myStudents = students.filter(s =>
          s.enrollStatus !== 'inactive' && (s.selfUid === myUid || s.parentUid === myUid)
        );
        // 分組學員也視為已報名
        const enrolledStudentIds = new Set(
          (p._enrollments || []).filter(e => e.status !== 'rejected').map(e => e.studentId)
        );
        if (p.groupId) {
          students.filter(s => s.enrollStatus === 'active' && (s.groupIds || []).includes(p.groupId))
            .forEach(s => enrolledStudentIds.add(s.id));
        }
        const allEnrolled = myStudents.length > 0 && myStudents.every(s => enrolledStudentIds.has(s.id));

        if (allEnrolled) {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem;opacity:.45" disabled>學員皆已報名</button>';
        } else if (isFull) {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem;opacity:.45" disabled>已額滿</button>';
        } else {
          signupBtn = '<button class="primary-btn" style="width:100%;margin-top:.4rem" onclick="event.stopPropagation();App.applyCourseEnrollment(\'' + teamId + '\',\'' + p.id + '\')">我要報名</button>';
        }
        } // end else (not ended)
      }

      // 管理按鈕（報名按鈕之下，左對齊 + 右側排序按鈕）
      const idx = activePlans.indexOf(p);
      const manageHtml = isStaff
        ? '<div class="edu-cp-manage-left">'
          + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="event.stopPropagation();App.showEduCoursePlanForm(\'' + teamId + '\',\'' + p.id + '\')">編輯</button>'
          + '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)" onclick="event.stopPropagation();App.deleteEduCoursePlan(\'' + teamId + '\',\'' + p.id + '\')">刪除</button>'
          + '<span style="margin-left:auto;display:flex;gap:.2rem">'
          + (idx > 0 ? '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',-1)" title="向上">▲</button>' : '')
          + (idx < activePlans.length - 1 ? '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',1)" title="向下">▼</button>' : '')
          + '<button class="' + (p.pinned ? 'edu-cp-pin-active' : 'outline-btn') + '" style="font-size:.68rem;padding:.15rem .35rem" onclick="event.stopPropagation();App._moveCoursePlan(\'' + teamId + '\',\'' + p.id + '\',0)" title="' + (p.pinned ? '取消置頂' : '置頂') + '">★</button>'
          + '</span>'
          + '</div>'
        : '';

      const clickAction = isStaff
        ? ' onclick="App.showCourseEnrollmentList(\'' + teamId + '\',\'' + p.id + '\')"'
        : '';

      return '<div class="edu-course-card edu-cp-card-v2" style="' + cardBg + '"' + clickAction + '>'
        + '<div class="edu-cp-body">'
        + '<div class="edu-cp-left">'
        + '<div class="edu-cp-top">'
        + '<span class="edu-course-name">' + escapeHTML(p.name) + '</span>'
        + '<span class="edu-cp-type-text ' + (p.planType === 'weekly' ? 'edu-cp-type-weekly' : 'edu-cp-type-session') + '">' + typeLabel + '</span>'
        + statusBadge
        + '</div>'
        + infoHtml
        + '</div>'
        + coverHtml
        + '</div>'
        + signupBtn
        + manageHtml
        + '</div>';
    }).join('');
  },

});
