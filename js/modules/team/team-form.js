/* ================================================
   SportHub — Team: Form Save (handleSaveTeam)
   Phase 4 §10.1 瘦身：驗證→team-form-validate.js、角色→team-form-roles.js
   依賴：team-form-validate.js, team-form-roles.js,
         team-form-join.js, team-form-init.js, team-form-search.js
   ================================================ */

Object.assign(App, {

  // ── Team Form State（全域狀態集中管理）──
  _teamFormState: {
    editId: null,
    leaders: [],
    captain: null,
    coaches: [],
  },

  async handleSaveTeam() {
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料（建立/編輯俱樂部屬於寫入行為）
    if (this._requireProfileComplete()) return;
    const vals = this._extractTeamFormValues();
    if (!vals) return;

    const { name, nameEn, nationality, region, founded, contact, bio,
            oldCaptainUid, oldCoachUids, oldLeaderUids,
            realLeaderUids, leaderNames, captain, captainUidForSave,
            coaches, newCoachUids, users } = vals;

    // ── 降級確認（編輯模式）──
    if (this._teamFormState.editId) {
      if (!(await this._confirmTeamRoleDemotions(vals))) return;
    }

    const leaderUidCompat = realLeaderUids[0] || null;
    const leaderCompat = leaderNames[0] || '';
    const nextTeamId = this._teamFormState.editId || generateId('tm_');
    const teamForMemberCount = {
      ...(this._teamFormState.editId ? (ApiService.getTeam(this._teamFormState.editId) || {}) : {}),
      id: nextTeamId,
      captain,
      captainUid: captainUidForSave,
      leader: leaderCompat,
      leaderUid: leaderUidCompat,
      leaders: leaderNames,
      leaderUids: realLeaderUids,
      coaches,
    };
    const members = (typeof this._calcTeamMemberCountByTeam === 'function')
      ? this._calcTeamMemberCountByTeam(teamForMemberCount, users)
      : 0;

    // ── 運動類型 ──
    const sportTag = document.getElementById('ct-team-sport-tag')?.value || '';
    // ── 俱樂部類型 ──
    const teamType = document.getElementById('ct-team-type')?.value || 'general';
    const eduSettings = teamType === 'education' ? {
      acceptingStudents: document.getElementById('ct-edu-accepting')?.checked !== false,
    } : null;

    const preview = document.getElementById('ct-team-preview');
    let image = null;
    const imgEl = preview.querySelector('img');
    if (imgEl) {
      image = imgEl.src;
    } else {
      const bgImg = preview.style.backgroundImage;
      if (bgImg && bgImg !== 'none' && bgImg !== '') {
        image = bgImg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
      }
    }

    try {
      // leader/leaderUid 相容欄位（舊格式）
      if (this._teamFormState.editId) {
        const updates = {
          name, nameEn, nationality, region, founded, contact, bio,
          leader: leaderCompat, leaderUid: leaderUidCompat,
          leaders: leaderNames, leaderUids: realLeaderUids, leaderNames,
          captain, captainUid: captainUidForSave, captainName: captain,
          coaches, coachUids: newCoachUids, coachNames: coaches,
          members,
          type: teamType, sportTag,
        };
        if (eduSettings) updates.eduSettings = eduSettings;
        else updates.eduSettings = firebase.firestore.FieldValue.delete();
        if (image) updates.image = image;
        try {
          await ApiService.updateTeamAwait(this._teamFormState.editId, updates);
        } catch (err) {
          if (!err?._toasted) this.showToast('俱樂部更新失敗，請重試');
          return;
        }
        ApiService._writeOpLog('team_edit', '編輯俱樂部', `編輯「${name}」`);
        // ── 俱樂部職位變更日誌 ──
        const newCapUid = captainUidForSave;
        if (oldCaptainUid && newCapUid && oldCaptainUid !== newCapUid) {
          const oldCapName = users.find(u => u.uid === oldCaptainUid)?.name || '?';
          ApiService._writeOpLog('team_position', '俱樂部職位變更', `「${name}」俱樂部經理由「${oldCapName}」轉移至「${captain}」`);
        } else if (!oldCaptainUid && newCapUid) {
          ApiService._writeOpLog('team_position', '俱樂部職位變更', `設定「${captain}」為「${name}」俱樂部經理`);
        }
        // 領隊異動日誌
        realLeaderUids.forEach(uid => {
          if (!oldLeaderUids.includes(uid)) {
            const lName = users.find(u => u.uid === uid)?.name || '?';
            ApiService._writeOpLog('team_position', '俱樂部職位變更', `新增「${lName}」為「${name}」領隊`);
          }
        });
        oldLeaderUids.forEach(uid => {
          if (!realLeaderUids.includes(uid)) {
            const lName = users.find(u => u.uid === uid)?.name || '?';
            ApiService._writeOpLog('team_position', '俱樂部職位變更', `移除「${lName}」的「${name}」領隊職位`);
          }
        });
        newCoachUids.forEach(uid => {
          if (!oldCoachUids.includes(uid)) {
            const cName = users.find(u => u.uid === uid)?.name || '?';
            ApiService._writeOpLog('team_position', '俱樂部職位變更', `新增「${cName}」為「${name}」教練`);
          }
        });
        oldCoachUids.forEach(uid => {
          if (!newCoachUids.includes(uid)) {
            const cName = users.find(u => u.uid === uid)?.name || '?';
            ApiService._writeOpLog('team_position', '俱樂部職位變更', `移除「${cName}」的「${name}」教練職位`);
          }
        });
        this.showToast('俱樂部資料已更新');
      } else {
        const data = {
          id: nextTeamId,
          name, nameEn, nationality,
          leader: leaderCompat, leaderUid: leaderUidCompat,
          leaders: leaderNames, leaderUids: realLeaderUids,
          captain, captainUid: captainUidForSave, captainName: captain,
          coaches, coachUids: newCoachUids, coachNames: coaches,
          leaderNames,
          members,
          region, founded, contact, bio, image,
          active: true, pinned: false, pinOrder: 0,
          wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
          history: [],
          type: teamType, sportTag,
        };
        if (eduSettings) data.eduSettings = eduSettings;
        ApiService.createTeam(data);
        ApiService._writeOpLog('team_create', '建立俱樂部', `建立「${name}」`);
        // ── 新建俱樂部職位日誌 ──
        if (captain) {
          ApiService._writeOpLog('team_position', '俱樂部職位變更', `設定「${captain}」為「${name}」俱樂部經理`);
        }
        leaderNames.forEach(l => {
          ApiService._writeOpLog('team_position', '俱樂部職位變更', `新增「${l}」為「${name}」領隊`);
        });
        coaches.forEach(c => {
          ApiService._writeOpLog('team_position', '俱樂部職位變更', `新增「${c}」為「${name}」教練`);
        });
        this.showToast('俱樂部建立成功！');
      }
    } catch (err) {
      console.error('[handleSaveTeam]', err);
      this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
      ApiService._writeErrorLog({ fn: '_saveTeam', teamId: this._teamFormState.editId }, err);
      return;
    }

    // ── 自動升降級 + 職位通知（委派 team-form-roles.js）──
    this._applyTeamRoleChangesAfterSave(vals, name);

    this.closeModal();
    this._teamFormState.editId = null;
    this.renderTeamList();
    this.renderAdminTeams();
    this.renderTeamManage();
  },

});
