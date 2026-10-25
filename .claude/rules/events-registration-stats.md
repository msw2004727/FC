---
paths:
  - "js/firebase-crud.js"
  - "js/firebase-service.js"
  - "js/api-service.js"
  - "js/config.js"
  - "js/modules/event/**"
  - "js/modules/education/**"
  - "js/modules/achievement/**"
  - "js/modules/user-admin/**"
  - "js/modules/scan/**"
  - "js/modules/dashboard/**"
  - "js/modules/leaderboard.js"
  - "js/modules/home-next-activity.js"
  - "js/modules/favorites.js"
  - "functions/**"
  - "firestore.rules"
  - "tests/unit/**"
  - "tests/firestore-rules/**"
---

# 活動、報名、候補與統計

> 本檔是 `CLAUDE.md` 的領域規則檔，以下 Rule ID 的 canonical 定義在此。條文中的「本檔」除非明確指特定檔案，一律指整個生效規則集（`CLAUDE.md` 加全部規則檔），標記的權威層級不因所在檔案而異。標記、權威順序與授權模式見 `CLAUDE.md` §0；修改本檔後必須跑 `node scripts/check-rules-integrity.js`。

## 10. Exact Contract Registry：活動、報名、統計

### 10.1 Terminal 活動

- **R-EVT-001 [B/HARD]**：前台無「已結束」頁籤；舊 hash／state／link `ended` 在 `event-list.js` normalize 為 `normal`。
- **R-EVT-002 [B/HARD]**：一般結束／手動取消在結束時間 +6 小時後才 terminal；6 小時內留「報名中」。
- **R-EVT-003 [B/HARD]**：前台只載少量 terminal preview，數量查 source constant，不全載。
- **R-EVT-004 [B/HARD]**：管理歷史用 `ensureTerminalEventsLoaded({ mode:'history' })`，`loadMoreTerminalEvents()` 分頁。
- **R-EVT-005 [B/HARD]**：改列表、取消、auto-end、terminal cache 跑 `activity-terminal-events-loading.test.js`、`event-ended-tab-delay.test.js` 與相關 tests。

### 10.2 可見性／黑名單

- **R-EVT-010 [A/HARD]**：列表／詳情用 `App._isEventVisibleToUser(event, uid)` 或 `_getVisibleEvents`，禁重寫。
- **R-EVT-011 [A/HARD]**：四態：訪客可見；未封鎖可見；被擋但曾有任何 registration（含 cancelled／removed）可見；被擋且無紀錄不可見。
- **R-EVT-012 [B/HARD]**：一般列表優先 `_getVisibleEvents`；獨立列表明確 filter helper。
- **R-EVT-013 [A/HARD]**：詳情拒絕顯示「找不到此活動」不透露封鎖；報名／同行者寫入也檢查，拒絕文案「此活動目前無法報名」。
- **R-EVT-014 [A/HARD]**：Companion 只擋 operator，不擋同行者中的被封鎖用戶。
- **R-EVT-015 [B/HARD]**：現有「活動報名／取消／遞補等事件通知」只發已報名者，可不重複可見性 filter；未來活動通知未報名者時 Functions 同步可見性。此例外不適用全體／角色／俱樂部廣播、Ops、私訊。Favorites、Scan、Dashboard 豁免。
- **R-EVT-016 [A/HARD]**：`blockedUids` 是 LINE UID array；`blockedUidsLog` 每筆 `{ uid, by, action:'add'|'remove', at, reason }`。
- **R-EVT-017 [A/HARD]**：黑名單寫入只改 `blockedUids`、`blockedUidsLog`，不順改 `updatedAt`；用 `arrayUnion/arrayRemove`。
- **R-EVT-018 [A/HARD]**：code `admin.repair.event_blocklist`；`super_admin` inherent。`rolePermissions/user` 固定不授予；角色層 toggle 仍顯示但鎖定／disabled，不能透過 `rolePermissions` 開啟。`super_admin` 可透過 `userPermissionGrants/{uid}` 個別授予特定一般 user；其他非 user 角色可透過 `rolePermissions` 調整，也可接受個別授權。所有入口一律以目前登入者的 effective permission 判斷。
- **R-EVT-019 [A/HARD]**：Rules `canManageEventBlocklist()` 必須精確為 `isSuperAdmin() || hasEffectivePerm('admin.repair.event_blocklist')`；`hasEffectivePerm(perm) = hasPerm(perm) || hasUserPermissionGrant(perm)`。角色權限與啟用中的個別授權都有效；禁止降回只檢查 `hasPerm(...)` 或放寬成一般 `isAdmin()`。

### 10.3 報名／候補／課程

| 檔案 | 鎖定 symbols |
|------|--------------|
| `js/firebase-crud.js` | `registerForEvent`、`batchRegisterForEvent`、`cancelRegistration`、`cancelCompanionRegistrations`、`_rebuildOccupancy`、`_applyRebuildOccupancy` |
| `js/modules/event/event-detail-signup.js` | `handleSignup`、`handleCancelSignup` |
| `js/modules/event/event-detail-companion.js` | `_confirmCompanionRegister`、`_confirmCompanionCancel` |
| `js/modules/event/event-create-waitlist.js` | `_adjustWaitlistOnCapacityChange`、`_getNextWaitlistCandidate`、`_promoteSingleCandidateLocal`、`_getPromotedArDocIds` |
| `functions/index.js` | `registerForEduCoursePlan`、`approveCourseEnrollment`、`migrateEduCourseAutoEnrollments` |
| `functions/edu-course-enrollment-core.js` | `decideCoursePlanRegistration`、`decideCoursePlanApproval`、`getApprovedStudentIdSet` |
| `js/modules/education/edu-course-enrollment.js` | `applyCourseEnrollment`、`_approveCourseEnrollment` |

- **R-REG-001 [A/HARD]**：occupancy 來自最新 Firestore query，禁不完整 `this._cache.registrations` 計數／重建。
- **R-REG-002 [A/HARD]**：禁手動 `current++/--`；`event.current`、`event.waitlist` 由 `_rebuildOccupancy()`。
- **R-REG-003 [A/HARD]**：報名 transaction／batch；取消正取與候補遞補同原子提交。
- **R-REG-004 [A/HARD]**：`_rebuildOccupancy` 純函式：不寫 cache、不呼 API、不改輸入。
- **R-REG-005 [B/HARD]**：改鎖定 symbol 跑 `check:registration-ops`、完整 `test:unit`、local-only `docs/registration-integrity-check.js`；缺工具回報，不假稱。
- **R-REG-006 [A/HARD]**：遞補 `registeredAt ASC`、同時 `promotionOrder ASC`；容量下降兩者 DESC。
- **R-REG-007 [A/HARD]**：`confirmed ↔ waitlisted` 同步 activityRecord `registered ↔ waitlisted`；只有 `participantType === 'companion'` 例外。
- **R-REG-008 [A/HARD]**：`cancelRegistration`、`cancelCompanionRegistrations` commit 前只在副本模擬，成功後才更新 cache。
- **R-REG-009 [A/HARD]**：Timestamp 排序先 `data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt`。
- **R-REG-010 [A/HARD]**：`_adjustWaitlistOnCapacityChange` 開頭 query 最新 Firestore 並同步 cache，不用舊 cache。
- **R-REG-011 [A/HARD]**：`coursePlans/{planId}/enrollments` 一般學員走 `registerForEduCoursePlan`，審核走 `approveCourseEnrollment`；直寫只留 team staff／`team.manage_all`。
- **R-REG-012 [A/HARD]**：`maxCapacity` 最終判斷在 CF transaction；禁 `_effectiveCount`、local cache、舊 `currentCount`。批次檢查「已核准 + 本次 accepted」不超 `maxCapacity`。
- **R-REG-013 [A/HARD]**：`eduAutoMigrationCompleted` 只在 `migrateEduCourseAutoEnrollments({ dryRun:false, markCompleted:true })` 成功後設；之後前端不建 `_auto_`。
- **R-REG-014 [A/HARD]**：`registrations`、`attendanceRecords`、`activityRecords` 的 canonical 路徑一律是 `events/{eventDocId}/{collection}`，禁止新增 root collection 查詢／寫入。單活動先 resolve `eventDocId` 再讀對應子集合；跨活動用 `collectionGroup(collectionName)`，前端保留 `doc.ref.parent.parent !== null`，Admin／CF 保留 `d.ref.path.split('/').length > 2` 或等價共用 predicate。Phase 4c legacy root 資料尚未完整移除前，三種 collection 的排除 predicate 都不得刪。 已修（T-034，2026-10-26；取代原「已知待修 drift」）：`js/modules/home-next-activity.js#fetchRegistrationsForUid()` 於映射前套 `doc.ref.parent.parent !== null`，完整性判斷與上限警告依「過濾前」筆數，並有 legacy-root allow／deny 測試；`requireSubcollection:false` 仍保留但舊根文件到不了這一步。
- **R-REG-015 [B/HARD]**：操作後禁 `showEventDetail()` 全頁重繪；用 `_refreshSignupButton(eventId)`（8 狀態）、`_patchDetailCount(eventId)`、`_patchDetailTables(eventId)`；`_debouncedSnapshotRender` 的 `page-activity-detail` 同樣局部更新。
- **R-REG-016 [A/HARD]**：「副本模擬」是 transaction 前本地計算，不是 Demo mode。

### 10.4 統計／出席／放鴿子

- **R-STAT-000 [A/HARD]**：鎖定集合：`js/modules/event/event-manage-noshow.js` → `_buildRawNoShowCountByUid`、`_getNoShowDetailsByUid`；`js/modules/event/event-manage-confirm.js` → `_confirmAllAttendance`；`js/modules/achievement/stats.js` → `getParticipantAttendanceStats`；`js/modules/leaderboard.js` → `_calcScanStats`、`_categorizeRecords`；`js/firebase-service.js` → `ensureUserStatsLoaded`；`js/api-service.js` → `getUserAttendanceRecords`。
- **R-STAT-001 [A/HARD/GATED]**：未經使用者針對 R-STAT-000 明確授權，禁修改任何 symbol，包括重構、改名、整理。
- **R-STAT-002 [A/HARD]**：registrations `userId`、attendance／activity `uid`、users cache key `adminUsers` 不得改。
- **R-STAT-003 [A/HARD]**：`attendanceRecords.uid`、`activityRecords.uid` 的 canonical 身分是 LINE／Firebase UID；新 join 只直接比 UID，禁止新增 displayName fallback。**既有 legacy 例外**：`js/modules/achievement/batch.js#_processOneUserAchievements` 在 UID attendance 查無資料時仍以 `userName == displayName` 補查並映射 UID；此路徑有同名碰撞風險，不得複製，只有完成歷史資料驗證／遷移與相稱 tests 後才能移除。
- **R-STAT-004 [A/HARD]**：前後端 `NO_SHOW_FEATURE_ENABLED` 同步，不寫死目前值。若關閉，兩端 flag、主站 bump、Functions deploy、權限／統計 tests 同批規劃。
- **R-STAT-005 [B/HARD]**：提案先說明完成場次、出席率、放鴿子、歷史資料影響與是否重驗／重算。
- **R-STAT-006 [A/HARD]**：`activity.view_noshow` 控制放鴿子資訊查看，`admin.repair.no_show_adjust` 控制管理補正；flag、UI、排程重算、`noshow_penalty`、permission／statistics tests 一起核對。

---

