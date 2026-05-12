/* ================================================
   ToosterX — Private Message dialog search
   ================================================ */

Object.assign(App, {
  _pmDialogSearchKeyword: '',

  filterPmDialogMessages(keyword) {
    this._pmDialogSearchKeyword = String(keyword || '').trim().toLowerCase();
    this._renderPmDialogMessages(this._pmDialogMessages || []);
  },
});
