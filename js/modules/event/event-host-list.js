/* === ToosterX — Event Host List (主辦方排行) === */

Object.assign(App, {

  _hostListData: null,
  _hostListDataTs: 0,
  _HOST_LIST_TTL: 24 * 60 * 60 * 1000, // 24 小時快取
  _hostListSort: { key: 'eventCount', desc: true },

  _ensureHostListOverlay() {
    var overlay = document.getElementById('host-list-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'host-list-overlay';
    overlay.className = 'host-list-overlay';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) App.closeHostList(); });
    overlay.addEventListener('touchmove', function(e) {
      if (e.target.closest('.host-list-modal')) return;
      e.preventDefault(); e.stopPropagation();
    }, { passive: false });
    overlay.innerHTML =
      '<div class="host-list-modal">' +
        '<div class="host-list-header">' +
          '<h3>主辦方排行</h3>' +
          '<span id="host-list-updated" style="font-size:.65rem;color:#94a3b8;white-space:nowrap"></span>' +
        '</div>' +
        '<div class="host-list-body" id="host-list-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  },

  async openHostList() {
    var overlay = this._ensureHostListOverlay();
    overlay.classList.add('open');
    var modal = overlay.querySelector('.host-list-modal');
    if (modal) setTimeout(function() { modal.classList.add('open'); }, 10);
    document.body.style.overflow = 'hidden';
    this._renderHostListLoading();
    await this._loadHostListData();
    this._renderHostList();
  },

  closeHostList() {
    var overlay = document.getElementById('host-list-overlay');
    if (!overlay) return;
    var modal = overlay.querySelector('.host-list-modal');
    if (modal) modal.classList.remove('open');
    setTimeout(function() { overlay.classList.remove('open'); }, 200);
    document.body.style.overflow = '';
  },

  _renderHostListLoading() {
    var body = document.getElementById('host-list-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:2.5rem;color:var(--text-muted)"><div style="width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1rem"></div>載入中...</div>';
  },

  _loadHostListCache() {
    try {
      var raw = sessionStorage.getItem('hostListCache');
      if (!raw) return false;
      var cache = JSON.parse(raw);
      if (!cache || !cache.ts || (Date.now() - cache.ts) >= this._HOST_LIST_TTL) return false;
      this._hostListData = cache.data;
      this._hostListDataTs = cache.ts;
      return true;
    } catch (_) { return false; }
  },

  _saveHostListCache() {
    try {
      sessionStorage.setItem('hostListCache', JSON.stringify({ data: this._hostListData, ts: this._hostListDataTs }));
    } catch (_) {}
  },

  async _loadHostListData() {
    // 記憶體快取
    if (this._hostListData && this._hostListData.length > 0 && (Date.now() - this._hostListDataTs) < this._HOST_LIST_TTL) {
      return;
    }
    // sessionStorage 快取（頁面重載後仍有效）
    if (this._loadHostListCache()) return;
    try {
      var events = ApiService.getEvents() || [];
      var hostMap = {};
      events.forEach(function(e) {
        var uid = e.creatorUid;
        if (!uid) return;
        if (e.type === 'external') return; // 外部活動不列入
        if (!hostMap[uid]) {
          hostMap[uid] = { uid: uid, name: e.creator || '', avatar: '', eventCount: 0, totalRegistrations: 0, attendanceRate: 0, subscriberCount: 0 };
        }
        hostMap[uid].eventCount++;
        hostMap[uid].totalRegistrations += (parseInt(e.current) || 0);
      });

      var uids = Object.keys(hostMap);
      var db = firebase.firestore();

      // 批次查用戶頭像
      for (var i = 0; i < uids.length; i += 10) {
        var batch = uids.slice(i, i + 10);
        try {
          var snap = await db.collection('users').where(firebase.firestore.FieldPath.documentId(), 'in', batch).get();
          snap.forEach(function(doc) {
            var data = doc.data();
            if (hostMap[doc.id]) {
              hostMap[doc.id].avatar = data.pictureUrl || data.avatar || '';
              hostMap[doc.id].name = data.displayName || data.name || hostMap[doc.id].name;
            }
          });
        } catch (_) {}
      }

      // 出席率 = (正取人數 - 放鴿子次數) / 正取人數 × 100
      // 正取人數 = 各已結束活動的 event.current 加總
      // 放鴿子 = 正取人數 - 簽到人數（每場獨立計算，下限 0）
      var endedEvents = events.filter(function(e) { return e.status === 'ended' && e.creatorUid; });
      var hostEndedMap = {};
      endedEvents.forEach(function(e) {
        var uid = e.creatorUid;
        if (!hostEndedMap[uid]) hostEndedMap[uid] = [];
        hostEndedMap[uid].push({ id: e.id, current: parseInt(e.current) || 0 });
      });

      // 每場活動的簽到文件數（不去重，每筆 = 1 人簽到）
      var checkinCountByEvent = {};
      try {
        var arSnap = await db.collectionGroup('attendanceRecords').where('type', '==', 'checkin').get();
        arSnap.docs
          .filter(function(doc) { return doc.ref.parent.parent !== null; })
          .forEach(function(doc) {
            var eid = doc.data().eventId;
            if (eid) checkinCountByEvent[eid] = (checkinCountByEvent[eid] || 0) + 1;
          });
      } catch (_) {}

      uids.forEach(function(uid) {
        var evts = hostEndedMap[uid] || [];
        var totalConfirmed = 0, totalNoShow = 0;
        evts.forEach(function(evt) {
          var checkedIn = checkinCountByEvent[evt.id] || 0;
          var noShow = Math.max(0, evt.current - checkedIn);
          totalConfirmed += evt.current;
          totalNoShow += noShow;
        });
        hostMap[uid].attendanceRate = totalConfirmed > 0
          ? Math.round(((totalConfirmed - totalNoShow) / totalConfirmed) * 100)
          : 0;
      });

      this._hostListData = Object.values(hostMap);
      this._hostListDataTs = Date.now();
      this._saveHostListCache();
    } catch (err) {
      console.warn('[HostList] load error:', err);
      this._hostListData = [];
    }
  },

  _renderHostList() {
    var body = document.getElementById('host-list-body');
    if (!body) return;
    var data = this._hostListData || [];

    if (data.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">尚無主辦方資料</div>';
      return;
    }

    var sort = this._hostListSort;
    var sorted = data.slice().sort(function(a, b) {
      var va = a[sort.key] || 0, vb = b[sort.key] || 0;
      return sort.desc ? vb - va : va - vb;
    });

    var arrow = function(k) {
      if (k !== sort.key) return '';
      return sort.desc ? ' ▼' : ' ▲';
    };
    var activeClass = function(k) { return k === sort.key ? ' hl-th-active' : ''; };

    var html = '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">'
      + '<table class="hl-table">'
      + '<thead><tr>'
      + '<th style="width:40px"></th>'
      + '<th class="hl-th' + activeClass('eventCount') + '" onclick="App._toggleHostListSort(\'eventCount\')">活動數' + arrow('eventCount') + '</th>'
      + '<th class="hl-th' + activeClass('totalRegistrations') + '" onclick="App._toggleHostListSort(\'totalRegistrations\')">報名人次' + arrow('totalRegistrations') + '</th>'
      + '<th class="hl-th' + activeClass('attendanceRate') + '" onclick="App._toggleHostListSort(\'attendanceRate\')">出席率' + arrow('attendanceRate') + '</th>'
      + '<th style="width:50px">訂閱</th>'
      + '<th style="width:40px">數量</th>'
      + '</tr></thead><tbody>';

    sorted.forEach(function(h) {
      var _oc = 'event.stopPropagation();App.showUserProfile(\'' + escapeHTML(h.name) + '\',{uid:\'' + escapeHTML(h.uid) + '\'})';
      var avatarHtml = h.avatar
        ? '<img src="' + escapeHTML(h.avatar) + '" class="hl-avatar" loading="lazy" onclick="' + _oc + '">'
        : '<div class="hl-avatar hl-avatar-fallback" onclick="' + _oc + '">?</div>';
      html += '<tr>'
        + '<td>' + avatarHtml + '</td>'
        + '<td style="text-align:center;font-weight:600">' + h.eventCount + '</td>'
        + '<td style="text-align:center">' + h.totalRegistrations + '</td>'
        + '<td style="text-align:center">' + h.attendanceRate + '%</td>'
        + '<td style="text-align:center"><button class="host-subscribe-btn" onclick="event.stopPropagation();App.showToast(\'功能尚未開放\')">訂閱</button></td>'
        + '<td style="text-align:center;font-size:.72rem;color:var(--text-muted)">' + h.subscriberCount + '</td>'
        + '</tr>';
    });

    html += '</tbody></table></div>';
    body.innerHTML = html;

    // 右上角灰色小字顯示最後更新時間
    var updEl = document.getElementById('host-list-updated');
    if (updEl && this._hostListDataTs) {
      var d = new Date(this._hostListDataTs);
      var pad = function(n) { return n < 10 ? '0' + n : n; };
      updEl.textContent = pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 更新';
    }
  },

  _toggleHostListSort(key) {
    if (this._hostListSort.key === key) {
      this._hostListSort.desc = !this._hostListSort.desc;
    } else {
      this._hostListSort = { key: key, desc: true };
    }
    this._renderHostList();
  },

});
