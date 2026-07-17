/* ================================================
   SportHub — Button Loading State Helper
   統一的「寫入按鈕」視覺回饋:
     1. 點擊瞬間 disable + 改文字(處理中…/儲存中…/建立中…)
     2. dataset.loading 防重複點擊
     3. try/finally 自動 restore 原始狀態
     4. 異常時也會 restore,避免按鈕永久卡住
   對應 §開發守則「既有可重用工具優先沿用」,所有寫入 onclick handler
   應改為 `return this._withButtonLoading(btn, '建立中...', async () => {...})`。
   參考 pattern: js/modules/education/edu-helpers.js _setEduBtnLoading
   ================================================ */

Object.assign(App, {

  /**
   * 包裹 async 寫入動作,提供統一 UI 回饋
   * @param {string|HTMLElement} btnOrSelector - button DOM 或 querySelector 字串
   * @param {string} loadingText - 載入中顯示的文字(如「建立中...」)
   * @param {() => Promise} asyncFn - 實際非同步寫入函式
   * @returns {Promise} asyncFn 的結果,失敗時 rethrow
   */
  _withButtonLoading(btnOrSelector, loadingText, asyncFn, options = {}) {
    const btn = typeof btnOrSelector === 'string'
      ? document.querySelector(btnOrSelector)
      : btnOrSelector;

    // 找不到按鈕也不應炸,直接執行 asyncFn(避免 silent fail 改成完全不執行)
    if (!btn) return Promise.resolve().then(() => asyncFn());

    // 已在 loading 狀態 → 防重複點擊
    if (btn.dataset.btnLoading === '1') return undefined;

    const originalText = btn.textContent;
    const originalDisabled = btn.disabled;
    const originalOpacity = btn.style.opacity;
    const originalAriaBusy = btn.getAttribute?.('aria-busy');
    const glowWrap = typeof btn.closest === 'function'
      ? btn.closest('.signup-glow-wrap')
      : null;
    btn.dataset.btnLoading = '1';
    btn.disabled = true;
    if (loadingText) btn.textContent = loadingText;
    if (glowWrap) {
      glowWrap.classList.add('loading');
      btn.setAttribute?.('aria-busy', 'true');
      btn.style.opacity = originalOpacity || '';
    } else {
      btn.style.opacity = '.6';
    }

    return Promise.resolve().then(() => asyncFn()).finally(() => {
      // 即使 DOM 被換掉(例如 modal 重渲染)也不要拋
      try {
        if (typeof options.shouldRestore === 'function' && options.shouldRestore() === false) return;
        if (btn.isConnected) {
          btn.dataset.btnLoading = '';
          btn.disabled = originalDisabled;
          if (loadingText) btn.textContent = originalText;
          btn.style.opacity = originalOpacity;
          if (glowWrap?.isConnected !== false) glowWrap?.classList.remove('loading');
          if (originalAriaBusy === null) btn.removeAttribute?.('aria-busy');
          else if (originalAriaBusy !== undefined) btn.setAttribute?.('aria-busy', originalAriaBusy);
        }
      } catch (_) { /* noop */ }
    });
  },

});
