/* ================================================
   ToosterX — Private Message write actions
   ================================================ */

Object.assign(App, {
  async sendPmMessage() {
    const state = this._currentPmDialog;
    if (!state?.targetUid) return;
    const overlay = document.getElementById('pm-dialog-overlay');
    const input = overlay?.querySelector('.pm-dialog-input');
    const btn = overlay?.querySelector('.pm-dialog-send');
    const body = String(input?.value || '').trim();
    if (!body) {
      this.showToast?.('請輸入訊息');
      return;
    }
    if (body.length > 1000) {
      this.showToast?.('訊息最多 1000 字');
      return;
    }
    this._setPmSendBusy(true);
    try {
      const fn = this._pmCallable?.('sendPrivateMessage');
      if (!fn) throw new Error('sendPrivateMessage missing');
      await fn({ toUid: state.targetUid, body });
      if (input) input.value = '';
    } catch (err) {
      console.warn('[sendPmMessage]', err);
      const code = String(err?.code || '');
      if (code.includes('resource-exhausted')) this.showToast?.('私訊太頻繁，請稍後再試');
      else if (code.includes('permission-denied')) this.showToast?.('目前無法私訊此用戶');
      else this.showToast?.('私訊送出失敗');
    } finally {
      this._setPmSendBusy(false);
    }
  },

  _setPmSendBusy(busy) {
    const overlay = document.getElementById('pm-dialog-overlay');
    const btn = overlay?.querySelector('.pm-dialog-send');
    const input = overlay?.querySelector('.pm-dialog-input');
    if (btn) {
      btn.disabled = !!busy;
      btn.classList.toggle('is-loading', !!busy);
      btn.textContent = busy ? '送出中' : '送出';
    }
    if (input) input.disabled = !!busy;
  },

  async editPmMessage(messageId) {
    const state = this._currentPmDialog;
    if (!state?.conversationId || !messageId) return;
    const current = (this._pmDialogMessages || []).find(m => (m.messageId || m.id) === messageId);
    const nextBody = prompt('編輯訊息', current?.body || '');
    if (nextBody == null) return;
    const body = String(nextBody || '').trim();
    if (!body || body.length > 1000) {
      this.showToast?.('訊息最多 1000 字');
      return;
    }
    try {
      const fn = this._pmCallable?.('editPrivateMessage');
      if (!fn) throw new Error('editPrivateMessage missing');
      await fn({ conversationId: state.conversationId, messageId, body });
    } catch (err) {
      console.warn('[editPmMessage]', err);
      this.showToast?.('編輯失敗或已超過可編輯時間');
    }
  },

  async recallPmMessage(messageId) {
    const state = this._currentPmDialog;
    if (!state?.conversationId || !messageId) return;
    if (!confirm('確定要撤回這則訊息嗎？')) return;
    try {
      const fn = this._pmCallable?.('recallPrivateMessage');
      if (!fn) throw new Error('recallPrivateMessage missing');
      await fn({ conversationId: state.conversationId, messageId });
    } catch (err) {
      console.warn('[recallPmMessage]', err);
      this.showToast?.('撤回失敗或已超過可撤回時間');
    }
  },
});
