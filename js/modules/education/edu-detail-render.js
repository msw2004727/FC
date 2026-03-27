/* ================================================
   SportHub — Education: Club Detail Page Rendering
   ================================================
   教育型俱樂部詳情頁渲染（分組、課程、簽到入口）
   + 學員 subcollection 即時監聽
   ================================================ */

Object.assign(App, {

  _eduDetailTeamId: null,
  _eduStudentsUnsub: null,

  /**
   * 為教育型俱樂部建構詳情頁 body HTML
   */
  renderEduClubDetail(teamId) {
    const bodyEl = document.getElementById('team-detail-body');
    if (!bodyEl) return;

    const team = ApiService.getTeam(teamId);
    if (!team) return;

    this._eduDetailTeamId = teamId;
    const isStaff = this.isEduClubStaff(teamId);

    // ── 基本資訊卡 ──
    const infoCard = '<div class="td-card">'
      + '<div class="td-card-title">俱樂部資訊</div>'
      + '<div class="td-card-grid">'
      + '<div class="td-card-item"><span class="td-card-label">類型</span><span class="td-card-value"><span class="edu-type-badge">教學</span></span></div>'
      + '<div class="td-card-item"><span class="td-card-label">俱樂部經理</span><span class="td-card-value">' + (team.captain ? this._userTag(team.captain, 'captain') : '未設定') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">教練</span><span class="td-card-value">' + ((team.coaches || []).length > 0 ? team.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無') + '</span></div>'
      + '<div class="td-card-item"><span class="td-card-label">地區</span><span class="td-card-value">' + escapeHTML(team.region || '') + '</span></div>'
      + (team.contact ? '<div class="td-card-item"><span class="td-card-label">聯繫方式</span><span class="td-card-value">' + escapeHTML(team.contact) + '</span></div>' : '')
      + (team.eduSettings && team.eduSettings.acceptingStudents !== false ? '<div class="td-card-item"><span class="td-card-label">招生狀態</span><span class="td-card-value" style="color:var(--success)">招生中</span></div>' : '<div class="td-card-item"><span class="td-card-label">招生狀態</span><span class="td-card-value" style="color:var(--text-muted)">暫停招生</span></div>')
      + '</div></div>';

    const bioCard = team.bio ? '<div class="td-card"><div class="td-card-title" style="text-align:center">簡介</div><div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHTML(team.bio) + '</div></div>' : '';

    // ── 分組卡 ──
    const groupSection = '<div class="td-card">'
      + '<div class="td-card-title td-card-title-row">'
      + '<span>分組</span>'
      + (isStaff ? '<button class="primary-btn small" onclick="App.showEduGroupForm(\'' + teamId + '\')">＋ 新增</button>' : '')
      + '</div>'
      + '<div id="edu-group-list"></div>'
      + '</div>';

    // ── 簽到入口（幹部專用）──
    const checkinSection = isStaff ? '<div class="td-card">'
      + '<div class="td-card-title">簽到</div>'
      + '<div style="display:flex;gap:.5rem;flex-wrap:wrap">'
      + '<button class="primary-btn" onclick="App.showEduCheckin(\'' + teamId + '\')">批次簽到</button>'
      + '<button class="outline-btn" onclick="App.showEduCheckinScan(\'' + teamId + '\')">掃碼簽到</button>'
      + '</div></div>' : '';

    // ── 課程方案（所有人可見，幹部可編輯）──
    const courseSection = '<div class="td-card">'
      + '<div class="td-card-title td-card-title-row">'
      + '<span>課程方案</span>'
      + (isStaff ? '<button class="primary-btn small" onclick="App.showEduCoursePlanForm(\'' + teamId + '\')">＋ 新增</button>' : '')
      + '</div>'
      + '<div id="edu-course-plan-list"></div>'
      + '</div>';

    // ── 學員狀態區塊（即時渲染目標）──
    const memberSection = '<div id="edu-member-section"></div>';

    bodyEl.innerHTML = infoCard + bioCard + groupSection + courseSection + checkinSection + memberSection;

    // ★ Phase 1：用快取立即渲染（可能為空或舊資料）
    this._renderEduMemberSection(teamId);
    this.renderEduGroupList(teamId);
    if (typeof this.renderEduCoursePlanList === 'function') {
      this.renderEduCoursePlanList(teamId, isStaff);
    }

    // ★ Phase 2：背景一次性 fetch（保底）+ onSnapshot 即時監聽（持續更新）
    this._loadEduStudents(teamId).then(() => {
      if (this._eduDetailTeamId === teamId) {
        this._renderEduMemberSection(teamId);
        this.renderEduGroupList(teamId);
      }
    });
    this._startEduStudentsListener(teamId);
  },

  /**
   * 渲染「我的學員」區塊（可獨立重繪，供即時監聽呼叫）
   */
  _renderEduMemberSection(teamId) {
    const container = document.getElementById('edu-member-section');
    if (!container) return;

    const isStaff = this.isEduClubStaff(teamId);

    const curUser = ApiService.getCurrentUser();
    const myStudents = this._getMyEduStudents(teamId, curUser);
    const hasActive = myStudents.some(s => s.enrollStatus === 'active');
    const hasPending = myStudents.some(s => s.enrollStatus === 'pending');

    if (myStudents.length === 0) {
      container.innerHTML = '<div class="td-card" style="padding:.6rem .8rem">'
        + '<button class="primary-btn" style="width:100%" onclick="App.showEduStudentApply(\'' + teamId + '\')">申請加入（本人/代理）</button>'
        + '</div>';
      return;
    }

    let html = '<div class="td-card">'
      + '<div class="td-card-title">我的學員</div>';

    html += myStudents.map(s => {
      const age = this.calcAge(s.birthday);
      const ageLabel = age != null ? age + ' 歲' : '';
      const genderIcon = s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '';
      const genderClass = s.gender === 'male' ? ' edu-gender-male' : s.gender === 'female' ? ' edu-gender-female' : '';
      const isPending = s.enrollStatus === 'pending';
      const statusHtml = isPending
        ? '<span class="edu-status-pending">待審核</span>'
        : '<span class="edu-status-active">已通過</span>';
      const groupHtml = (s.groupNames && s.groupNames.length)
        ? '<div class="edu-student-groups">' + s.groupNames.map(n => '<span class="edu-group-tag">' + escapeHTML(n) + '</span>').join('') + '</div>'
        : '';
      // 右側按鈕列
      let actionBtns = '';
      if (!isPending) {
        actionBtns = '<button class="outline-btn small edu-attendance-btn" onclick="App.showEduCalendar(\'' + teamId + '\',\'' + s.id + '\')">出席紀錄</button>'
          + '<button class="outline-btn small edu-withdraw-btn" onclick="App._confirmEduWithdraw(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">退學</button>';
      } else {
        actionBtns = '<button class="outline-btn small edu-withdraw-btn" onclick="App._confirmEduCancelApply(\'' + teamId + '\',\'' + s.id + '\',this)" data-name="' + escapeHTML(s.name) + '">取消申請</button>';
      }

      return '<div class="edu-student-card">'
        + '<div class="edu-student-header">'
        + '<span class="edu-student-name">' + escapeHTML(s.name) + '</span>'
        + (genderIcon ? '<span class="edu-student-gender' + genderClass + '">' + genderIcon + '</span>' : '')
        + (ageLabel ? '<span class="edu-student-age">' + ageLabel + '</span>' : '')
        + statusHtml
        + '<span class="edu-header-actions">' + actionBtns + '</span>'
        + '</div>'
        + groupHtml
        + '</div>';
    }).join('');

    // 追加學員按鈕（有任一 active 或 pending 時顯示）
    if (hasActive || hasPending) {
      html += '<div style="margin-top:.5rem">'
        + '<button class="primary-btn" onclick="App.showEduStudentApply(\'' + teamId + '\')">追加學員</button>'
        + '</div>';
      if (!hasActive && hasPending) {
        html += '<div style="margin-top:.4rem;font-size:.78rem;color:var(--text-muted)">申請審核中，請等待教練審核</div>';
      }
    }

    html += '</div>';
    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  即時監聽：students subcollection
  // ══════════════════════════════════

  _startEduStudentsListener(teamId) {
    this._stopEduStudentsListener();
    if (!teamId || ModeManager.isDemo()) return;
    try {
      const ref = firebase.firestore()
        .collection('teams').doc(teamId).collection('students');
      this._eduStudentsUnsub = ref.onSnapshot(
        snapshot => {
          this._eduStudentsCache[teamId] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
          const page = this.currentPage;
          // 俱樂部詳情頁：重繪學員區塊 + 分組人數
          if (page === 'page-team-detail' && this._eduDetailTeamId === teamId) {
            this._renderEduMemberSection(teamId);
            this._updateGroupMemberCounts(teamId);
            this.renderEduGroupList(teamId);
          }
          // 分組學員列表頁：即時重繪（快取已更新，直接渲染不需再 fetch）
          if (page === 'page-edu-students' && this._eduCurrentGroupId) {
            this._renderEduStudentListFromCache(teamId, this._eduCurrentGroupId);
          }
          // 俱樂部列表頁：更新卡片人數
          if (page === 'page-teams') {
            this.renderTeamList();
          }
        },
        err => { console.error('[edu-realtime] students listener error:', err); }
      );
    } catch (e) { console.error('[edu-realtime] start failed:', e); }
  },

  _stopEduStudentsListener() {
    if (this._eduStudentsUnsub) {
      this._eduStudentsUnsub();
      this._eduStudentsUnsub = null;
    }
  },

  /**
   * 頁面離開時清理教育監聽器（由 navigation.js 呼叫）
   */
  _cleanupEduListeners() {
    this._stopEduStudentsListener();
    this._stopEduTeamsListener();
    this._eduDetailTeamId = null;
  },

  // ══════════════════════════════════
  //  即時監聽：teams collection（俱樂部列表頁）
  // ══════════════════════════════════

  _eduTeamsUnsub: null,
  _eduTeamsStudentUnsubs: [],


  _startEduTeamsListener() {
    this._stopEduTeamsListener();
    if (ModeManager.isDemo()) return;
    try {
      this._eduTeamsUnsub = firebase.firestore()
        .collection('teams')
        .where('active', '==', true)
        .onSnapshot(
          snapshot => {
            const freshTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
            const inactiveTeams = (FirebaseService._cache.teams || []).filter(t => !t.active);
            FirebaseService._cache.teams = [...freshTeams, ...inactiveTeams];
            FirebaseService._debouncedPersistCache();
            this._ensureEduTeamsStudentListeners(freshTeams);
            if (this.currentPage === 'page-teams') {
              this.renderTeamList();
            }
          },
          err => { console.error('[edu-realtime] teams listener error:', err); }
        );
    } catch (e) { console.error('[edu-realtime] teams listener start failed:', e); }
  },

  /**
   * 確保每個教育俱樂部有 students listener（不重複建立）
   */
  _ensureEduTeamsStudentListeners(teams) {
    const eduTeams = teams.filter(t => t.type === 'education');
    const existingIds = new Set(this._eduTeamsStudentUnsubs.map(u => u._teamId));

    for (const t of eduTeams) {
      if (existingIds.has(t.id)) continue; // 已有 listener，不重建
      try {
        const teamId = t.id;
        const unsub = firebase.firestore()
          .collection('teams').doc(teamId).collection('students')
          .onSnapshot(
            snap => {
              this._eduStudentsCache[teamId] = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
              if (this.currentPage === 'page-teams') {
                this.renderTeamList();
              }
            },
            () => {}
          );
        unsub._teamId = teamId; // 標記用於去重
        this._eduTeamsStudentUnsubs.push(unsub);
      } catch (_) {}
    }
  },

  _stopEduTeamsListener() {
    if (this._eduTeamsUnsub) {
      this._eduTeamsUnsub();
      this._eduTeamsUnsub = null;
    }
    this._eduTeamsStudentUnsubs.forEach(fn => fn());
    this._eduTeamsStudentUnsubs = [];
  },

  // ══════════════════════════════════
  //  退學確認（含文字輸入驗證）
  // ══════════════════════════════════

  async _confirmEduCancelApply(teamId, studentId, btnEl) {
    const studentName = btnEl && btnEl.dataset ? btnEl.dataset.name : '';
    if (!(await this.appConfirm('確定要取消「' + studentName + '」的申請嗎？'))) return;
    await this._executeEduWithdraw(teamId, studentId, studentName);
  },

  _confirmEduWithdraw(teamId, studentId, btnEl) {
    const studentName = btnEl && btnEl.dataset ? btnEl.dataset.name : '';
    // 建立毛玻璃彈窗
    const overlay = document.createElement('div');
    overlay.className = 'app-confirm-overlay open';
    overlay.style.cssText = 'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);background:rgba(0,0,0,.35)';

    overlay.innerHTML = '<div class="app-confirm-box" style="border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.15);max-width:320px;width:90%">'
      + '<div class="app-confirm-msg" style="text-align:center">確定要將「' + escapeHTML(studentName) + '」退學嗎？<br><span style="font-size:.75rem;color:var(--text-muted)">此操作無法自行撤回</span></div>'
      + '<div style="margin:.6rem 0"><input type="text" id="edu-withdraw-input" class="ce-input" placeholder="請輸入「我確定退學」" style="width:100%;text-align:center;font-size:.85rem"></div>'
      + '<div class="app-confirm-btns">'
      + '<button class="app-confirm-cancel" id="edu-withdraw-cancel">取消</button>'
      + '<button class="app-confirm-ok" id="edu-withdraw-ok" disabled style="opacity:.5">確定</button>'
      + '</div></div>';

    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    const input = document.getElementById('edu-withdraw-input');
    const okBtn = document.getElementById('edu-withdraw-ok');
    const cancelBtn = document.getElementById('edu-withdraw-cancel');

    // 輸入匹配時啟用確定按鈕
    input.addEventListener('input', () => {
      const match = input.value.trim() === '我確定退學';
      okBtn.disabled = !match;
      okBtn.style.opacity = match ? '1' : '.5';
    });

    // 阻止背景穿透
    overlay.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.app-confirm-box')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });

    const cleanup = () => {
      overlay.remove();
      document.body.classList.remove('modal-open');
    };

    cancelBtn.addEventListener('click', cleanup, { once: true });
    okBtn.addEventListener('click', async () => {
      if (input.value.trim() !== '我確定退學') return;
      cleanup();
      await this._executeEduWithdraw(teamId, studentId, studentName);
    }, { once: true });

    // 自動 focus
    setTimeout(() => input.focus(), 100);
  },

  async _executeEduWithdraw(teamId, studentId, studentName) {
    try {
      await FirebaseService.updateEduStudent(teamId, studentId, {
        enrollStatus: 'inactive',
      });
      const cached = this._eduStudentsCache[teamId];
      if (cached) {
        const s = cached.find(s => s.id === studentId);
        if (s) s.enrollStatus = 'inactive';
      }
      this._updateGroupMemberCounts(teamId);
      this.showToast('「' + studentName + '」已退學');
      this._renderEduMemberSection(teamId);
      this.renderEduGroupList(teamId);
    } catch (err) {
      console.error('[_executeEduWithdraw]', err);
      this.showToast('操作失敗：' + (err.message || '請稍後再試'));
    }
  },

  // ══════════════════════════════════
  //  Helpers
  // ══════════════════════════════════

  _getMyEduStudents(teamId, curUser) {
    if (!curUser) return [];
    const students = this.getEduStudents(teamId);
    return students.filter(s =>
      s.enrollStatus !== 'inactive' &&
      ((s.parentUid && s.parentUid === curUser.uid) || (s.selfUid && s.selfUid === curUser.uid))
    );
  },

  _isEduStudentOrParent(teamId, curUser) {
    return this._getMyEduStudents(teamId, curUser).length > 0;
  },

});
