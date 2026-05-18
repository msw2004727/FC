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

  _ensureActivityMapState() {
    if (!this._activityMapState) {
      this._activityMapState = {
        userLocation: null,
        locationStatus: 'idle',
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
    this._renderActivityMapLoading('準備附近活動...');

    if (!state.userLocation) {
      let choice = this._getActivityMapLocationChoice();
      if (!choice) choice = await this._showActivityMapLocationNotice();
      if (choice === 'allow') {
        await this.refreshActivityMapLocation({ silent: true });
      }
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
  },

  _ensureActivityMapRoot() {
    let root = document.getElementById('activity-map-overlay');
    if (root) return root;
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
          <button class="outline-btn small" type="button" onclick="App.refreshActivityMapLocation()">使用定位排序</button>
          <span id="activity-map-status" class="activity-map-status"></span>
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
    return root;
  },

  _renderActivityMapLoading(message) {
    const stage = document.getElementById('activity-map-stage');
    const list = document.getElementById('activity-map-list');
    const status = document.getElementById('activity-map-status');
    if (status) status.textContent = message || '';
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

  async refreshActivityMapLocation(options = {}) {
    const state = this._ensureActivityMapState();
    this._setActivityMapLocationChoice('allow');
    state.locationStatus = 'requesting';
    if (!options.silent) this._renderActivityMapLoading('正在取得定位...');
    try {
      state.userLocation = await this._requestActivityMapLocation();
      state.locationStatus = 'ready';
      if (!options.silent) await this._renderActivityMap();
      return state.userLocation;
    } catch (err) {
      state.locationStatus = 'failed';
      console.warn('[ActivityMap] geolocation failed:', err);
      if (!options.silent) {
        this.showToast?.('無法取得定位，已改用地區活動');
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

  _getActivityMapCandidateEvents() {
    let events = typeof this._getVisibleEvents === 'function'
      ? this._getVisibleEvents()
      : (ApiService.getEvents?.() || []);
    events = this._filterBySportTag ? this._filterBySportTag(events) : events;

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

    const radiusKm = Number((typeof ACTIVITY_MAP_CONFIG !== 'undefined' && ACTIVITY_MAP_CONFIG.nearRadiusKm) || 10);
    const radiusMeters = Math.max(1, radiusKm) * 1000;
    const nearby = userLocation
      ? mapReady.filter(item => item.distance !== null && item.distance <= radiusMeters)
      : mapReady;
    const displayMapItems = (userLocation && nearby.length > 0 ? nearby : mapReady)
      .sort((a, b) => {
        if (a.distance !== null && b.distance !== null && a.distance !== b.distance) return a.distance - b.distance;
        return this._compareActivityMapEventTime(a.event, b.event);
      });

    const fallbackEvents = events
      .filter(event => !this._activityMapGetEventPoint?.(event))
      .sort((a, b) => this._compareActivityMapEventTime(a, b));

    return { userLocation, mapReady: displayMapItems, fallbackEvents, totalCandidates: events.length };
  },

  _compareActivityMapEventTime(a, b) {
    const da = this._parseEventStartDate?.(a?.date);
    const db = this._parseEventStartDate?.(b?.date);
    return (da || 0) - (db || 0);
  },

  async _renderActivityMap() {
    const data = this._getActivityMapData();
    const status = document.getElementById('activity-map-status');
    const subtitle = document.getElementById('activity-map-subtitle');
    if (status) {
      status.textContent = data.userLocation
        ? '已使用目前定位排序'
        : '未使用定位，顯示目前地區活動';
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
      stage.innerHTML = `
        <div class="activity-map-empty">
          <div class="activity-map-empty-title">目前沒有可顯示在地圖上的活動</div>
          <div class="activity-map-empty-body">活動需要完成場地定位後才會出現在地圖。下方仍可查看符合目前條件的活動。</div>
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
      : data.fallbackEvents.slice(0, 20).map(event => this._renderActivityMapFallbackCard(event));
    if (count) count.textContent = String(rows.length);
    list.innerHTML = rows.length
      ? rows.join('')
      : '<div class="activity-map-empty-list">目前沒有符合條件的活動</div>';
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
