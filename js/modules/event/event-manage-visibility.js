/* === SportHub — Attendance edit-mode auto-exit on visibility hidden ===
   離開瀏覽器 / 切背景 ≥ 3 秒後自動退出編輯模式，
   避免編輯中場被遺忘 + 消除「勾選消失」bug（回前景時編輯狀態重繪用舊快取）。

   設計依據（2026-04-25 深度審計）：
   1. 用 hidden 記時間 + visible 判斷，避免 setTimeout 在背景被 suspend、
      回前景瞬間補 fire 造成的瞬退問題（Chrome / iOS / LINE WebView 行為不一致）。
   2. hidden 時立刻 flush pending debounce，避免 300ms timer 被 WebView 凍結丟資料。
   3. 提交中（_confirmAllAttendance 執行中）不退出編輯，避免打亂原子寫入流程。
   4. pagehide 兜底：iOS / LINE WebView 有時直接 pagehide 而不經過 hidden（CLAUDE.md L2865）。
   5. 退出後同步重繪表格，避免 UI 停留在編輯樣式但內部狀態已清的不一致。
   6. 重用 event-manage.js 的 _autoExitDetailEdits（2026-04-23 切頁情境既有 helper），
      確保正取 / 未報名 / 候補三種編輯狀態一致處理。

   依賴：event-manage.js (_autoExitDetailEdits)、event-manage-attendance.js (render)
   ============================================ */

(function () {
  var IDLE_EXIT_MS = 3000;
  var _editHiddenAt = 0;

  function _hasEditingMode() {
    return !!(App._attendanceEditingEventId
      || App._unregEditingEventId
      || App._waitlistEditingEventId);
  }

  function _isSubmitting() {
    return !!(App._attendanceSubmittingEventId || App._unregSubmittingEventId);
  }

  function _flushPendingSaves() {
    try {
      if (App._attendanceEditingEventId && typeof App._flushInstantSaves === 'function') {
        var aP = App._flushInstantSaves(App._attendanceEditingEventId);
        if (aP && typeof aP.catch === 'function') aP.catch(function () {});
      }
      if (App._unregEditingEventId && typeof App._flushUnregInstantSaves === 'function') {
        var uP = App._flushUnregInstantSaves(App._unregEditingEventId);
        if (uP && typeof uP.catch === 'function') uP.catch(function () {});
      }
    } catch (err) {
      console.warn('[edit-visibility] flush failed:', err);
    }
  }

  function _exitEditIfIdle() {
    if (_isSubmitting()) return;
    if (!_hasEditingMode()) return;

    var eid = App._currentDetailEventId;
    var wasAttendanceEditing = !!App._attendanceEditingEventId;
    var wasUnregEditing = !!App._unregEditingEventId;

    if (typeof App._autoExitDetailEdits === 'function') {
      try { App._autoExitDetailEdits(); }
      catch (err) { console.warn('[edit-visibility] autoExit failed:', err); }
    }

    if (eid && App.currentPage === 'page-activity-detail') {
      if (wasAttendanceEditing && typeof App._renderAttendanceTable === 'function') {
        App._renderAttendanceTable(eid, 'detail-attendance-table');
      }
      if (wasUnregEditing && typeof App._renderUnregTable === 'function') {
        App._renderUnregTable(eid, 'detail-unreg-table');
      }
    }

    if (typeof App.showToast === 'function') {
      App.showToast('離開過久，已自動退出編輯模式');
    }
  }

  function _onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      if (!_hasEditingMode() || _isSubmitting()) return;
      _flushPendingSaves();
      _editHiddenAt = Date.now();
    } else if (document.visibilityState === 'visible') {
      if (_editHiddenAt && Date.now() - _editHiddenAt >= IDLE_EXIT_MS) {
        _exitEditIfIdle();
      }
      _editHiddenAt = 0;
    }
  }

  function _onPageHide() {
    if (_hasEditingMode()) _flushPendingSaves();
  }

  document.addEventListener('visibilitychange', _onVisibilityChange);
  window.addEventListener('pagehide', _onPageHide);
})();
