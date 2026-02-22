# 規格書：活動詳情頁簽到簽退整合 + 報名表格化 + 權限控制

## 專案概述

本規格書涵蓋四項需求：
1. 在活動詳情頁新增「現場簽到」按鈕，跳轉至掃碼頁並自動帶入活動
2. 報名名單改為表格式呈現，支援手動簽到/簽退/備註
3. 簽到簽退按鈕僅限主辦/委託/管理員/總管可見
4. 費用摘要（應收/實收/短收）僅限總管可見

---

## 技術背景

### 架構

- 純前端 Vanilla JS（無框架、無 build），所有模組以 `Object.assign(App, {...})` 掛載
- 資料操作統一透過 `ApiService`
- 權限判斷使用 `ROLE_LEVEL_MAP[this.currentRole]` 取得等級數值
- `escapeHTML()` 處理所有用戶輸入

### 相關檔案

| 檔案 | 用途 |
|------|------|
| `js/modules/event-detail.js` | 活動詳情頁 `showEventDetail()` — **主要修改對象** |
| `js/modules/event-render.js` | 同名 `showEventDetail()` 副本 — **需同步修改** |
| `js/modules/event-manage.js` | 活動管理列表卡片（費用摘要所在） |
| `js/modules/scan.js` | 掃碼簽到/簽退頁面 |
| `pages/scan.html` | 掃碼頁 HTML 結構 |
| `js/config.js` | `CACHE_VERSION`、`ROLE_LEVEL_MAP` |
| `index.html` | 所有 `?v=` 快取參數 |

### 重要：雙檔案同步

`showEventDetail()` 同時存在於 `event-detail.js` 和 `event-render.js`，兩份程式碼結構相同。**所有對活動詳情頁面的修改，必須同步修改這兩個檔案**。

### 權限等級對照

```
user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5
```

### 現有權限判斷函式（定義在 event-render.js）

```javascript
_isEventOwner(e)      // 當前用戶是否為活動建立者
_isEventDelegate(e)   // 當前用戶是否為活動委託人
_canManageEvent(e)    // owner || delegate || admin+
```

### currentRole 取得方式

`this.currentRole` 是 App 物件上的屬性，在 Demo 模式下由角色切換器設定，正式版由 LINE 登入後查詢。值為 `'user'`、`'coach'`、`'admin'`、`'super_admin'` 等字串。

---

## 需求 1：活動詳情頁「現場簽到」按鈕

### 按鈕名稱

**「現場簽到」**（四個字）

### 按鈕位置

在 `showEventDetail()` 的按鈕區塊中，新增在「分享活動」按鈕右邊。

**event-detail.js 約 line 89-93，event-render.js 約 line 431-435：**

現行 HTML：
```html
<div style="display:flex;gap:.5rem;margin:1rem 0;flex-wrap:wrap">
  ${signupBtn}
  <button class="outline-btn" onclick="App.showUserProfile(...)">聯繫主辦人</button>
  <button class="outline-btn" onclick="App.shareEvent(...)">分享活動</button>
  <!-- ← 新按鈕插入此處 -->
</div>
```

修改後：
```html
<div style="display:flex;gap:.5rem;margin:1rem 0;flex-wrap:wrap">
  ${signupBtn}
  <button class="outline-btn" onclick="App.showUserProfile(...)">聯繫主辦人</button>
  <button class="outline-btn" onclick="App.shareEvent(...)">分享活動</button>
  ${scanBtn}
</div>
```

### 按鈕產生邏輯

```javascript
// 在 showEventDetail() 內，按鈕區塊之前加入：
const canScan = this._canManageEvent(e);
const scanBtn = canScan
  ? `<button class="outline-btn" onclick="App.goToScanForEvent('${e.id}')">現場簽到</button>`
  : '';
```

- **可見條件**：`_canManageEvent(e)` 回傳 true（主辦人 OR 委託人 OR admin OR super_admin）
- 一般用戶（user）**不會看到**此按鈕

### 跳轉函式 `goToScanForEvent(eventId)`

在 `scan.js` 中新增此函式：

```javascript
goToScanForEvent(eventId) {
  // 1. 記錄要帶入的活動 ID
  this._scanPresetEventId = eventId;
  // 2. 導航到掃碼頁
  this.showPage('page-scan');
},
```

### 掃碼頁的預設活動處理

修改 `scan.js` 的 `renderScanPage()` 函式（約 line 18-61），在原有邏輯之後加入預設活動處理：

```javascript
renderScanPage() {
  const select = document.getElementById('scan-event-select');
  if (!select) return;

  // ... 現有的 events 過濾、排序、option 建立邏輯不變 ...

  // ── 新增：若有預設活動 ID，自動選取並鎖定下拉 ──
  if (this._scanPresetEventId) {
    const presetId = this._scanPresetEventId;
    this._scanPresetEventId = null; // 清除，只生效一次

    // 確保預設活動存在於選單中（若不在，手動加入）
    const presetEvent = ApiService.getEvent(presetId);
    if (presetEvent) {
      if (!select.querySelector(`option[value="${presetId}"]`)) {
        const opt = document.createElement('option');
        opt.value = presetId;
        opt.textContent = `${presetEvent.title}（${presetEvent.date}）`;
        select.appendChild(opt);
      }
      select.value = presetId;
      this._scanSelectedEventId = presetId;

      // 鎖定下拉選單：禁用切換
      select.disabled = true;
      // 在下拉上方或旁邊顯示提示，讓用戶知道是哪場活動
    }
  } else {
    // 非預設模式：恢復下拉可選
    select.disabled = false;
    // Restore previous selection if still valid
    if (this._scanSelectedEventId) {
      select.value = this._scanSelectedEventId;
    }
  }

  this._updateScanControls();
  this._renderAttendanceSections();
  this._bindScanEvents();
},
```

**重點行為**：
- 從活動詳情頁點「現場簽到」→ 跳轉掃碼頁 → 下拉選單自動選中該活動 → **下拉設為 disabled**（不可切換活動）
- 從側邊選單直接進掃碼頁 → 下拉正常可選（現行行為不變）
- `_scanPresetEventId` 只生效一次，清除後不影響後續操作

---

## 需求 2：報名名單表格化 + 手動簽到/簽退/備註

### 適用範圍

修改 `event-manage.js` 中 `showMyActivityDetail()` 函式的**報名名單**區塊（約 line 161-209 之間，目前的分組名單渲染邏輯）。

### 表格結構

| 姓名 | 簽到 | 簽退 | 編輯 | 備註 |
|------|------|------|------|------|
| 👤 王小明 | ✓ | | [編輯] | |
| ↳ 小明伴侶 | ✓ | ✓ | [編輯] | 遲到10分 |
| 👤 李小芳 | | | [編輯] | |

### HTML 結構

```html
<div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:.8rem">
    <thead>
      <tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:.4rem .3rem;font-weight:600">姓名</th>
        <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
        <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
        <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">編輯</th>
        <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:5rem">備註</th>
      </tr>
    </thead>
    <tbody>
      <!-- 每一列為一個報名者 -->
    </tbody>
  </table>
</div>
```

### 每一列的渲染邏輯

需要結合 `e.participants`（或 registrations）和 `attendanceRecords` 來渲染：

```javascript
// 取得簽到/簽退紀錄
const records = ApiService.getAttendanceRecords(e.id);

// 對每一位報名者：
const hasCheckin = records.some(r => r.userName === name && r.type === 'checkin');
const hasCheckout = records.some(r => r.userName === name && r.type === 'checkout');
```

**姓名欄**：
- 主帳號：`👤 ${name}`
- 同行者：`<span style="padding-left:1rem">↳ ${companionName}</span>`（縮排顯示）

**簽到欄**：
- 已簽到：`<span style="color:var(--success)">✓</span>`
- 未簽到：空白

**簽退欄**：
- 已簽退：`<span style="color:var(--success)">✓</span>`
- 未簽退：空白

**編輯欄**（普通狀態）：
```html
<button class="outline-btn" style="font-size:.65rem;padding:.1rem .3rem"
  onclick="App._startManualAttendance('${eventId}', '${uid}', '${name}')">編輯</button>
```

**編輯欄**（編輯中狀態）：
點擊「編輯」後，該列的簽到/簽退欄位切換為可互動 checkbox，「編輯」按鈕變成「確認」按鈕：

```html
<!-- 簽到欄切換為 checkbox -->
<input type="checkbox" ${hasCheckin ? 'checked' : ''}
  id="manual-checkin-${uid}" style="width:1rem;height:1rem">

<!-- 簽退欄切換為 checkbox -->
<input type="checkbox" ${hasCheckout ? 'checked' : ''}
  id="manual-checkout-${uid}" style="width:1rem;height:1rem">

<!-- 編輯按鈕變成確認 -->
<button class="primary-btn" style="font-size:.65rem;padding:.1rem .3rem"
  onclick="App._confirmManualAttendance('${eventId}', '${uid}', '${name}')">確認</button>
```

**備註欄**（普通狀態）：
- 有備註：顯示備註文字
- 無備註：空白

**備註欄**（編輯中狀態）：
```html
<input type="text" maxlength="10" value="${existingNote}"
  id="manual-note-${uid}" placeholder="備註"
  style="width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box">
```

### 手動簽到/簽退函式

#### `_startManualAttendance(eventId, uid, name)`

```javascript
// 將該列切換為「編輯模式」
// 方式 1（推薦）：重新渲染整個表格，標記該 uid 為 editing 狀態
// 方式 2：直接用 DOM 操作替換該列 cells
_startManualAttendance(eventId, uid, name) {
  this._manualEditingUid = uid;
  this._manualEditingEventId = eventId;
  // 重新渲染名單表格
  this._renderAttendanceTable(eventId);
},
```

#### `_confirmManualAttendance(eventId, uid, name)`

```javascript
_confirmManualAttendance(eventId, uid, name) {
  const checkinBox = document.getElementById('manual-checkin-' + uid);
  const checkoutBox = document.getElementById('manual-checkout-' + uid);
  const noteInput = document.getElementById('manual-note-' + uid);

  const wantCheckin = checkinBox?.checked || false;
  const wantCheckout = checkoutBox?.checked || false;
  const note = (noteInput?.value || '').trim().slice(0, 10);

  const records = ApiService.getAttendanceRecords(eventId);
  const hasCheckin = records.some(r => r.uid === uid && r.type === 'checkin');
  const hasCheckout = records.some(r => r.uid === uid && r.type === 'checkout');

  const now = new Date();
  const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // 新增簽到紀錄
  if (wantCheckin && !hasCheckin) {
    ApiService.addAttendanceRecord({
      id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      eventId, uid, userName: name,
      type: 'checkin', time: timeStr,
    });
  }

  // 新增簽退紀錄
  if (wantCheckout && !hasCheckout) {
    // 簽退前必須有簽到
    if (!wantCheckin && !hasCheckin) {
      this.showToast('需先簽到才能簽退');
    } else {
      ApiService.addAttendanceRecord({
        id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        eventId, uid, userName: name,
        type: 'checkout', time: timeStr,
      });
    }
  }

  // 儲存備註（使用 attendanceRecords 的 note 欄位，或另存）
  if (note) {
    ApiService.addAttendanceRecord({
      id: 'att_note_' + Date.now(),
      eventId, uid, userName: name,
      type: 'note', time: timeStr, note,
    });
  }

  // 退出編輯模式，重新渲染
  this._manualEditingUid = null;
  this._manualEditingEventId = null;
  this.showMyActivityDetail(eventId);
  this.showToast('已更新');
},
```

### 備註儲存方式

備註資料以新 type `'note'` 的 attendanceRecord 儲存。讀取備註時：

```javascript
const noteRecord = records.filter(r => r.uid === uid && r.type === 'note').pop(); // 取最新一筆
const noteText = noteRecord?.note || '';
```

### 候補名單

候補名單不需要簽到/簽退功能，維持現有的簡易列表顯示即可。

---

## 需求 3：簽到簽退按鈕權限控制

### 規則

「現場簽到」按鈕**只有**以下角色可見：
- 該活動的**主辦人**（`_isEventOwner(e)` 為 true）
- 該活動的**委託者**（`_isEventDelegate(e)` 為 true）
- **管理員**（`ROLE_LEVEL_MAP[this.currentRole] >= ROLE_LEVEL_MAP.admin`）
- **總管**（`ROLE_LEVEL_MAP[this.currentRole] >= ROLE_LEVEL_MAP.super_admin`）

### 實作方式

已在需求 1 的 `scanBtn` 產生邏輯中包含：

```javascript
const canScan = this._canManageEvent(e);
const scanBtn = canScan
  ? `<button class="outline-btn" onclick="App.goToScanForEvent('${e.id}')">現場簽到</button>`
  : '';
```

`_canManageEvent(e)` 的邏輯（已存在於 event-render.js line 73-78）：

```javascript
_canManageEvent(e) {
  const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
  if (myLevel >= ROLE_LEVEL_MAP.admin) return true;
  return this._isEventOwner(e) || this._isEventDelegate(e);
}
```

此函式正好符合需求，不需新建權限函式。

### 手動編輯按鈕同理

報名表格中的「編輯」欄位（手動簽到/簽退）只在管理端 `showMyActivityDetail()` 中顯示，該頁面本身已受 `renderMyActivities()` 的權限過濾保護（僅 coach+ 且 `_canManageEvent(e)` 的活動才會列出）。因此**編輯按鈕不需額外權限判斷**。

---

## 需求 4：費用摘要僅限總管可見

### 適用位置

**位置 A**：`event-manage.js` 的 `renderMyActivities()` 列表卡片中的 `feeBox`（約 line 86-98）

**位置 B**：`event-manage.js` 的 `showMyActivityDetail()` 詳情中的 `feeSection`（約 line 270-284）

### 修改方式

在 feeBox / feeSection 渲染前加入權限判斷：

```javascript
const isSuperAdmin = (ROLE_LEVEL_MAP[this.currentRole] || 0) >= ROLE_LEVEL_MAP.super_admin;
```

**位置 A（列表卡片）**：

原本（約 line 86）：
```javascript
const fee = e.fee || 0;
```

修改為：
```javascript
const fee = e.fee || 0;
const isSuperAdmin = (ROLE_LEVEL_MAP[this.currentRole] || 0) >= ROLE_LEVEL_MAP.super_admin;
```

原本（約 line 94）：
```javascript
const feeBox = fee > 0 ? `<div ...>...</div>` : '';
```

修改為：
```javascript
const feeBox = (fee > 0 && isSuperAdmin) ? `<div ...>...</div>` : '';
```

**位置 B（詳情頁）**：

同理，在 `feeSection` 的渲染條件加入 `isSuperAdmin`：

```javascript
const feeSection = (fee > 0 && isSuperAdmin)
  ? `<div ...>應收/實收/短收...</div>`
  : '';
```

### 可見性矩陣

| 角色 | 看到費用摘要 |
|------|------------|
| user | ✗ |
| coach | ✗ |
| captain | ✗ |
| venue_owner | ✗ |
| admin | ✗ |
| super_admin | ✓ |

---

## 快取版本號更新

**每次修改完成後，必須更新：**

1. `js/config.js` → `CACHE_VERSION` 常數
2. `index.html` → 所有 `?v=` 參數（約 61 處，全域替換即可）

版本號格式：`YYYYMMDD` + 同天遞增後綴 `a`, `b`, `c`...

---

## 修改檔案清單

| # | 檔案 | 修改內容 |
|---|------|---------|
| 1 | `js/modules/event-detail.js` | `showEventDetail()` 加入 `scanBtn` |
| 2 | `js/modules/event-render.js` | `showEventDetail()` 加入 `scanBtn`（同步） |
| 3 | `js/modules/scan.js` | 新增 `goToScanForEvent()`、修改 `renderScanPage()` 支援預設活動 |
| 4 | `js/modules/event-manage.js` | 報名名單改為表格 + 手動簽到/簽退/備註 + 費用權限 |
| 5 | `js/config.js` | `CACHE_VERSION` 更新 |
| 6 | `index.html` | 所有 `?v=` 更新 |

---

## 驗證步驟

### 需求 1 驗證
1. Demo 模式 → 切換為 coach 角色 → 進入任一 open 活動詳情
2. 確認「分享活動」右邊出現「現場簽到」按鈕
3. 點擊 → 跳轉掃碼頁 → 活動下拉已選中且 disabled
4. 掃碼/手動輸入正常運作

### 需求 2 驗證
1. 活動管理 → 點任一活動詳情 → 報名名單為表格
2. 橫向顯示：姓名、簽到（✓）、簽退（✓）、編輯、備註
3. 點「編輯」→ 簽到/簽退變為 checkbox + 備註變為 input → 按鈕變「確認」
4. 勾選簽到 → 點確認 → 該列簽到欄變 ✓
5. 備註填入文字 → 點確認 → 備註顯示文字

### 需求 3 驗證
1. Demo 切 user 角色 → 活動詳情頁 **不顯示** 「現場簽到」按鈕
2. Demo 切 coach 角色 → **自己主辦或受委託** 的活動顯示按鈕
3. Demo 切 admin/super_admin → **所有活動** 顯示按鈕

### 需求 4 驗證
1. Demo 切 coach → 活動管理列表 → 有費用的活動卡片 **不顯示** 應收/實收/短收
2. Demo 切 admin → 同上 **不顯示**
3. Demo 切 super_admin → **顯示** 應收/實收/短收
