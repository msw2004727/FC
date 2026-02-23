# Demo 模式：現有功能與未來設計規劃（詳細版）

> 文件目的：整理 SportHub 目前 Demo 模式的實作現況、可使用功能、行為差異與限制，並提出可落地的未來設計規劃。
> 適用範圍：`FC-github/` 前端專案與其 Demo 模式（ModeManager + ApiService + DemoData）。

---

**一、定位與原則**

- Demo 模式是「純前端、無 Firebase/LIFF 的完整 UI 展示與互動體驗」。
- Demo/Prod 的切換由 `ModeManager` 控制，資料流由 `ApiService` 統一分流。
- 模組不得自行判斷 Demo/Prod，避免邏輯分散與維護成本。

---

**二、目前 Demo 模式的啟動方式**

- Logo 連點 5 次（3 秒內）
- 快捷鍵 `Shift + Alt + D`
- Console 指令 `switchMode('fc2026')`

限制：
- 在 GitHub Pages（`msw2004727.github.io`）網域會強制關閉 demo 模式。

---

**三、Demo 資料來源與結構**

- 主資料來源：`js/data.js` 中的 `DemoData`。
- 資料覆蓋範圍包含：
  - 使用者與角色
  - 活動 / 錦標賽 / 球隊
  - 訊息 / 公告
  - 簽到簽退 / 活動紀錄
  - 廣告 / Banner / 贊助商 / 佈景
  - 成就 / 徽章 / EXP / 通知模板
- 事件補強：`minAge` 與 `notes` 由 IIFE 後處理填入。
- Auto EXP 規則與記錄在 demo 模式會寫入 localStorage（含 mode-aware key）。

---

**四、Demo 與 Production 行為對照（核心面）**

| 功能/資料 | Demo 行為 | Production 行為 | 主要檔案 |
|---|---|---|---|
| 全域資料來源 | `DemoData` | `FirebaseService._cache` | `js/api-service.js` |
| CRUD 寫入 | 僅更新記憶體 | 寫入 Firestore | `js/api-service.js` |
| Firebase/LIFF | 不初始化 | Phase 4 初始化 | `app.js` |
| Firestore 監聽 | 會 `destroy()` | 使用 `onSnapshot` | `js/core/mode.js` |
| 登入/使用者 | `DemoData.currentUser` | `FirebaseService.currentUser` | `js/api-service.js` |
| Registrations | 直接回空陣列 | 由 Firestore 查詢 | `js/api-service.js` |

---

**五、目前 Demo 可使用功能清單（依資料覆蓋）**

- 活動列表與詳情
- 報名相關 UI（但缺真實 registrations 支援）
- 球隊列表與詳情、動態牆、留言互動
- 錦標賽列表與賽程顯示
- 個人資料頁、徽章與成就展示
- 訊息列表與已讀狀態
- 管理端 UI（含 EXP、成就、廣告、訊息、公告等）
- QR 簽到 UI（demo 靜態資料）
- Banner / Popup / 贊助商 UI

---

**六、目前 Demo 的限制與缺口**

- ~~Registrations 在 Demo 模式直接回空陣列~~ → **已修復**（2026-02-21：同行者報名系統實裝，Demo 模式已可透過 `registerEventWithCompanions` 寫入 registrations）
- `event-render.js` 中仍存在舊版同步 handleSignup/handleCancelSignup，與 `event-detail-signup.js` 的正確 async 版本衝突（待清理）
- 部分跨頁面資料依賴 Firestore 動態同步，Demo 缺少模擬更新機制。
- Demo 不包含真實 LIFF 流程，部分登入後功能僅能模擬。
- demo 資料較大，當前維護方式集中於 `data.js`，擴充成本高。

---

**七、未來 Demo 設計規劃（可落地版本）**

**7.1 Demo 資料層完整化**
- 補齊 `registrations` 的 DemoData，以支援：報名、候補、取消、名單、計費。
- 補齊 `attendanceRecords` 與 `activityRecords` 的對應關係，提升出席率統計正確性。
- 建立「資料版本」欄位，支援快速切換不同 demo 場景。

**7.2 Demo 模式行為一致性**
- 報名流程改為：在 demo 也能寫入 registrations（本地記憶體）。
- 取消報名、簽到簽退要能同步更新 demo 資料，避免 UI 不一致。
- 管理端的公告/訊息/廣告在 demo 也能更新並即時反映。

**7.3 Demo 情境模板化**
- 建立多個 Demo Scenario：
  - 新手使用者（空資料）
  - 高活躍使用者（完整成就/EXP）
  - 管理員角色（完整後台權限）
- 每種 Scenario 可在模式切換後從 UI 選擇。

**7.4 Demo 資料維護優化**
- 將 `DemoData` 拆分為多檔案（events/teams/users/admin/...）以利維護。
- 提供簡單腳本將 JSON 合併成單一 `DemoData`（不需 build 系統，可在開發時使用）。
- 將 Demo 產生邏輯集中管理，減少 UI 模組內硬編碼。

**7.5 Demo 模式提示 UX**
- 頁面右上角顯示 Demo Badge（已存在），加入「目前 Demo 資料版本」資訊。
- 重要操作（例如刪除/取消）顯示「Demo 模式僅模擬」提示。

---

**八、建議的實作優先順序**

1. 補齊 registrations + 相關 demo 流程
2. 活動名單與計費 UI demo 化
3. Scenario 切換與資料版本機制
4. DemoData 拆檔維護
5. Demo Badge UX 強化

---

**九、可延伸的長期方向**

- 加入「可重置 Demo 資料」功能（清空本地變動，恢復初始狀態）。
- 增加 Demo 使用行為統計（僅前端記錄），便於展示時追蹤。
- Demo 與 Production 對照模式：可顯示「真實模式目前不可用的功能」。

---

*最後更新：2026-02-23（同行者報名系統已完成、registrations 已可用）*
