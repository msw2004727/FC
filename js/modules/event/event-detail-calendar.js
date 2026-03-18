/* ================================================
   SportHub — Event: Add to Calendar
   一鍵加入行事曆 — 產生 .ics 直接開啟系統行事曆（含提醒）
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

      this._openIcsInSystemCalendar(calEvent);
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
  //  .ics — 直接開啟系統行事曆
  // ══════════════════════════════════

  _toIcsDateStr(d) {
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) + 'T' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds());
  },

  _foldIcsLine(line) {
    var result = [];
    while (line.length > 75) {
      result.push(line.slice(0, 75));
      line = ' ' + line.slice(75);
    }
    result.push(line);
    return result.join('\r\n');
  },

  _escapeIcsText(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  },

  _buildIcsContent(calEvent) {
    var uid = 'sporthub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '@toosterx.com';
    var now = this._toIcsDateStr(new Date());
    var tzid = 'Asia/Taipei';

    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SportHub//Event//ZH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Taipei',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0800',
      'TZOFFSETTO:+0800',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      this._foldIcsLine('UID:' + uid),
      'DTSTAMP:' + now,
      this._foldIcsLine('DTSTART;TZID=' + tzid + ':' + this._toIcsDateStr(calEvent.start)),
      this._foldIcsLine('DTEND;TZID=' + tzid + ':' + this._toIcsDateStr(calEvent.end)),
      this._foldIcsLine('SUMMARY:' + this._escapeIcsText(calEvent.title)),
      this._foldIcsLine('LOCATION:' + this._escapeIcsText(calEvent.location)),
      this._foldIcsLine('DESCRIPTION:' + this._escapeIcsText(calEvent.description)),
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      this._foldIcsLine('DESCRIPTION:' + this._escapeIcsText(calEvent.title) + ' \u660E\u5929\u958B\u59CB'),
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      this._foldIcsLine('DESCRIPTION:' + this._escapeIcsText(calEvent.title) + ' \u5373\u5C07\u958B\u59CB'),
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  },

  _openIcsInSystemCalendar(calEvent) {
    var icsContent = this._buildIcsContent(calEvent);
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOS) {
      // iOS Safari / LINE WebView 不支援 blob: URL 開啟 .ics
      // 改用 data URI — iOS 會直接彈出 Apple Calendar「加入行程」對話框
      var dataUri = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(icsContent);
      window.open(dataUri);
    } else {
      // Android / 桌面 — blob URL + download 屬性
      // Android 會觸發 intent 選擇器（Google Calendar 等）
      var blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
      var blobUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = blobUrl;
      a.download = (calEvent.title || 'event').replace(/[^\w\u4e00-\u9fff]/g, '_').slice(0, 30) + '.ics';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 10000);
    }

    this.showToast('\u6B63\u5728\u958B\u555F\u884C\u4E8B\u66C6\u2026');
  },

});
