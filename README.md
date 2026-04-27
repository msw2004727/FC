# ToosterX

> 台灣運動活動報名與管理 SPA · LIFF + Firebase + Vanilla JS

**Live**: <https://toosterx.com>

---

## ⚠️ License 與使用條款（請先閱讀）

本專案採 **Source-available, All Rights Reserved** 模式。

**簡單版**:程式碼公開可看,但**保留所有權利**。沒有 OSS license。

**詳細版**:

| 你想做的事 | 是否允許 |
|---|---|
| 在 GitHub 上**閱讀 / 學習** code 設計 | ✅ 允許(GitHub TOS 內建授權)|
| **Fork** 在 GitHub 站內(用 GitHub fork 按鈕)| ✅ 允許(GitHub TOS 內建授權)|
| **下載 / clone 到本地端閱讀** | ✅ 允許(個人學習用途)|
| **取用片段或整段程式碼,放進你自己的產品** | ❌ **不允許**(無論商業或非商業)|
| **重新部署 / 自架 ToosterX 服務** | ❌ **不允許** |
| **修改後對外散布**(無論免費或收費)| ❌ **不允許** |
| **將設計概念 / 架構模式 / 演算法寫進你自己的產品**(從零自寫,不複製 code) | ✅ 允許(中華民國著作權法第 10-1 條保護「思想」不及於「表達」)|

任何上述「❌ 不允許」的行為**未經書面授權即構成著作權法侵害**(中華民國著作權法第 22 條重製權 / 第 26-1 條公開傳輸權 / 第 91 條重製罪)。

需要商業授權 / 客製合作 / 整合服務,請聯繫專案所有人。

---

## 是什麼

ToosterX 是一套面向 LINE 用戶的運動活動報名與管理系統,服務台灣運動社群。功能包含:

### 用戶端

- **活動報名** — PLAY / 友誼賽 / 教學課程 / 觀賽 四類
- **同行者報名** — 一次帶朋友 / 家人一起報
- **候補遞補** — 自動依報名時間排候補,正取取消即遞補
- **俱樂部 / 球隊** — 加入俱樂部、查看球隊動態、成員管理
- **賽事系統** — 錦標賽報名 / 對戰表 / 賽程
- **QR Code 簽到簽退** — 主辦方驗證出席
- **個人數據統計** — 完成場次、出席率、活動歷史
- **成就徽章 + EXP 系統** — 累積活動參與獲得徽章 / 等級

### 管理端

- 活動管理(建立 / 編輯 / 結束 / 通知)
- 用戶管理(EXP 補正 / 角色權限 / 黑名單)
- 廣告管理(輪播 / 浮動 / 贊助商位 / 品牌開機畫面)
- 後台分析儀表板
- 廣告投放 + 用量統計

---

## 技術架構

| 類別 | 技術 |
|---|---|
| 前端 | Vanilla JS (ES6+) · HTML5 · CSS3 · **無框架、無 build 流程** |
| 認證 | LINE LIFF + Firebase Custom Auth |
| 資料庫 | Firebase Firestore(子集合架構)|
| 後端 | Firebase Cloud Functions (Node.js 22, asia-east1) |
| 推播 | LINE Messaging API |
| 儲存 | Firebase Storage |
| 離線支援 | Service Worker (sw.js) |
| 部署 | Cloudflare Pages(主站)+ GitHub Pages(備援) |
| CI/CD | GitHub Actions(包含 inline 熱資料注入)|

完整模組結構與依賴關係見 [`docs/architecture.md`](docs/architecture.md)。

---

## 程式碼規模

- 主程式 + 模組:**~24 個功能子資料夾,200+ JS 模組**
- Firestore Rules:**~1500 行**
- Cloud Functions:**~6200 行 / 36 個 exports**
- 自動化測試:**~660 個**(550 unit + 110 rules)
- 持續整合:GitHub Actions on push to main

---

## 此 Repo 的目的

本 repo **公開可見的目的是讓:**

1. 用戶 / 客戶可以查看程式碼來源驗證 ToosterX 的技術真實性
2. 潛在合作夥伴 / 投資人可以審視程式碼品質
3. 社群可以學習(看 / 讀)現代 LIFF + Firebase 大型 SPA 的架構

公開可見**不代表開放使用**。請見上方「License 與使用條款」。

---

## 商業化說明

ToosterX 目前由原作者獨立開發維運,規劃中的商業模式:

- B2C:免費使用,廣告 / 增值服務變現
- B2B:LIFF 整合服務 / 客製化部署 / 白牌(white-label)授權
- 未來可能拓展:匹克球垂直市場、東南亞市場(LINE 主流地區)

商業合作意向、客戶導入諮詢、投資交流,歡迎聯繫專案所有人。

---

## 為何選擇 Source-available 而非 OSS license

明確選擇「Source-available, All Rights Reserved」基於以下考量:

1. **保留商業選項** — 將來可隨時轉換策略(open core / 商業授權 / 投資合作),不被早期 license 鎖死
2. **避免被閉源競品低成本抄襲** — 台灣 / 中國運動 SaaS 市場競爭激烈,商業競品可能直接 fork 商用,維持保留所有權確保競爭門檻
3. **VC 友善** — 創投傾向投資具備技術護城河的封閉產品,純 OSS 不利於早期估值
4. **用戶資料安全** — 用戶資料 / 活動紀錄屬於 ToosterX 服務內容,不應透過授權散布

此立場不否認 OSS 對社群的價值,但本專案處於商業化早期,需要保留所有戰略彈性。

---

## 修改與貢獻

本專案**目前不接受外部 PR / 不開放 contributor**,理由同上。

若您發現 bug / 安全漏洞,歡迎透過 GitHub Issues 通報(僅限回報,程式碼修改由內部處理)。

---

## 相關連結

- 正式服務:<https://toosterx.com>
- LINE 官方帳號:見正式網站連結

---

## Copyright

Copyright © 2024-2026 ToosterX 專案所有人. All rights reserved.

未經書面授權,不得以任何形式重製、修改、散布、公開傳輸、改作或再授權本專案之全部或部分。
