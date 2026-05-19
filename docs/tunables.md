# ToosterX — Tunables & Sequence Reference

> 專案內所有可調設定（timing / limit / threshold）+ 關鍵流程的順序效果總覽。
> **強制維護規則（CLAUDE.md §設定追蹤規範）**：修改檔案時若涉及任何可調設定 / 加載順序 / timing / 閾值，必須同步更新本檔對應條目；新增任何可調常數，必須在本檔登記。

**Last Updated: 2026-05-18**（activity map venue picker lazy/manual-only path）

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
| Activity map Google Maps JS version | `quarterly` | `ACTIVITY_MAP_CONFIG.googleMapsVersion` | 附近活動地圖與活動地點搜尋共用較穩定的 Maps JS channel，避免 weekly channel 在行動 WebView 出現臨時 renderer regression。 |
| Activity map Google layout settle | `requestAnimationFrame` + `[120, 450]` ms | `js/modules/event/event-map.js` / `ACTIVITY_MAP_CONFIG.googleLayoutSettleDelaysMs` | Google Maps 在附近活動彈窗內建立後，補做尺寸同步與中心/邊界重套，避免彈窗剛展開時底圖 canvas 灰底但標記已出現。 |
| Activity map Google render mode | `roadmap` + `RenderingType.RASTER` | `js/modules/event/event-map.js` | 附近活動地圖固定使用 raster roadmap，避免 WebGL/vector canvas 在 modal/GPU compositing 環境下只顯示灰底但 marker 和控制項正常。 |
| Activity map Google tile image style | scoped `.activity-google-map img` override | `css/activity.css` | 專案全域圖片淡入會讓未被 `.img-loaded` 標記的動態 `<img>` 維持透明；附近活動地圖內強制 Google raster tile 可見，避免短暫出圖後變灰底。 |
| Activity map Google tile fallback | `7000` ms | `js/modules/event/event-map.js` / `ACTIVITY_MAP_CONFIG.googleTileFallbackMs` | Google `tilesloaded` 未完成時切回現有輕量靜態地圖，避免使用者停在灰底地圖；標記與列表仍以本機活動資料呈現。 |

### Route Loading Hint（頁面切換載入提示）

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `minVisibleMs` | `280` ms | `app.js:715` `_routeLoading` | 最短顯示時間（避免閃爍） |
| `slowMs` | `3200` ms | `app.js:716` `_routeLoading` | 超過此時間顯示「網路較慢，資料仍在載入中...」 |

### Public Navigation Warmup（公開頁快速切換）

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `fastShellNavigation` | `true` | `js/config.js` `PERFORMANCE_FLAGS` / `js/core/navigation.js` | 活動、俱樂部、賽事列表與詳情先切到頁面 shell，再背景補 JS/Firestore，避免第一次點擊看似無反應。 |
| `idleModuleExecutionPreload` | `true` | `js/config.js` / `js/core/script-loader.js` | 首頁首屏完成後，利用 idle time 逐步執行載入活動/俱樂部/賽事列表與詳情模組。 |
| `idlePreloadDelayMs` | `900` ms | `js/config.js` / `js/core/script-loader.js` | 首次閒置預載開始延遲，避免搶首頁第一屏資源。 |
| `idlePreloadGapMs` | `450` ms | `js/config.js` / `js/core/script-loader.js` | 每個核心頁模組預載之間的間隔，降低瞬間下載與執行壓力。 |
| `visibleCardPrefetchDelayMs` | `650` ms | `js/config.js` / `js/core/navigation.js` | 列表/首頁卡片渲染後延遲預抓可見詳情文件。 |
| `publicBootSnapshotMaxAgeMs` | `30` 分鐘 | `js/config.js` / `app.js` / `scripts/inject-hot-events.js` | `index.html` 內公開列表快照只在 30 分鐘內作為首屏快取；報名/取消/管理寫入仍必須讀即時資料。 |
| `FirebaseService._LS_FRESH_TTL` | `30` 分鐘 | `js/firebase-service.js` | localStorage 快取在 30 分鐘內標記為 fresh；超過 30 分鐘但仍在可展示上限內，也會先進畫面並立刻背景刷新。 |
| `FirebaseService._LS_TTL_LONG` | `7` 天 | `js/firebase-service.js` | 一般用戶的可展示快取上限。7 天內可直接先顯示舊列表降低冷啟動空白感；報名人數、名單與詳情仍由 realtime / 背景刷新校正。 |
| `FirebaseService._LS_TTL` | `60` 分鐘 | `js/firebase-service.js` | admin / super_admin 的可展示快取上限較短，避免後台與權限資料長時間沿用舊狀態。 |

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

### Private Message（私訊）

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| PM read debounce | `500` ms | `js/modules/message/pm-permission.js` `PM_MARK_READ_DEBOUNCE_MS` | 對話視窗收到連續訊息時合併已讀 callable，避免每次 snapshot 都打後端 |
| PM keyboard restore delay | `320` ms | `js/modules/message/pm-permission.js` `PM_KEYBOARD_RESTORE_DELAY_MS` / `pm-dialog.js` | 手機瀏覽器關閉鍵盤後延遲校正私訊彈窗 viewport，避免 iOS Safari fixed overlay 卡住或點擊失效 |
| PM keyboard accessory reclaim | up to `96` px after reserving `260` px | `js/modules/message/pm-permission.js` `PM_KEYBOARD_ACCESSORY_GAP_PX` / `PM_KEYBOARD_MIN_KEYBOARD_RESERVE_PX` / `pm-dialog.js` | iOS 鍵盤開啟時回收 Safari 輸入工具列或候選字區多出的可視空間，減少輸入框下方空白，同時保留鍵盤本體高度 |
| PM edit / recall read lock | 對方已讀後鎖定 | `js/modules/message/pm-dialog.js` / `js/modules/message/pm-dialog-actions.js` / `functions/index.js` | 私訊編輯與撤回不限時間；對方已讀後不可編輯或撤回 |

<a id="sport-icon-svg"></a>
### Sport Icon（運動圖示對照）

| 名稱 | 值 / 內容 | 檔案位置 | 用途 |
|------|----------|---------|------|
| `SPORT_ICON_EMOJI` | 19 個運動 → emoji 字符對照表 | `js/config.js:437` | LINE Flex Message / textContent 等不支援 HTML 的場景使用 |
| `SPORT_ICON_SVG_HTML` | 自製 HTML 圖示對照（目前 2 項：pickleball、escape_room）| `js/config.js:458` | 網頁 UI 渲染時優先使用，否則 fallback 到 emoji |
| `getSportIconSvg(key, className)` | 渲染 `<span class="sport-emoji">` 包裹的圖示 | `js/config.js:481` | 統一入口：先查 SVG_HTML，否則用 EMOJI |
| 匹克球 SVG 設計 | V4 動感版（圓角方形拍 + 飛球 + 速度線）| `js/config.js:461` | 因 Unicode 無匹克球專屬 emoji，且 🏓（桌球橢圓拍）會誤導視覺 |

**新增自製 HTML/SVG 圖示流程**：
1. 在 `SPORT_ICON_SVG_HTML` 加 `<key>: '<svg ...>...</svg>'` 或 `<key>: '<img ...>'`
2. SVG 或圖片必須能跟隨 `.sport-emoji` 的 1em 尺寸縮放
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

### Phase 6 popstate handler (D10 hashchange dedupe)

<a id="popstate-hashchange-dedupe-window"></a>

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `popstate-hashchange-dedupe-window` | `50ms` | `app.js` popstate handler 內 `setTimeout(..., 50)` | popstate 觸發時 set `window._suppressNextHashchange = true`,50ms 內到達的 hashchange 視為「popstate 接續觸發」會被攔截。50ms 視窗在實測瀏覽器(Chrome 120+ / Safari 17 / LINE WebView iOS 14+/Android 80+)都足夠,且不會誤殺正常 hashchange。詳 §8.9 V6 / D10。 |

---

<a id="limit"></a>
## 📦 Limit 容量 / 數量上限

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| `MAX_IMAGE_CACHE` | `150` 張 | `sw.js:10` | Service Worker 圖片快取上限 |
| `REALTIME_LIMIT_DEFAULTS` | 動態 (siteConfig/realtimeConfig) | `js/config.js` | 即時監聽預設 limit（events/registrations/attendanceRecords/etc，可在儀表板調整） |
| Attendance / Registration query 預設 | `500` (典型值) | `firebase-service.js` | onSnapshot listener limit。超過 500 筆的老活動需 fallback fetch |
| Event comments manager fetch | `80` 則留言 | `js/modules/event/event-comments.js` `_loadEventComments` | 主辦、委託、admin+ 可讀活動留言上限；留言板隨活動詳情最後載入，不進活動列表首屏。 |
| Event comments user fetch | public `60` + own private `30` 並行查詢，去重後最多 `80` | `js/modules/event/event-comments.js` `_loadEventComments` | 一般 user 只讀公開留言與自己私密留言，避免每次打開活動就掃完整留言集合；兩條 query 用 `Promise.all` 並行，縮短留言板最後載入等待。 |
| Event comments soft timeout | `9000` ms | `js/modules/event/event-comments.js` `_eventCommentLoadTimeoutMs` | 留言板最後載入仍不可無限 spinner；超過 9 秒改顯示「留言載入較久」與重新載入按鈕，原查詢若稍後成功仍可補上內容。 |
| Event comments retry delays | `[3000, 15000]` ms | `js/modules/event/event-comments.js` `_eventCommentRetryDelaysMs` | 留言板局部背景重試，不重整整個活動頁；舊請求用 `_eventCommentLoadSeq` 防止覆蓋新活動頁。 |
| Event comments hard stop | `45000` ms | `js/modules/event/event-comments.js` `_eventCommentHardStopMs` | 最多約 45 秒後停止自動重試，顯示「留言暫時無法載入」與手動重新載入，避免十分鐘仍在載入中。 |
| Event comment replies fetch | `20` replies / comment，`8` comments / batch | `js/modules/event/event-comments.js` `_loadEventCommentRepliesForList` | 留言板載入時自動逐批查每則可見留言的 replies，回覆預設展開且不再顯示「查看回覆」按鈕；留言板仍固定在活動主內容後載入。 |
| Event comment likes hydration | recent summary 優先；legacy 最多 `32` likes / comment 背景補齊 | `js/modules/event/event-comments.js` `_hydrateEventCommentLikeState` | 主列表先用 comment 上的 `likeCount/recentLikers` 顯示；舊資料才背景讀 likes 子集合，按讚頭像不阻塞留言主列表。 |
| Event comment like avatar stack | `32` likers rendered per comment | `js/modules/event/event-comments.js` `_renderEventCommentLikeAvatars` | UI render cap only. Like count comes from summary or background hydration. Newest likers render first; older avatars are clipped first when horizontal space runs out. |
| Event comment avatar overlap threshold | `> 6` 人改用 `8px` step；否則 `26px` step | `js/modules/event/event-comments.js` `_renderEventCommentLikeAvatars` / `css/activity.css` | 對應目前「新頭像蓋舊頭像約 2/3」的視覺規則；CSS 容器 `overflow:hidden` 讓寬度不足時自然隱藏最舊頭像。 |
| Event blocklist `blockedUidsLog` | 無上限 | `firestore.rules` | 黑名單審計軌跡，建議手動清理超過 100 筆的活動 |
| Operation log altText 截斷 | `400` 字 | `event-share*.js` | LIFF Flex Message altText 上限 |
| Home summary Firestore REST page size | `300` 筆/頁 | `scripts/inject-hot-events.js` | GitHub Action 產生 `boot-home-summary-data` 時分頁掃描 events / teams / tournaments，避免只取前幾筆造成首頁總量不準 |
| Home summary max pages | events `25` 頁；teams / tournaments `15` 頁 | `scripts/inject-hot-events.js` | 防止注入腳本在資料異常或 API pagination 異常時無限掃描；超過即保留既有 inline 摘要 |
| Public boot snapshot limit | events `80`；teams `36`；tournaments `36` | `scripts/inject-hot-events.js` `PUBLIC_LIST_LIMITS` | 首次進站/清快取時先顯示公開列表快照；只保留列表與詳情骨架必要欄位，不含報名名單 UID 或隊員 UID。 |
| Activity terminal preview limit | `50` 筆 | `js/firebase-service.js` `_terminalPreviewLimit` | 前台活動頁只載少量已結束/已取消活動，用來維持 6 小時留存判定與最近狀態，不讀完整歷史。 |
| Activity terminal history limit | `10` 筆 + load more | `js/firebase-service.js` `_terminalHistoryLimit` / `loadMoreTerminalEvents()` | 活動管理切到已結束、已取消或全部時才升級 history 載入；每次「查看更多」最多延伸 10 筆，降低歷史活動讀取成本。 |
| Visible detail prefetch limit | `8` 筆 | `js/config.js` / `js/core/navigation.js` / `js/firebase-service.js` | 首頁/列表渲染後最多預抓 8 筆可見詳情文件，提升點卡片速度但避免大量讀取。 |
| Home summary client stale age | `5` 分鐘 | `js/modules/home-dashboard.js` | inline `boot-home-summary-data` 超過此時間後，首頁背景讀公開活動快取/Firestore，重算活動數、運動分類數與已記錄瀏覽數 |
| Home summary client refresh throttle | `5` 分鐘 | `js/modules/home-dashboard.js` | 避免使用者反覆切回首頁時連續觸發活動摘要刷新 |
| Home summary injection schedule | 每小時第 `17` 分鐘 | `.github/workflows/inject-hot-events.yml` | 定期重建 `index.html` 內的首頁匿名摘要，降低新活動/新運動分類在首屏出現的延遲 |
| Home next activity revalidate | `10` 分鐘 | `js/modules/home-next-activity.js` | 首頁「我的下一場活動」先顯示同 UID 的本機快取，再背景刷新，避免切回首頁時短暫空白。 |
| Home next activity max local cache age | `60` 分鐘 | `js/modules/home-next-activity.js` | 快取最長只作為 1 小時內的先顯示資料；活動已過開始時間、已結束或取消時不顯示快取。 |
| PM body max length | `300` 字 | `functions/index.js` `PM_MAX_BODY_LENGTH` / `pm-dialog.js` textarea maxlength | 私訊單則內容長度上限 |
| PM thread listener limit | `50` 筆 | `js/modules/message/pm-listener.js` / `functions/index.js` `PM_THREAD_LIMIT` | 使用者訊息中心私訊對話列表最多載入最近 50 個 thread |
| PM message load limit | `50` 筆，稽核檢視最多 `100` 筆 | `js/modules/message/pm-dialog.js` / `functions/index.js` `PM_MESSAGE_LIMIT` | 私訊對話窗預設載入最近 50 則；聊天室稽核單次檢視最多 100 則 |
| PM daily per-user send limit | `100` 則/日 | `functions/index.js` `PM_DAILY_LIMIT_PER_UID` | 防止單一用戶大量發送私訊 |
| PM daily per-peer send limit | `30` 則/日 | `functions/index.js` `PM_DAILY_LIMIT_PER_PEER` | 防止單一對象被同一人短時間洗訊息 |
| PM audit retention | `180` 天 | `functions/index.js` `PM_AUDIT_RETENTION_DAYS` / `cleanupPmAuditRetention` | 私訊稽核內容副本與使用 log 保留 180 天後由排程清理 |

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

### 首頁摘要

| 名稱 | 值 | 檔案位置 | 用途 |
|------|---|---------|------|
| 首頁活動有效判定 | 活動開始時間 `<= now` 即視為已結束並排除 | `scripts/inject-hot-events.js` | 首頁活動數、運動分類數與已記錄瀏覽數都使用同一口徑；取消、私密、俱樂部限定也排除 |
| 首頁瀏覽數口徑 | `viewCount` 或 `views` 的正數加總 | `scripts/inject-hot-events.js` / `js/modules/home-dashboard.js` | 顯示為「已記錄瀏覽」，只做輕量趨勢參考，不宣稱精準訪客數 |

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
| Phase 2.5 | 讀取 inline `boot-home-summary-data` / `boot-banners-data` / `boot-public-lists-data`，公開快照只作首屏與 shell 快取 | `app.js` boot inline block |
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
| `event` | 30+ | `script-loader.js`；含輕量 `event-location-draft.js`，但不含 Google/地圖 picker UI |
| `activityMap` | manual-only | 使用者點「尋找附近活動」才執行；不進 `preloadAll()` / `preloadCorePages()`；Maps JS 載入帶 `auth_referrer_policy=origin`，避免 `/events/{id}` 等 clean path 被當成未授權 referrer |
| `eventLocationPicker` | manual-only | 建立/編輯活動點「設定地圖位置」才執行；Google Maps JS 只在 picker 內搜尋且 key 存在時才動態載入，並帶 `auth_referrer_policy=origin` |
| `teamList` | 4 | `page-teams` first screen only：helpers/stats/list/render |
| `teamDetail` | 10 | `page-team-detail` lazy detail/share/join flow |
| `teamForm` | 5 | create/edit modal lazy loaded from list/detail/manage |
| `tournament` / `tournamentDetail` | 16 + `event-share` helper | `script-loader.js` |
| `activityCalendar` | 4（lazy load） | `script-loader.js:306-311` |
| `adminUsers` | 10+ | `script-loader.js:312-324` |
| `adminContent` | 6 | `script-loader.js:325-332` |

**新模組註冊規則**：放在對應頁面清單的合理位置（依賴前 / 同類後）；event-manage 系列放在 `event` 清單的後段。

### 活動列表 / 詳情 / 留言板載入順序

| 順序 | 內容 | 檔案位置 | 規則 |
|------|------|---------|------|
| 1 | 活動列表 shell | `page-loader.js` / `event-list-timeline.js` | `activity` page fragment 屬 boot pages；列表先用可展示 cache 畫面，沒有可展示活動且 Firestore 尚未載入完成時才顯示 `activity-list-loading-bar`。 |
| 2 | 活動 collection | `firebase-service.js` `_loadEventsStatic` | active events 首批 `200`；terminal preview 首批 `50`，管理頁 history 模式才每批 `10` 延伸。 |
| 3 | 卡片詳情預抓 | `navigation.js` / `firebase-service.js` | 可見卡片最多預抓 `8` 筆 detail 文件；只改善點擊速度，不取代 Firestore refresh。 |
| 4 | 詳細頁主視覺與操作按鈕 | `event-detail.js` `showEventDetail` | 先呈現封面、標題、主操作按鈕與基本欄位；按鈕以下先放 `_renderEventDetailBelowFoldLoadingHtml()`，避免使用者誤判為沒有內容。 |
| 5 | 報名/簽到/未報名/候補 | `event-detail.js` / `event-manage-attendance.js` | registrations cache 先用；必要時針對該活動補抓 registrations。候補區在留言板前，且候補存在時不得蓋掉留言板 mount point。 |
| 6 | 留言板 | `event-comments.js` | 留言板固定最後載入，先顯示「留言載入中...」。comments / replies / likes 不阻塞活動主內容與報名操作。 |

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

### 首頁摘要儀表流程（2026-05-06）

```
GitHub Action / 手動腳本
  → scripts/inject-hot-events.js 分頁讀 events / teams / tournaments
  → 依活動開始時間與公開狀態產生 boot-home-summary-data
  → index.html inline 匿名摘要
  ↓
App renderHomeCritical()
  → banner / announcement 保留
  → home-dashboard.js 渲染運動快速入口、數量儀表、我要開活動
  → 首屏不等待 events / teams / tournaments collection
  ↓
Firebase 可用後
```

### 公開列表快照與詳情預抓（2026-05-12）

```
scripts/inject-hot-events.js
  → 掃描公開 events / teams / tournaments
  → 過濾已結束、取消、私密、俱樂部限定活動
  → 只保留列表卡片與詳情 shell 需要欄位
  → 注入 boot-public-lists-data
  ↓
App boot Phase 2.5
  → 若快照 30 分鐘內有效，先放入 FirebaseService cache
  → 不標記 lazyLoaded=true，後續 Firestore 仍背景刷新
  ↓
showPage / showDetail
  → 先切 shell 與快取畫面
  → idle 預載模組 + 可見卡片預抓詳情文件
  → Firestore / listener 回來後重繪成最新資料
```

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
- **2026-05-07**：首頁摘要增加 5 分鐘 stale client refresh，並將 `inject-hot-events` 排程改為每小時，讓運動快速入口可在靜態注入延遲時背景補正。
- **2026-05-12**：新增公開頁快速切換 tunables：shell-first navigation、idle module execution preload、visible detail prefetch，以及 `boot-public-lists-data` 30 分鐘公開快照。
- **2026-04-25**：boot overlay `MIN_VISIBLE_MS` 1500 → 2500（用戶反映 1.5 秒仍偏短，調至 2.5 秒看到更完整的進度條動畫）。
- **2026-04-25**：新增 `SPORT_ICON_SVG_HTML` 對照表 + 匹克球 V4 SVG 圖示（紅色圓角方形拍斜放 + 黃球飛 + 速度線）。Unicode 無匹克球專屬 emoji、🏓 桌球拍視覺誤導，改用自製 SVG。
