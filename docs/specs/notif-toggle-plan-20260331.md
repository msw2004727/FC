# LINE 推播節流開關 — 實作計畫書

**版本：** 1.3
**日期：** 2026-03-31
**狀態：** 待實作
**計畫審核：** 架構師 Arch ✅ × QA 工程師 QA ✅（詳見文末）
**v1.1 勘誤：** 三方交叉審核修正 8 項瑕疵（架構師 × QA × 前端工程師一致通過）
**v1.2 勘誤：** 二次審查修正 6 項瑕疵（架構師 × QA × 安全工程師一致通過）
**v1.3 勘誤：** create/update 規則拆分 + featureFlags 不存在邊界測試 + QA 驗收精確化

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

在 Firestore `siteConfig/featureFlags` 文件新增 `notificationToggles` 欄位（複用現有文件，不新增 Firestore 讀取）：

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

`super_admin` 預設取得 `admin.notif.entry`（由 DRAWER_MENUS 自動收集）+ `admin.notif.toggle`（需手動加入）。

> ⚠️ **注意：** `getDefaultRolePermissions()` 只自動收集 DRAWER_MENUS 的 `entryCode`，不會自動收集 `ADMIN_PAGE_EXTRA_PERMISSION_ITEMS` 的子權限。因此必須在函式中手動追加：
> ```javascript
> if (roleLevel >= getRuntimeRoleLevel('super_admin')) {
>   defaults.push('admin.notif.toggle');
> }
> ```

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

新增一個取得設定的函式（供 `_queueLinePush` 使用）：
```javascript
getNotificationToggles() {
  const doc = this.getCachedDoc('siteConfig', 'featureFlags') || {};
  return doc.notificationToggles || {};
}
```

> ⚠️ **v1.1 修正：** `siteConfig` 的文件存放在 `_singleDocCache`（非 `_cache`），必須透過 `getCachedDoc('siteConfig', 'featureFlags')` 存取。`_cache` 中沒有 `siteConfig` 欄位，原寫法 `this._cache.siteConfig` 會永遠回傳 `undefined`，導致守衛形同虛設。

`siteConfig/featureFlags` 已在 boot 期間由 `_fetchSingleDoc('siteConfig', 'featureFlags')` 載入，不增加額外 Firestore 讀取。

---

### Step 4：`js/modules/message/message-line-push.js` — 在單一入口加守衛

在 `_queueLinePush()` 的參數驗證之後、**`ModeManager.isDemo()` 判斷之前**加入守衛，確保 Demo 模式也反映開關狀態（方便管理員在 Demo 環境測試開關效果）：

> ⚠️ **v1.1 決策：** 守衛位置在 Demo 分支**之前**。理由：Demo 模式的 console.log 應與 Prod 行為一致，否則管理員在 Demo 測試時看到的推播 log 與 Prod 實際行為不符，造成測試結果誤判。

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

> **前提假設：** 本功能假設 `siteConfig/featureFlags` 文件已存在。`saveNotifSettings()` 應使用 `set({...}, {merge: true})` 而非 `update()`，以相容文件不存在的情境（新環境、測試專案、文件被誤刪）。本地快取同步時亦須先確認 `_singleDocCache['siteConfig/featureFlags']` 是否存在，不存在則初始化為空物件後再寫入。

主要函式：
- `renderNotifSettings()` — 渲染頁面，透過 `FirebaseService.getCachedDoc('siteConfig', 'featureFlags')` 讀取 `notificationToggles`
- `saveNotifSettings(toggles)` — 寫入 Firestore `siteConfig/featureFlags` 文件的 `notificationToggles` 欄位（需驗證 `admin.notif.toggle` 權限）。**寫入前須做 schema 驗證**：所有 key 必須在允許清單內（`category_activity`, `category_system`, `category_tournament`, `type_signup_success`, `type_cancel_signup`, `type_waitlist_demoted`, `type_event_relisted`, `type_role_upgrade`, `type_welcome`），所有 value 必須為 `boolean`（`typeof v === 'boolean'`），不符則拒絕寫入並提示。**Firestore 寫入成功後，必須同步更新本地快取** `_singleDocCache['siteConfig/featureFlags'].notificationToggles`，否則守衛在同一 session 內仍讀取舊值
- `_buildNotifToggleUI()` — 產生開關 UI HTML

---

### Step 7：`js/core/navigation.js` — 新增頁面路由

在 `renderPageContent()` 加入：
```javascript
if (pageId === 'page-admin-notif') this.renderNotifSettings?.();
```

---

### Step 8：`js/core/page-loader.js` — 新增頁面映射與延遲載入

**修改位置：** `_pageFileMap` 新增映射：
```javascript
'page-admin-notif': 'admin-notif',
```

**修改位置：** `_deferredPages` 陣列新增（與其他後台管理頁一致）：
```javascript
'admin-notif',
```

> ⚠️ **v1.1 補充：** 不加入 `_deferredPages` 的話，`ensurePage()` 仍能按需載入，但不會被背景預載，首次導航會有可感知的延遲。所有後台管理頁（admin-users、admin-content、admin-system 等）均已在 `_deferredPages` 中。

---

### Step 9：`firestore.rules` — 合併寫入權限規則

將現有 `siteConfig` 規則拆分為 `create` / `update` 獨立規則，並追加 `admin.notif.toggle` 權限（含 field-level 限制），**不得覆蓋現有條件**：

```javascript
match /siteConfig/{docId} {
  allow read: if isAuth();                                          // ← 維持不變
  allow create: if isAdmin()                                        // ← 拆分 create
    || hasPerm('admin.auto_exp.entry')
    || (hasPerm('admin.notif.toggle')
        && docId == 'featureFlags'
        && request.resource.data.keys().hasOnly(['notificationToggles']));
  allow update: if isAdmin()                                        // ← 拆分 update
    || hasPerm('admin.auto_exp.entry')
    || (hasPerm('admin.notif.toggle')
        && docId == 'featureFlags'
        && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['notificationToggles']));
  allow delete: if false;                                           // ← 維持不變
}
```

> ⚠️ **v1.3 修正：** `create` 和 `update` 拆為獨立規則。`diff(resource.data)` 要求文件已存在（`resource.data` 非 null），用於 `create` 時會失敗。Firebase 官方建議 `create` 用 `keys().hasOnly()`、`update` 用 `diff().affectedKeys().hasOnly()`。當 `set({merge:true})` 對不存在的文件操作時觸發 `create` 路徑，拆分後可正確通過。

> ⚠️ **v1.1 修正：** 原計畫書的規則是整段替換式，會造成三個破壞：(1) `allow read` 從 `isAuth()` 降級為 `true`（安全性降低）；(2) 移除 `isAdmin()` 和 `hasPerm('admin.auto_exp.entry')` 條件（破壞 Auto-EXP 功能）；(3) 移除 `allow create` 和 `allow delete: if false`。正確做法是**合併**現有條件。

> ⚠️ **v1.2 修正：** 新增 `docId == 'featureFlags'` + `affectedKeys().hasOnly(['notificationToggles'])` 雙重限制，防止持有 `admin.notif.toggle` 權限的管理員越權寫入其他 siteConfig 文件（如 `autoExpRules`、`bootBrand`）。本專案已有 12+ 處 field-level 限制先例（如 `isSignupFieldsOnly`、`canMessageParticipantUpdate`）。

---

### Step 10：`js/config.js` — `PAGE_STRATEGY` + `PAGE_DATA_CONTRACT` 分別新增頁面

**修改位置：** `PAGE_STRATEGY` 新增：
```javascript
'page-admin-notif': 'fresh-first',
```

**修改位置：** `PAGE_DATA_CONTRACT` 新增：
```javascript
'page-admin-notif': { required: [], optional: [], realtime: [] },
```

> ⚠️ **v1.1 修正：** `PAGE_STRATEGY` 和 `PAGE_DATA_CONTRACT` 是兩個獨立物件，不可混寫。`PAGE_STRATEGY` 的值為純字串，`PAGE_DATA_CONTRACT` 的格式為 `{ required, optional, realtime }`。此外，`siteConfig` 不在 `_cache` 的集合列表中（它存在 `_singleDocCache`），不可作為 `required` 的值。`siteConfig/featureFlags` 已在 boot 自動載入，不需額外宣告依賴。

---

### Step 11（v1.1 新增）：`index.html` — 新增 script 載入標籤

在現有 `message/` 模組的 `<script>` 標籤群組後（`message-notify.js` 之後），新增：
```html
<script defer src="js/modules/message/notif-settings.js?v=..."></script>
```

> ⚠️ **v1.1 補充：** 本專案無 build process，所有 JS 模組靠 `index.html` 的 `<script>` 標籤載入。`notif-settings.js` 使用 `Object.assign(App, {...})` 掛載，不加載入標籤會導致 `renderNotifSettings` 為 `undefined`。

---

## 五、動用檔案一覽

| 檔案 | 異動類型 | 說明 |
|------|---------|------|
| `js/config.js` | 修改 | 新增選單、權限碼、頁面策略、`getDefaultRolePermissions()` 追加 `admin.notif.toggle` |
| `js/modules/user-admin/user-admin-perm-info.js` | 修改 | 新增 2 個權限說明 |
| `js/firebase-service.js` | 修改 | 新增 `getNotificationToggles()`（透過 `getCachedDoc`） |
| `js/modules/message/message-line-push.js` | 修改 | 在 `_queueLinePush()` 加守衛（Demo 分支之前） |
| `js/modules/message/notif-settings.js` | 新增 | 推播設定模組 |
| `pages/admin-notif.html` | 新增 | 頁面 HTML 片段 |
| `js/core/navigation.js` | 修改 | 新增路由 |
| `js/core/page-loader.js` | 修改 | 新增頁面映射 + `_deferredPages` 條目 |
| `firestore.rules` | 修改 | siteConfig create/update 拆分 + field-level 限制（合併，非覆蓋） |
| `index.html` | 修改 | 新增 `notif-settings.js` 的 `<script>` 標籤 + 版本號更新 |

**共計：** 8 個修改、2 個新增，核心邏輯集中於 `message-line-push.js` 的 ~15 行守衛。

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

  ✅ 具備 admin.notif.toggle 權限時，呼叫 Firestore `set({merge:true})` 寫入
  ✅ 不具備 admin.notif.toggle 時，拒絕並顯示 toast
  ✅ 寫入成功後，本地 `_singleDocCache['siteConfig/featureFlags']` 同步更新
  ✅ 寫入失敗時，UI 開關回復原狀並顯示錯誤 toast
  ✅ toggles 含有不在允許清單內的 key 時，拒絕寫入並提示
  ✅ toggles 的 value 不是 boolean 時（如字串 "false"），拒絕寫入並提示
```

#### 6.4 Firestore Rules 測試（補充至 `tests/firestore-rules-extended.test.js`）

```
describe('siteConfig 通知設定寫入規則')

  ✅ super_admin 可以更新 siteConfig/featureFlags.notificationToggles
  ✅ 持有 admin.notif.toggle 的管理員只能修改 featureFlags 的 notificationToggles 欄位，無法修改其他 siteConfig 文件
  ✅ featureFlags 文件不存在時，持有 admin.notif.toggle 的人可透過 set({merge:true}) 建立文件（create 規則）
  ✅ featureFlags 文件不存在時，create 規則仍限制只能寫入 notificationToggles 欄位
  ✅ admin（isAdmin）即使不含 notif.toggle 權限，仍可更新任何 siteConfig 文件（現有行為不變）
  ✅ coach（非 isAdmin，不含 notif.toggle）無法更新 siteConfig
  ✅ 一般用戶無法更新 siteConfig
  ✅ 已登入用戶（含匿名）可讀取 siteConfig（現有規則 `isAuth()` 不變）
  ✅ 未登入用戶無法讀取 siteConfig
```

#### 6.5 權限碼完整性測試（補充至 `tests/unit/permissions-phase2-logic.test.js`）

```
✅ admin.notif.entry 存在於 DRAWER_MENUS 中
✅ admin.notif.toggle 存在於 ADMIN_PAGE_EXTRA_PERMISSION_ITEMS['page-admin-notif'] 中
✅ getDefaultRolePermissions('super_admin') 包含 admin.notif.entry
✅ getDefaultRolePermissions('super_admin') 包含 admin.notif.toggle（v1.2 補充：驗證手動 push 是否生效）
✅ getDefaultRolePermissions('admin') 不包含 admin.notif.entry（此為 super_admin 功能）
✅ getDefaultRolePermissions('admin') 不包含 admin.notif.toggle
✅ _PERM_INFO 中有 admin.notif.entry 和 admin.notif.toggle 的說明
```

---

## 七、QA 驗收項目（手動）

### 正向驗收
- [ ] 抽屜選單「推播通知設定」顯示在「無效資料查詢」下方
- [ ] 未持有 `admin.notif.entry` 權限的用戶不顯示此選單項目（注意：抽屜選單判斷以 `permissionCode` 為準，`minRole` 僅為預設授權參考，非硬性角色鎖定）
- [ ] 頁面正確顯示所有開關與強制開啟項目
- [ ] 關閉 `activity` 類別後，執行報名 → 用戶不收到 LINE 推播，但 App 內訊息正常收到
- [ ] 關閉 `type_signup_success` 後，取消報名通知仍正常送（精準控制不相互影響）
- [ ] 強制開啟的候補遞補在 `activity` 類別關閉時仍正確送出
- [ ] 管理員廣播不受任何開關影響
- [ ] 儲存後重新整理頁面，設定持久化正確

### 回歸驗收
- [ ] 現有報名流程 App 內訊息功能不受影響（只有 LINE 推播被控制）
- [ ] `category_tournament` 預設為 `false`，現有行為不變
- [ ] Demo 模式下，守衛正常生效（與 Prod 一致）；因 `siteConfig/featureFlags` 的 `notificationToggles` 欄位初始不存在，安全降級為全開，console.log 照常輸出

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

*兩位審核者均已通過，計畫書初稿定稿。*

---

## 十、v1.1 三方交叉審核（架構師 × QA × 前端工程師）

> 針對 v1.0 計畫書進行程式碼級交叉驗證，三方一致同意的瑕疵修入計畫書，分歧項保留不改。

### 一致同意修入（8 項）

| # | 瑕疵 | 等級 | 修正摘要 |
|---|------|------|---------|
| 1 | `getNotificationToggles()` 存取 `_cache.siteConfig`（不存在） | P0 | 改用 `getCachedDoc('siteConfig', 'featureFlags')` |
| 2 | 未指定 siteConfig 文件 docId | P0 | 明確指定存放於 `siteConfig/featureFlags` |
| 3 | Firestore Rules 整段替換會破壞 Auto-EXP | P0 | 改為合併條件，保留現有 `isAdmin()` + `hasPerm('admin.auto_exp.entry')` |
| 4 | `admin.notif.toggle` 不會被 `getDefaultRolePermissions()` 自動授予 | P1 | 手動在函式中追加 super_admin 的 `admin.notif.toggle` |
| 5 | 缺少 `index.html` 的 `<script>` 載入 | P1 | 新增 Step 11 |
| 6 | `PAGE_DATA_CONTRACT` 混入 `strategy` 欄位 | P1 | 分別寫入 `PAGE_STRATEGY` 和 `PAGE_DATA_CONTRACT` |
| 7 | `_deferredPages` 缺少 `admin-notif` | P1 | 補入 Step 8 |
| 8 | Demo 模式守衛位置未決策 | P1 | 明確決策：守衛在 Demo 分支**之前** |

### 分歧保留（2 項）

| # | 瑕疵 | 架構師 | QA | 前端 | 保留理由 |
|---|------|--------|-----|------|---------|
| 9 | 缺少 `docs/architecture.md` 更新步驟 | ❌ | ❌ | ✅ | 架構師與 QA 認為屬 CLAUDE.md 通用規範，不需每份計畫書重複列出；前端認為應列入動用檔案一覽 |
| 11 | 通知類型列表可能不完整（遺漏 tournament 友誼賽通知） | ✅ | ✅ | ❌ | 架構師與 QA 認為應補齊完整列表；前端認為安全降級設計不影響正確性，可後續迭代補充 |

### 一致否決（1 項）

| # | 瑕疵 | 理由 |
|---|------|------|
| 10 | 缺少 `INHERENT_ROLE_PERMISSIONS` 同步考量 | 本次權限為 super_admin 等級，不涉及 coach/captain/venue_owner 的固有權限，無需修改 `INHERENT_ROLE_PERMISSIONS` |

---

## 十一、v1.2 二次審查（架構師 × QA × 安全工程師）

> 針對 v1.1 計畫書進行二次精讀，三方一致同意的瑕疵修入計畫書。

### 額外發現

架構師驗證確認：**Demo 模式確實會載入 siteConfig**（匿名登入通過 `isAuth()`），v1.1 分析中「Demo 不載入 siteConfig」的前提有誤。守衛在 Demo 下全放行的原因是 `featureFlags` 文件初始不含 `notificationToggles` 欄位，`getNotificationToggles()` 回傳 `{}`（安全降級為全開），而非 siteConfig 未被載入。

### 一致同意修入（6 項）

| # | 瑕疵 | 等級 | 修正摘要 |
|---|------|------|---------|
| A | 回歸驗收第 3 項與 Step 4 v1.1 決策文字矛盾 | P2 | 修正措辭：守衛正常生效，因 `notificationToggles` 初始不存在而安全降級為全開 |
| B | Step 6 `saveNotifSettings()` 未指定 docId 為 `featureFlags` | P1 | 統一為 `siteConfig/featureFlags` |
| C | 測試 6.4「任何人可讀取」與規則 `isAuth()` 矛盾 | P1 | 改為「已登入用戶（含匿名）可讀取」，補充「未登入用戶無法讀取」測試 |
| D | 測試 6.5 缺少 `admin.notif.toggle` 的 super_admin 驗證 | P1 | 新增測試項目 |
| E | Firestore Rules `admin.notif.toggle` 可寫入所有 siteConfig 文件 | P0 | 加入 `docId == 'featureFlags'` + `affectedKeys().hasOnly(['notificationToggles'])` 雙重限制 |
| F | Step 6 `saveNotifSettings()` 缺少本地快取同步說明 | P1 | 補充：寫入成功後同步 `_singleDocCache['siteConfig/featureFlags'].notificationToggles` |
