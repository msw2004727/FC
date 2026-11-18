/**
 * DeepSeek flash 審查（優化 diff）P1-2、P2-1、P2-3 的回歸測試。
 */
import { describe, expect, test } from 'vitest';
import { affectedByMatchChange, previewSchedule, validateCompetitionConfig, standingIdOf } from '../src/engine/index.js';
import { FORMAT_TEMPLATES } from '../src/engine/formats.js';
import type { Format } from '../src/engine/types.js';

/** 預賽 2 組×4 → 複賽 1 組×4 的兩段循環賽制 */
const TWO_ROUND_ROBINS: Format = {
  formatId: 'T_RR2', name: 'two rr', teamCount: 8, description: '',
  stages: [
    { stageId: 'g1', name: '預賽', type: 'roundRobin', order: 1, groupCount: 2, groupSize: 4, legs: 1, seedingMethod: 'snake' },
    { stageId: 'g2', name: '複賽', type: 'roundRobin', order: 2, groupCount: 1, groupSize: 4, legs: 1, seedingMethod: 'snake' }
  ],
  finalRankingMap: []
} as unknown as Format;

describe('P1-2 預覽：多個循環階段', () => {
  test('最多場數累加兩段循環（3＋3＝6），最少只算第一段（3）；總場數 12＋6＝18', () => {
    const out = previewSchedule({
      format: TWO_ROUND_ROBINS, fields: 2, matchMinutes: 30, bufferMinutes: 0, dayStart: '08:00', dayEnd: '18:00'
    });
    expect(out.errors).toBeUndefined();
    expect(out.matchCount).toBe(18);
    expect(out.matchesPerTeam).toEqual({ min: 3, max: 6 });
  });
});

describe('P2-1 增量：沒帶 stageId', () => {
  test('多個循環階段時不猜階段（不回傳積分榜）；帶 stageId 時正確', () => {
    const guess = affectedByMatchChange(TWO_ROUND_ROBINS, { divisionId: 'div', groupId: 'A', status: 'finished' });
    expect(guess.standingIds).toEqual([]);
    const ok = affectedByMatchChange(TWO_ROUND_ROBINS, { divisionId: 'div', stageId: 'g2', groupId: 'A', status: 'finished' });
    expect(ok.standingIds).toEqual([standingIdOf('div', 'g2', 'A')]);
  });
});

describe('P2-3 設定驗證：組別都自帶 format 時仍驗證根層 format', () => {
  test('根層 format 非法會回錯誤', () => {
    const config = {
      divisions: [{ divisionId: 'd1', teamCount: 8, format: { kind: 'roundRobin', teamCount: 8, legs: 1 } }],
      format: { kind: 'bad' },
      fields: [{ venueId: 'f1', fieldType: '9v9' }],
      time: { dayStart: '08:30', dayEnd: '18:00', matchMinutes: 30, bufferMinutes: 10, dates: ['2026-10-11'] },
      points: { win: 3, draw: 1, loss: 0 },
      criteria: ['points', 'goalDiff', 'manual']
    };
    const keys = validateCompetitionConfig(config).errors.map(e => `${e.path}:${e.messageKey}`);
    expect(keys).toContain('format.kind:cp.config.format.kind.invalid');
  });
});

describe('第二輪審查疑慮：既有範本名次表涵蓋全隊', () => {
  test('五個飛達盃範本的 finalRankingMap 筆數都等於 teamCount（complete 新判斷不會讓既有範本退步）', () => {
    for (const [id, f] of Object.entries(FORMAT_TEMPLATES as Record<string, Format>)) {
      expect(f.finalRankingMap.length, id).toBe(f.teamCount);
    }
  });
});