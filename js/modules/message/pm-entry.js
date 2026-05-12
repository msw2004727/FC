/* ================================================
   ToosterX — Private Message lazy entry
   ================================================ */

Object.assign(App, {
  _pmDialogLoadPromise: null,

  async openPmDialog(targetUid, options = {}) {
    let safeUid = String(targetUid || '').trim();
    if ((!safeUid || !this.isValidLineUid?.(safeUid)) && options?.conversationId && this._pmParseConversationId) {
      const parsed = this._pmParseConversationId(options.conversationId);
      const myUid = this._pmCurrentUid?.() || '';
      if (parsed) safeUid = parsed.uidA === myUid ? parsed.uidB : parsed.uidA;
    }
    if (!safeUid || !this.isValidLineUid?.(safeUid)) {
      this.showToast?.('無法開啟私訊');
      return;
    }
    if (safeUid === this._pmCurrentUid?.()) {
      this.showToast?.('不能私訊自己');
      return;
    }
    try {
      if (!this._pmDialogLoadPromise) {
        this._pmDialogLoadPromise = (async () => {
          if (typeof ScriptLoader !== 'undefined' && ScriptLoader._load) {
            await ScriptLoader._load('js/modules/message/pm-dialog.js');
            await ScriptLoader._load('js/modules/message/pm-dialog-actions.js');
            await ScriptLoader._load('js/modules/message/pm-dialog-search.js');
          }
        })();
      }
      await this._pmDialogLoadPromise;
      if (typeof this._openPmDialogImpl !== 'function') {
        throw new Error('PM dialog module missing');
      }
      return this._openPmDialogImpl(safeUid, options);
    } catch (err) {
      console.error('[openPmDialog]', err);
      this._pmDialogLoadPromise = null;
      this.showToast?.('私訊功能載入失敗');
    }
  },
});
