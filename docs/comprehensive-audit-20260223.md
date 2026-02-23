# SportHub 全面審計報告與建議企劃書

> **審計日期**：2026-02-23
> **範圍**：活動 / 賽事 / 球隊 / 後台管理功能 BUG + 安全性與隱私
> **狀態**：審計完成，待決策

---

## 一、審計統計摘要

| 分類 | 嚴重 | 高 | 中 | 低 | 合計 |
|------|------|-----|-----|-----|------|
| 活動頁面 | 2 | 5 | 4 | 4 | 15 |
| 賽事 & 球隊 | 0 | 6 | 9 | 10 | 25 |
| 後台管理 | 3 | 3 | 14 | 3 | 23 |
| 安全性 & 隱私 | 3 | 9 | 9 | 5 | 26 |
| **合計** | **8** | **23** | **36** | **22** | **89** |

---

## 二、最高優先修復項目（嚴重等級）

### 2.1 ~~event-render.js 重複定義問題（嚴重 A1+A2）~~ ✅ 已修復

**修復方式**：確認 `event-render.js` 為孤立檔案（未被 index.html 或 script-loader.js 載入），所有函式已正確拆分至 `event-list.js`、`event-detail.js`、`event-detail-signup.js`、`event-detail-companion.js`。已刪除孤立檔案並更新依賴註解。

### 2.2 ~~Firestore Security Rules 全面重寫（嚴重 S1+S2+S3）~~ ✅ 已改善

**修復方式**：全面重寫 `firestore.rules`，29 個集合各自定義規則，消除 catch-all 萬用規則。改善項目：
- 固定 slot 集合（banners/sponsors/siteThemes 等）禁止刪除
- 日誌集合（expLogs/teamExpLogs/operationLogs）改為 append-only
- 禁止從前端刪除 users 和 attendanceRecords
- 建立時驗證必要欄位與資料型別
- 阻擋 ghost user（`userId = 'unknown'`）寫入
- 未列出的集合一律拒絕

**仍有限制**：因使用 Anonymous Auth，`request.auth.uid` ≠ LINE userId，無法做 owner 和 role 驗證。長期需改用 Custom Claims。

### 2.3 後台管理權限缺口（嚴重 B1+B2+B3）— ✅ 已修復

**修復內容**（20260223s）：
已在約 30 個後台管理函式開頭加入統一權限 guard，依最低角色分級：
- **coach**：`handleCreateTournament`、`handleSaveEditTournament`、`handleCreateEvent`
- **admin**：`handleEndTournament`、`handleReopenTournament`、公告 CRUD（5 函式）、廣告管理（`delistAd`、`clearAdSlot`、`editBannerItem`、`saveBanner`、`editFloatingAd`、`editPopupAd`、`saveSponsorRow`、`editSponsorItem`）
- **super_admin**：角色管理（4 函式）、EXP 管理（4 函式）、用戶編輯（2 函式）、`clearThemeSlot`、`saveAutoExpRules`、`clearAllData`

```javascript
if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.{minRole}) {
  this.showToast('權限不足'); return;
}
```

---

## 三、高優先修復項目

### 3.1 活動名額判斷 off-by-one（A3）
- `event-render.js:949` — `e.current > e.max` 改為 `e.current >= e.max`

### 3.2 候補人數雙重計算（A4）
- `event-render.js:941` — 移除重複加法

### 3.3 Race Condition 修復（B4+B5+T1）
- `event-create.js:644-646` — 候補遞補 Firebase 寫入改為 `await`
- `user-admin-exp.js:149-151` — 批次 EXP 改用 `Promise.all` 或序列 await
- `tournament-render.js:285` — 報名加入 debounce 或按鈕 disable

### 3.4 球隊成員數初始化（T5）
- `team-form.js:392` — 建立時正確計算隊長+教練數量

### 3.5 賽事狀態邊界（T4）
- `tournament-manage.js:18` — 調整邊界條件並加入 undefined 防護

### 3.6 XSS 修復（S8+S9）
- 所有 onclick handler 中的動態值統一經過 `escapeHTML()`
- 圖片 URL 加入 scheme 驗證（只允許 https: 和 data:image/）

### 3.7 Firebase 認證加強（S3+S10）
- 建議：改用 LINE 登入取得 Custom Token 後做 `signInWithCustomToken()`，取代 `signInAnonymously()`
- 需要 Cloud Functions 做 LINE ID Token 驗證 → 產生 Firebase Custom Token

---

## 四、中期改善項目

### 4.1 Demo/Production 行為一致性
| 項目 | 說明 |
|------|------|
| event-render.js 舊版清理 | 移除所有與 signup/companion 相關的重複函式 |
| Demo 報名路徑 | 統一走 registerEventWithCompanions，確保 registrations 同步 |
| 退隊同步 | 清除所有 user 引用（currentUser.teamId 等） |

### 4.2 資料驗證強化
| 項目 | 說明 |
|------|------|
| EXP 邊界 | 加入 min/max 驗證（如 -99999 ~ 99999） |
| 賽事日期 | 驗證 regStart < regEnd |
| 賽事隊數 | 加入 min=2 max=128 限制 |
| 贊助商 URL | 驗證 URL 格式（https:// 開頭） |
| 檔案大小提示 | 統一 UI 與程式碼的限制數值 |

### 4.3 Null Safety 全面加固
| 檔案 | 行 | 修復 |
|------|-----|------|
| `event-detail.js` | 38 | `FirebaseService._cache?.registrations?.length` |
| `user-admin-list.js` | 19-20 | `(u.name \|\| '').toLowerCase()` |
| `user-admin-roles.js` | 304 | `ApiService.getAdminUsers() \|\| []` |
| `ad-manage-popup-sponsor.js` | 176 | `input.closest(...)?.querySelector(...)` |
| `event-create.js` | 651 | `event.participants = event.participants \|\| []` |
| `tournament-manage.js` | 12-20 | regStart/regEnd undefined 防護 |

### 4.4 隱私保護
| 項目 | 說明 |
|------|------|
| Firestore 規則分層 | messages/registrations 加入收件人/參與者限制 |
| 個人資料最小化 | 只在需要時才將 email/phone 寫入 Firestore |
| localStorage 敏感欄位 | 不存角色和完整 profile，改存最小必要欄位 |
| console.log 清理 | 移除 production 環境中的個資 log |

---

## 五、長期架構建議

### 5.1 伺服器端權限驗證（最重要）
- 使用 Firebase Custom Claims 儲存角色（auth token 內建，不可篡改）
- Cloud Functions 處理敏感操作（角色變更、EXP 調整、賽事管理）
- Firestore Rules 用 `request.auth.token.role` 做權限判斷

### 5.2 前端架構清理
- 消除 event-render.js 的重複函式
- 統一 Demo/Production 資料流（全部經過 ApiService）
- 統一 ID 生成機制（加入 random component 避免碰撞）

### 5.3 CDN 安全
- html5-qrcode 加入 Subresource Integrity (SRI)
- 考慮 self-host 關鍵 CDN 資源

---

## 六、建議實施順序

```
Phase 0（立即）：修復 event-render.js 重複定義
  └─ 風險最高、影響最大、改動最小

Phase 1（1-2 週）：安全性基礎
  ├─ Firestore Security Rules 重寫
  ├─ 後台函式權限 guard
  ├─ XSS 修復（onclick + image URL）
  └─ Firebase 認證改用 Custom Token

Phase 2（2-3 週）：邏輯 BUG 修復
  ├─ 名額 off-by-one
  ├─ Race condition（await 化）
  ├─ 球隊成員數
  ├─ 賽事狀態邊界
  └─ 候補人數雙重計算

Phase 3（3-4 週）：資料驗證 & null safety
  ├─ 全面 null check
  ├─ 表單驗證強化
  └─ Demo/Prod 一致性

Phase 4（長期）：架構演進
  ├─ Custom Claims + Cloud Functions
  ├─ event-render.js 重構
  └─ 隱私保護強化
```

---

## 七、docs/ 文件現況審查

| 檔案 | 建議 | 原因 |
|------|------|------|
| `architecture.md` | **更新** | 缺少 `attendance-notify.js`、`personal-dashboard.js` 等新模組；初始化流程描述需更新（Phase 1 並行化已完成、page-loader 現在會呼叫 _bindPageElements）|
| `banner-swipe-spec.md` | **刪除** | 已實作完成，spec 已無參考價值 |
| `codex-spec-20260222.md` | **刪除** | 3 項任務全部已實作完成 |
| `demo-mode-plan.md` | **更新** | registrations 缺口已修復（companion system）；需更新現況描述 |
| `fix-image-reload.md` | **刪除** | 已實作完成 |
| `performance-optimization-plan.md` | **更新** | 方案三（並行化）、方案四（骨架屏）已完成；方案六（SW 圖片快取）已完成；需標記已完成項目 |
| `player-registration-plan.md` | **刪除** | 同行者報名系統已完整實作 |
| `scan-in-detail-spec.md` | **刪除** | 簽到簽退整合已實作完成 |

---

*最後更新：2026-02-23*
