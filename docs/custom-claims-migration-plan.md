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

**計劃書版本**：V1（多視角協作版）
**下次修訂**：Phase 0 啟動前若有新發現會另外 append
