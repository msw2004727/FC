/* ================================================
   SportHub — Scan Check-in / Check-out Module
   Core page init and state — glue file.
   Split into: scan-ui.js, scan-camera.js, scan-process.js
   Note: innerHTML here uses static safe strings only.
   ================================================ */

Object.assign(App, {

  _scanSelectedEventId: null,
  _scanPresetEventId: null,
  _scanPresetEventRecord: null,
  _scanSelectedEventRecord: null,
  _scanMode: 'checkin',
  _scanDateFilter: 'today',
  _scanEventBuckets: null,
  _scannerInstance: null,
  _lastScannedUid: null,
  _lastScanTime: 0,

  // ══════════════════════════════════
  //  Render scan page
  // ══════════════════════════════════

  _getScanSelectedEvent() {
    if (!this._scanSelectedEventId) return null;
    const event = ApiService.getEvent?.(this._scanSelectedEventId);
    if (event) return event;
    const record = this._scanSelectedEventRecord;
    const recordId = this._getScanEventValue(record);
    return recordId && recordId === String(this._scanSelectedEventId || '').trim() ? record : null;
  },

  _getScanEventValue(e) {
    return e ? String(e.id || e._docId || e.docId || '').trim() : '';
  },

  renderScanPage() {
    if (!this.hasPermission('event.scan') && !this.hasPermission('activity.manage.entry') && !this._isAnyActiveEventOperator?.()) { this.showToast('權限不足'); return; }
    const select = document.getElementById('scan-event-select');
    if (!select) return;

    // Populate event options
    let events = ApiService.getEvents().filter(e =>
      e.status === 'open' || e.status === 'full' || e.status === 'ended'
    );
    events = events.filter(e => this._canOperateEventSite?.(e) === true);

    const filterContainer = document.getElementById('scan-date-filter');

    // ── 預設活動模式：從活動詳情頁帶入 ──
    if (this._scanPresetEventId) {
      if (filterContainer) filterContainer.style.display = 'none';
      const presetId = this._scanPresetEventId;
      const presetEvent = this._scanPresetEventRecord || ApiService.getEvent(presetId);
      this._scanPresetEventId = null;
      this._scanPresetEventRecord = null;
      select.innerHTML = '<option value="">— 請選擇活動 —</option>';
      if (presetEvent && this._canOperateEventSite?.(presetEvent) === true) {
        const selectedId = this._getScanEventValue(presetEvent) || presetId;
        const typeLabel = this._getScanEventTypeLabel(presetEvent);
        const opt = document.createElement('option');
        opt.value = selectedId;
        opt.textContent = `${typeLabel}${presetEvent.title}（${presetEvent.date}）`;
        select.appendChild(opt);
        select.value = selectedId;
        this._scanSelectedEventId = selectedId;
        this._scanSelectedEventRecord = presetEvent;
        select.disabled = true;
      } else {
        this._scanSelectedEventId = null;
        this._scanSelectedEventRecord = null;
        this.showToast('權限不足');
        return;
      }
    } else {
      select.disabled = false;
      if (filterContainer) filterContainer.style.display = '';

      // Categorize events into buckets
      this._scanEventBuckets = this._categorizeScanEvents(events);

      // Update tab counts
      this._updateScanDateTabCounts();

      // If current tab is empty, auto-switch to first non-empty
      const buckets = this._scanEventBuckets;
      if (buckets[this._scanDateFilter].length === 0) {
        const order = ['today', 'past', 'future'];
        const found = order.find(k => buckets[k].length > 0);
        this._scanDateFilter = found || 'today';
      }

      // Update active tab UI
      if (filterContainer) {
        filterContainer.querySelectorAll('.scan-date-tab').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.scanDate === this._scanDateFilter);
        });
      }

      // Populate select with current tab's events
      this._populateScanSelect();
    }

    this._updateScanControls();
    this._renderScanResults();
    this._renderAttendanceSections();
    this._bindScanEvents();
  },

});
