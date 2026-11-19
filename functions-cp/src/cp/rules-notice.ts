/**
 * 改規則的系統公告與稽核用的計分差異。純函式。
 * 只列草案 §2 影響計分、而且值有變的項目。僅顯示（含補充說明、球隊暫停、仁慈關閉時的 cap）不列。
 * 公告用草案 §1 的顯示文字，不出現鍵名。排序只寫捷徑名稱或「自訂順序」。
 * 超過 NOTICE_LIMITS.textMax 時從最後一項拿掉，結尾改「…等 N 項」；原因整段保留。
 */
import type { ResolvedRules, TiePreset } from '../engine/index.js';
import { NOTICE_LIMITS } from './notice.js';
import { clipCodePoints, codePointLength } from './text.js';

const MINUS = '\u2212';

/** 負數用 U+2212，與草案表格一致。 */
export function formatRuleNumber(n: number): string {
  return n < 0 ? MINUS + String(-n) : String(n);
}

const PRESET_LABEL: Record<TiePreset, string> = {
  h2hFirst: '對戰關係優先',
  goalDiffFirst: '得失球差優先',
  feda2026: '飛達盃 2026 規章第十九條',
  youth: '兒童組（較早交給主辦裁定）',
  fifa2026: 'FIFA 2026 對照',
  custom: '自訂順序'
};

export interface RuleChange {
  key: string;
  from: string | number | boolean | string[];
  to: string | number | boolean | string[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function pointsLine(label: string, from: number, to: number): string {
  return `${label} ${formatRuleNumber(from)}→${formatRuleNumber(to)} 分`;
}

function goalStatsLabel(on: boolean): string {
  return on ? '計入得失球' : '不計入得失球，仍計勝敗與積分';
}

/** 關閉時 cap 不進計分。開著才把兩邊的 cap 拿來比。 */
function mercyOn(r: ResolvedRules): { on: false } | { on: true; cap: number } {
  return r.mercy.enabled ? { on: true, cap: r.mercy.cap } : { on: false };
}

function mercyLine(before: ResolvedRules, after: ResolvedRules): string | null {
  const a = mercyOn(before);
  const b = mercyOn(after);
  if (!a.on && !b.on) return null;
  if (a.on && b.on && a.cap === b.cap) return null;
  if (a.on && b.on) return `單場球差上限 ${a.cap}→${b.cap} 球`;
  if (!a.on && b.on) return `單場球差上限 不設→${b.cap} 球`;
  if (a.on && !b.on) return `單場球差上限 ${a.cap} 球→不設`;
  return null;
}

export interface ScoringDiff {
  /** 公告項目，草案 §2 的順序。 */
  items: string[];
  /** 稽核用。鍵名可以是葉路徑；公告不使用這份。 */
  changes: RuleChange[];
}

/** 影響計分且值有變的項目。仁慈關著時只改 cap 不算。 */
export function diffScoringRules(before: ResolvedRules, after: ResolvedRules): ScoringDiff {
  const items: string[] = [];
  const changes: RuleChange[] = [];

  const points: ReadonlyArray<['points.win' | 'points.draw' | 'points.loss', string, number, number]> = [
    ['points.win', '勝一場', before.points.win, after.points.win],
    ['points.draw', '和局各', before.points.draw, after.points.draw],
    ['points.loss', '負一場', before.points.loss, after.points.loss]
  ];
  for (const [key, label, from, to] of points) {
    if (from === to) continue;
    changes.push({ key, from, to });
    items.push(pointsLine(label, from, to));
  }

  const criteriaChanged = !sameList(before.tieBreak.criteria, after.tieBreak.criteria);
  const presetChanged = before.tieBreak.preset !== after.tieBreak.preset;
  if (criteriaChanged || presetChanged) {
    if (presetChanged) {
      changes.push({ key: 'tieBreak.preset', from: before.tieBreak.preset, to: after.tieBreak.preset });
    }
    if (criteriaChanged) {
      changes.push({
        key: 'tieBreak.criteria',
        from: [...before.tieBreak.criteria],
        to: [...after.tieBreak.criteria]
      });
    }
    items.push(`同分排序 ${PRESET_LABEL[before.tieBreak.preset]}→${PRESET_LABEL[after.tieBreak.preset]}`);
  }

  // 只有 miniLeagueThenRestart。值不會變，公告不寫這一行（顯示句裡有分號）。真的不同才進稽核。
  if (before.tieBreak.h2hScope !== after.tieBreak.h2hScope) {
    changes.push({ key: 'tieBreak.h2hScope', from: before.tieBreak.h2hScope, to: after.tieBreak.h2hScope });
  }

  const goals: ReadonlyArray<['walkover.scoreFor' | 'walkover.scoreAgainst', string, number, number]> = [
    ['walkover.scoreFor', '對手進球', before.walkover.scoreFor, after.walkover.scoreFor],
    ['walkover.scoreAgainst', '棄權方進球', before.walkover.scoreAgainst, after.walkover.scoreAgainst]
  ];
  for (const [key, label, from, to] of goals) {
    if (from === to) continue;
    changes.push({ key, from, to });
    items.push(`${label} ${formatRuleNumber(from)}→${formatRuleNumber(to)}`);
  }

  const pointWalk: ReadonlyArray<['walkover.awardPoints' | 'walkover.penaltyPoints', string, number, number]> = [
    ['walkover.awardPoints', '勝方得', before.walkover.awardPoints, after.walkover.awardPoints],
    ['walkover.penaltyPoints', '棄權方得', before.walkover.penaltyPoints, after.walkover.penaltyPoints]
  ];
  for (const [key, label, from, to] of pointWalk) {
    if (from === to) continue;
    changes.push({ key, from, to });
    items.push(pointsLine(label, from, to));
  }

  if (before.walkover.countInGoalStats !== after.walkover.countInGoalStats) {
    changes.push({
      key: 'walkover.countInGoalStats',
      from: before.walkover.countInGoalStats,
      to: after.walkover.countInGoalStats
    });
    items.push(`${goalStatsLabel(before.walkover.countInGoalStats)}→${goalStatsLabel(after.walkover.countInGoalStats)}`);
  }

  const fair: ReadonlyArray<['fairPlay.yellow' | 'fairPlay.secondYellow' | 'fairPlay.directRed' | 'fairPlay.yellowThenRed', string, number, number]> = [
    ['fairPlay.yellow', '一張黃牌', before.fairPlay.yellow, after.fairPlay.yellow],
    ['fairPlay.secondYellow', '兩黃變紅', before.fairPlay.secondYellow, after.fairPlay.secondYellow],
    ['fairPlay.directRed', '直接紅牌', before.fairPlay.directRed, after.fairPlay.directRed],
    ['fairPlay.yellowThenRed', '先黃牌再直接紅牌', before.fairPlay.yellowThenRed, after.fairPlay.yellowThenRed]
  ];
  for (const [key, label, from, to] of fair) {
    if (from === to) continue;
    changes.push({ key, from, to });
    items.push(pointsLine(label, from, to));
  }

  if (before.mercy.enabled !== after.mercy.enabled) {
    changes.push({ key: 'mercy.enabled', from: before.mercy.enabled, to: after.mercy.enabled });
  }
  const capCounts = before.mercy.enabled || after.mercy.enabled;
  if (capCounts && before.mercy.cap !== after.mercy.cap) {
    changes.push({ key: 'mercy.cap', from: before.mercy.cap, to: after.mercy.cap });
  }
  const mercy = mercyLine(before, after);
  if (mercy) items.push(mercy);

  return { items, changes };
}

export function scoringChangesOf(before: ResolvedRules, after: ResolvedRules): RuleChange[] {
  return diffScoringRules(before, after).changes;
}

export function rulesNoticeItems(before: ResolvedRules, after: ResolvedRules): string[] {
  return diffScoringRules(before, after).items;
}

/**
 * 組出系統公告。max 預設是 NOTICE_LIMITS.textMax。
 * 放得下就整則列出。放不下就從最後一項開始拿掉，清單結尾改「…等 N 項」，N 是項目總數。
 * 原因不截。框本身仍超長時，只截框，而且不切開字素。
 */
export function assembleRulesNotice(monthDay: string, items: readonly string[], reason: string, max: number = NOTICE_LIMITS.textMax): string {
  const head = `比賽規則於 ${monthDay} 修改：`;
  const tail = `；原因：${reason}`;
  const full = head + items.join('、') + tail;
  if (codePointLength(full) <= max) return full;

  const total = items.length;
  for (let keep = items.length - 1; keep >= 0; keep--) {
    const shown = keep === 0 ? '' : items.slice(0, keep).join('、');
    const text = `${head}${shown}…等 ${total} 項${tail}`;
    if (codePointLength(text) <= max) return text;
  }

  const marker = `…等 ${total} 項`;
  const frame = head + marker;
  const budget = max - codePointLength(tail);
  if (budget >= codePointLength(frame)) return frame + tail;
  if (budget <= 0) return tail;
  return clipCodePoints(frame, budget) + tail;
}

export function rulesChangeNoticeText(input: {
  monthDay: string;
  before: ResolvedRules;
  after: ResolvedRules;
  reason: string;
  /** 預設 NOTICE_LIMITS.textMax。測試可傳更小的值，逼出截斷。 */
  max?: number;
}): string {
  const items = rulesNoticeItems(input.before, input.after);
  return assembleRulesNotice(input.monthDay, items, input.reason, input.max ?? NOTICE_LIMITS.textMax);
}
