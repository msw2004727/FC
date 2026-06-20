/* ================================================
   ToosterX User Admin: Permission Audit Rendering
   ================================================ */

Object.assign(App, {
  _permissionAdminTab: 'settings',
  _permissionAuditLastReport: null,

  switchPermissionAdminTab(tab) {
    const active = tab === 'audit' ? 'audit' : (tab === 'user-grants' ? 'user-grants' : 'settings');
    this._permissionAdminTab = active;
    const settingsPane = document.getElementById('role-admin-settings-pane');
    const userGrantsPane = document.getElementById('role-admin-user-grants-pane');
    const auditPane = document.getElementById('role-admin-audit-pane');
    const settingsTab = document.getElementById('role-admin-tab-settings');
    const userGrantsTab = document.getElementById('role-admin-tab-user-grants');
    const auditTab = document.getElementById('role-admin-tab-audit');
    if (settingsPane) settingsPane.style.display = active === 'settings' ? '' : 'none';
    if (userGrantsPane) userGrantsPane.style.display = active === 'user-grants' ? '' : 'none';
    if (auditPane) auditPane.style.display = active === 'audit' ? '' : 'none';
    if (settingsTab) settingsTab.classList.toggle('active', active === 'settings');
    if (userGrantsTab) userGrantsTab.classList.toggle('active', active === 'user-grants');
    if (auditTab) auditTab.classList.toggle('active', active === 'audit');
    if (active === 'user-grants') this.renderUserPermissionGrantShell?.();
    if (active === 'audit') this.renderPermissionAuditShell();
  },

  renderPermissionAuditShell() {
    const host = document.getElementById('permission-audit-report');
    if (!host) return;
    if (this._permissionAuditLastReport) {
      host.innerHTML = this._renderPermissionAuditReport(this._permissionAuditLastReport);
      return;
    }
    host.innerHTML = '<div class="permission-audit-empty">尚未檢查。按「立即檢查」後會產生完整報表。</div>';
  },

  async runPermissionAuditReport() {
    const levels = (typeof ROLE_LEVEL_MAP !== 'undefined') ? ROLE_LEVEL_MAP : {};
    if ((levels[this.currentRole] || 0) < (levels.super_admin || 999)) {
      this.showToast('只有超級管理員可以執行權限測試');
      return;
    }
    const btn = document.getElementById('permission-audit-run-btn');
    const oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '檢查中...'; }
    try {
      if (typeof FirebaseService !== 'undefined' && FirebaseService?.ensureStaticCollectionsLoaded) {
        await FirebaseService.ensureStaticCollectionsLoaded(['permissions', 'customRoles', 'rolePermissions', 'roleActivityCapabilities']);
      }
      const report = this._buildPermissionAuditReport();
      this._permissionAuditLastReport = report;
      this.renderPermissionAuditShell();
      this.showToast(report.summary.errors ? '權限檢查完成：發現異常' : '權限檢查完成');
    } catch (err) {
      console.error('[runPermissionAuditReport]', err);
      this.showToast('權限檢查失敗，請查看 console');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText || '立即檢查'; }
    }
  },

  copyPermissionAuditReport() {
    const report = this._permissionAuditLastReport || this._buildPermissionAuditReport();
    const text = this._formatPermissionAuditText(report);
    const done = () => this.showToast('權限報告已複製');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this._fallbackCopyPermissionAuditText(text, done));
      return;
    }
    this._fallbackCopyPermissionAuditText(text, done);
  },

  _fallbackCopyPermissionAuditText(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done?.(); } catch (_) { this.showToast('複製失敗'); }
    ta.remove();
  },

  _renderPermissionAuditReport(report) {
    const esc = escapeHTML;
    const status = report.summary.errors ? 'error' : (report.summary.warnings ? 'warn' : 'ok');
    return `
      <div class="permission-audit-summary-grid">
        ${this._auditStat('狀態', report.summary.errors ? '異常' : (report.summary.warnings ? '需確認' : '正常'), status)}
        ${this._auditStat('層級', report.summary.roles)}
        ${this._auditStat('權限碼', report.summary.permissions)}
        ${this._auditStat('user 前台能力', report.summary.capabilities)}
        ${this._auditStat('警告', report.summary.warnings, report.summary.warnings ? 'warn' : 'ok')}
        ${this._auditStat('異常', report.summary.errors, report.summary.errors ? 'error' : 'ok')}
      </div>
      ${this._renderPermissionAuditIssues(report.issues)}
      ${this._renderPermissionAuditMajorTable(report)}
      ${this._renderPermissionAuditCapabilityTable()}
      ${this._renderPermissionAuditCatalogTable(report)}
      <div class="permission-audit-footnote">
        產生時間：${esc(report.generatedAt.toLocaleString('zh-TW'))}，前端版本：${esc(report.version || '未知')}。此頁負責檢查目前資料庫權限設定與前端權限 catalog；Firestore Rules 與 Cloud Functions 仍需搭配 <span class="permission-audit-code">npm run test:rules</span> 與相關 unit tests 驗證。
      </div>
    `;
  },

  _auditStat(label, value, tone = 'neutral') {
    return `<div class="permission-audit-stat"><div class="permission-audit-stat-value"><span class="permission-audit-badge ${tone}">${escapeHTML(String(value))}</span></div><div class="permission-audit-stat-label">${escapeHTML(label)}</div></div>`;
  },

  _renderPermissionAuditIssues(issues) {
    const list = issues.length
      ? issues
      : [{ level: 'ok', title: '未發現高風險異常', detail: '目前權限 catalog、角色設定與 user 前台能力沒有掃到明顯 drift。' }];
    return `<div class="permission-audit-section">
      <div class="permission-audit-section-title"><span>高風險異常與提醒</span><span class="permission-audit-section-meta">${issues.length} 項</span></div>
      <div class="permission-audit-list">${list.map(item => `
        <div class="permission-audit-issue">
          <span class="permission-audit-badge ${item.level === 'error' ? 'error' : item.level === 'warn' ? 'warn' : 'ok'}">${item.level === 'error' ? '異常' : item.level === 'warn' ? '提醒' : '正常'}</span>
          <div><div class="permission-audit-issue-title">${escapeHTML(item.title)}</div><div class="permission-audit-issue-detail">${escapeHTML(item.detail)}</div></div>
        </div>`).join('')}</div>
    </div>`;
  },

  _renderPermissionAuditMajorTable(report) {
    const headers = report.majorChecks.map(check => `<th>${escapeHTML(check.label)}</th>`).join('');
    const rows = report.roleRows.map(row => `
      <tr>
        <td><span class="role-level-badge" style="background:${escapeHTML(row.role.color)}">${escapeHTML(row.role.label)}</span><div class="permission-audit-code">${escapeHTML(row.role.key)}</div></td>
        <td>${row.storedExists ? '資料庫設定' : '系統預設'}</td>
        <td>${row.effectiveCount}</td>
        ${row.cells.map(cell => `<td><span class="permission-audit-badge ${cell.state ? 'ok' : 'neutral'}">${cell.state ? '有' : '無'}</span><div class="permission-audit-code">${escapeHTML(cell.source)}</div></td>`).join('')}
      </tr>`).join('');
    return `<div class="permission-audit-section">
      <div class="permission-audit-section-title"><span>主要權限矩陣</span><span class="permission-audit-section-meta">所有層級</span></div>
      <div class="permission-audit-scroll"><table class="permission-audit-table"><thead><tr><th>層級</th><th>來源</th><th>有效權限數</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  },

  _renderPermissionAuditCapabilityTable() {
    const items = typeof ROLE_ACTIVITY_CAPABILITY_ITEMS !== 'undefined' ? ROLE_ACTIVITY_CAPABILITY_ITEMS : [];
    const current = new Set((typeof ApiService !== 'undefined' && ApiService?.getRoleActivityCapabilities) ? ApiService.getRoleActivityCapabilities('user') : []);
    const rows = items.map(item => `<tr>
      <td>${escapeHTML(item.name || item.code)}<div class="permission-audit-code">${escapeHTML(item.code)}</div></td>
      <td><span class="permission-audit-badge ${item.defaultEnabled ? 'ok' : 'neutral'}">${item.defaultEnabled ? '預設開' : '預設關'}</span></td>
      <td><span class="permission-audit-badge ${current.has(item.code) ? 'ok' : 'neutral'}">${current.has(item.code) ? '目前開' : '目前關'}</span></td>
      <td>${escapeHTML(item.description || '')}</td>
    </tr>`).join('');
    return `<div class="permission-audit-section">
      <div class="permission-audit-section-title"><span>一般 user 前台活動能力</span><span class="permission-audit-section-meta">${items.length} 項</span></div>
      <div class="permission-audit-scroll"><table class="permission-audit-table"><thead><tr><th>能力</th><th>預設</th><th>目前</th><th>說明</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  },

  _renderPermissionAuditCatalogTable(report) {
    const rows = report.catalog.map(group => `<tr>
      <td>${escapeHTML(group.cat)}</td>
      <td>${group.items.length}</td>
      <td>${group.items.map(item => `<div>${escapeHTML(item.name)} <span class="permission-audit-code">${escapeHTML(item.code)}</span></div>`).join('')}</td>
    </tr>`).join('');
    return `<div class="permission-audit-section">
      <div class="permission-audit-section-title"><span>完整權限清單覆蓋</span><span class="permission-audit-section-meta">${report.summary.permissions} 個權限碼</span></div>
      <div class="permission-audit-scroll"><table class="permission-audit-table"><thead><tr><th>區塊</th><th>數量</th><th>權限項目</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  },

  _formatPermissionAuditText(report) {
    const lines = [
      'ToosterX 權限測試報告',
      `產生時間：${report.generatedAt.toLocaleString('zh-TW')}`,
      `前端版本：${report.version || '未知'}`,
      `摘要：層級 ${report.summary.roles}、權限碼 ${report.summary.permissions}、user 前台能力 ${report.summary.capabilities}、警告 ${report.summary.warnings}、異常 ${report.summary.errors}`,
      '',
      '高風險異常與提醒：',
      ...(report.issues.length ? report.issues.map((item, i) => `${i + 1}. [${item.level}] ${item.title}｜${item.detail}`) : ['未發現高風險異常']),
      '',
      '主要權限矩陣：',
      ...report.roleRows.map(row => `${row.role.label} (${row.role.key})：有效權限 ${row.effectiveCount}，來源 ${row.storedExists ? '資料庫設定' : '系統預設'}`),
      '',
      '備註：此頁檢查目前資料庫權限設定與前端權限 catalog；Firestore Rules 與 Cloud Functions 仍需搭配 npm run test:rules 與相關 unit tests 驗證。',
    ];
    return lines.join('\n');
  },
});
