/* ================================================
   ToosterX - Home Next Activity
   Shows the current user's nearest registered activity without blocking home paint.
   ================================================ */

(function(root) {
  const app = (typeof App !== 'undefined') ? App : root.App;
  if (!app) return; root.App = app;

  const FALLBACK_IMAGE = 'LOGO/Nocoverimage%20set.png';
  const CACHE_REVALIDATE_MS = 10 * 60 * 1000;
  const CACHE_DISPLAY_MAX_MS = 60 * 60 * 1000;
  const CACHE_STORAGE_PREFIX = 'toosterx.homeNextActivity.v1.';
  const REGISTRATION_QUERY_LIMIT = 120;
  const EVENT_QUERY_LIMIT = 80;
  const TERMINAL_EVENT_STATUSES = new Set(['ended', 'cancelled', 'canceled', 'archived', 'removed']);
  const TERMINAL_REGISTRATION_STATUSES = new Set(['cancelled', 'canceled', 'removed', 'deleted', 'rejected', 'withdrawn']);
  const WAITLIST_REGISTRATION_STATUS = 'waitlisted';
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

  function normalizeString(value) {
    return String(value ?? '').trim();
  }

  function normalizeLower(value) {
    return normalizeString(value).toLowerCase();
  }

  function addIfPresent(set, value, transform = normalizeString) {
    const normalized = transform(value);
    if (normalized) set.add(normalized);
  }

  function currentUserIdentity() {
    const { api, firebase } = services();
    const user = api?.getCurrentUser?.() || firebase?._cache?.currentUser || null;
    let authUid = '';
    try {
      if (typeof auth !== 'undefined' && auth?.currentUser?.uid) authUid = auth.currentUser.uid;
    } catch (_) {}
    const uidSet = new Set();
    [authUid, user?.uid, user?.lineUserId, user?.id, user?.userId].forEach(value => addIfPresent(uidSet, value));
    const nameSet = new Set();
    [
      user?.displayName,
      user?.name,
      user?.nickname,
      user?.lineName,
      user?.profileName,
    ].forEach(value => addIfPresent(nameSet, value, normalizeLower));
    return {
      uid: normalizeString(authUid || user?.uid || user?.lineUserId || user?.id || user?.userId || ''),
      uidSet,
      nameSet,
      user,
    };
  }

  function identityFrom(value) {
    if (value?.uidSet instanceof Set) return value;
    const uid = normalizeString(value);
    return {
      uid,
      uidSet: new Set(uid ? [uid] : []),
      nameSet: new Set(),
      user: null,
    };
  }

  function currentUid() {
    return currentUserIdentity().uid;
  }

  function safeStorage() {
    try {
      return root.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function storageKey(uid) {
    const safeUid = normalizeString(uid);
    return safeUid ? `${CACHE_STORAGE_PREFIX}${safeUid}` : '';
  }

  function compactEvent(event) {
    if (!event) return null;
    return {
      id: normalizeString(event.id || event._docId || event.docId),
      _docId: normalizeString(event._docId || event.docId || event.id),
      docId: normalizeString(event.docId || event._docId || event.id),
      title: normalizeString(event.title),
      date: event.date || event.startAt || event.startTime || '',
      startAt: event.startAt || null,
      startTime: event.startTime || null,
      status: normalizeString(event.status),
      location: normalizeString(event.location),
      image: event.image || '',
      imageVariants: (event.imageVariants && typeof event.imageVariants === 'object')
        ? {
            cover: event.imageVariants.cover || '',
            homeNext: event.imageVariants.homeNext || '',
          }
        : null,
      type: normalizeString(event.type),
      externalUrl: event.externalUrl || '',
    };
  }

  function compactRegistration(registration) {
    if (!registration) return null;
    return {
      id: normalizeString(registration.id || registration._docId),
      _docId: normalizeString(registration._docId || registration.id),
      eventId: normalizeString(registration.eventId),
      userId: normalizeString(registration.userId || registration.uid || registration.ownerUid),
      uid: normalizeString(registration.uid),
      ownerUid: normalizeString(registration.ownerUid),
      status: normalizeString(registration.status),
      participantType: normalizeString(registration.participantType),
      managedRole: normalizeString(registration.managedRole),
    };
  }

  function compactNextActivity(next) {
    if (!next) return null;
    const event = compactEvent(next.event || next);
    if (!event?.id) return null;
    return {
      event,
      registration: compactRegistration(next.registration) || null,
      managedRole: normalizeString(next.managedRole || next.registration?.managedRole),
    };
  }

  function normalizeCacheRecord(record, uid, nowMs = Date.now()) {
    if (!record || typeof record !== 'object') return null;
    if (normalizeString(record.uid) !== normalizeString(uid)) return null;
    const loadedAt = Number(record.loadedAt || 0);
    if (!Number.isFinite(loadedAt) || loadedAt <= 0) return null;
    if (nowMs - loadedAt > CACHE_DISPLAY_MAX_MS) return null;
    const next = compactNextActivity(record.next);
    if (record.next && !next) return null;
    if (next && !isUpcomingEvent(next.event, nowMs)) return null;
    return { uid: normalizeString(uid), loadedAt, next };
  }

  function readStoredCache(uid, nowMs = Date.now()) {
    const storage = safeStorage();
    const key = storageKey(uid);
    if (!storage || !key) return null;
    try {
      return normalizeCacheRecord(JSON.parse(storage.getItem(key) || 'null'), uid, nowMs);
    } catch (_) {
      try { storage.removeItem(key); } catch (_) {}
      return null;
    }
  }

  function writeStoredCache(uid, next, loadedAt = Date.now()) {
    const storage = safeStorage();
    const key = storageKey(uid);
    if (!storage || !key) return;
    const record = { uid: normalizeString(uid), loadedAt, next: compactNextActivity(next) };
    try {
      storage.setItem(key, JSON.stringify(record));
    } catch (_) {}
  }

  function clearStoredCache(uid) {
    const storage = safeStorage();
    if (!storage) return;
    const targetKey = storageKey(uid);
    try {
      if (targetKey) {
        storage.removeItem(targetKey);
        return;
      }
      for (let i = storage.length - 1; i >= 0; i -= 1) {
        const key = storage.key(i);
        if (key && key.startsWith(CACHE_STORAGE_PREFIX)) storage.removeItem(key);
      }
    } catch (_) {}
  }

  function isFreshCache(record, nowMs = Date.now()) {
    return !!record && nowMs - Number(record.loadedAt || 0) < CACHE_REVALIDATE_MS;
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
    const identity = identityFrom(uid);
    const recordUid = normalizeString(record.userId || record.uid || record.ownerUid);
    if (recordUid && identity.uidSet.size && !identity.uidSet.has(recordUid)) return false;
    const status = String(record.status || '').trim().toLowerCase();
    return !TERMINAL_REGISTRATION_STATUSES.has(status);
  }

  function registrationStatusMeta(record) {
    const managedRole = normalizeString(record?.managedRole).toLowerCase();
    if (managedRole === 'owner') {
      return { key: 'owner', label: '\u4e3b\u8fa6' };
    }
    if (managedRole === 'delegate') {
      return { key: 'delegate', label: '\u59d4\u8a17' };
    }
    const status = String(record?.status || '').trim().toLowerCase();
    if (status === WAITLIST_REGISTRATION_STATUS) {
      return { key: 'waitlisted', label: '候補' };
    }
    return { key: 'confirmed', label: '正取' };
  }

  function registrationDisplayPriority(record) {
    const participantType = String(record?.participantType || 'self').trim().toLowerCase();
    return !participantType || participantType === 'self' ? 0 : 1;
  }

  function eventIdentityKey(event) {
    const id = normalizeString(event?.id || event?._docId || event?.docId);
    if (id) return `id:${id}`;
    const title = normalizeString(event?.title);
    const date = normalizeString(event?.date || event?.startAt || event?.startTime);
    return title || date ? `event:${title}|${date}` : '';
  }

  function eventOwnerIds(event) {
    return [
      event?.creatorUid,
      event?.ownerUid,
      event?.createdByUid,
      event?.creatorId,
      event?.ownerId,
      event?.organizerUid,
    ].map(normalizeString).filter(Boolean);
  }

  function isEventOwnerForIdentity(event, identityValue) {
    const identity = identityFrom(identityValue);
    if (!event || !identity.uidSet.size) return false;
    const ownerIds = eventOwnerIds(event);
    if (ownerIds.some(uid => identity.uidSet.has(uid))) return true;
    if (ownerIds.length > 0 || !identity.nameSet.size) return false;
    return [
      event.creator,
      event.creatorName,
      event.ownerName,
      event.organizer,
      event.organizerDisplay,
    ].map(normalizeLower).filter(Boolean).some(name => identity.nameSet.has(name));
  }

  function isEventDelegateForIdentity(event, identityValue) {
    const identity = identityFrom(identityValue);
    if (!event || !identity.uidSet.size) return false;
    const delegateUids = Array.isArray(event.delegateUids) ? event.delegateUids.map(normalizeString).filter(Boolean) : [];
    if (delegateUids.some(uid => identity.uidSet.has(uid))) return true;
    const delegates = Array.isArray(event.delegates) ? event.delegates : [];
    return delegates.some(delegate => {
      const ids = [
        delegate?.uid,
        delegate?.userId,
        delegate?.lineUserId,
        delegate?.ownerUid,
      ].map(normalizeString).filter(Boolean);
      if (ids.some(uid => identity.uidSet.has(uid))) return true;
      if (!ids.length && identity.nameSet.size) {
        return [
          delegate?.name,
          delegate?.displayName,
          delegate?.lineName,
        ].map(normalizeLower).filter(Boolean).some(name => identity.nameSet.has(name));
      }
      return false;
    });
  }

  function managedRoleForEvent(event, identity) {
    if (isEventOwnerForIdentity(event, identity)) return 'owner';
    if (isEventDelegateForIdentity(event, identity)) return 'delegate';
    return '';
  }

  function candidatePriority(candidate) {
    const role = normalizeString(candidate?.managedRole || candidate?.registration?.managedRole).toLowerCase();
    if (role === 'owner') return 0;
    if (role === 'delegate') return 1;
    return 2 + registrationDisplayPriority(candidate?.registration);
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

  function mergeUniqueEvents(events) {
    const map = new Map();
    (Array.isArray(events) ? events : []).forEach(event => {
      if (!event) return;
      const key = eventIdentityKey(event);
      if (!key) return;
      map.set(key, { ...(map.get(key) || {}), ...event });
    });
    return Array.from(map.values());
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
    const identity = identityFrom(uid);
    const { api, firebase } = services();
    if (typeof api?.getRegistrations === 'function') {
      return (api.getRegistrations({ userId: identity.uid, includeTerminal: true }) || [])
        .filter(record => {
          const recordUid = normalizeString(record?.userId || record?.uid || record?.ownerUid);
          return !recordUid || identity.uidSet.has(recordUid);
        });
    }
    return (Array.isArray(firebase?._cache?.registrations) ? firebase._cache.registrations : [])
      .filter(record => {
        const recordUid = normalizeString(record?.userId || record?.uid || record?.ownerUid);
        return !recordUid || identity.uidSet.has(recordUid);
      });
  }

  async function fetchRegistrationsForUid(uid) {
    const identity = identityFrom(uid);
    const { firebase } = services();
    const cached = cachedRegistrationsForUid(identity);
    const queryUids = Array.from(identity.uidSet).filter(Boolean);
    if (typeof db === 'undefined' || !queryUids.length) return cached;
    try {
      const snaps = await Promise.all(queryUids.map(queryUid => db.collectionGroup('registrations')
        .where('userId', '==', queryUid)
        .limit(REGISTRATION_QUERY_LIMIT)
        .get()
        .catch(err => {
          console.warn('[HomeNextActivity] registration query skipped:', queryUid, err);
          return null;
        })));
      const rows = snaps.flatMap((snap, index) => {
        const fallbackUid = queryUids[index];
        return snap?.docs?.map(doc => {
          if (firebase?._mapSubcollectionDoc) return firebase._mapSubcollectionDoc(doc, 'registrations');
          return { ...doc.data(), _docId: doc.id, userId: doc.data()?.userId || doc.data()?.uid || fallbackUid };
        }) || [];
      });
      rows.forEach(record => {
        if (firebase?._upsertCanonicalCacheRecord) {
          firebase._upsertCanonicalCacheRecord('registrations', record, { requireSubcollection: false });
        }
      });
      const merged = new Map();
      [...cached, ...rows].forEach(record => {
        const key = normalizeString(record?._docId || record?.id || `${record?.eventId || ''}:${record?.userId || record?.uid || ''}:${record?.participantType || ''}`);
        if (key) merged.set(key, { ...(merged.get(key) || {}), ...record });
      });
      return merged.size ? Array.from(merged.values()) : cached;
    } catch (err) {
      console.warn('[HomeNextActivity] registration query skipped:', err);
      return cached;
    }
  }

  async function fetchManagedEventsForIdentity(identityValue) {
    const identity = identityFrom(identityValue);
    const cached = eventCacheList().filter(event => managedRoleForEvent(event, identity));
    const queryUids = Array.from(identity.uidSet).filter(Boolean);
    if (typeof db === 'undefined' || !queryUids.length) return cached;

    const queries = [];
    const seen = new Set();
    queryUids.forEach(uid => {
      [
        ['creatorUid', '==', uid],
        ['ownerUid', '==', uid],
        ['delegateUids', 'array-contains', uid],
      ].forEach(([field, operator, value]) => {
        const key = `${field}:${operator}:${value}`;
        if (seen.has(key)) return;
        seen.add(key);
        queries.push({ field, operator, value });
      });
    });

    const fetched = [];
    await Promise.all(queries.map(query => db.collection('events')
      .where(query.field, query.operator, query.value)
      .limit(EVENT_QUERY_LIMIT)
      .get()
      .then(snap => {
        snap.docs.forEach(doc => {
          const event = upsertEventCache({ ...doc.data(), _docId: doc.id });
          if (managedRoleForEvent(event, identity)) fetched.push(event);
        });
      })
      .catch(err => {
        console.warn('[HomeNextActivity] managed event query skipped:', query.field, err);
      })));

    return mergeUniqueEvents([...cached, ...fetched]).filter(event => managedRoleForEvent(event, identity));
  }

  function pickNextActivityCandidate(registrations, events, uid, nowMs = Date.now()) {
    const identity = identityFrom(uid);
    const eventMap = new Map();
    (Array.isArray(events) ? events : []).forEach(event => {
      if (!event) return;
      [event.id, event._docId, event.docId].forEach(id => {
        const key = String(id || '').trim();
        if (key && !eventMap.has(key)) eventMap.set(key, event);
      });
    });
    const candidates = [];
    const byEvent = new Map();
    const pushCandidate = candidate => {
      if (!candidate?.event || !isUpcomingEvent(candidate.event, nowMs)) return;
      const key = eventIdentityKey(candidate.event);
      if (!key) {
        candidates.push(candidate);
        return;
      }
      const existingIndex = byEvent.get(key);
      if (existingIndex == null) {
        byEvent.set(key, candidates.length);
        candidates.push(candidate);
        return;
      }
      if (candidatePriority(candidate) < candidatePriority(candidates[existingIndex])) {
        candidates[existingIndex] = candidate;
      }
    };

    (Array.isArray(registrations) ? registrations : [])
      .filter(record => isActiveRegistration(record, identity))
      .map(record => ({ event: eventMap.get(String(record.eventId || '').trim()), registration: record }))
      .forEach(pushCandidate);

    (Array.isArray(events) ? events : []).forEach(event => {
      const managedRole = managedRoleForEvent(event, identity);
      if (!managedRole) return;
      pushCandidate({ event, registration: { managedRole }, managedRole });
    });

    return candidates
      .sort((a, b) => {
        const byStart = eventStartMs(a.event) - eventStartMs(b.event);
        return byStart || candidatePriority(a) - candidatePriority(b);
      })[0] || null;
  }

  function pickNextActivity(registrations, events, uid, nowMs = Date.now()) {
    return pickNextActivityCandidate(registrations, events, uid, nowMs)?.event || null;
  }

  async function resolveNextActivity(uid) {
    const identity = currentUserIdentity();
    addIfPresent(identity.uidSet, uid);
    if (!identity.uid) identity.uid = normalizeString(uid);

    const registrations = await fetchRegistrationsForUid(identity);
    const activeRegistrations = registrations.filter(record => isActiveRegistration(record, identity));
    const eventIds = Array.from(new Set(activeRegistrations
      .map(record => String(record.eventId || '').trim())
      .filter(Boolean)));

    const cachedEvents = eventIds.map(findCachedEvent).filter(Boolean);
    const cachedEventKeys = new Set(cachedEvents.flatMap(event => [
      normalizeString(event?.id),
      normalizeString(event?._docId),
      normalizeString(event?.docId),
    ].filter(Boolean)));
    const missingEventIds = eventIds.filter(id => !cachedEventKeys.has(id));
    const [fetchedEvents, managedEvents] = await Promise.all([
      Promise.all(missingEventIds.map(id => fetchEventByPublicId(id).catch(err => {
        console.warn('[HomeNextActivity] event fetch skipped:', id, err);
        return null;
      }))),
      fetchManagedEventsForIdentity(identity),
    ]);
    return pickNextActivityCandidate(
      activeRegistrations,
      mergeUniqueEvents([...cachedEvents, ...fetchedEvents.filter(Boolean), ...managedEvents]),
      identity
    );
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

  function renderActivity(host, nextActivity) {
    const event = nextActivity?.event || nextActivity;
    const registration = nextActivity?.registration || null;
    const statusMeta = registrationStatusMeta(registration);
    const title = event?.title || '未命名活動';
    const location = event?.location || '地點待補';
    const image = app._getEventImageUrl?.(event, 'homeNext') || event?.image || FALLBACK_IMAGE;
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
            <span class="home-next-status-pill home-next-status-${statusMeta.key}">${esc(statusMeta.label)}</span>
          </div>
        </div>
        <div class="home-next-event-actions">
          <button class="home-next-primary" type="button" data-home-next-action="detail">查看活動</button>
          <button class="home-next-outline" type="button" data-home-next-action="calendar"><span>加入行事曆</span></button>
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

  function renderCacheRecord(host, record) {
    if (record?.next) renderActivity(host, record.next);
    else renderEmpty(host);
  }

  function setHomeNextCache(appRef, uid, next) {
    const record = {
      uid: normalizeString(uid),
      loadedAt: Date.now(),
      next: compactNextActivity(next),
    };
    appRef._homeNextActivityCache = record;
    writeStoredCache(uid, record.next, record.loadedAt);
    return record;
  }

  async function refreshHomeNextActivity(appRef, host, uid, options = {}) {
    const seq = ++appRef._homeNextActivityRequestSeq;
    if (options.showLoading) renderLoading(host);
    try {
      const next = await resolveNextActivity(uid);
      if (seq !== appRef._homeNextActivityRequestSeq) return null;
      const record = setHomeNextCache(appRef, uid, next || null);
      renderCacheRecord(host, record);
      return record;
    } catch (err) {
      console.warn('[HomeNextActivity] render failed:', err);
      if (seq !== appRef._homeNextActivityRequestSeq) return null;
      appRef._homeNextActivityCache = null;
      renderEmpty(host);
      return null;
    }
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
        const { lineAuth } = services();
        if (lineAuth?.isLoggedIn?.()) {
          if (!options.silent && !host.innerHTML) renderLoading(host);
          return;
        }
        renderEmpty(host);
        return;
      }

      const memoryCache = normalizeCacheRecord(this._homeNextActivityCache, uid, now);
      const storedCache = memoryCache || readStoredCache(uid, now);
      if (storedCache) {
        this._homeNextActivityCache = storedCache;
        renderCacheRecord(host, storedCache);
        if (isFreshCache(storedCache, now)) return;
        void refreshHomeNextActivity(this, host, uid, { showLoading: false });
        return;
      }

      return refreshHomeNextActivity(this, host, uid, { showLoading: !options.silent });
    },

    invalidateHomeNextActivityCache(uid) {
      const identity = currentUserIdentity();
      const targets = new Set(Array.from(identity.uidSet || []).filter(Boolean));
      addIfPresent(targets, uid);
      this._homeNextActivityRequestSeq += 1;
      this._homeNextActivityCache = null;
      if (targets.size) {
        targets.forEach(targetUid => clearStoredCache(targetUid));
      } else {
        clearStoredCache('');
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
      this.showPage?.('page-activities');
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
