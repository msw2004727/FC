/* === ToosterX — Event Host List (活動主辦方列表) === */

Object.assign(App, {

  _hostListData: null,
  _hostListSort: { key: 'eventCount', desc: true },

  async openHostList() {
    const overlay = document.getElementById('host-list-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    const modal = overlay.querySelector('.host-list-modal');
    if (modal) modal.classList.add('open');
    // 阻止背景滾動
    document.body.style.overflow = 'hidden';
    this._renderHostListLoading();
    await this._loadHostListData();
    this._renderHostList();
  },

  closeHostList() {
    const overlay = document.getElementById('host-list-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    const modal = overlay.querySelector('.host-list-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
  },

  _renderHostListLoading() {
    const list = document.getElementById('host-list-cards');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)"><div class="spinner" style="width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1rem"></div>載入主辦方資料中...</div>';
  },

  async _loadHostListData() {
    try {
      const events = ApiService.getEvents() || [];
      // 按 creatorUid 分群
      const hostMap = {};
      events.forEach(e => {
        const uid = e.creatorUid;
        if (!uid) return;
        if (!hostMap[uid]) {
          hostMap[uid] = {
            uid,
            name: e.creator || '',
            avatar: '',
            eventCount: 0,
            totalRegistrations: 0,
            subscriberCount: 0,
          };
        }
        hostMap[uid].eventCount++;
        hostMap[uid].totalRegistrations += (parseInt(e.current) || 0);
      });

      // 取得用戶資料（頭像、出席率）
      const uids = Object.keys(hostMap);
      const db = firebase.firestore();

      // 批次查詢用戶文件（每批最多 10 個，Firestore in 查詢限制）
      for (let i = 0; i < uids.length; i += 10) {
        const batch = uids.slice(i, i + 10);
        try {
          const snap = await db.collection('users').where(firebase.firestore.FieldPath.documentId(), 'in', batch).get();
          snap.forEach(doc => {
            const data = doc.data();
            if (hostMap[doc.id]) {
              hostMap[doc.id].avatar = data.pictureUrl || data.avatar || '';
              hostMap[doc.id].name = data.displayName || hostMap[doc.id].name;
            }
          });
        } catch (_) {}
      }

      // 取得出席率：從 activityRecords 查詢
      for (const uid of uids) {
        try {
          const arSnap = await db.collection('activityRecords')
            .where('uid', '==', uid)
            .get();
          let total = 0, attended = 0;
          arSnap.forEach(doc => {
            const d = doc.data();
            total++;
            if (d.status === 'registered' || d.status === 'attended') attended++;
          });
          hostMap[uid].attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;
          hostMap[uid].attendanceTotal = total;
        } catch (_) {
          hostMap[uid].attendanceRate = 0;
          hostMap[uid].attendanceTotal = 0;
        }
      }

      this._hostListData = Object.values(hostMap);
    } catch (err) {
      console.warn('[HostList] load error:', err);
      this._hostListData = [];
    }
  },

  _renderHostList() {
    const list = document.getElementById('host-list-cards');
    if (!list) return;
    const data = this._hostListData || [];

    if (data.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">尚無主辦方資料</div>';
      return;
    }

    // 排序
    const { key, desc } = this._hostListSort;
    const sorted = [...data].sort((a, b) => {
      const va = a[key] || 0;
      const vb = b[key] || 0;
      return desc ? vb - va : va - vb;
    });

    // 更新標頭排序指示
    document.querySelectorAll('.host-list-header .hl-sort').forEach(el => {
      const k = el.dataset.sort;
      el.classList.toggle('active', k === key);
      el.textContent = el.dataset.label + (k === key ? (desc ? ' ▼' : ' ▲') : '');
    });

    let html = '';
    sorted.forEach((h, idx) => {
      const avatarHtml = h.avatar
        ? '<img src="' + escapeHTML(h.avatar) + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0" loading="lazy">'
        : '<div style="width:40px;height:40px;border-radius:50%;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:.8rem;flex-shrink:0">?</div>';
      html += '<div class="host-card">'
        + avatarHtml
        + '<div class="host-card-info">'
        + '<div class="host-card-name">' + escapeHTML(h.name) + '</div>'
        + '<div class="host-card-stats">'
        + '<span title="總活動數">📋 ' + h.eventCount + '</span>'
        + '<span title="總報名人次">👥 ' + h.totalRegistrations + '</span>'
        + '<span title="出席率">✅ ' + h.attendanceRate + '%</span>'
        + '</div>'
        + '</div>'
        + '<div class="host-card-right">'
        + '<button class="host-subscribe-btn" onclick="event.stopPropagation();App.showToast(\'功能尚未開放\')">訂閱</button>'
        + '<span class="host-sub-count">' + h.subscriberCount + ' 訂閱</span>'
        + '</div>'
        + '</div>';
    });
    list.innerHTML = html;
  },

  _toggleHostListSort(key) {
    if (this._hostListSort.key === key) {
      this._hostListSort.desc = !this._hostListSort.desc;
    } else {
      this._hostListSort = { key, desc: true };
    }
    this._renderHostList();
  },

});
