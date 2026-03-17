# 成就 / 徽章 / 稱號系統重構規格書

## 1. 目標摘要
本次重構目標如下：

1. 移除目前不能保證正確上架的成就條件，避免後台再出現假條件。
2. 只保留目前系統可正確計算的成就條件。
3. 將成就條件系統改為模板註冊制（`achievement template registry`），保留未來可擴充空間。
4. 修正目前成就判定與中文語意不一致的問題。
5. 清理目前線上使用不支援條件的成就與關聯徽章。
6. 確保後台未來「只要能選到的條件，就一定可以正確上架」。

## 2. 現況盤點

### 2.1 目前線上已有成就
- `球隊新人`：`join_team`
- `初入江湖`：`attend_play`
- `新手村民`：`attend_camp`
- `測試先鋒`：`reach_exp`

### 2.2 目前問題
- `join_team` 有實作，但判定對象可能誤用目前登入操作者，不是目標用戶。
- `attend_*` 雖然有評估程式碼，但目前實際上算的是正取報名，不是實際出席。
- `reach_exp` 目前沒有真正評估邏輯。
- 後台目前仍可選到多個未實作 action 與 timeRange，屬於假條件。

## 3. 本次保留的正式條件

### 3.1 活動類條件
- 報名活動（`register_event`）
- 完成活動（`complete_event`）
- 出席 PLAY（`attend_play`）
- 出席友誼（`attend_friendly`）
- 出席教學（`attend_camp`）
- 出席觀賽（`attend_watch`）

### 3.2 球隊類條件
- 加入球隊（`join_team`）

### 3.3 用戶狀態類條件
- 達到出席率（`attendance_rate`）
- 達到等級（`reach_level`）
- 累計 EXP（`reach_exp`）
- 綁定 LINE 推播（`bind_line_notify`）
- 完成個人檔案（`complete_profile`）
- 註冊天數（`days_registered`）

## 4. 本次刪除的條件
以下條件目前不保證可正確上架，必須自系統移除：

- 主辦活動（`organize_event`）
- 刊登二手商品（`list_shop_item`）
- 售出二手商品（`sell_shop_item`）
- 獲得徽章（`earn_badges`）

### 4.1 刪除規則
1. 後台建立 / 編輯成就表單不得再顯示上述條件。
2. 若線上既有成就使用上述條件，需直接刪除。
3. 若該成就有關聯徽章（`badgeId`），需同步刪除對應徽章。
4. 不做 archived 保留，不做假上架過渡。

## 5. 條件語意定義

### 5.1 報名活動（`register_event`）
定義：
- 本人
- 有效報名
- 排除 `waitlisted`、`cancelled`、`removed`
- 可依活動類型（`play / friendly / camp / watch`）篩選

### 5.2 出席活動（`attend_*`）
定義：
- 本人
- 有簽到（`checkin`）
- 不可用正取報名代替出席
- 各 action 對應各自活動類型

### 5.3 完成活動（`complete_event`）
定義：
- 本人
- 有效報名
- 有簽到（`checkin`）
- 有簽退（`checkout`）
- 可依活動類型篩選

### 5.4 加入球隊（`join_team`）
定義：
- 目標用戶成功加入球隊後即達成
- 必須以被加入者本人為評估對象
- 不得誤用當前登入操作者作為判定對象
- 一旦達成即永久保留

### 5.5 達到出席率（`attendance_rate`）
定義：
- 使用最新應到 / 出席 / 完成邏輯
- 以 `出席場次 ÷ 應到場次` 計算
- 排除候補、取消、移除、未報名掃碼、同行者資料

### 5.6 達到等級（`reach_level`）
定義：
- 直接讀取 `使用者（users）.level`

### 5.7 累計 EXP（`reach_exp`）
定義：
- 直接讀取 `使用者（users）.exp`

### 5.8 綁定 LINE 推播（`bind_line_notify`）
定義：
- 直接讀取 `使用者（users）.lineNotify.bound === true`

### 5.9 完成個人檔案（`complete_profile`）
定義：
- 使用固定欄位完整度規則
- 第一版必填欄位：
  - 性別（`gender`）
  - 生日（`birthday`）
  - 地區（`region`）
  - 電話（`phone`）

### 5.10 註冊天數（`days_registered`）
定義：
- 以 `今天 - 使用者（users）.createdAt` 計算自然日數

## 6. 條件模型收斂規則

### 6.1 動作（`action`）
- 僅允許本文件「本次保留的正式條件」列出的 action。

### 6.2 時間範圍（`timeRange`）
- 本版僅允許：`none`
- 以下先自 UI 移除：
  - `7d`
  - `30d`
  - `90d`
  - `streak`

### 6.3 篩選器（`filter`）
- 僅活動類條件可使用
- 非活動類條件不得顯示 `filter`

### 6.4 門檻值（`threshold`）
- 僅顯示在需要數值門檻的模板上
- 布林型條件如 `join_team`、`bind_line_notify`、`complete_profile` 可固定使用 `1`

## 7. 模板註冊制（`achievement template registry`）設計要求

### 7.1 目標
未來新增新條件時，不重新走回「自由拼裝但其實算不出來」的舊模式。

### 7.2 設計原則
每個成就模板都必須有：

1. 模板 key（`action`）
2. 顯示名稱
3. 支援欄位定義
4. 評估函式（`evaluator`）
5. 驗證規則
6. 後台表單描述

### 7.3 新增模板標準流程
未來若要新增新條件，必須同時完成：

1. 在模板 registry 註冊
2. 補 evaluator
3. 補後台欄位顯示規則
4. 補驗證邏輯
5. 補測試案例

未完成上述任一項，不得上架，不得顯示於後台條件選單。

## 8. 施工步驟

### Step 1：盤點與資料備份
工作內容：
1. 盤點線上 `成就（achievements）`
2. 盤點線上 `徽章（badges）`
3. 標記使用不支援 action 的成就
4. 建立刪除清單

自我驗收：
- 可列出所有 achievement 的 `id / name / action / badgeId`
- 可列出所有不支援 action 的 achievement
- 可列出將受影響的 badge

可能風險：
- 刪錯仍需保留的成就
- badge 關聯漏刪
- 成就與 badge 關聯不一致

風險修復方式：
- 執行前先輸出刪除清單人工複核
- 刪除邏輯採 achievement 與 badge 成對校驗
- 刪除後再次掃描 orphan badge / orphan achievement

### Step 2：清理後台條件選單
工作內容：
1. 從條件設定 UI 移除不支援 action
2. 移除不支援 `timeRange`
3. 只保留活動類條件的 `filter`
4. 表單只顯示模板真正需要的欄位

自我驗收：
- 後台選單中看不到不支援 action
- 非活動條件不會看到 `filter`
- 不再出現 `7d / 30d / 90d / streak`

可能風險：
- 舊資料編輯頁載入失敗
- 表單欄位殘留舊值造成錯誤保存
- UI 看似精簡但 save payload 仍夾帶舊欄位

風險修復方式：
- 編輯舊資料時先做 normalize
- 儲存前重新組裝 payload，不沿用舊物件直接寫回
- 對 payload 做白名單欄位過濾

### Step 3：重寫模板評估器
工作內容：
1. 建立 `achievement template registry`
2. 將現有 action 評估改為模板化
3. 補齊保留條件的 evaluator
4. 移除找不到模板時的假評估

自我驗收：
- 每個保留 action 都能找到對應 evaluator
- 不支援 action 不會被上架，也不會進入正常計算流程
- evaluator 輸入與輸出格式一致

可能風險：
- evaluator 之間資料來源不一致
- 某些條件仍偷偷依賴 `currentUser`
- 找不到模板時直接讓頁面壞掉

風險修復方式：
- 建立單一 evaluator interface
- 評估一律明確傳入 `targetUid`
- 找不到模板時回傳可觀測錯誤並略過，不中斷整體渲染

### Step 4：修正條件語意
工作內容：
1. `attend_*` 改為用 `checkin`
2. `complete_event` 改為 `checkin + checkout`
3. `join_team` 改為以目標用戶為準
4. `attendance_rate` 套用最新應到邏輯
5. `reach_level / reach_exp / bind_line_notify / complete_profile / days_registered` 改為讀真實欄位

自我驗收：
- 只有報名、未簽到者不會算 `attend_*`
- 只有簽到、未簽退者不會算 `complete_event`
- 入隊審核者不會誤拿 `join_team`
- 出席率結果與個人頁統計邏輯一致

可能風險：
- 活動紀錄與簽到紀錄互相打架
- 個人頁統計和成就判定公式再次分裂
- `join_team` 歷史資料不完整導致誤判

風險修復方式：
- 明確指定每個模板的唯一主資料來源
- 共用既有統計 helper，不重寫第二套公式
- `join_team` 允許多來源交叉回退，並保留達成後永久完成

### Step 5：刪除不支援條件的線上成就與徽章
工作內容：
1. 刪除使用不支援 action 的 achievement
2. 刪除其對應 badge
3. 清理 UI 顯示結果

自我驗收：
- 線上 achievement 不再含不支援 action
- 對應 badge 不殘留 orphan
- 前台成就頁與個人頁不再顯示被刪除成果

可能風險：
- 前端快取殘留舊成就
- badge 已刪但 achievement 快取還在
- 使用者稱號曾引用被刪成就名稱

風險修復方式：
- 同步清理 cache version
- 刪除後重新抓取 achievements / badges
- 對稱號顯示做 fallback，若來源成就不存在則清空顯示

### Step 6：未來擴充位保留
工作內容：
1. 補文件註明新增模板流程
2. 將 registry 結構寫成可擴充格式
3. 保留後續新增 action 的統一入口

自我驗收：
- 新模板只需新增 registry 項與 evaluator 即可接入
- UI 不需要為每個條件重寫一整套頁面
- 未註冊模板不會誤顯示

可能風險：
- 註冊表與 UI 邏輯分散，未來再次失真
- 新人維護時只加 UI 沒加 evaluator
- 模板欄位不一致造成儲存格式漂移

風險修復方式：
- 以 registry 作為 UI 與 evaluator 唯一來源
- 增加模板完整性檢查
- 文件中規定未註冊即不可上架

## 9. 自我驗收總表

### 9.1 後台
- 建立 / 編輯成就時，只能看到正式支援條件
- 不支援 action 不可選、不可存、不可上架
- 不支援 `timeRange` 不可選

### 9.2 前台
- 成就頁正確顯示
- 個人頁徽章數正確
- 名片徽章正確
- 稱號頁選項與已完成成就一致

### 9.3 邏輯
- `join_team` 不誤判
- `attend_*` 真的是出席
- `complete_event` 真的是完成
- `attendance_rate` 與個人頁統計一致
- 狀態型條件都讀真實欄位

### 9.4 線上資料
- 不支援條件 achievement 全數移除
- 關聯 badge 全數同步移除
- 無 orphan badge
- 無假條件殘留

## 10. 後續擴充規範
未來若新增新成就條件，必須一律遵守：

1. 先定義中文語意
2. 指定唯一主資料來源
3. 補 registry
4. 補 evaluator
5. 補後台欄位定義
6. 補測試
7. 驗證後才可讓條件出現在後台 UI

禁止再次出現：
- UI 可選但實際無法正確判定的假條件
- 文案看起來像「出席」，實際卻是「報名」
- 同一條件在不同頁面用不同公式

## 11. 結論
本次不是單純修 bug，而是將成就條件系統收斂為：

- 可上架
- 可驗證
- 可維護
- 可擴充

任何在本版無法保證正確判定的條件，一律不保留於後台上架選項中。
