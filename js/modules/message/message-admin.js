/* ================================================
   SportHub — Message: Admin Management & Compose
   Slim glue — list in message-admin-list.js,
   compose in message-admin-compose.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Admin Message Management (後台)
  // ══════════════════════════════════

  _msgCurrentFilter: 'sent',
  _scheduledMessageProcessing: false,
  // ── 排程信件自動處理 ──
  async _processScheduledMessages() {
    if (this._scheduledMessageProcessing) return;
    this._scheduledMessageProcessing = true;

    const now = Date.now();
    const allItems = ApiService.getAdminMessages();
    const due = allItems.filter(m => m.status === 'scheduled' && m.scheduledAt && new Date(m.scheduledAt).getTime() <= now);
    if (!due.length) {
      this._scheduledMessageProcessing = false;
      return;
    }

    try {
      const catNames = { system: '系統', activity: '活動', private: '私訊' };
      for (const m of due) {
        let claimed = false;
        try {
          claimed = await this._claimScheduledMessageForSend(m, now);
        } catch (claimErr) {
          console.error('[Schedule] claim failed:', m?.id, claimErr);
        }
        if (!claimed) continue;

        try {
          // 投遞到收件箱
          const extra = { adminMsgId: m.id, targetType: m.targetType || 'all' };
          if (m.targetTeamId) extra.targetTeamId = m.targetTeamId;
          if (m.targetRoles) extra.targetRoles = m.targetRoles;
          this._deliverMessageToInbox(
            m.title,
            m.body,
            m.category,
            catNames[m.category] || m.categoryName || '系統',
            m.targetUid,
            m.senderName,
            extra
          );
          // LINE 推播
          this._queueLinePushByTarget(m.targetType || 'all', m.targetUid, m.category, m.title, m.body, m.targetTeamId);
          await this._markScheduledMessageSent(m);
          console.log('[Schedule] 已自動發送排程信件:', m.title);
        } catch (sendErr) {
          console.error('[Schedule] send failed:', m?.id, sendErr);
          try {
            await this._releaseScheduledMessageClaim(m, sendErr);
          } catch (releaseErr) {
            console.error('[Schedule] release failed:', m?.id, releaseErr);
          }
        }
      }
      this.renderMsgManage();
    } finally {
      this._scheduledMessageProcessing = false;
    }
  },

  _getScheduledMessageProcessorId() {
    const user = ApiService.getCurrentUser?.();
    return user?.uid || user?.name || 'system';
  },

  async _claimScheduledMessageForSend(msg, nowMs) {
    if (!msg || msg.status !== 'scheduled') return false;

    const processorId = this._getScheduledMessageProcessorId();
    const markLocalProcessing = () => {
      const live = ApiService.getAdminMessages().find(m => m.id === msg.id);
      if (!live || live.status !== 'scheduled') return false;
      live.status = 'processing';
      live.processingBy = processorId;
      live.processingAt = new Date().toISOString();
      return true;
    };

    if (!msg._docId) {
      return markLocalProcessing();
    }

    let claimed = false;
    const docRef = db.collection('adminMessages').doc(msg._docId);
    await db.runTransaction(async tx => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const dueMs = new Date(data.scheduledAt || msg.scheduledAt || 0).getTime();
      if (data.status !== 'scheduled' || !Number.isFinite(dueMs) || dueMs > nowMs) return;
      tx.update(docRef, {
        status: 'processing',
        processingBy: processorId,
        processingAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      claimed = true;
    });

    if (claimed) markLocalProcessing();
    return claimed;
  },

  async _markScheduledMessageSent(msg) {
    if (!msg) return;
    if (msg._docId) {
      const fv = firebase.firestore.FieldValue;
      await db.collection('adminMessages').doc(msg._docId).update({
        status: 'sent',
        sentAt: fv.serverTimestamp(),
        processingAt: fv.delete(),
        processingBy: fv.delete(),
        lastError: fv.delete(),
      });
    }
    const live = ApiService.getAdminMessages().find(m => m.id === msg.id);
    if (!live) return;
    live.status = 'sent';
    live.sentAt = new Date().toISOString();
    delete live.processingAt;
    delete live.processingBy;
    delete live.lastError;
  },

  async _releaseScheduledMessageClaim(msg, err) {
    if (!msg) return;
    const errorText = err?.message ? String(err.message).slice(0, 300) : 'schedule_send_failed';
    let writeErr = null;
    if (msg._docId) {
      const fv = firebase.firestore.FieldValue;
      try {
        await db.collection('adminMessages').doc(msg._docId).update({
          status: 'scheduled',
          lastError: errorText,
          processingAt: fv.delete(),
          processingBy: fv.delete(),
        });
      } catch (e) {
        writeErr = e;
      }
    }
    const live = ApiService.getAdminMessages().find(m => m.id === msg.id);
    if (live) {
      live.status = 'scheduled';
      live.lastError = errorText;
      delete live.processingAt;
      delete live.processingBy;
    }
    if (writeErr) throw writeErr;
  },

});
