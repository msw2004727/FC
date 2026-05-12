/* ================================================
   ToosterX - Private Message dialog search
   ================================================ */

Object.assign(App, {
  _pmDialogSearchKeyword: '',
  _pmDialogSearchExpanded: false,

  togglePmDialogSearch(expanded) {
    const overlay = document.getElementById('pm-dialog-overlay');
    const tools = overlay?.querySelector('.pm-dialog-tools');
    const input = overlay?.querySelector('.pm-dialog-search');
    const toggle = overlay?.querySelector('.pm-dialog-search-toggle');
    if (!tools || !input) return;
    const next = typeof expanded === 'boolean' ? expanded : !this._pmDialogSearchExpanded;
    this._pmDialogSearchExpanded = next;
    tools.classList.toggle('is-search-open', next);
    if (toggle) toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) {
      setTimeout(() => input.focus(), 0);
      return;
    }
    input.value = '';
    this.filterPmDialogMessages('');
  },

  filterPmDialogMessages(keyword) {
    this._pmDialogSearchKeyword = String(keyword || '').trim().toLowerCase();
    const state = this._currentPmDialog;
    const messages = state?.conversationId && this._getPmDialogRenderMessages
      ? this._getPmDialogRenderMessages(state.conversationId, this._pmDialogMessages || [])
      : (this._pmDialogMessages || []);
    this._renderPmDialogMessages(messages);
  },
});
