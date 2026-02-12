/* ================================================
   SportHub — Firebase Service: CRUD Operations
   ================================================
   所有 Firestore 讀寫操作（Object.assign 擴充 FirebaseService）
   ================================================ */

Object.assign(FirebaseService, {

  // ════════════════════════════════
  //  Role Permissions CRUD
  // ════════════════════════════════

  async saveRolePermissions(roleKey, permissions) {
    try {
      await db.collection('rolePermissions').doc(roleKey).set({ permissions }, { merge: true });
    } catch (err) { console.error('[saveRolePermissions]', err); }
  },

  async deleteRolePermissions(roleKey) {
    try {
      await db.collection('rolePermissions').doc(roleKey).delete();
    } catch (err) { console.error('[deleteRolePermissions]', err); }
  },

  // ════════════════════════════════
  //  Custom Roles CRUD
  // ════════════════════════════════

  async addCustomRole(data) {
    try {
      await db.collection('customRoles').doc(data.key).set(data, { merge: true });
      data._docId = data.key;
    } catch (err) { console.error('[addCustomRole]', err); }
    return data;
  },

  async deleteCustomRole(key) {
    try {
      await db.collection('customRoles').doc(key).delete();
    } catch (err) { console.error('[deleteCustomRole]', err); }
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

  // ════════════════════════════════
  //  Attendance Records（簽到/簽退）
  // ════════════════════════════════

  async addAttendanceRecord(data) {
    const docRef = await db.collection('attendanceRecords').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  // ════════════════════════════════
  //  Registrations（報名系統）
  // ════════════════════════════════

  async registerForEvent(eventId, userId, userName) {
    const event = this._cache.events.find(e => e.id === eventId);
    if (!event) throw new Error('活動不存在');

    // 檢查重複報名
    const existing = this._cache.registrations.find(
      r => r.eventId === eventId && r.userId === userId && r.status !== 'cancelled'
    );
    if (existing) throw new Error('已報名此活動');

    const isWaitlist = event.current >= event.max;
    const status = isWaitlist ? 'waitlisted' : 'confirmed';
    const registration = {
      id: 'reg_' + Date.now(),
      eventId,
      userId,
      userName,
      status,
      registeredAt: new Date().toISOString(),
    };

    // 寫入 Firestore
    const docRef = await db.collection('registrations').add({
      ...registration,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    registration._docId = docRef.id;
    this._cache.registrations.push(registration);

    // 更新活動計數（確保不會同時出現在兩個名單）
    if (status === 'confirmed') {
      event.current++;
      if (!event.participants) event.participants = [];
      if (!event.participants.includes(userName)) event.participants.push(userName);
      // 安全移除：確保不在候補名單
      if (event.waitlistNames) {
        const wi = event.waitlistNames.indexOf(userName);
        if (wi >= 0) { event.waitlistNames.splice(wi, 1); event.waitlist = Math.max(0, (event.waitlist || 0) - 1); }
      }
    } else {
      event.waitlist = (event.waitlist || 0) + 1;
      if (!event.waitlistNames) event.waitlistNames = [];
      if (!event.waitlistNames.includes(userName)) event.waitlistNames.push(userName);
      // 安全移除：確保不在正取名單
      if (event.participants) {
        const pi = event.participants.indexOf(userName);
        if (pi >= 0) { event.participants.splice(pi, 1); event.current = Math.max(0, event.current - 1); }
      }
    }

    // 正取滿即標記為 full（候補無限）
    if (event.current >= event.max) event.status = 'full';

    const eventUpdate = {
      current: event.current,
      waitlist: event.waitlist,
      participants: event.participants,
      waitlistNames: event.waitlistNames,
      status: event.status,
    };

    await db.collection('events').doc(event._docId).update(eventUpdate);

    return { registration, status };
  },

  async cancelRegistration(registrationId) {
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
      const pIdx = (event.participants || []).indexOf(reg.userName);
      if (pIdx >= 0) {
        event.participants.splice(pIdx, 1);
        event.current = Math.max(0, event.current - 1);
      }
      const wIdx = (event.waitlistNames || []).indexOf(reg.userName);
      if (wIdx >= 0) {
        event.waitlistNames.splice(wIdx, 1);
        event.waitlist = Math.max(0, event.waitlist - 1);
      }

      // 候補遞補：將第一位候補轉為正式
      if (event.waitlistNames && event.waitlistNames.length > 0 && event.current < event.max) {
        const promoted = event.waitlistNames.shift();
        event.waitlist = Math.max(0, event.waitlist - 1);
        // 確保遞補者不會重複出現在正取名單
        if (!event.participants.includes(promoted)) {
          event.participants.push(promoted);
          event.current++;
        }

        // 更新被遞補者的 registration 狀態
        const promotedReg = this._cache.registrations.find(
          r => r.eventId === event.id && r.userName === promoted && r.status === 'waitlisted'
        );
        if (promotedReg) {
          promotedReg.status = 'confirmed';
          reg._promotedUserId = promotedReg.userId;
          if (promotedReg._docId) {
            await db.collection('registrations').doc(promotedReg._docId).update({ status: 'confirmed' });
          }
        }
      }

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

    return reg;
  },

  getRegistrationsByUser(userId) {
    return this._cache.registrations.filter(
      r => r.userId === userId && r.status !== 'cancelled'
    );
  },

  getRegistrationsByEvent(eventId) {
    return this._cache.registrations.filter(
      r => r.eventId === eventId && r.status !== 'cancelled'
    );
  },

  // ════════════════════════════════
  //  Tournaments
  // ════════════════════════════════

  async addTournament(data) {
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
    const { userId: lineUserId, displayName, pictureUrl, email } = lineProfile;
    const snapshot = await db.collection('users')
      .where('lineUserId', '==', lineUserId).limit(1).get();

    const now = new Date().toISOString();

    console.log('[FirebaseService] createOrUpdateUser 查詢結果: empty=', snapshot.empty, 'auth.uid=', auth.currentUser?.uid);

    if (snapshot.empty) {
      // 新用戶：建立完整欄位（以 lineUserId 作為 doc ID，確保可預測且符合安全規則）
      const userData = {
        uid: lineUserId,
        lineUserId,
        displayName,
        pictureUrl: pictureUrl || null,
        email: email || null,
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
      const docId = lineUserId;
      await db.collection('users').doc(docId).set({
        ..._stripDocId(userData),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
      });
      userData._docId = docId;
      userData._isNewUser = true;
      this._cache.currentUser = userData;
      this._setupUserListener(docId);
      console.log('[FirebaseService] 新用戶建立:', displayName, 'docId:', docId);
      return userData;
    } else {
      // 既有用戶：更新 displayName, pictureUrl, lastLogin（並補齊 uid 欄位）
      const doc = snapshot.docs[0];
      const existing = { ...doc.data(), _docId: doc.id };
      const updates = { displayName, pictureUrl: pictureUrl || null, lastLogin: now };
      // 補齊早期缺少的 uid 欄位
      if (!existing.uid) updates.uid = lineUserId;
      await db.collection('users').doc(doc.id).update({
        ...updates,
        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
      });
      Object.assign(existing, updates);
      this._cache.currentUser = existing;
      this._setupUserListener(doc.id);
      console.log('[FirebaseService] 用戶登入更新:', displayName);
      return existing;
    }
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
          this._cache.currentUser = { ...doc.data(), _docId: doc.id };
          if (this._onUserChanged) this._onUserChanged();
        }
      },
      err => console.warn('[onSnapshot] currentUser 監聽錯誤:', err)
    );
  },

  async getUser(lineUserId) {
    const snapshot = await db.collection('users')
      .where('lineUserId', '==', lineUserId).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { ...doc.data(), _docId: doc.id };
  },

  async updateUser(docId, updates) {
    await db.collection('users').doc(docId).update({
      ...updates,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // ════════════════════════════════
  //  Image Upload（Firebase Storage）
  // ════════════════════════════════

  async _uploadImage(base64DataUrl, path) {
    try {
      if (!storage) { console.error('[Storage] storage 未初始化'); return null; }
      const ref = storage.ref().child(`images/${path}_${Date.now()}`);
      const snapshot = await ref.putString(base64DataUrl, 'data_url');
      const url = await snapshot.ref.getDownloadURL();
      console.log('[Storage] 圖片上傳成功:', path);
      return url;
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
    const doc = this._cache.banners.find(b => b.id === id);
    if (!doc || !doc._docId) return null;
    // 避免 base64 寫入 Firestore（超過 1MB 限制）
    if (updates.image && updates.image.startsWith('data:')) delete updates.image;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('banners').doc(doc._docId).update(updates);
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
    const docRef = await db.collection('messages').add({
      ..._stripDocId(data),
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
    await db.collection('operationLogs').add({
      ..._stripDocId(data),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

});
