/**
 * 組別比賽規則：讀取時解析成一份，計分與畫面共用。
 * 舊文件沒有 rules 時，結果必須等於現在的 rankingRuleOf(presetOf(schedule.ranking))
 * ＋ DEFAULT_WALKOVER ＋不壓球差。缺值不展開成 feda2026。
 * 純函式。禁用詞不在這裡查（Callable 用已讀過的清單）。
 */
import { RANKING_RULES } from './formats.js';
import type { Criterion, FairPlayConfig, PointsRule, RankingRule, TallyOpts, WalkoverConfig } from './types.js';

export type PlayersOnField = 5 | 7 | 8 | 9 | 11;
export type TiePreset = 'h2hFirst' | 'goalDiffFirst' | 'feda2026' | 'youth' | 'fifa2026' | 'custom';
export type SubMode = 'unlimitedReturn' | 'limitedCount';
export type EquipChoice = 'unset' | 'required' | 'notRequired';

export interface ResolvedRules {
  playersOnField: PlayersOnField;
  squad: { note: string | null };
  time: {
    periods: 1 | 2;
    halfMinutes: number;
    halftime: { enabled: boolean; minutes: number };
    note: string | null;
  };
  substitution: { mode: SubMode; maxCount: number | null; note: string | null };
  points: PointsRule & { note: string | null };
  tieBreak: {
    preset: TiePreset;
    criteria: Criterion[];
    h2hScope: 'miniLeagueThenRestart';
    note: string | null;
  };
  draw: { roundRobin: 'allowDraw'; knockout: 'pendingStep5'; note: string | null };
  walkover: WalkoverConfig & { note: string | null };
  late: { graceMin: number | null; note: string | null };
  suspension: {
    enabled: boolean;
    yellowThreshold: number;
    yellowBanMatches: number;
    directRedBanMatches: number;
    note: string | null;
  };
  fairPlay: FairPlayConfig & { note: string | null };
  mercy: { enabled: boolean; cap: number; note: string | null };
  equipment: {
    shinGuards: EquipChoice;
    sameColorKit: EquipChoice;
    jerseyNumber: EquipChoice;
    note: string | null;
  };
  appeal: { windowMin: number | null; depositTwd: number | null; note: string | null };
}

/** 寫進 divisions/{dvId}.rules 的形狀。上場人數留在組別文件，不複製進來。 */
export type StoredRules = Omit<ResolvedRules, 'playersOnField'>;

export interface RulesIssue { field: string; reason: string }

const PLAYERS: readonly PlayersOnField[] = [5, 7, 8, 9, 11];
const CRITERIA: readonly Criterion[] = [
  'points', 'headToHeadPoints', 'headToHeadGoalDiff', 'headToHeadGoalsFor', 'headToHeadWins',
  'goalDiff', 'goalsFor', 'goalsAgainstAsc', 'wins', 'fairPlay', 'seed', 'drawLots', 'manual'
];
const PRESETS: readonly TiePreset[] = ['h2hFirst', 'goalDiffFirst', 'feda2026', 'youth', 'fifa2026', 'custom'];
const EQUIP: readonly EquipChoice[] = ['unset', 'required', 'notRequired'];
const NOTE_MAX = 200;

const H2H_CRITERIA = [...RANKING_RULES.RR_FEDA_DEFAULT.criteria] as Criterion[];
const GOAL_DIFF_CRITERIA: Criterion[] = ['points', 'goalDiff', 'goalsFor', 'headToHeadPoints', 'manual'];
const FEDA_CRITERIA = [...RANKING_RULES.RR_FEDA_2026.criteria] as Criterion[];
const YOUTH_CRITERIA = [...RANKING_RULES.RR_FEDA_YOUTH.criteria] as Criterion[];
const FIFA_CRITERIA = [...RANKING_RULES.RR_FIFA_2026.criteria] as Criterion[];

const PRESET_CRITERIA: Record<Exclude<TiePreset, 'custom'>, readonly Criterion[]> = {
  h2hFirst: H2H_CRITERIA,
  goalDiffFirst: GOAL_DIFF_CRITERIA,
  feda2026: FEDA_CRITERIA,
  youth: YOUTH_CRITERIA,
  fifa2026: FIFA_CRITERIA
};

const PRESET_NAME: Record<TiePreset, string> = {
  h2hFirst: '對戰關係優先',
  goalDiffFirst: '得失球差優先',
  feda2026: '飛達盃 2026 規章第十九條',
  youth: '兒童組（較早交給主辦裁定）',
  fifa2026: 'FIFA 2026 對照',
  custom: '自訂順序'
};

/** 與 cp/text.ts optionalText 同一套：NFKC、留換行、連續三個換行壓成兩個、去掉不可見字元。不丟錯。 */
const NOTE_INVISIBLE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u115f\u1160\u3164\uffa0\u2800]/g;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function cleanNote(value: unknown): { ok: true; value: string | null } | { ok: false; reason: 'FIELD_TYPE' | 'FIELD_LENGTH' } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, reason: 'FIELD_TYPE' };
  const s = value.normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(NOTE_INVISIBLE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length === 0) return { ok: true, value: null };
  if ([...s].length > NOTE_MAX) return { ok: false, reason: 'FIELD_LENGTH' };
  return { ok: true, value: s };
}

function readNote(value: unknown): string | null {
  const n = cleanNote(value);
  return n.ok ? n.value : null;
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return undefined;
  return v;
}

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[]): T | undefined {
  return (allowed as readonly unknown[]).includes(v) ? v as T : undefined;
}

/** 舊文件 schedule.ranking。只有剛好 goalDiffFirst 走得失球差；缺值與其他字串都走對戰關係優先。 */
function presetOf(ranking: unknown): 'h2hFirst' | 'goalDiffFirst' {
  return ranking === 'goalDiffFirst' ? 'goalDiffFirst' : 'h2hFirst';
}

function criteriaOfPreset(preset: 'h2hFirst' | 'goalDiffFirst'): Criterion[] {
  return [...(preset === 'goalDiffFirst' ? GOAL_DIFF_CRITERIA : H2H_CRITERIA)];
}

function sameCriteria(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function matchMinutesOf(schedule: Record<string, unknown> | null): number | null {
  const n = intIn(schedule?.matchMinutes, 5, 180);
  return n == null ? null : n;
}

function defaultFairPlay(): FairPlayConfig {
  return { ...RANKING_RULES.RR_FEDA_DEFAULT.fairPlay };
}

function blank(playersOnField: PlayersOnField, periods: 1 | 2, halfMinutes: number, halftimeMin: number): ResolvedRules {
  const fair = defaultFairPlay();
  return {
    playersOnField,
    squad: { note: null },
    time: {
      periods,
      halfMinutes,
      halftime: { enabled: halftimeMin > 0, minutes: halftimeMin },
      note: null
    },
    substitution: { mode: 'unlimitedReturn', maxCount: null, note: null },
    points: { win: 3, draw: 1, loss: 0, note: null },
    tieBreak: {
      preset: 'h2hFirst',
      criteria: [...H2H_CRITERIA],
      h2hScope: 'miniLeagueThenRestart',
      note: null
    },
    draw: { roundRobin: 'allowDraw', knockout: 'pendingStep5', note: null },
    walkover: { scoreFor: 2, scoreAgainst: 0, awardPoints: 3, penaltyPoints: 0, countInGoalStats: true, note: null },
    late: { graceMin: null, note: null },
    suspension: { enabled: false, yellowThreshold: 2, yellowBanMatches: 1, directRedBanMatches: 1, note: null },
    fairPlay: { ...fair, note: null },
    mercy: { enabled: false, cap: 7, note: null },
    equipment: { shinGuards: 'unset', sameColorKit: 'unset', jerseyNumber: 'unset', note: null },
    appeal: { windowMin: null, depositTwd: null, note: null }
  };
}

/** 五人制一般、七人制、十一人制。一鍵填值；存進文件的是展開後的鍵值，不是範本 id。 */
export const RULE_TEMPLATES: Record<'five' | 'seven' | 'eleven', ResolvedRules> = {
  five: blank(5, 2, 20, 5),
  seven: blank(7, 2, 25, 5),
  eleven: blank(11, 2, 35, 10)
};

function legacyBase(division: Record<string, unknown>): ResolvedRules {
  const schedule = isRecord(division.schedule) ? division.schedule : null;
  const rankingPreset = presetOf(schedule?.ranking);
  const minutes = matchMinutesOf(schedule);
  const out = blank(5, 1, minutes ?? 20, 0);
  out.tieBreak.preset = rankingPreset;
  out.tieBreak.criteria = criteriaOfPreset(rankingPreset);
  const players = oneOf(division.playersOnField, PLAYERS);
  if (players != null) out.playersOnField = players;
  return out;
}

function criteriaValid(v: unknown): v is Criterion[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > CRITERIA.length) return false;
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string' || !CRITERIA.includes(item as Criterion) || seen.has(item)) return false;
    seen.add(item);
  }
  return v[0] === 'points';
}

function overlay(base: ResolvedRules, rules: Record<string, unknown>): void {
  if (isRecord(rules.squad)) base.squad.note = readNote(rules.squad.note);

  const time = isRecord(rules.time) ? rules.time : null;
  if (time) {
    const periods = oneOf(time.periods, [1, 2] as const);
    if (periods != null) base.time.periods = periods;
    const halfMax = base.time.periods === 1 ? 180 : 90;
    const half = intIn(time.halfMinutes, 5, halfMax);
    if (half != null) base.time.halfMinutes = half;
    else if (base.time.halfMinutes > halfMax) base.time.halfMinutes = 20;
    const ht = isRecord(time.halftime) ? time.halftime : null;
    if (base.time.periods === 1) {
      base.time.halftime = { enabled: false, minutes: 0 };
    } else if (ht && typeof ht.enabled === 'boolean') {
      const minutes = intIn(ht.minutes, 0, 30) ?? 0;
      base.time.halftime = ht.enabled ? { enabled: true, minutes } : { enabled: false, minutes: 0 };
    }
    base.time.note = readNote(time.note);
  }

  const sub = isRecord(rules.substitution) ? rules.substitution : null;
  if (sub) {
    const mode = oneOf(sub.mode, ['unlimitedReturn', 'limitedCount'] as const);
    if (mode === 'unlimitedReturn') base.substitution = { mode, maxCount: null, note: readNote(sub.note) };
    else if (mode === 'limitedCount') {
      const max = intIn(sub.maxCount, 1, 15);
      if (max != null) base.substitution = { mode, maxCount: max, note: readNote(sub.note) };
      else base.substitution.note = readNote(sub.note);
    } else base.substitution.note = readNote(sub.note);
  }

  const points = isRecord(rules.points) ? rules.points : null;
  if (points) {
    const win = intIn(points.win, 0, 20);
    const draw = intIn(points.draw, 0, 20);
    const loss = intIn(points.loss, -20, 20);
    if (win != null) base.points.win = win;
    if (draw != null) base.points.draw = draw;
    if (loss != null) base.points.loss = loss;
    base.points.note = readNote(points.note);
  }

  const tb = isRecord(rules.tieBreak) ? rules.tieBreak : null;
  if (tb) {
    // 清單要非空、白名單、不重複、第一項是 points，才覆蓋排序；否則仍看 schedule.ranking。
    // preset 只看清單是否與某捷徑展開完全相同，不採用文件上的 preset。
    if (criteriaValid(tb.criteria)) {
      base.tieBreak.criteria = [...tb.criteria];
      base.tieBreak.preset = inferPreset(tb.criteria);
    }
    if (tb.h2hScope === 'miniLeagueThenRestart') base.tieBreak.h2hScope = 'miniLeagueThenRestart';
    base.tieBreak.note = readNote(tb.note);
  }

  const draw = isRecord(rules.draw) ? rules.draw : null;
  if (draw) {
    if (draw.roundRobin === 'allowDraw') base.draw.roundRobin = 'allowDraw';
    if (draw.knockout === 'pendingStep5') base.draw.knockout = 'pendingStep5';
    base.draw.note = readNote(draw.note);
  }

  const wo = isRecord(rules.walkover) ? rules.walkover : null;
  if (wo) {
    const scoreFor = intIn(wo.scoreFor, 0, 99);
    const scoreAgainst = intIn(wo.scoreAgainst, 0, 99);
    const awardPoints = intIn(wo.awardPoints, -20, 20);
    const penaltyPoints = intIn(wo.penaltyPoints, -20, 20);
    if (scoreFor != null) base.walkover.scoreFor = scoreFor;
    if (scoreAgainst != null) base.walkover.scoreAgainst = scoreAgainst;
    if (awardPoints != null) base.walkover.awardPoints = awardPoints;
    if (penaltyPoints != null) base.walkover.penaltyPoints = penaltyPoints;
    if (typeof wo.countInGoalStats === 'boolean') base.walkover.countInGoalStats = wo.countInGoalStats;
    base.walkover.note = readNote(wo.note);
  }

  const late = isRecord(rules.late) ? rules.late : null;
  if (late) {
    if (late.graceMin == null) base.late.graceMin = null;
    else {
      const g = intIn(late.graceMin, 0, 60);
      if (g != null) base.late.graceMin = g;
    }
    base.late.note = readNote(late.note);
  }

  const sus = isRecord(rules.suspension) ? rules.suspension : null;
  if (sus) {
    if (typeof sus.enabled === 'boolean') base.suspension.enabled = sus.enabled;
    const yellowThreshold = intIn(sus.yellowThreshold, 1, 10);
    const yellowBanMatches = intIn(sus.yellowBanMatches, 1, 5);
    const directRedBanMatches = intIn(sus.directRedBanMatches, 1, 5);
    if (yellowThreshold != null) base.suspension.yellowThreshold = yellowThreshold;
    if (yellowBanMatches != null) base.suspension.yellowBanMatches = yellowBanMatches;
    if (directRedBanMatches != null) base.suspension.directRedBanMatches = directRedBanMatches;
    base.suspension.note = readNote(sus.note);
  }

  const fp = isRecord(rules.fairPlay) ? rules.fairPlay : null;
  if (fp) {
    const yellow = intIn(fp.yellow, -20, 0);
    const secondYellow = intIn(fp.secondYellow, -20, 0);
    const directRed = intIn(fp.directRed, -20, 0);
    const yellowThenRed = intIn(fp.yellowThenRed, -20, 0);
    if (yellow != null) base.fairPlay.yellow = yellow;
    if (secondYellow != null) base.fairPlay.secondYellow = secondYellow;
    if (directRed != null) base.fairPlay.directRed = directRed;
    if (yellowThenRed != null) base.fairPlay.yellowThenRed = yellowThenRed;
    base.fairPlay.note = readNote(fp.note);
  }

  const mercy = isRecord(rules.mercy) ? rules.mercy : null;
  if (mercy) {
    if (typeof mercy.enabled === 'boolean') base.mercy.enabled = mercy.enabled;
    const cap = intIn(mercy.cap, 1, 30);
    if (cap != null) base.mercy.cap = cap;
    base.mercy.note = readNote(mercy.note);
  }

  const eq = isRecord(rules.equipment) ? rules.equipment : null;
  if (eq) {
    const shinGuards = oneOf(eq.shinGuards, EQUIP);
    const sameColorKit = oneOf(eq.sameColorKit, EQUIP);
    const jerseyNumber = oneOf(eq.jerseyNumber, EQUIP);
    if (shinGuards) base.equipment.shinGuards = shinGuards;
    if (sameColorKit) base.equipment.sameColorKit = sameColorKit;
    if (jerseyNumber) base.equipment.jerseyNumber = jerseyNumber;
    base.equipment.note = readNote(eq.note);
  }

  const appeal = isRecord(rules.appeal) ? rules.appeal : null;
  if (appeal) {
    if (appeal.windowMin == null) base.appeal.windowMin = null;
    else {
      const w = intIn(appeal.windowMin, 0, 180);
      if (w != null) base.appeal.windowMin = w;
    }
    if (appeal.depositTwd == null) base.appeal.depositTwd = null;
    else {
      const d = intIn(appeal.depositTwd, 0, 100000);
      if (d != null) base.appeal.depositTwd = d;
    }
    base.appeal.note = readNote(appeal.note);
  }
}

function inferPreset(criteria: readonly Criterion[]): TiePreset {
  for (const [preset, list] of Object.entries(PRESET_CRITERIA) as Array<[Exclude<TiePreset, 'custom'>, readonly Criterion[]]>) {
    if (sameCriteria(criteria, list)) return preset;
  }
  return 'custom';
}

/** 組別文件 → 完整規則。沒有 rules 時只補預設，不寫回。 */
export function resolveRules(division: unknown): ResolvedRules {
  const d = isRecord(division) ? division : {};
  const base = legacyBase(d);
  if (!isRecord(d.rules)) return base;
  overlay(base, d.rules);
  return base;
}

function legacyRule(preset: 'h2hFirst' | 'goalDiffFirst'): RankingRule {
  const src = RANKING_RULES.RR_FEDA_DEFAULT;
  return {
    rankingRuleId: src.rankingRuleId,
    name: src.name,
    points: { ...src.points },
    criteria: criteriaOfPreset(preset),
    fairPlay: { ...src.fairPlay }
  };
}

function samePoints(a: PointsRule, b: PointsRule): boolean {
  return a.win === b.win && a.draw === b.draw && a.loss === b.loss;
}

function sameFair(a: FairPlayConfig, b: FairPlayConfig): boolean {
  return a.yellow === b.yellow && a.secondYellow === b.secondYellow
    && a.directRed === b.directRed && a.yellowThenRed === b.yellowThenRed;
}

/**
 * 組裝約定：rule 的 points／criteria／fairPlay，opts 的 fairPlay（同一份物件）、walkover、mercyRule。
 * 不放 cardEvents。舊的兩種捷徑且積分、清單、行為分都沒改時，rule 與 rankingRuleOf 同一份身分。
 */
export function engineInputsOf(resolved: ResolvedRules): { rule: RankingRule; opts: Partial<TallyOpts> } {
  const points: PointsRule = { win: resolved.points.win, draw: resolved.points.draw, loss: resolved.points.loss };
  const fairPlay: FairPlayConfig = {
    yellow: resolved.fairPlay.yellow,
    secondYellow: resolved.fairPlay.secondYellow,
    directRed: resolved.fairPlay.directRed,
    yellowThenRed: resolved.fairPlay.yellowThenRed
  };
  const walkover: WalkoverConfig = {
    scoreFor: resolved.walkover.scoreFor,
    scoreAgainst: resolved.walkover.scoreAgainst,
    awardPoints: resolved.walkover.awardPoints,
    penaltyPoints: resolved.walkover.penaltyPoints,
    countInGoalStats: resolved.walkover.countInGoalStats
  };
  const mercyRule: NonNullable<TallyOpts['mercyRule']> = resolved.mercy.enabled
    ? { enabled: true, cap: resolved.mercy.cap }
    : { enabled: false };

  const preset = resolved.tieBreak.preset;
  if (preset === 'h2hFirst' || preset === 'goalDiffFirst') {
    const legacy = legacyRule(preset);
    if (samePoints(points, legacy.points) && sameFair(fairPlay, legacy.fairPlay) && sameCriteria(resolved.tieBreak.criteria, legacy.criteria)) {
      return { rule: legacy, opts: { fairPlay: legacy.fairPlay, walkover, mercyRule } };
    }
  }

  const rule: RankingRule = {
    rankingRuleId: preset,
    name: PRESET_NAME[preset],
    points,
    criteria: [...resolved.tieBreak.criteria],
    fairPlay
  };
  return { rule, opts: { fairPlay, walkover, mercyRule } };
}

/**
 * 兩份解析結果交給引擎的計分輸入是否相同。相同就不重算。
 * 仁慈關著時 mercyRule 是 `{ enabled: false }`，不帶 cap。只改 cap 仍相同：關閉時 cap 不參與計算。
 */
export function sameScoringInputs(a: ResolvedRules, b: ResolvedRules): boolean {
  const left = engineInputsOf(a);
  const right = engineInputsOf(b);
  const pack = (x: ReturnType<typeof engineInputsOf>) => JSON.stringify({
    points: x.rule.points,
    criteria: x.rule.criteria,
    fairPlay: x.rule.fairPlay,
    walkover: x.opts.walkover,
    mercyRule: x.opts.mercyRule
  });
  return pack(left) === pack(right);
}

const TOP_KEYS = [
  'playersOnField', 'squad', 'time', 'substitution', 'points', 'tieBreak', 'draw',
  'walkover', 'late', 'suspension', 'fairPlay', 'mercy', 'equipment', 'appeal'
] as const;

function pushUnknown(errors: RulesIssue[], obj: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push({ field: prefix ? `${prefix}.${k}` : k, reason: 'UNKNOWN_FIELD' });
  }
}

function takeNote(errors: RulesIssue[], value: unknown, field: string): string | null {
  const n = cleanNote(value);
  if (!n.ok) {
    errors.push({ field, reason: n.reason });
    return null;
  }
  return n.value;
}

function needRecord(errors: RulesIssue[], value: unknown, field: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push({ field, reason: value == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
    return null;
  }
  return value;
}

function needInt(errors: RulesIssue[], value: unknown, field: string, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push({ field, reason: value == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
    return null;
  }
  if (value < min || value > max) {
    errors.push({ field, reason: 'FIELD_RANGE' });
    return null;
  }
  return value;
}

function needEnum<T extends string | number>(errors: RulesIssue[], value: unknown, field: string, allowed: readonly T[]): T | null {
  if (value == null) {
    errors.push({ field, reason: 'FIELD_REQUIRED' });
    return null;
  }
  if (!(allowed as readonly unknown[]).includes(value)) {
    errors.push({ field, reason: 'FIELD_ENUM' });
    return null;
  }
  return value as T;
}

function needNullInt(errors: RulesIssue[], value: unknown, field: string, min: number, max: number): number | null {
  if (value == null) return null;
  return needInt(errors, value, field, min, max);
}

/** 關閉時省略或 null 用預設；有送值仍驗範圍。開啟時與 needInt 相同，缺了是 FIELD_REQUIRED。 */
function closedInt(
  errors: RulesIssue[],
  value: unknown,
  field: string,
  min: number,
  max: number,
  enabled: boolean,
  fallback: number
): number | null {
  if (!enabled && value == null) return fallback;
  return needInt(errors, value, field, min, max);
}

function inspectCriteria(errors: RulesIssue[], value: unknown): Criterion[] | null {
  const field = 'tieBreak.criteria';
  if (!Array.isArray(value)) {
    errors.push({ field, reason: value == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
    return null;
  }
  if (value.length < 1 || value.length > CRITERIA.length) {
    errors.push({ field, reason: 'FIELD_RANGE' });
    return null;
  }
  const seen = new Set<string>();
  let badItem = false;
  let dup = false;
  for (const item of value) {
    if (typeof item !== 'string' || !CRITERIA.includes(item as Criterion)) badItem = true;
    else if (seen.has(item)) dup = true;
    else seen.add(item);
  }
  if (badItem) errors.push({ field, reason: 'FIELD_ENUM' });
  if (dup) errors.push({ field, reason: 'CRITERIA_DUPLICATE' });
  if (!badItem && value[0] !== 'points') errors.push({ field, reason: 'CRITERIA_POINTS_FIRST' });
  if (badItem || dup || value[0] !== 'points') return null;
  return [...value] as Criterion[];
}

interface Inspected {
  errors: RulesIssue[];
  warnings: string[];
  playersOnField: PlayersOnField | null;
  rules: StoredRules | null;
}

function inspect(input: unknown): Inspected {
  const errors: RulesIssue[] = [];
  const warnings: string[] = [];
  if (!isRecord(input)) {
    errors.push({ field: 'rules', reason: input == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
    return { errors, warnings, playersOnField: null, rules: null };
  }
  pushUnknown(errors, input, TOP_KEYS, '');

  const playersOnField = needEnum(errors, input.playersOnField, 'playersOnField', PLAYERS);

  const squad = needRecord(errors, input.squad, 'squad');
  if (squad) pushUnknown(errors, squad, ['note'], 'squad');
  const squadNote = squad ? takeNote(errors, squad.note, 'squad.note') : null;

  const time = needRecord(errors, input.time, 'time');
  let periods: 1 | 2 | null = null;
  let halfMinutes: number | null = null;
  let htEnabled: boolean | null = null;
  let htMinutes: number | null = null;
  let timeNote: string | null = null;
  if (time) {
    pushUnknown(errors, time, ['periods', 'halfMinutes', 'halftime', 'note'], 'time');
    periods = needEnum(errors, time.periods, 'time.periods', [1, 2] as const);
    const halfMax = periods === 2 ? 90 : 180;
    halfMinutes = needInt(errors, time.halfMinutes, 'time.halfMinutes', 5, periods == null ? 180 : halfMax);
    const ht = needRecord(errors, time.halftime, 'time.halftime');
    if (ht) {
      pushUnknown(errors, ht, ['enabled', 'minutes'], 'time.halftime');
      if (typeof ht.enabled !== 'boolean') errors.push({ field: 'time.halftime.enabled', reason: ht.enabled == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
      else htEnabled = ht.enabled;
      htMinutes = needInt(errors, ht.minutes, 'time.halftime.minutes', 0, 30);
    }
    timeNote = takeNote(errors, time.note, 'time.note');
    if (periods === 1 && htEnabled === true) errors.push({ field: 'time.halftime.enabled', reason: 'FIELD_RANGE' });
    if (periods === 1 && htMinutes != null && htMinutes > 0) errors.push({ field: 'time.halftime.minutes', reason: 'FIELD_RANGE' });
    if (htEnabled === false && htMinutes != null && htMinutes > 0) errors.push({ field: 'time.halftime.minutes', reason: 'FIELD_RANGE' });
  }

  const sub = needRecord(errors, input.substitution, 'substitution');
  let subMode: SubMode | null = null;
  let maxCount: number | null = null;
  let subNote: string | null = null;
  if (sub) {
    pushUnknown(errors, sub, ['mode', 'maxCount', 'note'], 'substitution');
    subMode = needEnum(errors, sub.mode, 'substitution.mode', ['unlimitedReturn', 'limitedCount'] as const);
    subNote = takeNote(errors, sub.note, 'substitution.note');
    if (subMode === 'unlimitedReturn') {
      if (sub.maxCount != null) errors.push({ field: 'substitution.maxCount', reason: 'FIELD_RANGE' });
    } else if (subMode === 'limitedCount') {
      maxCount = needInt(errors, sub.maxCount, 'substitution.maxCount', 1, 15);
    }
  }

  const points = needRecord(errors, input.points, 'points');
  let win: number | null = null;
  let drawPts: number | null = null;
  let loss: number | null = null;
  let pointsNote: string | null = null;
  if (points) {
    pushUnknown(errors, points, ['win', 'draw', 'loss', 'note'], 'points');
    win = needInt(errors, points.win, 'points.win', 0, 20);
    drawPts = needInt(errors, points.draw, 'points.draw', 0, 20);
    loss = needInt(errors, points.loss, 'points.loss', -20, 20);
    pointsNote = takeNote(errors, points.note, 'points.note');
    if (win != null && drawPts != null && loss != null && (win < drawPts || loss > drawPts)) warnings.push('POINTS_ORDER');
  }

  const tb = needRecord(errors, input.tieBreak, 'tieBreak');
  let preset: TiePreset | null = null;
  let criteria: Criterion[] | null = null;
  let tbNote: string | null = null;
  if (tb) {
    pushUnknown(errors, tb, ['preset', 'criteria', 'h2hScope', 'note'], 'tieBreak');
    // 輸入的 preset 仍須是合法列舉，但寫入值只由 criteria 推導。
    const givenPreset = needEnum(errors, tb.preset, 'tieBreak.preset', PRESETS);
    criteria = inspectCriteria(errors, tb.criteria);
    preset = criteria ? inferPreset(criteria) : givenPreset;
    if (tb.h2hScope !== 'miniLeagueThenRestart') {
      errors.push({ field: 'tieBreak.h2hScope', reason: tb.h2hScope == null ? 'FIELD_REQUIRED' : 'FIELD_ENUM' });
    }
    tbNote = takeNote(errors, tb.note, 'tieBreak.note');
  }

  const draw = needRecord(errors, input.draw, 'draw');
  let drawNote: string | null = null;
  if (draw) {
    pushUnknown(errors, draw, ['roundRobin', 'knockout', 'note'], 'draw');
    if (draw.roundRobin !== 'allowDraw') errors.push({ field: 'draw.roundRobin', reason: draw.roundRobin == null ? 'FIELD_REQUIRED' : 'FIELD_ENUM' });
    if (draw.knockout !== 'pendingStep5') errors.push({ field: 'draw.knockout', reason: draw.knockout == null ? 'FIELD_REQUIRED' : 'FIELD_ENUM' });
    drawNote = takeNote(errors, draw.note, 'draw.note');
  }

  const wo = needRecord(errors, input.walkover, 'walkover');
  let scoreFor: number | null = null;
  let scoreAgainst: number | null = null;
  let awardPoints: number | null = null;
  let penaltyPoints: number | null = null;
  let countInGoalStats: boolean | null = null;
  let woNote: string | null = null;
  if (wo) {
    pushUnknown(errors, wo, ['scoreFor', 'scoreAgainst', 'awardPoints', 'penaltyPoints', 'countInGoalStats', 'note'], 'walkover');
    scoreFor = needInt(errors, wo.scoreFor, 'walkover.scoreFor', 0, 99);
    scoreAgainst = needInt(errors, wo.scoreAgainst, 'walkover.scoreAgainst', 0, 99);
    awardPoints = needInt(errors, wo.awardPoints, 'walkover.awardPoints', -20, 20);
    penaltyPoints = needInt(errors, wo.penaltyPoints, 'walkover.penaltyPoints', -20, 20);
    if (typeof wo.countInGoalStats !== 'boolean') {
      errors.push({ field: 'walkover.countInGoalStats', reason: wo.countInGoalStats == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
    } else countInGoalStats = wo.countInGoalStats;
    woNote = takeNote(errors, wo.note, 'walkover.note');
  }

  const late = needRecord(errors, input.late, 'late');
  let graceMin: number | null = null;
  let lateNote: string | null = null;
  if (late) {
    pushUnknown(errors, late, ['graceMin', 'note'], 'late');
    graceMin = needNullInt(errors, late.graceMin, 'late.graceMin', 0, 60);
    lateNote = takeNote(errors, late.note, 'late.note');
  }

  const sus = needRecord(errors, input.suspension, 'suspension');
  let susEnabled: boolean | null = null;
  let yellowThreshold: number | null = null;
  let yellowBanMatches: number | null = null;
  let directRedBanMatches: number | null = null;
  let susNote: string | null = null;
  if (sus) {
    pushUnknown(errors, sus, ['enabled', 'yellowThreshold', 'yellowBanMatches', 'directRedBanMatches', 'note'], 'suspension');
    if (typeof sus.enabled !== 'boolean') errors.push({ field: 'suspension.enabled', reason: sus.enabled == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
    else susEnabled = sus.enabled;
    // 關閉時三欄可省略或 null，存成 2／1／1。開啟時仍必填。有送的數字照範圍驗。
    const susOn = susEnabled === true;
    yellowThreshold = closedInt(errors, sus.yellowThreshold, 'suspension.yellowThreshold', 1, 10, susOn, 2);
    yellowBanMatches = closedInt(errors, sus.yellowBanMatches, 'suspension.yellowBanMatches', 1, 5, susOn, 1);
    directRedBanMatches = closedInt(errors, sus.directRedBanMatches, 'suspension.directRedBanMatches', 1, 5, susOn, 1);
    susNote = takeNote(errors, sus.note, 'suspension.note');
  }

  const fp = needRecord(errors, input.fairPlay, 'fairPlay');
  let yellow: number | null = null;
  let secondYellow: number | null = null;
  let directRed: number | null = null;
  let yellowThenRed: number | null = null;
  let fpNote: string | null = null;
  if (fp) {
    pushUnknown(errors, fp, ['yellow', 'secondYellow', 'directRed', 'yellowThenRed', 'note'], 'fairPlay');
    yellow = needInt(errors, fp.yellow, 'fairPlay.yellow', -20, 0);
    secondYellow = needInt(errors, fp.secondYellow, 'fairPlay.secondYellow', -20, 0);
    directRed = needInt(errors, fp.directRed, 'fairPlay.directRed', -20, 0);
    yellowThenRed = needInt(errors, fp.yellowThenRed, 'fairPlay.yellowThenRed', -20, 0);
    fpNote = takeNote(errors, fp.note, 'fairPlay.note');
  }

  const mercy = needRecord(errors, input.mercy, 'mercy');
  let mercyEnabled: boolean | null = null;
  let cap: number | null = null;
  let mercyNote: string | null = null;
  if (mercy) {
    pushUnknown(errors, mercy, ['enabled', 'cap', 'note'], 'mercy');
    if (typeof mercy.enabled !== 'boolean') errors.push({ field: 'mercy.enabled', reason: mercy.enabled == null ? 'FIELD_REQUIRED' : 'FIELD_TYPE' });
    else mercyEnabled = mercy.enabled;
    // 關閉時 cap 可省略或 null，存成 7。開啟時仍必填。有送的數字照範圍驗，不改成預設。
    cap = closedInt(errors, mercy.cap, 'mercy.cap', 1, 30, mercyEnabled === true, 7);
    mercyNote = takeNote(errors, mercy.note, 'mercy.note');
  }

  const eq = needRecord(errors, input.equipment, 'equipment');
  let shinGuards: EquipChoice | null = null;
  let sameColorKit: EquipChoice | null = null;
  let jerseyNumber: EquipChoice | null = null;
  let eqNote: string | null = null;
  if (eq) {
    pushUnknown(errors, eq, ['shinGuards', 'sameColorKit', 'jerseyNumber', 'note'], 'equipment');
    shinGuards = needEnum(errors, eq.shinGuards, 'equipment.shinGuards', EQUIP);
    sameColorKit = needEnum(errors, eq.sameColorKit, 'equipment.sameColorKit', EQUIP);
    jerseyNumber = needEnum(errors, eq.jerseyNumber, 'equipment.jerseyNumber', EQUIP);
    eqNote = takeNote(errors, eq.note, 'equipment.note');
  }

  const appeal = needRecord(errors, input.appeal, 'appeal');
  let windowMin: number | null = null;
  let depositTwd: number | null = null;
  let appealNote: string | null = null;
  if (appeal) {
    pushUnknown(errors, appeal, ['windowMin', 'depositTwd', 'note'], 'appeal');
    windowMin = needNullInt(errors, appeal.windowMin, 'appeal.windowMin', 0, 180);
    depositTwd = needNullInt(errors, appeal.depositTwd, 'appeal.depositTwd', 0, 100000);
    appealNote = takeNote(errors, appeal.note, 'appeal.note');
  }

  if (
    playersOnField == null || periods == null || halfMinutes == null || htEnabled == null || htMinutes == null
    || subMode == null || win == null || drawPts == null || loss == null || preset == null || criteria == null
    || scoreFor == null || scoreAgainst == null || awardPoints == null || penaltyPoints == null || countInGoalStats == null
    || susEnabled == null || yellowThreshold == null || yellowBanMatches == null || directRedBanMatches == null
    || yellow == null || secondYellow == null || directRed == null || yellowThenRed == null
    || mercyEnabled == null || cap == null || shinGuards == null || sameColorKit == null || jerseyNumber == null
    || (subMode === 'limitedCount' && maxCount == null)
  ) {
    return { errors, warnings, playersOnField, rules: null };
  }
  if (errors.length > 0) return { errors, warnings, playersOnField, rules: null };

  const rules: StoredRules = {
    squad: { note: squadNote },
    time: {
      periods,
      halfMinutes,
      halftime: { enabled: htEnabled, minutes: htEnabled ? htMinutes : 0 },
      note: timeNote
    },
    substitution: { mode: subMode, maxCount: subMode === 'limitedCount' ? maxCount : null, note: subNote },
    points: { win, draw: drawPts, loss, note: pointsNote },
    tieBreak: { preset, criteria, h2hScope: 'miniLeagueThenRestart', note: tbNote },
    draw: { roundRobin: 'allowDraw', knockout: 'pendingStep5', note: drawNote },
    walkover: { scoreFor, scoreAgainst, awardPoints, penaltyPoints, countInGoalStats, note: woNote },
    late: { graceMin, note: lateNote },
    suspension: { enabled: susEnabled, yellowThreshold, yellowBanMatches, directRedBanMatches, note: susNote },
    fairPlay: { yellow, secondYellow, directRed, yellowThenRed, note: fpNote },
    mercy: { enabled: mercyEnabled, cap, note: mercyNote },
    equipment: { shinGuards, sameColorKit, jerseyNumber, note: eqNote },
    appeal: { windowMin, depositTwd, note: appealNote }
  };
  return { errors, warnings, playersOnField, rules };
}

/** 型別與範圍。勝分小於和分、或負分大於和分只進 warnings（POINTS_ORDER），不擋。 */
export function validateRulesInput(input: unknown): { errors: RulesIssue[]; warnings: string[] } {
  const r = inspect(input);
  return { errors: r.errors, warnings: r.warnings };
}

/** 驗證通過才回寫入用的鍵值（補充說明已清理）。playersOnField 不放進 rules。 */
export function rulesDocumentOf(input: unknown): { playersOnField: PlayersOnField; rules: StoredRules } | null {
  const r = inspect(input);
  if (r.errors.length || r.playersOnField == null || !r.rules) return null;
  return { playersOnField: r.playersOnField, rules: r.rules };
}
