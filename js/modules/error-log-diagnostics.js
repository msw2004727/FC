/* ================================================
   SportHub Error Log Diagnostics Helpers
   Display-only helpers for admin error log analysis
   ================================================ */

Object.assign(App, {
  _normalizeErrorCode(value) {
    return String(value || '').trim().replace(/^functions\//i, '').toLowerCase();
  },

  _normalizeErrorMessage(value) {
    return String(value || '').trim();
  },

  _isFirestoreIndexedDbTransientLog(log) {
    const code = this._normalizeErrorCode(log?.errorCode);
    const message = this._normalizeErrorMessage(log?.errorMessage).toLowerCase();
    return code === 'firestore-indexeddb-transient'
      || message.includes('attempt to get records from database without an in-progress transaction');
  },

  _isProfileIncompleteLog(log) {
    const context = this._getErrorContextObject(log?.context) || {};
    const text = [
      log?.errorCode,
      log?.errorMessage,
      context.errCode,
      context.reason,
      context.action,
    ].map(value => String(value || '')).join(' ').toUpperCase();
    return text.includes('PROFILE_INCOMPLETE');
  },

  _getErrorSeverity(log) {
    const code = this._normalizeErrorCode(log?.errorCode);
    const message = this._normalizeErrorMessage(log?.errorMessage).toLowerCase();

    if (this._isFirestoreIndexedDbTransientLog(log)) {
      return { key: 'info', label: '\u4f4e', className: 'severity-info' };
    }

    if (this._isProfileIncompleteLog(log)) {
      return { key: 'info', label: '一般', className: 'severity-info' };
    }

    if (
      ['permission-denied', 'unauthenticated', 'failed-precondition', 'internal', 'unknown', 'data-loss']
        .includes(code)
      || /permission|forbidden|auth|unauth|rules|insufficient permissions/.test(message)
    ) {
      return { key: 'critical', label: '嚴重', className: 'severity-critical' };
    }

    if (
      ['deadline-exceeded', 'unavailable', 'resource-exhausted', 'aborted', 'cancelled', 'network-request-failed']
        .includes(code)
      || /timeout|timed out|network|failed to fetch|load failed|quota|too many requests|unavailable/.test(message)
    ) {
      return { key: 'warn', label: '警告', className: 'severity-warn' };
    }

    return { key: 'info', label: '一般', className: 'severity-info' };
  },

  _getErrorCodeLabel(code) {
    const normalized = this._normalizeErrorCode(code);
    const map = {
      'firestore-indexeddb-transient': '\u672c\u5730\u5feb\u53d6\u66ab\u614b\u932f\u8aa4',
      'permission-denied': '權限不足',
      unauthenticated: '登入失效',
      'not-found': '找不到資料',
      'already-exists': '資料已存在',
      'failed-precondition': '前置條件不符',
      'resource-exhausted': '資源已達上限',
      'deadline-exceeded': '操作逾時',
      cancelled: '操作取消',
      unavailable: '服務不可用',
      'network-request-failed': '網路錯誤',
      'invalid-argument': '參數錯誤',
      profile_incomplete: '個人資料未補齊',
      internal: '系統錯誤',
      unknown: '未知錯誤',
      aborted: '流程中止',
    };
    return map[normalized] || (normalized ? normalized : '未分類');
  },

  _getErrorDisplayCode(log) {
    if (this._isProfileIncompleteLog(log)) return 'PROFILE_INCOMPLETE';
    return this._normalizeErrorCode(log?.errorCode);
  },

  _getErrorDisplayCodeLabel(log) {
    if (this._isProfileIncompleteLog(log)) return '個人資料未補齊';
    return this._getErrorCodeLabel(log?.errorCode);
  },

  _getErrorChineseMessage(log) {
    const code = this._normalizeErrorCode(log?.errorCode);
    const message = this._normalizeErrorMessage(log?.errorMessage);
    const lower = message.toLowerCase();
    const codeMap = {
      'firestore-indexeddb-transient': '\u700f\u89bd\u5668\u672c\u5730\u5feb\u53d6\u66ab\u6642\u4e0d\u7a69\uff0c\u591a\u534a\u767c\u751f\u5728 LINE \u5167\u5efa\u700f\u89bd\u5668\u3002\u9019\u4e0d\u4ee3\u8868\u8cc7\u6599\u58de\u6389\uff0c\u901a\u5e38\u91cd\u65b0\u6574\u7406\u5373\u53ef\u6062\u5fa9\u3002',
      'permission-denied': '權限不足，這個操作被系統拒絕。可能是登入狀態過期，或目前身分沒有這個權限。',
      unauthenticated: '登入狀態失效，請重新登入後再試。',
      'not-found': '找不到要操作的資料，可能已被刪除或尚未同步。',
      'already-exists': '資料已存在，系統拒絕重複建立。',
      'failed-precondition': '目前資料狀態不符合操作條件，請重新整理後再試。',
      'resource-exhausted': '操作太頻繁或系統資源暫時不足，請稍後再試。',
      'deadline-exceeded': '連線逾時，可能是網路不穩或服務回應較慢。',
      cancelled: '操作已被取消，請重新操作一次。',
      unavailable: '目前連線或服務不穩，請稍後再試。',
      'network-request-failed': '網路連線失敗，請檢查網路後再試。',
      'invalid-argument': '送出的資料格式不正確，系統無法完成操作。',
      internal: '系統發生未預期錯誤，請管理員查看詳細紀錄。',
      unknown: '系統發生未知錯誤，請管理員查看詳細紀錄。',
      aborted: '流程中止，請重新整理後再試。',
    };
    if (this._isFirestoreIndexedDbTransientLog(log)) return codeMap['firestore-indexeddb-transient'];
    if (this._isProfileIncompleteLog(log)) return '請先補齊個人資料（性別、生日、地區）後再報名。';
    if (codeMap[code]) return codeMap[code];
    if (/missing or insufficient permissions|the caller does not have permission|permission denied|insufficient permissions/.test(lower)) return codeMap['permission-denied'];
    if (/authentication required|requires authentication|auth token is expired|id token has expired|user token expired/.test(lower)) return codeMap.unauthenticated;
    if (/network request failed|failed to fetch|load failed|networkerror/.test(lower)) return codeMap['network-request-failed'];
    if (/no document to update|document does not exist|not found/.test(lower)) return codeMap['not-found'];
    if (/is required|missing required/.test(lower)) return '缺少必要資料，系統無法完成操作。';
    if (/too many requests|quota exceeded|resource exhausted/.test(lower)) return codeMap['resource-exhausted'];
    if (/timeout|timed out|deadline exceeded/.test(lower)) return codeMap['deadline-exceeded'];
    if (/[\u4e00-\u9fff]/.test(message)) return message;
    return '系統發生錯誤，請稍後再試；管理員可展開詳細紀錄追查原因。';
  },

  _getErrorTimestampMs(log) {
    const createdAt = log?.createdAt;
    if (createdAt && typeof createdAt.toMillis === 'function') return createdAt.toMillis();
    if (createdAt && typeof createdAt.seconds === 'number') {
      return (createdAt.seconds * 1000) + Math.floor((createdAt.nanoseconds || 0) / 1000000);
    }
    const isoMs = Date.parse(log?.clientTimeIso || log?.createdAtIso || '');
    if (Number.isFinite(isoMs)) return isoMs;
    const time = String(log?.time || '').trim();
    const match = time.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0)).getTime();
    }
    return 0;
  },

  _formatErrorLogTime(log) {
    const ms = this._getErrorTimestampMs(log);
    if (ms && typeof this._formatDateTime === 'function') return this._formatDateTime(new Date(ms));
    return String(log?.time || '').trim();
  },

  _getErrorDateKey(log) {
    const ms = this._getErrorTimestampMs(log);
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  _getErrorContextObject(ctx) {
    if (!ctx) return null;
    try {
      const obj = typeof ctx === 'string' ? JSON.parse(ctx) : ctx;
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (_) {
      return null;
    }
  },

  _parseErrorContext(ctx) {
    const obj = this._getErrorContextObject(ctx);
    if (!obj) return String(ctx || '');
    const parts = [];
    if (obj.fn) parts.push(obj.fn);
    Object.keys(obj).forEach(key => {
      if (key !== 'fn' && obj[key] != null && obj[key] !== '') parts.push(`${key}=${obj[key]}`);
    });
    return parts.join(', ');
  },

  _getErrorFunctionName(log) {
    const obj = this._getErrorContextObject(log?.context);
    if (obj?.fn) return String(obj.fn);
    const raw = String(log?.context || '').trim();
    return raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
  },

  _parseUserAgent(ua) {
    return this._getErrorDeviceInfo(ua).label;
  },

  _getErrorDeviceInfo(ua) {
    const text = String(ua || '');
    const osName = /iPhone|iPad|iPod/i.test(text) ? 'iOS'
      : /Android/i.test(text) ? 'Android'
      : /Windows/i.test(text) ? 'Windows'
      : /Macintosh|Mac OS X/i.test(text) ? 'macOS'
      : /Linux/i.test(text) ? 'Linux'
      : 'Other';
    const browserName = /Line\//i.test(text) ? 'LINE'
      : /Edg\//i.test(text) ? 'Edge'
      : /CriOS|Chrome\//i.test(text) ? 'Chrome'
      : /FxiOS|Firefox\//i.test(text) ? 'Firefox'
      : /Safari\//i.test(text) ? 'Safari'
      : 'Other';
    const deviceType = /iPad|Tablet/i.test(text) ? 'tablet'
      : /Mobi|Android|iPhone|iPod/i.test(text) ? 'mobile'
      : 'desktop';
    const label = `${osName}${browserName !== 'Other' ? ` · ${browserName}` : ''}`;
    return { osName, browserName, deviceType, label };
  },

  _getErrorDeviceType(log) {
    return String(log?.deviceType || this._getErrorDeviceInfo(log?.userAgent).deviceType || '').trim();
  },

  _getErrorDeviceLabel(log) {
    const os = String(log?.osName || '').trim();
    const browser = String(log?.browserName || '').trim();
    if (os || browser) return `${os || 'Other'}${browser ? ` · ${browser}` : ''}`;
    return this._getErrorDeviceInfo(log?.userAgent).label;
  },

  _getErrorVersion(log) {
    return String(log?.appVersion || '').trim();
  },

  _getErrorPage(log) {
    return String(log?.page || 'unknown').trim();
  },

  _getErrorSearchText(log) {
    const contextSummary = this._parseErrorContext(log?.context);
    return [
      log?.userName, log?.uid, log?.role, this._getErrorPage(log),
      this._getErrorFunctionName(log), this._getErrorDisplayCodeLabel(log),
      this._getErrorDisplayCode(log), log?.errorCode, this._getErrorChineseMessage(log), log?.errorMessage,
      contextSummary, log?.url, log?.hash, log?.appVersion,
      this._getErrorDeviceLabel(log), log?.userAgent, log?.errorStack,
    ].filter(Boolean).join(' ').toLowerCase();
  },
});
