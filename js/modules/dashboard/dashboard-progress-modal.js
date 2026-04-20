/* ================================================
   SportHub — Admin Dashboard: Progress Modal
   撈取完整資料時的進度條 UI
   依賴：dashboard-data-fetcher.js
   ================================================ */

Object.assign(App, {

  _openDashboardProgressModal() {
    let overlay = document.getElementById('dashboard-progress-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'dashboard-progress-overlay';
    overlay.className = 'dash-progress-overlay';
    overlay.innerHTML = `
      <div class="dash-progress-box">
        <div class="dash-progress-header">撈取完整資料</div>
        <div class="dash-progress-bar-wrap">
          <div class="dash-progress-bar" id="dash-progress-bar" style="width:0%"></div>
        </div>
        <div class="dash-progress-percent" id="dash-progress-percent">0%</div>
        <ul class="dash-progress-steps" id="dash-progress-steps"></ul>
        <div class="dash-progress-actions">
          <button class="outline-btn" id="dash-progress-cancel-btn" type="button">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 阻止 touchmove 穿透背景，但允許 box 內部滾動
    overlay.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.dash-progress-box')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });

    // 綁取消（避免 inline onclick 的 XSS / CSP 議題）
    const cancelBtn = overlay.querySelector('#dash-progress-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this._cancelDashboardFetch?.();
        cancelBtn.disabled = true;
        cancelBtn.textContent = '取消中...';
      });
    }

    return overlay;
  },

  _updateDashboardProgress(progress) {
    const overlay = document.getElementById('dashboard-progress-overlay');
    if (!overlay) return;
    const bar = document.getElementById('dash-progress-bar');
    const percent = document.getElementById('dash-progress-percent');
    const stepsList = document.getElementById('dash-progress-steps');

    const pct = Math.round((progress.step / progress.total) * 100);
    if (bar) bar.style.width = pct + '%';
    if (percent) percent.textContent = pct + '%';

    if (stepsList) {
      const existing = stepsList.querySelector(`[data-step="${progress.step}"]`);
      const icon = progress.status === 'done' ? '✓'
                 : progress.status === 'error' ? '✗'
                 : '⏳';
      const color = progress.status === 'done' ? 'var(--success, #10b981)'
                  : progress.status === 'error' ? 'var(--danger, #ef4444)'
                  : 'var(--text-muted)';
      const suffix = progress.status === 'done' ? `：${progress.count || 0} 筆`
                   : progress.status === 'error' ? `：${progress.message || '錯誤'}`
                   : '...';
      const safeName = escapeHTML(progress.stepName || '');
      const safeSuffix = escapeHTML(suffix);
      const html = `<li data-step="${progress.step}" style="color:${color}">${icon} ${safeName}${safeSuffix}</li>`;
      if (existing) {
        existing.outerHTML = html;
      } else {
        stepsList.insertAdjacentHTML('beforeend', html);
      }
    }
  },

  _closeDashboardProgressModal() {
    const overlay = document.getElementById('dashboard-progress-overlay');
    if (overlay) overlay.remove();
  },

});
