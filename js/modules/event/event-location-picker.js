/* ================================================
   SportHub — Event Location Picker
   Manual-only module loaded after user clicks "設定地圖位置".
   ================================================ */

Object.assign(App, {
  _eventLocationGooglePromise: null,

  async openEventLocationPicker(options = {}) {
    const formPrefix = options.formPrefix || 'ce';
    const locationText = String(options.locationText || document.getElementById(`${formPrefix}-location`)?.value || '').trim();
    const draft = this._getEventLocationDraft?.(formPrefix) || {};
    this._ensureEventLocationPickerRoot();
    this._eventLocationPickerPrefix = formPrefix;
    this._eventLocationGooglePlaceId = draft.mapPlaceId || '';

    const queryEl = document.getElementById('event-location-query');
    const addressEl = document.getElementById('event-location-address');
    const latEl = document.getElementById('event-location-lat');
    const lngEl = document.getElementById('event-location-lng');
    const resultEl = document.getElementById('event-location-result');

    if (queryEl) queryEl.value = locationText;
    if (addressEl) addressEl.value = draft.mapAddress || locationText;
    if (latEl) latEl.value = Number.isFinite(Number(draft.lat)) ? String(draft.lat) : '';
    if (lngEl) lngEl.value = Number.isFinite(Number(draft.lng)) ? String(draft.lng) : '';
    if (resultEl) resultEl.textContent = '輸入座標後即可確認。若已設定 Google Maps key，也可以搜尋地點。';

    const root = document.getElementById('event-location-picker-overlay');
    root?.classList.add('open');
    document.body.classList.add('modal-open');
    return true;
  },

  closeEventLocationPicker() {
    const root = document.getElementById('event-location-picker-overlay');
    root?.classList.remove('open');
    document.body.classList.remove('modal-open');
  },

  _ensureEventLocationPickerRoot() {
    let root = document.getElementById('event-location-picker-overlay');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'event-location-picker-overlay';
    root.className = 'event-location-picker-overlay';
    root.innerHTML = `
      <div class="event-location-picker-dialog" role="dialog" aria-modal="true" aria-label="設定地圖位置">
        <div class="event-location-picker-header">
          <div>
            <div class="event-location-picker-title">設定地圖位置</div>
            <div class="event-location-picker-subtitle">確認後，此活動才會出現在附近活動地圖</div>
          </div>
          <button type="button" class="event-location-picker-close" onclick="App.closeEventLocationPicker()" aria-label="關閉">×</button>
        </div>
        <div class="event-location-picker-body">
          <label class="event-location-picker-field">
            <span>搜尋地點</span>
            <div class="event-location-search-row">
              <input type="text" id="event-location-query" placeholder="輸入場地名稱或地址">
              <button type="button" class="outline-btn small" onclick="App.searchEventLocationByAddress()">搜尋</button>
            </div>
          </label>
          <label class="event-location-picker-field">
            <span>確認地址</span>
            <input type="text" id="event-location-address" placeholder="例：台北市大安運動中心">
          </label>
          <div class="event-location-coordinate-row">
            <label class="event-location-picker-field">
              <span>緯度</span>
              <input type="number" id="event-location-lat" inputmode="decimal" step="0.000001" placeholder="25.026000">
            </label>
            <label class="event-location-picker-field">
              <span>經度</span>
              <input type="number" id="event-location-lng" inputmode="decimal" step="0.000001" placeholder="121.543000">
            </label>
          </div>
          <div id="event-location-result" class="event-location-result" aria-live="polite"></div>
          <button type="button" class="event-location-current-btn" onclick="App.useCurrentPositionForEventLocation()">用目前位置作為場地</button>
        </div>
        <div class="event-location-picker-actions">
          <button type="button" class="outline-btn" onclick="App.closeEventLocationPicker()">取消</button>
          <button type="button" class="primary-btn" onclick="App.confirmEventLocationPicker()">確認此位置</button>
        </div>
      </div>`;
    root.addEventListener('mousedown', event => {
      if (event.target === root) this.closeEventLocationPicker();
    });
    document.body.appendChild(root);
    root.querySelectorAll('#event-location-address,#event-location-lat,#event-location-lng').forEach(input => {
      input.addEventListener('input', () => {
        this._eventLocationGooglePlaceId = '';
      });
    });
    return root;
  },

  _setEventLocationPickerResult(message, state = '') {
    const resultEl = document.getElementById('event-location-result');
    if (!resultEl) return;
    resultEl.textContent = message || '';
    resultEl.dataset.state = state;
  },

  _getEventLocationPickerPoint() {
    const lat = Number(document.getElementById('event-location-lat')?.value);
    const lng = Number(document.getElementById('event-location-lng')?.value);
    const normalize = window.ActivityMapGeo?.normalizePoint || this._eventLocationDraftTestUtils?.normalizePoint;
    return normalize?.({ lat, lng }) || null;
  },

  async _ensureEventLocationGoogleMapsLoaded() {
    if (window.google?.maps?.Geocoder) return true;
    const cfg = typeof ACTIVITY_MAP_CONFIG !== 'undefined' ? ACTIVITY_MAP_CONFIG : {};
    const apiKey = String(cfg.googleApiKey || '').trim();
    if (!apiKey) return false;
    if (this._eventLocationGooglePromise) return this._eventLocationGooglePromise;
    this._eventLocationGooglePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams({ key: apiKey, v: 'weekly' });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('Google Maps script failed'));
      document.head.appendChild(script);
    }).catch(err => {
      this._eventLocationGooglePromise = null;
      throw err;
    });
    return this._eventLocationGooglePromise;
  },

  async searchEventLocationByAddress() {
    const query = String(document.getElementById('event-location-query')?.value || '').trim();
    if (!query) {
      this._setEventLocationPickerResult('請先輸入地點名稱或地址', 'error');
      return;
    }
    this._setEventLocationPickerResult('搜尋中...', 'loading');
    this._eventLocationGooglePlaceId = '';
    try {
      const loaded = await this._ensureEventLocationGoogleMapsLoaded();
      if (!loaded || !window.google?.maps?.Geocoder) {
        this._setEventLocationPickerResult('尚未設定 Google Maps key，可手動輸入座標後確認', 'muted');
        return;
      }
      const geocoder = new google.maps.Geocoder();
      const result = await new Promise((resolve, reject) => {
        geocoder.geocode({ address: query }, (results, status) => {
          if (status === 'OK' && results && results[0]) resolve(results[0]);
          else reject(new Error(status || 'NO_RESULTS'));
        });
      });
      const loc = result.geometry?.location;
      const point = loc ? { lat: loc.lat(), lng: loc.lng() } : null;
      const normalized = window.ActivityMapGeo?.normalizePoint?.(point);
      if (!normalized) throw new Error('INVALID_GEOCODE_POINT');
      document.getElementById('event-location-lat').value = normalized.lat.toFixed(6);
      document.getElementById('event-location-lng').value = normalized.lng.toFixed(6);
      document.getElementById('event-location-address').value = result.formatted_address || query;
      this._eventLocationGooglePlaceId = result.place_id || '';
      this._setEventLocationPickerResult('已帶入搜尋結果，請確認位置後儲存', 'ready');
    } catch (err) {
      console.warn('[EventLocation] geocode failed:', err);
      this._setEventLocationPickerResult('找不到可靠位置，請改用手動座標或目前位置', 'error');
    }
  },

  async useCurrentPositionForEventLocation() {
    if (!navigator.geolocation) {
      this._setEventLocationPickerResult('此裝置不支援定位，請手動輸入座標', 'error');
      return;
    }
    this._setEventLocationPickerResult('定位只會用來填入活動場地座標，不會儲存你的目前位置紀錄。取得中...', 'loading');
    const cfg = typeof ACTIVITY_MAP_CONFIG !== 'undefined' ? ACTIVITY_MAP_CONFIG : {};
    try {
      const point = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          position => {
            const normalized = window.ActivityMapGeo?.normalizePoint?.({
              lat: position?.coords?.latitude,
              lng: position?.coords?.longitude,
            });
            normalized ? resolve(normalized) : reject(new Error('invalid current location'));
          },
          reject,
          {
            enableHighAccuracy: false,
            timeout: Number(cfg.geolocationTimeoutMs) || 7000,
            maximumAge: Number(cfg.geolocationMaxAgeMs) || 300000,
          }
        );
      });
      document.getElementById('event-location-lat').value = point.lat.toFixed(6);
      document.getElementById('event-location-lng').value = point.lng.toFixed(6);
      this._setEventLocationPickerResult('已帶入目前位置，請確認這就是活動場地後儲存', 'ready');
    } catch (err) {
      console.warn('[EventLocation] current location failed:', err);
      this._setEventLocationPickerResult('無法取得目前位置，請手動輸入座標', 'error');
    }
  },

  confirmEventLocationPicker() {
    const point = this._getEventLocationPickerPoint();
    if (!point) {
      this._setEventLocationPickerResult('請輸入合法的緯度與經度', 'error');
      return;
    }
    const formPrefix = this._eventLocationPickerPrefix || 'ce';
    const locationText = String(document.getElementById(`${formPrefix}-location`)?.value || '').trim();
    const address = String(document.getElementById('event-location-address')?.value || locationText).trim();
    this._setEventLocationDraft?.(formPrefix, {
      ...point,
      mapAddress: address,
      mapPlaceId: this._eventLocationGooglePlaceId || '',
      mapProvider: this._eventLocationGooglePlaceId ? 'google' : 'manual',
      sourceLocationText: locationText,
      mapLocationUpdatedAt: new Date().toISOString(),
    });
    this._eventLocationGooglePlaceId = '';
    this.closeEventLocationPicker();
    this.showToast?.('已設定活動地圖位置');
  },
});
