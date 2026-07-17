# E2E Tests — 執行指南

本目錄是 ToosterX 的 Playwright 端到端測試。它以真實瀏覽器載入本機靜態站，驗證主要頁面、導航、權限與互動是否能在部署前正常運作。

> 命令與專案設定的真相來源是根目錄 `package.json`、`playwright.config.js` 與 `.github/workflows/test.yml`；本文件不維護容易漂移的測試數量。

## 快速開始

首次使用：

```bash
npm ci
npx playwright install chromium
```

終端 1，在專案根目錄啟動測試用靜態站：

```bash
node tests/e2e/static-server.cjs 3000
```

終端 2，先跑與 CI 相同的 desktop smoke：

```bash
npm run test:e2e:smoke
```

`static-server.cjs` 預設只監聽 `127.0.0.1`、停用快取，並將沒有副檔名的 clean route 回退至 `index.html`。本機測試預設使用 `http://localhost:3000`；需要覆寫時設定 `BASE_URL`。

## 執行指令

| 指令 | 實際範圍 |
|------|----------|
| `npm run test:e2e:smoke` | 全部 E2E spec，僅 `chromium-desktop` project；CI 使用此命令 |
| `npm run test:e2e` | 全部 E2E spec，跑 `playwright.config.js` 內所有 projects |
| `npm run test:e2e:full` | 目前與 `test:e2e` 相同的完整別名 |
| `npm run test:e2e:visual` | `chromium-mobile` project，且只匹配標題含 `@visual` 的測試 |
| `npm run test:e2e:admin` | `admin-desktop` project，且只匹配標題含 `@admin` 的測試 |

指定檔案與 project：

```bash
npx playwright test tests/e2e/home-banner.spec.js --project=chromium-desktop
npx playwright test tests/e2e/private-message.spec.js --project=chromium-mobile
```

需要看到瀏覽器或逐步除錯：

```bash
npx playwright test tests/e2e/example.spec.js --project=chromium-desktop --headed
npx playwright test tests/e2e/example.spec.js --project=chromium-desktop --debug
```

`test:e2e:visual` 與 `test:e2e:admin` 是標記式篩選器；使用前以 `rg -n "@visual|@admin" tests/e2e` 確認目前確實有對應標記，不可把「沒有匹配測試」誤當成通過。

## Playwright Projects

| Project | 環境 |
|---------|------|
| `chromium-desktop` | Chromium，1280 × 720；CI smoke 基準 |
| `chromium-mobile` | Chromium + Playwright Pixel 5 device profile |
| `admin-desktop` | Chromium，1440 × 900；供 `@admin` 情境使用 |

目前 config 沒有 WebKit 或 Firefox project。若要聲稱 Safari／Firefox 已驗證，必須先在 config 建立相對應 project 並實際執行，不可只以 Chromium 結果代替。

## 規格檔責任

| 檔案 | 主要覆蓋 |
|------|----------|
| `activity-permissions.spec.js` | 一般 user 活動建立能力、add-ons 限制與 owner／delegate 邊界 |
| `example.spec.js` | 首頁、底部導航、活動／個人／賽事頁、deep link、PWA、隱私與條款頁 |
| `home-banner.spec.js` | 首頁 banner 固定 CTA、輪播切換與找活動篩選 modal |
| `home-layout-smoke.spec.js` | 首頁主要容器溢出、有效截圖與 mobile 建立活動 CTA |
| `private-message.spec.js` | 私訊 mobile 鍵盤版面與 desktop 未讀提醒 |
| `smoke-journeys.spec.js` | 管理儀表板、多分頁降級、主題、活動 deep link、用戶名片與 Service Worker |
| `helpers/test-harness.js` | 共用測試使用者／活動 fixture、local cache seed、LIFF 與外部服務攔截 |
| `static-server.cjs` | 本機靜態站與 clean-route fallback |

不要手動維護「共有幾個測試」；需要盤點時使用：

```bash
rg --files tests/e2e -g '*.spec.js'
npx playwright test --list
```

## Mock 與資料安全

- 應用程式 E2E 優先呼叫 `installTestHarness(page, TEST_USERS.xxx)`。
- harness 會清除瀏覽器 storage、停用 Service Worker、seed 可預期的本機 cache，並攔截 Firebase、Firestore、LINE、外部運動 API 與 IP 查詢。
- 測試不得依賴或寫入 Production Firebase、LINE 或其他正式服務。
- 登入、報名、簽到等流程只有在測試明確建立完整 deterministic mock 時才算有覆蓋；頁面能載入不代表真實後端交易已驗證。
- fixture 使用假 UID、假活動與假名稱，不加入真實個資或 secret。

## CI 整合

`.github/workflows/test.yml` 的 E2E job 會：

1. 使用 Node 24 安裝 root dependencies。
2. 快取並安裝 Playwright Chromium。
3. 執行 `node tests/e2e/static-server.cjs 3000`。
4. 以 `BASE_URL=http://127.0.0.1:3000 npm run test:e2e:smoke -- --workers=1` 執行 desktop smoke。

因此本機重現 CI 時應使用同一個 server 與 `test:e2e:smoke`，不要以 Python server 或不同測試命令宣稱已重現 CI。

## 新增或修改測試

1. 優先重用 `helpers/test-harness.js`；共用 fixture 或攔截集中維護，不在每個 spec 複製。
2. 測試名稱描述使用者可觀察行為，不綁定實作行號或固定測試數量。
3. 每個測試自行建立所需狀態，不依賴執行順序或其他 spec 的殘留資料。
4. UI 驗證除了元素存在，也要檢查可見、可點、viewport 溢出與必要互動結果。
5. 修改 E2E、loader、導航或共享 harness 後，先跑目標 spec，再跑 `npm run test:e2e:smoke`；高風險或跨 project 變更再跑完整 `npm run test:e2e`。

## 常用診斷

```bash
# 確認 Playwright 收集到哪些測試與 project
npx playwright test --list

# 搜尋 project filter tags
rg -n "@visual|@admin" tests/e2e

# 核對 package scripts、config 與 CI 命令
rg -n "test:e2e|chromium-desktop|chromium-mobile|admin-desktop|static-server" package.json playwright.config.js .github/workflows/test.yml
```

Playwright 依 config 只在失敗時截圖；失敗輸出位於 `test-results/`，屬本機 generated output，不得提交。
