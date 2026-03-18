/* ================================================
   SportHub — Auto EXP System
   活動結束簽退後自動發放經驗值
   Firestore 持久化 + localStorage fallback
   ================================================ */

Object.assign(App, {

  _AUTO_EXP_KEY_BASE: 'sporthub_auto_exp_rules',
  _AUTO_EXP_LOG_KEY_BASE: 'sporthub_auto_exp_logs',
  _autoExpFirestoreCache: null,

  _autoExpKey()    { return this._AUTO_EXP_KEY_BASE + '_' + ModeManager.getMode(); },
  _autoExpLogKey() { return this._AUTO_EXP_LOG_KEY_BASE + '_' + ModeManager.getMode(); },

  _AUTO_EXP_DEFAULTS: [
    { key: 'complete_activity',    label: '\u5B8C\u6210\u6D3B\u52D5',     desc: '\u7C3D\u5230\uFF0B\u7C3D\u9000\u5B8C\u6210\u4E00\u5834\u6D3B\u52D5' },
    { key: 'register_activity',    label: '\u5831\u540D\u6D3B\u52D5',     desc: '\u6210\u529F\u5831\u540D\u4E00\u5834\u6D3B\u52D5' },
    { key: 'cancel_registration',  label: '\u53D6\u6D88\u5831\u540D',     desc: '\u53D6\u6D88\u6D3B\u52D5\u5831\u540D\uFF08\u53EF\u8A2D\u8CA0\u6578\u6263\u5206\uFF09' },
    { key: 'host_activity',        label: '\u4E3B\u8FA6\u6D3B\u52D5',     desc: '\u5EFA\u7ACB\u4E00\u5834\u65B0\u6D3B\u52D5' },
  ],

  // ── Rule CRUD ──

  _getAutoExpRules() {
    // 優先用 Firestore 快取，其次 localStorage
    var saved = this._autoExpFirestoreCache;
    if (!saved) {
      try {
        saved = JSON.parse(localStorage.getItem(this._autoExpKey()));
      } catch (_) { saved = null; }
    }
    if (saved && typeof saved === 'object') {
      return this._AUTO_EXP_DEFAULTS.map(function (d) {
        return { key: d.key, label: d.label, desc: d.desc, amount: saved[d.key] !== undefined ? Number(saved[d.key]) : 0 };
      });
    }
    return this._AUTO_EXP_DEFAULTS.map(function (d) { return { key: d.key, label: d.label, desc: d.desc, amount: 0 }; });
  },

  _getAutoExpAmount(key) {
    var rules = this._getAutoExpRules();
    var rule = rules.find(function (r) { return r.key === key; });
    return rule ? rule.amount : 0;
  },

  /** 從 Firestore 載入 Auto-EXP 規則（背景呼叫，不阻塞） */
  async _loadAutoExpRulesFromFirestore() {
    if (ModeManager.isDemo() || typeof db === 'undefined') return;
    try {
      var doc = await db.collection('siteConfig').doc('autoExpRules').get();
      if (doc.exists) {
        var data = doc.data() || {};
        this._autoExpFirestoreCache = data;
        // 同步到 localStorage 作為 fallback
        localStorage.setItem(this._autoExpKey(), JSON.stringify(data));
      }
    } catch (err) {
      console.warn('[autoExp] Firestore load failed, using localStorage fallback:', err.message);
    }
  },

  // ── Grant EXP ──

  _grantAutoExp(uid, key, context) {
    if (!uid) return;
    var amount = this._getAutoExpAmount(key);
    if (amount === 0) return;
    var rule = this._AUTO_EXP_DEFAULTS.find(function (r) { return r.key === key; });
    var reason = '\u81EA\u52D5\uFF1A' + (rule ? rule.label : key) + (context ? '\uFF08' + context + '\uFF09' : '');
    var requestId = 'autoexp_' + uid + '_' + key + '_' + Date.now();
    var user = ApiService.adjustUserExp(uid, amount, reason, '\u7CFB\u7D71', { mode: 'auto', requestId: requestId });
    if (!user) return;
    // Write to auto exp log
    var logs = this._getAutoExpLogs();
    var now = new Date();
    var timeStr = App._formatDateTime(now);
    logs.unshift({ time: timeStr, target: user.name, key: key, amount: amount, context: context || '' });
    if (logs.length > 200) logs.length = 200;
    localStorage.setItem(this._autoExpLogKey(), JSON.stringify(logs));
  },

  _getAutoExpLogs() {
    try {
      var data = JSON.parse(localStorage.getItem(this._autoExpLogKey()) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (_) { return []; }
  },

  // ── Admin Page Rendering ──

  renderAutoExpRules() {
    var container = document.getElementById('auto-exp-rules-list');
    if (!container) return;
    var rules = this._getAutoExpRules();
    container.innerHTML = rules.map(function (r) {
      return '<div style="display:flex;align-items:center;gap:.5rem;padding:.55rem 0;border-bottom:1px solid var(--border)">'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:.85rem;font-weight:600;color:var(--text-primary)">' + escapeHTML(r.label) + '</div>'
        + '<div style="font-size:.72rem;color:var(--text-muted)">' + escapeHTML(r.desc) + '</div>'
        + '</div>'
        + '<input type="number" id="auto-exp-' + r.key + '" value="' + r.amount + '" style="width:80px;text-align:center;font-size:.85rem;padding:.35rem .3rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary)" placeholder="0">'
        + '<span style="font-size:.72rem;color:var(--text-muted);flex-shrink:0">EXP</span>'
        + '</div>';
    }).join('');
    this._renderAutoExpLogs();
  },

  async saveAutoExpRules() {
    if (!this.hasPermission('admin.auto_exp.entry')) {
      this.showToast('\u6B0A\u9650\u4E0D\u8DB3'); return;
    }
    var data = {};
    this._AUTO_EXP_DEFAULTS.forEach(function (d) {
      var input = document.getElementById('auto-exp-' + d.key);
      data[d.key] = parseInt(input?.value) || 0;
    });
    // 同時寫入 Firestore + localStorage
    localStorage.setItem(this._autoExpKey(), JSON.stringify(data));
    this._autoExpFirestoreCache = data;
    if (!ModeManager.isDemo() && typeof db !== 'undefined') {
      try {
        await db.collection('siteConfig').doc('autoExpRules').set(data, { merge: true });
      } catch (err) {
        console.error('[autoExp] Firestore save failed:', err);
        this.showToast('\u5132\u5B58\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66');
        return;
      }
    }
    this.showToast('\u81EA\u52D5 EXP \u898F\u5247\u5DF2\u5132\u5B58');
  },

  _renderAutoExpLogs() {
    var container = document.getElementById('auto-exp-log-list');
    if (!container) return;
    var logs = this._getAutoExpLogs();
    if (!logs.length) {
      container.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">\u5C1A\u7121\u81EA\u52D5\u767C\u653E\u7D00\u9304</div>';
      return;
    }
    container.innerHTML = logs.slice(0, 50).map(function (l) {
      var sign = l.amount > 0 ? '+' : '';
      var color = l.amount > 0 ? 'var(--success)' : 'var(--danger)';
      return '<div style="display:flex;align-items:center;gap:.4rem;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:.78rem">'
        + '<span style="color:var(--text-primary);font-weight:600;min-width:3.5em">' + escapeHTML(l.target) + '</span>'
        + '<span style="color:var(--text-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHTML(l.context || l.key) + '</span>'
        + '<span style="font-weight:700;color:' + color + ';flex-shrink:0">' + sign + l.amount + '</span>'
        + '<span style="color:var(--text-muted);font-size:.68rem;flex-shrink:0">' + escapeHTML(l.time) + '</span>'
        + '</div>';
    }).join('');
  },

});
