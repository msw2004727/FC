# 成就系統資料夾化重構計畫

## 1. 目標摘要
本文件是 [achievement-condition-refactor-spec.md](achievement-condition-refactor-spec.md) 的前置結構計畫，目的不是先改條件公式，而是先把成就 / 徽章 / 稱號系統整理成可逐步重構的模組化骨架。

本次資料夾化的核心原則如下：

1. 保留舊入口，先不做一次性大搬家。
2. 先建立新資料夾與責任邊界，再逐步把內部邏輯抽離。
3. 每一階段都要可回退、可驗證、可繼續上線。
4. 功能修正與大規模搬移盡量拆階段，避免同一次變更同時承擔兩種風險。

## 2. 為什麼先做資料夾化
目前成就 / 徽章 / 稱號相關邏輯並不只在單一檔案內，已經分散在：

- `js/modules/achievement.js`
- `js/modules/profile-data.js`
- `js/modules/profile-core.js`
- `js/modules/profile-card.js`
- `js/modules/leaderboard.js`
- `js/modules/personal-dashboard.js`
- `js/modules/event-detail-signup.js`
- `js/modules/message-inbox.js`
- `js/config.js`
- `js/firebase-service.js`

如果直接在這種狀態下重寫 achievement condition 邏輯，後續仍然要再搬一次結構，容易造成：

- 同一套規則被重寫兩次
- 前台顯示與後台條件再次分岔
- 搬移時漏改舊入口導致頁面壞掉
- `index.html` 載入順序或 `script-loader` 依賴失衡

因此本計畫建議先做「可控的結構整理」，再進入真正的條件重構。

## 3. 重構原則

### 3.1 保留舊入口（Facade / Compatibility Layer）
第一階段保留：

- `js/modules/achievement.js`

它暫時不直接承載全部邏輯，而是逐步改為：

- 對外 API 入口
- 舊頁面相容層
- 新資料夾模組的轉呼叫層

只要還有舊頁面或舊呼叫點依賴它，就不刪除。

### 3.2 新舊並存，而不是大爆改
第一版資料夾化不追求把所有 achievement 相關碼一次搬乾淨，而是採：

1. 先建立新資料夾骨架
2. 每次只搬一類責任
3. 每搬完一類就驗收
4. 舊檔只剩轉接後，再進下一步

### 3.3 以責任切割，不以頁面切割
資料夾拆分以「責任」為準，而不是以「目前哪個頁面用到」為準。

建議責任切法：

- 條件模板與 metadata
- 條件評估
- 徽章 / 成就展示
- 稱號裝備與可選清單
- 後台成就管理
- 共用 helper

### 3.4 任何搬移都要保持可上線
每一階段完成後，都要保證：

- 現有頁面仍可正常打開
- 舊按鈕與入口仍能正常使用
- 未搬移完成前，不讓新資料夾成為唯一單點

## 4. 目標結構
第一版建議收斂成以下骨架：

```text
js/modules/
├── achievement.js                       # 舊入口，相容層，逐步瘦身
└── achievement/
    ├── index.js                        # 新系統對內整合入口
    ├── shared.js                       # 共用 helper / 常數 / normalize
    ├── registry.js                     # 成就模板註冊表
    ├── evaluator.js                    # achievement condition 評估入口
    ├── stats.js                        # 應到 / 出席 / 完成等共用統計 helper
    ├── badges.js                       # 徽章展示、已獲得判定 helper
    ├── titles.js                       # 稱號裝備、稱號選項、fallback
    ├── profile.js                      # 個人頁 / 名片 / dashboard 顯示整合
    └── admin.js                        # 後台建立 / 編輯 / 刪除 / 驗證整合
```

> 備註：第一版不一定一次拆到這麼細，但命名與責任應朝這個方向前進。

## 5. 施工分期

### Phase 0：盤點與責任標註
工作內容：

1. 盤點所有成就 / 徽章 / 稱號相關呼叫點
2. 區分每段邏輯屬於：
   - 評估
   - 展示
   - 後台管理
   - 稱號裝備
   - 共用 helper
3. 標記哪些函式仍必須保留在 `js/modules/achievement.js`

自我驗收：

- 能列出所有入口函式與其責任
- 能列出每個頁面目前依賴哪個 achievement API
- 能列出第一批可抽離的函式清單

可能風險：

- 漏掉隱藏呼叫點
- 只看頁面入口，漏掉事件觸發型呼叫

修復方式：

- 用全文搜尋確認 `renderAchievements`、`_evaluateAchievements`、徽章數與稱號裝備相關呼叫
- Phase 0 完成前先整理依賴地圖，不急著搬碼

### Phase 1：建立資料夾骨架與相容層
工作內容：

1. 新增 `js/modules/achievement/` 資料夾
2. 建立最小骨架檔：
   - `index.js`
   - `shared.js`
   - `registry.js`
   - `evaluator.js`
3. `js/modules/achievement.js` 先保留原對外函式名稱
4. 讓舊入口可逐步轉呼叫新模組

自我驗收：

- 頁面載入順序正確
- 舊入口函式仍存在
- 尚未搬完的功能不會因資料夾化而壞掉

可能風險：

- `index.html` / `script-loader` 載入順序錯誤
- 新檔掛載順序晚於舊入口，導致 undefined

修復方式：

- 採增量加入，不一次替換全部 `<script>`
- 每加入一個新模組就驗證 `App` 上的對應方法是否仍可呼叫

### Phase 2：先抽共用 helper，不先抽 UI
工作內容：

1. 把可純化的 helper 優先抽到 `shared.js` / `stats.js`
2. 把條件 metadata 抽到 `registry.js`
3. 讓 `achievement.js` 改呼叫新 helper，而不是自行持有全部細節

適合優先抽離的內容：

- threshold 解析
- condition normalize
- 活動類型判斷
- 應到 / 出席 / 完成共用統計
- 已獲得徽章計算 helper

自我驗收：

- 抽出的 helper 不依賴 DOM
- 抽出的 helper 不偷讀 `currentUser`
- 前台顯示結果與搬移前一致

可能風險：

- helper 看似共用，實際偷偷依賴某頁上下文
- 同一 helper 在不同頁面語意不一致

修復方式：

- helper 一律改為明確傳入參數
- 若語意不同，分成兩個 helper，不強行共用

### Phase 3：抽離評估器與條件註冊表
工作內容：

1. 將 `achievement condition` 評估邏輯集中到 `evaluator.js`
2. 將 action 定義集中到 `registry.js`
3. 舊的 `_evaluateAchievements()` 保留名稱，但內容改為轉呼叫 evaluator

自我驗收：

- `_evaluateAchievements()` 對外行為不變
- 所有 action 判定都從 registry 取得
- 找不到模板時可安全略過，不讓整頁 crash

可能風險：

- 舊呼叫點仍假設 evaluator 會直接寫 UI
- evaluator 與 registry 切開後，欄位定義不同步

修復方式：

- evaluator 只負責算資料，不直接 render
- registry 作為 action metadata 唯一來源

### Phase 4：抽離前台展示與稱號管理
工作內容：

1. 將個人頁 / 名片 / dashboard 的徽章與稱號 helper 收斂到：
   - `badges.js`
   - `titles.js`
   - `profile.js`
2. 讓 `js/modules/profile-data.js`、`js/modules/profile-core.js`、`js/modules/profile-card.js` 改讀新 helper

自我驗收：

- 個人頁徽章數、名片徽章、稱號頁可選清單一致
- 稱號預覽與實際儲存一致
- 不同頁面不再各自重算一套徽章 / 稱號

可能風險：

- 多頁面仍各自保留一份舊邏輯
- 稱號與 achievement 名稱字串綁太死，搬移後更難追

修復方式：

- 抽出單一 badge/title selector helper
- 在本階段先保留舊欄位 fallback，避免直接切斷舊資料

### Phase 5：抽離後台管理
工作內容：

1. 將後台成就建立 / 編輯 / 刪除 / 驗證整合到 `admin.js`
2. 保留 `renderAdminAchievements()` 作為舊入口名稱
3. 後台表單欄位與 registry 對齊

自我驗收：

- 後台建立 / 編輯流程仍可正常開啟
- 新增、修改、刪除 achievement / badge 不受影響
- 表單可依模板顯示對應欄位

可能風險：

- 後台 UI 與 evaluator 支援模板再次分叉
- badge 上傳流程被搬壞

修復方式：

- 後台欄位來源直接讀 registry
- badge 圖片上傳與預覽先維持原 API，不在同一階段改儲存方式

### Phase 6：開始套用真正的條件重構規格
這一階段才正式接回 [achievement-condition-refactor-spec.md](achievement-condition-refactor-spec.md)。

工作內容：

1. 移除假條件
2. 補齊真條件 evaluator
3. 清理線上無效 achievement / badge
4. 再決定是否進一步拆更多檔案

自我驗收：

- 後台只剩真條件
- 前台與後台共用同一套判定來源
- 舊入口已明顯瘦身，但仍保留必要相容性

可能風險：

- 邏輯重構與資料清理同時進行，難以定位錯誤

修復方式：

- 先完成資料夾化，再做 condition 重構
- 清理腳本與 evaluator 改寫分開提交

## 6. 哪些東西現在不要急著搬
以下項目第一輪不建議和資料夾化一起大改：

- Firestore collection schema
- `users.titleBig / titleNormal` 的資料結構
- 線上 achievement / badge 刪除
- `index.html` 全量 script 大重排
- 一次把 profile / leaderboard / personal-dashboard 全部重寫

原因：

- 這些都屬於第二層風險
- 和資料夾化綁在同一批施工，會讓回歸定位困難

## 7. 這份計畫對專案長期模組化的意義
這不是只為 achievement 系統服務，而是建立一個之後可複製到其他功能的重構模式。

未來可沿用同樣方法處理：

- `user-admin-*`
- `profile-*`
- `message-*`
- `tournament-*`
- `event-*`

共通原則都是：

1. 先建立領域資料夾
2. 保留舊入口
3. 逐步抽離內部責任
4. 每階段保持可上線
5. 最後再清理 legacy 殘留

## 8. 結論
本計畫的重點不是「先搬檔案」，而是：

- 先建立 achievement 領域資料夾化骨架
- 讓舊入口持續可用
- 把內部邏輯逐步抽離
- 把結構風險與業務邏輯風險拆開

這樣後續要實作 achievement condition 重構時，施工量雖然會多一個前置階段，但整體回歸風險會比直接大改低得多。
