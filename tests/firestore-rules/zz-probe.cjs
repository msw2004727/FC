// 暫時探針（不合併）：三版預算對照＋失敗測試全文（jest 輸出寫檔，UTF-8）
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64e6 }); } catch (e) { return (e.stdout || "") + (e.stderr || ""); } };
const out = path.resolve("zz-out"); fs.mkdirSync(out, { recursive: true });
const write = (name, text) => fs.writeFileSync(path.join(out, name), text, "utf8");
const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, "");
write("pre.rules", sh("git show 057bc668c:firestore.rules"));
write("6114.rules", sh("git show 6114256a0:firestore.rules"));
for (const [tag, rules] of [["pre", path.join(out, "pre.rules")], ["6114", path.join(out, "6114.rules")], ["head", "firestore.rules"]]) {
  const j = path.join(out, `b-${tag}.json`);
  const log = sh(`node tests/firestore-rules/t090a-budget.js "${rules}" "${j}" users`);
  write(`b-${tag}.log`, log);
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(j, "utf8")).results || []; } catch (e) { console.log(`[${tag}] budget json unreadable`); }
  for (const r of rows) console.log(`BUDGET ${tag} ${r.name} allowed=${r.baseline && r.baseline.allowed} pad=${r.maxPassPad}`);
  // 沒跑完全部 spec 時（例如 Non-budget failure 中途丟錯），把 log 尾端印出來
  if (/Error/.test(log)) console.log(`[${tag}] budget log tail:\n${stripAnsi(log).split(/\r?\n/).slice(-15).join("\n")}`);
}
const jsonPath = path.join(out, "jest.json");
const verbose = sh(`npx jest --runInBand --verbose --json --outputFile="${jsonPath}" --testMatch "<rootDir>/tests/firestore-rules/team-member-removal-rules.test.js"`);
write("jest-verbose.txt", stripAnsi(verbose));
try {
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  console.log(`JEST total=${report.numTotalTests} passed=${report.numPassedTests} failed=${report.numFailedTests}`);
  for (const suite of report.testResults) {
    for (const t of suite.assertionResults) {
      if (t.status !== "failed") continue;
      console.log(`\n=== FAILED: ${t.fullName}`);
      console.log(stripAnsi(t.failureMessages.join("\n")).split(/\r?\n/).slice(0, 40).join("\n"));
    }
    if (suite.message && suite.status === "failed" && !suite.assertionResults.some((t) => t.status === "failed")) console.log(`SUITE ERROR:\n${stripAnsi(suite.message).slice(0, 4000)}`);
  }
} catch (e) { console.log(`jest json unreadable: ${e.message}`); }
console.log(`\n全文：${path.join(out, "jest-verbose.txt")}、${jsonPath}（UTF-8）`);
