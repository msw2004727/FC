/* ================================================
   SportHub — API Service 抽象層
   ================================================
   ModeManager.isDemo() = true  → 讀取 DemoData（Demo 演示）
   ModeManager.isDemo() = false → 讀取 FirebaseService._cache（正式版）

   切換方式：透過 ModeManager 統一管理
   App 層的渲染邏輯完全不需要改動。
   ================================================ */

const ApiService = {

  get _demoMode() { return ModeManager.isDemo(); },

  _isCurrentUserRestricted() {
    if (this._demoMode) return false;
    const user = this.getCurrentUser ? this.getCurrentUser() : null;
    return !!(user && user.isRestricted === true);
  },

  _handleRestrictedAction() {
    if (!this._isCurrentUserRestricted()) return false;
    try {
      if (typeof App !== 'undefined') {
        App.showToast?.('帳號限制中');
        App._handleRestrictedStateChange?.();
      }
    } catch (_) {}
    return true;
  },

  async _hasFreshFirebaseUser(forceRefreshToken = false) {
    if (typeof auth === 'undefined' || !auth) return false;
    // 等待 Firebase Auth 從持久化儲存恢復登入狀態（最多 5 秒）
    if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
      try {
        await Promise.race([
          _firebaseAuthReadyPromise,
          new Promise(r => setTimeout(r, 5000)),
        ]);
      } catch (_) {}
    }
    if (!auth.currentUser) return false;
    try {
      await auth.currentUser.getIdToken(!!forceRefreshToken);
      return true;
    } catch (err) {
      console.warn('[ApiService] Firebase token check failed:', err);
      return false;
    }
  },

  _hasLiffSession() {
    try {
      return typeof LineAuth !== 'undefined'
        && typeof LineAuth.hasLiffSession === 'function'
        && LineAuth.hasLiffSession();
    } catch (_) {
      return false;
    }
  },

  _hasLineAccessToken() {
    try {
      return typeof LineAuth !== 'undefined'
        && typeof LineAuth.getAccessToken === 'function'
        && !!LineAuth.getAccessToken();
    } catch (_) {
      return false;
    }
  },

  _logAttendanceAuthState(stage, err) {
    try {
      console.warn('[ApiService][AttendanceAuth]', {
        stage,
        authUid: (typeof auth !== 'undefined' && auth?.currentUser) ? auth.currentUser.uid : null,
        hasLiffSession: this._hasLiffSession(),
        hasLineAccessToken: this._hasLineAccessToken(),
        errorCode: err?.code || null,
        errorMessage: err?.message || String(err || ''),
      });
    } catch (_) {}
  },

  async _ensureFirebaseWriteAuth(options = {}) {
    const { forceRefreshToken = false, forceReauth = false } = options;
    if (this._demoMode) return true;

    if (!forceReauth && await this._hasFreshFirebaseUser(forceRefreshToken)) {
      return true;
    }

    console.warn('[ApiService] auth.currentUser 為空或 token 無效，嘗試重新登入...',
      { hasAuth: typeof auth !== 'undefined' && !!auth,
        currentUser: auth?.currentUser?.uid || null,
        liffLoggedIn: this._hasLiffSession(),
        hasAccessToken: this._hasLineAccessToken() });

    if (forceReauth && typeof auth !== 'undefined' && auth?.currentUser) {
      try {
        await auth.signOut();
      } catch (err) {
        console.warn('[ApiService] Firebase signOut before reauth failed:', err);
      }
    }

    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._signInWithAppropriateMethod === 'function') {
      try {
        await FirebaseService._signInWithAppropriateMethod();
      } catch (err) {
        console.warn('[ApiService] Firebase write auth retry failed:', err);
      }
    }

    const result = await this._hasFreshFirebaseUser(true);
    if (!result) {
      console.error('[ApiService] 重新登入後 auth.currentUser 仍為空',
        { currentUser: auth?.currentUser?.uid || null });
    }
    return result;
  },

  _isAttendancePermissionError(err) {
    const raw = String(err?.message || err || '').trim();
    const normalized = raw.toLowerCase().replace(/\s+/g, '');
    const code = String(err?.code || '').toLowerCase();
    return (
      normalized.includes('missingorinsufficientpermissions')
      || normalized.includes('permission-denied')
      || normalized.includes('insufficientpermissions')
      || normalized.includes('unauthenticated')
      || code.includes('permission-denied')
      || code.includes('unauthenticated')
    );
  },

  _mapAttendanceWriteError(err) {
    const raw = String(err?.message || err || '').trim();
    const normalized = raw.toLowerCase().replace(/\s+/g, '');
    if (this._isAttendancePermissionError(err)) {
      if (!this._hasLiffSession()) {
        return '未偵測到 LINE 登入\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員';
      }
      if (!this._hasLineAccessToken()) {
        return 'LINE 登入已過期\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員';
      }
      // auth.currentUser 存在但 Firestore 拒絕 vs 根本未登入
      const hasUser = typeof auth !== 'undefined' && !!auth?.currentUser;
      if (!hasUser) {
        return 'Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員';
      }
      return 'Firebase 權限不足\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員';
    }
    if (normalized.includes('missingrequiredfields')) {
      return '簽到資料格式錯誤\n缺少必要欄位，請重新操作\n若仍異常請聯繫管理員';
    }
    return raw || '簽到寫入失敗\n請稍後再試\n若仍異常請聯繫管理員';
  },

  async _runAttendanceWriteWithAuthRetry(writeFn, label) {
    if (this._demoMode) return await writeFn();

    // forceRefreshToken:false = 讀取本地快取 token（毫秒級），Firebase SDK 自動在背景維持 token 有效性
    // 只有 retry 路徑才強制刷新，避免每筆寫入都多一次 HTTP round-trip
    const authed = await this._ensureFirebaseWriteAuth({ forceRefreshToken: false });
    if (!authed) {
      this._logAttendanceAuthState(label + ':precheck_failed');
      throw new Error('unauthenticated');
    }

    try {
      return await writeFn();
    } catch (err) {
      if (!this._isAttendancePermissionError(err)) throw err;
      this._logAttendanceAuthState(label + ':first_attempt_denied', err);

      const reauthed = await this._ensureFirebaseWriteAuth({
        forceRefreshToken: true,
        forceReauth: true,
      });
      if (!reauthed) {
        this._logAttendanceAuthState(label + ':reauth_failed', err);
        throw err;
      }

      try {
        return await writeFn();
      } catch (retryErr) {
        this._logAttendanceAuthState(label + ':retry_denied', retryErr);
        throw retryErr;
      }
    }
  },

  // ════════════════════════════════
  //  通用工具方法（消除重複的 demo/production 分支）
  // ════════════════════════════════

  /** 取得資料來源陣列（安全：DemoData 未載入時降級為空陣列） */
  _src(key) {
    if (this._demoMode) {
      return (typeof DemoData !== 'undefined' && DemoData[key]) ? DemoData[key] : [];
    }
    return FirebaseService._cache[key] || [];
  },

  /** 根據 id 查找單筆資料 */
  _findById(key, id) {
    return this._src(key).find(item => item.id === id) || null;
  },

  _normalizeTournamentRecordForWrite(data, existing = null) {
    const merged = existing ? { ...existing, ...data } : { ...data };
    if (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentRecord === 'function') {
      return App._buildFriendlyTournamentRecord(merged);
    }
    return merged;
  },

  _getDemoTournamentFriendlyArray(tournamentId, field) {
    const tournament = this.getTournament(tournamentId);
    if (!tournament) throw new Error('TOURNAMENT_NOT_FOUND');
    if (!Array.isArray(tournament[field])) tournament[field] = [];
    return tournament[field];
  },

  /** 通用新增：寫入快取 + 非同步寫入 Firebase */
  _create(key, data, firebaseMethod, label, prepend) {
    if (this._handleRestrictedAction()) return null;
    const source = this._src(key);
    if (prepend !== false) { source.unshift(data); } else { source.push(data); }
    if (!this._demoMode && firebaseMethod) {
      FirebaseService.ensureAuthReadyForWrite()
        .then(() => firebaseMethod.call(FirebaseService, data))
        .catch(err => console.error(`[${label}]`, err));
    }
    return data;
  },

  async _createAwaitWrite(key, data, firebaseMethod, label, prepend) {
    if (this._handleRestrictedAction()) return null;
    const source = this._src(key);
    if (prepend !== false) { source.unshift(data); } else { source.push(data); }
    if (!this._demoMode && firebaseMethod) {
      try {
        await FirebaseService.ensureAuthReadyForWrite();
        await firebaseMethod.call(FirebaseService, data);
      } catch (err) {
        const idx = source.indexOf(data);
        if (idx >= 0) source.splice(idx, 1);
        console.error(`[${label}]`, err);
        this._handleFirestoreWriteError(err, label);
        throw err;
      }
    }
    return data;
  },

  /** Firestore 寫入失敗統一處理：permission-denied / assertion 給用戶提示 */
  _handleFirestoreWriteError(err, label) {
    const code = (err?.code || '').toLowerCase();
    const msg = (err?.message || '').toLowerCase();
    if (typeof App !== 'undefined' && App.showToast) {
      if (code === 'permission-denied') {
        App.showToast('操作失敗：權限不足，請重新登入或聯繫管理員');
      } else if (msg.includes('assertion') || msg.includes('internal')) {
        App.showToast('系統異常，請關閉所有分頁後重新開啟');
      } else if (msg.includes('尚未準備就緒')) {
        App.showToast('連線尚未就緒，請稍後再試');
      }
    }
  },

  /** 通用更新：快取 Object.assign + 非同步寫入 Firebase */
  _update(key, id, updates, firebaseMethod, label) {
    if (this._handleRestrictedAction()) return null;
    const item = this._findById(key, id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode && firebaseMethod) {
      FirebaseService.ensureAuthReadyForWrite()
        .then(() => firebaseMethod.call(FirebaseService, id, updates))
        .catch(err => {
          console.error(`[${label}]`, err);
          this._handleFirestoreWriteError(err, label);
        });
    }
    return item;
  },

  async _updateAwaitWrite(key, id, updates, firebaseMethod, label) {
    if (this._handleRestrictedAction()) return null;
    const item = this._findById(key, id);
    if (!item) return null;

    const snapshot = JSON.parse(JSON.stringify(item));
    Object.assign(item, updates);
    if (!this._demoMode && firebaseMethod) {
      try {
        await FirebaseService.ensureAuthReadyForWrite();
        await firebaseMethod.call(FirebaseService, id, updates);
      } catch (err) {
        Object.keys(item).forEach(keyName => delete item[keyName]);
        Object.assign(item, snapshot);
        console.error(`[${label}]`, err);
        this._handleFirestoreWriteError(err, label);
        throw err;
      }
    }
    return item;
  },

  /** 通用刪除：先呼叫 Firebase（需要讀取 _docId），再從快取 splice */
  _delete(key, id, firebaseMethod, label) {
    if (this._handleRestrictedAction()) return false;
    const source = this._src(key);
    // 必須先呼叫 Firebase 刪除（需要從 cache 中找到 _docId），再 splice
    if (!this._demoMode && firebaseMethod) {
      FirebaseService.ensureAuthReadyForWrite()
        .then(() => firebaseMethod.call(FirebaseService, id))
        .catch(err => {
          console.error(`[${label}]`, err);
          this._handleFirestoreWriteError(err, label);
        });
    }
    const idx = source.findIndex(item => item.id === id);
    if (idx >= 0) source.splice(idx, 1);
    // Persist updated cache to localStorage so deleted items don't reappear on refresh
    if (!this._demoMode) {
      FirebaseService._saveToLS(key, source);
    }
    return true;
  },

  async _deleteAwaitWrite(key, id, firebaseMethod, label) {
    if (this._handleRestrictedAction()) return false;
    const source = this._src(key);
    const idx = source.findIndex(item => item.id === id);
    if (!this._demoMode && firebaseMethod) {
      try {
        await FirebaseService.ensureAuthReadyForWrite();
        const deleted = await firebaseMethod.call(FirebaseService, id);
        if (!deleted) return false;
      } catch (err) {
        console.error(`[${label}]`, err);
        this._handleFirestoreWriteError(err, label);
        throw err;
      }
    }
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) {
      FirebaseService._saveToLS(key, source);
    }
    return idx >= 0 || this._demoMode;
  },

  // ════════════════════════════════
  //  Events（活動）
  // ════════════════════════════════

  getEvents()       { return this._src('events'); },
  getEvent(id)      { return this._findById('events', id); },

  getActiveEvents() {
    return this._src('events').filter(e => e.status !== 'ended' && e.status !== 'cancelled');
  },

  getHotEvents(withinDays) {
    const now = new Date();
    const limit = new Date(now.getTime() + (withinDays || 14) * 24 * 60 * 60 * 1000);
    return this._src('events').filter(e => {
      if (e.status === 'ended' || e.status === 'cancelled') return false;
      const parts = e.date.split(' ')[0].split('/');
      const eventDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      return eventDate >= now && eventDate <= limit;
    });
  },

  _normalizeEventUpdates(updates) {
    const normalized = (updates && typeof updates === 'object') ? { ...updates } : {};
    if (normalized.status === 'ended') normalized.feeEnabled = false;
    return normalized;
  },

  createEvent(data)         { return this._createAwaitWrite('events', data, FirebaseService.addEvent, 'createEvent'); },
  updateEvent(id, updates)  { return this._update('events', id, this._normalizeEventUpdates(updates), FirebaseService.updateEvent, 'updateEvent'); },
  deleteEvent(id)           { return this._deleteAwaitWrite('events', id, FirebaseService.deleteEvent, 'deleteEvent'); },

  async loadMyEventTemplates(ownerUid) {
    if (this._demoMode) return this._src('eventTemplates');
    const data = await FirebaseService.loadMyEventTemplates(ownerUid);
    return Array.isArray(data) ? data : [];
  },

  getEventTemplates() { return this._src('eventTemplates'); },

  async createEventTemplate(data) {
    if (this._handleRestrictedAction()) return null;
    const source = this._src('eventTemplates');
    source.unshift(data);
    if (!this._demoMode) {
      try {
        await FirebaseService.addEventTemplate(data);
      } catch (err) {
        console.error('[createEventTemplate]', err);
        const idx = source.indexOf(data);
        if (idx >= 0) source.splice(idx, 1);
        FirebaseService._saveToLS('eventTemplates', source);
        throw err;
      }
      FirebaseService._saveToLS('eventTemplates', source);
    }
    return data;
  },

  async deleteEventTemplate(id) {
    if (this._handleRestrictedAction()) return false;
    if (!this._demoMode) {
      await FirebaseService.deleteEventTemplate(id);
    }
    const source = this._src('eventTemplates');
    const idx = source.findIndex(item => item.id === id || item._docId === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) FirebaseService._saveToLS('eventTemplates', source);
    return true;
  },

  // ════════════════════════════════
  //  Tournaments（賽事）
  // ════════════════════════════════

  getTournaments()    { return this._src('tournaments'); },
  getTournament(id)   { return this._findById('tournaments', id); },
  getStandings()      { return this._src('standings'); },
  getMatches()        { return this._src('matches'); },
  getTrades()         { return this._src('trades'); },

  getFriendlyTournamentRecord(idOrRecord) {
    const tournament = typeof idOrRecord === 'string'
      ? this.getTournament(idOrRecord)
      : idOrRecord;
    if (!tournament) return null;
    if (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentRecord === 'function') {
      return App._buildFriendlyTournamentRecord(tournament);
    }
    return tournament;
  },

  createTournament(data) {
    const payload = this._normalizeTournamentRecordForWrite(data);
    return this._create('tournaments', payload, FirebaseService.addTournament, 'createTournament');
  },

  async createTournamentAwait(data) {
    const payload = this._normalizeTournamentRecordForWrite(data);
    return await this._createAwaitWrite('tournaments', payload, FirebaseService.addTournament, 'createTournament');
  },

  updateTournament(id, updates) {
    const payload = this._normalizeTournamentRecordForWrite(updates, this.getTournament(id));
    return this._update('tournaments', id, payload, FirebaseService.updateTournament, 'updateTournament');
  },

  async updateTournamentAwait(id, updates) {
    const payload = this._normalizeTournamentRecordForWrite(updates, this.getTournament(id));
    return await this._updateAwaitWrite('tournaments', id, payload, FirebaseService.updateTournament, 'updateTournament');
  },

  async listTournamentApplications(tournamentId) {
    if (this._demoMode) {
      return this._getDemoTournamentFriendlyArray(tournamentId, 'teamApplications')
        .map(item => ({ ...item }));
    }
    return await FirebaseService.listTournamentApplications(tournamentId);
  },

  async createTournamentApplication(tournamentId, data) {
    const payload = (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentApplicationRecord === 'function')
      ? App._buildFriendlyTournamentApplicationRecord(data)
      : { ...data };
    if (this._demoMode) {
      const store = this._getDemoTournamentFriendlyArray(tournamentId, 'teamApplications');
      const idx = store.findIndex(item => item.id === payload.id || item.teamId === payload.teamId);
      if (idx >= 0) store[idx] = { ...store[idx], ...payload };
      else store.push(payload);
      return payload;
    }
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    return await FirebaseService.createTournamentApplication(tournamentId, payload);
  },

  async updateTournamentApplication(tournamentId, applicationId, updates) {
    if (this._demoMode) {
      const store = this._getDemoTournamentFriendlyArray(tournamentId, 'teamApplications');
      const idx = store.findIndex(item => item.id === applicationId);
      if (idx === -1) return null;
      store[idx] = { ...store[idx], ...updates };
      return store[idx];
    }
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    return await FirebaseService.updateTournamentApplication(tournamentId, applicationId, updates);
  },

  async listTournamentEntries(tournamentId) {
    if (this._demoMode) {
      return this._getDemoTournamentFriendlyArray(tournamentId, 'teamEntries')
        .map(item => ({ ...item }));
    }
    return await FirebaseService.listTournamentEntries(tournamentId);
  },

  async upsertTournamentEntry(tournamentId, teamId, data) {
    const payload = (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentEntryRecord === 'function')
      ? App._buildFriendlyTournamentEntryRecord({ ...data, teamId: teamId || data?.teamId })
      : { ...data, teamId: teamId || data?.teamId };
    if (this._demoMode) {
      const store = this._getDemoTournamentFriendlyArray(tournamentId, 'teamEntries');
      const idx = store.findIndex(item => item.teamId === payload.teamId);
      if (idx >= 0) store[idx] = { ...store[idx], ...payload };
      else store.push(payload);
      return payload;
    }
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    return await FirebaseService.upsertTournamentEntry(tournamentId, teamId, payload);
  },

  async listTournamentEntryMembers(tournamentId, teamId) {
    if (this._demoMode) {
      const entry = this._getDemoTournamentFriendlyArray(tournamentId, 'teamEntries')
        .find(item => item.teamId === teamId);
      return Array.isArray(entry?.memberRoster) ? entry.memberRoster.map(item => ({ ...item })) : [];
    }
    return await FirebaseService.listTournamentEntryMembers(tournamentId, teamId);
  },

  async upsertTournamentEntryMember(tournamentId, teamId, member) {
    const payload = (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentRosterMemberRecord === 'function')
      ? App._buildFriendlyTournamentRosterMemberRecord(member)
      : { ...member };
    if (this._demoMode) {
      const store = this._getDemoTournamentFriendlyArray(tournamentId, 'teamEntries');
      const entry = store.find(item => item.teamId === teamId);
      if (!entry) return null;
      if (!Array.isArray(entry.memberRoster)) entry.memberRoster = [];
      const idx = entry.memberRoster.findIndex(item => item.uid === payload.uid);
      if (idx >= 0) entry.memberRoster[idx] = { ...entry.memberRoster[idx], ...payload };
      else entry.memberRoster.push(payload);
      return payload;
    }
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    return await FirebaseService.upsertTournamentEntryMember(tournamentId, teamId, payload);
  },

  async removeTournamentEntryMember(tournamentId, teamId, memberUid) {
    if (this._demoMode) {
      const store = this._getDemoTournamentFriendlyArray(tournamentId, 'teamEntries');
      const entry = store.find(item => item.teamId === teamId);
      if (!entry || !Array.isArray(entry.memberRoster)) return false;
      entry.memberRoster = entry.memberRoster.filter(item => item.uid !== memberUid);
      return true;
    }
    if (!(await FirebaseService.ensureAuthReadyForWrite())) throw new Error('AUTH_NOT_READY');
    return await FirebaseService.removeTournamentEntryMember(tournamentId, teamId, memberUid);
  },

  deleteTournament(id) {
    const source = this._src('tournaments');
    const idx = source.findIndex(t => t.id === id);
    if (idx === -1) return;
    const removed = source.splice(idx, 1)[0];
    if (!this._demoMode) {
      if (removed._docId) {
        FirebaseService.ensureAuthReadyForWrite()
          .then(async () => {
            const docRef = db.collection('tournaments').doc(removed._docId);
            // 清理 subcollections: applications, entries (含 members)
            const subs = ['applications', 'entries'];
            for (const sub of subs) {
              const snap = await docRef.collection(sub).get();
              if (!snap.empty) {
                const batch = db.batch();
                for (const doc of snap.docs) {
                  // entries 底下可能有 members subcollection
                  if (sub === 'entries') {
                    const membersSnap = await doc.ref.collection('members').get();
                    membersSnap.docs.forEach(m => batch.delete(m.ref));
                  }
                  batch.delete(doc.ref);
                }
                await batch.commit();
              }
            }
            await docRef.delete();
          })
          .catch(err => console.error('[deleteTournament]', err));
      }
      FirebaseService._saveToLS('tournaments', source);
    }
  },

  // ════════════════════════════════
  //  Teams（俱樂部）
  // ════════════════════════════════

  getTeams()        { return this._src('teams'); },
  getTeam(id)       { return this._findById('teams', id); },
  getActiveTeams()  { return this._src('teams').filter(t => t.active); },

  createTeam(data)        { return this._create('teams', data, FirebaseService.addTeam, 'createTeam'); },
  updateTeam(id, updates) { return this._update('teams', id, updates, FirebaseService.updateTeam, 'updateTeam'); },

  async deleteTeam(id) {
    const source = this._src('teams');

    // 正式版：先取得 _docId 再刪 Firestore，最後才從快取移除
    if (!this._demoMode) {
      const doc = source.find(t => t.id === id);
      if (doc && doc._docId) {
        await FirebaseService.deleteTeam(id);
      } else {
        throw new Error('TEAM_DOC_NOT_FOUND');
      }
    }

    // 從快取移除
    const idx = source.findIndex(t => t.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) FirebaseService._saveToLS('teams', source);

    const buildNextMembership = (user) => {
      const ids = [];
      const seen = new Set();
      const pushId = (teamId) => {
        const value = String(teamId || '').trim();
        if (!value || seen.has(value)) return;
        seen.add(value);
        ids.push(value);
      };

      if (Array.isArray(user?.teamIds)) user.teamIds.forEach(pushId);
      pushId(user?.teamId);

      if (!ids.includes(String(id))) return null;

      const namesById = new Map();
      if (Array.isArray(user?.teamIds)) {
        ids.forEach((teamId, index) => {
          const teamName = Array.isArray(user?.teamNames) ? user.teamNames[index] : '';
          if (typeof teamName === 'string' && teamName.trim()) {
            namesById.set(teamId, teamName.trim());
          }
        });
      }
      if (typeof user?.teamId === 'string' && user.teamId.trim() && typeof user?.teamName === 'string' && user.teamName.trim()) {
        namesById.set(String(user.teamId).trim(), user.teamName.trim());
      }

      const nextIds = ids.filter(teamId => teamId !== String(id));
      const nextNames = nextIds.map(teamId => {
        if (namesById.has(teamId)) return namesById.get(teamId);
        const team = this.getTeam(teamId);
        return team?.name || teamId;
      });

      return nextIds.length > 0
        ? {
            teamId: nextIds[0],
            teamName: nextNames[0] || '',
            teamIds: nextIds,
            teamNames: nextNames,
          }
        : {
            teamId: null,
            teamName: null,
            teamIds: [],
            teamNames: [],
          };
    };

    const pendingWrites = [];
    const writtenDocIds = new Set();

    // 清除所有引用此俱樂部的用戶
    const users = this._src('adminUsers');
    users.forEach(u => {
      const updates = buildNextMembership(u);
      if (!updates) return;

      Object.assign(u, updates);
      if (!this._demoMode && u._docId && !writtenDocIds.has(u._docId)) {
        writtenDocIds.add(u._docId);
        pendingWrites.push(
          FirebaseService.updateUser(u._docId, updates)
            .catch(err => console.error('[deleteTeam] clear user team:', err))
        );
      }
    });

    // 清除 currentUser 的俱樂部引用
    const cur = this.getCurrentUser();
    const currentUserUpdates = buildNextMembership(cur);
    if (cur && currentUserUpdates) {
      Object.assign(cur, currentUserUpdates);
      if (!this._demoMode && cur._docId && !writtenDocIds.has(cur._docId)) {
        writtenDocIds.add(cur._docId);
        pendingWrites.push(
          FirebaseService.updateUser(cur._docId, currentUserUpdates)
            .catch(err => console.error('[deleteTeam] clear currentUser team:', err))
        );
      }
    }

    if (pendingWrites.length > 0) await Promise.all(pendingWrites);

    return true;
  },

  // ════════════════════════════════
  //  Shop（二手商品）
  // ════════════════════════════════

  getShopItems()    { return this._src('shopItems'); },
  getShopItem(id)   { return this._findById('shopItems', id); },

  createShopItem(data)        { return this._create('shopItems', data, FirebaseService.addShopItem, 'createShopItem'); },
  updateShopItem(id, updates) { return this._update('shopItems', id, updates, FirebaseService.updateShopItem, 'updateShopItem'); },
  deleteShopItem(id)          { return this._delete('shopItems', id, FirebaseService.deleteShopItem, 'deleteShopItem'); },

  // ════════════════════════════════
  //  Users & Admin（用戶管理）
  // ════════════════════════════════

  getAdminUsers() { return this._src('adminUsers'); },

  getUserCorrections() { return this._src('userCorrections'); },

  getUserCorrection(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return null;
    return this._src('userCorrections').find(item => String(item?.uid || item?._docId || '').trim() === safeUid) || null;
  },

  async saveUserNoShowCorrection(uid, noShow) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) throw new Error('USER_CORRECTION_UID_REQUIRED');

    const source = this._src('userCorrections');
    const nextDoc = {
      uid: safeUid,
      noShow: { ...(noShow || {}) },
      _docId: safeUid,
    };
    const idx = source.findIndex(item => String(item?.uid || item?._docId || '').trim() === safeUid);
    const prevDoc = idx >= 0 ? { ...source[idx], noShow: source[idx]?.noShow ? { ...source[idx].noShow } : null } : null;

    if (idx >= 0) source[idx] = nextDoc;
    else source.push(nextDoc);
    if (!this._demoMode && typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('userCorrections', source);
    }

    if (!this._demoMode) {
      try {
        await FirebaseService.saveUserCorrection(safeUid, nextDoc);
      } catch (err) {
        if (idx >= 0 && prevDoc) source[idx] = prevDoc;
        else if (idx < 0) source.pop();
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
          FirebaseService._saveToLS('userCorrections', source);
        }
        console.error('[saveUserNoShowCorrection]', err);
        throw err;
      }
    }

    return nextDoc;
  },

  async clearUserNoShowCorrection(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) throw new Error('USER_CORRECTION_UID_REQUIRED');

    const source = this._src('userCorrections');
    const idx = source.findIndex(item => String(item?.uid || item?._docId || '').trim() === safeUid);
    if (idx < 0) return false;
    const prevDoc = { ...source[idx], noShow: source[idx]?.noShow ? { ...source[idx].noShow } : null };
    source.splice(idx, 1);
    if (!this._demoMode && typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('userCorrections', source);
    }

    if (!this._demoMode) {
      try {
        await FirebaseService.deleteUserCorrection(safeUid);
      } catch (err) {
        source.splice(Math.max(0, idx), 0, prevDoc);
        if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
          FirebaseService._saveToLS('userCorrections', source);
        }
        console.error('[clearUserNoShowCorrection]', err);
        throw err;
      }
    }

    return true;
  },

  getUserRole(name) {
    if (this._demoMode) {
      if (DEMO_USERS[name]) return DEMO_USERS[name];
      if (typeof DemoData !== 'undefined') {
        const u = DemoData.adminUsers.find(u => u.name === name);
        return u ? u.role : 'user';
      }
      return 'user';
    }
    const user = FirebaseService._cache.adminUsers.find(u => u.name === name);
    return user ? user.role : 'user';
  },

  async updateAdminUser(name, updates) {
    const user = this._src('adminUsers').find(u => u.name === name);
    if (!user) return null;
    const rollback = { ...user };
    Object.assign(user, updates);
    if (!this._demoMode && user._docId) {
      try {
        await FirebaseService.manageAdminUser(user._docId, updates);
      } catch (err) {
        Object.assign(user, rollback);
        console.error('[updateAdminUser]', err);
        throw err;
      }
    }
    return user;
  },

  getRolePermissions(role) {
    if (role === 'user') {
      return [];
    }

    const hasStoredRolePermissions = this._demoMode
      ? !!(typeof DemoData !== 'undefined' && DemoData.rolePermissions && Object.prototype.hasOwnProperty.call(DemoData.rolePermissions, role))
      : !!(FirebaseService._cache.rolePermissions && Object.prototype.hasOwnProperty.call(FirebaseService._cache.rolePermissions, role));

    const stored = this._demoMode
      ? ((typeof DemoData !== 'undefined' && DemoData.rolePermissions) ? (DemoData.rolePermissions[role] || []) : [])
      : ((FirebaseService._cache.rolePermissions || {})[role] || []);

    const resolved = sanitizePermissionCodeList(hasStoredRolePermissions
      ? stored
      : (Array.isArray(getDefaultRolePermissions(role)) ? getDefaultRolePermissions(role) : stored));

    const inherent = typeof getInherentRolePermissions === 'function'
      ? getInherentRolePermissions(role)
      : [];

    if (role === 'super_admin') {
      return sanitizePermissionCodeList([
        ...resolved,
        ...inherent,
        ...getAllPermissionCodes(this._src('permissions') || []),
      ]);
    }

    return sanitizePermissionCodeList([...resolved, ...inherent]);
  },

  getRolePermissionDefaults(role) {
    if (role === 'user') {
      return [];
    }

    const meta = this._demoMode
      ? ((typeof DemoData !== 'undefined' && DemoData.rolePermissionMeta) ? DemoData.rolePermissionMeta : {})
      : (FirebaseService._cache.rolePermissionMeta || {});
    const savedDefaults = meta?.[role]?.defaultPermissions;
    if (Array.isArray(savedDefaults)) return [...savedDefaults];
    const builtInDefaults = getDefaultRolePermissions(role);
    return Array.isArray(builtInDefaults) ? [...builtInDefaults] : null;
  },

  // ════════════════════════════════
  //  Registrations（報名管理 — 僅 Firebase 模式）
  // ════════════════════════════════

  getRegistrationsByUser(userId) {
    return this._src('registrations').filter(
      r => r.userId === userId && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  getRegistrationsByEvent(eventId) {
    return this._src('registrations').filter(
      r => r.eventId === eventId && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  // ════════════════════════════════
  //  Messages（站內信）
  // ════════════════════════════════

  getMessages() { return this._src('messages'); },

  updateMessage(msgId, updates) { return this._update('messages', msgId, updates, FirebaseService.updateMessage, 'updateMessage'); },

  markMessageRead(msgId) {
    if (this._handleRestrictedAction()) return;
    const msg = this._findById('messages', msgId);
    if (msg) msg.unread = false;
    if (!this._demoMode) {
      FirebaseService.updateMessageRead(msgId).catch(err => console.error('[markMessageRead]', err));
    }
  },

  markAllMessagesRead() {
    if (this._handleRestrictedAction()) return;
    this._src('messages').forEach(m => { m.unread = false; });
    if (!this._demoMode) {
      FirebaseService.markAllMessagesRead().catch(err => console.error('[markAllMessagesRead]', err));
    }
  },

  // ════════════════════════════════
  //  Leaderboard & Records（排行榜 & 紀錄）
  // ════════════════════════════════

  getLeaderboard() { return this._src('leaderboard'); },

  getActivityRecords(uid) {
    if (uid && !this._demoMode) {
      const usc = FirebaseService.getUserStatsCache?.();
      if (usc && usc.uid === uid && usc.activityRecords !== null) {
        return usc.activityRecords.filter(r => r.uid === uid);
      }
    }
    const source = this._src('activityRecords');
    if (uid) return source.filter(r => r.uid === uid);
    return source;
  },

  addActivityRecord(record) {
    this._src('activityRecords').unshift(record);
    return record;
  },

  removeActivityRecord(eventId, uid) {
    const source = this._src('activityRecords');
    const idx = source.findIndex(r => r.eventId === eventId && r.uid === uid);
    if (idx >= 0) {
      source.splice(idx, 1);
      return true;
    }
    return false;
  },

  // ════════════════════════════════
  //  Attendance Records（簽到/簽退）
  // ════════════════════════════════

  getAttendanceRecords(eventId) {
    const source = this._src('attendanceRecords');
    const active = source.filter(r => r.status !== 'removed' && r.status !== 'cancelled');
    if (eventId) return active.filter(r => r.eventId === eventId);
    return active;
  },

  /** 取得指定用戶的簽到簽退紀錄（優先使用 user-specific cache，無 limit 截斷） */
  getUserAttendanceRecords(uid) {
    if (uid && !this._demoMode) {
      const usc = FirebaseService.getUserStatsCache?.();
      if (usc && usc.uid === uid && usc.attendanceRecords !== null) {
        return usc.attendanceRecords.filter(r => r.status !== 'removed' && r.status !== 'cancelled');
      }
    }
    return this.getAttendanceRecords().filter(r => r.uid === uid);
  },

  async addAttendanceRecord(record) {
    if (this._handleRestrictedAction()) return null;
    const normalized = { ...record, status: record.status || 'active' };
    if (
      !this._demoMode
      && (typeof normalized.eventId !== 'string' || !normalized.eventId || typeof normalized.uid !== 'string' || !normalized.uid)
    ) {
      throw new Error('missing required fields: eventId/uid');
    }
    const source = this._src('attendanceRecords');
    source.push(normalized);
    if (!this._demoMode) {
      try {
        await this._runAttendanceWriteWithAuthRetry(async () => {
          await FirebaseService.addAttendanceRecord(normalized);
          FirebaseService._saveToLS('attendanceRecords', FirebaseService._cache.attendanceRecords);
        }, 'addAttendanceRecord');
      } catch (err) {
        const idx = source.findIndex(r => r.id === normalized.id);
        if (idx !== -1) source.splice(idx, 1);
        console.error('[addAttendanceRecord]', err);
        throw new Error(this._mapAttendanceWriteError(err));
      }
    }
    return normalized;
  },

  async removeAttendanceRecord(record) {
    if (this._handleRestrictedAction()) return;
    const source = this._src('attendanceRecords');
    const idx = source.findIndex(r => r.id === record.id);
    const target = idx !== -1 ? source[idx] : null;
    const prev = target ? { ...target } : null;
    if (target) {
      target.status = 'removed';
      target.removedAt = new Date().toISOString();
    }
    if (!this._demoMode) {
      try {
        await this._runAttendanceWriteWithAuthRetry(async () => {
          await FirebaseService.removeAttendanceRecord(target || record);
        }, 'removeAttendanceRecord');
      } catch (err) {
        if (target && prev) Object.assign(target, prev);
        console.error('[removeAttendanceRecord]', err);
        throw new Error(this._mapAttendanceWriteError(err));
      }
    }
    return target;
  },

  /**
   * 批次寫入出席紀錄（原子操作：全部成功或全部失敗）
   * @param {Array} adds - 要新增的紀錄（需有 eventId, uid）
   * @param {Array} removes - 要軟刪除的紀錄（需有 id）
   */
  async batchWriteAttendance(adds, removes) {
    if (this._handleRestrictedAction()) return;
    for (const record of adds) {
      record.status = record.status || 'active';
      if (!this._demoMode && (typeof record.eventId !== 'string' || !record.eventId || typeof record.uid !== 'string' || !record.uid)) {
        throw new Error('missing required fields: eventId/uid');
      }
    }
    if (this._demoMode) {
      const source = this._src('attendanceRecords');
      for (const record of removes) {
        const target = source.find(r => r.id === record.id);
        if (target) { target.status = 'removed'; target.removedAt = new Date().toISOString(); }
      }
      for (const record of adds) source.push(record);
      return;
    }
    try {
      await this._runAttendanceWriteWithAuthRetry(async () => {
        await FirebaseService.batchWriteAttendance(adds, removes);
      }, 'batchWriteAttendance');
    } catch (err) {
      console.error('[batchWriteAttendance]', err);
      throw new Error(this._mapAttendanceWriteError(err));
    }
  },

  // ════════════════════════════════
  //  Achievements & Badges
  // ════════════════════════════════

  getAchievements() { return this._src('achievements'); },
  getBadges()       { return this._src('badges'); },

  createAchievement(data)        { return this._create('achievements', data, FirebaseService.addAchievement, 'createAchievement', false); },
  updateAchievement(id, updates) { return this._update('achievements', id, updates, FirebaseService.updateAchievement, 'updateAchievement'); },
  deleteAchievement(id)          { return this._deleteAwaitWrite('achievements', id, FirebaseService.deleteAchievement, 'deleteAchievement'); },

  createBadge(data)        { return this._create('badges', data, FirebaseService.addBadge, 'createBadge', false); },
  updateBadge(id, updates) { return this._update('badges', id, updates, FirebaseService.updateBadge, 'updateBadge'); },
  deleteBadge(id)          { return this._deleteAwaitWrite('badges', id, FirebaseService.deleteBadge, 'deleteBadge'); },

  // ════════════════════════════════
  //  Error Log（錯誤日誌工具）
  // ════════════════════════════════

  _errorLogCache: new Set(),

  _writeErrorLog(context, err) {
    try {
      if (ModeManager.isDemo()) return;
      const curUser = this.getCurrentUser();
      if (!curUser?.uid) return;

      let contextStr;
      try { contextStr = typeof context === 'string' ? context : JSON.stringify(context); }
      catch (_) { contextStr = String(context); }
      const dedupKey = contextStr + '|' + (err?.code || 'no-code');
      if (this._errorLogCache.has(dedupKey)) return;
      this._errorLogCache.add(dedupKey);

      const page = App._currentPage
        || document.querySelector('.page.active')?.id
        || 'unknown';

      const entry = {
        time: App._formatDateTime ? App._formatDateTime(new Date()) : new Date().toISOString(),
        uid: curUser.uid,
        userName: curUser.displayName || curUser.name || curUser.uid,
        context: contextStr,
        errorCode: err?.code || '',
        errorMessage: err?.message || (err != null ? String(err) : ''),
        errorStack: err?.stack ? err.stack.slice(0, 1500) : '',
        page,
        appVersion: CACHE_VERSION,
        userAgent: navigator.userAgent,
      };

      db?.collection('errorLogs').add(entry)
        .then(() => console.log('[errorLog] written:', dedupKey))
        .catch(e => console.warn('[errorLog] write failed:', e?.code, e?.message));
    } catch (_) {
      // _writeErrorLog 自身絕不能拋錯
    }
  },

  // ════════════════════════════════
  //  Operation Log（統一日誌工具）
  // ════════════════════════════════

  _writeOpLog(type, typeName, content) {
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const curUser = this.getCurrentUser();
    const actorUid = auth?.currentUser?.uid || curUser?.uid || curUser?.lineUserId || null;
    const operator = curUser?.displayName || ROLES[App.currentRole]?.label || '系統';
    const opLog = {
      _docId: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actorUid,
      time: timeStr,
      operator,
      type,
      typeName,
      content,
    };
    this._src('operationLogs').unshift(opLog);
    if (!this._demoMode) {
      FirebaseService.addOperationLog(opLog).catch(err => console.error('[opLog]', err));
    }
  },

  // ════════════════════════════════
  //  Admin：Logs, Banners, Permissions
  // ════════════════════════════════

  getExpLogs()       { return this._src('expLogs'); },
  getTeamExpLogs()   { return this._src('teamExpLogs'); },
  getOperationLogs() { return this._src('operationLogs'); },
  getErrorLogs()     { return this._src('errorLogs'); },
  getBanners()       { return this._src('banners').filter(b => b.type !== 'shotgame'); },
  getShotGameAd()    {
    return this._src('banners').find(b =>
      b.slot === 'sga1'
      || b.id === 'sga1'
      || b._docId === 'sga1'
      || b.type === 'shotgame'
    ) || null;
  },
  getPermissions()   { return getMergedPermissionCatalog(this._src('permissions') || []); },

  updateBanner(id, updates)      { return this._update('banners', id, updates, FirebaseService.updateBanner, 'updateBanner'); },
  updateShotGameAd(id, updates)  {
    if (this._handleRestrictedAction()) return null;

    const source = this._src('banners');
    const shotAd = this.getShotGameAd();
    const keys = [id, shotAd?.id, shotAd?._docId, 'sga1'].filter(Boolean);
    const item = source.find(b =>
      keys.includes(b.id)
      || keys.includes(b._docId)
      || b.slot === 'sga1'
      || b.type === 'shotgame'
    ) || null;

    if (item) {
      Object.assign(item, updates);
      // Normalize id so subsequent generic _update paths can resolve this record.
      if (!item.id && item._docId) item.id = item._docId;
      if (!this._demoMode && typeof FirebaseService !== 'undefined' && FirebaseService.updateBanner) {
        const writeId = item.id || item._docId || 'sga1';
        FirebaseService.ensureAuthReadyForWrite()
          .then(() => FirebaseService.updateBanner.call(FirebaseService, writeId, updates))
          .catch(err => console.error('[updateShotGameAd]', err));
      }
      return item;
    }

    // If sga1 slot is missing in cache, try creating it once and retry update.
    if (!this._demoMode && typeof FirebaseService !== 'undefined' && typeof FirebaseService._ensureSga1Slot === 'function') {
      Promise.resolve(FirebaseService._ensureSga1Slot())
        .then(() => {
          const created = this.getShotGameAd();
          if (!created) return;
          if (!created.id && created._docId) created.id = created._docId;
          const retryId = created.id || created._docId || 'sga1';
          if (FirebaseService.updateBanner) {
            return FirebaseService.ensureAuthReadyForWrite()
              .then(() => FirebaseService.updateBanner.call(FirebaseService, retryId, updates));
          }
          return null;
        })
        .catch(err => console.warn('[updateShotGameAd] ensure sga1 failed:', err));
    }
    return null;
  },

  // ════════════════════════════════
  //  Site Themes（佈景主題）
  // ════════════════════════════════

  getSiteThemes() { return this._src('siteThemes'); },

  updateSiteTheme(id, updates) { return this._update('siteThemes', id, updates, FirebaseService.updateSiteTheme, 'updateSiteTheme'); },

  // ════════════════════════════════
  //  Home Game Config（首頁小遊戲設定）
  // ════════════════════════════════

  getGameConfigs() { return this._src('gameConfigs'); },

  getGameConfigByKey(gameKey) {
    const key = String(gameKey || '').trim();
    if (!key) return null;
    return this.getGameConfigs().find(cfg => cfg.gameKey === key) || null;
  },

  isHomeGameVisible(gameKey) {
    const cfg = this.getGameConfigByKey(gameKey);
    if (!cfg) {
      // 無 Firestore 覆蓋時，使用 HOME_GAME_PRESETS 的預設值
      const preset = Array.isArray(HOME_GAME_PRESETS)
        ? HOME_GAME_PRESETS.find(p => p && p.gameKey === gameKey)
        : null;
      return preset ? preset.homeVisible !== false : false;
    }
    if (cfg.enabled === false) return false;
    return cfg.homeVisible !== false;
  },

  isNewsVisible() {
    var cfg = this.getGameConfigs().find(function (c) { return c.gameKey === 'news-section' || c.id === 'news-section'; });
    return !cfg || cfg.homeVisible !== false;
  },

  upsertGameConfig(id, updates) {
    if (this._handleRestrictedAction()) return null;
    const configId = String(id || '').trim();
    if (!configId) return null;

    const source = this._src('gameConfigs');
    let item = source.find(cfg => cfg.id === configId || cfg._docId === configId) || null;
    if (!item) {
      item = { id: configId, ...updates };
      source.push(item);
    } else {
      Object.assign(item, updates);
      if (!item.id) item.id = configId;
    }

    if (!this._demoMode && FirebaseService.upsertGameConfig) {
      FirebaseService.ensureAuthReadyForWrite()
        .then(() => FirebaseService.upsertGameConfig.call(FirebaseService, configId, updates))
        .catch(err => console.error('[upsertGameConfig]', err));
    }
    return item;
  },

  // ════════════════════════════════
  //  Announcements（系統公告）
  // ════════════════════════════════

  getAnnouncements()       { return this._src('announcements'); },
  getActiveAnnouncements() { return this.getAnnouncements().filter(a => a.status === 'active').sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99)); },
  getActiveAnnouncement()  { return this.getActiveAnnouncements()[0] || null; },

  createAnnouncement(data)        { return this._create('announcements', data, FirebaseService.addAnnouncement, 'createAnnouncement'); },
  updateAnnouncement(id, updates) { return this._update('announcements', id, updates, FirebaseService.updateAnnouncement, 'updateAnnouncement'); },
  deleteAnnouncement(id)          { return this._delete('announcements', id, FirebaseService.deleteAnnouncement, 'deleteAnnouncement'); },

  // ════════════════════════════════
  //  News Articles（每日體育新聞）
  // ════════════════════════════════

  getNewsArticles() { return this._src('newsArticles'); },

  // ════════════════════════════════
  //  Floating Ads（浮動廣告）
  // ════════════════════════════════

  getFloatingAds() { return this._src('floatingAds'); },

  updateFloatingAd(id, updates) { return this._update('floatingAds', id, updates, FirebaseService.updateFloatingAd, 'updateFloatingAd'); },

  // ════════════════════════════════
  //  Popup Ads（彈跳廣告）
  // ════════════════════════════════

  getPopupAds()       { return this._src('popupAds'); },
  getActivePopupAds() { return this.getPopupAds().filter(a => a.status === 'active'); },

  createPopupAd(data)        { return this._create('popupAds', data, FirebaseService.addPopupAd, 'createPopupAd', false); },
  updatePopupAd(id, updates) { return this._update('popupAds', id, updates, FirebaseService.updatePopupAd, 'updatePopupAd'); },
  deletePopupAd(id)          { return this._delete('popupAds', id, FirebaseService.deletePopupAd, 'deletePopupAd'); },

  // ════════════════════════════════
  //  Admin Messages（後台站內信）
  // ════════════════════════════════

  getAdminMessages() { return this._src('adminMessages'); },

  // ════════════════════════════════
  //  Notification Templates（通知模板）
  // ════════════════════════════════

  getNotifTemplates() { return this._src('notifTemplates'); },

  getNotifTemplate(key) {
    return this._src('notifTemplates').find(t => t.key === key) || null;
  },

  updateNotifTemplate(key, updates) {
    const t = this._src('notifTemplates').find(t => t.key === key);
    if (t) Object.assign(t, updates);
    if (!this._demoMode) {
      FirebaseService.updateNotifTemplate(key, updates).catch(err => console.error('[updateNotifTemplate]', err));
    }
    return t;
  },

  createAdminMessage(data)        { return this._create('adminMessages', data, FirebaseService.addAdminMessage, 'createAdminMessage'); },
  updateAdminMessage(id, updates) { return this._update('adminMessages', id, updates, FirebaseService.updateAdminMessage, 'updateAdminMessage'); },

  deleteAdminMessage(id) {
    const source = this._src('adminMessages');
    // 先呼叫 Firebase 刪除（需要從 cache 中找到 _docId），再 splice
    if (!this._demoMode) {
      FirebaseService.deleteAdminMessage(id).catch(err => console.error('[deleteAdminMessage]', err));
    }
    const idx = source.findIndex(m => m.id === id);
    if (idx >= 0) source.splice(idx, 1);
  },

  // ════════════════════════════════
  //  Sponsors（贊助商）
  // ════════════════════════════════

  getSponsors() {
    if (this._demoMode) return (typeof DemoData !== 'undefined' && DemoData.sponsors) ? DemoData.sponsors : [];
    return (FirebaseService._cache.sponsors || []).filter(s => s.slot != null && s.slot <= 6);
  },

  getActiveSponsors() {
    return this.getSponsors().filter(s => s.status === 'active');
  },

  updateSponsor(id, updates) {
    const source = this._demoMode ? ((typeof DemoData !== 'undefined' && DemoData.sponsors) ? DemoData.sponsors : []) : (FirebaseService._cache.sponsors || []);
    const item = source.find(s => s.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateSponsor(id, updates).catch(err => console.error('[updateSponsor]', err));
    }
    return item;
  },

  // ════════════════════════════════
  //  User Promotion（用戶晉升）
  // ════════════════════════════════

  promoteUser(name, newRole) {
    const user = this._src('adminUsers').find(u => u.name === name);
    if (user) {
      user.role = newRole;
      if (!this._demoMode && user._docId) {
        FirebaseService.updateUserRole(user._docId, newRole).catch(err => console.error('[promoteUser]', err));
      }
    }
    return user;
  },

  /**
   * 重新計算用戶角色：掃描所有俱樂部職位 + manualRole 底線，取最高。
   * @param {string} uid
   * @returns {{ uid, oldRole, newRole, userName }|null} 有變化回傳結果，無變化回傳 null
   */
  _recalcUserRole(uid) {
    const user = this._src('adminUsers').find(u => u.uid === uid);
    if (!user) return null;
    const oldRole = user.role;
    // venue_owner 以上由管理員手動管理，不做自動降級
    if ((ROLE_LEVEL_MAP[oldRole] || 0) >= ROLE_LEVEL_MAP['venue_owner']) return null;

    // 掃描所有俱樂部，找出此用戶擔任的最高職位
    let highestTeamLevel = 0;
    const teams = this._src('teams');
    teams.forEach(t => {
      if (t.captainUid === uid || t.captain === user.name) {
        highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['captain']);
      }
      if ((t.coaches || []).includes(user.name)) {
        highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['coach']);
      }
      // 領隊 → coach 等級
      const leaderUids = t.leaderUids || (t.leaderUid ? [t.leaderUid] : []);
      if (leaderUids.includes(uid)) {
        highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['coach']);
      }
    });

    // manualRole 底線（未設定等同 user）
    const manualLevel = ROLE_LEVEL_MAP[user.manualRole] || 0;
    const targetLevel = Math.max(highestTeamLevel, manualLevel);

    // 反查角色名稱
    const levelToRole = Object.entries(ROLE_LEVEL_MAP).reduce((m, [k, v]) => { m[v] = k; return m; }, {});
    const newRole = levelToRole[targetLevel] || 'user';

    if (newRole === oldRole) return null;

    // 更新角色
    user.role = newRole;
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserRole(user._docId, newRole).catch(err => console.error('[_recalcUserRole]', err));
    }
    return { uid, oldRole, newRole, userName: user.name };
  },

  // ════════════════════════════════
  //  EXP Adjustment（手動 EXP）
  // ════════════════════════════════

  // ── Cloud Function 呼叫 adjustExp ──
  async _callAdjustExpCF(payload) {
    await FirebaseService.ensureAuthReadyForWrite();
    const fn = firebase.app().functions('asia-east1').httpsCallable('adjustExp');
    return await fn(payload);
  },

  adjustUserExp(nameOrUid, amount, reason, operatorLabel, { mode = 'manual', requestId, ruleKey } = {}) {
    const user = this._src('adminUsers').find(u => u.name === nameOrUid || u.uid === nameOrUid);
    if (!user || !(user.uid || user.lineUserId)) return null;
    // 樂觀更新本地快取
    user.exp = Math.max(0, (user.exp || 0) + amount);
    // 同步 currentUser（adminUsers 和 currentUser 是不同物件）
    const curUser = this.getCurrentUser();
    if (curUser && curUser !== user && (curUser.uid === (user.uid || user.lineUserId) || curUser.lineUserId === (user.uid || user.lineUserId))) {
      curUser.exp = user.exp;
    }
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const log = { time: timeStr, uid: user.uid || user.lineUserId, target: user.name, amount: (amount > 0 ? '+' : '') + amount, reason, operator: operatorLabel || '管理員', operatorUid: auth?.currentUser?.uid || null };
    this._src('expLogs').unshift(log);
    const _expLogLabel = mode === 'auto' ? '自動EXP' : '手動EXP';
    this._writeOpLog('exp', _expLogLabel, `${user.name} ${log.amount}「${reason}」`);
    if (!this._demoMode) {
      const targetId = user._docId || user.uid || user.lineUserId;
      if (targetId) {
        const payload = { mode, targets: [targetId], amount, reason, operatorLabel: operatorLabel || '管理員' };
        if (requestId) payload.requestId = requestId;
        if (ruleKey) payload.ruleKey = ruleKey;
        this._callAdjustExpCF(payload).catch(err => {
          console.error('[adjustUserExp CF]', err);
          // CF 失敗 → rollback 樂觀更新
          user.exp = Math.max(0, (user.exp || 0) - amount);
          const _cur = this.getCurrentUser();
          if (_cur && _cur !== user && (_cur.uid === (user.uid || user.lineUserId) || _cur.lineUserId === (user.uid || user.lineUserId))) {
            _cur.exp = user.exp;
          }
        });
      }
    }
    return user;
  },

  async adjustUserExpAsync(nameOrUid, amount, reason, operatorLabel, { mode = 'manual', requestId, ruleKey } = {}) {
    const user = this._src('adminUsers').find(u => u.name === nameOrUid || u.uid === nameOrUid);
    if (!user || !(user.uid || user.lineUserId)) return null;
    user.exp = Math.max(0, (user.exp || 0) + amount);
    // 同步 currentUser
    const curUser = this.getCurrentUser();
    if (curUser && curUser !== user && (curUser.uid === (user.uid || user.lineUserId) || curUser.lineUserId === (user.uid || user.lineUserId))) {
      curUser.exp = user.exp;
    }
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const log = { time: timeStr, uid: user.uid || user.lineUserId, target: user.name, amount: (amount > 0 ? '+' : '') + amount, reason, operator: operatorLabel || '管理員', operatorUid: auth?.currentUser?.uid || null };
    this._src('expLogs').unshift(log);
    const _expLogLabel2 = mode === 'auto' ? '自動EXP' : '手動EXP';
    this._writeOpLog('exp', _expLogLabel2, `${user.name} ${log.amount}「${reason}」`);
    if (!this._demoMode) {
      const targetId = user._docId || user.uid || user.lineUserId;
      if (targetId) {
        const payload = { mode, targets: [targetId], amount, reason, operatorLabel: operatorLabel || '管理員' };
        if (requestId) payload.requestId = requestId;
        if (ruleKey) payload.ruleKey = ruleKey;
        await this._callAdjustExpCF(payload);
      }
    }
    return user;
  },

  async adjustBatchUserExpAsync(names, amount, reason, operatorLabel) {
    const results = [];
    const targetIds = [];
    for (const nameOrUid of names) {
      const user = this._src('adminUsers').find(u => u.name === nameOrUid || u.uid === nameOrUid);
      if (!user) continue;
      user.exp = Math.max(0, (user.exp || 0) + amount);
      results.push(user);
      const targetId = user._docId || user.uid || user.lineUserId;
      if (targetId) targetIds.push(targetId);
      const now = new Date();
      const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const log = { time: timeStr, uid: user.uid || user.lineUserId || null, target: user.name, amount: (amount > 0 ? '+' : '') + amount, reason, operator: operatorLabel || '管理員', operatorUid: auth?.currentUser?.uid || null };
      this._src('expLogs').unshift(log);
    }
    if (results.length > 0) {
      this._writeOpLog('exp', '批次EXP', `${results.length} 人 ${amount > 0 ? '+' : ''}${amount}「${reason}」`);
    }
    if (!this._demoMode && targetIds.length > 0) {
      await this._callAdjustExpCF({
        mode: 'batch', targets: targetIds, amount, reason, operatorLabel: operatorLabel || '管理員',
      });
    }
    return results;
  },

  adjustTeamExp(teamId, amount, reason, operatorLabel) {
    const team = this._findById('teams', teamId);
    if (!team) return null;
    // 樂觀更新本地快取
    team.teamExp = Math.min(10000, Math.max(0, (team.teamExp || 0) + amount));
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const log = { time: timeStr, target: team.name, targetId: teamId, amount: (amount > 0 ? '+' : '') + amount, reason, operator: operatorLabel || '管理員', operatorUid: auth?.currentUser?.uid || null };
    this._src('teamExpLogs').unshift(log);
    this._writeOpLog('team_exp', '俱樂部積分', `${team.name} ${log.amount}「${reason}」`);
    if (!this._demoMode) {
      this._callAdjustExpCF({
        mode: 'teamExp', teamId, amount, reason, operatorLabel: operatorLabel || '管理員',
      }).catch(err => console.error('[adjustTeamExp CF]', err));
    }
    return team;
  },

  async adjustTeamExpAsync(teamId, amount, reason, operatorLabel) {
    const team = this._findById('teams', teamId);
    if (!team) return null;
    team.teamExp = Math.min(10000, Math.max(0, (team.teamExp || 0) + amount));
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const log = { time: timeStr, target: team.name, targetId: teamId, amount: (amount > 0 ? '+' : '') + amount, reason, operator: operatorLabel || '管理員', operatorUid: auth?.currentUser?.uid || null };
    this._src('teamExpLogs').unshift(log);
    this._writeOpLog('team_exp', '俱樂部積分', `${team.name} ${log.amount}「${reason}」`);
    if (!this._demoMode) {
      await this._callAdjustExpCF({
        mode: 'teamExp', teamId, amount, reason, operatorLabel: operatorLabel || '管理員',
      });
    }
    return team;
  },

  // ════════════════════════════════
  //  Companions（同行者）
  // ════════════════════════════════

  getCompanions() {
    const user = this.getCurrentUser();
    return user?.companions || [];
  },

  addCompanion(data) {
    if (this._handleRestrictedAction()) return null;
    const user = this.getCurrentUser();
    if (!user) return null;
    if (!user.companions) user.companions = [];
    user.companions.push(data);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserCompanions(user._docId, user.companions)
        .catch(err => console.error('[addCompanion]', err));
    }
    return data;
  },

  updateCompanion(companionId, updates) {
    if (this._handleRestrictedAction()) return null;
    const user = this.getCurrentUser();
    if (!user || !user.companions) return null;
    const comp = user.companions.find(c => c.id === companionId);
    if (!comp) return null;
    Object.assign(comp, updates);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserCompanions(user._docId, user.companions)
        .catch(err => console.error('[updateCompanion]', err));
    }
    return comp;
  },

  deleteCompanion(companionId) {
    if (this._handleRestrictedAction()) return false;
    const user = this.getCurrentUser();
    if (!user || !user.companions) return false;
    const idx = user.companions.findIndex(c => c.id === companionId);
    if (idx < 0) return false;
    user.companions.splice(idx, 1);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserCompanions(user._docId, user.companions)
        .catch(err => console.error('[deleteCompanion]', err));
    }
    return true;
  },

  // ── Education: Parent-Child Binding ──

  getEduChildren() {
    const user = this.getCurrentUser();
    return (user && user.eduChildren) || [];
  },

  addEduChild(data) {
    if (this._handleRestrictedAction()) return null;
    const user = this.getCurrentUser();
    if (!user) return null;
    if (!user.eduChildren) user.eduChildren = [];
    user.eduChildren.push(data);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserEduChildren(user._docId, user.eduChildren)
        .catch(err => console.error('[addEduChild]', err));
    }
    return data;
  },

  removeEduChild(childId) {
    if (this._handleRestrictedAction()) return false;
    const user = this.getCurrentUser();
    if (!user || !user.eduChildren) return false;
    const idx = user.eduChildren.findIndex(c => c.id === childId);
    if (idx < 0) return false;
    user.eduChildren.splice(idx, 1);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserEduChildren(user._docId, user.eduChildren)
        .catch(err => console.error('[removeEduChild]', err));
    }
    return true;
  },

  getMyRegistrationsByEvent(eventId) {
    const uid = this.getCurrentUser()?.uid;
    if (!uid) return [];
    return this._src('registrations').filter(
      r => r.eventId === eventId && r.userId === uid && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  async registerEventWithCompanions(eventId, participantList) {
    if (this._handleRestrictedAction()) {
      throw new Error('ACCOUNT_RESTRICTED');
    }
    const e = App._syncEventEffectiveStatus?.(ApiService.getEvent(eventId)) || ApiService.getEvent(eventId);
    if (e && e.status === 'cancelled') throw new Error('\u6d3b\u52d5\u5df2\u53d6\u6d88');
    if (e && e.status === 'ended') throw new Error('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u5831\u540d\u5df2\u7d50\u675f');
    if (e && e.status === 'upcoming') throw new Error('\u5831\u540d\u5c1a\u672a\u958b\u653e\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    if (!e) throw new Error('活動不存在');
    const user = this.getCurrentUser();
    const userId = user?.uid || 'unknown';
    const userName = user?.displayName || user?.name || '用戶';

    if (this._demoMode) {
      const registrations = [];
      let confirmed = 0, waitlisted = 0;
      let promotionIdx = 0;
      for (const p of participantList) {
        // 重複檢查：跳過已報名的相同人員
        const dupKey = p.companionId ? `${userId}_${p.companionId}` : userId;
        const existing = this._src('registrations').find(r => {
          if (r.eventId !== eventId || r.status === 'cancelled' || r.status === 'removed') return false;
          const rKey = r.companionId ? `${r.userId}_${r.companionId}` : r.userId;
          return rKey === dupKey;
        });
        if (existing) { promotionIdx++; continue; }

        const isWaitlist = e.current >= e.max;
        if (isWaitlist) {
          e.waitlist = (e.waitlist || 0) + 1;
          waitlisted++;
        } else {
          e.current++;
          confirmed++;
        }
        const reg = {
          id: 'reg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId,
          userId,
          userName,
          participantType: p.type,
          companionId: p.companionId || null,
          companionName: p.companionName || null,
          status: isWaitlist ? 'waitlisted' : 'confirmed',
          promotionOrder: promotionIdx,
          registeredAt: new Date().toISOString(),
        };
        promotionIdx++;
        this._src('registrations').push(reg);
        registrations.push(reg);
        if (e.current >= e.max) e.status = 'full';
      }
      return { registrations, confirmed, waitlisted };
    }

    const entries = participantList.map(p => ({
      userId,
      userName,
      participantType: p.type,
      companionId: p.type === 'companion' ? p.companionId : null,
      companionName: p.type === 'companion' ? p.companionName : null,
    }));
    return await FirebaseService.batchRegisterForEvent(eventId, entries);
  },

  // ════════════════════════════════
  //  Shot Game — 射門遊戲（Phase 1）
  // ════════════════════════════════

  /**
   * 呼叫 Cloud Function 提交射門分數。
   * Demo 模式下靜默成功（不實際寫入）。
   * @param {{ score, shots, streak, durationMs, displayName }} payload
   * @returns {Promise<{ success, isNewBest, bucket }|null>}
   */
  async submitShotGameScore(payload) {
    if (this._demoMode) return { success: true, isNewBest: false, bucket: 'demo' };
    if (!auth?.currentUser) return null;
    try {
      const fn = firebase.app().functions('asia-east1').httpsCallable('submitShotGameScore');
      const result = await fn(payload);
      return result.data;
    } catch (err) {
      console.warn('[ApiService] submitShotGameScore failed:', err?.code, err?.message);
      return null;
    }
  },

  /**
   * 讀取射門排行榜（5 分鐘 client-side cache）。
   * @param {{ period: 'daily'|'weekly'|'monthly', bucket: string }} options
   *   bucket 格式：daily_2026-03-05 / weekly_2026-W10 / monthly_2026-03
   * @returns {Promise<Array<{ uid, displayName, bestScore, bestStreak, bestAt, updatedAt }>>}
   */
  _shotGameLeaderboardCache: {},

  async getShotGameLeaderboard({ period = 'daily', bucket } = {}) {
    if (!bucket) return [];
    const cacheKey = bucket;
    const cached = this._shotGameLeaderboardCache[cacheKey];
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;

    if (this._demoMode) {
      const demo = [
        { uid: 'demo1', displayName: '示範玩家 A', bestScore: 850, bestStreak: 5, bestAt: null },
        { uid: 'demo2', displayName: '示範玩家 B', bestScore: 720, bestStreak: 3, bestAt: null },
      ];
      this._shotGameLeaderboardCache[cacheKey] = { ts: Date.now(), data: demo };
      return demo;
    }

    try {
      const snap = await db
        .collection('shotGameRankings')
        .doc(bucket)
        .collection('entries')
        .orderBy('bestScore', 'desc')
        .limit(50)
        .get();
      const data = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      this._shotGameLeaderboardCache[cacheKey] = { ts: Date.now(), data };
      return data;
    } catch (err) {
      console.warn('[ApiService] getShotGameLeaderboard failed:', err?.code, err?.message);
      return [];
    }
  },

  // ════════════════════════════════
  //  Current User（登入用戶）
  // ════════════════════════════════

  _auditLogCallable: null,
  _auditLogBackfillCallable: null,

  async writeAuditLog(payload = {}) {
    try {
      if (this._demoMode) return null;
      const authed = await this._ensureFirebaseWriteAuth({ forceRefreshToken: false });
      if (!authed) return null;

      if (!this._auditLogCallable) {
        this._auditLogCallable = firebase.app().functions('asia-east1').httpsCallable('writeAuditLog');
      }

      const result = await this._auditLogCallable({
        action: String(payload.action || '').trim(),
        targetType: String(payload.targetType || 'system').trim(),
        targetId: String(payload.targetId || '').trim(),
        targetLabel: String(payload.targetLabel || '').trim(),
        result: String(payload.result || 'success').trim(),
        source: String(payload.source || 'web').trim(),
        meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
      });
      return result?.data || null;
    } catch (err) {
      console.warn('[writeAuditLog]', err?.code || '', err?.message || err);
      return null;
    }
  },

  async backfillAuditActorNames(dayKey = '') {
    try {
      if (this._demoMode) {
        return { success: true, dayKey: '', scanned: 0, updated: 0 };
      }
      const authed = await this._ensureFirebaseWriteAuth({ forceRefreshToken: true });
      if (!authed) return null;

      if (!this._auditLogBackfillCallable) {
        this._auditLogBackfillCallable = firebase.app().functions('asia-east1').httpsCallable('backfillAuditActorNames');
      }

      const safeDayKey = String(dayKey || '').replace(/\D/g, '').slice(0, 8);
      const result = await this._auditLogBackfillCallable({
        dayKey: safeDayKey,
      });
      return result?.data || null;
    } catch (err) {
      console.warn('[backfillAuditActorNames]', err?.code || '', err?.message || err);
      return null;
    }
  },

  async getAuditLogsByDay(dayKey, options = {}) {
    if (this._demoMode) {
      return { items: [], lastDoc: null, hasMore: false };
    }

    const safeDayKey = String(dayKey || '').replace(/\D/g, '').slice(0, 8);
    if (safeDayKey.length !== 8) {
      return { items: [], lastDoc: null, hasMore: false };
    }

    const pageSize = Math.max(1, Math.min(200, Number(options.pageSize) || 100));
    let query = db.collection('auditLogsByDay')
      .doc(safeDayKey)
      .collection('auditEntries')
      .orderBy('createdAt', 'desc')
      .limit(pageSize + 1);

    if (options.startAfter) {
      query = query.startAfter(options.startAfter);
    }

    const snap = await query.get();
    const pageDocs = snap.docs.slice(0, pageSize);

    return {
      items: pageDocs.map(doc => ({ ...doc.data(), _docId: doc.id })),
      lastDoc: pageDocs.length ? pageDocs[pageDocs.length - 1] : null,
      hasMore: snap.docs.length > pageSize,
    };
  },

  _normalizeEventParticipantKeyword(value) {
    return String(value || '').trim().toLowerCase();
  },

  _parseEventParticipantDate(dateStr) {
    if (!dateStr) return null;
    const parts = String(dateStr).split(' ');
    const dateParts = parts[0].split('/');
    if (dateParts.length < 3) return null;
    const y = parseInt(dateParts[0], 10);
    const m = parseInt(dateParts[1], 10) - 1;
    const d = parseInt(dateParts[2], 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (parts[1]) {
      const timePart = parts[1].split('~')[0];
      const [hh, mm] = timePart.split(':').map(v => parseInt(v, 10));
      return new Date(y, m, d, Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0);
    }
    return new Date(y, m, d);
  },

  _chunkArray(items, size) {
    const chunkSize = Math.max(1, Number(size) || 1);
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
  },

  _collectEventParticipantStats({ keyword, startDate, endDate, events, attendanceRecords }) {
    const normalizedKeyword = this._normalizeEventParticipantKeyword(keyword);
    const matchedEvents = (events || [])
      .map(event => {
        const eventId = event.id || event._docId || '';
        const title = String(event.title || '').trim();
        const startAt = this._parseEventParticipantDate(event.date);
        return {
          eventId,
          title,
          date: event.date || '',
          startAtMs: startAt ? startAt.getTime() : 0,
        };
      })
      .filter(event => event.eventId && event.title && this._normalizeEventParticipantKeyword(event.title).includes(normalizedKeyword))
      .sort((a, b) => b.startAtMs - a.startAtMs);

    if (!matchedEvents.length) {
      return {
        keyword,
        startDate,
        endDate,
        matchedEventCount: 0,
        matchedUserCount: 0,
        totalParticipationCount: 0,
        items: [],
      };
    }

    const eventMap = new Map(matchedEvents.map(event => [event.eventId, event]));
    const seen = new Set();
    const userMap = new Map();

    (attendanceRecords || []).forEach(record => {
      const eventId = String(record.eventId || '').trim();
      if (!eventMap.has(eventId)) return;
      if (String(record.status || '').trim() === 'removed' || String(record.status || '').trim() === 'cancelled') return;
      if (String(record.type || '').trim() !== 'checkin') return;

      const uid = String(record.uid || '').trim();
      if (!uid) return;

      const dedupeKey = `${uid}::${eventId}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      const event = eventMap.get(eventId);
      const userName = String(record.userName || uid).trim() || uid;
      const existing = userMap.get(uid) || {
        uid,
        userName,
        count: 0,
        latestParticipationDate: '',
        latestAtMs: 0,
        matchedEvents: [],
      };

      existing.count += 1;
      existing.matchedEvents.push({
        eventId,
        title: event.title,
        date: event.date,
        startAtMs: event.startAtMs,
      });
      if (event.startAtMs >= existing.latestAtMs) {
        existing.latestAtMs = event.startAtMs;
        existing.latestParticipationDate = event.date || '';
        existing.userName = userName;
      }
      userMap.set(uid, existing);
    });

    const items = [...userMap.values()]
      .map(item => ({
        uid: item.uid,
        userName: item.userName,
        count: item.count,
        latestParticipationDate: item.latestParticipationDate,
        matchedEvents: item.matchedEvents
          .sort((a, b) => b.startAtMs - a.startAtMs)
          .map(event => ({
            eventId: event.eventId,
            title: event.title,
            date: event.date,
          })),
        latestAtMs: item.latestAtMs,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.latestAtMs !== a.latestAtMs) return b.latestAtMs - a.latestAtMs;
        return String(a.userName || '').localeCompare(String(b.userName || ''), 'zh-Hant');
      })
      .map(({ latestAtMs, ...item }) => item);

    return {
      keyword,
      startDate,
      endDate,
      matchedEventCount: matchedEvents.length,
      matchedUserCount: items.length,
      totalParticipationCount: items.reduce((sum, item) => sum + item.count, 0),
      items,
    };
  },

  async queryEventParticipantStats(options = {}) {
    const keyword = String(options.keyword || '').trim();
    const startDate = String(options.startDate || '').trim();
    const endDate = String(options.endDate || '').trim();

    if (!keyword) throw new Error('請輸入活動關鍵字');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('請選擇有效的開始與結束日期');
    }

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('日期格式錯誤');
    }
    if (start > end) {
      throw new Error('開始日期不可晚於結束日期');
    }
    const rangeDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (rangeDays > 365) {
      throw new Error('單次查詢日期區間不可超過 365 天');
    }

    if (this._demoMode) {
      const demoEvents = this.getEvents().filter(event => {
        const eventStart = this._parseEventParticipantDate(event.date);
        return eventStart && eventStart >= start && eventStart <= new Date(`${endDate}T23:59:59`);
      });
      return this._collectEventParticipantStats({
        keyword,
        startDate,
        endDate,
        events: demoEvents,
        attendanceRecords: this._src('attendanceRecords'),
      });
    }

    const currentUser = this.getCurrentUser();
    if (!currentUser || !['admin', 'super_admin'].includes(String(currentUser.role || ''))) {
      throw new Error('只有管理者可以使用此查詢');
    }

    const startKey = startDate.replace(/-/g, '/');
    const endKey = endDate.replace(/-/g, '/') + '\uf8ff';
    const endAt = new Date(`${endDate}T23:59:59`);

    const eventSnap = await db.collection('events')
      .where('date', '>=', startKey)
      .where('date', '<=', endKey)
      .get({ source: 'server' });

    const rangedEvents = eventSnap.docs
      .map(doc => ({ ...doc.data(), _docId: doc.id, id: doc.data().id || doc.id }))
      .filter(event => {
        const eventStart = this._parseEventParticipantDate(event.date);
        return eventStart && eventStart >= start && eventStart <= endAt;
      });

    const matchedEvents = rangedEvents.filter(event =>
      this._normalizeEventParticipantKeyword(event.title).includes(this._normalizeEventParticipantKeyword(keyword))
    );

    if (!matchedEvents.length) {
      return {
        keyword,
        startDate,
        endDate,
        matchedEventCount: 0,
        matchedUserCount: 0,
        totalParticipationCount: 0,
        items: [],
      };
    }

    if (matchedEvents.length > 100) {
      throw new Error(`符合活動過多（${matchedEvents.length} 場），請縮小日期區間或提高關鍵字精準度`);
    }

    const eventIdChunks = this._chunkArray(matchedEvents.map(event => event.id).filter(Boolean), 10);
    const attendanceRecords = [];

    for (const chunk of eventIdChunks) {
      if (!chunk.length) continue;
      const snap = await db.collection('attendanceRecords')
        .where('eventId', 'in', chunk)
        .get({ source: 'server' });
      snap.docs.forEach(doc => attendanceRecords.push({ ...doc.data(), _docId: doc.id }));
    }

    return this._collectEventParticipantStats({
      keyword,
      startDate,
      endDate,
      events: matchedEvents,
      attendanceRecords,
    });
  },

  _normalizeParticipantQueryShareResult(result = {}) {
    const items = Array.isArray(result.items) ? result.items : [];
    return {
      keyword: String(result.keyword || '').trim(),
      startDate: String(result.startDate || '').trim(),
      endDate: String(result.endDate || '').trim(),
      matchedEventCount: Number(result.matchedEventCount || 0),
      matchedUserCount: Number(result.matchedUserCount || 0),
      totalParticipationCount: Number(result.totalParticipationCount || 0),
      items: items.map((item, index) => ({
        sortIndex: index + 1,
        userName: String(item.userName || item.uid || '未知使用者').trim() || '未知使用者',
        count: Number(item.count || 0),
        latestParticipationDate: String(item.latestParticipationDate || '').trim(),
        matchedEvents: Array.isArray(item.matchedEvents)
          ? item.matchedEvents.map(event => ({
            title: String(event?.title || '').trim(),
            date: String(event?.date || '').trim(),
          })).filter(event => event.title)
          : [],
      })),
    };
  },

  _assertAdminParticipantQueryShareAccess() {
    const currentUser = this.getCurrentUser();
    if (!currentUser || !['admin', 'super_admin'].includes(String(currentUser.role || ''))) {
      throw new Error('只有管理者可以建立臨時查詢報表');
    }
    return currentUser;
  },

  _buildParticipantQueryShareUrl(shareId) {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('rid', shareId);
    url.hash = 'page-temp-participant-report';
    return url.toString();
  },

  async createParticipantQueryShare(result, options = {}) {
    if (this._demoMode) {
      throw new Error('Demo 模式不支援臨時查詢報表');
    }

    this._assertAdminParticipantQueryShareAccess();
    const normalized = this._normalizeParticipantQueryShareResult(result);
    if (!normalized.keyword || !normalized.startDate || !normalized.endDate) {
      throw new Error('查詢條件不完整，無法建立臨時報表');
    }

    const expiresInDays = Math.max(1, Math.min(30, Number(options.expiresInDays || 7)));
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    const shareRef = db.collection('participantQueryShares').doc();

    const baseData = {
      reportType: 'event_participant_query',
      status: 'building',
      publicRead: true,
      keyword: normalized.keyword,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      matchedEventCount: normalized.matchedEventCount,
      matchedUserCount: normalized.matchedUserCount,
      totalParticipationCount: normalized.totalParticipationCount,
      itemCount: normalized.items.length,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    };

    await shareRef.set(baseData);

    try {
      for (let i = 0; i < normalized.items.length; i += 350) {
        const batch = db.batch();
        normalized.items.slice(i, i + 350).forEach(item => {
          const itemRef = shareRef.collection('shareItems').doc(String(item.sortIndex).padStart(4, '0'));
          batch.set(itemRef, {
            sortIndex: item.sortIndex,
            userName: item.userName,
            count: item.count,
            latestParticipationDate: item.latestParticipationDate,
            matchedEvents: item.matchedEvents,
            eventCount: item.matchedEvents.length,
            expiresAt,
          });
        });
        await batch.commit();
      }

      await shareRef.update({
        status: 'ready',
        readyAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error('[createParticipantQueryShare]', err);
      await shareRef.update({
        status: 'error',
        errorAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      throw new Error('建立臨時查詢報表失敗');
    }

    return {
      shareId: shareRef.id,
      url: this._buildParticipantQueryShareUrl(shareRef.id),
      expiresAt: expiresAt.toISOString(),
      expiresAtMs: expiresAt.getTime(),
    };
  },

  async getParticipantQueryShare(shareId) {
    if (this._demoMode) {
      throw new Error('Demo 模式不支援臨時查詢報表');
    }

    const safeShareId = String(shareId || '').trim();
    if (!safeShareId) {
      throw new Error('缺少報表識別碼');
    }

    const shareRef = db.collection('participantQueryShares').doc(safeShareId);
    let shareSnap;
    try {
      shareSnap = await shareRef.get({ source: 'server' });
    } catch (err) {
      if (err?.code === 'permission-denied') {
        throw new Error('此臨時報表已過期、失效或無法存取');
      }
      throw err;
    }
    if (!shareSnap.exists) {
      throw new Error('查無此臨時報表');
    }

    const share = shareSnap.data() || {};
    const expiresAt = share.expiresAt?.toDate ? share.expiresAt.toDate() : new Date(share.expiresAt || 0);
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      throw new Error('臨時報表資料已損壞');
    }
    if (share.status !== 'ready') {
      throw new Error('臨時報表尚未完成，請稍後再試');
    }
    if (Date.now() >= expiresAt.getTime()) {
      throw new Error('此臨時報表已過期');
    }

    let itemSnap;
    try {
      itemSnap = await shareRef.collection('shareItems')
        .orderBy('sortIndex', 'asc')
        .get({ source: 'server' });
    } catch (err) {
      if (err?.code === 'permission-denied') {
        throw new Error('此臨時報表已過期、失效或無法存取');
      }
      throw err;
    }

    return {
      shareId: safeShareId,
      keyword: String(share.keyword || '').trim(),
      startDate: String(share.startDate || '').trim(),
      endDate: String(share.endDate || '').trim(),
      matchedEventCount: Number(share.matchedEventCount || 0),
      matchedUserCount: Number(share.matchedUserCount || 0),
      totalParticipationCount: Number(share.totalParticipationCount || 0),
      itemCount: Number(share.itemCount || 0),
      expiresAt: expiresAt.toISOString(),
      items: itemSnap.docs.map(doc => {
        const data = doc.data() || {};
        return {
          sortIndex: Number(data.sortIndex || 0),
          userName: String(data.userName || '未知使用者').trim() || '未知使用者',
          count: Number(data.count || 0),
          latestParticipationDate: String(data.latestParticipationDate || '').trim(),
          matchedEvents: Array.isArray(data.matchedEvents)
            ? data.matchedEvents.map(event => ({
              title: String(event?.title || '').trim(),
              date: String(event?.date || '').trim(),
            })).filter(event => event.title)
            : [],
        };
      }),
    };
  },

  getCurrentUser() {
    if (this._demoMode) return (typeof DemoData !== 'undefined') ? DemoData.currentUser : null;
    return FirebaseService._cache.currentUser || null;
  },

  async loginUser(lineProfile) {
    if (this._demoMode) return (typeof DemoData !== 'undefined') ? DemoData.currentUser : null;
    return await FirebaseService.createOrUpdateUser(lineProfile);
  },

  updateCurrentUser(updates) {
    if (this._handleRestrictedAction()) return null;
    if (this._demoMode) {
      if (typeof DemoData !== 'undefined' && DemoData.currentUser) {
        Object.assign(DemoData.currentUser, updates);
        return DemoData.currentUser;
      }
      return null;
    }
    const user = FirebaseService._cache.currentUser;
    if (user) {
      Object.assign(user, updates);
      if (user._docId) {
        FirebaseService.updateUser(user._docId, updates).catch(err => console.error('[updateCurrentUser]', err));
      }
    }
    return user;
  },
};
