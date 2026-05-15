# 報名/活動/簽到紀錄 canonical 讀取修正計畫書

> Status: Ready for implementation after Codex re-audit
> Date: 2026-04-30
> Scope: `registrations` / `activityRecords` / `attendanceRecords` 的官方讀取、快取、localStorage、診斷例外
> Non-goal: 本計畫不刪除 root collection 殘留資料，不做不可逆資料清理

## 1. 背景與判斷

UID 健康檢查顯示：

- root `registrations` 仍有舊資料。
- root 與 `events/{eventId}/registrations` subcollection 有 active duplicate。
- root `activityRecords` / `attendanceRecords` 仍有舊資料。

這不代表所有畫面都已經錯，但代表只要 UI 或統計仍直接讀 raw cache，就可能遇到：

- root leftover 被統計進去，造成人數、簽到、放鴿子、個人紀錄重複或不一致。
- localStorage 裡的舊 cache 在刷新後先被還原，短時間顯示錯誤資料。
- 某些 fallback 查詢從 subcollection 拉回資料後，因沒有來源 metadata，後續無法判斷是乾淨資料還是 root leftover。

目前程式碼已經有不少 collectionGroup 查詢會過濾 root document，但還不是一致策略。這次修正目標不是刪資料，而是讓正式 UI / 統計永遠走可驗證的 canonical 資料。

## 2. 核心原則

### 2.1 三層 API 邊界

本修正必須明確分成三種資料路徑。

1. 官方 UI / 統計 canonical read

   用於頁面顯示、統計、排行榜、個人頁、簽到、活動詳情、儀表板等正式功能。

   規則：

   - 只採用 subcollection 來源。
   - 忽略 root leftover。
   - 依業務需要分成 active-only 與 all-status。
   - 對同一筆資料做 canonical 去重。
   - 不再讓一般 UI 直接依賴 `ApiService._src('registrations')` 這類 raw cache。

2. 內部 cache mutation / write helper

   用於報名、取消報名、候補晉升/降級、簽到新增/移除、活動生命週期等會修改 cache 並存回 localStorage 的流程。

   規則：

   - 寫入 cache 前必須補來源 metadata。
   - 存回 localStorage 前必須 canonicalize。
   - 不要在各模組手寫 `push`、`splice`、`_saveToLS` 後留下污染入口。

3. 診斷 / 修復 / raw audit

   用於 UID 健康檢查、資料同步工具、registration audit、root cleanup、修復工具。

   規則：

   - 這些工具必須能看見 raw/root/duplicate，否則會遮掉真正要修的髒資料。
   - 不得強行改成 canonical read。
   - 檔案內應註明「此處刻意使用 raw cache / root collection」。

### 2.2 metadata 必要欄位

所有會進入三個 cache 的 subcollection 文件，至少要補：

```js
{
  _docId: doc.id,
  _path: doc.ref.path,
  _parentPath: doc.ref.parent.parent.path,
  _sourceCollection: 'registrations' | 'activityRecords' | 'attendanceRecords',
  _sourceKind: 'subcollection'
}
```

如果是新寫入後的本地 optimistic cache，因為已知寫入路徑是 `events/{eventDocId}/{collection}/{docId}`，也要補同等 metadata。

### 2.3 localStorage 遷移規則

localStorage 舊資料可能沒有 metadata，因此不能信任它是否來自 root 或 subcollection。

建議做法：

- 對 `registrations` / `activityRecords` / `attendanceRecords` 增加 cache schema version。
- 若 LS 中這三個集合缺 metadata 或 schema 過舊：
  - 不直接還原，或
  - 只還原能確認為 subcollection 的紀錄。
- 初始化後由 listener / fetchIfMissing / userStats 查詢重新補乾淨 cache。

這比嘗試猜測 root/sub 安全，因為舊 LS 沒有來源路徑可驗證。

## 3. 需要修改的檔案與做法

### 3.1 `js/firebase-service.js`

目的：集中處理 metadata、canonical cache、LS 遷移、listener / revalidate root 過濾。

必做：

1. 新增 shared mapper：

   - `_mapSubcollectionDoc(doc, collectionName)`
   - `_isSubcollectionPath(pathOrDoc)`
   - `_canonicalRecordKey(collectionName, record)`
   - `_canonicalizeRecordList(collectionName, records, options)`
   - `_upsertCanonicalCacheRecord(collectionName, record)`
   - `_replaceCanonicalCollectionCache(collectionName, records)`

2. `_restoreCache()`

   - 對 `registrations` / `activityRecords` / `attendanceRecords` 做 schema 檢查。
   - 缺 `_sourceKind: 'subcollection'` 或 `_path` 的舊資料不得直接還原為官方 cache。
   - 避免刷新後先顯示 root leftover。

3. `_persistCache()` / `_saveToLS()`

   - 儲存三個集合前先 canonicalize。
   - 不把 root/unknown source 寫回 LS。

4. `_replaceCollectionCache()`

   - 目前只用 `doc.id` 去重不夠。
   - 三個集合要改用 canonical key 去重。
   - 其他集合維持現有邏輯。

5. `_loadStaticCollections()`

   - `activityRecords` 已經過濾 root，但 map 時要補 metadata。

6. `ensureUserStatsLoaded(uid)`

   - `activityRecords` / `attendanceRecords` collectionGroup 已過濾 root，map 時要補 metadata。

7. `_startRegistrationsListener()`

   - 目前已過濾 root。
   - map 改用 shared mapper，保留 `uid/userId` alias 補齊。
   - 覆蓋 cache 時使用 canonical replace。

8. `_startAttendanceRecordsListener()`

   - 目前已過濾 root。
   - map 改用 shared mapper。
   - 覆蓋 cache 時使用 canonical replace。

9. `_staleWhileRevalidateRegistrations()`

   - 目前 `.get()` 後沒有 `doc.ref.parent.parent !== null` 過濾。
   - 必須補 root 過濾與 shared mapper。

10. `_handleVisibilityResume()`

   - 目前 resume revalidate 同樣沒有 root 過濾。
   - 必須補 root 過濾與 shared mapper。

### 3.2 `js/api-service.js`

目的：讓正式 UI 不再直接吃 raw `_src()`。

必做：

1. 新增 canonical read helpers：

   - `getRegistrations(options)`
   - `getRegistrationsByEvent(eventId)`
   - `getRegistrationsByUser(userId)`
   - `getRegistrationHistoryByEventUser(eventId, uid)`
   - `getActivityRecords(uid)`
   - `getAttendanceRecords(eventId)`
   - `getUserAttendanceRecords(uid)`

2. helper 分 active-only / all-status：

   - 報名按鈕、活動人數、簽到名單：active-only。
   - 收藏 badge、blocked event visibility、歷史紀錄、取消狀態顯示：all-status。

3. `fetchRegistrationsIfMissing(eventId)`

   - short-circuit 不能只因 raw cache 有 root leftover 就停止。
   - direct subcollection fetch map 時補 metadata。
   - merge 時用 canonical helper，不直接 `source.push`。

4. `fetchAttendanceIfMissing(eventId)`

   - direct subcollection fetch map 時補 metadata。
   - merge 時用 canonical helper，不直接 `source.push`。

5. `addActivityRecord()` / `removeActivityRecord()` / `addAttendanceRecord()` / `removeAttendanceRecord()`

   - 若仍由 ApiService 直接操作 cache，需改走 internal mutation helper。

6. `getRegistrations()`

   - 目前 `dashboard-snapshot.js` 會呼叫 `ApiService.getRegistrations()`，但現行沒有此方法。
   - 必須補上，否則 dashboard cache view 會拿到空 registrations。

7. `collectEventParticipantStats` 相關 direct subcollection fetch

   - 目前直接讀 `events/{eventDocId}/attendanceRecords`，沒有 root 風險。
   - 若只是局部統計資料，可維持不進全域 cache。
   - 若未來 merge 進 `FirebaseService._cache.attendanceRecords`，必須補 metadata 並走 canonical helper。

### 3.3 `js/firebase-crud.js`

目的：修掉最大 cache 污染入口。

必做：

1. `addAttendanceRecord()` / `removeAttendanceRecord()` / `batchWriteAttendance()`

   - 新增 attendanceRecords cache record 時補 metadata。
   - save LS 前 canonicalize。

2. `registerForEvent()`

   - `registration` 與 `activityRecord` 寫入成功後補 metadata 再放入 cache。
   - 不直接 `this._cache.registrations.push(registration)`。
   - 不直接 `this._cache.activityRecords.unshift(result.activityRecord)`。

3. `cancelRegistration()`

   - Firestore subcollection refresh map 時補 metadata。
   - fallback 到 cache 時必須用 canonical all-status helper。
   - commit 後 cache mutation 走 internal helper，再 save LS。

4. `batchRegisterForEvent()`

   - `result.registrations` 補 metadata 後再進 cache。
   - save LS 前 canonicalize。

5. `cancelCompanionRegistrations()`

   - Firestore subcollection refresh map 時補 metadata。
   - fallback 到 cache 時必須用 canonical all-status helper。
   - commit 後 cache mutation 走 internal helper，再 save LS。

6. `_getRegistrationUniqueKey()`

   - 這是業務去重/容量判斷用，不應在本計畫中隨意改動。
   - 但 canonical read dedupe 要處理 companion `companionId` 空值的風險，可用 `_docId` / `_path` 作 fallback，避免不同同行者被讀取層誤合併。

### 3.4 正式 UI 模組

以下模組不可再用 raw `_src('registrations')` / `_src('activityRecords')` / `_src('attendanceRecords')` 作正式顯示或統計。

需要改成 canonical helper：

- `js/modules/event/event-detail.js`
  - direct subcollection safety fetch map 要補 metadata。
  - fallback `ApiService._src('registrations')` 改用 canonical all-status/event helper。

- `js/modules/event/event-detail-signup.js`
  - 取消流程 subcollection refresh map 要補 metadata。
  - cache rebuild / push 改 internal helper。
  - `activityRecords` raw read 改 canonical helper，除非是明確 cache mutation。

- `js/modules/event/event-detail-companion.js`
  - `activityRecords` direct write / update 後的 cache 操作補 metadata。
  - raw read 改 canonical helper。

- `js/modules/event/event-create-waitlist.js`
  - 候補自動晉升/降級會直接 mutate registrations/activityRecords。
  - 需要使用 internal mutation helper，不可直接 `_saveToLS` 污染 LS。

- `js/modules/event/event-manage-waitlist.js`
  - 手動晉升/降級同上。

- `js/modules/event/event-manage-lifecycle.js`
  - 移除參與者、活動生命週期同步同上。

- `js/modules/event/event-blocklist.js`
  - 目前刻意不用 `getRegistrationsByEvent()`，因為需要 cancelled/removed 歷史。
  - 應改用 canonical all-status helper，例如 `getRegistrationHistoryByEventUser(eventId, uid)`。
  - 不應改成 active-only。

- `js/modules/event/event-manage-noshow.js`
  - no-show details 應使用 canonical registrations + canonical attendanceRecords。

- `js/modules/favorites.js`
  - 收藏 badge 需要 all-status canonical registration history。

- `js/modules/leaderboard.js`
  - `_calcScanStats()` 需要 canonical all-status registrations，避免 root leftover 影響 active/cancelled event set。

- `js/modules/scan/scan-process.js`
  - family check-in 判斷目前 raw `_src('registrations')`。
  - 改 canonical event/user helper。

- `js/modules/dashboard/dashboard-snapshot.js`
  - 補 `ApiService.getRegistrations()` 或改呼叫 canonical helper。

- `js/modules/dashboard/dashboard-data-fetcher.js`
  - direct collectionGroup fetch 已經過濾 root。
  - 若結果會交給統計圖或 snapshot cache，map 時也要補 metadata，避免後續流程無法辨識來源。

- `js/modules/achievement/batch.js`
  - 這不是診斷 raw 路徑，而是正式成就批次計算。
  - 目前 collectionGroup 查詢已過濾 root，但會暫時覆蓋 `FirebaseService._cache.registrations/activityRecords/attendanceRecords` 給 evaluator 使用。
  - map 時要補 metadata；暫時覆蓋 cache 前後要確保不觸發 LS persist，不要把批次 user scoped cache 誤存成全域 cache。

- `js/modules/attendance-notify.js`
  - 目前只監聽近 5 筆 attendanceRecords 並已過濾 root，不寫入全域 cache。
  - 可維持現狀；若未來要把通知資料 merge 進 cache，必須走 shared mapper。

- `js/modules/event/event-host-list.js`
  - collectionGroup attendance 查詢已過濾 root。
  - 若後續結果被併回全域 cache，需要補 metadata；純統計用可保持局部資料。

### 3.5 可保留 raw 的診斷/修復模組

以下模組不應被盲目改成 canonical，因為它們的工作就是看見髒資料：

- `js/modules/registration-audit.js`
- `js/modules/data-sync.js`
- `functions/index.js` 的 UID health checker / migration / repair 相關函式
- `docs/registration-integrity-check.js`
- `docs/archive/*`

要求：

- 在主要 raw 讀取附近加短註解，標示「diagnostic/raw path，刻意保留 root/duplicate 可見性」。
- 不讓正式 UI 引用這些 raw 結果。

## 4. 不修會發生什麼

若維持現狀：

- 使用者刷新後可能短暫看到 LS 舊 root leftover 造成的錯誤狀態。
- 少數統計頁、收藏 badge、排行榜、掃描、no-show、dashboard 可能受 root duplicate 影響。
- 健康檢查會持續報大量 warning，且難以判斷哪些 warning 已被 UI 安全隔離。
- 每次新增 fallback 或快取修補，都可能又把沒有 metadata 的資料塞回 cache。

## 5. 修正風險

主要風險不是 Firestore 成本，而是行為邊界：

- 如果把診斷工具也 canonicalize，會看不到髒資料，造成修復工具失效。
- 如果 active-only / all-status 沒分清楚，可能讓取消過的活動、封鎖可見性、收藏 badge 顯示錯誤。
- 如果 cache mutation 改成回傳 clone，現有候補/生命週期流程直接修改物件的做法會失效。

因此本計畫採取：

- official read helper 可回傳乾淨資料。
- internal mutation helper 維持可修改 live cache reference。
- diagnostic raw helper 保留 raw/root 可見性。

## 6. 建議實作順序

### Phase 1: 建資料層 helper

修改 `js/firebase-service.js`：

1. 新增 metadata mapper。
2. 新增 canonicalize / upsert / replace helper。
3. 補 LS schema/migration。
4. 修 listener / static load / userStats / stale revalidate / visibility resume。

驗收：

- root doc 不會被放入官方 cache。
- 沒 metadata 的舊 LS 三集合不會直接還原。
- listener 與 resume 都會寫入 metadata。

### Phase 2: 建 ApiService canonical helpers

修改 `js/api-service.js`：

1. 補 `getRegistrations()`。
2. 重寫 registrations/activity/attendance read helpers。
3. 修 `fetchRegistrationsIfMissing()` / `fetchAttendanceIfMissing()` merge 流程。

驗收：

- 官方讀取不受 root leftover 影響。
- event/user/all-status 查詢結果一致。
- dashboard cache view registrations 不再永遠空。

### Phase 3: 收斂 cache mutation

修改 `js/firebase-crud.js` 與相關 event modules：

1. 新增/取消/批次報名/簽到寫入後補 metadata。
2. 候補晉升/降級、生命週期移除、活動詳情 fallback merge 改 internal helper。
3. 所有 `_saveToLS('registrations'|'activityRecords'|'attendanceRecords')` 前 canonicalize。

驗收：

- 報名、取消、候補、簽到後刷新不會復活 root/unknown cache。
- 不破壞 waitlist promotion / demotion。

### Phase 4: UI raw read 替換

修改正式 UI 模組：

1. favorites / leaderboard / scan / noshow / dashboard / event detail。
2. blocklist 改 all-status canonical helper。
3. 保留 diagnostic/raw 例外。

驗收：

- 收藏狀態、排行榜、掃描、no-show、dashboard 數字與 UI 同步。
- 被 blocked 但曾報名的使用者仍可看見該活動。

### Phase 5: 測試與部署

必測：

1. root active + sub active duplicate，只顯示一次。
2. root active + sub cancelled，官方 UI 以 sub cancelled 為準。
3. sub active + root removed，官方 UI 以 sub active 為準。
4. companion `companionId` 空值時，不誤合併不同 `_docId`。
5. 舊 localStorage 缺 metadata，不直接還原三集合。
6. `fetchRegistrationsIfMissing()` 不因 root leftover short-circuit。
7. `fetchAttendanceIfMissing()` merge 後帶 metadata。
8. waitlist promote/demote 後 LS 仍是 canonical。
9. lifecycle remove participant 後 LS 仍是 canonical。
10. dashboard cache view 可拿到 registrations。
11. registration-audit / data-sync / UID health 仍能看到 raw/root。
12. event-blocklist all-status 行為不退化。
13. achievement batch 暫時覆蓋 cache 後會還原，不會把單一使用者資料寫回 LS。
14. dashboard-data-fetcher 的 direct fetch 統計不吃 root leftover。

建議測試命令：

```bash
npm run test:unit
npm run test:rules
```

若只改前端 JS 且 rules 未動，`test:rules` 可作安全回歸；若時間有限，至少跑與 registrations/cache/API 相關 unit tests。

## 7. Codex 再審計結論

本計畫可執行，但有兩條硬性前提：

1. 不可只改 `ApiService`，必須一起處理 `FirebaseService` LS restore/persist 與 `firebase-crud.js` cache mutation。
2. 不可把診斷/修復工具改成 canonical read，必須保留 raw 可見性。

只要遵守以上邊界，這個修法不會增加 Firestore 讀取成本；主要變動是前端記憶體資料整理與 localStorage 過濾。Firestore 成本只會出現在原本就會發生的 listener / fallback fetch，不會因 canonical helper 本身新增查詢。

## 8. 實作前最後補充審計

### 8.1 canonical key 必須分兩層處理

Codex 實作前逐段檢查後，新增一個重要邊界：

- 同一份 subcollection 文件如果從 `waitlisted` 變成 `confirmed`，不能因為 status 不同而在 cache 中變成兩筆。
- 同一使用者同一活動若有「舊的 cancelled 歷史」與「新的 confirmed 報名」，兩者是不同生命週期文件，不能被互相覆蓋。

因此 canonicalize 流程必須先用真實 `_path` 合併同一份 Firestore 文件，再用「eventId + userId/uid + participantType + companionKey + status」處理 root/sub leftover 的邏輯去重。這樣才能同時避免：

1. root/sub active duplicate 造成統計翻倍。
2. 同一 doc 狀態轉換造成同一人被算兩次。
3. cancelled 歷史把後續重新報名的 active 報名蓋掉。

### 8.2 測試必須覆蓋的新增案例

新增單元測試必須驗證：

- root leftover 不會讓 `fetchRegistrationsIfMissing()` 提前短路。
- official `ApiService.getRegistrations*()` 只回傳 subcollection canonical 資料。
- all-status history 會保留 cancelled 與 active 的不同文件。
- 同一 `_path` 的不同狀態快取只保留最新狀態，避免 waitlisted/confirmed 雙算。
