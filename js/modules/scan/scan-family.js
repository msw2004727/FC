/* ================================================
   SportHub — Scan: Family Checkin Modal
   Split from scan-process.js — pure move, no logic changes
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   ================================================ */

Object.assign(App, {

  _familyScanUid: null,
  _familyScanUserName: null,
  _familyScanMode: null,

  _showFamilyCheckinMenu(uid, userName, regs, mode) {
    const eventId = this._scanSelectedEventId;
    const records = ApiService.getAttendanceRecords(eventId);
    const modeLabel = mode === 'checkin' ? '簽到' : '簽退';

    this._familyScanUid = uid;
    this._familyScanUserName = userName;
    this._familyScanMode = mode;

    const titleEl = document.getElementById('scan-family-title');
    const listEl = document.getElementById('scan-family-list');
    const confirmBtn = document.getElementById('scan-family-confirm-btn');
    if (!titleEl || !listEl) return;

    titleEl.textContent = `\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67 家庭${modeLabel}（${userName}）`;
    if (confirmBtn) confirmBtn.textContent = `確認${modeLabel}`;

    const rows = regs.map(r => {
      const displayName = r.companionName || r.userName;
      const cId = r.companionId || null;
      const hasCheckin = records.some(a => a.uid === uid && a.type === 'checkin' && (a.companionId || null) === cId);
      const hasCheckout = records.some(a => a.uid === uid && a.type === 'checkout' && (a.companionId || null) === cId);
      const statusLabel = hasCheckout ? '\u2705 已簽退' : hasCheckin ? '\uD83D\uDCCD 已簽到' : '\u2014';
      const disabled = (mode === 'checkin' && hasCheckin) || (mode === 'checkout' && hasCheckout);
      // Safe: escapeHTML sanitizes all user content before insertion
      return `<label style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="family-scan" data-companion-id="${escapeHTML(cId || '')}" data-name="${escapeHTML(displayName)}" ${!disabled ? 'checked' : 'disabled'} style="width:15px;height:15px">
        <span style="flex:1;font-size:.82rem">${escapeHTML(displayName)}${!cId ? '（本人）' : ''}</span>
        <span style="font-size:.68rem;color:var(--text-muted)">${statusLabel}</span>
      </label>`;
    }).join('');
    listEl.innerHTML = rows; // Safe: all values escaped above

    document.getElementById('scan-family-modal').classList.add('open');
  },

  _closeFamilyModal() {
    const modal = document.getElementById('scan-family-modal');
    if (modal) modal.classList.remove('open');
    this._familyScanUid = null;
    this._familyScanUserName = null;
    this._familyScanMode = null;
  },

  async _confirmFamilyCheckin() {
    const uid = this._familyScanUid;
    const userName = this._familyScanUserName;
    const mode = this._familyScanMode;
    if (!uid || !mode) return;

    const checked = [...document.querySelectorAll('#scan-family-list input[name="family-scan"]:not([disabled]):checked')];
    if (checked.length === 0) { this.showToast('請選擇要處理的成員'); return; }
    const eventId = this._scanSelectedEventId;
    const records = ApiService.getAttendanceRecords(eventId);
    const now = new Date();
    const timeStr = App._formatDateTime(now);
    const modeLabel = mode === 'checkin' ? '簽到' : '簽退';

    const _addRecord = (rec) => {
      ApiService.addAttendanceRecord(rec).catch(err => {
        console.error('[Scan] family attendance write failed:', err);
        this.showToast(`寫入失敗：${err?.message || '請確認登入狀態與網路'}`);
        ApiService._writeErrorLog({
          fn: '_confirmFamilyCheckin.addAttendanceRecord',
          eventId: rec?.eventId || eventId,
          uid: rec?.uid || uid,
          companionId: rec?.companionId || '',
          type: rec?.type || '',
          mode,
        }, err);
        this._renderScanResults();
        this._renderAttendanceSections();
      });
    };

    for (const cb of checked) {
      const cId = cb.dataset.companionId || null;
      const displayName = cb.dataset.name;
      const hasCheckin = records.some(r => r.uid === uid && r.type === 'checkin' && (r.companionId || null) === cId);
      const hasCheckout = records.some(r => r.uid === uid && r.type === 'checkout' && (r.companionId || null) === cId);
      if (mode === 'checkin' && !hasCheckin) {
        _addRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId, uid, userName,
          participantType: cId ? 'companion' : 'self',
          companionId: cId || null,
          companionName: cId ? displayName : null,
          type: 'checkin', time: timeStr,
        });
      } else if (mode === 'checkout' && !hasCheckout) {
        if (!hasCheckin) {
          _addRecord({
            id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            eventId, uid, userName,
            participantType: cId ? 'companion' : 'self',
            companionId: cId || null,
            companionName: cId ? displayName : null,
            type: 'checkin', time: timeStr,
          });
        }
        _addRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId, uid, userName,
          participantType: cId ? 'companion' : 'self',
          companionId: cId || null,
          companionName: cId ? displayName : null,
          type: 'checkout', time: timeStr,
        });
        if (!cId) {
          const _evt = ApiService.getEvent(eventId);
          this._grantAutoExp?.(uid, 'complete_activity', _evt?.title || '');
        }
      }
    }

    this._closeFamilyModal();

    this._renderScanResults();
    this._renderAttendanceSections();
    this._showScanResultPopup('success', `${userName} 等 ${checked.length} 人${modeLabel}成功`, userName);

  },

});
