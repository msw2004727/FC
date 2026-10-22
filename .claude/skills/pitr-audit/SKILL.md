---
name: pitr-audit
description: 正式 Firestore 疑似被錯誤寫入（覆寫成預設值、欄位被清空、誤改）時使用：在 PITR 保留期（7 天）內以唯讀 REST 讀回歷史版本、建每小時時間線並二分到分鐘、找出誰在何時改了哪些欄位、分類可自動回填／需人工確認，產出遮罩報告與修復草案（不執行）。修復寫入本身仍是 GATED。
---

# pitr-audit

正式 Firestore（`fc-football-6c8dc`）有開 PITR，保留 7 天；`readTime` 讀取不算寫入。誤寫事件發生後要**在 7 天內**跑完，否則只剩每日備份（整庫層級、成本高）。（2026-10-22 T-014 首建；參考實作在 FC local-only `tools/audit/b-edit-overwrite/audit.cjs`，含離線假 Firestore 模擬做法。）

## 什麼時候用

- 某版程式把共用資料寫成預設值／空值，要盤點受害文件與原值（T-014：B 編輯活動覆寫加值欄位、委託人、封面）。
- 要確認某欄位「何時、從什麼值變成什麼值」，且變化在 7 天內。

## 流程

1. **先確認保留期**：`gcloud firestore databases describe --database="(default)" --project fc-football-6c8dc` 看 `earliestVersionTime`。
2. **寫規格派工**（delegate skill，DeepSeek `--effort low`）。規格要寫死：
   - 唯一網路出口 `readOnlyPost(endpoint, body)`，第一行斷言只放行 `documents:runQuery`、`documents:batchGet`；不得引入 firebase-admin／`@google-cloud`，不得出現 `:commit`、`:batchWrite`、transaction、PATCH／DELETE／PUT。輸出欄位名也避開 update／delete 字樣，方便 grep 斷言。
   - token 用 `gcloud auth print-access-token`（`CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1`），只放記憶體；401 重取一次。
   - 請求數、讀取文件數、候選數都要有硬上限，超過就停並在報告標 `aborted`。
   - 觀察欄位清單＋「錯誤寫入的值」（例如 B 預設值）由 PM 從原始碼抄出，不讓模型猜。
3. **候選**：用「錯誤寫入一定留下的指紋」查（例：`image == ''`），再聯集「事件起點後 `updatedAt` 有變」的文件。查詢 limit 要放寬到過濾**之後**才套候選上限（第一版先套上限會把無關文件算進去）。
4. **時間線**：保留期內每整點用 `batchGet`＋`readTime` 一次讀全部候選（≤100 份一批）；`readTime` 必須整分鐘，超出保留期回 400，標 unreadable 跳過。
5. **精化**：有變化的小時格用二分法找到分鐘；**同一格要逐段找出所有變化點**（每段 before＝上一段變化後的狀態），否則「A 先正當修改、錯誤寫入在同一小時後發生」會漏掉錯誤寫入，原值也會取錯（Gemini 第一輪抓到的 P0）。
6. **歸因**：拿 `operationLogs`（A 的 `event_edit`）比對時間；查詢要**以候選 id 分批 `eventId IN`（每批 30）**，不要用 `type ==` 再 limit（歷史一多就漏近期紀錄）。錯誤寫入後（含前 1 分鐘）有任何 A 編輯 → 需人工確認。
7. **輸出**（全部放 `tools/`，不進 Git）：完整 `report.json`、遮罩 `report.md`（委託人只留數量、連結只留網域、uid 用 `actor-0001`、寫完自我檢查 email／LINE uid／URL／20 碼以上長 id，欄位名與文件 id 要列白名單）、修復草案（原始 REST Value＋`precondition.updateTime`＋冪等鍵）、現值備份。
8. **審查**：Gemini 4 審零寫入／token／遮罩／分類誤判情境；附上離線模擬報告讓它能實際檢查遮罩。
9. **離線模擬**：用 `node -r ./mock.cjs audit.cjs` 攔截 `child_process.spawnSync`（假 token）與 `global.fetch`（假 Firestore，非 runQuery／batchGet 一律丟錯），至少模擬：單純錯誤寫入、同小時 A 先改再錯誤寫入、錯誤寫入早於保留期、不該納入的文件、未受影響文件。
10. **正式執行前要人放行**：auto mode 分類器會擋「對正式資料執行腳本」，不要繞過、不要請其他 session 代跑；回報指揮官／站長，由站長在該 session 放行或自己執行。
11. **獨立抽查**：另寫小程式用 REST GET（可帶 `?readTime=`）重讀 3 筆現值與 1～2 個變化點前後，只印「一致／不一致」；再以另一寫法重跑指紋查詢、`updatedAt` 倒序前 N 筆核對名單（字串型 updatedAt 在倒序會排最前，順便排除型別漏網）。

## 坑

- Bash heredoc 裡寫 `\r\n` 這類反斜線會被吃掉，產生壞掉的正規表示式；含反斜線的修補用 Edit 或以 bytes 寫入。
- DeepSeek 交件常包在 Markdown 圍欄、沒有 FILE 標記，split-loose 切不出來，要自己從圍欄取出。
- `Object.create(null)` 會讓 grep `\.create\(` 誤報，斷言時排除。
