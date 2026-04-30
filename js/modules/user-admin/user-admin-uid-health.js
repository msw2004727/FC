/* ================================================
   SportHub - User Admin: UID Health Check
   位於「用戶補正管理 > UID檢查」分頁

   功能：
   - 讀取最後一次 UID 健康檢查報表
   - 後端密碼驗證後手動執行 runUidHealthCheck
   - 顯示只讀報表與 UID 檢查 Log
   ================================================ */

Object.assign(App, {
  _uidHealthLastReport: null,

  async renderUidHealthCheckPanel() {
    const host = document.getElementById('uid-health-panel-host');
    if (!host) return;

    if (!this.hasPermission?.('admin.repair.data_sync')) {
      host.innerHTML = '<div class="form-card"><div style="font-size:.82rem;color:var(--text-muted)">權限不足，無法使用 UID 檢查。</div></div>';
      return;
    }

    host.innerHTML = '<div class="form-card"><div class="sync-config-empty">載入中...</div></div>';
    let report = this._uidHealthLastReport || null;
    try {
      const snap = await db.collection('siteConfig').doc('realtimeConfig').get();
      const data = snap.exists ? (snap.data() || {}) : {};
      report = data.uidHealthLastReport && typeof data.uidHealthLastReport === 'object'
        ? data.uidHealthLastReport
        : null;
      this._uidHealthLastReport = report;
    } catch (err) {
      console.warn('[renderUidHealthCheckPanel] realtimeConfig read failed:', err);
    }

    const statusClass = this._getUidHealthStatusClass(report && report.status);
    const statusLabel = this._getUidHealthStatusLabel(report && report.status);
    host.innerHTML = '<div class="form-card">'
      + '  <div class="uid-health-panel">'
      + '    <div class="uid-health-head">'
      + '      <span><strong>只讀稽核報表</strong><small>掃描 UID 欄位一致性，不修復、不刪除正式資料</small></span>'
      + '      <b id="uid-health-status" class="uid-health-status ' + statusClass + '">' + statusLabel + '</b>'
      + '    </div>'
      + '    <div id="uid-health-summary">' + this._buildUidHealthSummaryHtml(report) + '</div>'
      + '    <div class="uid-health-actions">'
      + '      <button id="uid-health-run-btn" class="outline-btn" type="button">立即檢查</button>'
      + '      <button id="uid-health-report-btn" class="btn-sm" type="button">查看報表</button>'
      + '      <button id="uid-health-copy-btn" class="outline-btn" type="button">複製診斷包</button>'
      + '      <button id="uid-health-preview-comp-repair-btn" class="outline-btn" type="button">預覽同行修復</button>'
      + '      <button id="uid-health-apply-comp-repair-btn" class="outline-btn uid-health-danger-action" type="button">正式修復同行</button>'
      + '    </div>'
      + '    <div id="uid-health-repair-result" class="uid-health-repair-result" hidden></div>'
      + '    <div class="sync-config-progress uid-health-progress" id="uid-health-progress" hidden aria-hidden="true">'
      + '      <div class="sync-config-progress-head">'
      + '        <span id="uid-health-progress-text">準備中...</span>'
      + '        <strong id="uid-health-progress-percent">0%</strong>'
      + '      </div>'
      + '      <div class="sync-config-progress-track" id="uid-health-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">'
      + '        <div class="sync-config-progress-fill" id="uid-health-progress-fill" style="width:0%"></div>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '  <div id="uid-health-status-text" style="font-size:.72rem;color:var(--text-secondary);margin-top:.45rem;text-align:center"></div>'
      + '</div>';

    document.getElementById('uid-health-run-btn')?.addEventListener('click', () => {
      this.runUidHealthCheckNow();
    });
    document.getElementById('uid-health-report-btn')?.addEventListener('click', () => {
      this.openUidHealthReportModal();
    });
    document.getElementById('uid-health-copy-btn')?.addEventListener('click', () => {
      this.copyUidHealthDiagnosticPackage();
    });
    document.getElementById('uid-health-preview-comp-repair-btn')?.addEventListener('click', () => {
      this.runCompanionAttendanceRepair(false);
    });
    document.getElementById('uid-health-apply-comp-repair-btn')?.addEventListener('click', () => {
      this.runCompanionAttendanceRepair(true);
    });
  },

  _getUidHealthStatusLabel(status) {
    const safeStatus = String(status || '').toLowerCase();
    if (safeStatus === 'ok') return '正常';
    if (safeStatus === 'warning') return '警告';
    if (safeStatus === 'error') return '異常';
    return '未檢查';
  },

  _getUidHealthStatusClass(status) {
    const safeStatus = String(status || '').toLowerCase();
    if (safeStatus === 'ok') return 'is-ok';
    if (safeStatus === 'warning') return 'is-warning';
    if (safeStatus === 'error') return 'is-error';
    return 'is-idle';
  },

  _buildUidHealthSummaryHtml(report) {
    if (!report || typeof report !== 'object') {
      return '<div class="uid-health-empty">尚未執行 UID 健康檢查。</div>';
    }
    const checkedAt = this._formatSyncConfigLogTime(report.checkedAtMs || report.checkedAt || report.uidHealthLastCheckedAt);
    const scanned = Number(report.scannedDocs || 0) || 0;
    const reads = Number(report.estimatedReads || 0) || 0;
    const errors = Number(report.errors || 0) || 0;
    const warnings = Number(report.warnings || 0) || 0;
    const changes = Number(report.dataChanges || 0) || 0;
    return '<div class="uid-health-summary-grid">'
      + '<div><b>' + scanned.toLocaleString() + '</b><span>掃描文件</span></div>'
      + '<div><b>' + warnings.toLocaleString() + '</b><span>警告</span></div>'
      + '<div><b>' + errors.toLocaleString() + '</b><span>嚴重</span></div>'
      + '<div><b>' + changes.toLocaleString() + '</b><span>資料修改</span></div>'
      + '</div>'
      + '<div class="uid-health-summary-text">最近檢查：' + escapeHTML(checkedAt || '--')
      + '｜估計讀取：' + reads.toLocaleString() + ' 筆</div>';
  },

  _updateUidHealthSummary(report) {
    this._uidHealthLastReport = report || null;
    const summaryEl = document.getElementById('uid-health-summary');
    const statusEl = document.getElementById('uid-health-status');
    if (summaryEl) summaryEl.innerHTML = this._buildUidHealthSummaryHtml(report);
    if (statusEl) {
      statusEl.className = 'uid-health-status ' + this._getUidHealthStatusClass(report && report.status);
      statusEl.textContent = this._getUidHealthStatusLabel(report && report.status);
    }
  },

  _setUidHealthProgress(done, total, label, state) {
    const progressEl = document.getElementById('uid-health-progress');
    const fill = document.getElementById('uid-health-progress-fill');
    const track = document.getElementById('uid-health-progress-track');
    const percent = document.getElementById('uid-health-progress-percent');
    const text = document.getElementById('uid-health-progress-text');
    const safeTotal = Math.max(0, Number(total || 0));
    const safeDone = Math.max(0, Number(done || 0));
    let pct = safeTotal > 0 ? Math.round(Math.min(100, safeDone / safeTotal * 100)) : (state === 'done' ? 100 : 0);
    if (state === 'running' && pct >= 100) pct = 96;
    if (progressEl) {
      progressEl.hidden = false;
      progressEl.setAttribute('aria-hidden', 'false');
      progressEl.classList.toggle('is-running', state === 'running');
      progressEl.classList.toggle('is-done', state === 'done');
      progressEl.classList.toggle('is-error', state === 'error');
    }
    if (fill) fill.style.width = pct + '%';
    if (track) track.setAttribute('aria-valuenow', String(pct));
    if (percent) percent.textContent = pct + '%';
    if (text) text.textContent = label || '檢查中...';
  },

  async _loadUidHealthLastReport() {
    let report = this._uidHealthLastReport || null;
    if (report && typeof report === 'object') return report;
    try {
      const snap = await db.collection('siteConfig').doc('realtimeConfig').get();
      const data = snap.exists ? (snap.data() || {}) : {};
      report = data.uidHealthLastReport && typeof data.uidHealthLastReport === 'object'
        ? data.uidHealthLastReport
        : null;
      this._uidHealthLastReport = report;
      return report;
    } catch (err) {
      console.error('[loadUidHealthLastReport]', err);
      return null;
    }
  },

  async runUidHealthCheckNow() {
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast?.('權限不足');
      return;
    }

    const btn = document.getElementById('uid-health-run-btn');
    const reportBtn = document.getElementById('uid-health-report-btn');
    const copyBtn = document.getElementById('uid-health-copy-btn');
    const previewRepairBtn = document.getElementById('uid-health-preview-comp-repair-btn');
    const applyRepairBtn = document.getElementById('uid-health-apply-comp-repair-btn');
    const statusEl = document.getElementById('uid-health-status-text') || document.getElementById('rl-status');
    const ok = typeof this.appConfirm === 'function'
      ? await this.appConfirm('確定要執行 UID 健康檢查嗎？\n\n這會讀取使用者、報名、簽到、活動投影等資料，只產生報表與 Log，不會修復或刪除正式資料。')
      : window.confirm('確定要執行 UID 健康檢查嗎？');
    if (!ok) return;

    const password = await this._promptDataSyncPassword('UID 健康檢查');
    if (!password) {
      if (statusEl) statusEl.textContent = '已取消，沒有執行 UID 健康檢查。';
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '檢查中...';
    }
    if (reportBtn) reportBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
    if (previewRepairBtn) previewRepairBtn.disabled = true;
    if (applyRepairBtn) applyRepairBtn.disabled = true;
    if (statusEl) {
      statusEl.style.color = 'var(--text-secondary)';
      statusEl.textContent = '正在執行 UID 健康檢查...';
    }
    this._setUidHealthProgress(1, 5, '送出後端驗證...', 'running');
    try {
      const fn = firebase.app().functions('asia-east1');
      const callable = fn.httpsCallable('runUidHealthCheck', { timeout: 300000 });
      this._setUidHealthProgress(2, 5, '掃描 UID 關聯資料...', 'running');
      const resp = await callable({ password });
      const report = (resp && resp.data && resp.data.report) ? resp.data.report : null;
      this._setUidHealthProgress(5, 5, '檢查完成', 'done');
      this._updateUidHealthSummary(report);
      const msg = report && report.summary ? report.summary : 'UID 健康檢查完成';
      if (statusEl) {
        statusEl.style.color = report && report.status === 'error'
          ? 'var(--danger,#dc2626)'
          : (report && report.status === 'warning' ? 'var(--warning,#f59e0b)' : 'var(--success,#16a34a)');
        statusEl.textContent = msg;
      }
      this.showToast?.(msg);
    } catch (err) {
      console.error('[runUidHealthCheckNow]', err);
      this._setUidHealthProgress(1, 1, '檢查失敗', 'error');
      if (statusEl) {
        statusEl.style.color = 'var(--danger,#dc2626)';
        statusEl.textContent = this._getDataSyncGuardErrorMessage(err, 'UID 健康檢查失敗。');
      }
      this.showToast?.('UID 健康檢查失敗');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '立即檢查';
      }
      if (reportBtn) reportBtn.disabled = false;
      if (copyBtn) copyBtn.disabled = false;
      if (previewRepairBtn) previewRepairBtn.disabled = false;
      if (applyRepairBtn) applyRepairBtn.disabled = false;
    }
  },

  _setUidHealthRepairButtonsDisabled(disabled) {
    [
      'uid-health-run-btn',
      'uid-health-report-btn',
      'uid-health-copy-btn',
      'uid-health-preview-comp-repair-btn',
      'uid-health-apply-comp-repair-btn',
    ].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !!disabled;
    });
  },

  _renderCompanionAttendanceRepairResult(result, applyMode) {
    const box = document.getElementById('uid-health-repair-result');
    if (!box) return;
    const data = result && typeof result === 'object' ? result : {};
    const samples = Array.isArray(data.samples) ? data.samples : [];
    const title = applyMode ? '正式修復結果' : '預覽結果';
    const sampleHtml = samples.length
      ? '<div class="uid-health-repair-samples">' + samples.map((sample) => {
        const line = [
          sample.path,
          sample.fromUid ? ('from ' + sample.fromUid) : '',
          sample.toUid ? ('to ' + sample.toUid) : '',
          sample.companionName ? sample.companionName : '',
          sample.reason ? ('reason ' + sample.reason) : '',
        ].filter(Boolean).join(' / ');
        return '<code>' + escapeHTML(line) + '</code>';
      }).join('') + '</div>'
      : '';
    box.hidden = false;
    box.innerHTML = '<div class="uid-health-repair-head">'
      + '<b>' + escapeHTML(title) + '</b>'
      + '<span>' + (applyMode ? '已寫入資料庫' : '未修改資料') + '</span>'
      + '</div>'
      + '<div class="uid-health-repair-grid">'
      + '<div><b>' + Number(data.scannedAttendance || 0).toLocaleString() + '</b><span>掃描簽到</span></div>'
      + '<div><b>' + Number(data.candidates || 0).toLocaleString() + '</b><span>候選</span></div>'
      + '<div><b>' + Number(data.repairable || 0).toLocaleString() + '</b><span>可修復</span></div>'
      + '<div><b>' + Number(data.repaired || 0).toLocaleString() + '</b><span>已修復</span></div>'
      + '<div><b>' + Number(data.skipped || 0).toLocaleString() + '</b><span>略過</span></div>'
      + '</div>'
      + sampleHtml;
  },

  async runCompanionAttendanceRepair(applyMode) {
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast?.('權限不足');
      return;
    }
    const title = applyMode ? '正式修復同行簽到 UID' : '預覽同行簽到 UID 修復';
    const confirmText = applyMode
      ? '這會只修復「comp_ 同行者 ID 被寫成 self 簽到」且能對回同行者報名的紀錄。其他資料不會修改。\n\n是否繼續？'
      : '這次只會預覽可修復的同行者簽到紀錄，不會修改資料。\n\n是否繼續？';
    const ok = typeof this.appConfirm === 'function'
      ? await this.appConfirm(confirmText)
      : window.confirm(confirmText);
    if (!ok) return;

    const password = await this._promptDataSyncPassword(title);
    if (!password) return;

    const statusEl = document.getElementById('uid-health-status-text') || document.getElementById('rl-status');
    this._setUidHealthRepairButtonsDisabled(true);
    if (statusEl) {
      statusEl.style.color = 'var(--text-secondary)';
      statusEl.textContent = applyMode ? '正在修復同行者簽到 UID...' : '正在預覽同行者簽到 UID 修復...';
    }
    this._setUidHealthProgress(1, 4, applyMode ? '準備修復...' : '準備預覽...', 'running');
    try {
      const fn = firebase.app().functions('asia-east1');
      const callable = fn.httpsCallable('repairCompanionAttendanceRecords', { timeout: 300000 });
      this._setUidHealthProgress(2, 4, '掃描簽到紀錄...', 'running');
      const resp = await callable({
        password,
        dryRun: !applyMode,
        confirmApply: !!applyMode,
      });
      const result = (resp && resp.data) ? resp.data : {};
      this._setUidHealthProgress(4, 4, applyMode ? '修復完成' : '預覽完成', 'done');
      this._renderCompanionAttendanceRepairResult(result, applyMode);
      const msg = applyMode
        ? ('修復完成：已修復 ' + Number(result.repaired || 0).toLocaleString() + ' 筆')
        : ('預覽完成：可修復 ' + Number(result.repairable || 0).toLocaleString() + ' 筆');
      if (statusEl) {
        statusEl.style.color = 'var(--success,#16a34a)';
        statusEl.textContent = msg + '，建議再執行一次 UID 檢查。';
      }
      this.showToast?.(msg);
    } catch (err) {
      console.error('[runCompanionAttendanceRepair]', err);
      this._setUidHealthProgress(1, 1, applyMode ? '修復失敗' : '預覽失敗', 'error');
      if (statusEl) {
        statusEl.style.color = 'var(--danger,#dc2626)';
        statusEl.textContent = this._getDataSyncGuardErrorMessage(err, applyMode ? '同行簽到修復失敗' : '同行簽到修復預覽失敗');
      }
      this.showToast?.(applyMode ? '同行簽到修復失敗' : '同行簽到修復預覽失敗');
    } finally {
      this._setUidHealthRepairButtonsDisabled(false);
    }
  },

  async openUidHealthReportModal() {
    const report = await this._loadUidHealthLastReport();
    if (!report) {
      this.showToast?.('尚無 UID 健康檢查報表');
      return;
    }

    let overlay = document.getElementById('uid-health-report-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'uid-health-report-modal';
      overlay.className = 'sync-config-log-overlay';
      overlay.onclick = function(e) { if (e.target === overlay) App.closeUidHealthReportModal(); };
      overlay.innerHTML = '<div class="sync-config-log-box uid-health-report-box">'
        + '<div class="sync-config-log-header"><span>UID 健康檢查報表</span><div class="uid-health-report-tools"><button class="outline-btn uid-health-report-copy-btn" type="button" onclick="App.copyUidHealthDiagnosticPackage()">複製診斷包</button><button class="event-reg-log-close" onclick="App.closeUidHealthReportModal()">&times;</button></div></div>'
        + '<div class="sync-config-log-body" id="uid-health-report-body"></div>'
        + '</div>';
      document.body.appendChild(overlay);
    }

    const body = document.getElementById('uid-health-report-body');
    const statusLabel = this._getUidHealthStatusLabel(report.status);
    const statusClass = this._getUidHealthStatusClass(report.status);
    const sections = Array.isArray(report.sections) ? report.sections : [];
    const sectionHtml = sections.map((section) => {
      const issues = Array.isArray(section.issues) ? section.issues : [];
      const issueHtml = issues.length ? issues.map((issue) => {
        const samples = Array.isArray(issue.samples) ? issue.samples : [];
        const sampleHtml = samples.length ? '<div class="uid-health-samples">' + samples.map((sample) => {
          const line = [
            sample.path,
            sample.field ? ('欄位 ' + sample.field) : '',
            sample.value ? ('值 ' + sample.value) : '',
            sample.name ? ('名稱 ' + sample.name) : '',
          ].filter(Boolean).join('｜');
          return '<code>' + escapeHTML(line) + '</code>';
        }).join('') + '</div>' : '';
        return '<div class="uid-health-issue ' + (issue.severity === 'error' ? 'is-error' : 'is-warning') + '">'
          + '<div><b>' + escapeHTML(issue.message || issue.type || '異常') + '</b><span>' + Number(issue.count || 0).toLocaleString() + ' 筆</span></div>'
          + sampleHtml
          + '</div>';
      }).join('') : '<div class="uid-health-no-issue">未發現異常</div>';
      return '<details class="uid-health-section" ' + (issues.length ? 'open' : '') + '>'
        + '<summary><span>' + escapeHTML(section.title || section.key || '') + '</span><b class="' + this._getUidHealthStatusClass(section.status) + '">' + this._getUidHealthStatusLabel(section.status) + '</b></summary>'
        + '<div class="uid-health-section-body">' + issueHtml + '</div>'
        + '</details>';
    }).join('');

    if (body) {
      body.innerHTML = '<div class="uid-health-report-head">'
        + '<span class="uid-health-status ' + statusClass + '">' + statusLabel + '</span>'
        + '<p>' + escapeHTML(report.summary || '') + '</p>'
        + '<small>最近檢查：' + escapeHTML(this._formatSyncConfigLogTime(report.checkedAtMs || report.checkedAt)) + '｜資料修改：0</small>'
        + '</div>'
        + sectionHtml;
    }
    overlay.classList.add('open');
  },

  closeUidHealthReportModal() {
    const modal = document.getElementById('uid-health-report-modal');
    if (modal) modal.classList.remove('open');
  },

  _syncConfigLogMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_) {} }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime(); } catch (_) {} }
    if (typeof v === 'object' && typeof (v.seconds || v._seconds) === 'number') {
      return ((v.seconds || v._seconds) * 1000) + Math.floor(((v.nanoseconds || v._nanoseconds || 0) / 1000000));
    }
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  },

  _formatSyncConfigLogTime(v) {
    const ms = this._syncConfigLogMs(v);
    if (!ms) return '--';
    const d = new Date(ms);
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0')
      + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  async openActivityRepairLogModal() {
    let overlay = document.getElementById('activity-repair-log-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'activity-repair-log-modal';
      overlay.className = 'sync-config-log-overlay';
      overlay.onclick = function(e) { if (e.target === overlay) App.closeActivityRepairLogModal(); };
      overlay.innerHTML = '<div class="sync-config-log-box">'
        + '<div class="sync-config-log-header"><span>資料同步與 UID 檢查 Log</span><button class="event-reg-log-close" onclick="App.closeActivityRepairLogModal()">&times;</button></div>'
        + '<div class="sync-config-log-body" id="activity-repair-log-body"></div>'
        + '</div>';
      document.body.appendChild(overlay);
    }
    const body = document.getElementById('activity-repair-log-body');
    overlay.classList.add('open');
    if (body) body.innerHTML = '<div class="sync-config-empty">載入中...</div>';

    try {
      const snap = await db.collection('siteConfig').doc('realtimeConfig').get();
      const data = snap.exists ? (snap.data() || {}) : {};
      const repairLogs = (Array.isArray(data.activityRepairLogs) ? data.activityRepairLogs : [])
        .map(function(log) { return Object.assign({ _kind: 'repair' }, log); });
      const healthLogs = (Array.isArray(data.uidHealthCheckLogs) ? data.uidHealthCheckLogs : [])
        .map(function(log) { return Object.assign({ _kind: 'uid_health' }, log); });
      const logs = repairLogs.concat(healthLogs);
      logs.sort((a, b) => this._syncConfigLogMs(b.at) - this._syncConfigLogMs(a.at));
      if (!logs.length) {
        if (body) body.innerHTML = '<div class="sync-config-empty">尚無同步紀錄</div>';
        return;
      }
      const sourceLabels = {
        scheduled: '排程',
        admin_manual: '手動',
        config: '設定',
        system: '系統',
        uid_health: 'UID檢查',
        uid_companion_attendance: '同行簽到修復',
      };
      const statusLabels = {
        success: '完成',
        error: '失敗',
        ok: '正常',
        warning: '警告',
      };
      if (body) {
        body.innerHTML = logs.map((log) => {
          const status = String(log.status || 'success');
          const source = sourceLabels[log.source] || sourceLabels[log._kind] || log.source || '系統';
          const actionClass = status === 'error' ? 'cancel'
            : (status === 'warning' ? 'warning' : (log.source === 'config' ? 'promote' : 'reg'));
          const summary = log._kind === 'uid_health'
            ? ('掃描 ' + (Number(log.scannedDocs || 0) || 0)
              + '｜警告 ' + (Number(log.warnings || 0) || 0)
              + '｜嚴重 ' + (Number(log.errors || 0) || 0)
              + '｜改資料 ' + (Number(log.dataChanges || 0) || 0))
            : (log.source === 'uid_companion_attendance'
              ? ('掃描簽到 ' + (Number(log.scannedRegistrations || 0) || 0)
                + '｜可修復 ' + (Number(log.created || 0) || 0)
                + '｜已修復 ' + (Number(log.updated || 0) || 0)
                + '｜略過 ' + (Number(log.skipped || 0) || 0))
            : ('活動 ' + (Number(log.scannedEvents || 0) || 0)
              + '｜報名 ' + (Number(log.scannedRegistrations || 0) || 0)
              + '｜新增 ' + (Number(log.created || 0) || 0)
              + '｜更新 ' + (Number(log.updated || 0) || 0)));
          const msg = log.error || log.message || summary;
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
    const modal = document.getElementById('activity-repair-log-modal');
    if (modal) modal.classList.remove('open');
  },

  _getDataSyncGuardErrorMessage(err, fallback) {
    const code = String((err && (err.code || err.name)) || '');
    const message = String((err && err.message) || '');
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
      const overlay = document.createElement('div');
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

      const input = overlay.querySelector('.sync-config-password-input');
      const done = function(value) {
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

  _showUidHealthInfo() {
    const body = '<p style="margin-bottom:.65rem">這裡是檢查系統裡 UID 有沒有混用、缺漏或和文件 ID 對不起來。</p>'
      + '<div class="sync-config-help-list">'
      + '<div><b>立即檢查</b><span>會請後端掃描 users、報名、簽到、活動紀錄、活動投影、俱樂部與賽事等資料，只產生報表。</span></div>'
      + '<div><b>查看報表</b><span>打開最後一次檢查結果，能看到各區塊正常、警告或異常，以及少量範例路徑。</span></div>'
      + '<div><b>複製診斷包</b><span>把最後一次檢查的摘要、分類、筆數與樣本路徑一次複製，方便貼給工程師分析，不會包含完整資料庫。</span></div>'
      + '<div><b>資料修改</b><span>健康檢查預期永遠是 0，代表它不會修資料、不會刪資料，只會寫入最後報表與 Log。</span></div>'
      + '<div><b>Log</b><span>記錄最近的 UID 檢查與報名紀錄修復結果，方便追查哪次檢查發現問題。</span></div>'
      + '<div><b>上鎖保護</b><span>執行檢查前要輸入密碼，密碼由後端驗證，避免誤觸造成大量讀取。</span></div>'
      + '</div>'
      + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.65rem">簡單說：這是體檢表，不是手術工具。看到異常後再針對報表內容另開修復流程。</p>';
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">UID 檢查說明</div>'
      + '<div class="edu-info-dialog-body">' + body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.edu-info-overlay\').remove()">確認</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },
});
