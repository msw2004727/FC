/* ================================================
   SportHub — Team: Role Demotion Preview & Auto Upgrade/Downgrade
   從 team-form.js 抽出（Phase 4 §10.1）
   依賴：config.js, api-service.js, team-form.js (_teamFormState),
         team-list-helpers.js (_applyRoleChange)
   ================================================ */

Object.assign(App, {

  /**
   * 編輯模式下，預覽被移除成員的角色變更並詢問確認。
   * @param {Object} vals - _extractTeamFormValues() 的回傳值
   * @returns {boolean} true=繼續儲存, false=使用者取消
   */
  async _confirmTeamRoleDemotions(vals) {
    const { captainUidForSave, oldCaptainUid, oldCoachUids, newCoachUids, oldLeaderUids, realLeaderUids, users } = vals;
    const newCaptainUidCheck = captainUidForSave || oldCaptainUid;

    // 預覽移除職位後的新角色（不實際修改）
    const previewNewRole = (uid) => {
      const u = users.find(u => u.uid === uid);
      if (!u) return null;
      if ((ROLE_LEVEL_MAP[u.role] || 0) >= ROLE_LEVEL_MAP['venue_owner']) return null;
      let highestTeamLevel = 0;
      ApiService.getTeams().forEach(t => {
        if (t.id === this._teamFormState.editId) return;
        if (t.captainUid === uid || t.captain === u.name) {
          highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['captain']);
        }
        if ((t.coaches || []).includes(u.name)) {
          highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['coach']);
        }
        const tLeaderUids = t.leaderUids || (t.leaderUid ? [t.leaderUid] : []);
        if (tLeaderUids.includes(uid)) {
          highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['coach']);
        }
      });
      const manualLevel = ROLE_LEVEL_MAP[u.manualRole] || 0;
      const targetLevel = Math.max(highestTeamLevel, manualLevel);
      const levelToRole = Object.entries(ROLE_LEVEL_MAP).reduce((m, [k, v]) => { m[v] = k; return m; }, {});
      return levelToRole[targetLevel] || 'user';
    };

    const demotionInfo = [];
    if (oldCaptainUid && oldCaptainUid !== newCaptainUidCheck) {
      const u = users.find(u => u.uid === oldCaptainUid);
      if (u) {
        const newRole = previewNewRole(oldCaptainUid);
        if (newRole && newRole !== u.role) {
          demotionInfo.push({ name: u.name, oldLabel: ROLES[u.role]?.label || u.role, newLabel: ROLES[newRole]?.label || newRole });
        }
      }
    }
    oldCoachUids.forEach(uid => {
      if (!newCoachUids.includes(uid)) {
        const u = users.find(u => u.uid === uid);
        if (u) {
          const newRole = previewNewRole(uid);
          if (newRole && newRole !== u.role) {
            demotionInfo.push({ name: u.name, oldLabel: ROLES[u.role]?.label || u.role, newLabel: ROLES[newRole]?.label || newRole });
          }
        }
      }
    });
    oldLeaderUids.forEach(uid => {
      if (!realLeaderUids.includes(uid)) {
        const u = users.find(u => u.uid === uid);
        if (u) {
          const newRole = previewNewRole(uid);
          if (newRole && newRole !== u.role) {
            demotionInfo.push({ name: u.name, oldLabel: ROLES[u.role]?.label || u.role, newLabel: ROLES[newRole]?.label || newRole });
          }
        }
      }
    });

    if (demotionInfo.length > 0) {
      const table = demotionInfo.map(d => `  ${d.name}：${d.oldLabel} → ${d.newLabel}`).join('\n');
      return await this.appConfirm(`以下成員將被移除職位，角色將自動調整：\n\n${table}\n\n確定要儲存？`);
    }
    return true;
  },

  /**
   * 儲存成功後，自動升降級 + 發送通知。
   * @param {Object} vals - _extractTeamFormValues() 的回傳值
   * @param {string} teamName - 俱樂部名稱
   */
  _applyTeamRoleChangesAfterSave(vals, teamName) {
    const { oldCaptainUid, oldCoachUids, oldLeaderUids, realLeaderUids, newCoachUids } = vals;
    const allUsers = ApiService.getAdminUsers();

    // ── 自動升級俱樂部經理 ──
    if (this._teamFormState.captain) {
      const capUser = allUsers.find(u => u.uid === this._teamFormState.captain);
      if (capUser && (ROLE_LEVEL_MAP[capUser.role] || 0) < ROLE_LEVEL_MAP['captain']) {
        const oldRole = capUser.role;
        ApiService.promoteUser(capUser.name, 'captain');
        this._sendNotifFromTemplate('role_upgrade', {
          userName: capUser.name, roleName: ROLES['captain'].label,
        }, capUser.uid, 'private', '私訊');
        ApiService._writeOpLog('role', '角色變更', `${capUser.name} 自動晉升為「${ROLES['captain'].label}」（原：${ROLES[oldRole]?.label || oldRole}）`);
      }
    }

    // ── 新領隊自動升至 coach 等級 ──
    realLeaderUids.forEach(uid => {
      if (!oldLeaderUids.includes(uid)) {
        const leaderUser = allUsers.find(u => u.uid === uid);
        if (leaderUser && (ROLE_LEVEL_MAP[leaderUser.role] || 0) < ROLE_LEVEL_MAP['coach']) {
          const oldRole = leaderUser.role;
          ApiService.promoteUser(leaderUser.name, 'coach');
          this._sendNotifFromTemplate('role_upgrade', {
            userName: leaderUser.name, roleName: ROLES['coach'].label,
          }, leaderUser.uid, 'private', '私訊');
          ApiService._writeOpLog('role', '角色變更', `${leaderUser.name} 自動晉升為「${ROLES['coach'].label}」（原：${ROLES[oldRole]?.label || oldRole}）`);
        }
      }
    });

    // ── 教練自動升級 ──
    this._teamFormState.coaches.forEach(uid => {
      const coachUser = allUsers.find(u => u.uid === uid);
      if (coachUser && (ROLE_LEVEL_MAP[coachUser.role] || 0) < ROLE_LEVEL_MAP['coach']) {
        const oldRole = coachUser.role;
        ApiService.promoteUser(coachUser.name, 'coach');
        this._sendNotifFromTemplate('role_upgrade', {
          userName: coachUser.name, roleName: ROLES['coach'].label,
        }, coachUser.uid, 'private', '私訊');
        ApiService._writeOpLog('role', '角色變更', `${coachUser.name} 自動晉升為「${ROLES['coach'].label}」（原：${ROLES[oldRole]?.label || oldRole}）`);
      }
    });

    // ── 俱樂部職位指派通知 ──
    if (this._teamFormState.captain) {
      const isNewCaptain = !oldCaptainUid || oldCaptainUid !== this._teamFormState.captain;
      if (isNewCaptain) {
        this._deliverMessageWithLinePush(
          '俱樂部職位指派',
          `您已被設為「${teamName}」的俱樂部經理。`,
          'system', '系統', this._teamFormState.captain, '系統', null,
          { lineOptions: { source: 'team_role_assignment:captain' } }
        );
      }
    }
    realLeaderUids.forEach(uid => {
      if (!oldLeaderUids.includes(uid)) {
        this._deliverMessageWithLinePush(
          '俱樂部職位指派',
          `您已被設為「${teamName}」的領隊。`,
          'system', '系統', uid, '系統', null,
          { lineOptions: { source: 'team_role_assignment:leader' } }
        );
      }
    });
    newCoachUids.forEach(uid => {
      if (!oldCoachUids.includes(uid)) {
        this._deliverMessageWithLinePush(
          '俱樂部職位指派',
          `您已被設為「${teamName}」的教練。`,
          'system', '系統', uid, '系統', null,
          { lineOptions: { source: 'team_role_assignment:coach' } }
        );
      }
    });

    // ── 自動降級：被移除的俱樂部經理/領隊/教練 ──
    if (this._teamFormState.editId) {
      const newCaptainUid = this._teamFormState.captain || oldCaptainUid;
      if (oldCaptainUid && oldCaptainUid !== newCaptainUid) {
        this._applyRoleChange(ApiService._recalcUserRole(oldCaptainUid));
      }
      oldCoachUids.forEach(uid => {
        if (!newCoachUids.includes(uid)) {
          this._applyRoleChange(ApiService._recalcUserRole(uid));
        }
      });
      oldLeaderUids.forEach(uid => {
        if (!realLeaderUids.includes(uid)) {
          this._applyRoleChange(ApiService._recalcUserRole(uid));
        }
      });
    }
  },

});
