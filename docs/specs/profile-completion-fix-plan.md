# 首次登入個人資料強制填寫 — 修復計畫書

> **版本**：v2.0（專家審計修正版）  
> **日期**：2026-04-14  
> **問題**：用戶首次登入應強制填寫性別/生日/地區，但 ScriptLoader 載入 48 個不相關 script 可能失敗，導致表單從未顯示。18.7% 的用戶（127/678）資料不完整。  
> **方案**：B（內聯表單消除 ScriptLoader 依賴）+ C（後端安全網）

---

## 1. 實際用戶資料（Firestore 查詢結果）

| 類型 | 人數 | 佔比 | 說明 |
|------|------|------|------|
| 完整（三欄都有） | 551 | 81.3% | 正常 |
| 三欄全空 | 37 | 5.5% | 首登表單完全沒顯示 |
| 只有 region（無 gender 無 birthday） | 90 | 13.3% | 表單可能部分顯示或手動填了 region |
| gender 有 region 無 | 0 | 0% | 原計畫假設的 edge case 不存在 |

**結論**：18.7% 的用戶（127 人）有不完整的資料，確認問題存在。

---

## 2. 專家審計發現的致命問題

### 問題 A：saveFirstLoginProfile 用 fire-and-forget 存檔（CRITICAL）

**現況**：`profile-form.js:412` 呼叫 `ApiService.updateCurrentUser()`，這是**同步返回、背景非同步寫入**的 fire-and-forget 函式。
- Modal 在 Firestore 寫入完成**之前**就關閉
- 如果網路失敗，`.catch()` 只 console.error，不通知用戶
- `_pendingFirstLogin` 已被設為 false → 表單不會再次出現
- 用戶以為資料已存，但 Firestore 上仍是 null

**修正**：改用 `updateCurrentUserAwait()`（`api-service.js:2243`），這是 async 版本，會等待寫入完成並在失敗時回滾。

### 問題 B：navigation.js 的 _tryShowFirstLoginModal 未更新（HIGH）

**現況**：計畫只更新了 `profile-form.js` 的顯示邏輯，但 `navigation.js:721-752` 的 `_tryShowFirstLoginModal()` 仍然有 ScriptLoader 依賴。此函式被 `showPage()` 守衛（line 443）和 `goBack()` 守衛（line 675）呼叫。

**修正**：同步簡化 navigation.js 的 `_tryShowFirstLoginModal()`。

### 問題 C：firebase-crud.js registerForEvent 是鎖定函式（HIGH）

**現況**：此函式在 CLAUDE.md 的「報名系統保護規則」鎖定範圍內。計畫未提及需要用戶授權，也未提及修改後須執行 `registration-integrity-check.js`。

**修正**：
- 明確標示為鎖定函式修改
- 修改僅為 pre-check（transaction 之前），不觸碰佔位邏輯
- 修改後必須執行 `docs/registration-integrity-check.js` 驗證

### 問題 D：三欄位驗證不一致（HIGH）

| 位置 | 檢查欄位 | 問題 |
|------|---------|------|
| `_pendingFirstLogin`（profile-form.js:103） | gender + birthday + region | 三欄都檢查 |
| `saveFirstLoginProfile`（profile-form.js:407） | gender + birthday + region | 三欄都必填 |
| CF `registerForEvent`（計畫 Step 3） | gender + region **only** | 漏掉 birthday |

**修正**：CF 檢查也包含 birthday。三處保持一致：`!gender || !birthday || !region`。

### 問題 E：CF 路徑 0% 流量（MEDIUM）

`shouldUseServerRegistration()` 預設返回 false。CF 檢查加了也沒用，直到 feature flag 開啟。

**修正**：計畫書明確記載此狀況。Step 5（firebase-crud.js 前端檢查）是實際有效的防線。

### 問題 F：overlay 鎖定後無退路（HIGH）

如果 `initFirstLoginRegionPicker()` 或 `_populateBirthdaySelects()` 失敗，modal 顯示但 select 為空，overlay 已鎖定，用戶被困住。

**修正**：在 showModal 前加 try-catch，失敗時顯示重試按鈕而非困住用戶。

---

## 3. 修正後實施計畫（6 步）

### Step 1：內聯首登表單到 index.html

**修改**：`index.html` — 在 `<div id="modal-container">` **之前**新增 first-login-modal HTML（~30 行）
**修改**：`pages/modals.html` — 刪除 first-login-modal 區塊（避免重複 DOM）

**放置位置**：modal-container 之前（不是之內），確保 PageLoader 不會覆蓋。

### Step 2：簡化兩處顯示邏輯（移除 ScriptLoader 依賴）

**修改**：`profile-form.js`（lines 144-160）
- 移除 `PageLoader._loadAllPromise` await
- 移除 `ScriptLoader.ensureForPage('page-profile')` 呼叫
- 保留 DOM 存在檢查（內聯後永遠通過）
- **新增**：try-catch 包裹 `initFirstLoginRegionPicker` + `_populateBirthdaySelects`，失敗時顯示重試按鈕

**修改**：`navigation.js`（lines 721-752）`_tryShowFirstLoginModal()`
- **同樣**移除 PageLoader/ScriptLoader 依賴
- 簡化為：找到 DOM → 初始化 → 顯示 → 鎖定

### Step 3：saveFirstLoginProfile 改用 await（修正 fire-and-forget）

**修改**：`profile-form.js`（line 394-428）

```javascript
// 修改前：
ApiService.updateCurrentUser({ gender, birthday, region });
// 立即關 modal（資料可能沒存到）

// 修改後：
async saveFirstLoginProfile() {
  // ... 驗證 ...
  try {
    await ApiService.updateCurrentUserAwait({ gender, birthday, region });
  } catch (err) {
    showErr('儲存失敗，請檢查網路後重試');
    return;  // 不關 modal，讓用戶重試
  }
  // 成功後才關 modal
  this._pendingFirstLogin = false;
  // ...
}
```

### Step 4：CF registerForEvent 加入 profile 檢查

**修改**：`functions/index.js`（line 4637 之後）

```javascript
const userData = callerUserDoc?.data;
if (!userData?.gender || !userData?.birthday || !userData?.region) {
  throw new HttpsError("failed-precondition", "PROFILE_INCOMPLETE");
}
```

**注意**：三欄位都檢查（與前端一致）。

### Step 5：前端錯誤處理 + 自動觸發表單

**修改**：`event-detail-signup.js`（catch 區塊）
**修改**：`event-detail-companion.js`（catch 區塊）

```javascript
// 新增到 cfMsg map：
PROFILE_INCOMPLETE: '請先完善個人資料後再報名',

// catch 區塊新增（在 cfMsg 查找之前）：
if (errCode === 'PROFILE_INCOMPLETE') {
  App._pendingFirstLogin = true;
  App._firstLoginShowing = false;
  App._tryShowFirstLoginModal?.();
  return;
}
```

### Step 6：firebase-crud.js 前端檢查（⚠️ 鎖定函式）

> **此函式為 CLAUDE.md 鎖定範圍。修改僅為 pre-check（transaction 之前），不觸碰佔位/候補邏輯。修改後須執行 `docs/registration-integrity-check.js` 驗證。**

**修改**：`firebase-crud.js registerForEvent`（line ~790，transaction 之前）
**修改**：`firebase-crud.js batchRegisterForEvent`（同樣 pre-check）

```javascript
// 鎖定函式 pre-check（transaction 之前，不影響佔位邏輯）
const currentUser = ApiService.getCurrentUser?.();
if (currentUser && (!currentUser.gender || !currentUser.birthday || !currentUser.region)) {
  throw new Error('PROFILE_INCOMPLETE');
}
```

### Step 7：版號 + 文件 + 驗證

- 快取版號 4 處同步
- `docs/claude-memory.md` 新增 `[永久]` 記錄
- 執行 `docs/registration-integrity-check.js`（鎖定函式驗證）

---

## 4. 不修改的項目

| 項目 | 理由 |
|------|------|
| `firestore.rules` | 不在 Rules 層加 profile 檢查（額外 read 成本 + 已有 CF + 前端雙層防護） |
| `cancelRegistration` | 不阻擋取消報名 |
| birthday 設為可選 | 三處保持一致，全部必填 |
| `shouldUseServerRegistration` flag | CF 檢查目前 0% 流量，Step 6 的前端檢查是實際有效防線 |

---

## 5. 風險評估

| 評估項目 | 內容 |
|----------|------|
| **做了會怎樣** | 首登表單 100% 可靠顯示 + 存檔失敗可重試 + 報名時兜底攔截 |
| **不做會怎樣** | 繼續產生空資料用戶（18.7%） |
| **最壞情況** | Step 6 的鎖定函式修改如果出錯可能影響報名 → 已有 registration-integrity-check 驗證 |
| **影響範圍** | index.html + modals.html + profile-form.js + navigation.js + functions/index.js + event-detail-signup.js + event-detail-companion.js + firebase-crud.js |
| **回退難度** | `git revert` 秒回退 |

---

## 6. 測試驗證清單

### 鎖定函式驗證
- [ ] 執行 `docs/registration-integrity-check.js`（修改 registerForEvent 後必做）

### 自動化
- [ ] `npx jest --ci`（664+ 既有測試通過）

### 手動驗證
- [ ] 新用戶首登 → 表單**立即**顯示（不等 ScriptLoader）
- [ ] 填完三欄 → 送出 → **等待存檔完成** → 才關閉 modal
- [ ] 斷網時填完送出 → 顯示「儲存失敗，請檢查網路後重試」→ modal 不關閉
- [ ] 恢復網路 → 重新送出 → 成功
- [ ] 舊用戶（已有三欄）→ 不顯示表單
- [ ] 不完整用戶報名活動 → PROFILE_INCOMPLETE → 自動彈出首登表單
- [ ] 同行者報名同樣攔截
- [ ] 常規 profile 編輯頁正常運作
- [ ] overlay 鎖定不影響其他 modal
- [ ] `initFirstLoginRegionPicker` 失敗 → 顯示重試按鈕（不困住用戶）
