# QA 測試模式管理腳本

管理 `qaTestMode/config`、QA 假帳號與清理清單。預設 dry-run，不會寫入 Firestore。

專案 ID 沒有預設值。請用 `--project <id>`，或已設定的環境變數 `GCLOUD_PROJECT`。

正式環境執行需站長授權，旗標為 `--production --execute --confirm-project <id>`。

## 共同旗標

- `--project <id>`：目標專案
- `--execute`：真正寫入；省略則為 dry-run
- `--production`：確認目前不是 emulator
- `--confirm-project <id>`：必須與專案 ID 相同；正式環境寫入時必填
- `--enable`：僅 setup-config 把總開關設為 true（預設 false）
- `--out <path>`：僅 cleanup-report 寫出完整 JSON（UTF-8 無 BOM）
- `--help`：說明

emulator 必須同時設定 `FIRESTORE_EMULATOR_HOST` 與 `FIREBASE_AUTH_EMULATOR_HOST`。只設其中一個會拒絕執行。

## 腳本

- `setup-config.js`：建立或更新設定文件。已有 `teams.main.teamId` 與 persona 會保留。沒有 `--enable` 不主動打開總開關。`clientIpXffFromRight` 預設 1（整數 1～5），指定 `x-forwarded-for` 由右數第幾段視為客戶端 IP。部署後若發現 ipHash 不穩定或把所有人算成同一個，調整此值，無須重新部署。
- `provision-accounts.js`：建立 QA 假帳號與「QA測試俱樂部」。不建立 Firebase Auth 使用者。請先跑 setup-config。`memberB` 不入隊。
- `cleanup-report.js`：只列出待清理資料，不刪除。刪除另需站長點頭。
- `emergency-revoke.js`：把總開關設為 false，並對 persona 呼叫 `revokeRefreshTokens`。使用者不存在會略過。
- `emulator-claims-check.js`：只在 emulator 檢查 `qa*` claims 經過 refresh 是否還在，以及撤銷後 refresh 是否失敗。不印 token。

## 典型 emulator 指令

```
firebase emulators:exec --only auth,firestore --project demo-qa-test "node scripts/qa-test-mode/setup-config.js --project demo-qa-test --execute"
```

```
firebase emulators:exec --only auth,firestore --project demo-qa-test "node scripts/qa-test-mode/provision-accounts.js --project demo-qa-test --execute"
```

```
firebase emulators:exec --only auth,firestore --project demo-qa-test "node scripts/qa-test-mode/cleanup-report.js --project demo-qa-test --out qa-cleanup.json"
```

```
firebase emulators:exec --only auth,firestore --project demo-qa-test "node scripts/qa-test-mode/emulator-claims-check.js --project demo-qa-test --execute"
```

正式環境（站長授權後）範例：

```
node scripts/qa-test-mode/emergency-revoke.js --project <id> --production --execute --confirm-project <id>
```
