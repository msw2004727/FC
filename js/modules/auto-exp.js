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
    // 同步 currentUser 的 EXP（adjustUserExp 只更新 adminUsers 快取）
    var curUser = ApiService.getCurrentUser();
    if (curUser && (curUser.uid === uid || curUser.lineUserId === uid)) {
      curUser.exp = user.exp;
      // 即時刷新畫面上的 EXP 顯示
      if (typeof this.renderProfileData === 'function') this.renderProfileData();
      if (typeof this.renderPersonalDashboard === 'function') this.renderPersonalDashboard();
    }
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

  // ── Backfill ──

  async runAutoExpBackfill(dryRun) {
    if (!this.hasPermission('admin.auto_exp.entry')) {
      this.showToast('權限不足'); return;
    }
    var resultEl = document.getElementById('auto-exp-backfill-result');
    var executeBtn = document.getElementById('auto-exp-backfill-execute-btn');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">處理中，請稍候…</div>';
    }
    if (executeBtn) executeBtn.disabled = true;

    try {
      var fn = firebase.app().functions('asia-east1').httpsCallable('backfillAutoExp', { timeout: 540000 });
      var res = await fn({ dryRun: !!dryRun });
      var d = res.data || {};
      var stats = d.stats || {};
      var labels = { register_activity: '報名活動', cancel_registration: '取消報名', complete_activity: '完成活動', host_activity: '主辦活動' };
      var rows = Object.keys(labels).map(function (key) {
        var s = stats[key] || {};
        return '<tr>'
          + '<td style="padding:.25rem .4rem;font-size:.78rem">' + escapeHTML(labels[key]) + '</td>'
          + '<td style="padding:.25rem .4rem;font-size:.78rem;text-align:center">' + (s.scanned || 0) + '</td>'
          + '<td style="padding:.25rem .4rem;font-size:.78rem;text-align:center">' + (s.alreadyGranted || 0) + '</td>'
          + '<td style="padding:.25rem .4rem;font-size:.78rem;text-align:center;font-weight:600;color:var(--success)">' + (dryRun ? (s.toGrant || 0) : (s.granted || 0)) + '</td>'
          + '</tr>';
      }).join('');
      var html = '<table style="width:100%;border-collapse:collapse;margin-bottom:.4rem">'
        + '<thead><tr style="border-bottom:1px solid var(--border)">'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:left;color:var(--text-muted)">規則</th>'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:center;color:var(--text-muted)">掃描</th>'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:center;color:var(--text-muted)">已發放</th>'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:center;color:var(--text-muted)">' + (dryRun ? '待補發' : '已補發') + '</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>';
      html += '<div style="font-size:.78rem;color:var(--text-primary);font-weight:600">' + escapeHTML(d.message || '') + '</div>';
      if (d.totalErrors > 0) {
        html += '<div style="font-size:.75rem;color:var(--danger)">失敗 ' + d.totalErrors + ' 筆</div>';
      }
      if (resultEl) resultEl.innerHTML = html;

      // 預覽完成且有待補發 → 啟用確認按鈕
      if (dryRun && (d.totalToGrant || 0) > 0 && executeBtn) {
        executeBtn.disabled = false;
      }
      if (!dryRun) {
        this.showToast(d.message || '補發完成');
        if (executeBtn) executeBtn.disabled = true;
        this._loadBackfillLogs();
      }
    } catch (err) {
      var msg = (err && err.message) || '回推補發失敗';
      if (resultEl) resultEl.innerHTML = '<div style="font-size:.82rem;color:var(--danger);padding:.5rem 0">' + escapeHTML(msg) + '</div>';
      this.showToast(msg);
    }
  },

  async _loadBackfillLogs() {
    var container = document.getElementById('auto-exp-backfill-log-list');
    if (!container || ModeManager.isDemo() || typeof db === 'undefined') return;
    container.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">載入中…</div>';
    try {
      var snap = await db.collection('expLogs')
        .where('backfill', '==', true)
        .limit(200)
        .get();
      if (snap.empty) {
        container.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);padding:.5rem 0">尚無補發紀錄</div>';
        return;
      }
      // 按 createdAt 降序排序（client-side，避免需要 composite index）
      var docs = snap.docs.slice().sort(function (a, b) {
        var ta = a.data().createdAt?.toMillis?.() || 0;
        var tb = b.data().createdAt?.toMillis?.() || 0;
        return tb - ta;
      }).slice(0, 100);
      var html = '<table style="width:100%;border-collapse:collapse">'
        + '<thead><tr style="border-bottom:1px solid var(--border)">'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:left;color:var(--text-muted)">時間</th>'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:left;color:var(--text-muted)">用戶</th>'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:left;color:var(--text-muted)">補發行為</th>'
        + '<th style="padding:.25rem .4rem;font-size:.72rem;text-align:right;color:var(--text-muted)">EXP</th>'
        + '</tr></thead><tbody>';
      docs.forEach(function (doc) {
        var d = doc.data() || {};
        var time = d.time || '';
        if (!time && d.createdAt && d.createdAt.toDate) {
          var dt = d.createdAt.toDate();
          time = (dt.getMonth() + 1 + '').padStart(2, '0') + '/' + (dt.getDate() + '').padStart(2, '0') + ' ' + (dt.getHours() + '').padStart(2, '0') + ':' + (dt.getMinutes() + '').padStart(2, '0');
        }
        var amt = d.amount || 0;
        var color = String(amt).indexOf('-') === 0 ? 'var(--danger)' : 'var(--success)';
        html += '<tr style="border-bottom:1px solid var(--border)">'
          + '<td style="padding:.25rem .4rem;font-size:.75rem;color:var(--text-muted);white-space:nowrap">' + escapeHTML(time) + '</td>'
          + '<td style="padding:.25rem .4rem;font-size:.75rem;font-weight:600">' + escapeHTML(d.target || d.uid || '') + '</td>'
          + '<td style="padding:.25rem .4rem;font-size:.75rem;color:var(--text-secondary)">' + escapeHTML(d.reason || '') + '</td>'
          + '<td style="padding:.25rem .4rem;font-size:.75rem;font-weight:700;text-align:right;color:' + color + '">' + escapeHTML(String(amt)) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<div style="font-size:.82rem;color:var(--danger);padding:.5rem 0">載入失敗：' + escapeHTML(err.message || '') + '</div>';
    }
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
