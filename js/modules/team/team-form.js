/* ================================================
   SportHub — Team: Form Save (handleSaveTeam)
   依賴：team-form-join.js, team-form-init.js, team-form-search.js
   ================================================ */

Object.assign(App, {

  _teamEditId: null,
  _teamLeaderUids: [],
  _teamCaptainUid: null,
  _teamCoachUids: [],

  async handleSaveTeam() {
    const name = document.getElementById('ct-team-name').value.trim();
    const nameEn = document.getElementById('ct-team-name-en').value.trim();
    const nationality = document.getElementById('ct-team-nationality').value;
    const region = document.getElementById('ct-team-region').value;
    const founded = document.getElementById('ct-team-founded').value;
    const contact = document.getElementById('ct-team-contact').value.trim();
    const bio = document.getElementById('ct-team-bio').value.trim();

    if (!name) { this.showToast('請輸入俱樂部名稱'); return; }

    // ── 記錄舊職位（編輯模式用於降級檢查）──
    let oldCaptainUid = null;
    let oldCoachUids = [];
    let oldLeaderUids = [];
    if (this._teamEditId) {
      const oldTeam = ApiService.getTeam(this._teamEditId);
      if (oldTeam) {
        oldCaptainUid = (oldTeam.captainUid && !String(oldTeam.captainUid).startsWith('__legacy__'))
          ? oldTeam.captainUid
          : null;
        if (!oldCaptainUid && oldTeam.captain) {
          const capUser = ApiService.getAdminUsers().find(u => u.name === oldTeam.captain);
          oldCaptainUid = capUser ? capUser.uid : null;
        }
        (oldTeam.coaches || []).forEach(cName => {
          const cUser = ApiService.getAdminUsers().find(u => u.name === cName);
          if (cUser) oldCoachUids.push(cUser.uid);
        });
        // 舊領隊 uid 陣列
        oldLeaderUids = (oldTeam.leaderUids || (oldTeam.leaderUid ? [oldTeam.leaderUid] : [])).filter(Boolean);
      }
    }

    const users = ApiService.getAdminUsers();

    // 驗證領隊（新建：至少一位且非 legacy；編輯：允許保留）
    if (!this._teamEditId && this._teamLeaderUids.length === 0) {
      this.showToast('請選擇至少一位俱樂部領隊');
      return;
    }
    const realLeaderUids = this._teamLeaderUids.filter(uid => !uid.startsWith('__legacy__'));
    if (!this._teamEditId && realLeaderUids.length === 0) {
      this.showToast('俱樂部領隊必須為有效用戶，請重新選擇');
      return;
    }

    // 解析領隊名稱
    const leaderNames = this._teamLeaderUids.map(uid => {
      if (uid.startsWith('__legacy__')) return uid.replace('__legacy__', '');
      const u = users.find(u => u.uid === uid);
      return u ? u.name : '';
    }).filter(Boolean);

    // Resolve team manager (captain) name
    let captain = '';
    let selectedCaptainUser = null;
    if (this._teamCaptainUid) {
      if (this._teamCaptainUid === '__legacy__') {
        const t = this._teamEditId ? ApiService.getTeam(this._teamEditId) : null;
        captain = t ? t.captain : '';
      } else {
        selectedCaptainUser = users.find(u => u.uid === this._teamCaptainUid);
        captain = selectedCaptainUser ? selectedCaptainUser.name : '';
      }
    }

    if (!this._teamEditId) {
      if (!this._teamCaptainUid) {
        this.showToast('請設定俱樂部經理（必填）');
        return;
      }
      if (this._teamCaptainUid === '__legacy__' || !selectedCaptainUser) {
        this.showToast('俱樂部經理必須為有效用戶，請重新選擇');
        return;
      }
    } else if (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__' && !selectedCaptainUser) {
      this.showToast('俱樂部經理資料無效，請重新選擇俱樂部經理');
      return;
    }

    const captainUidForSave = (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__')
      ? this._teamCaptainUid
      : null;

    // Resolve coach names
    const coaches = this._teamCoachUids.map(uid => {
      if (uid.startsWith('__legacy_')) return uid.replace('__legacy_', '');
      const u = users.find(u => u.uid === uid);
      return u ? u.name : '';
    }).filter(Boolean);

    // 新教練 uid 集合（排除 legacy）
    const newCoachUids = this._teamCoachUids.filter(uid => !uid.startsWith('__legacy_'));

    // ── 降級確認（編輯模式：預覽被移除成員的角色變更）──
    if (this._teamEditId) {
      const newCaptainUidCheck = captainUidForSave || oldCaptainUid;
      // 預覽移除職位後的新角色（不實際修改）
      const previewNewRole = (uid) => {
        const u = users.find(u => u.uid === uid);
        if (!u) return null;
        if ((ROLE_LEVEL_MAP[u.role] || 0) >= ROLE_LEVEL_MAP['venue_owner']) return null;
        let highestTeamLevel = 0;
        ApiService.getTeams().forEach(t => {
          if (t.id === this._teamEditId) return; // 排除正在編輯的俱樂部
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
      // 被移除的領隊
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
        if (!(await this.appConfirm(`以下成員將被移除職位，角色將自動調整：\n\n${table}\n\n確定要儲存？`))) return;
      }
    }

    const leaderUidCompat = realLeaderUids[0] || null;
    const leaderCompat = leaderNames[0] || '';
    const nextTeamId = this._teamEditId || generateId('tm_');
    const teamForMemberCount = {
      ...(this._teamEditId ? (ApiService.getTeam(this._teamEditId) || {}) : {}),
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
      if (this._teamEditId) {
        const updates = {
          name, nameEn, nationality, region, founded, contact, bio,
          leader: leaderCompat, leaderUid: leaderUidCompat,
          leaders: leaderNames, leaderUids: realLeaderUids,
          captain, captainUid: captainUidForSave,
          coaches, members,
          type: teamType,
        };
        if (eduSettings) updates.eduSettings = eduSettings;
        else updates.eduSettings = firebase.firestore.FieldValue.delete();
        if (image) updates.image = image;
        ApiService.updateTeam(this._teamEditId, updates);
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
          captain, captainUid: captainUidForSave,
          coaches, members,
          region, founded, contact, bio, image,
          active: true, pinned: false, pinOrder: 0,
          wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
          history: [],
          type: teamType,
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
      ApiService._writeErrorLog({ fn: '_saveTeam', teamId: this._teamEditId }, err);
      return;
    }

    // ── 自動升級俱樂部經理/領隊/教練權限 + 發送通知 ──
    const allUsers = ApiService.getAdminUsers();
    if (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') {
      const capUser = allUsers.find(u => u.uid === this._teamCaptainUid);
      if (capUser && (ROLE_LEVEL_MAP[capUser.role] || 0) < ROLE_LEVEL_MAP['captain']) {
        const oldRole = capUser.role;
        ApiService.promoteUser(capUser.name, 'captain');
        this._sendNotifFromTemplate('role_upgrade', {
          userName: capUser.name, roleName: ROLES['captain'].label,
        }, capUser.uid, 'private', '私訊');
        ApiService._writeOpLog('role', '角色變更', `${capUser.name} 自動晉升為「${ROLES['captain'].label}」（原：${ROLES[oldRole]?.label || oldRole}）`);
      }
    }
    // 新領隊自動升至 coach 等級
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
    this._teamCoachUids.forEach(uid => {
      if (uid.startsWith('__legacy_')) return;
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
    if (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') {
      const isNewCaptain = !oldCaptainUid || oldCaptainUid !== this._teamCaptainUid;
      if (isNewCaptain) {
        this._deliverMessageWithLinePush(
          '俱樂部職位指派',
          `您已被設為「${name}」的俱樂部經理。`,
          'system', '系統', this._teamCaptainUid, '系統', null,
          { lineOptions: { source: 'team_role_assignment:captain' } }
        );
      }
    }
    realLeaderUids.forEach(uid => {
      if (!oldLeaderUids.includes(uid)) {
        this._deliverMessageWithLinePush(
          '俱樂部職位指派',
          `您已被設為「${name}」的領隊。`,
          'system', '系統', uid, '系統', null,
          { lineOptions: { source: 'team_role_assignment:leader' } }
        );
      }
    });
    newCoachUids.forEach(uid => {
      if (!oldCoachUids.includes(uid)) {
        this._deliverMessageWithLinePush(
          '俱樂部職位指派',
          `您已被設為「${name}」的教練。`,
          'system', '系統', uid, '系統', null,
          { lineOptions: { source: 'team_role_assignment:coach' } }
        );
      }
    });

    // ── 自動降級：被移除的俱樂部經理/領隊/教練 ──
    if (this._teamEditId) {
      const newCaptainUid = (this._teamCaptainUid && this._teamCaptainUid !== '__legacy__') ? this._teamCaptainUid : oldCaptainUid;
      // 舊俱樂部經理不再是新俱樂部經理 → recalc
      if (oldCaptainUid && oldCaptainUid !== newCaptainUid) {
        this._applyRoleChange(ApiService._recalcUserRole(oldCaptainUid));
      }
      // 被移除的教練 → recalc
      oldCoachUids.forEach(uid => {
        if (!newCoachUids.includes(uid)) {
          this._applyRoleChange(ApiService._recalcUserRole(uid));
        }
      });
      // 被移除的領隊 → recalc
      oldLeaderUids.forEach(uid => {
        if (!realLeaderUids.includes(uid)) {
          this._applyRoleChange(ApiService._recalcUserRole(uid));
        }
      });
    }

    this.closeModal();
    this._teamEditId = null;
    this.renderTeamList();
    this.renderAdminTeams();
    this.renderTeamManage();
  },

});
