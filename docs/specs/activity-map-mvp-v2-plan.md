# 活動地圖 MVP V2 計劃書

Last Reviewed: 2026-05-18
Status: V2.1 first implementation completed

## 2026-05-18 實作紀錄

- 已新增活動建立/編輯表單的「設定地圖位置」流程。
- `event-location-draft.js` 只保存輕量表單草稿與 stale 判斷，會隨 activity group 載入。
- `event-location-picker.js` 被放在 `eventLocationPicker` manual-only group，只有使用者點擊後才載入。
- Google Maps JS 不在開啟 picker 時自動載入；只有使用者執行地點搜尋且 key 存在時才載入。
- `event-map-geo.js#getEventPoint()` 改為只接受 `mapLocationConfirmed === true` 的座標。
- Firestore rules 已加入 `lat/lng/mapAddress/mapPlaceId/mapProvider/mapLocationConfirmed/mapLocationUpdatedAt` 驗證。
- 已補 unit/rules 測試覆蓋 lazy/manual-only、stale payload、map-ready contract 與 rules 欄位驗證。

## 目標

V2 的目標是補上 V1 最大缺口：活動建立者或可編輯活動者可以在新增/編輯活動時完成「場地定位」，讓活動資料真正成為 map-ready event。

V2 不重做 V1 的地圖入口與地圖顯示骨架。V1 已完成：

- 活動頁「尋找附近活動」入口。
- 首頁管理 feature flag。
- 地圖模組 lazy loading。
- 使用者目前定位通知。
- map-ready 活動顯示與 fallback 地圖。
- 未開啟地圖時不載入地圖資源。

V2 專注在：活動表單、座標資料、Firestore rules、測試與舊資料補定位流程。

## V2.1 審計修正摘要

本版修正 V2 初稿中會影響實作安全性與上線流程的中型以上瑕疵：

1. Firestore rules 不只要修改 owner/scoped role 的欄位白名單，也必須讓所有 create/update 分支都套用 map 欄位型別驗證；否則 broad manager 或 legacy `event.edit_self` update path 可能繞過座標驗證。
2. create path 不能只寫「canCreateEventRoot 相關驗證」，必須明確新增 create payload whitelist 或至少 map field validator，避免非法座標在建立時落地。
3. V1 的 `event-map-geo.js` 目前只排除 `mapLocationConfirmed === false`，V2 必須收斂為 `mapLocationConfirmed === true` 才可成為 marker，避免只要有人寫入 `lat/lng` 就被當成有效 marker。
4. 公開「尋找附近活動」開關與建立/編輯活動的「場地定位 picker」不能完全綁死。公開地圖可關閉，但管理者仍需要在上線前補定位資料；V2 應新增獨立 picker 開關或 admin-only preparation path。
5. 新增的 `eventLocationPicker` script group 必須加入 manual-only 排除清單與測試，不能只在文件寫 lazy group。
6. 新增模組與載入順序會觸發專案文件、tunables、快取版本與完工紀錄同步要求；V2.1 已補成實作驗收條件。
7. 定位 picker 不得一開啟就要求使用者目前位置；只有使用者明確選擇「用目前位置作為場地」時才可觸發定位權限。

## 現況

目前活動新增/編輯只支援 `location` 文字欄位：

- `pages/activity.html`：`#ce-location`、`#cee-location`
- `js/modules/event/event-create.js`：建立/更新活動只送出 `location`
- `js/modules/event/event-create-external.js`：外部活動只送出 `location`
- `js/modules/event/event-map-geo.js`：地圖顯示端已能讀 `lat/lng`

因此 V1 地圖能顯示已具備座標的活動，但 UI 還沒有辦法讓主辦者設定座標。

## V2 必做範圍

1. 在自訂活動新增/編輯表單加入「設定地圖位置」流程。
2. 在外部活動新增/編輯表單加入同樣的 optional 定位流程。
3. 保留原本 `location` 文字欄位，且仍為自訂活動必填。
4. 使用者必須明確按下「設定地圖位置」才載入地圖定位模組。
5. 打開建立/編輯活動 modal 時不得自動載入 Google Maps 或 Places。
6. 使用者確認地點後才寫入活動座標欄位。
7. 使用者跳過定位時，活動仍可建立/更新，但不會成為 map marker。
8. 修改 `location` 文字後，若和已確認地址不同，必須把定位狀態標為待重新確認。
9. Firestore rules 允許並驗證活動地圖欄位。
10. 補 rules tests、unit tests、前端 smoke checks。
11. 將公開地圖入口開關與建立/編輯活動的定位 picker 權限分離；公開地圖關閉時，管理者仍需能透過獨立 picker 開關或 admin-only preparation path 補座標。
12. 收斂 `event-map-geo.js#getEventPoint()`：只有 `mapLocationConfirmed === true` 且座標合法才回傳 marker point。
13. Firestore rules 的 create 與所有 update allow branch 都必須套用 map 欄位驗證，不得只改 owner/scoped role 白名單。
14. `eventLocationPicker` 必須列為 manual-only script group，並補測試確認不會被 `preloadAll()` 或活動頁初始載入帶入。
15. 新增模組、載入順序、feature flag、JS/HTML/CSS 變更時，必須同步更新專案規範要求的架構文件、tunables、快取版本與完工紀錄。

## V2 不做範圍

- 不建立完整 `venues` collection。
- 不做場地主後台。
- 不批次自動 geocode 全部舊活動。
- 不做導航、交通時間、收藏場地。
- 不新增獨立 `page-activity-map` route。
- 不把使用者目前位置當作活動場地，除非使用者明確選擇「用目前位置作為場地」。
- 不把 `activityMapEnabled` 當作唯一定位資料維護開關；公開地圖可被關閉，但不應阻斷有權限者補 map-ready 資料。
- 不在定位 picker 開啟時自動要求使用者目前位置；只有使用者明確按「用目前位置作為場地」時才可觸發定位權限。

## 使用者流程

### 建立活動

1. 使用者輸入活動地點文字。
2. 地點欄下方顯示定位狀態：
   - `尚未設定地圖位置`
   - `已設定地圖位置`
   - `地點文字已變更，請重新確認`
3. 使用者點擊「設定地圖位置」。
4. 系統才 lazy load 地圖定位模組。
5. 系統用 `location + cities/region` 組成搜尋 query。
6. 顯示候選地點清單與地圖 pin。
7. 使用者選擇候選地點，或在地圖上微調 pin。
8. 使用者按「確認此位置」。
9. 表單暫存 map 欄位，按建立活動時一併寫入。

### 編輯活動

1. 開啟編輯時還原既有 `location` 與 map 欄位。
2. 若活動已有 `mapLocationConfirmed === true` 且座標合法，狀態顯示 `已設定地圖位置`。
3. 若編輯者修改 `location` 文字，暫存定位狀態改為 stale。
4. stale 狀態下儲存活動時：
   - 若未重新確認，寫入 `mapLocationConfirmed: false`，並清除或保留座標但不讓地圖使用。
   - 建議清除 `lat/lng/mapAddress/mapPlaceId`，避免錯誤 marker。
5. 使用者重新確認後再寫入新的 map 欄位。

## 資料模型

在 `events` 文件新增 optional 欄位：

```js
{
  lat: number | null,
  lng: number | null,
  mapAddress: string | null,
  mapPlaceId: string | null,
  mapProvider: 'google' | 'manual' | null,
  mapLocationConfirmed: boolean,
  mapLocationUpdatedAt: string | null
}
```

欄位語意：

- `lat/lng`：地圖 marker 與距離排序使用。
- `mapAddress`：供應商回傳或使用者確認後的地址。
- `mapPlaceId`：Google Place ID，用於未來去重與場地資料庫。
- `mapProvider`：座標來源，第一版定位流程主要是 `google`，管理者手動補座標可用 `manual`。
- `mapLocationConfirmed`：只有 true 才可成為地圖 marker。
- `mapLocationUpdatedAt`：ISO string，方便審計與排查。

V2 暫不寫 `geohash`。原因是目前 V1 地圖仍採 client-side 已載入活動過濾，尚未做 server-side geo query。等活動量成長後，再於 V3 補 geohash 與地理索引。

## map-ready 判斷

沿用 V1 顯示端邏輯，但 V2 建議收斂為明確契約：

```js
event.mapLocationConfirmed === true
  && Number.isFinite(event.lat)
  && Number.isFinite(event.lng)
  && event.lat >= -90
  && event.lat <= 90
  && event.lng >= -180
  && event.lng <= 180
```

實作時必須同步更新 V1 已存在的 `event-map-geo.js#getEventPoint()`。現況若只檢查 `mapLocationConfirmed !== false`，會讓缺少 confirmed 欄位但有 `lat/lng` 的資料被畫成 marker；V2 必須改成缺少 confirmed、confirmed false、非法座標都回傳 `null`。

## 前端架構

### 新增 lazy group

建議新增獨立 manual-only group，避免建立活動只需要定位 picker 時載入整個地圖瀏覽 overlay：

```js
eventLocationPicker: [
  'js/modules/event/event-map-geo.js',
  'js/modules/event/event-location-picker.js'
]
```

同時必須把 `eventLocationPicker` 加入 `ScriptLoader._manualOnlyGroups`，並確認 `preloadAll()`、`preloadCorePages()`、活動頁 page group 都不會自動執行它。若 `activityMap` 也載入 `event-map-geo.js`，script-loader 必須依既有去重機制避免重複載入。

載入時機：

```js
await ScriptLoader.ensureGroup('eventLocationPicker');
await App.openEventLocationPicker({ mode: 'create' });
```

Google Maps / Places / Geocoding SDK 必須由 `event-location-picker.js` 在使用者點擊後再動態載入。

### 表單狀態

新增表單暫存狀態，不直接污染活動列表狀態：

```js
App._eventLocationDraft = {
  lat: null,
  lng: null,
  mapAddress: '',
  mapPlaceId: '',
  mapProvider: null,
  mapLocationConfirmed: false,
  sourceLocationText: ''
};
```

建立、編輯、關閉 modal 時都要清理或還原此狀態。

### 表單 UI

在 `#ce-location` 下方新增：

- 狀態列：未定位 / 已定位 / 需重新確認。
- `設定地圖位置` 按鈕。
- 已定位時顯示簡短地址與 `重新設定`。
- optional：`清除定位`。

外部活動 `#cee-location` 下方使用同樣元件，但地點可維持選填。若外部活動沒有 `location`，定位按鈕 disabled 並提示先輸入地點。

## Feature Flag 與權限邊界

V2 需要分清兩個開關：

- `activityMapEnabled`：控制前台「尋找附近活動」入口、公開地圖瀏覽 overlay、使用者目前位置請求。
- `activityMapLocationPickerEnabled`（建議新增）或等效 admin-only preparation path：控制建立/編輯活動中的「設定地圖位置」能力。

理由：公開地圖可因內容不足、Google quota、UX 風險而暫時關閉；但如果定位 picker 也一起關閉，管理者就無法補舊活動座標，公開地圖永遠無法累積可用資料。

最低實作要求：

- 公開地圖 off 時，不顯示或不允許進入附近活動地圖，也不得觸發 geolocation。
- picker off 時，建立/編輯表單只保留文字地點，不載入 picker group。
- 若不新增第二個 siteConfig flag，必須提供只限管理者或活動可編輯者使用的 preparation path，並在 UI 文案上標示目前只用於補定位，不開放前台地圖。
- 沒有 Google key 或 SDK 失敗時，picker 自動降級為跳過定位；管理者手動座標模式可作為救援，但仍受 rules 驗證。
- picker 不得在開啟時自動要求使用者目前位置；只有使用者點擊「用目前位置作為場地」時，才顯示用途說明並觸發瀏覽器/LIFF 定位授權。

## Google Maps 使用邊界

V2 仍採 Google Maps Platform：

- Places Autocomplete 或 Places Text Search：找候選地點。
- Maps JavaScript API：顯示候選點與微調 pin。
- Geocoding API：作為地址轉座標 fallback。

限制：

- API key 只能放 client restricted key，不可當 secret。
- 必須設定 HTTP referrer restrictions。
- 必須限制 API scope。
- 必須設定 quota 與 billing alert。
- 沒有 key 或 SDK 載入失敗時，定位 picker 必須顯示 fallback，不阻塞活動建立。

Fallback：

- 一般使用者：可以跳過定位，只建立文字地點活動。
- 管理者：可提供「手動輸入座標」救援模式，但必須驗證數值範圍。

## Firestore Rules

### event create/update 欄位與驗證入口

將下列欄位加入活動建立與更新允許欄位：

- `lat`
- `lng`
- `mapAddress`
- `mapPlaceId`
- `mapProvider`
- `mapLocationConfirmed`
- `mapLocationUpdatedAt`

白名單需同步修改：

- `eventUpdateBasicFieldsOnly`
- `eventScopedRoleFieldsOnly`
- create payload whitelist 或 `canCreateEventRoot` 相關 create 驗證

但只改白名單不夠。V2 必須把 map 欄位驗證放在 `events/{eventId}` create/update 的共同入口，讓 broad manager、owner、scoped role、legacy `event.edit_self` 等所有分支都不能繞過。

建議結構：

```js
allow create: if isAuth()
  && hasString('title')
  && canCreateEventRoot()
  && isValidEventMapFields(request.resource.data);

allow update: if isAuth()
  && isValidEventMapFields(request.resource.data)
  && (
    canBroadManageEventUpdate()
    || canEventOwnerUpdate()
    || canScopedRoleUpdate()
    || canRegistrationCounterUpdate()
  );
```

若現有 rules 仍保留 `(isEventOwner() && hasPerm('event.edit_self'))` 這類 legacy path，該分支也必須被上方共同 validator 包住，或被移除/改接到同一個受控 helper。不得留下任何可寫入 map 欄位但不跑 `isValidEventMapFields()` 的路徑。

### 型別驗證

新增 rules helper：

```js
function hasValidEventPoint(data) {
  return data.keys().hasAll(['lat', 'lng'])
    && data.lat is number
    && data.lat >= -90
    && data.lat <= 90
    && data.lng is number
    && data.lng >= -180
    && data.lng <= 180;
}

function isValidEventMapFields(data) {
  return (!data.keys().hasAny(['lat']) || data.lat == null || (data.lat is number && data.lat >= -90 && data.lat <= 90))
    && (!data.keys().hasAny(['lng']) || data.lng == null || (data.lng is number && data.lng >= -180 && data.lng <= 180))
    && (!data.keys().hasAny(['mapAddress']) || data.mapAddress == null || (data.mapAddress is string && data.mapAddress.size() <= 240))
    && (!data.keys().hasAny(['mapPlaceId']) || data.mapPlaceId == null || (data.mapPlaceId is string && data.mapPlaceId.size() <= 180))
    && (!data.keys().hasAny(['mapProvider']) || data.mapProvider == null || data.mapProvider in ['google', 'manual'])
    && (!data.keys().hasAny(['mapLocationConfirmed']) || data.mapLocationConfirmed is bool)
    && (!data.keys().hasAny(['mapLocationUpdatedAt']) || data.mapLocationUpdatedAt == null || data.mapLocationUpdatedAt is string)
    && (data.get('mapLocationConfirmed', false) != true || hasValidEventPoint(data));
}
```

create/update 都必須套用。`null` 必須允許，因為舊活動與跳過定位活動不能被擋；但只要 `mapLocationConfirmed === true`，`lat/lng` 必須同時存在且合法。

更新計數、報名統計、檢視數等窄欄位 update branch 仍應因 `changedKeys()` 白名單自然排除 map 欄位變更；共同 validator 只負責確保整份 `request.resource.data` 沒有非法 map 狀態。

## 模板與多日期活動

### 活動模板

V2 初版建議模板只保存 `location` 文字，不保存座標。原因是模板可能被跨場地或跨城市使用，直接複製座標容易產生錯誤 marker。

若未來要保存常用場地，應改做 `venues` collection，而不是讓模板承擔場地資料庫。

### 多日期活動

同一批多日期活動使用同一個已確認場地時，可把 map 欄位複製到每一場活動。

如果使用者在建立前修改地點文字，必須重新確認一次，避免批次建立錯誤座標。

## 舊資料補定位

V2 不做全自動批次 geocoding。

建議補定位流程：

1. 管理者進入活動管理。
2. 篩選 active 且 `mapLocationConfirmed !== true` 的活動。
3. 逐筆編輯活動。
4. 點擊「設定地圖位置」。
5. 確認候選地點後儲存。

上線前建議至少補：

- 目標測試區 5 筆 active map-ready events，或
- 全站 10 筆 active map-ready events。

## 性能邊界

V2 不得破壞 V1 性能承諾：

- 打開活動頁不載入定位 picker。
- 打開建立活動 modal 不載入 Google Maps。
- 輸入地點文字時不自動 geocode。
- 只有點擊「設定地圖位置」才載入 picker 與 Google SDK。
- `activityMapEnabled` off 時，只關閉公開地圖查找入口；不得載入公開地圖模組、不得觸發 geolocation。
- `activityMapLocationPickerEnabled` off 或 preparation path 不可用時，定位 picker 才 disabled 或不可進入。
- picker flag on 時，也只能在可建立/可編輯活動者點擊按鈕後載入，不得跟建立/編輯 modal 同步載入。
- 不把 picker JS 加入 `preloadAll()` 可執行載入。
- 不把 Google Maps SDK 加入 `sw.js` static cache。

## 專案文件與版本同步

V2 實作碰到 JS、HTML、CSS、script-loader 或新增模組時，必須同步完成下列項目：

- 新增 `event-location-picker.js`、新增/調整 script-loader group 後，更新 `docs/architecture.md` 的模組清單與依賴說明。
- 變更 script-loader 載入順序、manual-only group、preload 排除邏輯後，更新 `docs/tunables.md` 的載入順序與 sequence effect。
- 修改 JS/HTML/CSS 後，使用 `node scripts/bump-version.js` 同步更新 `js/config.js`、`index.html`、`sw.js` 的快取版本。
- 新增管理端 feature flag 或權限碼時，依專案規範評估並同步更新權限說明與 permission-audit；若只沿用既有首頁管理權限，需在 PR/完工說明中明確記錄。
- 功能完成後在 `docs/claude-memory.md` 增加一筆完工紀錄，避免後續維護者不知道地圖定位資料契約。

## 測試計劃

### Unit tests

- `normalizePoint` 拒絕非法座標。
- `getEventPoint` 只接受 confirmed 且合法座標。
- `getEventPoint` 拒絕缺少 `mapLocationConfirmed`、`mapLocationConfirmed: false`、`lat/lng` 任一缺漏的活動。
- 地點文字改變時 draft 變成 stale。
- 未確認定位時 create/update 不送 confirmed map 欄位。
- 已確認定位時 create/update 送出正確 map 欄位。
- 多日期建立會複製同一組合法 map 欄位。
- `ScriptLoader.preloadAll()` 不會載入 `eventLocationPicker`，且 `eventLocationPicker` 被列入 manual-only group。

### Rules tests

- 建立活動可不帶 map 欄位。
- 建立活動可帶合法 map 欄位。
- 更新活動可清除 map 欄位。
- 拒絕 `lat` 超出範圍。
- 拒絕 `lng` 超出範圍。
- 拒絕座標字串。
- 拒絕過長 `mapAddress`、`mapPlaceId`。
- 拒絕非法 `mapProvider`。
- 拒絕 `mapLocationConfirmed: true` 但缺少 `lat` 或 `lng`。
- broad manager 不可透過全活動管理 update 寫入非法 map 欄位。
- owner 或 legacy `event.edit_self` path 不可繞過 map 欄位驗證。
- owner/delegate/admin 既有活動編輯能力不退化。

### Smoke checks

- `activityMapEnabled` off：公開附近活動地圖不可進入，且不載入公開地圖 JS / Google Maps / geolocation。
- `activityMapEnabled` off 但 picker preparation path 可用：有權限者仍能在建立/編輯活動中補定位。
- picker flag off：定位按鈕不可用，且不載入 picker JS。
- picker flag on 但未點擊定位：不載入 Google Maps。
- 點擊定位按鈕後才載入 picker group。
- 開啟 picker 不會要求目前位置；只有點擊「用目前位置作為場地」才出現定位用途說明與權限請求。
- Google SDK 失敗時仍可建立文字地點活動。
- 已定位活動儲存後會出現在附近活動地圖。
- 修改地點文字後未重新定位時，不再出現在地圖 marker。

## 實作順序

1. 新增 V2 data helper：draft normalize、map payload builder、stale 判斷。
2. 收斂 `event-map-geo.js#getEventPoint()`，補 confirmed contract unit tests。
3. 新增 manual-only `eventLocationPicker` script-loader group，先補 preload 排除測試。
4. 新增 picker flag 或 admin-only preparation path，不讓公開地圖開關阻斷資料補定位。
5. 在活動建立/編輯 modal 加定位狀態 UI。
6. 新增 `event-location-picker.js`，先做無 Google SDK 的 fallback/manual shell。
7. 將 map payload 接入 `event-create.js` create/update。
8. 將 map payload 接入 `event-create-external.js` create/update。
9. 補編輯活動時的 map 欄位還原。
10. 補 location 文字改動後 stale/reset 邏輯。
11. 補 Firestore rules 白名單、共同 validator 與 create/update 全分支防繞過測試。
12. 補 rules tests 與 unit tests。
13. 接 Google Places/Geocoding lazy loading。
14. Playwright smoke 驗證未開啟時無性能成本。
15. 更新 `docs/architecture.md`、`docs/tunables.md` 與必要的權限/完工紀錄。
16. bump version。
17. 部署前用 5 到 10 筆活動完成手動定位驗收。

## 驗收標準

V2 完成時必須同時滿足：

- 使用者能在新增/編輯活動時完成場地定位。
- 沒有定位的活動仍可正常建立與編輯。
- 只有 `mapLocationConfirmed === true` 且座標合法的活動可在 V1 地圖中顯示 marker。
- 修改地點文字後不會留下錯誤 marker。
- Firestore rules 在 create 與所有 update 分支都阻擋非法座標、非法型別、confirmed true 但缺座標的資料。
- `activityMapEnabled` off 時不載入公開地圖、不觸發目前位置權限。
- 公開地圖 off 時，有權限者仍可透過 picker flag 或 preparation path 補活動座標。
- picker flag on 但未點擊定位時不載入 picker JS 或 Google Maps。
- picker 開啟本身不要求目前位置；只有使用者明確選擇用目前位置當場地時才請求定位權限。
- `eventLocationPicker` 不會被 `preloadAll()`、活動頁初始載入或 Service Worker static cache 帶入。
- 新增模組與載入順序已同步更新 `docs/architecture.md`、`docs/tunables.md`、快取版本與完工紀錄。
- 既有活動列表、詳情、報名、活動管理流程不退化。

## 風險

- Google Places/Geocoding 需要實際 API key、quota、billing 設定才能完整驗證。
- 台灣場館名稱可能有同名問題，所以必須要求使用者確認候選點。
- LIFF WebView 的地圖 SDK 行為需真機測試。
- 若未補舊活動座標，地圖內容仍會偏少。
- 若未來需要「真正附近」的大量查詢，V3 需要 geohash 或 server-side geo query。
