/* ================================================
   ToosterX - Private Message write actions
   ================================================ */

Object.assign(App, {
  async sendPmMessage() {
    const state = this._currentPmDialog;
    if (!state?.targetUid || !state?.conversationId) return;
    const overlay = document.getElementById('pm-dialog-overlay');
    const input = overlay?.querySelector('.pm-dialog-input');
    const body = String(input?.value || '').trim();
    if (!body) {
      this.showToast?.('\u8acb\u8f38\u5165\u8a0a\u606f');
      return;
    }
    if (body.length > 1000) {
      this.showToast?.('\u8a0a\u606f\u6700\u591a 1000 \u5b57');
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

  async editPmMessage(messageId) {
    const state = this._currentPmDialog;
    if (!state?.conversationId || !messageId) return;
    const current = (this._pmDialogMessages || []).find(m => (m.messageId || m.id) === messageId);
    const nextBody = prompt('\u7de8\u8f2f\u8a0a\u606f', current?.body || '');
    if (nextBody == null) return;
    const body = String(nextBody || '').trim();
    if (!body || body.length > 1000) {
      this.showToast?.('\u8a0a\u606f\u6700\u591a 1000 \u5b57');
      return;
    }
    try {
      const fn = this._pmCallable?.('editPrivateMessage');
      if (!fn) throw new Error('editPrivateMessage missing');
      await fn({ conversationId: state.conversationId, messageId, body });
    } catch (err) {
      console.warn('[editPmMessage]', err);
      this.showToast?.('\u7de8\u8f2f\u5931\u6557\uff0c\u53ef\u80fd\u5df2\u8d85\u904e\u53ef\u7de8\u8f2f\u6642\u9593');
    }
  },

  async recallPmMessage(messageId) {
    const state = this._currentPmDialog;
    if (!state?.conversationId || !messageId) return;
    if (!confirm('\u78ba\u5b9a\u8981\u64a4\u56de\u9019\u5247\u8a0a\u606f\u55ce\uff1f')) return;
    try {
      const fn = this._pmCallable?.('recallPrivateMessage');
      if (!fn) throw new Error('recallPrivateMessage missing');
      await fn({ conversationId: state.conversationId, messageId });
    } catch (err) {
      console.warn('[recallPmMessage]', err);
      this.showToast?.('\u64a4\u56de\u5931\u6557\uff0c\u53ef\u80fd\u5df2\u8d85\u904e\u53ef\u64a4\u56de\u6642\u9593');
    }
  },
});
