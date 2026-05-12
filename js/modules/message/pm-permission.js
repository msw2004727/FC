/* ================================================
   ToosterX — Private Message permissions/helpers
   ================================================ */

Object.assign(App, {
  PM_MARK_READ_DEBOUNCE_MS: 500,
  PM_MAX_BODY_LENGTH: 300,
  PM_KEYBOARD_RESTORE_DELAY_MS: 320,
  PM_KEYBOARD_MIN_VIEWPORT_HEIGHT: 320,

  _pmRoleLevels: {
    user: 0,
    coach: 1,
    captain: 2,
    venue_owner: 3,
    admin: 4,
    super_admin: 5,
  },

  isValidLineUid(uid) {
    return /^U[0-9a-f]{32}$/i.test(String(uid || '').trim());
  },

  normalizeRoleForPM(role) {
    const safeRole = String(role || '').trim();
    return Object.prototype.hasOwnProperty.call(this._pmRoleLevels, safeRole) ? safeRole : 'user';
  },

  _pmParseConversationId(cId) {
    const raw = String(cId || '').trim();
    const match = raw.match(/^pm_(U[0-9a-f]{32})_(U[0-9a-f]{32})$/i);
    if (!match || match[1] === match[2]) return null;
    const uidA = match[1];
    const uidB = match[2];
    const canonical = this.pmBuildConversationId(uidA, uidB);
    if (canonical !== raw) return null;
    return { uidA, uidB, participants: [uidA, uidB] };
  },

  pmBuildConversationId(uidA, uidB) {
    const a = String(uidA || '').trim();
    const b = String(uidB || '').trim();
    if (!this.isValidLineUid(a) || !this.isValidLineUid(b) || a === b) return '';
    return `pm_${[a, b].sort().join('_')}`;
  },

  pmIsValidConversationId(cId, uid) {
    const parsed = this._pmParseConversationId(cId);
    const safeUid = String(uid || '').trim();
    if (!parsed || !safeUid) return false;
    return parsed.uidA === safeUid || parsed.uidB === safeUid;
  },

  canSendPMTo(fromRole, toRole, hasExistingConvo = false, settings = {}) {
    const normalizedFromRole = this.normalizeRoleForPM(fromRole);
    const normalizedToRole = this.normalizeRoleForPM(toRole);
    const fromLevel = this._pmRoleLevels[normalizedFromRole] ?? 0;
    const toLevel = this._pmRoleLevels[normalizedToRole] ?? 0;
    if (fromLevel >= this._pmRoleLevels.admin) return true;
    if (hasExistingConvo) return true;
    if (settings?.allowUserToUserPm === true && normalizedFromRole === 'user' && normalizedToRole === 'user') return true;
    return fromLevel < toLevel;
  },

  _pmCallable(name) {
    return firebase.app().functions('asia-east1').httpsCallable(name);
  },

  _pmCurrentUid() {
    return auth?.currentUser?.uid || ApiService.getCurrentUser()?.uid || ApiService.getCurrentUser()?.lineUserId || '';
  },

  _pmFormatTime(value) {
    try {
      const date = typeof value?.toDate === 'function'
        ? value.toDate()
        : (value?.seconds ? new Date(value.seconds * 1000) : new Date(value));
      if (!date || Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  },
});
