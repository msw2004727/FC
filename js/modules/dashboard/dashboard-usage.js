/* ================================================
   SportHub — Dashboard: Firebase Usage Metrics Widget
   依賴：config.js, api-service.js, firebase-service.js, i18n.js
   ================================================ */
Object.assign(App, {

  /** Spark 免費額度定義（每日） */
  _USAGE_FREE_TIER: {
    firestoreReads:   50000,   // 50K reads/day
    firestoreWrites:  20000,   // 20K writes/day
    firestoreDeletes: 20000,   // 20K deletes/day
    firestoreStorageBytes: 1073741824, // 1 GiB
    functionsInvocations: 66666, // 2M/month ≈ 66K/day
  },

  /** 格式化數字為易讀字串 */
  _fmtUsageNum(n) {
    if (n == null) return '--';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  },

  /** 格式化 bytes */
  _fmtBytes(bytes) {
    if (bytes == null) return '--';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GiB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MiB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KiB';
    return bytes + ' B';
  },

  /** 計算百分比並限制在 0~100 */
  _usagePct(used, total) {
    if (used == null || !total) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  },

  /** 進度條顏色 */
  _usageBarColor(pct) {
    if (pct >= 80) return '#ef4444'; // red
    if (pct >= 50) return '#f59e0b'; // amber
    return '#10b981'; // green
  },

  /** 渲染單張用量卡片 */
  _renderUsageCard(label, value, freeLimit, formatter) {
    const fmt = formatter || this._fmtUsageNum.bind(this);
    const pct = this._usagePct(value, freeLimit);
    const color = this._usageBarColor(pct);
    const displayVal = fmt(value);
    const displayLimit = fmt(freeLimit);
    return `<div class="dash-usage-card">
      <div class="dash-usage-label">${escapeHTML(label)}</div>
      <div class="dash-usage-num">${escapeHTML(displayVal)}</div>
      <div class="dash-usage-bar-track">
        <div class="dash-usage-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="dash-usage-sub">${escapeHTML(String(pct))}% of ${escapeHTML(displayLimit)}/日</div>
    </div>`;
  },

  /** 主入口：渲染雲端用量區塊 */
  async renderUsageMetrics(container) {
    if (!container) return;

    // 僅 super_admin 可見
    if (this.currentRole !== 'super_admin') return;

    // 取得最近 7 天的 usageMetrics
    let docs = [];
    try {
      // Demo 模式或 db 未就緒時跳過
      if (typeof ApiService !== 'undefined' && ApiService._demoMode) return;
      if (typeof db === 'undefined') return;
      const snap = await db.collection('usageMetrics')
        .orderBy('dateKey', 'desc')
        .limit(7)
        .get();
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('[dashboard-usage] 讀取 usageMetrics 失敗:', err);
    }

    const latest = docs.length > 0 ? docs[0] : null;
    const ft = this._USAGE_FREE_TIER;

    // 構建 HTML
    let html = `<div class="info-card" id="usage-metrics-card">
      <div class="info-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>雲端用量（過去 24 小時）</span>
        <button class="btn-sm" id="btn-refresh-usage" style="font-size:.72rem;padding:.2rem .5rem">重新抓取</button>
      </div>`;

    if (!latest) {
      html += `<div style="text-align:center;padding:1rem;color:var(--text-secondary);font-size:.82rem">
        尚無用量數據<br>
        <span style="font-size:.75rem">請先點「重新抓取」或等待排程自動收集</span>
      </div>`;
    } else {
      // 警示橫幅
      const alertItems = [];
      const checkAlert = (key, label) => {
        const pct = this._usagePct(latest[key], ft[key]);
        if (pct >= 80) alertItems.push(`${label} ${pct}%`);
      };
      checkAlert('firestoreReads', 'Firestore 讀取');
      checkAlert('firestoreWrites', 'Firestore 寫入');
      checkAlert('functionsInvocations', 'Functions 呼叫');

      if (alertItems.length > 0) {
        html += `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:.5rem .75rem;margin-bottom:.75rem;font-size:.78rem;color:#991b1b">
          ⚠ 接近免費額度上限：${alertItems.join('、')}
        </div>`;
      }

      // 收集時間
      const collectedAt = latest.collectedAt?.toDate?.() || latest.collectedAt;
      const timeStr = collectedAt ? new Date(collectedAt).toLocaleString('zh-TW', { hour12: false }) : latest.dateKey;
      html += `<div style="font-size:.72rem;color:var(--text-secondary);margin-bottom:.5rem">截至 ${escapeHTML(timeStr)}</div>`;

      // 用量卡片 grid
      html += `<div class="dash-usage-grid">`;
      html += this._renderUsageCard('Firestore 讀取', latest.firestoreReads, ft.firestoreReads);
      html += this._renderUsageCard('Firestore 寫入', latest.firestoreWrites, ft.firestoreWrites);
      html += this._renderUsageCard('Firestore 刪除', latest.firestoreDeletes, ft.firestoreDeletes);
      html += this._renderUsageCard('Functions 呼叫', latest.functionsInvocations, ft.functionsInvocations);
      html += this._renderUsageCard('Firestore 儲存', latest.firestoreStorageBytes, ft.firestoreStorageBytes, this._fmtBytes.bind(this));
      // Functions 錯誤（不顯示百分比）
      html += `<div class="dash-usage-card">
        <div class="dash-usage-label">Functions 延遲</div>
        <div class="dash-usage-num">${this._fmtUsageNum(latest.functionsLatency)}</div>
        <div class="dash-usage-sub">執行次數 (含延遲採樣)</div>
      </div>`;
      html += `</div>`; // grid end

      // 錯誤提示
      if (latest.errors && latest.errors.length > 0) {
        html += `<div style="font-size:.72rem;color:#b45309;margin-top:.5rem">
          部分指標抓取失敗：${latest.errors.map(e => escapeHTML(e)).join('；')}
        </div>`;
      }
    }

    // 7 天趨勢
    if (docs.length >= 2) {
      html += `<div style="margin-top:1rem">
        <div style="font-size:.82rem;font-weight:600;margin-bottom:.5rem">近 7 天趨勢</div>
        <canvas id="dash-usage-trend" style="width:100%;display:block"></canvas>
      </div>`;
    }

    html += `</div>`; // info-card end

    // 插入到 container
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    container.appendChild(wrapper);

    // 綁定重新抓取按鈕
    const btn = document.getElementById('btn-refresh-usage');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '抓取中...';
        try {
          const fn = firebase.app().functions('asia-east1').httpsCallable('fetchUsageMetricsManual');
          const res = await fn();
          this.showToast('用量數據已更新');
          // 重新渲染
          const card = document.getElementById('usage-metrics-card');
          if (card) card.parentElement.remove();
          await this.renderUsageMetrics(container);
        } catch (err) {
          console.error('[dashboard-usage] 手動抓取失敗:', err);
          this.showToast('抓取失敗：' + (err.message || err));
          btn.disabled = false;
          btn.textContent = '重新抓取';
        }
      });
    }

    // 繪製趨勢圖
    if (docs.length >= 2) {
      requestAnimationFrame(() => this._drawUsageTrendChart(docs.reverse()));
    }
  },

  /** 繪製 7 天用量趨勢折線圖 */
  _drawUsageTrendChart(docs) {
    const el = document.getElementById('dash-usage-trend');
    if (!el || !el.parentElement) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = el.parentElement.offsetWidth - 16 || 280;
    const h = 160;
    el.width = w * dpr; el.height = h * dpr;
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 12, bottom: 30, left: 45 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    // 資料系列
    const series = [
      { key: 'firestoreReads',  label: '讀取', color: '#3b82f6' },
      { key: 'firestoreWrites', label: '寫入', color: '#10b981' },
      { key: 'functionsInvocations', label: 'Functions', color: '#8b5cf6' },
    ];

    // 找最大值
    let maxVal = 100;
    for (const doc of docs) {
      for (const s of series) {
        if (doc[s.key] != null && doc[s.key] > maxVal) maxVal = doc[s.key];
      }
    }
    maxVal = Math.ceil(maxVal * 1.15);

    // 背景
    ctx.fillStyle = isDark ? '#1e293b' : '#f8fafc';
    ctx.fillRect(pad.left, pad.top, cw, ch);

    // 網格線
    ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (ch / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
      // Y 軸標籤
      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const val = maxVal - (maxVal / 4) * i;
      ctx.fillText(this._fmtUsageNum(val), pad.left - 4, y);
    }

    // X 軸標籤
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    docs.forEach((doc, i) => {
      const x = pad.left + (cw / (docs.length - 1 || 1)) * i;
      const label = doc.dateKey ? doc.dateKey.slice(4, 6) + '/' + doc.dateKey.slice(6, 8) : '';
      ctx.fillText(label, x, pad.top + ch + 6);
    });

    // 繪製折線
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      docs.forEach((doc, i) => {
        const x = pad.left + (cw / (docs.length - 1 || 1)) * i;
        const val = doc[s.key] || 0;
        const y = pad.top + ch - (val / maxVal) * ch;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // 繪製圓點
      docs.forEach((doc, i) => {
        const x = pad.left + (cw / (docs.length - 1 || 1)) * i;
        const val = doc[s.key] || 0;
        const y = pad.top + ch - (val / maxVal) * ch;
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      });
    }

    // 圖例
    let lx = pad.left;
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, 4, 12, 8);
      ctx.fillStyle = isDark ? '#cbd5e1' : '#475569';
      ctx.fillText(s.label, lx + 15, 3);
      lx += ctx.measureText(s.label).width + 28;
    }
  },
});
