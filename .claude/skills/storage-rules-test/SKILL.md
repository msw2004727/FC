---
name: storage-rules-test
description: FC storage.rules 新增或修改後、或要確認 Storage 上傳／刪除會不會被擋時使用：用自己的 Storage emulator 跑 tests/storage-rules、把同一套測試對正式部署版規則做差分、避開其他分支佔用的 port，以及 Storage 規則語言 Path 型別的已知限制。
---

# storage-rules-test

FC 的 `storage.rules` 同時套用兩個 bucket（`firebase.json` 的 `defaultStorage`、`asiaUpload` target）。Storage 規則部署是 GATED（R-SAFE-015），本 skill 只管本機驗證。（2026-10-22 T-015 首建）

## 跑測試

```bash
npm run test:storage-rules
```

- 用 demo project（`demo-storage-rules-test`）：emulator 會忽略 `firebase.json` 的 storage targets、先套開放規則，測試再用 `initializeTestEnvironment({ storage: { rules } })` 載入 repo 的 `storage.rules`。
- 測試讀 `FIREBASE_STORAGE_EMULATOR_HOST`（`emulators:exec` 會設），預設 `127.0.0.1:9199`。
- 測試檔放 `tests/storage-rules/**/*.test.js`，`test:storage-rules:unit` 以 `<rootDir>` 錨定收錄；不在 `test:rules`（Firestore）裡，CI 目前也沒跑（見「已知缺口」）。

## 9199 或 hub 被別的分支佔用時

同時有其他 session 開 emulator 是常態（FC-B 的 firestore＋auth 佔 4400／4500／8080，別的 PM 的 storage 佔 9199）。**不要把規則載入別人的 emulator**（`initializeTestEnvironment` 會覆蓋那台的規則）。

- 沒設定 port 的 hub／logging 被佔用時 firebase-tools 會自動改用下一個 port；**明確寫在 config 裡的 port 被佔用則直接失敗**。
- 改用 scratchpad 的獨立 config（不要改 repo 的 `firebase.json`）：

```json
{
  "storage": { "rules": "storage.rules" },
  "emulators": {
    "storage": { "host": "127.0.0.1", "port": 9298 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
```

```bash
cd <scratch> && npx --prefix <FC> firebase emulators:exec --only storage --project demo-storage-rules-test --config firebase.json "cd /d D:\\Users\\msw74\\Documents\\github\\FC && npm run test:storage-rules:unit"
```

- Windows 上 `emulators:exec` 的子命令走 **cmd**：要寫 `cd /d D:\...`，Git Bash 的 `cd /d/Users/...` 會失敗（亂碼「系統找不到指定的路徑」、exit 1）。多步驟改寫成 `.cmd` 檔再把它的 Windows 路徑交給 exec。

查誰佔 port：`netstat -ano | grep -E ":(9199|4400|4500) "`，再用 PowerShell `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` 看命令列。

## 對正式部署版做差分（證明沒有放寬）

1. 取正式版規則：唯讀 `GET firebaserules.googleapis.com/v1/projects/fc-football-6c8dc/releases` → ruleset id → `GET .../rulesets/{id}` 的 `source.files[].content`（需 `x-goog-user-project` header）。2026-10-22 查證的正式版就是 `git show 58b72084f:storage.rules`（12 行）。
2. 把測試檔複製到 scratchpad，`sed "s#const RULES_PATH = .*#const RULES_PATH = process.env.T_RULES;#"`；在同一資料夾放 `jest.config.json`：`{ "rootDir": ".", "testEnvironment": "node", "modulePaths": ["D:/Users/msw74/Documents/github/FC/node_modules"], "testMatch": ["**/*.test.js"] }`（測試檔在 repo 外，靠 `modulePaths` 找套件；`--roots` 指到 rootDir 外會找不到測試）。再寫 `run.cmd`：`set T_RULES=<正式版副本>` 後 `call <FC>\node_modules\.bin\jest --config jest.config.json --runInBand --verbose > prod.out`，同一支 cmd 換 `T_RULES` 再跑新版，交給 `emulators:exec`。
3. 新版通過、正式版失敗的案例＝行為差異。每一條都要是「收緊」（正式版 allow → 新版 deny）；出現正式版 deny、新版 allow 就是放寬，要停下回報。

## Storage 規則語言實測（cloud-storage-rules-runtime v1.1.3）

| 寫法 | 結果 |
|---|---|
| `{allPaths=**}` 的 `allPaths.matches(...)` | `Function not found: matches` → 該條 allow 評估錯誤＝拒絕 |
| `string(allPaths)` | `Unsupported operation: string(path)` |
| `allPaths.size()` | `Function not found: size` |
| `request.resource.name.matches('images/...')` | 可用；`name` 是不含 bucket 的完整物件路徑，`matches` 是整串比對 |
| `matches('(?s)...')` | 可用。RE2 的 `.` 預設不比對換行，排除用的 `.*` 要加 `(?s)`，否則檔名含 `\n` 可落入泛用區塊（T-015 有測試鎖住） |

- `request.resource` 只在 create／update 存在，排除條件只能寫在 create／update；delete 要另外寫死。
- `allow read` 含 get 與 list：`listAll()` 未登入也會成功（正式版即如此）。

- 刪除時 `request.resource` 是 null：`allow write` 條件若讀 `request.resource.size` 會 Null value error → 刪除被拒。正式版因此實際上**任何路徑都不能刪**。
- 多個 `match` 同時命中時任一 allow 成立就放行；專用區塊要限本人，泛用區塊必須真的排除該路徑。
- 評估錯誤在 emulator 主控台印 `EvaluationException: Error: storage.rules line [n], column [m]`，測試端只看到 `storage/unauthorized`；**測試全拒時先看主控台有沒有 EvaluationException**，不要以為是條件寫太嚴。

## 已知缺口

- `.github/workflows/test.yml` 只跑 `npm run test:rules`（Firestore），Storage 測試未進 CI。
