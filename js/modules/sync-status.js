/* ================================================
   SportHub — Sync Status Indicator
   頂部同步狀態條：syncing / done / error / offline
   依賴：無（純 UI 模組）
   ================================================ */
Object.assign(App, {

  _syncBarState: 'idle',
  _syncBarDoneTimer: null,
  _syncBarRetryFn: null,
  _syncPendingCount: 0,

  /**
   * @param {'idle'|'syncing'|'done'|'error'|'offline'} state
   * @param {Object} [opts]
   * @param {string}   [opts.text]  - 自訂訊息文字
   * @param {Function} [opts.retry] - 重試按鈕 callback
   */
  _setSyncState(state, opts) {
    const bar = document.getElementById('sync-bar');
    if (!bar) return;
    const textEl = bar.querySelector('.sync-bar__text');
    const retryBtn = bar.querySelector('.sync-bar__retry');
    opts = opts || {};

    // pending counter 追蹤並行寫入
    if (state === 'syncing') {
      this._syncPendingCount++;
    } else if (state === 'done' || state === 'error') {
      this._syncPendingCount = Math.max(0, this._syncPendingCount - 1);
      // 還有其他寫入進行中 → 維持 syncing，不切 done
      if (state === 'done' && this._syncPendingCount > 0) return;
    }

    clearTimeout(this._syncBarDoneTimer);
    bar.classList.remove('sync-bar--syncing', 'sync-bar--done', 'sync-bar--error', 'sync-bar--offline');
    this._syncBarState = state;

    switch (state) {
      case 'syncing':
        bar.classList.add('sync-bar--syncing');
        break;
      case 'done':
        bar.classList.add('sync-bar--done');
        this._syncBarDoneTimer = setTimeout(() => {
          bar.classList.remove('sync-bar--done');
          this._syncBarState = 'idle';
        }, 1200);
        break;
      case 'error':
        bar.classList.add('sync-bar--error');
        if (textEl) textEl.textContent = opts.text || '同步失敗';
        this._syncBarRetryFn = opts.retry || null;
        if (retryBtn) retryBtn.style.display = opts.retry ? '' : 'none';
        break;
      case 'offline':
        bar.classList.add('sync-bar--offline');
        if (textEl) textEl.textContent = opts.text || '目前離線，資料將在連線後同步';
        break;
      default:
        break;
    }
  },

  _initSyncBar() {
    const retryBtn = document.querySelector('#sync-bar .sync-bar__retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (typeof this._syncBarRetryFn === 'function') this._syncBarRetryFn();
      });
    }
    window.addEventListener('offline', () => this._setSyncState('offline'));
    window.addEventListener('online', () => {
      if (this._syncBarState === 'offline') {
        this._setSyncState('syncing');
        setTimeout(() => {
          // 只在沒有真正寫入進行中時才自動 done
          if (this._syncBarState === 'syncing' && this._syncPendingCount <= 1) this._setSyncState('done');
        }, 2000);
      }
    });
  },

});
