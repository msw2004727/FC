# ToosterX — Tunables & Sequence Reference

> 專案內所有可調設定（timing / limit / threshold）+ 關鍵流程的順序效果總覽。
> **強制維護規則（CLAUDE.md §設定追蹤規範）**：修改檔案時若涉及任何可調設定 / 加載順序 / timing / 閾值，必須同步更新本檔對應條目；新增任何可調常數，必須在本檔登記。

**Last Updated: 2026-04-28**（club page shell-first navigation + team script split）

## 目錄

- [⏱️ Timing 計時器 / Timeout / Interval](#timing)
- [📦 Limit 容量 / 數量上限](#limit)
- [🚦 Threshold 閾值 / 邊界條件](#threshold)
- [📚 Load Order 加載順序](#load-order)
- [🔀 Sequence Effects 流程順序效果](#sequence-effects)
- [🏷️ Versioning 版號規範](#versioning)

---

<a id="timing"></a>
## ⏱️ Timing 計時器 / Timeout / Interval

### Boot Overlay（開機載入畫面）

<a id="boot-overlay-min-visible"></a>
| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| **MIN_VISIBLE_MS** | `0` ms | `app.js` `_dismissBootOverlay` | 已解除 boot overlay 人為最短顯示時間。hash reload 由 early boot route + PageLoader priority 先啟用目標頁 shell，overlay 不再為了遮首頁跳轉固定等待 2500ms。 |
| Navigation 延後安全 timeout | `7000` ms | `app.js` `_dismissBootOverlay` | reload 帶 `?event=` deep link 或 `#page-xxx` hash navigation 時，等 navigation 跳轉完成才隱藏。此 timeout 是兜底（避免 navigation 卡住永遠遮罩）。**必須 < 開機看門狗 8000 ms**。2026-04-27 由 5000 調整為 7000，因 mobile/慢網路下 hash nav 經常需要 5+ 秒（cloud ready + ensureCollectionsForPage） |
| 開機看門狗 timeout | `8000` ms | `index.html:940` | 清快取後 8 秒內未完成初始化則自動 reload（最多 2 次） |
| Loading overlay safety timeout | `20000` ms | `index.html:820` | 終極兜底：若 boot overlay 超過 20 秒仍未消失強制隱藏 |
| 進度條 tick interval | `180` ms | `index.html:789` | 進度條動畫每 180ms 跑一次，從 0% → 92% 約 2.7 秒 |
| Boot overlay fade out delay | `150` ms | `app.js` `_dismissBootOverlay` | 跳到 100% → 等 150ms → 設 `display:none` |

### Route Loading Hint（頁面切換載入提示）

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `minVisibleMs` | `280` ms | `app.js:715` `_routeLoading` | 最短顯示時間（避免閃爍） |
| `slowMs` | `3200` ms | `app.js:716` `_routeLoading` | 超過此時間顯示「網路較慢，資料仍在載入中...」 |

### Visibility Change（背景/前景切換）

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `IDLE_EXIT_MS` | `3000` ms | `event-manage-visibility.js` | 編輯模式離開瀏覽器超過此時間自動退出編輯。短於此時間（如 iOS Face ID / 接 LINE 訊息 < 3 秒）保留編輯狀態 |
| Resume listeners 延遲 | `1000` ms | `firebase-service.js:2860` `_setupVisibilityRefresh` | 切回前景後延遲 1 秒重啟 listeners（避免快速切換時的 thrash） |
| Persist cache debounce | 由 `_persistDebounceTimer` 管理 | `firebase-service.js` | `pagehide` 時強制 flush，避免 iOS Safari 不可靠的 beforeunload |

### LINE LIFF（登入相關）

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| Profile refresh interval | `30000` ms | `line-auth.js:84` `_scheduleProfileRefresh` | 後台 30 秒輪詢檢查 LIFF session |
| Profile refresh max time | `5 * 60 * 1000` ms (5 分鐘) | `line-auth.js:83` | 超過 5 分鐘停止輪詢（避免無限執行） |
| Profile fetch timeout | `8000` ms | `line-auth.js:171` | LIFF `getProfile()` 單次呼叫超時 |
| LIFF retry delays | `[0, 500, 1500]` ms | `line-auth.js:170` | Profile fetch 失敗的 retry backoff |
| Pending login 自動降級超時 | `20000` ms | `line-auth.js:133` | LIFF login 卡住超過 20 秒自動降級為「未登入」 |
| LIFF Access Token 有效期 | `12 小時` | LIFF SDK（外部） | LINE 官方規格，不可調 |

### Instant Save（即時儲存）

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| Checkbox debounce | `300` ms | `event-manage-instant-save.js:58` | Checkbox 變更後 300ms 才寫 Firestore（避免快速多勾的 burst） |
| Note debounce | 同上路徑 | `event-manage-instant-save.js` `_iSaveNoteTimers` | 備註欄位變更 debounce |
| Flush in-flight 等待 | `5000` ms | `event-manage-instant-save.js:168` | `_flushInstantSaves` 等待 in-flight 完成最多 5 秒 |
| Row saved 動畫 | `600` ms | `event-manage-instant-save.js:122` | 寫入成功後 row 高亮 600ms |
| Row failed 動畫 | `1200` ms | `event-manage-instant-save.js:134` | 寫入失敗後 row 高亮 1200ms |

<a id="sport-icon-svg"></a>
### Sport Icon（運動圖示對照）

| 名稱 | 值 / 內容 | 檔案位置 | 用途 |
|------|----------|---------|------|
| `SPORT_ICON_EMOJI` | 18 個運動 → emoji 字符對照表 | `js/config.js:437` | LINE Flex Message / textContent 等不支援 HTML 的場景使用 |
| `SPORT_ICON_SVG_HTML` | 自製 SVG 圖示對照（目前 1 項：pickleball）| `js/config.js:458` | 網頁 UI 渲染時優先使用，否則 fallback 到 emoji |
| `getSportIconSvg(key, className)` | 渲染 `<span class="sport-emoji">` 包裹的圖示 | `js/config.js:481` | 統一入口：先查 SVG_HTML，否則用 EMOJI |
| 匹克球 SVG 設計 | V4 動感版（圓角方形拍 + 飛球 + 速度線）| `js/config.js:461` | 因 Unicode 無匹克球專屬 emoji，且 🏓（桌球橢圓拍）會誤導視覺 |

**新增自製 SVG 圖示流程**：
1. 在 `SPORT_ICON_SVG_HTML` 加 `<key>: '<svg ...>...</svg>'`
2. SVG 必須含 `width="1em" height="1em" style="vertical-align:-0.1em"`（適配 `.sport-emoji` font-size）
3. `SPORT_ICON_EMOJI` 對應 key 仍要保留 emoji 作為「不支援 HTML 場景」的 fallback
4. 同步更新 `tests/unit/config-utils.test.js` 加新測試

### Service Worker / 快取

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| Image cache 過期 | `7 * 24 * 60 * 60 * 1000` ms (7 天) | `sw.js:11` `MAX_IMAGE_AGE_MS` | Firebase Storage 圖片 stale-while-revalidate 過期時間 |

### Firebase Auth

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| Auth ID Token 有效期 | `1 小時` | Firebase SDK（外部） | SDK 自動 refresh，背景時 refresh 可能失敗 |
| Auth state ready 等待 | 無明確 timeout | `firebase-config.js:120` `onAuthStateChanged` | 首次觸發代表 persistence 已讀取完成 |

---

<a id="limit"></a>
## 📦 Limit 容量 / 數量上限

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `MAX_IMAGE_CACHE` | `150` 張 | `sw.js:10` | Service Worker 圖片快取上限 |
| `REALTIME_LIMIT_DEFAULTS` | 動態 (siteConfig/realtimeConfig) | `js/config.js` | 即時監聽預設 limit（events/registrations/attendanceRecords/etc，可在儀表板調整） |
| Attendance / Registration query 預設 | `500` (典型值) | `firebase-service.js` | onSnapshot listener limit。超過 500 筆的老活動需 fallback fetch |
| Event blocklist `blockedUidsLog` | 無上限 | `firestore.rules` | 黑名單審計軌跡，建議手動清理超過 100 筆的活動 |
| Operation log altText 截斷 | `400` 字 | `event-share*.js` | LIFF Flex Message altText 上限 |

---

<a id="threshold"></a>
## 🚦 Threshold 閾值 / 邊界條件

### 報名系統

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| Profile 完整度檢查欄位 | `gender` + `birthday` + `region` 三者必填 | `firebase-crud.js:816, 2130` | `registerForEvent` / `_doRegisterEventCompanion` 前置 PROFILE_INCOMPLETE 檢查 |
| Companion ID 衝突重試 | 1 次 | `event-detail-companion.js` | 同行者 ID 同名時的重新生成嘗試 |

### 候補遞補

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| 遞補排序 | `registeredAt ASC` + `promotionOrder ASC` | `event-create-waitlist.js` | 容量增加時的遞補順序（先到先補） |
| 降級排序 | `registeredAt DESC` + `promotionOrder DESC` | `event-create-waitlist.js` | 容量減少時的降級順序（最晚先降） |

### 統計系統

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| 出席率分子 | `checkin` 紀錄數 | `stats.js` `getParticipantAttendanceStats` | 鎖定函式 |
| No-show 判定 | `confirmed` 報名 + `status !== ended/cancelled` 排除 + 無 `checkin` | `event-manage-noshow.js` | 鎖定函式 |

### 版號 cleanup

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `claude-memory.md` 清理閾值 | `500` 行 | CLAUDE.md §修復日誌維護規則 | 超過此行數觸發清理（一般條目 30 天 / `[永久]` 永不過期） |

---

<a id="load-order"></a>
## 📚 Load Order 加載順序

### App 啟動 Phase

| Phase | 內容 | 檔案 |
|-------|------|------|
| Phase 0 (DOMContentLoaded) | 解析 deep link query → 寫入 sessionStorage `_pendingDeepXxx` | `app.js:2197-2222` |
| Phase 1 | `PageLoader.loadAll()` 載入 pages/*.html 片段（10 秒超時） | `app.js:2226-2236` |
| Phase 2 | `FirebaseService._restoreCache()` 從 localStorage / IndexedDB 恢復快取 | `app.js:2238-2245` |
| Phase 3 | `App.init()` 立即顯示頁面（不等 HTML / CDN / Firebase） | `app.js:2247-2253` |
| Phase 後續 | Cloud bootstrap → bind LineLogin → flush pending boot route → 開啟 deep link | `app.js:1965-1989` |

### Script Defer 順序（index.html）

關鍵順序原則：
1. `i18n.js` → `config.js` → `core/*` → `firebase-config.js` → `firebase-service.js` → `firebase-crud.js` → `api-service.js`
2. 模組（`js/modules/*.js`）按依賴關係排序（被依賴的在前）
3. 動態載入由 `js/core/script-loader.js` 處理（按 page 分組）

### `script-loader.js` 各 page 預載清單

| Page | 模組數 | 檔案位置 |
|------|-------|---------|
| `event` | 30+ | `script-loader.js:115-135` |
| `teamList` | 4 | `page-teams` first screen only：helpers/stats/list/render |
| `teamDetail` | 10 | `page-team-detail` lazy detail/share/join flow |
| `teamForm` | 5 | create/edit modal lazy loaded from list/detail/manage |
| `tournament` / `tournamentDetail` | 16 + `event-share` helper | `script-loader.js` |
| `activityCalendar` | 4（lazy load） | `script-loader.js:306-311` |
| `adminUsers` | 10+ | `script-loader.js:312-324` |
| `adminContent` | 6 | `script-loader.js:325-332` |

**新模組註冊規則**：放在對應頁面清單的合理位置（依賴前 / 同類後）；event-manage 系列放在 `event` 清單的後段。

---

<a id="sequence-effects"></a>
## 🔀 Sequence Effects 流程順序效果

### Boot Overlay 隱藏流程（2026-04-28 hash route 加速後）

```
顯示: prod-early class → display='' → _bootOverlayShownAt=Date.now() → start anim
觸發 dismiss (Phase 3 / Cloud ready / Cloud failed):
  ↓
[守衛 1] MIN_VISIBLE_MS = 0，不再固定等待；hash 目標頁 shell 先 active
  ↓
[守衛 2] _hasPendingDeepLink() / _hasPendingHashNav() && !_bootOverlayForceDismiss → 延後 + 7s timeout
  ↓
[正常隱藏] 進度條跳 100% → 150ms fade out → display='none' → _startContentStallCheck
```

### Visibility Change 流程

```
visibilitychange='hidden':
  ↓
firebase-service: _suspendListeners()
  → 停 users/messages/registrations/attendance/events listeners
  → _persistCache()
  ↓
event-manage-visibility: 若有編輯模式 → _flushPendingSaves() + 記時間戳
  ↓
visibilitychange='visible':
  ↓
firebase-service: 1000ms debounce → _resumeListeners() + _handleVisibilityResume()
  → events 一次性查詢刷新 (_refreshEventsOnResume)
  → registrations 一次性查詢刷新（若 listener 不在）
  → 觸發 _debouncedSnapshotRender('registrations')
  ↓
event-manage-visibility: 若離開 ≥ 3000ms → _exitEditIfIdle()
  → _autoExitDetailEdits()
  → _renderAttendanceTable / _renderUnregTable
  → showToast('離開過久，已自動退出編輯模式')
```

### `_confirmAllAttendance` 流程（[LOCKED] 鎖定函式）

```
1. _attendanceSubmittingEventId = eventId（防止重複提交）
2. await _renderAttendanceTable（重繪表格）
3. await _flushInstantSaves（清 pending debounce + 等 in-flight 完成）
4. 收集 people（registrations + participantsWithUid + fallback）
5. 讀 DOM checkbox 狀態 → desiredStateByUid
6. _attendancePendingStateByUid = desiredStateByUid（讓重繪能反映 pending state）
7. 收集 ops (_collectAttendanceOps)
8. await ApiService.batchWriteAttendance(adds, removes)
9. 發放 EXP（成功時）
10. 寫操作日誌 + 對帳 noShow EXP
11. finally: 清狀態 + 重繪
```

### `registerForEvent` 流程（[LOCKED] 鎖定函式）

```
1. PROFILE_INCOMPLETE 前置檢查（gender + birthday + region）
2. 模組層 busy lock (_signupBusyMap)
3. _doRegisterForEvent (Firestore transaction)
   → 身分一致性檢查
   → _rebuildOccupancy 計算佔位
   → 原子寫入 registration
4. finally: 釋放 busy lock
```

### Deep Link 解析流程

```
DOMContentLoaded → URL 含 ?event= / ?team= / ?tournament= / ?profile=
  ↓
sessionStorage.setItem('_pendingDeepXxx', id)
  ↓
App.init() → currentPage='page-home' 預設 → 渲染首頁
  ↓
Cloud ready → _flushPendingProtectedBootRoute → _tryOpenPendingDeepLink
  ↓
_pendingDeepLinkOpenPromise → 跳轉到目標頁面
  ↓
finally: _completeDeepLinkSuccess / _completeDeepLinkFallback
  → _clearPendingDeepLink (清 sessionStorage)
  → _dismissBootOverlayAfterDeepLink (若 boot overlay 處於延後狀態)
```

---

<a id="versioning"></a>
## 🏷️ Versioning 版號規範

### 格式

`0.YYYYMMDD{suffix}`

- `0.20260425` — 當天第一次部署，無後綴
- `0.20260425a` — 當天第二次部署
- `0.20260425b` ~ `0.20260425z` — 第 3-27 次
- `0.20260425za` ~ `0.20260425zz` — 第 28+ 次
- 跨日自動重置（`0.20260426` 而非 `0.20260425{下個字母}`）

### 4 處同步位置（強制）

| # | 檔案 | 位置 |
|---|------|------|
| 1 | `js/config.js` | `CACHE_VERSION` 常數 |
| 2 | `sw.js` | `CACHE_NAME` |
| 3 | `index.html` | inline `var V='...'` |
| 4 | `index.html` | 所有 `?v=` 參數（72+ 處） |

**禁止手動修改**，必須使用 `node scripts/bump-version.js`（自動同步 4 處）。

### 獨立頁面（不同步）

`game-lab.html`、`GrowthGames.html`、`inventory/index.html` 使用各自版號系統，**只在修改它們自己的 JS/CSS 時才需更新**。

---

## 📝 維護規則

### 何時必須更新本檔（強制）

1. **新增可調常數時**：必須在對應分類登記（值、檔案位置、用途）
2. **修改既有閾值時**：更新值欄位 + 修改原因（在「Last Updated」標註）
3. **改變流程順序時**（Sequence Effects）：更新對應流程圖
4. **新增 page 載入清單時**（script-loader.js）：更新 Load Order 表
5. **變更 timing 互相依賴關係時**（如「必須 < 開機看門狗 8000ms」）：補充依賴註記

### 何時不需要更新

- 純 bug 修復（不動 timing / 順序）
- 文件本身的拼字修正
- 模組搬移（檔案位置變更請同步本檔的「檔案位置」欄）

### 同步義務

修改檔案時若加入註解引用本檔（如「詳見 docs/tunables.md #boot-overlay-min-visible」），請確認對應 anchor 存在；移除常數時必須同步移除本檔對應條目。

---

## 變更歷史

- **2026-04-25**：建立檔案。初始登錄 Boot Overlay / Route Loading / Visibility / LIFF / Instant Save / SW / Limit / Threshold / Load Order / Sequence Effects / Versioning 共 11 大類。
- **2026-04-28**：boot overlay `MIN_VISIBLE_MS` 2500 → 0；hash reload 改由 early boot route + PageLoader priority 先定位目標頁，不再用固定遮罩等待掩蓋首頁跳轉。
- **2026-04-28**：俱樂部 `page-teams` 改為 shell-first navigation，並將原 `team` script group 拆為 `teamList` / `teamDetail` / `teamForm`，列表第一屏只載列表必要模組。
- **2026-04-25**：boot overlay `MIN_VISIBLE_MS` 1500 → 2500（用戶反映 1.5 秒仍偏短，調至 2.5 秒看到更完整的進度條動畫）。
- **2026-04-25**：新增 `SPORT_ICON_SVG_HTML` 對照表 + 匹克球 V4 SVG 圖示（紅色圓角方形拍斜放 + 黃球飛 + 速度線）。Unicode 無匹克球專屬 emoji、🏓 桌球拍視覺誤導，改用自製 SVG。
