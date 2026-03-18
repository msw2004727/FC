/* ================================================
   SportHub — Event: Add to Calendar
   產生 .ics 檔（含提醒）及 Google / Outlook 行事曆連結
   依賴：event-share.js（共用 action sheet CSS）
   ================================================ */

Object.assign(App, {

  _calendarInProgress: false,

  // ══════════════════════════════════
  //  Main Entry
  // ══════════════════════════════════

  async addEventToCalendar(eventId) {
    if (this._calendarInProgress) return;
    this._calendarInProgress = true;
    try {
      await this._doAddEventToCalendar(eventId);
    } finally {
      this._calendarInProgress = false;
    }
  },

  async _doAddEventToCalendar(eventId) {
    var event = ApiService.getEvents().find(function (ev) { return ev.id === eventId; });
    if (!event) { this.showToast('找不到活動資料'); return; }

    var parsed = this._parseEventDateRange(event.date);
    if (!parsed) { this.showToast('無法解析活動時間'); return; }

    var choice = await this._showCalendarActionSheet();
    if (choice === 'cancel') return;

    var calEvent = {
      title: event.title || '',
      location: event.location || '',
      description: this._buildCalendarDescription(event),
      start: parsed.start,
      end: parsed.end,
    };

    if (choice === 'ics') {
      this._downloadIcsFile(calEvent);
    } else if (choice === 'google') {
      this._openGoogleCalendar(calEvent);
    } else if (choice === 'outlook') {
      this._openOutlookCalendar(calEvent);
    }
  },

  // ══════════════════════════════════
  //  Date Parsing
  // ══════════════════════════════════

  /** 解析活動日期格式 "YYYY/MM/DD HH:MM~HH:MM" → { start: Date, end: Date } */
  _parseEventDateRange(dateStr) {
    if (!dateStr) return null;
    // 格式: "2026/03/22 14:00~16:00" 或 "2026/03/22 14:00"
    var m = String(dateStr).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~～\-]\s*(\d{1,2}):(\d{2}))?/);
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
      // 無結束時間預設 2 小時
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
  //  Action Sheet
  // ══════════════════════════════════

  _showCalendarActionSheet() {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'share-action-sheet';

      var buttons =
        '<button class="share-action-sheet-btn" data-choice="ics">' +
          '<span class="share-action-sheet-btn-icon">\uD83D\uDCC5</span>' +
          '<span class="share-action-sheet-btn-label">Apple / Outlook' +
            '<span class="share-action-sheet-btn-sub">\u4E0B\u8F09 .ics \u6A94\u30FB\u542B\u63D0\u9192</span>' +
          '</span>' +
        '</button>' +
        '<button class="share-action-sheet-btn" data-choice="google">' +
          '<span class="share-action-sheet-btn-icon">\uD83D\uDFE2</span>' +
          '<span class="share-action-sheet-btn-label">Google \u65E5\u66C6' +
            '<span class="share-action-sheet-btn-sub">\u958B\u555F\u7DB2\u9801\u65E5\u66C6</span>' +
          '</span>' +
        '</button>' +
        '<button class="share-action-sheet-btn" data-choice="outlook">' +
          '<span class="share-action-sheet-btn-icon">\uD83D\uDD35</span>' +
          '<span class="share-action-sheet-btn-label">Outlook.com' +
            '<span class="share-action-sheet-btn-sub">\u958B\u555F\u7DB2\u9801\u884C\u4E8B\u66C6</span>' +
          '</span>' +
        '</button>';

      var panel = document.createElement('div');
      panel.className = 'share-action-sheet-panel';
      panel.innerHTML =
        '<div class="share-action-sheet-title">\u52A0\u5165\u884C\u4E8B\u66C6</div>' +
        '<div class="share-action-sheet-grid">' + buttons + '</div>' +
        '<button class="share-action-sheet-cancel" data-choice="cancel">\u53D6\u6D88</button>';

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      requestAnimationFrame(function () {
        overlay.classList.add('active');
      });

      var resolved = false;
      function cleanup(choice) {
        if (resolved) return;
        resolved = true;
        overlay.classList.remove('active');
        overlay.addEventListener('transitionend', function handler() {
          overlay.removeEventListener('transitionend', handler);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 400);
        resolve(choice);
      }

      panel.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-choice]');
        if (btn) cleanup(btn.dataset.choice);
      });
      overlay.addEventListener('click', function (ev) {
        if (ev.target === overlay) cleanup('cancel');
      });
    });
  },

  // ══════════════════════════════════
  //  .ics File (iCalendar RFC 5545)
  // ══════════════════════════════════

  _toIcsDateStr(d) {
    // 轉為本地時間格式 YYYYMMDDTHHMMSS（不帶 Z，搭配 TZID 使用）
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) + 'T' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds());
  },

  _foldIcsLine(line) {
    // RFC 5545: 每行最多 75 octets，超過須折行（CRLF + 空格）
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

  _downloadIcsFile(calEvent) {
    var uid = 'sporthub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '@toosterx.com';
    var now = this._toIcsDateStr(new Date());
    var tzid = 'Asia/Taipei';

    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SportHub//Event//ZH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      // 時區定義
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
      // 提醒：活動前 1 天
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      this._foldIcsLine('DESCRIPTION:' + this._escapeIcsText(calEvent.title) + ' \u660E\u5929\u958B\u59CB'),
      'END:VALARM',
      // 提醒：活動前 30 分鐘
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      this._foldIcsLine('DESCRIPTION:' + this._escapeIcsText(calEvent.title) + ' \u5373\u5C07\u958B\u59CB'),
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    var icsContent = lines.join('\r\n');
    var blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = (calEvent.title || 'event').replace(/[^\w\u4e00-\u9fff]/g, '_').slice(0, 30) + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    this.showToast('\u5DF2\u4E0B\u8F09\u884C\u4E8B\u66C6\u6A94\u6848\uFF08\u542B\u63D0\u9192\uFF09');
  },

  // ══════════════════════════════════
  //  Google Calendar URL
  // ══════════════════════════════════

  _toUtcDateStr(d) {
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) + 'Z';
  },

  _openGoogleCalendar(calEvent) {
    var dates = this._toUtcDateStr(calEvent.start) + '/' + this._toUtcDateStr(calEvent.end);
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: calEvent.title,
      dates: dates,
      location: calEvent.location,
      details: calEvent.description,
    });
    window.open('https://calendar.google.com/calendar/render?' + params.toString(), '_blank');
  },

  // ══════════════════════════════════
  //  Outlook.com URL
  // ══════════════════════════════════

  _openOutlookCalendar(calEvent) {
    var fmt = function (d) { return d.toISOString().replace(/\.\d{3}Z$/, '+00:00'); };
    var params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: calEvent.title,
      startdt: fmt(calEvent.start),
      enddt: fmt(calEvent.end),
      location: calEvent.location,
      body: calEvent.description,
    });
    window.open('https://outlook.live.com/calendar/0/deeplink/compose?' + params.toString(), '_blank');
  },

});
