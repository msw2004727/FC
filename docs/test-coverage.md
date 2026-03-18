# SportHub 測試覆蓋文件

## 1. 概覽

| 類別 | 測試數量 | 執行指令 |
|------|----------|----------|
| 純函式單元測試 | 551 | `npm run test:unit` |
| Firestore 規則測試 | 113 | `npm run test:rules` |
| **總計** | **664** | — |

### 執行前置條件

- **Node.js**：v18+ (推薦 v20)
- **Java**：JDK 11+ (Firestore Emulator 需要)
- **Firebase CLI**：已包含在 devDependencies (`firebase-tools`)
- **安裝依賴**：`npm install`

### 執行方式

```bash
# 純函式單元測試（無需 emulator）
npm run test:unit

# Firestore 規則測試（自動啟動 emulator）
npm run test:rules

# Firestore 規則測試（watch 模式，需手動啟動 emulator）
npm run test:rules:watch
```

---

## 2. 純函式單元測試 (`npm run test:unit`)

### 2.1 `tests/unit/pure-functions.test.js`

- **測試來源**：`js/firebase-crud.js`、`js/modules/event-list.js`、`js/modules/role.js`、`js/modules/scan.js`
- **測試數量**：28

#### `_rebuildOccupancy` (js/firebase-crud.js:442-468) — 9 tests

根據活動設定與報名列表，計算佔位人數、候補人數與狀態。

| # | 測試案例 |
|---|---------|
| 1 | `empty registrations → current=0, waitlist=0, status=open` |
| 2 | `all confirmed, under max → correct count, status=open` |
| 3 | `all confirmed, at max → status=full` |
| 4 | `mix confirmed + waitlisted → correct counts` |
| 5 | `companion registrations → companionName used when present` |
| 6 | `event status ended → stays ended regardless of count` |
| 7 | `event status cancelled → stays cancelled` |
| 8 | `registrations with blank/missing userName → filtered out` |
| 9 | `max=0 edge case → any confirmed makes it full` |

#### `_isEventDelegate` (js/modules/event-list.js:377-381) — 5 tests

檢查用戶是否為活動委託人。

| # | 測試案例 |
|---|---------|
| 1 | `no delegates field → false` |
| 2 | `empty delegates array → false` |
| 3 | `user is in delegates → true` |
| 4 | `user is not in delegates → false` |
| 5 | `multiple delegates, user is one of them → true` |

#### `_isAnyActiveEventDelegate` (js/modules/role.js:71-86) — 8 tests

檢查用戶是否為任何可掃碼活動的委託人（含 preset event 修正）。

| # | 測試案例 |
|---|---------|
| 1 | `no events → false` |
| 2 | `events exist but none with user as delegate → false` |
| 3 | `open event with user as delegate → true` |
| 4 | `full event with user as delegate → true` |
| 5 | `ended event with user as delegate → true (THE FIX!)` |
| 6 | `cancelled event with user as delegate → false` |
| 7 | `preset eventId matches delegate → true (THE FIX!)` |
| 8 | `preset eventId but user is not delegate → false` |

#### `_categorizeScanEvents` (js/modules/scan.js:96-123) — 6 tests

將活動分為今日、過去、未來三個桶。

| # | 測試案例 |
|---|---------|
| 1 | `events categorized into today/past/future correctly` |
| 2 | `events with unparseable dates go to past` |
| 3 | `today events sorted ascending` |
| 4 | `past events sorted descending` |
| 5 | `future events sorted ascending` |
| 6 | `empty events array → all buckets empty` |

---

### 2.2 `tests/unit/config-utils.test.js`

- **測試來源**：`js/config.js`
- **測試數量**：90

#### `escapeHTML` (js/config.js:604-612) — 14 tests

HTML 特殊字元跳脫，防止 XSS。

| # | 測試案例 |
|---|---------|
| 1 | `returns empty string for null` |
| 2 | `returns empty string for undefined` |
| 3 | `returns empty string for empty string` |
| 4 | `passes through normal strings unchanged` |
| 5 | `escapes ampersand` |
| 6 | `escapes less-than` |
| 7 | `escapes greater-than` |
| 8 | `escapes double quote` |
| 9 | `escapes single quote` |
| 10 | `escapes all HTML special chars together` |
| 11 | `handles already-escaped content (double escaping)` |
| 12 | `converts number to string and returns it` |
| 13 | `converts boolean to string` |
| 14 | `handles mixed content with HTML tags and entities` |

#### `generateId` (js/config.js:614-616) — 6 tests

生成唯一 ID（可選前綴 + 時間戳 + 隨機碼）。

| # | 測試案例 |
|---|---------|
| 1 | `generates ID with prefix` |
| 2 | `generates ID without prefix` |
| 3 | `generates ID with empty string prefix` |
| 4 | `generates ID with null prefix (treated as empty)` |
| 5 | `generates unique values on successive calls` |
| 6 | `includes timestamp component` |

#### Sport Config Lookup — 15 tests

##### `getSportKeySafe` (js/config.js:571-574) — 6 tests

驗證運動項目 key 是否合法。

| # | 測試案例 |
|---|---------|
| 1 | `returns valid key for known sport` |
| 2 | `returns empty string for invalid key` |
| 3 | `returns empty string for null/undefined` |
| 4 | `returns empty string for empty string` |
| 5 | `trims whitespace` |
| 6 | `handles numeric input` |

##### `getSportLabelByKey` (js/config.js:576-579) — 3 tests

取得運動項目中文標籤。

| # | 測試案例 |
|---|---------|
| 1 | `returns correct label for valid key` |
| 2 | `returns football label as default for invalid key` |
| 3 | `returns football label for null/undefined` |

##### `getSportIconSvg` (js/config.js:581-586) — 6 tests

取得運動項目 emoji HTML span。

| # | 測試案例 |
|---|---------|
| 1 | `returns emoji span for valid key` |
| 2 | `includes className when provided` |
| 3 | `defaults to football emoji for invalid key` |
| 4 | `defaults to football emoji for null/undefined` |
| 5 | `no extra space in class when className is empty` |
| 6 | `returns correct emoji for each sport` |

#### Permission System — 57 tests

##### `isPermissionCodeEnabled` (js/config.js:700-704) — 4 tests

檢查權限碼是否啟用（未被停用）。

| # | 測試案例 |
|---|---------|
| 1 | `returns true for valid enabled code` |
| 2 | `returns false for disabled code` |
| 3 | `returns false for empty string` |
| 4 | `returns false for non-string types` |

##### `sanitizePermissionCodeList` (js/config.js:706-710) — 5 tests

清理權限碼清單：去重、移除停用碼。

| # | 測試案例 |
|---|---------|
| 1 | `removes duplicates` |
| 2 | `removes disabled codes` |
| 3 | `returns empty array for non-array input` |
| 4 | `returns empty array for empty array` |
| 5 | `filters out non-string items` |

##### `getInherentRolePermissions` (js/config.js:746-748) — 7 tests

取得角色的固有權限（不可移除）。

| # | 測試案例 |
|---|---------|
| 1 | `returns permissions for coach` |
| 2 | `returns permissions for captain` |
| 3 | `returns permissions for venue_owner` |
| 4 | `returns empty array for user role` |
| 5 | `returns empty array for admin role` |
| 6 | `returns empty array for super_admin role` |
| 7 | `returns empty array for unknown role` |

##### `getAdminDrawerPermissionCodes` (js/config.js:765-767) — 4 tests

從側邊欄選單定義提取所有權限碼。

| # | 測試案例 |
|---|---------|
| 1 | `returns array of permission codes` |
| 2 | `includes known permission codes` |
| 3 | `does not include disabled permission codes` |
| 4 | `all returned codes are non-empty strings` |

##### `getAdminPagePermissionCode` (js/config.js:769-772) — 4 tests

頁面 ID 對應權限碼查找。

| # | 測試案例 |
|---|---------|
| 1 | `returns permission code for known admin page` |
| 2 | `returns empty string for page without permission` |
| 3 | `returns empty string for unknown page` |
| 4 | `returns empty string for disabled permission page (roles)` |

##### `getMergedPermissionCatalog` (js/config.js:774-809) — 7 tests

合併內建與遠端權限分類。

| # | 測試案例 |
|---|---------|
| 1 | `returns built-in categories when no remote` |
| 2 | `includes extra permission items for pages that have them` |
| 3 | `merges remote categories without duplicating built-in codes` |
| 4 | `merges into existing category if cat name matches` |
| 5 | `filters out disabled codes from remote` |
| 6 | `handles null remoteCategories` |
| 7 | `handles empty remote categories` |

##### `getAllPermissionCodes` (js/config.js:811-816) — 4 tests

攤平所有權限碼為一維陣列。

| # | 測試案例 |
|---|---------|
| 1 | `returns flat array of all permission codes` |
| 2 | `includes both entry and extra permission codes` |
| 3 | `does not include disabled codes` |
| 4 | `includes remote codes when provided` |

##### `getDefaultRolePermissions` (js/config.js:818-835) — 8 tests

各角色的預設權限（基於角色等級）。

| # | 測試案例 |
|---|---------|
| 1 | `returns null for non-builtin role` |
| 2 | `returns empty array for user role` |
| 3 | `returns permissions for coach (level 1)` |
| 4 | `returns more permissions for admin than coach` |
| 5 | `admin gets team.create and team.manage_all` |
| 6 | `super_admin gets all drawer permission codes` |
| 7 | `returns no duplicates` |
| 8 | `coach does not get admin-level permissions` |

##### `getAdminDrawerPermissionDefinitions` — 隱含測試

透過 `getAdminDrawerPermissionCodes`、`getAdminPagePermissionCode`、`getMergedPermissionCatalog` 間接覆蓋。

#### `_normalizeRuntimeCustomRoles` (js/config.js:395-404) — 8 tests

正規化自訂角色定義。

| # | 測試案例 |
|---|---------|
| 1 | `normalizes valid custom roles` |
| 2 | `applies defaults for missing optional fields` |
| 3 | `returns empty array for null/undefined input` |
| 4 | `returns empty array for empty array` |
| 5 | `filters out entries without key` |
| 6 | `filters out entries where key is not a string` |
| 7 | `handles multiple valid roles` |
| 8 | `preserves key as label when label is empty string` |

---

### 2.3 `tests/unit/achievement.test.js`

- **測試來源**：`js/modules/achievement/shared.js`、`js/modules/achievement/evaluator.js`、`js/modules/achievement/stats.js`
- **測試數量**：133

#### shared.js 函式 — 28 tests

##### `sortByCat` (shared.js:28-29) — 5 tests

依成就等級（金、銀、銅）排序。

| # | 測試案例 |
|---|---------|
| 1 | `sorts gold before silver before bronze` |
| 2 | `does not mutate original array` |
| 3 | `unknown categories sort to end` |
| 4 | `empty array returns empty` |
| 5 | `stable sort for same category` |

##### `getCategoryOrder` (shared.js:32-33) — 2 tests

取得等級排序對照表。

| # | 測試案例 |
|---|---------|
| 1 | `returns copy of category order map` |
| 2 | `returned object is a copy (not same reference)` |

##### `getCategoryColor` (shared.js:36-37) — 5 tests

取得等級顏色。

| # | 測試案例 |
|---|---------|
| 1 | `returns correct color for gold` |
| 2 | `returns correct color for silver` |
| 3 | `returns correct color for bronze` |
| 4 | `unknown category falls back to bronze` |
| 5 | `undefined category falls back to bronze` |

##### `getCategoryBg` (shared.js:40-41) — 2 tests

取得等級背景色。

| # | 測試案例 |
|---|---------|
| 1 | `returns correct bg for gold` |
| 2 | `unknown category falls back to bronze` |

##### `getCategoryLabel` (shared.js:44-45) — 4 tests

取得等級中文標籤。

| # | 測試案例 |
|---|---------|
| 1 | `returns correct label for gold` |
| 2 | `returns correct label for silver` |
| 3 | `returns correct label for bronze` |
| 4 | `unknown category falls back to bronze label` |

##### `getThresholdShared` (shared.js:48-52) — 5 tests

取得成就門檻值。

| # | 測試案例 |
|---|---------|
| 1 | `returns condition.threshold when present` |
| 2 | `returns target when no condition.threshold` |
| 3 | `returns 1 as default` |
| 4 | `returns 1 for null/undefined` |
| 5 | `threshold 0 is valid (not null)` |

##### `generateConditionDesc` (shared.js:55-68) — 5 tests

生成成就條件描述文字。

| # | 測試案例 |
|---|---------|
| 1 | `returns desc or default when no condition` |
| 2 | `streak format` |
| 3 | `simple action with threshold <= 1` |
| 4 | `action with threshold > 1` |
| 5 | `action with timeRange` |

#### evaluator.js 函式 — 60 tests

##### `normalizeString` (evaluator.js:103-106) — 6 tests

字串正規化（trim + 空值處理）。

| # | 測試案例 |
|---|---------|
| 1 | `trims whitespace` |
| 2 | `converts null/undefined to empty string` |
| 3 | `converts number to string` |
| 4 | `converts 0 to empty string (falsy)` |
| 5 | `empty string stays empty` |
| 6 | `preserves inner whitespace` |

##### `normalizeLower` (evaluator.js:108-110) — 3 tests

字串小寫正規化。

| # | 測試案例 |
|---|---------|
| 1 | `lowercases and trims` |
| 2 | `null returns empty` |
| 3 | `mixed case` |

##### `toFiniteNumber` (evaluator.js:112-116) — 8 tests

安全轉換為有限數字。

| # | 測試案例 |
|---|---------|
| 1 | `returns number for valid input` |
| 2 | `returns fallback for NaN` |
| 3 | `returns fallback for Infinity` |
| 4 | `default fallback is 0` |
| 5 | `returns 0 for input 0` |
| 6 | `returns negative numbers` |
| 7 | `null returns 0 (Number(null) === 0, which is finite)` |
| 8 | `undefined returns fallback (Number(undefined) is NaN)` |

##### `parseDateValue` (evaluator.js:118-123) — 14 tests

多格式日期解析（Date / Timestamp / 字串 / epoch）。

| # | 測試案例 |
|---|---------|
| 1 | `returns null for null/undefined/empty` |
| 2 | `returns clone of valid Date object` |
| 3 | `returns null for invalid Date object` |
| 4 | `handles Firestore Timestamp mock with toDate()` |
| 5 | `handles Firestore Timestamp mock with toDate() returning invalid` |
| 6 | `handles {seconds, nanoseconds} object` |
| 7 | `handles {seconds, nanoseconds} with no nanoseconds` |
| 8 | `handles epoch number (milliseconds)` |
| 9 | `handles "YYYY/MM/DD" string` |
| 10 | `handles "YYYY/MM/DD HH:mm:ss" string` |
| 11 | `handles "YYYY-MM-DD" string` |
| 12 | `handles "YYYY-MM-DDTHH:mm:ss" ISO-like string` |
| 13 | `handles "YYYY-MM-DD HH:mm" string (no seconds)` |
| 14 | `handles whitespace-padded string` |

##### `isEventEnded` (evaluator.js) — 4 tests

判斷活動是否已結束。

| # | 測試案例 |
|---|---------|
| 1 | `returns true when status is ended` |
| 2 | `returns false when status is open` |
| 3 | `returns false for null event` |
| 4 | `returns false for no status` |

##### `maxDate` (evaluator.js:125-129) — 6 tests

取兩個日期中較晚者。

| # | 測試案例 |
|---|---------|
| 1 | `returns the later date` |
| 2 | `returns b when a is null` |
| 3 | `returns a when b is null` |
| 4 | `returns null when both are null` |
| 5 | `returns a when dates are equal` |
| 6 | `handles undefined` |

##### `formatCompletedDate` (evaluator.js:131-134) — 3 tests

格式化日期為 YYYY/MM/DD。

| # | 測試案例 |
|---|---------|
| 1 | `formats date as YYYY/MM/DD` |
| 2 | `pads single-digit month and day` |
| 3 | `uses current date when non-Date is passed` |

##### `normalizeCurrentValue` (evaluator.js:136-141) — 7 tests

正規化成就進度值。

| # | 測試案例 |
|---|---------|
| 1 | `returns positive integer` |
| 2 | `rounds to nearest integer` |
| 3 | `returns 0 for negative` |
| 4 | `returns 0 for zero` |
| 5 | `returns 0 for non-finite` |
| 6 | `parses string numbers` |
| 7 | `returns 0 for null/undefined` |

##### `isSelfParticipantRecord` (evaluator.js:143-149) — 7 tests

判斷是否為本人（非同行者）的參與記錄。

| # | 測試案例 |
|---|---------|
| 1 | `returns true for matching uid` |
| 2 | `returns true for matching userId field` |
| 3 | `returns false for null record` |
| 4 | `returns false for mismatched uid` |
| 5 | `returns false for companion records` |
| 6 | `trims whitespace in uid comparison` |
| 7 | `returns false when record has no uid/userId` |

#### stats.js 函式 — 45 tests

##### `getThreshold` (stats.js:13-18) — 6 tests

取得成就門檻值（stats 版本）。

| # | 測試案例 |
|---|---------|
| 1 | `returns condition.threshold when present` |
| 2 | `returns target when no condition.threshold` |
| 3 | `returns 1 as default` |
| 4 | `handles null` |
| 5 | `prefers condition.threshold over target` |
| 6 | `threshold 0 is valid` |

##### `getActiveAchievements` (stats.js:21-26) — 4 tests

過濾出非封存的成就。

| # | 測試案例 |
|---|---------|
| 1 | `filters out archived achievements` |
| 2 | `returns empty for non-array` |
| 3 | `filters out null/falsy entries` |
| 4 | `empty array returns empty` |

##### `isCompleted` (stats.js:28-30) — 6 tests

判斷成就是否已達成。

| # | 測試案例 |
|---|---------|
| 1 | `returns true when current >= threshold` |
| 2 | `returns false when current < threshold` |
| 3 | `defaults current to 0` |
| 4 | `defaults threshold to 1` |
| 5 | `handles null` |
| 6 | `threshold 0 means always completed` |

##### `getCompletedAchievements` (stats.js:32-34) — 1 test

取得已完成的成就清單。

| # | 測試案例 |
|---|---------|
| 1 | `returns only completed and active achievements` |

##### `getPendingAchievements` (stats.js:36-38) — 1 test

取得進行中的成就清單。

| # | 測試案例 |
|---|---------|
| 1 | `returns only pending and active achievements` |

##### `splitAchievements` (stats.js:40-45) — 2 tests

將成就分為 active / completed / pending。

| # | 測試案例 |
|---|---------|
| 1 | `splits into active, completed, and pending` |
| 2 | `handles empty array` |

##### `getBadgeCount` & `getEarnedBadgeViewModels` (stats.js:47-71) — 7 tests

徽章計數與已獲得徽章 ViewModel 組裝。

| # | 測試案例 |
|---|---------|
| 1 | `getBadgeCount counts only earned badges` |
| 2 | `getEarnedBadgeViewModels returns correct structure` |
| 3 | `empty badges returns empty` |
| 4 | `empty achievements returns empty` |
| 5 | `badge with no matching achievement is filtered out` |
| 6 | `uses badge category as fallback when achievement has none` |
| 7 | `defaults to bronze when neither achievement nor badge has category` |

##### `getTitleOptions` (stats.js:73-80) — 2 tests

取得可選稱號（金級 / 一般分開）。

| # | 測試案例 |
|---|---------|
| 1 | `separates gold and non-gold titles` |
| 2 | `empty when no completed` |

##### `getParticipantAttendanceStats` (stats.js:82-153) — 20 tests

出席統計核心函式（完成場次、出席率、放鴿子偵測）。

| # | 測試案例 |
|---|---------|
| 1 | `returns zero stats for empty inputs` |
| 2 | `returns zero stats when called with no arguments` |
| 3 | `returns zero stats for null registrations/attendance` |
| 4 | `counts expected events from registered + ended events` |
| 5 | `excludes cancelled registrations` |
| 6 | `excludes registrations for events not in eventMap` |
| 7 | `counts attended events (checkin only)` |
| 8 | `counts completed events (checkin + checkout)` |
| 9 | `excludes companion attendance records` |
| 10 | `excludes participantType=companion attendance records` |
| 11 | `ignores attendance for non-expected events` |
| 12 | `attendance records with wrong uid are excluded` |
| 13 | `handles registration with userId field instead of uid` |
| 14 | `filters registrations with mismatched uid` |
| 15 | `uses status fallback when no isEventEnded function` |
| 16 | `full scenario: mix of ended/open events with attendance` |
| 17 | `handles null entries in registrations array` |
| 18 | `handles null entries in attendanceRecords array` |
| 19 | `ignores attendance records with invalid type` |
| 20 | `returns Set objects for event ID collections` |

---

### 2.4 `tests/unit/event-utils.test.js`

- **測試來源**：`js/modules/event-list.js`、`js/core/navigation.js`、`js/firebase-crud.js`
- **測試數量**：121

#### 性別限制邏輯 (event-list.js:158-229) — 52 tests

##### `_normalizeBinaryGender` — 9 tests

正規化二元性別值（僅接受「男」/「女」）。

| # | 測試案例 |
|---|---------|
| 1 | `returns "男" for "男"` |
| 2 | `returns "女" for "女"` |
| 3 | `returns empty string for "male"` |
| 4 | `returns empty string for "female"` |
| 5 | `returns empty string for "other"` |
| 6 | `returns empty string for empty string` |
| 7 | `returns empty string for null` |
| 8 | `returns empty string for undefined` |
| 9 | `returns empty string for number` |

##### `_getEventAllowedGender` — 8 tests

取得活動允許的性別（需啟用限制）。

| # | 測試案例 |
|---|---------|
| 1 | `returns empty string when event is null` |
| 2 | `returns empty string when event is undefined` |
| 3 | `returns empty string when genderRestrictionEnabled is false` |
| 4 | `returns empty string when genderRestrictionEnabled is missing` |
| 5 | `returns "男" when enabled and allowedGender is "男"` |
| 6 | `returns "女" when enabled and allowedGender is "女"` |
| 7 | `returns empty string when enabled but allowedGender is invalid` |
| 8 | `returns empty string when enabled but allowedGender is missing` |

##### `_hasEventGenderRestriction` — 5 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns false for unrestricted event` |
| 2 | `returns false for null event` |
| 3 | `returns true for male-restricted event` |
| 4 | `returns true for female-restricted event` |
| 5 | `returns false when enabled but invalid gender` |

##### `_getEventGenderRibbonText` — 4 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns empty string for unrestricted event` |
| 2 | `returns "男生限定" for male-only event` |
| 3 | `returns "女生限定" for female-only event` |
| 4 | `returns empty string for null event` |

##### `_getEventGenderTimelineRibbonText` — 3 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns empty string for unrestricted event` |
| 2 | `returns "限男生" for male-only event` |
| 3 | `returns "限女生" for female-only event` |

##### `_getEventGenderDetailText` — 3 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns empty string for unrestricted event` |
| 2 | `returns "限男性報名" for male-only event` |
| 3 | `returns "限女性報名" for female-only event` |

##### `_canEventGenderParticipantSignup` — 9 tests

| # | 測試案例 |
|---|---------|
| 1 | `allows any gender for unrestricted event` |
| 2 | `allows male for male-only event` |
| 3 | `rejects female for male-only event` |
| 4 | `rejects empty gender for male-only event` |
| 5 | `rejects null gender for male-only event` |
| 6 | `rejects unrecognized gender string for male-only event` |
| 7 | `allows female for female-only event` |
| 8 | `rejects male for female-only event` |
| 9 | `rejects undefined gender for restricted event` |

##### `_getEventGenderRestrictionMessage` — 7 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns empty string for unrestricted event` |
| 2 | `returns missing_gender message for male event` |
| 3 | `returns default restriction message for male event` |
| 4 | `returns missing_gender message for female event` |
| 5 | `returns default restriction message for female event` |
| 6 | `returns default message for unknown reason` |
| 7 | `returns empty string for null event` |

##### `_getCompanionGenderRestrictionMessage` — 7 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns empty string for unrestricted event` |
| 2 | `returns named message for male event` |
| 3 | `returns anonymous message for male event without name` |
| 4 | `returns named message for female event` |
| 5 | `returns anonymous message for female event` |
| 6 | `returns anonymous message for empty companion name` |
| 7 | `returns empty string for null event` |

#### 活動俱樂部邏輯 (event-list.js:135-148) — 11 tests

##### `_getEventLimitedTeamIds` — 11 tests

取得活動的俱樂部限制 ID 清單（含去重、trim）。

| # | 測試案例 |
|---|---------|
| 1 | `returns empty array for null event` |
| 2 | `returns empty array for undefined event` |
| 3 | `returns empty array for event with no team fields` |
| 4 | `returns single team from creatorTeamId` |
| 5 | `returns teams from creatorTeamIds array` |
| 6 | `includes creatorTeamId after creatorTeamIds` |
| 7 | `deduplicates when creatorTeamId is in creatorTeamIds` |
| 8 | `deduplicates within creatorTeamIds` |
| 9 | `skips empty/null entries in creatorTeamIds` |
| 10 | `trims whitespace from IDs` |
| 11 | `skips empty creatorTeamId` |

#### 活動人員摘要 (event-list.js:264-312) — 16 tests

##### `_buildEventPeopleSummaryByStatus` — 16 tests

根據報名記錄建構人員摘要（含同行者、去重、fallback）。

| # | 測試案例 |
|---|---------|
| 1 | `returns empty result for null event` |
| 2 | `returns empty result with no registrations` |
| 3 | `returns empty result when no registrations match status` |
| 4 | `returns confirmed participants only` |
| 5 | `handles companions correctly` |
| 6 | `deduplicates same-name participants` |
| 7 | `deduplicates companion with same name as main participant` |
| 8 | `uses fallback names when no registrations match` |
| 9 | `fallback names do not duplicate registration names` |
| 10 | `fallback names skip empty/null entries` |
| 11 | `fallback names deduplicate among themselves` |
| 12 | `handles non-array registrations gracefully` |
| 13 | `handles non-array fallbackNames gracefully` |
| 14 | `groups by userId, self reg provides main name` |
| 15 | `companion uses companionName over userName` |
| 16 | `companion falls back to userName when companionName is missing` |

#### 活動容量徽章 (event-list.js:366-370) — 4 tests

##### `_renderEventCapacityBadge` — 4 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns full badge HTML when showFullBadge is true` |
| 2 | `returns almost-full badge HTML when showAlmostFullBadge is true` |
| 3 | `returns empty string when neither badge applies` |
| 4 | `full badge takes priority over almost-full badge` |

#### 活動運動標籤 (event-list.js:396-399) — 7 tests

##### `_getEventSportTag` — 7 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns "football" for event with no sportTag` |
| 2 | `returns "football" for null event` |
| 3 | `returns "football" for undefined event` |
| 4 | `returns valid sport key for known sportTag` |
| 5 | `returns "football" for unknown sportTag` |
| 6 | `returns valid key for all EVENT_SPORT_OPTIONS` |
| 7 | `trims whitespace in sportTag` |

#### 導航函式 (navigation.js:9-31) — 13 tests

##### `_getRouteStepTimeoutMs` — 6 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns 15000 by default for page step` |
| 2 | `returns 15000 by default for cloud step` |
| 3 | `returns custom timeout for page step` |
| 4 | `returns custom timeout for cloud step` |
| 5 | `cloud step ignores routeStepTimeoutMs` |
| 6 | `page step ignores routeCloudTimeoutMs` |

##### `_getRouteFailureToast` — 7 tests

| # | 測試案例 |
|---|---------|
| 1 | `returns generic page failure for non-timeout error` |
| 2 | `returns cloud failure message for cloud step` |
| 3 | `returns activities-specific timeout message` |
| 4 | `returns generic timeout message for other pages` |
| 5 | `timeout takes priority over cloud step` |
| 6 | `returns page failure for null error` |
| 7 | `returns page failure for error without code` |

#### 活動佔位狀態 (firebase-crud.js:481-517) — 15 tests

##### `_getEventOccupancyState` — 15 tests

從活動資料建構佔位狀態（含陣列 vs fallback 數值、去重、trim）。

| # | 測試案例 |
|---|---------|
| 1 | `returns defaults for empty/undefined input` |
| 2 | `returns defaults for null-ish event data` |
| 3 | `uses fallback current/waitlist counts when no arrays` |
| 4 | `counts participants from array, ignoring fallback current` |
| 5 | `counts waitlist from array, ignoring fallback waitlist` |
| 6 | `deduplicates participants` |
| 7 | `deduplicates waitlist names` |
| 8 | `waitlist excludes names already in participants` |
| 9 | `trims and filters empty/null participant names` |
| 10 | `trims and filters empty/null waitlist names` |
| 11 | `handles negative fallback current gracefully (clamps to 0)` |
| 12 | `handles negative fallback waitlist gracefully (clamps to 0)` |
| 13 | `handles NaN fallback current (clamps to 0)` |
| 14 | `handles both arrays present` |
| 15 | `empty arrays result in zero counts` |

---

## 3. Firestore 規則測試 (`npm run test:rules`)

- **檔案路徑**：`tests/firestore.rules.test.js`
- **測試規則檔**：`firestore.rules`
- **測試數量**：113
- **環境**：Firebase Emulator（Firestore）

### 3.1 `/users/{userId}` — 13 tests

驗證使用者文件的安全規則。

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `[SECURITY_HARDENED] own profile update requires server timestamp for updatedAt when provided` | update |
| 2 | `[SECURITY_HARDENED] lastLogin only allowed in login-shaped update` | update |
| 3 | `[SECURITY_HARDENED] user cannot self-assign new team membership` | update |
| 4 | `[SECURITY_HARDENED] user can clear all own team fields` | update |
| 5 | `[SECURITY_HARDENED] user can shrink own multi-team membership to subset` | update |
| 6 | `[SECURITY_HARDENED] user cannot fake shrink to unrelated team or reorder same-size list` | update |
| 7 | `[SECURITY_HARDENED] coach/staff path still works with server timestamp but rejects spoofed timestamp` | update |
| 8 | `[SECURITY_HARDENED] user cannot self-edit role/manualRole/claims/isAdmin` | update |
| 9 | `[SECURITY_HARDENED] admin cannot raw update another user's profile or privilege fields` | update |
| 10 | `[SECURITY_HARDENED] super_admin can directly update another user's profile and role` | update |

### 3.2 `/events/{eventId}` — 5 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `read (current): guest/memberA/memberB/admin/superAdmin` | read (allow all) |
| 2 | `write-create (current): guest deny; authenticated allow` | create |
| 3 | `[SECURITY_GAP] write-update (current): any authenticated user can update others' event` | update |
| 4 | `write-delete (current): only admin/superAdmin` | delete |
| 5 | `delete uses users.role when token claim is stale user after promotion` | delete |

### 3.3 `/registrations/{regId}` — 4 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `read: any authenticated user can read registration` | read |
| 2 | `[SECURITY_GAP_FIXED] create: member can create own registration but cannot spoof userId` | create |
| 3 | `[SECURITY_GAP_FIXED] update: member cannot update others' registration` | update |
| 4 | `[SECURITY_GAP_FIXED] delete: member cannot delete others' registration` | delete |

### 3.4 `/messages/{msgId}` — 4 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `[SECURITY_GAP_FIXED] read: only sender/recipient/admin can read message` | read |
| 2 | `[SECURITY_GAP_FIXED] create: member can create own message but cannot spoof sender` | create |
| 3 | `[SECURITY_GAP_FIXED] update: participants can only update message metadata` | update |
| 4 | `[SECURITY_GAP_FIXED] delete: member cannot delete others' message unless sender` | delete |

### 3.5 `/linePushQueue/{docId}` — 4 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `read (current): denied for all roles` | read (deny all) |
| 2 | `[SECURITY_GAP_FIXED] create: only admin/superAdmin can enqueue push` | create |
| 3 | `update (current): denied for all roles` | update (deny all) |
| 4 | `delete (current): denied for all roles` | delete (deny all) |

### 3.6 `logs/records high-risk matrix` — 6 tests

涵蓋多個日誌/記錄集合的 CRUD 權限矩陣。

| # | 測試案例 | 集合 |
|---|---------|------|
| 1 | `[SECURITY_GAP] /activityRecords: read/create/update are auth-wide; delete admin/super only` | activityRecords |
| 2 | `[SECURITY_GAP] /attendanceRecords: read/create/update are auth-wide; delete denied for all` | attendanceRecords |
| 3 | `[SECURITY_GAP] /expLogs: read/create are auth-wide; update/delete denied for all` | expLogs |
| 4 | `[SECURITY_GAP] /teamExpLogs: read/create are auth-wide; update/delete denied for all` | teamExpLogs |
| 5 | `[SECURITY_GAP] /operationLogs: read/create are auth-wide; update/delete denied for all` | operationLogs |
| 6 | `[SECURITY_GAP] /errorLogs: create is auth-wide; read/delete only superAdmin` | errorLogs |

### 3.7 `/auditLogsByDay/{dayKey}/auditEntries` — 1 test

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `[LOCKED_DOWN] read only superAdmin; client writes denied` | read/create/update/delete |

### 3.8 `/userCorrections/{uid}` — 3 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `super_admin can manage no-show corrections without rolePermissions doc` | create/update/delete |
| 2 | `admin requires explicit permission to manage no-show corrections` | create (permission-based) |
| 3 | `user role cannot manage no-show corrections even if rolePermissions doc exists` | create (deny) |

### 3.9 `/teams/{teamId}` — 4 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `read (current): allow all` | read |
| 2 | `create (current): guest deny; authenticated allow with name` | create |
| 3 | `update: owner or hasPerm('team.manage_all') can update, others cannot` | update |
| 4 | `delete (current): owner or admin/superAdmin` | delete |

### 3.10 `/shopItems/{itemId}` — 4 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `read (current): allow all` | read |
| 2 | `create (current): guest deny; authenticated allow` | create |
| 3 | `[SECURITY_GAP_FIXED] update: only owner or admin can update item` | update |
| 4 | `delete (current): owner or admin/superAdmin` | delete |

### 3.11 `/trades/{tradeId}` — 4 tests

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `read (current): guest deny; authenticated allow` | read |
| 2 | `[SECURITY_GAP] create (current): any authenticated user can create spoofed ownership fields` | create |
| 3 | `update (current): owner or admin/superAdmin` | update |
| 4 | `delete (current): owner or admin/superAdmin` | delete |

### 3.12 `Role usability smoke tests` — 16 tests

跨角色（user / coach / manager / leader / admin / superAdmin）的功能性煙霧測試。

| # | 測試案例 |
|---|---------|
| 1 | `user can create own registration` |
| 2 | `user can update own registration` |
| 3 | `user can delete own registration` |
| 4 | `user cannot update another user's registration` |
| 5 | `user cannot delete another user's registration` |
| 6 | `user can create message with fromUid=self` |
| 7 | `user can delete own sent message` |
| 8 | `user cannot delete another user's message` |
| 9 | `user can read received inbox message (toUid=self)` |
| 10 | `coach can update own created event` |
| 11 | `[SECURITY_GAP_USABILITY] non-coach user can update event` |
| 12 | `manager/leader can update teams` |
| 13 | `[SECURITY_GAP_FIXED] user cannot update teams without owner/manager context` |
| 14 | `user can read own attendance record` |
| 15 | `user can create attendance record` |
| 16 | `user cannot create line push queue job` |

### 3.13 `/attendanceRecords/{recordId}` — 8 tests

簽到記錄的完整 CRUD 測試。

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `any authenticated user can read` | read |
| 2 | `guest cannot read` | read (deny) |
| 3 | `any authenticated user can create` | create |
| 4 | `guest cannot create` | create (deny) |
| 5 | `admin can update any field` | update |
| 6 | `non-admin can update status fields only (isAttendanceStatusUpdate)` | update |
| 7 | `non-admin can update removedAt and removedByUid status fields` | update |
| 8 | `non-admin cannot update non-status fields like eventId or type` | update |

### 3.14 `/users/{userId} self-update security boundaries` — 26 tests

使用者自助更新的安全邊界測試。

| # | 測試案例 | 驗證路徑 |
|---|---------|----------|
| 1 | `owner can update safe profile fields (displayName, phone, gender, etc.)` | isSafeSelfProfileUpdate |
| 2 | `owner can update photoURL, pictureUrl, favorites, socialLinks` | isSafeSelfProfileUpdate |
| 3 | `owner can update titleBig, titleNormal, lineNotify, companions` | isSafeSelfProfileUpdate |
| 4 | `owner can set nullable profile fields to null` | isSafeSelfProfileUpdate |
| 5 | `owner CANNOT update role` | deny |
| 6 | `owner CANNOT update exp` | deny |
| 7 | `owner CANNOT update level` | deny |
| 8 | `owner CANNOT update uid` | deny |
| 9 | `owner CANNOT update isAdmin` | deny |
| 10 | `owner CANNOT update createdAt` | deny |
| 11 | `owner CANNOT update claims or manualRole` | deny |
| 12 | `owner CANNOT update lineUserId` | deny |
| 13 | `owner CANNOT update teamId/teamName via normal profile update` | deny |
| 14 | `owner CAN do team field shrink (remove from teamIds)` | isTeamFieldShrinkOrClear |
| 15 | `owner CAN clear all team fields` | isTeamFieldShrinkOrClear |
| 16 | `owner CAN clear team fields using null for teamIds/teamNames` | isTeamFieldShrinkOrClear |
| 17 | `owner CANNOT add new team via team shrink path` | deny |
| 18 | `owner CANNOT replace team list with different team of same size` | deny |
| 19 | `login update: can update displayName + pictureUrl + lastLogin` | isSafeLoginUpdate |
| 20 | `login update: can update only lastLogin with server timestamp` | isSafeLoginUpdate |
| 21 | `login update: can update displayName + lastLogin without pictureUrl` | isSafeLoginUpdate |
| 22 | `login update: lastLogin must equal request.time (serverTimestamp)` | deny |
| 23 | `login update: cannot include other fields like phone` | deny |
| 24 | `login update: cannot include updatedAt (not in login shape)` | deny |
| 25 | `non-owner cannot update another user's profile even with safe fields` | deny |
| 26 | `non-owner cannot use login update path on another user` | deny |

### 3.15 `/rolePermissions/{roleKey}` — 12 tests

角色權限設定文件的存取控制。

| # | 測試案例 | 驗證規則 |
|---|---------|----------|
| 1 | `any authenticated user can read` | read |
| 2 | `guest cannot read` | read (deny) |
| 3 | `superAdmin can create new rolePermissions doc` | create |
| 4 | `superAdmin can update existing rolePermissions doc` | update |
| 5 | `superAdmin can delete rolePermissions doc` | delete |
| 6 | `admin cannot create rolePermissions` | create (deny) |
| 7 | `admin cannot update rolePermissions` | update (deny) |
| 8 | `admin cannot delete rolePermissions` | delete (deny) |
| 9 | `regular user cannot create rolePermissions` | create (deny) |
| 10 | `regular user cannot update rolePermissions` | update (deny) |
| 11 | `regular user cannot delete rolePermissions` | delete (deny) |
| 12 | `memberA cannot write rolePermissions` | create/update (deny) |

---

## 4. 測試架構說明

### 為何函式被複製到測試檔案中？

本專案採用 `Object.assign(App, {...})` 模式擴充全域物件，而非 ES Modules。函式定義散落在各 `.js` 檔案中，無法直接 `import` / `require`。

因此，每個測試檔案會將待測函式的原始碼**完整複製**為獨立函式，並在函式上方以註解標示來源檔案與行號範圍（例如 `// Extracted from js/firebase-crud.js:442-468`）。

對於依賴 `this.*` 或全域變數的函式，會改寫為接受顯式參數的版本以利測試。

### 當正式碼變更時如何維護測試？

1. **檢查來源行號**：每個複製函式上方都標註了來源（如 `js/config.js:604-612`），修改正式碼後需對照更新。
2. **同步複製**：若正式碼的函式邏輯改變，必須將新版邏輯同步複製到對應的測試檔案中。
3. **來源行號更新**：正式碼若因新增程式碼而行號偏移，應一併更新測試檔案中的來源行號註解。
4. **新增測試案例**：若正式碼新增了邊界條件處理，應同步新增對應的測試案例。

### Firestore Emulator 測試運作方式

1. `npm run test:rules` 透過 `firebase emulators:exec` 自動啟動 Firestore Emulator。
2. 測試使用 `@firebase/rules-unit-testing` 套件，載入 `firestore.rules` 規則檔。
3. `beforeEach` 會清除所有 Firestore 資料並重新 seed 基礎文件。
4. 透過 `assertSucceeds` / `assertFails` 驗證各角色（guest / user / coach / admin / super_admin）對各集合的 CRUD 權限。
5. `seedBaseDocs()` 建立完整的測試種子資料（用戶、活動、報名、訊息、俱樂部、日誌等）。
6. 角色權限測試使用 `rolePermissions` 集合模擬動態權限查詢。

---

## 5. 覆蓋範圍與限制

### 已覆蓋

- **純函式邏輯**：佔位計算、委託人判斷、活動分類、HTML 跳脫、ID 生成、運動項目查找
- **權限系統**：權限碼啟用檢查、清理、角色預設權限、權限目錄合併
- **成就系統**：等級排序/顏色/標籤、門檻計算、完成判斷、徽章 ViewModel、出席統計
- **活動工具**：性別限制全鏈路（9 個函式）、俱樂部 ID 提取、人員摘要建構、容量徽章、運動標籤
- **導航工具**：路由逾時計算、失敗提示訊息
- **Firestore 安全規則**：15 個集合/子集合的完整 CRUD 權限矩陣，含角色提升/降級、時間戳偽造防護、欄位級別寫入限制

### 尚未覆蓋

- **DOM 操作**：所有涉及 `document.querySelector`、`innerHTML`、事件監聽器的 UI 邏輯
- **API 呼叫**：`firebase.firestore()` 的實際讀寫操作、`liff.*` API、`fetch()` 呼叫
- **整合測試**：跨模組互動（例如報名 → 佔位重建 → UI 更新的完整流程）
- **非同步流程**：`onSnapshot` 監聽器、Promise 鏈、錯誤重試邏輯
- **Service Worker**：`sw.js` 的快取策略與離線行為
- **Cloud Functions**：`functions/` 目錄下的 18 個 Cloud Functions
- **LINE LIFF 整合**：登入流程、shareTargetPicker、LIFF URL 解析
- **Demo 模式**：`DemoData` / `ModeManager` 的模式切換邏輯
- **瀏覽器相容性**：LINE WebView / Chrome / Safari 的跨瀏覽器行為

### 2.5 `tests/unit/tournament-core.test.js`

- **測試來源**：`js/modules/tournament/tournament-core.js`
- **測試數量**：42

#### `getTournamentStatus` — 6 tests

根據報名起訖日期判斷賽事狀態。

| # | 測試案例 |
|---|---------|
| 1 | `returns 即將開始 for null/undefined` |
| 2 | `returns existing status when no dates` |
| 3 | `returns 即將開始 when missing regStart/regEnd` |
| 4 | `returns 即將開始 when before regStart` |
| 5 | `returns 報名中 when within registration period` |
| 6 | `returns 已截止報名 when after regEnd` |

#### `isTournamentEnded` — 8 tests

根據 ended 旗標與最後比賽日判斷賽事是否結束。

| # | 測試案例 |
|---|---------|
| 1 | `returns false for null/undefined` |
| 2 | `returns true when ended flag is true` |
| 3 | `returns false when ended flag is false with no matchDates` |
| 4 | `returns false when matchDates is empty` |
| 5 | `returns false when matchDates has invalid date` |
| 6 | `returns true when last matchDate + 24h is in the past` |
| 7 | `returns false when last matchDate + 24h is in the future` |
| 8 | `uses the last element of matchDates` |

#### `_getTournamentMode` — 6 tests

解析賽事模式（友誼賽/杯賽/聯賽）。

| # | 測試案例 |
|---|---------|
| 1 | `defaults to friendly for null/undefined` |
| 2 | `detects cup mode` |
| 3 | `detects league mode` |
| 4 | `detects friendly mode` |
| 5 | `falls back to friendly for unknown modes` |
| 6 | `priority: mode > typeCode > type` |

#### `_sanitizeFriendlyTournamentTeamLimit` — 5 tests

友誼賽隊伍上限清理（限制 2~4 範圍）。

| # | 測試案例 |
|---|---------|
| 1 | `clamps to [2, 4] range` |
| 2 | `floors decimal values` |
| 3 | `returns fallback for non-finite values` |
| 4 | `respects custom fallback` |
| 5 | `handles string numbers` |

#### `_buildTournamentOrganizerDisplay` — 5 tests

組合主辦方顯示文字（隊名 + 用戶名）。

| # | 測試案例 |
|---|---------|
| 1 | `returns combined format when both provided` |
| 2 | `returns team name only when user empty` |
| 3 | `returns user name only when team empty` |
| 4 | `returns fallback when both empty` |
| 5 | `trims whitespace` |

#### `_getTournamentOrganizerDisplayText` — 4 tests

從賽事物件取得主辦方顯示文字。

| # | 測試案例 |
|---|---------|
| 1 | `returns fallback for null tournament` |
| 2 | `returns organizerDisplay when set` |
| 3 | `builds from hostTeamName + organizer` |
| 4 | `falls back to creatorName` |

#### `_normalizeTournamentDelegates` — 5 tests

正規化賽事委託人清單（去重、過濾空值）。

| # | 測試案例 |
|---|---------|
| 1 | `returns empty array for non-array input` |
| 2 | `normalizes delegates` |
| 3 | `deduplicates by uid` |
| 4 | `deduplicates by name when uid empty` |
| 5 | `skips entries with no uid or name` |

#### `_getTournamentDelegateUids` — 4 tests

合併 delegateUids 與 delegates 為 UID 集合。

| # | 測試案例 |
|---|---------|
| 1 | `merges delegateUids and delegates` |
| 2 | `deduplicates across both sources` |
| 3 | `handles missing delegateUids` |
| 4 | `skips empty uids` |

#### `_isTournamentLeaderForTeam` — 5 tests

判斷用戶是否為某隊領隊。

| # | 測試案例 |
|---|---------|
| 1 | `returns false for null inputs` |
| 2 | `matches by leaderUids array` |
| 3 | `matches by single leaderUid` |
| 4 | `matches by leader displayName` |
| 5 | `returns false when no match` |

#### `_isTournamentCaptainForTeam` — 5 tests

判斷用戶是否為某隊隊長。

| # | 測試案例 |
|---|---------|
| 1 | `returns false for null inputs` |
| 2 | `matches by captainUid` |
| 3 | `matches by captain displayName` |
| 4 | `uses name fallback when displayName missing` |
| 5 | `returns false when no match` |

#### `_buildFriendlyTournamentApplicationRecord` — 4 tests

建立友誼賽申請紀錄（含預設值與正規化）。

| # | 測試案例 |
|---|---------|
| 1 | `returns default values for empty input` |
| 2 | `normalizes all string fields` |
| 3 | `falls back to _docId for id` |
| 4 | `falls back to creatorUid for requestedByUid` |

---

### 2.6 `tests/unit/leaderboard-stats.test.js`

- **測試來源**：`js/modules/leaderboard.js`
- **測試數量**：18

#### `_categorizeRecords` — 基本分類 — 6 tests

活動紀錄三階段分類（完成/報名中/取消）。

| # | 測試案例 |
|---|---------|
| 1 | `empty input returns empty arrays` |
| 2 | `registered records appear in registered (event open)` |
| 3 | `cancelled records appear in cancelled` |
| 4 | `completed records (checkin + checkout) appear in completed` |
| 5 | `checkin only (no checkout) does NOT count as completed` |
| 6 | `removed records are excluded from all categories` |

#### `_categorizeRecords` — 取消後再報名 — 2 tests

| # | 測試案例 |
|---|---------|
| 1 | `cancel then re-register: cancel record hidden, registered shown` |
| 2 | `cancel then re-register then complete: shows completed only` |

#### `_categorizeRecords` — 去重 — 2 tests

| # | 測試案例 |
|---|---------|
| 1 | `duplicate cancelled records for same event only show once` |
| 2 | `duplicate completed records for same event only show once` |

#### `_categorizeRecords` — 結束活動處理 — 2 tests

| # | 測試案例 |
|---|---------|
| 1 | `registered + event ended = missed status` |
| 2 | `waitlisted + event ended = not shown (waitlisted not counted as missed)` |

#### `_categorizeRecords` — 公開模式 — 2 tests

| # | 測試案例 |
|---|---------|
| 1 | `public mode hides registered records` |
| 2 | `public mode still shows completed and cancelled` |

#### `_categorizeRecords` — 多活動混合 — 2 tests

| # | 測試案例 |
|---|---------|
| 1 | `correctly classifies mixed events` |
| 2 | `event with null getEvent result does not appear` |

#### `_categorizeRecords` — 跨類別衝突 — 2 tests

| # | 測試案例 |
|---|---------|
| 1 | `completed event is not also shown in registered` |
| 2 | `attendance from different uid does not affect target user` |

---

### 2.7 `tests/unit/script-loader.test.js`

- **測試來源**：`js/core/script-loader.js`
- **測試數量**：22

#### `_normalizeLocalSrc` — 9 tests

URL 路徑正規化（同源判斷、解碼、query/hash 移除）。

| # | 測試案例 |
|---|---------|
| 1 | `normalizes relative path` |
| 2 | `normalizes absolute path on same origin` |
| 3 | `normalizes URL with query string` |
| 4 | `normalizes URL with hash` |
| 5 | `normalizes full same-origin URL` |
| 6 | `returns null for external URLs` |
| 7 | `returns null for invalid URLs` |
| 8 | `decodes URL-encoded paths` |
| 9 | `handles nested paths` |

#### `filterToLoad` — 4 tests

過濾已載入的 script（避免重複載入）。

| # | 測試案例 |
|---|---------|
| 1 | `returns all scripts when none loaded` |
| 2 | `filters out already loaded scripts` |
| 3 | `returns empty array when all loaded` |
| 4 | `handles empty input` |

#### `resolvePageScripts` — 5 tests

解析頁面所需 script 清單（跨群組去重）。

| # | 測試案例 |
|---|---------|
| 1 | `returns scripts for single group` |
| 2 | `deduplicates shared scripts across groups` |
| 3 | `returns empty array for unknown page` |
| 4 | `handles missing group gracefully` |
| 5 | `preserves order within groups` |

#### `resolvePageScripts` — 實際專案群組驗證 — 3 tests

使用真實專案的群組定義做整合驗證。

| # | 測試案例 |
|---|---------|
| 1 | `page-tournaments loads tournament group` |
| 2 | `page-profile deduplicates image-cropper.js across achievement+profile` |
| 3 | `page-user-card loads both achievement and profile groups` |

---

### 2.8 `tests/unit/no-show-stats.test.js`

- **測試來源**：`js/modules/event/event-manage-noshow.js`
- **測試數量**：30

#### `_buildRawNoShowCountByUid` — 基本計數 — 9 tests

統計每位用戶的放鴿子次數（未簽到 + 活動已結束）。

| # | 測試案例 |
|---|---------|
| 1 | `returns empty map when no registrations` |
| 2 | `counts confirmed registration with no checkin as no-show` |
| 3 | `does not count if user has checkin` |
| 4 | `does not count waitlisted registrations` |
| 5 | `does not count companions` |
| 6 | `does not count non-ended events` |
| 7 | `does not count events happening today (grace period)` |
| 8 | `counts multiple no-shows per user` |
| 9 | `deduplicates same user+event registration` |

#### `_buildRawNoShowCountByUid` — nameToUid 歷史修正 — 3 tests

修正歷史資料中 `attendanceRecords.uid` 儲存為顯示名稱的問題。

| # | 測試案例 |
|---|---------|
| 1 | `matches checkin by displayName when uid stored as displayName` |
| 2 | `ignores removed/cancelled attendance records` |
| 3 | `nameToUid does not map uid to itself` |

#### `_buildRawNoShowCountByUid` — 日期格式處理 — 2 tests

| # | 測試案例 |
|---|---------|
| 1 | `handles date with time component` |
| 2 | `handles YYYY-MM-DD format` |

#### `_buildNoShowCountByUid` — 補正值處理 — 7 tests

管理員手動補正放鴿子次數。

| # | 測試案例 |
|---|---------|
| 1 | `applies negative adjustment` |
| 2 | `applies positive adjustment` |
| 3 | `clamps to minimum 0` |
| 4 | `adds correction for user not in raw count` |
| 5 | `ignores non-finite adjustments` |
| 6 | `uses _docId as fallback uid` |
| 7 | `does not modify original map` |

#### `_getNoShowDetailsByUid` — 7 tests

查詢特定用戶的放鴿子明細（含事件資訊）。

| # | 測試案例 |
|---|---------|
| 1 | `returns empty array for empty uid` |
| 2 | `returns details for no-show events` |
| 3 | `excludes events where user checked in` |
| 4 | `only returns details for the specified uid` |
| 5 | `uses nameToUid mapping for historical checkin records` |
| 6 | `formats eventDate correctly` |
| 7 | `sorts by eventDate descending` |

---

### 2.9 `tests/unit/script-deps.test.js`

- **測試來源**：跨模組依賴驗證（解析 `index.html`、`js/core/script-loader.js` 及所有 JS 模組）
- **測試數量**：9
- **測試類型**：靜態分析（不執行模組程式碼）
- **設計目的**：防止 Phase 1 效能優化（移除 eager script）後的跨模組呼叫斷裂，此測試能在部署前捕捉此類問題

#### Script dependency validation — 3 tests

基本結構驗證。

| # | 測試案例 |
|---|---------|
| 1 | `index.html has eager scripts` |
| 2 | `script-loader has groups defined` |
| 3 | `script-loader has pageGroups defined` |

#### Eager scripts — no unguarded calls — 2 tests

驗證 eager 載入的腳本不會未保護地呼叫僅在 dynamic 群組中定義的函式。

| # | 測試案例 | 說明 |
|---|---------|------|
| 1 | `no unguarded calls to undefined functions in eager scripts` | 掃描所有 App 模組的 `this.X()` 呼叫，排除 `?.()` / `typeof` / truthiness guard |
| 2 | `no unguarded calls in index.html inline onclick` | 掃描 index.html 中 `onclick="App.X()"` 是否呼叫未載入的函式 |

#### ScriptLoader groups — no orphaned scripts — 3 tests

驗證 ScriptLoader 群組完整性。

| # | 測試案例 | 說明 |
|---|---------|------|
| 1 | `all scripts in groups point to existing files` | 群組內的路徑對應到實際存在的檔案 |
| 2 | `all pageGroup references point to existing groups` | `_pageGroups` 引用的群組名稱都存在 |
| 3 | `scripts not in index.html must be in at least one ScriptLoader group` | 偵測遺漏模組（不在 eager 也不在任何群組） |

#### Eager script file existence — 1 test

| # | 測試案例 |
|---|---------|
| 1 | `all scripts referenced in index.html exist on disk` |

### 2.10 `tests/unit/signup-logic.test.js`

- **測試來源**：`js/modules/event/event-list-stats.js`、`js/firebase-crud.js`、`js/modules/event/event-detail-signup.js`
- **測試數量**：43
- **設計目的**：保護報名/取消按鈕狀態判斷、`_docId` 回填防禦、取消流程的 reg 選擇邏輯

#### `_isUserSignedUp` (event-list-stats.js:261-275) — 14 tests

判斷當前用戶是否已報名（決定按鈕顯示「立即報名」or「取消報名」）。

| # | 測試案例 |
|---|---------|
| 1 | `no user → false` |
| 2 | `user with confirmed registration → true` |
| 3 | `user with waitlisted registration → true` |
| 4 | `user with cancelled registration → false` |
| 5 | `user with removed registration → false` |
| 6 | `different userId → false` |
| 7 | `fallback: uid in participants → true` |
| 8 | `fallback: displayName in participants → true` |
| 9 | `fallback: uid in waitlistNames → true` |
| 10 | `fallback: name in waitlistNames → true` |
| 11 | `no match anywhere → false` |
| 12 | `getRegistrationsByEvent is undefined → graceful fallback` |
| 13 | `mixed: cancelled in regs but name in participants → true (fallback)` |
| 14 | `user with empty uid and empty name → false` |

#### `_isUserOnWaitlist` (event-list-stats.js:278-290) — 9 tests

判斷當前用戶是否在候補名單（決定按鈕顯示「取消報名」or「取消候補」）。

| # | 測試案例 |
|---|---------|
| 1 | `no user → false` |
| 2 | `user with waitlisted registration → true` |
| 3 | `user with confirmed registration → false` |
| 4 | `user with cancelled registration → false` |
| 5 | `different userId waitlisted → false` |
| 6 | `fallback: uid in waitlistNames → true` |
| 7 | `fallback: displayName in waitlistNames → true` |
| 8 | `name in participants but not waitlistNames → false` |
| 9 | `getRegistrationsByEvent undefined → graceful fallback` |

#### `_docId backfill` (firebase-crud.js:752-757) — 8 tests

測試 `cancelRegistration` 內的 `_docId` 回填邏輯與防禦 throw。

| # | 測試案例 |
|---|---------|
| 1 | `reg has _docId → no change, no throw` |
| 2 | `reg missing _docId, fsReg matched by id → backfill` |
| 3 | `reg missing _docId, no fsReg match → throws` |
| 4 | `reg missing _docId, firestoreRegs empty → throws` |
| 5 | `reg has _docId, fsReg has different _docId → keeps original` |
| 6 | `multiple fsRegs, first match by id wins` |
| 7 | `fsReg matched but fsReg._docId also undefined → throws` |
| 8 | `does not mutate original reg object` |

#### `selectCancelReg` (event-detail-signup.js:435-441) — 12 tests

測試取消報名時的 reg 選擇優先順序與 extraRegs 清除邏輯。

| # | 測試案例 |
|---|---------|
| 1 | `single confirmed reg → selected` |
| 2 | `single waitlisted reg (isWaitlist) → selected` |
| 3 | `isWaitlist=false: prefers confirmed over other statuses` |
| 4 | `isWaitlist=false: accepts "registered" status too` |
| 5 | `isWaitlist=true: prefers waitlisted over confirmed` |
| 6 | `fallback: no matching status, uses _docId + active status` |
| 7 | `fallback: no _docId, uses first reg` |
| 8 | `empty array → reg is null` |
| 9 | `extraRegs: duplicate regs with _docId are marked as extra` |
| 10 | `extraRegs: regs without _docId are NOT in extraRegs` |
| 11 | `cancelled regs are skipped by fallback _docId check` |
| 12 | `removed regs are skipped by fallback _docId check` |

---

### 未來測試階段建議

1. **Phase 3：擴充純函式覆蓋**
   - `js/firebase-service.js` 的快取邏輯（`_mergeLocalAndCloud` 等）
   - ~~`js/modules/leaderboard.js` 的 `_categorizeRecords`~~ ✅ 已完成（leaderboard-stats.test.js）
   - ~~`js/modules/event-manage-noshow.js` 的 `_buildRawNoShowCountByUid`~~ ✅ 已完成（no-show-stats.test.js）

2. **Phase 4：Mock 整合測試**
   - 使用 jsdom 或類似工具測試 DOM 渲染邏輯
   - Mock `ApiService` 測試模組間資料流

3. **Phase 5：Cloud Functions 測試**
   - 使用 Firebase Emulator Suite 測試 `submitShotGameScore` 等 callable functions
   - 測試 Firestore trigger functions 的資料一致性

4. **Phase 6：E2E 測試**
   - 使用 Playwright 或 Cypress 測試完整用戶流程
   - 報名 → 簽到 → 統計的端到端驗證
