# Codex Implementation Spec — 3 Tasks (2026-02-22)

> **Project:** SportHub (FC-github)
> **Tech:** Vanilla JS (ES6+), no build, no npm. All modules extend `App` via `Object.assign`.
> **Cache rule:** After modifying ANY JS/HTML file, update `CACHE_VERSION` in `js/config.js` AND all `?v=` params in `index.html` (approx 40 occurrences). Format: `YYYYMMDD` + suffix `a`, `b`, `c`… Current: `20260222b` → next: `20260222c`.

---

## Task 1: Simplify Activity Datetime to Single-Row Field

### Current State
File `pages/activity.html` lines 119-126 currently has TWO `<input type="datetime-local">` inputs (start/end) requiring the user to pick the date twice. The stored format is `YYYY/MM/DD HH:mm~HH:mm` (e.g. `2026/03/01 14:00~16:00`).

### Goal
Replace the two datetime-local inputs with **one date + two time inputs** in a single row, so the user picks the date **once** and only selects start/end **times**. This looks like a single "field" visually: `[date] [start time] ~ [end time]`.

**Storage format stays the same:** `YYYY/MM/DD HH:mm~HH:mm`

### Changes Required

#### 1.1 `pages/activity.html` (~line 119-126)

**Delete** the current block:
```html
<div class="ce-row">
  <label>活動時間 <span class="required">*必填</span></label>
  <div style="display:flex;gap:.3rem;align-items:center">
    <input type="datetime-local" id="ce-datetime-start" style="flex:1">
    <span style="font-size:.82rem;color:var(--text-muted)">~</span>
    <input type="datetime-local" id="ce-datetime-end" style="flex:1">
  </div>
</div>
```

**Replace** with:
```html
<div class="ce-row">
  <label>活動時間 <span class="required">*必填</span></label>
  <div style="display:flex;gap:.3rem;align-items:center">
    <input type="date" id="ce-date" style="flex:1.2">
    <input type="time" id="ce-time-start" style="flex:1" step="1800">
    <span style="font-size:.82rem;color:var(--text-muted)">~</span>
    <input type="time" id="ce-time-end" style="flex:1" step="1800">
  </div>
</div>
```

Key: `step="1800"` = 30-minute increments (optional, for mobile UX).

#### 1.2 `js/modules/event-create.js` — 7 locations

All current references use `ce-datetime-start` and `ce-datetime-end`. Change them to `ce-date`, `ce-time-start`, `ce-time-end`.

| # | Function | ~Line | What to change |
|---|----------|-------|----------------|
| 1 | `_saveEventTemplate` | ~149-150 | Read `ce-date`, `ce-time-start`, `ce-time-end` → save as `date`, `timeStart`, `timeEnd` |
| 2 | `_loadEventTemplate` | ~187-188 | Write `ce-date`, `ce-time-start`, `ce-time-end` from template |
| 3 | `openCreateEventModal` | ~240-241 | Reset: `ce-date` = `''`, `ce-time-start` = `'14:00'`, `ce-time-end` = `'16:00'` |
| 4 | `handleCreateEvent` read | ~442-445 | Read `ce-date` → `dateVal`, `ce-time-start` + `ce-time-end` → `timeVal` = `start~end` |
| 5 | `handleCreateEvent` validate | ~457-462 | Check `dateVal` and both times are set; validate date not in past (new mode); validate end > start |
| 6 | `handleCreateEvent` fullDate | ~485 | Assemble: `dateVal.replace(/-/g, '/') + ' ' + timeVal` |
| 7 | `handleCreateEvent` reset | ~599-600 | Reset: `ce-date` = `''`, `ce-time-start` = `'14:00'`, `ce-time-end` = `'16:00'` |

**Detail for location 1** (`_saveEventTemplate`, ~line 143-155):
```javascript
// BEFORE (current):
datetimeStart: document.getElementById('ce-datetime-start')?.value || '',
datetimeEnd: document.getElementById('ce-datetime-end')?.value || '',

// AFTER:
date: document.getElementById('ce-date')?.value || '',
timeStart: document.getElementById('ce-time-start')?.value || '14:00',
timeEnd: document.getElementById('ce-time-end')?.value || '16:00',
```

**Detail for location 2** (`_loadEventTemplate`, ~line 187-188):
```javascript
// BEFORE:
setVal('ce-datetime-start', tpl.datetimeStart);
setVal('ce-datetime-end', tpl.datetimeEnd);

// AFTER:
setVal('ce-date', tpl.date);
setVal('ce-time-start', tpl.timeStart);
setVal('ce-time-end', tpl.timeEnd);
```

**Detail for location 3** (`openCreateEventModal`, ~line 240-241):
```javascript
// BEFORE:
document.getElementById('ce-datetime-start').value = '';
document.getElementById('ce-datetime-end').value = '';

// AFTER:
document.getElementById('ce-date').value = '';
document.getElementById('ce-time-start').value = '14:00';
document.getElementById('ce-time-end').value = '16:00';
```

**Detail for location 4** (`handleCreateEvent` read values, ~line 442-445):
```javascript
// BEFORE:
const dtStartVal = document.getElementById('ce-datetime-start').value;
const dtEndVal = document.getElementById('ce-datetime-end').value;
const dateVal = dtStartVal ? dtStartVal.split('T')[0] : '';
const timeVal = (dtStartVal && dtEndVal) ? `${dtStartVal.split('T')[1]}~${dtEndVal.split('T')[1]}` : '';

// AFTER:
const dateVal = document.getElementById('ce-date').value;
const tStart = document.getElementById('ce-time-start').value;
const tEnd = document.getElementById('ce-time-end').value;
const timeVal = (tStart && tEnd) ? `${tStart}~${tEnd}` : '';
```

**Detail for location 5** (`handleCreateEvent` validation, ~line 457-462):
```javascript
// BEFORE:
if (!dtStartVal || !dtEndVal) { this.showToast('請選擇活動開始與結束時間'); return; }
if (!this._editEventId) {
  if (new Date(dtStartVal) < new Date()) { this.showToast('活動開始時間不可早於現在'); return; }
}
if (new Date(dtEndVal) <= new Date(dtStartVal)) { this.showToast('結束時間必須晚於開始時間'); return; }

// AFTER:
if (!dateVal) { this.showToast('請選擇日期'); return; }
if (!tStart || !tEnd) { this.showToast('請選擇開始與結束時間'); return; }
if (!this._editEventId) {
  const startDt = new Date(`${dateVal}T${tStart}`);
  if (startDt < new Date()) { this.showToast('活動開始時間不可早於現在'); return; }
}
if (tEnd <= tStart) { this.showToast('結束時間必須晚於開始時間'); return; }
```

**Detail for location 6** (`handleCreateEvent` fullDate assembly, ~line 485):
```javascript
// BEFORE:
const fullDate = `${dateVal.replace(/-/g, '/')} ${timeVal}`;

// AFTER (same logic, no change needed — dateVal is already YYYY-MM-DD from <input type="date">):
const fullDate = `${dateVal.replace(/-/g, '/')} ${timeVal}`;
```

**Detail for location 7** (`handleCreateEvent` reset, ~line 599-600):
```javascript
// BEFORE:
document.getElementById('ce-datetime-start').value = '';
document.getElementById('ce-datetime-end').value = '';

// AFTER:
document.getElementById('ce-date').value = '';
document.getElementById('ce-time-start').value = '14:00';
document.getElementById('ce-time-end').value = '16:00';
```

#### 1.3 `js/modules/event-manage.js` (~line 258-269)

`editMyActivity` needs to parse stored format back to the three fields.

```javascript
// BEFORE (current):
const dateTime = (e.date || '').split(' ');
const dateParts = (dateTime[0] || '').split('/');
const timeStr = dateTime[1] || '';
const timeParts = timeStr.split('~');
if (dateParts.length === 3) {
  const isoDate = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
  const dtStart = document.getElementById('ce-datetime-start');
  const dtEnd = document.getElementById('ce-datetime-end');
  if (dtStart) dtStart.value = `${isoDate}T${timeParts[0] || '14:00'}`;
  if (dtEnd) dtEnd.value = `${isoDate}T${timeParts[1] || '16:00'}`;
}

// AFTER:
const dateTime = (e.date || '').split(' ');
const dateParts = (dateTime[0] || '').split('/');
const timeStr = dateTime[1] || '';
const timeParts = timeStr.split('~');
if (dateParts.length === 3) {
  document.getElementById('ce-date').value = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
}
const ceTS = document.getElementById('ce-time-start');
const ceTE = document.getElementById('ce-time-end');
if (ceTS) ceTS.value = timeParts[0] || '14:00';
if (ceTE) ceTE.value = timeParts[1] || '16:00';
```

### Acceptance Criteria — Task 1

| # | Test | Expected |
|---|------|----------|
| T1-1 | Open "新增活動" modal | See ONE date field + TWO time fields (start ~ end) in a single row |
| T1-2 | Select date 2026/03/15, time 18:00~20:00, create event | Event list shows `2026/03/15 18:00~20:00` |
| T1-3 | Edit existing event | Date field pre-filled with correct date, time fields pre-filled with correct start/end |
| T1-4 | Save template → Load template | Date and times correctly restored |
| T1-5 | New mode: select past date | Toast: "活動開始時間不可早於現在" |
| T1-6 | Select end time earlier than start | Toast: "結束時間必須晚於開始時間" |
| T1-7 | Stored format check | `ApiService.getEvents()` returns `date` field as `"YYYY/MM/DD HH:mm~HH:mm"` |
| T1-8 | No references to `ce-datetime-start` or `ce-datetime-end` remain in codebase | `grep -r "ce-datetime" .` returns 0 matches |

---

## Task 2: Fix Deleted Activities Reappearing After Refresh

### Root Cause

When an activity is deleted:
1. `ApiService.deleteEvent(id)` removes it from the in-memory `_cache.events` array ✅
2. `FirebaseService.deleteEvent(id)` deletes the Firestore document ✅
3. **BUG:** `localStorage` cache (`shub_c_events`) is NOT updated after deletion ❌

On browser refresh within 30 minutes (`_LS_TTL`), `_restoreCache()` loads the stale localStorage (which still contains the deleted event), and the deleted event reappears.

### Files Involved

| File | Role |
|------|------|
| `js/api-service.js` (~line 52-62) | `_delete()` — removes from in-memory cache but does NOT persist to localStorage |
| `js/firebase-service.js` (~line 84-91) | `_saveToLS()` — saves a collection to localStorage |
| `js/firebase-service.js` (~line 120-144) | `_restoreCache()` — restores from localStorage on refresh |
| `js/firebase-service.js` (~line 254-275) | `onSnapshot` for events — only watches `open/full/upcoming`, ignores deleted docs |

### Fix

**In `js/api-service.js`, modify `_delete()` method** (~line 52-62):

```javascript
// BEFORE:
_delete(key, id, firebaseMethod, label) {
  const source = this._src(key);
  if (!this._demoMode && firebaseMethod) {
    firebaseMethod.call(FirebaseService, id).catch(err => console.error(`[${label}]`, err));
  }
  const idx = source.findIndex(item => item.id === id);
  if (idx >= 0) source.splice(idx, 1);
  return true;
},

// AFTER:
_delete(key, id, firebaseMethod, label) {
  const source = this._src(key);
  if (!this._demoMode && firebaseMethod) {
    firebaseMethod.call(FirebaseService, id).catch(err => console.error(`[${label}]`, err));
  }
  const idx = source.findIndex(item => item.id === id);
  if (idx >= 0) source.splice(idx, 1);
  // Persist updated cache to localStorage so deleted items don't reappear on refresh
  if (!this._demoMode) {
    FirebaseService._saveToLS(key, source);
  }
  return true;
},
```

This is a **one-line addition**. It calls `_saveToLS()` immediately after `splice()`, so localStorage always reflects the deletion.

### Why This Is Sufficient

- `_saveToLS` is a public method on `FirebaseService` (line 84).
- The `onSnapshot` listener for events (line 254) will eventually overwrite localStorage with fresh Firestore data, but in the gap between deletion and next snapshot, our localStorage is now correct.
- This fix also applies to any other collection deleted via `_delete()` (tournaments, teams, etc.), preventing the same class of bug everywhere.

### Acceptance Criteria — Task 2

| # | Test | Expected |
|---|------|----------|
| T2-1 | Delete an activity → immediately refresh browser (F5) | Deleted activity does NOT reappear |
| T2-2 | Delete an activity → close browser → reopen within 30min | Deleted activity does NOT reappear |
| T2-3 | Delete an activity → check `localStorage.getItem('shub_c_events')` | The deleted event's id is NOT in the JSON string |
| T2-4 | Delete a tournament → refresh browser | Deleted tournament does NOT reappear (same fix applies) |
| T2-5 | Normal event CRUD still works | Create, edit, list events all function correctly after the fix |

---

## Task 3: Add "Clear All Data" Button in Operation Log Page

### Goal

Add a button in the top-right of the operation log page header (`page-admin-logs`) that clears **all Firestore collections except `users`**. Requires a 4-digit password (`1121`) before executing.

### Files Involved

| File | Action |
|------|--------|
| `pages/admin-system.html` (~line 190-195) | Add button to page header |
| `js/modules/dashboard.js` (or new file) | Add `clearAllData()` method |
| `js/firebase-crud.js` | Add `clearCollection(name)` helper |

### 3.1 `pages/admin-system.html` — Add button (~line 192)

Find:
```html
<section class="page" id="page-admin-logs" data-min-role="super_admin">
  <div class="page-header">
    <button class="back-btn" onclick="App.goBack()">←</button>
    <h2>操作日誌</h2>
  </div>
```

Replace with:
```html
<section class="page" id="page-admin-logs" data-min-role="super_admin">
  <div class="page-header">
    <button class="back-btn" onclick="App.goBack()">←</button>
    <h2>操作日誌</h2>
    <button class="header-action-btn" onclick="App.clearAllData()" style="margin-left:auto;font-size:.72rem;padding:.3rem .7rem;background:#dc2626;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-weight:600">一鍵清除</button>
  </div>
```

### 3.2 `js/firebase-crud.js` — Add `clearCollection()` helper

Add this method to `FirebaseService` (append before the closing `});`):

```javascript
/**
 * Clear all documents in a Firestore collection.
 * Uses batch writes (max 450 per batch to stay under Firestore's 500 limit).
 */
async clearCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  if (snapshot.empty) return 0;
  const docs = snapshot.docs;
  // Process in chunks of 450
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + 450);
    chunk.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  return docs.length;
},
```

### 3.3 `js/modules/dashboard.js` — Add `clearAllData()` method

Add this method to the `App` object (via `Object.assign`):

```javascript
async clearAllData() {
  // Step 1: Password prompt
  const pwd = prompt('請輸入四位數密碼以執行清除：');
  if (pwd !== '1121') {
    this.showToast('密碼錯誤');
    return;
  }

  // Step 2: Confirmation
  if (!(await this.appConfirm('確定要清除所有資料（用戶資料除外）？此操作無法復原！'))) return;

  // Step 3: Show loading
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = '';

  try {
    if (ModeManager.isDemo()) {
      // Demo mode: clear in-memory arrays
      const keys = Object.keys(DemoData).filter(k => k !== 'users' && Array.isArray(DemoData[k]));
      keys.forEach(k => { DemoData[k].length = 0; });
    } else {
      // Production: clear Firestore collections (except users)
      const collections = [
        'events', 'tournaments', 'teams', 'registrations',
        'attendanceRecords', 'activityRecords', 'matches', 'standings',
        'operationLogs', 'expLogs', 'teamExpLogs',
        'announcements', 'banners', 'floatingAds', 'popupAds', 'sponsors',
        'siteThemes', 'shopItems', 'achievements', 'badges', 'leaderboard',
        'messages', 'adminMessages', 'notifTemplates',
        'permissions', 'customRoles', 'rolePermissions', 'trades',
      ];
      for (const name of collections) {
        await FirebaseService.clearCollection(name);
      }
      // Clear corresponding cache arrays
      collections.forEach(name => {
        const cacheKey = name === 'users' ? 'adminUsers' : name;
        if (Array.isArray(FirebaseService._cache[cacheKey])) {
          FirebaseService._cache[cacheKey].length = 0;
          FirebaseService._saveToLS(cacheKey, []);
        }
      });
    }

    // Step 4: Log the action (write to opLog AFTER clearing, so this is the first entry)
    ApiService._writeOpLog('system_clear', '系統清除', '一鍵清除所有資料（用戶除外）');

    // Step 5: Re-render
    this.renderAll?.();
    this.showToast('所有資料已清除（用戶資料保留）');
  } catch (err) {
    console.error('[clearAllData]', err);
    this.showToast('清除過程發生錯誤：' + err.message);
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
},
```

### 3.4 `pages/admin-system.html` — Add operation type option for filter

In the `<select id="oplog-type-filter">` dropdown (~line 230), add inside the appropriate `<optgroup>`:

```html
<option value="system_clear">系統清除</option>
```

### Acceptance Criteria — Task 3

| # | Test | Expected |
|---|------|----------|
| T3-1 | Navigate to 操作日誌 page | Red "一鍵清除" button visible in page header, top-right |
| T3-2 | Click button → enter wrong password `0000` | Toast: "密碼錯誤"; no data deleted |
| T3-3 | Click button → enter correct password `1121` → Cancel confirm | No data deleted |
| T3-4 | Click button → enter `1121` → Confirm | All collections cleared except `users`; toast shown |
| T3-5 | After clearing → check events list | Empty (no events) |
| T3-6 | After clearing → check operation log | Exactly 1 entry: "系統清除 — 一鍵清除所有資料（用戶除外）" |
| T3-7 | After clearing → check user list | All users still present and intact |
| T3-8 | After clearing → refresh browser | Data remains cleared (not restored from cache) |
| T3-9 | `data-min-role="super_admin"` on the page | Only super_admin can access the page/button |

---

## Cache Version Update (ALL TASKS)

After all three tasks are completed:

1. `js/config.js` line 7: change `CACHE_VERSION` from `'20260222b'` to the appropriate next version
2. `index.html`: replace ALL `?v=20260222b` with the new version (approx 40 occurrences, use find-and-replace)

---

## File Change Summary

| File | Task(s) | Type |
|------|---------|------|
| `pages/activity.html` | 1 | Edit |
| `js/modules/event-create.js` | 1 | Edit (7 locations) |
| `js/modules/event-manage.js` | 1 | Edit |
| `js/api-service.js` | 2 | Edit (1 line addition) |
| `js/firebase-crud.js` | 3 | Edit (add method) |
| `js/modules/dashboard.js` | 3 | Edit (add method) |
| `pages/admin-system.html` | 3 | Edit (2 locations) |
| `js/config.js` | all | Edit (version bump) |
| `index.html` | all | Edit (version bump) |

Total: **9 files**, no new files created.

---

## Verification Checklist (for reviewer)

Run these checks after implementation:

```bash
# 1. No stale references to old element IDs
grep -r "ce-datetime-start\|ce-datetime-end" pages/ js/ --include="*.html" --include="*.js"
# Expected: 0 matches

# 2. New element IDs exist in HTML
grep "ce-date\|ce-time-start\|ce-time-end" pages/activity.html
# Expected: 3 matches (one for each input)

# 3. localStorage persistence in _delete
grep -A5 "_delete(key" js/api-service.js
# Expected: contains _saveToLS

# 4. clearCollection method exists
grep "clearCollection" js/firebase-crud.js
# Expected: 1+ matches

# 5. clearAllData method exists
grep "clearAllData" js/modules/dashboard.js
# Expected: 1+ matches

# 6. Button in admin-system.html
grep "clearAllData" pages/admin-system.html
# Expected: 1 match

# 7. Cache version updated consistently
grep -c "20260222b" index.html
# Expected: 0 (all should be updated to new version)
```
