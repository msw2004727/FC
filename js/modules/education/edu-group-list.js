/* ================================================
   SportHub — Education: Group List Rendering
   ================================================ */

Object.assign(App, {

  _eduGroupsCache: {},
  _eduGroupsLoadFailedByTeam: {},

  /**
   * 載入並快取指定俱樂部的分組列表
   */
  async _loadEduGroups(teamId) {
    if (!teamId) return [];
    try {
      const groups = await FirebaseService.listEduGroups(teamId);
      this._eduGroupsCache[teamId] = groups;
      this._eduGroupsLoadFailedByTeam[teamId] = false;
      return groups;
    } catch (err) {
      console.error('[edu-group-list] loadEduGroups failed:', err);
      this._eduGroupsLoadFailedByTeam[teamId] = true;
      return this._eduGroupsCache[teamId] || [];
    }
  },

  /**
   * 取得快取中的分組（同步）
   */
  getEduGroups(teamId) {
    return this._eduGroupsCache[teamId] || [];
  },

  _renderEduGroupRefreshStatus(text) {
    if (typeof this._renderEduRefreshStatus === 'function') return this._renderEduRefreshStatus(text);
    return '<div class="edu-refresh-status" role="status" aria-live="polite"><span class="edu-inline-spinner" aria-hidden="true"></span><span>' + escapeHTML(text || '\u8cc7\u6599\u66f4\u65b0\u4e2d...') + '</span></div>';
  },

  _renderEduGroupListRows(teamId, groups, options = {}) {
    const container = options.container || document.getElementById('edu-group-list') || document.getElementById('edu-group-list-page');
    if (!container) return;
    const isStaff = this.isEduClubStaff(teamId);
    const isDetailPanel = !!container.closest?.('#edu-detail-section');
    const readOnly = options.readOnly === true || options.refreshing === true || options.refreshError === true;
    const refreshHtml = options.refreshError === true
      ? this._renderEduGroupRefreshStatus('\u5206\u7d44\u8cc7\u6599\u66ab\u6642\u7121\u6cd5\u66f4\u65b0\uff0c\u5148\u986f\u793a\u4e0a\u6b21\u8cc7\u6599')
      : (options.refreshing === true ? this._renderEduGroupRefreshStatus('\u5206\u7d44\u8cc7\u6599\u66f4\u65b0\u4e2d...') : '');
    const unmatchedCard = () => {
      if (!isStaff || isDetailPanel) return '';
      const unmatched = this.getUnmatchedPendingStudents(teamId);
      if (!unmatched.length) return '';
      return '<div class="edu-group-card edu-group-card-virtual" onclick="App.showEduStudentList(\'' + teamId + '\',\'__unmatched__\')">'
        + '<div class="edu-group-header">'
        + '<span class="edu-group-name">\u5f85\u5be9\u6838\u5b78\u54e1</span>'
        + '<span class="edu-group-pending">' + unmatched.length + ' \u4eba\u5f85\u5206\u914d</span>'
        + '</div>'
        + '<div class="edu-group-desc">\u672a\u7d81\u5b9a\u5206\u7d44\u7684\u5831\u540d\u5b78\u54e1</div>'
        + '</div>';
    };

    if (!Array.isArray(groups) || !groups.length) {
      container.innerHTML = refreshHtml + '<div class="edu-empty-state">\u76ee\u524d\u6c92\u6709\u5206\u7d44'
        + (isStaff && !readOnly ? '<br><button class="primary-btn small" style="margin-top:.5rem" onclick="App.showEduGroupForm(\'' + teamId + '\')">\u65b0\u589e\u5206\u7d44</button>' : '')
        + '</div>' + unmatchedCard();
      return;
    }

    const sorted = [...groups].filter(g => g.active !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const students = this.getEduStudents(teamId);
    sorted.forEach(g => {
      g.memberCount = students.filter(s =>
        s.enrollStatus === 'active' && (s.groupIds || []).includes(g.id)
      ).length;
      g.pendingCount = students.filter(s =>
        s.enrollStatus === 'pending' && (s.groupIds || []).includes(g.id)
      ).length;
    });

    const rows = sorted.map((g, idx) => {
      const ageRange = (g.ageMin != null || g.ageMax != null)
        ? '<span class="edu-group-age">' +
          (g.ageMin != null ? g.ageMin : '?') + '-' +
          (g.ageMax != null ? g.ageMax : '?') + ' \u6b72</span>'
        : '';
      const scheduleHtml = g.schedule
        ? '<div class="edu-group-schedule">' + escapeHTML(g.schedule) + '</div>'
        : '';
      const genderLabel = g.gender === 'male'
        ? '<span class="edu-group-gender-male">\u7537</span>'
        : g.gender === 'female'
          ? '<span class="edu-group-gender-female">\u5973</span>'
          : '';
      let rightHtml = '';
      if (isStaff) {
        const pendingTag = g.pendingCount > 0
          ? '<span class="edu-group-pending">\u5f85\u5be9\u6838 ' + g.pendingCount + '</span>' : '';
        rightHtml = readOnly
          ? '<span class="edu-grp-staff-right">'
          + '<span class="edu-group-count">' + g.memberCount + ' \u4eba</span>'
          + pendingTag
          + '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .4rem" disabled>\u7de8\u8f2f</button>'
          + '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .4rem;color:var(--danger)" disabled>\u522a\u9664</button>'
          + '</span>'
          : '<span class="edu-grp-staff-right">'
          + '<span class="edu-group-count">' + g.memberCount + ' \u4eba</span>'
          + pendingTag
          + '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .4rem" onclick="event.stopPropagation();App.showEduGroupForm(\'' + teamId + '\',\'' + g.id + '\')">\u7de8\u8f2f</button>'
          + '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .4rem;color:var(--danger)" onclick="event.stopPropagation();App.deleteEduGroup(\'' + teamId + '\',\'' + g.id + '\')">\u522a\u9664</button>'
          + '</span>';
      } else {
        rightHtml = '<span class="edu-grp-staff-right"><span class="edu-group-count">' + g.memberCount + ' \u4eba</span></span>';
      }
      const altBg = idx % 2 === 0
        ? 'background:rgba(59,130,246,.06)'
        : 'background:rgba(16,185,129,.06)';
      return '<div class="edu-group-card" style="' + altBg + '" onclick="App.showEduStudentList(\'' + teamId + '\',\'' + g.id + '\')">'
        + '<div class="edu-group-header">'
        + '<span class="edu-group-name">' + escapeHTML(g.name) + '</span>'
        + ageRange + genderLabel
        + rightHtml
        + '</div>'
        + scheduleHtml
        + (g.description ? '<div class="edu-group-desc">' + escapeHTML(g.description) + '</div>' : '')
        + '</div>';
    }).join('');
    container.innerHTML = refreshHtml + rows + unmatchedCard();
  },

  /**
   * 渲染分組列表
   */
  async renderEduGroupList(teamId) {
    const container = document.getElementById('edu-group-list') || document.getElementById('edu-group-list-page');
    if (!container) return;

    const hasCachedGroups = Array.isArray(this._eduGroupsCache?.[teamId]);
    if (hasCachedGroups) {
      this._renderEduGroupListRows(teamId, this.getEduGroups(teamId), { container, refreshing: true, readOnly: true });
    } else {
      container.innerHTML = '<div class="edu-loading" role="status" aria-live="polite" aria-busy="true">'
        + '<div class="edu-loading-bar"><div class="edu-loading-fill"></div></div>'
        + '<div class="edu-loading-text">\u5206\u7d44\u8cc7\u6599\u8f09\u5165\u4e2d</div>'
        + '</div>';
    }
    const groups = await this._loadEduGroups(teamId);
    if (this._eduGroupsLoadFailedByTeam?.[teamId] === true && hasCachedGroups) {
      this._renderEduGroupListRows(teamId, this.getEduGroups(teamId), { container, readOnly: true, refreshError: true });
      return;
    }
    this._renderEduGroupListRows(teamId, groups, { container });
    return;

    if (!groups.length) {
      let emptyHtml = '<div class="edu-empty-state">尚未建立分組' +
        (isStaff ? '<br><button class="primary-btn small" style="margin-top:.5rem" onclick="App.showEduGroupForm(\'' + teamId + '\')">建立第一個分組</button>' : '') +
        '</div>';
      // 即使沒有分組，也要顯示虛擬待審核名單（有未匹配 pending 學員時）
      if (isStaff && !isDetailPanel) {
        const unmatched = this.getUnmatchedPendingStudents(teamId);
        if (unmatched.length > 0) {
          emptyHtml += '<div class="edu-group-card edu-group-card-virtual" style="margin-top:.5rem" onclick="App.showEduStudentList(\'' + teamId + '\',\'__unmatched__\')">'
            + '<div class="edu-group-header">'
            + '<span class="edu-group-name">待審核名單</span>'
            + '<span class="edu-group-pending">' + unmatched.length + ' 人待分配</span>'
            + '</div>'
            + '<div class="edu-group-desc">不符合任何分組條件的申請學員</div>'
            + '</div>';
        }
      }
      container.innerHTML = emptyHtml;
      return;
    }

    const sorted = [...groups].filter(g => g.active !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    // ★ 渲染前自動計算分組人數
    const students = this.getEduStudents(teamId);
    sorted.forEach(g => {
      g.memberCount = students.filter(s =>
        s.enrollStatus === 'active' && (s.groupIds || []).includes(g.id)
      ).length;
      g.pendingCount = students.filter(s =>
        s.enrollStatus === 'pending' && (s.groupIds || []).includes(g.id)
      ).length;
    });

    container.innerHTML = sorted.map((g, idx) => {
      const ageRange = (g.ageMin != null || g.ageMax != null)
        ? '<span class="edu-group-age">' +
          (g.ageMin != null ? g.ageMin : '?') + '-' +
          (g.ageMax != null ? g.ageMax : '?') + ' 歲</span>'
        : '';
      const scheduleHtml = g.schedule
        ? '<div class="edu-group-schedule">' + escapeHTML(g.schedule) + '</div>'
        : '';
      const genderLabel = g.gender === 'male'
        ? '<span class="edu-group-gender-male">限男生</span>'
        : g.gender === 'female'
          ? '<span class="edu-group-gender-female">限女生</span>'
          : '';
      // 置右區域：人數 + 待審核 + 編輯刪除
      let rightHtml = '';
      if (isStaff) {
        const pendingTag = g.pendingCount > 0
          ? '<span class="edu-group-pending">待審核 ' + g.pendingCount + '</span>' : '';
        rightHtml = '<span class="edu-grp-staff-right">'
          + '<span class="edu-group-count">' + g.memberCount + ' 人</span>'
          + pendingTag
          + '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .4rem" onclick="event.stopPropagation();App.showEduGroupForm(\'' + teamId + '\',\'' + g.id + '\')">編輯</button>'
          + '<button class="outline-btn" style="font-size:.68rem;padding:.15rem .4rem;color:var(--danger)" onclick="event.stopPropagation();App.deleteEduGroup(\'' + teamId + '\',\'' + g.id + '\')">刪除</button>'
          + '</span>';
      } else {
        rightHtml = '<span class="edu-grp-staff-right"><span class="edu-group-count">' + g.memberCount + ' 人</span></span>';
      }
      // 交錯底色
      const altBg = idx % 2 === 0
        ? 'background:rgba(59,130,246,.06)'
        : 'background:rgba(16,185,129,.06)';

      return '<div class="edu-group-card" style="' + altBg + '" onclick="App.showEduStudentList(\'' + teamId + '\',\'' + g.id + '\')">' +
        '<div class="edu-group-header">' +
          '<span class="edu-group-name">' + escapeHTML(g.name) + '</span>' +
          ageRange + genderLabel +
          rightHtml +
        '</div>' +
        scheduleHtml +
        (g.description ? '<div class="edu-group-desc">' + escapeHTML(g.description) + '</div>' : '') +
      '</div>';
    }).join('');

    // ★ 虛擬「待審核名單」卡片（職員可見，有未匹配 pending 學員時顯示）
    if (isStaff && !isDetailPanel) {
      const unmatched = this.getUnmatchedPendingStudents(teamId);
      if (unmatched.length > 0) {
        container.innerHTML += '<div class="edu-group-card edu-group-card-virtual" onclick="App.showEduStudentList(\'' + teamId + '\',\'__unmatched__\')">'
          + '<div class="edu-group-header">'
          + '<span class="edu-group-name">待審核名單</span>'
          + '<span class="edu-group-pending">' + unmatched.length + ' 人待分配</span>'
          + '</div>'
          + '<div class="edu-group-desc">不符合任何分組條件的申請學員</div>'
          + '</div>';
      }
    }
  },

  /**
   * 刪除分組
   */
  async deleteEduGroup(teamId, groupId) {
    if (!(await this.appConfirm('確定要刪除此分組？分組內的學員不會被刪除。'))) return;
    try {
      await FirebaseService.deleteEduGroup(teamId, groupId);
      const cached = this._eduGroupsCache[teamId];
      if (cached) {
        const idx = cached.findIndex(g => g.id === groupId);
        if (idx !== -1) cached.splice(idx, 1);
      }
      this.showToast('分組已刪除');
      await this.renderEduGroupList(teamId);
    } catch (err) {
      console.error('[deleteEduGroup]', err);
      this.showToast('刪除失敗：' + (err.message || '請稍後再試'));
    }
  },

});
