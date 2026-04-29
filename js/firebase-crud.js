/* ================================================
   SportHub — Firebase Service: CRUD Operations
   ================================================
   所有 Firestore 讀寫操作（Object.assign 擴充 FirebaseService）
   ================================================

   === Function Index ===
   L46:   _ensureAuth(expectedUid)
   L99:   saveRolePermissions / saveRolePermissionDefaults
   L119:  saveUserCorrection(uid, data)
   L138:  addCustomRole / addCustomRoleWithPermissions
   L188:  _getTournamentDocRefById / _getTournamentSubcollectionRef
   L205:  listTournamentApplications / createTournamentApplication
   L227:  updateTournamentApplication
   L237:  listTournamentEntries / upsertTournamentEntry
   L267:  listTournamentEntryMembers / upsertTournamentEntryMember / removeTournamentEntryMember
   L312:  addEvent(eventData) — 新增活動
   L330:  updateEvent(id, updates) — 更新活動
   L440:  addAttendanceRecord / removeAttendanceRecord / batchWriteAttendance
   L547:  _rebuildOccupancy(event, regs) — [LOCKED] 佔位重建純函式
   L596:  _applyRebuildOccupancy — 寫入快取
   L739:  registerForEvent(eventId, userId, userName) — [LOCKED] 單人報名
   L870:  cancelRegistration(registrationId) — [LOCKED] 取消報名+候補遞補
   L1031: addTournament / updateTournament
   L1070: addTeam / updateTeam
   L1659: addAchievement / updateAchievement / addBadge / updateBadge
   L1738: addAdminMessage / updateAdminMessage
   L1784: addMessage / updateMessage / clearAllMessages
   L1873: updateUserRole
   L1918: addOperationLog / addErrorLog
   L1966: batchRegisterForEvent(eventId, entries) — [LOCKED] 批次報名
   L2085: cancelCompanionRegistrations(regIds) — [LOCKED] 取消同行者
   L2340: saveUserAchievementProgress / loadUserAchievementProgress
   L2390: listEduGroups / createEduGroup / updateEduGroup
   L2434: listEduStudents / createEduStudent / updateEduStudent
   L2477: listEduCoursePlans / createEduCoursePlan / updateEduCoursePlan
   L2559: addEduAttendance / queryEduAttendance
   ================================================ */

Object.assign(FirebaseService, {

  /**
   * 確保 Firebase Auth 已登入，否則嘗試重新簽入。
   * 在所有需要 Firestore 寫入的關鍵流程（登入、報名等）前呼叫。
   */
  async _ensureAuth(expectedUid = null) {
    const hasExpectedUid = uid => !expectedUid || uid === expectedUid;
    console.log('[_ensureAuth] start, currentUser=', auth?.currentUser?.uid || 'null', 'expectedUid=', expectedUid || 'none');

    if (auth?.currentUser) {
      if (hasExpectedUid(auth.currentUser.uid)) {
        // Token 尚未過期時直接放行，避免每次都強制刷新（省一次網路往返）
        try {
          await auth.currentUser.getIdToken(false);
          console.log('[_ensureAuth] token ok (cached), uid=', auth.currentUser.uid);
          return true;
        } catch (e) {
          // Token 無效，嘗試強制刷新
          try {
            await auth.currentUser.getIdToken(true);
            console.log('[_ensureAuth] token refresh ok, uid=', auth.currentUser.uid);
            return true;
          } catch (e2) {
            console.warn('[_ensureAuth] token refresh failed:', e2.code, e2.message);
          }
        }
      } else {
        console.warn('[_ensureAuth] uid mismatch, current=', auth.currentUser.uid, 'expected=', expectedUid);
      }
    }

    if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
      console.log('[_ensureAuth] waiting Auth persistence restore...');
      try {
        await Promise.race([_firebaseAuthReadyPromise, new Promise(r => setTimeout(r, 5000))]);
      } catch (_) {}
      console.log('[_ensureAuth] after persistence, currentUser=', auth?.currentUser?.uid || 'null');
    }

    if (auth?.currentUser && hasExpectedUid(auth.currentUser.uid)) return true;

    console.log('[_ensureAuth] trying re-auth via appropriate sign-in method...');
    try {
      await this._signInWithAppropriateMethod(expectedUid);
    } catch (e) {
      console.error('[_ensureAuth] re-auth failed:', e.code || '', e.message);
    }

    const finalUid = auth?.currentUser?.uid || null;
    const ok = !!finalUid && hasExpectedUid(finalUid);
    console.log('[_ensureAuth] result=', ok, 'finalUid=', finalUid, 'expectedUid=', expectedUid || 'none');
    return ok;
  },

  // ════════════════════════════════
  //  Role Permissions CRUD
  // ════════════════════════════════

  async saveRolePermissions(roleKey, permissions) {
    const sanitizedPermissions = sanitizePermissionCodeList(permissions);
    await db.collection('rolePermissions').doc(roleKey).set({
      permissions: sanitizedPermissions,
      catalogVersion: ROLE_PERMISSION_CATALOG_VERSION,
    }, { merge: true });
  },

  async saveRolePermissionDefaults(roleKey, defaultPermissions) {
    const sanitizedDefaults = sanitizePermissionCodeList(defaultPermissions);
    await db.collection('rolePermissions').doc(roleKey).set({
      defaultPermissions: sanitizedDefaults,
      catalogVersion: ROLE_PERMISSION_CATALOG_VERSION,
    }, { merge: true });
  },

  async deleteRolePermissions(roleKey) {
    await db.collection('rolePermissions').doc(roleKey).delete();
  },

  async saveUserCorrection(uid, data) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) throw new Error('USER_CORRECTION_UID_REQUIRED');
    await db.collection('userCorrections').doc(safeUid).set({
      uid: safeUid,
      ..._stripDocId(data),
    }, { merge: true });
  },

  async deleteUserCorrection(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) throw new Error('USER_CORRECTION_UID_REQUIRED');
    await db.collection('userCorrections').doc(safeUid).delete();
  },

  // ════════════════════════════════
  //  Custom Roles CRUD
  // ════════════════════════════════

  async addCustomRole(data) {
    await db.collection('customRoles').doc(data.key).set(data, { merge: true });
    data._docId = data.key;
    return data;
  },

  async addCustomRoleWithPermissions(data, permissions = [], defaultPermissions = []) {
    const sanitizedPermissions = sanitizePermissionCodeList(permissions);
    const sanitizedDefaults = sanitizePermissionCodeList(defaultPermissions);
    const batch = db.batch();
    batch.set(db.collection('customRoles').doc(data.key), data, { merge: true });
    batch.set(db.collection('rolePermissions').doc(data.key), {
      permissions: sanitizedPermissions,
      defaultPermissions: sanitizedDefaults,
      catalogVersion: ROLE_PERMISSION_CATALOG_VERSION,
    }, { merge: true });
    await batch.commit();
    data._docId = data.key;
    return data;
  },

  async deleteCustomRole(key) {
    await db.collection('customRoles').doc(key).delete();
  },

  async deleteCustomRoleWithPermissions(key) {
    const batch = db.batch();
    batch.delete(db.collection('customRoles').doc(key));
    batch.delete(db.collection('rolePermissions').doc(key));
    await batch.commit();
  },

  async updateNotifTemplate(key, updates) {
    const doc = this._cache.notifTemplates.find(t => t.key === key);
    if (!doc) return null;
    const snapshot = JSON.parse(JSON.stringify(doc));
    Object.assign(doc, updates);
    try {
      await db.collection('notifTemplates').doc(key).update({
        ...updates,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      Object.keys(doc).forEach(k => delete doc[k]);
      Object.assign(doc, snapshot);
      console.error('[updateNotifTemplate]', err);
    }
    return doc;
  },

  _mapCollectionDocs(snapshot) {
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _docId: doc.id }));
  },

  async _getTournamentDocRefById(tournamentId) {
    const safeTournamentId = String(tournamentId || '').trim();
    if (!safeTournamentId) throw new Error('TOURNAMENT_ID_REQUIRED');

    const cached = this._cache.tournaments.find(t => t.id === safeTournamentId && t._docId);
    if (cached?._docId) return db.collection('tournaments').doc(cached._docId);

    const snapshot = await db.collection('tournaments').where('id', '==', safeTournamentId).limit(1).get();
    if (snapshot.empty) throw new Error('TOURNAMENT_DOC_NOT_FOUND');
    const doc = snapshot.docs[0];
    // Phase 2A §7.7：fallback 成功時注入快取，後續查詢不再需要 Firestore
    if (!this._cache.tournaments.find(t => t.id === safeTournamentId)) {
      this._cache.tournaments.push({ ...doc.data(), _docId: doc.id });
    }
    return doc.ref;
  },

  async _getTournamentSubcollectionRef(tournamentId, subcollectionName) {
    const tournamentRef = await this._getTournamentDocRefById(tournamentId);
    return tournamentRef.collection(subcollectionName);
  },

  async listTournamentApplications(tournamentId) {
    const collectionRef = await this._getTournamentSubcollectionRef(tournamentId, 'applications');
    const snapshot = await collectionRef.get();
    return this._mapCollectionDocs(snapshot);
  },

  async getTournamentApplication(tournamentId, applicationId) {
    const collectionRef = await this._getTournamentSubcollectionRef(tournamentId, 'applications');
    const safeApplicationId = String(applicationId || '').trim();
    if (!safeApplicationId) return null;
    const snapshot = await collectionRef.doc(safeApplicationId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data(), _docId: snapshot.id } : null;
  },

  async createTournamentApplication(tournamentId, data) {
    const collectionRef = await this._getTournamentSubcollectionRef(tournamentId, 'applications');
    const payload = (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentApplicationRecord === 'function')
      ? App._buildFriendlyTournamentApplicationRecord(data)
      : { ...data };
    const safeTeamId = String(payload.teamId || '').trim();
    const safeApplicationId = String(payload.id || '').trim();
    if (!safeTeamId || safeApplicationId !== `ta_${safeTeamId}`) {
      throw new Error('TOURNAMENT_APPLICATION_ID_MISMATCH');
    }
    const docRef = collectionRef.doc(payload.id);
    const writePayload = _stripDocId(payload);
    delete writePayload.reviewedAt;
    delete writePayload.reviewedByUid;
    delete writePayload.reviewedByName;
    await docRef.set({
      ...writePayload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    payload._docId = docRef.id;
    return payload;
  },

  async applyFriendlyTournamentAtomic(tournamentId, teamId) {
    await this.ensureAuthReadyForWrite();
    const callable = firebase.app().functions('asia-east1').httpsCallable('applyFriendlyTournament');
    const result = await callable({ tournamentId, teamId });
    return result.data;
  },

  async withdrawFriendlyTournamentTeamAtomic(tournamentId, teamId) {
    await this.ensureAuthReadyForWrite();
    const callable = firebase.app().functions('asia-east1').httpsCallable('withdrawFriendlyTournamentTeam');
    const result = await callable({ tournamentId, teamId });
    return result.data;
  },

  async updateTournamentApplication(tournamentId, applicationId, updates) {
    const collectionRef = await this._getTournamentSubcollectionRef(tournamentId, 'applications');
    const docRef = collectionRef.doc(String(applicationId || '').trim());
    await docRef.update({
      ..._stripDocId(updates),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { id: applicationId, ...updates, _docId: applicationId };
  },

  async reviewFriendlyTournamentApplicationAtomic(tournamentId, applicationId, action) {
    await this.ensureAuthReadyForWrite();
    const callable = firebase.app().functions('asia-east1').httpsCallable('reviewFriendlyTournamentApplication');
    const result = await callable({ tournamentId, applicationId, action });
    return result.data;
  },

  async removeFriendlyTournamentEntryAtomic(tournamentId, teamId) {
    await this.ensureAuthReadyForWrite();
    const callable = firebase.app().functions('asia-east1').httpsCallable('removeFriendlyTournamentEntry');
    const result = await callable({ tournamentId, teamId });
    return result.data;
  },

  async listTournamentEntries(tournamentId) {
    const collectionRef = await this._getTournamentSubcollectionRef(tournamentId, 'entries');
    const snapshot = await collectionRef.get();
    return this._mapCollectionDocs(snapshot);
  },

  async upsertTournamentEntry(tournamentId, teamId, data) {
    const collectionRef = await this._getTournamentSubcollectionRef(tournamentId, 'entries');
    const payload = (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentEntryRecord === 'function')
      ? App._buildFriendlyTournamentEntryRecord({ ...data, teamId: teamId || data?.teamId })
      : { ...data, teamId: teamId || data?.teamId };
    const safeTeamId = String(payload.teamId || '').trim();
    if (!safeTeamId) throw new Error('TOURNAMENT_ENTRY_TEAM_ID_REQUIRED');

    const docRef = collectionRef.doc(safeTeamId);
    const snapshot = await docRef.get();
    const record = {
      ..._stripDocId(payload),
      teamId: safeTeamId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (!snapshot.exists) {
      record.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      if (!record.approvedAt) record.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    await docRef.set(record, { merge: true });
    payload._docId = safeTeamId;
    return payload;
  },

  async listTournamentEntryMembers(tournamentId, teamId) {
    const entryRef = (await this._getTournamentSubcollectionRef(tournamentId, 'entries')).doc(String(teamId || '').trim());
    const snapshot = await entryRef.collection('members').get();
    return this._mapCollectionDocs(snapshot);
  },

  async upsertTournamentEntryMember(tournamentId, teamId, member) {
    const payload = (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentRosterMemberRecord === 'function')
      ? App._buildFriendlyTournamentRosterMemberRecord(member)
      : { ...member };
    const safeTeamId = String(teamId || '').trim();
    const safeUid = String(payload.uid || '').trim();
    if (!safeTeamId) throw new Error('TOURNAMENT_ENTRY_TEAM_ID_REQUIRED');
    if (!safeUid) throw new Error('TOURNAMENT_ENTRY_MEMBER_UID_REQUIRED');

    const entryRef = (await this._getTournamentSubcollectionRef(tournamentId, 'entries')).doc(safeTeamId);
    const memberRef = entryRef.collection('members').doc(safeUid);
    const snapshot = await memberRef.get();
    const record = {
      ..._stripDocId(payload),
      uid: safeUid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (!snapshot.exists) {
      record.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      if (!record.joinedAt) record.joinedAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    await memberRef.set(record, { merge: true });
    payload._docId = safeUid;
    return payload;
  },

  async joinFriendlyTournamentRosterAtomic(tournamentId, teamId) {
    await this.ensureAuthReadyForWrite();
    const callable = firebase.app().functions('asia-east1').httpsCallable('joinFriendlyTournamentRoster');
    const result = await callable({ tournamentId, teamId });
    return result.data;
  },

  async leaveFriendlyTournamentRosterAtomic(tournamentId) {
    await this.ensureAuthReadyForWrite();
    const callable = firebase.app().functions('asia-east1').httpsCallable('leaveFriendlyTournamentRoster');
    const result = await callable({ tournamentId });
    return result.data;
  },

  async removeTournamentEntryMember(tournamentId, teamId, memberUid) {
    const safeTeamId = String(teamId || '').trim();
    const safeUid = String(memberUid || '').trim();
    if (!safeTeamId || !safeUid) return false;
    const entryRef = (await this._getTournamentSubcollectionRef(tournamentId, 'entries')).doc(safeTeamId);
    await entryRef.collection('members').doc(safeUid).delete();
    return true;
  },

  // ════════════════════════════════
  //  Events CRUD
  // ════════════════════════════════

  async addEvent(eventData) {
    // 圖片上傳至 Storage
    if (eventData.image && eventData.image.startsWith('data:')) {
      eventData.image = await this._uploadImage(eventData.image, `events/${eventData.id}`);
    }
    // delegateUids 同步：確保 delegates → delegateUids 一致（team-split Rules 依賴此欄位）
    if (Array.isArray(eventData.delegates) && !eventData.delegateUids) {
      eventData.delegateUids = eventData.delegates.map(d => String(d.uid || '').trim()).filter(Boolean);
    }
    const docRef = await db.collection('events').add({
      ..._stripDocId(eventData),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    eventData._docId = docRef.id;
    return eventData;
  },

  async updateEvent(id, updates) {
    const doc = this._cache.events.find(e => e.id === id);
    if (!doc || !doc._docId) return null;
    if (typeof db === 'undefined' || !db) {
      console.error('[updateEvent] db 尚未初始化');
      throw new Error('Firebase 尚未準備就緒，請稍後再試');
    }
    if (updates.image && typeof updates.image === 'string' && updates.image.startsWith('data:')) {
      const uploadedUrl = await this._uploadImage(updates.image, `events/${id}`);
      if (uploadedUrl) updates.image = uploadedUrl;
      else delete updates.image;
    }
    // delegateUids 同步：若 delegates 被更新，同步計算 delegateUids
    if (Array.isArray(updates.delegates)) {
      updates.delegateUids = updates.delegates.map(d => String(d.uid || '').trim()).filter(Boolean);
    }
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('events').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteEvent(id) {
    const doc = this._cache.events.find(e => e.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('events').doc(doc._docId).delete();

    // 級聯清理：刪除該活動的報名、簽到紀錄
    const cleanupCollections = ['registrations', 'activityRecords', 'attendanceRecords', 'registrationLocks'];
    for (const colName of cleanupCollections) {
      try {
        const snap = await db.collection(colName).where('eventId', '==', id).get();
        if (snap.empty) continue;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        // 同步本地快取
        if (Array.isArray(this._cache[colName])) {
          this._cache[colName] = this._cache[colName].filter(r => r.eventId !== id);
        }
      } catch (err) {
        console.warn(`[deleteEvent] cleanup ${colName} failed:`, err);
      }
    }

    return true;
  },

  async loadMyEventTemplates(ownerUid) {
    if (!ownerUid) return [];
    const snap = await db.collection('eventTemplates')
      .where('ownerUid', '==', ownerUid)
      .limit(100)
      .get();
    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      const n = new Date(v).getTime();
      return Number.isFinite(n) ? n : 0;
    };
    const docs = snap.docs
      .map(doc => ({ ...doc.data(), _docId: doc.id }))
      .sort((a, b) => {
        const bt = toMillis(b.updatedAt) || toMillis(b.createdAt);
        const at = toMillis(a.updatedAt) || toMillis(a.createdAt);
        return bt - at;
      });
    this._cache.eventTemplates = docs;
    this._saveToLS('eventTemplates', docs);
    return docs;
  },

  async addEventTemplate(templateData) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) {
      throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    }
    const writeData = { ..._stripDocId(templateData) };
    if (writeData.image && typeof writeData.image === 'string' && writeData.image.startsWith('data:')) {
      const uploaded = await this._uploadImage(writeData.image, `eventTemplates/${writeData.ownerUid || writeData.id}`);
      if (uploaded) writeData.image = uploaded;
      else delete writeData.image;
    }
    const docRef = await db.collection('eventTemplates').add({
      ...writeData,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    templateData._docId = docRef.id;
    if (writeData.image !== undefined) templateData.image = writeData.image;
    return templateData;
  },

  async deleteEventTemplate(id) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) {
      throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    }
    const templates = this._cache.eventTemplates || [];
    const doc = templates.find(t => t.id === id) || templates.find(t => t._docId === id);
    if (!doc || !doc._docId) {
      throw new Error('EVENT_TEMPLATE_NOT_FOUND: id=' + id);
    }
    await db.collection('eventTemplates').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Attendance Records（簽到/簽退）
  // ════════════════════════════════

  async addAttendanceRecord(data) {
    const eventDocId = await this._getEventDocIdAsync(data.eventId);
    if (!eventDocId) throw new Error('無法取得活動文件 ID: ' + data.eventId);
    const docRef = db.collection('events').doc(eventDocId).collection('attendanceRecords').doc();
    await docRef.set({
      ..._stripDocId(data),
      status: data.status || 'active',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async removeAttendanceRecord(record) {
    const inCache = this._cache.attendanceRecords.find(r => r.id === record.id);
    const target = record._docId ? record : inCache;
    if (target && target._docId) {
      const updates = {
        status: 'removed',
        removedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (typeof auth !== 'undefined' && auth?.currentUser?.uid) {
        updates.removedByUid = auth.currentUser.uid;
      }
      const eventDocId = await this._getEventDocIdAsync(target.eventId || record.eventId);
      if (!eventDocId) throw new Error('無法取得活動文件 ID: ' + (target.eventId || record.eventId));
      await db.collection('events').doc(eventDocId).collection('attendanceRecords').doc(target._docId).update(updates);
    }

    if (inCache) {
      inCache.status = 'removed';
      inCache.removedAt = new Date().toISOString();
    } else {
      const idx = this._cache.attendanceRecords.findIndex(r => r.id === record.id);
      if (idx !== -1) {
        this._cache.attendanceRecords[idx].status = 'removed';
        this._cache.attendanceRecords[idx].removedAt = new Date().toISOString();
      }
    }
    this._saveToLS('attendanceRecords', this._cache.attendanceRecords);
  },

  /**
   * 批次寫入出席紀錄（Firestore batch：原子性，全部成功或全部失敗）
   * @param {Array} adds - 要新增的紀錄陣列
   * @param {Array} removes - 要軟刪除的紀錄陣列（需有 id，有 _docId 才寫 Firestore）
   */
  async batchWriteAttendance(adds, removes) {
    // 預先解析 eventDocIds（子集合寫入必要）
    const eventDocIdMap = {};
    for (const _r of adds) {
      if (_r.eventId && !(_r.eventId in eventDocIdMap)) {
        eventDocIdMap[_r.eventId] = await this._getEventDocIdAsync(_r.eventId);
        if (!eventDocIdMap[_r.eventId]) throw new Error('無法取得活動文件 ID: ' + _r.eventId);
      }
    }
    for (const _r of removes) {
      const _eid = _r.eventId || (this._cache.attendanceRecords.find(function(x) { return x.id === _r.id; }) || {}).eventId;
      if (_eid && !(_eid in eventDocIdMap)) {
        eventDocIdMap[_eid] = await this._getEventDocIdAsync(_eid);
        if (!eventDocIdMap[_eid]) throw new Error('無法取得活動文件 ID: ' + _eid);
      }
    }

    const batch = db.batch();

    // 新增紀錄：預先產生 docId
    for (const record of adds) {
      const docRef = db.collection('events').doc(eventDocIdMap[record.eventId]).collection('attendanceRecords').doc();
      record._docId = docRef.id;
      batch.set(docRef, {
        ..._stripDocId(record),
        status: record.status || 'active',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 軟刪除紀錄：update status='removed'
    const removedDocIds = new Set();
    const removeUpdates = {
      status: 'removed',
      removedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (typeof auth !== 'undefined' && auth?.currentUser?.uid) {
      removeUpdates.removedByUid = auth.currentUser.uid;
    }
    for (const record of removes) {
      const inCache = this._cache.attendanceRecords.find(r => r.id === record.id);
      const target = record._docId ? record : inCache;
      if (target && target._docId && !removedDocIds.has(target._docId)) {
        removedDocIds.add(target._docId);
        const _eid = target.eventId || record.eventId || (inCache || {}).eventId;
        batch.update(
          db.collection('events').doc(eventDocIdMap[_eid]).collection('attendanceRecords').doc(target._docId),
          removeUpdates
        );
      } else if (!target?._docId) {
        console.warn('[batchWriteAttendance] record missing _docId, skipping remove:', record.id);
      }
    }

    // 原子提交
    await batch.commit();

    // commit 成功 → 更新本地快取
    const source = this._cache.attendanceRecords;
    for (const record of removes) {
      const inCache = source.find(r => r.id === record.id);
      if (inCache) {
        inCache.status = 'removed';
        inCache.removedAt = new Date().toISOString();
      }
    }
    for (const record of adds) {
      source.push(record);
    }
    this._saveToLS('attendanceRecords', source);
  },

  // ════════════════════════════════
  //  Registrations（報名系統）
  // ════════════════════════════════

  /**
   * 統一佔位重建：以 registrations 為唯一真實來源，重建 event 投影欄位。
   * @param {Object} event - 活動物件（需有 max, status）
   * @param {Array} registrations - 該活動所有有效 registrations（含 confirmed/waitlisted）
   * @returns {Object} { participants, waitlistNames, current, waitlist, status }
   */
  _getRegistrationUniqueKey(reg = {}) {
    const userId = String(reg.userId || '').trim();
    if (reg.participantType === 'companion') {
      return `${userId}_companion_${String(reg.companionId || '').trim()}`;
    }
    return `${userId}_self`;
  },

  _getRegistrationLockId(reg = {}) {
    const encode = (value) => encodeURIComponent(String(value || '').trim() || '_');
    if (reg.participantType === 'companion') {
      return `companion_${encode(reg.userId)}_${encode(reg.companionId)}`;
    }
    return `self_${encode(reg.userId)}`;
  },

  _dedupeRegistrations(registrations = []) {
    const seen = new Set();
    return (Array.isArray(registrations) ? registrations : []).filter(r => {
      const key = this._getRegistrationUniqueKey(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  _countUniqueConfirmedRegistrations(registrations = []) {
    return this._dedupeRegistrations(
      (Array.isArray(registrations) ? registrations : []).filter(r => r.status === 'confirmed')
    ).length;
  },

  _normalizeTeamReservationSummaries(eventOrSummaries = {}) {
    const raw = Array.isArray(eventOrSummaries)
      ? eventOrSummaries
      : (Array.isArray(eventOrSummaries?.teamReservationSummaries) ? eventOrSummaries.teamReservationSummaries : []);
    const seen = new Set();
    return raw.map(item => {
      const teamId = String(item?.teamId || item?.id || '').trim();
      if (!teamId || seen.has(teamId)) return null;
      seen.add(teamId);
      const reservedSlotsRaw = Number(item?.reservedSlots || item?.slots || 0);
      const reservedSlots = Number.isFinite(reservedSlotsRaw) ? Math.max(0, Math.trunc(reservedSlotsRaw)) : 0;
      const usedSlotsRaw = Number(item?.usedSlots || 0);
      const usedSlots = Number.isFinite(usedSlotsRaw) ? Math.max(0, Math.trunc(usedSlotsRaw)) : 0;
      return {
        teamId,
        teamName: String(item?.teamName || item?.name || teamId).trim(),
        reservedSlots,
        usedSlots,
        remainingSlots: Math.max(0, reservedSlots - usedSlots),
        occupiedSlots: Math.max(reservedSlots, usedSlots),
        updatedAt: item?.updatedAt || null,
        updatedByUid: item?.updatedByUid || null,
        updatedByName: item?.updatedByName || null,
      };
    }).filter(Boolean);
  },

  _getRegistrationTeamReservationTeamId(reg = {}) {
    return String(reg.teamReservationTeamId || reg.teamReservationId || '').trim();
  },

  _getUserTeamIdSetForReservation(userData = {}) {
    const ids = new Set();
    const add = (value) => {
      const safeValue = String(value || '').trim();
      if (safeValue) ids.add(safeValue);
    };
    if (typeof App !== 'undefined' && typeof App._getUserTeamIds === 'function') {
      App._getUserTeamIds(userData).forEach(add);
    }
    if (Array.isArray(userData.teamIds)) userData.teamIds.forEach(add);
    add(userData.teamId);
    const uid = String(userData.uid || userData.lineUserId || userData._docId || '').trim();
    const name = String(userData.name || userData.displayName || '').trim();
    const users = (typeof ApiService !== 'undefined' && ApiService.getAdminUsers) ? (ApiService.getAdminUsers() || []) : [];
    const match = users.find(u =>
      (uid && (u.uid === uid || u.lineUserId === uid || u._docId === uid)) ||
      (name && (u.name === name || u.displayName === name))
    );
    if (match) {
      if (Array.isArray(match.teamIds)) match.teamIds.forEach(add);
      add(match.teamId);
    }
    return ids;
  },

  _findTeamReservationForUser(eventData = {}, userData = {}) {
    const userTeamIds = this._getUserTeamIdSetForReservation(userData);
    if (!userTeamIds.size) return null;
    const summaries = this._normalizeTeamReservationSummaries(eventData)
      .filter(item => item.reservedSlots > 0 || item.usedSlots > 0);
    return summaries.find(item => userTeamIds.has(item.teamId)) || null;
  },

  _applyTeamReservationFields(registration, reservation, source) {
    if (!registration || !reservation) return registration;
    registration.teamReservationTeamId = reservation.teamId;
    registration.teamReservationTeamName = reservation.teamName || reservation.teamId;
    registration.teamSeatSource = source || 'reserved';
    return registration;
  },

  _decideRegistrationSeat(eventData, activeRegs, registration, userData = {}) {
    const maxCount = Math.max(0, Number(eventData?.max || 0) || 0);
    const reservation = registration?.participantType === 'companion'
      ? null
      : this._findTeamReservationForUser(eventData, userData);
    const occupancyBefore = this._rebuildOccupancy(eventData, activeRegs || []);
    let status = 'waitlisted';
    let source = null;

    if (reservation) {
      const summary = (occupancyBefore.teamReservationSummaries || []).find(item => item.teamId === reservation.teamId) || reservation;
      const usedSlots = Math.max(0, Number(summary.usedSlots || 0) || 0);
      const reservedSlots = Math.max(0, Number(summary.reservedSlots || 0) || 0);
      if (usedSlots < reservedSlots) {
        status = 'confirmed';
        source = 'reserved';
      } else if (occupancyBefore.current < maxCount) {
        status = 'confirmed';
        source = 'overflow';
      } else {
        source = 'waitlist';
      }
      this._applyTeamReservationFields(registration, reservation, source);
    } else if (occupancyBefore.current < maxCount) {
      status = 'confirmed';
    }

    registration.status = status;
    return { status, reservation, source, occupancyBefore };
  },

  _sortWaitlistCandidates(regs = []) {
    const _sortTime = (r) => {
      const v = r && r.registeredAt;
      if (!v) return Number.POSITIVE_INFINITY;
      if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_e) {} }
      if (typeof v === 'object' && typeof v.seconds === 'number')
        return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    return (Array.isArray(regs) ? regs : []).slice().sort((a, b) => {
      const ta = _sortTime(a), tb = _sortTime(b);
      if (ta !== tb) return ta - tb;
      const pa = Number(a.promotionOrder || 0), pb = Number(b.promotionOrder || 0);
      if (pa !== pb) return pa - pb;
      return String(a._docId || a.id || '').localeCompare(String(b._docId || b.id || ''));
    });
  },

  _promoteWaitlistForAvailableSeats(eventData, simRegs = []) {
    const promoted = [];
    const maxCount = Math.max(0, Number(eventData?.max || 0) || 0);

    while (true) {
      const activeRegs = simRegs.filter(r => r.status === 'confirmed' || r.status === 'waitlisted');
      const occupancy = this._rebuildOccupancy(eventData, activeRegs);
      const summaries = occupancy.teamReservationSummaries || [];
      const waitlisted = this._sortWaitlistCandidates(activeRegs.filter(r => r.status === 'waitlisted'));
      let candidateToPromote = null;
      let source = null;

      for (const candidate of waitlisted) {
        const teamId = this._getRegistrationTeamReservationTeamId(candidate);
        if (!teamId) continue;
        const summary = summaries.find(item => item.teamId === teamId);
        if (summary && Number(summary.remainingSlots || 0) > 0) {
          candidateToPromote = candidate;
          source = 'reserved';
          break;
        }
      }

      if (!candidateToPromote && occupancy.current < maxCount) {
        candidateToPromote = waitlisted[0] || null;
        if (candidateToPromote && this._getRegistrationTeamReservationTeamId(candidateToPromote)) {
          source = 'overflow';
        }
      }

      if (!candidateToPromote) break;
      candidateToPromote.status = 'confirmed';
      if (source && this._getRegistrationTeamReservationTeamId(candidateToPromote)) {
        candidateToPromote.teamSeatSource = source;
      }
      promoted.push(candidateToPromote);
    }

    return promoted;
  },

  _rebuildOccupancy(event, registrations) {
    // 去重：同一 (userId, participantType, companionId) 只保留最早報名的那筆
    const confirmed = this._dedupeRegistrations(registrations.filter(r => r.status === 'confirmed'));
    const waitlisted = this._dedupeRegistrations(registrations.filter(r => r.status === 'waitlisted'));

    // 排序：確保 participants / waitlistNames 順序一致（registeredAt ASC → docId ASC）
    const _regSortTime = (r) => {
      const v = r && r.registeredAt;
      if (!v) return Number.POSITIVE_INFINITY;
      if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_e) {} }
      if (typeof v === 'object' && typeof v.seconds === 'number')
        return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    const _regSort = (a, b) => {
      const ta = _regSortTime(a), tb = _regSortTime(b);
      if (ta !== tb) return ta - tb;
      return String(a._docId || a.id || '').localeCompare(String(b._docId || b.id || ''));
    };
    confirmed.sort(_regSort);
    waitlisted.sort(_regSort);

    const participants = confirmed.map(r =>
      r.participantType === 'companion'
        ? String(r.companionName || r.userName || '').trim()
        : String(r.userName || '').trim()
    ).filter(Boolean);

    const waitlistNames = waitlisted.map(r =>
      r.participantType === 'companion'
        ? String(r.companionName || r.userName || '').trim()
        : String(r.userName || '').trim()
    ).filter(Boolean);

    // ⚠️ 雙端同步：此函式與 functions/index.js rebuildOccupancy 必須邏輯一致
    //    修改任一端時必須手動 review 另一端
    //    Phase 1（2026-04-19）新增 participantsWithUid / waitlistWithUid 擴充回傳
    const teamReservations = this._normalizeTeamReservationSummaries(event);
    const reservationByTeamId = new Map(teamReservations.map(item => [item.teamId, item]));
    const usedSlotsByTeamId = new Map();
    confirmed.forEach(r => {
      const teamId = this._getRegistrationTeamReservationTeamId(r);
      if (!teamId || !reservationByTeamId.has(teamId)) return;
      usedSlotsByTeamId.set(teamId, (usedSlotsByTeamId.get(teamId) || 0) + 1);
    });
    const teamReservationSummaries = teamReservations.map(item => {
      const usedSlots = usedSlotsByTeamId.get(item.teamId) || 0;
      const reservedSlots = Math.max(0, Number(item.reservedSlots || 0) || 0);
      return {
        ...item,
        reservedSlots,
        usedSlots,
        remainingSlots: Math.max(0, reservedSlots - usedSlots),
        occupiedSlots: Math.max(reservedSlots, usedSlots),
      };
    }).filter(item => item.reservedSlots > 0 || item.usedSlots > 0);

    const _buildWuEntry = (r) => {
      const isComp = r.participantType === 'companion';
      const uid = isComp
        ? String(r.companionId || (r.userId ? `${r.userId}_${r.companionName || ''}` : '')).trim()
        : String(r.userId || '').trim();
      const name = isComp
        ? String(r.companionName || r.userName || '').trim()
        : String(r.userName || '').trim();
      const teamReservationTeamId = this._getRegistrationTeamReservationTeamId(r);
      const teamReservation = teamReservationTeamId ? reservationByTeamId.get(teamReservationTeamId) : null;
      return {
        uid,
        name,
        teamKey: r.teamKey || null,
        teamReservationTeamId: teamReservationTeamId || null,
        teamReservationTeamName: r.teamReservationTeamName || teamReservation?.teamName || null,
        teamSeatSource: r.teamSeatSource || null,
      };
    };
    const _isValidWu = (x) => x.uid && x.name && !x.uid.endsWith('_');
    const participantsWithUid = confirmed.map(_buildWuEntry).filter(_isValidWu);
    const waitlistWithUid = waitlisted.map(_buildWuEntry).filter(_isValidWu);

    const realCurrent = participants.length;
    const current = realCurrent + teamReservationSummaries.reduce(
      (sum, item) => sum + Math.max(0, Number(item.remainingSlots || 0) || 0),
      0
    );
    const waitlist = waitlistNames.length;

    // status: ended/cancelled 不變；current >= max → full；否則 → open
    let status = event.status;
    if (status !== 'ended' && status !== 'cancelled') {
      status = current >= (event.max || 0) ? 'full' : 'open';
    }

    return {
      participants, waitlistNames, current, realCurrent, waitlist, status,
      participantsWithUid, waitlistWithUid, teamReservationSummaries,
    };
  },

  /**
   * 將 _rebuildOccupancy 結果寫入 event 物件（本地快取）
   */
  _applyRebuildOccupancy(event, occupancy) {
    event.participants = occupancy.participants;
    event.waitlistNames = occupancy.waitlistNames;
    event.participantsWithUid = occupancy.participantsWithUid;
    event.waitlistWithUid = occupancy.waitlistWithUid;
    event.current = occupancy.current;
    event.realCurrent = occupancy.realCurrent;
    event.waitlist = occupancy.waitlist;
    event.status = occupancy.status;
    event.teamReservationSummaries = occupancy.teamReservationSummaries || [];
  },

  _getEventOccupancyState(eventData = {}) {
    const fallbackCurrent = Math.max(0, Number(eventData.current || 0) || 0);
    const fallbackWaitlist = Math.max(0, Number(eventData.waitlist || 0) || 0);
    const hasParticipantArray = Array.isArray(eventData.participants);
    const hasWaitlistArray = Array.isArray(eventData.waitlistNames);
    const participantSet = new Set();
    const waitlistSet = new Set();
    const participants = [];
    const waitlistNames = [];

    if (hasParticipantArray) {
      eventData.participants.forEach(name => {
        const safeName = String(name || '').trim();
        if (!safeName || participantSet.has(safeName)) return;
        participantSet.add(safeName);
        participants.push(safeName);
      });
    }

    if (hasWaitlistArray) {
      eventData.waitlistNames.forEach(name => {
        const safeName = String(name || '').trim();
        if (!safeName || participantSet.has(safeName) || waitlistSet.has(safeName)) return;
        waitlistSet.add(safeName);
        waitlistNames.push(safeName);
      });
    }

    return {
      hasParticipantArray,
      hasWaitlistArray,
      participants,
      waitlistNames,
      current: hasParticipantArray ? participants.length : fallbackCurrent,
      waitlist: hasWaitlistArray ? waitlistNames.length : fallbackWaitlist,
    };
  },

  _applyEventOccupancyState(eventData, occupancy = null) {
    if (!eventData) return null;
    const state = occupancy || this._getEventOccupancyState(eventData);
    eventData.current = state.current;
    eventData.waitlist = state.waitlist;
    if (state.hasParticipantArray) eventData.participants = state.participants;
    if (state.hasWaitlistArray) eventData.waitlistNames = state.waitlistNames;
    return state;
  },

  _getEventRegOpenDate(eventData) {
    if (!eventData?.regOpenTime) return null;
    const regOpen = new Date(eventData.regOpenTime);
    return Number.isNaN(regOpen.getTime()) ? null : regOpen;
  },

  _getEventStartDate(eventData) {
    const startDate = App._parseEventStartDate?.(eventData?.date);
    return startDate instanceof Date && !Number.isNaN(startDate.getTime()) ? startDate : null;
  },

  async _assertEventSignupOpen(eventData) {
    if (!eventData) throw new Error('\u6d3b\u52d5\u4e0d\u5b58\u5728');

    const now = new Date();
    if (eventData.status === 'cancelled') {
      throw new Error('\u6d3b\u52d5\u5df2\u53d6\u6d88');
    }

    const startDate = this._getEventStartDate(eventData);
    if (startDate && startDate <= now) {
      if (eventData.status !== 'ended' && eventData.status !== 'cancelled') {
        eventData.status = 'ended';
        eventData.feeEnabled = false;
        if (eventData._docId) {
          try {
            await db.collection('events').doc(eventData._docId).update({ status: 'ended', feeEnabled: false });
          } catch (err) {
            console.warn('[eventSignupGuard] sync ended status failed:', err);
          }
        }
        this._saveToLS('events', this._cache.events);
      }
      throw new Error('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u5831\u540d\u5df2\u7d50\u675f');
    }

    if (eventData.status === 'ended') {
      throw new Error('\u6d3b\u52d5\u5831\u540d\u5df2\u7d50\u675f');
    }

    const regOpenDate = this._getEventRegOpenDate(eventData);
    if (regOpenDate && regOpenDate > now) {
      throw new Error('\u5831\u540d\u5c1a\u672a\u958b\u653e\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    }
  },

  /**
   * 報名成功後，背景寫入用戶徽章到 registration 文件
   * 在 transaction 外執行，失敗不影響報名
   */
  async _writeDisplayBadgesToReg(regDocId) {
    try {
      if (typeof App === 'undefined') return;
      // 等待 achievement 模組（最多 3 秒）
      let ab = App._getAchievementBadges?.();
      if (!ab) {
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 500));
          ab = App._getAchievementBadges?.();
          if (ab) break;
        }
      }
      if (!ab || !ab.getCurrentUserEarnedBadgeViewModels) return;
      const earned = ab.getCurrentUserEarnedBadgeViewModels();
      if (!earned || !earned.length) return;
      const displayBadges = earned.map(item => ({
        id: item.badge?.id || '',
        name: item.badge?.name || '',
        image: item.badge?.image || '',
      })).filter(b => b.image);
      if (!displayBadges.length) return;
      const _bdReg = this._cache.registrations.find(function(r) { return r._docId === regDocId; });
      if (_bdReg && _bdReg.eventId) {
        const _bdEventDocId = await this._getEventDocIdAsync(_bdReg.eventId);
        if (_bdEventDocId) {
          await db.collection('events').doc(_bdEventDocId).collection('registrations').doc(regDocId).update({ displayBadges });
        }
      }
      // 同步本地快取
      const cached = this._cache.registrations.find(r => r._docId === regDocId);
      if (cached) cached.displayBadges = displayBadges;
    } catch (err) {
      console.warn('[Registration] displayBadges write failed (non-critical):', err);
    }
  },

  /**
   * [LOCKED] 單人報名 — Firestore transaction 原子操作
   * @param {string} eventId - 活動 ID
   * @param {string} userId - 報名者 LINE userId
   * @param {string} userName - 報名者顯示名稱
   * @param {string|null} teamKey - 分隊 key（分隊模式時）
   */
  async registerForEvent(eventId, userId, userName, teamKey = null) {
    if (!userId || userId === 'unknown') throw new Error('用戶資料載入中，請稍候再試');

    // Plan C：個人資料完整度前置檢查（⚠️ 鎖定函式 pre-check：不觸碰 transaction/佔位邏輯）
    var _cu = typeof ApiService !== 'undefined' && ApiService.getCurrentUser?.();
    if (_cu && (!_cu.gender || !_cu.birthday || !_cu.region)) {
      throw new Error('PROFILE_INCOMPLETE');
    }

    // 模組層 busy lock（防止同一活動同時多次報名）
    this._signupBusyMap = this._signupBusyMap || {};
    const busyKey = eventId + '_' + userId;
    if (this._signupBusyMap[busyKey]) throw new Error('報名處理中，請稍候');
    this._signupBusyMap[busyKey] = true;

    try {
      return await this._doRegisterForEvent(eventId, userId, userName, teamKey);
    } finally {
      delete this._signupBusyMap[busyKey];
    }
  },

  async _doRegisterForEvent(eventId, userId, userName, teamKey) {
    // v8 Blocker 2 Part 3：身分一致性最後防線（寫入層、Tier 2 換帳號防污染）
    // 傳 expectedUid 讓 _ensureAuth 比對、並在 transaction 前再 assert 一次
    const authed = await this._ensureAuth(userId);
    if (!authed) {
      throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    }
    if (auth.currentUser.uid !== userId) {
      throw new Error('身分不一致、請重新登入');
    }
    console.log('[registerForEvent] auth OK, uid:', auth.currentUser?.uid, 'userId:', userId);

    const event = this._cache.events.find(e => e.id === eventId);
    if (!event) throw new Error('活動不存在');

    await this._assertEventSignupOpen(event);

    // 快取層重複檢查（含 participantType == 'self'）
    const existing = this._cache.registrations.find(
      r => r.eventId === eventId && r.userId === userId
        && r.participantType !== 'companion'
        && r.status !== 'cancelled' && r.status !== 'removed'
    );
    if (existing) throw new Error('已報名此活動');

    const registration = {
      id: generateId('reg_'),
      eventId,
      userId,
      userName,
      participantType: 'self',
      promotionOrder: 0,
      registeredAt: new Date().toISOString(),
    };
    const eventRef = db.collection('events').doc(event._docId);
    const regDocRef = eventRef.collection('registrations').doc();
    const lockId = this._getRegistrationLockId(registration);
    const lockRef = eventRef.collection('registrationLocks').doc(lockId);

    const result = await db.runTransaction(async (transaction) => {
      // 原子讀取活動最新狀態
      const eventDoc = await transaction.get(eventRef);
      if (!eventDoc.exists) throw new Error('活動不存在');
      const ed = eventDoc.data();
      const maxCount = ed.max || 0;

      // 每次 transaction 嘗試都重新查詢 registrations（子集合直接查詢，強制走伺服器）
      const allRegsSnap = await db.collection('events').doc(event._docId)
        .collection('registrations')
        .get({ source: 'server' });
      const allEventRegs = allRegsSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
      const lockDoc = await transaction.get(lockRef);
      if (lockDoc.exists) throw new Error('撌脣?迨瘣餃?');

      // 防幽靈：在 transaction 內再次檢查重複報名
      const hasActive = allEventRegs.some(r =>
        r.userId === userId
        && (r.status === 'confirmed' || r.status === 'waitlisted')
        && r.participantType !== 'companion'
      );
      if (hasActive) throw new Error('已報名此活動');

      const firestoreActiveRegs = allEventRegs.filter(
        r => r.status !== 'cancelled' && r.status !== 'removed'
      );

      const currentUserData = (typeof ApiService !== 'undefined' && ApiService.getCurrentUser)
        ? (ApiService.getCurrentUser() || {})
        : { uid: userId };
      const seatDecision = this._decideRegistrationSeat(
        { ...ed, id: eventId, max: maxCount },
        firestoreActiveRegs,
        registration,
        currentUserData
      );
      const status = seatDecision.status;

      // team-split: 解析 teamKey（random 模式在此分配）
      let resolvedTeamKey = teamKey;
      if (resolvedTeamKey === null && ed.teamSplit?.enabled && ed.teamSplit?.mode === 'random') {
        resolvedTeamKey = typeof App !== 'undefined' && App._resolveTeamKey
          ? App._resolveTeamKey({ teamSplit: ed.teamSplit, max: maxCount }, allEventRegs)
          : null;
      }
      if (resolvedTeamKey !== undefined) registration.teamKey = resolvedTeamKey;

      transaction.set(regDocRef, {
        ..._stripDocId(registration),
        registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      transaction.set(lockRef, {
        key: lockId,
        eventId,
        userId,
        participantType: 'self',
        companionId: null,
        registrationDocId: regDocRef.id,
        status: 'active',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // 用 Firestore 真實資料 + 新報名重建投影
      const allRegsForRebuild = [...firestoreActiveRegs, registration];
      const occupancy = this._rebuildOccupancy({ ...ed, max: maxCount, status: ed.status }, allRegsForRebuild);

      transaction.update(eventRef, {
        current: occupancy.current,
        realCurrent: occupancy.realCurrent,
        waitlist: occupancy.waitlist,
        participants: occupancy.participants,
        waitlistNames: occupancy.waitlistNames,
        participantsWithUid: occupancy.participantsWithUid,
        waitlistWithUid: occupancy.waitlistWithUid,
        teamReservationSummaries: occupancy.teamReservationSummaries,
        schemaVersion: 2,
        status: occupancy.status,
      });

      return { status, occupancy };
    });

    // Transaction 成功後更新本地快取
    registration._docId = regDocRef.id;
    registration.status = result.status;
    this._cache.registrations.push(registration);
    this._applyRebuildOccupancy(event, result.occupancy);

    console.log('[registerForEvent] transaction OK, docId:', regDocRef.id, 'status:', result.status);

    this._saveToLS('registrations', this._cache.registrations);
    this._saveToLS('events', this._cache.events);

    // 背景寫入徽章（不阻塞報名流程）
    this._writeDisplayBadgesToReg(regDocRef.id);

    return { registration, status: result.status };
  },

  /**
   * [LOCKED] 取消報名 + 候補遞補 — 模擬模式先算再 commit
   * @param {string} registrationId - registration doc ID
   */
  async cancelRegistration(registrationId) {
    // v8 Blocker 2 Part 3：身分一致性（取消只能取消自己的報名、Tier 2 換帳號防污染）
    const reg = this._cache.registrations.find(r => r.id === registrationId);
    if (!reg) throw new Error('報名記錄不存在');
    const authed = await this._ensureAuth(reg.userId);
    if (!authed) {
      throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    }
    if (auth.currentUser?.uid !== reg.userId) {
      throw new Error('身分不一致、無法取消他人報名');
    }

    const wasPreviouslyConfirmed = reg.status === 'confirmed';
    const event = this._cache.events.find(e => e.id === reg.eventId);

    // 從 Firestore 查詢該活動所有報名（不依賴快取）
    let firestoreRegs = [];
    if (event) {
      try {
        const snap = await db.collection('events').doc(event._docId)
          .collection('registrations')
          .get();
        firestoreRegs = snap.docs.map(d => {
          const data = d.data();
          return {
            ...data,
            _docId: d.id,
            registeredAt: data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt,
          };
        });
      } catch (err) {
        console.warn('[cancelRegistration] Firestore 查詢失敗，fallback 用快取:', err);
        firestoreRegs = this._cache.registrations.filter(r => r.eventId === event.id);
      }
    }

    // 回填 _docId（C1：從 Firestore 查詢結果補救快取缺失）
    const fsReg = firestoreRegs.find(r => r.id === registrationId || r._docId === reg._docId);
    if (fsReg && !reg._docId && fsReg._docId) reg._docId = fsReg._docId;

    // _docId 防禦：若仍缺失則明確報錯（在變更快取之前，確保不會汙染狀態）
    if (!reg._docId) throw new Error('報名記錄不完整，請重新整理後再試');

    // ── 先計算投影，但不修改快取（commit 成功後才寫入）──
    // 模擬取消：在 firestoreRegs 的副本上計算
    const simRegs = firestoreRegs.map(r => ({ ...r }));
    const simTarget = simRegs.find(r => r.id === registrationId || r._docId === reg._docId);
    if (simTarget) simTarget.status = 'cancelled';

    const promotedCandidates = [];

    let occupancy = null;
    if (event) {
      // 候補遞補：若取消的是正取，依序將 waitlisted 改 confirmed 直到滿額
      if (wasPreviouslyConfirmed) {
        promotedCandidates.push(...this._promoteWaitlistForAvailableSeats(event, simRegs));
      }

      // 用模擬結果重建投影（不寫入快取）
      const allActive = simRegs.filter(
        r => r.status === 'confirmed' || r.status === 'waitlisted'
      );
      occupancy = this._rebuildOccupancy(event, allActive);
    }

    // 解析 eventDocId（子集合寫入必要）
    const eventDocId = event?._docId || await this._getEventDocIdAsync(reg.eventId);
    if (!eventDocId) throw new Error('無法取得活動文件 ID，請重新整理後再試');

    // 若有候補遞補，查該活動所有 activityRecords（Firestore 而非快取，避免 onSnapshot limit 漏資料）
    // Bug #A 修復：遞補時必須同步 activityRecord.status，否則統計會少算
    let eventActivityRecords = [];
    if (promotedCandidates.length > 0) {
      try {
        const arSnap = await db.collection('events').doc(eventDocId).collection('activityRecords').get();
        eventActivityRecords = arSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
      } catch (err) {
        console.warn('[cancelRegistration] activityRecords query failed, fallback to cache:', err);
        const arSource = (typeof ApiService !== 'undefined' && ApiService._src)
          ? ApiService._src('activityRecords') : [];
        eventActivityRecords = arSource.filter(a => a.eventId === reg.eventId);
      }
    }

    // ── 所有 Firestore 寫入合併到同一個 batch ──
    const batch = db.batch();

    // 1. 取消報名
    batch.update(db.collection('events').doc(eventDocId).collection('registrations').doc(reg._docId), {
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    batch.delete(db.collection('events').doc(eventDocId).collection('registrationLocks').doc(this._getRegistrationLockId(reg)));

    // 2. 遞補候補者（含 team-split teamKey 分配）
    for (const candidate of promotedCandidates) {
      if (candidate._docId) {
        const promoUpdate = { status: 'confirmed' };
        if (candidate.teamSeatSource) promoUpdate.teamSeatSource = candidate.teamSeatSource;
        // team-split: 遞補時分配隊伍
        if (event?.teamSplit?.enabled && typeof App !== 'undefined' && App._assignTeamKeyForPromotion) {
          const assignedKey = App._assignTeamKeyForPromotion(event, simRegs, candidate);
          if (assignedKey !== undefined) {
            promoUpdate.teamKey = assignedKey;
            candidate.teamKey = assignedKey;
          }
        }
        batch.update(db.collection('events').doc(eventDocId).collection('registrations').doc(candidate._docId), promoUpdate);
      }
    }

    // 2b. 同步遞補者的 activityRecord.status waitlisted → registered（Bug #A 修復）
    // 同行者不產生 activityRecord（CLAUDE.md 規則 9），排除處理
    const arDocIdsToSync = [];
    for (const candidate of promotedCandidates) {
      if (candidate.participantType === 'companion') continue;
      const matchedArs = eventActivityRecords.filter(a =>
        a.uid === candidate.userId && a.status === 'waitlisted'
      );
      if (matchedArs.length === 0) {
        console.warn('[cancelRegistration] no waitlisted activityRecord found for candidate uid=' + candidate.userId + ' eventId=' + reg.eventId);
        continue;
      }
      for (const ar of matchedArs) {
        if (!ar._docId) continue;
        batch.update(
          db.collection('events').doc(eventDocId).collection('activityRecords').doc(ar._docId),
          { status: 'registered' }
        );
        arDocIdsToSync.push(ar._docId);
      }
    }

    // 3. 更新 event 投影
    if (event && event._docId && occupancy) {
      batch.update(db.collection('events').doc(event._docId), {
        current: occupancy.current,
        realCurrent: occupancy.realCurrent,
        waitlist: occupancy.waitlist,
        participants: occupancy.participants,
        waitlistNames: occupancy.waitlistNames,
        participantsWithUid: occupancy.participantsWithUid,
        waitlistWithUid: occupancy.waitlistWithUid,
        teamReservationSummaries: occupancy.teamReservationSummaries,
        schemaVersion: 2,
        status: occupancy.status,
      });
    }

    // ── commit 成功後才更新本地快取 ──
    await batch.commit();

    // commit 成功 → 安全寫入本地快取
    reg.status = 'cancelled';
    reg.cancelledAt = new Date().toISOString();
    if (fsReg) fsReg.status = 'cancelled';

    // 同步候補遞補到本地快取
    for (const candidate of promotedCandidates) {
      const localCandidate = this._cache.registrations.find(r => r.id === candidate.id);
      if (localCandidate) {
        localCandidate.status = 'confirmed';
        if (candidate.teamSeatSource) localCandidate.teamSeatSource = candidate.teamSeatSource;
      }
    }

    // 同步 activityRecord.status 到本地快取（Bug #A 修復）
    if (arDocIdsToSync.length > 0 && typeof ApiService !== 'undefined' && ApiService._src) {
      const liveArSource = ApiService._src('activityRecords') || [];
      for (const docId of arDocIdsToSync) {
        const liveAr = liveArSource.find(a => a._docId === docId);
        if (liveAr) liveAr.status = 'registered';
      }
    }

    // 寫入 event 投影到快取
    if (event && occupancy) {
      this._applyRebuildOccupancy(event, occupancy);
    }

    // 記錄遞補資訊供呼叫端使用 + 寫入操作日誌
    if (promotedCandidates.length > 0) {
      reg._promotedUserId = promotedCandidates[0].userId;
      reg._promotedUserIds = promotedCandidates.map(c => c.userId);
      var _pNames = promotedCandidates.map(function(c) { return c.participantType === 'companion' ? (c.companionName || c.userName) : c.userName; }).filter(Boolean);
      if (_pNames.length > 0 && typeof ApiService !== 'undefined' && ApiService._writeOpLog) {
        ApiService._writeOpLog('auto_promote', '自動遞補', '活動「' + (event?.title || reg.eventId) + '」候補 ' + _pNames.join('、') + ' 自動遞補為正取', reg.eventId);
      }
    }

    // 立即寫入 localStorage
    this._saveToLS('registrations', this._cache.registrations);
    this._saveToLS('events', this._cache.events);

    return reg;
  },

  getRegistrationsByUser(userId) {
    return this._cache.registrations.filter(
      r => r.userId === userId && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  getRegistrationsByEvent(eventId) {
    return this._cache.registrations.filter(
      r => r.eventId === eventId && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  // ════════════════════════════════
  //  Tournaments
  // ════════════════════════════════

  async addTournament(data) {
    // Phase 2A §11.2②：自訂 ID = Firestore doc ID，消除雙軌制
    const tournamentId = data.id || generateId('ct_');
    data.id = tournamentId;
    if (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentRecord === 'function') {
      Object.assign(data, App._buildFriendlyTournamentRecord(data));
    }
    if (data.image && data.image.startsWith('data:')) {
      data.image = await this._uploadImage(data.image, `tournaments/${tournamentId}`);
    }
    if (data.contentImage && data.contentImage.startsWith('data:')) {
      data.contentImage = await this._uploadImage(data.contentImage, `tournaments/${tournamentId}_content`);
    }
    const docRef = db.collection('tournaments').doc(tournamentId);
    await docRef.set({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = tournamentId;  // 單軌：data.id === data._docId
    return data;
  },

  async createFriendlyTournamentAtomic(data) {
    await this.ensureAuthReadyForWrite();
    const tournament = { ...data };
    const tournamentId = String(tournament.id || generateId('ct_')).trim();
    tournament.id = tournamentId;
    const uploadedImageRefs = [];

    try {
      if (tournament.image && tournament.image.startsWith('data:')) {
        const uploaded = await this._uploadImageWithRef(tournament.image, `tournaments/${tournamentId}`);
        tournament.image = uploaded.url;
        uploadedImageRefs.push(uploaded.ref || firebase.storage().refFromURL(uploaded.url));
      }
      if (tournament.contentImage && tournament.contentImage.startsWith('data:')) {
        const uploaded = await this._uploadImageWithRef(tournament.contentImage, `tournaments/${tournamentId}_content`);
        tournament.contentImage = uploaded.url;
        uploadedImageRefs.push(uploaded.ref || firebase.storage().refFromURL(uploaded.url));
      }

      const callable = firebase.app().functions('asia-east1').httpsCallable('createFriendlyTournament');
      const result = await callable({ tournament });
      return result.data;
    } catch (err) {
      for (const ref of uploadedImageRefs) {
        try {
          await ref.delete();
        } catch (cleanupErr) {
          console.warn('[createFriendlyTournamentAtomic] image cleanup failed:', cleanupErr);
        }
      }
      throw err;
    }
  },

  async updateTournament(id, updates) {
    const doc = this._cache.tournaments.find(t => t.id === id);
    if (!doc || !doc._docId) return null;
    if (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentRecord === 'function') {
      Object.assign(updates, App._buildFriendlyTournamentRecord({ ...doc, ...updates }));
    }
    if (updates.image && updates.image.startsWith('data:')) {
      updates.image = await this._uploadImage(updates.image, `tournaments/${id}`);
    }
    if (updates.contentImage && updates.contentImage.startsWith('data:')) {
      updates.contentImage = await this._uploadImage(updates.contentImage, `tournaments/${id}_content`);
    }
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('tournaments').doc(doc._docId).update(_stripDocId(updates));
    return doc;
  },

  // ════════════════════════════════
  //  Teams
  // ════════════════════════════════

  async addTeam(data) {
    // Phase 2A §11.2②：自訂 ID = Firestore doc ID，消除雙軌制
    const teamId = data.id || generateId('tm_');
    data.id = teamId;
    if (data.image && data.image.startsWith('data:')) {
      data.image = await this._uploadImage(data.image, `teams/${teamId}`);
    }
    const docRef = db.collection('teams').doc(teamId);
    await docRef.set({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = teamId;  // 單軌：data.id === data._docId
    return data;
  },

  async updateTeam(id, updates) {
    const doc = this._cache.teams.find(t => t.id === id);
    if (!doc || !doc._docId) return null;
    if (updates.image && updates.image.startsWith('data:')) {
      updates.image = await this._uploadImage(updates.image, `teams/${id}`);
    }
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('teams').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteTeam(id) {
    const doc = this._cache.teams.find(t => t.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('teams').doc(doc._docId).delete();

    // 連鎖清理：移除相關用戶的俱樂部引用
    const teamId = String(id);
    const users = this._cache.adminUsers || [];
    for (const u of users) {
      const userTeamIds = Array.isArray(u.teamIds) ? u.teamIds : (u.teamId ? [u.teamId] : []);
      if (!userTeamIds.includes(teamId)) continue;
      const nextIds = userTeamIds.filter(tid => tid !== teamId);
      const nextNames = nextIds.map((tid, idx) => {
        const tNames = Array.isArray(u.teamNames) ? u.teamNames : [];
        const origIdx = userTeamIds.indexOf(tid);
        return origIdx >= 0 && origIdx < tNames.length ? tNames[origIdx] : '';
      });
      const updates = nextIds.length > 0
        ? { teamId: nextIds[0], teamName: nextNames[0] || '', teamIds: nextIds, teamNames: nextNames }
        : { teamId: null, teamName: null, teamIds: [], teamNames: [] };
      Object.assign(u, updates);
      if (u._docId) {
        try { await db.collection('users').doc(u._docId).update(updates); } catch (_) {}
      }
    }

    // 更新本地快取
    const idx = this._cache.teams.indexOf(doc);
    if (idx !== -1) this._cache.teams.splice(idx, 1);
    this._saveToLS('teams', this._cache.teams);
    return true;
  },

  // ════════════════════════════════
  //  Shop
  // ════════════════════════════════

  async addShopItem(data) {
    // 過濾 base64 圖片（避免超過 Firestore 1MB 限制）
    const cleanImages = (data.images || []).filter(img => !img.startsWith('data:'));
    const docRef = await db.collection('shopItems').add({
      ..._stripDocId(data),
      images: cleanImages,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async updateShopItem(id, updates) {
    const doc = this._cache.shopItems.find(s => s.id === id);
    if (!doc || !doc._docId) return null;
    // 過濾 base64 圖片
    if (updates.images) {
      updates.images = updates.images.filter(img => !img.startsWith('data:'));
    }
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('shopItems').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteShopItem(id) {
    const doc = this._cache.shopItems.find(s => s.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('shopItems').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Announcements（系統公告）
  // ════════════════════════════════

  async addAnnouncement(data) {
    const docRef = await db.collection('announcements').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async updateAnnouncement(id, updates) {
    const doc = this._cache.announcements.find(a => a.id === id);
    if (!doc || !doc._docId) return null;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('announcements').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteAnnouncement(id) {
    const doc = this._cache.announcements.find(a => a.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('announcements').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Users（LINE 登入用戶）
  // ════════════════════════════════

  async createOrUpdateUser(lineProfile) {
    const { userId: lineUserId, displayName, pictureUrl, email } = lineProfile || {};
    if (!lineUserId || typeof lineUserId !== 'string') {
      throw { code: 'invalid-argument', message: 'LINE userId is required' };
    }

    // Ensure Firebase Auth uid is aligned with current LINE userId.
    const authed = await this._ensureAuth(lineUserId);
    const authUid = auth?.currentUser?.uid || null;
    if (!authed || !authUid || authUid !== lineUserId) {
      console.error('[createOrUpdateUser] auth uid mismatch:', {
        expectedLineUserId: lineUserId,
        authUid,
      });
      throw {
        code: 'permission-denied',
        message: 'Firebase auth uid mismatch with LINE userId. Please re-login.',
      };
    }

    const normalizedDisplayName =
      (typeof displayName === 'string' && displayName.trim())
        ? displayName.trim()
        : lineUserId;
    const normalizedPictureUrl = pictureUrl || null;
    const normalizedEmail = email || null;

    const usersRef = db.collection('users');
    const canonicalRef = usersRef.doc(authUid);
    const canonicalSnap = await canonicalRef.get();
    const now = new Date().toISOString();

    console.log('[FirebaseService] createOrUpdateUser canonicalExists=', canonicalSnap.exists, 'auth.uid=', authUid);

    if (!canonicalSnap.exists) {
      const legacySnapshot = await usersRef
        .where('lineUserId', '==', lineUserId)
        .limit(1)
        .get();

      if (legacySnapshot.empty) {
        const userData = {
          uid: authUid,
          lineUserId,
          displayName: normalizedDisplayName,
          pictureUrl: normalizedPictureUrl,
          email: normalizedEmail,
          role: 'user',
          exp: 0,
          level: 1,
          gender: null,
          birthday: null,
          region: null,
          sports: null,
          teamId: null,
          teamName: null,
          phone: null,
          titleBig: null,
          titleNormal: null,
          totalGames: 0,
          completedGames: 0,
          attendanceRate: 0,
          badgeCount: 0,
          createdAt: now,
          lastLogin: now,
        };

        await canonicalRef.set({
          ..._stripDocId(userData),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
        });

        userData._docId = authUid;
        userData._isNewUser = true;
        this._cache.currentUser = userData;
        this._saveToLS('currentUser', userData);
        this._setupUserListener(authUid);
        Promise.resolve(this._startAuthDependentWork()).catch(err =>
          console.warn('[FirebaseService] start auth-dependent work after new user login failed:', err)
        );
        console.log('[FirebaseService] created user profile:', normalizedDisplayName, 'docId:', authUid);
        return userData;
      }

      const legacyDoc = legacySnapshot.docs[0];
      const legacyData = legacyDoc.data() || {};
      const migratedPayload = {
        ...legacyData,
        uid: authUid,
        lineUserId,
        displayName: normalizedDisplayName || legacyData.displayName || authUid,
        pictureUrl: normalizedPictureUrl,
        email: normalizedEmail,
        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (!legacyData.createdAt) {
        migratedPayload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      }

      await canonicalRef.set(migratedPayload, { merge: true });
      const migratedSnap = await canonicalRef.get();
      const migratedUser = {
        ...migratedSnap.data(),
        _docId: migratedSnap.id,
        _migratedFromDocId: legacyDoc.id,
      };

      // NOTE: Legacy document cannot be deleted by client because /users delete is disallowed.
      this._cache.currentUser = migratedUser;
      this._saveToLS('currentUser', migratedUser);
      this._setupUserListener(authUid);
      Promise.resolve(this._startAuthDependentWork()).catch(err =>
        console.warn('[FirebaseService] start auth-dependent work after migrated user login failed:', err)
      );
      console.log('[FirebaseService] migrated legacy user doc to canonical uid doc:', {
        from: legacyDoc.id,
        to: authUid,
      });
      return migratedUser;
    }

    const existing = { ...canonicalSnap.data(), _docId: canonicalSnap.id };
    const updates = {
      displayName: normalizedDisplayName,
      pictureUrl: normalizedPictureUrl,
    };

    const lastLoginMs = existing.lastLogin?.toMillis?.() ?? 0;
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - lastLoginMs > tenMinutes) {
      updates.lastLogin = firebase.firestore.FieldValue.serverTimestamp();
    }

    // Do not update uid from client side. rules block uid changes by design.
    await canonicalRef.update(updates);

    Object.assign(existing, updates);
    this._cache.currentUser = existing;
    this._saveToLS('currentUser', existing);
    this._setupUserListener(authUid);
    Promise.resolve(this._startAuthDependentWork()).catch(err =>
      console.warn('[FirebaseService] start auth-dependent work after login update failed:', err)
    );
    console.log('[FirebaseService] updated user profile:', normalizedDisplayName);
    return existing;
  },

  // ════════════════════════════════
  //  即時監聽：當前用戶文件
  // ════════════════════════════════

  _setupUserListener(docId) {
    if (this._userListener) {
      this._userListener();
      this._userListener = null;
    }
    this._userListener = db.collection('users').doc(docId).onSnapshot(
      doc => {
        if (doc.exists) {
          const prev = this._cache.currentUser || null;
          const next = { ...doc.data(), _docId: doc.id };
          this._cache.currentUser = next;
          this._saveToLS('currentUser', next);

          const roleChanged = prev?.role !== next.role;
          if (
            roleChanged
            && typeof auth !== 'undefined'
            && auth?.currentUser
          ) {
            const uid = next.uid || next.lineUserId || next._docId;
            if (uid && auth.currentUser.uid === uid) {
              auth.currentUser.getIdToken(true).catch(err => {
                console.warn('[FirebaseService] token refresh after role change failed:', err?.code || err?.message || err);
              });
            }
          }

          this._startMessagesListener?.();
          if (typeof App !== 'undefined' && this._getPageScopedRealtimeCollections?.(App?.currentPage).includes('registrations')) {
            this._startRegistrationsListener?.();
          }

          if (this._onUserChanged) {
            this._onUserChanged();
          } else if (typeof App !== 'undefined') {
            try {
              if (roleChanged && typeof App.applyRole === 'function') {
                App.applyRole(next.role || 'user', true);
              }
              App.renderLoginUI?.();
            } catch (uiErr) {
              console.warn('[FirebaseService] currentUser listener fallback UI refresh failed:', uiErr);
            }
          }
        }
      },
      err => console.warn('[onSnapshot] currentUser 監聽錯誤:', err)
    );
  },

  async getUser(lineUserId) {
    const direct = await db.collection('users').doc(lineUserId).get();
    if (direct.exists) {
      return { ...direct.data(), _docId: direct.id };
    }

    const snapshot = await db.collection('users')
      .where('lineUserId', '==', lineUserId).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { ...doc.data(), _docId: doc.id };
  },

  async _syncUserRoleClaims(uid) {
    if (!uid || typeof firebase === 'undefined' || !firebase.app) return;
    const fn = firebase.app().functions('asia-east1').httpsCallable('syncUserRole');
    await fn({ targetUid: uid });

    // Refresh current user's token immediately if their own role changed.
    if (typeof auth !== 'undefined' && auth?.currentUser?.uid === uid) {
      await auth.currentUser.getIdToken(true);
    }
  },

  async manageAdminUser(docId, updates = {}) {
    if (!docId || typeof firebase === 'undefined' || !firebase.app) {
      throw new Error('ADMIN_USER_TARGET_REQUIRED');
    }

    const payload = { targetUid: docId };
    const profileUpdates = {};
    ['region', 'gender', 'birthday', 'sports', 'phone'].forEach(field => {
      if (!Object.prototype.hasOwnProperty.call(updates, field)) return;
      profileUpdates[field] = updates[field];
    });
    if (Object.keys(profileUpdates).length > 0) {
      payload.profileUpdates = profileUpdates;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'isRestricted')) {
      payload.restrictionUpdate = { isRestricted: !!updates.isRestricted };
    }
    if (typeof updates.role === 'string' || typeof updates.manualRole === 'string') {
      payload.roleChange = {
        role: updates.role,
        manualRole: updates.manualRole || updates.role,
      };
    }

    if (Object.keys(payload).length === 1) {
      return null;
    }

    const fn = firebase.app().functions('asia-east1').httpsCallable('adminManageUser');
    const result = await fn(payload);
    if (result?.data?.forceRefreshToken && typeof auth !== 'undefined' && auth?.currentUser) {
      await auth.currentUser.getIdToken(true);
    }
    return result?.data || null;
  },

  async updateUser(docId, updates) {
    await db.collection('users').doc(docId).update({
      ...updates,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if (updates && typeof updates.role === 'string') {
      await this._syncUserRoleClaims(docId);
    }
  },

  // ════════════════════════════════
  //  Image Upload（Firebase Storage）
  // ════════════════════════════════

  async _uploadImage(base64DataUrl, path) {
    try {
      if (!storage && !uploadStorage) { console.error('[Storage] storage 未初始化'); return null; }
      const activeStorage = uploadStorage || storage;
      const uploadTargets = [
        {
          bucket: window._firebaseUploadStorageBucket || window._firebaseDefaultStorageBucket || '',
          service: activeStorage,
        },
      ];
      if (storage && storage !== activeStorage) {
        uploadTargets.push({
          bucket: window._firebaseDefaultStorageBucket || '',
          service: storage,
        });
      }
      const metadata = {
        cacheControl: 'public, max-age=31536000',
      };
      let lastError = null;
      for (const target of uploadTargets) {
        try {
          const ref = target.service.ref().child(`images/${path}_${Date.now()}`);
          const snapshot = await ref.putString(base64DataUrl, 'data_url', metadata);
          const url = await snapshot.ref.getDownloadURL();
          console.log('[Storage] upload target bucket:', target.bucket || '(default)');
          console.log('[Storage] 圖片上傳成功:', path);
          return url;
        } catch (uploadErr) {
          lastError = uploadErr;
          console.warn('[Storage] upload attempt failed:', target.bucket || '(default)', uploadErr.code, uploadErr.message);
        }
      }
      throw lastError || new Error('Storage upload failed');
    } catch (err) {
      console.error('[Storage] 圖片上傳失敗:', path, err.code, err.message, err);
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('圖片上傳失敗，請稍後重試');
      }
      return null;
    }
  },

  async _uploadImageWithRef(base64DataUrl, path) {
    try {
      if (!storage && !uploadStorage) throw new Error('Storage not initialized');
      const activeStorage = uploadStorage || storage;
      const uploadTargets = [
        {
          bucket: window._firebaseUploadStorageBucket || window._firebaseDefaultStorageBucket || '',
          service: activeStorage,
        },
      ];
      if (storage && storage !== activeStorage) {
        uploadTargets.push({
          bucket: window._firebaseDefaultStorageBucket || '',
          service: storage,
        });
      }
      const metadata = {
        cacheControl: 'public, max-age=31536000',
      };
      let lastError = null;
      for (const target of uploadTargets) {
        try {
          const ref = target.service.ref().child(`images/${path}_${Date.now()}`);
          const snapshot = await ref.putString(base64DataUrl, 'data_url', metadata);
          const url = await snapshot.ref.getDownloadURL();
          console.log('[Storage] upload target bucket:', target.bucket || '(default)');
          console.log('[Storage] 圖片上傳成功:', path);
          return { url, ref: snapshot.ref, bucket: target.bucket || '' };
        } catch (uploadErr) {
          lastError = uploadErr;
          console.warn('[Storage] upload attempt failed:', target.bucket || '(default)', uploadErr.code, uploadErr.message);
        }
      }
      throw lastError || new Error('Storage upload failed');
    } catch (err) {
      console.error('[Storage] 圖片上傳失敗:', path, err.code, err.message, err);
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('圖片上傳失敗，請稍後重試');
      }
      throw err;
    }
  },

  // ════════════════════════════════
  //  Banners
  // ════════════════════════════════

  async updateBanner(id, updates) {
    const doc = this._cache.banners.find(b =>
      b.id === id
      || b._docId === id
      || (id === 'sga1' && b.slot === 'sga1')
      || (id === 'sga1' && b.type === 'shotgame')
    );
    if (!doc || !doc._docId) return null;
    // 避免 base64 寫入 Firestore（超過 1MB 限制）
    if (updates.image && updates.image.startsWith('data:')) delete updates.image;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    const ref = db.collection('banners').doc(doc._docId);
    try {
      await ref.update(updates);
    } catch (err) {
      const isShotGame = id === 'sga1' || doc.id === 'sga1' || doc.slot === 'sga1' || doc.type === 'shotgame';
      const isNotFound = err && (err.code === 'not-found' || String(err.message || '').toLowerCase().includes('no document to update'));
      if (!(isShotGame && isNotFound)) throw err;
      await ref.set({
        id: 'sga1',
        slot: 'sga1',
        type: 'shotgame',
        ...updates,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return doc;
  },

  // ════════════════════════════════
  //  Floating Ads
  // ════════════════════════════════

  async updateFloatingAd(id, updates) {
    const doc = this._cache.floatingAds.find(a => a.id === id);
    if (!doc || !doc._docId) return null;
    if (updates.image && updates.image.startsWith('data:')) delete updates.image;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('floatingAds').doc(doc._docId).update(updates);
    return doc;
  },

  // ════════════════════════════════
  //  Popup Ads（彈跳廣告）
  // ════════════════════════════════

  async addPopupAd(data) {
    if (data.image && data.image.startsWith('data:')) {
      data.image = await this._uploadImage(data.image, `popupAds/${data.id}`);
    }
    const docRef = await db.collection('popupAds').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async updatePopupAd(id, updates) {
    const doc = this._cache.popupAds.find(a => a.id === id);
    if (!doc || !doc._docId) return null;
    // 避免 base64 寫入 Firestore（圖片已在 savePopupAd 上傳）
    if (updates.image && updates.image.startsWith('data:')) delete updates.image;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('popupAds').doc(doc._docId).update(updates);
    return doc;
  },

  async deletePopupAd(id) {
    const doc = this._cache.popupAds.find(a => a.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('popupAds').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Sponsors（贊助商）
  // ════════════════════════════════

  async updateSponsor(id, updates) {
    const doc = this._cache.sponsors.find(s => s.id === id);
    if (!doc || !doc._docId) return null;
    if (updates.image && updates.image.startsWith('data:')) delete updates.image;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('sponsors').doc(doc._docId).update(updates);
    return doc;
  },

  // ════════════════════════════════
  //  Site Themes（佈景主題）
  // ════════════════════════════════

  async updateSiteTheme(id, updates) {
    const doc = this._cache.siteThemes.find(t => t.id === id);
    if (!doc || !doc._docId) return null;
    if (updates.image && updates.image.startsWith('data:')) delete updates.image;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('siteThemes').doc(doc._docId).update(updates);
    return doc;
  },

  // ════════════════════════════════
  //  Home Game Config（首頁小遊戲設定）
  // ════════════════════════════════

  async upsertGameConfig(id, updates) {
    const configId = String(id || '').trim();
    if (!configId) return null;

    const existing = this._cache.gameConfigs.find(c =>
      c.id === configId || c._docId === configId
    ) || null;

    const ref = db.collection('gameConfigs').doc(existing?._docId || configId);
    const payload = {
      ...updates,
      id: configId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (!existing) {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    await ref.set(payload, { merge: true });

    if (existing) {
      Object.assign(existing, updates, { id: configId });
      return existing;
    }

    const created = { id: configId, _docId: ref.id, ...updates };
    this._cache.gameConfigs.push(created);
    return created;
  },

  // ════════════════════════════════
  //  Achievements
  // ════════════════════════════════

  async addAchievement(data) {
    const docRef = await db.collection('achievements').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async updateAchievement(id, updates) {
    const doc = this._cache.achievements.find(a => a.id === id);
    if (!doc || !doc._docId) return null;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('achievements').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteAchievement(id) {
    const doc = this._cache.achievements.find(a => a.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('achievements').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Badges
  // ════════════════════════════════

  async addBadge(data) {
    const writeData = { ..._stripDocId(data) };
    if (data.image && data.image.startsWith('data:')) {
      const url = await this._uploadImage(data.image, `badges/${data.id}`);
      if (url) {
        data.image = url;
        writeData.image = url;
      } else {
        // 上傳失敗：快取保留 dataURL 供顯示，Firestore 不寫入 base64
        writeData.image = null;
      }
    }
    const docRef = await db.collection('badges').add({
      ...writeData,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async updateBadge(id, updates) {
    const doc = this._cache.badges.find(b => b.id === id);
    if (!doc || !doc._docId) return null;
    const writeUpdates = { ...updates };
    if (updates.image && updates.image.startsWith('data:')) {
      const url = await this._uploadImage(updates.image, `badges/${id}`);
      if (url) {
        updates.image = url;
        writeUpdates.image = url;
        if (doc) doc.image = url;
      } else {
        // 上傳失敗：快取保留 dataURL，Firestore 不寫入 base64
        delete writeUpdates.image;
      }
    }
    writeUpdates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('badges').doc(doc._docId).update(writeUpdates);
    return doc;
  },

  async deleteBadge(id) {
    const doc = this._cache.badges.find(b => b.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('badges').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Admin Messages（後台站內信）
  // ════════════════════════════════

  async addAdminMessage(data) {
    const docRef = await db.collection('adminMessages').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async updateAdminMessage(id, updates) {
    const doc = this._cache.adminMessages.find(m => m.id === id);
    if (!doc || !doc._docId) return null;
    await db.collection('adminMessages').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteAdminMessage(id) {
    const doc = this._cache.adminMessages.find(m => m.id === id);
    if (!doc || !doc._docId) return null;
    await db.collection('adminMessages').doc(doc._docId).delete();
    return doc;
  },

  /** Phase 1 雙寫：呼叫 deliverToInbox CF 寫入 per-user inbox（fire-and-forget） */
  async _deliverToInboxCF(message, targetUid, targetTeamId, targetRoles, targetType) {
    if (typeof firebase === 'undefined' || !firebase.app) return;
    try {
      const fn = firebase.app().functions('asia-east1').httpsCallable('deliverToInbox');
      await fn({ message, targetUid, targetTeamId, targetRoles, targetType });
    } catch (err) {
      // Phase 1: inbox 寫入失敗不影響主流程（舊 messages/ 已寫入）
      console.warn('[deliverToInboxCF] inbox write failed (non-blocking):', err.message || err);
    }
  },

  /** Phase 1 雙寫：呼叫 syncGroupActionStatus CF 同步跨 inbox 審核狀態 */
  async _syncGroupActionStatusCF(groupId, newStatus, reviewerName) {
    if (typeof firebase === 'undefined' || !firebase.app) return;
    try {
      const fn = firebase.app().functions('asia-east1').httpsCallable('syncGroupActionStatus');
      await fn({ groupId, newStatus, reviewerName });
    } catch (err) {
      console.warn('[syncGroupActionStatusCF] sync failed (non-blocking):', err.message || err);
    }
  },

  async addMessage(data) {
    const authed = await this._ensureAuth();
    if (!authed || !auth?.currentUser) {
      throw {
        code: 'unauthenticated',
        message: 'Firebase auth required before creating messages.',
      };
    }
    const explicitId = typeof data?.id === 'string' ? data.id.trim() : '';
    const fallbackDocId = (typeof data?._docId === 'string' && data._docId.trim())
      ? data._docId.trim()
      : db.collection('messages').doc().id;
    const docId = explicitId || fallbackDocId;
    const docRef = db.collection('messages').doc(docId);
    const payload = {
      ..._stripDocId(data),
      id: explicitId || docId,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      const existing = await docRef.get();
      if (existing.exists) {
        data.id = payload.id;
        data._docId = docId;
        return data;
      }
    } catch (_) {}

    try {
      await docRef.set(payload);
    } catch (err) {
      const errorCode = String(err?.code || '').toLowerCase();
      const errorMessage = String(err?.message || '').toLowerCase();
      if (errorCode.includes('already-exists') || errorMessage.includes('document already exists')) {
        data.id = payload.id;
        data._docId = docId;
        return data;
      }
      if (errorCode.includes('permission-denied')) {
        try {
          const existing = await docRef.get();
          if (existing.exists) {
            data.id = payload.id;
            data._docId = docId;
            return data;
          }
        } catch (_) {}
      }
      throw err;
    }

    data.id = payload.id;
    data._docId = docId;
    return data;
  },

  // Phase 3 修正：updateMessage 透過 CF 同步（actionStatus 等欄位不能前端直寫 inbox）
  async updateMessage(msgId, updates) {
    const doc = this._cache.messages.find(m => m.id === msgId);
    if (!doc || !doc._docId) return null;
    // 本地快取先更新（樂觀更新）
    Object.assign(doc, updates);
    // 透過 syncGroupActionStatus CF 同步（含自己和其他幹部的 inbox）
    if (updates.actionStatus && doc.meta?.groupId) {
      this._syncGroupActionStatusCF?.(doc.meta.groupId, updates.actionStatus, updates.reviewerName);
    }
    return doc;
  },

  async clearAllMessages() {
    const myUid = auth?.currentUser?.uid;
    if (!myUid) return;
    const msgs = this._cache.messages.filter(m => m._docId);
    if (!msgs.length) { this._cache.messages.length = 0; return; }
    for (let i = 0; i < msgs.length; i += 450) {
      const chunk = msgs.slice(i, i + 450);
      const batch = db.batch();
      chunk.forEach(m => batch.delete(db.collection('users').doc(myUid).collection('inbox').doc(m._docId)));
      await batch.commit();
    }
    this._cache.messages.length = 0;
  },

  // ════════════════════════════════
  //  User Role（用戶晉升）
  // ════════════════════════════════

  async updateUserRole(docId, newRole) {
    const fn = firebase.app().functions('asia-east1').httpsCallable('autoPromoteTeamRole');
    const result = await fn({ targetUid: docId, newRole });
    // Refresh current user's token if their own role changed
    if (result?.data?.newRole && typeof auth !== 'undefined' && auth?.currentUser?.uid === result.data.targetUid) {
      await auth.currentUser.getIdToken(true);
    }
    return result?.data || null;
  },

  // ════════════════════════════════
  //  Message Read Status（訊息已讀）
  // ════════════════════════════════

  // Phase 3 修正：寫入 per-user inbox 路徑
  async updateMessageRead(msgId) {
    const myUid = auth?.currentUser?.uid;
    const doc = this._cache.messages.find(m => m.id === msgId);
    if (!doc || !doc._docId || !myUid) return null;
    doc.read = true;
    await db.collection('users').doc(myUid).collection('inbox').doc(doc._docId).update({
      read: true, readAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return doc;
  },

  async markAllMessagesRead() {
    const myUid = auth?.currentUser?.uid;
    if (!myUid) return;
    const unread = this._cache.messages.filter(m => !m.read && m._docId);
    if (unread.length === 0) return;
    const batch = db.batch();
    unread.forEach(m => {
      m.read = true;
      batch.update(db.collection('users').doc(myUid).collection('inbox').doc(m._docId), {
        read: true, readAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  },

  // ════════════════════════════════
  //  Operation Log（操作日誌）
  // ════════════════════════════════

  async addOperationLog(data) {
    const safeData = _stripDocId(data);
    const docId = (data && typeof data._docId === 'string' && data._docId.trim())
      ? data._docId.trim()
      : db.collection('operationLogs').doc().id;
    await db.collection('operationLogs').doc(docId).set({
      ...safeData,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  },

  // ════════════════════════════════
  //  Error Log（錯誤日誌）
  // ════════════════════════════════

  async addErrorLog(data) {
    await db.collection('errorLogs').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteErrorLog(docId) {
    await db.collection('errorLogs').doc(docId).delete();
  },

  async adjustTeamReservation(eventId, teamId, reservedSlots) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) {
      throw new Error('Firebase 登入尚未完成，請稍候再試');
    }
    const safeSlots = Math.max(0, Math.trunc(Number(reservedSlots || 0) || 0));
    const callable = firebase.app().functions('asia-east1').httpsCallable('adjustTeamReservation');
    const result = await callable({
      eventId,
      teamId,
      reservedSlots: safeSlots,
      requestId: `team_res_${auth.currentUser?.uid || 'user'}_${eventId}_${teamId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    });
    const data = result.data || {};
    const event = this._cache.events.find(e => e.id === eventId);
    if (event && data.event) {
      Object.assign(event, {
        current: data.event.current,
        realCurrent: data.event.realCurrent,
        waitlist: data.event.waitlist,
        participants: data.event.participants,
        waitlistNames: data.event.waitlistNames,
        participantsWithUid: data.event.participantsWithUid,
        waitlistWithUid: data.event.waitlistWithUid,
        teamReservationSummaries: data.event.teamReservationSummaries || [],
        status: data.event.status,
      });
      this._saveToLS('events', this._cache.events);
    }
    if (Array.isArray(data.promoted) && data.promoted.length) {
      data.promoted.forEach(item => {
        const reg = this._cache.registrations.find(r =>
          (item.docId && r._docId === item.docId) || (item.id && r.id === item.id)
        );
        if (reg) {
          reg.status = 'confirmed';
          if (item.teamSeatSource) reg.teamSeatSource = item.teamSeatSource;
        }
        if (Array.isArray(this._cache.activityRecords)) {
          const ar = this._cache.activityRecords.find(a =>
            a.eventId === eventId && a.uid === item.userId && a.status === 'waitlisted'
          );
          if (ar) ar.status = 'registered';
        }
      });
      this._saveToLS('registrations', this._cache.registrations);
      if (Array.isArray(this._cache.activityRecords)) this._saveToLS('activityRecords', this._cache.activityRecords);
    }
    return data;
  },

  // ════════════════════════════════
  //  Companions（同行者）
  // ════════════════════════════════

  async updateUserCompanions(docId, companions) {
    await db.collection('users').doc(docId).update({
      companions,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async updateUserEduChildren(docId, eduChildren) {
    await db.collection('users').doc(docId).update({
      eduChildren,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // ════════════════════════════════
  //  Batch Registration（批次報名）
  // ════════════════════════════════

  async batchRegisterForEvent(eventId, entries) {
    // Plan C：個人資料完整度前置檢查（⚠️ 鎖定函式 pre-check）
    var _cu2 = typeof ApiService !== 'undefined' && ApiService.getCurrentUser?.();
    if (_cu2 && (!_cu2.gender || !_cu2.birthday || !_cu2.region)) {
      throw new Error('PROFILE_INCOMPLETE');
    }

    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) {
      throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    }
    const mainUserId = entries[0]?.userId;
    if (!mainUserId || mainUserId === 'unknown') throw new Error('用戶資料載入中，請稍候再試');
    // v8 Blocker 2 Part 3：身分一致性最後防線（同行者報名同樣擋 Tier 2 污染）
    if (auth.currentUser?.uid !== mainUserId) {
      throw new Error('身分不一致、請重新登入');
    }
    const event = this._cache.events.find(e => e.id === eventId);
    if (!event || !event._docId) throw new Error('活動不存在');

    // 從 Firestore 查詢該活動所有報名紀錄（不依賴快取，避免快取不完整導致覆蓋正確計數）
    await this._assertEventSignupOpen(event);

    const allRegsSnap = await db.collection('events').doc(event._docId)
      .collection('registrations')
      .get({ source: 'server' });
    const allEventRegs = allRegsSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));

    // 防幽靈：用 Firestore 真實資料檢查重複報名
    const hasActive = allEventRegs.some(r =>
      r.userId === mainUserId
      && (r.status === 'confirmed' || r.status === 'waitlisted')
    );
    if (hasActive) throw new Error('已報名此活動');

    const eventRef = db.collection('events').doc(event._docId);
    const regDocRefs = entries.map(() => eventRef.collection('registrations').doc());
    const regLockIds = entries.map(entry => this._getRegistrationLockId({
      userId: entry.userId,
      participantType: entry.participantType || 'self',
      companionId: entry.companionId || null,
    }));
    const regLockRefs = regLockIds.map(lockId => eventRef.collection('registrationLocks').doc(lockId));

    // 從 Firestore 查詢結果取得有效報名（不用快取）
    const firestoreActiveRegs = allEventRegs.filter(
      r => r.status === 'confirmed' || r.status === 'waitlisted'
    );

    const result = await db.runTransaction(async (transaction) => {
      // 原子讀取活動最新狀態
      const eventDoc = await transaction.get(eventRef);
      if (!eventDoc.exists) throw new Error('活動不存在');
      const ed = eventDoc.data();
      const maxCount = ed.max || 0;
      const lockDocs = await Promise.all(regLockRefs.map(ref => transaction.get(ref)));

      const registrations = [];
      let confirmed = 0, waitlisted = 0;
      let refIdx = 0;
      let promotionIdx = 0;
      const plannedKeys = new Set(firestoreActiveRegs.map(r => this._getRegistrationUniqueKey(r)));
      const plannedActiveRegs = firestoreActiveRegs.map(r => ({ ...r }));
      const currentUserData = (typeof ApiService !== 'undefined' && ApiService.getCurrentUser)
        ? (ApiService.getCurrentUser() || {})
        : { uid: mainUserId };

      for (const entry of entries) {
        const entryType = entry.participantType || 'self';
        const dupKey = this._getRegistrationUniqueKey({
          userId: entry.userId,
          participantType: entryType,
          companionId: entry.companionId || null,
        });
        const existing = allEventRegs.find(r => {
          if (r.status === 'cancelled' || r.status === 'removed') return false;
          const rKey = this._getRegistrationUniqueKey(r);
          return rKey === dupKey;
        });
        if (existing || plannedKeys.has(dupKey) || lockDocs[refIdx]?.exists) {
          if (entryType !== 'companion') throw new Error('撌脣?迨瘣餃?');
          refIdx++;
          promotionIdx++;
          continue;
        }

        const reg = {
          id: 'reg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId,
          userId: entry.userId,
          userName: entry.userName,
          participantType: entryType,
          companionId: entry.companionId || null,
          companionName: entry.companionName || null,
          status: 'waitlisted',
          promotionOrder: promotionIdx,
          registeredAt: new Date().toISOString(),
        };
        const seatDecision = this._decideRegistrationSeat(
          { ...ed, id: eventId, max: maxCount },
          plannedActiveRegs,
          reg,
          entryType === 'self' ? currentUserData : {}
        );
        const status = seatDecision.status;
        promotionIdx++;

        const docRef = regDocRefs[refIdx];
        transaction.set(docRef, { ..._stripDocId(reg), registeredAt: firebase.firestore.FieldValue.serverTimestamp() });
        transaction.set(regLockRefs[refIdx], {
          key: regLockIds[refIdx],
          eventId,
          userId: entry.userId,
          participantType: entryType,
          companionId: entry.companionId || null,
          registrationDocId: docRef.id,
          status: 'active',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        reg._docId = docRef.id;
        registrations.push(reg);
        plannedKeys.add(dupKey);
        plannedActiveRegs.push(reg);

        if (status === 'confirmed') {
          confirmed++;
        } else {
          waitlisted++;
        }
        refIdx++;
      }

      // 用 Firestore 真實資料 + 新報名重建投影
      const allRegsForRebuild = [...firestoreActiveRegs, ...registrations];
      const occupancy = this._rebuildOccupancy({ ...ed, max: maxCount, status: ed.status }, allRegsForRebuild);

      transaction.update(eventRef, {
        current: occupancy.current,
        realCurrent: occupancy.realCurrent,
        waitlist: occupancy.waitlist,
        participants: occupancy.participants,
        waitlistNames: occupancy.waitlistNames,
        participantsWithUid: occupancy.participantsWithUid,
        waitlistWithUid: occupancy.waitlistWithUid,
        teamReservationSummaries: occupancy.teamReservationSummaries,
        schemaVersion: 2,
        status: occupancy.status,
      });

      return { registrations, confirmed, waitlisted, occupancy };
    });

    // Transaction 成功後同步本地快取
    this._applyRebuildOccupancy(event, result.occupancy);
    result.registrations.forEach(r => this._cache.registrations.push(r));

    // 立即寫入 localStorage，避免刷新後資料遺失
    this._saveToLS('registrations', this._cache.registrations);
    this._saveToLS('events', this._cache.events);

    // 背景寫入徽章到 self 報名文件（不阻塞報名流程）
    const selfReg = result.registrations.find(r => r.participantType === 'self');
    if (selfReg && selfReg._docId) {
      this._writeDisplayBadgesToReg(selfReg._docId);
    }

    return { registrations: result.registrations, confirmed: result.confirmed, waitlisted: result.waitlisted };
  },

  async cancelCompanionRegistrations(regIds) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) {
      throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    }

    // ── 階段 1：收集要取消的報名（不修改快取）──
    const regsToCancel = [];
    const affectedEventIds = new Set();
    const hadConfirmed = new Set();

    for (const regId of regIds) {
      const reg = this._cache.registrations.find(r => r.id === regId);
      if (!reg || reg.status === 'cancelled' || reg.status === 'removed') continue;
      if (reg.status === 'confirmed') hadConfirmed.add(reg.eventId);
      affectedEventIds.add(reg.eventId);
      regsToCancel.push(reg);
    }

    if (regsToCancel.length === 0) return [];

    // ── 階段 2：從 Firestore 查詢受影響活動的最新報名資料（不依賴快取）──
    const firestoreRegsByEvent = {};
    for (const eventId of affectedEventIds) {
      try {
        const _ev = this._cache.events.find(e => e.id === eventId);
        const _eventDocId = _ev?._docId || await FirebaseService._getEventDocIdAsync(eventId);
        if (!_eventDocId) throw new Error('eventDocId not found for ' + eventId);
        const snap = await db.collection('events').doc(_eventDocId)
          .collection('registrations')
          .get();
        firestoreRegsByEvent[eventId] = snap.docs.map(d => {
          const data = d.data();
          return {
            ...data,
            _docId: d.id,
            registeredAt: data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt,
          };
        });
      } catch (err) {
        console.warn('[cancelCompanionRegistrations] Firestore query failed, fallback:', err);
        firestoreRegsByEvent[eventId] = this._cache.registrations.filter(r => r.eventId === eventId);
      }
    }

    // 回填 _docId（從 Firestore 查詢結果補救快取缺失）
    for (const reg of regsToCancel) {
      if (!reg._docId) {
        const fsRegs = firestoreRegsByEvent[reg.eventId] || [];
        const fsReg = fsRegs.find(r => r.id === reg.id);
        if (fsReg?._docId) reg._docId = fsReg._docId;
      }
    }

    // _docId 防禦：排除回填後仍缺失的報名，避免快取與 Firestore 不一致
    const missingDocIds = regsToCancel.filter(r => !r._docId);
    if (missingDocIds.length > 0) {
      console.warn('[cancelCompanionRegistrations] skipping regs without _docId:', missingDocIds.map(r => r.id));
    }
    const validRegsToCancel = regsToCancel.filter(r => r._docId);
    if (validRegsToCancel.length === 0) {
      throw new Error('報名記錄不完整，請重新整理後再試');
    }

    // ── 階段 3：在模擬副本上計算取消 + 遞補（不修改快取）──
    const cancelledIdSet = new Set(validRegsToCancel.map(r => r.id));
    const simRegsByEvent = {};
    for (const eventId of affectedEventIds) {
      simRegsByEvent[eventId] = (firestoreRegsByEvent[eventId] || []).map(r => ({ ...r }));
      // 在模擬中標記取消
      for (const simReg of simRegsByEvent[eventId]) {
        if (cancelledIdSet.has(simReg.id)) simReg.status = 'cancelled';
      }
    }

    // 候補遞補（模擬）
    const promotedCandidates = [];
    for (const eventId of affectedEventIds) {
      if (!hadConfirmed.has(eventId)) continue;
      const event = this._cache.events.find(e => e.id === eventId);
      if (!event) continue;

      promotedCandidates.push(...this._promoteWaitlistForAvailableSeats(event, simRegsByEvent[eventId]));
    }

    // 用模擬結果重建投影
    const occupancyByEvent = {};
    for (const eventId of affectedEventIds) {
      const event = this._cache.events.find(e => e.id === eventId);
      if (!event) continue;
      const allActive = simRegsByEvent[eventId].filter(
        r => r.status === 'confirmed' || r.status === 'waitlisted'
      );
      occupancyByEvent[eventId] = this._rebuildOccupancy(event, allActive);
    }

    // 解析所有受影響活動的 eventDocId（子集合寫入必要）
    const eventDocIds = {};
    for (const _evId of affectedEventIds) {
      const _ev = this._cache.events.find(e => e.id === _evId);
      eventDocIds[_evId] = _ev?._docId || await this._getEventDocIdAsync(_evId);
      if (!eventDocIds[_evId]) throw new Error('無法取得活動文件 ID: ' + _evId);
    }

    // 若有候補遞補（hadConfirmed），查受影響活動的 activityRecords（Firestore 而非快取，避免 onSnapshot limit 漏資料）
    // Bug #B 修復：遞補時必須同步 activityRecord.status
    const arsByEvent = {};
    for (const _evId of affectedEventIds) {
      if (!hadConfirmed.has(_evId)) continue;
      try {
        const arSnap = await db.collection('events').doc(eventDocIds[_evId]).collection('activityRecords').get();
        arsByEvent[_evId] = arSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));
      } catch (err) {
        console.warn('[cancelCompanionRegistrations] activityRecords query failed for event=' + _evId + ':', err);
        const arSource = (typeof ApiService !== 'undefined' && ApiService._src)
          ? ApiService._src('activityRecords') : [];
        arsByEvent[_evId] = arSource.filter(a => a.eventId === _evId);
      }
    }

    // ── 階段 4：所有 Firestore 寫入合併到同一個 batch ──
    const batch = db.batch();

    // 1. 取消報名
    for (const reg of validRegsToCancel) {
      batch.update(db.collection('events').doc(eventDocIds[reg.eventId]).collection('registrations').doc(reg._docId), {
        status: 'cancelled',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      batch.delete(db.collection('events').doc(eventDocIds[reg.eventId]).collection('registrationLocks').doc(this._getRegistrationLockId(reg)));
    }

    // 2. 遞補候補者（含 team-split teamKey 分配）
    for (const candidate of promotedCandidates) {
      if (candidate._docId) {
        const promoUpdate = { status: 'confirmed' };
        if (candidate.teamSeatSource) promoUpdate.teamSeatSource = candidate.teamSeatSource;
        const candEvent = this._cache.events.find(e => e.id === candidate.eventId);
        if (candEvent?.teamSplit?.enabled && typeof App !== 'undefined' && App._assignTeamKeyForPromotion) {
          const simR = (simRegsByEvent?.[candidate.eventId] || []);
          const assignedKey = App._assignTeamKeyForPromotion(candEvent, simR, candidate);
          if (assignedKey !== undefined) {
            promoUpdate.teamKey = assignedKey;
            candidate.teamKey = assignedKey;
          }
        }
        batch.update(db.collection('events').doc(eventDocIds[candidate.eventId]).collection('registrations').doc(candidate._docId), promoUpdate);
      }
    }

    // 2b. 同步遞補者的 activityRecord.status waitlisted → registered（Bug #B 修復）
    // 同行者不產生 activityRecord（CLAUDE.md 規則 9），排除處理
    const arDocIdsToSyncByEvent = {};
    for (const candidate of promotedCandidates) {
      if (candidate.participantType === 'companion') continue;
      const ars = arsByEvent[candidate.eventId] || [];
      const matchedArs = ars.filter(a =>
        a.uid === candidate.userId && a.status === 'waitlisted'
      );
      if (matchedArs.length === 0) {
        console.warn('[cancelCompanionRegistrations] no waitlisted activityRecord found for candidate uid=' + candidate.userId + ' eventId=' + candidate.eventId);
        continue;
      }
      for (const ar of matchedArs) {
        if (!ar._docId) continue;
        batch.update(
          db.collection('events').doc(eventDocIds[candidate.eventId]).collection('activityRecords').doc(ar._docId),
          { status: 'registered' }
        );
        if (!arDocIdsToSyncByEvent[candidate.eventId]) arDocIdsToSyncByEvent[candidate.eventId] = [];
        arDocIdsToSyncByEvent[candidate.eventId].push(ar._docId);
      }
    }

    // 3. 更新 event 投影
    for (const eventId of affectedEventIds) {
      const event = this._cache.events.find(e => e.id === eventId);
      const occupancy = occupancyByEvent[eventId];
      if (event?._docId && occupancy) {
        batch.update(db.collection('events').doc(event._docId), {
          current: occupancy.current,
          realCurrent: occupancy.realCurrent,
          waitlist: occupancy.waitlist,
          participants: occupancy.participants, waitlistNames: occupancy.waitlistNames,
          participantsWithUid: occupancy.participantsWithUid,
          waitlistWithUid: occupancy.waitlistWithUid,
          teamReservationSummaries: occupancy.teamReservationSummaries,
          schemaVersion: 2,
          status: occupancy.status,
        });
      }
    }

    // ── 階段 5：commit 成功後才更新本地快取 ──
    await batch.commit();

    const cancelled = [];
    for (const reg of validRegsToCancel) {
      reg.status = 'cancelled';
      reg.cancelledAt = new Date().toISOString();
      cancelled.push(reg);
    }

    // 同步候補遞補到本地快取
    for (const candidate of promotedCandidates) {
      const localReg = this._cache.registrations.find(r => r.id === candidate.id);
      if (localReg) {
        localReg.status = 'confirmed';
        if (candidate.teamSeatSource) localReg.teamSeatSource = candidate.teamSeatSource;
      }
    }

    // 同步 activityRecord.status 到本地快取（Bug #B 修復）
    if (typeof ApiService !== 'undefined' && ApiService._src) {
      const liveArSource = ApiService._src('activityRecords') || [];
      for (const eventId of Object.keys(arDocIdsToSyncByEvent)) {
        for (const docId of arDocIdsToSyncByEvent[eventId]) {
          const liveAr = liveArSource.find(a => a._docId === docId);
          if (liveAr) liveAr.status = 'registered';
        }
      }
    }

    // 寫入 event 投影到快取
    for (const eventId of affectedEventIds) {
      const event = this._cache.events.find(e => e.id === eventId);
      const occupancy = occupancyByEvent[eventId];
      if (event && occupancy) {
        this._applyRebuildOccupancy(event, occupancy);
      }
    }

    // 記錄遞補資訊供呼叫端使用
    if (promotedCandidates.length > 0 && cancelled.length > 0) {
      cancelled[0]._promotedUserId = promotedCandidates[0].userId;
      cancelled[0]._promotedUserIds = promotedCandidates.map(c => c.userId);
    }

    this._saveToLS('registrations', this._cache.registrations);
    this._saveToLS('events', this._cache.events);

    return cancelled;
  },

  /**
   * Clear all documents in a Firestore collection.
   * Uses batch writes (max 450 per batch to stay under Firestore's 500 limit).
   */
  async clearCollection(collectionName) {
    const snapshot = await db.collection(collectionName).get();
    if (snapshot.empty) return 0;
    const docs = snapshot.docs;
    // Process in chunks of 450
    for (let i = 0; i < docs.length; i += 450) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + 450);
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    return docs.length;
  },

  /**
   * Clear all files under images/ in Firebase Storage.
   * Recursively lists all prefixes (subdirectories) and deletes every file.
   */
  async clearAllStorageImages() {
    const storageTargets = [];
    const seenBuckets = new Set();

    function addStorageTarget(target, bucket) {
      if (!target) return;
      const key = bucket || `bucket-${storageTargets.length}`;
      if (seenBuckets.has(key)) return;
      seenBuckets.add(key);
      storageTargets.push(target);
    }

    addStorageTarget(storage, window._firebaseDefaultStorageBucket || '');
    addStorageTarget(uploadStorage, window._firebaseUploadStorageBucket || '');
    if (!storageTargets.length) return 0;

    let deleted = 0;
    async function deleteFolder(ref) {
      const result = await ref.listAll();
      for (const item of result.items) {
        await item.delete();
        deleted++;
      }
      for (const prefix of result.prefixes) {
        await deleteFolder(prefix);
      }
    }

    for (const target of storageTargets) {
      await deleteFolder(target.ref('images'));
    }

    return deleted;
  },

  // ═══════════════════════════════════════════
  //  Per-User Achievement Progress（子集合）
  // ═══════════════════════════════════════════

  async saveUserAchievementProgress(uid, achId, data) {
    if (!uid || !achId) return;
    try {
      await db.collection('users').doc(uid).collection('achievements')
        .doc(achId).set({
          achId,
          current: data.current || 0,
          completedAt: data.completedAt || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (err) {
      console.warn('[FirebaseService] saveUserAchievementProgress failed:', achId, err);
    }
  },

  async loadUserAchievementProgress(uid) {
    if (!uid) return [];
    try {
      const snap = await db.collection('users').doc(uid)
        .collection('achievements').get();
      return snap.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
    } catch (err) {
      console.warn('[FirebaseService] loadUserAchievementProgress failed:', err);
      return [];
    }
  },

  // ════════════════════════════════
  //  Education: Team Subcollection Helpers
  // ════════════════════════════════

  async _getTeamDocRefById(teamId) {
    const safeId = String(teamId || '').trim();
    if (!safeId) throw new Error('TEAM_ID_REQUIRED');
    const cached = this._cache.teams.find(t => t.id === safeId && t._docId);
    if (cached && cached._docId) return db.collection('teams').doc(cached._docId);
    const snapshot = await db.collection('teams').where('id', '==', safeId).limit(1).get();
    if (snapshot.empty) throw new Error('TEAM_DOC_NOT_FOUND');
    // Phase 2A §7.7：fallback 成功時注入快取（與 _getTournamentDocRefById 對齊）
    const doc = snapshot.docs[0];
    if (!this._cache.teams.find(t => t.id === safeId)) {
      this._cache.teams.push({ ...doc.data(), _docId: doc.id });
    }
    return doc.ref;
  },

  async _getTeamSubcollectionRef(teamId, subcollectionName) {
    const teamRef = await this._getTeamDocRefById(teamId);
    return teamRef.collection(subcollectionName);
  },

  // ════════════════════════════════
  //  Phase 2B: Team Feed CRUD
  // ════════════════════════════════

  async listTeamFeed(teamId) {
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    var snapshot = await collRef.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(function(doc) {
      var data = doc.data();
      data._docId = doc.id;
      if (data.createdAt && typeof data.createdAt.toDate === 'function') {
        data.createdAt = data.createdAt.toDate().toISOString();
      }
      return data;
    });
  },

  async createTeamPost(teamId, post) {
    var authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    var payload = Object.assign({}, post);
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    await collRef.doc(post.id).set(payload);
    // audit log 由 ApiService 層處理
    return post;
  },

  async deleteTeamPost(teamId, postId) {
    var authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    await collRef.doc(postId).delete();
    // audit log 由 ApiService 層處理
  },

  async updateTeamPost(teamId, postId, updates) {
    var authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    await collRef.doc(postId).update(updates);
    // audit log 由 ApiService 層處理
  },

  async pinTeamPost(teamId, postId, pinned) {
    var authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    await collRef.doc(postId).update({ pinned: pinned });
    // audit log 由 ApiService 層處理
  },

  async toggleTeamFeedReaction(teamId, postId, reactionKey, uid, adding) {
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    var updateObj = {};
    updateObj['reactions.' + reactionKey] = adding
      ? firebase.firestore.FieldValue.arrayUnion(uid)
      : firebase.firestore.FieldValue.arrayRemove(uid);
    await collRef.doc(postId).update(updateObj);
  },

  async addTeamFeedComment(teamId, postId, comment) {
    var authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    await collRef.doc(postId).update({
      comments: firebase.firestore.FieldValue.arrayUnion(comment)
    });
    // audit log 由 ApiService 層處理
  },

  async deleteTeamFeedComment(teamId, postId, commentId) {
    var authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    var collRef = await this._getTeamSubcollectionRef(teamId, 'feed');
    var docSnap = await collRef.doc(postId).get();
    if (!docSnap.exists) return;
    var filtered = (docSnap.data().comments || []).filter(function(c) { return c.id !== commentId; });
    await collRef.doc(postId).update({ comments: filtered });
    // audit log 由 ApiService 層處理
  },

  // ════════════════════════════════
  //  Education: Groups CRUD
  // ════════════════════════════════

  async listEduGroups(teamId) {
    const collRef = await this._getTeamSubcollectionRef(teamId, 'groups');
    const snapshot = await collRef.orderBy('sortOrder').get();
    return this._mapCollectionDocs(snapshot);
  },

  async createEduGroup(teamId, data) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'groups');
    const docRef = data.id ? collRef.doc(data.id) : collRef.doc();
    const payload = { ..._stripDocId(data), id: data.id || docRef.id };
    await docRef.set({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    payload._docId = docRef.id;
    return payload;
  },

  async updateEduGroup(teamId, groupId, updates) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'groups');
    await collRef.doc(groupId).update({
      ..._stripDocId(updates),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { id: groupId, ...updates, _docId: groupId };
  },

  async deleteEduGroup(teamId, groupId) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'groups');
    await collRef.doc(groupId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Education: Students CRUD
  // ════════════════════════════════

  async listEduStudents(teamId) {
    const collRef = await this._getTeamSubcollectionRef(teamId, 'students');
    const snapshot = await collRef.get();
    return this._mapCollectionDocs(snapshot);
  },

  async createEduStudent(teamId, data) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'students');
    const docRef = data.id ? collRef.doc(data.id) : collRef.doc();
    const payload = { ..._stripDocId(data), id: data.id || docRef.id };
    await docRef.set({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    payload._docId = docRef.id;
    return payload;
  },

  async updateEduStudent(teamId, studentId, updates) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'students');
    await collRef.doc(studentId).update({
      ..._stripDocId(updates),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { id: studentId, ...updates, _docId: studentId };
  },

  async deleteEduStudent(teamId, studentId) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'students');
    await collRef.doc(studentId).delete();
  },

  // ════════════════════════════════
  //  Education: Course Plans CRUD
  // ════════════════════════════════

  async listEduCoursePlans(teamId) {
    const collRef = await this._getTeamSubcollectionRef(teamId, 'coursePlans');
    const snapshot = await collRef.get();
    return this._mapCollectionDocs(snapshot);
  },

  async createEduCoursePlan(teamId, data) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'coursePlans');
    const docRef = data.id ? collRef.doc(data.id) : collRef.doc();
    const payload = { ..._stripDocId(data), id: data.id || docRef.id };
    await docRef.set({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    payload._docId = docRef.id;
    return payload;
  },

  async updateEduCoursePlan(teamId, planId, updates) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'coursePlans');
    await collRef.doc(planId).update({
      ..._stripDocId(updates),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { id: planId, ...updates, _docId: planId };
  },

  async deleteEduCoursePlan(teamId, planId) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const collRef = await this._getTeamSubcollectionRef(teamId, 'coursePlans');
    await collRef.doc(planId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Education: Course Enrollments CRUD
  // ════════════════════════════════

  async listCourseEnrollments(teamId, planId) {
    const teamRef = await this._getTeamDocRefById(teamId);
    const snapshot = await teamRef.collection('coursePlans').doc(planId)
      .collection('enrollments').get();
    return this._mapCollectionDocs(snapshot);
  },

  async createCourseEnrollment(teamId, planId, data) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    const teamRef = await this._getTeamDocRefById(teamId);
    const collRef = teamRef.collection('coursePlans').doc(planId).collection('enrollments');
    const docRef = data.id ? collRef.doc(data.id) : collRef.doc();
    const payload = { ..._stripDocId(data), id: data.id || docRef.id };
    await docRef.set({
      ...payload,
      appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    payload._docId = docRef.id;
    return payload;
  },

  async updateCourseEnrollment(teamId, planId, enrollId, updates) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗');
    const teamRef = await this._getTeamDocRefById(teamId);
    await teamRef.collection('coursePlans').doc(planId)
      .collection('enrollments').doc(enrollId).update({
        ..._stripDocId(updates),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    return { id: enrollId, ...updates };
  },

  // ════════════════════════════════
  //  Education: Attendance (eduAttendance top-level)
  // ════════════════════════════════

  async addEduAttendance(data) {
    const authed = await this.ensureAuthReadyForWrite();
    if (!authed) throw new Error('Firebase 登入失敗\n請清除瀏覽器緩存後重新登入\n若仍異常請聯繫管理員');
    const docRef = data.id ? db.collection('eduAttendance').doc(data.id) : db.collection('eduAttendance').doc();
    const payload = { ..._stripDocId(data), id: data.id || docRef.id };
    await docRef.set({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    payload._docId = docRef.id;
    return payload;
  },

  async queryEduAttendance(filters) {
    let query = db.collection('eduAttendance');
    if (filters.teamId) query = query.where('teamId', '==', filters.teamId);
    if (filters.groupId) query = query.where('groupId', '==', filters.groupId);
    if (filters.studentId) query = query.where('studentId', '==', filters.studentId);
    if (filters.coursePlanId) query = query.where('coursePlanId', '==', filters.coursePlanId);
    if (filters.date) query = query.where('date', '==', filters.date);
    const snapshot = await query.get();
    return this._mapCollectionDocs(snapshot).filter(r => r.status !== 'removed');
  },

});
