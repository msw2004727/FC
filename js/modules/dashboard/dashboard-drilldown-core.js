/* ================================================
   SportHub — Admin Dashboard: Drilldown Core
   通用彈窗框架 + Tab 切換 + 第二層 modal（清單鑽取）
   依賴：dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _activeDashDrillKey: null,

  /**
   * 路由到對應卡片的彈窗
   * @param {string} cardKey users|events|teams|tournaments|openEvents|endedEvents|records|attendance
   */
  _openDashDrilldown(cardKey) {
    if (!this._hasDashboardSnapshot?.()) {
      this.showToast?.('請先點上方「重新整理完整資料」按鈕');
      return;
    }
    const router = {
      users:        () => this._renderDashDrillUsers?.(),
      events:       () => this._renderDashDrillEvents?.(),
      teams:        () => this._renderDashDrillTeams?.(),
      tournaments:  () => this._renderDashDrillTournaments?.(),
      openEvents:   () => this._renderDashDrillOpenEvents?.(),
      endedEvents:  () => this._renderDashDrillEndedEvents?.(),
      records:      () => this._renderDashDrillRecords?.(),
      attendance:   () => this._renderDashDrillAttendance?.(),
    };
    const renderFn = router[cardKey];
    if (!renderFn) {
      this.showToast?.('此項詳情尚未開放');
      return;
    }
    this._activeDashDrillKey = cardKey;
    renderFn();
  },

  /**
   * 通用彈窗框架（Tab + 區塊直瀑式滾動）
   * @param {object} config { title, tabs: [{ key, label, render: () => htmlString }] }
   */
  _renderDashDrillShell(config) {
    let overlay = document.getElementById('dash-drill-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'dash-drill-overlay';
    overlay.className = 'dash-drill-overlay';

    const tabButtons = (config.tabs || []).map((t, i) =>
      `<button class="dash-drill-tab ${i === 0 ? 'active' : ''}" data-tab="${escapeHTML(t.key)}" type="button">${escapeHTML(t.label)}</button>`
    ).join('');

    overlay.innerHTML = `
      <div class="dash-drill-box">
        <div class="dash-drill-header">
          <h3 data-no-translate>${escapeHTML(config.title || '')}</h3>
          <button class="dash-drill-close" id="dash-drill-close-btn" type="button" aria-label="關閉">✕</button>
        </div>
        <div class="dash-drill-tabs">${tabButtons}</div>
        <div class="dash-drill-body" id="dash-drill-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 關閉：背景點擊、關閉鈕、Esc
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeDashDrilldown();
    });
    overlay.querySelector('#dash-drill-close-btn')?.addEventListener('click', () => this._closeDashDrilldown());

    // touchmove 穿透保護（允許 box 內部滾動）
    overlay.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.dash-drill-box')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });

    // Tab 切換
    overlay.querySelectorAll('.dash-drill-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.tab;
        overlay.querySelectorAll('.dash-drill-tab').forEach(b => b.classList.toggle('active', b === btn));
        const tab = (config.tabs || []).find(t => t.key === key);
        if (tab) {
          const body = document.getElementById('dash-drill-body');
          if (body) {
            body.scrollTop = 0;
            body.innerHTML = tab.render();
          }
        }
      });
    });

    // 初始渲染第一個 Tab
    const body = document.getElementById('dash-drill-body');
    if (body && config.tabs && config.tabs[0]) {
      body.innerHTML = config.tabs[0].render();
    }

    // Esc 關閉（綁一次性）
    if (!this._dashDrillEscBound) {
      this._dashDrillEscBound = true;
      this._dashDrillEscHandler = (e) => {
        if (e.key !== 'Escape') return;
        // 先關第二層，再關第一層
        if (document.getElementById('dash-drill-secondary-overlay')) {
          this._closeDashSecondaryList();
        } else if (document.getElementById('dash-drill-overlay')) {
          this._closeDashDrilldown();
        }
      };
      document.addEventListener('keydown', this._dashDrillEscHandler);
    }
  },

  _closeDashDrilldown() {
    const overlay = document.getElementById('dash-drill-overlay');
    if (overlay) overlay.remove();
    this._activeDashDrillKey = null;
    // 同時關第二層（防止孤兒 modal）
    this._closeDashSecondaryList();
  },

  /**
   * 第二層 modal：點排行項目鑽取清單
   * @param {string} title 標題
   * @param {string} htmlContent 預先組好的 HTML
   */
  _openDashSecondaryList(title, htmlContent) {
    let overlay = document.getElementById('dash-drill-secondary-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'dash-drill-secondary-overlay';
    overlay.className = 'dash-drill-overlay dash-drill-overlay-secondary';

    overlay.innerHTML = `
      <div class="dash-drill-box">
        <div class="dash-drill-header">
          <h3 data-no-translate>${escapeHTML(title || '')}</h3>
          <button class="dash-drill-close" id="dash-drill-secondary-close-btn" type="button" aria-label="關閉">✕</button>
        </div>
        <div class="dash-drill-body">${htmlContent}</div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeDashSecondaryList();
    });
    overlay.querySelector('#dash-drill-secondary-close-btn')?.addEventListener('click', () => this._closeDashSecondaryList());
    overlay.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.dash-drill-box')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });
  },

  _closeDashSecondaryList() {
    const overlay = document.getElementById('dash-drill-secondary-overlay');
    if (overlay) overlay.remove();
  },

  // ══════════════════════════════════
  //  共用渲染工具
  // ══════════════════════════════════

  /** 產出「分布長條圖列表」HTML（label + track + value） */
  _dashBarList(entries, total) {
    return entries.map(([k, v]) => {
      const pct = total > 0 ? Math.round(v / total * 100) : 0;
      return `<div class="dash-bar-row">
        <span class="dash-bar-label">${escapeHTML(String(k))}</span>
        <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%"></div></div>
        <span class="dash-bar-val">${v}</span>
      </div>`;
    }).join('');
  },

  /** 產出統計數字卡網格 HTML */
  _dashStatGrid(items) {
    return `<div class="dash-stat-grid">${items.map(it => `
      <div class="dash-stat-item">
        <div class="dash-stat-num">${escapeHTML(String(it.num))}</div>
        <div class="dash-stat-label">${escapeHTML(String(it.label))}</div>
      </div>
    `).join('')}</div>`;
  },

  /** 產出區塊 HTML */
  _dashSection(title, innerHtml, note) {
    const noteHtml = note ? `<span class="dash-section-note">${escapeHTML(note)}</span>` : '';
    return `<div class="dash-section">
      <div class="dash-section-title">${escapeHTML(title)}${noteHtml}</div>
      ${innerHtml}
    </div>`;
  },

});
