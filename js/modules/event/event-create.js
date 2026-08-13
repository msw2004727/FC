/* ================================================
   SportHub — Event: Create & Edit (Main Flow)
   依賴：event-list.js (helpers)
   拆分模組：event-create-input-history / sport-picker / delegates / options / team-picker / external
              event-create-template / event-create-waitlist
   innerHTML uses escapeHTML() for all user-supplied values
   ================================================ */

Object.assign(App, {

  //  Create Event
  // ══════════════════════════════════

  _editEventId: null,
  _eventSubmitInFlight: false,
  _eventFormGeneration: 0,
  _eventFormSession: null,
  _eventSubmitToken: null,
  _eventSubmitContext: null,
  _eventFormSessionObserver: null,
  _eventFormSessionObserverModal: null,
  _eventFormSessionBoundModal: null,
  _eventImageVariantsData: null,
  _pendingSingleEventSubmission: null,
  _pendingMultiDateSubmission: null,
  _defaultEventCoverAssetPath: 'LOGO/Nocoverimage set.png',
  _eventCreateDelegateTimeoutMs: 12000,
  _eventCreateWriteTimeoutMs: 30000,
  _eventCreateReconcileTimeoutMs: 8000,
  _eventCreatePendingCoordinatorTimeoutMs: 3000,
  _eventCreatePendingWebLockTimeoutMs: 3000,
  _eventCreatePendingStoragePrefix: 'sportshub:event-create-pending:',
  _eventCreatePendingLockPrefix: 'sportshub:event-create-lock:',
  _eventCreatePendingDbName: 'sportshub-event-create',
  _eventCreatePendingDbStore: 'pendingIntents',
  _eventCreatePendingMaxSerializedChars: 4 * 1024 * 1024,
  _eventCreatePendingMaxAttempts: 50,
  _eventCreateAttemptSequence: 0,
  _eventCreateNormalizedMarkers: null,
  _courseLinkedEditLockedControlSelector: 'input, select, textarea, button',
  _courseLinkedEditUnlockedIds: ['ce-private-event', 'ce-submit-btn'],
  _courseLinkedEditLockedIds: [
    'ce-template-selector',
    'ce-image',
    'ce-upload-preview',
    'ce-title',
    'ce-type',
    'ce-region-enabled',
    'ce-region-radios',
    'ce-region-cities',
    'ce-location',
    'ce-location-btn',
    'ce-location-clear',
    'ce-date',
    'ce-time-start',
    'ce-time-end',
    'ce-reg-open-enabled',
    'ce-reg-open-date',
    'ce-reg-open-clock',
    'ce-reg-rel-days',
    'ce-reg-rel-hours',
    'ce-fee-enabled',
    'ce-fee',
    'ce-team-only',
    'ce-team-select',
    'ce-team-picker',
    'ce-team-search',
    'ce-gender-restriction-enabled',
    'ce-gender-restriction-options',
    'ce-allowed-gender',
    'ce-team-split-enabled',
    'ce-team-split-options',
    'ce-social-links-enabled',
    'ce-social-links-options',
    'ce-early-bird-enabled',
    'ce-early-bird-options',
    'ce-gps-enabled',
    'ce-max',
    'ce-age-limit-enabled',
    'ce-min-age',
    'ce-delegate-search',
    'ce-delegate-tags',
    'ce-notes',
    'ce-sport-picker',
    'ce-sport-selected',
    'ce-sport-search',
    'ce-sport-list',
    'ce-template-name',
  ],

  _getEventFormAuthUid() {
    if (typeof auth !== 'undefined') return String(auth?.currentUser?.uid || '').trim();
    return String(ApiService.getCurrentUser?.()?.uid || '').trim();
  },

  _normalizeEventFormEditId(eventId) {
    const normalized = String(eventId || '').trim();
    return normalized || null;
  },

  _bindEventFormSessionLifecycle(modal) {
    if (!modal) return;
    if (this._eventFormSessionBoundModal !== modal) {
      modal.addEventListener?.('click', event => {
        const closeTrigger = event.target?.closest?.('[onclick*="App.closeModal"]');
        if (!closeTrigger || !modal.classList?.contains('open')) return;
        if (this._eventSubmitInFlight) {
          event.preventDefault?.();
          event.stopImmediatePropagation?.();
          this.showToast?.('資料儲存中，請稍候');
          return;
        }
        const activeSession = this._eventFormSession;
        if (activeSession?.modal === modal) this._invalidateEventFormSession(activeSession);
      }, true);
      this._eventFormSessionBoundModal = modal;
    }
    if (typeof MutationObserver === 'undefined' || this._eventFormSessionObserverModal === modal) return;
    this._eventFormSessionObserver?.disconnect?.();
    this._eventFormSessionObserver = new MutationObserver(() => {
      const activeSession = this._eventFormSession;
      if (activeSession?.modal === modal && !modal.classList?.contains('open')) {
        this._invalidateEventFormSession(activeSession);
      }
    });
    this._eventFormSessionObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
    this._eventFormSessionObserverModal = modal;
  },

  _beginEventFormSession(eventId = null) {
    const modal = document.getElementById('create-event-modal');
    const generation = Number(this._eventFormGeneration || 0) + 1;
    const session = {
      generation,
      editId: this._normalizeEventFormEditId(eventId),
      authUid: this._getEventFormAuthUid(),
      modal: modal || null,
    };
    this._eventFormGeneration = generation;
    this._eventFormSession = session;
    this._delegateSearchSeq = Number(this._delegateSearchSeq || 0) + 1;
    this._eventSubmitToken = null;
    this._eventSubmitContext = null;
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitting?.(false);
    this._bindEventFormSessionLifecycle(modal);
    return session;
  },

  _invalidateEventFormSession(expectedSession = null) {
    const activeSession = this._eventFormSession;
    if (expectedSession && activeSession?.generation !== expectedSession.generation) return false;
    this._eventFormGeneration = Number(this._eventFormGeneration || 0) + 1;
    this._eventFormSession = null;
    this._delegateSearchSeq = Number(this._delegateSearchSeq || 0) + 1;
    this._eventSubmitToken = null;
    this._eventSubmitContext = null;
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitting?.(false);
    return true;
  },

  _getEventCreateFixedDigest(value) {
    const input = String(value || '');
    const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      hashes[0] = Math.imul(hashes[0] ^ code, 0x01000193);
      hashes[1] = Math.imul(hashes[1] ^ code, 0x27d4eb2d);
      hashes[2] = Math.imul(hashes[2] ^ code, 0x165667b1);
      hashes[3] = Math.imul(hashes[3] ^ code, 0x9e3779b1);
    }
    return `v1-${hashes.map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('')}`;
  },

  _isValidEventCreateFixedDigest(value) {
    return /^v1-[0-9a-f]{32}$/.test(String(value || ''));
  },

  _getEventFormSubmitSignature() {
    const modal = document.getElementById('create-event-modal');
    const fields = typeof modal?.querySelectorAll === 'function'
      ? Array.from(modal.querySelectorAll('input, select, textarea')).map((field) => ({
        id: field.id || '',
        name: field.name || '',
        type: field.type || '',
        value: field.multiple
          ? Array.from(field.selectedOptions || []).map(option => String(option.value || ''))
          : (field.type === 'checkbox' || field.type === 'radio'
            ? !!field.checked
            : String(field.value || '')),
      }))
      : [];
    return this._getEventCreateFixedDigest(JSON.stringify({
      fields,
      multiDates: [...(this._multiDates || [])],
      delegateUids: (this._delegates || []).map(delegate => String(delegate?.uid || '').trim()),
      imageVariants: this._eventImageVariantsData || null,
    }));
  },

  _captureEventFormSubmitSession() {
    const modal = document.getElementById('create-event-modal');
    if (modal && !modal.classList?.contains('open')) return null;
    const editId = this._normalizeEventFormEditId(this._editEventId);
    const authUid = this._getEventFormAuthUid();
    const activeSession = this._eventFormSession;
    if (activeSession
      && activeSession.generation === this._eventFormGeneration
      && activeSession.editId === editId
      && activeSession.authUid === authUid
      && activeSession.modal === (modal || null)) {
      return activeSession;
    }
    return this._beginEventFormSession(editId);
  },

  _isEventFormSubmitSessionCurrent(session) {
    if (!session || this._eventFormSession !== session) return false;
    if (session.generation !== this._eventFormGeneration) return false;
    if (session.editId !== this._normalizeEventFormEditId(this._editEventId)) return false;
    if (session.authUid !== this._getEventFormAuthUid()) return false;
    const modal = document.getElementById('create-event-modal');
    if (session.modal !== (modal || null)) return false;
    return !modal || !!modal.classList?.contains('open');
  },

  _startEventFormSubmitSession(session) {
    if (!this._isEventFormSubmitSessionCurrent(session)) return null;
    const token = { generation: session.generation };
    this._eventSubmitToken = token;
    this._eventSubmitContext = session;
    this._eventSubmitInFlight = true;
    this._setCreateEventSubmitting?.(true);
    return token;
  },

  _stopEventFormSubmitSession(session, token) {
    if (!token || this._eventSubmitToken !== token) return false;
    if (this._eventFormSession !== session || session?.generation !== this._eventFormGeneration) return false;
    this._eventSubmitToken = null;
    this._eventSubmitContext = null;
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitting?.(false);
    return true;
  },

  _completeEventFormSubmitSession(session, token) {
    if (!token || this._eventSubmitToken !== token || !this._isEventFormSubmitSessionCurrent(session)) return 0;
    const completedGeneration = Number(this._eventFormGeneration || 0) + 1;
    this._eventFormGeneration = completedGeneration;
    this._eventFormSession = null;
    this._eventSubmitToken = null;
    this._eventSubmitContext = null;
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitting?.(false);
    if (this._normalizeEventFormEditId(this._editEventId) === session.editId) this._editEventId = null;
    return completedGeneration;
  },

  _isEventFormPostSaveGenerationCurrent(generation) {
    return Number(generation || 0) > 0
      && this._eventFormGeneration === generation
      && !this._eventFormSession;
  },

  _setCreateEventSubmitIdleLabel(label) {
    const submitBtn = document.getElementById('ce-submit-btn');
    if (!submitBtn) return;
    submitBtn.dataset.idleLabel = label;
    submitBtn.textContent = label;
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    submitBtn.style.cursor = '';
  },

  _getEventCreatePendingStorageKey(creatorUid = '') {
    const normalizedUid = String(creatorUid || this._getEventFormAuthUid() || '').trim();
    if (!normalizedUid) return '';
    return `${this._eventCreatePendingStoragePrefix}${encodeURIComponent(normalizedUid)}`;
  },

  _getEventCreatePendingLockName(creatorUid = '') {
    const normalizedUid = String(creatorUid || this._getEventFormAuthUid() || '').trim();
    if (!normalizedUid) return '';
    return `${this._eventCreatePendingLockPrefix}${encodeURIComponent(normalizedUid)}`;
  },

  _isPendingEventCreatePlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    return !!descriptor && typeof descriptor.value === 'function' && descriptor.value.name === 'Object';
  },

  _isPendingEventCreateSafeKey(key) {
    return typeof key === 'string'
      && key !== '__proto__'
      && key !== 'prototype'
      && key !== 'constructor'
      && key !== '__sportshubEventCreateDate'
      && key !== '__sportshubEventCreateBase64Ref';
  },

  _getPendingEventCreateOwnDataKeys(value) {
    if (!this._isPendingEventCreatePlainObject(value)) {
      throw new Error('EVENT_CREATE_PENDING_NON_PLAIN_OBJECT');
    }
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (!this._isPendingEventCreateSafeKey(key)) {
        throw new Error('EVENT_CREATE_PENDING_UNSAFE_KEY');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new Error('EVENT_CREATE_PENDING_UNSUPPORTED_PROPERTY');
      }
    }
    return keys;
  },

  _isPendingEventCreateDate(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Date]') return false;
    try {
      return Number.isFinite(Date.prototype.getTime.call(value));
    } catch (_) {
      return false;
    }
  },

  _isPendingEventCreateTimestamp(value) {
    if (!value || typeof value !== 'object' || typeof value.toDate !== 'function') return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype?.constructor?.name === 'Timestamp';
    } catch (_) {
      return false;
    }
  },

  _encodePendingEventCreateValue(value, seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new Error('EVENT_CREATE_PENDING_UNSAFE_NUMBER');
      }
      return value;
    }
    if (this._isPendingEventCreateDate(value)) {
      return { __sportshubEventCreateDate: Date.prototype.toISOString.call(value) };
    }
    if (this._isPendingEventCreateTimestamp(value)) {
      const converted = value.toDate();
      if (!this._isPendingEventCreateDate(converted)) {
        throw new Error('EVENT_CREATE_PENDING_INVALID_TIMESTAMP');
      }
      return { __sportshubEventCreateDate: Date.prototype.toISOString.call(converted) };
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new Error('EVENT_CREATE_PENDING_CIRCULAR_PAYLOAD');
      seen.add(value);
      const ownKeys = Reflect.ownKeys(value);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          seen.delete(value);
          throw new Error('EVENT_CREATE_PENDING_SPARSE_ARRAY');
        }
      }
      if (ownKeys.some(key => key !== 'length'
        && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
        seen.delete(value);
        throw new Error('EVENT_CREATE_PENDING_UNSUPPORTED_ARRAY_PROPERTY');
      }
      if (ownKeys.some(key => key !== 'length' && (() => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value');
      })())) {
        seen.delete(value);
        throw new Error('EVENT_CREATE_PENDING_UNSUPPORTED_ARRAY_PROPERTY');
      }
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        result.push(this._encodePendingEventCreateValue(value[index], seen));
      }
      seen.delete(value);
      return result;
    }
    if (typeof value === 'object') {
      if (seen.has(value)) throw new Error('EVENT_CREATE_PENDING_CIRCULAR_PAYLOAD');
      seen.add(value);
      const result = Object.create(null);
      const keys = this._getPendingEventCreateOwnDataKeys(value);
      keys.forEach(key => {
        result[key] = this._encodePendingEventCreateValue(value[key], seen);
      });
      seen.delete(value);
      return result;
    }
    throw new Error('EVENT_CREATE_PENDING_UNSUPPORTED_PAYLOAD');
  },

  _decodePendingEventCreateValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new Error('EVENT_CREATE_PENDING_UNSAFE_NUMBER');
      }
      return value;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error('EVENT_CREATE_PENDING_SPARSE_ARRAY');
        }
      }
      return value.map(item => this._decodePendingEventCreateValue(item));
    }
    if (!this._isPendingEventCreatePlainObject(value)) {
      throw new Error('EVENT_CREATE_PENDING_NON_PLAIN_OBJECT');
    }
    const wireKeys = Reflect.ownKeys(value);
    const wireDateDescriptor = wireKeys.length === 1 && wireKeys[0] === '__sportshubEventCreateDate'
      ? Object.getOwnPropertyDescriptor(value, '__sportshubEventCreateDate')
      : null;
    if (wireDateDescriptor?.enumerable
      && Object.prototype.hasOwnProperty.call(wireDateDescriptor, 'value')
      && typeof wireDateDescriptor.value === 'string') {
      const converted = new Date(value.__sportshubEventCreateDate);
      if (Number.isNaN(converted.getTime())) throw new Error('EVENT_CREATE_PENDING_INVALID_DATE');
      return converted;
    }
    const keys = this._getPendingEventCreateOwnDataKeys(value);
    const result = Object.create(null);
    keys.forEach(key => { result[key] = this._decodePendingEventCreateValue(value[key]); });
    return result;
  },

  _clonePendingEventCreateValue(value) {
    return this._decodePendingEventCreateValue(this._encodePendingEventCreateValue(value));
  },

  _canonicalizePendingEventCreateDigestValue(value) {
    if (Array.isArray(value)) {
      return value.map(item => this._canonicalizePendingEventCreateDigestValue(item));
    }
    if (!value || typeof value !== 'object') return value;
    const result = Object.create(null);
    Object.keys(value).sort().forEach(key => {
      result[key] = this._canonicalizePendingEventCreateDigestValue(value[key]);
    });
    return result;
  },

  _getPendingEventCreatePayloadDigest(kind, event, events, batchGroupId = '') {
    const payload = kind === 'multi'
      ? { kind, batchGroupId: String(batchGroupId || '').trim(), events }
      : { kind: 'single', event };
    const encoded = this._encodePendingEventCreateValue(payload);
    const canonical = this._canonicalizePendingEventCreateDigestValue(encoded);
    return this._getEventCreateFixedDigest(JSON.stringify(canonical));
  },

  _compactPendingEventCreateMarker(marker) {
    const normalized = this._normalizePendingEventCreateMarker(marker, marker?.creatorUid);
    if (!normalized) return normalized;
    const compactBase = { ...normalized };
    delete compactBase.eventEncoding;
    delete compactBase.sharedEvent;
    delete compactBase.imageEncoding;
    delete compactBase.imageFromCoverIndexes;
    const events = (normalized.kind === 'multi' ? normalized.events : [normalized.event])
      .map(event => this._clonePendingEventCreateValue(event));
    const imageFromCoverIndexes = [];
    events.forEach((event, index) => {
      const cover = event?.imageVariants?.cover;
      if (typeof cover === 'string' && cover
        && Object.prototype.hasOwnProperty.call(event, 'image')
        && event.image === cover) {
        delete event.image;
        imageFromCoverIndexes.push(index);
      }
    });
    const imageAlias = imageFromCoverIndexes.length > 0
      ? { imageEncoding: 'cover-alias-v1', imageFromCoverIndexes }
      : {};
    if (normalized.kind !== 'multi') {
      return { ...compactBase, ...imageAlias, event: events[0] };
    }
    const sharedEvent = Object.create(null);
    const identityKeys = new Set(['id', 'clientRequestId']);
    this._getPendingEventCreateOwnDataKeys(events[0]).forEach(key => {
      if (identityKeys.has(key)) return;
      if (!events.every(event => Object.prototype.hasOwnProperty.call(event, key))) return;
      const reference = JSON.stringify(this._encodePendingEventCreateValue(events[0][key]));
      if (!events.every(event => JSON.stringify(this._encodePendingEventCreateValue(event[key])) === reference)) return;
      sharedEvent[key] = events[0][key];
      events.forEach(event => { delete event[key]; });
    });
    return { ...compactBase, ...imageAlias, eventEncoding: 'shared-delta-v1', sharedEvent, events };
  },

  _expandPendingEventCreateMarker(marker) {
    if (!marker || (marker.kind !== 'single' && marker.kind !== 'multi')) return marker;
    let expandedMarker = { ...marker };
    if (marker.kind === 'multi') {
      const hasSharedEvent = Object.prototype.hasOwnProperty.call(marker, 'sharedEvent');
      const hasEncoding = Object.prototype.hasOwnProperty.call(marker, 'eventEncoding');
      if (hasSharedEvent) {
        if (marker.eventEncoding !== 'shared-delta-v1'
          || !this._isPendingEventCreatePlainObject(marker.sharedEvent)
          || !Array.isArray(marker.events)) {
          throw new Error('EVENT_CREATE_PENDING_INVALID_ENCODING');
        }
        const sharedEvent = marker.sharedEvent;
        const sharedKeys = new Set(this._getPendingEventCreateOwnDataKeys(sharedEvent));
        expandedMarker.events = marker.events.map(event => {
        const deltaKeys = this._getPendingEventCreateOwnDataKeys(event);
        if (deltaKeys.some(key => sharedKeys.has(key))) {
          throw new Error('EVENT_CREATE_PENDING_OVERLAPPING_DELTA');
        }
        const expanded = Object.create(null);
        const sharedClone = this._clonePendingEventCreateValue(sharedEvent);
        const deltaClone = this._clonePendingEventCreateValue(event);
        this._getPendingEventCreateOwnDataKeys(sharedClone).forEach(key => { expanded[key] = sharedClone[key]; });
        this._getPendingEventCreateOwnDataKeys(deltaClone).forEach(key => { expanded[key] = deltaClone[key]; });
        return expanded;
        });
      } else if (hasEncoding) {
        throw new Error('EVENT_CREATE_PENDING_UNEXPECTED_ENCODING');
      }
      delete expandedMarker.eventEncoding;
      delete expandedMarker.sharedEvent;
    }
    const hasImageEncoding = Object.prototype.hasOwnProperty.call(marker, 'imageEncoding');
    const hasImageIndexes = Object.prototype.hasOwnProperty.call(marker, 'imageFromCoverIndexes');
    if (hasImageEncoding !== hasImageIndexes) {
      throw new Error('EVENT_CREATE_PENDING_INVALID_IMAGE_ENCODING');
    }
    if (hasImageEncoding) {
      const indexes = marker.imageFromCoverIndexes;
      if (marker.imageEncoding !== 'cover-alias-v1' || !Array.isArray(indexes)) {
        throw new Error('EVENT_CREATE_PENDING_INVALID_IMAGE_ENCODING');
      }
      const eventList = marker.kind === 'multi' ? expandedMarker.events : [expandedMarker.event];
      const uniqueIndexes = new Set();
      indexes.forEach(index => {
        if (!Number.isSafeInteger(index) || index < 0 || index >= eventList.length || uniqueIndexes.has(index)) {
          throw new Error('EVENT_CREATE_PENDING_INVALID_IMAGE_ALIAS');
        }
        uniqueIndexes.add(index);
        const event = eventList[index];
        const cover = event?.imageVariants?.cover;
        if (Object.prototype.hasOwnProperty.call(event || {}, 'image')
          || typeof cover !== 'string' || !cover) {
          throw new Error('EVENT_CREATE_PENDING_INVALID_IMAGE_ALIAS');
        }
        event.image = cover;
      });
      if (indexes.length === 0) throw new Error('EVENT_CREATE_PENDING_EMPTY_IMAGE_ALIAS');
    }
    delete expandedMarker.imageEncoding;
    delete expandedMarker.imageFromCoverIndexes;
    return expandedMarker;
  },

  _isPendingEventCreateImageBase64(value) {
    return typeof value === 'string'
      && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
      && value.length > 32;
  },

  _isPendingEventCreateImageValueKey(key) {
    return ['image', 'cover', 'homeNext', 'card', 'detail'].includes(String(key || ''));
  },

  _packPendingEventCreateBase64(value, key = '', state = null) {
    const active = state || { blobs: [], indexes: new Map() };
    if (typeof value === 'string'
      && this._isPendingEventCreateImageValueKey(key)
      && this._isPendingEventCreateImageBase64(value)) {
      let index = active.indexes.get(value);
      if (index == null) {
        index = active.blobs.length;
        active.indexes.set(value, index);
        active.blobs.push(value);
      }
      return { value: { __sportshubEventCreateBase64Ref: index }, state: active };
    }
    if (Array.isArray(value)) {
      return {
        value: value.map(item => this._packPendingEventCreateBase64(item, '', active).value),
        state: active,
      };
    }
    if (value && typeof value === 'object') {
      const packed = Object.create(null);
      Object.keys(value).forEach(childKey => {
        packed[childKey] = this._packPendingEventCreateBase64(value[childKey], childKey, active).value;
      });
      return { value: packed, state: active };
    }
    return { value, state: active };
  },

  _unpackPendingEventCreateBase64Envelope(value) {
    if (!this._isPendingEventCreatePlainObject(value)) return value;
    const hasWireEncoding = Object.prototype.hasOwnProperty.call(value, 'wireEncoding');
    if (!hasWireEncoding) return value;
    const envelopeKeys = Reflect.ownKeys(value);
    if (value.wireEncoding !== 'base64-table-v1'
      || envelopeKeys.length !== 3
      || !envelopeKeys.includes('blobs')
      || !envelopeKeys.includes('marker')
      || !Array.isArray(value.blobs)) {
      throw new Error('EVENT_CREATE_PENDING_INVALID_BASE64_ENVELOPE');
    }
    const blobs = value.blobs;
    const uniqueBlobs = new Set();
    for (let index = 0; index < blobs.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(blobs, index)
        || !this._isPendingEventCreateImageBase64(blobs[index])
        || uniqueBlobs.has(blobs[index])) {
        throw new Error('EVENT_CREATE_PENDING_INVALID_BASE64_TABLE');
      }
      uniqueBlobs.add(blobs[index]);
    }
    const usedIndexes = new Set();
    const unpack = (item, key = '') => {
      if (Array.isArray(item)) return item.map(child => unpack(child, ''));
      if (!item || typeof item !== 'object') return item;
      if (!this._isPendingEventCreatePlainObject(item)) {
        throw new Error('EVENT_CREATE_PENDING_INVALID_BASE64_VALUE');
      }
      const keys = Reflect.ownKeys(item);
      if (keys.length === 1 && keys[0] === '__sportshubEventCreateBase64Ref') {
        const descriptor = Object.getOwnPropertyDescriptor(item, keys[0]);
        const index = descriptor?.value;
        if (!descriptor?.enumerable
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || !this._isPendingEventCreateImageValueKey(key)
          || !Number.isSafeInteger(index)
          || index < 0
          || index >= blobs.length) {
          throw new Error('EVENT_CREATE_PENDING_INVALID_BASE64_REFERENCE');
        }
        usedIndexes.add(index);
        return blobs[index];
      }
      const result = Object.create(null);
      keys.forEach(childKey => {
        if (typeof childKey !== 'string') throw new Error('EVENT_CREATE_PENDING_INVALID_BASE64_KEY');
        const descriptor = Object.getOwnPropertyDescriptor(item, childKey);
        if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          throw new Error('EVENT_CREATE_PENDING_INVALID_BASE64_PROPERTY');
        }
        result[childKey] = unpack(descriptor.value, childKey);
      });
      return result;
    };
    const marker = unpack(value.marker);
    if (usedIndexes.size !== blobs.length) throw new Error('EVENT_CREATE_PENDING_UNUSED_BASE64');
    return marker;
  },

  _serializePendingEventCreateMarker(marker) {
    const compacted = this._compactPendingEventCreateMarker(marker);
    if (!compacted) throw new Error('EVENT_CREATE_PENDING_INVALID_MARKER');
    const encoded = this._encodePendingEventCreateValue(compacted);
    const packed = this._packPendingEventCreateBase64(encoded);
    const wire = packed.state.blobs.length > 0
      ? { wireEncoding: 'base64-table-v1', blobs: packed.state.blobs, marker: packed.value }
      : packed.value;
    const serialized = JSON.stringify(wire);
    if (serialized.length > this._eventCreatePendingMaxSerializedChars) {
      throw new Error('EVENT_CREATE_PENDING_MARKER_TOO_LARGE');
    }
    return serialized;
  },

  _isValidPendingEventCreateId(value, prefix = '') {
    const normalized = String(value || '').trim();
    return /^[A-Za-z0-9_-]{1,120}$/.test(normalized) && (!prefix || normalized.startsWith(prefix));
  },

  _rememberNormalizedPendingEventCreateMarker(marker) {
    if (!marker || typeof marker !== 'object') return marker;
    if (!this._eventCreateNormalizedMarkers) this._eventCreateNormalizedMarkers = new WeakSet();
    this._eventCreateNormalizedMarkers.add(marker);
    return marker;
  },

  _isKnownNormalizedPendingEventCreateMarker(marker, expectedCreatorUid = '') {
    const expectedUid = String(expectedCreatorUid || '').trim();
    return !!marker
      && typeof marker === 'object'
      && !!this._eventCreateNormalizedMarkers?.has?.(marker)
      && (!expectedUid || marker.creatorUid === expectedUid);
  },

  _normalizePendingEventCreateMarker(marker, expectedCreatorUid = '') {
    if (this._isKnownNormalizedPendingEventCreateMarker(marker, expectedCreatorUid)) return marker;
    const expectedUid = String(expectedCreatorUid || '').trim();
    const creatorUid = String(marker?.creatorUid || '').trim();
    const kind = marker?.kind === 'multi' ? 'multi' : (marker?.kind === 'single' ? 'single' : '');
    const startedAt = Number(marker?.startedAt || 0);
    const recoveryState = marker?.recoveryState == null
      ? 'frozen'
      : String(marker.recoveryState || '').trim();
    const payloadRevision = marker?.payloadRevision == null ? 1 : Number(marker.payloadRevision);
    const intentRevision = marker?.intentRevision == null ? 1 : Number(marker.intentRevision);
    const sourceAttempts = marker?.attempts == null ? [] : marker.attempts;
    if (marker?.version !== 2 || !kind || !creatorUid || creatorUid === 'unknown'
      || (expectedUid && creatorUid !== expectedUid) || !Number.isFinite(startedAt) || startedAt <= 0
      || (recoveryState !== 'frozen' && recoveryState !== 'editable')
      || !Number.isSafeInteger(payloadRevision) || payloadRevision < 1
      || !Number.isSafeInteger(intentRevision) || intentRevision < 1
      || !Array.isArray(sourceAttempts)
      || sourceAttempts.length > this._eventCreatePendingMaxAttempts) {
      return null;
    }
    const attemptTokens = new Set();
    const attempts = [];
    for (const attempt of sourceAttempts) {
      const token = String(attempt?.token || '').trim();
      const attemptPayloadRevision = Number(attempt?.payloadRevision || 0);
      const attemptPayloadDigest = String(attempt?.payloadDigest || '').trim();
      const state = String(attempt?.state || '').trim();
      if (!/^eca_[A-Za-z0-9_-]{1,116}$/.test(token)
        || attemptTokens.has(token)
        || !Number.isSafeInteger(attemptPayloadRevision) || attemptPayloadRevision < 1
        || !this._isValidEventCreateFixedDigest(attemptPayloadDigest)
        || ![
          'pending', 'timed-out', 'rejected-definitive',
          'rejected-ambiguous', 'conflict', 'committed',
        ].includes(state)) {
        return null;
      }
      attemptTokens.add(token);
      attempts.push({ token, payloadRevision: attemptPayloadRevision, payloadDigest: attemptPayloadDigest, state });
    }
    if (kind === 'single') {
      const event = marker?.event;
      const eventId = String(event?.id || '').trim();
      if (!this._isValidPendingEventCreateId(eventId, 'ce_')
        || String(event?.clientRequestId || '').trim() !== eventId
        || String(event?.creatorUid || '').trim() !== creatorUid
        || String(marker?.intentId || '').trim() !== eventId) {
        return null;
      }
      let payloadDigest;
      try {
        payloadDigest = this._getPendingEventCreatePayloadDigest(kind, event, null);
      } catch (_) {
        return null;
      }
      if (marker?.payloadDigest != null && String(marker.payloadDigest) !== payloadDigest) return null;
      const signature = this._isValidEventCreateFixedDigest(marker?.signature)
        ? String(marker.signature)
        : payloadDigest;
      return this._rememberNormalizedPendingEventCreateMarker({
        ...marker,
        version: 2,
        kind,
        creatorUid,
        intentId: eventId,
        event,
        recoveryState,
        payloadRevision,
        intentRevision,
        attempts,
        payloadDigest,
        signature,
        startedAt,
      });
    }
    const events = Array.isArray(marker?.events) ? marker.events : [];
    const batchGroupId = String(marker?.batchGroupId || marker?.intentId || '').trim();
    if (events.length < 2 || events.length > 30
      || !this._isValidPendingEventCreateId(batchGroupId)
      || String(marker?.intentId || '').trim() !== batchGroupId) {
      return null;
    }
    const eventIds = new Set();
    for (const event of events) {
      const eventId = String(event?.id || '').trim();
      if (!this._isValidPendingEventCreateId(eventId, 'ce_')
        || eventIds.has(eventId)
        || String(event?.clientRequestId || '').trim() !== eventId
        || String(event?.creatorUid || '').trim() !== creatorUid
        || String(event?.batchGroupId || '').trim() !== batchGroupId) {
        return null;
      }
      eventIds.add(eventId);
    }
    let payloadDigest;
    try {
      payloadDigest = this._getPendingEventCreatePayloadDigest(kind, null, events, batchGroupId);
    } catch (_) {
      return null;
    }
    if (marker?.payloadDigest != null && String(marker.payloadDigest) !== payloadDigest) return null;
    const signature = this._isValidEventCreateFixedDigest(marker?.signature)
      ? String(marker.signature)
      : payloadDigest;
    return this._rememberNormalizedPendingEventCreateMarker({
      ...marker,
      version: 2,
      kind,
      creatorUid,
      intentId: batchGroupId,
      batchGroupId,
      events,
      recoveryState,
      payloadRevision,
      intentRevision,
      attempts,
      payloadDigest,
      signature,
      startedAt,
    });
  },

  _parsePendingEventCreateMarker(raw, expectedCreatorUid = '') {
    try {
      const decoded = this._expandPendingEventCreateMarker(
        this._decodePendingEventCreateValue(
          this._unpackPendingEventCreateBase64Envelope(JSON.parse(String(raw || ''))),
        ),
      );
      return this._normalizePendingEventCreateMarker(decoded, expectedCreatorUid);
    } catch (_) {
      return null;
    }
  },

  _getPendingEventCreateMarkerFromPending(pending) {
    if (pending?.marker) return this._normalizePendingEventCreateMarker(pending.marker, pending.creatorUid);
    const creatorUid = String(pending?.creatorUid || '').trim();
    const startedAt = Number(pending?.startedAt || Date.now());
    const signature = String(pending?.signature || '');
    const payloadRevision = Number(pending?.payloadRevision || 1);
    const intentRevision = Number(pending?.intentRevision || 1);
    const attempts = Array.isArray(pending?.durableAttempts) ? pending.durableAttempts : [];
    const recoveryState = pending?.recoveryState === 'editable' || pending?.state === 'editable'
      ? 'editable'
      : 'frozen';
    if (pending?.kind === 'multi' || Array.isArray(pending?.events)) {
      const events = pending.events || [];
      const batchGroupId = String(events[0]?.batchGroupId || pending?.batchGroupId || '').trim();
      return this._normalizePendingEventCreateMarker({
        version: 2,
        kind: 'multi',
        creatorUid,
        intentId: batchGroupId,
        batchGroupId,
        events,
        signature,
        payloadRevision,
        intentRevision,
        attempts,
        recoveryState,
        startedAt,
      }, creatorUid);
    }
    const eventId = String(pending?.event?.id || '').trim();
    return this._normalizePendingEventCreateMarker({
      version: 2,
      kind: 'single',
      creatorUid,
      intentId: eventId,
      event: pending?.event,
      signature,
      payloadRevision,
      intentRevision,
      attempts,
      recoveryState,
      startedAt,
    }, creatorUid);
  },

  _isSamePendingEventCreateIdentity(left, right) {
    const leftMarker = this._normalizePendingEventCreateMarker(left, left?.creatorUid);
    const rightMarker = this._normalizePendingEventCreateMarker(right, right?.creatorUid);
    if (!leftMarker || !rightMarker
      || leftMarker.kind !== rightMarker.kind
      || leftMarker.creatorUid !== rightMarker.creatorUid
      || leftMarker.intentId !== rightMarker.intentId) {
      return false;
    }
    if (leftMarker.kind === 'single') {
      return leftMarker.event.id === rightMarker.event.id
        && leftMarker.event.clientRequestId === rightMarker.event.clientRequestId;
    }
    const leftIds = leftMarker.events.map(event => `${event.id}:${event.clientRequestId}`);
    const rightIds = rightMarker.events.map(event => `${event.id}:${event.clientRequestId}`);
    return leftIds.length === rightIds.length && leftIds.every((value, index) => value === rightIds[index]);
  },

  _isSamePendingEventCreateIntent(left, right) {
    const leftMarker = this._normalizePendingEventCreateMarker(left, left?.creatorUid);
    const rightMarker = this._normalizePendingEventCreateMarker(right, right?.creatorUid);
    return !!leftMarker && !!rightMarker
      && this._isSamePendingEventCreateIdentity(leftMarker, rightMarker)
      && leftMarker.startedAt === rightMarker.startedAt
      && leftMarker.payloadRevision === rightMarker.payloadRevision
      && leftMarker.payloadDigest === rightMarker.payloadDigest
      && leftMarker.recoveryState === rightMarker.recoveryState
      && leftMarker.intentRevision === rightMarker.intentRevision
      && JSON.stringify(leftMarker.attempts) === JSON.stringify(rightMarker.attempts);
  },

  _getEventCreateRuntime() {
    if (typeof window !== 'undefined') return window;
    if (typeof globalThis !== 'undefined') return globalThis;
    return null;
  },

  _getEventCreateLockManager() {
    const lockManager = this._getEventCreateRuntime()?.navigator?.locks;
    return lockManager && typeof lockManager.request === 'function' ? lockManager : null;
  },

  async _waitForEventCreatePendingCoordinator(promise, fallbackValue, onTimeout = null, configuredTimeoutMs = null) {
    const timeoutMs = Math.max(1, Number(configuredTimeoutMs
      || this._eventCreatePendingCoordinatorTimeoutMs) || 3000);
    let timeoutId = null;
    const timeout = new Promise(resolve => {
      timeoutId = setTimeout(() => {
        try { onTimeout?.(); } catch (_) {}
        resolve(fallbackValue);
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },

  _persistPendingSingleEventMarker(pendingOrMarker) {
    const marker = pendingOrMarker?.version === 2
      ? this._normalizePendingEventCreateMarker(pendingOrMarker, pendingOrMarker?.creatorUid)
      : this._getPendingEventCreateMarkerFromPending(pendingOrMarker);
    const storageKey = this._getEventCreatePendingStorageKey(marker?.creatorUid);
    if (!marker || !storageKey) return false;
    try {
      const storage = this._getEventCreateRuntime()?.localStorage;
      if (!storage) return false;
      const serialized = this._serializePendingEventCreateMarker(marker);
      return this._writeSerializedPendingEventCreateMarker(storage, storageKey, serialized, marker.creatorUid)
        && storage.getItem(storageKey) === serialized;
    } catch (_) {
      return false;
    }
  },

  _readPendingSingleEventMarker(creatorUid = '') {
    const normalizedUid = String(creatorUid || this._getEventFormAuthUid() || '').trim();
    const storageKey = this._getEventCreatePendingStorageKey(normalizedUid);
    if (!storageKey) return null;
    try {
      const storage = this._getEventCreateRuntime()?.localStorage;
      if (!storage) return { unavailable: true, creatorUid: normalizedUid };
      const raw = storage.getItem(storageKey);
      if (!raw) return null;
      const marker = this._parsePendingEventCreateMarker(raw, normalizedUid);
      return marker || { invalid: true, creatorUid: normalizedUid };
    } catch (_) {
      return { unavailable: true, creatorUid: normalizedUid };
    }
  },

  _clearPendingSingleEventMarker(expectedMarker) {
    const marker = this._normalizePendingEventCreateMarker(expectedMarker, expectedMarker?.creatorUid);
    const storageKey = this._getEventCreatePendingStorageKey(marker?.creatorUid);
    if (!marker || !storageKey) return false;
    try {
      const storage = this._getEventCreateRuntime()?.localStorage;
      if (!storage) return false;
      const current = this._readPendingSingleEventMarker(marker.creatorUid);
      if (!this._isSamePendingEventCreateIntent(current, marker)) return false;
      storage.removeItem(storageKey);
      return !storage.getItem(storageKey);
    } catch (_) {
      return false;
    }
  },

  _getEventCreatePendingEvictableStorageKeys(storage) {
    if (!storage) return [];
    const firebaseDisplayCache = /^shub_c_(?:.+_)?(?:newsArticles|gameConfigs|operationLogs|expLogs|teamExpLogs|errorLogs)$/;
    const homeNextCache = /^toosterx\.homeNextActivity\.v1\.[A-Za-z0-9_-]+$/;
    const rosterPreviewCache = /^toosterx\.eduCourseRosterPreview\.v1\.[A-Za-z0-9_-]+$/;
    const keys = [];
    const length = Number(storage.length || 0);
    if (!Number.isSafeInteger(length) || length < 0) return [];
    for (let index = 0; index < length; index += 1) {
      const key = String(storage.key(index) || '');
      if (key === 'shub_qr_data'
        || firebaseDisplayCache.test(key)
        || homeNextCache.test(key)
        || rosterPreviewCache.test(key)) keys.push(key);
    }
    return keys;
  },

  _isEventCreatePendingQuotaError(err) {
    const name = String(err?.name || '').toLowerCase();
    const code = Number(err?.code || 0);
    return name === 'quotaexceedederror'
      || name === 'ns_error_dom_quota_reached'
      || code === 22
      || code === 1014;
  },

  _writeSerializedPendingEventCreateMarker(storage, storageKey, serialized, creatorUid = '') {
    try {
      storage.setItem(storageKey, serialized);
      return true;
    } catch (err) {
      if (!this._isEventCreatePendingQuotaError(err)) return false;
      const candidates = [];
      let evictableKeys;
      try {
        evictableKeys = this._getEventCreatePendingEvictableStorageKeys(storage);
      } catch (_) {
        return false;
      }
      for (const key of evictableKeys) {
        try {
          const value = key === storageKey ? null : storage.getItem(key);
          if (value != null) candidates.push({ key, size: String(value).length });
        } catch (_) {
          return false;
        }
      }
      candidates.sort((left, right) => right.size - left.size || left.key.localeCompare(right.key));
      for (const candidate of candidates) {
        try {
          storage.removeItem(candidate.key);
          storage.setItem(storageKey, serialized);
          return true;
        } catch (retryErr) {
          if (!this._isEventCreatePendingQuotaError(retryErr)) return false;
        }
      }
      return false;
    }
  },

  _isAllowedPendingEventCreateReplacement(expected, next) {
    if (!expected || !next
      || !this._isSamePendingEventCreateIdentity(expected, next)
      || expected.startedAt !== next.startedAt
      || next.intentRevision !== expected.intentRevision + 1) {
      return false;
    }
    if (next.payloadRevision === expected.payloadRevision) {
      return next.payloadDigest === expected.payloadDigest
        && (next.recoveryState === expected.recoveryState
          || (expected.recoveryState === 'frozen' && next.recoveryState === 'editable'));
    }
    return next.payloadRevision === expected.payloadRevision + 1
      && expected.recoveryState === 'editable'
      && next.recoveryState === 'frozen'
      && JSON.stringify(next.attempts) === JSON.stringify(expected.attempts);
  },

  _prepareEventCreatePendingOperation(operation, creatorUid, marker = null) {
    const normalizedUid = String(creatorUid || '').trim();
    if (!normalizedUid) return null;
    if (operation === 'read') return { operation, creatorUid: normalizedUid };
    if (operation === 'claim' || operation === 'remove') {
      const expected = this._normalizePendingEventCreateMarker(marker, normalizedUid);
      if (!expected) return null;
      return {
        operation,
        creatorUid: normalizedUid,
        expectedMarker: expected,
        expectedSerialized: this._serializePendingEventCreateMarker(expected),
      };
    }
    if (operation === 'replace') {
      const expected = this._normalizePendingEventCreateMarker(marker?.expectedMarker, normalizedUid);
      const next = this._normalizePendingEventCreateMarker(marker?.nextMarker, normalizedUid);
      if (!this._isAllowedPendingEventCreateReplacement(expected, next)) return null;
      return {
        operation,
        creatorUid: normalizedUid,
        expectedMarker: expected,
        expectedSerialized: this._serializePendingEventCreateMarker(expected),
        nextMarker: next,
        nextSerialized: this._serializePendingEventCreateMarker(next),
      };
    }
    return null;
  },

  _finalizeEventCreatePendingStorageResult(result, prepared) {
    if (!result?.state) return { state: 'unavailable' };
    if (!['existing', 'preserved', 'read'].includes(result.state)) return result;
    if (!result.raw) return result.state === 'read' ? { state: 'empty', marker: null } : result;
    const parsed = this._parsePendingEventCreateMarker(result.raw, prepared.creatorUid);
    if (!parsed) return { state: 'blocked', marker: { invalid: true, creatorUid: prepared.creatorUid } };
    return {
      state: result.state === 'read' ? 'existing' : result.state,
      marker: parsed,
    };
  },

  _runEventCreatePendingStorageOperation(prepared) {
    const storageKey = this._getEventCreatePendingStorageKey(prepared?.creatorUid);
    const storage = this._getEventCreateRuntime()?.localStorage;
    if (!prepared || !storageKey || !storage) return { state: 'unavailable' };
    let currentRaw;
    try {
      currentRaw = storage.getItem(storageKey);
    } catch (_) {
      return { state: 'unavailable' };
    }
    if (prepared.operation === 'read') return { state: 'read', raw: currentRaw || null };
    if (prepared.operation === 'claim') {
      if (currentRaw) return { state: 'existing', raw: currentRaw };
      if (!this._writeSerializedPendingEventCreateMarker(
        storage, storageKey, prepared.expectedSerialized, prepared.creatorUid,
      )) return { state: 'unavailable' };
      try {
        return storage.getItem(storageKey) === prepared.expectedSerialized
          ? { state: 'claimed', marker: prepared.expectedMarker }
          : { state: 'unavailable' };
      } catch (_) {
        return { state: 'unavailable' };
      }
    }
    if (prepared.operation === 'replace') {
      if (currentRaw !== prepared.expectedSerialized) {
        return { state: 'preserved', raw: currentRaw || null };
      }
      if (!this._writeSerializedPendingEventCreateMarker(
        storage, storageKey, prepared.nextSerialized, prepared.creatorUid,
      )) return { state: 'unavailable' };
      try {
        return storage.getItem(storageKey) === prepared.nextSerialized
          ? { state: 'replaced', marker: prepared.nextMarker }
          : { state: 'unavailable' };
      } catch (_) {
        return { state: 'unavailable' };
      }
    }
    if (prepared.operation === 'remove') {
      if (currentRaw !== prepared.expectedSerialized) {
        return { state: 'preserved', raw: currentRaw || null };
      }
      try {
        storage.removeItem(storageKey);
        return storage.getItem(storageKey) == null
          ? { state: 'removed', marker: prepared.expectedMarker }
          : { state: 'unavailable' };
      } catch (_) {
        return { state: 'unavailable' };
      }
    }
    return { state: 'unavailable' };
  },

  async _openEventCreatePendingDb() {
    const indexedDb = this._getEventCreateRuntime()?.indexedDB;
    if (!indexedDb || typeof indexedDb.open !== 'function') return null;
    let request = null;
    let active = true;
    const openPromise = new Promise((resolve, reject) => {
      try {
        request = indexedDb.open(this._eventCreatePendingDbName, 1);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = () => {
        if (!active) {
          try { request.transaction?.abort?.(); } catch (_) {}
          return;
        }
        const database = request.result;
        if (!database.objectStoreNames.contains(this._eventCreatePendingDbStore)) {
          database.createObjectStore(this._eventCreatePendingDbStore, { keyPath: 'creatorUid' });
        }
      };
      request.onsuccess = () => {
        if (!active) {
          try { request.result?.close?.(); } catch (_) {}
          return;
        }
        resolve(request.result);
      };
      request.onerror = () => {
        if (active) reject(request.error || new Error('EVENT_CREATE_PENDING_DB_OPEN_FAILED'));
      };
      request.onblocked = () => {
        if (active) reject(new Error('EVENT_CREATE_PENDING_DB_BLOCKED'));
      };
    });
    let deliveredDatabase = null;
    try {
      deliveredDatabase = await this._waitForEventCreatePendingCoordinator(openPromise, null, () => {
        active = false;
        try { request?.transaction?.abort?.(); } catch (_) {}
        try { request?.result?.close?.(); } catch (_) {}
      });
      return deliveredDatabase;
    } finally {
      active = false;
      if (!deliveredDatabase) {
        try { request?.transaction?.abort?.(); } catch (_) {}
        try { request?.result?.close?.(); } catch (_) {}
      }
    }
  },

  async _runEventCreatePendingDbOperation(prepared) {
    const normalizedUid = String(prepared?.creatorUid || '').trim();
    const database = await this._openEventCreatePendingDb();
    if (!database || !normalizedUid) return { state: 'unavailable' };
    let transaction = null;
    let active = true;
    try {
      const operationPromise = new Promise((resolve, reject) => {
        try {
          transaction = database.transaction(this._eventCreatePendingDbStore, 'readwrite');
        } catch (err) {
          reject(err);
          return;
        }
        const store = transaction.objectStore(this._eventCreatePendingDbStore);
        const request = store.get(normalizedUid);
        let result = { state: 'unavailable' };
        request.onsuccess = () => {
          if (!active) {
            try { transaction.abort(); } catch (_) {}
            return;
          }
          try {
            result = this._runEventCreatePendingStorageOperation(prepared);
            const previousEpoch = Number(request.result?.epoch || 0);
            store.put({
              creatorUid: normalizedUid,
              epoch: Number.isSafeInteger(previousEpoch) && previousEpoch >= 0
                && previousEpoch < Number.MAX_SAFE_INTEGER ? previousEpoch + 1 : 1,
            });
          } catch (err) {
            try { transaction.abort(); } catch (_) {}
            reject(err);
          }
        };
        request.onerror = () => {
          if (!active) return;
          try { transaction.abort(); } catch (_) {}
          reject(request.error || new Error('EVENT_CREATE_PENDING_DB_READ_FAILED'));
        };
        transaction.oncomplete = () => {
          if (active) resolve(result);
        };
        transaction.onerror = () => {
          if (active) reject(transaction.error || request.error || new Error('EVENT_CREATE_PENDING_DB_FAILED'));
        };
        transaction.onabort = () => {
          if (active) reject(transaction.error || request.error || new Error('EVENT_CREATE_PENDING_DB_ABORTED'));
        };
      });
      return await this._waitForEventCreatePendingCoordinator(
        operationPromise,
        { state: 'unavailable' },
        () => {
          active = false;
          try { transaction?.abort?.(); } catch (_) {}
        },
      );
    } finally {
      active = false;
      try { database.close(); } catch (_) {}
    }
  },

  async _runEventCreatePendingOperation(operation, creatorUid, marker = null) {
    const normalizedUid = String(creatorUid || '').trim();
    const lockName = this._getEventCreatePendingLockName(normalizedUid);
    if (!normalizedUid || !lockName) return { state: 'unavailable' };
    let prepared;
    try {
      prepared = this._prepareEventCreatePendingOperation(operation, normalizedUid, marker);
    } catch (err) {
      this._writeEventCreateStageError('pendingIntentPrepare', err);
      return { state: 'unavailable' };
    }
    if (!prepared) return { state: 'blocked', marker: { invalid: true, creatorUid: normalizedUid } };
    const lockManager = this._getEventCreateLockManager();
    if (lockManager) {
      let active = true;
      const runtime = this._getEventCreateRuntime();
      const AbortControllerCtor = runtime?.AbortController
        || (typeof AbortController !== 'undefined' ? AbortController : null);
      const abortController = AbortControllerCtor ? new AbortControllerCtor() : null;
      try {
        const options = { mode: 'exclusive' };
        if (abortController?.signal) options.signal = abortController.signal;
        let signalAcquired = null;
        const acquiredPromise = new Promise(resolve => { signalAcquired = resolve; });
        const lockRequest = Promise.resolve(lockManager.request(lockName, options, async () => {
          if (!active) {
            signalAcquired(false);
            return { state: 'unavailable' };
          }
          signalAcquired(true);
          return await this._runEventCreatePendingDbOperation(prepared);
        }));
        lockRequest.catch(() => {});
        const acquired = await this._waitForEventCreatePendingCoordinator(
          acquiredPromise,
          false,
          () => {
            active = false;
            try { abortController?.abort?.(); } catch (_) {}
          },
          this._eventCreatePendingWebLockTimeoutMs,
        );
        if (!acquired || !active) {
          active = false;
          return { state: 'unavailable' };
        }
        const lockResult = await lockRequest;
        active = false;
        return this._finalizeEventCreatePendingStorageResult(
          lockResult?.state ? lockResult : { state: 'unavailable' },
          prepared,
        );
      } catch (err) {
        active = false;
        this._writeEventCreateStageError('pendingIntentLock', err);
        return { state: 'unavailable' };
      }
    }
    try {
      const result = await this._runEventCreatePendingDbOperation(prepared);
      return this._finalizeEventCreatePendingStorageResult(result, prepared);
    } catch (err) {
      this._writeEventCreateStageError('pendingIntentIndexedDb', err);
      return { state: 'unavailable' };
    }
  },

  async _claimPendingEventCreateIntent(marker) {
    const normalized = this._normalizePendingEventCreateMarker(marker, marker?.creatorUid);
    if (!normalized) return { state: 'blocked', marker: { invalid: true } };
    return await this._runEventCreatePendingOperation('claim', normalized.creatorUid, normalized);
  },

  async _loadPendingEventCreateIntent(creatorUid = '') {
    return await this._runEventCreatePendingOperation('read', creatorUid);
  },

  async _removePendingEventCreateIntent(marker) {
    const normalized = this._normalizePendingEventCreateMarker(marker, marker?.creatorUid);
    if (!normalized) return false;
    let expected = normalized;
    for (let retry = 0; retry < 3; retry += 1) {
      const result = await this._runEventCreatePendingOperation('remove', expected.creatorUid, expected);
      if (result.state === 'removed') return true;
      const canonical = result?.state === 'preserved' ? result.marker : null;
      if (!canonical
        || !this._isSamePendingEventCreateIdentity(canonical, normalized)
        || canonical.payloadRevision !== normalized.payloadRevision
        || canonical.payloadDigest !== normalized.payloadDigest
        || !canonical.attempts.some(attempt => attempt.state === 'committed'
          && attempt.payloadRevision === normalized.payloadRevision
          && attempt.payloadDigest === normalized.payloadDigest)) {
        return false;
      }
      expected = canonical;
    }
    return false;
  },

  async _replacePendingEventCreateIntent(expectedMarker, nextMarker) {
    const expected = this._normalizePendingEventCreateMarker(expectedMarker, expectedMarker?.creatorUid);
    const next = this._normalizePendingEventCreateMarker(nextMarker, nextMarker?.creatorUid);
    if (!this._isAllowedPendingEventCreateReplacement(expected, next)) {
      return { state: 'preserved', marker: null };
    }
    const result = await this._runEventCreatePendingOperation('replace', expected.creatorUid, {
      expectedMarker: expected,
      nextMarker: next,
    });
    if (result?.state !== 'unavailable') return result;
    const canonical = await this._runEventCreatePendingOperation('read', expected.creatorUid);
    return canonical?.state === 'existing'
      && this._isSamePendingEventCreateIntent(canonical.marker, next)
      ? { state: 'replaced', marker: canonical.marker }
      : { state: 'unavailable', marker: canonical?.marker || null };
  },

  _setEventCreateOutcomeUnknownUi(isUnknown) {
    const modal = document.getElementById('create-event-modal');
    const modalBody = modal?.querySelector?.(':scope > .modal-body') || modal?.querySelector?.('.modal-body');
    if (modalBody) modalBody.inert = !!isUnknown;
    modal?.classList?.toggle('ce-create-outcome-unknown', !!isUnknown);
    if (isUnknown) this._setCreateEventSubmitIdleLabel('確認建立結果');
  },

  _setEventCreateEditableRetryUi() {
    this._setEventCreateOutcomeUnknownUi(false);
    this._setCreateEventSubmitIdleLabel('修正後重新送出');
  },

  _isPendingEventCreateCurrent(pending) {
    if (!pending) return false;
    return pending.kind === 'multi'
      ? this._pendingMultiDateSubmission === pending
      : this._pendingSingleEventSubmission === pending;
  },

  _clearPendingSingleEventSubmission(pending = null) {
    const target = pending || this._pendingSingleEventSubmission || this._pendingMultiDateSubmission;
    if (!target || !this._isPendingEventCreateCurrent(target)) return false;
    if (target.kind === 'multi') this._pendingMultiDateSubmission = null;
    else this._pendingSingleEventSubmission = null;
    this._setEventCreateOutcomeUnknownUi(false);
    return true;
  },

  _restorePendingEventCreateIntent(marker, generation = 0) {
    const normalized = this._normalizePendingEventCreateMarker(marker, marker?.creatorUid);
    if (!normalized) return null;
    const pending = {
      kind: normalized.kind,
      generation,
      signature: normalized.signature,
      creatorUid: normalized.creatorUid,
      marker: normalized,
      event: normalized.kind === 'single'
        ? this._clonePendingEventCreateValue(normalized.event)
        : null,
      events: normalized.kind === 'multi'
        ? normalized.events.map(event => this._clonePendingEventCreateValue(event))
        : null,
      batchGroupId: normalized.kind === 'multi' ? normalized.batchGroupId : '',
      payloadRevision: normalized.payloadRevision,
      payloadDigest: normalized.payloadDigest,
      intentRevision: normalized.intentRevision,
      recoveryState: normalized.recoveryState,
      durableAttempts: normalized.attempts,
      attempts: [],
      state: normalized.recoveryState === 'editable' ? 'editable-restored' : 'outcome-unknown',
      restored: true,
      startedAt: normalized.startedAt,
    };
    if (pending.kind === 'multi') this._pendingMultiDateSubmission = pending;
    else this._pendingSingleEventSubmission = pending;
    return pending;
  },

  _writeEventCreateStageError(stage, err, extra = {}) {
    ApiService._writeErrorLog?.({
      fn: 'handleCreateEvent',
      stage,
      currentUserRole: ApiService.getCurrentUser?.()?.role || this.currentRole || '',
      authMatchesProfile: String(ApiService.getCurrentUser?.()?.uid || '').trim() === this._getEventFormAuthUid(),
      ...extra,
    }, err);
  },

  _classifyEventCreateAttemptRejection(reason) {
    const explicitOutcome = String(reason?.eventCreateOutcome || '').trim();
    if (explicitOutcome === 'conflict') return 'conflict';
    const writeState = String(reason?.eventCreateWriteState || '').trim();
    if (explicitOutcome === 'definitive-rejected' && writeState === 'not-started') return 'definitive';
    const code = String(reason?.code || '').trim().toLowerCase();
    const message = String(reason?.message || reason || '').trim().toLowerCase();
    if (code === 'event/id-conflict' || message.includes('event_id_conflict')) return 'conflict';
    if (String(reason?.eventCreatePhase || '').trim() === 'transaction'
      && ['permission-denied', 'unauthenticated', 'invalid-argument'].includes(code)) {
      return 'authoritative-rejected';
    }
    return 'ambiguous';
  },

  _canOfferEditableEventCreateRetry(pending) {
    const attempts = Array.isArray(pending?.marker?.attempts) ? pending.marker.attempts : [];
    return attempts.length > 0
      && attempts.every(attempt => attempt.state === 'rejected-definitive');
  },

  _getEventCreateAttemptToken() {
    this._eventCreateAttemptSequence = Number(this._eventCreateAttemptSequence || 0) + 1;
    const entropy = `${Date.now()}:${this._eventCreateAttemptSequence}:${Math.random()}`;
    return `eca_${this._getEventCreateFixedDigest(entropy).slice(3)}`;
  },

  _syncPendingEventCreateMarker(pending, marker) {
    const normalized = this._normalizePendingEventCreateMarker(marker, pending?.creatorUid);
    if (!pending || !normalized) return false;
    pending.marker = normalized;
    pending.payloadRevision = normalized.payloadRevision;
    pending.payloadDigest = normalized.payloadDigest;
    pending.intentRevision = normalized.intentRevision;
    pending.recoveryState = normalized.recoveryState;
    pending.durableAttempts = normalized.attempts;
    if (normalized.kind === 'multi') {
      pending.events = normalized.events.map(event => this._clonePendingEventCreateValue(event));
      pending.batchGroupId = normalized.batchGroupId;
    } else {
      pending.event = this._clonePendingEventCreateValue(normalized.event);
    }
    return true;
  },

  async _beginPendingEventCreateAttempt(pending) {
    const token = this._getEventCreateAttemptToken();
    for (let retry = 0; retry < 3; retry += 1) {
      const expected = pending?.marker || this._getPendingEventCreateMarkerFromPending(pending);
      if (!expected || expected.recoveryState !== 'frozen'
        || expected.attempts.length >= this._eventCreatePendingMaxAttempts) return null;
      const next = this._normalizePendingEventCreateMarker({
        ...expected,
        intentRevision: expected.intentRevision + 1,
        attempts: expected.attempts.concat({
          token,
          payloadRevision: expected.payloadRevision,
          payloadDigest: expected.payloadDigest,
          state: 'pending',
        }),
      }, pending.creatorUid);
      if (!next) return null;
      const replaced = await this._replacePendingEventCreateIntent(expected, next);
      if (replaced?.state === 'replaced' && replaced.marker) {
        this._syncPendingEventCreateMarker(pending, replaced.marker);
        return {
          number: (pending.attempts?.length || 0) + 1,
          token,
          revision: next.payloadRevision,
          digest: next.payloadDigest,
          status: 'pending',
          rejectionKind: '',
          outcome: null,
          promise: null,
        };
      }
      if (replaced?.state !== 'preserved' || !replaced.marker
        || replaced.marker.recoveryState !== 'frozen'
        || replaced.marker.payloadRevision !== expected.payloadRevision
        || replaced.marker.payloadDigest !== expected.payloadDigest) return null;
      this._syncPendingEventCreateMarker(pending, replaced.marker);
    }
    return null;
  },

  async _settlePendingEventCreateAttempt(pending, attemptRecord, durableState) {
    if (!pending || !attemptRecord?.token) return false;
    for (let retry = 0; retry < 4; retry += 1) {
      const expected = pending.marker;
      if (!expected) return false;
      const attemptIndex = expected.attempts.findIndex(attempt => attempt.token === attemptRecord.token);
      if (attemptIndex < 0) return false;
      const currentAttempt = expected.attempts[attemptIndex];
      if (currentAttempt.payloadRevision !== attemptRecord.revision
        || currentAttempt.payloadDigest !== attemptRecord.digest) return false;
      if (currentAttempt.state === durableState
        || currentAttempt.state === 'committed'
        || currentAttempt.state === 'conflict') return true;
      const attempts = expected.attempts.map((attempt, index) => index === attemptIndex
        ? { ...attempt, state: durableState }
        : attempt);
      const next = this._normalizePendingEventCreateMarker({
        ...expected,
        intentRevision: expected.intentRevision + 1,
        attempts,
      }, pending.creatorUid);
      if (!next) return false;
      const replaced = await this._replacePendingEventCreateIntent(expected, next);
      if (replaced?.state === 'replaced' && replaced.marker) {
        this._syncPendingEventCreateMarker(pending, replaced.marker);
        return true;
      }
      if (replaced?.state !== 'preserved' || !replaced.marker
        || !this._isSamePendingEventCreateIdentity(replaced.marker, expected)
        || replaced.marker.payloadRevision !== attemptRecord.revision
        || replaced.marker.payloadDigest !== attemptRecord.digest) return false;
      this._syncPendingEventCreateMarker(pending, replaced.marker);
    }
    return false;
  },

  _getPendingEventCreateWritePayload(pending) {
    const metadata = {
      payloadRevision: pending.marker.payloadRevision,
      payloadDigest: pending.marker.payloadDigest,
    };
    return pending.kind === 'multi'
      ? pending.marker.events.map(event => ({ ...this._clonePendingEventCreateValue(event), ...metadata }))
      : { ...this._clonePendingEventCreateValue(pending.marker.event), ...metadata };
  },

  async _markPendingEventCreateEditable(pending) {
    const expected = pending?.marker || this._getPendingEventCreateMarkerFromPending(pending);
    if (!expected || !this._canOfferEditableEventCreateRetry(pending)) return false;
    const next = this._normalizePendingEventCreateMarker({
      ...expected,
      recoveryState: 'editable',
      intentRevision: expected.intentRevision + 1,
    }, pending.creatorUid);
    if (!next) return false;
    const replaced = await this._replacePendingEventCreateIntent(expected, next);
    if (replaced?.state !== 'replaced' || !replaced.marker) {
      pending.state = 'outcome-unknown';
      this._setEventCreateOutcomeUnknownUi(true);
      return false;
    }
    this._syncPendingEventCreateMarker(pending, replaced.marker);
    pending.state = 'editable';
    this._setEventCreateEditableRetryUi();
    return true;
  },

  _showEditableEventCreateRetry(reason, pending) {
    this._setEventCreateEditableRetryUi();
    if (reason?._toasted) return;
    const payload = pending?.kind === 'multi' ? pending?.events?.[0] : pending?.event;
    const message = this._getCreateEventWriteErrorMessage?.(reason, payload)
      || '活動資料未能建立，請修正表單後重新送出；系統會沿用原本的活動編號';
    this.showToast?.(message);
  },

  async _captureSingleEventCreateAttempt(pending, writePayload) {
    try {
      const created = pending.kind === 'multi'
        ? await ApiService.createEventsAtomic(writePayload)
        : await ApiService.createEvent(writePayload);
      if (!created) throw new Error('EVENT_CREATE_EMPTY_RESULT');
      return { status: 'fulfilled', value: created };
    } catch (reason) {
      return { status: 'rejected', reason };
    }
  },

  async _rememberSingleEventCreateAttempt(pending, attemptRecord, attemptPromise) {
    const outcome = await attemptPromise;
    attemptRecord.status = outcome.status;
    attemptRecord.outcome = outcome;
    attemptRecord.rejectionKind = outcome.status === 'rejected'
      ? this._classifyEventCreateAttemptRejection(outcome.reason)
      : '';
    const durableState = outcome.status === 'fulfilled'
      ? 'committed'
      : (attemptRecord.rejectionKind === 'definitive'
        ? 'rejected-definitive'
        : (attemptRecord.rejectionKind === 'authoritative-rejected'
          ? 'rejected-definitive'
          : (attemptRecord.rejectionKind === 'conflict' ? 'conflict' : 'rejected-ambiguous')));
    const settledCurrentIntent = await this._settlePendingEventCreateAttempt(
      pending, attemptRecord, durableState,
    );
    if (this._isPendingEventCreateCurrent(pending)) {
      if (outcome.status === 'fulfilled' && settledCurrentIntent) {
        pending.committedOutcome = outcome;
        pending.state = 'committed';
      } else if ((pending.attempts || []).some(record => record.status === 'pending')) {
        pending.state = 'outcome-unknown';
      } else if (this._canOfferEditableEventCreateRetry(pending)) {
        pending.state = 'definitive-rejected';
      } else {
        pending.state = 'outcome-unknown';
      }
    }
    return outcome;
  },

  async _runSingleEventCreateAttempt(pending) {
    const attempts = Array.isArray(pending.attempts) ? pending.attempts : [];
    pending.attempts = attempts;
    const attemptRecord = await this._beginPendingEventCreateAttempt(pending);
    if (!attemptRecord) {
      pending.state = 'outcome-unknown';
      this._setEventCreateOutcomeUnknownUi(true);
      return { state: 'unknown', reason: 'pending-intent-not-canonical' };
    }
    attempts.push(attemptRecord);
    pending.state = 'writing';
    const writePayload = this._getPendingEventCreateWritePayload(pending);
    const capturedAttempt = this._captureSingleEventCreateAttempt(pending, writePayload);
    const rememberedAttempt = this._rememberSingleEventCreateAttempt(pending, attemptRecord, capturedAttempt);
    attemptRecord.promise = rememberedAttempt;
    let outcome;
    try {
      outcome = await this._waitForActivityCreateDependency(
        rememberedAttempt,
        this._eventCreateWriteTimeoutMs,
        'event-create-write-timeout',
        'Event create result is still pending',
      );
    } catch (err) {
      if (err?.code !== 'event-create-write-timeout') throw err;
      await this._settlePendingEventCreateAttempt(pending, attemptRecord, 'timed-out');
      if (this._isPendingEventCreateCurrent(pending) && !pending.committedOutcome) {
        pending.state = 'outcome-unknown';
        this._setEventCreateOutcomeUnknownUi(true);
      }
      this._writeEventCreateStageError('createEventTimeout', err, { attempt: attemptRecord.number, kind: pending.kind });
      return { state: 'unknown' };
    }
    const committed = pending.committedOutcome
      || attempts.find(record => record.outcome?.status === 'fulfilled')?.outcome;
    if (committed) return { state: 'committed', value: committed.value };
    if (outcome?.status === 'rejected') {
      if (this._canOfferEditableEventCreateRetry(pending)) {
        pending.state = 'settled-rejected';
        return { state: 'settled-rejected', reason: outcome.reason };
      }
      pending.state = 'outcome-unknown';
      this._setEventCreateOutcomeUnknownUi(true);
      return { state: 'unknown', reason: outcome.reason };
    }
    return { state: 'committed', value: outcome?.value };
  },

  async _resolvePendingSingleEventCreate(pending) {
    const attempts = Array.isArray(pending?.attempts) ? pending.attempts : [];
    const committed = pending?.committedOutcome
      || attempts.find(record => record.outcome?.status === 'fulfilled')?.outcome;
    if (committed) return { state: 'committed', value: committed.value };
    if (typeof ApiService.reconcileEventCreate !== 'function') {
      const unavailable = new Error('EVENT_CREATE_RECONCILE_UNAVAILABLE');
      unavailable.code = 'event-create-reconcile-unavailable';
      this._writeEventCreateStageError('reconcileEventCreateUnavailable', unavailable);
      return { state: 'unknown' };
    }
    try {
      const requests = pending.kind === 'multi'
        ? pending.events.map(event => ApiService.reconcileEventCreate({
          id: event.id,
          clientRequestId: event.clientRequestId,
          creatorUid: pending.creatorUid,
          payloadRevision: pending.marker.payloadRevision,
          payloadDigest: pending.marker.payloadDigest,
        }))
        : [ApiService.reconcileEventCreate({
          id: pending.event.id,
          clientRequestId: pending.event.clientRequestId,
          creatorUid: pending.creatorUid,
          payloadRevision: pending.marker.payloadRevision,
          payloadDigest: pending.marker.payloadDigest,
        })];
      const result = await this._waitForActivityCreateDependency(
        Promise.all(requests),
        this._eventCreateReconcileTimeoutMs,
        'event-create-reconcile-timeout',
        'Event create reconciliation timed out',
      );
      const results = Array.isArray(result) ? result : [];
      if (results.some(item => item?.state === 'conflict')
        || results.length !== requests.length
        || results.some(item => item?.state !== 'committed' && item?.state !== 'missing')) {
        const conflict = new Error('EVENT_CREATE_RECONCILE_CONFLICT');
        conflict.code = 'event-create-reconcile-conflict';
        throw conflict;
      }
      if (results.every(item => item?.state === 'committed')) {
        return { state: 'committed', value: pending.kind === 'multi' ? pending.events : (results[0]?.event || pending.event) };
      }
      if (results.every(item => item?.state === 'missing')) {
        pending.state = 'ready';
        return { state: 'retry' };
      }
      const conflict = new Error('EVENT_CREATE_RECONCILE_CONFLICT');
      conflict.code = 'event-create-reconcile-conflict';
      throw conflict;
    } catch (err) {
      if (err?.code === 'event-create-reconcile-conflict') throw err;
      pending.state = 'outcome-unknown';
      this._setEventCreateOutcomeUnknownUi(true);
      this._writeEventCreateStageError('reconcileEventCreate', err);
      return { state: 'unknown' };
    }
  },

  async _resolvePersistedSingleEventMarker(marker) {
    const pending = this._restorePendingEventCreateIntent(marker, this._eventFormSession?.generation || 0);
    if (!pending) return { state: 'unknown' };
    return await this._resolvePendingSingleEventCreate(pending);
  },

  async _authorizePendingEventCreateRetry(pending) {
    const expectedMarker = pending?.marker || this._getPendingEventCreateMarkerFromPending(pending);
    if (!expectedMarker) return false;
    const canonical = await this._loadPendingEventCreateIntent(pending.creatorUid);
    if (canonical?.state !== 'existing'
      || !this._isSamePendingEventCreateIntent(canonical.marker, expectedMarker)) {
      pending.state = 'outcome-unknown';
      this._setEventCreateOutcomeUnknownUi(true);
      return false;
    }
    return this._syncPendingEventCreateMarker(pending, canonical.marker);
  },

  async _recoverDefinitiveEventCreateRejection(pending, reason) {
    if (!this._canOfferEditableEventCreateRetry(pending)) return { state: 'unknown', reason };
    const resolution = await this._resolvePendingSingleEventCreate(pending);
    if (resolution?.state !== 'retry') return resolution;
    if (!await this._markPendingEventCreateEditable(pending)) {
      return { state: 'unknown', reason: 'pending-intent-not-canonical' };
    }
    return { state: 'editable', reason };
  },

  async _advancePendingEventCreateIntent(pending) {
    if (!pending || !this._isPendingEventCreateCurrent(pending)) return { state: 'unknown' };
    if (pending.state === 'editable-restored') {
      return { state: 'unknown', reason: 'editable-requires-original-form' };
    }
    if (pending.state === 'ready' && (!pending.attempts || pending.attempts.length === 0) && !pending.restored) {
      const firstAttempt = await this._runSingleEventCreateAttempt(pending);
      if (firstAttempt?.state === 'settled-rejected') {
        return await this._recoverDefinitiveEventCreateRejection(pending, firstAttempt.reason);
      }
      return firstAttempt;
    }
    if (pending.state === 'settled-rejected' && this._canOfferEditableEventCreateRetry(pending)) {
      const reason = [...(pending.attempts || [])]
        .reverse()
        .find(attempt => attempt.status === 'rejected')?.outcome?.reason;
      return await this._recoverDefinitiveEventCreateRejection(pending, reason);
    }
    const resolution = await this._resolvePendingSingleEventCreate(pending);
    if (resolution?.state !== 'retry') return resolution;
    if (!await this._authorizePendingEventCreateRetry(pending)) {
      return { state: 'unknown', reason: 'pending-intent-not-canonical' };
    }
    if (pending.marker.attempts.some(attempt => attempt.state === 'conflict')) {
      return { state: 'unknown', reason: 'pending-intent-conflict' };
    }
    if (this._canOfferEditableEventCreateRetry(pending)) {
      const reason = [...(pending.attempts || [])]
        .reverse()
        .find(attempt => attempt.status === 'rejected')?.outcome?.reason;
      if (await this._markPendingEventCreateEditable(pending)) {
        return { state: 'editable', reason };
      }
      return { state: 'unknown', reason: 'pending-intent-not-canonical' };
    }
    const retryAttempt = await this._runSingleEventCreateAttempt(pending);
    if (retryAttempt?.state === 'settled-rejected') {
      return await this._recoverDefinitiveEventCreateRejection(pending, retryAttempt.reason);
    }
    return retryAttempt;
  },

  async _handleRecoveredPendingEventCreate(pending, submitSession, submitToken) {
    const isCurrent = () => this._isEventFormSubmitSessionCurrent(submitSession, submitToken)
      && this._isPendingEventCreateCurrent(pending);
    try {
      const result = await this._advancePendingEventCreateIntent(pending);
      if (!isCurrent()) return { handled: true, state: 'stale' };
      if (result?.state === 'editable') {
        this._showEditableEventCreateRetry(result.reason, pending);
        return { handled: true, state: 'editable' };
      }
      if (result?.state === 'unknown') {
        this._setEventCreateOutcomeUnknownUi(true);
        this.showToast(result?.reason === 'pending-intent-not-canonical'
          ? '建立紀錄已由其他分頁更新，已停止重試；請稍後再確認'
          : (result?.reason === 'editable-requires-original-form'
            ? '此分頁無法安全還原待修正表單，已停止送出；請回原分頁繼續操作'
            : '建立結果仍在確認中，請勿重複開團；請稍後再按一次「確認建立結果」'));
        return { handled: true, state: 'unknown' };
      }
      const marker = pending.marker || this._getPendingEventCreateMarkerFromPending(pending);
      if (result?.state !== 'committed') return { handled: true, state: result?.state || 'unknown' };
      const removed = await this._removePendingEventCreateIntent(marker);
      if (!isCurrent()) return { handled: true, state: 'stale' };
      this._clearPendingSingleEventSubmission(pending);
      this._setCreateEventSubmitIdleLabel('建立活動');
      const completedGeneration = this._completeEventFormSubmitSession(submitSession, submitToken);
      if (!completedGeneration) return { handled: true, state: 'stale' };
      this.closeModal();
      const firstEvent = pending.kind === 'multi' ? pending.events?.[0] : pending.event;
      const eventCount = pending.kind === 'multi' ? Number(pending.events?.length || 0) : 1;
      const title = String(firstEvent?.title || '').trim();
      this.showToast(eventCount > 1
        ? `已確認建立 ${eventCount} 場「${title}」活動！`
        : `活動「${title}」已確認建立！`);
      if (removed) {
        try {
          ApiService._writeOpLog?.('event_create', '建立活動', `建立「${title}」`);
          if (pending.creatorUid) this._grantAutoExp?.(pending.creatorUid, 'host_activity', title);
        } catch (postErr) {
          console.warn('[handleCreateEvent] recovered post-create error:', postErr);
        }
      }
      try { this.renderActivityList(); } catch (_) {}
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderMyActivities(); } catch (_) {}
      return { handled: true, state: 'committed' };
    } catch (err) {
      if (!isCurrent()) return { handled: true, state: 'stale' };
      pending.state = 'outcome-unknown';
      this._setEventCreateOutcomeUnknownUi(true);
      this._writeEventCreateStageError('confirmPendingEventCreate', err, { kind: pending.kind });
      this.showToast(err?.code === 'event-create-reconcile-conflict'
        ? '上一筆活動建立紀錄發生衝突，已停止重試，請聯繫管理員'
        : '建立結果暫時無法確認，請檢查網路後再試');
      return { handled: true, state: 'unknown' };
    }
  },

  _setCreateEventModalMode(isEdit) {
    const titleEl = document.getElementById('ce-modal-title');
    if (!titleEl) return;
    const titleKey = isEdit ? '編輯活動' : '新增活動';
    titleEl.dataset.i18n = titleKey;
    if (typeof t === 'function') {
      const translated = t(titleKey);
      titleEl.textContent = translated === titleKey ? titleKey : translated;
    } else {
      titleEl.textContent = titleKey;
    }
  },

  _ensureCreateEventDomContract() {
    const contract = this._getCreateEventDomContract?.();
    if (!contract || contract.ok) return true;
    console.error('[EventCreate] missing required DOM ids:', contract.missing);
    this.showToast?.('活動表單載入不完整，請重新整理後再試');
    return false;
  },

  _applyCreateEventUiVariant() {
    const modal = document.getElementById('create-event-modal');
    if (!modal) return;
    modal.classList.toggle('ce-v2-enabled', this._isActivityCreateUiV2Enabled?.() !== false);
  },

  _isCourseLinkedEditMode(eventRecord = null) {
    const source = eventRecord || (this._editEventId ? ApiService.getEvent?.(this._editEventId) : null);
    return !!(source && this._isCourseLinkedEvent?.(source));
  },

  _getEventTitleInputLimit(eventRecord = null) {
    return this._isCourseLinkedEditMode?.(eventRecord) ? 120 : 16;
  },

  _setEventTitleInputLimit(eventRecord = null) {
    const titleInput = document.getElementById('ce-title');
    if (!titleInput) return;
    titleInput.maxLength = this._getEventTitleInputLimit(eventRecord);
  },

  _removeCourseLinkedTypeEditOption() {
    const typeSelect = document.getElementById('ce-type');
    if (!typeSelect) return;
    Array.from(typeSelect.options || [])
      .filter(option => option?.dataset?.courseLinkedTransient === '1')
      .forEach(option => option.remove?.());
  },

  _syncCourseLinkedTypeEditOption(eventRecord = null) {
    const typeSelect = document.getElementById('ce-type');
    if (!typeSelect) return;
    this._removeCourseLinkedTypeEditOption();
    if (!this._isCourseLinkedEditMode?.(eventRecord)) return;
    const typeValue = String(eventRecord?.type || 'course').trim() || 'course';
    const hasOption = Array.from(typeSelect.options || [])
      .some(option => String(option?.value || '') === typeValue);
    if (!hasOption) {
      const option = document.createElement('option');
      option.value = typeValue;
      option.textContent = typeValue === 'course' ? '課程' : typeValue;
      option.dataset.courseLinkedTransient = '1';
      typeSelect.appendChild(option);
    }
    typeSelect.value = typeValue;
  },

  _pruneUnchangedCourseLinkedEventFields(updates, existingEvent) {
    const next = { ...(updates || {}) };
    if (!existingEvent) return next;
    ['title', 'type', 'location', 'sportTag'].forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(next, key)) return;
      if (String(next[key] ?? '') === String(existingEvent[key] ?? '')) delete next[key];
    });
    if (Object.prototype.hasOwnProperty.call(next, 'max')) {
      const nextMax = Number(next.max);
      const previousMax = Number(existingEvent.max);
      if (Number.isFinite(nextMax) && Number.isFinite(previousMax) && nextMax === previousMax) {
        delete next.max;
      }
    }
    return next;
  },

  _applyCourseLinkedRosterUpdateResult(eventId, result = {}) {
    const transitions = [
      ...((Array.isArray(result?.promoted) ? result.promoted : []).map(item => ({ item, status: 'confirmed' }))),
      ...((Array.isArray(result?.demoted) ? result.demoted : []).map(item => ({ item, status: 'waitlisted' }))),
    ];
    if (!transitions.length || typeof FirebaseService === 'undefined') return 0;
    const source = Array.isArray(FirebaseService._cache?.registrations)
      ? FirebaseService._cache.registrations
      : [];
    let changed = 0;
    transitions.forEach(({ item, status }) => {
      const docId = String(item?.docId || item?._docId || '').trim();
      const publicId = String(item?.id || '').trim();
      const live = source.find(reg => (
        String(reg?.eventId || '').trim() === String(eventId || '').trim()
        && (
          (docId && String(reg?._docId || '').trim() === docId)
          || (publicId && String(reg?.id || '').trim() === publicId)
        )
      ));
      if (!live || live.status === status) return;
      live.status = status;
      changed++;
    });
    if (changed) FirebaseService._saveToLS?.('registrations', source);
    return changed;
  },

  _reconcileCourseLinkedRosterAfterEdit(eventId, completedGeneration = 0) {
    if (!eventId || typeof ApiService?.fetchRegistrationsIfMissing !== 'function') return;
    Promise.resolve(ApiService.fetchRegistrationsIfMissing(eventId, { force: true, timeoutMs: 8000 }))
      .catch(err => {
        console.warn('[courseLinkedEventEdit] registration reconcile failed:', err);
      })
      .then(() => {
        if (completedGeneration
          && !this._isEventFormPostSaveGenerationCurrent?.(completedGeneration)) return;
        if (this.currentPage === 'page-activity-detail' && this._currentDetailEventId === eventId) {
          this._patchDetailTables?.(eventId, { skipFetch: true });
          this._refreshSignupButton?.(eventId);
        }
      });
  },

  _canManageCourseLinkedEventDelegates(eventRecord = null) {
    const source = eventRecord || (this._editEventId ? ApiService.getEvent?.(this._editEventId) : null);
    return !!(source
      && this._isCourseLinkedEvent?.(source)
      && this._canOperatePrivateEvent?.(source)
      && this._isEventOwner?.(source));
  },

  _canSubmitCourseLinkedEventLimitedEdit(eventRecord = null) {
    const source = eventRecord || (this._editEventId ? ApiService.getEvent?.(this._editEventId) : null);
    return !!(source
      && this._isCourseLinkedEvent?.(source)
      && this._canOperatePrivateEvent?.(source)
      && (
        this._canManageEventDelegates?.(source)
        || this._canManageCourseLinkedEventDelegates?.(source)
        || this._canManageScopedActivity?.(source)
        || this._canManageAllActivities?.()
      ));
  },

  _setCourseLinkedEditControlLocked(control, locked) {
    if (!control) return;
    if (locked) {
      if (!Object.prototype.hasOwnProperty.call(control.dataset || {}, 'courseLinkedPrevDisabled')) {
        control.dataset.courseLinkedPrevDisabled = control.disabled ? '1' : '0';
      }
      control.disabled = true;
      control.setAttribute('aria-disabled', 'true');
      return;
    }
    if (Object.prototype.hasOwnProperty.call(control.dataset || {}, 'courseLinkedPrevDisabled')) {
      control.disabled = control.dataset.courseLinkedPrevDisabled === '1';
      delete control.dataset.courseLinkedPrevDisabled;
    }
    control.removeAttribute('aria-disabled');
  },

  _getCourseLinkedEditRowForElement(element) {
    if (!element) return null;
    return element.closest?.('.ce-row') || element;
  },

  _syncCourseLinkedEditNotice(modal, locked) {
    if (!modal) return;
    let notice = document.getElementById('ce-course-linked-edit-notice');
    if (!locked) {
      notice?.remove();
      return;
    }
    if (notice) return;
    const body = modal.querySelector('.ce-form-v2') || modal.querySelector('.ce-form') || modal.querySelector('.modal-body');
    if (!body) return;
    notice = document.createElement('div');
    notice.id = 'ce-course-linked-edit-notice';
    notice.className = 'ce-course-linked-edit-notice';
    notice.textContent = '\u9019\u662f\u8ab2\u7a0b\u8f49\u5316\u6d3b\u52d5\uff0c\u6642\u9593\u3001\u5730\u9ede\u3001\u540d\u984d\u3001\u6a19\u984c\u8207\u5831\u540d\u898f\u5247\u7531\u8ab2\u5802\u8cc7\u6599\u7ba1\u7406\uff1b\u672c\u8996\u7a97\u53ea\u5141\u8a31\u8abf\u6574\u79c1\u5bc6/\u516c\u958b\u72c0\u614b\u8207\u59d4\u8a17\u4eba\u3002';
    body.insertBefore(notice, body.firstChild || null);
  },

  _clearCourseLinkedEditLockState() {
    const modal = document.getElementById('create-event-modal');
    if (!modal) return;
    const wasCourseLinkedEdit = modal.classList.contains('ce-course-linked-edit');
    modal.classList.remove('ce-course-linked-edit');
    this._syncCourseLinkedEditNotice(modal, false);
    if (wasCourseLinkedEdit) {
      const valueSection = document.getElementById('ce-value-section');
      if (valueSection) valueSection.open = false;
    }
    modal.querySelectorAll('[data-course-linked-lock-control="1"]').forEach(control => {
      this._setCourseLinkedEditControlLocked(control, false);
      delete control.dataset.courseLinkedLockControl;
    });
    modal.querySelectorAll('[data-course-linked-lock-row="1"]').forEach(row => {
      row.classList.remove('ce-course-linked-locked-row');
      delete row.dataset.courseLinkedLockRow;
    });
    modal.querySelectorAll('[data-course-linked-editable-row="1"]').forEach(row => {
      row.classList.remove('ce-course-linked-editable-row');
      delete row.dataset.courseLinkedEditableRow;
    });
  },

  _applyCourseLinkedEditLockState(eventRecord = null) {
    this._clearCourseLinkedEditLockState();
  },

  async _submitCourseLinkedEventVisibilityEdit(existingEvent, nextPrivateEvent) {
    const submitSession = this._eventSubmitContext || this._captureEventFormSubmitSession();
    if (!submitSession || !this._isEventFormSubmitSessionCurrent(submitSession)) return false;
    let submitToken = this._eventSubmitToken;
    const ownsSubmitToken = !submitToken;
    if (ownsSubmitToken) submitToken = this._startEventFormSubmitSession(submitSession);
    const eventId = submitSession.editId;
    if (!submitToken || !eventId || !this._isCourseLinkedEvent?.(existingEvent)) {
      if (ownsSubmitToken) this._stopEventFormSubmitSession(submitSession, submitToken);
      return false;
    }
    const isCurrent = () => this._eventSubmitToken === submitToken
      && this._isEventFormSubmitSessionCurrent(submitSession);
    const privateEvent = !!nextPrivateEvent;
    const canManageDelegates = !!(this._canManageEventDelegates?.(existingEvent)
      || this._canManageCourseLinkedEventDelegates?.(existingEvent));
    const normalizedDelegates = (Array.isArray(this._delegates) ? this._delegates : [])
      .map(delegate => ({
        uid: String(delegate?.uid || '').trim(),
        name: String(delegate?.name || '').trim(),
      }))
      .filter(delegate => delegate.uid)
      .slice(0, 3);
    const nextDelegateUids = normalizedDelegates.map(delegate => delegate.uid);
    const previousDelegateUids = Array.isArray(existingEvent?.delegateUids)
      ? existingEvent.delegateUids.map(uid => String(uid || '').trim()).filter(Boolean)
      : [];
    const didChangeDelegates = canManageDelegates
      && previousDelegateUids.join('\u0001') !== nextDelegateUids.join('\u0001');
    const updates = {
      privateEvent,
      isPublic: !privateEvent,
    };
    if (canManageDelegates) {
      updates.delegates = normalizedDelegates;
      updates.delegateUids = nextDelegateUids;
    }
    try {
      if (!isCurrent()) return false;
      await ApiService.updateEventAwait(eventId, updates);
      if (!isCurrent()) return false;
      const updatedEvent = ApiService.getEvent?.(eventId);
      if (updatedEvent) Object.assign(updatedEvent, updates);
      const completedGeneration = this._completeEventFormSubmitSession(submitSession, submitToken);
      if (!completedGeneration) return false;
      this.closeModal?.();
      if (!this._isEventFormPostSaveGenerationCurrent(completedGeneration)) return true;
      this.showToast?.(didChangeDelegates
        ? '\u8ab2\u7a0b\u6d3b\u52d5\u59d4\u8a17\u4eba\u5df2\u66f4\u65b0'
        : (privateEvent ? '\u8ab2\u7a0b\u6d3b\u52d5\u5df2\u8a2d\u70ba\u4e0d\u516c\u958b' : '\u8ab2\u7a0b\u6d3b\u52d5\u5df2\u8a2d\u70ba\u516c\u958b'));
      try { this.renderActivityList?.(); } catch (_) {}
      try { this.renderHotEvents?.(); } catch (_) {}
      try { this.renderMyActivities?.(); } catch (_) {}
      try {
        if (this._currentDetailEventId === eventId && typeof this.showEventDetail === 'function') {
          await this.showEventDetail(eventId);
          if (!this._isEventFormPostSaveGenerationCurrent(completedGeneration)) return true;
        }
      } catch (detailRefreshErr) {
        console.warn('[courseLinkedEventVisibilityEdit] detail refresh failed:', detailRefreshErr);
      }
      return true;
    } catch (err) {
      if (!isCurrent()) return false;
      console.error('[courseLinkedEventVisibilityEdit]', err);
      if (!err?._toasted) {
        this.showToast?.('\u8ab2\u7a0b\u6d3b\u52d5\u53ea\u80fd\u8abf\u6574\u516c\u958b\u72c0\u614b\u8207\u59d4\u8a17\u4eba\uff1b\u82e5\u4ecd\u5931\u6557\uff0c\u8acb\u78ba\u8a8d\u662f\u5426\u5177\u5099\u4e3b\u8fa6\u4eba\u3001\u4ee3\u7406\u4eba\u6216\u7e3d\u7ba1\u6b0a\u9650');
      }
      return false;
    } finally {
      if (ownsSubmitToken) this._stopEventFormSubmitSession(submitSession, submitToken);
    }
  },
  _setCreateEventSubmitting(isSubmitting) {
    const modal = document.getElementById('create-event-modal');
    if (modal) {
      modal.inert = !!isSubmitting;
      if (isSubmitting) modal.setAttribute?.('aria-busy', 'true');
      else modal.removeAttribute?.('aria-busy');
    }
    const submitBtn = document.getElementById('ce-submit-btn');
    if (!submitBtn) return;
    const idleLabel = submitBtn.dataset.idleLabel || submitBtn.textContent || '建立活動';
    if (!submitBtn.dataset.idleLabel) submitBtn.dataset.idleLabel = idleLabel;
    if (isSubmitting) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.72';
      submitBtn.style.cursor = 'not-allowed';
      const isConfirmingUnknownCreate = !this._editEventId
        && (this._pendingSingleEventSubmission?.state === 'outcome-unknown'
          || this._pendingMultiDateSubmission?.state === 'outcome-unknown'
          || !!this._readPendingSingleEventMarker?.());
      submitBtn.textContent = this._editEventId
        ? '儲存中'
        : (isConfirmingUnknownCreate ? '確認中...' : '建立中...');
      return;
    }
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    submitBtn.style.cursor = '';
    submitBtn.textContent = idleLabel;
  },

  _getDefaultEventCoverUrl() {
    const version = (typeof this._getAssetVersion === 'function' && this._getAssetVersion())
      || (typeof window !== 'undefined' && typeof window.getSportHubAssetVersion === 'function'
        && window.getSportHubAssetVersion())
      || ((typeof CACHE_VERSION !== 'undefined' && CACHE_VERSION) ? CACHE_VERSION : '');
    try {
      const baseUrl = (typeof document !== 'undefined' && document.baseURI)
        || (typeof window !== 'undefined' && window.location?.href)
        || '';
      const url = new URL(this._defaultEventCoverAssetPath, baseUrl);
      if (version) url.searchParams.set('v', version);
      return url.toString();
    } catch (_) {
      const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
      return `${encodeURI(this._defaultEventCoverAssetPath)}${suffix}`;
    }
  },

  async _resolveEventCoverImage(image) {
    const currentImage = typeof image === 'string' ? image.trim() : image;
    if (currentImage) return currentImage;
    return this._getDefaultEventCoverUrl();
  },

  _getFirestoreWriteErrorMessageForUser(err, context = {}) {
    if (context?.label === 'createEvent' || context?.label === 'createEventsAtomic') {
      return this._getCreateEventWriteErrorMessage(err, context.payload);
    }
    return '';
  },

  _getCreateEventWriteErrorMessage(err, eventData = {}) {
    const code = String(err?.code || '').toLowerCase();
    const raw = String(err?.message || err || '').toLowerCase();
    const isAuthUidMismatch = code === 'auth/uid-mismatch'
      || raw.includes('auth_uid_mismatch')
      || raw.includes('uid mismatch');
    const isPermissionDenied = code === 'permission-denied'
      || raw.includes('permission-denied')
      || raw.includes('missing or insufficient permissions')
      || raw.includes('insufficient permissions');
    if (isAuthUidMismatch) {
      return '\u767b\u5165\u72c0\u614b\u4e0d\u540c\u6b65\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u5f8c\u518d\u5efa\u7acb\u6d3b\u52d5\u3002';
    }
    if (raw.includes('auth_not_ready')) {
      return '\u767b\u5165\u72c0\u614b\u5c1a\u672a\u5b8c\u6210\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\uff0c\u6216\u91cd\u65b0\u767b\u5165\u5f8c\u5efa\u7acb\u6d3b\u52d5\u3002';
    }
    if (code === 'unauthenticated' || raw.includes('unauthenticated')) {
      return '登入狀態已過期，請重新登入後再試';
    }
    if (isPermissionDenied) {
      if (eventData?.teamOnly || eventData?.isPublic || eventData?.creatorTeamId || (Array.isArray(eventData?.creatorTeamIds) && eventData.creatorTeamIds.length > 0)) {
        return '俱樂部限定活動需要俱樂部開團權限，請關閉「俱樂部限定」或聯繫管理員';
      }
      const addonLabels = this._getCreateEventAddonLabels?.(eventData) || [];
      if (addonLabels.length > 0) {
        return `你目前沒有使用「${addonLabels.join('、')}」的權限，請關閉相關進階功能後再試`;
      }
      return '權限不足，請重新登入或聯繫管理員確認開團權限';
    }
    if (code === 'deadline-exceeded' || code === 'unavailable' || raw.includes('network') || raw.includes('timeout') || raw.includes('deadline')) {
      return '連線逾時，請檢查網路後再試';
    }
    if (code === 'invalid-argument' || code === 'failed-precondition' || raw.includes('missingrequiredfields') || raw.includes('missing required')) {
      return '活動資料不完整，請檢查必填欄位後再試';
    }
    if (code === 'aborted') {
      return '建立活動時資料同步衝突，請重新整理後再試';
    }
    return '';
  },

  _getCreateEventAddonLabels(eventData = {}) {
    const labels = [];
    if (eventData?.feeEnabled || Number(eventData?.fee || 0) > 0) labels.push('費用');
    if (eventData?.teamOnly || eventData?.isPublic || eventData?.creatorTeamId || (Array.isArray(eventData?.creatorTeamIds) && eventData.creatorTeamIds.length > 0)) labels.push('俱樂部限定');
    if (eventData?.genderRestrictionEnabled || eventData?.allowedGender) labels.push('性別限制');
    if (eventData?.privateEvent) labels.push('私密活動');
    if (eventData?.teamSplit) labels.push('分隊功能');
    if (eventData?.socialLinksEnabled || (Array.isArray(eventData?.socialLinks) && eventData.socialLinks.length > 0)) labels.push('社群連結');
    if (eventData?.earlyBirdEnabled) labels.push('早鳥報名');
    if (eventData?.gpsEnabled || eventData?.mapLocationConfirmed) labels.push('GPS定位');
    return labels;
  },

  _EVENT_CHANGE_NOTIFY_FIELDS: [
    'title',
    'type',
    'location',
    'date',
    'fee',
    'feeEnabled',
    'max',
    'minAge',
    'notes',
    'sportTag',
    'regOpenTime',
    'teamOnly',
    'genderRestrictionEnabled',
    'allowedGender',
    'privateEvent',
    'creatorTeamId',
    'creatorTeamName',
    'creatorTeamIds',
    'creatorTeamNames',
    'delegateUids',
    'socialLinksEnabled',
    'socialLinks',
    'earlyBirdEnabled',
    'earlyBirdCost',
    'earlyBirdPolicyVersion',
    'gpsEnabled',
    'lat',
    'lng',
    'mapAddress',
    'mapPlaceId',
    'mapProvider',
    'mapLocationConfirmed',
    'mapLocationUpdatedAt',
  ],

  _normalizeEventChangeNotifyValue(value) {
    if (value == null) return '';
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
    if (typeof value?.toDate === 'function') {
      const date = value.toDate();
      return Number.isFinite(date?.getTime?.()) ? date.toISOString() : '';
    }
    if (Array.isArray(value)) return value.map(item => this._normalizeEventChangeNotifyValue(item));
    if (typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = this._normalizeEventChangeNotifyValue(value[key]);
        return acc;
      }, {});
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : '';
    if (typeof value === 'boolean') return value;
    return String(value || '').trim();
  },

  _getEventChangeNotifySnapshot(eventData) {
    const source = eventData || {};
    return this._EVENT_CHANGE_NOTIFY_FIELDS.reduce((acc, key) => {
      acc[key] = this._normalizeEventChangeNotifyValue(source[key]);
      return acc;
    }, {});
  },

  _hasEventChangeNotificationDiff(existingEvent, updates) {
    if (!existingEvent) return true;
    const before = this._getEventChangeNotifySnapshot(existingEvent);
    const after = this._getEventChangeNotifySnapshot({ ...existingEvent, ...(updates || {}) });
    return JSON.stringify(before) !== JSON.stringify(after);
  },

  _hashEventChangeNotifyString(text) {
    let hash = 0;
    const input = String(text || '');
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  },

  _getEventChangeNotificationDedupeKey(eventId, targetUid, eventData) {
    const snapshot = this._getEventChangeNotifySnapshot(eventData);
    const hash = this._hashEventChangeNotifyString(JSON.stringify(snapshot));
    return `event_changed:${String(eventId || '').trim()}:${String(targetUid || '').trim()}:${hash}`;
  },

  _formatCreateTimeValue(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    const hour = Math.max(0, Math.min(23, parseInt(match[1], 10) || 0));
    const minute = Math.max(0, Math.min(59, parseInt(match[2], 10) || 0));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  },

  _formatCreateDateValue(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    return `${match[1]}/${match[2]}/${match[3]}`;
  },

  _updateCreateTimeSummary() {
    const dateValue = document.getElementById('ce-date')?.value || '';
    const startValue = this._formatCreateTimeValue(document.getElementById('ce-time-start')?.value);
    const endValue = this._formatCreateTimeValue(document.getElementById('ce-time-end')?.value);
    const dateLabel = this._formatCreateDateValue(dateValue);
    const timeSummary = document.getElementById('ce-time-summary');
    if (timeSummary) {
      const datePrefix = dateLabel ? `${dateLabel} ` : '';
      timeSummary.textContent = startValue && endValue
        ? `已選時間：${datePrefix}${startValue} ～ ${endValue}`
        : '已選時間：請選擇開始與結束時間（24 小時制）';
    }

    const regSummary = document.getElementById('ce-reg-open-summary');
    if (regSummary) {
      const regOpenEnabled = this._isEventRegOpenEnabled?.() === true;
      const isMultiDate = typeof this._isMultiDateMode === 'function' && this._isMultiDateMode();
      if (!regOpenEnabled) {
        regSummary.textContent = '報名開放：建立後立即開放報名';
      } else if (isMultiDate) {
        const rel = this._getRelativeRegOpen?.() || { days: 0, hours: 0 };
        const days = Number(rel.days || 0);
        const hours = Number(rel.hours || 0);
        if (days || hours) {
          const parts = [];
          if (days) parts.push(`${days} 日`);
          if (hours) parts.push(`${hours} 小時`);
          regSummary.textContent = `報名開放：每場活動開始前 ${parts.join(' ')} 開放`;
        } else {
          regSummary.textContent = '報名開放：未指定提前時間，建立後立即開放報名';
        }
      } else {
        const regDateValue = document.getElementById('ce-reg-open-date')?.value || '';
        const regTimeValue = this._formatCreateTimeValue(document.getElementById('ce-reg-open-clock')?.value);
        const regDateLabel = this._formatCreateDateValue(regDateValue);
        if (regDateLabel && regTimeValue) {
          regSummary.textContent = `報名開放：${regDateLabel} ${regTimeValue} 後可報名`;
        } else {
          regSummary.textContent = '報名開放：請選擇完整的開放日期與時間';
        }
      }
    }
  },

  _bindCreateTimeSummary() {
    ['ce-date', 'ce-time-start', 'ce-time-end', 'ce-reg-open-date', 'ce-reg-open-clock', 'ce-reg-rel-days', 'ce-reg-rel-hours'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.timeSummaryBound === '1') return;
      el.dataset.timeSummaryBound = '1';
      el.addEventListener('input', () => this._updateCreateTimeSummary());
      el.addEventListener('change', () => this._updateCreateTimeSummary());
    });
    const regOpenToggle = document.getElementById('ce-reg-open-enabled');
    if (regOpenToggle && regOpenToggle.dataset.timeSummaryBound !== '1') {
      regOpenToggle.dataset.timeSummaryBound = '1';
      regOpenToggle.addEventListener('change', () => this._handleEventRegOpenToggle?.());
    }
    this._syncEventRegOpenTimeUI?.({ clear: false });
    this._updateCreateTimeSummary();
  },

  _activityCreateOptionsPromise: null,
  _activityCreateOptionsTimeoutMs: 12000,
  _activityRoleCapabilityRefreshPromise: null,
  _activityRoleCapabilityRefreshTimeoutMs: 8000,

  async _waitForActivityCreateDependency(promise, timeoutMs, code, message) {
    const safeTimeoutMs = Math.max(1, Number(timeoutMs) || 12000);
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message || code || 'Activity create dependency timeout');
        err.code = code || 'activity-create-dependency-timeout';
        reject(err);
      }, safeTimeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  },

  _getActivityCreateOptionMethodNames() {
    return [
      '_setEventFeeFormState',
      '_setEventRegOpenTimeValue',
      '_setGenderRestrictionState',
      '_setPrivateEventState',
      'bindEventFeeToggle',
      'bindGenderRestrictionToggle',
      'bindPrivateEventToggle',
    ];
  },

  _hasActivityCreateOptionsReady() {
    return this._getActivityCreateOptionMethodNames()
      .every(name => typeof this[name] === 'function');
  },

  async _ensureActivityCreateOptionsReady() {
    if (this._hasActivityCreateOptionsReady()) return true;
    if (typeof ScriptLoader === 'undefined' || typeof ScriptLoader.loadGroup !== 'function') {
      throw new Error('Activity create options loader unavailable');
    }

    let loadPromise = this._activityCreateOptionsPromise;
    if (!loadPromise) {
      loadPromise = ScriptLoader.loadGroup(['js/modules/event/event-create-options.js']);
      this._activityCreateOptionsPromise = loadPromise;
      void Promise.resolve(loadPromise)
        .catch(() => {})
        .finally(() => {
          if (this._activityCreateOptionsPromise === loadPromise) {
            this._activityCreateOptionsPromise = null;
          }
        });
    }

    try {
      await this._waitForActivityCreateDependency(
        loadPromise,
        this._activityCreateOptionsTimeoutMs,
        'activity-create-options-timeout',
        'Activity create options timeout'
      );
    } catch (err) {
      if (err?.code === 'activity-create-options-timeout'
        && this._activityCreateOptionsPromise === loadPromise) {
        this._activityCreateOptionsPromise = null;
      }
      throw err;
    }
    if (!this._hasActivityCreateOptionsReady()) {
      const err = new Error('Activity create options incomplete');
      err.code = 'activity-create-options-incomplete';
      throw err;
    }
    return true;
  },

  async _ensureFreshActivityRoleCapabilitiesForCreate(options = {}) {
    const canContinue = () => typeof options.entryGuard !== 'function' || options.entryGuard();
    const roleKey = this._getCurrentActivityRoleKey?.();
    if (!roleKey) {
      if (canContinue()) this.showToast?.('權限資料更新失敗，請稍後再試');
      return false;
    }
    if (roleKey !== 'user') return true;
    if (typeof this._ensureActivityRoleCapabilitiesReady !== 'function') {
      if (canContinue()) this.showToast?.('權限資料更新失敗，請稍後再試');
      return false;
    }

    let refreshPromise = this._activityRoleCapabilityRefreshPromise;
    if (!refreshPromise) {
      refreshPromise = this._ensureActivityRoleCapabilitiesReady({ force: true });
      this._activityRoleCapabilityRefreshPromise = refreshPromise;
      void Promise.resolve(refreshPromise)
        .catch(() => {})
        .finally(() => {
          if (this._activityRoleCapabilityRefreshPromise === refreshPromise) {
            this._activityRoleCapabilityRefreshPromise = null;
          }
        });
    }

    try {
      const loaded = await this._waitForActivityCreateDependency(
        refreshPromise,
        this._activityRoleCapabilityRefreshTimeoutMs,
        'activity-role-capability-timeout',
        'Activity role capability timeout'
      );
      if (!Array.isArray(loaded) || !loaded.includes('roleActivityCapabilities')) {
        if (canContinue()) this.showToast?.('權限資料更新失敗，請稍後再試');
        return false;
      }
      return true;
    } catch (err) {
      if (err?.code === 'activity-role-capability-timeout'
        && this._activityRoleCapabilityRefreshPromise === refreshPromise) {
        this._activityRoleCapabilityRefreshPromise = null;
      }
      console.error('[EventCreate] capability refresh failed:', err);
      if (canContinue()) {
        this.showToast?.(
          err?.code === 'activity-role-capability-timeout'
            ? '權限資料載入逾時，請檢查網路後再試'
            : '權限資料更新失敗，請稍後再試'
        );
      }
      return false;
    }
  },

  async openCreateEventModal(options = {}) {
    if (this._eventSubmitInFlight) {
      this.showToast?.('資料儲存中，請稍候');
      return false;
    }
    const canContinue = () => typeof options.entryGuard !== 'function' || options.entryGuard();
    if (!canContinue()) return false;
    this._beginSwLazyContinuation?.();
    try {
      // v8 M1：開 sheet 前先擋未登入（避免用戶填表單後才被踢）
      if (this._requireProtectedActionLogin?.({ type: 'createEvent' }, { suppressToast: true })) return false;
      try {
        await this._ensureActivityCreateOptionsReady();
      } catch (err) {
        if (!canContinue()) return false;
        console.error('[EventCreate] options load failed:', err);
        this.showToast?.(
          err?.code === 'activity-create-options-timeout'
            ? '活動建立功能載入逾時，請檢查網路後再試'
            : '活動建立功能載入失敗，請稍後再試'
        );
        return false;
      }
      if (!canContinue()) return false;
      if (!await this._ensureFreshActivityRoleCapabilitiesForCreate({
        entryGuard: options.entryGuard,
      })) return false;
      if (!canContinue()) return false;
      if (!this._canCreateActivityByPermission?.()) {
        this.showToast('權限不足：需要建立活動權限');
        return false;
      }
      if (this._requireActivityCreateProfileComplete?.()) return false;
      if (!canContinue()) return false;
      if (options.directCustom === true) {
        return this._openCreateCustomEventModal() === true;
      }
      // 彈底部 Action Sheet：選擇建立自訂活動或活動連結
      this._showCreateEventTypeSheet();
      return true;
    } finally {
      this._endSwLazyContinuation?.('activity-create-modal-ready');
    }
  },

  _showCreateEventTypeSheet() {
    const existing = document.getElementById('create-event-type-sheet');
    if (existing) existing.remove();
    const canCustom = !!this._canCreateBasicActivity?.();
    const canExternal = !!this._canCreateExternalActivity?.();
    if (!canCustom && !canExternal) {
      this.showToast('權限不足：需要建立活動權限');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'create-event-type-sheet';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
    const closeSheet = (trigger = 'activity-create-type-sheet-close') => {
      overlay.remove();
      this._maybeRunDeferredSwReload?.(trigger);
    };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) closeSheet();
    });

    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:var(--bg-card);border-radius:var(--radius-lg) var(--radius-lg) 0 0;width:100%;max-width:440px;padding:1rem 1rem .6rem;animation:slideUp .25s ease-out';

    sheet.innerHTML = `
      <div style="font-weight:700;font-size:.92rem;margin-bottom:.8rem;text-align:center">選擇活動類型</div>
      <button id="cets-custom" style="width:100%;padding:.7rem;margin-bottom:.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.85rem;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:.6rem">
        <span style="font-size:1.3rem">📋</span>
        <span><div>自訂活動</div><div style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-top:.15rem">建立可報名的活動（含人數、費用等設定）</div></span>
      </button>
      <button id="cets-external" aria-disabled="true" data-feature-locked="true" style="width:100%;padding:.7rem;margin-bottom:.6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-muted);font-size:.85rem;font-weight:600;cursor:not-allowed;text-align:left;display:flex;align-items:center;gap:.6rem;opacity:.62;filter:grayscale(1)">
        <span style="font-size:1.3rem">🔗</span>
        <span><div>活動連結</div><div style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-top:.15rem">連結外部平台活動，點擊直接跳轉</div></span>
      </button>
      <button id="cets-cancel" style="width:100%;padding:.55rem;border:none;border-radius:var(--radius);background:transparent;color:var(--text-muted);font-size:.82rem;cursor:pointer">取消</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const customBtn = sheet.querySelector('#cets-custom');
    const externalBtn = sheet.querySelector('#cets-external');
    if (customBtn) customBtn.style.display = canCustom ? 'flex' : 'none';
    if (externalBtn) externalBtn.style.display = 'flex';

    customBtn?.addEventListener('click', () => {
      overlay.remove();
      this._openCreateCustomEventModal();
      this._maybeRunDeferredSwReload?.('activity-create-custom-modal-open');
    });
    externalBtn?.addEventListener('click', () => {
      this.showToast('功能尚未開放');
    });
    sheet.querySelector('#cets-cancel').addEventListener('click', () => closeSheet());
  },

  _openCreateCustomEventModal() {
    if (this._eventSubmitInFlight) {
      this.showToast?.('資料儲存中，請稍候');
      return false;
    }
    if (!this._canCreateBasicActivity?.()) {
      this.showToast('權限不足：需要建立活動權限');
      return false;
    }
    if (!this._ensureCreateEventDomContract()) return false;
    const authUid = this._getEventFormAuthUid();
    const pendingSingle = this._pendingSingleEventSubmission;
    const hasPendingSingle = !!pendingSingle && pendingSingle.creatorUid === authUid;
    const pendingMulti = this._pendingMultiDateSubmission;
    const hasPendingMulti = !!pendingMulti && pendingMulti.creatorUid === authUid;
    const persistedMarker = this._readPendingSingleEventMarker(authUid);
    if (hasPendingSingle || hasPendingMulti || persistedMarker) {
      this._editEventId = null;
      const resumedSession = this._beginEventFormSession(null);
      if (hasPendingSingle) pendingSingle.generation = resumedSession.generation;
      if (hasPendingMulti) pendingMulti.generation = resumedSession.generation;
      let resumedPending = hasPendingSingle ? pendingSingle : (hasPendingMulti ? pendingMulti : null);
      if (!hasPendingSingle && !hasPendingMulti && !persistedMarker?.invalid) {
        resumedPending = this._restorePendingEventCreateIntent(persistedMarker, resumedSession.generation);
      }
      this._setCreateEventModalMode(false);
      this.showModal('create-event-modal');
      const isEditableRetry = resumedPending?.state === 'editable' && resumedPending?.restored !== true;
      if (isEditableRetry) this._setEventCreateEditableRetryUi();
      else this._setEventCreateOutcomeUnknownUi(true);
      this.showToast?.(persistedMarker?.invalid
        ? '上一筆活動建立紀錄無法驗證，已停止送出，請聯繫管理員'
        : (isEditableRetry
          ? '上一筆活動未建立成功；可修正表單後重新送出，系統會沿用原本的活動編號'
          : (resumedPending?.marker?.recoveryState === 'editable'
            ? '上一筆活動可修正重送，但此分頁無法安全還原完整表單；請回原分頁繼續操作'
            : '上一筆活動仍在確認中，請按「確認建立結果」，系統不會重複開團')));
      return true;
    }
    this._editEventId = null;
    this._beginEventFormSession(null);
    this._clearCourseLinkedEditLockState?.();
    this._eventImageVariantsData = null;
    this._delegates = [];
    this._setCreateEventModalMode(false);
    // 重置表單欄位，防止編輯後殘留資料
    this._setEventTitleInputLimit?.(null);
    this._removeCourseLinkedTypeEditOption?.();
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-type').value = 'play';
    document.getElementById('ce-location').value = '';
    this._resetEventLocationDraft?.('ce', null);
    this._bindEventLocationInputs?.('ce');
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    this._setEventFeeFormState(false, 0);
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    if (typeof this._setEventAgeLimitState === 'function') this._setEventAgeLimitState(false, 0);
    else document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-sport-tag').value = '';
    this._setEventRegOpenTimeValue('');
    document.getElementById('ce-image').value = '';
    const ceTeamOnly = document.getElementById('ce-team-only');
    const ceTeamSelect = document.getElementById('ce-team-select');
    if (ceTeamSelect) Array.from(ceTeamSelect.options || []).forEach(opt => { opt.selected = false; });
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    this._setGenderRestrictionState(false, '');
    this._setPrivateEventState(false);
    this._tsSetFormData?.(null);
    this._setEventSocialLinksFormData?.(false, []);
    this._setEventEarlyBirdFormData?.(false, 10);
    this._setEventGpsFormData?.(false);
    this._regionSetFormData?.(true, '中部', typeof REGION_MAP !== 'undefined' && REGION_MAP['中部'] ? [...REGION_MAP['中部']] : []);
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitIdleLabel('建立活動');
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindEventImageVariantUpload?.('ce-image', 'ce-upload-preview');
    this.bindTeamOnlyToggle();
    this.bindEventFeeToggle();
    this.bindEventAgeLimitToggle?.();
    this.bindGenderRestrictionToggle();
    this.bindPrivateEventToggle();
    this.bindTeamSplitToggle?.();
    this.bindEventSocialLinksToggle?.();
    this.bindEventEarlyBirdToggle?.();
    this.bindEventGpsToggle?.();
    this.bindReservedActivityAddonToggles?.();
    this.bindRegionToggle?.();
    this._bindCreateTimeSummary();
    this._resetMultiDates();
    this._initMultiDatePicker();
    this._initSportTagPicker('');
    this._applyCreateEventUiVariant();
    this._clearCourseLinkedEditLockState?.();
    this.showModal('create-event-modal');
    this._initDelegateSearch();
    void this._refreshTeamOnlyDirectoryIfOpen?.();
    this._renderHistoryChips('ce-location', 'ce-location');
    this._renderHistoryChips('ce-fee', 'ce-fee');
    this._renderHistoryChips('ce-max', 'ce-max');
    this._renderHistoryChips('ce-min-age', 'ce-min-age');
    this._renderRecentDelegateChips('ce-delegate-tags', 'ce');
    this._renderTemplateSelector();
    void this._ensureEventTemplatesReady();
    return true;
  },

  // (Fee, Gender, Team-only, Reg open time, Delegates, Sport picker, External event
  //  moved to: event-create-options.js, event-create-delegates.js,
  //  event-create-sport-picker.js, event-create-external.js,
  //  event-create-input-history.js)

  async handleCreateEvent() {
    const submitSession = this._captureEventFormSubmitSession();
    if (!submitSession) return;
    if (this._eventSubmitInFlight) {
      this.showToast('系統已在處理中');
      return;
    }
    const editEventId = submitSession.editId;
    const isEditSubmit = !!editEventId;
    const submitFormSignature = this._getEventFormSubmitSignature();
    let editablePending = null;
    let completedSessionGeneration = 0;
    let earlySubmitBusy = false;
    let submitToken = null;
    const isSubmitCurrent = () => !!submitToken
      && this._eventSubmitToken === submitToken
      && this._isEventFormSubmitSessionCurrent(submitSession)
      && this._getEventFormSubmitSignature() === submitFormSignature;
    const isSubmitSessionCurrent = () => !!submitToken
      && this._eventSubmitToken === submitToken
      && this._isEventFormSubmitSessionCurrent(submitSession);
    const isPostSaveCurrent = () => this._isEventFormPostSaveGenerationCurrent(completedSessionGeneration);
    const startEarlySubmitBusy = () => {
      if (earlySubmitBusy) return;
      submitToken = this._startEventFormSubmitSession(submitSession);
      earlySubmitBusy = !!submitToken;
    };
    const stopEarlySubmitBusy = () => {
      if (!earlySubmitBusy) return;
      earlySubmitBusy = false;
      this._stopEventFormSubmitSession(submitSession, submitToken);
    };
    startEarlySubmitBusy();
    if (!submitToken) return;
    try {
    if (!await this._ensureFreshActivityRoleCapabilitiesForCreate({ entryGuard: isSubmitCurrent })) return;
    if (!isSubmitCurrent()) return;
    const eventBeingEdited = editEventId ? ApiService.getEvent(editEventId) : null;
    const isCourseLinkedEdit = !!(editEventId && this._isCourseLinkedEvent?.(eventBeingEdited));
    const canSubmitActivity = editEventId
      ? this._canEditOwnActivityBasic?.(eventBeingEdited)
      : this._canCreateBasicActivity?.();
    if (!canSubmitActivity) {
      this.showToast('權限不足：需要建立活動權限'); return;
    }
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料（主辦人資料會寫入活動文件）
    if (this._requireProfileComplete()) return;
    const authCreatorUid = this._getEventFormAuthUid();
    const profileCreatorUid = String(ApiService.getCurrentUser?.()?.uid || '').trim();
    if (!isEditSubmit && (!authCreatorUid || !profileCreatorUid || authCreatorUid !== profileCreatorUid)) {
      const identityError = new Error('AUTH_PROFILE_UID_MISMATCH');
      identityError.code = 'auth/uid-mismatch';
      this._writeEventCreateStageError('validateCreatorIdentity', identityError);
      this.showToast('登入狀態不同步，請重新登入後再建立活動');
      return;
    }
    if (!isEditSubmit) {
      let activePending = this._pendingSingleEventSubmission || this._pendingMultiDateSubmission;
      if (activePending && activePending.creatorUid !== authCreatorUid) {
        this._setEventCreateOutcomeUnknownUi(true);
        this.showToast('上一筆活動的建立身分不同，已停止送出，請重新登入後再確認');
        return;
      }
      if (!activePending) {
        const persisted = await this._loadPendingEventCreateIntent(authCreatorUid);
        if (!isSubmitSessionCurrent()) return;
        if (persisted?.state === 'unavailable') {
          this.showToast('瀏覽器無法安全保存建立紀錄，已停止送出；請更新瀏覽器後再試');
          return;
        }
        if (persisted?.state === 'blocked' || persisted?.marker?.invalid) {
          this._setEventCreateOutcomeUnknownUi(true);
          this.showToast('上一筆活動建立紀錄無法驗證，已停止送出，請聯繫管理員');
          return;
        }
        if (persisted?.marker) {
          activePending = this._restorePendingEventCreateIntent(persisted.marker, submitSession.generation);
        }
      }
      if (activePending) {
        activePending.generation = submitSession.generation;
        if (activePending.state === 'editable' && activePending.restored !== true) {
          editablePending = activePending;
          this._setEventCreateEditableRetryUi();
        } else {
          await this._handleRecoveredPendingEventCreate(activePending, submitSession, submitToken);
          return;
        }
      }
    }
    const title = document.getElementById('ce-title').value.trim();
    const selectedType = document.getElementById('ce-type').value;
    const type = isCourseLinkedEdit && !selectedType
      ? String(eventBeingEdited?.type || 'course')
      : selectedType;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value
      || (this._multiDates && this._multiDates.length ? this._multiDates[0] : '');
    const tStart = this._formatCreateTimeValue(document.getElementById('ce-time-start').value);
    const tEnd = this._formatCreateTimeValue(document.getElementById('ce-time-end').value);
    const timeVal = (tStart && tEnd) ? `${tStart}~${tEnd}` : '';
    let feeEnabled = !!document.getElementById('ce-fee-enabled')?.checked;
    let fee = feeEnabled ? (parseInt(document.getElementById('ce-fee').value, 10) || 0) : 0;
    const parsedMax = parseInt(document.getElementById('ce-max').value, 10);
    const max = Number.isFinite(parsedMax) ? parsedMax : 20;
    const minAge = typeof this._getEventMinAgeFormValue === 'function'
      ? this._getEventMinAgeFormValue()
      : (parseInt(document.getElementById('ce-min-age').value, 10) || 0);
    const notes = document.getElementById('ce-notes').value.trim();
    const sportTag = getSportKeySafe(document.getElementById('ce-sport-tag')?.value || this._selectedSportTag || '');
    const regOpenTime = this._getEventRegOpenTimeValue();
    let teamOnly = !!document.getElementById('ce-team-only')?.checked;
    let genderRestrictionEnabled = !!document.getElementById('ce-gender-restriction-enabled')?.checked;
    let allowedGender = genderRestrictionEnabled ? this._getAllowedGenderValue() : '';
    let privateEvent = !!document.getElementById('ce-private-event')?.checked;
    if (typeof this._verifySelectedEventDelegatesForSubmit === 'function') {
      try {
        const delegatesAreValid = await this._waitForActivityCreateDependency(
          this._verifySelectedEventDelegatesForSubmit(eventBeingEdited, { submitSession }),
          this._eventCreateDelegateTimeoutMs,
          'event-create-delegate-timeout',
          'Event delegate verification timed out',
        );
        if (!isSubmitCurrent()) return;
        if (!delegatesAreValid) return;
      } catch (err) {
        if (!isSubmitSessionCurrent()) return;
        this._writeEventCreateStageError('verifyDelegates', err);
        this.showToast(err?.code === 'event-create-delegate-timeout'
          ? '委託人驗證逾時，請檢查網路後再試'
          : '委託人驗證失敗，請稍後再試');
        return;
      }
    }
    const submitDelegates = (Array.isArray(this._delegates) ? this._delegates : [])
      .map(delegate => ({
        uid: String(delegate?.uid || '').trim(),
        name: String(delegate?.name || '').trim(),
      }))
      .filter(delegate => delegate.uid);
    let teamSplitData = this._tsGetFormData?.() || null;
    let socialLinksData = this._getEventSocialLinksFormData?.({ validate: true }) || { enabled: false, links: [] };
    if (socialLinksData.error) { this.showToast(socialLinksData.error); return; }
    let socialLinksEnabled = !!socialLinksData.enabled;
    let socialLinks = Array.isArray(socialLinksData.links) ? socialLinksData.links : [];
    let earlyBirdData = this._getEventEarlyBirdFormData?.({ validate: true }) || { enabled: false, cost: 0 };
    if (earlyBirdData.error) { this.showToast(earlyBirdData.error); return; }
    let earlyBirdEnabled = !!earlyBirdData.enabled;
    let earlyBirdCost = earlyBirdEnabled ? Number(earlyBirdData.cost || 0) : 0;
    let gpsData = this._getEventGpsFormData?.() || { enabled: false };
    let gpsEnabled = !!gpsData.enabled;
    const regionData = this._regionGetFormData?.() || { regionEnabled: true, region: '', cities: [] };
    const canUseAddons = !!this._canUseActivityAddons?.(eventBeingEdited || null);
    if (!canUseAddons && (feeEnabled || teamOnly || genderRestrictionEnabled || privateEvent || teamSplitData || socialLinksEnabled || earlyBirdEnabled || gpsEnabled)) {
      this._showActivityAddonUpsellToast?.();
      feeEnabled = false;
      fee = 0;
      teamOnly = false;
      genderRestrictionEnabled = false;
      allowedGender = '';
      privateEvent = false;
      teamSplitData = null;
      socialLinksEnabled = false;
      socialLinks = [];
      earlyBirdEnabled = false;
      earlyBirdCost = 0;
      gpsEnabled = false;
    }

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    const titleLimit = this._getEventTitleInputLimit?.(eventBeingEdited) || 16;
    if (title.length > titleLimit) { this.showToast(`活動名稱不可超過 ${titleLimit} 字`); return; }
    const unchangedEmptyCourseLocation = isCourseLinkedEdit
      && !String(eventBeingEdited?.location || '').trim()
      && !location;
    if (!location && !unchangedEmptyCourseLocation) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇活動日期'); return; }
    if (!tStart || !tEnd) { this.showToast('請選擇開始與結束時間'); return; }
    if (regOpenTime === null) { this.showToast('請完整選擇開放報名日期與時間'); return; }
    if (earlyBirdEnabled) {
      if (this._isMultiDateMode?.()) {
        const rel = this._getRelativeRegOpen?.() || { days: 0, hours: 0 };
        if (!Number(rel.days || 0) && !Number(rel.hours || 0)) {
          this.showToast('早鳥報名需先設定活動開始前的開放報名時間');
          return;
        }
      } else if (!regOpenTime || new Date(regOpenTime) <= new Date()) {
        this.showToast('早鳥報名需搭配未來的開放報名時間');
        return;
      }
    }
    // 新增模式：不允許選擇過去的日期時間
    if (feeEnabled && fee <= 0) { this.showToast('請輸入活動費用'); return; }
    if (!editEventId) {
      const startDt = new Date(`${dateVal}T${tStart}`);
      if (startDt < new Date()) { this.showToast('活動開始時間不可早於現在'); return; }
    }
    if (tEnd <= tStart) { this.showToast('結束時間必須晚於開始時間'); return; }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }
    const unchangedEmptyCourseSportTag = isCourseLinkedEdit
      && !String(eventBeingEdited?.sportTag || '').trim()
      && !sportTag;
    if (!sportTag && !unchangedEmptyCourseSportTag) { this.showToast('請先選擇運動 / 場景標籤（必選）'); return; }
    if (genderRestrictionEnabled && !allowedGender) { this.showToast('請選擇限定性別'); return; }
    if (regionData.regionEnabled && !regionData.region) { this.showToast('請選擇活動地區'); return; }
    const locationPayload = this._buildEventLocationPayload?.('ce', location, { gpsEnabled }) || {};
    // 俱樂部限定：決定 teamId / teamName
    let resolvedTeamId = null, resolvedTeamName = null;
    if (teamOnly) {
      const team = this._getEventCreatorTeam();
      if (team.teamId) {
        resolvedTeamId = team.teamId;
        resolvedTeamName = team.teamName;
      } else {
        // 從下拉選單取
        const select = document.getElementById('ce-team-select');
        const selVal = select?.value;
        if (!selVal) { this.showToast('請選擇限定俱樂部'); return; }
        resolvedTeamId = selVal;
        resolvedTeamName = select.options[select.selectedIndex]?.dataset?.name || selVal;
      }
    }

    let resolvedTeamIds = [], resolvedTeamNames = [];
    if (teamOnly) {
      const selectedTeams = this._resolveTeamOnlySelection();
      if (selectedTeams.length === 0) { this.showToast('請至少選擇 1 支俱樂部'); return; }
      if (!this._isTeamOnlySelectionValidForSubmit?.(selectedTeams)) {
        this.showToast(editEventId
          ? '非總管編輯活動時不能變更限定俱樂部'
          : '非總管建立俱樂部限定活動時，只能選擇 1 支由你管理的俱樂部');
        return;
      }
      const hasOnlyTeamScopedAddon = !feeEnabled
        && !genderRestrictionEnabled
        && !privateEvent
        && !teamSplitData
        && !socialLinksEnabled
        && !earlyBirdEnabled
        && !gpsEnabled;
      if (!editEventId && !this._canCreateTeamOnlyActivityForSubmit?.(selectedTeams, { hasOnlyTeamScopedAddon })) {
        this.showToast('權限不足：無法建立此俱樂部限定活動');
        return;
      }
      resolvedTeamIds = selectedTeams.map(t => t.id);
      resolvedTeamNames = selectedTeams.map(t => t.name || t.id);
      resolvedTeamId = resolvedTeamIds[0] || null;
      resolvedTeamName = resolvedTeamNames[0] || null;
    }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    let image = ceImg ? ceImg.src : null;
    const imageVariants = (this._eventImageVariantsData && typeof this._eventImageVariantsData === 'object')
      ? { ...this._eventImageVariantsData }
      : null;
    if (imageVariants && (imageVariants.cover || imageVariants.homeNext)) {
      image = imageVariants.cover || image || imageVariants.homeNext;
    }

    const fullDate = `${dateVal.replace(/-/g, '/')} ${timeVal}`;
    const startTimestamp = new Date(`${dateVal}T${tStart}`);
    const endTimestamp = new Date(`${dateVal}T${tEnd}`);

    if (editEventId) {
      // Trigger 6：活動變更通知 — 先取得現有報名者
      const existingEvent = eventBeingEdited || ApiService.getEvent(editEventId);
      if (!this._hasActivityManageEntry?.() && !this._canManageAllActivities?.() && max > 0 && max < (Number(existingEvent?.current || 0) || 0)) {
        this.showToast('\u540d\u984d\u4e0d\u53ef\u5c0f\u65bc\u5df2\u6b63\u53d6\u4eba\u6578');
        return;
      }
      const notifyUids = this._collectEventNotifyRecipientUids
        ? this._collectEventNotifyRecipientUids(existingEvent, editEventId)
        : (() => {
          const set = new Set((ApiService.getRegistrationsByEvent(editEventId) || []).map(r => r.userId).filter(Boolean));
          if (set.size || !existingEvent) return set;
          // Phase 3 (2026-04-19): 優先從 participantsWithUid / waitlistWithUid 取真 UID（無歧義）
          const wuP = Array.isArray(existingEvent.participantsWithUid) ? existingEvent.participantsWithUid : [];
          const wuW = Array.isArray(existingEvent.waitlistWithUid) ? existingEvent.waitlistWithUid : [];
          if (wuP.length > 0 || wuW.length > 0) {
            [...wuP, ...wuW].forEach(entry => {
              if (entry && entry.uid) set.add(entry.uid);
            });
            return set;
          }
          // Fallback：舊字串陣列 + name 反查（同暱稱會挑錯）
          const nameToUid = new Map();
          (ApiService.getAdminUsers() || []).forEach(u => {
            if (!u?.name || !u?.uid) return;
            if (!nameToUid.has(u.name)) nameToUid.set(u.name, u.uid);
          });
          const allNames = [...(existingEvent.participants || []), ...(existingEvent.waitlistNames || [])];
          allNames.forEach(name => {
            const uid = nameToUid.get(name);
            if (uid) set.add(uid);
          });
          return set;
        })();

      const updates = {
        title, type, location, date: fullDate, startTimestamp, endTimestamp, fee, feeEnabled, max, minAge, notes, image, sportTag,
        regOpenTime: regOpenTime || null,
        gradient: isCourseLinkedEdit && type === String(existingEvent?.type || '')
          ? (existingEvent?.gradient || GRADIENT_MAP[type] || GRADIENT_MAP.friendly)
          : (GRADIENT_MAP[type] || GRADIENT_MAP.friendly),
        teamOnly,
        genderRestrictionEnabled,
        allowedGender,
        privateEvent,
        socialLinksEnabled,
        socialLinks,
        earlyBirdEnabled,
        earlyBirdCost,
        earlyBirdPolicyVersion: earlyBirdEnabled ? 1 : null,
        regionEnabled: regionData.regionEnabled,
        region: regionData.region,
        cities: regionData.cities,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        creatorTeamIds: teamOnly ? [...resolvedTeamIds] : [],
        creatorTeamNames: teamOnly ? [...resolvedTeamNames] : [],
        delegates: submitDelegates.map(delegate => ({ ...delegate })),
        delegateUids: submitDelegates.map(delegate => delegate.uid),
      };
      Object.assign(updates, locationPayload);
      if (imageVariants) updates.imageVariants = imageVariants;
      if (!canUseAddons) {
        [
          'fee', 'feeEnabled', 'teamOnly', 'genderRestrictionEnabled', 'allowedGender',
          'privateEvent', 'creatorTeamId', 'creatorTeamName', 'creatorTeamIds',
          'creatorTeamNames', 'teamSplit', 'socialLinksEnabled', 'socialLinks',
          'earlyBirdEnabled', 'earlyBirdCost', 'earlyBirdPolicyVersion',
          'gpsEnabled', 'lat', 'lng', 'mapAddress', 'mapPlaceId', 'mapProvider',
          'mapLocationConfirmed', 'mapLocationUpdatedAt',
        ].forEach(key => { delete updates[key]; });
      }
      if (!this._canManageAllActivities?.()) {
        ['teamOnly', 'creatorTeamId', 'creatorTeamName', 'creatorTeamIds', 'creatorTeamNames']
          .forEach(key => { delete updates[key]; });
      }
      if (!this._canManageEventDelegates?.(existingEvent)) {
        delete updates.delegates;
        delete updates.delegateUids;
      }
      if (teamSplitData) {
        updates.teamSplit = teamSplitData;
        this._recalcTeamSplitTimestamps?.(updates);
      }
      // 已結束/已取消的活動編輯時不改變狀態
      if (!this._hasActivityManageEntry?.() && !this._canManageAllActivities?.()) {
        // Owner-scope basic edit must not change lifecycle state.
      } else if (existingEvent && (existingEvent.status === 'ended' || existingEvent.status === 'cancelled')) {
        // 保持原狀態，不做任何改變
      } else if (regOpenTime && new Date(regOpenTime) > new Date()) {
        // 若有設定報名時間且尚未到達，更新狀態為 upcoming
        updates.status = 'upcoming';
      } else if (existingEvent && existingEvent.status === 'upcoming') {
        // 報名時間已到或未設定，確保不是 upcoming
        updates.status = this._isEventTrulyFull(existingEvent) ? 'full' : 'open';
      }
      const oldMax = existingEvent ? existingEvent.max : max;
      const shouldNotifyEventChange = this._hasEventChangeNotificationDiff(existingEvent, updates);
      const eventChangeNotifyData = { ...(existingEvent || {}), ...updates };
      let courseLinkedUpdateResult = null;
      let courseLinkedCallableUpdates = null;
      try {
        if (!isSubmitCurrent()) return;
        if (isCourseLinkedEdit) {
          const callableUpdates = this._pruneUnchangedCourseLinkedEventFields?.(updates, existingEvent)
            || { ...updates };
          ['startTimestamp', 'endTimestamp', 'mapLocationUpdatedAt'].forEach(key => {
            const value = callableUpdates[key];
            if (value instanceof Date) callableUpdates[key] = value.toISOString();
            else if (value && typeof value.toDate === 'function') {
              callableUpdates[key] = value.toDate().toISOString();
            }
          });
          const teamSplitLockAt = callableUpdates.teamSplit?.lockAt;
          if (teamSplitLockAt instanceof Date) {
            callableUpdates.teamSplit = {
              ...callableUpdates.teamSplit,
              lockAt: teamSplitLockAt.toISOString(),
            };
          } else if (teamSplitLockAt && typeof teamSplitLockAt.toDate === 'function') {
            callableUpdates.teamSplit = {
              ...callableUpdates.teamSplit,
              lockAt: teamSplitLockAt.toDate().toISOString(),
            };
          }
          const functionsSdk = await ensureFirebaseFunctionsSdk('asia-east1');
          if (!isSubmitCurrent()) return;
          courseLinkedCallableUpdates = callableUpdates;
          const cfResult = await functionsSdk.httpsCallable('updateCourseLinkedEvent')({
            eventId: editEventId,
            updates: callableUpdates,
          });
          courseLinkedUpdateResult = cfResult?.data || {};
          if (!isSubmitSessionCurrent()) return;
          this._applyCourseLinkedRosterUpdateResult?.(editEventId, courseLinkedUpdateResult);
        } else {
          await ApiService.updateEventAwait(editEventId, updates);
        }
        if (!isSubmitSessionCurrent()) return;
        const updatedEvent = ApiService.getEvent(editEventId);
        if (updatedEvent) {
          Object.assign(updatedEvent, isCourseLinkedEdit ? (courseLinkedCallableUpdates || {}) : updates);
          if (courseLinkedUpdateResult?.event) {
            Object.assign(updatedEvent, courseLinkedUpdateResult.event);
          }
          if (isCourseLinkedEdit) {
            updatedEvent.courseEventDetailsManagedByEvent = true;
          }
        }
      } catch (err) {
        if (!isSubmitSessionCurrent()) return;
        if (!err?._toasted) this.showToast('活動更新失敗，請重試');
        return;
      }
      const editedId = editEventId;
      this._eventImageVariantsData = null;
      completedSessionGeneration = this._completeEventFormSubmitSession(submitSession, submitToken);
      if (!completedSessionGeneration) return;
      // ── 編輯成功：先完成關鍵收尾 ──
      this.closeModal();
      if (!isPostSaveCurrent()) return;
      this.showToast(`活動「${title}」已更新！`);
      // 非關鍵操作：即使失敗也不影響用戶體驗
      try {
        if (!isCourseLinkedEdit && (this._hasActivityManageEntry?.() || this._canManageAllActivities?.())) {
          await this._adjustWaitlistOnCapacityChange(editedId, oldMax, max);
          if (!isPostSaveCurrent()) return;
        }
        if (shouldNotifyEventChange) {
          notifyUids.forEach(uid => {
            this._sendNotifFromTemplate('event_changed', {
              eventName: title, date: fullDate, location,
            }, uid, 'activity', '活動', {
              dedupeKey: this._getEventChangeNotificationDedupeKey(editedId, uid, eventChangeNotifyData),
            });
          });
        }
        ApiService._writeOpLog('event_edit', '編輯活動', `編輯「${title}」`, editedId);
      } catch (postErr) {
        console.warn('[handleCreateEvent] post-edit error:', postErr);
      }
      // 重新渲染（獨立於上方 try-catch，確保即使記錄操作失敗也能刷新列表）
      try { this.renderActivityList(); } catch (_) {}
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderMyActivities(); } catch (_) {}
      if (isCourseLinkedEdit) {
        this._reconcileCourseLinkedRosterAfterEdit?.(editedId, completedSessionGeneration);
      }
      try {
        if (this.currentPage === 'page-activity-detail'
          && this._currentDetailEventId === editedId
          && typeof this.showEventDetail === 'function') {
          await this.showEventDetail(editedId);
          if (!isPostSaveCurrent()) return;
        }
      } catch (detailRefreshErr) {
        console.warn('[handleCreateEvent] post-edit detail refresh failed:', detailRefreshErr);
      }
      try {
        await this._refreshTeamDetailAfterEventSave?.(teamOnly ? resolvedTeamIds : []);
        if (!isPostSaveCurrent()) return;
      } catch (_) {}
    } else {
      const creatorName = this._getEventCreatorName();
      const creatorUid = authCreatorUid;
      const initStatus = (regOpenTime && new Date(regOpenTime) > new Date()) ? 'upcoming' : 'open';
      let resolvedImage;
      try {
        if (!isSubmitCurrent()) return;
        resolvedImage = await this._resolveEventCoverImage(image, { entryGuard: isSubmitCurrent });
        if (!isSubmitCurrent()) return;
      } catch (_) {
        if (!isSubmitCurrent()) return;
        return;
      }
      const isMultiDateCreate = this._isMultiDateMode();
      const editableMarker = editablePending?.marker
        ? this._normalizePendingEventCreateMarker(editablePending.marker, creatorUid)
        : null;
      if (editablePending && (!editableMarker
        || (isMultiDateCreate ? 'multi' : 'single') !== editableMarker.kind)) {
        this.showToast('待重新送出的活動不能切換單日／多日期模式，請改回原模式後再試');
        return;
      }
      const candidateEventId = editableMarker
        ? (editableMarker.kind === 'multi' ? editableMarker.events[0].id : editableMarker.event.id)
        : generateId('ce_');
      const candidateEvent = {
        id: candidateEventId,
        title, type, status: initStatus, location, date: fullDate, startTimestamp, endTimestamp,
        fee, feeEnabled, max, current: 0, waitlist: 0, minAge, notes, image: resolvedImage, sportTag,
        regOpenTime: regOpenTime || null,
        creator: creatorName,
        creatorUid,
        contact: '',
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        icon: '',
        countdown: '即將開始',
        participants: [],
        waitlistNames: [],
        teamOnly,
        isPublic: !!teamOnly,
        genderRestrictionEnabled,
        allowedGender,
        privateEvent,
        socialLinksEnabled,
        socialLinks,
        earlyBirdEnabled,
        earlyBirdCost,
        earlyBirdPolicyVersion: earlyBirdEnabled ? 1 : null,
        regionEnabled: regionData.regionEnabled,
        region: regionData.region,
        cities: regionData.cities,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        creatorTeamIds: teamOnly ? [...resolvedTeamIds] : [],
        creatorTeamNames: teamOnly ? [...resolvedTeamNames] : [],
        delegates: submitDelegates.map(delegate => ({ ...delegate })),
        delegateUids: submitDelegates.map(delegate => delegate.uid),
      };
      Object.assign(candidateEvent, locationPayload);
      if (imageVariants) candidateEvent.imageVariants = imageVariants;
      if (!this._canManageEventDelegates?.(null)) {
        candidateEvent.delegates = [];
        candidateEvent.delegateUids = [];
      }
      if (teamSplitData) {
        candidateEvent.teamSplit = teamSplitData;
        this._recalcTeamSplitTimestamps?.(candidateEvent);
      }
      // ★ 多日期模式：批次建立所有場次
      let totalCreated = 1;
      let newEvent = candidateEvent;
      let pendingCreate;
      if (isMultiDateCreate) {
        const allEvents = this._buildMultiDateEvents(newEvent, tStart, tEnd);
        if (editableMarker && allEvents.length !== editableMarker.events.length) {
          this.showToast(`待重新送出的批次需保留原本 ${editableMarker.events.length} 個日期，請調整後再試`);
          return;
        }
        allEvents.forEach(event => {
          event.creatorUid = creatorUid;
          event.clientRequestId = event.id;
        });
        if (editableMarker) {
          allEvents.forEach((event, index) => {
            event.id = editableMarker.events[index].id;
            event.clientRequestId = editableMarker.events[index].clientRequestId;
            event.batchGroupId = editableMarker.batchGroupId;
          });
        }
        totalCreated = allEvents.length;
        pendingCreate = {
          kind: 'multi',
          generation: submitSession.generation,
          signature: submitFormSignature,
          creatorUid,
          events: allEvents,
          batchGroupId: String(allEvents[0]?.batchGroupId || '').trim(),
          payloadRevision: editableMarker ? editableMarker.payloadRevision + 1 : 1,
          intentRevision: editableMarker ? editableMarker.intentRevision + 1 : 1,
          recoveryState: 'frozen',
          durableAttempts: editableMarker ? editableMarker.attempts : [],
          attempts: [],
          state: 'ready',
          restored: false,
          startedAt: editableMarker ? editableMarker.startedAt : Date.now(),
        };
      } else {
        candidateEvent.clientRequestId = candidateEvent.id;
        pendingCreate = {
          kind: 'single',
          generation: submitSession.generation,
          signature: submitFormSignature,
          creatorUid,
          event: candidateEvent,
          payloadRevision: editableMarker ? editableMarker.payloadRevision + 1 : 1,
          intentRevision: editableMarker ? editableMarker.intentRevision + 1 : 1,
          recoveryState: 'frozen',
          durableAttempts: editableMarker ? editableMarker.attempts : [],
          attempts: [],
          state: 'ready',
          restored: false,
          startedAt: editableMarker ? editableMarker.startedAt : Date.now(),
        };
      }
      const candidateMarker = this._getPendingEventCreateMarkerFromPending(pendingCreate);
      if (!candidateMarker) {
        this.showToast('活動建立資料不完整，已停止送出');
        return;
      }
      const claim = editableMarker
        ? await this._replacePendingEventCreateIntent(editableMarker, candidateMarker)
        : await this._claimPendingEventCreateIntent(candidateMarker);
      if (!isSubmitSessionCurrent()) return;
      if (claim?.state === 'unavailable') {
        this.showToast('瀏覽器無法安全保存建立紀錄，已停止送出；請更新瀏覽器後再試');
        return;
      }
      if (claim?.state === 'blocked' || claim?.marker?.invalid) {
        this._setEventCreateOutcomeUnknownUi(true);
        this.showToast('上一筆活動建立紀錄無法驗證，已停止送出，請聯繫管理員');
        return;
      }
      if (editableMarker && claim?.state !== 'replaced') {
        if (claim?.marker) {
          const canonicalPending = this._restorePendingEventCreateIntent(claim.marker, submitSession.generation);
          if (canonicalPending?.state === 'editable') this._setEventCreateEditableRetryUi();
          else this._setEventCreateOutcomeUnknownUi(true);
        } else {
          this._setEventCreateOutcomeUnknownUi(true);
        }
        this.showToast('建立紀錄已由其他分頁更新，本次未送出；請確認最新內容後再試');
        return;
      }
      if (claim?.state === 'existing') {
        const recoveredPending = this._restorePendingEventCreateIntent(claim.marker, submitSession.generation);
        if (!recoveredPending) {
          this._setEventCreateOutcomeUnknownUi(true);
          this.showToast('上一筆活動建立紀錄無法恢復，已停止送出');
          return;
        }
        await this._handleRecoveredPendingEventCreate(recoveredPending, submitSession, submitToken);
        return;
      }
      if (!this._syncPendingEventCreateMarker(pendingCreate, claim.marker || candidateMarker)) {
        this.showToast('活動建立資料無法驗證，已停止送出');
        return;
      }
      if (pendingCreate.kind === 'multi') this._pendingMultiDateSubmission = pendingCreate;
      else this._pendingSingleEventSubmission = pendingCreate;
      newEvent = pendingCreate.kind === 'multi' ? pendingCreate.events[0] : pendingCreate.event;
      let didFinalizePendingCreateIntent = false;
      try {
        const createResult = await this._advancePendingEventCreateIntent(pendingCreate);
        if (!isSubmitSessionCurrent()) return;
        if (createResult?.state === 'editable') {
          this._showEditableEventCreateRetry(createResult.reason, pendingCreate);
          return;
        }
        if (createResult?.state !== 'committed') {
          this._setEventCreateOutcomeUnknownUi(true);
          this.showToast('建立結果仍在確認中，請勿重複開團；請再按一次「確認建立結果」');
          return;
        }
        didFinalizePendingCreateIntent = await this._removePendingEventCreateIntent(pendingCreate.marker);
        if (!isSubmitSessionCurrent()) return;
        this._clearPendingSingleEventSubmission(pendingCreate);
        this._setCreateEventSubmitIdleLabel('建立活動');
      } catch (err) {
        if (!isSubmitSessionCurrent()) return;
        pendingCreate.state = 'outcome-unknown';
        this._setEventCreateOutcomeUnknownUi(true);
        console.error('[handleCreateEvent:createEvent]', err);
        this._writeEventCreateStageError('createEvent', err, {
          kind: pendingCreate.kind,
          canUseAddons,
          addonLabels: this._getCreateEventAddonLabels?.(newEvent) || [],
        });
        this.showToast('建立結果暫時無法確認，請稍後再按一次「確認建立結果」');
        return;
      }
      if (!isSubmitSessionCurrent()) return;
      this._eventImageVariantsData = null;
      completedSessionGeneration = this._completeEventFormSubmitSession(submitSession, submitToken);
      if (!completedSessionGeneration) return;
      // ── 建立成功：先完成關鍵收尾（closeModal + toast），再處理非關鍵操作 ──
      this.closeModal();
      if (!isPostSaveCurrent()) return;
      const toastMsg = totalCreated > 1 ? '已建立 ' + totalCreated + ' 場「' + title + '」活動！' : '活動「' + title + '」已建立！';
      this.showToast(toastMsg);
      // 非關鍵操作：即使失敗也不影響用戶體驗
      try {
        this._saveInputHistory('ce-location', location);
        if (feeEnabled && fee > 0) this._saveInputHistory('ce-fee', fee);
        this._saveInputHistory('ce-max', max);
        if (minAge > 0) this._saveInputHistory('ce-min-age', minAge);
        this._saveRecentDelegates(submitDelegates);
        if (didFinalizePendingCreateIntent) {
          ApiService._writeOpLog('event_create', '建立活動', `建立「${title}」`);
          const _creatorUser = ApiService.getCurrentUser?.();
          if (_creatorUser?.uid) this._grantAutoExp?.(_creatorUser.uid, 'host_activity', title);
        }
      } catch (postErr) {
        console.warn('[handleCreateEvent] post-create error:', postErr);
      }
      // 重新渲染（獨立於上方 try-catch，確保即使記錄操作失敗也能刷新列表）
      try { this.renderActivityList(); } catch (_) {}
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderMyActivities(); } catch (_) {}
      try {
        await this._refreshTeamDetailAfterEventSave?.(teamOnly ? resolvedTeamIds : []);
        if (!isPostSaveCurrent()) return;
      } catch (_) {}
      // 活動建立成功後提示分享到 LINE
      if (newEvent.id && typeof this._promptShareAfterCreate === 'function') {
        const _eid = newEvent.id;
        const sharePromptGeneration = completedSessionGeneration;
        setTimeout(() => {
          if (!this._isEventFormPostSaveGenerationCurrent(sharePromptGeneration)) return;
          Promise.resolve(this._promptShareAfterCreate(_eid))
            .catch(err => console.warn('[Share] prompt failed:', err));
        }, 500);
      }
    }

    if (!isPostSaveCurrent()) return;
    // 重置表單
    this._editEventId = null;
    this._clearCourseLinkedEditLockState?.();
    this._eventImageVariantsData = null;
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    this._clearEventLocationDraft?.('ce');
    this._setEventFeeFormState(false, 0);
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    if (typeof this._setEventAgeLimitState === 'function') this._setEventAgeLimitState(false, 0);
    else document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-sport-tag').value = '';
    this._setEventRegOpenTimeValue('');
    document.getElementById('ce-image').value = '';
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    this._updateCreateTimeSummary();
    this._delegates = [];
    this._renderDelegateTags();
    this._updateDelegateInput();
    const ceTeamOnly = document.getElementById('ce-team-only');
    const ceTeamSelect = document.getElementById('ce-team-select');
    if (ceTeamSelect) Array.from(ceTeamSelect.options || []).forEach(opt => { opt.selected = false; });
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    this._setGenderRestrictionState(false, '');
    this._setPrivateEventState(false);
    this._setEventSocialLinksFormData?.(false, []);
    this._setEventEarlyBirdFormData?.(false, 10);
    this._setEventGpsFormData?.(false);
    this._resetMultiDates();
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    this._initSportTagPicker('');
    } finally {
      stopEarlySubmitBusy();
    }
  },

  /** 同步活動計數至 Firebase */
  async _syncEventToFirebase(event) {
    if (event._docId) {
      try {
        await db.collection('events').doc(event._docId).update({
          current: event.current,
          waitlist: event.waitlist,
          participants: event.participants || [],
          waitlistNames: event.waitlistNames || [],
          status: event.status,
        });
      } catch (err) {
        console.error('[syncEvent]', err);
        if (typeof this.showToast === 'function') this.showToast('活動同步失敗，請重試');
      }
    }
    // 同步本地快取到 localStorage
    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('events', FirebaseService._cache.events);
    }
  },

  // ═══════════════════════════════
  //  欄位說明彈窗
  // ═══════════════════════════════

  _ceInfoData: {
    template: {
      title: '從範本建立',
      body: '載入之前儲存的活動設定，快速填入所有欄位。載入後仍可修改任何內容。',
    },
    title: {
      title: '活動名稱',
      body: '為活動取一個簡短好懂的名稱，上限 16 字。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">例：「週三足球」、「假日友誼賽」</p>',
    },
    type: {
      title: '活動類型',
      body: '<b>PLAY</b> — 一般揪團踢球<br><b>教學</b> — 教練帶隊訓練<br><b>觀賽</b> — 觀看比賽<p style="margin:.4rem 0 0;color:var(--text-muted);font-size:.8rem">類型會影響統計分類與首頁顯示位置。</p>',
    },
    region: {
      title: '活動地區',
      body: '選擇活動所在的地區分區。用戶可透過地區頁籤快速找到該區域的活動。<br><br>• <b>北部</b>：台北、新北、基隆、桃園、新竹、宜蘭<br>• <b>中部</b>：苗栗、台中、彰化、南投、雲林<br>• <b>南部</b>：嘉義、台南、高雄、屏東<br>• <b>東部&amp;外島</b>：花蓮、台東、澎湖、金門、連江<br><br>選擇分區後，<b>至少須勾選一個縣市</b>，不可全部取消。<br><br>管理員可關閉此選項，讓活動在所有地區頁籤都顯示。'
    },
    location: {
      title: '活動地點',
      body: '輸入場地名稱或地址。系統會記住最近使用的地點，下次可直接選取。',
    },
    time: {
      title: '活動時間',
      body: '選擇日期與開始 / 結束時間。<p style="margin:.4rem 0 0">選擇<b>多個日期</b>可一次建立多場活動（批次建立），每場獨立管理報名與出席。</p>',
    },
    regOpen: {
      title: '開放報名時間',
      body: '開關預設關閉，代表活動建立後立即開放報名。<p style="margin:.3rem 0 0"><b>開啟後</b>：需填寫完整的開放日期與時間，時間未到前顯示「即將開放」。</p><p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">多日期模式下可設「活動開始前 N 天 N 時」，系統會自動為每場計算各自的開放時間。若要讓用戶在正式開放前提前報名，請到「進階功能」開啟早鳥報名。</p>',
    },
    fee: {
      title: '費用',
      body: '開啟後輸入每人費用（新台幣）。金額會顯示在活動詳情頁，方便參加者提前準備。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">關閉 = 免費活動。</p>',
    },
    max: {
      title: '人數上限',
      body: '設定最多可報名的人數。額滿後新報名者自動進入<b>候補名單</b>，有人取消時系統依報名順序自動遞補。',
    },
    age: {
      title: '年齡限制',
      body: '設定參加者的最低年齡。填 <b>0</b> 表示不限年齡。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">年齡依個人資料中的生日計算。</p>',
    },
    teamOnly: {
      title: '俱樂部限定',
      body: '開啟後，只有指定俱樂部的成員可以報名。可選擇一個或多個俱樂部。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">非成員會看到「球隊限定」無法報名。</p>',
    },
    delegate: {
      title: '委託人',
      body: '指定最多 3 位管理員協助管理此活動，包括出席確認、編輯活動與簽到掃碼。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">被委託人會收到通知，並可在「我的活動」中看到此活動。</p>',
    },
    notes: {
      title: '注意事項',
      body: '填寫活動備註，例如場地規則、攜帶物品、付款方式等。上限 500 字，會顯示在活動詳情頁。',
    },
    sport: {
      title: '運動 / 場景標籤',
      body: '選擇活動的運動類別，用於分類與篩選。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">目前支援足球，未來將開放更多運動項目。</p>',
    },
    gender: {
      title: '性別限定',
      body: '開啟後，僅限所選性別可報名。不符合的用戶會看到限制提示。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">依個人資料中的性別欄位判斷；性別空白的用戶也無法報名。</p>',
    },
    'private': {
      title: '私密活動',
      body: '開啟後活動<b>不會</b>出現在公開列表中，只有透過分享連結才能查看。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">適合內部活動或邀請制活動。</p>',
    },
    socialLinks: {
      title: '社群連結',
      body: '開啟後可放最多 5 個社群或外部連結。系統會依網址自動判斷 LINE、Facebook、Instagram、YouTube 等常見平台，並在活動詳情頁顯示成圓形連結按鈕。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">適合放社團公告、主辦社群、活動相簿或其他補充資訊。</p>',
    },
    earlyBird: {
      title: '早鳥報名',
      body: '此開關位於「進階功能」。開啟後，活動在正式開放報名前會顯示早鳥報名按鈕。用戶確認後會扣除設定積分並報名正取；活動取消時系統退回積分，用戶自行取消則不退回。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">積分範圍 10～500 分。早鳥不支援同行者，避免一人扣一次卻帶多人提前卡位。</p>',
    },
    gps: {
      title: 'GPS功能',
      body: '開啟後才可使用「設定地圖座標」，讓活動儲存精準經緯度並出現在附近活動地圖。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">關閉時，地圖座標按鈕會反灰；已設定的座標會在送出時清除，只保留一般地點文字。</p>',
    },
    teamSplit: {
      title: '分隊功能（色衣分組）',
      body: '開啟後系統會在報名流程中加入<b>隊伍分配機制</b>，讓參加者到場前就知道自己穿什麼顏色背心。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">三種模式</p>'
        + '<b>隨機分配</b> — 報名時系統自動平衡分配，適合彼此不認識的揪團。<br>'
        + '<b>自選隊伍</b> — 報名時用戶自己挑隊，適合朋友約好要同隊。<br>'
        + '<b>主辦分配</b> — 報名時不分隊，由主辦在報名名單手動安排。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">隊伍數量</p>'
        + '支援 2～4 隊，預設 2 隊（紅 vs 藍）。每隊以字母 A/B/C/D 加顏色識別，色盲用戶可透過字母辨別。'
        + '<div style="margin:.6rem 0 .3rem;padding:.55rem .7rem;border:1.5px solid var(--accent);border-radius:8px">'
        + '<div style="font-size:.8rem;font-weight:700;color:var(--accent);margin-bottom:.3rem">✅ 均分上限</div>'
        + '<div style="font-size:.75rem;margin-bottom:.35rem">勾選後系統自動計算每隊人數上限，避免隊伍人數嚴重失衡。</div>'
        + '<div style="font-size:.75rem;font-weight:600;margin-bottom:.15rem">計算方式</div>'
        + '<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.3rem">每隊上限 = 活動人數上限 ÷ 隊伍數（<b>無條件進位</b>）</div>'
        + '<div style="font-size:.75rem;font-weight:600;margin-bottom:.15rem">範例</div>'
        + '<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.25rem">'
        + '• 20 人活動 ÷ 2 隊 → 每隊上限 <b>10 人</b><br>'
        + '• 20 人活動 ÷ 3 隊 → 每隊上限 <b>7 人</b><br>'
        + '<span style="padding-left:1rem;font-size:.7rem">（20÷3=6.67 進位）</span><br>'
        + '• 15 人活動 ÷ 4 隊 → 每隊上限 <b>4 人</b><br>'
        + '<span style="padding-left:1rem;font-size:.7rem">（15÷4=3.75 進位）</span></div>'
        + '<div style="font-size:.72rem;color:var(--text-muted)">自選模式：滿隊後無法再選該隊<br>隨機模式：系統自動平衡分配</div>'
        + '</div>'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">鎖定時間（僅自選模式）</p>'
        + '活動開始前 N 小時鎖定，用戶不能再更改隊伍。主辦隨時可調。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">同行者</p>'
        + '同行者預設跟主報名人同隊，不需額外操作。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">管理操作</p>'
        + '主辦/委託人可在活動詳情頁使用三個批次按鈕：<br>'
        + '• <b>隨機</b> — 全部重新洗牌分隊<br>'
        + '• <b>補齊</b> — 只分配還沒有隊的人<br>'
        + '• <b>重置</b> — 清除所有隊伍分配'
        + '<p style="margin:.4rem 0 0;color:var(--text-muted);font-size:.8rem">不管選哪種模式，主辦隨時可在報名名單點擊色衣圖示手動調整。未開啟分隊的活動一切與現在完全相同。</p>',
    },
    saveTemplate: {
      title: '儲存為範本',
      body: '將目前填寫的活動設定儲存為範本，下次建立類似活動可直接載入。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">範本儲存在雲端，跨裝置可用，上限 30 個。</p>',
    },
  },

  _showCeInfo(type) {
    const item = this._ceInfoData[type];
    if (!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + item.title + '</div>'
      + '<div class="edu-info-dialog-body">' + item.body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem;flex-shrink:0" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
