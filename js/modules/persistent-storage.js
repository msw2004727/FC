(function(root) {
  'use strict';

  if (!root) return;

  var App = root.App || (root.App = {});
  var state = root.__toosterxPersistentStorageState || {
    promise: null,
    result: null,
    unsupported: false,
    attempts: 0,
  };
  root.__toosterxPersistentStorageState = state;

  var MAX_ATTEMPTS = 8;
  var RETRY_DELAY_MS = 2000;

  function getNavigator() {
    return root.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  }

  function getStorageManager() {
    var nav = getNavigator();
    return nav && nav.storage ? nav.storage : null;
  }

  function hasStorageSupport() {
    var storage = getStorageManager();
    return !!(storage
      && typeof storage.persist === 'function'
      && typeof storage.persisted === 'function'
      && typeof storage.estimate === 'function');
  }

  function isStandalone() {
    try {
      if (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (_) {}
    try {
      var nav = getNavigator();
      return !!(nav && nav.standalone);
    } catch (_) {
      return false;
    }
  }

  function hasLoggedInUser() {
    try {
      if (root.LineAuth && typeof root.LineAuth.isLoggedIn === 'function' && root.LineAuth.isLoggedIn()) {
        return true;
      }
    } catch (_) {}
    try {
      var user = root.FirebaseService && root.FirebaseService._cache && root.FirebaseService._cache.currentUser;
      return !!(user && (user.uid || user.userId || user.id));
    } catch (_) {
      return false;
    }
  }

  function writeDebugResult(result) {
    state.result = result;
    root.__toosterxPersistentStorageLastResult = result;
    try {
      var logger = root.console && (root.console.debug || root.console.log);
      if (logger) logger.call(root.console, '[PersistentStorage]', result);
    } catch (_) {}
    return result;
  }

  App.requestPersistentStorage = function(reason) {
    if (state.promise) return state.promise;
    if (state.unsupported) {
      return Promise.resolve({ ok: false, supported: false, reason: reason || '', skipped: 'unsupported' });
    }
    if (!hasStorageSupport()) {
      state.unsupported = true;
      return Promise.resolve({ ok: false, supported: false, reason: reason || '', skipped: 'unsupported' });
    }

    var storage = getStorageManager();
    state.promise = Promise.resolve()
      .then(function() {
        return Promise.all([
          storage.persisted(),
          storage.estimate().catch(function() { return null; }),
        ]);
      })
      .then(function(values) {
        var alreadyPersisted = !!values[0];
        var estimate = values[1];
        if (alreadyPersisted) {
          return writeDebugResult({
            ok: true,
            supported: true,
            reason: reason || '',
            persisted: true,
            alreadyPersisted: true,
            estimate: estimate,
          });
        }
        return Promise.resolve(storage.persist()).then(function(granted) {
          return writeDebugResult({
            ok: true,
            supported: true,
            reason: reason || '',
            persisted: !!granted,
            alreadyPersisted: false,
            estimate: estimate,
          });
        });
      })
      .catch(function(err) {
        return writeDebugResult({
          ok: false,
          supported: true,
          reason: reason || '',
          error: err && (err.code || err.message || String(err)),
        });
      });
    return state.promise;
  };

  App.maybeRequestPersistentStorage = function(reason) {
    if (!isStandalone() && !hasLoggedInUser()) {
      return Promise.resolve({ ok: false, eligible: false, reason: reason || '' });
    }
    return App.requestPersistentStorage(reason);
  };

  function scheduleEligibilityCheck() {
    if (state.promise || state.unsupported || state.attempts >= MAX_ATTEMPTS) return;
    state.attempts += 1;
    var done = function() {
      if (!state.promise && !state.unsupported && state.attempts < MAX_ATTEMPTS) {
        root.setTimeout(scheduleEligibilityCheck, RETRY_DELAY_MS);
      }
    };
    App.maybeRequestPersistentStorage(isStandalone() ? 'standalone-boot' : 'auth-ready-check').then(done, done);
  }

  function start() {
    root.setTimeout(scheduleEligibilityCheck, 0);
  }

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
