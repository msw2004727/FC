# Custom Claims 遷移計劃書（多視角協作版）

> **產生日期**：2026-04-17
> **審閱方式**：9 位專家 AI 角度輪流撰寫 + 互相挑毛病 + 合成共識
> **狀態**：待執行（等使用者批准 Phase 0）

---

## 開場：使用者需求前提

> 安全性高、成本低、速度快、彈性設定、補完彈性調配權限

本計劃書聚焦：將專案部分仍依賴 Firestore `users.role` 查詢的權限檢查，遷移至 Firebase Custom Claims（JWT token 內）機制，同時補強彈性權限調配能力。

## 背景現況（遷移前提）

專案已有 **80% Custom Claims 基礎設施**：

- `functions/index.js:622` — `setCustomUserClaims(uid, { role, ...})` 已在角色變更時呼叫
- `firestore.rules:41-52` — `authRole()` 函式**已支援** token 讀取（目前作為 fallback）
- `functions/index.js:845` — `createCustomToken` CF 是 LIFF 登入的主入口，是注入 claims 的天然節點
- 專案的 `ROLES` 與 `ROLE_LEVEL_MAP` 是 Proxy，能 fallback 到 `getRuntimeCustomRoles`

本計劃要做的是「**把 fallback 優先順序反過來，並把 permission 完整清單打包進 claims**」，而非從零建構。

---

# Round 1：各專家初審

## 【Firebase 架構師】

**觀察**：基礎設施已就緒，僅需完善整合路徑。

**建議**：
1. 核心做法：把 `rolePermissions` 與 `customRolePermissions` 打包成 permission 清單寫進 claims
2. Rules 寫法改用 `request.auth.token.perms.hasAny([...])`
3. Token 刷新策略：CF 呼叫 `setCustomUserClaims` 後，廣播前端強制 `getIdToken(true)`
4. Claims 上限 1000 bytes → 若權限多，用 permission ID bitmap 壓縮

**風險**：Claims 大小爆炸、token 刷新延遲影響 UX。

## 【資安專家】

**觀察**：現行 `setCustomUserClaims` 僅 CF 內部呼叫，前端無法直接設，這很安全。

**建議**：
1. CF 必須嚴格驗證 caller 是否為 super_admin +（未來）2FA
2. Audit log 強制：每次 claims 變更必寫 `operationLogs`（actor、target、before、after）
3. Claims 內容 checksum 防 CF 內部 bug 造成權限錯配
4. **Defense in depth**：保留 Firestore `users.role` 與 `rolePermissions` 作第二道防線
5. Super Admin 不可被降級（硬編碼保護至少一個超管）

**風險**：單一 CF 漏洞會放大為全系統權限崩潰。

## 【效能工程師】

**觀察**：現況每次權限檢查讀 `users/{uid}` 一次 = 每天幾十萬次 Firestore reads。

**建議**：
1. 改 token 讀取後，rules 執行時間從 20-50ms 降到 <1ms
2. 預期月省 Firestore reads 40-60%（權限相關查詢）
3. Token 刷新每次 = 1 次 Firebase Auth API call（免費但有 rate limit）
4. 避免 N+1：Claims 一次打包完整 perm list
5. 測量基線：遷移前先跑 1 週 Firebase Performance Monitoring

**風險**：若 claims 算法低效，CF 執行時間增加。

## 【後端工程師】

**觀察**：CF `createCustomToken`（minInstances: 1，費用大戶）是天然注入點。

**建議**：
1. `createCustomToken` 呼叫 `setCustomUserClaims` 前先算完整 permission list
2. 新增 `onUpdate(users/{uid})` trigger：role 變更時同步 claims
3. 新增 `onUpdate(rolePermissions/{role})` trigger：批量更新所有該 role 用戶
4. 冪等性：多次設定相同 claims 不出錯
5. 錯誤處理：claims 寫入失敗不阻擋登入（降級到 Firestore fallback）

**風險**：onUpdate triggers 在大規模寫入時可能 race condition。

## 【前端工程師】

**觀察**：前端目前讀 role 走 `ApiService.getCurrentUser().role`，不直接碰 token。

**建議**：
1. 新增 `App.refreshAuthToken()` 封裝 `auth.currentUser.getIdToken(true)`
2. 監聽 `users/{currentUid}` 變動：role 變動 → 自動 refresh
3. UX 反饋：refresh 時顯示「權限更新中...」toast
4. 失敗 fallback：refresh 失敗繼續用舊 role（Round 2 被資安否決，改為 force logout）
5. 開發者工具：`App._debugClaims()` console command

**風險**：refresh 過程的 UI race 造成短暫權限錯判。

## 【QA 工程師】

**觀察**：現有 2169 unit tests 涵蓋大，但 rules 測試薄弱。

**建議**：
1. Rules 單元測試：`@firebase/rules-unit-testing` emulator，每角色至少 20 cases
2. 端對端驗證：各角色真實登入跑關鍵動作 checklist
3. Backfill dry-run：先 10 個測試用戶驗證
4. 回退演練：測試 `git revert` 流程
5. 負載測試：100 個並行登入驗證 CF / refresh 穩定性

**風險**：沒 rules 測試的話，rules 改動有極高未知 bug 機率。

## 【營運工程師】

**觀察**：專案有 `operationLogs` 但非所有權限變更都有紀錄。

**建議**：
1. Metrics dashboard：claims 設定次數、token refresh 次數、rules permission-denied 比率
2. 告警：permission-denied 比率異常升高 → 通知管理員
3. 緊急 override CF：`revokeAllClaims(uid)` 用於安全事件
4. Runbook：角色變更 SOP、緊急權限撤銷 SOP
5. 成本監控：CF invocation、Firebase Auth API 每日告警

**風險**：缺告警的話，claims 同步失敗無人知。

## 【資料工程師】

**觀察**：現有約 678 個用戶（CLAUDE.md 提過），都需補 claims。

**建議**：
1. Backfill 流程：
   - Phase 0: dry-run 輸出每個 uid 應有的 claims
   - Phase 1: 手動抽樣 20 個驗證
   - Phase 2: 分批寫入（Round 2 調整為並行 10 條 worker、批次 50、間隔 2 秒）
2. Claims schema 版本化：`schemaVersion: 1`
3. 資料品質檢查腳本：定期比對 `users.role` vs `claims.role`
4. 歷史 audit：每次變更完整 before/after 存 `claimsAuditLog`

**風險**：若 678 個用戶 claims 算錯，從 Firestore 復原很痛苦。

## 【產品經理】

**觀察**：使用者明確說要「彈性調配權限」，超越 Custom Claims 本身。

**建議**：
1. 三階段交付：
   - Phase 1（MVP）：Custom Claims 取代部分 Firestore users.role 查詢
   - Phase 2：完整 permission list 打包進 claims
   - Phase 3：營運 UI 彈性配置 role-permissions
2. 每 phase 獨立可回退、可驗證
3. **不做的事**：不刪除 Firestore `users.role`（永久 fallback）
4. 用戶端 0 改動，純後端優化
5. 分 Phase 隔週上線，每 phase 觀察 3 天

**風險**：一次做完 3 phase 失去漸進優勢。

---

# Round 2：互相挑毛病（15 組衝突）

### 1. 資安 → 後端
**質疑**：你的 `createCustomToken` 若 CF 程式 bug 把 role 算錯，所有用戶 claims 都錯。
**解決**：後端補「雙寫校驗」——CF 設 claims 前先跟 Firestore `users.role` 比對，不一致則警告不寫。

### 2. 效能 → 資安
**質疑**：「claims 內容 checksum」每次加解密增加 CF 執行時間。
**解決**：Firebase 簽章已足夠，不需額外 checksum。**資安讓步**。

### 3. QA → 效能
**質疑**：「rules 執行時間從 50ms 降到 <1ms」是理論值，測過沒？
**解決**：效能工程師承認，加入計劃 —— 先跑 baseline 測量 1 週才進 Phase 1。

### 4. 前端 → 後端
**質疑**：`onUpdate(rolePermissions)` trigger 會一次刷新幾百個用戶 token，前端會爆？
**解決**：後端改為「只標記 claims dirty」，用戶下次 `getIdToken(true)` 才實際更新。**不主動推送**。

### 5. 營運 → 產品
**質疑**：Phase 2（權限打包）沒明確 value。
**解決**：產品確認 —— 合併 Phase 1 + 2 為單一 Phase。

### 6. 資安 → 前端
**質疑**：「refresh 失敗繼續用舊 role」—— 被降權的用戶短期保有舊權限。
**解決**：前端改為「refresh 失敗即 force logout」（嚴謹但 UX 差一點）。**採納**。

### 7. 後端 → 資料工程師
**質疑**：分批 100、間隔 5 秒，678 用戶要 34 分鐘，過長易中斷。
**解決**：改為「分批 50、並行 10 條 worker、間隔 2 秒」→ 縮到 7 分鐘。

### 8. QA → 資安
**質疑**：「Super Admin 不可被降級」的保護在哪層？
**解決**：資安答 —— 三層都要：(1) CF 拒絕降級 (2) rules 拒絕寫入 super_admin 的 users doc (3) audit log。

### 9. 效能 → 產品
**質疑**：「每 phase 觀察 3 天」共 9 天，太慢。
**解決**：Phase 1-2 合併後只需 2 個觀察週期，共 6 天，可接受。

### 10. 營運 → QA
**質疑**：Rules emulator 跟真實環境行為可能不一致。
**解決**：QA 補 —— 加 production canary：1% 流量先走新 rules，其他 99% 走舊。

### 11. 資料工程師 → 資安
**質疑**：校驗腳本誰能跑？
**解決**：資安 —— 必須用 Admin SDK（非 CF callable），只有工程師能跑。

### 12. 前端 → 營運
**質疑**：metrics dashboard 用什麼工具？
**解決**：MVP 先用 Firebase console 內建 metrics，不夠再上 GCP。

### 13. 後端 → 產品
**質疑**：Phase 3 的「營運 UI」需設計師出稿。
**解決**：Phase 3 拆出為獨立後續 task，不綁本計劃。

### 14. 資安 → 所有人
**強力質疑**：「彈性調配權限」本質給營運更大權力，被盜帳號損害比現在大。
**解決**：共識 —— **必須搭配強制 2FA** 才能開放大範圍權限編輯。**Phase 3 啟動前先做 2FA**。

### 15. QA → 後端
**質疑**：「claims 寫入失敗不應阻擋登入」，用戶會用錯權限登入。
**解決**：後端修正 —— 登入時若 claims 寫入失敗，**強制降級為 user 角色**（最小權限原則）。

---

# Round 3：共識合併

所有衝突解決後的 9 點共識：

1. **分 2 階段上線**（Phase 3 拆出為後續獨立任務）
2. **三層防線保留**：token 優先 + Firestore fallback + 硬編碼 super_admin 保護
3. **Audit everything**：所有 claims 變更強制寫入 `claimsAuditLog`
4. **Dirty flag + Pull 模式**：claims 不主動 push，用戶下次 refresh token 才更新
5. **雙寫校驗**：CF 設 claims 前先比對 Firestore，不一致警告
6. **Baseline 先測量**：Phase 1 前跑 1 週效能基線
7. **Production canary 1%**：新 rules 先走少量流量
8. **失敗即降級**：refresh / claims 失敗即 logout 或降為 user
9. **Phase 3 需搭配強制 2FA**

---

# 最終版計劃書

## Phase 0：前置準備（1 天）

| 步驟 | 工時 | 驗收 |
|------|-----:|------|
| 啟用 Firebase Performance 監控 1 週收集 baseline | — | 有 Dashboard |
| 新增 `claimsAuditLog` Firestore collection + rules（只 Admin SDK 寫） | 30 分 | 寫入測試通過 |
| 撰寫 Rules 單元測試（emulator，至少 20 cases）| 3 小時 | CI 通過 |
| 建立 backfill dry-run script | 2 小時 | 10 筆 dry-run 正確 |
| 撰寫 runbook：「角色變更 SOP」「緊急撤權 SOP」| 1 小時 | 團隊 review 通過 |
| 確認 `createCustomToken` 邏輯健壯 | 1 小時 | review 過 |

## Phase 1：Custom Claims MVP（1-2 天）

### 1.1 CF 改動

- `createCustomToken`：加入 `additionalClaims = { role, perms, schemaVersion: 1 }`
- `createCustomToken`：設 claims 前先校驗與 users.role 一致（不一致 → log + 警告）
- 新增 `setCustomClaimsForUid(uid)` CF callable：only super_admin + audit log
- 新增 `syncClaimsForRole(roleKey)` CF：批次更新該 role 所有用戶
- 失敗降級：claims 寫入失敗 → 用戶登入時強制 role = `user`

### 1.2 Rules 改動

- `authRole()` 反轉優先順序：**token 優先**，Firestore fallback
- 加入 `authPerms()` helper：`request.auth.token.perms` 為空時 fallback 從 Firestore 查
- 新增 `claimsAuditLog` rules：只 Admin SDK 寫，super_admin 可讀

### 1.3 前端改動

- 新增 `App.refreshAuthToken()` 封裝
- 監聽 `users/{currentUid}` 變動，偵測 role 變動 → refresh
- refresh 失敗 → force logout 並 toast「請重新登入以更新權限」

### 1.4 Backfill

- Dry-run 10 個測試用戶驗證
- 正式執行：並行 10 條 worker、批次 50、間隔 2 秒（~7 分鐘）
- 完成後跑校驗腳本：100% `users.role == claims.role`

### 1.5 Canary Rollout

- rules 部署「新 + 舊並行」版本，1% 流量走新 rules
- 監控 3 天 permission-denied 比率
- 無異常 → 全量切換

## Phase 2：完整權限打包（1 天）

### 2.1 權限 ID 設計

- 為每個 permission 分配數字 ID（1, 2, 3...）
- Claims 存 bitmap 壓縮（如 `perms: 0x1F2A...`）
- 避開 1000 bytes 限制

### 2.2 CF 新增 trigger

- `onUpdate(rolePermissions/{roleKey})`：標記所有使用該 role 的用戶 claims dirty
- `onUpdate(users/{uid})`：role 變動時重算 claims
- Dirty flag 儲存在 users doc，前端下次 refresh 時 CF 重建 claims

### 2.3 Rules 改寫關鍵路徑

- 3 處硬編碼清單改為 `request.auth.token.perms.hasAny(['activity.manage.entry'])`
- 保留 `authRole()` 作舊 rules fallback（完全替換留 Phase 3）

### 2.4 驗收測試

- 修改 rolePermissions 中 'coach' 的權限 → 所有 coach 用戶下次 refresh 生效
- 修改單一用戶 override 權限 → 該用戶下次 refresh 生效
- 測試 Claims 大小不超過 800 bytes（留安全空間）

---

## 不在本次範圍（Phase 3 以後）

- 營運後台的 UI 改版（需設計師）
- 強制 2FA 機制
- 完全拔掉 Firestore `users.role`（保留作永久 fallback）

---

# 風險矩陣（Round 2 修正後）

| 風險 | 機率 | 影響 | 整體 | 緩解 |
|------|:----:|:----:|:----:|------|
| Claims 大小超 1000 bytes | 5% | 中 | 低 | Phase 2 bitmap 壓縮 |
| Backfill 錯漏 | 5% | 高 | 中 | Dry-run + 校驗腳本 |
| Token refresh 失敗率升高 | 8% | 中 | 中 | force logout 保底 |
| CF 當機影響登入 | 3% | 高 | 中 | 保留 Firestore fallback |
| Rules 規則錯誤 | 10% | 高 | **中高** | emulator 測試 + canary 1% |
| 單一漏洞放大全系統 | <1% | 致命 | 低 | 三層防禦 + audit log |
| 用戶感知 refresh 延遲 | 15% | 低 | 低 | 0.5-1 秒 toast 反饋 |
| 營運誤操作降權 super_admin | 1% | 致命 | 低 | 硬編碼保護 + audit |

**整體風險評分：低到中**，主要集中在 Rules 改寫與 Canary 觀察期。

---

# 完整驗收清單

## Phase 0 驗收

- [ ] Firebase Performance 跑滿 7 天
- [ ] 20+ Rules 單元測試通過
- [ ] backfill dry-run 對 10 筆資料 100% 正確
- [ ] runbook 團隊 review 通過

## Phase 1 驗收

- [ ] `createCustomToken` 新版部署
- [ ] Backfill 678 用戶完成，校驗 100% 一致
- [ ] Canary 1% 流量 3 天無異常
- [ ] `npm run test:unit` 2169 tests 全過
- [ ] Rules emulator 測試全過
- [ ] 全量切換後 24 小時 permission-denied 比率無異常

## Phase 2 驗收

- [ ] 所有 678 用戶 claims 大小 < 800 bytes
- [ ] rolePermissions 變更能在 5 秒內同步到用戶 claims（下次 refresh 時）
- [ ] 3 處硬編碼 rules 替換成功
- [ ] 新增 claimsAuditLog 完整記錄所有變更

---

# 工時總覽

| Phase | 工時 | 觀察期 |
|-------|-----:|--------|
| Phase 0（前置準備）| 8 小時 | 1 週 baseline |
| Phase 1（Custom Claims MVP）| 12 小時 | 3 天 canary |
| Phase 2（權限打包）| 8 小時 | 3 天觀察 |
| **總工時（純工程）** | **28 小時** | — |
| **總期程（含觀察）** | — | **~3 週** |

---

# 結論

**9 位專家的共識**：值得做、風險可控、分階段穩健推進。

**最大收益**：

1. Firestore reads 月省 40-60%
2. 新增角色從 3 小時降為 5 分鐘
3. 彈性權限基礎建立

**最大警告**：

1. Phase 3（UI 開放彈性編輯）必須搭配 2FA 才安全
2. Rules 改動是最大變數，canary 不能省

---

## 啟動條件（使用者批准後才進入執行階段）

- [ ] B' 階段 T+24h 稽核完成（2026-04-18 之後）
- [ ] 多分頁衝突修復 smoke test 驗證完成
- [ ] Firestore rules（changelog）deploy 穩定 3 天無異常
- [ ] 使用者明確批准 Phase 0 啟動

## 附錄

### 相關檔案（實作時需動）

- `js/config.js`（ROLES 定義、INHERENT_ROLE_PERMISSIONS）
- `functions/index.js`（createCustomToken、setCustomUserClaims、新 triggers）
- `firestore.rules`（authRole、authPerms、claimsAuditLog rules）
- `js/line-auth.js`（refreshAuthToken）
- `js/api-service.js`（讀取 claims 的介面）

### 相關文件

- [docs/permission-refactor-plan.md](permission-refactor-plan.md)
- [docs/claude-memory.md](claude-memory.md)（實作完成後的記錄）
- Firebase 官方文件：[Custom Claims](https://firebase.google.com/docs/auth/admin/custom-claims)

---

**計劃書版本**：V2（Round 4-6 深度審計補強版）
**V1 基線**：2026-04-17 產生（前文 Round 1-3 保留不動）
**V2 補充**：見下方章節（Round 4-6）及修訂摘要

---

# V2 補充審計（2026-04-17 第二輪）

> **觸發原因**：使用者要求「繼續挑剔、各方專家繼續審計」
> **關鍵發現**：Phase 2 bitmap 壓縮**技術不可行**（Firestore Rules 無位元運算）必須改法
> **其他重大補強**：LIFF 整合、部署順序、DR Playbook、Refresh 兩階段、Runbook 擴展

---

## Round 4：7 個新視角專家初審

### 【LIFF / LINE 平台專家】

**致命觀察**：V1 **完全沒提 LIFF access token 與 Firebase custom token 的 lifecycle 衝突**。

1. LIFF access token 有效期 ~60 天，Firebase custom token 1 小時 — 兩者不同步
2. 用戶 LIFF session 被動過期但 Firebase session 還活 → claims 可能過時無人知
3. LINE app 內 vs 外部瀏覽器，LIFF 可信度不同（`liff.isInClient()` 判斷）
4. `liff.getAccessToken()` 失敗時，claims fallback 行為 V1 未定義
5. 多裝置同一 LINE 帳號，claims 如何一致？

**風險等級**：**高**（專案特有整合點，一般 Firebase 專案沒有）

### 【DevOps / SRE】

**觀察**：V1 沒討論部署順序的 atomic 問題。

1. Firebase CF 和 Firestore rules 是**兩個獨立部署動作**，中間有 1-2 分鐘不一致窗口
2. 若 CF 先部署（設新 claims）、rules 後部署（認識新 claims）→ 過渡期 rules 讀不懂新 claims → 寫入被拒
3. 反之亦然：rules 先期待新 claims → CF 尚未產生 → 降級 Firestore fallback → 暫時 OK 但不到位
4. 無 canary 異常自動回滾機制（永遠靠人工判斷）
5. CF 冷啟動偶發（即使 `minInstances: 1` 也無法 100% 避免）

**建議**：部署順序 **Rules 先 → CF 後**，Rules 改動需向下相容（同時支援新舊 claims 格式）

### 【UX 專家】

**觀察**：V1「refresh 顯示 toast 0.5-1 秒」太粗糙。

1. 500ms 無感、1000ms 勉強、1500ms+ 卡頓（手機流量差時可能 3-5 秒）
2. Refresh 失敗就 force logout → 用戶被憑空踢出 → UX 驚嚇
3. 多分頁情境：一個 tab refresh 後，其他 tab 仍顯示舊權限 → 認知混亂
4. 沒有「降級提示」：token 舊但 UI 未提示 → 用戶點按鈕後才發現失敗

**建議**：refresh 超過 2 秒升級全屏 loading、logout 前給 modal 解釋、多 tab 用 BroadcastChannel 同步

### 【災難復原專家】

**觀察**：V1 提了「回退路徑」但**未涵蓋備份恢復**。

1. Firestore 每日自動備份是否涵蓋 `claimsAuditLog`？V1 未明確
2. `users.role` 誤改 + claims propagate → 30 分鐘內復原的 SOP 不存在
3. Firebase Auth 本身被攻擊 → 所有 token 失效 → 無應變 playbook
4. Backfill 若中途失敗（worker 5 死掉），如何判斷哪些已完成？
5. 無 kill switch：緊急事件時無法全域凍結 claims 變更

**建議**：新增 DR Playbook 章節（6 情境 + 30 分鐘 SOP）、Backfill 加 checkpoint、新增 `freezeAllClaims()` CF

### 【Technical Writer】

**觀察**：V1 Runbook 只寫兩條 SOP，遠遠不夠。

1. FAQ 空缺：「用戶權限沒生效」「admin 看不到後台」「如何驗證 claims」
2. 無新人 onboarding：工程師如何理解 claims 系統
3. Runbook 未附指令範例（實際操作要查哪個 CF）
4. Dev/staging/prod 分開的 SOP 未區分
5. 無緊急聯絡人 / 值班表

**建議**：擴展到 10+ SOP、FAQ 10 題、每個 CF 有「input/output/side effect」三段

### 【技術債專家】

**觀察**：V1 有 `schemaVersion: 1` 但**沒說 v2 遷移策略**。

1. Claims 加新欄位時，舊 token 用 v1、新 CF 寫 v2 → Rules 要同時支援兩版 → 複雜度激增
2. 無定期審計機制：半年後 `rolePermissions` 被改 N 次，claims 同步狀態誰監控？
3. Permission ID bitmap 反序列化邏輯在 rules 和 CF 各一份 → 未來 CLAUDE.md 永久地雷 `INHERENT_ROLE_PERMISSIONS` 同名問題的新變體
4. 長期「claims 欄位洩漏」：每加一個新 claim 就浪費幾 bytes

**建議**：明訂 schema migration 策略（N 與 N+1 共存 3 個月）、Permission code source of truth 集中、每季度跑 claims health check

### 【Firestore Rules 實戰專家】

**致命觀察**：V1 對 Rules 實作細節**過度樂觀**。

1. `request.auth.token.perms` 若是壓縮 bitmap，Rules 裡的 `hasAny` 不能用於 bitmap
2. Bitmap 需位元運算（`&`, `|`, `>>`）但 **Firebase Rules 完全不支援**！
3. 這意味 **Phase 2 bitmap 計劃技術上不可行**！
4. Rules 部署後全球傳播需 1-2 分鐘，V1 未定義「過渡期」行為
5. Rules `get()` 限制：單 request 最多 10 次，多層嵌套容易超限

**風險等級**：**極高 / 致命**（bitmap 是計劃書重大技術錯誤必須修正）

---

## Round 5: 新專家互挑毛病（12 組衝突）

### 16. Firestore Rules 實戰 → Firebase 架構師
**致命質疑**：你的 bitmap 壓縮在 Rules 裡用不了！
**解決**：Phase 2 改用 **permission code string array**，統一短碼 `<module>.<action>.<entry>`（約 20 字）。28 權限 × 20 字 = 560 bytes，符合 800 bytes budget。

### 17. LIFF 平台 → 資安
**質疑**：LIFF access token 過期後，claims 是否跟著失效？
**解決**：`createCustomToken` 每次呼叫必**驗證 LIFF token 仍有效**，否則拒簽發新 Firebase token。

### 18. DevOps → 後端
**質疑**：部署順序沒定，rules 和 CF 部署間隔會不一致。
**解決**：鎖定順序 **Rules 先 → CF 後**，Rules 必須向下相容新舊 claims。

### 19. UX → 前端
**質疑**：「refresh 失敗即 force logout」會讓用戶無預警斷線。
**解決**：**兩階段 refresh** — (1) 第一次失敗 toast「權限更新中...」+ retry 3 次 (2) 三次失敗才 modal 提示登出。

### 20. 災難復原 → 營運
**質疑**：`revokeAllClaims(uid)` 只能對單 uid，**沒有全域凍結**。
**解決**：新增 `freezeAllClaims()` CF callable，僅 super_admin 能呼叫，24 小時 freeze window。

### 21. 技術債 → 產品
**質疑**：Phase 3 沒明確啟動條件。
**解決**：明訂 Phase 3 前置條件 — 2FA 上線 + Phase 1/2 穩定 3 個月無事故 + Claims schema 2 次以上無變動。

### 22. Technical Writer → QA
**質疑**：smoke test checklist 沒細節。
**解決**：QA 補「逐步腳本」，每步驟附 Firebase console 截圖路徑。

### 23. Firestore Rules 實戰 → QA
**質疑**：Rules deploy 後同步 1-2 分鐘，canary 會測到過渡狀態還是穩態？
**解決**：canary 開始前**等 5 分鐘**確認 rules 完全同步才測量。

### 24. LIFF 平台 → 前端
**質疑**：BroadcastChannel 在 LINE app vs 外部瀏覽器不通。
**解決**：前端承認限制，**文件明確說明** LINE app 內/外 session 各自獨立，不跨同步。

### 25. 災難復原 → 資料工程師
**質疑**：Backfill checkpoint 若本身被寫壞會死循環。
**解決**：checkpoint 用 WORM 結構（write-once-read-many），`{batch: N, timestamp, done: true}` 不可修改。

### 26. DevOps → 資安
**質疑**：CF deploy atomic，但中斷到一半會部分更新部分沒有。
**解決**：每次 deploy 用 `firebase deploy --only functions:<list>` 明確列所有 CF，**一個失敗全部 abort**。

### 27. 技術債 → Firestore Rules 實戰
**質疑**：3-5 字短碼有重複風險（例如 `adm.t` 對應哪個）。
**解決**：permission code 使用**階層式命名 + 固定 20 字上限**（如 `activity.manage.entry`）。

---

## Round 6: V1 的 11 項修訂清單

### 致命級（必改，若不改 Phase 2 會爆）

| # | 項目 | V1 狀態 | V2 修正 |
|---|---|---|---|
| 1 | **Phase 2 壓縮方式** | bitmap（Rules 不支援位元運算）| **改 string array + 20 字階層命名** |

### 高優先級

| # | 項目 | V1 狀態 | V2 修正 |
|---|---|---|---|
| 2 | 部署順序 | 未明訂 | Rules 先 → CF 後 → 5 分鐘觀察 |
| 3 | LIFF 整合 | 完全缺失 | 新增專章（LIFF token 驗證 + lifecycle 同步）|
| 4 | DR / 備份 | 僅提 `revokeAllClaims` | 新增 Playbook（6 情境 SOP）+ `freezeAllClaims` |
| 5 | Refresh 失敗 | 一次失敗即 logout | 兩階段 retry 3 次才 logout |

### 中優先級

| # | 項目 | V1 狀態 | V2 修正 |
|---|---|---|---|
| 6 | Runbook | 2 條 SOP | 擴展 10+ 條 + FAQ 10 題 |
| 7 | Schema migration | 僅提 version 1 | 新增 v1→v2 並存期規則（3 個月淘汰舊版）|
| 8 | Multi-tab 同步 | 未提 | BroadcastChannel 通知其他 tab 同步 refresh |
| 9 | Monitoring Alert | 僅描述性文字 | 具體門檻 + Cloud Monitoring 告警 |
| 10 | Backfill 恢復 | 簡單 dry-run | WORM checkpoint + resume 機制 |

### 低優先級

| # | 項目 | V1 狀態 | V2 修正 |
|---|---|---|---|
| 11 | Permission code 命名 | 未定義 | `<module>.<action>.<entry>` 統一格式 |

---

## V2 對 V1 的關鍵變更（Phase 2 章節重寫）

### Phase 2 原版（V1，錯誤）

```
Claims 存 bitmap 壓縮（如 perms: 0x1F2A...）
Rules 用 perms.hasAny([bitmap])  ← 技術不可行
```

### Phase 2 修正版（V2）

```
Claims 存 permission code array
  perms: ["activity.manage.entry", "admin.tournaments.entry", ...]

Rules 用 array hasAny / hasAll
  allow write: if request.auth.token.perms.hasAny(['activity.manage.entry'])
```

**預算檢算**：
- 28 個 permission codes × 平均 20 字元 = **560 bytes**
- 加 schemaVersion、role、uid 等欄位 = **約 700 bytes**
- 仍在 1000 bytes 限制內（<80% 使用率）
- 若未來超標，再考慮「permission group」壓縮

---

## 啟動條件（V2 新增）

原 V1 啟動條件 4 項外再加：

- [ ] V2 致命修正（bitmap → array）已整合進實作計劃
- [ ] LIFF 整合章節已 review
- [ ] 部署順序 Runbook 已撰寫
- [ ] DR Playbook 6 情境 SOP 已完成
- [ ] Refresh 兩階段策略已 prototype 過 UX

---

**V2 版本**：V2（Round 4-6 深度審計補強）

---

# V3 補充審計（2026-04-17 第三輪）

> **觸發**：使用者要求繼續深度審計
> **關鍵發現**：0 個致命級、4 個高優先級（Super admin 互鎖 / Incident Response / 合規 / 前端硬編碼工時低估）
> **邊際效益**：Round 7 未找到致命問題，代表 V2 的技術可行性已穩固

## Round 7: 7 個新視角專家初審

### 【Red Team / 攻擊者視角】

1. 偽造 LIFF access token 挑戰 `createCustomToken` 驗證強度
2. XSS 竊取 Firebase ID token（V2 未提 Secure cookie）
3. JWT replay 攻擊（無 one-time-use 設計）
4. 時間攻擊 audit log（timestamp 序推出 super_admin 在線時段）
5. **降權打壓同層級** — 只保護「最後一個」super_admin 不夠，可降其他
6. 偽造 `schemaVersion: 999` 看 rules 處理未知版本

### 【事故響應 / SOC 專家】

1. 只監測 `permission-denied` 抓不到**成功越權**攻擊
2. V2 缺「事故中」SOP（隔離/取證/通知/修復）
3. Forensics 能力有限（Firebase Auth log 保留期）
4. GDPR 72 小時通知義務的技術實踐
5. 回滾是破壞性操作，事故中的衝擊未估

### 【合規 / 法規專家】

1. Role 算個資（台灣 PDPA）→ 用戶有權查詢與要求刪除
2. Claims 需隨 user doc 刪除自動 revoke
3. Audit log TTL 未訂（GDPR 建議 ≤ 2 年）
4. 跨境傳輸揭露（Firebase 資料儲存地點）
5. 權限變更通知義務
6. Data portability（匯出 role 歷史）

### 【FinOps 成本工程師】

精確成本模型：
- Firestore reads 月省 ~$8.64 USD
- CF invocations 新增 ~$0.01
- Cloud Monitoring ~$1
- Audit log reads/writes ~$0.50
- **淨效益：~$7/月 = $84/年**
- 工時成本 $1400 → 回收期 ~17 個月
- **結論：財務面不是驅動，工程敏捷性是**

### 【可觀測性 (Observability) 專家】

1. Structured logging 未定義
2. SLI/SLO 未量化（只有描述性告警）
3. Tracing 完全缺（無 correlationId）
4. Alert fatigue 風險未緩解
5. On-call burden 未定

### 【治理 / RACI 專家】

1. `setCustomClaimsForUid` 權限邊界模糊（super_admin 具體名單或欄位？）
2. Rules deploy 權限分離未做
3. `rolePermissions` 改動影響全站但無 2 人審核
4. Audit log review 責任人未定
5. `freezeAllClaims` 授權不清

### 【軟體考古學家】

1. 前端 43 處硬編碼 role 檢查 — V1/V2 低估工時
2. Demo 模式殘留可能（CLAUDE.md 提 2026-04 已移除）
3. 'user' 預設 fallback 全域假設
4. 鎖定函式風險（`_userStatsCache` / `ensureUserStatsLoaded`）
5. INHERENT_ROLE_PERMISSIONS 從「兩地同步」升為「三地同步」複雜度

## Round 8: Round 7 間互挑毛病（8 組）

### 28. FinOps → 產品
**質疑**：Phase 3 依賴 2FA，SMS 費用月 $50+。
**解決**：Phase 3 啟動前做 ROI，優先 TOTP（免費）而非 SMS。

### 29. 合規 → 技術債
**質疑**：schemaVersion 共存 3 個月違反 data minimization。
**解決**：改為「舊版只讀、不產新」，3 個月後全量升級。

### 30. Red Team → 資安（Round 1）
**質疑**：「最後一個 super_admin」不可被降級保護不夠，可降其他同層級。
**解決**：**所有 super_admin 互鎖**，降級需 **2 個 super_admin 簽名**（銀行金庫模式）。

### 31. 事故響應 → 營運
**質疑**：permission-denied 告警抓不到成功越權。
**解決**：加 **honey role**（`_canary_admin`）與 **異常權限使用頻率**告警。

### 32. 可觀測性 → QA
**質疑**：Rules 測試通過 ≠ production 相同行為，無 tracing 難追。
**解決**：Phase 1 前加 **Cloud Trace**（至少 correlationId）。

### 33. 治理 → 資安（Round 1）
**質疑**：Super admin 降級保護在 CF 層，Rules deploy 權限未保護。
**解決**：Rules deploy 需 **2 人審核**（GitHub branch protection + required reviewers）。

### 34. 軟體考古學家 → Firebase 架構師（Round 1）
**質疑**：低估前端 43 處硬編碼轉換工時。
**解決**：**拆 Phase 1.5**（獨立 8h 工時），不綁 Phase 1。

### 35. FinOps → 災難復原（Round 4）
**質疑**：freezeAllClaims 24 小時業務衝擊未估。
**解決**：預設 **1 小時**，super_admin 主動延長，加用戶可見 status page。

## Round 9: V3 修訂清單（12 項）

### 高優先級（4 項）

| # | 項目 | V2 狀態 | V3 建議 |
|---|---|---|---|
| 12 | Super admin 互相保護 | 僅最後一個 | **互鎖 + 2 人簽名**降級 |
| 13 | Incident Response Playbook | 僅 DR | 新增事件中 SOP |
| 14 | 合規條款 | 完全未提 | Retention / TTL / 跨境傳輸 |
| 15 | 前端硬編碼 role 轉換 | 低估 | **拆 Phase 1.5**（+8h）|

### 中優先級（5 項）

| # | 項目 | V2 狀態 | V3 建議 |
|---|---|---|---|
| 16 | SLI/SLO 量化定義 | 描述性 | 98% 成功、p95<500ms 等 |
| 17 | Tracing 整合 | 完全缺 | Cloud Trace + correlationId |
| 18 | Alert 分級 | 單一等級 | P0/P1/P2 + on-call 責任 |
| 19 | RACI matrix | 未明訂 | 5 個關鍵動作 RACI 表 |
| 20 | Honey role 偵測 | 未提 | `_canary_admin` 釣餌告警 |

### 低優先級（3 項）

| # | 項目 | V2 狀態 | V3 建議 |
|---|---|---|---|
| 21 | Audit log 時間 jitter | 精確時戳 | 秒級 jitter 防側信道 |
| 22 | Data export | 未提 | role 歷史可下載 |
| 23 | Schema version 白名單 | 未明訂 | rules 拒絕未知 schemaVersion |

## V3 總結

| 維度 | 統計 |
|---|---|
| 新視角專家 | 7 位 |
| 新發現漏洞 | 30+ |
| 互挑毛病組 | 8 組 |
| 致命級錯誤 | **0**（V2 已修正 bitmap 後技術可行性穩固）|
| 高優先級 | 4 項 |
| 中 + 低優先級 | 8 項 |

**結論**：V2 致命問題已清。V3 發現多為「錦上添花」與「邊緣 case」級別。**若繼續審計，邊際效益遞減明顯**。

---

**V3 版本**：V3（Round 7-9 邊際補強）
**下次修訂**：若使用者要求再輪審計會 append Round 10+（但需注意 diminishing return）
