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

  async handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    // 活動開始時間已過 → 自動結束並阻止操作
    const _startGuard = App._parseEventStartDate?.(e.date);
    if (_startGuard && _startGuard <= new Date() && e.status !== 'ended' && e.status !== 'cancelled') {
      ApiService.updateEvent(id, { status: 'ended' });
      this.showToast('活動已於開始時間結束，無法報名');
      this.showEventDetail(id);
      return;
    }
    if (e.status === 'upcoming') { this.showToast('報名尚未開放，請稍後再試'); return; }

    // 有同行者 → 顯示選人 Modal
    const companions = ApiService.getCompanions();
    if (companions.length > 0) {
      this._openCompanionSelectModal(id);
      return;
    }

    const user = ApiService.getCurrentUser();
    if (!user?.uid) { this.showToast('用戶資料載入中，請稍候再試'); return; }
    const userName = user.displayName || user.name || '用戶';
    const userId = user.uid;

    // 恢復報名 → 移除之前的取消紀錄
    this._removeCancelRecordOnResignup(id, userId);

    if (ApiService._demoMode) {
      if (this._isUserSignedUp(e)) {
        this.showToast('您已報名此活動');
        return;
      }
      // registerEventWithCompanions 統一處理 participants/current/waitlist 變更
      const result = await ApiService.registerEventWithCompanions(id, [{ type: 'self' }]);
      const isWaitlist = (result.waitlisted || 0) > 0;
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

    // 防幽靈 UI 層：報名期間禁用按鈕，防止重複點擊，並在主報名鈕顯示 spinner
    const signupBtns = document.querySelectorAll('#detail-body button');
    let activeBtn = null;
    signupBtns.forEach(b => {
      b.disabled = true; b.style.opacity = '0.6';
      if ((b.getAttribute('onclick') || '').includes('handleSignup')) {
        activeBtn = b;
        b._origText = b.textContent;
        b.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:.3rem"></span>報名中...';
      }
    });
    try {
      const result = await FirebaseService.registerForEvent(id, userId, userName);
      const dateParts = e.date.split(' ')[0].split('/');
      const dateStr = `${dateParts[1]}/${dateParts[2]}`;
      const arRecord = {
        eventId: e.id, name: e.title, date: dateStr,
        status: result.status === 'waitlisted' ? 'waitlisted' : 'registered', uid: userId,
      };
      ApiService.addActivityRecord(arRecord);
      db.collection('activityRecords').add({
        ...arRecord, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).then(ref => { arRecord._docId = ref.id; })
        .catch(err => console.error('[activityRecord]', err));
      this._sendNotifFromTemplate('signup_success', {
        eventName: e.title, date: e.date, location: e.location,
        status: result.status === 'waitlisted' ? '候補' : '正取',
      }, userId, 'activity', '活動');
      this.showToast(result.status === 'waitlisted' ? '已加入候補名單' : '報名成功！');
      this.showEventDetail(id);
    } catch (err) {
      console.error('[handleSignup]', err);
      this.showToast(err.message || '報名失敗，請稍後再試');
      signupBtns.forEach(b => {
        b.disabled = false; b.style.opacity = '';
        if (b === activeBtn && b._origText) { b.textContent = b._origText; }
      });
    }
  },

  async handleCancelSignup(id) {
    // 有多筆報名（含同行者）→ 顯示取消選擇 Modal
    const myRegs = ApiService.getMyRegistrationsByEvent(id);
    if (myRegs.length > 1) {
      this._openCompanionCancelModal(id, myRegs);
      return;
    }

    const e0 = ApiService.getEvent(id);
    // 活動開始時間已過 → 自動結束並阻止操作
    const _startGuard = App._parseEventStartDate?.(e0?.date);
    if (_startGuard && _startGuard <= new Date() && e0?.status !== 'ended' && e0?.status !== 'cancelled') {
      ApiService.updateEvent(id, { status: 'ended' });
      this.showToast('活動已於開始時間結束，無法取消報名');
      this.showEventDetail(id);
      return;
    }
    const singleReg = myRegs.length === 1 ? myRegs[0] : null;
    const isWaitlist = singleReg ? singleReg.status === 'waitlisted' : (e0 && this._isUserOnWaitlist(e0));
    const confirmMsg = isWaitlist ? '確定要取消候補？' : '確定要取消報名？';
    if (!await this.appConfirm(confirmMsg)) return;
    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';

    if (ApiService._demoMode) {
      const e = ApiService.getEvent(id);
      if (e) {
        // 優先用 registrations 取消
        const demoRegs = ApiService._src('registrations');
        const myReg = demoRegs.find(r => r.eventId === id && r.userId === userId && r.status !== 'cancelled');
        if (myReg) {
          const wasWaitlisted = myReg.status === 'waitlisted';
          // 取消所有此用戶此活動的 registrations
          for (let i = demoRegs.length - 1; i >= 0; i--) {
            if (demoRegs[i].eventId === id && demoRegs[i].userId === userId && demoRegs[i].status !== 'cancelled') {
              demoRegs[i].status = 'cancelled';
              demoRegs[i].cancelledAt = new Date().toISOString();
            }
          }
          if (wasWaitlisted) {
            e.waitlist = Math.max(0, e.waitlist - 1);
          } else {
            e.current = Math.max(0, e.current - 1);
            e.status = e.current >= e.max ? 'full' : 'open';
          }
        } else {
          // Fallback: 舊資料用 participants
          const pi = (e.participants || []).indexOf(userName);
          if (pi !== -1) {
            e.participants.splice(pi, 1);
            e.current = Math.max(0, e.current - 1);
            e.status = e.current >= e.max ? 'full' : 'open';
          } else {
            const wi = (e.waitlistNames || []).indexOf(userName);
            if (wi !== -1) {
              e.waitlistNames.splice(wi, 1);
              e.waitlist = Math.max(0, e.waitlist - 1);
            }
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
      if (!isWaitlist) this._grantAutoExp(userId, 'cancel_registration', e0.title);
      this.showEventDetail(id);
      return;
    }

    const targetStatus = isWaitlist ? 'waitlisted' : 'confirmed';
    const reg = myRegs.find(r => r.status === targetStatus) || null;
    if (reg && reg._docId) {
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
      console.warn('[cancelSignup] active registration not found', {
        eventId: id,
        userId,
        targetStatus,
        activeRegCount: myRegs.length,
        activeRegStatuses: myRegs.map(r => r.status)
      });
      this.showToast('資料尚未同步，請稍後再試');
      this.showEventDetail(id);
    }
  },

});
