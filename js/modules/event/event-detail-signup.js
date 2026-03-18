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

  _notifySignupCancelledInbox(eventData, targetUid, isWaitlist) {
    if (!eventData || !targetUid || typeof this._deliverMessageWithLinePush !== 'function') return;
    const title = isWaitlist ? '取消候補通知' : '取消報名通知';
    const statusLabel = isWaitlist ? '已取消候補' : '已取消報名';
    const body =
      `${statusLabel}：\n\n` +
      `活動名稱：${eventData.title || '-'}\n` +
      `活動時間：${eventData.date || '-'}\n` +
      `活動地點：${eventData.location || '-'}\n\n` +
      '如需再次參加，可回到活動頁重新報名。';
    this._deliverMessageWithLinePush(
      title,
      body,
      'activity',
      '活動',
      targetUid,
      '系統',
      null,
      { lineOptions: { source: 'event_cancel_signup:legacy' } }
    );
  },

  _notifySignupCancelledInboxFromTemplate(eventData, targetUid, isWaitlist) {
    if (
      !eventData ||
      !targetUid ||
      typeof this._deliverMessageWithLinePush !== 'function' ||
      typeof this._renderTemplate !== 'function'
    ) return;
    const vars = {
      eventName: eventData.title || '-',
      date: eventData.date || '-',
      location: eventData.location || '-',
      status: isWaitlist ? '已取消候補' : '已取消報名',
    };
    const fallbackTemplate = {
      title: '取消報名通知',
      body: '{status}：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如之後想再次參加，請回到活動頁重新報名。',
    };
    const tpl = ApiService.getNotifTemplate?.('cancel_signup') || fallbackTemplate;
    const title = this._renderTemplate(tpl.title, vars);
    const body = this._renderTemplate(tpl.body, vars);
    this._deliverMessageWithLinePush(
      title,
      body,
      'activity',
      '活動',
      targetUid,
      '系統',
      null,
      { lineOptions: { source: 'template:cancel_signup' } }
    );
  },

  async _syncMyEventRegistrations(eventId, userId) {
    if (!eventId || !userId || ApiService._demoMode) return [];
    try {
      await FirebaseService.ensureAuthReadyForWrite?.();
      if (!auth?.currentUser) return ApiService.getMyRegistrationsByEvent(eventId);

      const snapshot = await db.collection('registrations')
        .where('eventId', '==', eventId)
        .where('userId', '==', userId)
        .get();

      const allDocs = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
      const activeDocs = allDocs.filter(r => r.status !== 'cancelled' && r.status !== 'removed');
      const source = FirebaseService._cache.registrations || [];
      FirebaseService._cache.registrations = source
        .filter(r => !(r.eventId === eventId && r.userId === userId))
        .concat(allDocs);
      FirebaseService._saveToLS?.('registrations', FirebaseService._cache.registrations);
      return activeDocs;
    } catch (err) {
      console.warn('[cancelSignup] sync registrations fallback failed:', err);
      return ApiService.getMyRegistrationsByEvent(eventId);
    }
  },

  async handleSignup(id) {
    if (this._requireProtectedActionLogin({ type: 'eventSignup', eventId: id }, { suppressToast: true })) {
      return;
    }
    let e = ApiService.getEvent(id);
    if (!e) return;
    e = this._syncEventEffectiveStatus?.(e) || e;
    if (e.status === 'ended' || e.status === 'cancelled') {
      this.showToast('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u5831\u540d\u5df2\u7d50\u675f');
      this.showEventDetail(id);
      return;
    }
    if (e.status === 'upcoming') {
      this.showToast('\u5831\u540d\u5c1a\u672a\u958b\u653e\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      return;
    }
    if (e.teamOnly && typeof this._canSignupTeamOnlyEvent === 'function' && !this._canSignupTeamOnlyEvent(e)) {
      this.showToast('俱樂部限定活動，僅限該隊成員報名');
      return;
    }
    const genderSignupState = typeof this._getEventGenderSignupState === 'function'
      ? this._getEventGenderSignupState(e, ApiService.getCurrentUser?.() || null)
      : { restricted: false, canSignup: true, requiresLogin: false, reason: '' };
    if (genderSignupState.restricted && !genderSignupState.requiresLogin && !genderSignupState.canSignup) {
      this.showToast(this._getEventGenderRestrictionMessage?.(e, genderSignupState.reason) || '此活動不符合目前性別限制');
      return;
    }
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
        status: isWaitlist ? 'waitlisted' : 'registered', uid: userId, eventType: e.type,
      });
      this.showToast(isWaitlist ? '已加入候補名單' : '報名成功！');
      if (!isWaitlist) this._grantAutoExp(userId, 'register_activity', e.title);
      void ApiService.writeAuditLog({
        action: 'event_signup',
        targetType: 'event',
        targetId: e.id,
        targetLabel: e.title,
        result: 'success',
        source: 'web',
        meta: {
          eventId: e.id,
          statusTo: isWaitlist ? 'waitlisted' : 'registered',
        },
      });
      this._sendNotifFromTemplate('signup_success', {
        eventName: e.title, date: e.date, location: e.location,
        status: isWaitlist ? '候補' : '正取',
      }, userId, 'activity', '活動');
      this._evaluateAchievements?.(e.type);
      this._maybeShowLineNotifyPrompt?.();
      this.showEventDetail(id);
      return;
    }

    // 防幽靈 UI 層：報名期間禁用按鈕，啟動光跡載入特效
    const signupBtns = document.querySelectorAll('#detail-body button');
    let activeBtn = null;
    let glowWrap = null;
    signupBtns.forEach(b => {
      b.disabled = true; b.style.opacity = '0.6';
      if ((b.getAttribute('onclick') || '').includes('handleSignup')) {
        activeBtn = b;
        b._origText = b.textContent;
        // 按鈕文字即時切換為處理中狀態
        const txt = b.textContent.trim();
        b.textContent = txt.includes('候補') ? '候補中...' : '報名中...';
        b.style.opacity = '';
        glowWrap = b.closest('.signup-glow-wrap');
        if (glowWrap) glowWrap.classList.add('loading');
      }
    });
    // 在 Firestore 操作前鎖定重渲染，防止 onSnapshot 中途替換 DOM
    if (glowWrap) {
      this._flipAnimating = true;
      this._flipAnimatingAt = Date.now(); // F1：記錄時間戳供安全重置判斷
    }
    try {
      // F3：15 秒 timeout 保護，防止 Firestore 掛住導致永久卡死
      const _signupTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('報名操作逾時，請重新整理後再試')), 15000));
      const result = await Promise.race([
        FirebaseService.registerForEvent(id, userId, userName),
        _signupTimeout,
      ]);
      // ── 即時回饋：翻牌動畫 + toast ──
      const isWL = result.status === 'waitlisted';
      this.showToast(isWL ? '已加入候補名單' : '報名成功！');
      if (glowWrap) {
        glowWrap.classList.remove('loading');
        const flipper = glowWrap.querySelector('.signup-flipper');
        if (flipper) {
          const backEl = document.createElement('div');
          backEl.className = 'signup-flip-back';
          backEl.style.cssText = isWL
            ? 'background:#7c3aed;color:#fff;padding:.55rem 1.2rem'
            : 'background:#dc2626;color:#fff;padding:.55rem 1.2rem';
          backEl.textContent = isWL ? '取消候補' : '取消報名';
          flipper.appendChild(backEl);
          void flipper.offsetHeight;
          flipper.classList.add('flipped');
          glowWrap.classList.add('flipped');
          await new Promise(r => setTimeout(r, 1200));
        }
      }
      // QA fix：在 showEventDetail 之前先解鎖，否則 showEventDetail 會被 _flipAnimating 擋住
      this._flipAnimating = false;
      this._flipAnimatingAt = 0;
      this.showEventDetail(id);
      this._maybeShowLineNotifyPrompt?.();
      // ── 背景 post-ops（fire-and-forget，不阻塞 UI）──
      const dateParts = e.date.split(' ')[0].split('/');
      const dateStr = `${dateParts[1]}/${dateParts[2]}`;
      const arRecord = {
        eventId: e.id, name: e.title, date: dateStr,
        status: result.status === 'waitlisted' ? 'waitlisted' : 'registered', uid: userId, eventType: e.type,
      };
      ApiService.addActivityRecord(arRecord);
      db.collection('activityRecords').add({
        ...arRecord, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).then(ref => { arRecord._docId = ref.id; })
        .catch(err => console.error('[activityRecord]', err));
      void ApiService.writeAuditLog({
        action: 'event_signup',
        targetType: 'event',
        targetId: e.id,
        targetLabel: e.title,
        result: 'success',
        source: 'web',
        meta: {
          eventId: e.id,
          statusTo: result.status === 'waitlisted' ? 'waitlisted' : 'registered',
        },
      });
      this._sendNotifFromTemplate('signup_success', {
        eventName: e.title, date: e.date, location: e.location,
        status: result.status === 'waitlisted' ? '候補' : '正取',
      }, userId, 'activity', '活動');
      if (result.status !== 'waitlisted') this._grantAutoExp(userId, 'register_activity', e.title);
      this._evaluateAchievements?.(e.type);
    } catch (err) {
      console.error('[handleSignup]', err);
      this.showToast(err.message || '報名失敗，請稍後再試');
      if (glowWrap) glowWrap.classList.remove('loading');
      signupBtns.forEach(b => {
        b.disabled = false; b.style.opacity = '';
        if (b === activeBtn && b._origText) { b.textContent = b._origText; }
      });
    } finally {
      // F2：無論成功/失敗/timeout，確保 flag 被重置
      this._flipAnimating = false;
      this._flipAnimatingAt = 0;
    }
  },

  async handleCancelSignup(id) {
    if (this._requireProtectedActionLogin({ type: 'eventCancelSignup', eventId: id }, { suppressToast: true })) {
      return;
    }
    this._cancelSignupBusyMap = this._cancelSignupBusyMap || {};
    if (this._cancelSignupBusyMap[id]) {
      this.showToast('取消處理中，請稍後');
      return;
    }

    const currentUser = ApiService.getCurrentUser();
    const currentUserId = currentUser?.uid || 'unknown';
    let myRegs = ApiService.getMyRegistrationsByEvent(id);

    // 有真正的同行者報名（companionId 存在）→ 顯示多選取消 Modal
    // 若只是本人報名出現重複（資料競態窗口），不誤觸同行者 modal
    const hasRealCompanions = myRegs.some(r => r.participantType === 'companion' || r.companionId);
    if (myRegs.length > 1 && hasRealCompanions) {
      this._openCompanionCancelModal(id, myRegs);
      return;
    }

    let e0 = ApiService.getEvent(id);
    e0 = this._syncEventEffectiveStatus?.(e0) || e0;
    if (e0?.status === 'ended' || e0?.status === 'cancelled') {
      this.showToast('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u7121\u6cd5\u518d\u53d6\u6d88\u5831\u540d');
      this.showEventDetail(id);
      return;
    }
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

    // B1 優化：移除 _syncMyEventRegistrations 前置查詢
    // cancelRegistration 內部已查詢 firestoreRegs 並自動回填 _docId（C1），不再需要額外同步

    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';
    const cancelBtns = Array.from(document.querySelectorAll('#detail-body button'))
      .filter(b => ((b.getAttribute('onclick') || '').includes('handleCancelSignup')));
    const activeCancelBtn = cancelBtns[0] || null;
    let cancelUiRestored = false;
    this._cancelSignupBusyMap[id] = true;
    // 安全超時：15 秒後自動解鎖，防止 Firestore 卡住導致永久鎖定
    const _busyTimeout = setTimeout(() => { delete this._cancelSignupBusyMap[id]; }, 15000);
    let cancelGlowWrap = null;
    cancelBtns.forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.6';
      b._origCancelHtml = b.innerHTML;
      // 按鈕文字即時切換為處理中狀態
      b.textContent = isWaitlist ? '取消候補中...' : '取消報名中...';
    });
    if (activeCancelBtn) {
      activeCancelBtn.style.opacity = '';
      cancelGlowWrap = activeCancelBtn.closest('.signup-glow-wrap');
      if (cancelGlowWrap) {
        cancelGlowWrap.classList.add('loading');
        // 在 Firestore 操作前鎖定重渲染，防止 onSnapshot 中途替換 DOM
        this._flipAnimating = true;
        this._flipAnimatingAt = Date.now(); // F1：記錄時間戳供安全重置判斷
      }
    }
    const _restoreCancelUI = () => {
      if (cancelUiRestored) return;
      cancelUiRestored = true;
      this._flipAnimating = false;
      delete this._cancelSignupBusyMap[id];
      if (cancelGlowWrap) cancelGlowWrap.classList.remove('loading');
      cancelBtns.forEach(b => {
        b.disabled = false;
        b.style.opacity = '';
        if (typeof b._origCancelHtml === 'string') {
          b.innerHTML = b._origCancelHtml;
          delete b._origCancelHtml;
        }
      });
    };

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
      _restoreCancelUI();
      this._notifySignupCancelledInboxFromTemplate(e0, userId, isWaitlist);
      void ApiService.writeAuditLog({
        action: 'event_cancel_signup',
        targetType: 'event',
        targetId: e0?.id || id,
        targetLabel: e0?.title || '',
        result: 'success',
        source: 'web',
        meta: {
          eventId: e0?.id || id,
          statusFrom: isWaitlist ? 'waitlisted' : 'registered',
          statusTo: 'cancelled',
        },
      });
      this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
      if (!isWaitlist) this._grantAutoExp(userId, 'cancel_registration', e0.title);
      this._evaluateAchievements?.(e0?.type);
      this.showEventDetail(id);
      return;
    }

    const targetStatuses = isWaitlist ? ['waitlisted'] : ['confirmed', 'registered'];
    const reg = myRegs.find(r => targetStatuses.includes(r.status))
      || myRegs.find(r => r._docId && r.status !== 'cancelled' && r.status !== 'removed')
      || myRegs[0]
      || null;
    // 若有重複的本人報名（資料不一致），直接清掉額外的（不觸發候補遞補）
    const extraRegs = myRegs.filter(r => r !== reg && r._docId);
    for (const extra of extraRegs) {
      extra.status = 'cancelled';
      extra.cancelledAt = new Date().toISOString();
      db.collection('registrations').doc(extra._docId).update({
        status: 'cancelled',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(err => console.error('[cancelSignup dedup]', err));
    }
    if (reg) {
      try {
        // F3：15 秒 timeout 保護，防止 Firestore 掛住導致永久卡死
        const _cancelTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('取消操作逾時，請重新整理後再試')), 15000));
        const cancelledReg = await Promise.race([
          FirebaseService.cancelRegistration(reg.id),
          _cancelTimeout,
        ]);
        if (cancelledReg && cancelledReg._promotedUserId) {
          const ev = ApiService.getEvent(id);
          if (ev) {
            this._sendNotifFromTemplate('waitlist_promoted', {
              eventName: ev.title, date: ev.date, location: ev.location,
            }, cancelledReg._promotedUserId, 'activity', '活動');
            // 候補遞補為正取 → 補發報名 EXP
            (cancelledReg._promotedUserIds || [cancelledReg._promotedUserId]).forEach(pUid => {
              this._grantAutoExp(pUid, 'register_activity', ev.title);
            });
          }
        }
        // ── 即時回饋：翻牌動畫 + toast ──
        this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
        if (cancelGlowWrap) {
          cancelGlowWrap.classList.remove('loading');
          const flipper = cancelGlowWrap.querySelector('.signup-flipper');
          if (flipper) {
            // 取消後翻轉到「立即報名」或「報名候補」
            const ev = ApiService.getEvent(id);
            const stillFull = ev && ev.current >= ev.max;
            const backEl = document.createElement('div');
            backEl.className = 'signup-flip-back';
            backEl.style.cssText = stillFull
              ? 'background:#7c3aed;color:#fff;padding:.55rem 1.2rem'
              : 'background:var(--accent);color:#fff;padding:.55rem 1.2rem;font-weight:600';
            backEl.textContent = stillFull ? '報名候補' : '立即報名';
            flipper.appendChild(backEl);
            void flipper.offsetHeight;
            flipper.classList.add('flipped');
            cancelGlowWrap.classList.add('flipped');
            await new Promise(r => setTimeout(r, 1200));
          }
          this._flipAnimating = false;
        }
        this.showEventDetail(id);
        // ── 背景 post-ops（fire-and-forget，不阻塞 UI）──
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
        db.collection('activityRecords')
          .where('uid', '==', userId).where('eventId', '==', id)
          .get().then(snap => {
            snap.forEach(doc => {
              if (doc.data().status !== 'cancelled') {
                doc.ref.update({ status: 'cancelled' })
                  .catch(err => console.error('[activityRecord cancel-fallback]', err));
              }
            });
          }).catch(err => console.error('[activityRecord cancel-fallback query]', err));
        if (!hasCancelRec && !records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled')) {
          const ev = ApiService.getEvent(id);
          if (ev) {
            const dp = ev.date.split(' ')[0].split('/');
            ApiService.addActivityRecord({ eventId: id, name: ev.title, date: `${dp[1]}/${dp[2]}`, status: 'cancelled', uid: userId });
          }
        }
        this._notifySignupCancelledInboxFromTemplate(ApiService.getEvent(id) || e0, userId, isWaitlist);
        void ApiService.writeAuditLog({
          action: 'event_cancel_signup',
          targetType: 'event',
          targetId: e0?.id || id,
          targetLabel: e0?.title || '',
          result: 'success',
          source: 'web',
          meta: {
            eventId: e0?.id || id,
            statusFrom: isWaitlist ? 'waitlisted' : 'registered',
            statusTo: 'cancelled',
          },
        });
        if (!isWaitlist) this._grantAutoExp(userId, 'cancel_registration', e0.title);
        this._evaluateAchievements?.(e0?.type);
      } catch (err) {
        console.error('[cancelSignup]', err);
        this._flipAnimating = false;
        this.showToast('取消失敗：' + (err.message || ''));
        ApiService._writeErrorLog({ fn: 'handleCancelSignup', eventId: id }, err);
        // 失敗：恢復按鈕原始狀態讓使用者可重試
        _restoreCancelUI();
      } finally {
        clearTimeout(_busyTimeout);
        this._flipAnimating = false;
        this._flipAnimatingAt = 0;
        delete this._cancelSignupBusyMap[id];
      }
    } else {
      console.warn('[cancelSignup] active registration not found', {
        eventId: id,
        userId,
        targetStatuses,
        activeRegCount: myRegs.length,
        activeRegStatuses: myRegs.map(r => r.status)
      });
      _restoreCancelUI();
      this.showToast('找不到有效的報名紀錄，請重新整理後再試');
      this.showEventDetail(id);
    }
  },

});
