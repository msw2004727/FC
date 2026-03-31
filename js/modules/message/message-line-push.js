/* ================================================
   SportHub — Message: LINE Push Notification Queue
   Split from message-notify.js — pure move, no logic changes
   ================================================ */

Object.assign(App, {

  _LINE_PUSH_FORCED_ON_SOURCES: [
    'template:waitlist_promoted',
    'template:event_cancelled',
    'template:event_changed',
  ],

  _isForcedLinePushSource(source) {
    const safeSource = String(source || '').trim();
    return this._LINE_PUSH_FORCED_ON_SOURCES.some(prefix => safeSource.startsWith(prefix))
      || safeSource.startsWith('target:');
  },

  _shouldSkipLinePushByToggles(category, source, toggles) {
    if (this._isForcedLinePushSource(source)) return false;

    const safeToggles = toggles || {};
    const categoryKey = 'category_' + this._linePushCategoryKey(category);
    if (safeToggles[categoryKey] === false) return true;

    if (String(source || '').startsWith('template:')) {
      const typeKey = 'type_' + String(source || '').slice('template:'.length);
      if (safeToggles[typeKey] === false) return true;
    }

    return false;
  },

  _queueLinePushByTarget(targetType, targetUid, category, title, body, teamId, options = {}) {
    const baseOptions = { ...options, source: options.source || `target:${targetType}` };
    if (targetType === 'individual') {
      if (targetUid) this._queueLinePush(targetUid, category, title, body, baseOptions);
      return;
    }
    // 與 sendMessage() 的 roleTargetMap 保持一致
    const roleFilter = {
      coach_up: ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'],
      admin: ['admin', 'super_admin'],
      coach: ['coach', 'admin', 'super_admin'],
      captain: ['captain', 'admin', 'super_admin'],
      venue_owner: ['venue_owner', 'admin', 'super_admin'],
    };
    const users = ApiService.getAdminUsers() || [];
    users.forEach(u => {
      if (roleFilter[targetType] && !roleFilter[targetType].includes(u.role)) return;
      if (targetType === 'team') {
        const inTeam = (typeof this._isUserInTeam === 'function')
          ? this._isUserInTeam(u, teamId)
          : (u.teamId === teamId);
        if (!inTeam) return;
      }
      this._queueLinePush(u.uid, category, title, body, baseOptions);
    });
  },

  // category → lineNotify settings key 映射（private 歸入 system）
  _linePushCategoryKey(category) {
    if (category === 'private') return 'system';
    return category; // system, activity, tournament 直接對應
  },

  _canCurrentUserUsePrivilegedLineQueue() {
    return true;
  },

  _getLineNotifySettings(lineNotify) {
    return {
      activity: true,
      system: true,
      tournament: false,
      ...(lineNotify?.settings || {}),
    };
  },

  _getLinePushTargetUser(uid) {
    const users = ApiService.getAdminUsers() || [];
    const target = users.find(u =>
      u.uid === uid || u.lineUserId === uid || u._docId === uid
    );
    if (target) return target;

    const currentUser = ApiService.getCurrentUser?.() || null;
    if (
      currentUser &&
      (currentUser.uid === uid || currentUser.lineUserId === uid || currentUser._docId === uid)
    ) {
      return currentUser;
    }
    return null;
  },

  _enqueuePrivilegedLinePush(uid, category, title, body, options = {}) {
    const payload = {
      uid,
      category,
      title,
      body,
      source: options.source || 'client:line-push',
    };
    if (options.dedupeKey) payload.dedupeKey = options.dedupeKey;

    return firebase.app().functions('asia-east1').httpsCallable('enqueuePrivilegedLineNotification')(payload)
      .then(result => {
        const data = result?.data || {};
        if (data.skipped) {
          console.log('[LINE Push] skipped:', data.reason || 'unknown', payload);
        } else if (data.queued) {
          console.log('[LINE Push] queued via callable:', data.queueId || '(no-id)', payload);
        }
        return data;
      });
  },

  _dispatchLinePush(uid, category, title, body, options = {}) {
    if (this._canCurrentUserUsePrivilegedLineQueue()) {
      this._enqueuePrivilegedLinePush(uid, category, title, body, options)
        .catch(err => console.error('[LINE Push] callable enqueue failed:', err));
      return;
    }

    db.collection('linePushQueue').add({
      uid,
      title,
      body,
      category,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error('[LINE Push] 寫入失敗:', err));
  },

  _queueLinePush(uid, category, title, body, options = {}) {
    if (!uid || !category || !title || !body) return;
    const source = String(options?.source || '').trim();
    const hasCachedFeatureFlags = !!FirebaseService.getCachedDoc?.('siteConfig', 'featureFlags');
    const shouldPreloadToggles = !this._isForcedLinePushSource(source)
      && !hasCachedFeatureFlags
      && typeof FirebaseService.ensureSingleDocLoaded === 'function'
      && typeof db !== 'undefined';

    const finalizeQueue = () => {
      const toggles = FirebaseService.getNotificationToggles?.() || {};
      if (this._shouldSkipLinePushByToggles(category, source, toggles)) return;
      this._dispatchLinePush(uid, category, title, body, options);
    };

    if (shouldPreloadToggles) {
      FirebaseService.ensureSingleDocLoaded('siteConfig', 'featureFlags')
        .catch(err => {
          console.warn('[LINE Push] featureFlags preload failed:', err);
        })
        .finally(() => {
          finalizeQueue();
        });
      return;
    }

    finalizeQueue();
  },

});
