// 依設定檔從 UI/UX 盤點抽出某一批項目，附 PM 建議與截圖對應，寫 <outDir>/items.json。
// 用法：node pick-items.mjs <config.json>（格式見 ../examples/batch3.config.json）
import fs from 'node:fs';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const inv = JSON.parse(fs.readFileSync(cfg.inventory, 'utf8')).items;
const ids = new Set(cfg.ids || []);
const groups = new Set(cfg.groups || []);
const pick = inv.filter((x) => groups.has(x.group) || ids.has(x.id));
const pm = cfg.pm || {};
const missing = [...pick, ...(cfg.extra || [])].filter((x) => !pm[x.id]).map((x) => x.id);
if (missing.length) throw new Error('缺 PM 建議：' + missing.join(','));

const decide = new Set(cfg.decide || []);
const bMissing = new Set(cfg.bMissing || []);
const loginOnly = new Set(cfg.loginOnly || []);
const mockNotes = cfg.mockNotes || {};
const prioRank = { 高: 0, 中: 1, 低: 2 };

const items = [...(cfg.extra || []), ...pick].map((x) => {
  const [verdict, reason, shot] = pm[x.id];
  const aKey = loginOnly.has(shot) ? cfg.loginFallback : shot;
  return {
    id: x.id,
    title: x.page ?? x.title,
    area: x.area ?? x.group,
    summary: x.summary || '',
    suggestion: x.suggestion,
    user_feel: x.user_feel || '',
    a_ref: x.a_ref,
    b_ref: x.b_ref,
    priority: x.priority,
    effort: x.effort,
    needs_backend: !!x.needs_backend,
    needs_owner_decision: decide.has(x.id),
    owner_directive: !!x.owner_directive,
    risk: x.risk || '',
    pm_verdict: verdict,
    pm_reason: reason,
    shot,
    shots: {
      a_light: `shots/${aKey}-A-light.png`, a_dark: `shots/${aKey}-A-dark.png`,
      b_light: `shots/${shot}-B-light.png`, b_dark: `shots/${shot}-B-dark.png`,
    },
    a_note: loginOnly.has(shot) ? (cfg.loginNote || '此畫面需登入，A 正式站以訪客畫面代替。') : (mockNotes[shot] || ''),
    b_missing: bMissing.has(x.id),
  };
}).sort((a, b) => (b.needs_owner_decision - a.needs_owner_decision)
  || (prioRank[a.priority] - prioRank[b.priority]) || a.id.localeCompare(b.id));

fs.mkdirSync(cfg.outDir, { recursive: true });
fs.writeFileSync(path.join(cfg.outDir, 'items.json'), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  title: cfg.title,
  rule: cfg.rule,
  count: items.length,
  count_from_inventory: pick.length,
  extra_from_commander: (cfg.extra || []).map((x) => x.id),
  appendix: cfg.appendix || [], // 內嵌到預覽頁的 .md 附錄（2026-10-22 T-012 新增）
  items,
}, null, 1) + '\n');
console.log(`items=${items.length} 盤點=${pick.length} 追加=${(cfg.extra || []).length} 需站長決定=${items.filter((i) => i.needs_owner_decision).map((i) => i.id).join(',') || '無'}`);
