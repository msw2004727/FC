/**
 * 改規則公告（純函式）：改前→改後、排序捷徑、負數、超長截斷。
 * 截斷以碼位計，不切開組合 emoji。
 */
import { describe, expect, it } from 'vitest';
import { NOTICE_LIMITS } from '../src/cp/notice.js';
import {
  assembleRulesNotice,
  rulesChangeNoticeText,
  rulesNoticeItems,
  scoringChangesOf
} from '../src/cp/rules-notice.js';
import { clipCodePoints, codePointLength } from '../src/cp/text.js';
import { RULE_TEMPLATES, sameScoringInputs, type Criterion, type ResolvedRules } from '../src/engine/index.js';

const FAMILY = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';

function base(): ResolvedRules {
  return structuredClone(RULE_TEMPLATES.five);
}

function textOf(before: ResolvedRules, after: ResolvedRules, reason: string, monthDay = '1/9', max?: number): string {
  return rulesChangeNoticeText({ monthDay, before, after, reason, max });
}

function listed(text: string): string[] {
  const mark = '修改：';
  const from = text.indexOf(mark) + mark.length;
  const etc = text.indexOf('…等', from);
  const end = etc >= 0 ? etc : text.indexOf('；原因：', from);
  const body = text.slice(from, end);
  return body ? body.split('、') : [];
}

describe('碼位截斷不切開字素', () => {
  it('單一碼位的 emoji、組合附加符號、膚色、國旗、變體選擇器、ZWJ 家庭都整段留或整段拿掉', () => {
    const grin = '\u{1F600}';
    expect(codePointLength(grin)).toBe(1);
    expect(grin.length).toBe(2);
    expect(clipCodePoints(grin, 1)).toBe(grin);
    expect(clipCodePoints('甲' + grin, 1)).toBe('甲');

    const acute = 'e\u0301';
    expect(codePointLength(acute)).toBe(2);
    expect(clipCodePoints(acute, 1)).toBe('');
    expect(clipCodePoints('a' + acute, 2)).toBe('a');
    expect([...('a' + acute)].slice(0, 2).join('')).toBe('ae');

    const skin = '\u{1F44D}\u{1F3FD}';
    expect(clipCodePoints(skin, 1)).toBe('');
    expect(clipCodePoints(skin, 2)).toBe(skin);

    const flag = '\u{1F1F9}\u{1F1FC}';
    expect(clipCodePoints(flag, 1)).toBe('');
    expect(clipCodePoints(flag, 2)).toBe(flag);

    const emojiStyle = '\u263a\ufe0f';
    expect(clipCodePoints(emojiStyle, 1)).toBe('');
    expect(clipCodePoints(emojiStyle, 2)).toBe(emojiStyle);

    expect(codePointLength(FAMILY)).toBe(5);
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(FAMILY)]).toHaveLength(1);
    expect(clipCodePoints(FAMILY, 4)).toBe('');
    expect(clipCodePoints(FAMILY, 5)).toBe(FAMILY);
    const mixed = '甲' + FAMILY + '乙';
    expect(clipCodePoints(mixed, 4)).toBe('甲');
    expect([...mixed].slice(0, 4).join('')).toContain('\u200d');
  });
});

describe('規則公告文字', () => {
  it('單項：勝一場 3→2 分，原因用分號接在後面', () => {
    const before = base();
    const after = base();
    after.points.win = 2;
    expect(textOf(before, after, '調整勝分')).toBe('比賽規則於 1/9 修改：勝一場 3→2 分；原因：調整勝分');
    expect(scoringChangesOf(before, after)).toEqual([{ key: 'points.win', from: 3, to: 2 }]);
  });

  it('多項依草案順序，勝分在前、棄權方得分在後', () => {
    const before = base();
    const after = base();
    after.points.win = 2;
    after.walkover.penaltyPoints = -1;
    after.points.note = '這段僅顯示';
    const text = textOf(before, after, '兩項都改');
    expect(text).toBe('比賽規則於 1/9 修改：勝一場 3→2 分、棄權方得 0→−1 分；原因：兩項都改');
    expect(text).not.toContain('這段僅顯示');
    expect(text).not.toContain('points.');
    expect(text).not.toContain('walkover.');
    expect(scoringChangesOf(before, after)).toEqual([
      { key: 'points.win', from: 3, to: 2 },
      { key: 'walkover.penaltyPoints', from: 0, to: -1 }
    ]);
  });

  it('排序捷徑只寫名稱，不逐條列條件', () => {
    const before = base();
    const after = base();
    const custom: Criterion[] = ['points', 'wins', 'manual'];
    after.tieBreak.criteria = custom;
    after.tieBreak.preset = 'custom';
    const text = textOf(before, after, '排序改了');
    expect(text).toContain('同分排序 對戰關係優先→自訂順序');
    expect(text).not.toContain('wins');
    expect(text).not.toContain('manual');
    expect(text).not.toContain('headToHead');
    expect(text).not.toContain('h2hFirst');
    expect(text).not.toContain('custom');
    expect(scoringChangesOf(before, after)).toEqual([
      { key: 'tieBreak.preset', from: 'h2hFirst', to: 'custom' },
      { key: 'tieBreak.criteria', from: [...before.tieBreak.criteria], to: custom }
    ]);

    const goal = base();
    const goalDiff: Criterion[] = ['points', 'goalDiff', 'goalsFor', 'headToHeadPoints', 'manual'];
    goal.tieBreak.criteria = goalDiff;
    goal.tieBreak.preset = 'goalDiffFirst';
    expect(textOf(before, goal, '改得失球')).toContain('同分排序 對戰關係優先→得失球差優先');

    const left = base();
    const right = base();
    const fromList: Criterion[] = ['points', 'wins', 'manual'];
    const toList: Criterion[] = ['points', 'goalDiff', 'manual'];
    left.tieBreak.preset = 'custom';
    left.tieBreak.criteria = fromList;
    right.tieBreak.preset = 'custom';
    right.tieBreak.criteria = toList;
    const again = textOf(left, right, '仍是自訂');
    expect(again).toContain('同分排序 自訂順序→自訂順序');
    expect(again).not.toContain('goalDiff');
    expect(again).not.toContain('wins');
    expect(scoringChangesOf(left, right)).toEqual([
      { key: 'tieBreak.criteria', from: fromList, to: toList }
    ]);
  });

  it('負數用 U+2212', () => {
    const before = base();
    const after = base();
    after.points.loss = -1;
    after.fairPlay.yellow = -2;
    const text = textOf(before, after, '負分');
    expect(text).toContain('負一場 0→\u22121 分');
    expect(text).toContain('一張黃牌 \u22121→\u22122 分');
    expect(text).not.toMatch(/→-\d/);
  });

  it('單場球差上限：關閉寫不設，開啟寫球數；關閉時只改 cap 不列', () => {
    const before = base();
    const on = base();
    on.mercy.enabled = true;
    expect(textOf(before, on, '開啟上限')).toContain('單場球差上限 不設→7 球');
    expect(scoringChangesOf(before, on)).toEqual([{ key: 'mercy.enabled', from: false, to: true }]);

    const capped = base();
    capped.mercy.enabled = true;
    capped.mercy.cap = 5;
    const fromOn = base();
    fromOn.mercy.enabled = true;
    expect(textOf(fromOn, capped, '調低')).toContain('單場球差上限 7→5 球');
    expect(scoringChangesOf(fromOn, capped)).toEqual([{ key: 'mercy.cap', from: 7, to: 5 }]);

    const both = base();
    both.mercy.enabled = true;
    both.mercy.cap = 4;
    expect(textOf(before, both, '改上限')).toContain('單場球差上限 不設→4 球');
    expect(scoringChangesOf(before, both)).toEqual([
      { key: 'mercy.enabled', from: false, to: true },
      { key: 'mercy.cap', from: 7, to: 4 }
    ]);

    const capOnly = base();
    capOnly.mercy.cap = 9;
    expect(rulesNoticeItems(before, capOnly)).toEqual([]);
    expect(scoringChangesOf(before, capOnly)).toEqual([]);
    expect(sameScoringInputs(before, capOnly)).toBe(true);
  });

  it('只改補充說明或比賽時間不進公告', () => {
    const before = base();
    const after = base();
    after.time.note = '補時另計';
    after.squad.note = '人數說明';
    after.points.win = 2;
    const items = rulesNoticeItems(before, after);
    expect(items).toEqual(['勝一場 3→2 分']);
    expect(scoringChangesOf(before, after).map(c => c.key)).toEqual(['points.win']);
  });

  it('超長時從最後一項拿掉，等 N 項，原因完整，不切開組合 emoji', () => {
    const before = base();
    before.tieBreak.preset = 'youth';
    before.tieBreak.criteria = ['points', 'manual'];
    const after = base();
    after.tieBreak.preset = 'feda2026';
    after.tieBreak.criteria = ['points', 'wins', 'manual'];
    after.points.win = 2;
    after.points.draw = 2;
    after.points.loss = -1;
    after.walkover.scoreFor = 3;
    after.walkover.scoreAgainst = 1;
    after.walkover.awardPoints = 2;
    after.walkover.penaltyPoints = -1;
    after.walkover.countInGoalStats = false;
    after.fairPlay.yellow = -2;
    after.fairPlay.secondYellow = -4;
    after.fairPlay.directRed = -5;
    after.fairPlay.yellowThenRed = -6;
    after.mercy.enabled = true;
    after.mercy.cap = 9;
    after.time.note = '僅顯示，不該進公告';

    const items = rulesNoticeItems(before, after);
    expect(items).toHaveLength(14);
    expect(items[0]).toBe('勝一場 3→2 分');
    expect(items[3]).toBe('同分排序 兒童組（較早交給主辦裁定）→飛達盃 2026 規章第十九條');
    expect(items[items.length - 1]).toBe('單場球差上限 不設→9 球');
    expect(items.join('')).not.toContain('僅顯示');
    expect(items.join('')).not.toContain('wins');

    const reasonHead = '調整';
    const reason = reasonHead + '字'.repeat(100 - codePointLength(reasonHead + FAMILY)) + FAMILY;
    expect(codePointLength(reason)).toBe(100);
    const loose = textOf(before, after, reason, '12/31', 100_000);
    expect(codePointLength(loose)).toBeGreaterThan(NOTICE_LIMITS.textMax);
    const naive = [...loose].slice(0, NOTICE_LIMITS.textMax).join('');
    expect(naive.includes(FAMILY)).toBe(false);

    const text = textOf(before, after, reason, '12/31');
    expect(codePointLength(text)).toBeLessThanOrEqual(NOTICE_LIMITS.textMax);
    expect(text.endsWith('；原因：' + reason)).toBe(true);
    expect(text).toContain(`…等 ${items.length} 項`);
    const shown = listed(text);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(items.length);
    expect(shown).toEqual(items.slice(0, shown.length));
    expect(text.split(FAMILY).join('')).not.toContain('\u200d');

    const fit = textOf(before, after, '短原因', '1/9', codePointLength(textOf(before, after, '短原因', '1/9', 100_000)));
    expect(fit).not.toContain('…等');
    const overByOne = textOf(before, after, '短原因', '1/9', codePointLength(fit) - 1);
    expect(overByOne).toContain(`…等 ${items.length} 項`);
    expect(codePointLength(overByOne)).toBeLessThanOrEqual(codePointLength(fit) - 1);
    expect(overByOne.endsWith('；原因：短原因')).toBe(true);
    expect(listed(overByOne)).toEqual(items.slice(0, listed(overByOne).length));
  });

  it('項目本身是組合 emoji 時，截斷不會留下半個', () => {
    const reason = '原因';
    const items = [FAMILY, FAMILY, FAMILY];
    const loose = assembleRulesNotice('1/9', items, reason, 100_000);
    // 16 碼位會切進第一個家庭 emoji 的 ZWJ。組公告時改拿掉項目，不留半個。
    const max = 16;
    const naive = [...loose].slice(0, max).join('');
    expect(naive.split(FAMILY).join('')).toContain('\u200d');
    const text = assembleRulesNotice('1/9', items, reason, max);
    expect(codePointLength(text)).toBeLessThanOrEqual(max);
    expect(text.endsWith('；原因：' + reason)).toBe(true);
    expect(text.split(FAMILY).join('')).not.toContain('\u200d');
    const dropped = assembleRulesNotice('1/9', items, reason, 25);
    expect(dropped).toContain('…等 3 項');
    expect(dropped.endsWith('；原因：' + reason)).toBe(true);
    expect(dropped.split(FAMILY).join('')).not.toContain('\u200d');
  });
});
