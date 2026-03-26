/* ================================================
   SportHub — Education: Group CRUD Form
   ================================================ */

Object.assign(App, {

  _eduGroupEditTeamId: null,
  _eduGroupEditId: null,

  /**
   * 顯示分組建立/編輯表單
   */
  showEduGroupForm(teamId, groupId) {
    this._eduGroupEditTeamId = teamId;
    this._eduGroupEditId = groupId || null;

    const titleEl = document.getElementById('edu-group-modal-title');
    const saveBtn = document.getElementById('edu-group-save-btn');

    if (groupId) {
      titleEl.textContent = '編輯分組';
      saveBtn.textContent = '儲存變更';
      const groups = this.getEduGroups(teamId);
      const g = groups.find(g => g.id === groupId);
      if (g) {
        document.getElementById('edu-grp-name').value = g.name || '';
        document.getElementById('edu-grp-desc').value = g.description || '';
        document.getElementById('edu-grp-age-min').value = g.ageMin != null ? g.ageMin : '';
        document.getElementById('edu-grp-age-max').value = g.ageMax != null ? g.ageMax : '';
        document.getElementById('edu-grp-gender').value = g.gender || 'all';
        document.getElementById('edu-grp-schedule').value = g.schedule || '';
      }
    } else {
      titleEl.textContent = '建立分組';
      saveBtn.textContent = '建立分組';
      document.getElementById('edu-grp-name').value = '';
      document.getElementById('edu-grp-desc').value = '';
      document.getElementById('edu-grp-age-min').value = '';
      document.getElementById('edu-grp-age-max').value = '';
      document.getElementById('edu-grp-gender').value = 'all';
      document.getElementById('edu-grp-schedule').value = '';
    }

    this.showModal('edu-group-modal');
  },

  /**
   * 儲存分組
   */
  async handleSaveEduGroup() {
    const teamId = this._eduGroupEditTeamId;
    const groupId = this._eduGroupEditId;
    const name = document.getElementById('edu-grp-name').value.trim();
    if (!name) { this.showToast('請輸入分組名稱'); return; }

    const ageMinRaw = document.getElementById('edu-grp-age-min').value.trim();
    const ageMaxRaw = document.getElementById('edu-grp-age-max').value.trim();
    const ageMin = ageMinRaw ? parseInt(ageMinRaw, 10) : null;
    const ageMax = ageMaxRaw ? parseInt(ageMaxRaw, 10) : null;

    if (ageMin != null && ageMax != null && ageMin > ageMax) {
      this.showToast('最小年齡不能大於最大年齡');
      return;
    }

    const data = {
      name,
      description: document.getElementById('edu-grp-desc').value.trim(),
      ageMin,
      ageMax,
      gender: document.getElementById('edu-grp-gender').value || 'all',
      schedule: document.getElementById('edu-grp-schedule').value.trim(),
      active: true,
    };

    try {
      if (groupId) {
        await FirebaseService.updateEduGroup(teamId, groupId, data);
        const cached = this._eduGroupsCache[teamId];
        if (cached) {
          const existing = cached.find(g => g.id === groupId);
          if (existing) Object.assign(existing, data);
        }
        this.showToast('分組已更新');
      } else {
        data.id = this._generateEduId('grp');
        data.memberCount = 0;
        data.sortOrder = (this.getEduGroups(teamId).length + 1) * 10;
        const result = await FirebaseService.createEduGroup(teamId, data);
        const cached = this._eduGroupsCache[teamId];
        if (cached) cached.push(result);
        else this._eduGroupsCache[teamId] = [result];
        this.showToast('分組已建立');
        // ★ 新建分組後自動匹配未分配的 pending 學員
        await this._reassignUnmatchedStudents(teamId, data);
      }
      this.closeModal();
      await this.renderEduGroupList(teamId);
    } catch (err) {
      console.error('[handleSaveEduGroup]', err);
      this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
    }
  },

});
