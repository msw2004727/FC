/* ================================================
   SportHub — Dashboard: Canvas Chart Widgets & Helpers
   依賴：config.js, i18n.js
   ================================================ */

Object.assign(App, {

  /** 繪製甜甜圈圖（活動類型分布） */
  _drawDonutChart(canvasId, typeCounts, totalEvents) {
    const el = document.getElementById(canvasId);
    if (!el || !el.parentElement) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = el.parentElement.offsetWidth - 32 || 280;
    const h = 200;
    el.width = w * dpr; el.height = h * dpr;
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);

    const colorMap = { friendly: '#0d9488', camp: '#ec4899', play: '#7c3aed', watch: '#f59e0b' };
    const data = Object.entries(typeCounts).map(([type, count]) => ({
      label: (TYPE_CONFIG[type] || {}).label || type,
      value: count,
      color: colorMap[type] || '#6b7280',
    }));

    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) {
      ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t('common.noData'), w / 2, h / 2);
      return;
    }

    const cx = w * 0.35, cy = h / 2;
    const r = Math.min(cx - 10, cy - 10);
    const innerR = r * 0.55;

    let startAngle = -Math.PI / 2;
    data.forEach(d => {
      const slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, startAngle + slice);
      ctx.arc(cx, cy, innerR, startAngle + slice, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      startAngle += slice;
    });

    // 中心文字
    ctx.fillStyle = isDark ? '#e5e7eb' : '#1f2937';
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(totalEvents, cx, cy - 6);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
    ctx.fillText(t('dash.totalEvents'), cx, cy + 12);

    // 圖例
    const lx = w * 0.68;
    let ly = (h - data.length * 28) / 2;
    data.forEach(d => {
      ctx.beginPath();
      ctx.arc(lx + 5, ly + 6, 5, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.fillStyle = isDark ? '#d1d5db' : '#374151';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      const pct = Math.round((d.value / total) * 100);
      ctx.fillText(`${d.label}  ${d.value} (${pct}%)`, lx + 16, ly + 10);
      ly += 28;
    });
  },

  /** 繪製長條圖（月份趨勢） */
  _drawBarChart(canvasId, monthCounts) {
    const el = document.getElementById(canvasId);
    if (!el || !el.parentElement) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = el.parentElement.offsetWidth - 32 || 280;
    const h = 180;
    el.width = w * dpr; el.height = h * dpr;
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);

    const sorted = Object.entries(monthCounts).sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length === 0) {
      ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t('common.noData'), w / 2, h / 2);
      return;
    }

    const pad = { top: 18, right: 10, bottom: 28, left: 35 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const maxVal = Math.max(...sorted.map(d => d[1]), 1);
    const barW = Math.min(36, (chartW / sorted.length) * 0.6);
    const totalBarArea = barW * sorted.length;
    const gap = (chartW - totalBarArea) / (sorted.length + 1);

    // 網格線
    ctx.strokeStyle = isDark ? '#374151' : '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = isDark ? '#9ca3af' : '#9ca3af';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * i / 4), pad.left - 5, y + 3);
    }

    // 長條
    sorted.forEach(([month, count], i) => {
      const x = pad.left + gap + i * (barW + gap);
      const barH = Math.max(2, (count / maxVal) * chartH);
      const y = pad.top + chartH - barH;

      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, '#7c3aed');
      grad.addColorStop(1, '#a78bfa');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, barH);

      // 數值
      if (count > 0) {
        ctx.fillStyle = isDark ? '#d1d5db' : '#374151';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(count, x + barW / 2, y - 4);
      }

      // 月份標籤
      ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const displayM = month.includes('/') ? String(parseInt(month.split('/')[1])) : String(parseInt(month));
      ctx.fillText(displayM + '月', x + barW / 2, h - 8);
    });
  },

  /** 繪製折線圖（活躍度趨勢） */
  _drawLineChart(canvasId, weeklyData) {
    const el = document.getElementById(canvasId);
    if (!el || !el.parentElement) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const dpr = window.devicePixelRatio || 1;
    const w = el.parentElement.offsetWidth - 32 || 280;
    const h = 180;
    el.width = w * dpr; el.height = h * dpr;
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);

    const labels = weeklyData.map(d => d.label);
    const values = weeklyData.map(d => d.value);
    if (values.length === 0) {
      ctx.fillStyle = isDark ? '#6b7280' : '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('尚無資料', w / 2, h / 2);
      return;
    }

    const pad = { top: 20, right: 15, bottom: 30, left: 35 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;
    const maxVal = Math.max(...values, 1);

    // Grid lines
    ctx.strokeStyle = isDark ? '#374151' : '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = isDark ? '#9ca3af' : '#9ca3af';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * i / 4), pad.left - 5, y + 3);
    }

    // Compute points
    const step = values.length > 1 ? chartW / (values.length - 1) : 0;
    const points = values.map((v, i) => ({
      x: pad.left + i * step,
      y: pad.top + chartH * (1 - v / maxVal),
    }));

    // Fill area
    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.top + chartH);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, pad.top + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, isDark ? 'rgba(59,130,246,.3)' : 'rgba(59,130,246,.15)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots + labels
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], p.x, h - 8);
    });
  },

  /** 將 MM/DD 或 YYYY/MM/DD 字串轉為 Date；MM/DD 格式以距今超過 180 天推算為去年 */
  _parseMmDdToDate(mmdd) {
    const parts = (mmdd || '').split('/');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    if (parts.length === 2) {
      const mm = parseInt(parts[0]), dd = parseInt(parts[1]);
      if (!mm || !dd) return null;
      const now = new Date();
      const cy = now.getFullYear();
      const d = new Date(cy, mm - 1, dd);
      return (d - now > 180 * 86400000) ? new Date(cy - 1, mm - 1, dd) : d;
    }
    return null;
  },

});
