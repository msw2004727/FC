# 活動地圖 MVP V2 計劃書

Last Reviewed: 2026-05-18
Status: Ready for implementation planning

## 目標

在不破壞現有活動列表、報名、活動詳情與建立活動流程的前提下，推出第一版「活動地圖 MVP」：

- 使用者可以從活動頁進入地圖模式。
- 地圖顯示目前可見且已完成定位的活動。
- 點擊地圖標記可查看活動摘要卡。
- 有使用者定位時依距離排序；沒有定位時退回目前地區篩選。
- 沒有座標的既有活動仍照常出現在原本列表，不進入地圖標記。

V2 修正 V1 的核心瑕疵：座標來源、Firestore rules、附近語意、供應商決策、Service Worker/cache busting、feature flag 與回滾策略都納入第一版必要範圍。

## 現況依據

- `pages/activity.html` 已有附近活動/地圖入口，但目前 disabled 並顯示尚未開放。
- 這代表入口不是完全缺失；V2 應啟用現有入口並改為「尋找附近活動」，不要移除既有地區篩選，避免定位失敗時失去 fallback。
- `pages/activity.html` 與 `js/modules/event/event-create.js` 已有活動地點文字欄位。
- `docs/specs/firestore-schema.md` 的 `events` schema 目前只有 `location` 字串，沒有座標欄位。
- `js/modules/event/event-detail.js` 已將活動地點轉成 Google Maps 搜尋連結。
- `firestore.rules` 的 event update 白名單目前允許 `location`, `regionEnabled`, `region`, `cities`，但不允許 `lat`, `lng`, `geohash`, `venueId`。
- `js/core/script-loader.js` 已有 lazy group 模式，適合把地圖 SDK 與地圖模組延後載入。
- `js/config.js`, `index.html`, `sw.js` 使用明確 cache version，需要依專案規則同步處理 JS/CSS/HTML 變更。

## 產品範圍

### 第一版必做

1. 啟用活動頁現有 `#region-tab-nearby-activity` 地圖入口，文案改為「尋找附近活動」，但掛在 feature flag 後面。
   - 不取代活動頁 region tabs，也不取代首頁搜尋的地區下拉；這些控件是拒絕定位、定位失敗、或 feature flag off 時的手動篩選 fallback。
   - 若版面需要突出入口，可將按鈕移到地區列左側或使用 icon + text，但不得犧牲原本地區篩選能力。
2. 新增 map-ready 活動資料欄位：
   - `lat`
   - `lng`
   - `geohash`
   - `mapPlaceId`
   - `mapAddress`
   - `mapLocationConfirmed`
3. 建立/編輯活動時新增「定位確認」流程：
   - 保留既有 `location` 文字輸入，不破壞舊流程。
   - 使用 `location + region/cities` 做搜尋或 geocoding。
   - 使用者確認後才寫入座標。
   - 搜尋失敗或使用者跳過時，活動仍可建立，但不會出現在地圖 pin。
4. 地圖模式只讀取目前 client 已載入的可見 active events，不新增歷史全量查詢。
5. 有座標的活動渲染 marker；沒有座標的活動不渲染 marker。
6. marker 點擊後顯示活動小卡：
   - 活動名稱
   - 運動類型
   - 日期時間
   - 地點
   - 費用
   - 剩餘名額
   - 查看詳情/報名入口
7. 下方 bottom sheet 顯示 map-ready 活動列表。
8. 支援目前活動頁既有篩選語意：
   - region tab
   - sport tag
   - type filter
   - keyword search
   - active/visible event filtering
9. 加入 Firestore rules 白名單與型別驗證。
10. 加入 rules tests 與前端 smoke checks。
11. 更新 cache version 與 Service Worker 相關版本。

### 第一版不做

- 不建立完整 `venues` collection。
- 不做場地主完整後台。
- 不做大量自動 geocoding 舊資料。
- 不做導航路線、交通時間、地圖熱區、收藏場地。
- 不要求所有活動建立時必填座標，避免破壞既有活動建立流程。

## 供應商決策

第一版採用 Google Maps Platform：

- Maps JavaScript API：地圖顯示與 marker。
- Advanced Markers：自訂活動 pin。
- Geocoding API 或 Places Autocomplete：活動建立/編輯時取得座標。

理由：

- 專案目前活動詳情已使用 Google Maps 搜尋連結，使用者心智一致。
- 台灣地址、運動中心、學校、場館搜尋準確度通常較適合 MVP。
- V2 要先降低產品不確定性，不把第一版成本放在自建地理資料服務上。

限制與必備設定：

- API key 不可寫死在可任意濫用的未限制狀態。
- 這個專案沒有 build step，前端 API key 會是公開 client key；它不是 secret，安全邊界必須靠 HTTP referrer restrictions、API restrictions、quota 與 billing alerts。
- API key 與 map id 的設定位置需明確，建議新增前端設定物件，例如 `ACTIVITY_MAP_CONFIG`，放在既有 config 載入鏈中，不放進 Firestore 使用者可改寫資料。
- Google Cloud Console 必須設定 HTTP referrer restrictions。
- 必須設定 billing budget/alerts 與 API quota。
- feature flag 預設關閉，待 key、quota、測試完成後再逐步開啟。

官方依據：

- Google Maps JavaScript API Advanced Markers: https://developers.google.com/maps/documentation/javascript/advanced-markers/start
- Google Geocoding API: https://developers.google.com/maps/documentation/geocoding/overview
- Google Maps pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Firestore geo queries: https://firebase.google.com/docs/firestore/solutions/geoqueries

## 資料模型

### events 新增欄位

```js
{
  location: string,
  regionEnabled: boolean,
  region: string,
  cities: string[],

  lat: number | null,
  lng: number | null,
  geohash: string | null,
  mapPlaceId: string | null,
  mapAddress: string | null,
  mapLocationConfirmed: boolean
}
```

### 欄位語意

- `location`：原本使用者輸入的地點文字，繼續作為主要顯示欄位。
- `mapAddress`：地圖供應商回傳或使用者確認後的地址文字。
- `lat/lng`：marker 與距離排序用。
- `geohash`：未來 server-side geo query 或分區查詢用。第一版可以先 client-side filter，但欄位要先落地。
- `mapPlaceId`：Google place id 或供應商定位結果 id，用於去重與未來場地資料庫。
- `mapLocationConfirmed`：只有使用者確認過的位置才進入地圖 marker。

### 地理工具依賴

專案目前沒有 bundler，也不應為 MVP 新增大型前端依賴。

- geohash 產生採小型本地 helper，例如 `js/modules/event/event-map-geo.js`。
- 距離排序採本地 haversine helper。
- 第一版不為距離排序載入 Google Maps Geometry library。
- 不從第三方 CDN 動態載入 geohash 套件，避免 CSP、離線快取與供應鏈風險。

### map-ready 判斷

```js
event.mapLocationConfirmed === true
  && Number.isFinite(event.lat)
  && Number.isFinite(event.lng)
  && event.lat >= -90
  && event.lat <= 90
  && event.lng >= -180
  && event.lng <= 180
```

## Firestore Rules

第一版必須同步修改 rules，不可等到後續。

### event update 白名單

將以下欄位加入 `eventUpdateBasicFieldsOnly` 與 `eventScopedRoleFieldsOnly`：

- `lat`
- `lng`
- `geohash`
- `mapPlaceId`
- `mapAddress`
- `mapLocationConfirmed`

### 驗證規則

新增 helper，例如：

```js
function isValidEventMapFields(data) {
  return (!data.keys().hasAny(['lat']) || data.lat == null || (data.lat is number && data.lat >= -90 && data.lat <= 90))
    && (!data.keys().hasAny(['lng']) || data.lng == null || (data.lng is number && data.lng >= -180 && data.lng <= 180))
    && (!data.keys().hasAny(['geohash']) || data.geohash == null || (data.geohash is string && data.geohash.size() <= 12))
    && (!data.keys().hasAny(['mapPlaceId']) || data.mapPlaceId == null || (data.mapPlaceId is string && data.mapPlaceId.size() <= 180))
    && (!data.keys().hasAny(['mapAddress']) || data.mapAddress == null || (data.mapAddress is string && data.mapAddress.size() <= 240))
    && (!data.keys().hasAny(['mapLocationConfirmed']) || data.mapLocationConfirmed is bool);
}
```

### create/update 都要套用

- `allow create` 要驗證新欄位。
- `allow update` 要驗證新欄位。
- `null` 要被允許，因為舊活動或跳過定位的活動不能被擋。
- 不允許非 number 的座標字串。

## 附近語意

### 有定位權限

- 使用 `navigator.geolocation` 取得目前位置。
- 使用者目前位置只保存在記憶體中的 `_activityMapState.userLocation`。
- 第一版不得把使用者目前位置寫入 Firestore、localStorage、analytics log 或 operation log。
- 第一次點擊「尋找附近活動」時，先顯示輕量站內說明，再觸發瀏覽器/LIFF 定位權限。
  - 說明文字需明確告知：定位只用於排序附近活動，不會儲存目前位置。
  - 使用者可選「允許定位找附近」或「不用定位，先看地區活動」。
  - 站內說明的已讀狀態可只存在 localStorage；不得把使用者座標保存到 localStorage。
- 預設半徑：10 km。
- 半徑內活動依距離升冪排序。
- 若半徑內為空，顯示目前地區 map-ready 活動，並提示目前沒有附近活動。

### 沒有定位權限或定位失敗

- 不阻擋地圖模式。
- 使用目前 region tab 作為地圖範圍。
- 若 region 為全部，預設聚焦台灣北部/目前活動最多的區域，並顯示 active map-ready 活動。

### 沒有座標的活動

- 不出現在 marker。
- 保留在原本活動列表。
- 在地圖 bottom sheet 可選擇顯示一段 empty/helper 訊息，不把缺座標活動混入地圖列表。

## 前端架構

## 未開啟地圖時的性能邊界

這是第一版的硬性約束：使用者沒有開啟地圖時，現有活動頁性能不得明顯變差。

### 不可進入的載入路徑

`activityMap` 只能由使用者主動點擊地圖入口後載入，不可加入以下路徑：

- `ScriptLoader._pageGroups['page-activities']`
- `ScriptLoader.preloadCorePages()` 的 core page prefetch 結果
- `ScriptLoader.preloadCorePagesExecutable()` 的 idle execution 結果
- `ScriptLoader.preloadAll()` 的全量執行載入結果
- `sw.js` 的 `STATIC_ASSETS`
- `index.html` 初始 `<script>` 或初始 CSS

如果未來真的需要保留 `preloadAll()`，必須讓 `activityMap` 支援 `manualOnly` 或排除清單，避免全站 idle preload 時把地圖模組載入。

### 未開啟地圖時允許的成本

- `siteConfig/featureFlags.activityMapEnabled`：沿用既有 `featureFlags` 載入，不新增額外 Firestore read。
- 首頁管理新增「附近活動地圖」滑動開關，使用既有 `toggle-switch` 樣式，寫入 `siteConfig/featureFlags.activityMapEnabled` 並 `{ merge: true }`。
- feature flag off 時必須同時做到：隱藏或停用入口、入口 handler 直接 return、地圖 lazy group 不載入、不得觸發 geolocation 權限請求。
- `ACTIVITY_MAP_CONFIG`：只是一個小型 config object。
- `events` 新增 `lat/lng/geohash/mapPlaceId/mapAddress/mapLocationConfirmed`：只增加每筆活動少量欄位；不得新增額外活動查詢。
- 活動頁地圖入口 DOM：只允許小型按鈕/狀態切換，不渲染 map container、marker、bottom sheet 清單。

### 未開啟地圖時禁止的成本

- 不載入 Google Maps JavaScript API。
- 不載入 Places/Geocoding 相關 SDK。
- 不呼叫 geolocation permission prompt。
- 不呼叫 geocoding/places API。
- 不建立 map instance。
- 不建立 marker。
- 不對所有活動跑距離排序。
- 不渲染地圖 bottom sheet。

### 建立/編輯活動的性能邊界

- 打開建立/編輯活動 modal 時不得自動載入 Google Maps SDK。
- 使用者只有點擊「確認地圖位置」時才載入定位確認流程。
- 使用者輸入 `location` 時不得每次 keypress 自動 geocode；搜尋要由明確按鈕觸發，或至少 debounce 且只在定位 UI 開啟後執行。
- 定位確認失敗不得阻塞活動建立/編輯既有流程。

### 性能驗收

實作完成後需驗證：

- feature flag off：Network panel 不出現 `maps.googleapis.com`、`maps.gstatic.com`、`event-map.js`、`event-map-geo.js`。
- feature flag on 但未點地圖：上述地圖資源仍不得載入。
- 點擊地圖後：才允許載入 `event-map-geo.js`、`event-map.js` 與 Google Maps SDK。
- 活動頁初始 render 不新增地圖 marker/bottom sheet DOM。
- 手機慢網路下，未開啟地圖的活動頁進入時間與目前版本相比不得有可感知退化。

### 新增模組

建議新增：

- `js/modules/event/event-map.js`
- `css/activity-map.css` 或併入既有活動 CSS，視現有 CSS 結構而定

### script-loader

新增 lazy group，例如：

```js
activityMap: [
  'js/modules/event/event-map-geo.js',
  'js/modules/event/event-map.js'
]
```

只在使用者點擊地圖入口時載入：

```js
await ScriptLoader.ensureGroup('activityMap');
await App.showActivityMap();
```

Google Maps SDK 也必須由 `event-map.js` 動態載入，不放進 boot path。

### Route/History 邊界

第一版不要新增 `page-activity-map` route，也不要在打開地圖時呼叫 `history.pushState`。

- 地圖作為 `page-activities` 內的 view/overlay。
- 關閉地圖回到原活動列表狀態。
- Android back / LIFF back 的行為先沿用活動頁既有行為。
- 如果第二階段要做獨立地圖 route，必須另外走 History API / popstate 設計與測試。

### App API

新增或使用以下方法：

- `App.isActivityMapEnabled()`
- `App.showActivityMap()`
- `App.hideActivityMap()`
- `App.renderActivityMapMarkers()`
- `App.getMapReadyEvents()`
- `App.resolveActivityMapLocation(event)`
- `App.confirmEventMapLocation(eventId, result)`

### 狀態隔離

地圖狀態不要污染活動列表狀態：

```js
App._activityMapState = {
  map: null,
  markers: [],
  selectedEventId: null,
  userLocation: null,
  lastFilterFingerprint: '',
  loadPromise: null
};
```

## Feature Flag 與回滾

### flag 名稱

建議使用：

```js
activityMapEnabled
```

來源優先序：

1. `siteConfig/featureFlags.activityMapEnabled`
2. local diagnostic override，例如 query string `?activityMap=1`
3. production default: `false`

### 回滾方式

- 將 `activityMapEnabled` 設為 `false`。
- 地圖入口回到 disabled 或隱藏。
- 活動建立/編輯仍保留 `location` 文字欄位。
- 已寫入的 map 欄位不影響活動列表、詳情、報名。
- 不刪資料，不 migration rollback。

### 首頁管理開關

- 位置：`pages/admin-content.html` 的「首頁管理」內，沿用首頁新聞開關附近的區塊與 `toggle-switch` 視覺樣式。
- 初始化：管理頁渲染時讀取已快取的 `siteConfig/featureFlags.activityMapEnabled`。
- 儲存：新增 `App.toggleActivityMapEnabled(visible)`，寫入 `siteConfig/featureFlags`，只 merge `activityMapEnabled` 欄位。
- 生效範圍：
  - off：活動頁入口 disabled/hidden，`App.showActivityMap()` 及任何 map loader 都必須短路。
  - on：只開啟入口；仍需使用者主動點擊後才載入 map chunk、Google Maps SDK 與定位流程。
  - 管理端切換後不要求重新整理，但活動頁下一次 render 必須同步狀態。

## 舊資料策略

第一版不做大量自動補定位，但需要避免地圖空白。

### 上線前門檻

- 至少手動確認 10 筆 active events 的座標，或
- 至少目標測試區域有 5 筆 active map-ready events。

### 補定位方式

優先走活動編輯流程手動確認：

1. 管理者或活動建立者打開編輯活動。
2. 點擊「確認地圖位置」。
3. 搜尋候選位置。
4. 選擇正確場地。
5. 儲存後寫入 map 欄位。

避免第一版直接批次 geocode 所有舊活動，因為文字地點可能有歧義，例如只有「大安運動中心」但缺城市或完整地址。

## 測試計劃

### Rules tests

必測：

- 建立活動時可不帶 map 欄位。
- 建立活動時可帶合法 `lat/lng/geohash/mapAddress/mapPlaceId/mapLocationConfirmed`。
- 拒絕 `lat` 超出 -90 到 90。
- 拒絕 `lng` 超出 -180 到 180。
- 拒絕座標字串。
- 拒絕過長 `geohash/mapPlaceId/mapAddress`。
- 活動 owner/delegate/admin 既有可更新欄位行為不退化。

### Unit 或 smoke checks

必測：

- `event-map-geo.js` 的 geohash 與 haversine helper 對固定座標輸出穩定。
- `getMapReadyEvents()` 只回傳座標合法且 confirmed 的活動。
- 沒定位時使用 region fallback。
- 有定位時距離排序穩定。
- 既有活動列表篩選不因地圖模組載入而改變。
- feature flag 關閉時地圖入口不可進入。
- 打開/關閉地圖不修改 history state、不新增瀏覽器返回層。
- 使用者目前定位不寫入 Firestore/localStorage。

### 手機/LIFF 檢查

必測：

- iOS/Android LIFF WebView 進入地圖頁不白屏。
- 拒絕定位權限後仍可使用地區地圖。
- 切回活動列表後，原本報名與詳情可正常操作。
- 地圖 SDK 載入失敗時顯示 fallback，不阻塞活動頁。

## Service Worker 與版本

若實作碰到 JS/HTML/CSS，必須依專案規則同步：

- `js/config.js` 的 `CACHE_VERSION`
- `index.html` 的 `var V`
- `index.html` 中相關 `?v=` 引用
- `sw.js` 的 `CACHE_NAME`

新增 map JS/CSS 檔案後要確認：

- 透過 `script-loader` 加上 `?v=${CACHE_VERSION}`。
- 不把 Google Maps SDK 加入 `STATIC_ASSETS`。
- 地圖 SDK 失敗不讓 Service Worker cache deadlock。

## 驗收標準

第一版完成條件：

- feature flag off 時，現有活動頁行為與現在一致。
- feature flag on 時，活動頁可進入地圖模式。
- map-ready 活動在地圖上顯示 marker。
- marker 點擊可看到活動摘要並進入詳情。
- 沒有座標的活動不顯示 marker，但仍在原活動列表正常顯示。
- 建立/編輯活動可以確認座標並保存。
- Firestore rules tests 通過。
- 既有活動建立、編輯、報名、取消報名、詳情頁 smoke test 通過。
- 手機 viewport 無明顯文字重疊或底部 sheet 擋住主要操作。

## 實作順序

1. 加 feature flag 讀取 helper，預設關閉。
2. 加 `ACTIVITY_MAP_CONFIG` 設定入口，明確處理 key/map id 缺失時的 disabled/fallback。
3. 加 `event-map-geo.js`，提供 geohash 與 haversine helper，不引入外部套件。
4. 加 Firestore rules 欄位白名單與驗證，先補 rules tests。
5. 在 event create/edit 流程加入 optional 定位確認欄位與資料保存。
6. 新增 `event-map.js`，先用 fake/local map-ready events 驗證 UI 狀態。
7. 接 Google Maps SDK lazy loading。
8. 接目前活動篩選與 map-ready filtering。
9. 加 marker、活動卡、bottom sheet。
10. 手動補定位一批 active events 做上線驗證。
11. 跑 rules tests、前端 smoke、手機/LIFF 檢查。
12. bump version。
13. feature flag 由測試帳號或 admin 開始小流量開啟。

## V2 自審

### 已修正的 V1 瑕疵

- P1 座標來源：已納入建立/編輯活動定位確認流程。
- P1 rules/schema：已列入第一版必做，含 rules tests。
- P2 附近語意：已定義有定位與無定位 fallback。
- P2 供應商決策：第一版明確採 Google Maps Platform。
- P2 Service Worker/cache：已納入版本與 lazy loading 規則。
- P2 回滾策略：已定義 `activityMapEnabled` feature flag 與資料不回滾策略。

### 剩餘風險

- Google Maps API key、billing、quota 需要實際設定後才能驗證。
- Geocoding/Places 搜尋結果仍可能選錯場地，所以第一版必須要求使用者確認。
- 舊資料若不手動補定位，地圖內容會偏少。
- Client-side filtering 足夠 MVP，但活動量成長後需要 server-side geo query 或 Cloud Function 輔助。
- LIFF WebView 的 geolocation 權限表現需要真機測試。

### V2 追加修正

- 明確指定 `ScriptLoader.ensureGroup('activityMap')`，避免使用不存在的載入 API。
- 明確要求地圖 MVP 不新增 route/history state，降低 LIFF/back 行為回歸風險。
- 明確要求使用者目前位置只留在 memory，不寫入 Firestore/localStorage/log。
- 明確要求 geohash/haversine 使用本地 helper，不新增 CDN 或大型依賴。
- 明確補上 client API key 的安全邊界與設定位置。

### 目前沒有放進 V2 的項目

- `venues` collection：建議第二階段再做，避免第一版同時改活動與場地兩個模型。
- 批次自動 geocode：第一版不做，避免錯誤座標大量寫入。
- 地理查詢索引與 Cloud Function：等 map-ready 活動量變大或跨區查詢需求明確後再做。
