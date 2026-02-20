# 同行者報名功能 — 修改計劃（確認版）

> 狀態：**確認版（待實作）**
> 日期：2026-02-20
> 需求：用戶可替旗下同行者（孩子、臨時朋友等）一起報名活動，各自計費、各自簽到、可個別或群體取消。

---

## 已確認決策

| 決策項目 | 確認結果 |
|---------|---------|
| 附屬報名稱呼 | **同行者**（英文欄位名稱：`companion`） |
| `participants[]` 名稱格式 | 純名稱（方案A），名單顯示改由 `registrations` 組裝 |
| 票價設計 | 單一費率，不設兒童票價，同行者與本人費用相同 |
| QR Code 設計 | 掃帳號持有人 UID，由系統帶出同行者清單，不另外產生個人 QR |
| 個人統計範圍 | 同行者完全排除於統計之外，參加場次 / 完成數 / 出席率 / EXP 只計帳號持有人本人 |
| 同行者紀錄保留 | registrations / attendanceRecords 仍記錄同行者，用途限於計費與名單顯示 |
| **同行者年齡設計** | **不設計**，同行者無年齡欄位，不做年齡限制驗證 |
| **多人報名寫入** | 使用 **Batch Write** 確保多筆 registration + 名額更新的原子性 |

---

## 一、核心資料結構變更

### 1-A. User 新增 `companions` 陣列

```javascript
// users/{userId}
{
  // ... 現有欄位不動 ...
  companions: [
    {
      id: 'cp_abc123',   // 本地 UUID，由 generateId() 產生
      name: '小明',
      gender: '男',      // 選填
      notes: '對花生過敏' // 選填：健康備註 / 緊急聯絡事項
    },
    // ...
  ]
}
```

> **儲存位置**：存在 user 文件內（不建獨立子集合）。
> 無年齡/生日欄位，同行者為臨時性質，不做年齡管理。

---

### 1-B. Registration 記錄新增參與者欄位

```javascript
// registrations/{regId}  ← 現有集合，擴充欄位
{
  id: 'reg_...',
  eventId: 'e4',
  userId: 'U123abc',       // 帳號持有人 UID（聯絡方）
  userName: '王小明',       // 帳號持有人名稱

  // ★ 新增欄位
  participantType: 'self', // 'self' | 'companion'
  companionId: null,       // companion 時填 companions[].id；self 填 null
  companionName: null,     // companion 時填同行者名稱；self 填 null

  status: 'registered',    // 'registered' | 'waitlisted' | 'cancelled'
  registeredAt: '2026/02/20 10:00',  // ★ 新增：報名時間戳（候補排序依據）
  _docId: 'firebase_doc_id'
}
```

> **一人一筆**：A用戶 + B同行者 + C同行者報名同一活動 → 產生 **3筆** 獨立 registration 記錄。
> **Batch Write**：3 筆 registration 寫入 + 名額更新，在同一個 batch 內完成，確保原子性。

---

### 1-C. AttendanceRecord 新增參與者欄位

```javascript
// attendanceRecords ← 現有，擴充欄位
{
  id: 'att_...',
  eventId: 'e4',
  uid: 'U123abc',          // 帳號持有人 UID
  userName: '王小明',

  // ★ 新增欄位
  participantType: 'self', // 'self' | 'companion'
  companionId: null,       // companion 時填 companions[].id
  companionName: null,     // companion 時填同行者名稱

  type: 'checkin',         // 'checkin' | 'checkout' | 'unreg'
  time: '2026/02/22 13:55'
}
```

---

### 1-D. 計費公式修改（應收 / 實收 / 短收）

**現行公式（只算正取人數，不含同行者）：**
```javascript
feeExpected = fee * e.current   // e.current = 正取名單長度
feeActual   = fee * checkoutCount
```

**新公式（改從 registrations 計算，同行者一併納入）：**
```javascript
// ⚠️ 計費來源：registrations 集合，非 e.current
// 應收：該活動所有 status==='registered' 的記錄筆數（含同行者）
const totalRegistered = registrations
  .filter(r => r.eventId === e.id && r.status === 'registered').length;
feeExpected = fee * totalRegistered;

// 實收：checkout 記錄筆數（含同行者各自的 checkout）
const totalCheckedOut = attendanceRecords
  .filter(r => r.eventId === e.id && r.type === 'checkout').length;
feeActual = fee * totalCheckedOut;

feeShort = feeExpected - feeActual;
```

> `e.current` 與 `e.participants[]` 仍沿用為「名額計數」，每位參與者各佔一個名額，行為不變。
> 計費改由 `registrations` 集合精確計算，管理端介面需標示「計費來源：報名記錄」避免維護混淆。

---

### 1-E. 個人統計範圍（同行者排除）

```javascript
// 參加場次、完成數、出席率、EXP — 只計算本人
const selfRegistrations = registrations.filter(
  r => r.userId === uid && r.participantType === 'self'
);

// ❌ 不計入：companion 的報名、簽到、簽退
// ✅ companion 的 registration / attendanceRecord 僅保留供計費與名單使用
```

---

## 二、需修改的檔案清單

| 檔案 | 修改性質 | 說明 |
|------|---------|------|
| `js/data.js` | 擴充 | demo user 加 `companions[]`；demo registrations 加新欄位 |
| `js/api-service.js` | 擴充 | 新增 companion CRUD；`registerEventWithCompanions` 使用 batch write |
| `js/firebase-crud.js` | 擴充 | 新增 `updateUserCompanions()`；新增 `batchRegister()` |
| `js/modules/event-render.js` | 重構 | `handleSignup` 改為先顯示同行者選擇 Modal；`handleCancelSignup` 改版 |
| `js/modules/event-manage.js` | 修改 | 計費公式更新；名單改為分組顯示；加計費來源標示 |
| `js/modules/scan.js` | 擴充 | 掃描後顯示同行者清單，可個別勾選簽到 |
| `js/modules/profile-data.js` | 擴充 | 新增同行者管理 UI（CRUD） |
| `pages/modals.html` | 新增 | 同行者選擇 Modal；同行者管理 Modal；取消選擇 Modal |
| `pages/personal-dashboard.html` | 擴充 | 新增「我的同行者」區塊 |
| `index.html` + `js/config.js` | 必改 | 更新快取版本號 |

---

## 三、各功能詳細設計

### 3-A. 個人資料頁 — 同行者管理

**位置**：`個人資料` 頁內新增「我的同行者」可收折區塊（與「我的收藏」同設計模式）

**UI 結構：**
```
▼ 我的同行者 (2)
┌─────────────────────────────┐
│  小明  男  [編輯][刪除]      │
│  小華  女  [編輯][刪除]      │
└─────────────────────────────┘
[+ 新增同行者]
```

**新增/編輯 Modal 欄位：**
- 姓名（必填）
- 性別（選填）
- 備註（選填，健康狀況、緊急聯絡）

**API 操作：**
```javascript
ApiService.addCompanion(companionData)        // push to user.companions[]
ApiService.updateCompanion(companionId, data)
ApiService.deleteCompanion(companionId)       // 若有進行中報名則警示
```

---

### 3-B. 活動報名流程 — 同行者選擇

**現行流程：** 按「報名」→ 直接報名

**新流程：**
```
按「報名」
    │
    ▼
[有同行者?]──否──→ 直接報名（維持現行行為）
    │是
    ▼
顯示「報名選人」Modal
┌──────────────────────────────────────┐
│  選擇參與者                           │
│  活動：週六足球友誼賽（費用：NT$300/人）│
│                                      │
│  ☑ 我自己（王小明）                   │
│  ☑ 小明                              │
│  ☐ 小華                              │
│                                      │
│  已選 2 人  預計費用 NT$600            │
│  剩餘名額：6 / 22                     │
│                                      │
│        [取消]    [確認報名]           │
└──────────────────────────────────────┘
    │
    ▼
Batch Write：依選擇逐一建立 registration 記錄 + 更新名額
（每人一筆，participantType: 'self' 或 'companion'）
```

**名額顯示**：勾選後即時更新「剩餘名額」，若選擇人數超過剩餘名額，超出者自動改為候補（顯示提示）。

**注意**：帳號持有人可以不勾選自己，單純替同行者報名。

---

### 3-C. 取消報名 — 個別 & 群體

**現行流程：** 按「取消報名」→ 直接取消自己

**新流程：**
```
按「取消報名」
    │
    ▼
查詢 registrations 找出本人在此活動的所有報名（含同行者）
    │
    ├─ 只有自己（無同行者） → 直接取消（維持現行行為）
    │
    └─ 有同行者 → 顯示「取消報名」Modal
       ┌──────────────────────────────────────┐
       │  取消報名 — 週六足球友誼賽            │
       │                                      │
       │  ☑ 我自己（王小明）   正取            │
       │  ☑ 小明              正取            │
       │                                      │
       │  [全選]                              │
       │        [返回]    [確認取消]           │
       └──────────────────────────────────────┘
           │
           ▼
       Batch Write：取消勾選的參與者 registration status → 'cancelled'
       名額釋出 → 候補補位（依 registeredAt 排序，逐一晉升）
```

---

### 3-D. 活動名單 — 分組顯示

**現行顯示：**
```
1. 王小明  ✅ 已簽退
2. 小明
3. 李小芳  📍 已簽到
```

**新顯示（按帳號持有人分組，由 registrations 組裝）：**
```
1. 👤 王小明       ✅ 已簽退
      ↳ 小明        📍 已簽到
2. 👤 李小芳       📍 已簽到
```

**計費摘要（名單下方，標示計費來源）：**
```
正取人數：3（王小明、小明、李小芳）
應收：NT$900（3 × NT$300）  ← 計費來源：報名記錄
實收：NT$600（2 人簽退）
短收：NT$300
```

> `participants[]` 僅作名額計數，名單顯示完全改由 `registrations` 依 `userId` 分組組裝。

---

### 3-E. QR Code 簽到 — 同行者代簽

**方案**：掃描帳號持有人的 QR Code → 系統找出該帳號在此活動的所有 registration 記錄 → 顯示可勾選的參與者清單 → 為每位勾選者建立獨立 attendanceRecord。

**三種情境：**

| 情境 | 行為 |
|------|------|
| 掃到 UID，只有**自己**報名 | 直接簽到（維持現行，不顯示選單） |
| 掃到 UID，**自己 + 同行者**都報名 | 顯示選單，可個別勾選 |
| 掃到 UID，**只有同行者**報名（自己未報名） | 顯示選單，清單內只有同行者（無「自己」選項） |

**簽到選單 UI：**
```
掃描王小明的 QR Code
    │
    ▼
┌──────────────────────────────────────┐
│  王小明 的報名（週六足球友誼賽）       │
│                                      │
│  ☑ 王小明（自己）  尚未簽到           │
│  ☑ 小明           尚未簽到           │
│                                      │
│        [確認簽到]                    │
└──────────────────────────────────────┘
    │
    ▼
為每位勾選者建立獨立 attendanceRecord
{ participantType, companionId, companionName 各自帶入 }
```

> **同行者的簽到/簽退記錄**：僅用於計費（實收計算），不影響帳號持有人的出席率統計。

---

### 3-F. 報名歷史 — 同行者分組顯示

**位置**：個人資料頁「我的報名紀錄」改版

**顯示方式**：以活動為單位，同行者列在本人紀錄之下。

```
▼ 我的報名紀錄

週六足球友誼賽  2026/02/14
  ✅ 我自己（王小明）   已完成
     ↳ 小明            已完成
     ↳ 小華            已取消

週日籃球賽     2026/02/21
  ⏳ 我自己（王小明）   候補（第 2 位）
```

**統計數字**（個人資料頁統計區塊）：
```javascript
// 參加場次、完成數、出席率：只計 participantType === 'self'
const myRegistrations = registrations.filter(
  r => r.userId === uid && r.participantType === 'self'
);
// 同行者的紀錄僅顯示於歷史清單，不納入個人統計數字
```

---

### 3-G. 活動通知群發

**原則**：同一帳號只發一則通知給帳號持有人（不因同行者數量重複發送）。

| 事件 | 通知對象 | 內容 |
|------|---------|------|
| 活動取消 | 每個 userId（唯一）各一則 | 「XXX 活動已取消，您與同行者共 N 人報名已自動取消」 |
| 活動時間修改 | 同上 | 「XXX 活動時間已更改，請確認是否繼續參加」 |
| 候補晉升（本人） | 該 registration 的 userId | 「您已從候補晉升為正取」 |
| 候補晉升（同行者） | 該 registration 的 userId | 「您的同行者 [名稱] 已從候補晉升為正取」 |
| 報名成功 | 報名的 userId | 「報名成功（共 N 人）」 |

**去重邏輯**：
```javascript
const notifyTargets = new Set(affectedRegistrations.map(r => r.userId));
notifyTargets.forEach(uid => sendNotification(uid, message));
```

---

## 四、實作順序

```
Phase 1：資料層基礎（無 UI，低風險）
  ├─ 1. data.js — demo user 加 companions[]；demo registrations 加新欄位
  ├─ 2. api-service.js — 新增 companion CRUD、registerEventWithCompanions（batch）
  └─ 3. firebase-crud.js — updateUserCompanions()；batchRegister()

Phase 2：個人資料 — 同行者管理（獨立功能，不影響報名）
  ├─ 4. pages/modals.html — 新增同行者管理 Modal
  ├─ 5. pages/personal-dashboard.html — 新增「我的同行者」區塊
  └─ 6. profile-data.js — 同行者 CRUD UI

Phase 3：報名 & 取消流程（核心變更）
  ├─ 7. pages/modals.html — 新增同行者選擇 Modal & 取消選擇 Modal
  └─ 8. event-render.js — handleSignup & handleCancelSignup 改版

Phase 4：名單 & 計費（管理端）
  └─ 9. event-manage.js — 計費公式 + 名單分組顯示 + 計費來源標示

Phase 5：QR 簽到
  └─ 10. scan.js — 同行者代簽流程

Phase 6：通知 & 歷史
  ├─ 11. 通知邏輯去重
  └─ 12. 報名歷史同行者分組顯示
```

---

## 五、邊界情境 & 注意事項

| 情境 | 處理方式 |
|------|---------|
| 刪除同行者但該同行者有進行中報名 | 顯示警示，列出衝突的活動；建議先取消報名再刪除 |
| 候補晉升後名額不足以全部晉升 | 逐一晉升（依 registeredAt 排序），超出部分維持候補 |
| 帳號持有人未報名，只替同行者報名 | 允許；self 不勾選，只勾選同行者；統計不影響本人 |
| 同行者未簽到/簽退 | 不影響帳號持有人統計；計費以 attendanceRecord 為準（未簽退即短收） |
| 掃碼時只有同行者報名（情境三） | 掃到 UID 後顯示選單，清單內只有同行者，無「自己」選項；程式不因找不到 self 記錄而異常 |
| Batch Write 部分失敗 | Firebase batch 具備全有或全無特性，失敗時整批 rollback，前端顯示錯誤提示 |
| Demo 模式驗證 | demo data 需包含 companion-type registrations 以供前端完整驗證 |

---

*最後更新：2026-02-20（確認版 v2）*
