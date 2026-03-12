# 全站頁面快取與載入策略擴張規格書

## 1. 文件目的

本文件定義 SportHub 下一階段的頁面載入策略擴張方式。

目標不是把所有頁面都硬改成首頁 / 活動頁同一種模式，而是先把頁面分型，再依頁面特性套用正確的載入策略，避免：

1. 該快的頁面不夠快
2. 該新的頁面不夠新
3. 該保守的頁面被錯用舊快取
4. 不同頁面各自長成不同邏輯，後續越來越難維護

---

## 2. 核心原則

### 2.1 不追求全站單一策略

不同頁面分成 4 種策略：

1. 快取先開型
2. 快取先看，但操作前先確認型
3. 先準備關鍵資料再開型
4. fresh-first 型

### 2.2 先分類，再施工

先定清楚每頁屬於哪一型，再改導航、資料契約與 render 順序。

### 2.3 先補資料契約，再談 stale-first

若頁面目前沒有明確的 `page -> data -> render` 契約，就不能直接套用首頁 / 活動頁做法。

### 2.4 即時監聽只留給真的需要的頁面

不是所有頁面都值得開 realtime。能靠靜態抓取 + TTL 的頁面，就不要一進頁就常駐監聽。

---

## 3. 四種策略定義

### 3.1 快取先開型

白話流程：

1. 點頁面
2. 若本機已有舊畫面或舊資料，先開頁
3. 使用者先看到內容
4. 背後再抓較新的資料
5. 若資料有變，再局部更新畫面
6. 若該頁真的需要，再延後啟動即時監聽

適用條件：

- 主要是列表、瀏覽、統計
- 舊幾秒到幾十秒可接受
- 先開畫面比資料百分之百最新更重要

### 3.2 快取先看，但操作前先確認型

白話流程：

1. 點頁面
2. 先用快取資料開頁
3. 背後刷新較新的資料
4. 使用者可先看內容
5. 但在按下會改資料的按鈕前，先抓一次最新資料
6. 確定狀態沒變，再送出操作

適用條件：

- 可先看舊資料
- 但操作會影響資料、名額、狀態或他人結果

### 3.3 先準備關鍵資料再開型

白話流程：

1. 點頁面
2. 先抓這頁最重要的資料
3. 關鍵資料 ready 後才開頁
4. 進頁後只對最敏感的部分補 realtime
5. 不是整頁全 realtime，而是重點即時

適用條件：

- 詳情頁
- 不能太舊
- 但也不值得整頁全程即時監聽

### 3.4 fresh-first 型

白話流程：

1. 點頁面
2. 先確認權限、裝置、狀態或最新資料
3. 確定可用後才開頁
4. 不用舊畫面頂著做主依據

適用條件：

- 掃碼頁
- 後台修改頁
- 權限與修復頁
- 任何用舊快取可能造成誤操作的頁面

---

## 4. 頁面分型總表

### 4.1 最適合直接套用「快取先開型」

- `page-teams`
- `page-tournaments`
- `page-personal-dashboard`
- `page-leaderboard`

### 4.2 適合套用「快取先看，但操作前先確認型」

- `page-profile`
- `page-user-card`
- `page-achievements`
- `page-titles`
- `page-team-detail`
- `page-tournament-detail`
- `page-shop`
- `page-shop-detail`
- `page-my-activities`
- `page-messages`
- `page-admin-dashboard`
- `page-admin-teams`
- `page-admin-tournaments`

### 4.3 已接近「先準備關鍵資料再開型」的頁面

- `page-activity-detail`

說明：

- 這頁目前已經是混合型做法
- 進頁前先準備關鍵資料
- 進頁後再對 `registrations`、`attendanceRecords` 做 page-scoped realtime

### 4.4 不建議改成首頁同款 stale-first 的頁面

- `page-scan`
- `page-qrcode`
- `page-game`
- `page-admin-users`
- `page-admin-exp`
- `page-admin-auto-exp`
- `page-admin-roles`
- `page-admin-achievements`
- `page-admin-banners`
- `page-admin-shop`
- `page-admin-messages`
- `page-admin-games`
- `page-admin-themes`
- `page-admin-announcements`
- `page-admin-inactive`
- `page-admin-logs`
- `page-admin-repair`

### 4.5 施工前需先補齊資料契約的頁面

- `page-messages`
- `page-achievements`
- `page-titles`
- `page-user-card`

說明：

這幾頁不是不能優化，而是要先明確定義：

1. 這頁依賴哪些集合
2. 哪些欄位要先到
3. 哪些可以背景補
4. 哪些操作前要 fresh-check

---

## 5. 目標架構

施工完成後，全站頁面應具備以下統一能力：

1. 每頁有明確的策略型別
2. 每頁有明確的資料契約
3. `showPage()` 或 detail gateway 知道該頁是：
   - 先開頁再補
   - 先補資料再開頁
   - 還是先強制 fresh 再開頁
4. `FirebaseService` 知道該頁是：
   - 靜態抓取
   - TTL 刷新
   - page-scoped realtime
   - 不可使用 stale cache

---

## 6. 施工步驟

### Step 1：建立頁面策略清單與資料契約表

工作內容：

1. 建立 `pageId -> strategyType` 清單
2. 建立 `pageId -> requiredCollections / optionalCollections / realtimeCollections` 表
3. 標記需要 fresh-check 的操作型頁面
4. 標記不允許 stale-first 的頁面

建議交付物：

- 頁面策略 registry
- 頁面資料契約 registry

工作量：

- 複雜度：中
- 主要耗時：盤點現有頁面與資料依賴

自我驗收：

- 每個主要頁面都有策略型別
- 每個主要頁面都有資料依賴表
- 沒有同一頁同時標成互相衝突的策略
- 能列出哪些頁面允許 stale-first，哪些不允許

可能產生的 BUG：

- 頁面分類錯誤，導致不該 stale 的頁面誤用舊資料
- 頁面漏列依賴集合，進頁後出現半殘畫面
- 同一頁不同入口使用不同策略，造成行為分裂

風險修復方式：

- 先以文件與 registry 為唯一來源，不接受散落頁面內部各自判斷
- 對每頁做 `page -> data -> render` 對照檢查
- 由第三方角度抽查高風險頁面：活動詳情、訊息、後台頁

---

### Step 2：把導航層改成可讀策略型別

工作內容：

1. 讓 `showPage()` 或 detail gateway 可依 `strategyType` 決定流程
2. 支援以下 3 種主要路由行為：
   - `stale-first`
   - `prepare-before-open`
   - `fresh-first`
3. 把現有首頁 / 活動頁的特殊判斷抽成可重用邏輯

工作量：

- 複雜度：高
- 主要耗時：整理 `navigation.js` 中既有分支與例外

自我驗收：

- 路由層不再只硬寫 `page-home` / `page-activities`
- 新策略可由 registry 控制
- 進頁流程不因策略新增而互相覆蓋

可能產生的 BUG：

- 切頁流程卡住
- route loading overlay 無法正確結束
- 快速連點造成過期 render 覆蓋新畫面
- hash / history 同步錯亂

風險修復方式：

- 保留 transition sequence guard
- 每種策略都走同一套 route timeout 保險絲
- 在 `showPage()` 加入策略層級的日志與錯誤標記

---

### Step 3：先擴張「快取先開型」頁面

目標頁面：

- `page-teams`
- `page-tournaments`
- `page-personal-dashboard`
- `page-leaderboard`

工作內容：

1. 讓這些頁面支援先開頁再背景刷新
2. 建立頁面快照 ready 標記
3. 依頁面補上必要的 TTL 刷新與局部重 render
4. 非必要不要開 realtime

工作量：

- 複雜度：中
- 主要耗時：補頁面快照、局部重 render 邏輯

自我驗收：

- 再次進入頁面時可先顯示既有畫面
- 背後刷新後資料有變才更新
- 沒有變動時不重刷整頁
- 不會因 stale-first 造成白屏或按鈕失效

可能產生的 BUG：

- 顯示舊資料後沒有補更新
- 多次 render 造成列表重複、事件綁定重複
- 頁面標題 / 篩選狀態被重設

風險修復方式：

- 每頁補 snapshot-ready / render-id guard
- 對重 render 頁面採局部刷新，不整頁重建
- 驗證回頁後篩選狀態是否保留

---

### Step 4：再擴張「快取先看，但操作前先確認型」頁面

目標頁面：

- `page-profile`
- `page-user-card`
- `page-achievements`
- `page-titles`
- `page-team-detail`
- `page-tournament-detail`
- `page-shop`
- `page-shop-detail`
- `page-my-activities`
- `page-messages`
- `page-admin-dashboard`
- `page-admin-teams`
- `page-admin-tournaments`

工作內容：

1. 頁面本身可先用快取開啟
2. 所有操作前按鈕定義 fresh-check
3. 對會影響狀態的操作加上「送出前重新確認」

工作量：

- 複雜度：高
- 主要耗時：逐頁盤點操作按鈕與狀態依賴

自我驗收：

- 頁面可先開
- 背後可刷新
- 操作按鈕送出前會抓最新狀態
- 名額、狀態、擁有權變動時不會用舊資料直接送出

可能產生的 BUG：

- 使用者看到能按的按鈕，但送出時被最新資料打回
- fresh-check 完後 UI 沒同步，造成誤會
- detail 頁的 stale data 與操作結果互相打架

風險修復方式：

- fresh-check 失敗時明確 toast 說明原因
- 送出前若狀態已變，先重畫最新畫面再提示
- 把「可看快取」與「可用來送出」分成兩層判斷

---

### Step 5：整理活動詳細頁，作為高敏感詳情頁範本

目標頁面：

- `page-activity-detail`

工作內容：

1. 明確分出哪些資料要先準備
2. 明確分出哪些資料進頁後走 page-scoped realtime
3. 確認整體人數、報名狀態、出席表格的資料來源一致
4. 評估是否升級為 event-scoped realtime

工作量：

- 複雜度：高
- 主要耗時：整理 event detail 主資料與周邊資料來源

自我驗收：

- 進頁時不會出現明顯錯誤或按鈕幽靈狀態
- `registrations` 更新時，報名狀態與人數能正確回灌
- `attendanceRecords` 更新時，出席表格能正確更新
- 不會出現一般用戶看到錯誤整包資料範圍

可能產生的 BUG：

- 報名人數與名單不同步
- 報名按鈕狀態和實際報名狀態不一致
- 一般用戶看到部分即時、部分舊資料而誤判

風險修復方式：

- 統一 event detail 的人數與名單 helper
- 明確區分「主活動資料」與「即時補充資料」
- 先驗證 admin / 一般 user / 未登入 3 種視角

---

### Step 6：保守處理 fresh-first 頁面

目標頁面：

- `page-scan`
- `page-qrcode`
- `page-game`
- 多數後台編輯 / 修復 / 權限頁

工作內容：

1. 明確標記這些頁面不可套用 stale-first
2. 保留現有 fresh-first 或 prepare-first 流程
3. 僅做局部效能優化，不做快取先開

工作量：

- 複雜度：中
- 主要耗時：補限制規則、避免策略誤套

自我驗收：

- 這些頁面不會誤走 stale-first
- 相機、權限、修復頁仍以正確性優先
- 後台修改頁不會拿舊資料當主依據

可能產生的 BUG：

- 某些後台頁被誤分類後，直接顯示舊資料
- 掃碼頁進頁時相機 / 權限流程被錯誤延後
- 修復頁用快取資料導致管理員做錯事

風險修復方式：

- 將這批頁面列入 deny list
- 導航層對 deny list 強制 fresh-first
- 驗證高風險頁面不受 stale-first 影響

---

### Step 7：全站整合驗收與第三方驗收

工作內容：

1. 針對各策略頁面做整合驗收
2. 以第三方角度重跑一次高風險頁面
3. 補抓「自己施工時容易忽略」的 UI / 狀態邊角問題

工作量：

- 複雜度：中高
- 主要耗時：跨頁回歸測試與角色視角測試

自我驗收：

- 各策略頁面都符合預期流程
- 沒有出現不該 stale 的頁面誤用舊資料
- 沒有出現需要即時的頁面更新延遲過頭
- 導航、返回、快取、背景刷新、realtime 行為一致

可能產生的 BUG：

- 某一頁策略正確，但從別的頁入口進來就錯
- 同一頁在不同角色下資料權限不同，導致 stale render 異常
- 離頁後 listener 沒收乾淨

風險修復方式：

- 驗收時以「入口」而不是只以「頁面」測試
- 驗證 user / coach / admin / super_admin 多角色視角
- 驗證切頁與返回時 listener finalize 是否正確

---

## 7. 建議施工順序

建議分 4 批做，不要全站一起改：

### Batch A：最容易成功的前台頁

- `page-teams`
- `page-tournaments`
- `page-personal-dashboard`
- `page-leaderboard`

### Batch B：有操作但仍屬前台的頁面

- `page-profile`
- `page-team-detail`
- `page-tournament-detail`
- `page-shop`
- `page-shop-detail`

### Batch C：高敏感詳情與狀態頁

- `page-activity-detail`
- `page-my-activities`
- `page-messages`

### Batch D：保守處理頁與後台頁

- 所有 `fresh-first` 頁面

---

## 8. 總工作量評估

### 整體複雜度

- 複雜度：高

### 原因

1. 不只是資料抓取，還會動到導航流程
2. 不只是前台 render，還會碰到 realtime 啟動與收尾
3. 不同頁面有不同資料敏感度，不能複製貼上
4. 需避免破壞既有首頁 / 活動頁的成熟策略

### 粗略工作量

- 文件 / 分型 / registry：中
- 導航抽象化：高
- 前台列表頁擴張：中
- 詳情頁與操作頁擴張：高
- 活動詳情整理：高
- 整合驗收與回歸：中高

---

## 9. 全域風險總表

### 9.1 策略誤分類風險

可能 BUG：

- 不該用 stale 的頁面先顯示舊資料
- 使用者根據舊資料誤操作

修復方式：

- 以 registry 為唯一策略來源
- 建立 deny list 保護高風險頁

### 9.2 資料契約不完整風險

可能 BUG：

- 頁面開了，但資料只到一半
- 部分區塊空白或按鈕狀態錯誤

修復方式：

- 先補 `page -> requiredCollections` 契約
- 缺契約頁不得先導入 stale-first

### 9.3 render 重複與事件綁定重複風險

可能 BUG：

- 列表重複
- 按鈕點一次執行兩次
- DOM 狀態被背景刷新蓋掉

修復方式：

- 每頁建立 render guard / request seq / snapshot ready
- 背景刷新優先做局部更新

### 9.4 listener 管理錯誤風險

可能 BUG：

- 離頁後 listener 還活著
- 其他頁被不相關 realtime 更新干擾

修復方式：

- page-scoped realtime 一律由導航層統一收尾
- 不允許頁面自行偷偷常駐監聽

### 9.5 fresh-check 沒做完整風險

可能 BUG：

- 使用者看到可按，送出卻撞到過期資料
- 名額 / 狀態 / 擁有權判斷錯誤

修復方式：

- 把操作前 fresh-check 視為正式規格，不是可選優化
- 所有會改資料的入口都要盤點

---

## 10. 最終驗收標準

### 功能面

1. 每頁都能說清楚自己屬於哪種策略
2. 每頁都能說清楚自己的資料來源與更新方式
3. 首頁 / 活動頁既有體感不能退步

### 使用者體感

1. 常進頁面明顯更快
2. 不該卡住的頁面不再先等資料才開
3. 需要最新資料的頁面不會因快取而誤導

### 維護面

1. 新頁面未來可直接選擇策略型別
2. 不再每頁各自發明一套切頁與刷新邏輯
3. 導航、資料層、頁面 renderer 的責任邊界更清楚

---

## 11. 結論

本計畫的目標不是把全站都改成首頁 / 活動頁同一招，而是把全站頁面整理成：

1. 哪些頁面重視秒開
2. 哪些頁面重視最新
3. 哪些頁面可以先看舊資料
4. 哪些頁面絕對不能信舊資料

只要先把這 4 種策略收斂清楚，後續擴張快取與背後載入時，風險才可控，架構也才會越來越分明。
