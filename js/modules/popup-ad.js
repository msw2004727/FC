/* ================================================
   SportHub — Popup Ad (Frontend Display)
   ================================================ */

Object.assign(App, {

  _popupAdQueue: [],
  _popupAdIndex: 0,
  _popupDismissToday: false,

  showPopupAdsOnLoad() {
    const dismissKey = 'sporthub_popup_dismiss';
    const dismissVal = localStorage.getItem(dismissKey);
    if (dismissVal) {
      const now = new Date();
      if (new Date(dismissVal).toDateString() === now.toDateString()) return;
    }
    const activeAds = ApiService.getActivePopupAds();
    if (!activeAds || activeAds.length === 0) return;
    this._popupAdQueue = [...activeAds].sort((a, b) => a.layer - b.layer);
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

    const clickHandler = ad.linkUrl
      ? `onclick="App.trackAdClick('popup','${ad.id}');window.open('${ad.linkUrl}','_blank')" style="cursor:pointer"`
      : '';
    body.innerHTML = ad.image
      ? `<img src="${ad.image}" alt="${ad.title || ''}" ${clickHandler}>`
      : `<div class="popup-ad-placeholder" ${clickHandler}>
           <div style="font-size:1.1rem;font-weight:700;margin-bottom:.3rem">${ad.title || '廣告'}</div>
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
      localStorage.setItem('sporthub_popup_dismiss', new Date().toISOString());
      const overlay = document.getElementById('popup-ad-overlay');
      if (overlay) overlay.style.display = 'none';
      return;
    }
    this._popupAdIndex++;
    this._showNextPopupAd();
  },

});
