/* ================================================
   SportHub — Popup Ad (Frontend Display)
   ================================================ */

Object.assign(App, {

  _popupAdQueue: [],
  _popupAdIndex: 0,
  _popupDismissToday: false,

  showPopupAdsOnLoad() {
    const activeAds = ApiService.getActivePopupAds();
    if (!activeAds || activeAds.length === 0) return;
    // 產生當前活躍廣告的 ID 指紋（排序後合併）
    const activeKey = activeAds.map(a => a.id).sort().join(',');
    const dismissKey = 'sporthub_popup_dismiss_' + ModeManager.getMode();
    try {
      const stored = JSON.parse(localStorage.getItem(dismissKey));
      if (stored && stored.adKey === activeKey) {
        const now = new Date();
        if (new Date(stored.date).toDateString() === now.toDateString()) return;
      }
    } catch (_) { /* 舊格式或無效 JSON，忽略 */ }
    this._popupAdQueue = [...activeAds].sort((a, b) => a.layer - b.layer);
    this._popupAdActiveKey = activeKey;
    this._popupAdIndex = 0;
    this._popupDismissToday = false;
    this._showNextPopupAd();
  },

  _showNextPopupAd() {
    if (this._popupAdIndex >= this._popupAdQueue.length) {
      const overlay = document.getElementById('popup-ad-overlay');
      if (overlay) overlay.style.display = 'none';
      return;
    }
    const ad = this._popupAdQueue[this._popupAdIndex];
    const overlay = document.getElementById('popup-ad-overlay');
    const body = document.getElementById('popup-ad-body');
    if (!overlay || !body) return;

    const safeUrl = (ad.linkUrl && /^https?:\/\//.test(ad.linkUrl)) ? escapeHTML(ad.linkUrl) : '';
    const clickHandler = safeUrl
      ? `onclick="App.trackAdClick('popup','${escapeHTML(ad.id)}');window.open('${safeUrl}','_blank')" style="cursor:pointer"`
      : '';
    body.innerHTML = ad.image
      ? `<img src="${ad.image}" alt="${escapeHTML(ad.title || '')}" ${clickHandler}>`
      : `<div class="popup-ad-placeholder" ${clickHandler}>
           <div style="font-size:1.1rem;font-weight:700;margin-bottom:.3rem">${escapeHTML(ad.title || '廣告')}</div>
           <div style="font-size:.75rem;color:rgba(255,255,255,.6)">600 × 800</div>
         </div>`;

    // 更新計數器
    const counter = document.getElementById('popup-ad-counter');
    if (counter) {
      counter.textContent = this._popupAdQueue.length > 1
        ? `${this._popupAdIndex + 1} / ${this._popupAdQueue.length}`
        : '';
    }

    // 同步按鈕狀態
    const btn = document.getElementById('popup-ad-dismiss-btn');
    if (btn) btn.classList.toggle('active', this._popupDismissToday);

    overlay.style.display = '';
  },

  togglePopupDismiss() {
    this._popupDismissToday = !this._popupDismissToday;
    const btn = document.getElementById('popup-ad-dismiss-btn');
    if (btn) btn.classList.toggle('active', this._popupDismissToday);
  },

  closePopupAd() {
    if (this._popupDismissToday) {
      localStorage.setItem('sporthub_popup_dismiss_' + ModeManager.getMode(), JSON.stringify({
        date: new Date().toISOString(),
        adKey: this._popupAdActiveKey || '',
      }));
      const overlay = document.getElementById('popup-ad-overlay');
      if (overlay) overlay.style.display = 'none';
      return;
    }
    this._popupAdIndex++;
    this._showNextPopupAd();
  },

});
