/* ================================================
   SportHub — Education: Group List Rendering
   ================================================ */

Object.assign(App, {

  _eduGroupsCache: {},

  /**
   * 載入並快取指定俱樂部的分組列表
   */
  async _loadEduGroups(teamId) {
    if (!teamId) return [];
    try {
      const groups = await FirebaseService.listEduGroups(teamId);
      this._eduGroupsCache[teamId] = groups;
      return groups;
    } catch (err) {
      console.error('[edu-group-list] loadEduGroups failed:', err);
      return this._eduGroupsCache[teamId] || [];
    }
  },

  /**
   * 取得快取中的分組（同步）
   */
  getEduGroups(teamId) {
    return this._eduGroupsCache[teamId] || [];
  },

  /**
   * 渲染分組列表
   */
  async renderEduGroupList(teamId) {
    const container = document.getElementById('edu-group-list') || document.getElementById('edu-group-list-page');
    if (!container) return;

    const isStaff = this.isEduClubStaff(teamId);
    const groups = await this._loadEduGroups(teamId);

    if (!groups.length) {
      container.innerHTML = '<div class="edu-empty-state">尚未建立分組' +
        (isStaff ? '<br><button class="primary-btn small" style="margin-top:.5rem" onclick="App.showEduGroupForm(\'' + teamId + '\')">建立第一個分組</button>' : '') +
        '</div>';
      return;
    }

    const sorted = [...groups].filter(g => g.active !== false).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    container.innerHTML = sorted.map(g => {
      const ageRange = (g.ageMin != null || g.ageMax != null)
        ? '<span class="edu-group-age">' +
          (g.ageMin != null ? g.ageMin : '?') + '-' +
          (g.ageMax != null ? g.ageMax : '?') + ' 歲</span>'
        : '';
      const scheduleHtml = g.schedule
        ? '<div class="edu-group-schedule">' + escapeHTML(g.schedule) + '</div>'
        : '';
      const countHtml = '<span class="edu-group-count">' + (g.memberCount || 0) + ' 人</span>';

      return '<div class="edu-group-card" onclick="App.showEduStudentList(\'' + teamId + '\',\'' + g.id + '\')">' +
        '<div class="edu-group-header">' +
          '<span class="edu-group-name">' + escapeHTML(g.name) + '</span>' +
          ageRange + countHtml +
        '</div>' +
        scheduleHtml +
        (g.description ? '<div class="edu-group-desc">' + escapeHTML(g.description) + '</div>' : '') +
        (isStaff ? '<div class="edu-group-actions">' +
          '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem" onclick="event.stopPropagation();App.showEduGroupForm(\'' + teamId + '\',\'' + g.id + '\')">編輯</button>' +
          '<button class="outline-btn" style="font-size:.72rem;padding:.2rem .5rem;color:var(--danger)" onclick="event.stopPropagation();App.deleteEduGroup(\'' + teamId + '\',\'' + g.id + '\')">刪除</button>' +
        '</div>' : '') +
      '</div>';
    }).join('');
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
