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
    staffNameHints: {},
    unresolvedStaffNames: { leaders: [], captain: '', coaches: [] },
  },
  _teamFormSubmitCounter: 0,
  _teamFormSubmitToken: null,

  _getTeamFormSubmitSignature() {
    const modal = document.getElementById('create-team-modal');
    const fields = typeof modal?.querySelectorAll === 'function'
      ? Array.from(modal.querySelectorAll('input, select, textarea')).map((field) => ({
        id: field.id || '',
        name: field.name || '',
        type: field.type || '',
        value: field.multiple
          ? Array.from(field.selectedOptions || []).map(option => String(option.value || ''))
          : (field.type === 'checkbox' || field.type === 'radio'
            ? !!field.checked
            : String(field.value || '')),
      }))
      : [];
    const preview = document.getElementById('ct-team-preview');
    const previewImage = preview?.querySelector?.('img')?.src || preview?.style?.backgroundImage || '';
    return JSON.stringify({
      fields,
      staff: [
        [...(this._teamFormState.leaders || [])],
        this._teamFormState.captain || null,
        [...(this._teamFormState.coaches || [])],
      ],
      previewImage,
      imageVariants: this._teamImageVariantsData || null,
    });
  },

  _beginTeamFormSubmit() {
    if (this._teamFormSubmitToken != null) return null;
    const token = ++this._teamFormSubmitCounter;
    const context = {
      token,
      requestSeq: Number(this._teamFormRequestSeq || 0),
      editId: String(this._teamFormState.editId || ''),
      authUid: String(ApiService.getCurrentUser?.()?.uid || ''),
      signature: this._getTeamFormSubmitSignature(),
    };
    this._teamFormSubmitToken = token;
    const modal = document.getElementById('create-team-modal');
    if (modal) {
      modal.inert = true;
      modal.setAttribute?.('aria-busy', 'true');
    }
    return context;
  },

  _isTeamFormSubmitSessionCurrent(context) {
    if (!context || this._teamFormSubmitToken !== context.token) return false;
    if (Number(this._teamFormRequestSeq || 0) !== context.requestSeq) return false;
    if (String(this._teamFormState.editId || '') !== context.editId) return false;
    if (String(ApiService.getCurrentUser?.()?.uid || '') !== context.authUid) return false;
    const modal = document.getElementById('create-team-modal');
    return !modal || !!modal.classList?.contains('open');
  },

  _isTeamFormSubmitCurrent(context) {
    return this._isTeamFormSubmitSessionCurrent(context)
      && this._getTeamFormSubmitSignature() === context.signature;
  },

  async handleSaveTeam() {
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料（建立/編輯俱樂部屬於寫入行為）
    if (this._requireProfileComplete()) return;
    const vals = this._extractTeamFormValues();
    if (!vals) return;

    const { name, nameEn, nationality, region, founded, contact, bio,
            contactLinksEnabled, contactLinks,
            oldCaptainUid, oldCoachUids, oldLeaderUids,
            realLeaderUids, leaderNames, captain, captainUidForSave,
            coaches, newCoachUids, users } = vals;

    if (this._teamFormState.editId) {
      const targetTeam = ApiService.getTeam?.(this._teamFormState.editId);
      if (!targetTeam || !this._canEditTeamByRoleOrCaptain?.(targetTeam)) {
        this.showToast('\u6b0a\u9650\u4e0d\u8db3');
        return;
      }
    }

    // ── 降級確認（編輯模式)── 必須在 loading wrapper 前(用戶取消 confirm 不該顯示 loading)
    const isEditMode = !!this._teamFormState.editId;
    const sportTag = document.getElementById('ct-team-sport-tag')?.value || '';
    const rawTeamType = document.getElementById('ct-team-type')?.value || 'competitive';
    const teamType = typeof this._normalizeTeamCategory === 'function'
      ? this._normalizeTeamCategory(rawTeamType)
      : (rawTeamType === 'none' ? 'none' : (rawTeamType === 'education' ? 'education' : 'competitive'));
    const isTeachingType = teamType === 'education';
    const eduSettings = isTeachingType ? {
      acceptingStudents: document.getElementById('ct-edu-accepting')?.checked !== false,
      teachingEnabled: true,
    } : null;
    const preview = document.getElementById('ct-team-preview');
    let image = null;
    const imgEl = preview?.querySelector?.('img');
    if (imgEl) {
      image = imgEl.src;
    } else {
      const bgImg = preview?.style?.backgroundImage;
      if (bgImg && bgImg !== 'none' && bgImg !== '') {
        image = bgImg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
      }
    }
    const imageVariants = (this._teamImageVariantsData && typeof this._teamImageVariantsData === 'object')
      ? { ...this._teamImageVariantsData }
      : null;
    if (imageVariants && (imageVariants.cover || imageVariants.card)) {
      image = imageVariants.cover || imageVariants.card || image;
    }

    const submitContext = this._beginTeamFormSubmit();
    if (!submitContext) return;
    const submitPromise = this._withButtonLoading(
      '#ct-team-save-btn',
      isEditMode ? '\u5132\u5b58\u4e2d...' : '\u5efa\u7acb\u4e2d...',
      async () => {
        if (!this._isTeamFormSubmitCurrent(submitContext)) return { ok: false, reason: 'stale' };
        if (isEditMode) {
          if (typeof this._confirmTeamManagerTransfer === 'function'
            && !await this._confirmTeamManagerTransfer(vals)) return { ok: false, reason: 'cancelled' };
          if (!this._isTeamFormSubmitCurrent(submitContext)) return { ok: false, reason: 'stale' };
          if (!await this._confirmTeamRoleDemotions(vals)) return { ok: false, reason: 'cancelled' };
          if (!this._isTeamFormSubmitCurrent(submitContext)) return { ok: false, reason: 'stale' };
        }
    const resolvedStaffUids = Array.from(new Set([
      ...realLeaderUids,
      captainUidForSave,
      ...newCoachUids,
    ].map(value => String(value || '').trim()).filter(Boolean)));
    if (resolvedStaffUids.length > 0) {
      let verification = null;
      let verificationError = '';
      try {
        if (typeof ApiService.verifyUserDirectorySelection !== 'function') {
          throw new Error('USER_DIRECTORY_VERIFICATION_UNAVAILABLE');
        }
        verification = await ApiService.verifyUserDirectorySelection(resolvedStaffUids);
      } catch (err) {
        verificationError = err?.message || 'unavailable';
      }
      if (!this._isTeamFormSubmitCurrent(submitContext)) {
        return { ok: false, reason: 'stale' };
      }

      const verifiedIds = new Set();
      (Array.isArray(verification?.users) ? verification.users : []).forEach(user => {
        const uid = String(user?.uid || '').trim();
        const docId = String(user?._docId || '').trim();
        if (uid) verifiedIds.add(uid);
        if (docId) verifiedIds.add(docId);
      });
      const reportedMissing = new Set(
        (Array.isArray(verification?.missingUids) ? verification.missingUids : [])
          .map(value => String(value || '').trim())
      );
      const missingUids = resolvedStaffUids.filter(uid => reportedMissing.has(uid) || !verifiedIds.has(uid));
      if (verificationError || !verification?.ok || missingUids.length > 0) {
        this.showToast?.('\u7121\u6cd5\u78ba\u8a8d\u4eba\u54e1\u8cc7\u6599\uff0c\u8acb\u91cd\u65b0\u641c\u5c0b\u5f8c\u518d\u8a66');
        return { ok: false, reason: verificationError || verification?.reason || 'missing-user' };
      }
    }
    const leaderUidCompat = realLeaderUids[0] || null;
    const leaderCompat = leaderNames[0] || '';
    const nextTeamId = submitContext.editId || generateId('tm_');
    const roleChangeContext = {
      editId: submitContext.editId,
      teamId: nextTeamId,
      oldCaptainUid,
      oldCoachUids: [...oldCoachUids],
      oldLeaderUids: [...oldLeaderUids],
      realLeaderUids: [...realLeaderUids],
      newCoachUids: [...newCoachUids],
      captainUid: captainUidForSave,
      coachUids: [...newCoachUids],
    };
    const teamForMemberCount = {
      ...(isEditMode ? (ApiService.getTeam(submitContext.editId) || {}) : {}),
      id: nextTeamId,
      captain,
      captainUid: captainUidForSave,
      leader: leaderCompat,
      leaderUid: leaderUidCompat,
      leaders: leaderNames,
      leaderUids: realLeaderUids,
      coaches,
    };
    const members = (!isEditMode && typeof this._calcTeamMemberCountByTeam === 'function')
      ? this._calcTeamMemberCountByTeam(teamForMemberCount, users)
      : 0;

    // ── 運動類型 ──
    let staleAfterWrite = false;
    try {
      if (!isEditMode) {
        image = await this._resolveTeamCoverImage(image);
        if (!this._isTeamFormSubmitCurrent(submitContext)) {
          return { ok: false, reason: 'stale' };
        }
      }
      // leader/leaderUid 相容欄位（舊格式）
      if (isEditMode) {
        const updates = {
          name, nameEn, nationality, region, founded, contact, bio,
          contactLinksEnabled, contactLinks,
          leader: leaderCompat, leaderUid: leaderUidCompat,
          leaders: leaderNames, leaderUids: realLeaderUids, leaderNames,
          captain, captainUid: captainUidForSave, captainName: captain,
          coaches, coachUids: newCoachUids, coachNames: coaches,
          type: teamType, sportTag, teachingEnabled: isTeachingType,
        };
        if (eduSettings) updates.eduSettings = eduSettings;
        else updates.eduSettings = firebase.firestore.FieldValue.delete();
        if (imageVariants) updates.imageVariants = imageVariants;
        if (image) updates.image = image;
        try {
          await ApiService.updateTeamAwait(submitContext.editId, updates);
          staleAfterWrite = !this._isTeamFormSubmitSessionCurrent(submitContext);
        } catch (err) {
          if (this._isTeamFormSubmitSessionCurrent(submitContext) && !err?._toasted) {
            this.showToast('俱樂部更新失敗，請重試');
          }
          ApiService._writeErrorLog({ fn: 'handleSaveTeam.updateTeamAwait', teamId: submitContext.editId, mode: 'edit' }, err);
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
          contactLinksEnabled, contactLinks,
          active: true, pinned: false, pinOrder: 0,
          wins: 0, draws: 0, losses: 0, gf: 0, ga: 0,
          history: [],
          type: teamType, sportTag, teachingEnabled: isTeachingType,
        };
        if (eduSettings) data.eduSettings = eduSettings;
        if (imageVariants) data.imageVariants = imageVariants;
        const createdTeam = await ApiService.createTeamAwait(data);
        if (!createdTeam) return { ok: false, reason: 'create-blocked' };
        staleAfterWrite = !this._isTeamFormSubmitSessionCurrent(submitContext);
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
      }
    } catch (err) {
      console.error('[handleSaveTeam]', err);
      if (this._isTeamFormSubmitSessionCurrent(submitContext) && !err?._toasted) {
        this.showToast('儲存失敗：' + (err.message || '請稍後再試'));
      }
      ApiService._writeErrorLog({ fn: '_saveTeam', teamId: submitContext.editId }, err);
      return;
    }

    // ── 自動升降級 + 職位通知（委派 team-form-roles.js）──
    const roleSyncResult = await this._applyTeamRoleChangesAfterSave(roleChangeContext, name);
    if (staleAfterWrite || !this._isTeamFormSubmitSessionCurrent(submitContext)) {
      return { ok: true, reason: 'stale-after-write' };
    }
    this.showToast(roleSyncResult?.ok === false
      ? '俱樂部已儲存，但角色同步尚未完成，請稍後再儲存一次'
      : (isEditMode ? '俱樂部資料已更新' : '俱樂部建立成功！'));

    const savedTeamId = submitContext.editId || nextTeamId;
    const shouldRefreshCurrentDetail = isEditMode
      && savedTeamId
      && this._teamDetailId === savedTeamId
      && this.currentPage === 'page-team-detail'
      && typeof this.showTeamDetail === 'function';

    this.closeModal({ allowSubmitting: true });
    this._teamFormState.editId = null;
    this._teamImageVariantsData = null;
    this.renderTeamList();
    this.renderAdminTeams();
    this.renderTeamManage();
    if (shouldRefreshCurrentDetail) {
      await this.showTeamDetail(savedTeamId, { skipPageHistory: true, bypassPageLock: true });
    }
    },
    {
      shouldRestore: () => this._teamFormSubmitToken === submitContext.token,
    });
    return Promise.resolve(submitPromise).finally(() => {
      if (this._teamFormSubmitToken === submitContext.token) {
        this._teamFormSubmitToken = null;
        const modal = document.getElementById('create-team-modal');
        if (modal) {
          modal.inert = false;
          modal.removeAttribute?.('aria-busy');
        }
      }
    });
  },

});
