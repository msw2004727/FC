/* ================================================
   SportHub — Message: User Inbox & Notification Utilities
   Slim glue — rendering in message-render.js,
   actions in message-actions.js, notifications in message-notify.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  User Inbox (前台)
  // ══════════════════════════════════

  _msgInboxFilter: 'all',

  // Phase 3: per-user inbox — 未讀判斷（優先看 read 欄位，向下相容 readBy 和 unread）
  _isMessageUnread(msg) {
    if (!msg) return false;
    // inbox 文件有 read 欄位（per-user inbox 格式）
    if (typeof msg.read === 'boolean') return !msg.read;
    // 向下相容：舊格式用 readBy 陣列
    const myUid = ApiService.getCurrentUser()?.uid;
    if (!myUid) return false;
    if (Array.isArray(msg.readBy)) return !msg.readBy.includes(myUid);
    return !!msg.unread;
  },

  _filterMyMessages(messages) {
    const curUser = ApiService.getCurrentUser();
    const myUid = curUser?.uid || null;
    const myRole = curUser?.role || 'user';
    const myTeamIds = (typeof this._getUserTeamIds === 'function')
      ? this._getUserTeamIds(curUser)
      : (() => {
        const ids = [];
        if (curUser?.teamId) ids.push(curUser.teamId);
        return ids;
      })();
    return messages.filter(m => {
      if (myUid && Array.isArray(m.hiddenBy) && m.hiddenBy.includes(myUid)) return false;
      if (m.targetUid || m.toUid) return myUid && (m.targetUid || m.toUid) === myUid;
      if (m.targetTeamId) return myTeamIds.includes(String(m.targetTeamId));
      if (m.targetRoles && m.targetRoles.length) return m.targetRoles.includes(myRole);
      return true; // broadcast to all
    });
  },

  _msgSearchKeyword: '',
  _msgFilterDate: '',

  filterInboxMessages() {
    this._msgSearchKeyword = (document.getElementById('msg-search-keyword')?.value || '').trim().toLowerCase();
    this._msgFilterDate = document.getElementById('msg-filter-date')?.value || '';
    this.renderMessageList();
  },

  // ══════════════════════════════════
  //  Helper：取得發送人暱稱
  // ══════════════════════════════════

  _getMsgSenderName() {
    // 優先用 LINE 暱稱
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) {
      const profile = LineAuth.getProfile();
      if (profile && profile.displayName) return profile.displayName;
    }
    // 其次用 currentUser
    const user = ApiService.getCurrentUser?.() || null;
    if (user && user.displayName) return user.displayName;
    return '系統';
  },

});
