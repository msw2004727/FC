/* ================================================
   SportHub — Dashboard: Firebase Usage Metrics Widget
   依賴：config.js, api-service.js, firebase-service.js, i18n.js
   ================================================ */
Object.assign(App, {

  /** Blaze 方案每日免費額度（超過部分依 pay-as-you-go 計費） */
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

  /** 渲染純數字卡片（無免費額度對比） */
  _renderUsageNumCard(label, value, unit) {
    var displayVal;
    if (unit === 'bytes') displayVal = this._fmtBytes(value);
    else if (unit === 's') displayVal = this._fmtUsageNum(value) + 's';
    else displayVal = this._fmtUsageNum(value);
    return `<div class="dash-usage-card">
      <div class="dash-usage-label">${escapeHTML(label)}</div>
      <div class="dash-usage-num">${escapeHTML(displayVal)}</div>
      <div class="dash-usage-sub">過去 24 小時</div>
    </div>`;
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
      <div class="dash-usage-sub">${escapeHTML(String(pct))}% 免費額度（${escapeHTML(displayLimit)}/月累計）</div>
    </div>`;
  },

  /** 主入口：渲染雲端用量區塊 */
  async renderUsageMetrics(container) {
    if (!container) return;

    // 防止重複渲染 + async race
    if (document.getElementById('usage-metrics-card')) return;
    if (this._renderingUsageMetrics) return;
    this._renderingUsageMetrics = true;

    // admin 以上可見
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) { this._renderingUsageMetrics = false; return; }

    // 取得當月 1 號至今的 usageMetrics
    let docs = [];
    try {
      if (typeof db === 'undefined') return;
      var _now = new Date();
      var _monthStartKey = String(_now.getFullYear()) + String(_now.getMonth() + 1).padStart(2, '0') + '01';
      const snap = await db.collection('usageMetrics')
        .where('dateKey', '>=', _monthStartKey)
        .orderBy('dateKey', 'desc')
        .get();
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('[dashboard-usage] 讀取 usageMetrics 失敗:', err);
    }

    const latest = docs.length > 0 ? docs[0] : null;
    const ft = this._USAGE_FREE_TIER;

    // 當月累計：加總所有天的用量
    var _sumKey = function(key) {
      var total = 0;
      for (var i = 0; i < docs.length; i++) {
        if (docs[i][key] != null) total += Number(docs[i][key]) || 0;
      }
      return total;
    };
    var _sumHasData = function(key) {
      for (var i = 0; i < docs.length; i++) { if (docs[i][key] != null) return true; }
      return false;
    };
    // 當月免費額度 = 每日額度 × 天數
    var _monthDays = docs.length || 1;
    var ftMonth = {};
    for (var _fk in ft) { ftMonth[_fk] = ft[_fk] * _monthDays; }

    // 構建 HTML
    var _mNow = new Date();
    var _mLabel = _mNow.getFullYear() + '/' + (_mNow.getMonth() + 1) + ' 月';
    let html = `<div class="info-card" id="usage-metrics-card">
      <div class="info-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>雲端用量 Blaze（${escapeHTML(_mLabel)}累計，${escapeHTML(String(_monthDays))} 天）</span>
        <div style="display:flex;gap:.4rem;align-items:center">
          <button class="edu-info-btn" onclick="App._showUsageInfoPopup()" title="用量說明">?</button>
          <button class="btn-sm" id="btn-refresh-usage" style="font-size:.72rem;padding:.2rem .5rem">重新抓取</button>
        </div>
      </div>`;

    if (!latest) {
      html += `<div style="text-align:center;padding:1rem;color:var(--text-secondary);font-size:.82rem">
        尚無用量數據<br>
        <span style="font-size:.75rem">請先點「重新抓取」或等待排程自動收集</span>
      </div>`;
    } else {
      // 警示橫幅（用今日資料判斷是否接近每日上限）
      const alertItems = [];
      const checkAlert = (key, label) => {
        const pct = this._usagePct(latest[key], ft[key]);
        if (pct >= 80) alertItems.push(`${label} ${pct}%`);
      };
      checkAlert('firestoreReads', 'Firestore 讀取');
      checkAlert('firestoreWrites', 'Firestore 寫入');
      checkAlert('functionsInvocations', 'Functions 呼叫');

      if (alertItems.length > 0) {
        // 2026-04-27：用半透明紅在淺/深色主題都可讀
        html += `<div class="dash-usage-alert">
          ⚠ 今日接近免費額度上限，超過將產生費用：${escapeHTML(alertItems.join('、'))}
        </div>`;
      }

      // 最新收集時間
      const collectedAt = latest.collectedAt?.toDate?.() || latest.collectedAt;
      const timeStr = collectedAt ? new Date(collectedAt).toLocaleString('zh-TW', { hour12: false }) : latest.dateKey;
      html += `<div style="font-size:.72rem;color:var(--text-secondary);margin-bottom:.5rem">最新資料：${escapeHTML(timeStr)}</div>`;

      // ── Firestore ──
      html += `<div style="font-size:.75rem;font-weight:600;color:var(--text-secondary);margin-bottom:.3rem">Firestore</div>`;
      html += `<div class="dash-usage-grid">`;
      html += this._renderUsageCard('讀取', _sumKey('firestoreReads'), ftMonth.firestoreReads);
      html += this._renderUsageCard('寫入', _sumKey('firestoreWrites'), ftMonth.firestoreWrites);
      html += this._renderUsageCard('刪除', _sumKey('firestoreDeletes'), ftMonth.firestoreDeletes);
      html += `</div>`;

      // ── Cloud Functions / Cloud Run ──
      html += `<div style="font-size:.75rem;font-weight:600;color:var(--text-secondary);margin:.6rem 0 .3rem">Cloud Functions</div>`;
      html += `<div class="dash-usage-grid">`;
      html += this._renderUsageCard('呼叫次數', _sumKey('functionsInvocations'), ftMonth.functionsInvocations);
      if (_sumHasData('cloudRunRequests')) {
        html += this._renderUsageNumCard('Cloud Run 請求', _sumKey('cloudRunRequests'));
      }
      if (_sumHasData('cloudRunInstanceTime')) {
        html += this._renderUsageNumCard('運算時間', Math.round(_sumKey('cloudRunInstanceTime')), 's');
      }
      html += `</div>`;

      // ── Cloud Storage ──
      var _hasStorage = _sumHasData('storageApiRequests') || _sumHasData('storageBytesReceived') || _sumHasData('storageBytesSent');
      if (_hasStorage) {
        html += `<div style="font-size:.75rem;font-weight:600;color:var(--text-secondary);margin:.6rem 0 .3rem">Cloud Storage</div>`;
        html += `<div class="dash-usage-grid">`;
        if (_sumHasData('storageApiRequests')) html += this._renderUsageNumCard('API 請求', _sumKey('storageApiRequests'));
        if (_sumHasData('storageBytesSent')) html += this._renderUsageNumCard('下載流量', _sumKey('storageBytesSent'), 'bytes');
        if (_sumHasData('storageBytesReceived')) html += this._renderUsageNumCard('上傳流量', _sumKey('storageBytesReceived'), 'bytes');
        html += `</div>`;
      }

      // ── App Engine ──
      if (_sumHasData('appEngineRequests')) {
        html += `<div style="font-size:.75rem;font-weight:600;color:var(--text-secondary);margin:.6rem 0 .3rem">App Engine</div>`;
        html += `<div class="dash-usage-grid">`;
        html += this._renderUsageNumCard('請求數', _sumKey('appEngineRequests'));
        html += `</div>`;
      }

      // ── 費用區塊（傳入所有 docs 以累計當月估算） ──
      html += this._renderCostSection(latest, docs);

      // 錯誤提示
      if (latest.errors && latest.errors.length > 0) {
        html += `<div style="font-size:.72rem;color:#b45309;margin-top:.5rem">
          部分指標抓取失敗：${latest.errors.map(e => escapeHTML(e)).join('；')}
        </div>`;
      }
    }

    // 當月趨勢
    if (docs.length >= 2) {
      html += `<div style="margin-top:1rem">
        <div style="font-size:.82rem;font-weight:600;margin-bottom:.5rem">當月趨勢</div>
        <canvas id="dash-usage-trend" style="width:100%;display:block"></canvas>
      </div>`;
    }

    html += `</div>`; // info-card end

    // 插入前再次檢查（防 async race）
    if (document.getElementById('usage-metrics-card')) { this._renderingUsageMetrics = false; return; }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    container.appendChild(wrapper);
    this._renderingUsageMetrics = false;

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

  /** 格式化金額 */
  _fmtCurrency(val, currency) {
    if (val == null) return '--';
    const num = Number(val);
    if (isNaN(num)) return '--';
    const sym = currency === 'TWD' ? 'NT$' : currency === 'USD' ? 'US$' : (currency || '') + ' ';
    return sym + num.toFixed(2);
  },

  /** 渲染費用區塊（Billing API 實際 + 近 N 天累計估算） */
  _renderCostSection(latest, docs) {
    const billing = latest.billing;
    const estimated = latest.estimated;
    if (!billing && !estimated) return '';

    let html = `<div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border)">
      <div style="font-size:.82rem;font-weight:600;margin-bottom:.5rem">費用</div>`;

    // 實際費用（Billing API）
    if (billing && billing.totalCost != null) {
      const color = billing.totalCost > 0 ? '#ef4444' : '#10b981';
      html += `<div class="dash-cost-row">
        <span class="dash-cost-label">實際帳單（${escapeHTML(billing.billingPeriod || '--')}）</span>
        <span class="dash-cost-val" style="color:${color}">${escapeHTML(this._fmtCurrency(billing.totalCost, billing.currency))}</span>
      </div>`;
      if (billing.costByService) {
        const entries = Object.entries(billing.costByService).sort((a, b) => b[1] - a[1]);
        for (const [svc, cost] of entries) {
          html += `<div class="dash-cost-row dash-cost-detail">
            <span class="dash-cost-label">${escapeHTML(svc)}</span>
            <span class="dash-cost-val">${escapeHTML(this._fmtCurrency(cost, billing.currency))}</span>
          </div>`;
        }
      }
    } else {
      html += `<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.3rem">
        帳單資料同步中（請點「重新抓取」更新）
      </div>`;
    }

    // 近 N 天累計估算：只累加有資料的天數，誠實標示
    const recentEst = this._calcRecentEstimated(docs);

    if (recentEst) {
      var _mNow = new Date();
      var _mLabel = _mNow.getFullYear() + '/' + (_mNow.getMonth() + 1);
      const mColor = recentEst.totalCost > 0 ? '#f59e0b' : '#10b981';
      html += `<div class="dash-cost-row" style="margin-top:.4rem">
        <span class="dash-cost-label">${escapeHTML(_mLabel)} 月超額估算（${escapeHTML(String(recentEst.days))} 天資料）</span>
        <span class="dash-cost-val" style="color:${mColor}">${escapeHTML(this._fmtCurrency(recentEst.totalCost, 'USD'))}</span>
      </div>`;
      if (recentEst.breakdown) {
        for (const [key, info] of Object.entries(recentEst.breakdown)) {
          if (info.cost > 0) {
            const label = key.replace('firestore', 'Firestore ').replace('functions', 'Functions ').replace('Reads', '讀取').replace('Writes', '寫入').replace('Deletes', '刪除').replace('Invocations', '呼叫');
            html += `<div class="dash-cost-row dash-cost-detail">
              <span class="dash-cost-label">${escapeHTML(label)}（超額 ${escapeHTML(this._fmtUsageNum(info.overage))}）</span>
              <span class="dash-cost-val">${escapeHTML(this._fmtCurrency(info.cost, 'USD'))}</span>
            </div>`;
          }
        }
      }
      if (recentEst.totalCost === 0) {
        html += `<div style="font-size:.72rem;color:#10b981;margin-top:.2rem">所有用量皆在免費額度內</div>`;
      }
      html += `<div style="font-size:.68rem;color:var(--text-secondary);margin-top:.2rem">* 估算基於用量×公開定價，僅供參考，非實際帳單</div>`;
    }

    html += `</div>`;
    return html;
  },

  /** 累加所有有 estimated 資料的 docs（誠實顯示有幾天就算幾天） */
  _calcRecentEstimated(docs) {
    if (!docs || docs.length === 0) return null;
    const estDocs = docs.filter(d => d.estimated);
    if (estDocs.length === 0) return null;

    const totalBreakdown = {};
    let totalCost = 0;
    for (const doc of estDocs) {
      const est = doc.estimated;
      totalCost += (Number(est.totalCost) || 0);
      if (est.breakdown) {
        for (const [key, info] of Object.entries(est.breakdown)) {
          if (!totalBreakdown[key]) totalBreakdown[key] = { overage: 0, cost: 0 };
          totalBreakdown[key].overage += (Number(info.overage) || 0);
          totalBreakdown[key].cost += (Number(info.cost) || 0);
        }
      }
    }
    // 四捨五入
    totalCost = Math.round(totalCost * 100) / 100;
    for (const key of Object.keys(totalBreakdown)) {
      totalBreakdown[key].cost = Math.round(totalBreakdown[key].cost * 10000) / 10000;
    }
    return { totalCost, breakdown: totalBreakdown, days: estDocs.length };
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
      const day = doc.dateKey ? parseInt(String(doc.dateKey).slice(6, 8), 10) : 0;
      const label = day ? String(day) : '';
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

  // ═══════════════════════════════════════════════════
  //  翻譯 API 用量卡片
  // ═══════════════════════════════════════════════════

  _TRANSLATE_FREE_CHARS: 500000,

  async renderTranslateUsage(container) {
    if (!container) return;
    if (document.getElementById('translate-usage-card')) return;
    if (this._renderingTranslateUsage) return;
    this._renderingTranslateUsage = true;
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.admin) { this._renderingTranslateUsage = false; return; }

    const now = new Date();
    const monthKey = 'translate_' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0');
    let data = null;
    try {
      if (typeof db === 'undefined') return;
      const snap = await db.doc('translateUsage/' + monthKey).get();
      if (snap.exists) data = snap.data();
    } catch (err) {
      console.warn('[dashboard] translateUsage 讀取失敗:', err);
    }

    const chars = data?.totalChars || 0;
    const calls = data?.totalCalls || 0;
    const byLang = data?.byLang || {};
    const free = this._TRANSLATE_FREE_CHARS;
    const pct = this._usagePct(chars, free);
    const color = this._usageBarColor(pct);
    const cost = chars <= free ? 0 : (chars - free) * 0.00002;
    const costColor = cost > 0 ? '#ef4444' : '#10b981';
    const monthLabel = now.getFullYear() + '/' + (now.getMonth() + 1);

    // 語言分佈
    const langEntries = Object.entries(byLang).sort((a, b) => b[1] - a[1]);
    const langHtml = langEntries.length > 0
      ? langEntries.map(([lang, c]) => escapeHTML(lang) + ' ' + this._fmtUsageNum(c)).join(' · ')
      : '尚無資料';

    const html = '<div class="info-card" id="translate-usage-card">'
      + '<div class="info-title">翻譯 API 用量（' + escapeHTML(monthLabel) + '）</div>'
      + '<div class="dash-usage-grid">'
      + '<div class="dash-usage-card">'
      + '  <div class="dash-usage-label">已用字元</div>'
      + '  <div class="dash-usage-num">' + escapeHTML(this._fmtUsageNum(chars)) + '</div>'
      + '  <div class="dash-usage-bar-track"><div class="dash-usage-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
      + '  <div class="dash-usage-sub">' + pct + '% of ' + this._fmtUsageNum(free) + '/月</div>'
      + '</div>'
      + '<div class="dash-usage-card">'
      + '  <div class="dash-usage-label">翻譯次數</div>'
      + '  <div class="dash-usage-num">' + escapeHTML(String(calls)) + '</div>'
      + '  <div class="dash-usage-sub">Cloud Function 呼叫</div>'
      + '</div>'
      + '<div class="dash-usage-card">'
      + '  <div class="dash-usage-label">估算費用</div>'
      + '  <div class="dash-usage-num" style="color:' + costColor + '">$' + cost.toFixed(2) + '</div>'
      + '  <div class="dash-usage-sub">' + (cost > 0 ? '超出免費額度' : '免費額度內') + '</div>'
      + '</div>'
      + '<div class="dash-usage-card">'
      + '  <div class="dash-usage-label">語言分佈</div>'
      + '  <div class="dash-usage-num" style="font-size:.78rem">' + langHtml + '</div>'
      + '  <div class="dash-usage-sub">依字元數排序</div>'
      + '</div>'
      + '</div></div>';

    // 插入前再次檢查（防 async race）
    if (!document.getElementById('translate-usage-card')) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      container.appendChild(wrapper);
    }
    this._renderingTranslateUsage = false;
  },

  // ── 雲端用量說明彈窗（樣式參考教學俱樂部 edu-info-popup）──
  _showUsageInfoPopup() {
    const body = ''
      + '<p style="margin-bottom:.6rem">此區塊顯示 Firebase Blaze 方案的雲端資源使用狀況，數據由排程或手動抓取自 Google Cloud Monitoring API。</p>'

      + '<div style="font-weight:700;margin:.7rem 0 .3rem">Firestore</div>'
      + '<ul>'
      + '<li><b>讀取</b> — 每次查詢或載入資料都算一次讀取，例如用戶打開活動清單、查報名紀錄。</li>'
      + '<li><b>寫入</b> — 每次新增或修改資料都算一次寫入，例如報名、取消報名、編輯活動。</li>'
      + '<li><b>刪除</b> — 每次移除資料都算一次刪除，例如刪除過期快取、移除取消的報名。</li>'
      + '</ul>'

      + '<div style="font-weight:700;margin:.7rem 0 .3rem">Cloud Functions</div>'
      + '<ul>'
      + '<li><b>呼叫次數</b> — 後端函式被觸發的次數，包含報名、取消報名、推播通知等。</li>'
      + '<li><b>Cloud Run 請求</b> — 每次函式執行時 Cloud Run 處理的 HTTP 請求數量。</li>'
      + '<li><b>運算時間</b> — 函式實際執行花費的秒數，反映後端的運算負載。</li>'
      + '</ul>'

      + '<div style="font-weight:700;margin:.7rem 0 .3rem">Cloud Storage</div>'
      + '<ul>'
      + '<li><b>API 請求</b> — 上傳、下載、列出檔案等操作的次數。</li>'
      + '<li><b>下載流量</b> — 用戶從 Storage 下載圖片或檔案的傳輸量（例如活動封面圖）。</li>'
      + '<li><b>上傳流量</b> — 上傳圖片或檔案到 Storage 的傳輸量。</li>'
      + '</ul>'

      + '<div style="font-weight:700;margin:.7rem 0 .3rem">App Engine</div>'
      + '<ul>'
      + '<li><b>請求數</b> — App Engine 處理的 HTTP 請求數量。</li>'
      + '</ul>'

      + '<div style="font-weight:700;margin:.7rem 0 .3rem">進度條顏色</div>'
      + '<ul>'
      + '<li><span style="color:#10b981;font-weight:700">綠色</span> — 低於 50% 免費額度，安全。</li>'
      + '<li><span style="color:#f59e0b;font-weight:700">橘色</span> — 50%～80%，需注意。</li>'
      + '<li><span style="color:#ef4444;font-weight:700">紅色</span> — 超過 80%，接近上限，超過將產生費用。</li>'
      + '</ul>'

      + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.6rem">Blaze 方案每日有免費額度，超出部分才會計費。「月累計」是將每日額度乘以已收集天數計算。</p>';

    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">雲端用量說明</div>'
      + '<div class="edu-info-dialog-body">' + body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  // ═══════════════════════════════════════════════════
  //  即時監聽範圍設定卡片
  // ═══════════════════════════════════════════════════

  async _renderRealtimeLimitCard(container) {
    if (!container) return;
    if (document.getElementById('realtime-limit-card')) return;

    // 讀取目前設定
    var defaults = (typeof REALTIME_LIMIT_DEFAULTS !== 'undefined') ? REALTIME_LIMIT_DEFAULTS
      : { attendanceLimit: 1500, registrationLimit: 3000, eventLimit: 100 };
    var current = Object.assign({}, defaults);
    var noShowFrequency = 24; // 預設每小時（24次/天）
    try {
      var snap = await db.collection('siteConfig').doc('realtimeConfig').get();
      if (snap.exists) {
        var d = snap.data();
        if (d.attendanceLimit) current.attendanceLimit = d.attendanceLimit;
        if (d.registrationLimit) current.registrationLimit = d.registrationLimit;
        if (d.eventLimit) current.eventLimit = d.eventLimit;
        if (d.noShowFrequency) noShowFrequency = Number(d.noShowFrequency) || 24;
      }
    } catch (e) {
      console.warn('[dashboard] realtimeConfig read failed:', e);
    }

    var esc = escapeHTML;
    var inputStyle = 'width:80px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;'
      + 'font-size:14px;font-weight:600;text-align:center;background:var(--bg-card);'
      + 'color:var(--text-primary);outline:none';

    var html = '<div class="info-card" id="realtime-limit-card">'
      + '<div class="info-title" style="display:flex;align-items:center;gap:6px">'
      + '  <span>即時監聽範圍設定</span>'
      + '  <button class="edu-info-btn" onclick="App._showRealtimeLimitInfo()" title="說明">?</button>'
      + '</div>'
      + '<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.75rem">'
      + '調整即時監聽器的最大文件數。數值越大即時範圍越廣但費用越高。用戶切頁或重開 App 後生效。</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px">'
      + '  <div style="display:flex;align-items:center;justify-content:space-between">'
      + '    <div><div style="font-size:.82rem;font-weight:600">簽到紀錄</div>'
      + '    <div style="font-size:.7rem;color:var(--text-secondary)">建議：活躍活動數 × 25</div></div>'
      + '    <input id="rl-attendance" type="number" inputmode="numeric" min="100" max="10000" value="' + current.attendanceLimit + '" style="' + inputStyle + '" />'
      + '  </div>'
      + '  <div style="display:flex;align-items:center;justify-content:space-between">'
      + '    <div><div style="font-size:.82rem;font-weight:600">報名紀錄（管理員）</div>'
      + '    <div style="font-size:.7rem;color:var(--text-secondary)">建議：活躍活動數 × 50</div></div>'
      + '    <input id="rl-registration" type="number" inputmode="numeric" min="100" max="10000" value="' + current.registrationLimit + '" style="' + inputStyle + '" />'
      + '  </div>'
      + '  <div style="display:flex;align-items:center;justify-content:space-between">'
      + '    <div><div style="font-size:.82rem;font-weight:600">活動列表</div>'
      + '    <div style="font-size:.7rem;color:var(--text-secondary)">建議：預期最大同時活躍活動數 × 2</div></div>'
      + '    <input id="rl-event" type="number" inputmode="numeric" min="100" max="10000" value="' + current.eventLimit + '" style="' + inputStyle + '" />'
      + '  </div>'
      + '  <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px;margin-top:4px">'
      + '    <div><div style="font-size:.82rem;font-weight:600">放鴿子統計頻率</div>'
      + '    <div style="font-size:.7rem;color:var(--text-secondary)">Cloud Function 每天計算幾次</div></div>'
      + '    <select id="rl-noshow-freq" style="' + inputStyle + ';width:auto;min-width:90px;padding-right:24px">'
      + [1,2,3,4,6,8,12,24].map(function(n) {
          var label = n === 24 ? '24（每小時）' : n === 1 ? '1（每天凌晨）' : n + '（每' + (24/n) + '小時）';
          return '<option value="' + n + '"' + (n === noShowFrequency ? ' selected' : '') + '>' + label + '</option>';
        }).join('')
      + '    </select>'
      + '  </div>'
      + '</div>'
      + '<button id="rl-save-btn" class="btn-sm" style="margin-top:.75rem;width:100%;padding:10px;font-size:.88rem;font-weight:600">'
      + '儲存設定</button>'
      + '<div id="rl-status" style="font-size:.72rem;color:var(--text-secondary);margin-top:.4rem;text-align:center"></div>'
      + '</div>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    container.appendChild(wrapper);

    // 綁定儲存
    var saveBtn = document.getElementById('rl-save-btn');
    var statusEl = document.getElementById('rl-status');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        var att = parseInt(document.getElementById('rl-attendance').value, 10);
        var reg = parseInt(document.getElementById('rl-registration').value, 10);
        var evt = parseInt(document.getElementById('rl-event').value, 10);
        var freq = parseInt(document.getElementById('rl-noshow-freq').value, 10) || 24;
        // 驗證
        var errors = [];
        if (!att || att < 100 || att > 10000) errors.push('簽到紀錄需在 100~10000 之間');
        if (!reg || reg < 100 || reg > 10000) errors.push('報名紀錄需在 100~10000 之間');
        if (!evt || evt < 100 || evt > 10000) errors.push('活動列表需在 100~10000 之間');
        if (errors.length > 0) {
          if (statusEl) { statusEl.style.color = 'var(--danger,#dc2626)'; statusEl.textContent = errors.join('；'); }
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = '儲存中...';
        try {
          await db.collection('siteConfig').doc('realtimeConfig').set({
            attendanceLimit: att,
            registrationLimit: reg,
            eventLimit: evt,
            noShowFrequency: freq,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: (typeof App !== 'undefined' && App.currentUser) ? App.currentUser.uid : '',
          }, { merge: true });
          // 同步更新本地
          if (typeof FirebaseService !== 'undefined' && FirebaseService._realtimeLimits) {
            FirebaseService._realtimeLimits = { attendanceLimit: att, registrationLimit: reg, eventLimit: evt };
          }
          if (statusEl) { statusEl.style.color = 'var(--success,#16a34a)'; statusEl.textContent = '已儲存，用戶切頁或重開 App 後生效'; }
          if (typeof App !== 'undefined' && App.showToast) App.showToast('即時監聽設定已儲存');
        } catch (e) {
          console.error('[dashboard] realtimeConfig save failed:', e);
          if (statusEl) { statusEl.style.color = 'var(--danger,#dc2626)'; statusEl.textContent = '儲存失敗：' + (e.message || ''); }
        }
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存設定';
      });
    }
  },

  /** 即時監聽範圍說明彈窗 */
  _showRealtimeLimitInfo() {
    var body = ''
      + '<p style="margin-bottom:.6rem">此設定控制 Firestore 即時監聽器（onSnapshot）的最大文件數量。'
      + '數值越大，即時更新的資料範圍越廣，但 Firestore 讀取費用也越高。</p>'
      + '<div style="font-weight:700;margin:.7rem 0 .3rem">各欄位說明</div>'
      + '<ul>'
      + '<li><b>簽到紀錄</b> — 即時監聽最新 N 筆簽到紀錄，用於掃碼簽到頁面的即時顯示。'
      + '建議值：活躍活動數 × 每場平均出席人數。統計數據（出席率、完成場次）不受此限制影響。</li>'
      + '<li><b>報名紀錄（管理員）</b> — 管理員模式下即時監聽最新 N 筆報名。'
      + '一般用戶只看自己的報名，不受此設定影響。歷史報名可在活動詳情頁單獨查詢。</li>'
      + '<li><b>活動列表</b> — 即時監聽「開放中 / 已滿 / 即將開始」的活動數量上限。'
      + '僅作為安全防護，目前活動數通常遠小於此值。</li>'
      + '</ul>'
      + '<div style="font-weight:700;margin:.7rem 0 .3rem">什麼時候生效？</div>'
      + '<p>儲存後，用戶<b>下次切頁或重新開啟 App</b> 時會套用新設定。正在使用中的頁面不會中途改變。</p>'
      + '<div style="font-weight:700;margin:.7rem 0 .3rem">會影響統計數據嗎？</div>'
      + '<p><b>不會。</b>出席率、完成場次、放鴿子統計使用獨立查詢，不受此限制。</p>';

    var overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">即時監聽範圍說明</div>'
      + '<div class="edu-info-dialog-body">' + body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  async _renderRealtimeLimitCard(container) {
    if (!container) return;
    if (document.getElementById('realtime-limit-card')) return;

    var defaults = (typeof REALTIME_LIMIT_DEFAULTS !== 'undefined') ? REALTIME_LIMIT_DEFAULTS
      : { attendanceLimit: 1500, registrationLimit: 3000, eventLimit: 100 };
    var current = Object.assign({
      attendanceLimit: 1500,
      registrationLimit: 3000,
      eventLimit: 100,
      noShowFrequency: 24,
      activityRepairEnabled: false,
      activityRepairFrequency: 1,
      activityRepairLookbackDays: 90,
      activityRepairFutureDays: 180,
      activityRepairMaxEventsPerRun: 500,
      activityRepairBatchSize: 300,
      activityRepairManualCooldownSeconds: 300,
      activityRepairLogs: [],
    }, defaults);

    try {
      var snap = await db.collection('siteConfig').doc('realtimeConfig').get();
      if (snap.exists) {
        var d = snap.data() || {};
        [
          'attendanceLimit', 'registrationLimit', 'eventLimit', 'noShowFrequency',
          'activityRepairFrequency', 'activityRepairLookbackDays', 'activityRepairFutureDays',
          'activityRepairMaxEventsPerRun', 'activityRepairBatchSize', 'activityRepairManualCooldownSeconds',
        ].forEach(function(key) {
          if (d[key] !== undefined && d[key] !== null && d[key] !== '') current[key] = Number(d[key]);
        });
        current.activityRepairEnabled = d.activityRepairEnabled === true;
        current.activityRepairLogs = Array.isArray(d.activityRepairLogs) ? d.activityRepairLogs : [];
      }
    } catch (e) {
      console.warn('[dashboard] realtimeConfig read failed:', e);
    }

    var inputStyle = 'width:86px;padding:6px 8px;border:1.5px solid var(--border);border-radius:8px;'
      + 'font-size:14px;font-weight:600;text-align:center;background:var(--bg-card);'
      + 'color:var(--text-primary);outline:none';
    var rowStyle = 'display:flex;align-items:center;justify-content:space-between;gap:12px';
    var sectionTitle = 'font-size:.78rem;font-weight:800;color:var(--text-secondary);margin:.15rem 0 .1rem';
    var freqOptions = [1, 2, 3, 4, 6, 8, 12, 24].map(function(n) {
      var label = n === 24 ? '24次/天' : (n === 1 ? '1次/天' : n + '次/天');
      return '<option value="' + n + '"' + (n === Number(current.noShowFrequency) ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
    var repairFreqOptions = [1, 2, 4, 6, 12, 24].map(function(n) {
      var label = n === 24 ? '24次/天' : (n === 1 ? '1次/天' : n + '次/天');
      return '<option value="' + n + '"' + (n === Number(current.activityRepairFrequency) ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
    var html = '<div class="info-card" id="realtime-limit-card">'
      + '<div class="info-title sync-config-title">'
      + '  <span>資料同步與監聽設定</span>'
      + '  <button class="event-reg-log-btn sync-config-log-btn" onclick="App.openActivityRepairLogModal()">Log</button>'
      + '  <span class="sync-config-lock-pill">後端上鎖</span>'
      + '  <button class="edu-info-btn" onclick="App._showDataSyncSettingInfo()" title="說明">?</button>'
      + '</div>'
      + '<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.75rem">'
      + '調整即時監聽文件數與報名紀錄排程修復。監聽數越大即時範圍越廣但讀取成本越高。</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px">'
      + '  <div class="sync-config-lock-note">這區可以查看與調整數值，但「儲存設定」和「立即修復」都必須輸入密碼，並由後端驗證通過才會真正生效。</div>'
      + '  <div style="' + sectionTitle + '">即時監聽範圍</div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">簽到紀錄</div><div style="font-size:.7rem;color:var(--text-secondary)">掃碼與簽到頁即時資料</div></div><input id="rl-attendance" type="number" inputmode="numeric" min="100" max="10000" value="' + Number(current.attendanceLimit || 1500) + '" style="' + inputStyle + '" /></div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">報名紀錄</div><div style="font-size:.7rem;color:var(--text-secondary)">活動頁與管理員報名資料</div></div><input id="rl-registration" type="number" inputmode="numeric" min="100" max="10000" value="' + Number(current.registrationLimit || 3000) + '" style="' + inputStyle + '" /></div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">活動列表</div><div style="font-size:.7rem;color:var(--text-secondary)">首頁與活動列表即時資料</div></div><input id="rl-event" type="number" inputmode="numeric" min="100" max="10000" value="' + Number(current.eventLimit || 100) + '" style="' + inputStyle + '" /></div>'
      + '  <div style="' + rowStyle + ';border-top:1px solid var(--border);padding-top:10px;margin-top:2px"><div><div style="font-size:.82rem;font-weight:600">放鴿子統計頻率</div><div style="font-size:.7rem;color:var(--text-secondary)">Cloud Function 排程重算</div></div><select id="rl-noshow-freq" style="' + inputStyle + ';width:auto;min-width:96px">' + freqOptions + '</select></div>'
      + '  <div style="' + sectionTitle + ';border-top:1px solid var(--border);padding-top:10px;margin-top:2px">排程修復</div>'
      + '  <label class="sync-config-toggle-row"><span><strong>報名紀錄修復</strong><small>自動補齊 registrations 對應的 activityRecords</small></span><input id="ar-repair-enabled" type="checkbox"' + (current.activityRepairEnabled ? ' checked' : '') + '></label>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">修復頻率</div><div style="font-size:.7rem;color:var(--text-secondary)">排程啟用後生效</div></div><select id="ar-repair-freq" style="' + inputStyle + ';width:auto;min-width:96px">' + repairFreqOptions + '</select></div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">回補天數</div><div style="font-size:.7rem;color:var(--text-secondary)">往前掃描活動天數</div></div><input id="ar-repair-lookback" type="number" inputmode="numeric" min="1" max="365" value="' + Number(current.activityRepairLookbackDays || 90) + '" style="' + inputStyle + '" /></div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">未來天數</div><div style="font-size:.7rem;color:var(--text-secondary)">往後掃描活動天數</div></div><input id="ar-repair-future" type="number" inputmode="numeric" min="0" max="365" value="' + Number(current.activityRepairFutureDays || 180) + '" style="' + inputStyle + '" /></div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">單次活動上限</div><div style="font-size:.7rem;color:var(--text-secondary)">每次排程最多掃描幾場</div></div><input id="ar-repair-max-events" type="number" inputmode="numeric" min="50" max="1000" value="' + Number(current.activityRepairMaxEventsPerRun || 500) + '" style="' + inputStyle + '" /></div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">批次大小</div><div style="font-size:.7rem;color:var(--text-secondary)">每批 Firestore 寫入上限</div></div><input id="ar-repair-batch" type="number" inputmode="numeric" min="50" max="450" value="' + Number(current.activityRepairBatchSize || 300) + '" style="' + inputStyle + '" /></div>'
      + '  <div style="' + rowStyle + '"><div><div style="font-size:.82rem;font-weight:600">用戶刷新冷卻</div><div style="font-size:.7rem;color:var(--text-secondary)">個人頁手動刷新間隔秒數</div></div><input id="ar-repair-cooldown" type="number" inputmode="numeric" min="60" max="3600" value="' + Number(current.activityRepairManualCooldownSeconds || 300) + '" style="' + inputStyle + '" /></div>'
      + '</div>'
      + '<div class="sync-config-actions">'
      + '  <button id="rl-save-btn" class="btn-sm">儲存設定</button>'
      + '  <button id="ar-run-btn" class="outline-btn">立即修復</button>'
      + '</div>'
      + '<div class="sync-config-progress" id="ar-repair-progress" hidden aria-hidden="true">'
      + '  <div class="sync-config-progress-head">'
      + '    <span id="ar-repair-progress-text">準備中...</span>'
      + '    <strong id="ar-repair-progress-percent">0%</strong>'
      + '  </div>'
      + '  <div class="sync-config-progress-track" id="ar-repair-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">'
      + '    <div class="sync-config-progress-fill" id="ar-repair-progress-fill" style="width:0%"></div>'
      + '  </div>'
      + '</div>'
      + '<div id="rl-status" style="font-size:.72rem;color:var(--text-secondary);margin-top:.45rem;text-align:center"></div>'
      + '</div>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    container.appendChild(wrapper);

    var saveBtn = document.getElementById('rl-save-btn');
    var runBtn = document.getElementById('ar-run-btn');
    var statusEl = document.getElementById('rl-status');
    var setStatus = function(message, color) {
      if (!statusEl) return;
      statusEl.style.color = color || 'var(--text-secondary)';
      statusEl.textContent = message || '';
    };
    var readInt = function(id, fallback) {
      var el = document.getElementById(id);
      var n = parseInt(el && el.value, 10);
      return Number.isFinite(n) ? n : fallback;
    };
    var appendConfigLog = function(logs) {
      var now = (firebase.firestore.Timestamp && firebase.firestore.Timestamp.now)
        ? firebase.firestore.Timestamp.now()
        : new Date();
      var next = Array.isArray(logs) ? logs.slice() : [];
      next.unshift({
        id: 'cfg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        at: now,
        source: 'config',
        status: 'success',
        message: 'settings saved',
        scannedEvents: 0,
        scannedRegistrations: 0,
        created: 0,
        updated: 0,
        skipped: 0,
      });
      return next.slice(0, 30);
    };

    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        var att = readInt('rl-attendance', 1500);
        var reg = readInt('rl-registration', 3000);
        var evt = readInt('rl-event', 100);
        var noShowFreq = readInt('rl-noshow-freq', 24);
        var repairFreq = readInt('ar-repair-freq', 1);
        var lookback = readInt('ar-repair-lookback', 90);
        var future = readInt('ar-repair-future', 180);
        var maxEvents = readInt('ar-repair-max-events', 500);
        var batch = readInt('ar-repair-batch', 300);
        var cooldown = readInt('ar-repair-cooldown', 300);
        var enabledEl = document.getElementById('ar-repair-enabled');
        var errors = [];
        if (att < 100 || att > 10000) errors.push('簽到紀錄需介於 100~10000');
        if (reg < 100 || reg > 10000) errors.push('報名紀錄需介於 100~10000');
        if (evt < 100 || evt > 10000) errors.push('活動列表需介於 100~10000');
        if (lookback < 1 || lookback > 365) errors.push('回補天數需介於 1~365');
        if (future < 0 || future > 365) errors.push('未來天數需介於 0~365');
        if (maxEvents < 50 || maxEvents > 1000) errors.push('單次活動上限需介於 50~1000');
        if (batch < 50 || batch > 450) errors.push('批次大小需介於 50~450');
        if (cooldown < 60 || cooldown > 3600) errors.push('刷新冷卻需介於 60~3600 秒');
        if (errors.length) {
          setStatus(errors.join('；'), 'var(--danger,#dc2626)');
          return;
        }

        var password = await App._promptDataSyncPassword('儲存資料同步設定');
        if (!password) {
          setStatus('已取消，設定沒有變更。');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = '儲存中...';
        try {
          var fn = firebase.app().functions('asia-east1');
          var callable = fn.httpsCallable('saveRealtimeConfig');
          await callable({
            password: password,
            attendanceLimit: att,
            registrationLimit: reg,
            eventLimit: evt,
            noShowFrequency: noShowFreq,
            activityRepairEnabled: !!(enabledEl && enabledEl.checked),
            activityRepairFrequency: repairFreq,
            activityRepairLookbackDays: lookback,
            activityRepairFutureDays: future,
            activityRepairMaxEventsPerRun: maxEvents,
            activityRepairBatchSize: batch,
            activityRepairManualCooldownSeconds: cooldown,
          });
          password = '';
          if (typeof FirebaseService !== 'undefined' && FirebaseService._realtimeLimits) {
            FirebaseService._realtimeLimits = Object.assign(
              {},
              (typeof REALTIME_LIMIT_DEFAULTS !== 'undefined' ? REALTIME_LIMIT_DEFAULTS : {}),
              FirebaseService._realtimeLimits,
              { attendanceLimit: att, registrationLimit: reg, eventLimit: evt }
            );
          }
          setStatus('設定已儲存，後端密碼驗證通過。', 'var(--success,#16a34a)');
          if (typeof App !== 'undefined' && App.showToast) App.showToast('資料同步與監聽設定已儲存');
        } catch (e) {
          password = '';
          console.error('[dashboard] realtimeConfig save failed:', e);
          setStatus(App._getDataSyncGuardErrorMessage(e, '儲存失敗，設定沒有變更。'), 'var(--danger,#dc2626)');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '儲存設定';
        }
      });
    }

    if (runBtn) {
      runBtn.addEventListener('click', function() {
        App.runActivityRecordRepairNow();
      });
    }
  },

  _syncConfigLogMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_) {} }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime(); } catch (_) {} }
    if (typeof v === 'object' && typeof (v.seconds || v._seconds) === 'number') {
      return ((v.seconds || v._seconds) * 1000) + Math.floor(((v.nanoseconds || v._nanoseconds || 0) / 1000000));
    }
    var t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  },

  _formatSyncConfigLogTime(v) {
    var ms = this._syncConfigLogMs(v);
    if (!ms) return '--';
    var d = new Date(ms);
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0')
      + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  async openActivityRepairLogModal() {
    var overlay = document.getElementById('activity-repair-log-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'activity-repair-log-modal';
      overlay.className = 'sync-config-log-overlay';
      overlay.onclick = function(e) { if (e.target === overlay) App.closeActivityRepairLogModal(); };
      overlay.innerHTML = '<div class="sync-config-log-box">'
        + '<div class="sync-config-log-header"><span>資料同步 Log</span><button class="event-reg-log-close" onclick="App.closeActivityRepairLogModal()">&times;</button></div>'
        + '<div class="sync-config-log-body" id="activity-repair-log-body"></div>'
        + '</div>';
      document.body.appendChild(overlay);
    }
    var body = document.getElementById('activity-repair-log-body');
    overlay.classList.add('open');
    if (body) body.innerHTML = '<div class="sync-config-empty">載入中...</div>';

    try {
      var snap = await db.collection('siteConfig').doc('realtimeConfig').get();
      var data = snap.exists ? (snap.data() || {}) : {};
      var repairLogs = (Array.isArray(data.activityRepairLogs) ? data.activityRepairLogs : [])
        .map(function(log) { return Object.assign({ _kind: 'repair' }, log); });
      var healthLogs = (Array.isArray(data.uidHealthCheckLogs) ? data.uidHealthCheckLogs : [])
        .map(function(log) { return Object.assign({ _kind: 'uid_health' }, log); });
      var logs = repairLogs.concat(healthLogs);
      logs.sort((a, b) => this._syncConfigLogMs(b.at) - this._syncConfigLogMs(a.at));
      if (!logs.length) {
        if (body) body.innerHTML = '<div class="sync-config-empty">尚無同步紀錄</div>';
        return;
      }
      var sourceLabels = {
        scheduled: '排程',
        admin_manual: '手動',
        config: '設定',
        system: '系統',
        uid_health: 'UID檢查',
      };
      var statusLabels = {
        success: '完成',
        error: '失敗',
        ok: '正常',
        warning: '警告',
      };
      if (body) {
        body.innerHTML = logs.map((log) => {
          var status = String(log.status || 'success');
          var source = sourceLabels[log.source] || sourceLabels[log._kind] || log.source || '系統';
          var actionClass = status === 'error' ? 'cancel'
            : (status === 'warning' ? 'warning' : (log.source === 'config' ? 'promote' : 'reg'));
          var summary = log._kind === 'uid_health'
            ? ('掃描 ' + (Number(log.scannedDocs || 0) || 0)
              + '｜警告 ' + (Number(log.warnings || 0) || 0)
              + '｜嚴重 ' + (Number(log.errors || 0) || 0)
              + '｜改資料 ' + (Number(log.dataChanges || 0) || 0))
            : ('活動 ' + (Number(log.scannedEvents || 0) || 0)
              + '｜報名 ' + (Number(log.scannedRegistrations || 0) || 0)
              + '｜新增 ' + (Number(log.created || 0) || 0)
              + '｜更新 ' + (Number(log.updated || 0) || 0));
          var msg = log.error || log.message || summary;
          return '<div class="sync-config-log-item">'
            + '<div class="sync-config-log-main">'
            + '<span class="event-reg-log-time">' + this._formatSyncConfigLogTime(log.at) + '</span>'
            + '<span class="event-reg-log-user">' + escapeHTML(source) + '</span>'
            + '<span class="event-reg-log-action ' + actionClass + '">' + escapeHTML(statusLabels[status] || status) + '</span>'
            + '</div>'
            + '<div class="sync-config-log-sub">' + escapeHTML(summary) + '</div>'
            + '<div class="sync-config-log-msg">' + escapeHTML(msg) + '</div>'
            + '</div>';
        }).join('');
      }
    } catch (err) {
      console.error('[activityRepairLog]', err);
      if (body) body.innerHTML = '<div class="sync-config-empty">Log 載入失敗</div>';
    }
  },

  closeActivityRepairLogModal() {
    var modal = document.getElementById('activity-repair-log-modal');
    if (modal) modal.classList.remove('open');
  },

  _getDataSyncGuardErrorMessage(err, fallback) {
    var code = String((err && (err.code || err.name)) || '');
    var message = String((err && err.message) || '');
    if (code.indexOf('permission-denied') >= 0 || message.indexOf('data sync password invalid') >= 0) {
      return '密碼錯誤或權限不足，操作沒有執行。';
    }
    if (code.indexOf('unauthenticated') >= 0) {
      return '請先登入後再操作。';
    }
    return fallback + (message ? '（' + message + '）' : '');
  },

  _promptDataSyncPassword(actionTitle) {
    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'sync-config-password-overlay';
      overlay.innerHTML = '<div class="sync-config-password-box" role="dialog" aria-modal="true">'
        + '<div class="sync-config-password-title">' + escapeHTML(actionTitle || '資料同步設定') + '</div>'
        + '<div class="sync-config-password-text">此操作已上鎖。請輸入密碼，送出後會交給後端驗證，通過才會生效。</div>'
        + '<input class="sync-config-password-input" type="password" inputmode="numeric" autocomplete="off" placeholder="輸入密碼" />'
        + '<div class="sync-config-password-actions">'
        + '  <button type="button" class="outline-btn sync-config-password-cancel">取消</button>'
        + '  <button type="button" class="btn-sm sync-config-password-submit">確認</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);

      var input = overlay.querySelector('.sync-config-password-input');
      var done = function(value) {
        overlay.remove();
        resolve(value);
      };
      overlay.querySelector('.sync-config-password-cancel')?.addEventListener('click', function() { done(''); });
      overlay.querySelector('.sync-config-password-submit')?.addEventListener('click', function() {
        done((input && input.value || '').trim());
      });
      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') done('');
        if (e.key === 'Enter') done((input && input.value || '').trim());
      });
      setTimeout(function() { if (input) input.focus(); }, 30);
    });
  },

  async runActivityRecordRepairNow() {
    var btn = document.getElementById('ar-run-btn');
    var statusEl = document.getElementById('rl-status');
    var progressEl = document.getElementById('ar-repair-progress');
    var progressFill = document.getElementById('ar-repair-progress-fill');
    var progressTrack = document.getElementById('ar-repair-progress-track');
    var progressPercent = document.getElementById('ar-repair-progress-percent');
    var progressText = document.getElementById('ar-repair-progress-text');
    var hideRepairProgress = function() {
      if (!progressEl) return;
      progressEl.hidden = true;
      progressEl.setAttribute('aria-hidden', 'true');
      progressEl.classList.remove('is-running', 'is-done', 'is-error');
      if (progressFill) progressFill.style.width = '0%';
      if (progressTrack) progressTrack.setAttribute('aria-valuenow', '0');
      if (progressPercent) progressPercent.textContent = '0%';
      if (progressText) progressText.textContent = '準備中...';
    };
    var setRepairProgress = function(done, total, label, state) {
      var safeTotal = Math.max(0, Number(total || 0));
      var safeDone = Math.max(0, Number(done || 0));
      var pct = safeTotal > 0 ? Math.round(Math.min(100, safeDone / safeTotal * 100)) : (state === 'done' ? 100 : 0);
      if (state === 'running' && safeTotal > 0 && safeDone < safeTotal) pct = Math.min(99, pct);
      if (progressEl) {
        progressEl.hidden = false;
        progressEl.setAttribute('aria-hidden', 'false');
        progressEl.classList.toggle('is-running', state === 'running');
        progressEl.classList.toggle('is-done', state === 'done');
        progressEl.classList.toggle('is-error', state === 'error');
      }
      if (progressFill) progressFill.style.width = pct + '%';
      if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(pct));
      if (progressPercent) progressPercent.textContent = pct + '%';
      if (progressText) progressText.textContent = label || '處理中...';
    };
    var ok = typeof this.appConfirm === 'function'
      ? await this.appConfirm('確定要立即執行報名紀錄修復嗎？\n\n系統會掃描設定範圍內的活動，補齊缺漏的報名紀錄。')
      : window.confirm('確定要立即執行報名紀錄修復嗎？');
    if (!ok) {
      hideRepairProgress();
      return;
    }

    var password = await this._promptDataSyncPassword('立即修復報名紀錄');
    if (!password) {
      if (statusEl) statusEl.textContent = '已取消，沒有執行修復。';
      hideRepairProgress();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '修復中...';
    }
    if (statusEl) {
      statusEl.style.color = 'var(--text-secondary)';
      statusEl.textContent = '正在執行報名紀錄修復...';
    }
    setRepairProgress(0, 0, '準備掃描活動...', 'running');
    var aggregate = {
      created: 0,
      updated: 0,
      scannedEvents: 0,
      scannedRegistrations: 0,
      skipped: 0,
      candidateEvents: 0,
    };
    try {
      var fn = firebase.app().functions('asia-east1');
      var callable = fn.httpsCallable('repairActivityRecordsManual', { timeout: 300000 });
      var startIndex = 0;
      var hasMore = true;
      var loops = 0;
      var maxLoops = 8;
      var chunkSize = 80;
      while (hasMore && loops < maxLoops) {
        loops += 1;
        var resp = await callable({
          password: password,
          startIndex: startIndex,
          maxEventsPerRun: chunkSize,
        });
        var data = resp.data || {};
        ['created', 'updated', 'scannedEvents', 'scannedRegistrations', 'skipped'].forEach(function(key) {
          aggregate[key] += Number(data[key] || 0);
        });
        aggregate.candidateEvents = Math.max(aggregate.candidateEvents, Number(data.candidateEvents || 0));
        var nextStartIndex = Number(data.nextStartIndex || 0);
        var totalEvents = Number(data.candidateEvents || aggregate.candidateEvents || 0);
        var completedEvents = totalEvents > 0 ? Math.min(nextStartIndex, totalEvents) : nextStartIndex;
        hasMore = !!data.hasMore && nextStartIndex > startIndex;
        startIndex = nextStartIndex;
        var progressLabel = totalEvents > 0
          ? ('已處理 ' + completedEvents + '/' + totalEvents + ' 場活動')
          : ('已掃描 ' + aggregate.scannedEvents + ' 場活動');
        if (hasMore) progressLabel += '，繼續下一批';
        setRepairProgress(completedEvents, totalEvents, progressLabel, hasMore ? 'running' : 'done');
        if (statusEl && hasMore) {
          statusEl.style.color = 'var(--text-secondary)';
          statusEl.textContent = '修復中：' + progressLabel + '...';
        }
      }
      password = '';
      var msg = '修復完成：新增 ' + aggregate.created + '，更新 ' + aggregate.updated
        + '，掃描 ' + aggregate.scannedEvents + ' 場';
      if (hasMore) {
        msg = '已分批修復：新增 ' + aggregate.created + '，更新 ' + aggregate.updated
          + '，掃描 ' + aggregate.scannedEvents + ' 場；仍有資料可再次修復';
      }
      if (statusEl) {
        statusEl.style.color = 'var(--success,#16a34a)';
        statusEl.textContent = msg;
      }
      var finalTotal = aggregate.candidateEvents || startIndex || aggregate.scannedEvents;
      var finalDone = hasMore ? Math.min(startIndex || aggregate.scannedEvents, finalTotal) : finalTotal;
      setRepairProgress(
        finalDone,
        finalTotal,
        hasMore ? '本次批次已完成，仍有資料可再次修復' : '修復完成',
        'done'
      );
      this.showToast?.(msg);
    } catch (err) {
      password = '';
      console.error('[runActivityRecordRepairNow]', err);
      var hasPartial = aggregate.scannedEvents > 0 || aggregate.created > 0 || aggregate.updated > 0;
      var fallback = hasPartial
        ? ('部分修復完成後中斷。新增 ' + aggregate.created + '，更新 ' + aggregate.updated + '，掃描 ' + aggregate.scannedEvents + ' 場。')
        : '修復失敗，沒有變更任何資料。';
      if (statusEl) {
        statusEl.style.color = 'var(--danger,#dc2626)';
        statusEl.textContent = this._getDataSyncGuardErrorMessage(err, fallback);
      }
      setRepairProgress(
        aggregate.candidateEvents ? Math.min(startIndex || 0, aggregate.candidateEvents) : aggregate.scannedEvents,
        aggregate.candidateEvents || aggregate.scannedEvents || 1,
        hasPartial ? '部分完成後中斷' : '修復失敗',
        'error'
      );
      this.showToast?.(hasPartial ? '報名紀錄部分修復後中斷' : '報名紀錄修復失敗');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '立即修復';
      }
    }
  },

  _showDataSyncSettingInfo() {
    var body = '<p style="margin-bottom:.65rem">這一區是在管「資料要聽多少」和「報名紀錄要不要自動補齊」。數字越大，能看的資料越多，但資料庫讀寫成本也會比較高。</p>'
      + '<div class="sync-config-help-list">'
      + '<div><b>簽到監聽</b><span>簽到頁一次最多即時盯住多少筆簽到資料。人很多、簽到很頻繁時才需要調高。</span></div>'
      + '<div><b>報名監聽</b><span>活動報名名單一次最多即時盯住多少筆資料。活動很多或報名名單很長時，這個值會影響畫面更新範圍。</span></div>'
      + '<div><b>活動監聽</b><span>活動列表一次最多即時盯住多少筆活動。調太高會讓首頁或活動列表讀比較多資料。</span></div>'
      + '<div><b>放鴿子統計頻率</b><span>系統多久重新計算一次放鴿子次數。越頻繁越即時，但 Cloud Functions 執行次數也會增加。</span></div>'
      + '<div><b>報名紀錄修復</b><span>開啟後，系統會定時檢查報名資料，幫缺漏的個人報名紀錄補回來。它不會改活動名額，也不會改報名狀態。</span></div>'
      + '<div><b>修復頻率</b><span>一天要跑幾次自動修復。例如 1 次就是每天跑一次，24 次就是每小時都會檢查。</span></div>'
      + '<div><b>回補天數</b><span>往過去看幾天的活動。數字越大，越能補舊資料，但會掃描更多活動。</span></div>'
      + '<div><b>未來天數</b><span>往未來看幾天的活動。用來確保快到來的活動也有完整報名紀錄。</span></div>'
      + '<div><b>單次活動上限</b><span>自動排程一次最多檢查幾場活動。活動量很多時可以先調小，避免單次修復跑太久。</span></div>'
      + '<div><b>批次大小</b><span>每一批最多寫入幾筆修復資料。一般維持預設就好，調太高比較容易碰到寫入限制。</span></div>'
      + '<div><b>用戶刷新冷卻</b><span>個人資訊頁的刷新按鈕，按完後要等幾秒才能再按。這是用來避免一直重複刷新造成成本。</span></div>'
      + '<div><b>UID 檢查</b><span>已移到「用戶補正管理」的 UID檢查分頁。那裡是只讀體檢報表，不會修正或刪除正式資料。</span></div>'
      + '<div><b>Log</b><span>會保留最近 30 筆設定儲存、自動修復、手動修復與 UID 檢查結果，方便回頭查發生什麼事。</span></div>'
      + '<div><b>上鎖保護</b><span>儲存設定和立即修復都會要求輸入密碼，而且一定是後端驗證通過才會真的寫入或執行。</span></div>'
      + '</div>'
      + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.65rem">簡單說：平常不要常改，真的要改時先看成本和範圍；如果只是個人報名紀錄漏掉，優先用個人頁的刷新按鈕。</p>';
    var overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">資料同步與監聽設定</div>'
      + '<div class="edu-info-dialog-body">' + body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">確認</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },
});
