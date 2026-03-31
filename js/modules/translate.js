/* ================================================
   SportHub — In-Page Translation Module
   ================================================
   乾淨邊界設計：移除 index.html 的 <script> 標籤即完全關閉。
   不修改任何現有模組，純增量功能。
   ================================================ */

Object.assign(App, {

  // ─── 常數 ───
  _TRANSLATE_SUPPORTED: {
    en: { label: 'English', btn: 'Translate' },
    ja: { label: '日本語', btn: '翻訳' },
    ko: { label: '한국어', btn: '번역' },
    vi: { label: 'Tiếng Việt', btn: 'Dịch' },
    th: { label: 'ภาษาไทย', btn: 'แปล' },
  },
  _TRANSLATE_LS_KEY: 'sporthub_translate_lang',
  _TRANSLATE_DISMISS_KEY: 'sporthub_translate_dismiss',
  _TRANSLATE_SKIP_TAGS: new Set(['SCRIPT', 'STYLE', 'OPTION', 'NOSCRIPT', 'CODE', 'PRE', 'SVG']),

  // ─── 狀態 ───
  _translateCache: new Map(),
  _translateObserver: null,
  _translateActive: false,
  _translateLang: null,
  _translateDebounceTimer: null,

  // ─── 初始化（由 script 載入時自動呼叫）───
  initTranslate() {
    // URL 參數後門（測試用）: ?lang=ko
    const urlLang = new URLSearchParams(location.search).get('lang');
    const saved = localStorage.getItem(this._TRANSLATE_LS_KEY);
    const dismissed = localStorage.getItem(this._TRANSLATE_DISMISS_KEY);
    const deviceLang = (navigator.language || '').slice(0, 2);

    // 決定目標語言
    const targetLang = urlLang || saved || (this._TRANSLATE_SUPPORTED[deviceLang] ? deviceLang : null);

    if (saved || urlLang) {
      // 已有偏好 → 自動翻譯
      this._translateLang = targetLang;
      this._translateActive = true;
      this._syncI18nLocale(targetLang);
      this._startTranslation();
      this._renderTranslateFab(true);
    } else if (!dismissed && targetLang && !deviceLang.startsWith('zh')) {
      // 偵測到非中文設備且未關閉提示 → 顯示提示條
      this._showTranslateBanner(targetLang);
      this._renderTranslateFab(false);
    } else {
      // 中文設備或已關閉提示 → 只顯示浮動按鈕
      this._renderTranslateFab(false);
    }
  },

  // ─── 提示條（非中文設備自動顯示）───
  _showTranslateBanner(lang) {
    const info = this._TRANSLATE_SUPPORTED[lang];
    if (!info) return;
    const bar = document.createElement('div');
    bar.id = 'translate-banner';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:1100;background:var(--bg-card,#fff);border-top:1px solid var(--border,#e5e7eb);padding:.7rem 1rem;display:flex;align-items:center;gap:.6rem;box-shadow:0 -2px 12px rgba(0,0,0,.08);font-size:.88rem;';
    bar.innerHTML = '<span style="font-size:1.2rem">🌐</span>'
      + '<span style="flex:1;color:var(--text-primary,#111)">' + escapeHTML(info.label) + '?</span>'
      + '<button id="translate-banner-btn" style="padding:.4rem 1rem;border-radius:8px;background:var(--accent,#0d9488);color:#fff;border:none;font-weight:700;font-size:.85rem;cursor:pointer">' + escapeHTML(info.btn) + '</button>'
      + '<button id="translate-banner-close" style="background:none;border:none;color:var(--text-muted,#9ca3af);font-size:1.2rem;cursor:pointer;padding:.2rem .4rem">✕</button>';
    document.body.appendChild(bar);

    document.getElementById('translate-banner-btn').onclick = () => {
      bar.remove();
      localStorage.setItem(this._TRANSLATE_LS_KEY, lang);
      this._translateLang = lang;
      this._translateActive = true;
      this._syncI18nLocale(lang);
      this._startTranslation();
      this._updateTranslateFab(true);
    };
    document.getElementById('translate-banner-close').onclick = () => {
      bar.remove();
      localStorage.setItem(this._TRANSLATE_DISMISS_KEY, '1');
    };
  },

  // ─── 浮動按鈕（地球圖示）───
  _renderTranslateFab(active) {
    if (document.getElementById('translate-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'translate-fab';
    fab.title = '翻譯 / Translate';
    fab.style.cssText = 'position:fixed;bottom:calc(var(--bottombar-h,56px) + env(safe-area-inset-bottom,0px) + 18px);left:8px;z-index:1000;width:36px;height:36px;border-radius:50%;border:1.5px solid var(--border,#e5e7eb);background:var(--bg-card,#fff);box-shadow:0 2px 8px rgba(0,0,0,.1);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.1rem;transition:background .15s,box-shadow .15s;';
    fab.textContent = '🌐';
    if (active) fab.style.background = 'var(--accent-bg,rgba(13,148,136,.08))';
    document.body.appendChild(fab);

    fab.onclick = () => this._toggleTranslateMenu();
  },

  _updateTranslateFab(active) {
    const fab = document.getElementById('translate-fab');
    if (!fab) return;
    fab.style.background = active ? 'var(--accent-bg,rgba(13,148,136,.08))' : 'var(--bg-card,#fff)';
  },

  // ─── 語言選單 ───
  _toggleTranslateMenu() {
    const existing = document.getElementById('translate-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'translate-menu';
    menu.style.cssText = 'position:fixed;bottom:calc(var(--bottombar-h,56px) + env(safe-area-inset-bottom,0px) + 58px);left:8px;z-index:1001;background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.12);padding:.5rem 0;min-width:160px;';

    // 中文選項（關閉翻譯）
    const zhItem = '<div class="translate-menu-item' + (!this._translateActive ? ' active' : '') + '" data-lang="zh" style="padding:.55rem 1rem;cursor:pointer;font-size:.85rem;display:flex;align-items:center;gap:.5rem;">繁體中文（原文）</div>';

    const langItems = Object.entries(this._TRANSLATE_SUPPORTED).map(([code, info]) => {
      const isActive = this._translateActive && this._translateLang === code;
      return '<div class="translate-menu-item' + (isActive ? ' active' : '') + '" data-lang="' + code + '" style="padding:.55rem 1rem;cursor:pointer;font-size:.85rem;display:flex;align-items:center;gap:.5rem;">' + escapeHTML(info.label) + '</div>';
    }).join('');

    menu.innerHTML = zhItem + langItems;
    document.body.appendChild(menu);

    // 選中狀態樣式
    menu.querySelectorAll('.translate-menu-item').forEach(item => {
      if (item.classList.contains('active')) item.style.cssText += 'color:var(--accent,#0d9488);font-weight:700;background:var(--accent-bg,rgba(13,148,136,.08));';
      item.onmouseenter = () => { if (!item.classList.contains('active')) item.style.background = 'var(--bg-elevated,#f3f4f6)'; };
      item.onmouseleave = () => { if (!item.classList.contains('active')) item.style.background = ''; };
    });

    menu.onclick = (e) => {
      const item = e.target.closest('[data-lang]');
      if (!item) return;
      const lang = item.dataset.lang;
      menu.remove();

      if (lang === 'zh') {
        this._stopTranslation();
        localStorage.removeItem(this._TRANSLATE_LS_KEY);
        this._updateTranslateFab(false);
        this._syncI18nLocale('zh-TW');
      } else {
        // 先還原為中文（清除舊語言殘留）再翻譯新語言
        if (this._translateObserver) this._translateObserver.disconnect();
        if (typeof App !== 'undefined' && App._renderPageContent && App.currentPage) {
          App._renderPageContent(App.currentPage);
        }
        localStorage.setItem(this._TRANSLATE_LS_KEY, lang);
        this._translateLang = lang;
        this._translateActive = true;
        this._syncI18nLocale(lang);
        // 等 DOM 重新渲染完成後再翻譯
        setTimeout(() => this._startTranslation(), 100);
        this._updateTranslateFab(true);
      }
    };

    // 點外面關閉
    setTimeout(() => {
      const close = (e) => {
        if (!menu.contains(e.target) && e.target.id !== 'translate-fab') {
          menu.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  },

  // ─── i18n 連動（切換 I18N locale + 重新套用 data-i18n 翻譯）───
  _syncI18nLocale(lang) {
    if (typeof I18N === 'undefined' || typeof I18N.setLocale !== 'function') return;
    I18N.setLocale(lang);
    // 重新套用 data-i18n 標記的元素
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) el.textContent = typeof t === 'function' ? t(key) : key;
    });
  },

  // ─── 翻譯核心 ───
  async _startTranslation() {
    // 翻譯當前可見內容
    await this._translateVisibleContent();
    // 啟動 MutationObserver 監聽新內容
    this._startTranslateObserver();
  },

  _stopTranslation() {
    this._translateActive = false;
    this._translateLang = null;
    if (this._translateObserver) {
      this._translateObserver.disconnect();
      this._translateObserver = null;
    }
    // 重新渲染當前頁面（JS 變數中的原文會重新寫入 DOM）
    if (typeof App !== 'undefined' && App._renderPageContent && App.currentPage) {
      App._renderPageContent(App.currentPage);
    }
  },

  _startTranslateObserver() {
    if (this._translateObserver) this._translateObserver.disconnect();
    const main = document.getElementById('main-content') || document.body;
    this._translateObserver = new MutationObserver(() => {
      if (!this._translateActive) return;
      clearTimeout(this._translateDebounceTimer);
      this._translateDebounceTimer = setTimeout(() => this._translateVisibleContent(), 300);
    });
    this._translateObserver.observe(main, { childList: true, subtree: true });
  },

  async _translateVisibleContent() {
    if (!this._translateActive || !this._translateLang) return;
    const lang = this._translateLang;

    // 收集需要翻譯的 TextNode
    const main = document.getElementById('main-content') || document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (this._TRANSLATE_SKIP_TAGS.has(node.parentNode?.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.parentNode?.closest?.('[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        if (node.parentNode?.closest?.('[data-i18n]')) return NodeFilter.FILTER_REJECT;
        if (node.parentNode?.closest?.('input,textarea,select')) return NodeFilter.FILTER_REJECT;
        // 已翻譯的跳過
        if (node._translatedLang === lang) return NodeFilter.FILTER_REJECT;
        // 純數字/符號跳過
        if (/^\s*[\d\s\-\/\.:,+%$#@!?=()（）【】「」]+\s*$/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        // 沒有中文字元的跳過
        if (!/[\u4e00-\u9fff]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    const texts = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue.trim();
      nodes.push(walker.currentNode);
      texts.push(text);
    }

    if (!texts.length) return;

    // 分批：查快取 vs 需要 API
    const needApi = [];
    const needApiIdx = [];
    const results = new Array(texts.length);

    texts.forEach((t, i) => {
      const cacheKey = lang + ':' + t;
      if (this._translateCache.has(cacheKey)) {
        results[i] = this._translateCache.get(cacheKey);
      } else {
        needApi.push(t);
        needApiIdx.push(i);
      }
    });

    // 呼叫 Cloud Function 翻譯未快取的文字
    if (needApi.length > 0) {
      try {
        const fn = firebase.app().functions('asia-east1').httpsCallable('translateTexts');
        // 分批：每批最多 128 段
        for (let start = 0; start < needApi.length; start += 128) {
          const batch = needApi.slice(start, start + 128);
          const batchIdx = needApiIdx.slice(start, start + 128);
          const res = await fn({ texts: batch, targetLang: lang });
          const translations = res.data?.translations || [];
          translations.forEach((t, j) => {
            const origIdx = batchIdx[j];
            results[origIdx] = t;
            this._translateCache.set(lang + ':' + texts[origIdx], t);
          });
        }
      } catch (err) {
        console.warn('[Translate] API failed:', err);
        return; // 翻譯失敗不影響正常功能
      }
    }

    // 暫停 Observer → 替換文字 → 恢復 Observer
    if (this._translateObserver) this._translateObserver.disconnect();

    results.forEach((translated, i) => {
      if (!translated || !nodes[i]) return;
      const node = nodes[i];
      if (!node._originalText) node._originalText = node.nodeValue;
      node.nodeValue = node.nodeValue.replace(texts[i], translated);
      node._translatedLang = lang;
    });

    // 恢復 Observer
    if (this._translateActive) this._startTranslateObserver();
  },

});

// ─── 自動初始化 ───
if (typeof App !== 'undefined') {
  // 等頁面基本載入完成後再初始化翻譯
  if (document.readyState === 'complete') {
    setTimeout(() => App.initTranslate(), 1000);
  } else {
    window.addEventListener('load', () => setTimeout(() => App.initTranslate(), 1000));
  }
}
