/* ================================================
   SportHub - Team Detail V2: Runtime Actions
   ================================================ */

Object.assign(App, {

  _teamDetailV2Runtime: null,

  _setTeamDetailV2ShellActive(active) {
    const page = typeof document !== 'undefined' ? document.getElementById('page-team-detail') : null;
    if (page?.classList) page.classList.toggle('td-v2-active', !!active);
  },

  _cleanupTeamDetailV2Runtime(expectedTeamId, expectedRequestSeq) {
    const rt = this._teamDetailV2Runtime;
    if (!rt) {
      this._setTeamDetailV2ShellActive(false);
      return false;
    }
    if (expectedTeamId && String(rt.teamId) !== String(expectedTeamId)) return false;
    if (expectedRequestSeq != null && rt.requestSeq !== expectedRequestSeq) return false;
    try {
      rt.shell?.removeEventListener?.('click', rt.onClick, true);
      if (typeof document !== 'undefined') document.removeEventListener?.('keydown', rt.onKeydown);
    } catch (_) {}
    if (rt.modal?.classList) rt.modal.classList.remove('open');
    this._teamDetailV2Runtime = null;
    this._setTeamDetailV2ShellActive(false);
    return true;
  },

  _syncTeamDetailV2RuntimeAfterBodyRender(teamId, requestSeq) {
    const enabled = typeof isTeamDetailV2Enabled === 'function' && isTeamDetailV2Enabled();
    const shell = enabled && typeof document !== 'undefined'
      ? document.querySelector('#team-detail-body .td-v2-shell')
      : null;
    if (!shell) {
      this._cleanupTeamDetailV2Runtime(teamId, requestSeq);
      this._setTeamDetailV2ShellActive(false);
      return false;
    }
    this._cleanupTeamDetailV2Runtime();
    this._setTeamDetailV2ShellActive(true);
    const runtime = {
      teamId: String(teamId || ''),
      requestSeq,
      shell,
      modal: shell.querySelector('.td-v2-course-modal'),
      onClick: (event) => this._handleTeamDetailV2Click(event, teamId, requestSeq),
      onKeydown: (event) => {
        if (event.key === 'Escape') this.closeTeamDetailV2CourseModal();
      },
    };
    shell.addEventListener('click', runtime.onClick, true);
    if (typeof document !== 'undefined') document.addEventListener('keydown', runtime.onKeydown);
    this._teamDetailV2Runtime = runtime;
    return true;
  },

  _isTeamDetailV2RuntimeCurrent(teamId, requestSeq) {
    const rt = this._teamDetailV2Runtime;
    return !!(rt
      && String(rt.teamId) === String(teamId || '')
      && (requestSeq == null || rt.requestSeq === requestSeq));
  },

  _handleTeamDetailV2Click(event, teamId, requestSeq) {
    if (!this._isTeamDetailV2RuntimeCurrent(teamId, requestSeq)) return;
    const card = event.target?.closest?.('.td-v2-panel-courses .edu-cp-card-v3');
    if (card && !event.target?.closest?.('button,a,input,select,textarea')) {
      const planId = card.getAttribute('data-course-plan-id');
      if (planId && !this.isEduClubStaff?.(teamId)) {
        event.preventDefault();
        event.stopPropagation();
        this.openTeamDetailV2CourseModal(planId);
        return;
      }
    }
    const target = event.target?.closest?.('[data-td-v2-action]');
    if (!target || !this._teamDetailV2Runtime?.shell?.contains(target)) return;
    const action = target.getAttribute('data-td-v2-action');
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    this._runTeamDetailV2Action(action, target, teamId);
  },

  _runTeamDetailV2Action(action, target, teamId) {
    const team = ApiService.getTeam?.(teamId);
    if (!team) return;
    if (action === 'back') return this.goBack?.();
    if (action === 'settings') return this.openTeamDetailSettings?.();
    if (action === 'more') {
      if (this._canEditTeamByRoleOrCaptain?.(team)) return this.openTeamDetailSettings?.();
      return this.shareTeam?.(teamId);
    }
    if (action === 'share') return this.shareTeam?.(teamId);
    if (action === 'contact') {
      if (team.captain) return this.showUserProfile?.(team.captain);
      return this.showToast?.('此俱樂部尚未設定負責人');
    }
    if (action === 'invite') return target.disabled ? null : this.showTeamInviteQR?.(teamId);
    if (action === 'join') return this.handleJoinTeam?.(teamId);
    if (action === 'leave') return this.handleLeaveTeam?.(teamId);
    if (action === 'join-pending') return this.showTeamJoinPendingToast?.(teamId);
    if (action === 'tab') return this.switchTeamDetailV2Tab(teamId, target.getAttribute('data-tab'));
    if (action === 'event') return this.openTeamEventDetailFromCard?.(target.getAttribute('data-event-id'), target);
    if (action === 'create-event') return this.openTeamDetailCreateEvent?.(teamId);
    if (action === 'toggle-member-management') return this.toggleTeamMemberEditMode?.(teamId);
    if (action === 'user') {
      const name = target.getAttribute('data-user-name') || '';
      const uid = target.getAttribute('data-user-uid') || '';
      return this.showUserProfile?.(name, uid ? { uid } : undefined);
    }
    if (action === 'course') return this.openTeamDetailV2CourseModal(target.getAttribute('data-course-id'));
    if (action === 'close-course') return this.closeTeamDetailV2CourseModal();
    if (action === 'fab') return this.openTeamDetailV2Fab(teamId);
    return null;
  },

  switchTeamDetailV2Tab(teamId, tab) {
    const team = ApiService.getTeam?.(teamId);
    if (!team || !tab) return false;
    const allowed = new Set((this._getTeamDetailV2Tabs?.(team) || []).map(item => item.key));
    if (!allowed.has(tab)) return false;
    this._teamDetailTabByTeam = this._teamDetailTabByTeam || {};
    this._teamDetailTabByTeam[teamId] = tab;
    const shell = document.querySelector('#team-detail-body .td-v2-shell');
    if (!shell) return false;
    shell.querySelectorAll('.td-v2-tab-list button').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    shell.querySelectorAll('.td-v2-panel').forEach(panel => {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === tab);
    });
    try { shell.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) {}
    return true;
  },

  openTeamDetailV2CourseModal(planId) {
    const rt = this._teamDetailV2Runtime;
    const teamId = rt?.teamId || this._teamDetailId;
    const plan = (this.getEduCoursePlans?.(teamId) || []).find(p => String(p.id) === String(planId));
    if (!rt?.modal || !plan) {
      this.showToast?.('課程資料載入後可查看詳細內容');
      return false;
    }
    const count = Number(plan._effectiveCount || 0);
    const max = Number(plan.maxCapacity || 0);
    const price = Number(plan.price || 0);
    const schedule = plan.planType === 'weekly'
      ? ((plan.weekdays || []).map(d => '週' + this._weekdayLabel?.(d)).join('、') || '未設定')
      : `共 ${Number(plan.totalSessions || 0)} 堂`;
    rt.modal.querySelector('.td-v2-course-modal-body').innerHTML =
      '<div class="td-v2-modal-head"><div class="td-v2-modal-icon">' + escapeHTML(String(plan.name || '課').charAt(0) || '課') + '</div><div><h3>' + escapeHTML(plan.name || '未命名課程') + '</h3><p>' + escapeHTML(plan.planType === 'weekly' ? '固定週期課程' : '堂數制課程') + '</p></div></div>'
      + '<div class="td-v2-modal-grid">'
      + '<div><span>課表</span><strong>' + escapeHTML(schedule) + '</strong></div>'
      + '<div><span>時間</span><strong>' + escapeHTML(plan.timeSlot || '未設定') + '</strong></div>'
      + '<div><span>期間</span><strong>' + escapeHTML([plan.startDate, plan.endDate].filter(Boolean).join(' ~ ') || '未設定') + '</strong></div>'
      + '<div><span>名額</span><strong>' + escapeHTML(max > 0 ? `${count}/${max} 人` : `${count} 人`) + '</strong></div>'
      + '</div>'
      + (plan.description ? '<p class="td-v2-modal-desc">' + escapeHTML(plan.description) + '</p>' : '')
      + '<div class="td-v2-modal-foot"><div><strong>' + escapeHTML(price > 0 ? 'NT$ ' + price.toLocaleString() : '費用未設定') + '</strong><span>課程費用</span></div>'
      + (plan.allowSignup ? '<button type="button" onclick="App.applyCourseEnrollment(\'' + escapeHTML(teamId) + '\',\'' + escapeHTML(plan.id || '') + '\')">我要報名</button>' : '<button type="button" disabled>未開放報名</button>') + '</div>';
    rt.modal.hidden = false;
    rt.modal.setAttribute('aria-hidden', 'false');
    rt.modal.classList.add('open');
    return true;
  },

  closeTeamDetailV2CourseModal() {
    const modal = this._teamDetailV2Runtime?.modal;
    if (!modal) return false;
    modal.classList.remove('open');
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    return true;
  },

  openTeamDetailV2Fab(teamId) {
    const team = ApiService.getTeam?.(teamId);
    if (!team) return false;
    if (this._canCreateTeamDetailActivity?.(teamId)) {
      this.showToast?.('可從活動分頁新增俱樂部活動');
      this.switchTeamDetailV2Tab(teamId, 'events');
      return true;
    }
    if (this._canEditTeamByRoleOrCaptain?.(team)) {
      this.openTeamDetailSettings?.();
      return true;
    }
    this.shareTeam?.(teamId);
    return true;
  },

});
