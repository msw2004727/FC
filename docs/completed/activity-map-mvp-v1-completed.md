# 活動地圖 MVP V1 完成歸檔

Last Reviewed: 2026-05-18
Status: Completed and archived
Implementation commit: `ca4e89c1 feat: add lazy nearby activity map`

## 完成結論

活動地圖 MVP V1 已完成並部署到 `main`。此版本的目標是先建立「可以開啟附近活動地圖」的安全骨架，同時確保未開啟地圖時不拖慢既有首頁與活動頁。

V1 已完成地圖入口、首頁管理開關、地圖 lazy loading、定位使用通知、map-ready 活動顯示、無 Google Maps key 的 fallback，以及功能關閉時的硬性短路。

## 已完成範圍

1. 活動頁原本停用的附近活動入口已改為「尋找附近活動」。
2. 首頁管理新增「附近活動地圖」滑動開關。
3. `siteConfig/featureFlags.activityMapEnabled` 控制功能開關，production default 為關閉。
4. feature flag 關閉時：
   - 入口不可進入。
   - 不載入地圖模組。
   - 不請求瀏覽器定位。
   - 不建立 map overlay。
5. feature flag 開啟但使用者未點擊地圖時：
   - 不載入 `event-map.js`。
   - 不載入 `event-map-geo.js`。
   - 不載入 Google Maps SDK。
6. 使用者點擊「尋找附近活動」後才載入地圖模組。
7. 第一次使用定位排序前先顯示站內定位說明。
8. 使用者目前位置只留在記憶體，不寫入 Firestore 或 localStorage。
9. map-ready 活動可在地圖/活動卡中顯示。
10. 沒有座標的活動不顯示 marker，但仍保留在原本活動列表。
11. Google Maps key 未設定或載入失敗時，使用輕量 fallback 地圖與活動卡。
12. Service Worker 與 cache version 已依專案規則更新。

## 實作檔案

主要變更：

- `pages/activity.html`
- `pages/admin-content.html`
- `js/config.js`
- `js/core/script-loader.js`
- `js/core/navigation.js`
- `js/firebase-service.js`
- `js/modules/ad-manage/ad-manage-core.js`
- `js/modules/event/event-list-helpers.js`
- `js/modules/event/event-list-timeline.js`
- `js/modules/event/event-map.js`
- `js/modules/event/event-map-geo.js`
- `css/activity.css`
- `tests/unit/activity-map-geo.test.js`
- `tests/unit/script-deps.test.js`
- `index.html`
- `sw.js`

## 驗收結果

已完成驗收：

- `node --check` 通過相關 JS / SW 檔案。
- `npm test` 通過：135 suites、3195 tests。
- Playwright smoke check 通過：
  - flag off 時不載入地圖模組、不開 overlay。
  - flag on 但未點擊前不載入地圖模組與 Google Maps。
  - 點擊後才載入本地 map module。
  - 點擊後先顯示定位說明。

## 未完成項目

以下項目刻意不納入 V1，移交到 V2：

1. 新增/編輯活動時的「設定地圖位置」流程。
2. 活動資料寫入 `lat/lng/mapAddress/mapPlaceId/mapLocationConfirmed`。
3. Firestore rules 對活動地圖欄位的白名單與型別驗證。
4. 活動地點文字改動後的座標失效與重新確認流程。
5. 舊活動的手動補定位工具。
6. Google Places/Geocoding 的建立活動端整合。

## 目前產品限制

V1 可以顯示已經具備座標的活動，但目前活動建立/編輯表單只有 `location` 文字欄位。因此一般主辦者還無法從 UI 完成場地定位。這是 V2 的主要工作。

## 歸檔原因

V1 的可部署範圍已完成，剩餘工作已不是地圖顯示骨架，而是活動資料建立端的場地定位能力。為避免 active spec 混入已完成事項，本文件歸檔於 `docs/completed`，新的待實作計劃改放 `docs/specs/activity-map-mvp-v2-plan.md`。
