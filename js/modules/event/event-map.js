/* ================================================
   Activity Map
   Loaded only after the user taps "尋找附近活動".
   ================================================ */

Object.assign(App, {
  _activityMapState: null,
  _activityMapGooglePromise: null,
  _activityMapGoogleMap: null,
  _activityMapGoogleMarkers: [],
  _activityMapGoogleRenderSeq: 0,
  _activityMapGoogleTileTimer: null,
  _activityMapPermissionStatus: null,

  _ensureActivityMapState() {
    if (!this._activityMapState) {
      this._activityMapState = {
        userLocation: null,
        locationStatus: 'idle',
        permissionState: 'unknown',
        radiusKm: this._getActivityMapStoredRadiusKm(),
        sportKey: this._getActivityMapStoredSportKey(),
        dateMode: this._getActivityMapStoredDateFilter().mode,
        dateStart: this._getActivityMapStoredDateFilter().start,
        dateEnd: this._getActivityMapStoredDateFilter().end,
        openedAt: 0,
      };
    }
    return this._activityMapState;
  },

  _activityMapLocationChoiceKey() {
    return 'toosterx.activityMap.locationChoice.v1';
  },

  _getActivityMapLocationChoice() {
    try {
      const value = localStorage.getItem(this._activityMapLocationChoiceKey());
      return value === 'allow' || value === 'skip' ? value : '';
    } catch (_) {
      return '';
    }
  },

  _setActivityMapLocationChoice(choice) {
    if (choice !== 'allow' && choice !== 'skip') return;
    try { localStorage.setItem(this._activityMapLocationChoiceKey(), choice); } catch (_) {}
  },

  _activityMapRadiusChoiceKey() {
    return 'toosterx.activityMap.radiusKm.v1';
  },

  _getActivityMapRadiusOptions() {
    const cfg = typeof ACTIVITY_MAP_CONFIG !== 'undefined' ? ACTIVITY_MAP_CONFIG : {};
    const raw = Array.isArray(cfg.nearRadiusOptionsKm) ? cfg.nearRadiusOptionsKm : [10, 20, 30];
    const values = raw
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 1 && value <= 100)
      .map(value => Math.round(value));
    const unique = Array.from(new Set(values));
    return unique.length ? unique : [10, 20, 30];
  },

  _getActivityMapDefaultRadiusKm() {
    const cfg = typeof ACTIVITY_MAP_CONFIG !== 'undefined' ? ACTIVITY_MAP_CONFIG : {};
    const options = this._getActivityMapRadiusOptions();
    const configured = Number(cfg.nearRadiusKm);
    if (Number.isFinite(configured) && options.includes(Math.round(configured))) {
      return Math.round(configured);
    }
    return options.includes(10) ? 10 : options[0];
  },

  _normalizeActivityMapRadiusKm(value) {
    const options = this._getActivityMapRadiusOptions();
    const radius = Math.round(Number(value));
    return options.includes(radius) ? radius : this._getActivityMapDefaultRadiusKm();
  },

  _getActivityMapStoredRadiusKm() {
    try {
      const stored = localStorage.getItem(this._activityMapRadiusChoiceKey());
      if (stored) return this._normalizeActivityMapRadiusKm(stored);
    } catch (_) {}
    return this._getActivityMapDefaultRadiusKm();
  },

  _setActivityMapStoredRadiusKm(radiusKm) {
    const radius = this._normalizeActivityMapRadiusKm(radiusKm);
    try { localStorage.setItem(this._activityMapRadiusChoiceKey(), String(radius)); } catch (_) {}
    return radius;
  },

  _getActivityMapSelectedRadiusKm() {
    const state = this._ensureActivityMapState();
    state.radiusKm = this._normalizeActivityMapRadiusKm(state.radiusKm);
    return state.radiusKm;
  },

  _renderActivityMapRadiusButtons() {
    const current = this._getActivityMapSelectedRadiusKm();
    return this._getActivityMapRadiusOptions().map(radius => {
      const active = radius === current;
      return `<button class="activity-map-radius-btn${active ? ' active' : ''}" type="button" aria-pressed="${active ? 'true' : 'false'}" onclick="App.setActivityMapRadius(${radius})">${radius}km</button>`;
    }).join('');
  },

  _updateActivityMapRadiusControls() {
    const group = document.getElementById('activity-map-radius-options');
    if (group) group.innerHTML = this._renderActivityMapRadiusButtons();
  },

  setActivityMapRadius(radiusKm) {
    const state = this._ensureActivityMapState();
    const next = this._setActivityMapStoredRadiusKm(radiusKm);
    if (state.radiusKm === next) {
      this._updateActivityMapRadiusControls();
      return next;
    }
    state.radiusKm = next;
    this._updateActivityMapRadiusControls();
    Promise.resolve(this._renderActivityMap?.()).catch(err => console.warn('[ActivityMap] radius render failed:', err));
    return next;
  },

  _activityMapSportChoiceKey() {
    return 'toosterx.activityMap.sportKey.v1';
  },

  _activityMapDateChoiceKey() {
    return 'toosterx.activityMap.dateFilter.v1';
  },

  _getActivityMapSportOptions() {
    const rawOptions = (typeof EVENT_SPORT_OPTIONS !== 'undefined' && Array.isArray(EVENT_SPORT_OPTIONS))
      ? EVENT_SPORT_OPTIONS
      : [{ key: 'football', label: '足球' }];
    const seen = new Set(['all']);
    const options = [{ key: 'all', label: '全部運動' }];
    rawOptions.forEach(item => {
      const key = String(item?.key || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push({ key, label: String(item?.label || key) });
    });
    return options;
  },

  _normalizeActivityMapSportKey(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'all') return 'all';
    const safe = typeof getSportKeySafe === 'function' ? getSportKeySafe(raw) : raw;
    return this._getActivityMapSportOptions().some(item => item.key === safe) ? safe : 'all';
  },

  _getActivityMapDefaultSportKey() {
    const active = this._activeSport || (() => {
      try { return localStorage.getItem('sporthub_active_sport') || ''; } catch (_) { return ''; }
    })();
    return this._normalizeActivityMapSportKey(active);
  },

  _getActivityMapStoredSportKey() {
    try {
      const stored = localStorage.getItem(this._activityMapSportChoiceKey());
      if (stored) return this._normalizeActivityMapSportKey(stored);
    } catch (_) {}
    return this._getActivityMapDefaultSportKey();
  },

  _setActivityMapStoredSportKey(sportKey) {
    const safe = this._normalizeActivityMapSportKey(sportKey);
    try { localStorage.setItem(this._activityMapSportChoiceKey(), safe); } catch (_) {}
    return safe;
  },

  _normalizeActivityMapDateMode(value) {
    const raw = String(value || '').trim();
    return raw === '7' || raw === '15' || raw === '30' || raw === 'custom' ? raw : 'all';
  },

  _normalizeActivityMapDateInput(value) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  },

  _getActivityMapStoredDateFilter() {
    try {
      const raw = localStorage.getItem(this._activityMapDateChoiceKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          mode: this._normalizeActivityMapDateMode(parsed?.mode),
          start: this._normalizeActivityMapDateInput(parsed?.start),
          end: this._normalizeActivityMapDateInput(parsed?.end),
        };
      }
    } catch (_) {}
    return { mode: 'all', start: '', end: '' };
  },

  _setActivityMapStoredDateFilter(filter) {
    const normalized = {
      mode: this._normalizeActivityMapDateMode(filter?.mode),
      start: this._normalizeActivityMapDateInput(filter?.start),
      end: this._normalizeActivityMapDateInput(filter?.end),
    };
    try { localStorage.setItem(this._activityMapDateChoiceKey(), JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  },

  _renderActivityMapSportOptions() {
    const state = this._ensureActivityMapState();
    const current = this._normalizeActivityMapSportKey(state.sportKey);
    return this._getActivityMapSportOptions().map(item => {
      const selected = item.key === current ? ' selected' : '';
      return `<option value="${escapeHTML(item.key)}"${selected}>${escapeHTML(item.label)}</option>`;
    }).join('');
  },

  _renderActivityMapDateModeOptions() {
    const state = this._ensureActivityMapState();
    const current = this._normalizeActivityMapDateMode(state.dateMode);
    const options = [
      { value: 'all', label: '全部未結束' },
      { value: '7', label: '7 日內' },
      { value: '15', label: '15 日內' },
      { value: '30', label: '30 日內' },
      { value: 'custom', label: '自訂區間' },
    ];
    return options.map(item => {
      const selected = item.value === current ? ' selected' : '';
      return `<option value="${escapeHTML(item.value)}"${selected}>${escapeHTML(item.label)}</option>`;
    }).join('');
  },

  _updateActivityMapFilterControls() {
    const state = this._ensureActivityMapState();
    const sportSelect = document.getElementById('activity-map-sport-filter');
    const dateSelect = document.getElementById('activity-map-date-mode');
    const custom = document.getElementById('activity-map-custom-dates');
    const start = document.getElementById('activity-map-date-start');
    const end = document.getElementById('activity-map-date-end');
    if (sportSelect) sportSelect.innerHTML = this._renderActivityMapSportOptions();
    if (dateSelect) dateSelect.innerHTML = this._renderActivityMapDateModeOptions();
    if (custom) custom.hidden = this._normalizeActivityMapDateMode(state.dateMode) !== 'custom';
    if (start) start.value = this._normalizeActivityMapDateInput(state.dateStart);
    if (end) end.value = this._normalizeActivityMapDateInput(state.dateEnd);
  },

  setActivityMapSport(sportKey) {
    const state = this._ensureActivityMapState();
    state.sportKey = this._setActivityMapStoredSportKey(sportKey);
    this._updateActivityMapFilterControls();
    Promise.resolve(this._renderActivityMap?.()).catch(err => console.warn('[ActivityMap] sport render failed:', err));
    return state.sportKey;
  },

  setActivityMapDateMode(mode) {
    const state = this._ensureActivityMapState();
    const saved = this._setActivityMapStoredDateFilter({
      mode,
      start: state.dateStart,
      end: state.dateEnd,
    });
    state.dateMode = saved.mode;
    state.dateStart = saved.start;
    state.dateEnd = saved.end;
    this._updateActivityMapFilterControls();
    Promise.resolve(this._renderActivityMap?.()).catch(err => console.warn('[ActivityMap] date mode render failed:', err));
    return state.dateMode;
  },

  setActivityMapCustomDate(which, value) {
    const state = this._ensureActivityMapState();
    const normalized = this._normalizeActivityMapDateInput(value);
    if (which === 'start') state.dateStart = normalized;
    if (which === 'end') state.dateEnd = normalized;
    const saved = this._setActivityMapStoredDateFilter({
      mode: state.dateMode,
      start: state.dateStart,
      end: state.dateEnd,
    });
    state.dateStart = saved.start;
    state.dateEnd = saved.end;
    this._updateActivityMapFilterControls();
    if (state.dateMode === 'custom') {
      Promise.resolve(this._renderActivityMap?.()).catch(err => console.warn('[ActivityMap] custom date render failed:', err));
    }
  },

  async showActivityMap() {
    if (!this._isActivityMapFeatureEnabled?.()) {
      this.showToast?.('附近活動地圖尚未開啟');
      return false;
    }

    const state = this._ensureActivityMapState();
    state.openedAt = Date.now();
    const root = this._ensureActivityMapRoot();
    root.classList.add('open');
    document.body.classList.add('activity-map-open');
    this._updateActivityMapFilterControls();
    this._renderActivityMapLoading('準備附近活動...');
    await this._syncActivityMapPermissionState();

    if (!state.userLocation && state.permissionState !== 'denied') {
      let choice = this._getActivityMapLocationChoice();
      if (!choice) choice = await this._showActivityMapLocationNotice();
      if (choice === 'allow') {
        await this.refreshActivityMapLocation({ silent: true });
      }
    } else if (!state.userLocation && state.permissionState === 'denied') {
      state.locationStatus = 'blocked';
    }

    await this._renderActivityMap();
    return true;
  },

  closeActivityMap() {
    const root = document.getElementById('activity-map-overlay');
    if (root) root.classList.remove('open');
    document.body.classList.remove('activity-map-open');
    this._clearActivityMapGoogleTileTimer();
    this._activityMapGoogleMarkers?.forEach(marker => {
      try { marker.setMap(null); } catch (_) {}
    });
    this._activityMapGoogleMarkers = [];
    this._activityMapGoogleMap = null;
    if (this._activityMapPermissionStatus) {
      try { this._activityMapPermissionStatus.onchange = null; } catch (_) {}
      this._activityMapPermissionStatus = null;
    }
  },

  _ensureActivityMapRoot() {
    let root = document.getElementById('activity-map-overlay');
    if (root && root.querySelector('#activity-map-sport-filter')) return root;
    if (root) root.remove();
    root = document.createElement('div');
    root.id = 'activity-map-overlay';
    root.className = 'activity-map-overlay';
    root.setAttribute('aria-hidden', 'false');
    root.innerHTML = `
      <div class="activity-map-panel" role="dialog" aria-modal="true" aria-label="尋找附近活動">
        <div class="activity-map-header">
          <button class="activity-map-back" type="button" onclick="App.closeActivityMap()" aria-label="返回">‹</button>
          <div>
            <div class="activity-map-title">尋找附近活動</div>
            <div class="activity-map-subtitle" id="activity-map-subtitle">依目前篩選顯示可定位活動</div>
          </div>
          <button class="activity-map-close" type="button" onclick="App.closeActivityMap()" aria-label="關閉">×</button>
        </div>
        <div class="activity-map-toolbar">
          <button id="activity-map-location-btn" class="outline-btn small activity-map-location-btn" type="button" onclick="App.reopenActivityMapLocation()">重新開啟定位</button>
          <span id="activity-map-status" class="activity-map-status"></span>
          <div class="activity-map-radius" role="group" aria-label="搜尋範圍">
            <span class="activity-map-radius-label">搜尋範圍</span>
            <span id="activity-map-radius-options" class="activity-map-radius-options"></span>
          </div>
          <div class="activity-map-filter-row">
            <label class="activity-map-filter-field">
              <span>運動</span>
              <select id="activity-map-sport-filter" aria-label="運動篩選" onchange="App.setActivityMapSport(this.value)"></select>
            </label>
            <label class="activity-map-filter-field">
              <span>日期</span>
              <select id="activity-map-date-mode" aria-label="日期範圍" onchange="App.setActivityMapDateMode(this.value)"></select>
            </label>
            <div class="activity-map-custom-dates" id="activity-map-custom-dates" hidden>
              <input id="activity-map-date-start" type="date" aria-label="開始日期" onchange="App.setActivityMapCustomDate('start', this.value)">
              <span>至</span>
              <input id="activity-map-date-end" type="date" aria-label="結束日期" onchange="App.setActivityMapCustomDate('end', this.value)">
            </div>
          </div>
        </div>
        <div class="activity-map-stage" id="activity-map-stage"></div>
        <div class="activity-map-sheet">
          <div class="activity-map-sheet-head">
            <span>附近活動</span>
            <span id="activity-map-count" class="activity-map-count">0</span>
          </div>
          <div id="activity-map-list" class="activity-map-list"></div>
        </div>
      </div>`;
    root.addEventListener('mousedown', event => {
      if (event.target === root) this.closeActivityMap();
    });
    document.body.appendChild(root);
    this._updateActivityMapRadiusControls();
    this._updateActivityMapFilterControls();
    this._updateActivityMapLocationButton();
    return root;
  },

  _renderActivityMapLoading(message) {
    const stage = document.getElementById('activity-map-stage');
    const list = document.getElementById('activity-map-list');
    const status = document.getElementById('activity-map-status');
    if (status) status.textContent = message || '';
    this._updateActivityMapLocationButton();
    if (stage) {
      stage.innerHTML = `
        <div class="activity-map-empty">
          <div class="activity-map-empty-title">${escapeHTML(message || '載入中')}</div>
        </div>`;
    }
    if (list) {
      list.innerHTML = '<div class="activity-map-list-loading">活動資料整理中...</div>';
    }
  },

  _normalizeActivityMapPermissionState(value) {
    return value === 'granted' || value === 'prompt' || value === 'denied' ? value : 'unknown';
  },

  async _syncActivityMapPermissionState() {
    const state = this._ensureActivityMapState();
    const permissions = typeof navigator !== 'undefined' ? navigator.permissions : null;
    if (!permissions || typeof permissions.query !== 'function') {
      state.permissionState = 'unknown';
      this._updateActivityMapLocationButton();
      return state.permissionState;
    }

    try {
      const status = await permissions.query({ name: 'geolocation' });
      state.permissionState = this._normalizeActivityMapPermissionState(status?.state);
      if (state.permissionState === 'denied') {
        state.userLocation = null;
        state.locationStatus = 'blocked';
      } else if (state.locationStatus === 'blocked') {
        state.locationStatus = state.userLocation ? 'ready' : 'idle';
      }
      if (this._activityMapPermissionStatus !== status && status) {
        this._activityMapPermissionStatus = status;
        status.onchange = () => {
          const latestState = this._ensureActivityMapState();
          latestState.permissionState = this._normalizeActivityMapPermissionState(status.state);
          if (latestState.permissionState === 'denied' && latestState.locationStatus !== 'requesting') {
            latestState.userLocation = null;
            latestState.locationStatus = 'blocked';
          } else if (latestState.permissionState !== 'denied' && latestState.locationStatus === 'blocked') {
            latestState.locationStatus = latestState.userLocation ? 'ready' : 'idle';
          }
          this._updateActivityMapLocationButton();
          const root = document.getElementById('activity-map-overlay');
          if (root?.classList.contains('open')) {
            Promise.resolve(this._renderActivityMap?.()).catch(err => console.warn('[ActivityMap] permission render failed:', err));
          }
        };
      }
    } catch (err) {
      state.permissionState = 'unknown';
    }
    this._updateActivityMapLocationButton();
    return state.permissionState;
  },

  _isActivityMapPermissionDeniedError(err) {
    const code = Number(err?.code);
    const name = String(err?.name || '');
    const message = String(err?.message || '');
    return code === 1 || name === 'NotAllowedError' || /permission|denied|blocked/i.test(message);
  },

  _updateActivityMapLocationButton() {
    const button = document.getElementById('activity-map-location-btn');
    if (!button) return;
    const state = this._ensureActivityMapState();
    const blocked = state.permissionState === 'denied' || state.locationStatus === 'blocked';
    const requesting = state.locationStatus === 'requesting';
    const ready = !!state.userLocation || state.permissionState === 'granted';
    button.disabled = requesting;
    button.textContent = requesting ? '定位中...' : (ready ? '更新定位' : '重新開啟定位');
    button.title = blocked
      ? '瀏覽器已封鎖定位，請到瀏覽器網站設定或系統定位權限重新開啟。'
      : '重新取得目前位置，用於排序與篩選附近活動。';
    button.dataset.permission = blocked ? 'denied' : (state.permissionState || 'unknown');
  },

  async reopenActivityMapLocation() {
    const state = this._ensureActivityMapState();
    const permissionState = await this._syncActivityMapPermissionState();
    if (permissionState === 'denied') {
      state.userLocation = null;
      state.locationStatus = 'blocked';
      this._setActivityMapLocationChoice('skip');
      this._updateActivityMapLocationButton();
      this.showToast?.('瀏覽器已封鎖定位，請到瀏覽器網站設定或系統定位權限重新開啟。');
      await this._renderActivityMap?.();
      return null;
    }
    return this.refreshActivityMapLocation({ silent: false });
  },

  async refreshActivityMapLocation(options = {}) {
    const state = this._ensureActivityMapState();
    this._setActivityMapLocationChoice('allow');
    state.locationStatus = 'requesting';
    this._updateActivityMapLocationButton();
    if (!options.silent) this._renderActivityMapLoading('正在取得定位...');
    try {
      state.userLocation = await this._requestActivityMapLocation();
      state.locationStatus = 'ready';
      state.permissionState = 'granted';
      this._updateActivityMapLocationButton();
      if (!options.silent) await this._renderActivityMap();
      return state.userLocation;
    } catch (err) {
      const blocked = this._isActivityMapPermissionDeniedError(err);
      state.locationStatus = blocked ? 'blocked' : 'failed';
      if (blocked) {
        state.userLocation = null;
        state.permissionState = 'denied';
        this._setActivityMapLocationChoice('skip');
      }
      this._updateActivityMapLocationButton();
      console.warn('[ActivityMap] geolocation failed:', err);
      if (!options.silent) {
        this.showToast?.(blocked
          ? '瀏覽器已封鎖定位，請到瀏覽器網站設定或系統定位權限重新開啟。'
          : '無法取得定位，已改用地區活動');
        await this._renderActivityMap();
      }
      return null;
    }
  },

  _requestActivityMapLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('geolocation unsupported'));
        return;
      }
      const cfg = typeof ACTIVITY_MAP_CONFIG !== 'undefined' ? ACTIVITY_MAP_CONFIG : {};
      navigator.geolocation.getCurrentPosition(
        position => {
          const coords = position && position.coords;
          const point = this._activityMapNormalizePoint?.({
            lat: coords?.latitude,
            lng: coords?.longitude,
          });
          if (!point) {
            reject(new Error('invalid geolocation'));
            return;
          }
          resolve(point);
        },
        reject,
        {
          enableHighAccuracy: false,
          timeout: Number(cfg.geolocationTimeoutMs) || 7000,
          maximumAge: Number(cfg.geolocationMaxAgeMs) || 300000,
        }
      );
    });
  },

  _showActivityMapLocationNotice() {
    return new Promise(resolve => {
      let notice = document.getElementById('activity-map-location-notice');
      if (notice) notice.remove();
      notice = document.createElement('div');
      notice.id = 'activity-map-location-notice';
      notice.className = 'activity-map-location-notice';
      notice.innerHTML = `
        <div class="activity-map-notice-card" role="dialog" aria-modal="true" aria-label="定位使用說明">
          <div class="activity-map-notice-title">允許定位來排序附近活動？</div>
          <div class="activity-map-notice-body">定位只用於排序附近活動，不會儲存你的目前位置。你也可以不開定位，先查看目前地區的活動。</div>
          <div class="activity-map-notice-actions">
            <button class="outline-btn" type="button" data-choice="skip">不用定位</button>
            <button class="primary-btn" type="button" data-choice="allow">允許定位</button>
          </div>
        </div>`;
      const finish = choice => {
        this._setActivityMapLocationChoice(choice);
        notice.remove();
        resolve(choice);
      };
      notice.addEventListener('click', event => {
        if (event.target === notice) finish('skip');
        const choice = event.target?.getAttribute?.('data-choice');
        if (choice) finish(choice);
      });
      document.body.appendChild(notice);
    });
  },

  _getActivityMapEventSportKey(event) {
    const raw = event?.sportTag || event?.sport || '';
    const safe = typeof getSportKeySafe === 'function' ? getSportKeySafe(raw) : String(raw || '').trim();
    return safe || 'football';
  },

  _filterActivityMapBySport(events) {
    const state = this._ensureActivityMapState();
    const sportKey = this._normalizeActivityMapSportKey(state.sportKey);
    state.sportKey = sportKey;
    if (sportKey === 'all') return events;
    return events.filter(event => this._getActivityMapEventSportKey(event) === sportKey);
  },

  _activityMapDateInputToTime(value, endOfDay = false) {
    const dateText = this._normalizeActivityMapDateInput(value);
    if (!dateText) return null;
    const date = new Date(`${dateText}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
  },

  _getActivityMapDateRange() {
    const state = this._ensureActivityMapState();
    const mode = this._normalizeActivityMapDateMode(state.dateMode);
    state.dateMode = mode;
    if (mode === 'all') return null;

    if (mode === 'custom') {
      const startMs = this._activityMapDateInputToTime(state.dateStart, false);
      const endMs = this._activityMapDateInputToTime(state.dateEnd, true);
      if (startMs === null && endMs === null) return null;
      if (startMs !== null && endMs !== null && startMs > endMs) {
        return { startMs: endMs, endMs: startMs };
      }
      return { startMs, endMs };
    }

    const days = Number(mode);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + Math.max(1, days) - 1);
    end.setHours(23, 59, 59, 999);
    return { startMs: start.getTime(), endMs: end.getTime() };
  },

  _filterActivityMapByDate(events) {
    const range = this._getActivityMapDateRange();
    if (!range) return events;
    return events.filter(event => {
      const date = this._parseEventStartDate?.(event?.date);
      const time = date instanceof Date ? date.getTime() : NaN;
      if (!Number.isFinite(time)) return false;
      if (range.startMs !== null && time < range.startMs) return false;
      if (range.endMs !== null && time > range.endMs) return false;
      return true;
    });
  },

  _getActivityMapCandidateEvents() {
    let events = typeof this._getVisibleEvents === 'function'
      ? this._getVisibleEvents()
      : (ApiService.getEvents?.() || []);
    events = this._filterActivityMapBySport(events);
    events = this._filterActivityMapByDate(events);

    const filterType = document.getElementById('activity-filter-type')?.value || '';
    const filterKw = (document.getElementById('activity-filter-keyword')?.value || '').trim().toLowerCase();
    if (filterType) events = events.filter(e => e.type === filterType);
    if (filterKw && typeof this._matchesActivityKeyword === 'function') {
      events = events.filter(e => this._matchesActivityKeyword(e, filterKw));
    }

    const nowDate = new Date();
    const endedHelper = typeof this._isEventInActivityEndedTab === 'function'
      ? this._isEventInActivityEndedTab.bind(this)
      : null;
    return events.filter(e => {
      const status = String(e?.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'canceled' || status === 'archived') return false;
      if (endedHelper) return !endedHelper(e, nowDate);
      return status !== 'ended';
    });
  },

  _getActivityMapData() {
    const state = this._ensureActivityMapState();
    const userLocation = state.userLocation || null;
    let events = this._getActivityMapCandidateEvents();
    if (!userLocation && this._filterByRegionTab) events = this._filterByRegionTab(events);

    const mapReady = events
      .map(event => {
        const point = this._activityMapGetEventPoint?.(event);
        if (!point) return null;
        const distance = userLocation ? this._activityMapDistanceMeters?.(userLocation, point) : null;
        return { event, point, distance };
      })
      .filter(Boolean);

    const radiusKm = this._getActivityMapSelectedRadiusKm();
    const radiusMeters = Math.max(1, radiusKm) * 1000;
    const nearby = userLocation
      ? mapReady.filter(item => item.distance !== null && item.distance <= radiusMeters)
      : mapReady;
    const displayMapItems = (userLocation ? nearby : mapReady)
      .sort((a, b) => {
        if (a.distance !== null && b.distance !== null && a.distance !== b.distance) return a.distance - b.distance;
        return this._compareActivityMapEventTime(a.event, b.event);
      });

    const fallbackEvents = events
      .filter(event => !this._activityMapGetEventPoint?.(event))
      .sort((a, b) => this._compareActivityMapEventTime(a, b));

    return {
      userLocation,
      mapReady: displayMapItems,
      fallbackEvents,
      totalCandidates: events.length,
      radiusKm,
      nearbyCount: nearby.length,
      allMapReadyCount: mapReady.length,
    };
  },

  _compareActivityMapEventTime(a, b) {
    const da = this._parseEventStartDate?.(a?.date);
    const db = this._parseEventStartDate?.(b?.date);
    return (da || 0) - (db || 0);
  },

  _getActivityMapStatusText(data) {
    const state = this._ensureActivityMapState();
    if (state.locationStatus === 'requesting') return '\u6b63\u5728\u53d6\u5f97\u5b9a\u4f4d...';
    if (state.permissionState === 'denied' || state.locationStatus === 'blocked') {
      return '\u5b9a\u4f4d\u6b0a\u9650\u5df2\u95dc\u9589\uff0c\u53ef\u7528\u6309\u9215\u67e5\u770b\u91cd\u65b0\u958b\u555f\u65b9\u5f0f\u3002';
    }
    if (data.userLocation) {
      if (data.mapReady.length) return `\u5df2\u4f7f\u7528\u76ee\u524d\u4f4d\u7f6e\uff0c\u986f\u793a ${data.radiusKm}km \u5167\u6d3b\u52d5`;
      return `${data.radiusKm}km \u5167\u66ab\u7121\u5df2\u5b9a\u4f4d\u6d3b\u52d5\uff0c\u53ef\u653e\u5bec\u641c\u5c0b\u7bc4\u570d`;
    }
    return '\u672a\u958b\u555f\u5b9a\u4f4d\uff0c\u5148\u986f\u793a\u76ee\u524d\u5730\u5340\u6d3b\u52d5';
  },
  async _renderActivityMap() {
    const data = this._getActivityMapData();
    const status = document.getElementById('activity-map-status');
    const subtitle = document.getElementById('activity-map-subtitle');
    if (status) {
      status.textContent = this._getActivityMapStatusText(data);
    }
    if (subtitle) {
      subtitle.textContent = data.mapReady.length
        ? '地圖只顯示已完成定位的活動'
        : '目前活動尚未完成地圖定位';
    }

    await this._renderActivityMapStage(data);
    this._renderActivityMapList(data);
  },

  async _renderActivityMapStage(data) {
    const stage = document.getElementById('activity-map-stage');
    if (!stage) return;
    const cfg = typeof ACTIVITY_MAP_CONFIG !== 'undefined' ? ACTIVITY_MAP_CONFIG : {};
    const apiKey = data.mapReady.length > 0
      ? await (typeof this._getActivityMapGoogleApiKey === 'function'
        ? this._getActivityMapGoogleApiKey()
        : Promise.resolve(String(cfg.googleApiKey || '').trim()))
      : '';
    if (apiKey && data.mapReady.length > 0) {
      try {
        await this._ensureGoogleMapsLoaded(apiKey);
        await this._waitForActivityMapLayout(stage);
        this._renderGoogleActivityMap(stage, data, cfg);
        return;
      } catch (err) {
        console.warn('[ActivityMap] Google Maps unavailable, using fallback:', err);
      }
    }
    this._renderStaticActivityMap(stage, data);
  },

  _ensureGoogleMapsLoaded(apiKey) {
    if (window.google?.maps) return Promise.resolve();
    if (this._activityMapGooglePromise) return this._activityMapGooglePromise;
    this._activityMapGooglePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams({
        key: apiKey,
        v: String((typeof ACTIVITY_MAP_CONFIG !== 'undefined' && ACTIVITY_MAP_CONFIG.googleMapsVersion) || 'quarterly'),
        auth_referrer_policy: 'origin',
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.referrerPolicy = 'origin';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Google Maps script failed'));
      document.head.appendChild(script);
    });
    return this._activityMapGooglePromise;
  },

  _waitForActivityMapLayout(stage) {
    return new Promise(resolve => {
      const finish = () => {
        if (!stage?.isConnected || (stage.offsetWidth > 0 && stage.offsetHeight > 0)) {
          resolve();
          return;
        }
        setTimeout(resolve, 50);
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      } else {
        setTimeout(finish, 0);
      }
    });
  },

  _clearActivityMapGoogleTileTimer() {
    if (this._activityMapGoogleTileTimer) {
      clearTimeout(this._activityMapGoogleTileTimer);
      this._activityMapGoogleTileTimer = null;
    }
  },

  _getActivityMapGoogleTileFallbackMs(cfg) {
    const value = Number(cfg?.googleTileFallbackMs);
    return Number.isFinite(value) && value >= 1000 ? value : 7000;
  },

  _getActivityMapGoogleSettleDelaysMs(cfg) {
    const values = Array.isArray(cfg?.googleLayoutSettleDelaysMs)
      ? cfg.googleLayoutSettleDelaysMs
      : [120, 450];
    return values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 0 && value <= 2000)
      .slice(0, 4);
  },

  _scheduleActivityMapGoogleSettle(map, bounds, shouldFitBounds, cfg) {
    const mapEl = map?.getDiv?.();
    const settle = () => {
      if (!mapEl?.isConnected || !window.google?.maps?.event) return;
      try {
        const center = map.getCenter?.();
        google.maps.event.trigger(map, 'resize');
        if (shouldFitBounds) {
          map.fitBounds(bounds, 48);
        } else if (center) {
          map.setCenter(center);
        }
      } catch (_) {}
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(settle);
    }
    this._getActivityMapGoogleSettleDelaysMs(cfg).forEach(delay => {
      setTimeout(settle, delay);
    });
  },

  _watchActivityMapGoogleTiles(stage, data, cfg, map) {
    this._clearActivityMapGoogleTileTimer();
    const renderSeq = ++this._activityMapGoogleRenderSeq;
    let tileReady = false;
    const clearForCurrentMap = () => {
      if (this._activityMapGoogleRenderSeq !== renderSeq) return;
      tileReady = true;
      this._clearActivityMapGoogleTileTimer();
    };

    try {
      google.maps.event.addListenerOnce(map, 'tilesloaded', clearForCurrentMap);
    } catch (_) {}

    this._activityMapGoogleTileTimer = setTimeout(() => {
      if (tileReady || this._activityMapGoogleRenderSeq !== renderSeq) return;
      const root = document.getElementById('activity-map-overlay');
      if (!stage?.isConnected || !root?.classList.contains('open')) return;
      console.warn('[ActivityMap] Google base tiles timed out, using static fallback');
      this._activityMapGoogleMarkers?.forEach(marker => {
        try { marker.setMap(null); } catch (_) {}
      });
      this._activityMapGoogleMarkers = [];
      this._activityMapGoogleMap = null;
      this._renderStaticActivityMap(stage, data);
    }, this._getActivityMapGoogleTileFallbackMs(cfg));
  },

  _renderGoogleActivityMap(stage, data, cfg) {
    stage.innerHTML = '<div id="activity-google-map" class="activity-google-map"></div>';
    const mapEl = document.getElementById('activity-google-map');
    const first = data.userLocation || data.mapReady[0]?.point || cfg.defaultCenter;
    const mapOptions = {
      center: first,
      zoom: data.userLocation ? 12 : (Number(cfg.defaultZoom) || 8),
      mapTypeId: google.maps.MapTypeId?.ROADMAP || 'roadmap',
      mapTypeControl: false,
      fullscreenControl: false,
      streetViewControl: false,
    };
    if (google.maps.RenderingType?.RASTER) {
      mapOptions.renderingType = google.maps.RenderingType.RASTER;
    }
    if (cfg.googleMapId) mapOptions.mapId = cfg.googleMapId;
    const map = new google.maps.Map(mapEl, mapOptions);
    this._activityMapGoogleMap = map;
    const bounds = new google.maps.LatLngBounds();
    this._activityMapGoogleMarkers?.forEach(marker => {
      try { marker.setMap(null); } catch (_) {}
    });
    this._activityMapGoogleMarkers = [];

    if (data.userLocation) {
      const marker = new google.maps.Marker({
        position: data.userLocation,
        map,
        title: '目前位置',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#2563eb',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      });
      this._activityMapGoogleMarkers.push(marker);
      bounds.extend(data.userLocation);
    }

    data.mapReady.forEach(item => {
      const marker = new google.maps.Marker({
        position: item.point,
        map,
        title: item.event.title || '活動',
      });
      marker.addListener('click', () => this.openActivityMapEvent(item.event.id || item.event._docId));
      this._activityMapGoogleMarkers.push(marker);
      bounds.extend(item.point);
    });
    const shouldFitBounds = data.mapReady.length > 1 || !!data.userLocation;
    if (shouldFitBounds) map.fitBounds(bounds, 48);
    this._scheduleActivityMapGoogleSettle(map, bounds, shouldFitBounds, cfg);
    this._watchActivityMapGoogleTiles(stage, data, cfg, map);
  },

  _renderStaticActivityMap(stage, data) {
    if (!data.mapReady.length) {
      const emptyTitle = data.userLocation
        ? `${data.radiusKm}km \u5167\u66ab\u7121\u5df2\u5b9a\u4f4d\u6d3b\u52d5`
        : '\u76ee\u524d\u6c92\u6709\u53ef\u986f\u793a\u5728\u5730\u5716\u4e0a\u7684\u6d3b\u52d5';
      const emptyBody = data.userLocation
        ? '\u8acb\u5207\u63db 20km \u6216 30km \u653e\u5bec\u7bc4\u570d\uff0c\u6216\u8abf\u6574\u7be9\u9078\u689d\u4ef6\u3002'
        : '\u6d3b\u52d5\u9700\u8981\u5b8c\u6210\u5834\u5730\u5b9a\u4f4d\u5f8c\u624d\u6703\u51fa\u73fe\u5728\u5730\u5716\u3002';
      stage.innerHTML = `
        <div class="activity-map-empty">
          <div class="activity-map-empty-title">${escapeHTML(emptyTitle)}</div>
          <div class="activity-map-empty-body">${escapeHTML(emptyBody)}</div>
        </div>`;
      return;
    }
    const points = data.mapReady.map(item => item.point);
    if (data.userLocation) points.push(data.userLocation);
    const bounds = this._activityMapBuildBounds?.(points);
    const markers = data.mapReady.map((item, index) => {
      const pos = this._activityMapProjectPoint?.(item.point, bounds);
      if (!pos) return '';
      const label = String(index + 1);
      return `<button class="activity-map-marker" type="button" style="left:${(pos.x * 100).toFixed(2)}%;top:${(pos.y * 100).toFixed(2)}%" onclick="App.openActivityMapEvent('${escapeHTML(item.event.id || item.event._docId || '')}')" title="${escapeHTML(item.event.title || '活動')}">${label}</button>`;
    }).join('');
    const userMarker = (() => {
      if (!data.userLocation) return '';
      const pos = this._activityMapProjectPoint?.(data.userLocation, bounds);
      if (!pos) return '';
      return `<span class="activity-map-user-marker" style="left:${(pos.x * 100).toFixed(2)}%;top:${(pos.y * 100).toFixed(2)}%" title="目前位置"></span>`;
    })();
    stage.innerHTML = `
      <div class="activity-map-static">
        <div class="activity-map-grid" aria-hidden="true"></div>
        ${markers}
        ${userMarker}
      </div>`;
  },

  _renderActivityMapList(data) {
    const count = document.getElementById('activity-map-count');
    const list = document.getElementById('activity-map-list');
    if (!list) return;
    const rows = data.mapReady.length
      ? data.mapReady.map((item, index) => this._renderActivityMapReadyCard(item, index))
      : (data.userLocation ? [] : data.fallbackEvents.slice(0, 20).map(event => this._renderActivityMapFallbackCard(event)));
    if (count) count.textContent = String(rows.length);
    const emptyText = data.userLocation
      ? `${data.radiusKm}km \u5167\u66ab\u7121\u7b26\u5408\u689d\u4ef6\u7684\u6d3b\u52d5`
      : '\u76ee\u524d\u6c92\u6709\u7b26\u5408\u689d\u4ef6\u7684\u6d3b\u52d5';
    list.innerHTML = rows.length
      ? rows.join('')
      : `<div class="activity-map-empty-list">${escapeHTML(emptyText)}</div>`;
  },
  _renderActivityMapReadyCard(item, index) {
    const event = item.event;
    const typeMap = typeof TYPE_CONFIG !== 'undefined' ? TYPE_CONFIG : {};
    const typeConf = typeMap[event.type] || typeMap.friendly || {};
    const time = String(event.date || '').split(' ')[1] || '';
    const distance = item.distance !== null ? this._activityMapFormatDistance?.(item.distance) : '';
    const stats = event.type !== 'external' && this._getEventParticipantStats ? this._getEventParticipantStats(event) : null;
    const meta = [
      typeConf.label || '活動',
      time,
      event.location || '',
      stats ? `${stats.confirmedCount}/${stats.maxCount} 人` : '',
    ].filter(Boolean).join(' · ');
    return `
      <button class="activity-map-card" type="button" onclick="App.openActivityMapEvent('${escapeHTML(event.id || event._docId || '')}')">
        <span class="activity-map-card-index">${index + 1}</span>
        <span class="activity-map-card-main">
          <span class="activity-map-card-title">${escapeHTML(event.title || '未命名活動')}</span>
          <span class="activity-map-card-meta">${escapeHTML(meta)}</span>
        </span>
        <span class="activity-map-card-distance">${escapeHTML(distance || '已定位')}</span>
      </button>`;
  },

  _renderActivityMapFallbackCard(event) {
    const typeMap = typeof TYPE_CONFIG !== 'undefined' ? TYPE_CONFIG : {};
    const typeConf = typeMap[event.type] || typeMap.friendly || {};
    const time = String(event.date || '').split(' ')[1] || '';
    const meta = [typeConf.label || '活動', time, event.location || ''].filter(Boolean).join(' · ');
    return `
      <button class="activity-map-card activity-map-card-fallback" type="button" onclick="App.openActivityMapEvent('${escapeHTML(event.id || event._docId || '')}')">
        <span class="activity-map-card-main">
          <span class="activity-map-card-title">${escapeHTML(event.title || '未命名活動')}</span>
          <span class="activity-map-card-meta">${escapeHTML(meta)}</span>
        </span>
        <span class="activity-map-card-distance">未定位</span>
      </button>`;
  },

  openActivityMapEvent(eventId) {
    if (!eventId) return;
    this.closeActivityMap();
    if (typeof this.openTimelineEventDetail === 'function') {
      this.openTimelineEventDetail(eventId);
    } else if (typeof this.showEventDetail === 'function') {
      this.showEventDetail(eventId);
    }
  },
});
