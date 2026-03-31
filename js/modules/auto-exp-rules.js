/* ================================================
   SportHub — Auto EXP Reconciliation Rules
   放鴿子扣分 / LINE 綁定獎勵 / 徽章獎勵

   Reconciliation model：
     expected = count × unitAmount
     actual   = tracking doc 中的 applied
     delta    = expected − actual → 補發或扣回
   ================================================ */

Object.assign(App, {

  // ── Reconciliation Core ──

  /**
   * Compare expected total vs already-applied total, adjust delta.
   * Chunks into ±100 calls to stay within CF auto mode limit.
   */
  async _reconcileAutoExp(uid, ruleKey, expectedTotal, reason) {
    if (!uid || typeof expectedTotal !== 'number' || !Number.isFinite(expectedTotal)) return;

    var applied = await this._getAutoExpTracking(uid, ruleKey);
    var delta = expectedTotal - applied;
    if (delta === 0) return;

    var CHUNK = 100;
    var sign = delta > 0 ? 1 : -1;
    var remaining = Math.abs(delta);
    var chunkIdx = 0;
    var baseTs = Date.now();

    while (remaining > 0) {
      var amount = Math.min(remaining, CHUNK) * sign;
      var requestId = 'autoexp_' + uid + '_' + ruleKey + '_' + expectedTotal + '_' + baseTs + '_' + chunkIdx;
      ApiService.adjustUserExp(uid, amount, reason, '系統', {
        mode: 'auto', requestId: requestId, ruleKey: ruleKey,
      });
      remaining -= CHUNK;
      chunkIdx++;
    }

    // Update tracking
    await this._setAutoExpTracking(uid, ruleKey, expectedTotal);

    // Local log
    var logs = this._getAutoExpLogs();
    var user = (ApiService.getAdminUsers() || []).find(function (u) {
      return u.uid === uid || u.lineUserId === uid;
    });
    logs.unshift({
      time: typeof App._formatDateTime === 'function' ? App._formatDateTime(new Date()) : new Date().toLocaleString(),
      target: (user && user.name) || uid,
      key: ruleKey,
      amount: delta,
      context: reason,
    });
    if (logs.length > 200) logs.length = 200;
    localStorage.setItem(this._autoExpLogKey(), JSON.stringify(logs));

    // Sync UI for current user
    var curUser = ApiService.getCurrentUser();
    if (curUser && (curUser.uid === uid || curUser.lineUserId === uid)) {
      if (typeof this.renderProfileData === 'function') this.renderProfileData();
      if (typeof this.renderPersonalDashboard === 'function') this.renderPersonalDashboard();
    }
  },

  // ── Tracking Storage (Firestore: users/{uid}/autoExpTracking/{ruleKey}) ──

  async _getAutoExpTracking(uid, ruleKey) {
    if (typeof db === 'undefined') {
      try {
        return Number(JSON.parse(localStorage.getItem('autoExpTrack_' + uid + '_' + ruleKey)) || 0);
      } catch (_) { return 0; }
    }
    try {
      var doc = await db.collection('users').doc(uid)
        .collection('autoExpTracking').doc(ruleKey).get();
      return doc.exists ? (Number(doc.data().applied) || 0) : 0;
    } catch (err) {
      console.warn('[autoExpTracking] read failed:', ruleKey, err.message);
      return 0;
    }
  },

  async _setAutoExpTracking(uid, ruleKey, applied) {
    if (typeof db === 'undefined') {
      localStorage.setItem('autoExpTrack_' + uid + '_' + ruleKey, JSON.stringify(applied));
      return;
    }
    try {
      await db.collection('users').doc(uid)
        .collection('autoExpTracking').doc(ruleKey).set({
          applied: applied,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (err) {
      console.warn('[autoExpTracking] write failed:', ruleKey, err.message);
    }
  },

  // ═══ Rule 1: LINE Binding Bonus (one-time, +100) ═══

  _reconcileLineBindingExp(uid) {
    if (!uid) return;
    var amount = typeof this._getAutoExpAmount === 'function'
      ? this._getAutoExpAmount('line_binding') : 0;
    if (!amount) return;

    // Deterministic requestId → CF dedup handles one-time guarantee
    var requestId = 'autoexp_' + uid + '_line_binding';
    ApiService.adjustUserExp(uid, amount, '自動：綁定 LINE 推播', '系統', {
      mode: 'auto', requestId: requestId, ruleKey: 'line_binding',
    });

    // Local log
    var logs = typeof this._getAutoExpLogs === 'function' ? this._getAutoExpLogs() : [];
    var curUser = ApiService.getCurrentUser();
    logs.unshift({
      time: typeof App._formatDateTime === 'function' ? App._formatDateTime(new Date()) : new Date().toLocaleString(),
      target: (curUser && curUser.name) || uid,
      key: 'line_binding',
      amount: amount,
      context: 'LINE 推播綁定',
    });
    if (logs.length > 200) logs.length = 200;
    if (typeof this._autoExpLogKey === 'function') {
      localStorage.setItem(this._autoExpLogKey(), JSON.stringify(logs));
    }
  },

  // ═══ Rule 2: No-show Penalty (reconciliation, −50 per occurrence) ═══

  async _reconcileNoShowExp(uid) {
    if (!uid) return;
    var amount = typeof this._getAutoExpAmount === 'function'
      ? this._getAutoExpAmount('noshow_penalty') : 0;
    if (!amount) return;

    if (typeof this._getEffectiveNoShowCount !== 'function') {
      console.warn('[autoExpRules] _getEffectiveNoShowCount not loaded, skip');
      return;
    }

    var count = this._getEffectiveNoShowCount(uid);
    var expectedTotal = count * amount;
    var reason = '自動：放鴿子扣分（' + count + ' 次 × ' + amount + '）';
    await this._reconcileAutoExp(uid, 'noshow_penalty', expectedTotal, reason);
  },

  // ═══ Rule 3: Badge Bonus (reconciliation, +100 per badge) ═══

  async _reconcileBadgeExp(uid) {
    if (!uid) return;
    var amount = typeof this._getAutoExpAmount === 'function'
      ? this._getAutoExpAmount('badge_bonus') : 0;
    if (!amount) return;

    var badges = typeof this._getAchievementBadges === 'function'
      ? this._getAchievementBadges() : null;
    var badgeCount = (badges && typeof badges.getCurrentUserBadgeCount === 'function')
      ? badges.getCurrentUserBadgeCount() : 0;
    var expectedTotal = badgeCount * amount;
    var reason = '自動：徽章獎勵（' + badgeCount + ' 枚 × ' + amount + '）';
    await this._reconcileAutoExp(uid, 'badge_bonus', expectedTotal, reason);
  },

});
