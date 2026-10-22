// 只動 emulator：替種子帳號暫補性別／生日／地區，解開「我要開團」鎖（needsFirstLogin），截完刪回。
// 用法：node coach-profile.mjs on|off [uid，預設種子教練]
// 2026-10-22 T-018 新增：種子教練缺這三欄，「我要開團」是 aria-disabled，Playwright 點不到。
const uid = process.argv[3] || 'U0000000000000000000000000000002';
const mask = ['gender', 'birthday', 'region'].map((f) => `updateMask.fieldPaths=${f}`).join('&');
const url = `http://127.0.0.1:8080/v1/projects/fc-football-6c8dc/databases/(default)/documents/users/${uid}?${mask}`;
const fields = process.argv[2] === 'on'
  ? { gender: { stringValue: '男' }, birthday: { stringValue: '1990-01-01' }, region: { stringValue: '台中市' } }
  : {};
const r = await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
console.log(process.argv[2], uid.slice(-4), r.status);
if (!r.ok) process.exit(1);
