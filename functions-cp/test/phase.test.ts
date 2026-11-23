import {
  AUTO_END_AFTER_MS,
  SCORE_PENDING_AFTER_MS,
  deriveCompetitionPhase
} from '../src/engine/phase.js';

const open = Date.parse('2026-06-01T00:00:00Z');
const close = Date.parse('2026-07-01T00:00:00Z');
const first = Date.parse('2026-08-01T00:00:00Z');
const last = Date.parse('2026-08-02T00:00:00Z');

const doc = {
  status: 'published',
  regOpenAt: open,
  regCloseAt: close,
  firstMatchAt: first,
  lastMatchAt: last
};

describe('deriveCompetitionPhase', () => {
  test('常數是 3 天與 14 天', () => {
    expect(SCORE_PENDING_AFTER_MS).toBe(3 * 24 * 60 * 60 * 1000);
    expect(AUTO_END_AFTER_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  test('draft 忽略壞掉的時間', () => {
    expect(deriveCompetitionPhase({ status: 'draft', firstMatchAt: 'nope' }, first)).toEqual({
      phase: 'draft', regOpen: false, scorePending: false, autoEndDue: false
    });
  });

  test('非 draft 但 firstMatchAt 無法解析就丟 TypeError，含取消與延期', () => {
    expect(() => deriveCompetitionPhase({ status: 'published' }, first)).toThrow(TypeError);
    expect(() => deriveCompetitionPhase({ status: 'cancelled', firstMatchAt: 'x' }, first)).toThrow(TypeError);
    expect(() => deriveCompetitionPhase({ status: 'postponed' }, first)).toThrow(TypeError);
  });

  test('cancelled 與 postponed 不是進行中', () => {
    expect(deriveCompetitionPhase({ ...doc, status: 'cancelled' }, last + AUTO_END_AFTER_MS).phase).toBe('cancelled');
    expect(deriveCompetitionPhase({ ...doc, status: 'postponed' }, first).scorePending).toBe(false);
  });

  test('有 endedAt 就是 ended；null 不算，解析失敗則丟錯', () => {
    expect(deriveCompetitionPhase({ ...doc, endedAt: first }, last).phase).toBe('ended');
    expect(deriveCompetitionPhase({ ...doc, endedAt: null }, first).phase).toBe('live');
    expect(() => deriveCompetitionPhase({ ...doc, endedAt: 'bad' }, first)).toThrow(TypeError);
  });

  test('開賽前：報名截止前是 recruiting，剛好截止與之後是 warmup', () => {
    expect(deriveCompetitionPhase(doc, close - 1).phase).toBe('recruiting');
    expect(deriveCompetitionPhase(doc, close).phase).toBe('warmup');
    expect(deriveCompetitionPhase(doc, first - 1).phase).toBe('warmup');
  });

  test('regOpen 只在 recruiting，且剛好等於 regOpenAt 那一毫秒為真', () => {
    expect(deriveCompetitionPhase(doc, open - 1)).toMatchObject({ phase: 'recruiting', regOpen: false });
    expect(deriveCompetitionPhase(doc, open)).toMatchObject({ phase: 'recruiting', regOpen: true });
    expect(deriveCompetitionPhase(doc, close - 1).regOpen).toBe(true);
    expect(deriveCompetitionPhase(doc, close).regOpen).toBe(false);
  });

  test('剛好等於 firstMatchAt 進入 live', () => {
    expect(deriveCompetitionPhase(doc, first).phase).toBe('live');
    expect(deriveCompetitionPhase(doc, first).scorePending).toBe(false);
  });

  test('末場後 3 天與 14 天的門檻含剛好那一毫秒', () => {
    const almost3 = last + SCORE_PENDING_AFTER_MS - 1;
    const at3 = last + SCORE_PENDING_AFTER_MS;
    const almost14 = last + AUTO_END_AFTER_MS - 1;
    const at14 = last + AUTO_END_AFTER_MS;
    expect(deriveCompetitionPhase(doc, almost3)).toMatchObject({ phase: 'live', scorePending: false, autoEndDue: false });
    expect(deriveCompetitionPhase(doc, at3)).toMatchObject({ phase: 'live', scorePending: true, autoEndDue: false });
    expect(deriveCompetitionPhase(doc, almost14)).toMatchObject({ scorePending: true, autoEndDue: false });
    expect(deriveCompetitionPhase(doc, at14)).toMatchObject({ scorePending: true, autoEndDue: true });
  });

  test('時間可以是 ISO、Date 或 toMillis()', () => {
    const iso = {
      status: 'published',
      regOpenAt: new Date(open).toISOString(),
      regCloseAt: { toMillis: () => close },
      firstMatchAt: new Date(first),
      lastMatchAt: new Date(last).toISOString()
    };
    expect(deriveCompetitionPhase(iso, open)).toMatchObject({ phase: 'recruiting', regOpen: true });
    expect(deriveCompetitionPhase(iso, first).phase).toBe('live');
  });

  test('該階段缺時間就丟 TypeError', () => {
    expect(() => deriveCompetitionPhase({ ...doc, regCloseAt: 'x' }, open)).toThrow(TypeError);
    expect(() => deriveCompetitionPhase({ ...doc, regOpenAt: null }, open)).toThrow(TypeError);
    expect(() => deriveCompetitionPhase({ ...doc, lastMatchAt: 'x' }, first)).toThrow(TypeError);
  });

  test('doc 不是物件或 nowMs 不是有限數字就丟 TypeError', () => {
    expect(() => deriveCompetitionPhase(null as unknown as { status: string }, first)).toThrow(TypeError);
    expect(() => deriveCompetitionPhase(doc, Number.NaN)).toThrow(TypeError);
  });
});
