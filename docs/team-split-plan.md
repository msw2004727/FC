# 球衣顏色分隊功能計畫書

## 計畫起因

ToosterX 作為運動活動報名平台，核心場景是揪團打球（足球、籃球、排球等）。這類活動到場後的第一件事就是**分隊穿背心**，但目前系統只管「報名」，不管「分隊」，導致：

1. **現場耗時**：主辦到場後才用口頭或 Excel 分隊，20 人活動常花 5-10 分鐘
2. **人數失衡**：沒有事先規劃，常出現一邊多人一邊少人
3. **朋友分散**：純隨機分隊無法滿足「想跟朋友同隊」的需求
4. **重複工作**：每次活動都要重新分，無法沿用上次分組

在活動報名流程中內建分隊機制，讓主辦在活動前就完成分隊，用戶到場直接看手機就知道自己穿什麼顏色，是提升整體使用體驗的自然延伸。

---

## 設計原則

| 原則 | 說明 |
|------|------|
| **色彩 + 字母雙標識** | 色衣圖示尺寸 20x18px（SVG `viewBox="0 0 32 28"`，字母 `font-size="12"`），字母等效高度約 7.7px，Retina 螢幕（2x/3x）下可讀；色盲用戶透過字母 A/B/C/D 辨識隊伍 |
| **預設聰明** | 2 隊、紅藍、均分 — 主辦 3 秒完成設定 |
| **模式可疊加** | 三種分隊方式不互斥，主辦隨時可手動微調 |
| **最小侵入** | 開關式 + 既有欄位擴充，不改動報名核心流程 |
| **同行者友善** | 預設同隊，降低操作步驟 |
| **零干擾** | 未開啟分隊的活動，一切與現在完全相同 |
| **無獨立面板** | 分隊管理全部在活動詳情頁完成，不跳轉 |

---

## 三種分隊模式

三種模式的定位是「報名時的預設行為」，而非硬限制。不管選哪種模式，主辦/委託人在詳情頁都能手動調整。

| 模式 | 代碼 | 報名時用戶端行為 | 適用場景 |
|------|------|-----------------|----------|
| **用戶自選** | `self-select` | 報名時看到色票卡片，自己挑隊 | 朋友約好要同隊、友誼賽對抗 |
| **隨機分配** | `random` | 報名時自動平衡分配，顯示結果 | 輕鬆揪團、彼此不認識 |
| **主辦分配** | `manual` | 報名時不分隊，由主辦事後處理 | 教練依技能分組、特殊考量 |

---

## UX 設計

### 一、建立活動時 — 分隊設定

使用**開關式**（與既有的費用設定、性別限制等一致），預設關閉。開啟後展開分隊選項：

```
┌─────────────────────────────────┐
│  👕 分隊功能       [○==== 關]   │  ← 預設關，不干擾
└─────────────────────────────────┘

打開後展開：
┌─────────────────────────────────┐
│  👕 分隊功能       [====○ 開]   │
│  ┌─────────────────────────────┐│
│  │  隊伍數量    [ 2 ▾ ]       ││  ← 下拉 2/3/4（最多 4 隊）
│  │                             ││
│  │  🔴 A 隊    🔵 B 隊        ││  ← 色票，點擊換色
│  │  "紅隊"     "藍隊"         ││  ← 可選自訂名稱
│  │                             ││
│  │  報名時用戶可以：           ││
│  │  ┌──────┐ ┌──────┐ ┌────┐ ││
│  │  │ 自選 │ │ 隨機 │ │不選│ ││  ← 三選一
│  │  └──────┘ └──────┘ └────┘ ││
│  │                             ││
│  │  ☐ 各隊人數上限均分         ││
│  │                             ││
│  │  ┌─────────────────────────┐││  ← 僅「自選」模式顯示
│  │  │ 開始前 [ 2 ▾ ] 小時鎖定 │││  ← 下拉 1/2/3/6/12/24
│  │  └─────────────────────────┘││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

**預設值**：2 隊、紅 🔴 + 藍 🔵、隨機模式、均分開啟。主辦開啟開關後幾乎不用改。

**隊伍數量上限：4 隊**。涵蓋絕大多數運動場景，且確保 detail-grid 隊伍資訊卡不會將報名按鈕推出手機螢幕。

**色票選擇**：提供 8 個預設色 + 自訂色碼：

```
預設色（點擊即選）：
🔴 紅  🔵 藍  🟢 綠  🟡 黃  ⚪ 白  ⚫ 黑  🟠 橙  🟣 紫

自訂色碼（展開輸入）：
┌──────────────────────────────┐
│  自訂  [ #FF5733 ]  ■ 預覽  │
└──────────────────────────────┘
```

- 預設色對應常見球衣顏色，多數主辦直接點選即可
- 自訂色碼**只接受 6 位 HEX 格式**（`#RRGGBB`），不接受 3 位縮寫（如 `#F00`）
- **即時驗證**：輸入時逐字驗證正則 `^#[0-9A-Fa-f]{6}$`
- 無效格式時 input 顯示紅框（`border-color: #EF4444`）+ 下方提示「請輸入有效色碼，如 #FF5733」，提交按鈕 disabled
- 色塊預覽 20x20px 顯示在輸入框右側，即時更新
- stroke 自動計算：RGB 各通道 x 0.85（`_darkenHex(hex, 0.85)` 函式）
- 特殊色硬編碼：白色 stroke `#D1D5DB`、黑色 stroke `#9CA3AF`，不走通用加深演算法
- 渲染端防禦：`color.replace(/[^#0-9a-fA-F]/g, '')` 確保只有合法 HEX 字元進入 SVG
- **自訂色字母對比度自動計算**：依據 relative luminance 決定字母顏色——
  - 若 `luminance > 0.5`：字母使用深色 `#1F2937`，不加圓底
  - 若 `luminance <= 0.5`：字母使用白色 `#fff`，字母下方加半透明黑底圓 `<circle cx="16" cy="17" r="7" fill="rgba(0,0,0,0.35)"/>` 增強對比
  - 預設 8 色的字母顏色硬編碼（紅/藍/綠/黑/橙/紫 → 白字 + 圓底；黃/白 → 深色字母），不走動態計算

**自選鎖定時間**：選擇「自選」模式後，額外展開鎖定時間設定。活動開始前 N 小時，用戶不能再更改隊伍。預設 2 小時。

### 二、用戶報名時

#### 模式 A：自選隊伍 (`self-select`)

在報名按鈕**上方**插入選隊區塊：

```
┌─────────────────────────────────┐
│        選擇你的隊伍 👕          │
│                                 │
│  ┌─────────┐    ┌─────────┐    │
│  │  🔴 A   │    │  🔵 B   │    │
│  │  紅隊   │    │  藍隊   │    │
│  │  6/10人 │    │  8/10人 │    │
│  │  ████░░ │    │  ████████│    │
│  └─────────┘    └─────────┘    │
│       ↑ 已選                    │
│                                 │
│  ╔═══════════════════════════╗  │
│  ║     ✨ 立即報名 ✨        ║  │
│  ╚═══════════════════════════╝  │
└─────────────────────────────────┘
```

3-4 隊時分兩行排列（3-4 隊使用精簡布局：僅色塊 + 人數，不含進度條，節省高度）。

- 色票卡片要**大且顏色飽和**，一眼就懂
- 顯示目前人數 + 進度條（2 隊時），讓用戶自然看到平衡狀況
- 選中的卡片加粗框 + 微放大動畫
- **模式切換過渡**：先選 A 再改選 B 時，`transition: border .15s, transform .15s` 平滑過渡
- 開啟均分上限時，滿的隊伍卡片變灰 + 顯示「已滿」
- **已滿隊伍點擊觸發 shake 動畫**：`@keyframes shake { 0%,100%{translateX(0)} 20%,60%{translateX(-4px)} 40%,80%{translateX(4px)} }` 0.3s 後自動移除 class
- **未選隊時報名按鈕 disabled**：
  - 有隊可選 → 引導文字「請先選擇隊伍」
  - 所有隊已滿 → 引導文字「所有隊伍已額滿」（文字顏色 `#EF4444`）

**同行者分隊 UI**：

```
同行者：
☑ 小美（跟我同隊）
☑ 阿強（跟我同隊）
  └ [展開] 個別選隊
```

- 預設收合，顯示「跟我同隊」
- **主報名人未選隊時**，同行者區塊顯示「請先為自己選擇隊伍」，展開按鈕 disabled
- 展開後每個同行者 label 下方新增 `div.companion-team-picker`（flex wrap），**每人獨立渲染一組 inline 色票按鈕**（不共用 DOM）
- 4 同行者 + 4 隊極端情境：色票按鈕縮小至 24px（而非預設 28px），確保 375px 螢幕可容納
- 隨機/主辦模式下此區塊不顯示

#### 模式 B：隨機分配 (`random`)

報名流程完全不變，報名成功後 Toast 多一行：`你被分配到 🔴 A 隊`。此外，詳情頁膠囊旁**持續顯示色衣 badge** 作為永久參考，不依賴 Toast。

隨機演算法為**平衡分配**：放進目前人數最少的隊，而非純 `Math.random()`。

#### 模式 C：主辦分配 (`manual`)

報名流程完全不變，用戶在活動詳情頁看到：`👕 分隊狀態：主辦安排中...`。主辦分配完成後顯示隊伍結果。

### 三、活動詳情頁 — 整體佈局

```
detail-grid（人數/倒數/熱度/費用 + 隊伍資訊卡 + 批次操作）
  ↓
注意事項（如果有）
  ↓
action-zone
  ├── action-toolbar（聯繫主辦 | 分享活動 | 加入行事曆）
  └── action-primary（立即報名 — 滿寬主按鈕）
  ↓
報名名單簽到表（[👕] 排序 + [手簽]）
```

**螢幕空間預算**（iPhone 8，667px）：

| 隊數 | detail-grid 新增 | 自選色票區塊 | 報名按鈕前剩餘 | 狀態 |
|------|-----------------|-------------|---------------|------|
| 2 隊 | +72px | +80px（自選時） | ~205px / ~285px | 夠用 |
| 3-4 隊 | +112px | +120px（自選時） | ~125px / ~245px | 偏緊但可用 |

隨機/主辦模式不顯示色票區塊，剩餘空間更寬裕。

### 四、detail-grid — 隊伍資訊卡與批次操作

隊伍資訊卡用色衣 SVG（20px，內嵌字母）+ 人數，**純視覺**。2 隊一行，3-4 隊兩行。

批次操作三個純文字等寬按鈕（`隨機`/`補齊`/`重置`），總寬度等於一張資訊卡：

- **僅主辦/委託人可見**
- 三個操作都使用 `db.batch()` 確保原子性
- 「隨機」確認彈窗：「重新分隊不會通知參加者，確認繼續？」
- 操作進行中加 loading 狀態，防止連續點擊

**「補齊」演算法**：將所有 `teamKey: null` 的人按平衡分配（放入目前人數最少的隊），不動已分配的人。

---

### 五、報名名單 — 色衣 badge 與排序

#### 色衣 badge（20x18px Inline SVG + 字母標識）

在膠囊右上角破框位置，與左上角等級 badge 對稱。**尺寸 20x18px**（較等級 badge 略大，確保字母可讀）。

**無障礙：色衣內嵌字母與對比度**

- **深色底**（紅/藍/紫/黑/深綠）：白字 `#fff` + 半透明黑色圓底 `<circle cx="16" cy="17" r="7" fill="rgba(0,0,0,0.35)"/>`
- **淺色底**（白/黃/橙/淺綠）：深色字母 `#1F2937`，不需圓底
- **自訂色**：用 `luminance > 0.5` 判斷（深色底用白字+圓底，淺色底用深字）
- **未分配**：透明 fill + 灰色虛線 stroke + 「?」字母 `#9CA3AF`
- `aria-label` 與 `<title>` 統一為完整描述：`"A 隊 - 紅隊"`
- `role="img"`（不可點擊）或 `role="button" tabindex="0" aria-expanded`（可點擊）

完整 SVG 範例（深色底紅隊，可點擊）：

```svg
<svg class="uc-team-jersey clickable" viewBox="0 0 32 28"
     role="button" tabindex="0" aria-label="A 隊 - 紅隊" aria-expanded="false">
  <title>A 隊 - 紅隊</title>
  <path d="M10 1L1 6.5L4.5 9L5 25C5 26.1 5.9 27 7 27H25C26.1 27 27 26.1 27 25V9L30.5 6.5L22 1C22 1 20 5 16 5C12 5 10 1 10 1Z"
        fill="#EF4444" stroke="#DC2626" stroke-width="1"/>
  <circle cx="16" cy="17" r="7" fill="rgba(0,0,0,0.35)"/>
  <text x="16" y="20" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">A</text>
</svg>
```

**觸控區域**：`::before` 偽元素擴展為垂直 `-8px`、水平 `-15px`（約 50x34px），刻意避免垂直方向過大防止跨行重疊。

**CSS 歸屬**：`.uc-team-jersey` → `profile.css`；`.jersey-picker` → `activity.css`

#### 點擊區域分離

| 點擊位置 | 觸發行為 |
|----------|----------|
| **膠囊本體** | `App.showUserProfile()` → 用戶名片（既有） |
| **右上角色衣 SVG** | 展開色票選擇器 → 換隊（新增，僅主辦/委託） |

`onclick` 綁在 SVG 元素本身（非膠囊），`stopPropagation()` 攔截。

#### 色票選擇器

**滑出動畫**：從色衣位置向右展開（`transform-origin: left center`）。

**溢出處理**：
- **水平**：距右邊緣 < 選擇器寬度 + 8px → 向左翻轉（`.flip`，`transform-origin: right center`）
- **垂直**：距底部 < 40px → 向上偏移（`.shift-up`），避免被 LINE 瀏覽器底部工具列（44-56px）遮蔽

**鍵盤導航**：

| 按鍵 | 行為 |
|------|------|
| Enter/Space（焦點在色衣） | 開啟選擇器 |
| ArrowLeft/ArrowRight | 色票間移動焦點 |
| Enter/Space（焦點在色票） | 選擇該隊伍 |
| Escape | 關閉選擇器，焦點返回色衣 |

ARIA：色衣 `aria-expanded`、選擇器 `role="listbox"`、色票 `role="option"`、取消 `aria-label="取消分配，移除隊伍"`。

**DOM 管理**：全域單例 `App._jerseyPickerEl` + 事件委託。`_renderAttendanceTable()` 開頭呼叫 `_closeJerseyPicker()`。close 函式用 **named function** 做 `removeEventListener` 避免累積監聽器。

**CSS**（含 flip 初始態、垂直偏移）：

```css
/* profile.css */
.uc-team-jersey { position: absolute; top: -8px; right: -3px; width: 20px; height: 18px; pointer-events: none; z-index: 2; filter: drop-shadow(0 1px 1px rgba(0,0,0,.15)); }
.uc-team-jersey.clickable { pointer-events: auto; cursor: pointer; }
.uc-team-jersey.clickable::before { content: ''; position: absolute; top: -8px; right: -15px; bottom: -8px; left: -15px; }

/* activity.css */
.jersey-picker { position: absolute; top: 50%; transform-origin: left center; transform: scaleX(0) translateY(-50%); opacity: 0; transition: opacity .2s ease, transform .25s cubic-bezier(.34,1.56,.64,1); }
.jersey-picker.open { opacity: 1; transform: scaleX(1) translateY(-50%); }
.jersey-picker.flip { left: auto; right: 100%; transform-origin: right center; transform: scaleX(0) translateY(-50%); }
.jersey-picker.flip.open { transform: scaleX(1) translateY(-50%); }
.jersey-picker.shift-up { top: auto; bottom: 50%; transform: scaleX(0) translateY(50%); }
.jersey-picker.shift-up.open { transform: scaleX(1) translateY(50%); }
```

#### 自選模式鎖定提示

鎖定後，名單**頂部**顯示全域提示條（不在每人旁邊重複）：

```html
<div class="team-lock-banner" role="status" aria-live="polite">
  <span aria-hidden="true">🔒</span> 分隊已鎖定，無法自行更改
</div>
```

僅自選模式 + 鎖定後 + 用戶自己才看到。主辦/委託不看到。

#### 排序 toggle 與狀態管理

`[👕]` 按鈕 toggle 報名順序 ↔ 隊伍分組排序。狀態存 `App._attendanceSortByTeam`，切換活動時重設為 `false`（插入 `showEventDetail` 的 `id !== _currentDetailEventId` 分支後）。

#### 手簽互動

編輯模式下 `[👕]` disabled + 色衣不可點。排序維持進入前狀態。

| 活動設定 | 表頭按鈕 | 膠囊樣式 |
|----------|----------|----------|
| 沒開分隊 | `[手動簽到]` | 左上 Lv，右上無 |
| 有開分隊 | `[👕] [手簽]` | 左上 Lv，右上色衣 |

---

## 鎖定與權限機制

### 時間軸

```
活動建立 ──── 報名期間 ──── 鎖定時間 ──── 活動開始 ──── 活動結束
               │                │              │
         用戶可自選換隊    用戶不可改     全面鎖定（用戶）
         主辦隨時可改      主辦仍可改     主辦仍可改
```

### `_recalcTeamSplitTimestamps()` 統一維護

所有影響時間戳的操作都必須呼叫此函式：

| 操作 | 觸發位置 |
|------|----------|
| 建立活動 | `event-create.js` 提交 |
| 編輯活動時間 | `event-create.js` 更新 |
| 修改鎖定小時數 | `event-create.js` 更新 |
| 切換分隊模式 | `event-create.js` 更新 |
| 開關分隊功能 | `event-create.js` 更新 |

```javascript
function _recalcTeamSplitTimestamps(event) {
  const eventStart = parseEventStartDate(event.date);
  event.startTimestamp = eventStart;
  if (event.teamSplit?.enabled && event.teamSplit.mode === 'self-select') {
    const lockHours = event.teamSplit.selfSelectLockHours || 2;
    event.teamSplit.lockAt = new Date(eventStart.getTime() - lockHours * 3600000);
  } else {
    event.teamSplit.lockAt = null;
  }
}
```

### Firestore Rules（完整偽代碼）

#### 前置：delegateUids 扁平陣列

`delegates` 是 list of maps，Rules 無法遍歷。需新增 `delegateUids: ['uid1', 'uid2']`，4 處同步維護：

| # | 檔案 | 位置 | 操作 |
|---|------|------|------|
| 1 | `event-create.js` | ~L258 建立活動 | `delegateUids: delegates.map(d => d.uid)` |
| 2 | `event-create.js` | ~L319 編輯委託人 | 同步更新 |
| 3 | `firebase-crud.js` | `addEvent()` | 確保寫入包含 delegateUids |
| 4 | `firebase-crud.js` | `updateEvent()` | 若含 delegates 則同步計算 |

#### 前置：registration update 欄位白名單（修補既有漏洞）

```javascript
function isRegistrationSafeFieldsOnly() {
  return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['teamKey', 'updatedAt']);
}
```

取消報名用 `delete`，不受 update 規則影響。

#### registration.teamKey 寫入規則

```javascript
match /registrations/{regId} {
  function getEventData() {
    return resource.data.eventId is string
      ? get(/databases/$(database)/documents/events/$(resource.data.eventId)).data
      : null;
  }

  function isEventManagerTeamKeyUpdate() {
    let eventData = getEventData();
    return eventData != null
      && isAuth()
      && isTeamKeyOnlyUpdate()
      && (eventData.creatorUid == request.auth.uid
          || eventData.captainUid == request.auth.uid
          || eventData.ownerUid == request.auth.uid
          || (eventData.delegateUids is list && request.auth.uid in eventData.delegateUids));
  }

  function isSelfSelectTeamKeyUpdate() {
    let eventData = getEventData();
    return eventData != null
      && isRegistrationOwnerResource()
      && isRegistrationSafeFieldsOnly()
      && eventData.teamSplit is map
      && eventData.teamSplit.mode == 'self-select'
      && (eventData.teamSplit.lockAt == null || request.time < eventData.teamSplit.lockAt)
      && request.time < eventData.startTimestamp;
  }

  function isTeamKeyOnlyUpdate() {
    return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['teamKey', 'updatedAt']);
  }

  allow update: if
    isAdmin()
    || isEventManagerTeamKeyUpdate()
    || isSelfSelectTeamKeyUpdate()
    || ...existing rules...
}
```

get() 配額：路徑 2/3 各 1 次，加上既有 role 判斷 1-2 次，總計 3-4 次，低於 10 次限制。

---

## 邊界情境處理

### 候補遞補時的隊伍分配

| 模式 | 遞補行為 |
|------|----------|
| 自選 | 保留候補時的自選 |
| 隨機 | 呼叫 `_assignTeamKeyForPromotion` 分到人數最少的隊 |
| 主辦分配 | `teamKey: null`，等主辦處理 |

**4 條遞補路徑都必須處理 teamKey**：

| # | 函式 | 檔案 |
|---|------|------|
| 1 | `cancelRegistration()` | `firebase-crud.js` |
| 2 | `cancelCompanionRegistrations()` | `firebase-crud.js` |
| 3 | `_adjustWaitlistOnCapacityChange()` | `event-create-waitlist.js` |
| 4 | `_promoteSingleCandidateLocal()` | `event-create-waitlist.js` |

封裝純函式 `_assignTeamKeyForPromotion(event, simRegs, candidate)`，放在 `firebase-crud.js`，4 條路徑統一呼叫。

### 同行者（Companion）

- 預設同隊，`entries` schema 擴充 `teamKey` 欄位
- `_confirmCompanionRegister` 負責計算好 teamKey 再傳入 `batchRegisterForEvent`

**隨機模式語義衝突解決：同隊優先 > 均分上限（軟性）**

- 同行者跟主報名人同隊，即使超過 `balanceCap` 也允許（軟性上限）
- 前端顯示黃色警告「該隊人數略多」但不阻擋

### balanceCap（均分上限）

`balanceCap = Math.ceil(event.max / teamCount)`

- **自選模式**：硬性限制，transaction 內拒絕 → 錯誤碼 `TEAM_FULL`：「該隊已額滿，請選擇其他隊伍」
- **隨機模式**：軟性允許（同行者同隊優先），記錄警告但不阻擋
- **已知限制**：自選併發下可能短暫超額 1-2 人，前端 onSnapshot 即時顯示滿隊可降低機率

### 取消報名

取消者從隊伍移除，不觸發自動重新平衡。主辦可用「補齊」手動處理。

### 競態條件

- 兩管理者同時批次操作：後寫覆蓋，最終一致可接受
- 鎖定邊界：`request.time` 伺服器端判斷，正確拒絕
- 用戶自選 + 主辦同時改：後寫覆蓋，站內信可緩解

#### batch 操作紀律（強制規則）

| # | 規則 |
|---|------|
| 1 | 只改 `teamKey` + `updatedAt`，禁碰 `status`/`registeredAt` 等核心欄位 |
| 2 | 不觸發 `_rebuildOccupancy` |
| 3 | 操作前從 Firestore 查詢最新 registrations（禁依賴快取） |
| 4 | batch 內不可混入非 registration 的寫入 |

---

## Cloud Function 同步改動

`functions/index.js` 的 `registerForEvent` CF 需同步支援分隊。CF 與客戶端走不同報名路徑，若 CF 不同步，LINE 通知直接報名的用戶將缺少 `teamKey`。

### 改動範圍

| # | 項目 |
|---|------|
| 1 | 讀取 `event.teamSplit` |
| 2 | 根據 mode 決定 teamKey（`self-select` 從 request body；`random` 呼叫 `_resolveTeamKey`；`manual` 寫 `null`） |
| 3 | `balanceCap` 檢查（自選硬性拒 `TEAM_FULL`；隨機軟性允許） |
| 4 | 回傳 registration 包含 `teamKey` |
| 5 | 候補遞補路徑同步呼叫 `_resolveTeamKey` |

### `_resolveTeamKey` 共用純函式

客戶端放 `event-team-split.js`，CF 端放 `functions/index.js` 內聯。演算法必須完全一致，修改時兩端同步更新。

```javascript
function _resolveTeamKey(event, allEventRegs, options = {}) {
  if (!event.teamSplit?.enabled) return undefined;
  if (event.teamSplit.mode === 'self-select') return options.userSelectedTeamKey || null;
  if (event.teamSplit.mode === 'manual') return null;
  // random：平衡分配到人數最少的隊
  const counts = {};
  event.teamSplit.teams.forEach(t => { counts[t.key] = 0; });
  allEventRegs.filter(r => r.status === 'confirmed' && r.teamKey)
    .forEach(r => { counts[r.teamKey] = (counts[r.teamKey] || 0) + 1; });
  return event.teamSplit.teams.reduce((min, t) =>
    (counts[t.key] || 0) < (counts[min.key] || 0) ? t : min
  ).key;
}
```

---

## 通知機制

| 觸發情境 | 站內信 | LINE |
|----------|--------|------|
| `manual` 首次分配 | 「你在『{event}』中被分配到 {team}」 | 不發送 |
| `manual` 換隊 | 「你在『{event}』中被換到 {team}」 | 不發送 |
| `self-select` 用戶自選 | 不發送 | 不發送 |
| `random` 報名分配 | 不發送（Toast 已顯示） | 不發送 |
| 批次「隨機」 | 不發送 | 不發送 |

---

## i18n 鍵值表

所有使用者可見文字以 `teamSplit.` 為前綴：

### 建立表單

| key | 中文 | 英文 |
|-----|------|------|
| `teamSplit.toggle.label` | 分隊功能 | Team Split |
| `teamSplit.teamCount.label` | 隊伍數量 | Number of Teams |
| `teamSplit.mode.label` | 報名時用戶可以 | Players can |
| `teamSplit.mode.selfSelect` | 自選隊伍 | Choose team |
| `teamSplit.mode.random` | 隨機分配 | Random |
| `teamSplit.mode.manual` | 主辦分配 | Host assigns |
| `teamSplit.balanceCap.label` | 各隊人數上限均分 | Balance team size |
| `teamSplit.lockHours.label` | 開始前 {n} 小時鎖定 | Lock {n}h before start |
| `teamSplit.color.custom` | 自訂 | Custom |
| `teamSplit.color.invalidHex` | 請輸入有效色碼，如 #FF5733 | Enter valid hex |

### 報名流程

| key | 中文 | 英文 |
|-----|------|------|
| `teamSplit.select.title` | 選擇你的隊伍 | Choose your team |
| `teamSplit.select.full` | 已滿 | Full |
| `teamSplit.select.required` | 請先選擇隊伍 | Select a team first |
| `teamSplit.select.allFull` | 所有隊伍已額滿 | All teams full |
| `teamSplit.random.assigned` | 你被分配到 {team} | Assigned to {team} |
| `teamSplit.companion.sameTeam` | 跟我同隊 | Same team as me |
| `teamSplit.companion.expand` | 個別選隊 | Choose individually |
| `teamSplit.companion.selectFirst` | 請先為自己選擇隊伍 | Select your team first |

### 詳情頁

| key | 中文 | 英文 |
|-----|------|------|
| `teamSplit.status.pending` | 主辦安排中... | Host is assigning... |
| `teamSplit.lock.notice` | 分隊已鎖定，無法自行更改 | Team locked |
| `teamSplit.batch.random` | 隨機 | Shuffle |
| `teamSplit.batch.fill` | 補齊 | Fill |
| `teamSplit.batch.reset` | 重置 | Reset |
| `teamSplit.batch.confirmRandom` | 重新分隊不會通知參加者，確認繼續？ | Reshuffle won't notify. Continue? |
| `teamSplit.batch.confirmReset` | 確定清除所有隊伍分配？ | Clear all assignments? |
| `teamSplit.unassigned` | 未分配 | Unassigned |
| `teamSplit.picker.unassign` | 取消分配 | Remove assignment |

### 通知與錯誤

| key | 中文 | 英文 |
|-----|------|------|
| `teamSplit.notify.assigned` | 你在『{event}』中被分配到 {team} | Assigned to {team} in '{event}' |
| `teamSplit.notify.switched` | 你在『{event}』中被換到 {team} | Switched to {team} in '{event}' |
| `teamSplit.error.eventFull` | 此活動報名已額滿 | Event is full |
| `teamSplit.error.teamFull` | 該隊已額滿，請選擇其他隊伍 | Team full, choose another |

---

## 與既有功能整合

| 功能 | 整合方式 |
|------|----------|
| **活動詳情頁** | detail-grid 隊伍資訊卡 + 批次操作 + 膠囊色衣 + 點擊換隊 + [👕] 排序 |
| **LINE 分享** | Flex Message 增加「🔴A 8 vs 🔵B 7」 |
| **活動列表** | 不顯示分隊資訊 |
| **活動模板** | 初版不存（`teamSplit` 獨立物件，未來可直接整包存入） |
| **管理端/排行榜** | 不加色衣標示 |

---

## 資料模型

### Event 擴充

```javascript
event.teamSplit = {
  enabled: true,
  mode: 'self-select' | 'random' | 'manual',
  balanceCap: true,
  selfSelectLockHours: 2,         // 僅 self-select
  lockAt: Timestamp | null,       // 僅 self-select
  teams: [
    { key: 'A', color: '#EF4444', name: '紅隊' },
    { key: 'B', color: '#3B82F6', name: '藍隊' }  // 最多 4 隊
  ]
}
event.startTimestamp = Timestamp;
event.delegateUids = ['uid1', 'uid2'];  // 與 delegates[] 同步
```

**teamKey null 語義**：`undefined` = 未開分隊；`null` = 已開但未分配；`'A'-'D'` = 已分配

### Registration 擴充

```javascript
registration.teamKey = 'A' | 'B' | 'C' | 'D' | null
```

### 複合索引

不建立。客戶端過濾（< 50 人），`where('eventId', '==', id)` 單欄位索引已足夠。

### 模組與函式歸屬

| 函式/模組 | 位置 |
|-----------|------|
| `jerseySvg()`, `_darkenHex()`, `isLightColor()` | `event-team-split.js` |
| `_renderTeamSelectUI(event, summary, {canManage, isLocked})` | `event-team-split.js`（回傳 HTML） |
| `_resolveTeamKey()` | `event-team-split.js` + `functions/index.js`（各一份） |
| `_assignTeamKeyForPromotion()` | `firebase-crud.js` |
| `_recalcTeamSplitTimestamps()` | `event-create.js` |
| ScriptLoader 註冊 | `script-loader.js` → `_groups.activity` 加入新模組 |
| `_userTag` 改造 | `profile-core.js` — 第三參數 options `{ teamKey, teams }` |

---

## 預覽檔案

`docs/team-split-preview.html`（瀏覽器直接開啟）：主辦視角 + 用戶視角 + 深色模式。

---

## 進度追蹤

### 已完成

- [x] 計畫書初版（2026-03-31）
- [x] 第一輪三方審計（UX 6.5 / 後端 5.5 / 前端 7.5）
- [x] 第一輪審計問題修進計畫書
- [x] 第二輪五方審計（UX 7 / Firestore 7.5 / 前端 8 / 報名 7 / 無障礙 5）
- [x] 第二輪審計問題全面修進計畫書（含 CF 同步、i18n、Rules 重構、對比度、鍵盤導航）
- [x] 設計原型預覽 (docs/team-split-preview.html)

### 待進行

- [ ] 第三輪審計（換設備後）
- [ ] Firestore Rules 實作與測試
- [ ] delegateUids 同步維護（4 處路徑）
- [ ] registration update 欄位白名單修補
- [ ] Cloud Function registerForEvent 同步改動
- [ ] 前端模組開發 (event-team-split.js)
- [ ] _userTag 改造（第三參數 options）
- [ ] i18n 鍵值新增（~30 keys）
- [ ] CSS 新增 (profile.css + activity.css)
- [ ] 4 條遞補路徑加入 teamKey 處理
- [ ] 整合測試
- [ ] 版本號更新與部署

---

## 待定項目

- [ ] 多日活動「沿用上次分隊」是否納入初版

---

*計畫建立日期：2026-03-31*
*最後更新：2026-04-01*
*狀態：第二輪審計修正完成，待第三輪審計*
