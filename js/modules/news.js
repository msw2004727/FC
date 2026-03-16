/* ================================================
   SportHub — News Module
   每日體育新聞渲染（卡片直瀑式）
   ================================================ */

Object.assign(App, {

  _newsActiveTag: 'all',

  renderNews() {
    const titleEl = document.getElementById('news-section-title');
    const tabsEl = document.getElementById('news-tabs');
    const listEl = document.getElementById('news-card-list');
    const dividerEl = document.getElementById('news-divider');
    if (!titleEl || !listEl) return;

    const articles = (typeof ApiService !== 'undefined' && ApiService.getNewsArticles)
      ? ApiService.getNewsArticles()
      : [];

    if (!articles || articles.length === 0) {
      titleEl.style.display = 'none';
      if (tabsEl) tabsEl.style.display = 'none';
      if (dividerEl) dividerEl.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }

    titleEl.style.display = '';
    if (dividerEl) dividerEl.style.display = '';
    if (tabsEl) {
      tabsEl.style.display = '';
      this._renderNewsTabs(tabsEl);
    }

    this._renderNewsCards(articles, listEl);

    // 綁定左右滑動切換頁籤
    this._bindSwipeTabs('news-card-list', 'news-tabs',
      this._handleNewsTabClick,
      (btn) => btn.getAttribute('data-tag')
    );
  },

  _renderNewsTabs(tabsEl) {
    const activeTag = this._newsActiveTag || 'all';
    let html = '<button class="news-tab' + (activeTag === 'all' ? ' active' : '') + '" data-tag="all" onclick="App._handleNewsTabClick(\'all\')">全部</button>';

    if (typeof EVENT_SPORT_OPTIONS !== 'undefined') {
      EVENT_SPORT_OPTIONS.forEach(function(opt) {
        const isActive = activeTag === opt.key ? ' active' : '';
        html += '<button class="news-tab' + isActive + '" data-tag="' + escapeHTML(opt.key) + '" onclick="App._handleNewsTabClick(\'' + escapeHTML(opt.key) + '\')">' + escapeHTML(opt.label) + '</button>';
      });
    }

    tabsEl.innerHTML = html;
  },

  _handleNewsTabClick(tag) {
    this._newsActiveTag = tag;
    const tabsEl = document.getElementById('news-tabs');
    const listEl = document.getElementById('news-card-list');
    if (!listEl) return;

    // Update active tab
    if (tabsEl) {
      tabsEl.querySelectorAll('.news-tab').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tag') === tag);
      });
    }

    const articles = (typeof ApiService !== 'undefined' && ApiService.getNewsArticles)
      ? ApiService.getNewsArticles()
      : [];

    this._renderNewsCards(articles, listEl);
  },

  _renderNewsCards(articles, listEl) {
    const activeTag = this._newsActiveTag || 'all';

    const sportLabels = {};
    if (typeof EVENT_SPORT_MAP !== 'undefined') {
      Object.keys(EVENT_SPORT_MAP).forEach(function(k) {
        sportLabels[k] = EVENT_SPORT_MAP[k].label;
      });
    }

    const filtered = activeTag === 'all'
      ? articles
      : articles.filter(function(a) { return a.sportTag === activeTag; });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:1.5rem .5rem;color:var(--text-muted);font-size:.82rem">目前沒有相關新聞</div>';
      return;
    }

    listEl.innerHTML = filtered.map(function(article) {
      const safeTitle = escapeHTML(article.title || '');
      const safeSource = escapeHTML(article.source || '');
      const sportTag = article.sportTag || 'general';
      const sportLabel = sportLabels[sportTag] || '';
      const safeUrl = escapeHTML(article.url || '');

      // Time formatting
      let timeStr = '';
      if (article.publishedAt) {
        try {
          const d = article.publishedAt.toDate
            ? article.publishedAt.toDate()
            : new Date(article.publishedAt);
          const now = new Date();
          const diff = now - d;
          if (diff < 3600000) {
            timeStr = Math.max(1, Math.floor(diff / 60000)) + ' 分鐘前';
          } else if (diff < 86400000) {
            timeStr = Math.floor(diff / 3600000) + ' 小時前';
          } else {
            timeStr = (d.getMonth() + 1) + '/' + d.getDate();
          }
        } catch (_) {}
      }

      // Thumbnail
      const imgUrl = article.imageUrl || '';
      const sportEmoji = (typeof SPORT_ICON_EMOJI !== 'undefined' && SPORT_ICON_EMOJI[sportTag]) || '';
      const thumbHtml = imgUrl
        ? '<img class="news-card-thumb" src="' + escapeHTML(imgUrl) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=\\\'news-card-thumb-placeholder\\\'>' + (sportEmoji || '') + '</div>\'">'
        : '<div class="news-card-thumb-placeholder">' + (sportEmoji || '') + '</div>';

      // Sport tag badge
      const tagHtml = sportLabel
        ? '<span class="news-card-sport-tag">' + escapeHTML(sportLabel) + '</span>'
        : '';

      return '<div class="news-card" onclick="App._openNewsUrl(\'' + safeUrl + '\')">'
        + thumbHtml
        + '<div class="news-card-body">'
        + '<div class="news-card-title">' + safeTitle + '</div>'
        + '<div class="news-card-meta">'
        + '<span class="news-card-source">' + safeSource + '</span>'
        + (timeStr ? '<span>' + escapeHTML(timeStr) + '</span>' : '')
        + tagHtml
        + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  },

  _openNewsUrl(url) {
    if (!url) return;
    // Validate URL starts with https://
    if (url.indexOf('https://') !== 0 && url.indexOf('http://') !== 0) return;
    location.href = url;
  },

  async _openNewsArticle(newsId) {
    if (!newsId) return;
    try {
      if (typeof db !== 'undefined') {
        const doc = await db.collection('newsArticles').doc(newsId).get();
        if (doc.exists) {
          const data = doc.data();
          if (data.url) {
            location.href = data.url;
            return;
          }
        }
      }
    } catch (err) {
      console.warn('[News] Failed to open news article:', err);
    }
    // Fallback: go to home
    this.showToast('新聞已過期');
  },

});
