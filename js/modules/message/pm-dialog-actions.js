/* ================================================
   ToosterX - Private Message write actions
   ================================================ */

Object.assign(App, {
  async sendPmMessage() {
    const state = this._currentPmDialog;
    if (!state?.targetUid || !state?.conversationId) return;
    const overlay = document.getElementById('pm-dialog-overlay');
    const input = overlay?.querySelector('.pm-dialog-input');
    const maxLength = Number(this.PM_MAX_BODY_LENGTH || 300);
    const body = String(input?.value || '').trim();
    if (!body) {
      this.showToast?.('\u8acb\u8f38\u5165\u8a0a\u606f');
      return;
    }
    if (body.length > maxLength) {
      this.showToast?.(`\u8a0a\u606f\u6700\u591a ${maxLength} \u5b57`);
      return;
    }

    if (input) input.value = '';
    const localId = this._addPmOptimisticMessage?.(state.conversationId, state.targetUid, body) || '';
    this._renderPmDialogMessages(
      this._getPmDialogRenderMessages?.(state.conversationId, this._pmDialogMessages || []) || this._pmDialogMessages || [],
    );

    try {
      const fn = this._pmCallable?.('sendPrivateMessage');
      if (!fn) throw new Error('sendPrivateMessage missing');
      const result = await fn({ toUid: state.targetUid, body });
      const serverMessageId = result?.data?.messageId || result?.messageId || '';
      if (localId) {
        this._markPmOptimisticMessage?.(state.conversationId, localId, {
          status: 'sent',
          _optimisticAck: true,
          _serverMessageId: serverMessageId,
        });
        this._renderPmDialogMessages(
          this._getPmDialogRenderMessages?.(state.conversationId, this._pmDialogMessages || []) || this._pmDialogMessages || [],
        );
      }
    } catch (err) {
      console.warn('[sendPmMessage]', err);
      if (localId) {
        this._markPmOptimisticMessage?.(state.conversationId, localId, {
          status: 'failed',
          _optimisticFailed: true,
        });
        this._renderPmDialogMessages(
          this._getPmDialogRenderMessages?.(state.conversationId, this._pmDialogMessages || []) || this._pmDialogMessages || [],
        );
      }
      if (input && !input.value) input.value = body;
      const code = String(err?.code || '');
      if (code.includes('resource-exhausted')) this.showToast?.('\u79c1\u8a0a\u592a\u983b\u7e41\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      else if (code.includes('permission-denied')) this.showToast?.('\u76ee\u524d\u7121\u6cd5\u79c1\u8a0a\u6b64\u7528\u6236');
      else this.showToast?.('\u79c1\u8a0a\u9001\u51fa\u5931\u6557');
    }
  },

  _setPmSendBusy(busy) {
    const overlay = document.getElementById('pm-dialog-overlay');
    const btn = overlay?.querySelector('.pm-dialog-send');
    const input = overlay?.querySelector('.pm-dialog-input');
    if (btn) {
      btn.disabled = !!busy;
      btn.classList.toggle('is-loading', !!busy);
      btn.textContent = busy ? '\u9001\u51fa\u4e2d' : '\u9001\u51fa';
    }
    if (input) input.disabled = !!busy;
  },

  _getPmDialogMessage(messageId) {
    const state = this._currentPmDialog;
    const cId = state?.conversationId || '';
    const messages = cId && this._getPmDialogRenderMessages
      ? this._getPmDialogRenderMessages(cId, this._pmDialogMessages || [])
      : (this._pmDialogMessages || []);
    return (messages || []).find(m => String(m.messageId || m.id || m._docId || '') === String(messageId || '')) || null;
  },

  _isPmMessagePeerRead(message) {
    return message?.peerRead === true;
  },

  _showPmMessageAlreadyRead() {
    this.showToast?.('\u5c0d\u65b9\u5df2\u8b80\uff0c\u7121\u6cd5\u7de8\u8f2f\u6216\u64a4\u56de');
  },

  _showPmMessageUnavailable() {
    this.showToast?.('\u8a0a\u606f\u72c0\u614b\u5df2\u8b8a\u66f4\uff0c\u7121\u6cd5\u7de8\u8f2f\u6216\u64a4\u56de');
  },

  _setPmPendingMessageUpdate(conversationId, messageId, updates = {}) {
    const cId = String(conversationId || '').trim();
    const id = String(messageId || '').trim();
    if (!cId || !id) return;
    if (!this._pmPendingMessageUpdates) this._pmPendingMessageUpdates = {};
    if (!this._pmPendingMessageUpdates[cId]) this._pmPendingMessageUpdates[cId] = {};
    this._pmPendingMessageUpdates[cId][id] = {
      ...updates,
      _pmPendingSince: new Date().toISOString(),
    };
  },

  _clearPmPendingMessageUpdate(conversationId, messageId) {
    const cId = String(conversationId || '').trim();
    const id = String(messageId || '').trim();
    if (!cId || !id || !this._pmPendingMessageUpdates?.[cId]) return;
    delete this._pmPendingMessageUpdates[cId][id];
    if (!Object.keys(this._pmPendingMessageUpdates[cId]).length) delete this._pmPendingMessageUpdates[cId];
  },

  _renderCurrentPmDialogMessages() {
    const state = this._currentPmDialog;
    if (!state?.conversationId || typeof this._renderPmDialogMessages !== 'function') return;
    const messages = this._getPmDialogRenderMessages?.(state.conversationId, this._pmDialogMessages || []) || this._pmDialogMessages || [];
    this._renderPmDialogMessages(messages);
  },

  async editPmMessage(messageId) {
    const state = this._currentPmDialog;
    if (!state?.conversationId || !messageId) return;
    const current = this._getPmDialogMessage?.(messageId);
    if (!current || current._optimistic) {
      this.showToast?.('\u8a0a\u606f\u9001\u51fa\u5b8c\u6210\u5f8c\u624d\u80fd\u7de8\u8f2f');
      return;
    }
    if (this._isPmMessagePeerRead?.(current)) {
      this._showPmMessageAlreadyRead?.();
      return;
    }
    const nextBody = prompt('\u7de8\u8f2f\u8a0a\u606f', current?.body || '');
    if (nextBody == null) return;
    const maxLength = Number(this.PM_MAX_BODY_LENGTH || 300);
    const body = String(nextBody || '').trim();
    if (!body || body.length > maxLength) {
      this.showToast?.(`\u8a0a\u606f\u6700\u591a ${maxLength} \u5b57`);
      return;
    }
    this._setPmPendingMessageUpdate?.(state.conversationId, messageId, {
      body,
      preview: body,
      status: 'edited',
      _pmPendingAction: 'editing',
      _expectedBody: body,
      _expectedStatus: 'edited',
    });
    this._renderCurrentPmDialogMessages?.();
    try {
      const fn = this._pmCallable?.('editPrivateMessage');
      if (!fn) throw new Error('editPrivateMessage missing');
      await fn({ conversationId: state.conversationId, messageId, body });
    } catch (err) {
      console.warn('[editPmMessage]', err);
      this._clearPmPendingMessageUpdate?.(state.conversationId, messageId);
      this._renderCurrentPmDialogMessages?.();
      const code = String(err?.code || '');
      const message = String(err?.message || '');
      if (code.includes('failed-precondition') && message.includes('already read')) this._showPmMessageAlreadyRead?.();
      else if (code.includes('failed-precondition')) this._showPmMessageUnavailable?.();
      else this.showToast?.('\u7de8\u8f2f\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    }
  },

  async recallPmMessage(messageId) {
    const state = this._currentPmDialog;
    if (!state?.conversationId || !messageId) return;
    const current = this._getPmDialogMessage?.(messageId);
    if (!current || current._optimistic) {
      this.showToast?.('\u8a0a\u606f\u9001\u51fa\u5b8c\u6210\u5f8c\u624d\u80fd\u64a4\u56de');
      return;
    }
    if (this._isPmMessagePeerRead?.(current)) {
      this._showPmMessageAlreadyRead?.();
      return;
    }
    if (!confirm('\u78ba\u5b9a\u8981\u64a4\u56de\u9019\u5247\u8a0a\u606f\u55ce\uff1f')) return;
    this._setPmPendingMessageUpdate?.(state.conversationId, messageId, {
      body: '',
      preview: '\u8a0a\u606f\u5df2\u64a4\u56de',
      status: 'recalled',
      _pmPendingAction: 'recalling',
      _expectedStatus: 'recalled',
    });
    this._renderCurrentPmDialogMessages?.();
    try {
      const fn = this._pmCallable?.('recallPrivateMessage');
      if (!fn) throw new Error('recallPrivateMessage missing');
      await fn({ conversationId: state.conversationId, messageId });
    } catch (err) {
      console.warn('[recallPmMessage]', err);
      this._clearPmPendingMessageUpdate?.(state.conversationId, messageId);
      this._renderCurrentPmDialogMessages?.();
      const code = String(err?.code || '');
      const message = String(err?.message || '');
      if (code.includes('failed-precondition') && message.includes('already read')) this._showPmMessageAlreadyRead?.();
      else if (code.includes('failed-precondition')) this._showPmMessageUnavailable?.();
      else this.showToast?.('\u64a4\u56de\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    }
  },
});
