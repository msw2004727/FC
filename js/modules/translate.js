/* ================================================
   SportHub — In-Page Translation Module
   ================================================
   與 I18N 語言選單整合：
   - 用戶從抽屜語言下拉切換語言 → I18N 翻譯 data-i18n + Cloud API 翻譯其餘中文
   - 非中文設備自動顯示提示條，點擊後切換 i18n 語言
   - 乾淨邊界：移除 index.html 的 <script> 標籤並重新載入頁面即完全關閉
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
  _TRANSLATE_DISMISS_KEY: 'sporthub_translate_dismiss',
  _TRANSLATE_SKIP_TAGS: new Set(['SCRIPT', 'STYLE', 'OPTION', 'NOSCRIPT', 'CODE', 'PRE', 'SVG']),

  // ─── 狀態 ───
  _translateCache: new Map(),
  _translateObserver: null,
  _translateActive: false,
  _translateLang: null,
  _translateDebounceTimer: null,

  // ─── 初始化 ───
  initTranslate() {
    // Hook 進現有語言切換（覆寫 switchLanguage）
    const origFn = typeof this.switchLanguage === 'function' ? this.switchLanguage.bind(this) : null;
    this.switchLanguage = (locale) => {
      if (origFn) origFn(locale);
      this._onLanguageChanged(locale);
    };

    // URL 參數後門（測試用）: ?lang=ko
    const urlLang = new URLSearchParams(location.search).get('lang');
    if (urlLang && this._TRANSLATE_SUPPORTED[urlLang]) {
      this.switchLanguage(urlLang);
      const sel = document.getElementById('lang-select');
      if (sel) sel.value = urlLang;
      return;
    }

    // 已有 i18n 語言偏好且非中文 → 自動觸發翻譯
    const currentLocale = typeof I18N !== 'undefined' ? I18N.getLocale() : 'zh-TW';
    if (currentLocale !== 'zh-TW' && this._TRANSLATE_SUPPORTED[currentLocale]) {
      this._onLanguageChanged(currentLocale);
      return;
    }

    // 偵測非中文設備 → 顯示提示條
    const dismissed = localStorage.getItem(this._TRANSLATE_DISMISS_KEY);
    if (!dismissed) {
      const deviceLang = (navigator.language || '').slice(0, 2);
      if (!deviceLang.startsWith('zh') && this._TRANSLATE_SUPPORTED[deviceLang]) {
        this._showTranslateBanner(deviceLang);
      }
    }
  },

  // ─── 語言切換回調（i18n 切換後觸發）───
  _onLanguageChanged(locale) {
    // 先停止舊翻譯
    if (this._translateObserver) this._translateObserver.disconnect();
    this._translateActive = false;

    if (locale === 'zh-TW' || !this._TRANSLATE_SUPPORTED[locale]) {
      // 切回中文 → 停止翻譯，重新渲染原文
      this._translateLang = null;
      if (this._renderPageContent && this.currentPage) {
        this._renderPageContent(this.currentPage);
      }
      return;
    }

    // 非中文 → 重新渲染頁面（清除舊翻譯殘留）再翻譯
    this._translateLang = locale;
    if (this._renderPageContent && this.currentPage) {
      this._renderPageContent(this.currentPage);
    }
    this._translateActive = true;
    setTimeout(() => this._startTranslation(), 150);
  },

  // ─── 提示條（非中文設備自動顯示，點擊切換 i18n 語言）───
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
      // 切換 i18n 語言（會觸發 switchLanguage → _onLanguageChanged）
      this.switchLanguage(lang);
      const sel = document.getElementById('lang-select');
      if (sel) sel.value = lang;
    };
    document.getElementById('translate-banner-close').onclick = () => {
      bar.remove();
      localStorage.setItem(this._TRANSLATE_DISMISS_KEY, '1');
    };
  },

  // ─── 翻譯核心 ───
  async _startTranslation() {
    await this._translateVisibleContent();
    this._startTranslateObserver();
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

    const main = document.getElementById('main-content') || document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (this._TRANSLATE_SKIP_TAGS.has(node.parentNode?.tagName)) return NodeFilter.FILTER_REJECT;
        if (node.parentNode?.closest?.('[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        if (node.parentNode?.closest?.('[data-i18n]')) return NodeFilter.FILTER_REJECT;
        if (node.parentNode?.closest?.('input,textarea,select')) return NodeFilter.FILTER_REJECT;
        if (node._translatedLang === lang) return NodeFilter.FILTER_REJECT;
        if (/^\s*[\d\s\-\/\.:,+%$#@!?=()（）【】「」]+\s*$/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (!/[\u4e00-\u9fff]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    const texts = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
      texts.push(walker.currentNode.nodeValue.trim());
    }
    if (!texts.length) return;

    // 快取查詢
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

    // Cloud Function 翻譯
    if (needApi.length > 0) {
      try {
        const fn = firebase.app().functions('asia-east1').httpsCallable('translateTexts');
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
        return;
      }
    }

    // 暫停 Observer → 替換 → 恢復
    if (this._translateObserver) this._translateObserver.disconnect();
    results.forEach((translated, i) => {
      if (!translated || !nodes[i]) return;
      const node = nodes[i];
      if (!node._originalText) node._originalText = node.nodeValue;
      node.nodeValue = node.nodeValue.replace(texts[i], translated);
      node._translatedLang = lang;
    });
    if (this._translateActive) this._startTranslateObserver();
  },

});

// ─── 自動初始化 ───
if (typeof App !== 'undefined') {
  if (document.readyState === 'complete') {
    setTimeout(() => App.initTranslate(), 1000);
  } else {
    window.addEventListener('load', () => setTimeout(() => App.initTranslate(), 1000));
  }
}
