/* ================================================
   SportHub — Team: Role Demotion Preview & Auto Upgrade/Downgrade
   從 team-form.js 抽出（Phase 4 §10.1）
   依賴：config.js, api-service.js, team-form.js (_teamFormState),
         team-list-helpers.js (_applyRoleChange)
   ================================================ */

Object.assign(App, {

  /**
   * Editing a club manager is a single-seat transfer, not a multi-select staff edit.
   * Confirm explicitly so the current manager does not accidentally transfer ownership.
   * @param {Object} vals - _extractTeamFormValues() result
   * @returns {boolean} true=continue save, false=cancel save
   */
  async _confirmTeamManagerTransfer(vals) {
    if (!vals) return true;
    const { captainUidForSave, oldCaptainUid, captain, users = [] } = vals;
    const oldUid = String(oldCaptainUid || '').trim();
    const newUid = String(captainUidForSave || oldUid || '').trim();
    if (!oldUid || !newUid || oldUid === newUid) return true;

    const findUser = (uid) => users.find(u => u && (u.uid === uid || u._docId === uid || u.id === uid));
    const oldUser = findUser(oldUid);
    const newUser = findUser(newUid);
    const oldName = oldUser?.name || oldUser?.displayName || '原俱樂部經理';
    const newName = captain || newUser?.name || newUser?.displayName || '新俱樂部經理';

    return await this.appConfirm(
      `確定要轉移俱樂部經理嗎？\n\n` +
      `目前經理：${oldName}\n` +
      `新的經理：${newName}\n\n` +
      `注意：\n` +
      `- 俱樂部經理只能有一位，不是可複選的領隊欄位。\n` +
      `- 儲存後，新的經理會取得俱樂部管理權限。\n` +
      `- 原經理可能失去此俱樂部管理權限，除非仍保留領隊、教練或其他管理身份。\n\n` +
      `確定要儲存這次經理轉移？`
    );
  },

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
        if (t.captainUid === uid) {
          highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['captain']);
        }
        if (Array.isArray(t.coachUids) && t.coachUids.includes(uid)) {
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
  async _applyTeamRoleChangesAfterSave(vals, teamName) {
    const {
      editId,
      teamId,
      oldCaptainUid,
      oldCoachUids,
      oldLeaderUids,
      realLeaderUids,
      newCoachUids,
      captainUid,
      coachUids,
    } = vals;
    const allUsers = [
      ...(ApiService.getUserDirectory?.() || []),
      ...(ApiService.getAdminUsers?.() || []),
    ];
    const findUserByUid = uid => allUsers.find(user => (
      String(user?.uid || user?.lineUserId || '').trim() === String(uid || '').trim()
    ));
    const requestedRoleRecalculations = new Set();
    const roleRecalculationRequests = [];
    const requestRoleRecalculation = (uid) => {
      const safeUid = String(uid || '').trim();
      if (!safeUid || requestedRoleRecalculations.has(safeUid)) return;
      requestedRoleRecalculations.add(safeUid);
      roleRecalculationRequests.push(
        Promise.resolve(ApiService.promoteUserByUid(safeUid, { teamId }))
          .then(result => ({ uid: safeUid, result }))
      );
    };

    // ── 自動升級俱樂部經理 ──
    if (captainUid) {
      requestRoleRecalculation(captainUid);
    }

    // ── 新領隊自動升至 coach 等級 ──
    realLeaderUids.forEach(uid => {
      if (!oldLeaderUids.includes(uid)) {
        requestRoleRecalculation(uid);
      }
    });

    // ── 教練自動升級 ──
    coachUids.forEach(uid => {
      requestRoleRecalculation(uid);
    });

    // ── 俱樂部職位指派通知 ──
    if (captainUid) {
      const isNewCaptain = !oldCaptainUid || oldCaptainUid !== captainUid;
      if (isNewCaptain) {
        this._deliverMessageWithLinePush(
          '俱樂部職位指派',
          `您已被設為「${teamName}」的俱樂部經理。`,
          'system', '系統', captainUid, '系統', null,
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
    if (editId) {
      const newCaptainUid = captainUid || oldCaptainUid;
      if (oldCaptainUid && oldCaptainUid !== newCaptainUid) {
        requestRoleRecalculation(oldCaptainUid);
      }
      oldCoachUids.forEach(uid => {
        if (!newCoachUids.includes(uid)) {
          requestRoleRecalculation(uid);
        }
      });
      oldLeaderUids.forEach(uid => {
        if (!realLeaderUids.includes(uid)) {
          requestRoleRecalculation(uid);
        }
      });
    }

    const results = await Promise.allSettled(roleRecalculationRequests);
    const completed = results
      .filter(item => item.status === 'fulfilled' && item.value?.result)
      .map(item => item.value);
    completed.forEach(({ uid, result }) => {
      const oldLevel = ROLE_LEVEL_MAP[result.oldRole] || 0;
      const newLevel = ROLE_LEVEL_MAP[result.newRole] || 0;
      if (!result.newRole || newLevel <= oldLevel) return;
      const user = findUserByUid(uid);
      if (!user) return;
      const roleName = ROLES[result.newRole]?.label || result.newRole;
      this._sendNotifFromTemplate('role_upgrade', {
        userName: user.name, roleName,
      }, uid, 'private', '私訊');
      ApiService._writeOpLog(
        'role',
        '角色變更',
        `${user.name} 自動晉升為「${roleName}」（原：${ROLES[result.oldRole]?.label || result.oldRole}）`
      );
    });
    const failed = results.length - completed.length;
    return { ok: failed === 0, failed };
  },

});
