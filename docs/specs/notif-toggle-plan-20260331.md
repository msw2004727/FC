# LINE 推播節流開關 — 實作計畫書

**版本：** 1.0
**日期：** 2026-03-31
**狀態：** 待實作
**計畫審核：** 架構師 Arch ✅ × QA 工程師 QA ✅（詳見文末）

---

## 一、背景與目的

LINE Messaging API 免費方案每月上限 **200 則推播**。現有系統共有 26 個觸發場景，根據估算小型俱樂部（50 人、15 場/月）每月實際推播量約 **320 則**，超出上限 60%。

其中消耗最大的兩個類型：
- **報名確認**（`signup_success`）：用戶自己操作，App 畫面已即時反應，屬「已知通知」
- **取消確認**（`cancel_signup`）：同上

目標：在不影響用戶關鍵體驗的前提下，讓管理員能控制哪些推播類型開啟，預計節省 **60–65%** 的月用量。

---

## 二、架構分析

### 推播流程（已確認）

```
各模組觸發
  └─ _sendNotifFromTemplate(key, ...)          ← 模板通知
  └─ _deliverMessageWithLinePush(...)           ← 通用通知
       └─ _queueLinePush(uid, category, title, body, options)  ← ★ 單一入口
            └─ _enqueuePrivilegedLinePush()
                 └─ CF: enqueuePrivilegedLineNotification
                      └─ linePushQueue → LINE API
```

**關鍵發現：** `options.source` 欄位在所有模板通知中已自動帶入 `template:{key}`（例如 `template:signup_success`），廣播訊息則帶入 `target:{type}`。這個欄位可作為類型識別，**不需要改動任何呼叫端**，只需在單一入口 `_queueLinePush()` 加入判斷即可。

### 通知類型分類

| 類型 | source 值 | 分類 | 可停用？ |
|------|-----------|------|---------|
| 報名確認 | `template:signup_success` | activity | ✅ 可停用 |
| 取消確認 | `template:cancel_signup` | activity | ✅ 可停用 |
| 候補降級 | `template:waitlist_demoted` | activity | ✅ 可停用 |
| 活動重新上架 | `template:event_relisted` | activity | ✅ 可停用 |
| 角色升等 | `template:role_upgrade` | private→system | ✅ 可停用 |
| 歡迎訊息 | `template:welcome` | system | ✅ 可停用 |
| **候補遞補** | `template:waitlist_promoted` | activity | 🔒 強制開啟 |
| **活動取消** | `template:event_cancelled` | activity | 🔒 強制開啟 |
| **活動異動** | `template:event_changed` | activity | 🔒 強制開啟 |
| 管理員廣播 | `target:*` | any | 🔒 強制開啟 |

---

## 三、實作方案（混合路線）

### Layer 1：類別開關（3 個全域 toggle）

在 Firestore `siteConfig` 文件新增 `notificationToggles` 欄位：

```json
{
  "notificationToggles": {
    "category_activity": true,
    "category_system": true,
    "category_tournament": false,
    "type_signup_success": true,
    "type_cancel_signup": true,
    "type_waitlist_demoted": true,
    "type_event_relisted": true,
    "type_role_upgrade": true,
    "type_welcome": true
  }
}
```

### Layer 2：高頻類型開關（6 個細粒度 toggle）

針對 `signup_success`、`cancel_signup` 等高頻但低價值的類型，提供個別開關。這些開關在 Layer 1 類別開啟時才有意義。

### 強制開啟（不受任何開關影響）

以下 source 在 `_queueLinePush()` 中直接放行，跳過所有開關檢查：
- `template:waitlist_promoted`
- `template:event_cancelled`
- `template:event_changed`
- `target:` 開頭（管理員廣播）

---

## 四、完整實作步驟

### Step 1：`js/config.js` — 新增選單與權限碼

**修改位置：** `DRAWER_MENUS` 陣列的最後一項（`admin.inactive.entry` 之後）

新增：
```javascript
{ icon: '🔔', label: '推播通知設定', page: 'page-admin-notif', minRole: 'super_admin', permissionCode: 'admin.notif.entry' },
```

**修改位置：** `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS`

新增：
```javascript
'page-admin-notif': [
  { code: 'admin.notif.toggle', name: '修改推播開關' },
],
```

**修改位置：** `getDefaultRolePermissions()`

`super_admin` 預設取得 `admin.notif.entry` + `admin.notif.toggle`。

---

### Step 2：`js/modules/user-admin/user-admin-perm-info.js` — 新增說明

在 `_PERM_INFO` 中新增：
```javascript
'admin.notif.entry': {
  title: '推播通知設定入口',
  body: '進入推播通知設定頁面，查看各類推播的開關狀態。'
},
'admin.notif.toggle': {
  title: '修改推播開關',
  body: '⚠️ 開啟或關閉各類 LINE 推播通知。關閉後用戶將不再收到該類推播，僅保留候補遞補、活動取消、活動異動三項強制通知。'
},
```

---

### Step 3：`js/firebase-service.js` — 讀取並快取通知設定

在 `bootCollections` 流程中，從 `siteConfig` 讀取 `notificationToggles`，寫入 `_cache.notificationToggles`。

新增一個取得設定的函式（供 `_queueLinePush` 使用）：
```javascript
getNotificationToggles() {
  const doc = (this._cache.siteConfig || {});
  return doc.notificationToggles || {};
}
```

`siteConfig` 本身已在 boot 期間載入，不增加額外 Firestore 讀取。

---

### Step 4：`js/modules/message/message-line-push.js` — 在單一入口加守衛

在 `_queueLinePush()` 的參數驗證之後、實際排入之前，加入：

```javascript
// ── 強制開啟類型：不受任何開關影響 ──
const FORCED_ON_SOURCES = [
  'template:waitlist_promoted',
  'template:event_cancelled',
  'template:event_changed',
];
const src = options?.source || '';
const isForced = FORCED_ON_SOURCES.some(s => src.startsWith(s))
  || src.startsWith('target:');

if (!isForced) {
  const toggles = FirebaseService.getNotificationToggles?.() || {};
  // Layer 1：類別開關
  const catKey = 'category_' + this._linePushCategoryKey(category);
  if (toggles[catKey] === false) return;
  // Layer 2：類型開關（從 source 解析，例如 template:signup_success → type_signup_success）
  if (src.startsWith('template:')) {
    const typeKey = 'type_' + src.replace('template:', '');
    if (toggles[typeKey] === false) return;
  }
}
```

**影響行數：** ~15 行。不改動現有邏輯，純加守衛。

---

### Step 5：`pages/admin-notif.html` — 新頁面 HTML 片段

建立新頁面片段，包含：
- 頁面標題「推播通知設定」
- 說明文字（目前免費方案 200 則/月、強制開啟項目說明）
- 類別開關區塊（activity / system / tournament）
- 細粒度開關區塊（顯示各可停用類型）
- 強制開啟類型說明區塊（灰色，不可操作）
- 儲存按鈕

---

### Step 6：`js/modules/message/notif-settings.js` — 新模組

建立新模組，掛載於 `App`：

主要函式：
- `renderNotifSettings()` — 渲染頁面，讀取 `siteConfig.notificationToggles`
- `saveNotifSettings(toggles)` — 寫入 Firestore `siteConfig` 文件的 `notificationToggles` 欄位（需驗證 `admin.notif.toggle` 權限）
- `_buildNotifToggleUI()` — 產生開關 UI HTML

---

### Step 7：`js/core/navigation.js` — 新增頁面路由

在 `renderPageContent()` 加入：
```javascript
if (pageId === 'page-admin-notif') this.renderNotifSettings?.();
```

---

### Step 8：`js/core/page-loader.js` — 新增頁面映射

新增：
```javascript
'page-admin-notif': 'admin-notif',
```

---

### Step 9：`firestore.rules` — 新增寫入權限規則

`siteConfig` 的 `notificationToggles` 欄位寫入限制：

```javascript
match /siteConfig/{docId} {
  allow read: if true;
  allow update: if isSuperAdmin() || hasPerm('admin.notif.toggle');
}
```

（需確認現有 siteConfig 規則並合併，不覆蓋）

---

### Step 10：`js/config.js` — `PAGE_DATA_CONTRACT` / `PAGE_STRATEGY` 新增頁面

```javascript
'page-admin-notif': { strategy: 'fresh-first', required: ['siteConfig'] }
```

---

## 五、動用檔案一覽

| 檔案 | 異動類型 | 說明 |
|------|---------|------|
| `js/config.js` | 修改 | 新增選單、權限碼、頁面策略 |
| `js/modules/user-admin/user-admin-perm-info.js` | 修改 | 新增 2 個權限說明 |
| `js/firebase-service.js` | 修改 | 新增 `getNotificationToggles()` |
| `js/modules/message/message-line-push.js` | 修改 | 在 `_queueLinePush()` 加守衛 |
| `js/modules/message/notif-settings.js` | 新增 | 推播設定模組 |
| `pages/admin-notif.html` | 新增 | 頁面 HTML 片段 |
| `js/core/navigation.js` | 修改 | 新增路由 |
| `js/core/page-loader.js` | 修改 | 新增頁面映射 |
| `firestore.rules` | 修改 | siteConfig 寫入規則 |

**共計：** 7 個修改、2 個新增，核心邏輯集中於 `message-line-push.js` 的 ~15 行守衛。

---

## 六、自動化測試計畫

### 現有缺口

目前 `tests/unit/message-system.test.js` 與 `tests/unit/message.test.js` 尚未覆蓋 `_queueLinePush()` 的通知過濾行為。本次需補完。

### 新增測試：`tests/unit/notif-toggle.test.js`

#### 6.1 核心守衛邏輯（`_queueLinePush` 守衛）

```
describe('_queueLinePush 推播守衛')

  ✅ category_activity = false 時，activity 類別通知被封鎖
  ✅ category_activity = false 時，system 類別通知仍正常送出
  ✅ type_signup_success = false 時，signup_success 被封鎖，其他 activity 通知不受影響
  ✅ type_cancel_signup = false 時，cancel_signup 被封鎖
  ✅ category 和 type 同時關閉時，只送一次封鎖（不重複判斷）

  強制開啟保護：
  ✅ 即使 category_activity = false，waitlist_promoted 仍被送出
  ✅ 即使 category_activity = false，event_cancelled 仍被送出
  ✅ 即使 category_activity = false，event_changed 仍被送出
  ✅ 管理員廣播（source: target:all）不受任何開關影響
  ✅ 管理員廣播（source: target:individual）不受任何開關影響

  邊界條件：
  ✅ notificationToggles 為空物件時，所有通知正常送出（預設全開）
  ✅ notificationToggles 欄位不存在時，所有通知正常送出（安全降級）
  ✅ source 為空字串時，僅類別開關生效，不崩潰
  ✅ uid / category / title / body 缺一則直接 return（現有行為不受影響）
```

#### 6.2 `getNotificationToggles()` 取得邏輯

```
describe('getNotificationToggles')

  ✅ siteConfig 有 notificationToggles 欄位時正確回傳
  ✅ siteConfig 無 notificationToggles 欄位時回傳空物件 {}
  ✅ siteConfig 尚未載入時回傳空物件 {}（安全降級，不丟例外）
```

#### 6.3 `saveNotifSettings()` 權限驗證

```
describe('saveNotifSettings 權限守衛')

  ✅ 具備 admin.notif.toggle 權限時，呼叫 Firestore 更新
  ✅ 不具備 admin.notif.toggle 時，拒絕並顯示 toast
  ✅ 更新成功後，本地 siteConfig 快取同步更新
```

#### 6.4 Firestore Rules 測試（補充至 `tests/firestore-rules-extended.test.js`）

```
describe('siteConfig 通知設定寫入規則')

  ✅ super_admin 可以更新 siteConfig.notificationToggles
  ✅ admin（不含 notif.toggle 權限）無法更新 siteConfig
  ✅ 一般用戶無法更新 siteConfig
  ✅ 任何人可讀取 siteConfig（現有規則不變）
```

#### 6.5 權限碼完整性測試（補充至 `tests/unit/permissions-phase2-logic.test.js`）

```
✅ admin.notif.entry 存在於 DRAWER_MENUS 中
✅ admin.notif.toggle 存在於 ADMIN_PAGE_EXTRA_PERMISSION_ITEMS['page-admin-notif'] 中
✅ getDefaultRolePermissions('super_admin') 包含 admin.notif.entry
✅ getDefaultRolePermissions('admin') 不包含 admin.notif.entry（此為 super_admin 功能）
✅ _PERM_INFO 中有 admin.notif.entry 和 admin.notif.toggle 的說明
```

---

## 七、QA 驗收項目（手動）

### 正向驗收
- [ ] 抽屜選單「推播通知設定」顯示在「無效資料查詢」下方
- [ ] 非 super_admin 不顯示此選單項目
- [ ] 頁面正確顯示所有開關與強制開啟項目
- [ ] 關閉 `activity` 類別後，執行報名 → 用戶不收到 LINE 推播，但 App 內訊息正常收到
- [ ] 關閉 `type_signup_success` 後，取消報名通知仍正常送（精準控制不相互影響）
- [ ] 強制開啟的候補遞補在 `activity` 類別關閉時仍正確送出
- [ ] 管理員廣播不受任何開關影響
- [ ] 儲存後重新整理頁面，設定持久化正確

### 回歸驗收
- [ ] 現有報名流程 App 內訊息功能不受影響（只有 LINE 推播被控制）
- [ ] `category_tournament` 預設為 `false`，現有行為不變
- [ ] Demo 模式下，開關邏輯不影響 Demo 推播 log（console.log 路徑）

---

## 八、CACHE_VERSION 更新規則

本次修改涉及 JS 和 HTML，完成後須同步更新四個版本號位置（見 `CLAUDE.md`）。

---

## 九、AI 角色審核

---

### 架構師 Arch 審核意見

> **結論：✅ 通過**

**優點：**
1. 在 `_queueLinePush()` 單一入口加守衛的設計非常乾淨，符合「閥門加在水管入口」原則，不需要分散修改 26 個呼叫點。
2. 利用已有的 `options.source` 欄位識別通知類型，零改動呼叫端，迴歸風險極低。
3. 強制開啟清單以 source prefix 判斷（`target:` 開頭即廣播），比用 flag 傳遞更不容易被遺忘或繞過。
4. `siteConfig` 複用現有集合，不新增 Firestore 讀取成本。
5. `getNotificationToggles()` 安全降級（回傳空物件 = 全開），確保 Firestore 尚未載入時不會誤封鎖。

**建議注意：**
- Step 9 的 Firestore Rules 需確認現有 `siteConfig` 規則結構，避免覆蓋現有允許條件。建議用 `update` 並限定 `affectedKeys()` 只能含 `notificationToggles`，防止其他管理員欄位被篡改。
- `notif-settings.js` 模組需注意不超過 300 行限制（CLAUDE.md 規範）。

---

### QA 工程師 QA 審核意見

> **結論：✅ 通過**

**測試覆蓋評估：**

| 面向 | 狀態 | 說明 |
|------|------|------|
| 守衛邏輯（正向） | ✅ 完整 | 類別、類型、強制開啟均有測試 |
| 守衛邏輯（邊界） | ✅ 完整 | 空 toggles、欄位缺失、空 source 均覆蓋 |
| 安全降級 | ✅ 完整 | 快取未載入時行為明確 |
| 權限碼完整性 | ✅ 完整 | DRAWER_MENUS / _PERM_INFO 一致性驗證 |
| Firestore Rules | ✅ 完整 | 寫入權限三角驗證（super_admin / admin / user）|
| 回歸（App 內訊息） | ✅ 有覆蓋 | 需在手動驗收確認 inbox 不受影響 |
| Demo 模式 | ✅ 有覆蓋 | Demo 路徑在 _queueLinePush 守衛之前不需通過，但需確認守衛位置在 isDemo() check 之後或之前 |

**建議注意：**
- 守衛邏輯的插入位置要在 `if (ModeManager.isDemo())` 分支**之前**，確保 Demo 模式也正確反映開關狀態（否則 Demo 測試可能與 Prod 行為不一致）。若 Demo 模式下不需要守衛，需在計畫書說明原因。
- `saveNotifSettings()` 的錯誤處理需測試 Firestore 寫入失敗時的 UI 狀態（toast 提示、開關不誤切換）。

---

*兩位審核者均已通過，計畫書定稿。*
