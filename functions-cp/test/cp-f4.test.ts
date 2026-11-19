/**
 * §3.272 F4 純函式（不需模擬器）：公告額度、系統公告汰換、聯絡文字、取消文案、積分文件組別名稱。
 */
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { CpError } from '../src/cp/errors.js';
import { MATCH_HOST_ACTIONS } from '../src/cp/match-host.js';
import { zeroStandingDoc } from '../src/cp/match-trigger.js';
import { rankingRuleOf } from '../src/cp/schedule-plan.js';
import { buildStanding, engineInputsOf, resolveRules } from '../src/engine/index.js';
import {
  NOTICE_LIMITS,
  appendSystemNotice,
  cancelNoticeText,
  noticeTextOf,
  noticesOf,
  pushNotice,
  removeNotice,
  taipeiMonthDay,
  type Notice
} from '../src/cp/notice.js';
import { SUGGESTED_BANNED_WORDS } from '../src/cp/text.js';
import { contactNoteOf } from '../src/cp/validate.js';

const W = SUGGESTED_BANNED_WORDS;
const reasonOf = (fn: () => unknown) => {
  try { fn(); return 'NO_ERROR'; } catch (e) { return (e as CpError).reason; }
};
const codeOf = (fn: () => unknown) => {
  try { fn(); return 'NO_ERROR'; } catch (e) { return (e as CpError).code; }
};

function at(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

function note(kind: 'host' | 'system', n: number, text = `${kind}${n}`): Notice {
  return { id: `nt_${n.toString(36).padStart(20, '0')}`, text, kind, at: at(1_000 + n), by: 'abcdef0123456789' };
}

describe('公告額度與汰換', () => {
  it('postNotice、deleteNotice 已掛上 cpHost', () => {
    expect(typeof MATCH_HOST_ACTIONS.postNotice).toBe('function');
    expect(typeof MATCH_HOST_ACTIONS.deleteNotice).toBe('function');
  });

  it('手動滿 20 再加回 NOTICE_LIMIT；系統公告不占這 20 則', () => {
    const host = Array.from({ length: NOTICE_LIMITS.hostMax }, (_, i) => note('host', i));
    expect(reasonOf(() => pushNotice(host, note('host', 99)))).toBe('NOTICE_LIMIT');
    expect(codeOf(() => pushNotice(host, note('host', 99)))).toBe('resource-exhausted');
    const withSystem = pushNotice(host, note('system', 1, '系統一則'));
    expect(withSystem.filter(n => n.kind === 'host')).toHaveLength(20);
    expect(withSystem.filter(n => n.kind === 'system')).toHaveLength(1);
    expect(withSystem).toHaveLength(21);
  });

  it('系統公告超過 N 則時丟掉最舊的，手動公告留在原位', () => {
    const limits = { hostMax: 20, systemMax: 2 };
    const existing = [note('host', 1, '手動甲'), note('system', 1, '舊'), note('host', 2, '手動乙'), note('system', 2, '次舊')];
    const next = pushNotice(existing, note('system', 3, '新'), limits);
    expect(next.map(n => n.text)).toEqual(['手動甲', '手動乙', '次舊', '新']);
  });

  it('同時刻用 id 分先後，新的這一則一定留下', () => {
    const limits = { hostMax: 20, systemMax: 1 };
    const old = note('system', 1, '舊');
    const next = pushNotice([old], { ...note('system', 2, '新'), at: old.at }, limits);
    expect(next.map(n => n.text)).toEqual(['新']);
  });

  it('形狀不對的元素略過；刪除可刪系統公告，沒有則 NOTICE_NOT_FOUND', () => {
    const good = note('system', 1, '留');
    const parsed = noticesOf([good, { id: 1 }, null, { id: 'x', text: 'y', kind: 'nope', at: at(1) }]);
    expect(parsed).toEqual([good]);
    expect(removeNotice(parsed, good.id).removed.kind).toBe('system');
    expect(reasonOf(() => removeNotice(parsed, 'nt_' + 'z'.repeat(20)))).toBe('NOTICE_NOT_FOUND');
  });

  it('appendSystemNotice 在手動額度用完時仍寫入，並汰換最舊的系統公告', () => {
    const host = Array.from({ length: 20 }, (_, i) => note('host', i, `手動${i}`));
    const system = Array.from({ length: 20 }, (_, i) => note('system', i, `系統${i}`));
    const updates: Array<Record<string, unknown>> = [];
    const tx = { update(_ref: unknown, data: Record<string, unknown>) { updates.push(data); } };
    const out = appendSystemNotice(tx as unknown as Transaction, {
      ref: {} as DocumentReference,
      notices: [...host, ...system],
      at: at(9_000),
      by: '0123456789abcdef'
    }, { kind: 'system', text: '1/9 甲隊對乙隊已取消：雨' });
    expect(out.id).toMatch(/^nt_[A-Za-z0-9]{20}$/);
    const written = updates[0]?.notices as Notice[];
    expect(written.filter(n => n.kind === 'host')).toHaveLength(20);
    expect(written.filter(n => n.kind === 'system')).toHaveLength(20);
    expect(written.some(n => n.text === '系統0')).toBe(false);
    const added = written[written.length - 1];
    expect(added).toMatchObject({ id: out.id, kind: 'system', text: '1/9 甲隊對乙隊已取消：雨', by: '0123456789abcdef' });
    expect(Object.keys(added).sort()).toEqual(['at', 'by', 'id', 'kind', 'text']);
    expect(JSON.stringify(added)).not.toContain('uid');
  });
});

describe('公告文字與取消文案', () => {
  it('可換行、上限 300；禁用詞、超長、空白拒絕', () => {
    expect(noticeTextOf('  延期一週  ', [])).toBe('延期一週');
    expect(noticeTextOf('第一行\n第二行', [])).toBe('第一行\n第二行');
    expect(noticeTextOf('字'.repeat(300), [])).toHaveLength(300);
    expect(reasonOf(() => noticeTextOf('字'.repeat(301), []))).toBe('FIELD_LENGTH');
    expect(reasonOf(() => noticeTextOf('   ', []))).toBe('FIELD_REQUIRED');
    expect(reasonOf(() => noticeTextOf(null, []))).toBe('FIELD_REQUIRED');
    expect(reasonOf(() => noticeTextOf(3, []))).toBe('FIELD_TYPE');
    expect(reasonOf(() => noticeTextOf('這是官方公告', W))).toBe('BANNED_WORD');
  });

  it('取消文案：白天寫比賽日，凌晨補日曆日與時刻；沒有開賽就不寫日期；超長截斷', () => {
    const midnight = Date.UTC(2026, 0, 8, 16, 0, 0);
    const daytime = Date.parse('2026-01-09T08:00:00+08:00');
    expect(taipeiMonthDay(midnight)).toBe('1/8');
    expect(taipeiMonthDay(Date.parse('2026-01-09T01:30:00+08:00'))).toBe('1/8');
    expect(taipeiMonthDay(Date.parse('2026-01-09T04:59:00+08:00'))).toBe('1/8');
    expect(taipeiMonthDay(Date.parse('2026-01-09T05:00:00+08:00'))).toBe('1/9');
    expect(taipeiMonthDay(daytime)).toBe('1/9');
    expect(cancelNoticeText({ kickoffMs: midnight, homeName: '甲隊', awayName: '乙隊', reason: '雨停' }))
      .toBe('1/9 00:00 甲隊對乙隊已取消：雨停');
    expect(cancelNoticeText({ kickoffMs: daytime, homeName: '甲隊', awayName: '乙隊', reason: '雨停' }))
      .toBe('1/9 甲隊對乙隊已取消：雨停');
    expect(cancelNoticeText({ kickoffMs: null, homeName: '甲隊', awayName: '乙隊', reason: '改期待定' }))
      .toBe('甲隊對乙隊已取消：改期待定');
    const long = cancelNoticeText({ kickoffMs: daytime, homeName: '甲', awayName: '乙', reason: '因'.repeat(400) });
    expect([...long]).toHaveLength(300);
  });
});

describe('主辦公開聯絡文字', () => {
  it('單行、去空白、上限 60；空的變 null', () => {
    expect(contactNoteOf(null, [])).toBeNull();
    expect(contactNoteOf('', [])).toBeNull();
    expect(contactNoteOf('   ', [])).toBeNull();
    expect(contactNoteOf('  表單連結  ', [])).toBe('表單連結');
    expect(contactNoteOf('聯'.repeat(60), [])).toBe('聯'.repeat(60));
  });

  it('禁用詞、超長、多行、型別不對都拒絕', () => {
    expect(reasonOf(() => contactNoteOf('官方聯絡', W))).toBe('BANNED_WORD');
    expect(reasonOf(() => contactNoteOf('聯'.repeat(61), []))).toBe('FIELD_LENGTH');
    expect(reasonOf(() => contactNoteOf('第一行\n第二行', []))).toBe('FIELD_FORMAT');
    expect(reasonOf(() => contactNoteOf('第一行\r\n第二行', []))).toBe('FIELD_FORMAT');
    expect(reasonOf(() => contactNoteOf(912345678, []))).toBe('FIELD_TYPE');
  });
});

describe('積分文件組別名稱', () => {
  const names = { en_a: '甲', en_b: '乙' };
  const teamIds = ['en_a', 'en_b'];

  function oldZero(preset: 'h2hFirst' | 'goalDiffFirst', prevVersion = 0) {
    const rule = rankingRuleOf(preset);
    const doc = buildStanding({
      competitionId: 'cp_x', divisionId: 'dv_x', stageId: 'group', groupId: 'A',
      teamIds, matches: [], rule,
      opts: { teamMeta: { en_a: { teamId: 'en_a', name: '甲' }, en_b: { teamId: 'en_b', name: '乙' } } },
      prev: { version: prevVersion }
    });
    return { ...doc, divisionName: '成人組', computedBy: 'cpHost:generateSchedule' };
  }

  it('全 0 積分榜帶上呼叫端已讀到的組別名稱', () => {
    const doc = zeroStandingDoc('cp_x', 'dv_x', teamIds, names, { schedule: { ranking: 'h2hFirst' } }, 'h2hFirst', 0, '成人組');
    expect(doc.divisionName).toBe('成人組');
    expect(doc.divisionId).toBe('dv_x');
    expect(doc.rows).toHaveLength(2);
  });

  it('沒有 rules 的全 0 積分榜與 rankingRuleOf 完全相同', () => {
    for (const preset of ['h2hFirst', 'goalDiffFirst'] as const) {
      const doc = zeroStandingDoc(
        'cp_x', 'dv_x', teamIds, names,
        { playersOnField: 11, schedule: { ranking: preset === 'h2hFirst' ? 'goalDiffFirst' : 'h2hFirst', matchMinutes: 40 } },
        preset, 3, '成人組'
      );
      const rule = rankingRuleOf(preset);
      const { updatedAt, rankingRuleId, criteria, ...rest } = doc;
      expect(updatedAt).toBeTruthy();
      expect(rankingRuleId).toBe(rule.rankingRuleId);
      expect(criteria).toEqual([...rule.criteria]);
      expect(rest).toEqual(oldZero(preset, 3));
    }
  });

  it('有 rules 時全 0 積分榜的 rankingRuleId 與 criteria 跟解析結果一致', () => {
    const custom = {
      playersOnField: 5,
      schedule: { ranking: 'goalDiffFirst' },
      rules: { tieBreak: { criteria: ['points', 'wins', 'manual'], preset: 'h2hFirst' } }
    };
    const customDoc = zeroStandingDoc('cp_x', 'dv_x', teamIds, names, custom, 'h2hFirst', 0, '成人組');
    const customRule = engineInputsOf(resolveRules({
      ...custom,
      schedule: { ...(custom.schedule), ranking: 'h2hFirst' }
    })).rule;
    expect(customDoc.rankingRuleId).toBe(customRule.rankingRuleId);
    expect(customDoc.criteria).toEqual([...customRule.criteria]);
    expect(customDoc.rankingRuleId).toBe('custom');
    expect(customDoc.criteria).toEqual(['points', 'wins', 'manual']);
    const h2hDoc = zeroStandingDoc('cp_x', 'dv_x', teamIds, names, {}, 'h2hFirst', 0, '成人組');
    expect(customDoc.rows.map(r => r.tieBreakTrace)).not.toEqual(h2hDoc.rows.map(r => r.tieBreakTrace));

    const pointsOnly = { rules: { points: { win: 2, draw: 1, loss: 0 } } };
    const pointsDoc = zeroStandingDoc('cp_x', 'dv_x', teamIds, names, pointsOnly, 'h2hFirst', 0, '成人組');
    const pointsRule = engineInputsOf(resolveRules({
      ...pointsOnly, schedule: { ranking: 'h2hFirst' }
    })).rule;
    expect(pointsDoc.rankingRuleId).toBe(pointsRule.rankingRuleId);
    expect(pointsDoc.criteria).toEqual([...pointsRule.criteria]);
    expect(pointsDoc.rankingRuleId).toBe('h2hFirst');
    expect(pointsDoc.rankingRuleId).not.toBe(rankingRuleOf('h2hFirst').rankingRuleId);
    expect(pointsDoc.criteria).toEqual([...rankingRuleOf('h2hFirst').criteria]);
  });
});
