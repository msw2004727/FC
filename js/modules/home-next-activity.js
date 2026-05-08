/* ================================================
   ToosterX - Home Next Activity
   Shows the current user's nearest registered activity without blocking home paint.
   ================================================ */

(function(root) {
  const app = (typeof App !== 'undefined') ? App : root.App;
  if (!app) return; root.App = app;

  const FALLBACK_IMAGE = 'LOGO/Nocoverimage%20set.png';
  const CACHE_TTL_MS = 45 * 1000;
  const REGISTRATION_QUERY_LIMIT = 120;
  const TERMINAL_EVENT_STATUSES = new Set(['ended', 'cancelled', 'canceled', 'archived', 'removed']);
  const TERMINAL_REGISTRATION_STATUSES = new Set(['cancelled', 'canceled', 'removed', 'deleted', 'rejected', 'withdrawn']);
  const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

  function esc(value) {
    if (typeof escapeHTML === 'function') return escapeHTML(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function services() {
    return {
      api: (typeof ApiService !== 'undefined') ? ApiService : root.ApiService,
      firebase: (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService,
      scriptLoader: (typeof ScriptLoader !== 'undefined') ? ScriptLoader : root.ScriptLoader,
      lineAuth: (typeof LineAuth !== 'undefined') ? LineAuth : root.LineAuth,
    };
  }

  function currentUid() {
    const { api, firebase } = services();
    const user = api?.getCurrentUser?.() || firebase?._cache?.currentUser || null;
    let authUid = '';
    try {
      if (typeof auth !== 'undefined' && auth?.currentUser?.uid) authUid = auth.currentUser.uid;
    } catch (_) {}
    return String(authUid || user?.uid || user?.lineUserId || '').trim();
  }

  function toMillis(value) {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value.toMillis === 'function') {
      try { return value.toMillis(); } catch (_) { return 0; }
    }
    if (typeof value.toDate === 'function') {
      try {
        const d = value.toDate();
        return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      } catch (_) {
        return 0;
      }
    }
    if (typeof value === 'object' && typeof (value.seconds || value._seconds) === 'number') {
      return ((value.seconds || value._seconds) * 1000) + Math.floor(((value.nanoseconds || value._nanoseconds || 0) / 1000000));
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseEventDateRange(dateValue) {
    if (!dateValue) return null;
    if (typeof dateValue !== 'string') {
      const ms = toMillis(dateValue);
      return ms ? { startMs: ms, endMs: ms + 2 * 60 * 60 * 1000 } : null;
    }
    const raw = dateValue.trim();
    const m = raw.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~\uFF5E\-]\s*(\d{1,2}):(\d{2}))?/);
    if (!m) {
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? { startMs: parsed, endMs: parsed + 2 * 60 * 60 * 1000 } : null;
    }
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    const startHour = Number(m[4]);
    const startMinute = Number(m[5]);
    const endHour = m[6] ? Number(m[6]) : startHour + 2;
    const endMinute = m[7] ? Number(m[7]) : startMinute;
    const start = new Date(year, month, day, startHour, startMinute, 0);
    const end = new Date(year, month, day, endHour, endMinute, 0);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  function eventStartMs(event) {
    const range = parseEventDateRange(event?.date || event?.startAt || event?.startTime);
    return range?.startMs || 0;
  }

  function isActiveRegistration(record, uid) {
    if (!record) return false;
    const recordUid = String(record.userId || record.uid || '').trim();
    if (uid && recordUid && recordUid !== uid) return false;
    const status = String(record.status || '').trim().toLowerCase();
    return !TERMINAL_REGISTRATION_STATUSES.has(status);
  }

  function isUpcomingEvent(event, nowMs = Date.now()) {
    if (!event || !(event.id || event._docId || event.docId)) return false;
    const status = String(event.status || '').trim().toLowerCase();
    if (TERMINAL_EVENT_STATUSES.has(status)) return false;
    const startMs = eventStartMs(event);
    return startMs > nowMs;
  }

  function eventCacheList() {
    const { firebase, api } = services();
    if (Array.isArray(firebase?._cache?.events)) return firebase._cache.events;
    if (typeof api?.getEvents === 'function') return api.getEvents() || [];
    return [];
  }

  function findCachedEvent(eventId) {
    const id = String(eventId || '').trim();
    if (!id) return null;
    const { api } = services();
    const direct = api?.getEvent?.(id);
    if (direct) return direct;
    return eventCacheList().find(event => {
      return String(event?.id || '').trim() === id
        || String(event?._docId || '').trim() === id
        || String(event?.docId || '').trim() === id;
    }) || null;
  }

  function upsertEventCache(event) {
    const { firebase } = services();
    if (!event || !firebase?._cache) return event;
    if (!Array.isArray(firebase._cache.events)) firebase._cache.events = [];
    const id = String(event.id || '').trim();
    const docId = String(event._docId || event.docId || '').trim();
    const index = firebase._cache.events.findIndex(item => {
      return (id && String(item?.id || '').trim() === id)
        || (docId && String(item?._docId || item?.docId || '').trim() === docId);
    });
    if (index >= 0) firebase._cache.events[index] = { ...firebase._cache.events[index], ...event };
    else firebase._cache.events.push(event);
    return index >= 0 ? firebase._cache.events[index] : event;
  }

  async function fetchEventByPublicId(eventId) {
    const cached = findCachedEvent(eventId);
    if (cached) return cached;
    const { firebase } = services();
    if (!eventId || typeof db === 'undefined' || !firebase?._getEventDocIdAsync) return null;
    const docId = await firebase._getEventDocIdAsync(eventId);
    if (!docId) return null;
    const snap = await db.collection('events').doc(docId).get();
    if (!snap.exists) return null;
    return upsertEventCache({ ...snap.data(), _docId: snap.id });
  }

  function cachedRegistrationsForUid(uid) {
    const { api, firebase } = services();
    if (typeof api?.getRegistrations === 'function') {
      return api.getRegistrations({ userId: uid, includeTerminal: true }) || [];
    }
    return (Array.isArray(firebase?._cache?.registrations) ? firebase._cache.registrations : [])
      .filter(record => String(record?.userId || record?.uid || '').trim() === uid);
  }

  async function fetchRegistrationsForUid(uid) {
    const { firebase } = services();
    const cached = cachedRegistrationsForUid(uid);
    if (typeof db === 'undefined' || !uid) return cached;
    try {
      const snap = await db.collectionGroup('registrations')
        .where('userId', '==', uid)
        .limit(REGISTRATION_QUERY_LIMIT)
        .get();
      const rows = snap.docs.map(doc => {
        if (firebase?._mapSubcollectionDoc) return firebase._mapSubcollectionDoc(doc, 'registrations');
        return { ...doc.data(), _docId: doc.id, userId: doc.data()?.userId || doc.data()?.uid || uid };
      });
      rows.forEach(record => {
        if (firebase?._upsertCanonicalCacheRecord) {
          firebase._upsertCanonicalCacheRecord('registrations', record, { requireSubcollection: false });
        }
      });
      return rows.length ? rows : cached;
    } catch (err) {
      console.warn('[HomeNextActivity] registration query skipped:', err);
      return cached;
    }
  }

  function pickNextActivity(registrations, events, uid, nowMs = Date.now()) {
    const eventMap = new Map();
    (Array.isArray(events) ? events : []).forEach(event => {
      if (!event) return;
      [event.id, event._docId, event.docId].forEach(id => {
        const key = String(id || '').trim();
        if (key && !eventMap.has(key)) eventMap.set(key, event);
      });
    });
    return (Array.isArray(registrations) ? registrations : [])
      .filter(record => isActiveRegistration(record, uid))
      .map(record => eventMap.get(String(record.eventId || '').trim()))
      .filter(event => isUpcomingEvent(event, nowMs))
      .sort((a, b) => eventStartMs(a) - eventStartMs(b))[0] || null;
  }

  async function resolveNextActivity(uid) {
    const registrations = await fetchRegistrationsForUid(uid);
    const activeRegistrations = registrations.filter(record => isActiveRegistration(record, uid));
    const eventIds = Array.from(new Set(activeRegistrations
      .map(record => String(record.eventId || '').trim())
      .filter(Boolean)));

    const cachedEvents = eventIds.map(findCachedEvent).filter(Boolean);
    let next = pickNextActivity(activeRegistrations, cachedEvents, uid);
    if (next) return next;

    const fetchedEvents = await Promise.all(eventIds.map(id => fetchEventByPublicId(id).catch(err => {
      console.warn('[HomeNextActivity] event fetch skipped:', id, err);
      return null;
    })));
    next = pickNextActivity(activeRegistrations, fetchedEvents.filter(Boolean), uid);
    return next;
  }

  function pad2(num) {
    return String(num).padStart(2, '0');
  }

  function formatDateRange(event) {
    const range = parseEventDateRange(event?.date || event?.startAt || event?.startTime);
    if (!range?.startMs) return String(event?.date || '');
    const start = new Date(range.startMs);
    const end = new Date(range.endMs || (range.startMs + 2 * 60 * 60 * 1000));
    const datePart = `${pad2(start.getMonth() + 1)}/${pad2(start.getDate())} (${DAY_NAMES[start.getDay()]})`;
    const startTime = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
    const endTime = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
    return `${datePart} ${startTime} - ${endTime}`;
  }

  function iconSvg(name) {
    if (name === 'location') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
    }
    if (name === 'search') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
    }
    if (name === 'plus') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>';
  }

  function emptyIllustration() {
    return `
      <div class="home-next-empty-illustration" aria-hidden="true">
        <div class="home-next-calendar-art">
          <span></span><span></span><span></span><span></span>
          <strong>+</strong>
        </div>
        <div class="home-next-ball-art"></div>
      </div>`;
  }

  function cardShell(bodyHtml) {
    return `
      <div class="home-next-card">
        <div class="home-next-head">
          <h3>我的下一場活動</h3>
          <button class="home-next-view-all" type="button" data-home-next-action="all">查看全部
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
        ${bodyHtml}
      </div>`;
  }

  function renderLoading(host) {
    host.innerHTML = cardShell(`
      <div class="home-next-loading">
        <div class="home-next-loading-img skeleton"></div>
        <div class="home-next-loading-lines">
          <span class="skeleton"></span>
          <span class="skeleton"></span>
          <span class="skeleton short"></span>
        </div>
      </div>`);
    bindActions(host, null);
  }

  function renderEmpty(host) {
    host.innerHTML = cardShell(`
      <div class="home-next-empty">
        ${emptyIllustration()}
        <div class="home-next-empty-title">你目前還沒有報名活動</div>
        <div class="home-next-empty-sub">找一場活動，或建立你的第一場活動</div>
        <div class="home-next-empty-actions">
          <button class="home-next-primary" type="button" data-home-next-action="find">${iconSvg('search')}<span>找活動</span></button>
          <button class="home-next-outline" type="button" data-home-next-action="create">${iconSvg('plus')}<span>我要開團</span></button>
        </div>
      </div>`);
    bindActions(host, null);
  }

  function renderActivity(host, event) {
    const title = event?.title || '未命名活動';
    const location = event?.location || '地點待補';
    const image = event?.image || FALLBACK_IMAGE;
    host.innerHTML = cardShell(`
      <div class="home-next-event">
        <button class="home-next-cover" type="button" data-home-next-action="detail" aria-label="查看活動">
          <img src="${esc(image)}" alt="${esc(title)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
        </button>
        <div class="home-next-event-main">
          <h4>${esc(title)}</h4>
          <div class="home-next-meta-row">
            <span class="home-next-meta">${iconSvg('calendar')}<span>${esc(formatDateRange(event))}</span></span>
            <span class="home-next-meta">${iconSvg('location')}<span>${esc(location)}</span></span>
          </div>
          <div class="home-next-event-actions">
            <button class="home-next-primary" type="button" data-home-next-action="detail">查看活動</button>
            <button class="home-next-outline" type="button" data-home-next-action="calendar">${iconSvg('calendar')}<span>加入行事曆</span></button>
          </div>
        </div>
      </div>`);
    bindActions(host, event);
  }

  function bindActions(host, event) {
    host.querySelector('[data-home-next-action="all"]')?.addEventListener('click', () => app.openHomeNextActivityAll?.());
    host.querySelector('[data-home-next-action="find"]')?.addEventListener('click', () => app.showPage?.('page-activities'));
    host.querySelector('[data-home-next-action="create"]')?.addEventListener('click', () => app.openHomeCreateEvent?.());
    host.querySelectorAll('[data-home-next-action="detail"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (event?.id) app.openHomeNextActivityDetail?.(event.id);
      });
    });
    host.querySelector('[data-home-next-action="calendar"]')?.addEventListener('click', () => {
      if (event?.id) app.openHomeNextActivityCalendar?.(event.id);
    });
  }

  Object.assign(app, {
    _homeNextActivityRequestSeq: 0,
    _homeNextActivityCache: null,

    async renderHomeNextActivity(options = {}) {
      const host = document.getElementById('home-next-activity');
      if (!host) return;
      const uid = currentUid();
      const now = Date.now();
      if (!uid) {
        this._homeNextActivityCache = null;
        renderEmpty(host);
        return;
      }

      const cached = this._homeNextActivityCache;
      if (!options.force && cached?.uid === uid && now - cached.loadedAt < CACHE_TTL_MS) {
        if (cached.event) renderActivity(host, cached.event);
        else renderEmpty(host);
        return;
      }

      const seq = ++this._homeNextActivityRequestSeq;
      if (!options.silent) renderLoading(host);
      try {
        const event = await resolveNextActivity(uid);
        if (seq !== this._homeNextActivityRequestSeq) return;
        this._homeNextActivityCache = { uid, loadedAt: Date.now(), event: event || null };
        if (event) renderActivity(host, event);
        else renderEmpty(host);
      } catch (err) {
        console.warn('[HomeNextActivity] render failed:', err);
        if (seq !== this._homeNextActivityRequestSeq) return;
        this._homeNextActivityCache = { uid, loadedAt: Date.now(), event: null };
        renderEmpty(host);
      }
    },

    async openHomeNextActivityDetail(eventId) {
      const safeEventId = String(eventId || '').trim();
      if (!safeEventId) return;
      const event = findCachedEvent(safeEventId);
      if (event?.type === 'external' && event.externalUrl && typeof this.showExternalTransitCard === 'function') {
        this.showExternalTransitCard(event);
        return;
      }
      await services().scriptLoader?.ensureForPage?.('page-activity-detail');
      if (typeof this.showEventDetail === 'function') {
        await this.showEventDetail(safeEventId);
      } else {
        this.showToast?.('活動資料載入中，請稍後再試');
      }
    },

    async openHomeNextActivityCalendar(eventId) {
      const safeEventId = String(eventId || '').trim();
      if (!safeEventId) return;
      await fetchEventByPublicId(safeEventId).catch(() => null);
      await services().scriptLoader?.ensureGroup?.('activity');
      if (typeof this.addEventToCalendar === 'function') {
        this.addEventToCalendar(safeEventId);
      } else {
        this.showToast?.('行事曆功能載入中，請稍後再試');
      }
    },

    openHomeNextActivityAll() {
      if (!currentUid() && this._requestLoginForAction) {
        this._requestLoginForAction({ type: 'showPage', pageId: 'page-profile' });
        return;
      }
      this.showPage?.('page-profile');
    },
  });

  root.HomeNextActivityUtils = {
    parseEventDateRange,
    eventStartMs,
    isActiveRegistration,
    isUpcomingEvent,
    pickNextActivity,
    formatDateRange,
  };
})(typeof window !== 'undefined' ? window : globalThis);
