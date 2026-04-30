/* ================================================
   SportHub - User Admin: UID Health Diagnostic Copy

   功能：
   - 將最後一次 UID 健康檢查報表打包成可貼上的純文字
   - 只包含摘要、分類、筆數與樣本路徑，不匯出完整資料庫
   ================================================ */

Object.assign(App, {
  _formatUidHealthDiagnosticSample(sample) {
    if (!sample || typeof sample !== 'object') return '';
    const preferredKeys = ['path', 'eventId', 'field', 'value', 'name', 'uid', 'userId', 'teamId', 'role', 'checkedByRole'];
    const labels = {
      path: 'path',
      eventId: 'eventId',
      field: '欄位',
      value: '值',
      name: '名稱',
      uid: 'uid',
      userId: 'userId',
      teamId: 'teamId',
      role: 'role',
      checkedByRole: '檢查角色',
    };
    const parts = preferredKeys
      .filter((key) => sample[key] !== undefined && sample[key] !== null && String(sample[key]).trim() !== '')
      .map((key) => labels[key] + '=' + String(sample[key]).trim());
    if (parts.length) return parts.join('｜');
    try {
      return JSON.stringify(sample).slice(0, 500);
    } catch (_) {
      return String(sample);
    }
  },

  _buildUidHealthDiagnosticText(report) {
    const safeReport = report && typeof report === 'object' ? report : {};
    const sections = Array.isArray(safeReport.sections) ? safeReport.sections : [];
    const status = String(safeReport.status || 'unknown');
    const checkedAt = this._formatSyncConfigLogTime(safeReport.checkedAtMs || safeReport.checkedAt || safeReport.uidHealthLastCheckedAt);
    const generatedAt = new Date().toLocaleString('zh-TW', { hour12: false });
    const lines = [
      'ToosterX UID 健康檢查診斷包',
      '產生時間：' + generatedAt,
      '最近檢查：' + (checkedAt || '--'),
      '狀態：' + this._getUidHealthStatusLabel(status) + ' (' + status + ')',
      '摘要：' + (safeReport.summary || '無'),
      '掃描文件：' + (Number(safeReport.scannedDocs || 0) || 0).toLocaleString(),
      '估計讀取：' + (Number(safeReport.estimatedReads || 0) || 0).toLocaleString(),
      '嚴重：' + (Number(safeReport.errors || 0) || 0).toLocaleString(),
      '警告：' + (Number(safeReport.warnings || 0) || 0).toLocaleString(),
      '資料修改：' + (Number(safeReport.dataChanges || 0) || 0).toLocaleString(),
      '檢查者：' + (safeReport.checkedByUid || '未標示') + ' / ' + (safeReport.checkedByRole || '未標示'),
      '',
      '說明：此診斷包只包含 UID 健康檢查摘要、異常分類與少量樣本路徑，不包含完整資料庫內容。',
      '',
      '區塊明細：',
    ];

    if (!sections.length) {
      lines.push('- 無區塊明細');
      return lines.join('\n');
    }

    sections.forEach((section, sectionIndex) => {
      const issues = Array.isArray(section.issues) ? section.issues : [];
      lines.push('');
      lines.push((sectionIndex + 1) + '. ' + (section.title || section.key || '未命名區塊')
        + '｜狀態：' + this._getUidHealthStatusLabel(section.status)
        + '｜檢查筆數：' + (Number(section.checked || 0) || 0).toLocaleString());
      if (!issues.length) {
        lines.push('   - 未發現異常');
        return;
      }
      issues.forEach((issue, issueIndex) => {
        const severity = issue.severity === 'error' ? '嚴重' : '警告';
        lines.push('   ' + (issueIndex + 1) + '. [' + severity + '] '
          + (issue.message || issue.type || '異常')
          + '｜筆數：' + (Number(issue.count || 0) || 0).toLocaleString()
          + (issue.type ? '｜類型：' + issue.type : ''));
        const samples = Array.isArray(issue.samples) ? issue.samples : [];
        if (!samples.length) return;
        samples.forEach((sample, sampleIndex) => {
          const sampleText = this._formatUidHealthDiagnosticSample(sample);
          if (sampleText) lines.push('      樣本 ' + (sampleIndex + 1) + '：' + sampleText);
        });
      });
    });
    return lines.join('\n');
  },

  async _copyUidHealthText(text) {
    if (!text) return false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  },

  async copyUidHealthDiagnosticPackage() {
    const report = await this._loadUidHealthLastReport();
    if (!report) {
      this.showToast?.('尚無 UID 健康檢查報表');
      return;
    }
    const text = this._buildUidHealthDiagnosticText(report);
    try {
      const ok = await this._copyUidHealthText(text);
      if (!ok) throw new Error('clipboard unavailable');
      this.showToast?.('已複製 UID 診斷包');
    } catch (err) {
      console.error('[copyUidHealthDiagnosticPackage]', err);
      this.showToast?.('複製失敗，請開啟報表後手動複製');
    }
  },
});
