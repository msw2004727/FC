/* ================================================
   SportHub — External Event Transit Card
   外部活動中繼卡片（YouTube 嵌入 / 一般跳轉）
   依賴：ApiService（取活動資料）、escapeHTML
   ================================================ */

Object.assign(App, {

  /* ── YouTube Video ID 萃取 ── */
  _extractYouTubeVideoId(url) {
    if (!url) return null;
    var patterns = [
      /(?:youtube\.com\/watch\?.*v=)([\w-]{11})/,
      /(?:youtube\.com\/embed\/)([\w-]{11})/,
      /(?:youtube\.com\/v\/)([\w-]{11})/,
      /(?:youtube\.com\/shorts\/)([\w-]{11})/,
      /(?:youtube\.com\/live\/)([\w-]{11})/,
      /(?:youtu\.be\/)([\w-]{11})/,
      /(?:m\.youtube\.com\/watch\?.*v=)([\w-]{11})/,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = url.match(patterns[i]);
      if (m) return m[1];
    }
    return null;
  },

  /* ── 顯示中繼卡片 ── */
  showExternalTransitCard(eventOrId) {
    var e = typeof eventOrId === 'string'
      ? ApiService.getEvent(eventOrId)
      : eventOrId;
    if (!e) return;

    // 移除舊的
    var old = document.getElementById('ext-transit-overlay');
    if (old) old.parentNode.removeChild(old);

    var ytId = this._extractYouTubeVideoId(e.externalUrl);
    var overlay = document.createElement('div');
    overlay.id = 'ext-transit-overlay';
    overlay.className = 'ext-transit-overlay';

    // 活動資訊
    var dateStr = e.date || '';
    var locStr = e.location || '';
    var sportEmoji = (typeof SPORT_ICON_EMOJI !== 'undefined' && e.sportTag)
      ? (SPORT_ICON_EMOJI[e.sportTag] || '') : '';

    var infoHtml = '<div class="ext-transit-info">'
      + (dateStr ? '<div class="ext-transit-meta">' + escapeHTML(dateStr) + '</div>' : '')
      + (locStr ? '<div class="ext-transit-meta">' + escapeHTML(locStr) + '</div>' : '')
      + '</div>';

    // 封面圖
    var coverHtml = '';
    if (e.image) {
      coverHtml = '<div class="ext-transit-cover">'
        + '<img src="' + e.image + '" alt="">'
        + '</div>';
    }

    // YouTube 嵌入 或 跳轉按鈕
    var contentHtml = '';
    if (ytId) {
      contentHtml = '<div class="ext-transit-yt-wrap">'
        + '<iframe src="https://www.youtube.com/embed/' + ytId + '?playsinline=1&rel=0"'
        + ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"'
        + ' allowfullscreen></iframe>'
        + '</div>'
        + '<a class="ext-transit-btn ext-transit-btn-secondary" href="' + escapeHTML(e.externalUrl) + '" target="_blank" rel="noopener">'
        + '在 YouTube 開啟'
        + '</a>';
    } else {
      contentHtml = '<a class="ext-transit-btn ext-transit-btn-primary" href="' + escapeHTML(e.externalUrl) + '" target="_blank" rel="noopener">'
        + '前往活動頁面'
        + '</a>';
    }

    overlay.innerHTML =
      '<div class="ext-transit-card">'
      + '<button class="ext-transit-close" id="ext-transit-close">&times;</button>'
      + coverHtml
      + '<div class="ext-transit-body">'
      + '<div class="ext-transit-title">' + sportEmoji + ' ' + escapeHTML(e.title || '外部活動') + '</div>'
      + infoHtml
      + contentHtml
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('visible'); });

    // 事件綁定
    document.getElementById('ext-transit-close').addEventListener('click', function () {
      App.closeExternalTransitCard();
    });
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) App.closeExternalTransitCard();
    });
  },

  /* ── 關閉中繼卡片 ── */
  closeExternalTransitCard() {
    var overlay = document.getElementById('ext-transit-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    // 移除 iframe 停止播放
    var iframe = overlay.querySelector('iframe');
    if (iframe) iframe.src = '';
    overlay.addEventListener('transitionend', function handler() {
      overlay.removeEventListener('transitionend', handler);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 400);
  },

});
