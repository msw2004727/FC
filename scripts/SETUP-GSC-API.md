# Google Search Console API 自動提交 Sitemap 設定指南

每次 push 含 SEO 相關檔案的變更到 main，GitHub Actions 會自動提交 sitemap.xml 給 Google，通知 Google 重新爬取。

## 一次性設定步驟

### 步驟 1：建立 GCP 專案

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 點左上角專案選擇器 → **新增專案**
3. 名稱輸入 `toosterx-seo`，點 **建立**

### 步驟 2：啟用 Search Console API

1. 在新專案中，前往 [API 程式庫](https://console.cloud.google.com/apis/library)
2. 搜尋 **「Google Search Console API」**
3. 點進去 → 點 **「啟用」**

### 步驟 3：建立 Service Account

1. 前往 [IAM → 服務帳戶](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. 點 **「建立服務帳戶」**
3. 名稱：`sitemap-submitter`
4. 點 **建立並繼續** → 跳過角色 → 點 **完成**
5. 在服務帳戶列表中，點剛建立的帳戶
6. 上方選 **「金鑰」** 分頁
7. 點 **「新增金鑰」** → **「建立新金鑰」** → 選 **JSON** → **建立**
8. 瀏覽器會下載一個 JSON 檔案，**保管好這個檔案**

### 步驟 4：在 GSC 加入 Service Account

1. 前往 [Google Search Console](https://search.google.com/search-console)
2. 選擇 **toosterx.com** 資源
3. 左下角 **「設定」** → **「使用者和權限」**
4. 點 **「新增使用者」**
5. Email 填入 Service Account 的 email（在 JSON 檔裡的 `client_email` 欄位，格式類似 `sitemap-submitter@toosterx-seo.iam.gserviceaccount.com`）
6. 權限選 **「擁有者」**
7. 點 **「新增」**

### 步驟 5：加入 GitHub Secrets

1. 前往你的 GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. 點 **「New repository secret」**
3. Name：`GCP_SERVICE_ACCOUNT_JSON`
4. Value：把下載的 JSON 檔案**整個內容**貼上
5. 點 **「Add secret」**

### 完成！

之後每次 push 到 main 且包含 SEO 相關檔案（`sitemap.xml`、`seo/**`、`index.html` 等），GitHub Actions 會自動提交 sitemap 給 Google。

## 本地測試

```bash
# 方法 1：用環境變數指定金鑰檔案路徑
GCP_KEY_FILE=path/to/your-key.json node scripts/submit-sitemap.js

# 方法 2：用環境變數直接傳 JSON 內容
GCP_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' node scripts/submit-sitemap.js
```

## 注意事項

- JSON 金鑰檔案包含私鑰，**絕對不要 commit 到 git**
- GitHub Secret 是加密儲存的，只有 Actions 執行時才能讀取
- Google Search Console API 的 sitemap submit 沒有頻率限制，但不需要過度提交
