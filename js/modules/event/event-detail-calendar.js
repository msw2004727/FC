/* ================================================
   SportHub — Event: Add to Calendar
   一鍵加入行事曆 — Google Calendar URL 外開
   ================================================ */

Object.assign(App, {

  _calendarInProgress: false,

  // ══════════════════════════════════
  //  Main Entry — 一鍵加入行事曆
  // ══════════════════════════════════

  addEventToCalendar(eventId) {
    if (this._calendarInProgress) return;
    this._calendarInProgress = true;
    try {
      var event = ApiService.getEvents().find(function (ev) { return ev.id === eventId; });
      if (!event) { this.showToast('\u627E\u4E0D\u5230\u6D3B\u52D5\u8CC7\u6599'); return; }

      var parsed = this._parseEventDateRange(event.date);
      if (!parsed) { this.showToast('\u7121\u6CD5\u89E3\u6790\u6D3B\u52D5\u6642\u9593'); return; }

      var calEvent = {
        title: event.title || '',
        location: event.location || '',
        description: this._buildCalendarDescription(event),
        start: parsed.start,
        end: parsed.end,
      };

      this._openGoogleCalendar(calEvent);
    } finally {
      this._calendarInProgress = false;
    }
  },

  // ══════════════════════════════════
  //  Date Parsing
  // ══════════════════════════════════

  /** 解析活動日期格式 "YYYY/MM/DD HH:MM~HH:MM" → { start: Date, end: Date } */
  _parseEventDateRange(dateStr) {
    if (!dateStr) return null;
    var m = String(dateStr).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~\uFF5E\-]\s*(\d{1,2}):(\d{2}))?/);
    if (!m) return null;

    var year = parseInt(m[1], 10);
    var month = parseInt(m[2], 10) - 1;
    var day = parseInt(m[3], 10);
    var startH = parseInt(m[4], 10);
    var startM = parseInt(m[5], 10);

    var start = new Date(year, month, day, startH, startM, 0);
    var end;
    if (m[6] && m[7]) {
      end = new Date(year, month, day, parseInt(m[6], 10), parseInt(m[7], 10), 0);
    } else {
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    }
    return { start: start, end: end };
  },

  // ══════════════════════════════════
  //  Description Builder
  // ══════════════════════════════════

  _buildCalendarDescription(event) {
    var lines = [];
    if (event.type) lines.push('\u985E\u578B\uFF1A' + event.type);
    if (event.max) lines.push('\u540D\u984D\uFF1A' + (event.current || 0) + '/' + event.max + ' \u4EBA');
    if (event.fee) lines.push('\u8CBB\u7528\uFF1A$' + event.fee);
    if (event.notes) lines.push('\n\u6CE8\u610F\u4E8B\u9805\uFF1A\n' + event.notes);
    lines.push('\n\u2014 SportHub');
    return lines.join('\n');
  },

  // ══════════════════════════════════
  //  Google Calendar URL
  // ══════════════════════════════════

  _toGcalDateStr(d) {
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    // Google Calendar 需要 UTC 格式 YYYYMMDDTHHmmSSZ
    // 但我們用本地時間，所以不加 Z，改用不帶時區的格式
    return d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) + 'T' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds());
  },

  _openGoogleCalendar(calEvent) {
    var dates = this._toGcalDateStr(calEvent.start) + '/' + this._toGcalDateStr(calEvent.end);

    var params = [
      'action=TEMPLATE',
      'text=' + encodeURIComponent(calEvent.title),
      'dates=' + dates,
      'location=' + encodeURIComponent(calEvent.location),
      'details=' + encodeURIComponent(calEvent.description),
      'ctz=Asia/Taipei',
    ];

    var url = 'https://calendar.google.com/calendar/render?' + params.join('&');

    // LIFF 環境用 openWindow 外開，確保 LINE WebView 能正常跳轉
    if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
      liff.openWindow({ url: url, external: true });
    } else {
      window.open(url, '_blank');
    }

    this.showToast('\u6B63\u5728\u958B\u555F Google \u884C\u4E8B\u66C6\u2026');
  },

});
