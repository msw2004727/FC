/* ================================================
   SEO Dashboard — Firestore Data Loader
   ================================================
   讀取 seoSnapshots collection 的最新快照與歷史資料
   ================================================ */

Object.assign(App, {

  _seoLatestCache: null,
  _seoHistoryCache: null,
  _seoCacheAt: 0,

  /** 讀取最新 snapshot（優先用 _latest 指標 doc 取得最新日期） */
  async _loadLatestSeoSnapshot() {
    // 30 秒內快取
    if (this._seoLatestCache && (Date.now() - this._seoCacheAt) < 30000) {
      return this._seoLatestCache;
    }

    const db = firebase.firestore();
    try {
      // 先讀 _latest 指標
      const latestRef = db.collection('seoSnapshots').doc('_latest');
      const latestSnap = await latestRef.get();
      if (!latestSnap.exists) {
        console.warn('[SEO] _latest 指標不存在，嘗試直接抓最新日期');
        return await this._loadLatestSeoSnapshotFallback();
      }
      const latestDate = latestSnap.data().latestDate;
      if (!latestDate) return await this._loadLatestSeoSnapshotFallback();

      // 讀該日 snapshot
      const snap = await db.collection('seoSnapshots').doc(latestDate).get();
      if (!snap.exists) return null;
      const data = { id: snap.id, ...snap.data() };
      this._seoLatestCache = data;
      this._seoCacheAt = Date.now();
      return data;
    } catch (err) {
      console.error('[SEO] 讀取 snapshot 失敗:', err);
      return null;
    }
  },

  async _loadLatestSeoSnapshotFallback() {
    const db = firebase.firestore();
    try {
      // 抓最近 3 個 non-_latest docs，取最新
      const snaps = await db.collection('seoSnapshots')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'desc')
        .limit(5)
        .get();
      for (const doc of snaps.docs) {
        if (doc.id === '_latest') continue;
        const data = { id: doc.id, ...doc.data() };
        this._seoLatestCache = data;
        this._seoCacheAt = Date.now();
        return data;
      }
      return null;
    } catch (err) {
      console.error('[SEO] fallback 失敗:', err);
      return null;
    }
  },

  /** 讀取歷史（預設過去 30 天）— 用於趨勢圖 */
  async _loadSeoHistory(days = 30) {
    if (this._seoHistoryCache && this._seoHistoryCache.days === days && (Date.now() - this._seoCacheAt) < 60000) {
      return this._seoHistoryCache.data;
    }

    const db = firebase.firestore();
    try {
      const snaps = await db.collection('seoSnapshots')
        .orderBy(firebase.firestore.FieldPath.documentId(), 'desc')
        .limit(days + 5)
        .get();
      const history = [];
      snaps.forEach(doc => {
        if (doc.id === '_latest') return;
        if (history.length >= days) return;
        history.push({ id: doc.id, ...doc.data() });
      });
      history.reverse(); // 時序由舊到新
      this._seoHistoryCache = { days, data: history };
      return history;
    } catch (err) {
      console.error('[SEO] 歷史讀取失敗:', err);
      return [];
    }
  },

  _seoInvalidateCache() {
    this._seoLatestCache = null;
    this._seoHistoryCache = null;
    this._seoCacheAt = 0;
  },

});
