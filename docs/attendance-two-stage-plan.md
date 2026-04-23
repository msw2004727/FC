# 活動詳情頁正取名單「兩段式 render」實作計畫書

**狀態**：2026-04-23 v1 — 初版 + 自我審計（8 項潛在 BUG 標示）
**目標**：把正取名單載入時間從 330-990ms 縮為 < 10ms（首見名字）+ 背景 200-800ms 補齊簽到/放鴿子
**預估工期**：0.5-1 天
**風險等級**：🟡 中等（有 3 項需要小心的 BUG 風險）

---

## 0. TL;DR

1. **做什麼**：正取名單改為「先快速顯示名字（像候補）+ 背景補簽到勾勾/放鴿子數」
2. **為什麼慢**：正取目前 `await` Firestore 2 次補查 + 放鴿子跨活動 scan + 100ms 防抖
3. **怎麼做**：一進活動頁、立即用 cache render 純名字版 → 背景 `fetchIfMissing` 完成後原子替換為完整版
4. **風險**：3 個 🟡 中風險、5 個 🟢 低風險（詳見 §5）

---

## 1. 現況分析

### 正取 render 路徑（`_doRenderAttendanceTable`、event-manage-attendance.js:110）

```
呼叫入口 → _renderAttendanceTable() {
  ⏱️ setTimeout 100ms 防抖
  → _doRenderAttendanceTable() {
    🌐 await Promise.all([
      fetchAttendanceIfMissing(eventId),   // 200-500ms（Firestore 補查）
      fetchRegistrationsIfMissing(eventId) // 200-500ms（Firestore 補查）
    ])
    🔀 _buildConfirmedParticipantSummary() — 參加者+同行者配對
    📊 _buildNoShowCountByUid() — 跨活動 scan 放鴿子統計
    🎨 組 HTML（含簽到勾勾、放鴿子 badge、分隊顏色）
    💾 innerHTML 替換
  }
}
```

### 候補 render 路徑（`_renderWaitlistSection`、event-manage-waitlist.js:9）

```
呼叫入口 → _renderWaitlistSection() {
  🚀 直接執行（無防抖）
  📖 ApiService.getRegistrationsByEvent() — 純讀 cache
  🔀 filter + group + sort
  💾 innerHTML 替換
}
```

### 關鍵差異

| 項目 | 正取 | 候補 |
|------|------|------|
| 防抖 | 100ms | 0ms |
| Firestore 補查 | 2 次 await | 0 |
| 跨活動 scan | 放鴿子統計 | 無 |
| 總時間 | 330-990ms | < 10ms |

---

## 2. 實作方案：兩段式 render

### Stage 1：立即快速 render（目標 < 50ms）

**資料來源**：純 cache（`_cache.registrations`、`_cache.attendanceRecords`）
**顯示內容**：名字 + 同行者 + 已知簽到狀態（cache 內有的）
**不顯示**：放鴿子數、分隊顏色（依賴完整資料）→ 用 placeholder
**跳過**：`fetchIfMissing`、`_buildNoShowCountByUid`

### Stage 2：背景補齊（完成後原子替換、約 200-800ms）

**資料來源**：`await fetchIfMissing` 後的完整 cache
**顯示內容**：完整版（含放鴿子 badge、分隊顏色、最新簽到狀態）
**原子替換**：用 `innerHTML` 一次性換、避免逐 row 替換的閃爍

### 實作骨架

```javascript
async _doRenderAttendanceTable(eventId, containerId) {
  const cId = containerId || 'attendance-table-container';
  const container = document.getElementById(cId);
  if (!container) return;
  App._lockContainerHeight?.(container);
  this._manualEditingContainerId = cId;
  const e = ApiService.getEvent(eventId);
  if (!e) return;

  // ★ 新增：Stage 1 立即 render（純 cache、跳過 await、跳過放鴿子）
  const stage1HTML = this._buildAttendanceTableHTML(eventId, cId, { fast: true });
  container.innerHTML = stage1HTML;

  // ★ 新增：Stage 2 背景補齊（await 完成後原子替換）
  try {
    await Promise.all([
      ApiService.fetchAttendanceIfMissing(eventId),
      ApiService.fetchRegistrationsIfMissing(eventId),
    ]);
  } catch (err) {
    console.warn('[AttendanceTable] Stage 2 fetch failed:', err);
    return;  // Stage 1 已顯示、不 crash
  }

  // 防止 await 期間用戶切頁、container 被清空
  if (!document.getElementById(cId)) return;
  // 防止 await 期間已進入編輯模式（避免覆蓋編輯狀態）
  if (this._attendanceEditingEventId === eventId) return;

  const stage2HTML = this._buildAttendanceTableHTML(eventId, cId, { fast: false });
  // 若 HTML 實質相同、不替換（避免無意義閃爍）
  if (stage2HTML !== stage1HTML) {
    container.innerHTML = stage2HTML;
  }
}

// 新增 helper：抽出既有 render 邏輯為純函式、options.fast 切換快/慢路徑
_buildAttendanceTableHTML(eventId, cId, options = {}) {
  const { fast = false } = options;
  // ... 既有的 render 邏輯
  // 若 fast=true：跳過 _buildNoShowCountByUid、分隊排序等
  // 若 fast=false：走完整路徑
}
```

---

## 3. 檔案變更清單（2 個）

| # | 檔案 | 改動 |
|---|------|------|
| 1 | `js/modules/event/event-manage-attendance.js` | 拆 `_doRenderAttendanceTable` 為 Stage 1 + Stage 2、抽 HTML 組裝為 `_buildAttendanceTableHTML` |
| 2 | `js/modules/event/event-manage-attendance.js` | 同上檔案、無其他檔案改動 |

**不改動**：
- `event-manage-waitlist.js`（候補本來就快、不動）
- `firebase-crud.js`（報名 transaction 鎖定函式、不動）
- `event-detail.js`（呼叫端不變、都是呼叫 `_renderAttendanceTable`）
- Firestore Rules / CF（無）

---

## 4. 自我審計：8 個潛在 BUG

### 🟡 BUG 1：Stage 2 完成時、用戶已進入編輯模式（race condition）

**情境**：
- Stage 1 render 完、用戶立即點「編輯簽到」按鈕、進入編輯模式
- Stage 2 fetch 完成後、`innerHTML` 替換為「完整版」
- **編輯狀態 DOM 被覆蓋、用戶的選擇消失**

**緩解**：
- 實作時在 Stage 2 替換前檢查 `this._attendanceEditingEventId === eventId` 跳過
- 若用戶進入編輯、Stage 2 不替換、維持 Stage 1（缺放鴿子 badge 等資訊）
- **剩餘風險**：編輯模式下看不到放鴿子 badge（minor UX 損失、不 crash）

### 🟡 BUG 2：Stage 1 與 Stage 2 的 row 順序不同 → 視覺重排

**情境**：
- Stage 1 用 cache 顯示、某個參加者的同行者資料可能還沒齊（只顯示主要人）
- Stage 2 補齊後、主要人+同行者的顯示順序變動
- 用戶看到名單「重排一次」、可能感覺閃爍

**緩解**：
- Stage 1 的排序邏輯**必須與 Stage 2 一致**（同個排序函式、只是資料來源不同）
- **剩餘風險**：若 Stage 1 因 cache 不完整、某人的同行者漏顯、Stage 2 補上時確實會看到「多一行」——這**無法避免**、只能減少（若 cache 本來就完整、兩段相同）

### 🟡 BUG 3：放鴿子統計在 Stage 2 才顯示、可能慢

**情境**：
- `_buildNoShowCountByUid` 跨活動 scan、若用戶參加過很多活動（> 100 場）可能 100-300ms
- Stage 1 顯示無放鴿子 badge、Stage 2 補齊時**突然每個人名字後面出現 🕊️ 數字**
- UX 上是「加資訊」、不是「內容變動」、可接受但仍有微閃

**緩解**：
- Stage 2 替換時用 `requestAnimationFrame` 批次 commit、減少閃爍
- 或 Stage 1 就保留「🕊️ -」的 placeholder、Stage 2 替換為實際數字
- **剩餘風險**：放鴿子欄位從「無」變「有」的視覺改變、用戶可能察覺

### 🟢 BUG 4：Stage 1 fetch 失敗、Stage 2 永不觸發

**情境**：
- `fetchAttendanceIfMissing` 或 `fetchRegistrationsIfMissing` throw（網路斷）
- Stage 2 的 `try/catch` 攔截後 `return`
- 用戶只看到 Stage 1 版本（缺放鴿子/完整簽到）

**緩解**：
- 實作時 log `[AttendanceTable] Stage 2 fetch failed`、至少 console 看得見
- **剩餘風險**：用戶看到「名單但無簽到狀態」、以為 bug——但這**本來就是 cache 的真實狀態**、比原本「永遠 loading」好

### 🟢 BUG 5：onSnapshot 觸發 → 連續兩段式 render → 放大 DOM 替換次數

**情境**：
- 活動詳情頁有 onSnapshot listener、`registrations` 變動時會重 render
- 每次都走「Stage 1 → Stage 2」兩段 → DOM 替換 2 次
- 原本 100ms 防抖把多次觸發收為 1 次、現在變成 N×2 次

**緩解**：
- **保留 100ms 防抖**（外層還在）、只改內層邏輯
- 或檢查 Stage 1 HTML 與 Stage 2 HTML 相同時跳過第二次替換（我已在 snippet 加）
- **剩餘風險**：極端情境（連續 snapshot）DOM 替換頻率仍可能增加、但因為第二次 diff 檢查、多數情況跳過

### 🟢 BUG 6：scroll 位置恢復失效

**情境**：
- 既有 `_lockContainerHeight` 是為了保 scrollTop 在 innerHTML 替換時不被瀏覽器 clamp
- 兩段式有兩次替換、lock 機制是否仍有效？

**緩解**：
- `_lockContainerHeight` 在 Stage 1 就呼叫、Stage 2 繼續 active
- 兩段替換 container 高度接近（row 數相同）、clamp 風險低
- **剩餘風險**：若 Stage 2 因同行者補齊比 Stage 1 多幾 row、高度變動、scroll 可能微跳

### 🟢 BUG 7：`_buildConfirmedParticipantSummary` 在 Stage 1 的行為

**情境**：
- Stage 1 呼叫此函式時 cache 可能不完整
- 回傳的 `people` array 可能少人或重複

**緩解**：
- 此函式本來就容錯（來自 `_cache.registrations`、純記憶體計算）
- 即使 cache 不完整、返回結果是「當前 cache 的狀態」、不 throw
- **剩餘風險**：極低——最多顯示人數少於實際、Stage 2 補齊

### 🟢 BUG 8：與候補名單的配合

**情境**：
- 用戶在「管理模式」同時看正取 + 候補
- 候補名單會用 `getRegistrationsByEvent` 過濾 `waitlisted`
- 若 Stage 1 的 registrations cache 不完整、候補名單也會少人
- 但候補已經有既有的「fallback to `event.waitlistNames`」機制

**緩解**：
- 候補既有 `_getWaitlistFallbackNames` 已處理 cache 不完整情境
- 本改動**不動候補邏輯**、不影響
- **剩餘風險**：零

---

## 5. 風險總評

| 項目 | 評分 |
|------|------|
| **🔴 Blocker 風險** | **0**（無災難性 BUG） |
| **🟡 中風險** | **3**（BUG 1-3、都有緩解方案、UX 微瑕疵） |
| **🟢 低風險** | **5**（BUG 4-8、幾乎無影響） |
| **鎖定函式觸及** | **0**（不動 firebase-crud transaction） |
| **Firestore / CF** | **0 改動** |
| **回退難度** | **秒回退**（單一檔案改動、revert 1 commit） |

---

## 6. 可能的副作用（即使沒 BUG）

1. **首次進活動頁 console 多一筆 fetchIfMissing warn**（若失敗）—— 無實質影響
2. **onSnapshot 高頻更新的活動**（例如報名 deadline 前 10 分鐘）DOM 替換從 1 次/100ms 變為最多 2 次/100ms
3. **編輯模式下的放鴿子 badge 短暫不顯示**（Stage 2 被 skip）—— 已在 BUG 1 緩解、是可接受的 trade-off

---

## 7. 驗收清單

### 🔴 必測

- [ ] Stage 1 名單在 < 100ms 內出現（Chrome DevTools Performance tab 量）
- [ ] Stage 2 替換後放鴿子 badge、分隊顏色、完整簽到狀態全部正確
- [ ] `npm run test:unit` 2381 全綠（含既有所有 attendance 測試）
- [ ] 編輯簽到模式下、Stage 2 不會覆蓋編輯狀態

### 🟡 建議測

- [ ] 慢網路（Chrome throttle Fast 3G）下 Stage 2 的體感
- [ ] 連續快速進出活動頁（切活動→返回→再切同一活動）無 race
- [ ] 同時開管理模式（正取 + 候補）無打架

### 🟢 可略

- [ ] 放鴿子統計數 > 100 活動的用戶、Stage 2 體感
- [ ] 分隊活動的球衣顏色、Stage 2 是否正確排序

---

## 8. 回退策略

單一 commit revert、5 分鐘：
```bash
git revert <commit-hash>
node scripts/bump-version.js
npm run test:unit
git push origin HEAD:main
```

**無資料風險**（純 render 邏輯變動、不動 transaction）。

---

## 9. 替代方案（若不想做兩段式）

若你覺得 BUG 風險太高、也可以考慮：

**A. 縮防抖時間 100ms → 50ms**（最保守、收益 50ms）
- ✅ 零 BUG 風險
- ❌ 主要瓶頸（Firestore await）仍在、收益小

**B. `fetchIfMissing` 的條件更嚴格**（cache 明顯夠完整時跳過）
- ✅ 風險低
- ❌ 需重新定義「夠完整」語意、可能遺漏邊緣情境

**C. 純 skeleton 優化**（Stage 1 只顯示 skeleton、不顯示名字）
- ✅ 風險極低
- ❌ 沒真正解決「體感慢」問題、只是換個 UI 告訴用戶在 loading

**D. 維持現狀**
- ✅ 零風險
- ❌ 候補快、正取慢的差異繼續存在

---

## 10. 動工授權建議

| 選項 | 風險 | 收益 | 建議 |
|------|------|------|------|
| **方案 A 兩段式（本計畫）** | 🟡 3 中風險、5 低風險 | 首見名字從 330-990ms 縮為 < 50ms | ✅ **推薦**（若用戶常抱怨慢） |
| **方案 B `fetchIfMissing` 條件化** | 🟢 極低 | 最多快 50% | 中庸之選 |
| **方案 C skeleton** | 🟢 極低 | UX 改善但不真快 | 快速上手 |
| **方案 D 不動** | 🟢 零 | 無 | 若覺得現況可接受 |

---

**計畫書版本**：2026-04-23 v1
**維護者**：Claude
**自審等級**：完成 1 輪、找到 8 個 BUG 點、3 中 5 低、均有緩解方案
