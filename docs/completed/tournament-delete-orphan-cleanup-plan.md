# 賽事刪除孤兒資料清理計劃

日期：2026-05-05  
狀態：尚未實作，本文為可執行計劃書

## 目前確認

這個修復目前還沒有落地。

已確認的現況：

1. `functions/index.js` 尚未存在 `exports.deleteTournament` callable。
2. `js/firebase-crud.js` 尚未存在 `deleteTournamentAtomic()`。
3. `js/api-service.js` 的 `deleteTournamentAwait(id)` 仍由前端直接刪 Firestore 子集合與 root。
4. `firestore.rules` 仍允許 `tournaments/{id}` root 由 admin client 直接刪除：`allow delete: if isAdmin();`
5. `tournaments/{id}/applications/{applicationId}` 已是 client 不可刪：`allow delete: if false;`

6. `tournaments/{id}/entries/{teamId}` 與 `entries/{teamId}/members/{memberUid}` 目前仍允許 admin client 直接刪除。

因此現行刪除流程仍有風險：

1. 前端嘗試刪 `applications` 會被 rules 擋下，但舊程式會吞掉子集合清理錯誤並繼續刪 root，導致 tournament root 消失、`applications` 等子集合殘留成孤兒資料。
2. 若只禁止 root delete，舊快取前端仍可能先刪掉 `entries/members`，最後 root delete 才失敗，造成 tournament root 還在但參賽隊伍資料消失。

## 目標

把「刪除賽事」改為 Cloud Function / Admin SDK 的後端集中、root-last、可重試刪除流程。

必須達成：

1. 刪除賽事時，先刪乾淨子集合，再刪 tournament root。
2. 子集合任一刪除失敗時，不可刪 root。
3. 前端不可再直接刪 `applications`、`entries`、`members` 或 tournament root。
4. 前端只有在 callable 成功後，才移除本地 cache 與跳轉頁面。
5. 最後用 rules hard cutover 禁止 client 直接刪 tournament root、entries、members。

## 非目標

本計劃不處理以下事項，避免擴大風險：

1. 不清除 Firebase Storage 裡的賽事封面圖。這是另一個 storage cleanup 題目。
2. 不刪獨立 collection 的 `matches`。目前賽程資料是以 `tournamentId` 關聯，不是 `tournaments/{id}` 子集合，直接刪可能破壞歷史資料。
3. 不重構整套賽事生命週期。
4. 不調整一般賽事報名、審核、退賽邏輯。

## 要清理的 Firestore 路徑

本次只清理 tournament root 底下的已知子集合：

```text
tournaments/{tournamentId}/applications/{applicationId}
tournaments/{tournamentId}/entries/{teamId}/members/{memberUid}
tournaments/{tournamentId}/entries/{teamId}
tournaments/{tournamentId}
```

刪除順序必須固定：

1. `applications`
2. `entries/{teamId}/members`
3. `entries`
4. tournament root

root 必須最後刪。

## 刪除一致性說明

這個流程不是所有情境都能稱為 Firestore 原子交易。

規格定義如下：

1. 如果總刪除 refs 數量小於等於 450，function 可以用單一 batch 一次刪除 children + root，這種情況接近 all-or-nothing。
2. 如果總刪除 refs 數量大於 450，必須分批刪除 children，最後才刪 root；這種情況不是 Firestore all-or-nothing，但必須做到 root-last 與可重試。
3. 多批刪除中途失敗時，root 必須保留，下一次呼叫 callable 時可重新掃描剩餘 children 並繼續清理。
4. 文件與程式註解不得把多批流程稱為「原子化刪除」，應稱為「後端集中 root-last 刪除」或「可重試刪除」。

## 實作步驟

### 1. 新增 Cloud Function：`deleteTournament`

檔案：`functions/index.js`

使用專案既有 Firebase Functions v2 寫法：

```js
exports.deleteTournament = onCall(
  { region: "asia-east1", timeoutSeconds: 60, memory: "512MiB" },
  async (request) => {
    // implementation
  }
);
```

必要規格：

1. 檢查 `request.auth.uid`，未登入回 `unauthenticated`。
2. 使用既有 `getCallerRoleWithFallback(request)` 讀取 caller role。
3. 只允許 `admin` / `super_admin` 執行，對齊目前 root delete rules 的 `isAdmin()` 語意。
4. 驗證 `tournamentId`：
   - 必須是 string。
   - 不可為空。
   - 不可包含 `/`。
   - 預設應符合現行賽事 id 契約 `ct_...`。
   - 若正式資料存在 legacy 非 `ct_` id，實作前要先列出樣本，不可直接放寬到任意 doc id。
5. 讀取 `tournaments/{tournamentId}`。
6. 如果 tournament 不存在，回 `{ ok: true, alreadyDeleted: true }`，保持冪等。
7. 依序收集並刪除：
   - `applications`
   - 每個 `entries/{teamId}/members`
   - `entries`
   - tournament root
8. 先計算所有要刪除的 children refs，再依資料量決定刪除策略：
   - children refs + root ref 總數小於等於 450：可用單一 batch 刪除 children + root。
   - children refs + root ref 總數大於 450：分批刪 children，全部 children 成功後才刪 root。
9. 每批最多 450 筆 delete，避免超過 Firestore batch 500 operation 限制。
10. 任一子集合刪除失敗，必須 throw `HttpsError("internal", ...)`，不可繼續刪 root。
11. 多批流程中若已刪部分 children 但後續失敗，root 必須保留，讓下次 callable 可重試剩餘清理。
12. root 刪除成功後才回 `{ ok: true, tournamentId, deleted: { ... } }`。

建議拆 helper，避免 `functions/index.js` 內主流程過長：

```js
async function listTournamentDeleteRefs(tournamentRef) {}
async function commitDeleteRefsInChunks(refs, chunkSize = 450) {}
function assertCanDeleteTournament(callerRole) {}
function validateTournamentIdForDelete(tournamentId) {}
```

注意：不要使用 Web client transaction 範例；這裡必須用 Admin SDK。

### 2. 新增 FirebaseService wrapper

檔案：`js/firebase-crud.js`

新增：

```js
async deleteTournamentAtomic(tournamentId) {
  await this.ensureAuthReadyForWrite();
  const callable = firebase.app().functions('asia-east1').httpsCallable('deleteTournament');
  const result = await callable({ tournamentId });
  return result.data;
}
```

要求：

1. region 固定 `asia-east1`，對齊既有 callable。
2. 錯誤不可吞掉，必須往上 throw。
3. 寫法要對齊現有 `createFriendlyTournamentAtomic`、`removeFriendlyTournamentEntryAtomic` 等 callable wrapper。

### 3. 改寫 ApiService 刪除流程

檔案：`js/api-service.js`

改寫 `deleteTournamentAwait(id)`：

1. 先找到 cache 裡的 tournament，但不要先移除。
2. 如果是 Firebase-backed record，呼叫 `FirebaseService.deleteTournamentAtomic(removed._docId || id)`。
3. callable 成功後，才從 `source` 移除 tournament 並 `_saveToLS`。
4. callable 失敗時：
   - 不移除 cache。
   - 不更新 localStorage。
   - throw error 給 UI。
5. 移除舊的前端直接刪除邏輯：
   - 不再 `docRef.collection('applications').get()`
   - 不再 `docRef.collection('entries').get()`
   - 不再由 client `docRef.delete()`
6. local-only / demo tournament 沒有 `_docId` 時，可保留純本地移除路徑，但 production Firebase record 不可走本地假刪除。

`deleteTournament(id)` fire-and-forget wrapper 可保留，但必須仍呼叫新版 `deleteTournamentAwait()`。

### 4. 確認 UI 刪除體驗

檔案：`js/modules/tournament/tournament-manage.js`

檢查 `handleDeleteTournament(id, actionButton)`：

1. 仍需二次確認。
2. 按下後按鈕 disabled，文字顯示 `刪除中`。
3. 成功後 toast 顯示刪除成功。
4. 如果目前停留在被刪除賽事詳細頁，成功後跳回賽事列表頁。
5. 失敗時恢復按鈕狀態，toast 顯示刪除失敗，不可讓 UI 看起來已刪除。

### 5. Firestore Rules hard cutover

檔案：`firestore.rules`

等 function 與前端都完成並驗證後，禁止 client 直接刪除 tournament root、entries、members。

#### 5.1 tournament root

將：

```js
allow delete: if isAdmin();
```

改為：

```js
allow delete: if false;
```

這段針對 `match /tournaments/{tournamentId}` root delete。

#### 5.2 entries

將：

```js
allow delete: if tournamentExists() && isAdmin();
```

改為：

```js
allow delete: if false;
```

這段針對 `match /tournaments/{tournamentId}/entries/{teamId}` delete。

#### 5.3 members

將：

```js
allow delete: if tournamentExists() && isAdmin();
```

改為：

```js
allow delete: if false;
```

這段針對 `match /tournaments/{tournamentId}/entries/{teamId}/members/{memberUid}` delete。

注意：本次 hard cutover 只要求關閉 direct delete。`entries/members` 的 create/update 是否仍保留 admin direct write，要依現有 legacy cleanup 需求另行評估，不在本次刪除風險修復內擴大調整。

原因：

1. Admin SDK callable 不受 Firestore Rules 限制。
2. 禁止舊前端、console、手動 script 直接刪 root。
3. 禁止舊快取前端先刪 `entries/members` 後 root 刪除失敗，造成 root 還在但參賽資料消失。
4. 防止再次產生 root 已刪但子集合殘留的 orphan data。

部署順序不可顛倒：

1. 先部署 `deleteTournament` Cloud Function。
2. 再部署前端，讓正式使用者改走 callable。
3. 驗證 callable 刪除成功。
4. 最後部署 Firestore Rules hard cutover。

如果先部署 rules，舊前端會直接刪除失敗。  
如果只關 root delete、不關 entries/members delete，舊快取前端仍可能造成局部資料遺失。

### 6. 測試要求

#### Unit tests

至少補以下測試：

1. `ApiService.deleteTournamentAwait` 成功時才移除 cache。
2. callable 失敗時不移除 cache、不寫 localStorage。
3. Firebase-backed tournament 會呼叫 `FirebaseService.deleteTournamentAtomic`。
4. local-only tournament 不呼叫 callable，只做本地移除。
5. UI 刪除成功後會觸發跳轉。
6. UI 刪除失敗會恢復按鈕狀態。

#### Rules tests

更新 `tests/firestore-rules-extended.test.js`：

1. client 直接刪 `tournaments/{id}` 應失敗。
2. client 直接刪 `tournaments/{id}/applications/{applicationId}` 應失敗。
3. client 直接刪 `tournaments/{id}/entries/{teamId}` 應失敗。
4. client 直接刪 `tournaments/{id}/entries/{teamId}/members/{memberUid}` 應失敗。
5. 若既有測試仍期待 admin client 可刪 tournament root、entries 或 members，必須改成失敗。

注意：Rules test 無法直接模擬 Admin SDK callable 成功，因為 callable 使用 Admin SDK 不走 rules。這點在測試說明中註記即可。

#### Function / source tests

若目前 functions 沒有完整 emulator callable 測試，可先補 source-level 或 helper-level 測試：

1. `deleteTournament` 使用 v2 `onCall`。
2. 使用 `getCallerRoleWithFallback(request)`。
3. 包含 `applications`、`entries`、`members` 刪除順序。
4. 不存在 tournament 時回 alreadyDeleted。
5. 子集合刪除失敗不會刪 root。

#### 手動 QA

不使用 Chromium 實體測試。

手動驗收建議：

1. 建立測試賽事。
2. 建立 application。
3. 建立 entry。
4. 建立 entry member。
5. admin 從 UI 刪除賽事。
6. 確認 root 不存在。
7. 確認 applications 不存在。
8. 確認 entries 不存在。
9. 確認 members 不存在。
10. 確認刪除成功後跳回賽事列表。
11. 模擬 callable 失敗時，UI 不可移除賽事。

## 風險與防護

### 風險 1：部署順序錯誤

如果先把 rules 改成 `allow delete: if false`，但前端尚未改走 callable，正式環境刪除會失敗。

防護：

1. function 先部署。
2. front-end 再部署。
3. 驗證成功後才 deploy rules。

### 風險 2：batch 太大

大量 entries / members 可能超過 500 operations。

防護：

1. children + root 總 refs 小於等於 450 時，使用單一 batch。
2. children + root 總 refs 大於 450 時，children 分批刪除，root 最後刪除。
3. 每批最多 450 筆。
4. 每批 await 完再下一批。
5. timeout 設 60 秒。

### 風險 3：子集合刪除失敗但 root 被刪

這是本次要修的核心問題。

防護：

1. callable 內不可吞錯。
2. 子集合刪除失敗直接 throw。
3. root delete 必須放在最後。
4. 多批流程不是 all-or-nothing；若中途失敗，root 保留並允許再次 callable 重試。

### 風險 4：前端 cache 與實際資料不同步

如果 callable 失敗但前端先移除 cache，使用者會以為已刪。

防護：

1. cache 移除必須在 callable 成功後。
2. catch 後恢復 UI 狀態。

### 風險 5：legacy tournament id

若正式資料存在非 `ct_` 的舊賽事 id，嚴格驗證可能導致刪除失敗。

防護：

1. 實作前先掃描正式資料或現有 fixtures 是否有 legacy id。
2. 若需要支援 legacy id，要明確列出條件，不可放寬成任意字串。

### 風險 6：舊快取前端仍可刪 entries/members

若 hard cutover 只禁止 root delete，舊快取前端仍可能執行舊版 `deleteTournamentAwait()`，先刪掉 `entries/members`，再被 root delete 擋下。

防護：

1. hard cutover 必須同步禁止 root、entries、members 的 direct delete。
2. rules tests 必須涵蓋 admin client 直接刪 root、entries、members 都失敗。
3. 正式刪除流程一律走 `deleteTournament` callable。

## 審計結論

這項修復是必要的，因為目前設計確實可能造成 tournament root 被刪、但 `applications` 子集合殘留。

可執行版本必須遵守四個核心原則：

1. 刪除賽事只走 Cloud Function。
2. 子集合清理失敗不可刪 root。
3. 多批刪除不是 all-or-nothing，因此必須 root-last 且可重試。
4. Rules hard cutover 必須最後部署，且要同時禁止 root、entries、members direct delete。

若照此計劃執行，修復範圍集中，風險可控；若跳過 callable 或部署順序錯誤，反而會造成正式刪除功能失效。
