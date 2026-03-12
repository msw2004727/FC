# 成就系統 Phase 0 盤點

## 1. 盤點目標
本文件是 [achievement-folder-refactor-plan.md](achievement-folder-refactor-plan.md) 的 `Phase 0` 交付物，用來回答三件事：

1. 目前成就 / 徽章 / 稱號系統的真實入口在哪裡
2. 哪些責任混在一起，必須先切開
3. 第一批資料夾化時，哪些函式要保留在舊入口，哪些可以先抽走

## 2. 目前入口與觸發點

### 2.1 頁面入口
- `page-achievements` → `App.renderAchievements()`
- `page-admin-achievements` → `App.renderAdminAchievements()`
- `page-titles` → `App.renderTitlePage()`
- `page-profile` → `App.renderProfileData()` + `App.renderUserCard()`

### 2.2 業務事件觸發
- 活動報名 / 取消報名流程會呼叫 `App._evaluateAchievements(eventType)`
- 球隊訊息審核流程會呼叫 `App._evaluateAchievements()`

### 2.3 使用者操作入口
- 後台新增 / 編輯 / 下架 / 刪除成就
- 後台上傳 / 更新徽章圖片
- 個人頁稱號裝備與儲存

## 3. 目前責任分布

### 3.1 `js/modules/achievement.js`
目前同時承擔：

- achievement condition 文案生成
- achievement condition 評估
- 前台成就頁 render
- 後台成就列表 render
- 後台成就表單狀態管理
- 後台成就 CRUD
- 後台 badge CRUD
- badge 圖片上傳 / 裁切接線

判斷：

- 這個檔案目前不是單一模組，而是「評估器 + 顯示層 + 後台管理 + 圖片上傳」四種責任混合。

### 3.2 `js/modules/profile-data.js`
目前承擔：

- 個人頁徽章數顯示
- 稱號 HTML 顯示
- 稱號推薦邏輯
- 稱號選單組裝
- 稱號預覽
- 稱號儲存

判斷：

- 稱號系統其實不在 `achievement.js`，而是在 profile 領域內散開。

### 3.3 `js/modules/profile-core.js`
目前承擔：

- 公開用戶卡與自己的個人卡中的已獲得徽章展示

判斷：

- badge 顯示 helper 不只一份，已在 profile core 內重算一次。

### 3.4 `js/modules/profile-card.js`
目前承擔：

- 名片頁徽章展示

判斷：

- 和 `profile-core.js` 有重複 badge 計算邏輯。

### 3.5 `js/modules/leaderboard.js`
目前承擔：

- 用戶卡活動統計
- 用戶卡徽章數顯示

判斷：

- 徽章數量沒有共用 helper，而是在 leaderboard 內再算一次。

### 3.6 `js/modules/personal-dashboard.js`
目前承擔：

- 儀表板摘要中的徽章數
- 使用 `user.totalGames / completedGames / attendanceRate`

判斷：

- 儀表板使用的活動統計定義和個人頁已修正的新公式並不一致，之後必須一起收斂。

### 3.7 `js/modules/event-detail-signup.js`
目前承擔：

- 活動報名 / 取消成功後觸發 achievement 重新評估

判斷：

- 這是 evaluator 的外部事件入口，第一版不能拆掉。

### 3.8 `js/modules/message-inbox.js`
目前承擔：

- 入隊審核成功後觸發 achievement 重新評估

判斷：

- 這也是 evaluator 的外部事件入口，必須列入相容層保護名單。

### 3.9 `js/core/navigation.js`
目前承擔：

- 頁面切換時觸發 `renderAchievements()`、`renderAdminAchievements()`、`renderTitlePage()`

判斷：

- 第一輪重構不能改變這些對外方法名稱，否則 routing 會一起壞。

### 3.10 `js/config.js`
目前承擔：

- `ACHIEVEMENT_CONDITIONS` 下拉選單定義

判斷：

- 這是未來 `registry.js` 的上游來源或過渡來源。

### 3.11 `js/firebase-service.js`
目前承擔：

- achievements / badges 快取集合
- achievement / badge default seed
- `page-admin-achievements` 頁面資料載入配置

判斷：

- 資料層也有 achievement 邏輯，不能只搬 UI。

### 3.12 `js/api-service.js` / `js/firebase-crud.js`
目前承擔：

- achievement / badge CRUD 封裝
- titleBig / titleNormal 預設資料欄位

判斷：

- 資料夾化第一版不需要改這層 API，但要在 Phase 1 之後明確列成依賴。

## 4. 目前應保留的舊入口
第一輪資料夾化時，以下方法應繼續保留在 `js/modules/achievement.js`，但內部可逐步轉呼叫新模組：

- `App.renderAchievements`
- `App.renderAdminAchievements`
- `App._evaluateAchievements`
- `App.showAchForm`
- `App.hideAchForm`
- `App.saveAchievement`
- `App.editAchievement`
- `App.toggleAchievementStatus`
- `App.confirmDeleteAchievement`
- `App._populateAchConditionSelects`
- `App._bindAchBadgeUpload`

原因：

- 這些方法已被頁面切換、按鈕 `onclick`、後台表單與業務流程直接依賴。

## 5. 第一批可抽離責任
Phase 1 到 Phase 2 建議優先抽這些內容：

### 5.1 `shared.js`
- `_sortByCat`
- `_getAchThreshold`
- condition normalize helper
- condition description helper

### 5.2 `registry.js`
- action metadata
- action 是否需要 filter
- action 對應單位與 label

### 5.3 `evaluator.js`
- `_evaluateAchievements` 主流程
- 各 action 的計算分流

### 5.4 `badges.js`
- 已獲得 badge selector
- badge 數量計算 helper

### 5.5 `titles.js`
- 稱號顯示 helper
- 稱號選項組裝
- 稱號預覽資料組裝

### 5.6 `admin.js`
- 後台列表 render
- 後台表單 state
- 後台 CRUD orchestration

## 6. 第一輪不要急著抽的內容
- `ApiService` / `FirebaseService` / `firebase-crud` 的 achievement CRUD
- `users.titleBig / titleNormal` 欄位結構
- achievements / badges seed 資料模型
- `pages/profile.html` / `pages/admin-system.html` 的 DOM 結構
- `onclick="App.xxx()"` 的既有頁面入口名稱

原因：

- 這些屬於第二階段風險，現在動它們會把「資料夾化」與「資料模型重寫」綁在一起。

## 7. 目前資料依賴地圖

### 7.1 主要集合
- `achievements`
- `badges`
- `users`
- `activityRecords`
- `attendanceRecords`
- `events`
- `teams`
- `messages`

### 7.2 主要欄位
- `achievements.id / name / category / badgeId / status / current / completedAt / condition.*`
- `badges.id / achId / name / category / image`
- `users.titleBig / titleNormal / exp / level / teamId / teamIds / teamName / teamNames`
- `messages.actionType / actionStatus / meta.teamId / meta.teamName / meta.applicantUid`

### 7.3 目前的資料耦合問題
- badge 是否已獲得，靠 `achievement.current >= threshold`
- 稱號可選清單，也靠 `achievement.current`
- 多個頁面直接各自讀 `ApiService.getAchievements()` 與 `ApiService.getBadges()`
- evaluator 直接寫回 `achievement.current / completedAt`

## 8. Phase 0 已確認的高風險點

### 8.1 achievement 進度不是 per-user
- 目前多個頁面直接讀全域 `achievement.current`
- 這會讓徽章數 / 稱號選項 / 已完成狀態天然不適合多使用者隔離

### 8.2 evaluator 綁死目前登入者
- `_evaluateAchievements()` 直接讀 `ApiService.getCurrentUser()`
- `join_team` 尤其容易誤把審核者當成目標用戶

### 8.3 achievement 語意與中文名稱不一致
- `attend_*` 目前不是實際出席
- `complete_event` 目前不是 `checkin + checkout`

### 8.4 profile / leaderboard / dashboard 各算各的
- 徽章數量沒有單一 helper
- 稱號選項與已獲得 badge 也沒有單一 selector

### 8.5 個人儀表板統計尚未對齊新定義
- `personal-dashboard.js` 仍讀 `user.totalGames / completedGames / attendanceRate`
- 與個人頁現行應到 / 完成 / 出席率邏輯不同步

## 9. Phase 1 實作建議順序
建議下一步依序做：

1. 建立 `js/modules/achievement/` 資料夾與最小骨架檔
2. 保留 `js/modules/achievement.js` 作 facade
3. 先抽 `shared.js`
4. 再抽 `registry.js`
5. 再抽 `evaluator.js`
6. 確認舊入口仍可被 `navigation`、`signup`、`message` 呼叫

## 10. Phase 0 驗收結論
本次盤點已達成下列條件：

- 已列出 achievement 系統主要入口
- 已列出外部呼叫點
- 已列出第一批應保留的舊入口方法
- 已列出第一批可抽離責任
- 已列出高風險耦合點

結論：

- 可以開始進入 `Phase 1：建立資料夾骨架與相容層`
- 但在 `Phase 1` 前，不建議先動 achievement data schema
