/* ================================================
   SportHub — Dashboard: GitHub Actions CI 用量 Widget
   依賴：config.js, dashboard-usage.js（共用 .dash-usage-card 樣式）
   資料來源：Firestore ciUsageSnapshots/latest
   寫入端：scripts/snapshot-ci-usage.js（每天 06:00 UTC 跑）
   ================================================ */
Object.assign(App, {

  /** 主入口：渲染 GitHub Actions CI 用量 widget */
  async renderCiUsage(container) {
    if (!container) return;
    if (document.getElementById('ci-usage-card')) return;
    if (this._renderingCiUsage) return;
    this._renderingCiUsage = true;

    // admin 以上可見（與 firestore.rules 一致）
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) {
      this._renderingCiUsage = false;
      return;
    }

    let data = null;
    try {
      if (typeof db === 'undefined') return;
      const snap = await db.doc('ciUsageSnapshots/latest').get();
      if (snap.exists) data = snap.data();
    } catch (err) {
      console.warn('[dashboard-ci-usage] 讀取失敗:', err.message);
    }

    let html = '<div class="info-card" id="ci-usage-card">'
      + '<div class="info-title" style="display:flex;justify-content:space-between;align-items:center">'
      + '  <span>GitHub Actions CI 用量（近 ' + (data?.periodDays || 30) + ' 天）</span>'
      + '  <button class="edu-info-btn" onclick="App._showCiUsageInfoPopup()" title="說明">?</button>'
      + '</div>';

    if (!data) {
      html += '<div style="text-align:center;padding:1rem;color:var(--text-secondary);font-size:.82rem">'
        + '尚無 CI 用量資料<br>'
        + '<span style="font-size:.75rem">每天 14:00（台北時間）自動更新</span>'
        + '</div></div>';
      this._insertCiUsageCard(container, html);
      this._renderingCiUsage = false;
      return;
    }

    // 摘要 3 卡（總次數 / 總分鐘 / 配額%）
    const totalRuns = Number(data.totalRuns || 0);
    const totalMin = Number(data.totalMinutes || 0);
    const usagePct = Number(data.usagePct || 0);
    const freeTier = Number(data.freeTierMinutes || 2000);
    const successRate = Number(data.successRate || 0);
    const failureCount = Number(data.failureCount || 0);

    const usageColor = this._usageBarColor ? this._usageBarColor(usagePct) : '#10b981';

    html += '<div class="dash-usage-grid">'
      + this._renderCiUsageCard('執行次數', totalRuns, '近 ' + (data.periodDays || 30) + ' 天')
      + this._renderCiUsageCard('總分鐘', totalMin, freeTier + ' 上限')
      + this._renderCiUsagePctCard('配額使用率', usagePct, usageColor)
      + '</div>';

    // 成功率 / 失敗數
    html += '<div style="margin-top:.6rem;font-size:.78rem;color:var(--text-secondary)">'
      + '✅ 成功率 ' + successRate + '%（' + (totalRuns - failureCount) + '/' + totalRuns + '）'
      + (failureCount > 0 ? ' · <span style="color:#ef4444">⚠ ' + failureCount + ' 次失敗</span>' : '')
      + '</div>';

    // 各 workflow 排名（橫條圖）
    const workflows = Array.isArray(data.workflows) ? data.workflows.slice(0, 8) : [];
    if (workflows.length > 0) {
      const maxMin = Math.max.apply(null, workflows.map(w => Number(w.totalMinutes || 0)).concat([1]));
      html += '<div style="font-size:.75rem;font-weight:600;color:var(--text-secondary);margin:.7rem 0 .4rem">'
        + '各 Workflow 用量（依分鐘數排序）</div>';
      html += '<div class="dash-bar-list">';
      workflows.forEach(w => {
        const wMin = Number(w.totalMinutes || 0);
        const wCount = Number(w.count || 0);
        const wFail = Number(w.failure || 0);
        const pct = Math.round((wMin / maxMin) * 100);
        const barColor = wFail > 0 ? '#f59e0b' : '#3b82f6';
        html += '<div class="dash-bar-row">'
          + '  <div class="dash-bar-label" title="' + escapeHTML(w.name) + '">' + escapeHTML(w.name) + '</div>'
          + '  <div class="dash-bar-track"><div class="dash-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>'
          + '  <div class="dash-bar-val">' + wCount + ' 次 / ' + wMin.toFixed(0) + ' 分</div>'
          + '</div>';
      });
      html += '</div>';
    }

    // 最後更新時間
    const asOf = data.asOf ? new Date(data.asOf) : null;
    if (asOf && !isNaN(asOf.getTime())) {
      const ts = asOf.toLocaleString('zh-TW', { hour12: false });
      html += '<div style="font-size:.7rem;color:var(--text-muted);margin-top:.5rem">資料更新於：' + escapeHTML(ts) + '</div>';
    }

    html += '</div>'; // info-card 收尾
    this._insertCiUsageCard(container, html);
    this._renderingCiUsage = false;
  },

  _insertCiUsageCard(container, html) {
    if (document.getElementById('ci-usage-card')) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    container.appendChild(wrapper);
  },

  _renderCiUsageCard(label, value, sub) {
    return '<div class="dash-usage-card">'
      + '<div class="dash-usage-label">' + escapeHTML(label) + '</div>'
      + '<div class="dash-usage-num">' + escapeHTML(String(value)) + '</div>'
      + '<div class="dash-usage-sub">' + escapeHTML(sub) + '</div>'
      + '</div>';
  },

  _renderCiUsagePctCard(label, pct, color) {
    return '<div class="dash-usage-card">'
      + '<div class="dash-usage-label">' + escapeHTML(label) + '</div>'
      + '<div class="dash-usage-num" style="color:' + color + '">' + pct + '%</div>'
      + '<div class="dash-usage-bar-track"><div class="dash-usage-bar-fill" style="width:' + Math.min(100, pct) + '%;background:' + color + '"></div></div>'
      + '<div class="dash-usage-sub">' + (pct < 50 ? '安全' : pct < 80 ? '注意' : '接近上限') + '</div>'
      + '</div>';
  },

  _showCiUsageInfoPopup() {
    const body = ''
      + '<p style="margin-bottom:.6rem">此區塊顯示專案在 GitHub Actions 上的 CI 用量、由排程每天從 GitHub API 抓取後寫入 Firestore。</p>'

      + '<div style="font-weight:700;margin:.7rem 0 .3rem">資料說明</div>'
      + '<ul>'
      + '<li><b>執行次數</b> — 近 30 天所有 workflow runs 的累計次數</li>'
      + '<li><b>總分鐘</b> — 所有 runs 的累計執行時間（runner 計時）</li>'
      + '<li><b>配額使用率</b> — 相對於 GitHub Free Tier 2000 分鐘/月的百分比</li>'
      + '<li><b>各 Workflow 用量</b> — 依分鐘數排序、橘色表示有失敗 run</li>'
      + '</ul>'

      + '<div style="font-weight:700;margin:.7rem 0 .3rem">配額顏色</div>'
      + '<ul>'
      + '<li><span style="color:#10b981;font-weight:700">綠色</span> — 低於 50%、安全</li>'
      + '<li><span style="color:#f59e0b;font-weight:700">橘色</span> — 50%~80%、需注意</li>'
      + '<li><span style="color:#ef4444;font-weight:700">紅色</span> — 超過 80%、接近上限</li>'
      + '</ul>'

      + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.6rem">每日 14:00（台北時間）自動更新一次。資料來源：scripts/snapshot-ci-usage.js（GitHub Actions 排程）。</p>';

    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">CI 用量說明</div>'
      + '<div class="edu-info-dialog-body">' + body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
