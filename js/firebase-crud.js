/* ================================================
   SportHub — Firebase Service: CRUD Operations
   ================================================
   所有 Firestore 讀寫操作（Object.assign 擴充 FirebaseService）
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
      try {
        await auth.currentUser.getIdToken(true);
        if (hasExpectedUid(auth.currentUser.uid)) {
          console.log('[_ensureAuth] token refresh ok, uid=', auth.currentUser.uid);
          return true;
        }
        console.warn('[_ensureAuth] uid mismatch after token refresh, current=', auth.currentUser.uid, 'expected=', expectedUid);
      } catch (e) {
        console.warn('[_ensureAuth] token refresh failed:', e.code, e.message);
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
    await db.collection('rolePermissions').doc(roleKey).set({ permissions }, { merge: true });
  },

  async saveRolePermissionDefaults(roleKey, defaultPermissions) {
    await db.collection('rolePermissions').doc(roleKey).set({ defaultPermissions }, { merge: true });
  },

  async deleteRolePermissions(roleKey) {
    await db.collection('rolePermissions').doc(roleKey).delete();
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
    const batch = db.batch();
    batch.set(db.collection('customRoles').doc(data.key), data, { merge: true });
    batch.set(db.collection('rolePermissions').doc(data.key), {
      permissions,
      defaultPermissions,
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
    if (doc) Object.assign(doc, updates);
    try {
      await db.collection('notifTemplates').doc(key).update({
        ...updates,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
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
    return snapshot.docs[0].ref;
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

  async createTournamentApplication(tournamentId, data) {
    const collectionRef = await this._getTournamentSubcollectionRef(tournamentId, 'applications');
    const payload = (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentApplicationRecord === 'function')
      ? App._buildFriendlyTournamentApplicationRecord(data)
      : { ...data };
    const docRef = payload.id ? collectionRef.doc(payload.id) : collectionRef.doc();
    payload.id = payload.id || docRef.id;
    await docRef.set({
      ..._stripDocId(payload),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    payload._docId = docRef.id;
    return payload;
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
    if (updates.image && typeof updates.image === 'string' && updates.image.startsWith('data:')) {
      const uploadedUrl = await this._uploadImage(updates.image, `events/${id}`);
      if (uploadedUrl) updates.image = uploadedUrl;
      else delete updates.image;
    }
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('events').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteEvent(id) {
    const doc = this._cache.events.find(e => e.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('events').doc(doc._docId).delete();
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
    const doc = this._cache.eventTemplates.find(t => t.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('eventTemplates').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Attendance Records（簽到/簽退）
  // ════════════════════════════════

  async addAttendanceRecord(data) {
    const docRef = await db.collection('attendanceRecords').add({
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
      await db.collection('attendanceRecords').doc(target._docId).update(updates);
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

  // ════════════════════════════════
  //  Registrations（報名系統）
  // ════════════════════════════════

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
      if (eventData.status !== 'ended') {
        eventData.status = 'ended';
        if (eventData._docId) {
          try {
            await db.collection('events').doc(eventData._docId).update({ status: 'ended' });
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

  async registerForEvent(eventId, userId, userName) {
    if (!userId || userId === 'unknown') throw new Error('用戶資料載入中，請稍候再試');

    // 確保 Firebase Auth 已登入
    const authed = await this._ensureAuth();
    if (!authed) {
      throw new Error('Firebase 登入失敗，請關閉此頁面後重新從 LINE 開啟');
    }
    console.log('[registerForEvent] auth OK, uid:', auth.currentUser?.uid, 'userId:', userId);

    const event = this._cache.events.find(e => e.id === eventId);
    if (!event) throw new Error('活動不存在');

    // 檢查重複報名（快取）
    await this._assertEventSignupOpen(event);

    const existing = this._cache.registrations.find(
      r => r.eventId === eventId && r.userId === userId && r.status !== 'cancelled' && r.status !== 'removed'
    );
    if (existing) throw new Error('已報名此活動');

    // 防幽靈：清快取後快取可能為空，直接查 Firestore 做二次確認
    let fsCheck;
    try {
      fsCheck = await db.collection('registrations')
        .where('eventId', '==', eventId)
        .where('userId', '==', userId)
        .get();
    } catch (queryErr) {
      console.error('[registerForEvent] 查詢 registrations 失敗:', queryErr.code, queryErr.message);
      throw queryErr;
    }
    const hasActive = fsCheck.docs.some(d => {
      const s = d.data().status;
      return s === 'confirmed' || s === 'waitlisted';
    });
    if (hasActive) throw new Error('已報名此活動');

    const occupancy = this._getEventOccupancyState(event);
    const participants = occupancy.hasParticipantArray ? [...occupancy.participants] : null;
    const waitlistNames = occupancy.hasWaitlistArray ? [...occupancy.waitlistNames] : null;
    const isWaitlist = occupancy.current >= event.max;
    const status = isWaitlist ? 'waitlisted' : 'confirmed';
    const registration = {
      id: 'reg_' + Date.now(),
      eventId,
      userId,
      userName,
      participantType: 'self',
      status,
      promotionOrder: 0,
      registeredAt: new Date().toISOString(),
    };

    // 寫入 registrations
    let docRef;
    try {
      docRef = await db.collection('registrations').add({
        ...registration,
        registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      console.log('[registerForEvent] registrations.add OK, docId:', docRef.id);
    } catch (addErr) {
      console.error('[registerForEvent] registrations.add 失敗:', addErr.code, addErr.message);
      throw addErr;
    }
    registration._docId = docRef.id;
    this._cache.registrations.push(registration);

    // 更新活動計數（確保不會同時出現在兩個名單）
    let nextCurrent = occupancy.current;
    let nextWaitlist = occupancy.waitlist;

    if (status === 'confirmed') {
      nextCurrent++;
      if (participants && !participants.includes(userName)) participants.push(userName);
      if (waitlistNames) {
        const wi = waitlistNames.indexOf(userName);
        if (wi >= 0) waitlistNames.splice(wi, 1);
      }
    } else {
      nextWaitlist++;
      if (waitlistNames && !waitlistNames.includes(userName)) waitlistNames.push(userName);
      if (participants) {
        const pi = participants.indexOf(userName);
        if (pi >= 0) participants.splice(pi, 1);
      }
    }

    if (participants) nextCurrent = participants.length;
    if (waitlistNames) nextWaitlist = waitlistNames.length;

    event.current = nextCurrent;
    event.waitlist = nextWaitlist;
    if (participants) event.participants = participants;
    if (waitlistNames) event.waitlistNames = waitlistNames;
    event.status = event.current >= event.max ? 'full' : 'open';

    const eventUpdate = {
      current: event.current,
      waitlist: event.waitlist,
      status: event.status,
    };
    if (participants) eventUpdate.participants = event.participants;
    if (waitlistNames) eventUpdate.waitlistNames = event.waitlistNames;

    try {
      await db.collection('events').doc(event._docId).update(eventUpdate);
      console.log('[registerForEvent] events.update OK, docId:', event._docId);
    } catch (updateErr) {
      console.error('[registerForEvent] events.update 失敗:', updateErr.code, updateErr.message);
      throw updateErr;
    }

    this._saveToLS('registrations', this._cache.registrations);
    this._saveToLS('events', this._cache.events);

    return { registration, status };
  },

  async cancelRegistration(registrationId) {
    await this._ensureAuth();
    const reg = this._cache.registrations.find(r => r.id === registrationId);
    if (!reg) throw new Error('報名記錄不存在');

    reg.status = 'cancelled';
    reg.cancelledAt = new Date().toISOString();

    await db.collection('registrations').doc(reg._docId).update({
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // 更新活動計數
    const event = this._cache.events.find(e => e.id === reg.eventId);
    if (event) {
      const participantName = reg.companionName || reg.userName;
      const pIdx = (event.participants || []).indexOf(participantName);
      if (pIdx >= 0) {
        event.participants.splice(pIdx, 1);
        event.current = Math.max(0, event.current - 1);
      }
      const wIdx = (event.waitlistNames || []).indexOf(participantName);
      if (wIdx >= 0) {
        event.waitlistNames.splice(wIdx, 1);
        event.waitlist = Math.max(0, event.waitlist - 1);
      }

      this._applyEventOccupancyState(event);

      // 候補遞補：取排序最前的候補者逐人遞補
      if (event.current < event.max) {
        const candidate = this._cache.registrations
          .filter(r => r.eventId === event.id && r.status === 'waitlisted')
          .sort((a, b) => {
            const ta = new Date(a.registeredAt).getTime();
            const tb = new Date(b.registeredAt).getTime();
            if (ta !== tb) return ta - tb;
            return (a.promotionOrder || 0) - (b.promotionOrder || 0);
          })[0];

        if (candidate) {
          const pName = candidate.participantType === 'companion'
            ? (candidate.companionName || candidate.userName)
            : candidate.userName;

          candidate.status = 'confirmed';
          reg._promotedUserId = candidate.userId;
          if (candidate._docId) {
            await db.collection('registrations').doc(candidate._docId).update({ status: 'confirmed' });
          }

          const wIdx = (event.waitlistNames || []).indexOf(pName);
          if (wIdx >= 0) event.waitlistNames.splice(wIdx, 1);
          event.waitlist = Math.max(0, event.waitlist - 1);
          if (!event.participants.includes(pName)) {
            event.participants.push(pName);
            event.current++;
          }
        }
      }

      this._applyEventOccupancyState(event);

      // 遞補後重新判斷 status：正取滿=full，有空位=open
      event.status = event.current >= event.max ? 'full' : 'open';

      if (event._docId) {
        await db.collection('events').doc(event._docId).update({
          current: event.current,
          waitlist: event.waitlist,
          participants: event.participants,
          waitlistNames: event.waitlistNames,
          status: event.status,
        });
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
    if (typeof App !== 'undefined' && typeof App._buildFriendlyTournamentRecord === 'function') {
      Object.assign(data, App._buildFriendlyTournamentRecord(data));
    }
    if (data.image && data.image.startsWith('data:')) {
      data.image = await this._uploadImage(data.image, `tournaments/${data.id}`);
    }
    if (data.contentImage && data.contentImage.startsWith('data:')) {
      data.contentImage = await this._uploadImage(data.contentImage, `tournaments/${data.id}_content`);
    }
    const docRef = await db.collection('tournaments').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
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
    if (data.image && data.image.startsWith('data:')) {
      data.image = await this._uploadImage(data.image, `teams/${data.id}`);
    }
    const docRef = await db.collection('teams').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
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
  //  User Points（積分系統）
  // ════════════════════════════════

  async updateUserPoints(userId, pointsDelta, reason, operatorLabel) {
    const user = this._cache.adminUsers.find(u => u.uid === userId);
    if (!user) throw new Error('用戶不存在');

    user.exp = Math.max(0, (user.exp || 0) + pointsDelta);

    if (user._docId) {
      await db.collection('users').doc(user._docId).update({
        exp: user.exp,
      });
    }

    // 記錄 EXP 操作日誌
    const now = new Date();
    const log = {
      time: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      target: user.name,
      amount: (pointsDelta > 0 ? '+' : '') + pointsDelta,
      reason: reason,
      operator: operatorLabel || '管理員',
    };
    await db.collection('expLogs').add({
      ...log,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    this._cache.expLogs.unshift(log);

    return user;
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
          } else if (typeof App !== 'undefined' && !ModeManager.isDemo()) {
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

  async addMessage(data) {
    const authed = await this._ensureAuth();
    if (!authed || !auth?.currentUser) {
      throw {
        code: 'unauthenticated',
        message: 'Firebase auth required before creating messages.',
      };
    }
    const docRef = await db.collection('messages').add({
      ..._stripDocId(data),
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  async updateMessage(msgId, updates) {
    const doc = this._cache.messages.find(m => m.id === msgId);
    if (!doc || !doc._docId) return null;
    await db.collection('messages').doc(doc._docId).update(updates);
    return doc;
  },

  async clearAllMessages() {
    const msgs = this._cache.messages.filter(m => m._docId);
    if (!msgs.length) { this._cache.messages.length = 0; return; }
    // Firestore batch 上限 500，分批刪除
    for (let i = 0; i < msgs.length; i += 450) {
      const chunk = msgs.slice(i, i + 450);
      const batch = db.batch();
      chunk.forEach(m => batch.delete(db.collection('messages').doc(m._docId)));
      await batch.commit();
    }
    this._cache.messages.length = 0;
  },

  // ════════════════════════════════
  //  User Role（用戶晉升）
  // ════════════════════════════════

  async updateUserRole(docId, newRole) {
    await db.collection('users').doc(docId).update({
      role: newRole,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await this._syncUserRoleClaims(docId);
  },

  // ════════════════════════════════
  //  Message Read Status（訊息已讀）
  // ════════════════════════════════

  async updateMessageRead(msgId) {
    const doc = this._cache.messages.find(m => m.id === msgId);
    if (!doc || !doc._docId) return null;
    await db.collection('messages').doc(doc._docId).update({ unread: false });
    return doc;
  },

  async markAllMessagesRead() {
    const unread = this._cache.messages.filter(m => m.unread && m._docId);
    if (unread.length === 0) return;
    const batch = db.batch();
    unread.forEach(m => {
      batch.update(db.collection('messages').doc(m._docId), { unread: false });
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

  // ════════════════════════════════
  //  Companions（同行者）
  // ════════════════════════════════

  async updateUserCompanions(docId, companions) {
    await db.collection('users').doc(docId).update({
      companions,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // ════════════════════════════════
  //  Batch Registration（批次報名）
  // ════════════════════════════════

  async batchRegisterForEvent(eventId, entries) {
    await this.ensureAuthReadyForWrite();
    const mainUserId = entries[0]?.userId;
    if (!mainUserId || mainUserId === 'unknown') throw new Error('用戶資料載入中，請稍候再試');
    const event = this._cache.events.find(e => e.id === eventId);
    if (!event || !event._docId) throw new Error('活動不存在');

    // 防幽靈：在 transaction 前先查 Firestore 確認主報名者是否已報名
    // 只用 eventId + userId 兩欄位查詢，避免需要複合索引
    await this._assertEventSignupOpen(event);

    const fsCheck = await db.collection('registrations')
      .where('eventId', '==', eventId)
      .where('userId', '==', mainUserId)
      .get();
    const hasActive = fsCheck.docs.some(d => {
      const s = d.data().status;
      return s === 'confirmed' || s === 'waitlisted';
    });
    if (hasActive) throw new Error('已報名此活動');

    const eventRef = db.collection('events').doc(event._docId);
    const regDocRefs = entries.map(() => db.collection('registrations').doc());

    const result = await db.runTransaction(async (transaction) => {
      // 原子讀取活動最新狀態
      const eventDoc = await transaction.get(eventRef);
      if (!eventDoc.exists) throw new Error('活動不存在');
      const ed = eventDoc.data();
      const occupancy = this._getEventOccupancyState(ed);
      const maxCount = ed.max || 0;
      const participants = occupancy.hasParticipantArray ? [...occupancy.participants] : null;
      const waitlistNames = occupancy.hasWaitlistArray ? [...occupancy.waitlistNames] : null;
      let currentCount = occupancy.current;
      let waitlistCount = occupancy.waitlist;

      const registrations = [];
      let confirmed = 0, waitlisted = 0;
      let refIdx = 0;
      let promotionIdx = 0;

      for (const entry of entries) {
        const dupKey = entry.companionId ? `${entry.userId}_${entry.companionId}` : entry.userId;
        const existing = this._cache.registrations.find(r => {
          if (r.eventId !== eventId || r.status === 'cancelled' || r.status === 'removed') return false;
          const rKey = r.companionId ? `${r.userId}_${r.companionId}` : r.userId;
          return rKey === dupKey;
        });
        if (existing) { refIdx++; promotionIdx++; continue; }

        const isWaitlist = currentCount >= maxCount;
        const status = isWaitlist ? 'waitlisted' : 'confirmed';
        const displayName = entry.companionName || entry.userName;

        const reg = {
          id: 'reg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId,
          userId: entry.userId,
          userName: entry.userName,
          participantType: entry.participantType || 'self',
          companionId: entry.companionId || null,
          companionName: entry.companionName || null,
          status,
          promotionOrder: promotionIdx,
          registeredAt: new Date().toISOString(),
        };
        promotionIdx++;

        const docRef = regDocRefs[refIdx];
        transaction.set(docRef, { ..._stripDocId(reg), registeredAt: firebase.firestore.FieldValue.serverTimestamp() });
        reg._docId = docRef.id;
        registrations.push(reg);

        if (status === 'confirmed') {
          confirmed++;
          currentCount++;
          if (participants && !participants.includes(displayName)) participants.push(displayName);
          if (waitlistNames) {
            const wi = waitlistNames.indexOf(displayName);
            if (wi >= 0) waitlistNames.splice(wi, 1);
          }
        } else {
          waitlisted++;
          waitlistCount++;
          if (waitlistNames && !waitlistNames.includes(displayName)) waitlistNames.push(displayName);
        }
        if (participants) currentCount = participants.length;
        if (waitlistNames) waitlistCount = waitlistNames.length;
        refIdx++;
      }

      const newCurrent = currentCount;
      const newWaitlist = waitlistCount;
      const newStatus = newCurrent >= maxCount ? 'full' : (ed.status || 'open');
      const eventUpdate = {
        current: newCurrent,
        waitlist: newWaitlist,
        status: newStatus,
      };
      if (participants) eventUpdate.participants = participants;
      if (waitlistNames) eventUpdate.waitlistNames = waitlistNames;

      transaction.update(eventRef, eventUpdate);

      return {
        registrations,
        confirmed,
        waitlisted,
        newCurrent,
        newWaitlist,
        newStatus,
        participants,
        waitlistNames,
        hasParticipantArray: occupancy.hasParticipantArray,
        hasWaitlistArray: occupancy.hasWaitlistArray,
      };
    });

    // Transaction 成功後同步本地快取
    event.current = result.newCurrent;
    event.waitlist = result.newWaitlist;
    event.status = result.newStatus;
    if (result.hasParticipantArray) event.participants = result.participants;
    if (result.hasWaitlistArray) event.waitlistNames = result.waitlistNames;
    result.registrations.forEach(r => this._cache.registrations.push(r));

    // 立即寫入 localStorage，避免刷新後資料遺失
    this._saveToLS('registrations', this._cache.registrations);
    this._saveToLS('events', this._cache.events);

    return { registrations: result.registrations, confirmed: result.confirmed, waitlisted: result.waitlisted };
  },

  async cancelCompanionRegistrations(regIds) {
    await this.ensureAuthReadyForWrite();
    const batch = db.batch();
    const cancelled = [];

    for (const regId of regIds) {
      const reg = this._cache.registrations.find(r => r.id === regId);
      if (!reg || reg.status === 'cancelled' || reg.status === 'removed') continue;

      reg.status = 'cancelled';
      reg.cancelledAt = new Date().toISOString();
      if (reg._docId) {
        batch.update(db.collection('registrations').doc(reg._docId), {
          status: 'cancelled',
          cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }

      const event = this._cache.events.find(e => e.id === reg.eventId);
      if (event) {
        const participantName = reg.companionName || reg.userName;
        const pIdx = (event.participants || []).indexOf(participantName);
        if (pIdx >= 0) { event.participants.splice(pIdx, 1); event.current = Math.max(0, event.current - 1); }
        const wIdx = (event.waitlistNames || []).indexOf(participantName);
        if (wIdx >= 0) { event.waitlistNames.splice(wIdx, 1); event.waitlist = Math.max(0, event.waitlist - 1); }
      }
      cancelled.push(reg);
    }

    if (cancelled.length === 0) return cancelled;

    // 按活動分組處理遞補（避免重複更新同一活動）
    const affectedEvents = new Set(cancelled.map(r => r.eventId));
    for (const eventId of affectedEvents) {
      const event = this._cache.events.find(e => e.id === eventId);
      if (!event) continue;

      this._applyEventOccupancyState(event);

      // 逐人遞補：每個空位取排序最前的候補
      while (event.current < event.max) {
        const candidate = this._cache.registrations
          .filter(r => r.eventId === eventId && r.status === 'waitlisted')
          .sort((a, b) => {
            const ta = new Date(a.registeredAt).getTime();
            const tb = new Date(b.registeredAt).getTime();
            if (ta !== tb) return ta - tb;
            return (a.promotionOrder || 0) - (b.promotionOrder || 0);
          })[0];

        if (!candidate) break;

        const pName = candidate.participantType === 'companion'
          ? (candidate.companionName || candidate.userName)
          : candidate.userName;

        candidate.status = 'confirmed';
        if (candidate._docId) batch.update(db.collection('registrations').doc(candidate._docId), { status: 'confirmed' });

        const wIdx = (event.waitlistNames || []).indexOf(pName);
        if (wIdx >= 0) event.waitlistNames.splice(wIdx, 1);
        event.waitlist = Math.max(0, event.waitlist - 1);
        if (!event.participants.includes(pName)) { event.participants.push(pName); event.current++; }
      }

      this._applyEventOccupancyState(event);
      event.status = event.current >= event.max ? 'full' : 'open';
      if (event._docId) {
        batch.update(db.collection('events').doc(event._docId), {
          current: event.current, waitlist: event.waitlist,
          participants: event.participants, waitlistNames: event.waitlistNames, status: event.status,
        });
      }
    }

    await batch.commit();

    // 立即寫入 localStorage
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

});
