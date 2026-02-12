/* ================================================
   SportHub — Page Loader（HTML 頁面片段載入器）
   ================================================
   將 index.html 拆分為獨立的 HTML 片段檔案，
   啟動時平行載入所有片段並注入 DOM。
   好處：每次維護只需讀取對應的頁面檔，節省 token。
   ================================================ */

const PageLoader = {

  /** 頁面片段清單（對應 pages/*.html） */
  _pages: [
    'home',
    'activity',
    'team',
    'message',
    'profile',
    'scan',
    'tournament',
    'shop',
    'admin-users',
    'admin-content',
    'admin-system',
    'admin-dashboard',
    'personal-dashboard',
  ],

  /** 全域彈窗片段 */
  _modals: ['modals'],

  /**
   * 平行載入所有頁面 + 彈窗片段，注入 DOM
   * 必須在 App.init() 之前呼叫
   */
  async loadAll() {
    const mainEl = document.getElementById('main-content');
    const modalEl = document.getElementById('modal-container');

    const [pageResults, modalResults] = await Promise.all([
      Promise.all(
        this._pages.map(name =>
          fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => r.text()).catch(err => {
            console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err);
            return '';
          })
        )
      ),
      Promise.all(
        this._modals.map(name =>
          fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => r.text()).catch(err => {
            console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err);
            return '';
          })
        )
      ),
    ]);

    mainEl.innerHTML = pageResults.join('\n');
    modalEl.innerHTML = modalResults.join('\n');

    console.log(`[PageLoader] 已載入 ${this._pages.length} 個頁面 + ${this._modals.length} 個彈窗片段`);
  },
};
