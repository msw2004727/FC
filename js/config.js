/* ================================================
   SportHub — Config & Constants
   ================================================ */

// ─── Cache Version（更新此值以清除瀏覽器快取）───
// 20260223u: Firestore 強制長輪詢模式，修復 WebChannel 400 錯誤
// 20260224q: 效能優化（seed 並行、localStorage debounce、O(n²) 修正）+ UX 改善
// 20260224r: 修正掃碼相機錯誤偵測（html5-qrcode reject 純字串處理）
// 20260224s: 修復 Android 開前鏡頭（exact:environment）+ videoConstraints 衝突移除 + overconstrained 自動降級
// 20260224w: opening loading overlay redesign (pixel bar + brand image)
// 20260224x: bottom tabs (teams/tournaments) show "功能準備中" during testing
// 20260224za: 頁籤順序調整（賽事→俱樂部→首頁→活動→我的）+ 首頁卡片地點去除自動加「市」
// 20260224zb: Tab bar 中央半圓凸起 + QR Code 快捷按鈕
// 20260224zi: Firestore WebSocket fallback（預設 WS，被擋自動降級長輪詢）
// 20260224zj: loading overlay 在框架就緒（Phase 3）即隱藏，不等 Phase 4
// 20260224zk: loading 動畫延長 1 秒再跳 100%
// 20260224zl: 未報名單欄位 + 已結束活動反向排序 + 收費公式含未報名人數
// 20260224zm: QR Code 圖片放大 50% + 白邊加寬
// 20260224zn: QR Code 頁面響應式 90vw 寬度
// 20260225c: QR Code 白邊減少 25%
// 20260225d: LINE Custom Token Auth（Firebase UID = LINE userId）
// 20260225e: 補載 firebase-functions-compat SDK
// 20260225f: 改用 Access Token 驗證（ID Token 過期問題）
// 20260225g: 修復 LIFF/Firebase 初始化競態條件（LIFF 先完成再啟動 Firebase Auth）
// 20260225h: Prod 模式移除匿名登入 fallback，避免產生無用匿名用戶
// 20260225i: lastLogin 節流（10 分鐘內不重寫），避免觸發跨裝置 onSnapshot 閃爍
// 20260226f: 修復新用戶卡在「登入確認中」—liff.init()/Auth timeout + isPendingLogin 自動降級
// 20260226g: LINE 首次登入速度優化（ensureProfile + Firebase 並行化 + profile 快取）
// 20260226k: 解除首頁底部隊伍按鈕「功能準備中」擋板（保留賽事按鈕）
// 20260226l: 俱樂部頁右上角新增俱樂部按鈕（依後台 rolePermissions 的 team.create 顯示）
// 20260226m: 俱樂部建立領隊必填 + 詳情頁編輯入口 + 修復入隊申請站內信收件人解析
// 20260226n: rolePermissions 改為 onSnapshot 即時同步（權限變更可即時反映前台功能）
// 20260226w: 修復俱樂部隊員在活動行事曆看不到俱樂部限定活動（補 adminUsers teamId fallback）
// 20260226x: 活動行事曆俱樂部限定標籤改為固定「俱樂部限定」
// 20260226y: 活動頁熱區卡片俱樂部限定標籤與行事曆統一為「俱樂部限定」
// 20260226z: 修復活動開始即 ended 與 ended/cancelled 活動狀態切換後前端短暫消失
// 20260226za: 活動行事曆卡片俱樂部限定標籤文案改為「限定」
// 20260226zb: 修復手動/掃碼簽到寫入錯誤被吞、備註讀取抓到舊紀錄問題
// 20260226zc: 簽到編輯改為軟刪除（status=removed），保留審計軌跡並避開 attendanceRecords delete 規則
// 20260226ze: 簽到寫入前補 Firebase Auth 自動重試，權限錯誤改為明確中文提示
// 20260226zf: 修復簽到簽退權限：Firestore rules 改 isCoachPlus()、錯誤訊息全中文化
// 20260226zg: 簽到簽退 update 規則放寬為 isAuth()，確保活動主辦/委託人（含非教練）皆可操作
// 20260226zh: 圖片上傳改為 WebP 格式（不支援時自動降級 JPEG）
// 20260226zi: 修復 Auth 狀態恢復競態：等待 onAuthStateChanged + persistence 恢復後再檢查登入
// 20260226zj: 登入/報名/取消報名前強制確認 Auth 已登入，避免未認證寫入
// 20260226zk: 修復站內信頁籤分類失效（bindTabBars 搶先綁定導致過濾邏輯未掛載）
// 20260227e: 移除重複「報名名單」標題（改為顯示在表頭含人數）+ 修復手動簽到閃爍（containerId race + setTimeout settle）
// 20260227f: 移除活動詳情頁「報名名單」section title 與分隔線
// 20260227g: 未報名單改為整表手動簽到模式，按鈕移至表頭右側
// 20260227h: 未報名單編輯模式補回踢掉功能 + _removeUnregUser
// 20260227i: 候補名單新增正取功能（編輯按鈕 + 紫色正取按鈕 + _forcePromoteWaitlist）
// 20260227j: 候補名單編輯按鈕改為紫底白字
// 20260227k: 正取後重整仍出現候補名單問題修正（await registration 寫入）
// 20260227l: 正取 activityRecords 更新也改為 await
// 20260227m: 取消報名誤觸同行者 modal 修正（重複本人報名不跳 companion modal）
// 20260227x: 首頁活動卡左上角自動加上黃底粗體月/日標籤
// 20260227y: 修正 event-list.js map block body 缺少 } 的語法錯誤
// 20260227z: 入隊申請升級：廣播全體職員、冷卻機制、第一操作勝出、教練可審核
// 20260227za: 入隊申請 pending 逾 24h 自動解鎖可重新申請
// 20260227zb: 個人頁面俱樂部申請記錄依 groupId 去重，修正廣播後顯示重複筆數
// 20260227zc: banner 初始 skeleton + V 版本號同步修正 SW 快取清除失效
// 20260227zo: 站內信審批 — ensureAuth + 修正 in-memory rollback + leaderUids isTeamStaff
// 20260227zp: 歷史入隊補正 — 去重改為每人取最新一筆 + 目標俱樂部存在性驗證
// 20260227zq: 操作日誌排序修正 — 最新在最上面（依 time 字串降序）
// 20260227zr: 補齊操作日誌 — 申請入隊、退出俱樂部、忽略審批、商品 CRUD、取消報名、手動簽到
// 20260227zs: 前端錯誤日誌系統 — 自動記錄系統異常到 Firestore errorLogs，總管可查閱/清除
// 20260227zt: 補上 admin.errorLogs i18n 翻譯（錯誤日誌按鈕顯示正確）
// 20260227zu: 修復 _writeErrorLog 靜默失敗（FirebaseService._db → db）+ 入隊審批 permission-denied（rules 改用 sameFieldValue）
// 20260227zv: 入隊審批 permission-denied 終極修復 — users.update 改 isAuth() + _ensureAuth 檢查回傳值
// 20260227zw: 修復錯誤日誌寫入/讀取 — .catch 改為 console.warn 可見 + rules 改 token.role 直接判斷避免 roleFromUserDoc null 問題
// 20260227zx: 俱樂部介紹頁 — 成員膠囊全部顯示（移除 slice/...xx人）+ 新增俱樂部限定活動欄位
// 20260227zy: 隊員數改為即時從 users.teamId 動態計算（team-detail + team-list 共 4 處）
// 20260227zz: 個人資料頁俱樂部申請欄位只顯示最新一筆
// 20260227zza: 俱樂部動態實裝 DB 寫入（發文/刪文/置頂/表情/留言/刪留言 共 6 處）
// 20260228a: force global cache refresh for i18n locale rollout
// 20260228b: team invite share text + dynamic team OG + team-share redirects
// 20260228c: Cloudflare Worker route for team-share dynamic OG (main domain)
// 20260228d: team detail member list edit mode + staff-only member removal with full sync
// 20260228e: multi-team membership compatibility (teamIds/teamNames) + join flow unblock
// 20260228h: firestore rules security hardening + team-only multi-select redesign + memory sync
// 20260228i: event sport-tag single-select + required validation + SVG sport icons
// 20260228j: switch sport category icons from SVG to Emoji
// 20260228k: team-only selector display fallback (avoid raw tm_* IDs in UI)
// 20260228l: deep-link boot guard + full-screen transition overlay (avoid home flash before target page)
// 20260228m: deep-link unauth flow auto-redirects to LINE login instead of timing out on overlay
// 20260304a: cold-start acceleration — tiered startup (public data first, Auth parallel), listener deferral, TTL by role, Worker edge cache
// 20260304b: auto-redirect to LINE login when unauthenticated on homepage
// 20260305: fix game-lab showGame() display:none bug (game section never showed)
// 20260305a: game-lab full Chinese UI, light/dark theme, field line markings
// 20260305b: free aim, hint top-right, goal randomness, streak ramp, 10x shake
// 20260306w: 手動簽到勾選簽退時自動補勾簽到，儲存時同步寫入 checkin + checkout
// 20260306x: redeploy cache bump for manual checkout/checkin sync fix
// 20260305e: Phase 1 shot game — Cloud Function submit + Firestore leaderboard
// 20260305f: game adjustments — intro modal, shot game ad slot, flash fix
// 20260305j: 射門遊戲嵌入主站（pages/game.html + shot-game-page.js + game.css）
// 20260305n: game-lab 排行榜落庫修正（匿名登入擋板 + 日/週/月榜同步寫入）
// 20260305o: 修復廣告欄位偶發被清空（seed 僅補缺、不覆蓋）+ 防初始化競態重複 seed
// 20260305p: 修復射手榜同一玩家重複列（本地暫存與 Firestore 排名合併）
// 20260305q: PK 射門 UI 修正（淺色訊息深色化 + HUD 字級提升 + 主題切換月亮遮擋）
// 20260305r: 修復射手榜即時「快取幽靈玩家」重複列（提交中暫存列 + uid 去重）
// 20260305s: game-lab 淺色背景去雲朵 + 套用主站同款 opening loading overlay
// 20260305t: 射手榜名稱優先使用 LINE 暱稱，避免顯示玩家xxxx
// 20260305u: 首頁空資料區塊隱藏 + 小遊戲卡文案更新 + 金色漸層反光卡片
// 20260305v: 小遊戲 HUD 位置調整 + 抽屜新增小遊戲管理與首頁顯示開關
// 20260305w: 當前最佳改為整合資訊卡（最佳紀錄 + 分數/連進）並與九宮格得分卡等高
// 20260305x: 球門左右移動邊界擴大 20%，提升移動範圍
// 20260305y: 射門 HUD 改為多層記分板樣式，當前最佳卡高度與九宮格得分卡動態對齊
// 20260305z: HUD 記分板重排（本局記錄置頂、上層欄位縮窄、移除重複列）
// 20260305aa: 手機版 HUD 防換行優化（主流螢幕寬度下維持單行與可讀性）
// 20260305ab: HUD 左右欄位定位修正（本局記錄靠左、九宮格靠右，避免邊線重疊）
// 20260305ac: 修復記分板下層母版容器裁切（高度同步改為不小於內容高度）
// 20260305ad: 射門遊戲新增球門後方廣告看板，並加入訊息可讀性底帶（同步 sga1 廣告圖）
// 20260305ae: 移除右上九宮格說明面板，得分改為球門九宮格內嵌顯示，並置中本局記錄欄位
// 20260305af: 修復射門遊戲廣告看板讀圖來源（slot/type fallback）並放大球門後方廣告空間
// 20260305ag: 九宮格分數新增半透明底色，並隨主題切換色彩以提升可讀性
// 20260305ah: 移除球門後方 3D 廣告看板（停用看板渲染與貼圖流程）
// 20260305ai: 九宮格分數底圖放大，接近單格滿版以提升辨識度
// 20260306a: 主題切換改為遮罩滑動樣式（露月亮=深色、露太陽=淺色）
// 20260306b: 蓄力準星抖動降 50%，放手按準星當下位置出球，並修正球面貼圖完整覆蓋
// 20260306c: 球改用 glTF 原始模型 UV 與材質，修正球面貼圖未貼滿
// 20260306d: 小遊戲主題優先跟隨主站 data-theme / sporthub_theme，再回退系統主題
// 20260306e: page-game 將 GLTFLoader 改為最佳努力載入，避免 loader 失敗阻斷遊戲啟動
// 20260306f: 修正點球命中檢測為遞迴 raycast，恢復可射門
// 20260306h: 首頁性能瘦身 V2 Step 2，建立可等待的 page/script/data gateway 契約
// 20260306i: 首頁性能瘦身 V2 Step 3，補上 detail gateway 與 deep link 安全流程
// 20260306j: 首頁性能瘦身 V2 Step 4，移出非首頁 eager route modules 並保留安全 gateway
// 20260306k: 修正 applyRole() 在登入同步時直接呼叫 lazy admin renderer 導致首頁報錯
// 20260306l: 將 message-admin / auto-exp 放回 eager，修正申請入隊與前台共享 runtime 回歸
// 20260306m: 首頁性能瘦身 V2 Step 5A，將 Firebase/LIFF 改為一次性延後初始化並移除首頁 preload
// 20260306n: 首頁性能瘦身 V2 Step 5B，首頁改為 critical/deferred 分段渲染並延後輪播/彈窗
// 20260306o: 補 route/cloud loading overlay，讓冷啟動首次切頁與登入同步期間有明確等待提示
// 20260306p: 將 route loading 改為 toast 下方非阻擋小提示，並收斂 LINE 文案只在 auth pending 顯示
// 20260306q: status hint 底部高度對齊既有 toast（如「功能準備中」）
// 20260306r: Step 6 驗收補齊 shop/tournament detail 冷首訪 fragment/data 契約缺口
// 20260306s: PK 大賽蓄力條改為跟隨球的螢幕座標顯示在球上方，避免手機手指遮擋
// 20260306v: 活動刪除改為等待 Firestore 成功後才更新前端，避免刷新後被刪活動重新出現
// 20260306y: 修復活動詳情頁「現場簽到」在 scan.js lazy load 前點擊會報 goToScanForEvent is not a function
// 20260309l: 修復取消再報名後出席紀錄顯示未出席的 BUG
// 20260309y: 收緊 users 時間/俱樂部欄位寫入規則 + deleteTeam 多俱樂部清理 + 規則測試補強
// 20260309z: 個人資訊頁俱樂部申請改為每支俱樂部顯示最新一筆狀態
// 20260309aa: 修正 messages 監聽查詢與個人頁俱樂部申請過濾
// 20260310: 將 registrations 即時監聽改為規則相容的 user-scoped/admin-scoped 查詢
// 20260310a: 收斂 boot/static collection query，移除 documentId orderBy 啟動查詢
// 20260310b: 將 boot/static collection 載入改為序列化，降低 init 期 Firestore targets 壓力
// 20260310c: 將首頁 events 預載也改為序列化，避免首頁啟動期偶發 Firestore Listen/channel 400
// 20260310d: 將 operationLogs 寫入改為固定文件 ID + 可重入 set，避免偶發 already-exists
// 20260310e: 新增第一版 change watch 後端異動監看（users/events/registrations/attendanceRecords）
// 20260310f: 將 change watch 日誌子集合改名為 changeWatchEntries，避免 entries TTL 誤傷其他集合群組
// 20260310g: 活動名稱上限從 12 字放寬為 16 字
// 20260310h: 彈跳廣告支援 app://bind-line-notify 直接觸發 LINE 推播綁定
// 20260310i: LINE 推播綁定在未登入或登入狀態未同步時改為明確提示，未登入時直接導向 LINE 登入
// 20260310j: 新增活動性別限定，含範本、報名限制與活動卡緞帶顯示
// 20260310k: 活動詳情頁在未設定年齡限制時隱藏年齡列
// 20260310l: 活動行事曆性別緞帶改為顯示限男生 / 限女生
// 20260310m: 首頁活動卡片性別緞帶移到圖片下方的人數右側空白區
// 20260310n: 個人資訊的我的資料編輯區開放修改性別
// 20260310o: 修正首頁活動卡片性別緞帶偏移，恢復斜角絕對定位
// 20260310q: 後台三種日誌整合為單頁分頁式日誌中心
// 20260310r: 後台活動參與查詢新增 7 天臨時網址分享頁
// 20260310s: 日誌中心工具列統一位置與返回箭頭文案
// 20260310t: 活動參與查詢主卡改為摘要模式，明細只留臨時頁
// 20260310u: 調整後台抽屜中數據儀表板與小遊戲管理的順序與預設角色門檻
// 20260310v: 後台抽屜入口全面接入自訂層級權限，並修正自訂層級 runtime 等級計算
// 20260310w: 頭像載入失敗時自動 fallback 成字首，降低 LINE 舊頭像網址 404 對管理頁與個人頁的影響
// 20260310x: 權限管理頁改版，加入抽屜排序、儲存成預設、只顯示已有權限與總管鎖定
// 20260310y: 後台入口改為只看權限碼顯示，不再受抽屜最低層級限制
// 20260310z: 持久化記錄失效頭像網址，避免已知 LINE 壞圖反覆觸發 404
// 20260310aa: 啟動時延後恢復受保護路由，避免首頁刷新時誤跳權限不足
// 20260310ab: 鎖定一般用戶為零後台權限，前端與 Firestore 規則都不承認 user 權限
// 20260310ac: 操作日誌改抓最新 500 筆並依實際建立時間排序，修正日誌中心看不到新紀錄
// 20260310ad: 稽核日誌搜尋條件改為可收折，保留日期欄位常駐
// 20260310ae: 稽核日誌收折範圍擴大為整個搜尋條件區，包含日期欄位
// 20260310af: 稽核日誌搜尋條件改用原生 details/summary 重做收折，避免分頁重組後收折失效
// 20260310ag: 數據儀表板「活動參與查詢」加入欄位收折功能
// 20260310ah: 改用原生 details/summary 重做收折，與稽核日誌同一方案
// 20260310ai: 修正 .dash-query-summary class 名稱衝突（與結果統計 grid 同名導致 summary 元素 CSS 錯誤）
// 20260310aj: 放棄 details/summary，改用 classList.toggle 直接操作 DOM 實現收折
// 20260310ak: 收折 onclick 改為完全 inline（this.parentElement.classList.toggle），零外部依賴
// 20260310al: 活動參與查詢收折改為原生 details/summary，並以獨立 class 與狀態同步重做
// 20260310am: 活動參與查詢收折摘要列改版，對齊稽核日誌的箭頭與提示樣式
// 20260310an: 活動參與查詢摘要列改為兩層佈局，箭頭與狀態同行，預設起始日固定為 2026-02-01
// 20260310ao: 操作日誌類型標籤改為依類型家族分色，提升辨識度
// 20260311p: 修補友誼賽站內信審核導流與申請重入保護
// 20260311q: 活動詳情封面新增依類型配色的左下斜角緞帶
// 20260311r: 修正活動詳情封面左下斜角緞帶方向
// 20260311s: 首頁近期活動縮圖新增同款左下類型斜角緞帶
// 20260311t: 首頁活動首次載入點擊新增 toast 與卡片 pending 提示
// 20260311w: 首頁與行事曆活動卡片人數改與報名名單共用摘要，已滿時不再誤顯示即將額滿
// 20260311x: 賽事詳情主辦聯繫與編輯工具列調整，並修正友誼賽表單的報名費 toggle、報名開始與隊伍上限設定
// 20260311y: 活動行事曆移除標題旁的額滿標籤，滿額狀態改只看最右側報名狀態
// 20260311z: 活動報名/取消改以 participants、waitlistNames 實際佔位同步 current/waitlist，避免 27/26 未進候補
// 20260311aa: 首頁活動卡片將報名狀態移到人數右側，額滿時整段人數改為紅字
// 20260311ab: 切換頁面與返回上一頁時統一強制回到頁面頂端，避免延後 render 覆蓋 scroll reset
// 20260311ac: 切入活動頁時強制回到「一般」頁籤，避免保留上次停留的「已結束」狀態
// 20260311ad: 每次切回首頁時將近期活動橫向卡片列重置到最左側，避免停在上次滑動位置
// 20260311ae: 首頁與活動頁改為先顯示最近一次快取畫面，再背景刷新資料，降低頻繁切頁的阻擋感
// 20260311af: route loading 加入超時保險絲，並將 WebSocket fallback 改為 tab-scoped 短 TTL，避免多頁籤長輪詢卡死
// 20260311ag: 縮小 cloud init boot 集合並延後活動頁即時監聽，減輕多頁籤活動頁切入壓力
// 20260311ah: 活動頁允許在 cloud 未完成時先顯示快取畫面，再背景補雲端初始化與刷新
// 20260311am: 活動費用欄位預設改為 0，沒有有效金額時開啟開關顯示 0
// 20260312a: 新增用戶補正管理頁，支援放鴿子補正與歷史入隊補正子權限，放鴿子統計改為只看未簽到
// 20260312b: 修正放鴿子補正的用戶搜尋結果在名稱缺失時重複顯示 UID
// 20260312c: 修正放鴿子補正寫入被 Firestore 規則拒絕，超級管理員可直接寫入補正
// 20260312e: 修正權限管理「儲存成預設」隔夜失效，避免 catalogVersion 補遷移覆蓋手動權限
// 20260312f: 啟動 achievement Phase 1，建立 js/modules/achievement/ 骨架與 facade 載入鏈
// 20260312g: 啟動 achievement Phase 2，抽離 stats helper 並收斂徽章與稱號重複計算
// 20260312l: achievement Phase 6，移除假條件並收斂成就正式支援模板
// 20260312o: 修正活動候補轉正取後殘留在候補名單，並補上候補顯示去殘影
// 20260313a: 修正 operationLogs 可重入寫入權限與站內信重送去重，避免 permission-denied / already-exists
// 20260313b: 活動報名系統 Bug 修復 — 統一佔位重建 _rebuildOccupancy，Transaction 化報名流程，新增 registration-audit
// 20260313c: 新增 repairRegistrationStatuses() 完整校正 registration status + event 投影
// 20260313d: 所有報名寫入流程改用 batch 原子操作，修復 _removeParticipant 多人遞補
// 20260313f: 日誌中心 UI 精簡（移除 panel-header/toolbar-copy，新增 ℹ 說明彈窗含毛玻璃效果）
// 20260313l: 跨瀏覽器相容性修復（webkit-backdrop-filter、dvh fallback、clipboard fallback、replaceAll→replace）
// 20260313m: 日誌中心 UI 改善：按鈕置中並排、log 行底色分類、操作日誌加重整按鈕
// 20260313n: 修復孤兒資料根因：deleteEvent 級聯清理 + 手動簽到 UID 解析
// 20260314r: 掃碼簽到加入日期分類篩選（今日/過期/未來）
// 20260314s: 首頁活動卡片載入 toast 改為持續顯示 + 5 秒後提示重整
// 20260314t: 首頁活動卡片載入中改為底部動畫進度條
// 20260314u: 活動卡片載入改為縮圖半透明遮罩 + 進度條
// 20260314v: 活動卡片載入改為置中圓潤計量棒 0%→100%
// 20260314w: 修復載入條被 renderHotEvents 重建 DOM 摧毀的問題
// 20260314x: 活動詳情頁新增報名/取消 Log 彈窗（管理者限定）
// 20260314y: 修復 Log 彈窗 Firestore Timestamp 排序錯誤（localeCompare → 毫秒數值比較）
// 20260314z: 活動行事曆卡片點擊新增半透明深底色 + 置中計量條載入動畫
// 20260314za: 頭像壞圖修復 — 登入時清除壞圖快取 + naturalWidth < 2 + 延遲複檢 + DOM img onerror
// 20260313o: 委託人（user）掃碼頁 delegate 例外 + Log 彈窗 Firestore 直查（不依賴本地快取）
// 20260314zb: 修復手動簽到 UID 不匹配導致已簽到紀錄被批量誤刪（delegate user 觸發）
// 20260314zc: 修復雲端範本刪除靜默失敗（deleteEventTemplate 回傳 false 不拋錯）
// 20260314zd: 外部連結改用具名視窗，避免分頁無限累積
// 20260314ze: 修復登入重導後空白模板（race condition + REST/SDK ID 查詢修正）
// 20260314zf: 修復取消報名後按鈕未更新（showEventDetail 未 await + _restoreCancelUI 時序）
// 20260314zg: 修復 LINE 登入成功但 getProfile 失敗時無限循環跳轉登入
// 20260314zh: 修復外部 Safari 無法登入（liff.login redirectUri 只在有 deep link 時才帶）
// 20260314zi: getProfile 失敗時以 ID Token 解析用戶資料（外部瀏覽器 fallback）
// 20260314zj: 外部瀏覽器登入修復：直接 Profile API fallback + access token 診斷 + 無效 session 自動重新登入
// 20260314zk: 修復取消報名 insufficient permissions：cancelRegistration/cancelCompanionRegistrations 加入 auth 回傳值檢查
// 20260314zl: EXP 系統修正 — 改用 Cloud Function adjustExp，修復非 super_admin 無法調整 EXP 的問題
// 20260315a: 俱樂部自動晉升修正 — updateUserRole 改用 autoPromoteTeamRole CF，修復非 super_admin 角色變更失敗
// 20260315b: 個人數據頁完成場次/出席率修正 — 統一使用 _calcScanStats 取代永遠為 0 的錯誤邏輯
// 20260315zz: Tier 2 login — LIFF 過期時以 Firebase Auth + profile 快取維持登入（30 天快取 + UID 驗證）
// 20260315aaa: 活動分享升級 — LINE Flex Message + shareTargetPicker + 底部選單 + 建立後分享提示
// 20260315aab: 分享模組修復 — 防連點、altText 截斷、typeof 守衛、toast 語意修正
// 20260315aac: surrogate pair 安全截斷、var→const/let 統一、unhandled rejection 防護
// 20260315aad: 修復建立活動無反應+重複建立 — 關鍵收尾(closeModal/toast)提前於非關鍵操作
// 20260315aae: 分享功能改善 — LIFF 未就緒時自動等待、Tier 2 登入也顯示底部選單、外部瀏覽器提示
// 20260315aaf: 修復建立/編輯活動後列表未刷新 — render 呼叫移出 try-catch 確保獨立執行
// 20260315aag: 全站分享升級 — 俱樂部/賽事/名片分享改用 LIFF URL + Flex Message + 底部選單
// 20260316r: Per-user achievement progress — 雙寫子集合 + fallback 即時計算
// 20260316s: Phase 3+4 — 支援讀其他用戶徽章 + 移除全域寫入 + 清理汙染邏輯
// 20260316t: 一次性清理全域 achievements 汙染（重設 current/completedAt 為模板狀態）
// 20260317j: Phase 2 — 拆分 event-list/scan/team-detail/profile-data/profile-core/team-list/dashboard
// 20260317zn: 教育型俱樂部系統 Phase 1-8（type/eduSettings + 分組/學員/課程/簽到/行事曆/通知）
// 20260317zo: QA 修復 — onclick XSS、missing await、deleteEduStudent、null guard
// 20260317zp: fix — 教育 CRUD 全部加 ensureAuthReadyForWrite 防止權限錯誤
// 20260317zq: fix — 刷新時 detail 頁面退回列表 + showTeamDetail render-before-show
// 20260318a: fix — hashchange 不套用 detail fallback，修復點卡片無法進入 detail 頁
// 20260318b: redeploy trigger
// 20260318c: B1+C1 — cancelRegistration _docId 回填 + 移除 _syncMyEventRegistrations 前置查詢
// 20260318d: QA fix — _docId 防禦移到快取變更前 + 移除 handleCancelSignup 的 _docId 門檻
// 20260318e: fix — bindLineNotify 移除 LIFF 登入檢查，外部/PC 瀏覽器可正常綁定
// 20260318f: fix — 跨裝置報名狀態同步（RC1+RC3+RC4+RC5+RC8）
// 20260318g: fix — _flipAnimating 卡死導致活動卡片無法點擊（F1+F2+F3+F4）
// 20260318zl: fix — 刷新瀏覽器後點頁籤恢復 500ms 延遲加載提示，避免用戶以為按鈕壞掉
// 20260318zm: feat — 分享連結改用 toosterx.com 中繼跳轉，避免 liff.line.me 被 LINE 社群回收
// 20260318zn: fix — image-cropper.js 加回 index.html，修復效能優化後裁切功能消失
// 20260318zs: fix — 首次造訪空框架問題：overlay 改為有內容才收 + CDN preload + WS timeout 降為 6s + SW 更新
// 20260319p: 活動分享連結改回 Mini App URL
// 20260319q: 抽屜加入「下載APP」PWA 安裝按鈕
// 20260319s: 下載APP 按鈕加光激繞圈效果
// 20260319t: 修正光跡遮蔽 + 金色光跡
// 20260319u: iOS 加複製網址按鈕 + 兩端加 URL 提示
// 20260319v: 外部活動中繼卡片 + YouTube 嵌入播放
// 20260319w: 外部活動分享連結改 Mini App URL（先進站再跳外部）
// 20260319x: 抽屜按鈕移到第二行，防名字過長擠出
// 20260319y: cancelRegistration 修正：commit 成功後才更新快取
// 20260319z: 外部活動中繼卡片加分享按鈕（右下角圓形）
// 20260320a: 分享按鈕改為與操作按鈕同行排列
// 20260320b: 分享按鈕先關閉中繼卡片再觸發分享流程
// 20260320c: 分享改用自帶邏輯（navigator.share / clipboard），不關閉中繼頁
// 20260320e: 中繼卡片分享改用完整 Action Sheet（動態載入 event-share）
// 20260320f: 修復候補邏輯 — 降級 activityRecord 同步、cancelCompanionRegistrations 改用 Firestore 查詢 + 模擬模式、容量變更快取刷新
// 20260320g: 活動詳情頁即時監聽 events + 手動刷新按鈕
const CACHE_VERSION = '20260320g';

// ─── Page Strategy Registry ───
// 唯一策略來源，未列出的頁面預設 fresh-first
const PAGE_STRATEGY = {
  // 主要頁面
  'page-home':               'stale-first',
  'page-activities':         'stale-first',
  'page-teams':              'stale-first',
  'page-tournaments':        'stale-first',
  'page-personal-dashboard': 'stale-first',
  'page-leaderboard':        'stale-first',
  'page-activity-detail':    'stale-first',
  'page-my-activities':      'stale-first',
  'page-shop':               'stale-first',

  // 詳情頁（需確認資料新鮮度）
  'page-profile':            'stale-confirm',
  'page-team-detail':        'stale-confirm',
  'page-tournament-detail':  'stale-confirm',
  'page-shop-detail':        'stale-confirm',

  // 後台管理頁（抽屜入口 — 快取優先 + 背景刷新）
  'page-admin-dashboard':    'stale-first',
  'page-admin-teams':        'stale-first',
  'page-admin-tournaments':  'stale-first',
  'page-admin-games':        'stale-first',
  'page-admin-users':        'stale-first',
  'page-admin-banners':      'stale-first',
  'page-admin-shop':         'stale-first',
  'page-admin-messages':     'stale-first',
  'page-admin-themes':       'stale-first',
  'page-admin-exp':          'stale-first',
  'page-admin-auto-exp':     'stale-first',
  'page-admin-announcements':'stale-first',
  'page-admin-achievements': 'stale-first',
  'page-admin-roles':        'stale-first',
  'page-admin-logs':         'stale-first',
  'page-admin-repair':       'stale-first',
  'page-admin-inactive':     'stale-first',
};

// ─── Page Data Contract ───
// 每頁的資料依賴定義：required = 必要集合，optional = 可背景補的，realtime = 需即時監聽的
const PAGE_DATA_CONTRACT = {
  'page-home':               { required: ['events', 'banners', 'announcements'], optional: ['teams', 'tournaments', 'leaderboard'], realtime: [] },
  'page-activities':         { required: ['events'], optional: ['registrations'], realtime: ['registrations', 'attendanceRecords'] },
  'page-teams':              { required: ['teams'], optional: [], realtime: [] },
  'page-tournaments':        { required: ['tournaments'], optional: ['standings', 'matches'], realtime: [] },
  'page-personal-dashboard': { required: ['events', 'registrations'], optional: ['attendanceRecords'], realtime: [] },
  'page-leaderboard':        { required: ['leaderboard'], optional: [], realtime: [] },
  'page-profile':            { required: [], optional: ['attendanceRecords', 'activityRecords'], realtime: [] },
  'page-team-detail':        { required: ['teams'], optional: ['events'], realtime: [] },
  'page-tournament-detail':  { required: ['tournaments', 'standings', 'matches'], optional: [], realtime: [] },
  'page-shop':               { required: ['shopItems'], optional: ['trades'], realtime: [] },
  'page-shop-detail':        { required: ['shopItems'], optional: ['trades'], realtime: [] },
  'page-activity-detail':    { required: ['events'], optional: ['registrations', 'attendanceRecords', 'activityRecords', 'userCorrections'], realtime: ['registrations', 'attendanceRecords'] },
  'page-my-activities':      { required: ['events', 'registrations'], optional: ['attendanceRecords'], realtime: ['registrations', 'attendanceRecords'] },
  'page-scan':               { required: ['events', 'attendanceRecords'], optional: [], realtime: ['attendanceRecords'] },
  // 後台管理頁（required: [] 允許首次載入後即走 stale-first）
  'page-admin-dashboard':    { required: [], optional: ['expLogs', 'teamExpLogs', 'operationLogs', 'attendanceRecords', 'activityRecords'], realtime: [] },
  'page-admin-teams':        { required: [], optional: ['teams', 'tournaments', 'standings', 'matches'], realtime: [] },
  'page-admin-tournaments':  { required: [], optional: ['tournaments', 'standings', 'matches'], realtime: [] },
  'page-admin-games':        { required: [], optional: ['gameConfigs'], realtime: [] },
  'page-admin-users':        { required: [], optional: ['permissions', 'customRoles'], realtime: [] },
  'page-admin-banners':      { required: [], optional: ['banners', 'floatingAds', 'popupAds', 'sponsors'], realtime: [] },
  'page-admin-shop':         { required: [], optional: ['shopItems', 'trades'], realtime: [] },
  'page-admin-messages':     { required: [], optional: ['adminMessages', 'notifTemplates'], realtime: [] },
  'page-admin-themes':       { required: [], optional: ['siteThemes'], realtime: [] },
  'page-admin-exp':          { required: [], optional: ['expLogs', 'teamExpLogs'], realtime: [] },
  'page-admin-auto-exp':     { required: [], optional: ['expLogs'], realtime: [] },
  'page-admin-announcements':{ required: [], optional: ['announcements'], realtime: [] },
  'page-admin-achievements': { required: [], optional: ['achievements', 'badges'], realtime: [] },
  'page-admin-roles':        { required: [], optional: ['permissions', 'customRoles'], realtime: [] },
  'page-admin-logs':         { required: [], optional: ['operationLogs', 'errorLogs'], realtime: [] },
  'page-admin-repair':       { required: [], optional: ['events', 'attendanceRecords', 'activityRecords', 'userCorrections', 'teams'], realtime: [] },
  'page-admin-inactive':     { required: [], optional: ['attendanceRecords', 'activityRecords', 'operationLogs'], realtime: [] },
};

// ─── Achievement Condition Config ───
const ACHIEVEMENT_CONDITIONS = {
  timeRanges: [
    { key: 'none',   label: '累計' },
  ],
  actions: [
    { key: 'register_event',  label: '報名活動',             unit: '場', needsFilter: true },
    { key: 'complete_event',  label: '完成活動（簽到+簽退）', unit: '場', needsFilter: true },
    { key: 'attend_play',     label: '出席 PLAY 活動',       unit: '場', needsFilter: false },
    { key: 'attend_friendly', label: '出席友誼活動',         unit: '場', needsFilter: false },
    { key: 'attend_camp',     label: '出席教學活動',         unit: '場', needsFilter: false },
    { key: 'attend_watch',    label: '出席觀賽',             unit: '場', needsFilter: false },
    { key: 'attendance_rate', label: '達到出席率',           unit: '%', needsFilter: false },
    { key: 'reach_level',     label: '達到等級',             unit: '級',  needsFilter: false },
    { key: 'reach_exp',       label: '累計 EXP',             unit: '點',  needsFilter: false },
    { key: 'join_team',       label: '加入俱樂部',             unit: '',  needsFilter: false },
    { key: 'complete_profile',label: '完成個人檔案',         unit: '',  needsFilter: false },
    { key: 'bind_line_notify',label: '綁定 LINE 推播',       unit: '',  needsFilter: false },
    { key: 'days_registered', label: '註冊天數',             unit: '天', needsFilter: false },
    { key: 'organize_event', label: '主辦活動',             unit: '場', needsFilter: true },
    { key: 'diverse_sports', label: '參與不同運動類型',     unit: '種', needsFilter: false },
    { key: 'no_show_free',   label: '連續無放鴿子',         unit: '場', needsFilter: false },
    { key: 'create_team',    label: '建立俱樂部',             unit: '隊', needsFilter: false },
    { key: 'bring_companion',label: '帶同行者報名',         unit: '人次', needsFilter: false },
    { key: 'team_member_count', label: '俱樂部成員數',        unit: '人', needsFilter: false },
    { key: 'early_event',    label: '參加早場活動',         unit: '場', needsFilter: false },
    { key: 'night_event',    label: '參加夜場活動',         unit: '場', needsFilter: false },
    { key: 'shop_trade',     label: '完成商城兌換',         unit: '次', needsFilter: false },
    { key: 'game_play',      label: '完成小遊戲',           unit: '場', needsFilter: false },
    { key: 'game_high_score',label: '小遊戲最高分',         unit: '分', needsFilter: false },
    { key: 'role_coach',     label: '教練身份',             unit: '',  needsFilter: false },
    { key: 'role_captain',   label: '領隊/經理身份',        unit: '',  needsFilter: false },
    { key: 'role_venue_owner',label: '場主身份',            unit: '',  needsFilter: false },
    { key: 'role_admin',     label: '管理員身份',           unit: '',  needsFilter: false },
    { key: 'role_super_admin',label: '總管身份',            unit: '',  needsFilter: false },
    { key: 'manual_award',   label: '手動授予',             unit: '',  needsFilter: false },
  ],
  filters: [
    { key: 'all',      label: '所有類型' },
    { key: 'play',     label: 'PLAY' },
    { key: 'friendly', label: '友誼' },
    { key: 'camp',     label: '教學' },
    { key: 'watch',    label: '觀賽' },
  ],
};

// ─── Mode Manager（stub — Demo 模式已移除，永遠回傳 production）───
const ModeManager = { isDemo() { return false; }, getMode() { return 'production'; } };

const PROD_HOSTS = Array.isArray(window.__SPORTHUB_PROD_HOSTS__)
  ? [...window.__SPORTHUB_PROD_HOSTS__]
  : ['toosterx.com', 'www.toosterx.com', 'msw2004727.github.io', 'fc-3g8.pages.dev'];

// ─── LINE Login Config ───
const LINE_CONFIG = {
  LIFF_ID: '2009525300-AuPGQ0sh',          // Mini App LIFF ID（用於 liff.init）
  LIFF_ID_LEGACY: '2009084941-zgn7tQOp',   // [備用] 舊 LIFF App ID
  MINI_APP_ID: '2009525300-AuPGQ0sh',
  CHANNEL_ID: '2009525300',
  BOT_BASIC_ID: '@830utvza',
};

// ─── Share URL Base ───
// 所有新分享連結統一使用 LINE Mini App URL
// 舊 LIFF URL (liff.line.me/2009084941-zgn7tQOp) 仍透過 index.html 中繼跳轉支援
const MINI_APP_BASE_URL = 'https://miniapp.line.me/' + LINE_CONFIG.MINI_APP_ID;

// ─── Role Hierarchy & Config ───
const BUILTIN_ROLE_KEYS = ['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'];

const _BASE_ROLES = {
  user:        { level: 0, label: '一般用戶', color: '#6b7280' },
  coach:       { level: 1, label: '教練',     color: '#0d9488' },
  captain:     { level: 2, label: '領隊',     color: '#7c3aed' },
  venue_owner: { level: 3, label: '場主',     color: '#d97706' },
  admin:       { level: 4, label: '管理員',   color: '#2563eb' },
  super_admin: { level: 5, label: '總管',     color: '#dc2626' }
};

const _BASE_ROLE_LEVEL_MAP = { user:0, coach:1, captain:2, venue_owner:3, admin:4, super_admin:5 };

function _getRuntimeCustomRolesSource() {
  try {
    if (typeof App !== 'undefined' && App && typeof App._getCustomRoles === 'function') {
      const roles = App._getCustomRoles();
      if (Array.isArray(roles)) return roles;
    }
  } catch (_) {}

  try {
    if (typeof FirebaseService !== 'undefined'
      && FirebaseService
      && FirebaseService._cache
      && Array.isArray(FirebaseService._cache.customRoles)) {
      return FirebaseService._cache.customRoles;
    }
  } catch (_) {}

  try {
    if (typeof DemoData !== 'undefined' && Array.isArray(DemoData.customRoles)) {
      return DemoData.customRoles;
    }
  } catch (_) {}

  return [];
}

function _normalizeRuntimeCustomRoles(customRoles) {
  return (customRoles || [])
    .filter(role => role && typeof role.key === 'string' && role.key.trim())
    .map(role => ({
      key: role.key,
      label: role.label || role.key,
      color: role.color || '#6366f1',
      afterRole: role.afterRole || 'captain',
    }));
}

function getRuntimeRoleSequence() {
  const customRoles = _normalizeRuntimeCustomRoles(_getRuntimeCustomRolesSource());
  const children = new Map();

  customRoles.forEach(role => {
    const parent = role.afterRole || 'captain';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(role);
  });

  const result = [];
  const visited = new Set();

  const appendRole = (roleKey) => {
    result.push(roleKey);
    const childRoles = children.get(roleKey) || [];
    childRoles.forEach(child => {
      if (visited.has(child.key)) return;
      visited.add(child.key);
      appendRole(child.key);
    });
  };

  BUILTIN_ROLE_KEYS.forEach(appendRole);

  customRoles.forEach(role => {
    if (visited.has(role.key)) return;
    visited.add(role.key);
    result.push(role.key);
  });

  return result;
}

function _buildRuntimeRoleLevelMap() {
  const levels = { ..._BASE_ROLE_LEVEL_MAP };
  const sequence = getRuntimeRoleSequence();

  for (let i = 0; i < BUILTIN_ROLE_KEYS.length - 1; i += 1) {
    const startKey = BUILTIN_ROLE_KEYS[i];
    const endKey = BUILTIN_ROLE_KEYS[i + 1];
    const startIndex = sequence.indexOf(startKey);
    const endIndex = sequence.indexOf(endKey);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex + 1) continue;

    const between = sequence.slice(startIndex + 1, endIndex);
    const step = (_BASE_ROLE_LEVEL_MAP[endKey] - _BASE_ROLE_LEVEL_MAP[startKey]) / (between.length + 1);
    between.forEach((roleKey, index) => {
      levels[roleKey] = _BASE_ROLE_LEVEL_MAP[startKey] + step * (index + 1);
    });
  }

  const superAdminIndex = sequence.indexOf('super_admin');
  if (superAdminIndex >= 0 && superAdminIndex < sequence.length - 1) {
    const deferredRoles = sequence.slice(superAdminIndex + 1);
    const step = (_BASE_ROLE_LEVEL_MAP.super_admin - _BASE_ROLE_LEVEL_MAP.admin) / (deferredRoles.length + 1);
    deferredRoles.forEach((roleKey, index) => {
      levels[roleKey] = _BASE_ROLE_LEVEL_MAP.admin + (step * (index + 1));
    });
  }

  return levels;
}

function getRuntimeRoleLevel(roleKey) {
  if (!roleKey) return 0;
  const levels = _buildRuntimeRoleLevelMap();
  return levels[roleKey] ?? 0;
}

function getRuntimeRoleInfo(roleKey) {
  if (!roleKey) return null;
  if (Object.prototype.hasOwnProperty.call(_BASE_ROLES, roleKey)) {
    return _BASE_ROLES[roleKey];
  }
  const customRole = _normalizeRuntimeCustomRoles(_getRuntimeCustomRolesSource())
    .find(role => role.key === roleKey);
  if (!customRole) return null;
  return {
    level: getRuntimeRoleLevel(roleKey),
    label: customRole.label,
    color: customRole.color,
    custom: true,
  };
}

const ROLES = new Proxy(_BASE_ROLES, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
    return getRuntimeRoleInfo(prop);
  },
  has(target, prop) {
    if (typeof prop !== 'string') return prop in target;
    return Object.prototype.hasOwnProperty.call(target, prop) || !!getRuntimeRoleInfo(prop);
  },
});

const ROLE_LEVEL_MAP = new Proxy(_BASE_ROLE_LEVEL_MAP, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
    return getRuntimeRoleLevel(prop);
  },
  has(target, prop) {
    if (typeof prop !== 'string') return prop in target;
    return Object.prototype.hasOwnProperty.call(target, prop) || getRuntimeRoleLevel(prop) > 0;
  },
});


// ─── Type & Status Config ───
const TYPE_CONFIG = {
  friendly: { icon: '', label: '友誼', color: 'friendly' },
  camp:     { icon: '', label: '教學', color: 'camp' },
  play:     { icon: '', label: 'PLAY', color: 'play' },
  watch:    { icon: '', label: '觀賽', color: 'watch' },
  external: { icon: '', label: '外部', color: 'external' },
};

const EVENT_SPORT_OPTIONS = [
  { key: 'football', label: '足球' },
  { key: 'basketball', label: '籃球' },
  { key: 'baseball_softball', label: '棒壘球' },
  { key: 'volleyball', label: '排球' },
  { key: 'table_tennis', label: '桌球' },
  { key: 'tennis', label: '網球' },
  { key: 'badminton', label: '羽球' },
  { key: 'hiking', label: '登山' },
  { key: 'running', label: '慢跑' },
  { key: 'cycling', label: '單車' },
  { key: 'motorcycle', label: '重機' },
  { key: 'skateboard', label: '滑板' },
  { key: 'dance', label: '舞蹈' },
  { key: 'yoga', label: '瑜伽' },
  { key: 'martial_arts', label: '武術' },
  { key: 'restaurant', label: '餐廳(觀賽)' },
  { key: 'pickleball', label: '匹克球' },
];

const SPORT_ICON_EMOJI = {
  football: '⚽',
  basketball: '🏀',
  baseball_softball: '⚾',
  volleyball: '🏐',
  table_tennis: '🏓',
  tennis: '🎾',
  badminton: '🏸',
  hiking: '🥾',
  running: '🏃',
  cycling: '🚴',
  motorcycle: '🏍️',
  skateboard: '🛹',
  dance: '💃',
  yoga: '🧘',
  martial_arts: '🥋',
  restaurant: '🍽️',
  pickleball: '🏓',
};

const EVENT_SPORT_MAP = EVENT_SPORT_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, Object.create(null));

function getSportKeySafe(key) {
  const raw = String(key || '').trim();
  return EVENT_SPORT_MAP[raw] ? raw : '';
}

function getSportLabelByKey(key) {
  const safeKey = getSportKeySafe(key) || 'football';
  return EVENT_SPORT_MAP[safeKey]?.label || '足球';
}

function getSportIconSvg(key, className = '') {
  const safeKey = getSportKeySafe(key) || 'football';
  const emoji = SPORT_ICON_EMOJI[safeKey] || SPORT_ICON_EMOJI.football;
  const klass = className ? ` ${className}` : '';
  return `<span class="sport-emoji${klass}" aria-hidden="true">${emoji}</span>`;
}

function getLockIconSvg(className = '') {
  const klass = className ? ` class="${className}"` : '';
  return `<svg${klass} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>`;
}

const STATUS_CONFIG = {
  open:      { label: '報名中', css: 'open' },
  full:      { label: '已額滿', css: 'full' },
  ended:     { label: '已結束', css: 'ended' },
  upcoming:  { label: '即將開放', css: 'upcoming' },
  cancelled: { label: '已取消', css: 'cancelled' },
};

const DAY_NAMES = ['日','一','二','三','四','五','六'];

// ─── Security Utilities ───
function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateId(prefix) {
  return (prefix || '') + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ─── Gradient Map (for event creation) ───
const GRADIENT_MAP = {
  friendly: 'linear-gradient(135deg,#0d9488,#065f46)',
  camp:     'linear-gradient(135deg,#ec4899,#be185d)',
  play:     'linear-gradient(135deg,#7c3aed,#4338ca)',
  watch:    'linear-gradient(135deg,#f59e0b,#d97706)',
  external: 'linear-gradient(135deg,#6b7280,#4b5563)',
};

const TOURNAMENT_GRADIENT_MAP = {
  '盃賽': 'linear-gradient(135deg,#7c3aed,#4338ca)',
};

// ─── Home Game Settings（可擴充多款小遊戲） ───
const HOME_GAME_PRESETS = [
  {
    id: 'home_game_shot',
    gameKey: 'shot-game',
    name: '蓄力射門 誰與爭鋒',
    pageTitle: 'ToosterX Hub 射門大賽',
    page: 'page-game',
    sortOrder: 10,
    enabled: true,
    homeVisible: true,
  },
  {
    id: 'home_game_kick',
    gameKey: 'kick-game',
    name: '誰才是開球王',
    pageTitle: 'ToosterX Hub 開球大賽',
    page: 'page-kick-game',
    sortOrder: 20,
    enabled: true,
    homeVisible: false,
  },
];

const TEAM_RANK_CONFIG = [
  { min: 0,    max: 999,   rank: 'E',   color: '#6b7280' },
  { min: 1000, max: 1999,  rank: 'D',   color: '#22c55e' },
  { min: 2000, max: 2999,  rank: 'C',   color: '#3b82f6' },
  { min: 3000, max: 3999,  rank: 'B',   color: '#8b5cf6' },
  { min: 4000, max: 4999,  rank: 'A',   color: '#f59e0b' },
  { min: 5000, max: 5999,  rank: 'A+',  color: '#f97316' },
  { min: 6000, max: 6999,  rank: 'A++', color: '#ef4444' },
  { min: 7000, max: 7999,  rank: 'S',   color: '#ec4899' },
  { min: 8000, max: 8999,  rank: 'SS',  color: '#14b8a6' },
  { min: 9000, max: 10000, rank: 'SSS', color: '#dc2626' },
];

// ─── Drawer Menu Config ───
const DRAWER_MENUS = [
  { icon: '', label: '個人數據', i18nKey: 'drawer.personalData', page: 'page-personal-dashboard', minRole: 'user', locked: true },
  { icon: '', label: '二手商品區', i18nKey: 'drawer.shop', page: 'page-shop', minRole: 'user', locked: true },
  { icon: '', label: '排行榜', i18nKey: 'drawer.leaderboard', action: 'coming-soon', minRole: 'user', locked: true },
  { icon: '', label: '分享網頁', i18nKey: 'drawer.share', action: 'share', minRole: 'user' },
  { divider: true },
  { icon: '', label: '活動管理', i18nKey: 'drawer.activityManage', page: 'page-my-activities', minRole: 'coach', permissionCode: 'activity.manage.entry' },
  { icon: '', label: '賽事管理', i18nKey: 'drawer.tournamentManage', page: 'page-admin-tournaments', minRole: 'coach', permissionCode: 'admin.tournaments.entry' },
  { divider: true, minRole: 'admin' },
  { sectionLabel: '後台管理', i18nKey: 'drawer.backendManage', minRole: 'admin' },
  { icon: '', label: '小遊戲管理', page: 'page-admin-games', minRole: 'admin', permissionCode: 'admin.games.entry' },
  { icon: '', label: '用戶管理', i18nKey: 'admin.userManage', page: 'page-admin-users', minRole: 'admin', permissionCode: 'admin.users.entry' },
  { icon: '', label: '廣告管理', i18nKey: 'admin.adManage', page: 'page-admin-banners', minRole: 'admin', permissionCode: 'admin.banners.entry' },
  { icon: '', label: '二手商品管理', i18nKey: 'admin.shopManage', page: 'page-admin-shop', minRole: 'admin', permissionCode: 'admin.shop.entry' },
  { icon: '', label: '站內信管理', i18nKey: 'admin.messageManage', page: 'page-admin-messages', minRole: 'admin', permissionCode: 'admin.messages.entry' },
  { icon: '', label: '俱樂部管理', i18nKey: 'admin.teamManage', page: 'page-admin-teams', minRole: 'admin', permissionCode: 'admin.teams.entry' },
  { icon: '', label: '數據儀表板', i18nKey: 'admin.dashboard', page: 'page-admin-dashboard', minRole: 'super_admin', permissionCode: 'admin.dashboard.entry' },
  { icon: '', label: '佈景主題', i18nKey: 'admin.themes', page: 'page-admin-themes', minRole: 'super_admin', permissionCode: 'admin.themes.entry' },
  { icon: '', label: '手動 EXP 管理', i18nKey: 'admin.expManage', page: 'page-admin-exp', minRole: 'super_admin', permissionCode: 'admin.exp.entry' },
  { icon: '', label: '自動 EXP 管理', i18nKey: 'drawer.autoExpManage', page: 'page-admin-auto-exp', minRole: 'super_admin', permissionCode: 'admin.auto_exp.entry' },
  { icon: '', label: '系統公告管理', i18nKey: 'admin.announcements', page: 'page-admin-announcements', minRole: 'super_admin', permissionCode: 'admin.announcements.entry' },
  { icon: '', label: '成就/徽章管理', i18nKey: 'admin.achievements', page: 'page-admin-achievements', minRole: 'super_admin', permissionCode: 'admin.achievements.entry' },
  { icon: '', label: '權限管理', i18nKey: 'admin.roles', page: 'page-admin-roles', minRole: 'super_admin' },
  { icon: '', label: '日誌中心', i18nKey: 'admin.logs', page: 'page-admin-logs', minRole: 'super_admin', permissionCode: 'admin.logs.entry' },
  { icon: '', label: '用戶補正管理', i18nKey: 'admin.repair', page: 'page-admin-repair', minRole: 'admin', permissionCode: 'admin.repair.entry', highlight: 'red' },
  { icon: '', label: '無效資料查詢', i18nKey: 'admin.inactive', page: 'page-admin-inactive', minRole: 'super_admin', permissionCode: 'admin.inactive.entry' },
];

const ROLE_PERMISSION_CATALOG_VERSION = '20260317a';
const DISABLED_PERMISSION_CODES = new Set(['admin.roles.entry']);

function isPermissionCodeEnabled(code) {
  return typeof code === 'string'
    && !!code
    && !DISABLED_PERMISSION_CODES.has(code);
}

function sanitizePermissionCodeList(codes) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : []).filter(code => isPermissionCodeEnabled(code))
  ));
}

const ADMIN_PAGE_EXTRA_PERMISSION_ITEMS = {
  'page-admin-users': [
    { code: 'admin.users.edit_profile', name: '編輯基本資料' },
    { code: 'admin.users.change_role', name: '修改用戶身分' },
    { code: 'admin.users.restrict', name: '限制 / 解除限制' },
  ],
  'page-my-activities': [
    { code: 'event.edit_all', name: '編輯所有活動' },
  ],
  'page-admin-teams': [
    { code: 'team.create', name: '建立俱樂部' },
    { code: 'team.manage_all', name: '管理所有俱樂部' },
  ],
  'page-admin-repair': [
    { code: 'admin.repair.team_join_repair', name: '歷史入隊補正' },
    { code: 'admin.repair.no_show_adjust', name: '放鴿子修改' },
    { code: 'admin.repair.data_sync', name: '系統資料同步' },
  ],
  'page-admin-logs': [
    { code: 'admin.logs.error_read', name: '錯誤日誌讀取' },
    { code: 'admin.logs.error_delete', name: '錯誤日誌清除' },
    { code: 'admin.logs.audit_read', name: '稽核日誌讀取' },
  ],
};

// ─── 身分不可剝奪權限（取得身分即自動擁有，不受 rolePermissions 覆蓋）───
// coach/captain/venue_owner 的活動管理與賽事為身分核心功能，不可拔除
// admin 以上的所有權限由 super_admin 在權限管理 UI 自由啟閉
const INHERENT_ROLE_PERMISSIONS = Object.freeze({
  coach:       ['activity.manage.entry', 'admin.tournaments.entry'],
  captain:     ['activity.manage.entry', 'admin.tournaments.entry'],
  venue_owner: ['activity.manage.entry', 'admin.tournaments.entry'],
});

function getInherentRolePermissions(roleKey) {
  return INHERENT_ROLE_PERMISSIONS[roleKey] || [];
}

function getAdminDrawerPermissionDefinitions() {
  return DRAWER_MENUS
    .filter(item => item && item.page && isPermissionCodeEnabled(item.permissionCode))
    .map(item => ({
      page: item.page,
      label: item.label,
      minRole: item.minRole || 'user',
      entryCode: item.permissionCode,
      items: [
        { code: item.permissionCode, name: '顯示入口' },
        ...(ADMIN_PAGE_EXTRA_PERMISSION_ITEMS[item.page] || []),
      ],
    }));
}

function getAdminDrawerPermissionCodes() {
  return getAdminDrawerPermissionDefinitions().map(item => item.entryCode);
}

function getAdminPagePermissionCode(pageId) {
  const def = getAdminDrawerPermissionDefinitions().find(item => item.page === pageId);
  return def ? def.entryCode : '';
}

function getMergedPermissionCatalog(remoteCategories = []) {
  const result = [];
  const assignedCodes = new Set();
  const builtInCategories = getAdminDrawerPermissionDefinitions().map(def => ({
    cat: def.label,
    items: def.items.map(item => ({ ...item })),
  }));

  builtInCategories.forEach(category => {
    category.items.forEach(item => assignedCodes.add(item.code));
    result.push(category);
  });

  (remoteCategories || []).forEach(category => {
    const items = Array.isArray(category?.items)
      ? category.items.filter(item =>
        item
        && isPermissionCodeEnabled(item.code)
        && !assignedCodes.has(item.code)
      )
      : [];
    if (!items.length) return;
    items.forEach(item => assignedCodes.add(item.code));
    const existingCategory = result.find(entry => entry.cat === category.cat);
    if (existingCategory) {
      existingCategory.items.push(...items.map(item => ({ ...item })));
      return;
    }
    result.push({
      ...category,
      items: items.map(item => ({ ...item })),
    });
  });

  return result;
}

function getAllPermissionCodes(remoteCategories = []) {
  return getMergedPermissionCatalog(remoteCategories)
    .flatMap(category => Array.isArray(category?.items) ? category.items : [])
    .map(item => item.code)
    .filter(code => isPermissionCodeEnabled(code));
}

function getDefaultRolePermissions(roleKey) {
  if (!BUILTIN_ROLE_KEYS.includes(roleKey)) return null;
  if (roleKey === 'user') return [];

  const roleLevel = getRuntimeRoleLevel(roleKey);
  const defaults = [];
  getAdminDrawerPermissionDefinitions().forEach(def => {
    if (roleLevel >= getRuntimeRoleLevel(def.minRole)) {
      defaults.push(def.entryCode);
    }
  });

  if (roleLevel >= getRuntimeRoleLevel('admin')) {
    defaults.push('team.create', 'team.manage_all', 'event.edit_all');
  }

  return Array.from(new Set(defaults));
}
