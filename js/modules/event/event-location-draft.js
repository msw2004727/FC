/* ================================================
   SportHub — Event Location Draft State
   Lightweight form state; Google/geo UI stays manual-only.
   ================================================ */

(function(root) {
  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function normalizePoint(input) {
    if (!input || typeof input !== 'object') return null;
    const lat = toFiniteNumber(input.lat ?? input.latitude);
    const lng = toFiniteNumber(input.lng ?? input.lon ?? input.longitude);
    if (lat === null || lng === null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function normalizeLocationText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function emptyDraft(locationText) {
    return {
      lat: null,
      lng: null,
      mapAddress: '',
      mapPlaceId: '',
      mapProvider: null,
      mapLocationConfirmed: false,
      mapLocationUpdatedAt: null,
      sourceLocationText: normalizeLocationText(locationText),
      isStale: false,
    };
  }

  function formatPoint(point) {
    if (!point) return '';
    return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
  }

  Object.assign(root.App, {
    _eventLocationDrafts: {},

    _getEventLocationInput(prefix) {
      return document.getElementById(`${prefix}-location`);
    },

    _getEventLocationDraft(prefix) {
      if (!this._eventLocationDrafts) this._eventLocationDrafts = {};
      if (!this._eventLocationDrafts[prefix]) {
        this._eventLocationDrafts[prefix] = emptyDraft(this._getEventLocationInput(prefix)?.value || '');
      }
      return this._eventLocationDrafts[prefix];
    },

    _setEventLocationDraft(prefix, draft) {
      if (!this._eventLocationDrafts) this._eventLocationDrafts = {};
      const point = normalizePoint(draft);
      const currentLocation = normalizeLocationText(this._getEventLocationInput(prefix)?.value || draft?.sourceLocationText || '');
      this._eventLocationDrafts[prefix] = point ? {
        lat: point.lat,
        lng: point.lng,
        mapAddress: normalizeLocationText(draft.mapAddress || currentLocation),
        mapPlaceId: normalizeLocationText(draft.mapPlaceId || ''),
        mapProvider: draft.mapProvider === 'google' ? 'google' : 'manual',
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: draft.mapLocationUpdatedAt || new Date().toISOString(),
        sourceLocationText: currentLocation,
        isStale: false,
      } : emptyDraft(currentLocation);
      this._syncEventLocationUi(prefix);
    },

    _resetEventLocationDraft(prefix, eventRecord) {
      if (!this._eventLocationDrafts) this._eventLocationDrafts = {};
      const sourceLocationText = normalizeLocationText(
        eventRecord?.location || this._getEventLocationInput(prefix)?.value || ''
      );
      const point = eventRecord?.mapLocationConfirmed === true ? normalizePoint(eventRecord) : null;
      this._eventLocationDrafts[prefix] = point ? {
        lat: point.lat,
        lng: point.lng,
        mapAddress: normalizeLocationText(eventRecord.mapAddress || sourceLocationText),
        mapPlaceId: normalizeLocationText(eventRecord.mapPlaceId || ''),
        mapProvider: eventRecord.mapProvider === 'google' ? 'google' : 'manual',
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: eventRecord.mapLocationUpdatedAt || null,
        sourceLocationText,
        isStale: false,
      } : emptyDraft(sourceLocationText);
      this._syncEventLocationUi(prefix);
    },

    _clearEventLocationDraft(prefix) {
      const currentLocation = normalizeLocationText(this._getEventLocationInput(prefix)?.value || '');
      if (!this._eventLocationDrafts) this._eventLocationDrafts = {};
      this._eventLocationDrafts[prefix] = emptyDraft(currentLocation);
      this._syncEventLocationUi(prefix);
    },

    clearEventLocationDraft(prefix) {
      this._clearEventLocationDraft(prefix || 'ce');
    },

    _bindEventLocationInputs(prefix) {
      const input = this._getEventLocationInput(prefix);
      if (!input || input.dataset.locationDraftBound === '1') {
        this._syncEventLocationUi(prefix);
        return;
      }
      input.dataset.locationDraftBound = '1';
      input.addEventListener('input', () => this._markEventLocationStaleIfNeeded(prefix));
      input.addEventListener('change', () => this._markEventLocationStaleIfNeeded(prefix));
      this._syncEventLocationUi(prefix);
    },

    _markEventLocationStaleIfNeeded(prefix) {
      const draft = this._getEventLocationDraft(prefix);
      const currentLocation = normalizeLocationText(this._getEventLocationInput(prefix)?.value || '');
      if (!draft.mapLocationConfirmed) {
        this._syncEventLocationUi(prefix);
        return;
      }
      if (currentLocation !== normalizeLocationText(draft.sourceLocationText)) {
        draft.mapLocationConfirmed = false;
        draft.isStale = true;
        draft.sourceLocationText = normalizeLocationText(draft.sourceLocationText);
      }
      this._syncEventLocationUi(prefix);
    },

    _isEventLocationPickerFeatureEnabled() {
      if (typeof isActivityMapLocationPickerEnabled === 'function') {
        return isActivityMapLocationPickerEnabled();
      }
      return false;
    },

    _syncEventLocationUi(prefix) {
      const statusEl = document.getElementById(`${prefix}-location-status`);
      const summaryEl = document.getElementById(`${prefix}-location-summary`);
      const button = document.getElementById(`${prefix}-location-btn`);
      const clearButton = document.getElementById(`${prefix}-location-clear`);
      if (!statusEl || !button) return;

      const enabled = this._isEventLocationPickerFeatureEnabled();
      const draft = this._getEventLocationDraft(prefix);
      const point = draft.mapLocationConfirmed ? normalizePoint(draft) : null;
      button.disabled = !enabled;
      button.textContent = point ? '重新設定地圖位置' : '設定地圖位置';

      if (!enabled) {
        statusEl.textContent = '地圖定位未開啟';
        statusEl.dataset.state = 'disabled';
        if (summaryEl) summaryEl.textContent = '';
        if (clearButton) clearButton.style.display = 'none';
        return;
      }

      if (point) {
        statusEl.textContent = '已設定地圖位置';
        statusEl.dataset.state = 'ready';
        if (summaryEl) summaryEl.textContent = draft.mapAddress || formatPoint(point);
        if (clearButton) clearButton.style.display = '';
        return;
      }

      if (draft.isStale) {
        statusEl.textContent = '地點文字已變更，請重新確認';
        statusEl.dataset.state = 'stale';
      } else {
        statusEl.textContent = '尚未設定地圖位置';
        statusEl.dataset.state = 'empty';
      }
      if (summaryEl) summaryEl.textContent = '';
      if (clearButton) clearButton.style.display = 'none';
    },

    _buildEventLocationPayload(prefix, locationText) {
      if (!this._isEventLocationPickerFeatureEnabled()) return {};
      const draft = this._getEventLocationDraft(prefix);
      const point = draft.mapLocationConfirmed ? normalizePoint(draft) : null;
      const currentLocation = normalizeLocationText(locationText);
      if (!point || currentLocation !== normalizeLocationText(draft.sourceLocationText)) {
        return {
          lat: null,
          lng: null,
          mapAddress: null,
          mapPlaceId: null,
          mapProvider: null,
          mapLocationConfirmed: false,
          mapLocationUpdatedAt: null,
        };
      }
      return {
        lat: point.lat,
        lng: point.lng,
        mapAddress: draft.mapAddress || currentLocation || null,
        mapPlaceId: draft.mapPlaceId || null,
        mapProvider: draft.mapProvider || 'manual',
        mapLocationConfirmed: true,
        mapLocationUpdatedAt: draft.mapLocationUpdatedAt || new Date().toISOString(),
      };
    },

    _buildEventLocationTemplatePayload(prefix, locationText) {
      return this._buildEventLocationPayload(prefix, locationText);
    },

    _restoreEventLocationTemplateDraft(prefix, template) {
      this._resetEventLocationDraft(prefix, template);
    },

    _applyEventLocationPayload(target, prefix, locationText) {
      Object.assign(target, this._buildEventLocationPayload(prefix, locationText));
      return target;
    },

    async openEventLocationPickerFor(prefix) {
      const formPrefix = prefix || 'ce';
      const input = this._getEventLocationInput(formPrefix);
      const locationText = normalizeLocationText(input?.value || '');
      if (!locationText) {
        this.showToast?.('請先輸入地點文字');
        input?.focus?.();
        return false;
      }
      if (!this._isEventLocationPickerFeatureEnabled()) {
        this.showToast?.('地圖定位功能尚未開啟');
        return false;
      }
      try {
        await ScriptLoader.ensureGroup('eventLocationPicker');
        if (typeof this.openEventLocationPicker !== 'function') {
          throw new Error('event location picker unavailable');
        }
        return await this.openEventLocationPicker({ formPrefix, locationText });
      } catch (err) {
        console.error('[EventLocation] picker load failed:', err);
        this.showToast?.('地圖定位工具載入失敗');
        return false;
      }
    },

    _eventLocationDraftTestUtils: {
      normalizePoint,
      normalizeLocationText,
      emptyDraft,
      formatPoint,
    },
  });
})(window);
