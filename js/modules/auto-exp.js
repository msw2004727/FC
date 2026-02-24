/* ================================================
   SportHub — Auto EXP System
   活動結束簽退後自動發放經驗值
   ================================================ */

Object.assign(App, {

  _AUTO_EXP_KEY_BASE: 'sporthub_auto_exp_rules',
  _AUTO_EXP_LOG_KEY_BASE: 'sporthub_auto_exp_logs',

  _autoExpKey()    { return this._AUTO_EXP_KEY_BASE + '_' + ModeManager.getMode(); },
  _autoExpLogKey() { return this._AUTO_EXP_LOG_KEY_BASE + '_' + ModeManager.getMode(); },

  _AUTO_EXP_DEFAULTS: [
    { key: 'complete_activity',    label: '完成活動',     desc: '簽到＋簽退完成一場活動' },
    { key: 'register_activity',    label: '報名活動',     desc: '成功報名一場活動' },
    { key: 'cancel_registration',  label: '取消報名',     desc: '取消活動報名（可設負數扣分）' },
    { key: 'host_activity',        label: '主辦活動',     desc: '建立一場新活動' },
    { key: 'submit_review',        label: '提交評價',     desc: '提交活動星級評價' },
    { key: 'join_team',            label: '加入球隊',     desc: '成功申請加入球隊' },
    { key: 'post_team_feed',       label: '發佈球隊動態', desc: '在球隊動態牆發佈一則貼文' },
  ],

  // ── Rule CRUD ──

  _getAutoExpRules() {
    try {
      const saved = JSON.parse(localStorage.getItem(this._autoExpKey()));
      if (saved && typeof saved === 'object') {
        return this._AUTO_EXP_DEFAULTS.map(d => ({
          ...d,
          amount: saved[d.key] !== undefined ? Number(saved[d.key]) : 0,
        }));
      }
    } catch { /* ignore */ }
    return this._AUTO_EXP_DEFAULTS.map(d => ({ ...d, amount: 0 }));
  },

  _getAutoExpAmount(key) {
    const rules = this._getAutoExpRules();
    const rule = rules.find(r => r.key === key);
    return rule ? rule.amount : 0;
  },

  // ── Grant EXP ──

  _grantAutoExp(uid, key, context) {
    if (!uid) return;
    const amount = this._getAutoExpAmount(key);
    if (amount === 0) return;
    const rule = this._AUTO_EXP_DEFAULTS.find(r => r.key === key);
    const reason = `自動：${rule?.label || key}${context ? '（' + context + '）' : ''}`;
    const user = ApiService.adjustUserExp(uid, amount, reason, '系統');
    if (!user) return;
    // Write to auto exp log
    const logs = this._getAutoExpLogs();
    const now = new Date();
    const timeStr = App._formatDateTime(now);
    logs.unshift({ time: timeStr, target: user.name, key, amount, context: context || '' });
    if (logs.length > 200) logs.length = 200;
    localStorage.setItem(this._autoExpLogKey(), JSON.stringify(logs));
  },

  _getAutoExpLogs() {
    try {
      const data = JSON.parse(localStorage.getItem(this._autoExpLogKey()) || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },

  // ── Admin Page Rendering ──

  renderAutoExpRules() {
    const container = document.getElementById('auto-exp-rules-list');
    if (!container) return;
    const rules = this._getAutoExpRules();
    container.innerHTML = rules.map(r => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.55rem 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:.85rem;font-weight:600;color:var(--text-primary)">${escapeHTML(r.label)}</div>
          <div style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(r.desc)}</div>
        </div>
        <input type="number" id="auto-exp-${r.key}" value="${r.amount}" style="width:80px;text-align:center;font-size:.85rem;padding:.35rem .3rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary)" placeholder="0">
        <span style="font-size:.72rem;color:var(--text-muted);flex-shrink:0">EXP</span>
      </div>
    `).join('');
    this._renderAutoExpLogs();
  },

  saveAutoExpRules() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.super_admin) {
      this.showToast('權限不足'); return;
    }
    const data = {};
    this._AUTO_EXP_DEFAULTS.forEach(d => {
      const input = document.getElementById('auto-exp-' + d.key);
      data[d.key] = parseInt(input?.value) || 0;
    });
    localStorage.setItem(this._autoExpKey(), JSON.stringify(data));
    this.showToast('自動 EXP 規則已儲存');
  },

  _renderAutoExpLogs() {
    const container = document.getElementById('auto-exp-log-list');
    if (!container) return;
    const logs = this._getAutoExpLogs();
    if (!logs.length) {
      container.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">尚無自動發放紀錄</div>';
      return;
    }
    container.innerHTML = logs.slice(0, 50).map(l => {
      const sign = l.amount > 0 ? '+' : '';
      const color = l.amount > 0 ? 'var(--success)' : 'var(--danger)';
      return `<div style="display:flex;align-items:center;gap:.4rem;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.78rem">
        <span style="color:var(--text-primary);font-weight:600;min-width:3.5em">${escapeHTML(l.target)}</span>
        <span style="color:var(--text-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(l.context || l.key)}</span>
        <span style="font-weight:700;color:${color};flex-shrink:0">${sign}${l.amount}</span>
        <span style="color:var(--text-muted);font-size:.68rem;flex-shrink:0">${escapeHTML(l.time)}</span>
      </div>`;
    }).join('');
  },

});
