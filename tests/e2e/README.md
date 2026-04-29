# E2E Tests — 執行指南

本目錄是 ToosterX 的端到端（End-to-End）測試，使用 **Playwright**。
這些測試會啟動真實瀏覽器，對部署前的主要用戶流程做 smoke test。

---

## 環境需求

```bash
# 1. 安裝 Playwright 瀏覽器（首次）
npx playwright install chromium

# 2. 啟動本地 HTTP server（serve 專案根目錄）
npx serve . -l 3000

# 或使用 Python 內建 server
python3 -m http.server 3000 --bind 127.0.0.1
```

---

## 執行指令

```bash
# 所有 E2E 測試
npm run test:e2e

# 只跑特定檔案
npx playwright test tests/e2e/smoke-journeys.spec.js

# 有頭模式（可看瀏覽器實際點擊）
npx playwright test --headed tests/e2e/

# 特定瀏覽器
npx playwright test --browser=webkit tests/e2e/
```

---

## 測試檔案結構

| 檔案 | 涵蓋範圍 |
|------|---------|
| `example.spec.js` | 基礎 smoke：Homepage / Navigation / Deep link / PWA / Static pages |
| `smoke-journeys.spec.js` | 新功能：儀表板鑽取按鈕、多分頁警告、深淺主題切換、LIFF deep link |

---

## 注意事項

### Mock 機制
所有 E2E 測試使用 `mockBackend(page)` helper 攔截 Firebase / LIFF / LINE API 請求，
回傳空 response，讓頁面能在無後端環境下載入。

實際測試流程（如登入、報名）需要真實後端，不在 E2E 範圍。

### 跨瀏覽器
Playwright 預設跑 Chromium。測試跨瀏覽器需加 `--browser=webkit`（Safari）或 `--browser=firefox`。
ToosterX 主要運行環境是 LINE WebView + Chrome Mobile + Safari iOS。

### CI 整合
E2E smoke 已納入 `.github/workflows/test.yml`。CI 會安裝 Chromium、以 Python 內建 server 啟動本地靜態站，並用 `BASE_URL=http://127.0.0.1:3000 npm run test:e2e -- --workers=1` 執行，避免並行瀏覽器測試造成不穩定。

---

## 新功能補測試優先順序

| 功能 | 狀態 | 說明 |
|------|------|------|
| 首頁 + 底部 Tab Bar | ✅ | example.spec.js Journey 1-2 |
| Deep link `?event=xxx` | ✅ | example.spec.js Journey 3 |
| PWA manifest + SW | ✅ | example.spec.js Journey 4 |
| privacy.html / terms.html | ✅ | example.spec.js Journey 5 |
| **儀表板鑽取彈窗** | ✅ | smoke-journeys.spec.js（Phase 4 新增） |
| **多分頁警告 modal** | ✅ | smoke-journeys.spec.js（Phase 4 新增） |
| **深淺主題切換** | ✅ | smoke-journeys.spec.js（Phase 4 新增） |
| 活動詳情頁開啟 | ⚠️ 部分 | 需 deep link 測試 |
| 登入流程（LIFF） | ❌ | 需 mock LIFF，較複雜，目前略 |
| 報名流程 | ❌ | 需完整 Firebase mock，目前略 |
| 簽到流程 | ❌ | 同上 |
