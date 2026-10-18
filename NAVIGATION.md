# ToosterX — 專案導航（NAVIGATION）

> 本檔只記錄可從 repo 查證的事實；路徑以 tracked 清單為準，責任推不出即標「責任待確認」。
> 規則只引用 Rule ID 或規則檔名，不重述條文；數量以 `rg --files` 等命令即時查。

## 1.1 這是什麼
- ToosterX 是運動活動報名與管理系統：活動、俱樂部、錦標賽、教育課程、QR 簽到、個人統計與管理後台。
- 技術棧：Vanilla ES6 無 bundler、Firestore、LINE LIFF + Firebase Auth、Cloud Functions v2、Service Worker。
- 本檔是 repo 地圖：東西在哪、誰負責、改了要看哪條規則；放 repo 根、tracked。
- 規則入口：`CLAUDE.md`（核心）、`.claude/rules/`（領域規則）、`AGENTS.md`／`GEMINI.md`（其他 AI 入口）。

## 1.2 啟動與入口
- 載入鏈：`index.html` inline boot（`var V` 版號、deep link 清理）→ `app.js` → `js/core/script-loader.js` 分群組載入 → `js/core/page-loader.js` 載入 `pages/*.html` fragments。
- `index.html` 的 `<script>` 順序（以 source 為準）：
- 基礎：`js/i18n.js`、`js/config.js`、`js/core/history-route-flags.js`、`js/core/history-route-adapter.js`
- 資料層：`js/firebase-config.js`、`js/firebase-service.js`、`js/firebase-crud.js`、`js/api-service.js`、`js/identity-resolver.js`、`js/line-auth.js`
- loader：`js/core/page-loader.js`、`js/core/script-loader.js`
- boot 後段：`js/core/navigation.js`、`js/core/theme.js`、`js/core/button-loading.js` 與 eager 模組（如 `js/modules/multi-tab-guard.js`），以 source 為準。
- 群組載入：`js/core/script-loader.js` 的 `_groups`／`_pageGroups` 定義群組與 pageId 對應；`ensureForPage` 依頁載入，detailCoreSplit 拆包與 manual-only 群組以 source 為準。
- LIFF／Auth：`js/line-auth.js` 負責 LIFF `init` 與 LINE profile；`js/firebase-config.js` 負責 Firebase client 設定；`js/firebase-service.js` 負責 Firestore／Auth 初始化與同步。
- Service Worker：`sw.js` 的分級策略與常數見 `.claude/rules/release-sw.md`，本檔不複製。

## 1.3 目錄責任表
- `index.html`、`app.js` — 主入口與 App 核心
- `js/` — 前端腳本（根層、core、modules）
- `js/core/` — navigation、loader、history、theme 基礎設施
- `js/modules/` — 功能模組；同功能放對應子資料夾
- `pages/` — 動態載入 HTML fragments
- `css/` — 主題與元件樣式
- `functions/` — Cloud Functions
- `firestore.rules` — Firestore 存取邊界
- `tests/` — unit、Rules、E2E、contract tests
- `scripts/` — 可追蹤維護／驗證腳本
- `.github/` — CI 與 automation
- `docs/`、`tools/` — local-only（可能不存在於其他機器）
- `assets/` — 靜態素材
- `img/` — 圖片與遊戲 sprites
- `LOGO/` — 品牌標誌素材
- `PWA/` — PWA 圖示素材
- `blog/` — SEO 文章頁
- `seo/` — SEO 落地頁
- `permissions/` — 權限說明獨立頁
- `roles/` — 角色說明獨立頁
- `inventory/` — 進銷存獨立 App
- `valuation/` — 估值獨立頁
- `changelog/` — 更新日誌頁
- `manual.html` — 使用手冊獨立頁
- `privacy.html` — 隱私權政策獨立頁
- `terms.html` — 服務條款獨立頁
- `game-lab.html` — 射擊遊戲實驗獨立頁
- `GrowthGames.html` — Growth Games 獨立頁
- `ops-report.html` — 營運報表獨立頁
- `404.html` — 找不到頁面與 SPA fallback

## 1.4 `js/` 根層檔案
- `js/config.js` — 快取版號、權限定義與效能旗標
- `js/firebase-config.js` — Firebase 公開 client 設定
- `js/firebase-service.js` — Firestore 讀寫與即時監聽（含鎖定 symbols，見 `.claude/rules/events-registration-stats.md`）
- `js/firebase-crud.js` — 報名與活動寫入核心（含鎖定 symbols，見 `.claude/rules/events-registration-stats.md`）
- `js/api-service.js` — ApiService 資料存取層（含鎖定 symbols，見 `.claude/rules/events-registration-stats.md`）
- `js/identity-resolver.js` — 主／次身分解析與設定
- `js/i18n.js` — 語系切換與翻譯
- `js/line-auth.js` — LIFF 初始化與 LINE profile

## 1.5 `js/core/`
- `js/core/navigation.js` — `showPage`、路由與頁面切換核心
- `js/core/page-loader.js` — fragment 載入與 boot 預取
- `js/core/script-loader.js` — 群組式 JS 動態載入器
- `js/core/history-route-adapter.js` — History route 解析純函式
- `js/core/history-route-flags.js` — History route rollout 旗標
- `js/core/theme.js` — 主題、字級與 tab 綁定
- `js/core/button-loading.js` — 按鈕 loading 包裝

## 1.6 `js/modules/` 索引
完整清單以 `rg --files js/modules` 即時查。責任依檔頭註解、`App` 掛載函式、page id 與 `js/core/script-loader.js` 群組推斷；推不出者標「責任待確認」並列於 local-only 的 `docs/navigation-notes.md`。同域檔案以責任群組列出（一行多檔），逐檔全列以 `rg --files` 即時查。
**子資料夾**
**`js/modules/achievement/`** — 成就系統拆件；`achievement` 群組。
`js/modules/achievement/index.js`、`js/modules/achievement/registry.js`、`js/modules/achievement/shared.js`、`js/modules/achievement/evaluator.js` — 模組註冊、註冊表與條件評估
`js/modules/achievement/stats.js`、`js/modules/achievement/badges.js`、`js/modules/achievement/titles.js` — 統計、徽章與稱號
`js/modules/achievement/profile.js`、`js/modules/achievement/view.js`、`js/modules/achievement/admin.js`、`js/modules/achievement/batch.js` — 個人／檢視／後台區塊與批次重算
`js/modules/achievement/achievement.js` — 成就管理入口與後台表單（legacy facade，內部轉接到同資料夾拆件）
**`js/modules/ad-manage/`** — 廣告版位的前台顯示與後台管理；後台 CRUD 在 `adminContent` 群組，前台顯示由 `index.html` eager 載入。
`js/modules/ad-manage/banner.js`、`js/modules/ad-manage/popup-ad.js` — 前台 Banner 輪播／浮動廣告與彈窗廣告顯示（`index.html` eager）
`js/modules/ad-manage/ad-manage-core.js`、`js/modules/ad-manage/ad-manage-banner.js`、`js/modules/ad-manage/ad-manage-float.js` — 廣告核心、Banner 與浮動廣告
`js/modules/ad-manage/ad-manage-popup-sponsor.js`、`js/modules/ad-manage/ad-manage-shotgame.js`、`js/modules/ad-manage/boot-brand-manage.js` — 彈窗贊助、遊戲廣告與開機品牌圖
**`js/modules/admin-seo/`** — SEO 後台儀表板；`adminSeo` 群組。
`js/modules/admin-seo/seo-data-loader.js`、`js/modules/admin-seo/seo-dashboard.js` — SEO 快照載入與儀表板
**`js/modules/auto-exp/`** — 自動經驗值規則與發放。
`js/modules/auto-exp/index.js`、`js/modules/auto-exp/rules.js` — 規則管理、發放與對帳
**`js/modules/color-cat/`** — ColorCat 養成小遊戲場景與角色。
`js/modules/color-cat/color-cat-config.js`、`js/modules/color-cat/color-cat-mbti.js`、`js/modules/color-cat/color-cat-stats.js`、`js/modules/color-cat/color-cat-sprite.js` — 設定、人格、數值與精靈圖
`js/modules/color-cat/color-cat-profile.js`、`js/modules/color-cat/color-cat-naming.js`、`js/modules/color-cat/color-cat-cloud-save.js`、`js/modules/color-cat/color-cat-ball.js` — 角色檔案、命名、存檔與球
`js/modules/color-cat/color-cat-damage-number.js`、`js/modules/color-cat/color-cat-character.js`、`js/modules/color-cat/color-cat-character-stamina.js`、`js/modules/color-cat/color-cat-character-particles.js` — 飄字、角色狀態與粒子
`js/modules/color-cat/color-cat-character-actions.js`、`js/modules/color-cat/color-cat-character-actions-interact.js`、`js/modules/color-cat/color-cat-character-actions-special.js`、`js/modules/color-cat/color-cat-character-combo.js`、`js/modules/color-cat/color-cat-character-bubble.js` — 角色動作、互動與連段
`js/modules/color-cat/color-cat-character-combat.js`、`js/modules/color-cat/color-cat-enemy.js`、`js/modules/color-cat/color-cat-enemy-util.js` — 受傷戰鬥與敵人工具
`js/modules/color-cat/color-cat-enemy-draw.js`、`js/modules/color-cat/color-cat-enemy-projectile.js` — 敵人繪製與投射物
`js/modules/color-cat/color-cat-scene.js`、`js/modules/color-cat/color-cat-scene-bg.js`、`js/modules/color-cat/color-cat-scene-grass.js`、`js/modules/color-cat/color-cat-scene-flower.js` — 場景主迴圈與自然元素
`js/modules/color-cat/color-cat-scene-fog.js`、`js/modules/color-cat/color-cat-scene-weather.js`、`js/modules/color-cat/color-cat-scene-box.js`、`js/modules/color-cat/color-cat-scene-grave.js` — 霧、天氣、紙箱與墓地
`js/modules/color-cat/color-cat-scene-panel.js`、`js/modules/color-cat/color-cat-scene-panel-tab0.js`、`js/modules/color-cat/color-cat-scene-panel-tab1.js`、`js/modules/color-cat/color-cat-scene-panel-tab2.js` — 養成面板與分頁
`js/modules/color-cat/color-cat-scene-panel-modal.js`、`js/modules/color-cat/color-cat-scene-signpost-modal.js`、`js/modules/color-cat/color-cat-scene-stats-modal.js` — 面板、指標牌與統計彈窗
`js/modules/color-cat/dialogue/color-cat-dialogue-data.js`、`js/modules/color-cat/dialogue/color-cat-dialogue-mbti-analysts.js`、`js/modules/color-cat/dialogue/color-cat-dialogue-mbti-diplomats.js`、`js/modules/color-cat/dialogue/color-cat-dialogue-mbti-explorers.js`、`js/modules/color-cat/dialogue/color-cat-dialogue-mbti-sentinels.js` — MBTI 對話資料
`js/modules/color-cat/color-cat-scene-flag.js`、`js/modules/color-cat/color-cat-scene-butterfly.js`、`js/modules/color-cat/color-cat-character-ai.js` — 責任待確認
**`js/modules/dashboard/`** — 營運儀表板與下鑽；`adminDashboard` 群組。
`js/modules/dashboard/dashboard.js`、`js/modules/dashboard/dashboard-widgets.js`、`js/modules/dashboard/dashboard-snapshot.js` — 總覽、圖表與快照
`js/modules/dashboard/dashboard-data-fetcher.js`、`js/modules/dashboard/dashboard-usage.js`、`js/modules/dashboard/dashboard-ci-usage.js` — 資料抓取與用量
`js/modules/dashboard/dashboard-drilldown-core.js`、`js/modules/dashboard/dashboard-drilldown-users.js`、`js/modules/dashboard/dashboard-drilldown-events.js`、`js/modules/dashboard/dashboard-drilldown-teams.js`、`js/modules/dashboard/dashboard-drilldown-tourns.js` — 下鑽彈窗與各域明細
`js/modules/dashboard/dashboard-drilldown-open.js`、`js/modules/dashboard/dashboard-drilldown-ended.js`、`js/modules/dashboard/dashboard-drilldown-records.js`、`js/modules/dashboard/dashboard-drilldown-attend.js` — 場次與名單下鑽
`js/modules/dashboard/dashboard-participant-query.js`、`js/modules/dashboard/dashboard-participant-share.js`、`js/modules/dashboard/dashboard-progress-modal.js`、`js/modules/dashboard/dashboard-info-modal.js`、`js/modules/dashboard/personal-dashboard.js` — 參與者查詢、彈窗與個人儀表板
**`js/modules/education/`** — 教育課程、學員與簽到；`education` 群組。
`js/modules/education/edu-helpers.js`、`js/modules/education/edu-group-list.js`、`js/modules/education/edu-group-form.js` — 共用工具與分組管理
`js/modules/education/edu-student-list.js`、`js/modules/education/edu-student-form.js`、`js/modules/education/edu-student-join.js` — 學員名單、表單與加入審核
`js/modules/education/edu-parent-binding.js`、`js/modules/education/edu-notify.js`、`js/modules/education/edu-detail-realtime.js` — 家長綁定、通知與即時監聽
`js/modules/education/edu-course-plan.js`、`js/modules/education/edu-course-plan-form-v2.js`、`js/modules/education/edu-course-plan-render.js` — 課程方案與表單渲染
`js/modules/education/edu-course-ui-adapter.js`、`js/modules/education/edu-course-plan-attendance.js`、`js/modules/education/edu-course-enrollment.js`、`js/modules/education/edu-course-enrollment-render.js` — 方案 UI、出席與選課（含鎖定 symbols）
`js/modules/education/edu-course-session.js`、`js/modules/education/edu-course-session-form.js`、`js/modules/education/edu-course-lessons.js` — 課次與課表管理
`js/modules/education/edu-course-lessons-render.js`、`js/modules/education/edu-course-lesson-reschedule.js`、`js/modules/education/edu-course-lesson-share.js` — 課表渲染、調課與分享
`js/modules/education/edu-checkin.js`、`js/modules/education/edu-checkin-scan.js`、`js/modules/education/edu-calendar-core.js`、`js/modules/education/edu-calendar-monthly.js`、`js/modules/education/edu-calendar-stamp.js` — 簽到與出席月曆
`js/modules/education/edu-detail-render.js`、`js/modules/education/edu-detail-withdraw.js` — 詳情渲染與退出
**`js/modules/event/`** — 活動列表、詳情、建立與管理；`activity` 群組。
`js/modules/event/event-list.js`、`js/modules/event/event-list-helpers.js`、`js/modules/event/event-list-stats.js`、`js/modules/event/event-list-home.js` — 列表入口、權限 helper、統計與首頁卡
`js/modules/event/event-list-timeline.js`、`js/modules/event/event-list-female-theme.js`、`js/modules/event/event-list-calendar.js`、`js/modules/event/event-list-calendar-build.js` — 時間軸、主題與月曆建構
`js/modules/event/event-list-calendar-nav.js`、`js/modules/event/event-calendar-constants.js`、`js/modules/event/event-map.js` — 月曆導覽、運動色票與地圖檢視
`js/modules/event/event-detail.js`、`js/modules/event/event-detail-calendar.js`、`js/modules/event/event-detail-notify-prompt.js` — 詳情主渲染、行事曆與推播引導
`js/modules/event/event-detail-signup.js`、`js/modules/event/event-detail-companion.js` — 報名與同行者（含鎖定 symbols）
`js/modules/event/event-create.js`、`js/modules/event/event-create-view-model.js`、`js/modules/event/event-create-options.js` — 建立表單與欄位選項
`js/modules/event/event-create-input-history.js`、`js/modules/event/event-create-sport-picker.js`、`js/modules/event/event-create-team-picker.js`、`js/modules/event/event-create-delegates.js` — 輸入歷史與選取器
`js/modules/event/event-create-external.js`、`js/modules/event/event-create-template.js`、`js/modules/event/event-create-multidate.js`、`js/modules/event/event-create-waitlist.js` — 外部活動、範本、多日期與候補
`js/modules/event/event-manage.js`、`js/modules/event/event-manage-lifecycle.js`、`js/modules/event/event-manage-instant-save.js`、`js/modules/event/event-manage-confirm.js` — 管理、生命週期、即時存檔與簽到確認
`js/modules/event/event-manage-attendance.js`、`js/modules/event/event-manage-noshow.js`、`js/modules/event/event-manage-badges.js`、`js/modules/event/event-manage-waitlist.js`、`js/modules/event/event-manage-visibility.js` — 名單、放鴿子、徽章與候補
`js/modules/event/event-share.js`、`js/modules/event/event-share-builders.js`、`js/modules/event/event-team-split.js` — 分享、訊息建構與分隊
`js/modules/event/event-blocklist.js`、`js/modules/event/event-external-transit.js`、`js/modules/event/event-host-list.js` — 黑名單守衛、外部轉站與主辦排行
`js/modules/event/event-comments.js`、`js/modules/event/event-comments-actions.js` — 留言串與留言操作
`js/modules/event/event-location-draft.js`、`js/modules/event/event-location-picker.js` — 地點草稿與選點器
`js/modules/event/event-map-geo.js` — 責任待確認
**`js/modules/kickball/`** — Kickball 小遊戲；`kickball` 群組。
`js/modules/kickball/kickball-game-page.js`、`js/modules/kickball/kickball-ui.js`、`js/modules/kickball/kickball-leaderboard.js` — 遊戲頁、UI 與排行榜
`js/modules/kickball/kickball-physics.js`、`js/modules/kickball/kickball-renderer.js` — 物理與繪圖；`js/modules/kickball/kickball-helpers.js` 責任待確認
**`js/modules/message/`** — 訊息、私訊與推播；`message` 群組。
`js/modules/message/message-render.js`、`js/modules/message/message-inbox.js`、`js/modules/message/message-actions.js`、`js/modules/message/message-actions-team.js` — 訊息渲染、收件匣與操作
`js/modules/message/message-notify.js`、`js/modules/message/message-line-push.js`、`js/modules/message/notif-settings.js` — 通知模板、LINE 推播與開關
`js/modules/message/message-admin.js`、`js/modules/message/message-admin-list.js`、`js/modules/message/message-admin-compose.js` — 後台訊息管理
`js/modules/message/pm-entry.js`、`js/modules/message/pm-permission.js`、`js/modules/message/pm-listener.js`、`js/modules/message/pm-dialog.js`、`js/modules/message/pm-dialog-actions.js`、`js/modules/message/pm-dialog-search.js`、`js/modules/message/pm-audit.js` — 私訊系統與稽核
**`js/modules/profile/`** — 個人頁、名片與分享；`profile` 群組。
`js/modules/profile/profile-core.js`、`js/modules/profile/profile-avatar.js`、`js/modules/profile/profile-card.js` — 核心、頭像與名片
`js/modules/profile/profile-form.js`、`js/modules/profile/profile-data.js`、`js/modules/profile/profile-data-render.js` — 登入表單與資料渲染
`js/modules/profile/profile-data-stats.js`、`js/modules/profile/profile-data-history.js`、`js/modules/profile/profile-share.js` — 稱號統計、歷程與分享
**`js/modules/scan/`** — QR 簽到；`scan` 群組。
`js/modules/scan/scan.js`、`js/modules/scan/scan-ui.js`、`js/modules/scan/scan-camera.js` — 簽到頁、篩選 UI 與相機
`js/modules/scan/scan-process.js`、`js/modules/scan/scan-family.js` — 簽到處理與家庭代簽
**`js/modules/shot-game/`** — 射擊小遊戲；`game` 群組。
`js/modules/shot-game/shot-game-page.js`、`js/modules/shot-game/shot-page-ui.js` — 遊戲頁初始化與 HUD
`js/modules/shot-game/shot-game-engine.js`、`js/modules/shot-game/shot-game-loop.js`、`js/modules/shot-game/shot-physics.js`、`js/modules/shot-game/shot-renderer.js`、`js/modules/shot-game/shot-scoring.js` — 引擎、迴圈、物理、繪圖與計分
`js/modules/shot-game/shot-game-lab-page.js`、`js/modules/shot-game/shot-lab-controls.js`、`js/modules/shot-game/shot-lab-ui.js` — 責任待確認
**`js/modules/team/`** — 俱樂部列表、詳情與表單；`team` 群組。
`js/modules/team/team-list.js`、`js/modules/team/team-list-helpers.js`、`js/modules/team/team-list-stats.js`、`js/modules/team/team-list-render.js` — 列表、權限 helper 與卡片渲染
`js/modules/team/team-detail.js`、`js/modules/team/team-detail-render.js`、`js/modules/team/team-detail-invite.js` — 詳情、成員表與邀請
`js/modules/team/team-detail-v2-render.js`、`js/modules/team/team-detail-v2-panels.js`、`js/modules/team/team-detail-v2-lists.js`、`js/modules/team/team-detail-v2-actions.js` — v2 版面、面板與操作
`js/modules/team/team-form.js`、`js/modules/team/team-form-init.js`、`js/modules/team/team-form-validate.js`、`js/modules/team/team-form-search.js` — 建立／編輯表單與幹部搜尋
`js/modules/team/team-form-roles.js`、`js/modules/team/team-form-join.js`、`js/modules/team/team-contact-links.js`、`js/modules/team/team-share.js`、`js/modules/team/team-share-builders.js` — 角色異動、加入與分享
**`js/modules/tournament/`** — 賽事與友誼賽；`tournament` 群組。
`js/modules/tournament/tournament-core.js`、`js/modules/tournament/tournament-helpers.js`、`js/modules/tournament/tournament-render.js` — 核心常數、權限 helper 與列表
`js/modules/tournament/tournament-detail.js`、`js/modules/tournament/tournament-detail-competition.js`、`js/modules/tournament/tournament-competition.js` — 詳情與競賽視圖
`js/modules/tournament/tournament-match-data.js`、`js/modules/tournament/tournament-match-record.js`、`js/modules/tournament/tournament-schedule-manage.js` — match 資料、紀錄與賽程管理
`js/modules/tournament/tournament-manage.js`、`js/modules/tournament/tournament-manage-form.js`、`js/modules/tournament/tournament-manage-edit.js`、`js/modules/tournament/tournament-manage-host.js` — 管理與表單
`js/modules/tournament/tournament-manage-host-selection.js`、`js/modules/tournament/tournament-manage-people.js`、`js/modules/tournament/tournament-share.js`、`js/modules/tournament/tournament-share-builders.js` — 主辦選取、人員與分享
`js/modules/tournament/tournament-friendly-detail.js`、`js/modules/tournament/tournament-friendly-detail-view.js`、`js/modules/tournament/tournament-friendly-state.js`、`js/modules/tournament/tournament-friendly-apply-state.js` — 友誼賽詳情與狀態
`js/modules/tournament/tournament-friendly-roster.js`、`js/modules/tournament/tournament-friendly-withdraw.js`、`js/modules/tournament/tournament-friendly-notify.js` — 友誼賽名單、退出與通知
`js/modules/tournament/README.md` — 賽事模組說明文件
**`js/modules/user-admin/`** — 用戶後台與權限稽核；`adminUsers` 群組。
`js/modules/user-admin/user-admin-list.js`、`js/modules/user-admin/user-admin-roles.js`、`js/modules/user-admin/user-admin-perm-info.js` — 用戶列表、角色權限與權限說明
`js/modules/user-admin/user-admin-exp.js`、`js/modules/user-admin/user-admin-user-grants.js`、`js/modules/user-admin/user-admin-event-blocklist.js` — 經驗值、個別授權與黑名單
`js/modules/user-admin/user-admin-uid-health.js`、`js/modules/user-admin/user-admin-uid-health-copy.js`、`js/modules/user-admin/user-admin-corrections.js` — UID 健康與補正
`js/modules/user-admin/permission-audit/permission-audit.js`、`js/modules/user-admin/permission-audit/permission-audit-render.js` — 權限稽核與渲染
**根層散檔**（以 `ls -p js/modules | grep -v /` 即時查）
- `js/modules/admin-log-tabs.js` — 後台日誌中心分頁與工具列
- `js/modules/announcement.js` — 公告顯示與管理
- `js/modules/attendance-notify.js` — 出席通知監聽與彈窗
- `js/modules/audit-log.js` — 操作稽核日誌查詢
- `js/modules/auto-exp-rules.js` — 舊路徑 shim，轉載新模組
- `js/modules/auto-exp.js` — 舊路徑 shim，轉載新模組
- `js/modules/data-sync.js` — 後台資料同步與修復工具
- `js/modules/error-log-diagnostics.js` — 錯誤日誌欄位解析
- `js/modules/error-log-insights.js` — 錯誤日誌分群與趨勢
- `js/modules/error-log.js` — 錯誤日誌與提示紀錄檢視
- `js/modules/favorites.js` — 收藏活動與賽事
- `js/modules/game-log-viewer.js` — 遊戲紀錄檢視與匯出
- `js/modules/game-manage.js` — 首頁遊戲項目管理
- `js/modules/home-dashboard.js` — 首頁版面與入口渲染
- `js/modules/home-game-rank-preview.js` — 首頁遊戲排行預覽
- `js/modules/home-next-activity.js` — 首頁下一個活動卡
- `js/modules/image-cropper.js` — 圖片裁切工具
- `js/modules/image-upload.js` — 圖片上傳與變體裁切
- `js/modules/leaderboard.js` — 排行榜與出席紀錄（含鎖定 symbols）
- `js/modules/multi-tab-guard.js` — 多分頁重複開啟警告
- `js/modules/news.js` — 新聞卡片與分頁
- `js/modules/persistent-storage.js` — 責任待確認
- `js/modules/pwa-install.js` — PWA 安裝引導
- `js/modules/registration-audit.js` — 報名狀態稽核與修復
- `js/modules/role.js` — 角色權限判斷與側邊選單
- `js/modules/shop.js` — 商城瀏覽與管理
- `js/modules/site-theme.js` — 站台主題管理
- `js/modules/sync-status.js` — 同步狀態列
- `js/modules/translate.js` — 頁面翻譯與語系
**可能的歸類建議**：根層散檔的歸類建議表見 local-only 的 `docs/navigation-notes.md`；搬移屬 runtime 變更，需另開任務並 bump 版號，本檔只建議不執行。

## 1.7 `pages/` ↔ 模組對應
- `pages/activity.html` — `page-activities`、`page-activity-detail`、`page-my-activities` → `js/modules/event/`
- `pages/home.html` — `page-home` → `js/modules/home-dashboard.js`、`js/modules/ad-manage/banner.js`、`js/modules/event/event-list-home.js`
- `pages/team.html` — `page-teams`、`page-team-detail`、`page-team-manage` → `js/modules/team/`
- `pages/tournament.html` — `page-tournaments`、`page-tournament-detail` → `js/modules/tournament/`
- `pages/profile.html` — `page-profile`、`page-qrcode` → `js/modules/profile/`
- `pages/education.html` — `page-edu-groups`、`page-edu-students`、`page-edu-course-plan` → `js/modules/education/`
- `pages/message.html` — `page-messages` → `js/modules/message/`
- `pages/scan.html` — `page-scan` → `js/modules/scan/`
- `pages/shop.html` — `page-shop`、`page-shop-detail`、`page-leaderboard` → `js/modules/shop.js`、`js/modules/leaderboard.js`
- `pages/game.html` — `page-game` → `js/modules/shot-game/`
- `pages/kickball.html` — `page-kick-game` → `js/modules/kickball/`
- `pages/personal-dashboard.html` — `page-personal-dashboard` → `js/modules/dashboard/personal-dashboard.js`
- `pages/admin-dashboard.html` — `page-admin-dashboard`、`page-temp-participant-report` → `js/modules/dashboard/`
- `pages/admin-users.html` — `page-admin-users`、`page-admin-exp` → `js/modules/user-admin/`
- `pages/admin-content.html` — `page-admin-banners`、`page-admin-shop`、`page-admin-messages` → `js/modules/ad-manage/`、`js/modules/shop.js`、`js/modules/message/`
- `pages/admin-system.html` — `page-admin-achievements`、`page-admin-games`、`page-admin-themes` → `js/modules/achievement/achievement.js`、`js/modules/game-manage.js`；`page-admin-themes` 對應待確認
- `pages/admin-seo.html` — `page-admin-seo` → `js/modules/admin-seo/`
- `pages/admin-auto-exp.html` — `page-admin-auto-exp` → `js/modules/auto-exp/`
- `pages/admin-notif.html` — `page-admin-notif` → 對應待確認（無 `_pageGroups` 群組）
- `pages/modals.html` — 無 page id → 共用彈窗 fragments；對應待確認

## 1.8 `css/`
- `css/base.css` — 設計 token 來源（R-UI-005）
- `css/profile.css` — user-capsule palette 來源（R-UI-021）
- `css/layout.css` — 版面骨架
- `css/home.css` — 首頁
- `css/activity.css` — 活動頁
- `css/calendar.css` — 活動月曆
- `css/calendar-sport-counts.css` — 月曆運動數量徽章
- `css/team.css` — 俱樂部頁
- `css/team-detail-v2.css` — 俱樂部詳情 v2
- `css/tournament.css` — 賽事頁
- `css/education.css` — 教育區塊
- `css/message.css` — 訊息頁
- `css/scan.css` — 簽到頁
- `css/shop.css` — 商城頁
- `css/game.css` — 遊戲頁
- `css/admin.css` — 後台頁
- `css/admin-seo.css` — SEO 後台
- `css/permission-audit.css` — 權限稽核頁
- `css/image-cropper.css` — 圖片裁切工具

## 1.9 `functions/`
- `functions/index.js` — Functions 主入口與 callable exports（含鎖定 symbols）
- `functions/edu-course-enrollment-core.js` — 課程選課決策核心（含鎖定 symbols）
- `functions/user-attendance-stats.js`、`functions/user-attendance-stats-core.js` — 用戶出席統計
- `functions/backfill-user-attendance-stats.js` — 出席統計回填
- `functions/event-view-count.js` — 活動瀏覽計數
- `functions/user-directory.js` — 用戶目錄查詢
- `functions/team-role-promotion.js` — 俱樂部角色自動升級
- `functions/scoreboard-translations.js` — 記分板翻譯（參照 local-only 文件，見 R-DOC-006）
- `functions/scoreboard-sportsapipro.js`、`functions/scoreboard-sportsapipro-utils.js` — SportsAPI 比分整合
- `functions/ops-ltv-report.js` — 營運 LTV 報表
- `functions/package.json`、`functions/package-lock.json`、`functions/.env.example` — 專案設定與環境範本

## 1.10 Firestore
- `firestore.rules` — Firestore 存取邊界（R-DATA-001～005）
- `storage.rules` — Storage 存取邊界
- `firestore.indexes.json` — 查詢索引定義
- `firebase.json` — 專案與 emulator 設定
- 主要集合名稱：events、users、registrations、teams、tournaments、attendanceRecords、activityRecords、messages、inbox、siteConfig 等（以 `rg "collection\\(" -o` 即時查）；子集合 canonical 路徑見 R-REG-014。

## 1.11 `tests/`
- `tests/unit/` — Jest 單元測試
- `tests/firestore-rules/` — Rules emulator 測試 suites
- `tests/e2e/` — Playwright E2E 與靜態伺服器
- `tests/fixtures/` — 測試共用 fixtures
- `tests/archive/` — 歷史 Rules 測試封存
- 測試指令表見 `CLAUDE.md` §7 與 `package.json` scripts，本檔不複製。
- 已知 drift：`tests/firestore-rules/tournament-match-rules.test.js` 未被 aggregate 收錄（R-QA-008）。

## 1.12 `scripts/`
- `scripts/bump-version.js` — 唯一允許的版號工具（R-REL-002）
- `scripts/check-registration-ops-guard.js` — 報名鎖定 guard 檢查
- `scripts/build-sitemap.js` — 產生動態 sitemap
- `scripts/submit-sitemap.js` — 提交 sitemap 給 Google
- `scripts/gsc-snapshot.js` — GSC 資料快照
- `scripts/verify-gsc-read.js` — 驗證 GSC 讀取權限
- `scripts/inject-hot-events.js` — 注入首頁熱門活動摘要
- `scripts/sync-changelog.js` — 同步更新日誌到 Firestore
- `scripts/sync-inline-runtime.js` — 同步 inline runtime
- `scripts/snapshot-ci-usage.js` — CI 用量快照
- `scripts/achievement-phase1-7-final-smoke.js` — 成就里程碑 smoke
- `scripts/backfill-approved-edu-student-memberships.js` — 回填已核准學員 membership
- `scripts/backfill-region.js` — 回填活動地區
- `scripts/migrate-team-uids.js` — 遷移俱樂部 UID
- `scripts/migration-verify.js` — 遷移驗證
- `scripts/migration-baseline.json`、`scripts/SETUP-GSC-API.md` — 遷移基線與 GSC 設定說明

## 1.13 `.github/`
- `.github/workflows/test.yml` — push／PR 觸發；跑測試套件
- `.github/workflows/deploy-functions.yml` — push／手動；部署 Functions（gated，R-CF-008）
- `.github/workflows/build-sitemap.yml` — 排程／手動；重建動態 sitemap
- `.github/workflows/submit-sitemap.yml` — push；提交 sitemap
- `.github/workflows/gsc-snapshot.yml` — 排程／push／手動；GSC 每日快照
- `.github/workflows/verify-gsc-read.yml` — 手動；驗證 GSC 讀取權限
- `.github/workflows/inject-hot-events.yml` — 排程／手動；注入首頁熱門活動
- `.github/workflows/lighthouse.yml` — 排程／手動；Lighthouse 效能檢測
- `.github/workflows/ci-usage-snapshot.yml` — 排程／手動；CI 用量快照
- `.github/workflows/sync-changelog.yml` — push；同步 changelog 到 Firestore
- 說明文件：`.github/functions-deploy-runbook.md`、`.github/workflow-inventory.md`

## 1.14 規則檔索引
`paths` 與各規則檔的 frontmatter 一致，以規則檔為準；`.claude/rules/`、`GEMINI.md`、`NAVIGATION.md` 為 2026-10-18 拆分時新建。
| 規則檔 | 管哪些路徑（`paths`） | 主要 Rule ID 區間 |
|---|---|---|
| `CLAUDE.md` | 核心章節（每次 session 必讀） | R-GOV-001～006、R-GOV-010～015、R-MODE-001～004、R-CTX-001～006、R-SAFE-001～015、R-EXEC-001～016、R-CODE-001～005、R-ENC-001～007、R-DOC-001～006、R-SHIP-001～019、R-LOG-001～005、R-COM-001～005 |
| `.claude/rules/architecture-tunables.md` | `js/**`、`css/**`、`pages/**`、`index.html`、`app.js`、`sw.js`、`functions/**` | R-ARCH-001～005、R-TUNE-001～002 |
| `.claude/rules/release-sw.md` | `sw.js`、`app.js`、`js/**`、`css/**`、`pages/**`、`index.html`、`scripts/bump-version.js`、`_worker.js`、`_routes.json`、`_headers`、`404.html`、`manual.html`、`privacy.html`、`terms.html`、`game-lab.html`、`GrowthGames.html`、`permissions/**`、`roles/**`、`blog/**`、`seo/**`、`inventory/**` | R-REL-001～017 |
| `.claude/rules/testing-review.md` | `js/**`、`css/**`、`pages/**`、`functions/**`、`tests/**`、`firestore.rules`、`storage.rules`、`sw.js`、`app.js`、`_worker.js`、`index.html`、`*.html`、`permissions/**`、`roles/**`、`blog/**`、`seo/**`、`inventory/**`、`package.json`、`playwright.config.js`、`.github/workflows/**` | R-QA-001～013、R-REVIEW-001～006、R-REVIEW-010～014 |
| `.claude/rules/id-permissions.md` | `js/**`、`functions/**`、`firestore.rules`、`pages/**`、`index.html`、`app.js`、`scripts/**`、`tests/firestore-rules/**`、`tests/unit/**` | R-ID-001～011、R-IAM-001～013、R-CAP-001～010 |
| `.claude/rules/events-registration-stats.md` | `js/firebase-crud.js`、`js/firebase-service.js`、`js/api-service.js`、`js/config.js`、`js/modules/event/**`、`js/modules/education/**`、`js/modules/achievement/**`、`js/modules/user-admin/**`、`js/modules/scan/**`、`js/modules/dashboard/**`、`js/modules/leaderboard.js`、`js/modules/home-next-activity.js`、`js/modules/favorites.js`、`functions/**`、`firestore.rules`、`tests/unit/**`、`tests/firestore-rules/**` | R-EVT-001～005、R-EVT-010～019、R-REG-001～016、R-STAT-000～006 |
| `.claude/rules/firestore-functions.md` | `firestore.rules`、`storage.rules`、`firebase.json`、`firestore.indexes.json`、`functions/**`、`js/**`、`package.json`、`tests/firestore-rules/**`、`tests/unit/cloud-functions.test.js`、`.github/workflows/**` | R-DATA-001～005、R-CF-001～012 |
| `.claude/rules/navigation-history.md` | `app.js`、`index.html`、`js/core/**`、`js/modules/**`、`_worker.js`、`_routes.json`、`404.html`、`tests/unit/*route*.test.js`、`tests/unit/*popstate*.test.js`、`tests/unit/*history*.test.js` | R-NAV-001～008、R-NAV-011～020 |
| `.claude/rules/share.md` | `js/modules/**/*share*.js`、`js/modules/education/edu-course-plan-render.js`、`js/modules/profile/**`、`js/modules/scan/**`、`js/modules/dashboard/**`、`js/config.js`、`functions/index.js`、`_worker.js`、`index.html`、`tests/unit/*share*.test.js` | R-SHARE-001～013 |
| `.claude/rules/ui.md` | `css/**`、`pages/**`、`js/modules/**`、`js/core/**`、`app.js`、`index.html`、`*.html`、`permissions/**`、`roles/**`、`blog/**`、`seo/**`、`inventory/**` | R-UI-001～006、R-UI-010～014、R-UI-020～025 |
| `.claude/rules/seo.md` | `seo/**`、`sitemap*.xml`、`robots.txt`、`_headers`、`_worker.js`、`blog/**`、`index.html`、`*.html`、`permissions/**`、`roles/**`、`functions/index.js`、`scripts/build-sitemap.js`、`scripts/submit-sitemap.js`、`scripts/gsc-snapshot.js`、`scripts/verify-gsc-read.js`、`scripts/inject-hot-events.js`、`.github/workflows/**` | R-SEO-001～004 |
| `.claude/rules/governance-migration.md` | `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`NAVIGATION.md`、`.claude/rules/**` | §17 遷移表；無自有 Rule ID |

## 1.15 Local-only 區（docs／tools）
- `docs/`、`tools/` 為 local-only，不進 Git（R-DOC-001）；以下路徑都可能不存在於其他機器。
- `docs/claude-memory.md` — 修復記憶（R-LOG-001）；`docs/architecture.md` — 模組說明與 Mermaid（R-ARCH-004）。
- `docs/tunables.md` — tunables 同步（R-TUNE-001）；`docs/seo-log.md` — SEO 記錄（R-SEO-001）；`docs/worktrees.md` — worktree 說明。
- tracked runtime／CI 不得依賴 local-only 文件（R-DOC-006）。

## 1.16 如何更新本檔
- 新增／搬移／刪除檔案時，同步更新對應小節；「責任待確認」清單在 local-only 的 `docs/navigation-notes.md`。
- commit 前跑 `node scripts/check-rules-integrity.js --nav` 並確認通過。
- 不寫檔案數、行數、版本號等會漂移的數字；需要量時以 `rg --files` 等命令即時查。
