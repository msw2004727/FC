// 授權突變檢查範本（T-024 第二輪 (a) 實戰用；FC 專屬）。
// 用法：複製此檔到 scratchpad，改下方 H／C 與 mutations 清單，然後
//   node mutate.js <乾淨 worktree 的絕對路徑> > out.json
// 每項 [檔案, 代號, 說明, 要找的原文(必須在檔內恰好出現 1 次), 替換文字]：
// 逐一破壞單一守衛 → 跑指定 jest → 還原。failed>0 為「轉紅」；0 為「存活」（守衛冗餘或漏測，需判斷）。
// 注意：只在乾淨 worktree 內跑；跑完用 cmp 與主目錄版本確認已還原。
// 授權突變檢查：逐一破壞單一守衛，測試應轉紅（在乾淨 worktree 內執行，結束後還原）。
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const wt = process.argv[2];
const H = "functions/qa-test-mode.js";
const C = "functions/qa-test-mode-core.js";
const mutations = [
  [H, "config.enabled !== true", "enabled 開關檢查", "config.enabled !== true", "false"],
  [H, "reservation.throttled", "節流鎖定檢查", "if (reservation.throttled)", "if (false)"],
  [H, "entries.length === 0", "Secret 無有效條目", "if (parsed.entries.length === 0)", "if (false)"],
  [H, "!entry", "密碼未命中", "      if (!entry) {", "      if (false) {"],
  [H, "expired", "密碼過期", "if (entry.expiresAtMs <= nowMs)", "if (false)"],
  [H, "resolved", "persona 解析失敗", "if (!resolved.ok)", "if (false)"],
  [H, "user.uid", "users.uid 比對", "user.uid !== persona.uid ||", "false ||"],
  [H, "user.displayName", "users.displayName 前綴", "!user.displayName.startsWith(QA_DISPLAY_NAME_PREFIX) ||", "false ||"],
  [H, "user.role", "users.role 比對", "user.role !== persona.role) {", "false) {"],
  [H, "user.exists", "users 文件存在", "if (!isPlainObject(user) ||", "if (false ||"],
  [H, "invariants-uid", "簽發邊界 UID 不變量", "!QA_UID_RE.test(persona.uid) ||", "false ||"],
  [H, "invariants-role", "簽發邊界 role 不變量", "!QA_ALLOWED_ROLES.has(persona.role) ||", "false ||"],
  [H, "qaExp", "qaExp 取 min", "const qaExpMs = Math.min(", "const qaExpMs = Math.max("],
  [H, "claims-role", "claims 帶 role", "          qa: true,", "          qa: true, role: persona.role,"],
  [H, "audit", "成功 audit fail-closed", "return await deny(\"qa_success_audit_failed\", \"internal\");", "/* swallowed */"],
  [H, "reserve-limit", "預占名額上限", "if (count + reservations.length >= limits.maxFailures) {", "if (false) {"],
  [H, "lock", "failure 達上限鎖定", "patch.lockedUntilMs = patch.count >= limits.maxFailures", "patch.lockedUntilMs = false"],
  [H, "locked-skip", "鎖定中不再累加", "if (state.lockedUntilMs > txNowMs) return { throttled: true };", ""],
  [H, "bad-request", "輸入驗證", "typeof data.password !== \"string\" ||", "false ||"],
  [C, "timing-all", "密碼比對不提前跳出", "      matched = entry;\n", "      matched = entry; break;\n"],
  [C, "future-hours", "maxFutureHours 檢查", "expiresAtMs - nowMs > futureHours * 3600000 ||", "false ||"],
  [C, "dup-password", "重複密碼作廢", "passwordCounts.get(entry.password) !== 1", "false"],
  [C, "dup-agent", "重複專員代號作廢", "if (duplicateAgent ||", "if ("],
  [C, "pw-charset", "密碼字元集", "!/^[\\x21-\\x7E]+$/.test(password) ||", "false ||"],
  [C, "pw-len", "密碼最短長度", "password.length < QA_PASSWORD_MIN_LENGTH ||", "false ||"],
  [C, "enabled-strict", "enabled 嚴格等於 true", "enabled: value.enabled === true", "enabled: !!value.enabled"],
  [C, "persona-invariants", "persona 不變量過濾", "    typeof persona.uid === \"string\" && QA_UID_RE.test(persona.uid) &&", "    typeof persona.uid === \"string\" &&"],
  [C, "role-whitelist", "role 白名單", "    QA_ALLOWED_ROLES.has(persona.role);", "    true;"],
  [C, "xff-first", "XFF 取最右段", "const index = parts.length - distance;", "const index = 0;"],
];

function run() {
  const r = spawnSync("npx", ["jest", "tests/unit/qa-test-mode.test.js", "--runInBand"], { cwd: wt, encoding: "utf8", shell: true });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/Tests:\s+(?:(\d+) failed, )?(?:\d+ skipped, )?(\d+) passed/);
  return { failed: m && m[1] ? Number(m[1]) : 0, passed: m ? Number(m[2]) : -1, raw: m ? "" : out.slice(-300) };
}

const results = [];
for (const [file, , label, find, replace] of mutations) {
  if (find === null) continue;
  const p = path.join(wt, file);
  const original = fs.readFileSync(p, "utf8");
  const count = original.split(find).length - 1;
  if (count !== 1) { results.push({ label, error: `找到 ${count} 處（需恰好 1）` }); continue; }
  fs.writeFileSync(p, original.replace(find, () => replace));
  const res = run();
  fs.writeFileSync(p, original);
  results.push({ label, file, failed: res.failed, passed: res.passed, raw: res.raw });
}
const base = run();
console.log(JSON.stringify({ baseline: base, results }, null, 1));
