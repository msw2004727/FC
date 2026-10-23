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

## emulator 注入 Secret（Functions emulator）

- 實測（2026-10-23）：只用 shell 環境變數 `QA_TEST_PASSWORD` 啟動 Functions emulator 時，emulator 日誌出現 `Trying to access secret QA_TEST_PASSWORD@latest`，也就是它會嘗試用本機的 Application Default Credentials（ADC）去讀 Secret Manager，而且簽發被拒（內部原因 `qa_secret_invalid_entries`／`qa_secret_invalid`，對外仍是「無法進入測試模式」），看起來像密碼格式錯。改成下面的 `functions/.secret.local` 並隔離 ADC 後，同樣的 secret 內容就能正常簽發。不要依賴環境變數注入。
- 在臨時的乾淨工作樹作業。建議 `git worktree add --detach <暫存路徑> HEAD`，並把該工作樹 `functions/node_modules` 用 junction 指回主目錄。建立 `functions/.secret.local`，內容一行：`QA_TEST_PASSWORD="<整個 secret 字串>"`。整段 secret 含 `|`、`;`、`:`，必須用雙引號包住。此檔不 commit、不貼到對話或文件，用完立即刪除。先刪檔，再移除 junction，最後 `git worktree remove`，避免連帶刪掉主目錄的 `node_modules`。
- 啟動 emulator 的 shell 要把 `CLOUDSDK_CONFIG` 指到一個空資料夾、`GOOGLE_APPLICATION_CREDENTIALS` 指到一個不存在的檔案，emulator 才無法用本機憑證連到正式 Secret Manager。同時設定 `FUNCTIONS_DISCOVERY_TIMEOUT=60`（這台機器的 Functions 載入分析逾時預設太短）。
- Callable 網址包含專案 ID。emulator 的專案 ID 必須與 FC-B 前端一致，為 `<正式專案ID>`，而且只在 emulator 使用。啟動一律加 `--only auth,firestore,functions`，不要連任何正式服務。

臨時 `firebase.json` 只含 functions、firestore、auth 的 emulator 設定，host 為 `127.0.0.1`，ports 為 9099、8080、5001。路徑用佔位符。

```bash
cat > <臨時 firebase.json> <<'EOF'
{
  "emulators": {
    "auth": { "host": "127.0.0.1", "port": 9099 },
    "firestore": { "host": "127.0.0.1", "port": 8080 },
    "functions": { "host": "127.0.0.1", "port": 5001 }
  }
}
EOF

export CLOUDSDK_CONFIG="<空資料夾>"
export GOOGLE_APPLICATION_CREDENTIALS="<不存在的檔案>"
export FUNCTIONS_DISCOVERY_TIMEOUT=60

node <FC>/node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only auth,firestore,functions --config <臨時 firebase.json> --project <正式專案ID>

# emulator 起來之後，另開一個 shell：
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
node <暫存路徑>/scripts/qa-test-mode/setup-config.js --project <正式專案ID> --execute --enable
node <暫存路徑>/scripts/qa-test-mode/provision-accounts.js --project <正式專案ID> --execute
```

- 用瀏覽器自動化從 `/qa-login` 登入，檢查橫幅，以及 `getIdTokenResult` 的 `qa*` claims 在強制刷新後仍在，再登出回到訪客。不要把密碼印出或寫入 log。

## Secret 格式注意事項

- 單筆為 `專員代號:密碼|到期時間[|persona1,persona2]`。程式取第一個 `:` 左邊當代號、右邊再以 `|` 分成兩或三欄，所以代號須匹配 `^[a-z0-9_-]{1,24}$`，密碼長度須為 6～64（2026-10-23 站長決定封閉測試期由 12 放寬為 6）、每個字元都在 `!`～`~`（`\x21`～`\x7E`，不含空白）且不可含 `|` 或 `;`（冒號可以），persona 以逗號分隔、重複鍵會去掉，每個鍵須匹配 `^[A-Za-z0-9_-]{1,32}$`；任一不符就整筆忽略。
- 到期時間須帶時區，`parseExpiry` 接受 `2026-10-25T06:47:27Z` 與 `2026-10-25T14:47:27+08:00`，也接受省略秒以及小數秒，因此 `new Date().toISOString()` 的 `2026-10-25T06:47:27.123Z` 同樣有效。缺時區、不存在的月日時分秒，或時區的時大於 23、分大於 59，會整筆忽略，避免 `Date.parse` 自動進位；比現在晚超過 `maxFutureHours` 的筆也忽略（預設 168 小時，設定須為大於 0 且不超過 720 的數字，否則回到預設，等於上限仍有效），已到期（含剛好等於現在）的時間戳在解析時仍留下，簽發時才以 `qa_password_expired` 拒絕。
- 多筆建議用 `;` 分隔。程式以 `;`、`\r`、`\n` 切開，換行也接受，但環境變數與 dotenv 的換行容易被截斷或轉義，用 `;` 最不容易出錯。
- 同一密碼出現在多筆時，這些筆全部無效，簽發才能用密碼唯一對到一個專員。專員代號重複時只保留第一筆（該筆密碼仍須唯一），其後同代號的筆無效，而且後出的筆仍計入密碼出現次數，避免用重複代號掩蓋密碼衝突。
- 格式錯誤的條目只會被忽略，並在 log 留下 reasonCode `qa_secret_invalid_entries`（有無效筆就記，其他有效筆仍可用）。一筆有效條目都不剩時對外一律「無法進入測試模式」、內部 reasonCode 為 `qa_secret_invalid`（secret 空白或讀取失敗不會先記 `qa_secret_invalid_entries`）；畫面文字是固定的，排查要看 emulator 或 Cloud Logging 的 reasonCode。
- 沒有可用的 `x-forwarded-for`（缺漏、超過 2048 字，或由右數取不到合法 IP）時，`resolveQaClientIp` 改用 `rawRequest.ip`；兩者都不是合法 IP 時 `ipHash` 才是空字串，此時不寫 `ip_` 節流文件，只剩全域桶。實測（2026-10-23）emulator 日誌的 `ipHash` 為空字串，每 IP 桶不會分桶，只剩全域桶。每 IP 節流是否依 `clientIpXffFromRight` 取對段，只能在正式環境實測（既有章節已說明此值）。
