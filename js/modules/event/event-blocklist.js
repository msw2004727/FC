/* === SportHub — Event Blocklist (Visibility Guard) ===
   活動黑名單可見性守衛（2026-04-20）

   核心函式：_isEventVisibleToUser(event, uid)
   四狀態邏輯：
     - 訪客（無 uid）→ 可見
     - 未在 blockedUids → 可見
     - 在 blockedUids 但曾有任一報名紀錄（含 cancelled/removed）→ 可見（尊重歷史）
     - 在 blockedUids 且無任何報名紀錄 → 不可見

   重要規範（CLAUDE.md 永久條目）：
     所有活動列表渲染與詳情入口一律通過 App._isEventVisibleToUser()，
     禁止在模組內重寫黑名單判斷邏輯。
     CF 端同步此邏輯於 functions/index.js 的 isEventVisibleToUser()。
   =================================== */

Object.assign(App, {

  /**
   * 判斷某活動對某用戶是否可見（黑名單感知）
   * @param {object} e 活動物件（含 id / blockedUids 等）
   * @param {string|null|undefined} uid 用戶 uid；訪客傳 null/undefined/空字串
   * @returns {boolean} true=可見；false=不可見
   */
  _isEventVisibleToUser(e, uid) {
    if (!e) return false;
    if (!uid) return true;
    const blocked = Array.isArray(e.blockedUids) ? e.blockedUids : [];
    if (!blocked.includes(uid)) return true;
    // 被擋：檢查是否曾有任一報名紀錄（含 cancelled/removed，尊重歷史）
    return this._userHasRegistrationForEvent(e.id, uid);
  },

  /**
   * 檢查用戶是否曾有任何報名紀錄（不論 status）
   * 不經過 ApiService.getRegistrationsByEvent（會濾掉 cancelled），直接讀快取
   * @param {string} eventId
   * @param {string} uid
   * @returns {boolean}
   */
  _userHasRegistrationForEvent(eventId, uid) {
    if (!eventId || !uid) return false;
    const history = typeof ApiService !== 'undefined'
      && typeof ApiService.getRegistrationHistoryByEventUser === 'function'
      ? ApiService.getRegistrationHistoryByEventUser(eventId, uid)
      : [];
    return history.length > 0;
  },

  /**
   * 過濾活動陣列，只保留對目前登入用戶可見的活動。
   * 供列表渲染入口使用。
   * @param {Array<object>} events
   * @returns {Array<object>}
   */
  _filterVisibleEvents(events) {
    if (!Array.isArray(events)) return [];
    const uid = (typeof ApiService !== 'undefined' && ApiService.getCurrentUser)
      ? (ApiService.getCurrentUser()?.uid || null)
      : null;
    if (!uid) return events.slice();
    return events.filter(e => this._isEventVisibleToUser(e, uid));
  },

});
