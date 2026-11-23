/**
 * validateCompetitionConfig：每一種非法情況一個測試，訊息只有 messageKey。
 */
import { describe, expect, test } from 'vitest';
import { CONFIG_MESSAGE_KEYS, validateCompetitionConfig } from '../src/engine/index.js';

const CJK = /[\u3400-\u9fff]/;

function valid() {
  return {
    divisions: [{
      divisionId: 'd1',
      teamCount: 8,
      playersOnField: 9,
      matchDurationMin: 30,
      periods: 2
    }],
    format: { kind: 'roundRobin', teamCount: 8, legs: 1 },
    fields: [{ venueId: 'f1', fieldType: '9v9' }],
    time: {
      dayStart: '08:30',
      dayEnd: '18:00',
      matchMinutes: 30,
      bufferMinutes: 10,
      dates: ['2026-10-11']
    },
    points: { win: 3, draw: 1, loss: 0 },
    criteria: ['points', 'goalDiff', 'manual']
  };
}

function keysOf(config) {
  return validateCompetitionConfig(config).errors.map(e => e.messageKey);
}

describe('合法設定', () => {
  test('完整設定 ok，且沒有 errors 以外的中文', () => {
    const result = validateCompetitionConfig(valid());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('積分可以平手同分，勝場積分不必大於和局', () => {
    const config = valid();
    config.points = { win: 1, draw: 1, loss: 0 };
    expect(validateCompetitionConfig(config).ok).toBe(true);
  });

  test('公平競賽條件有給權重時可以過', () => {
    const config = valid();
    config.criteria = ['points', 'fairPlay'];
    config.fairPlay = { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 };
    expect(validateCompetitionConfig(config).ok).toBe(true);
  });
});

describe('每一種非法 key', () => {
  test('cp.config.divisions.required', () => {
    expect(keysOf({ ...valid(), divisions: [] })).toContain('cp.config.divisions.required');
  });

  test('cp.config.division.id.required', () => {
    const config = valid();
    config.divisions = [{ teamCount: 8 }];
    expect(keysOf(config)).toContain('cp.config.division.id.required');
  });

  test('cp.config.division.id.duplicate', () => {
    const config = valid();
    config.divisions.push({ divisionId: 'd1', teamCount: 8 });
    expect(keysOf(config)).toContain('cp.config.division.id.duplicate');
  });

  test('cp.config.division.playersOnField.invalid', () => {
    const config = valid();
    config.divisions[0].playersOnField = 0;
    expect(keysOf(config)).toContain('cp.config.division.playersOnField.invalid');
  });

  test('cp.config.division.matchDurationMin.invalid', () => {
    const config = valid();
    config.divisions[0].matchDurationMin = 0;
    expect(keysOf(config)).toContain('cp.config.division.matchDurationMin.invalid');
  });

  test('cp.config.division.periods.invalid', () => {
    const config = valid();
    config.divisions[0].periods = 3;
    expect(keysOf(config)).toContain('cp.config.division.periods.invalid');
  });

  test('cp.config.teamCount.required', () => {
    const config = valid();
    delete config.divisions[0].teamCount;
    expect(keysOf(config)).toContain('cp.config.teamCount.required');
  });

  test('cp.config.teamCount.notInteger', () => {
    const config = valid();
    config.divisions[0].teamCount = 8.5;
    expect(keysOf(config)).toContain('cp.config.teamCount.notInteger');
  });

  test('cp.config.teamCount.tooFew', () => {
    const config = valid();
    config.divisions[0].teamCount = 1;
    config.format.teamCount = 1;
    expect(keysOf(config)).toContain('cp.config.teamCount.tooFew');
  });

  test('cp.config.teamCount.tooMany', () => {
    const config = valid();
    config.divisions[0].teamCount = 65;
    config.format.teamCount = 65;
    expect(keysOf(config)).toContain('cp.config.teamCount.tooMany');
  });

  test('cp.config.teamCount.mismatch', () => {
    const config = valid();
    config.divisions[0].teamCount = 6;
    expect(keysOf(config)).toContain('cp.config.teamCount.mismatch');
  });

  test('cp.config.format.required', () => {
    const config = valid();
    delete config.format;
    expect(keysOf(config)).toContain('cp.config.format.required');
  });

  test('cp.config.format.kind.invalid', () => {
    const config = valid();
    config.format.kind = 'swiss';
    expect(keysOf(config)).toContain('cp.config.format.kind.invalid');
  });

  test('cp.config.format.legs.invalid', () => {
    const config = valid();
    config.format.legs = 3;
    expect(keysOf(config)).toContain('cp.config.format.legs.invalid');
  });

  test('cp.config.format.drawRule.invalid', () => {
    const config = valid();
    config.format = { kind: 'knockout', teamCount: 8, drawRule: 'extra', thirdPlace: false };
    config.divisions[0].teamCount = 8;
    expect(keysOf(config)).toContain('cp.config.format.drawRule.invalid');
  });

  test('cp.config.format.thirdPlace.invalid', () => {
    const config = valid();
    config.format = { kind: 'knockout', teamCount: 8, thirdPlace: 'yes' };
    config.divisions[0].teamCount = 8;
    expect(keysOf(config)).toContain('cp.config.format.thirdPlace.invalid');
  });

  test('cp.config.format.thirdPlace.unavailable', () => {
    const config = valid();
    config.format = { kind: 'knockout', teamCount: 3, thirdPlace: true };
    config.divisions[0].teamCount = 3;
    expect(keysOf(config)).toContain('cp.config.format.thirdPlace.unavailable');
  });

  test('cp.config.format.groupCount.invalid', () => {
    const config = valid();
    config.format = { kind: 'groupKnockout', groupCount: 3, groupSize: 4, advancePerGroup: 2 };
    config.divisions[0].teamCount = 12;
    expect(keysOf(config)).toContain('cp.config.format.groupCount.invalid');
  });

  test('cp.config.format.groupCount.invalid：組數超過 26', () => {
    const config = valid();
    config.format = { kind: 'groupKnockout', groupCount: 32, groupSize: 2, advancePerGroup: 1 };
    config.divisions[0].teamCount = 64;
    const keys = keysOf(config);
    expect(keys).toContain('cp.config.format.groupCount.invalid');
    expect(keys).not.toContain('cp.config.format.thirdPlace.unavailable');
  });

  test('cp.config.format.groupSize.invalid', () => {
    const config = valid();
    config.format = { kind: 'groupKnockout', groupCount: 2, groupSize: 1, advancePerGroup: 1 };
    config.divisions[0].teamCount = 2;
    expect(keysOf(config)).toContain('cp.config.format.groupSize.invalid');
  });

  test('cp.config.format.advance.invalid', () => {
    const config = valid();
    config.format = { kind: 'groupKnockout', groupCount: 2, groupSize: 4, advancePerGroup: 5 };
    config.divisions[0].teamCount = 8;
    expect(keysOf(config)).toContain('cp.config.format.advance.invalid');
  });

  test('cp.config.fields.required', () => {
    expect(keysOf({ ...valid(), fields: [] })).toContain('cp.config.fields.required');
  });

  test('cp.config.fields.venueId.required', () => {
    const config = valid();
    config.fields = [{}];
    expect(keysOf(config)).toContain('cp.config.fields.venueId.required');
  });

  test('cp.config.fields.venueId.duplicate', () => {
    const config = valid();
    config.fields = [
      { venueId: 'f1', fieldType: '9v9' },
      { venueId: 'f1', fieldType: '9v9' }
    ];
    expect(keysOf(config)).toContain('cp.config.fields.venueId.duplicate');
  });

  test('cp.config.fields.tooSmall', () => {
    const config = valid();
    config.fields = [{ venueId: 'f1', fieldType: '5v5' }];
    expect(keysOf(config)).toContain('cp.config.fields.tooSmall');
  });

  test('cp.config.time.required', () => {
    const config = valid();
    delete config.time;
    expect(keysOf(config)).toContain('cp.config.time.required');
  });

  test('cp.config.time.invalid', () => {
    const config = valid();
    config.time.dayStart = '8:30';
    expect(keysOf(config)).toContain('cp.config.time.invalid');
  });

  test('cp.config.time.dayEnd.beforeStart', () => {
    const config = valid();
    config.time.dayEnd = '08:00';
    expect(keysOf(config)).toContain('cp.config.time.dayEnd.beforeStart');
  });

  test('cp.config.time.matchMinutes.invalid', () => {
    const config = valid();
    config.time.matchMinutes = 0;
    expect(keysOf(config)).toContain('cp.config.time.matchMinutes.invalid');
  });

  test('cp.config.time.bufferMinutes.invalid', () => {
    const config = valid();
    config.time.bufferMinutes = -1;
    expect(keysOf(config)).toContain('cp.config.time.bufferMinutes.invalid');
  });

  test('cp.config.time.window.tooShort', () => {
    const config = valid();
    config.time.matchMinutes = 600;
    expect(keysOf(config)).toContain('cp.config.time.window.tooShort');
  });

  test('cp.config.time.date.invalid', () => {
    const config = valid();
    config.time.dates = ['2026/10/11'];
    expect(keysOf(config)).toContain('cp.config.time.date.invalid');
  });

  test('cp.config.points.required', () => {
    const config = valid();
    delete config.points;
    expect(keysOf(config)).toContain('cp.config.points.required');
  });

  test('cp.config.points.invalid', () => {
    const config = valid();
    config.points = { win: Number.NaN, draw: 1, loss: 0 };
    expect(keysOf(config)).toContain('cp.config.points.invalid');
  });

  test('cp.config.criteria.required', () => {
    const config = valid();
    config.criteria = [];
    expect(keysOf(config)).toContain('cp.config.criteria.required');
  });

  test('cp.config.criteria.unknown', () => {
    const config = valid();
    config.criteria = ['goalDifference'];
    expect(keysOf(config)).toContain('cp.config.criteria.unknown');
  });

  test('cp.config.criteria.duplicate', () => {
    const config = valid();
    config.criteria = ['points', 'points'];
    expect(keysOf(config)).toContain('cp.config.criteria.duplicate');
  });

  test('cp.config.fairPlay.required', () => {
    const config = valid();
    config.criteria = ['points', 'fairPlay'];
    expect(keysOf(config)).toContain('cp.config.fairPlay.required');
  });

  test('cp.config.fairPlay.invalid', () => {
    const config = valid();
    config.fairPlay = { yellow: 'x', secondYellow: -3, directRed: -4, yellowThenRed: -5 };
    expect(keysOf(config)).toContain('cp.config.fairPlay.invalid');
  });
});

describe('key 清單完整且沒有中文', () => {
  test('每個 CONFIG_MESSAGE_KEYS 都有案例產生，回傳的 key 都不超出清單', () => {
    const produced = new Set();
    const samples = [
      { ...valid(), divisions: [] },
      { ...valid(), divisions: [null] },
      (() => { const c = valid(); c.divisions.push({ divisionId: 'd1', teamCount: 8 }); return c; })(),
      (() => { const c = valid(); c.divisions[0].playersOnField = 1.5; return c; })(),
      (() => { const c = valid(); c.divisions[0].matchDurationMin = -5; return c; })(),
      (() => { const c = valid(); c.divisions[0].periods = 0; return c; })(),
      (() => { const c = valid(); delete c.divisions[0].teamCount; return c; })(),
      (() => { const c = valid(); c.divisions[0].teamCount = 2.2; return c; })(),
      (() => { const c = valid(); c.divisions[0].teamCount = 1; c.format.teamCount = 1; return c; })(),
      (() => { const c = valid(); c.divisions[0].teamCount = 80; c.format.teamCount = 80; return c; })(),
      (() => { const c = valid(); c.divisions[0].teamCount = 4; return c; })(),
      (() => { const c = valid(); delete c.format; return c; })(),
      (() => { const c = valid(); c.format.kind = 'league'; return c; })(),
      (() => { const c = valid(); c.format.legs = 4; return c; })(),
      (() => { const c = valid(); c.format = { kind: 'knockout', teamCount: 4, drawRule: 'pk' }; c.divisions[0].teamCount = 4; return c; })(),
      (() => { const c = valid(); c.format = { kind: 'knockout', teamCount: 4, thirdPlace: 1 }; c.divisions[0].teamCount = 4; return c; })(),
      (() => { const c = valid(); c.format = { kind: 'knockout', teamCount: 3, thirdPlace: true }; c.divisions[0].teamCount = 3; return c; })(),
      (() => { const c = valid(); c.format = { kind: 'groupKnockout', groupCount: 6, groupSize: 2, advancePerGroup: 1 }; c.divisions[0].teamCount = 12; return c; })(),
      (() => { const c = valid(); c.format = { kind: 'groupKnockout', groupCount: 2, groupSize: 0, advancePerGroup: 1 }; c.divisions[0].teamCount = 2; return c; })(),
      (() => { const c = valid(); c.format = { kind: 'groupKnockout', groupCount: 2, groupSize: 4, advancePerGroup: 0 }; c.divisions[0].teamCount = 8; return c; })(),
      { ...valid(), fields: null },
      (() => { const c = valid(); c.fields = [{ name: 'x' }]; return c; })(),
      (() => { const c = valid(); c.fields = [{ venueId: 'f1' }, { venueId: 'f1' }]; return c; })(),
      (() => { const c = valid(); c.fields = [{ venueId: 's', fieldType: '5v5' }]; return c; })(),
      (() => { const c = valid(); delete c.time; return c; })(),
      (() => { const c = valid(); c.time.dayEnd = '25:00'; return c; })(),
      (() => { const c = valid(); c.time.dayStart = '18:00'; c.time.dayEnd = '09:00'; return c; })(),
      (() => { const c = valid(); c.time.matchMinutes = -1; return c; })(),
      (() => { const c = valid(); c.time.bufferMinutes = 1.5; return c; })(),
      (() => { const c = valid(); c.time.matchMinutes = 600; return c; })(),
      (() => { const c = valid(); c.time.dates = '2026-10-11'; return c; })(),
      (() => { const c = valid(); c.points = null; return c; })(),
      (() => { const c = valid(); c.points = { win: 3, draw: '1', loss: 0 }; return c; })(),
      (() => { const c = valid(); c.criteria = null; return c; })(),
      (() => { const c = valid(); c.criteria = ['not-a-rule']; return c; })(),
      (() => { const c = valid(); c.criteria = ['wins', 'wins']; return c; })(),
      (() => { const c = valid(); c.criteria = ['fairPlay']; return c; })(),
      (() => { const c = valid(); c.fairPlay = { yellow: 1 }; return c; })(),
      (() => {
        const c = valid();
        c.format = { kind: 'groupKnockout', groupCount: 4, groupSize: 4, advancePerGroup: 2, teamCount: 10 };
        c.divisions[0].teamCount = 16;
        return c;
      })()
    ];
    for (const sample of samples) {
      const result = validateCompetitionConfig(sample);
      expect(CJK.test(JSON.stringify(result.errors))).toBe(false);
      for (const err of result.errors) {
        expect(CONFIG_MESSAGE_KEYS).toContain(err.messageKey);
        produced.add(err.messageKey);
      }
    }
    expect(CONFIG_MESSAGE_KEYS.filter(key => !produced.has(key))).toEqual([]);
  });
});
