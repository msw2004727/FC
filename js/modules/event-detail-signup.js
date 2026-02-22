/* ================================================
   SportHub — Event: Signup & Cancel (with Companions)
   依賴：event-detail.js, event-list.js, api-service.js, auto-exp.js, message-inbox.js
   同行者 Modal 邏輯位於 event-detail-companion.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Signup & Cancel
  // ══════════════════════════════════

  /** 恢復報名時移除該活動的取消紀錄（恢復報名則不列為取消） */
  _removeCancelRecordOnResignup(eventId, uid) {
    const source = ApiService._src('activityRecords');
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].eventId === eventId && source[i].uid === uid && source[i].status === 'cancelled') {
        if (!ModeManager.isDemo() && source[i]._docId) {
          db.collection('activityRecords').doc(source[i]._docId).delete()
            .catch(err => console.error('[removeCancelRecord]', err));
        }
        source.splice(i, 1);
      }
    }
  },

  handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e.status === 'upcoming') { this.showToast('報名尚未開放，請稍後再試'); return; }

    // 有同行者 → 顯示選人 Modal
    const companions = ApiService.getCompanions();
    if (companions.length > 0) {
      this._openCompanionSelectModal(id);
      return;
    }

    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    // 恢復報名 → 移除之前的取消紀錄
    this._removeCancelRecordOnResignup(id, userId);

    if (ApiService._demoMode) {
      if (this._isUserSignedUp(e)) {
        this.showToast('您已報名此活動');
        return;
      }
      const isWaitlist = e.current >= e.max;
      if (isWaitlist) {
        if (!e.waitlistNames) e.waitlistNames = [];
        if (!e.waitlistNames.includes(userName)) e.waitlistNames.push(userName);
        e.waitlist = (e.waitlist || 0) + 1;
        const pi = (e.participants || []).indexOf(userName);
        if (pi >= 0) { e.participants.splice(pi, 1); e.current = Math.max(0, e.current - 1); }
      } else {
        if (!e.participants) e.participants = [];
        if (!e.participants.includes(userName)) e.participants.push(userName);
        e.current++;
        const wi = (e.waitlistNames || []).indexOf(userName);
        if (wi >= 0) { e.waitlistNames.splice(wi, 1); e.waitlist = Math.max(0, (e.waitlist || 0) - 1); }
      }
      if (e.current >= e.max) e.status = 'full';
      // 建立 registration record
      ApiService.registerEventWithCompanions(id, [{ type: 'self' }]).catch(() => {});
      const dateParts = e.date.split(' ')[0].split('/');
      const dateStr = `${dateParts[1]}/${dateParts[2]}`;
      ApiService.addActivityRecord({
        eventId: e.id, name: e.title, date: dateStr,
        status: isWaitlist ? 'waitlisted' : 'registered', uid: userId,
      });
      this.showToast(isWaitlist ? '已加入候補名單' : '報名成功！');
      if (!isWaitlist) this._grantAutoExp(userId, 'register_activity', e.title);
      this._sendNotifFromTemplate('signup_success', {
        eventName: e.title, date: e.date, location: e.location,
        status: isWaitlist ? '候補' : '正取',
      }, userId, 'activity', '活動');
      this.showEventDetail(id);
      return;
    }

    FirebaseService.registerForEvent(id, userId, userName)
      .then(result => {
        const dateParts = e.date.split(' ')[0].split('/');
        const dateStr = `${dateParts[1]}/${dateParts[2]}`;
        ApiService.addActivityRecord({
          eventId: e.id, name: e.title, date: dateStr,
          status: result.status === 'waitlisted' ? 'waitlisted' : 'registered', uid: userId,
        });
        db.collection('activityRecords').add({
          eventId: e.id, name: e.title, date: dateStr,
          status: result.status === 'waitlisted' ? 'waitlisted' : 'registered',
          uid: userId, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(err => console.error('[activityRecord]', err));
        this._sendNotifFromTemplate('signup_success', {
          eventName: e.title, date: e.date, location: e.location,
          status: result.status === 'waitlisted' ? '候補' : '正取',
        }, userId, 'activity', '活動');
        this.showToast(result.status === 'waitlisted' ? '已加入候補名單' : '報名成功！');
        this.showEventDetail(id);
      })
      .catch(err => {
        console.error('[handleSignup]', err);
        this.showToast(err.message || '報名失敗，請稍後再試');
      });
  },

  async handleCancelSignup(id) {
    // 有多筆報名（含同行者）→ 顯示取消選擇 Modal
    const myRegs = ApiService.getMyRegistrationsByEvent(id);
    if (myRegs.length > 1) {
      this._openCompanionCancelModal(id, myRegs);
      return;
    }

    const e0 = ApiService.getEvent(id);
    const isWaitlist = e0 && this._isUserOnWaitlist(e0);
    const confirmMsg = isWaitlist ? '確定要取消候補？' : '確定要取消報名？';
    if (!await this.appConfirm(confirmMsg)) return;
    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    if (ApiService._demoMode) {
      const e = ApiService.getEvent(id);
      if (e) {
        const pi = (e.participants || []).indexOf(userName);
        if (pi !== -1) {
          e.participants.splice(pi, 1);
          e.current = Math.max(0, e.current - 1);
          if (e.waitlistNames && e.waitlistNames.length > 0) {
            const promoted = e.waitlistNames.shift();
            e.waitlist = Math.max(0, e.waitlist - 1);
            if (!e.participants.includes(promoted)) {
              e.participants.push(promoted);
              e.current++;
            }
            const adminUsers = ApiService.getAdminUsers();
            const promotedUser = adminUsers.find(u => u.name === promoted);
            if (promotedUser) {
              this._sendNotifFromTemplate('waitlist_promoted', {
                eventName: e.title, date: e.date, location: e.location,
              }, promotedUser.uid, 'activity', '活動');
            }
          }
          e.status = e.current >= e.max ? 'full' : 'open';
        } else {
          const wi = (e.waitlistNames || []).indexOf(userName);
          if (wi !== -1) {
            e.waitlistNames.splice(wi, 1);
            e.waitlist = Math.max(0, e.waitlist - 1);
          }
        }
        // 更新 demo registrations 狀態
        const demoRegs = ApiService._src('registrations');
        for (let i = demoRegs.length - 1; i >= 0; i--) {
          if (demoRegs[i].eventId === id && demoRegs[i].userId === userId && demoRegs[i].status !== 'cancelled') {
            demoRegs[i].status = 'cancelled';
            demoRegs[i].cancelledAt = new Date().toISOString();
          }
        }
        const records = ApiService.getActivityRecords();
        const hasCancelRecord = records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled');
        for (let i = records.length - 1; i >= 0; i--) {
          if (records[i].eventId === id && records[i].uid === userId && records[i].status !== 'cancelled') {
            records.splice(i, 1);
          }
        }
        if (!hasCancelRecord) {
          const dateParts = e.date.split(' ')[0].split('/');
          const dateStr = `${dateParts[1]}/${dateParts[2]}`;
          ApiService.addActivityRecord({ eventId: id, name: e.title, date: dateStr, status: 'cancelled', uid: userId });
        }
      }
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      if (!isWaitlist) this._grantAutoExp(userId, 'cancel_registration', e.title);
      this.showEventDetail(id);
      return;
    }

    const reg = FirebaseService._cache.registrations.find(
      r => r.eventId === id && r.userId === userId && r.status !== 'cancelled'
    );
    if (reg) {
      FirebaseService.cancelRegistration(reg.id)
        .then((cancelledReg) => {
          if (cancelledReg && cancelledReg._promotedUserId) {
            const ev = ApiService.getEvent(id);
            if (ev) {
              this._sendNotifFromTemplate('waitlist_promoted', {
                eventName: ev.title, date: ev.date, location: ev.location,
              }, cancelledReg._promotedUserId, 'activity', '活動');
            }
          }
          const records = ApiService.getActivityRecords();
          const hasCancelRec = records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled');
          for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].eventId === id && records[i].uid === userId && records[i].status !== 'cancelled') {
              if (records[i]._docId) {
                db.collection('activityRecords').doc(records[i]._docId).update({ status: 'cancelled' })
                  .catch(err => console.error('[activityRecord cancel]', err));
              }
              if (hasCancelRec) {
                if (records[i]._docId) {
                  db.collection('activityRecords').doc(records[i]._docId).delete().catch(err => console.error('[activityRecord dedup]', err));
                }
                records.splice(i, 1);
              } else {
                records[i].status = 'cancelled';
              }
            }
          }
          if (!hasCancelRec && !records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled')) {
            const ev = ApiService.getEvent(id);
            if (ev) {
              const dp = ev.date.split(' ')[0].split('/');
              ApiService.addActivityRecord({ eventId: id, name: ev.title, date: `${dp[1]}/${dp[2]}`, status: 'cancelled', uid: userId });
            }
          }
          this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
          this.showEventDetail(id);
        })
        .catch(err => { console.error('[cancelSignup]', err); this.showToast('取消失敗：' + (err.message || '')); });
    } else {
      const e = ApiService.getEvent(id);
      if (e) {
        const pi = (e.participants || []).indexOf(userName);
        if (pi !== -1) {
          e.participants.splice(pi, 1);
          e.current = Math.max(0, e.current - 1);
          if (e._docId) {
            db.collection('events').doc(e._docId).update({
              current: e.current, participants: e.participants,
            }).catch(err => console.error('[cancelSignup fallback]', err));
          }
        }
      }
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      this.showEventDetail(id);
    }
  },

});
