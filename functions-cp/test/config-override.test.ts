import { matchFairPlay } from '../src/engine/live-actions.js';
import { fairPlayPoints } from '../src/engine/ranking.js';
import { computeRows } from '../src/engine/standing.js';
import { DEFAULT_WALKOVER, effectiveScore, tallyMatches } from '../src/engine/tally.js';
import { RANKING_RULES } from '../src/engine/formats.js';
import { mk } from './_helpers.js';

const customFair = { yellow: -2, secondYellow: -6, directRed: -8, yellowThenRed: -9 };

describe('賽事設定可覆寫', () => {
  test('勝場可改成 2 分，預設仍是 3 分', () => {
    const matches = [mk('m1', 't1', 't2', 1, 0)];
    const rule2 = { ...RANKING_RULES.RR_FEDA_2026, points: { win: 2, draw: 1, loss: 0 } };
    const rows = computeRows(['t1', 't2'], matches, rule2);
    expect(rows.find(r => r.teamId === 't1')?.points).toBe(2);
    expect(rows.find(r => r.teamId === 't2')?.points).toBe(0);

    const viaOpts = tallyMatches(['t1', 't2'], matches, { points: { win: 2, draw: 1, loss: 0 } });
    expect(viaOpts.stats.get('t1')?.points).toBe(2);

    const normal = computeRows(['t1', 't2'], matches, RANKING_RULES.RR_FEDA_2026);
    expect(normal.find(r => r.teamId === 't1')?.points).toBe(3);
  });

  test('行為分表可整包覆寫', () => {
    const cards = [{ type: 'card', cardType: 'yellow', teamId: 't1', playerId: 'p1', clockSec: 10, matchId: 'm1' }];
    expect(fairPlayPoints(cards)).toBe(-1);
    expect(fairPlayPoints(cards, customFair)).toBe(-2);
    expect(matchFairPlay(cards, 't1')).toBe(-1);
    expect(matchFairPlay(cards, 't1', customFair)).toBe(-2);

    const rows = computeRows(['t1', 't2'], [mk('m1', 't1', 't2', 1, 0)], RANKING_RULES.RR_FEDA_2026, {
      cardEvents: cards,
      fairPlay: customFair
    });
    expect(rows.find(r => r.teamId === 't1')?.fairPlayPoints).toBe(-2);
  });

  test('棄權比分可覆寫，預設仍是 2:0', () => {
    const match = { matchId: 'm1', status: 'walkover', walkoverSide: 'away' as const };
    const custom = effectiveScore(match, { walkover: { scoreFor: 3, scoreAgainst: 0, awardPoints: 2 } });
    expect(custom).toMatchObject({ home: 3, away: 0, points: { home: 2, away: 0 } });
    const preset = effectiveScore(match);
    expect(preset).toMatchObject({
      home: DEFAULT_WALKOVER.scoreFor,
      away: DEFAULT_WALKOVER.scoreAgainst,
      points: { home: DEFAULT_WALKOVER.awardPoints, away: DEFAULT_WALKOVER.penaltyPoints }
    });
    expect(DEFAULT_WALKOVER.scoreFor).toBe(2);
  });
});
