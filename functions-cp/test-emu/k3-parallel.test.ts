/**
 * K3 並行量測：10 場同日同時進球，記錄摘要片交易回呼次數。
 * 只量測、不設重試門檻。本檔只寫、不在派工時執行；數字等 PM 跑模擬器。
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { handleMatchWritten } from '../src/cp/match-trigger.js';
import { summaryShardIdOf } from '../src/cp/summary.js';
import { makeDeps, resetAll } from './_cp.js';

const CID = 'cp_' + 'p'.repeat(20);
const DVID = 'dv_' + 'p'.repeat(20);

describe('K3 同日 10 場並行進球', () => {
  beforeAll(() => resetAll());

  it('先依序建立摘要片，再並行改比分，記下交易回呼次數', async () => {
    const kick = Timestamp.fromMillis(Date.parse('2026-07-01T10:00:00+08:00'));
    const kickMs = kick.toMillis();
    const ids = Array.from({ length: 10 }, (_, i) => `mt_${String(i).padStart(20, 'a')}`);
    const db = adminDb();

    const matchOf = (i: number, home: number) => ({
      divisionId: DVID,
      stageId: 'group',
      groupId: 'A',
      matchNo: i + 1,
      round: 1,
      kickoffAt: kick,
      venueName: 'A場',
      home: { teamId: 'en_' + 'h'.repeat(20), name: '甲' },
      away: { teamId: 'en_' + 'a'.repeat(20), name: '乙' },
      score: { home, away: 0 },
      penaltyScore: null,
      status: 'scheduled',
      rev: home === 0 ? 1 : 2,
      resetRev: 0,
      walkoverSide: null
    });

    for (let i = 0; i < ids.length; i++) {
      const data = matchOf(i, 0);
      await db.doc(`competitions/${CID}/matches/${ids[i]}`).set(data);
      await handleMatchWritten(makeDeps(), CID, ids[i]!, null, data);
    }

    const summaryTxAttempts = { count: 0 };
    const settled = await Promise.allSettled(ids.map(async (id, i) => {
      const ref = db.doc(`competitions/${CID}/matches/${id}`);
      const before = (await ref.get()).data()!;
      await ref.update({ score: { home: i + 1, away: 0 }, rev: 2 });
      const after = (await ref.get()).data()!;
      await handleMatchWritten({ ...makeDeps(), summaryTxAttempts }, CID, id, before, after);
    }));
    const rejected = settled.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
    const retries = summaryTxAttempts.count - ids.length;
    console.log('[k3-parallel]', JSON.stringify({
      matches: ids.length,
      summaryTxAttempts: summaryTxAttempts.count,
      retries,
      rejected: rejected.length
    }));
    expect(rejected.map(item => String(item.reason))).toEqual([]);
    expect(summaryTxAttempts.count).toBeGreaterThanOrEqual(ids.length);

    const shard = summaryShardIdOf(kickMs);
    const entries = (await db.doc(`competitions/${CID}/summary/${shard}`).get()).get('m') as Record<string, { s: number[] }>;
    ids.forEach((id, i) => expect(entries[id]?.s).toEqual([i + 1, 0]));
  });
});
