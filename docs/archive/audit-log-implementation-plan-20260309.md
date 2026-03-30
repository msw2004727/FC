# ToosterX Audit Logs Implementation Plan
> Date: 2026-03-09
> Target: 建立新的 `auditLogs` 稽核日誌系統，僅供 `super_admin` 查閱，採每日分桶、單日讀取、支援搜尋篩選、保留 180 日。
> Status: All phases implemented. This document now serves as the implementation and specification record.

## Summary

本方案建立新的 `auditLogsByDay/{yyyyMMdd}/auditEntries/{logId}` 稽核日誌系統，專門記錄高價值操作，並與現有 `operationLogs` 分離。

核心要求：

- 只有 `super_admin` 可讀取
- 查某一天時，只讀該日資料
- 支援篩選：日期、時間區間、暱稱或 UID、行為
- 保留 180 天
- 不進 `localStorage`
- 不做全量即時監聽
- 高價值 log 優先由 Cloud Functions 寫入，提升可信度

## Data Model

Collection 路徑：

- `auditLogsByDay/{yyyyMMdd}/auditEntries/{logId}`

每筆資料欄位：

- `createdAt`
- `dayKey`
- `timeKey`
- `actorUid`
- `actorName`
- `actorRole`
- `action`
- `targetType`
- `targetId`
- `targetLabel`
- `result`
- `source`
- `meta`
- `expiresAt`

`meta` 白名單：

- `eventId`
- `teamId`
- `messageId`
- `reasonCode`
- `statusFrom`
- `statusTo`

## Phase A — Foundation ✅ Completed

### Goal

建立 `auditLogs` 基礎架構、資料模型、規則與後台查詢頁骨架。

### Steps

1. 定義 `auditLogsByDay/{dayKey}/auditEntries/{logId}` 結構
2. 規劃固定欄位與 `meta` 白名單
3. 新增 `firestore.rules`
4. 建立 admin audit 頁骨架
5. 加入篩選欄位：日期、時間區間、暱稱/UID、行為
6. 明確排除 `localStorage` 與 realtime listener
7. 更新 `docs/architecture.md`

### Affected Files

- `firestore.rules`
- `js/api-service.js`
- `js/core/navigation.js`
- `js/core/page-loader.js`
- `js/core/script-loader.js`
- `js/config.js`
- `js/i18n.js`
- `pages/admin-system.html`
- `js/modules/audit-log.js`
- `docs/architecture.md`

### Acceptance

- `super_admin` 以外無法讀 audit logs
- audit logs 不加入初始化快取
- audit logs 不寫入 `localStorage`
- admin 頁可選日期
- admin 頁有時間、暱稱/UID、行為篩選欄位
- 畫面不做即時監聽

### Risks

- 若誤把 audit logs 放進首頁初始化或 collection cache，會直接破壞節省流量目標
- 若 UI 直接全量讀 180 天資料，查詢成本會快速膨脹

## Phase B — Trusted Write Path ✅ Completed

### Goal

建立 Cloud Functions 可信寫入入口，並建立前端統一寫入 API。

### Steps

1. 在 `functions/index.js` 新增 callable function：`writeAuditLog`
2. 驗證 `request.auth`
3. 驗證 `action` 白名單
4. 從 auth / Firestore 補 `actorUid`、`actorName`、`actorRole`
5. 產生 `dayKey`
6. 產生 `timeKey`
7. 產生 `expiresAt`
8. 寫入 `auditLogsByDay/{dayKey}/auditEntries`
9. 在 `js/api-service.js` 新增 `writeAuditLog(payload)`
10. 前端統一透過 `ApiService.writeAuditLog()` 呼叫
11. log 寫入失敗不得回滾主流程

### Affected Files

- `functions/index.js`
- `js/api-service.js`

### Acceptance

- 未登入呼叫被拒絕
- 非白名單 action 被拒絕
- `actorUid` 來自 `request.auth.uid`
- `createdAt` 為 server timestamp
- `expiresAt` 正確存在
- 路徑落在正確 day bucket
- 前端使用單一 API 寫入
- log 寫入失敗不影響主流程

### Risks

- 若直接信任前端傳入 `actorUid/actorRole`，可信度會失效
- TTL 必須另外在 Firestore Console 將 `expiresAt` 設成 TTL field，僅靠程式碼不會自動啟用背景刪除

## Phase C — Event Wiring / Query / TTL ✅ Completed

### Goal

接入第一批高價值事件，完成查詢與篩選頁，並寫入 180 日保留欄位。

### Implemented Event Scope

- `login_success`
- `login_failure`
- `logout`
- `event_signup`
- `event_cancel_signup`
- `team_join_request`
- `team_join_approve`
- `team_join_reject`
- `role_change`
- `admin_user_edit`

### Coverage Note

- `login_failure` 目前只覆蓋 Cloud Function `createCustomToken` 中的 LINE Access Token 驗證失敗。
- 前端 LIFF 初始化失敗、使用者網路中斷、LIFF session 異常、前端尚未取得 Firebase Auth 的登入失敗，不在目前 audit log 覆蓋範圍內。
- 原因是目前可信寫入路徑依賴 `request.auth`；未認證狀態下若仍允許直接寫 audit log，會引入可濫用與可偽造風險。
- 若未來要擴大 `login_failure` 覆蓋面，建議另做低信任的 `authAttemptLogs` 或 error telemetry，搭配 rate limit、App Check、IP/UA 節流，而不要直接放進高信任 audit log。

### Steps

1. 找出第一批事件觸發點
2. 在成功與失敗分支寫 audit log
3. 補齊 `targetType`、`targetId`、`targetLabel`、`result`
4. 完成 admin 查詢頁：單日查詢、時間區間篩選、暱稱/UID 搜尋、行為篩選、載入更多
5. 寫入 `expiresAt`
6. 補文件與維運說明

### Affected Files

- `js/firebase-service.js`
- `js/modules/profile-data.js`
- `js/modules/event-detail-signup.js`
- `js/modules/team-form.js`
- `js/modules/message-inbox.js`
- `js/modules/user-admin-list.js`
- `js/modules/audit-log.js`
- `pages/admin-system.html`
- `functions/index.js`
- `docs/claude-memory.md`

### Acceptance

- 上述事件都能成功留下 audit log
- `success` / `failure` 區分正確
- 指定日期只讀指定日期
- 可依時間區間篩選
- 可依暱稱或 UID 篩選
- 可依行為篩選
- 預設只抓最近 100 筆
- 可載入更多同日資料
- 每筆新 log 均帶 `expiresAt`

### Risks

- 若事件掛點選錯，可能漏記或重複記錄
- `login_failure` 目前僅涵蓋 Cloud Function 驗證失敗，不涵蓋所有前端登入失敗樣態
- Firestore TTL 為背景刪除，不是即時刪除

## Query / Index Notes

- 目前後台查詢固定為：
  - 單日 bucket
  - `orderBy('createdAt', 'desc')`
  - `limit(100)`
  - `startAfter(cursor)`
- 目前時間、暱稱或 UID、行為篩選都在前端做 client-side filter。
- 目前不需要複合索引；`createdAt` 的單欄位排序查詢可直接使用 Firestore 自動建立的單欄位索引。
- 若未來改成 server-side 條件，例如：
  - `where('action', '==', x).orderBy('createdAt', 'desc')`
  - `where('result', '==', 'failure').orderBy('createdAt', 'desc')`
  則需要另建 composite index。

## TTL Notes

- `expiresAt` 是 TTL 欄位來源，但真正自動刪除需要在 Firestore Console 設定 TTL policy。
- 因為資料路徑是 `auditLogsByDay/{dayKey}/auditEntries/{logId}`，TTL policy 應套用在 collection group `auditEntries`，不是父層 `auditLogsByDay`。
- subcollection 名稱改為 `auditEntries`，是為了避免未來其他功能若也使用通用名稱 `entries` 時，被同一條 TTL policy 誤套用。
- 目前文件與實作都假設 TTL field 為 `expiresAt`。
- 根據官方文件，TTL 到期後的文件通常會在 24 小時內刪除，但不是保證值，因此仍不可承諾即時刪除。
- 目前不需要先手動建立複合索引才可以套用 TTL；TTL 與索引是不同設定。若日後要做伺服器端複合查詢，才另外考慮 composite index。

## Cost / Volume Estimate

### Write Model

每個高價值事件，通常會產生：

- 1 次 Cloud Function callable
- 1 次 Firestore document write

### Rough Daily Estimate

若以 1,000 位日活躍使用者粗估：

- 1,000 次 `login_success`
- 700 到 1,000 次 `logout`
- 300 到 800 次 `event_signup` / `event_cancel_signup`
- 50 到 200 次 `team_join_request` / review
- 10 到 50 次 `role_change` / `admin_user_edit`

則每日大約：

- 2,060 到 3,050 次 callable
- 2,060 到 3,050 筆 Firestore writes

這個量級對目前架構屬於可控範圍，主要成本仍在 Firestore writes 與少量 Cloud Function 啟動。

### Burst / Cold Start Note

- 熱點時段若大量使用者同時報名，會出現少量 Cloud Functions 冷啟動延遲，但每次 audit payload 很小，通常只會增加單次操作延遲，不太會成為吞吐瓶頸。
- 若未來 audit 事件數量明顯上升，應優先檢查：
  - 是否記了太多低價值事件
  - 是否有重複寫入
  - 是否有前端重試造成多次 callable

## Final Acceptance Checklist

- 只有 `super_admin` 可讀 audit logs
- 單日查詢只讀單日 bucket
- 搜尋條件可依時間、暱稱/UID、行為篩選
- 寫入經過 Cloud Functions
- 180 日保留欄位已寫入 `expiresAt`
- audit logs 不進首頁初始化、不進 `localStorage`

## Manual Deployment Notes

- 部署 Cloud Functions：`createCustomToken`、`writeAuditLog`
- 部署 Firestore Rules
- 在 Firestore Console 為 collection group `auditEntries` 的欄位 `expiresAt` 啟用 TTL policy
