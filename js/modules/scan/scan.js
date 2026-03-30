/* ================================================
   SportHub — Scan Check-in / Check-out Module
   Core page init and state — glue file.
   Split into: scan-ui.js, scan-camera.js, scan-process.js
   Note: innerHTML here uses static safe strings only.
   ================================================ */

Object.assign(App, {

  _scanSelectedEventId: null,
  _scanPresetEventId: null,
  _scanMode: 'checkin',
  _scanDateFilter: 'today',
  _scanEventBuckets: null,
  _scannerInstance: null,
  _lastScannedUid: null,
  _lastScanTime: 0,

  // ══════════════════════════════════
  //  Render scan page
  // ══════════════════════════════════

  renderScanPage() {
    if (!this.hasPermission('event.scan') && !this.hasPermission('activity.manage.entry')) { this.showToast('權限不足'); return; }
    const select = document.getElementById('scan-event-select');
    if (!select) return;

    // Populate event options
    const isAdmin = this.hasPermission('event.edit_all');
    let events = ApiService.getEvents().filter(e =>
      e.status === 'open' || e.status === 'full' || e.status === 'ended'
    );
    if (!isAdmin) {
      events = events.filter(e => this._isEventOwner(e) || this._isEventDelegate(e));
    }

    const filterContainer = document.getElementById('scan-date-filter');

    // ── 預設活動模式：從活動詳情頁帶入 ──
    if (this._scanPresetEventId) {
      if (filterContainer) filterContainer.style.display = 'none';
      const presetId = this._scanPresetEventId;
      this._scanPresetEventId = null;
      const presetEvent = ApiService.getEvent(presetId);
      select.innerHTML = '<option value="">— 請選擇活動 —</option>';
      if (presetEvent) {
        const typeLabel = this._getScanEventTypeLabel(presetEvent);
        const opt = document.createElement('option');
        opt.value = presetId;
        opt.textContent = `${typeLabel}${presetEvent.title}（${presetEvent.date}）`;
        select.appendChild(opt);
        select.value = presetId;
        this._scanSelectedEventId = presetId;
        select.disabled = true;
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
