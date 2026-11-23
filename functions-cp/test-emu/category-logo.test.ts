/**
 * §3.264 模擬器：分類與 cpMine、報隊 teamLogo、鎖名單刷新、讀取預算。
 * 讀取數字是照程式路徑算出的（管理員鎖名單：閘門 1＋賽事 1＋主辦 0；測試者報隊：閘門 2＋其餘 5）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { adminDb } from '../test-rules/_harness.js';
import { ReadMeter } from '../src/cp/context.js';
import { LIMITS } from '../src/cp/validate.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { handleCpHost } from '../src/cp/host.js';
import { ADMIN, TESTER, TESTER2, TESTER3, call, createInput, fails, makeDeps, ok, resetAll } from './_cp.js';

// 顧問 §3.278 P2：隊徽只收本專案 Storage 下載網址；測試用假 bucket
process.env.CP_LOGO_BUCKETS = 'demo-cp.firebasestorage.app';
const LOGO_BASE = 'https://firebasestorage.googleapis.com/v0/b/demo-cp.firebasestorage.app/o/';
const LOGO_A = `${LOGO_BASE}teams%2Fa.png?alt=media`;
const LOGO_B = `${LOGO_BASE}teams%2Fb.png?alt=media`;

async function published(over: Record<string, unknown> = {}) {
  const c = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput({
    divisions: [
      { name: '成人組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 },
      { name: '青少年組', playersOnField: 5, maxTeams: 4, rosterMin: 1, rosterMax: 5 }
    ],
    ...over
  })));
  await ok(call(handleCpHost, TESTER, { action: 'publish', cid: c.cid }));
  return c;
}

describe('賽事分類 category（§3.264）', () => {
  beforeEach(() => resetAll());

  it('建賽有分類：根文件與個人主辦 cpMine 寫入該分類', async () => {
    const { cid } = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ category: 'cup' })));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('category')).toBe('cup');
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).get('category')).toBe('cup');
  });

  it('建賽缺分類、以及 category 為 null：寫入 league', async () => {
    const a = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput()));
    const b = await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput({ category: null, name: '【測試】缺值盃' })));
    for (const cid of [a.cid, b.cid]) {
      expect((await adminDb().doc(`competitions/${cid}`).get()).get('category')).toBe('league');
    }
    expect((await adminDb().doc('cpMine/tester/items/' + a.cid).get()).get('category')).toBe('league');
    expect((await adminDb().doc('cpMine/admin/items/' + b.cid).get()).get('category')).toBe('league');
  });

  it('非法分類值：建賽與改分類都回 INVALID_FIELD', async () => {
    for (const bad of ['open', 'League', '']) {
      const out = await call(handleCpHost, TESTER, createInput({ category: bad }));
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.reason).toBe('INVALID_FIELD');
        expect(out.error.params).toEqual({ field: 'category' });
      }
    }
    const { cid } = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput()));
    const out = await call(handleCpHost, TESTER, { action: 'update', cid, category: 'open' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.reason).toBe('INVALID_FIELD');
      expect(out.error.params).toEqual({ field: 'category' });
    }
  });

  it('非主辦改分類被拒', async () => {
    const { cid } = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ category: 'league' })));
    await fails(call(handleCpHost, TESTER2, { action: 'update', cid, category: 'friendly' }), 'NOT_HOST');
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('category')).toBe('league');
  });

  it('已結束改分類被拒（與改名相同）', async () => {
    const { cid } = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ category: 'cup' })));
    await adminDb().doc(`competitions/${cid}`).update({ endedAt: new Date() });
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, category: 'friendly' }), 'COMPETITION_CLOSED');
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('category')).toBe('cup');
  });

  it('已取消改分類被拒（Opus 終審 P3）', async () => {
    const { cid } = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ category: 'cup' })));
    await adminDb().doc(`competitions/${cid}`).update({ status: 'cancelled' });
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, category: 'friendly' }), 'COMPETITION_CLOSED');
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('category')).toBe('cup');
  });

  it('改分類後，主辦、報隊者、球員的 cpMine 分類跟著更新', async () => {
    const { cid, dvIds } = await published({ category: 'cup' });
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    await ok(call(handleCpEntry, TESTER2, { action: 'joinRoster', cid, enId, number: 9, privacyAck: true }));
    // 報隊覆寫整份 cpMine 時仍留下建賽時的分類
    expect((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).get('category')).toBe('cup');
    expect((await adminDb().doc(`cpMine/tester2/items/${cid}`).get()).get('category')).toBe('cup');
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, category: 'friendly' }));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('category')).toBe('friendly');
    for (const u of ['tester', 'tester2']) {
      const m = (await adminDb().doc(`cpMine/${u}/items/${cid}`).get()).data()!;
      expect(m.category).toBe('friendly');
      expect(m.name).toBe('【測試】週末盃');
    }
  });
});

describe('報隊隊徽 teamLogo（§3.264）', () => {
  beforeEach(() => resetAll());

  it('合格 https 網址寫進 entry；前後空白會去掉', async () => {
    await adminDb().doc('cpClubs/club_a').update({ image: `  ${LOGO_A}  ` });
    const { cid, dvIds } = await published();
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    expect((await adminDb().doc(`competitions/${cid}/entries/${enId}`).get()).get('teamLogo')).toBe(LOGO_A);
  });

  it('外部任意 https 網址（非本專案 Storage）寫 null（顧問 §3.278 P2）', async () => {
    await adminDb().doc('cpClubs/club_a').update({ image: 'https://cdn.example/track.png' });
    const { cid, dvIds } = await published();
    const out = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    expect((await adminDb().doc(`competitions/${cid}/entries/${out.enId}`).get()).get('teamLogo')).toBeNull();
  });

  it('隊徽網址 bucket 壞百分比編碼：寫 null、報隊照樣成功（顧問 §3.291 P2）', async () => {
    await adminDb().doc('cpClubs/club_a').update({ image: 'https://firebasestorage.googleapis.com/v0/b/%E0%A4%A/o/x' });
    const { cid, dvIds } = await published();
    const out = await ok<{ enId: string; status: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    expect(out.status).toBe('pending');
    expect((await adminDb().doc(`competitions/${cid}/entries/${out.enId}`).get()).get('teamLogo')).toBeNull();
  });

  it('非 https 網址寫 null、報隊不報錯', async () => {
    await adminDb().doc('cpClubs/club_a').update({ image: 'http://cdn.example/a.png' });
    const { cid, dvIds } = await published();
    const out = await ok<{ enId: string; status: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    expect(out.status).toBe('pending');
    expect((await adminDb().doc(`competitions/${cid}/entries/${out.enId}`).get()).get('teamLogo')).toBeNull();
  });

  it('cpClubs 沒有 image 時寫 null', async () => {
    const { cid, dvIds } = await published();
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    const data = (await adminDb().doc(`competitions/${cid}/entries/${enId}`).get()).data()!;
    expect(data.teamLogo).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(data, 'teamLogo')).toBe(true);
  });

  it('鎖名單刷新已核准隊伍的 teamLogo；待審隊伍維持報隊時的快照', async () => {
    await adminDb().doc('cpClubs/club_a').set({ repUids: ['tester'], name: '甲隊足球俱樂部', image: LOGO_A });
    await adminDb().doc('cpClubs/club_b').set({ repUids: ['tester3'], name: '乙隊', image: LOGO_B });
    const { cid, dvIds } = await published();
    const approved = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    const pending = await ok<{ enId: string }>(call(handleCpEntry, TESTER3, {
      action: 'registerEntry', cid, dvId: dvIds[1], teamId: 'club_b'
    }));
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId: approved.enId, decision: 'approve' }));
    await adminDb().doc('cpClubs/club_a').update({ image: LOGO_B });
    await adminDb().doc('cpClubs/club_b').update({ image: 'http://cdn.example/no.png' });
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }));
    expect((await adminDb().doc(`competitions/${cid}/entries/${approved.enId}`).get()).get('teamLogo')).toBe(LOGO_B);
    // 待審的乙隊不在刷新範圍，維持報隊當下的快照
    expect((await adminDb().doc(`competitions/${cid}/entries/${pending.enId}`).get()).get('teamLogo')).toBe(LOGO_B);
  });

  it('已核准 510 筆（超過單交易 500 寫入）：鎖名單成功，隊徽全部刷新（Flash 初審 P2）', async () => {
    const { cid, dvIds } = await published();
    const N = 510;
    await adminDb().doc('cpClubs/club_big').set({ repUids: ['tester'], name: '大隊', image: LOGO_B });
    for (let i = 0; i < N; i += 400) {
      const b = adminDb().batch();
      for (let j = i; j < Math.min(N, i + 400); j++) {
        b.set(adminDb().doc(`competitions/${cid}/entries/en_big${j}`), {
          dvId: dvIds[j % 2], teamId: j % 2 ? 'club_big' : `club_n${j}`, name: `隊${j}`, teamLogo: LOGO_A,
          status: 'approved', rosterCount: 0, rosterConfirmed: false
        });
      }
      await b.commit();
    }
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }));
    expect((await adminDb().doc(`competitions/${cid}`).get()).get('rostersLockedAt')).toBeTruthy();
    const snap = await adminDb().collection(`competitions/${cid}/entries`).get();
    const big = snap.docs.filter(d => d.get('teamId') === 'club_big');
    const none = snap.docs.filter(d => d.get('teamId') !== 'club_big');
    expect(big.length).toBe(N / 2);
    expect(big.every(d => d.get('teamLogo') === LOGO_B)).toBe(true);
    // 沒有 cpClubs 鏡像的隊伍改寫 null
    expect(none.every(d => d.get('teamLogo') === null)).toBe(true);
  }, 120_000);

  it('鎖名單時 cpClubs 沒有 image，已核准隊伍的 teamLogo 改寫 null', async () => {
    await adminDb().doc('cpClubs/club_a').update({ image: LOGO_A });
    const { cid, dvIds } = await published();
    const { enId } = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId, decision: 'approve' }));
    await adminDb().doc('cpClubs/club_a').update({ image: null });
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }));
    expect((await adminDb().doc(`competitions/${cid}/entries/${enId}`).get()).get('teamLogo')).toBeNull();
  });
});

describe('讀取預算（§3.264）', () => {
  beforeEach(() => resetAll());

  it('registerEntry 讀取數不變（隊徽不另讀）', async () => {
    await adminDb().doc('cpClubs/club_a').update({ image: LOGO_A });
    const { cid, dvIds } = await published();
    const meter = new ReadMeter();
    await ok(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }, makeDeps(0, meter)));
    // 閘門 launch＋testers、賽事、cpClubs（含 image）、組別、既有報隊查詢、cpMine
    expect(meter.reads).toBe(7);
    expect(meter.reads).toBeLessThanOrEqual(8);
  });

  it('lockRosters：沒有已核准隊伍時只多查詢 1，不讀 cpClubs', async () => {
    const { cid } = await published();
    const meter = new ReadMeter();
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }, makeDeps(0, meter)));
    // 管理員：閘門 1＋賽事 1＋主辦 0＋空查詢 1
    expect(meter.reads).toBe(3);
  });

  it('lockRosters：兩支不同的已核准隊伍各讀 1 次，且不超過組別隊數上限', async () => {
    await adminDb().doc('cpClubs/club_b').set({ repUids: ['tester3'], name: '乙隊', image: LOGO_B });
    const { cid, dvIds } = await published();
    const a = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    const b = await ok<{ enId: string }>(call(handleCpEntry, TESTER3, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_b'
    }));
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId: a.enId, decision: 'approve' }));
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId: b.enId, decision: 'approve' }));
    const maxTeamsSum = 4 + 4;
    const meter = new ReadMeter();
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }, makeDeps(0, meter)));
    const approved = 2;
    const teams = 2;
    expect(teams).toBeLessThanOrEqual(maxTeamsSum);
    expect(approved).toBeLessThanOrEqual(maxTeamsSum);
    // 閘門 1＋賽事 1＋主辦 0＋查詢筆數＋每隊 1
    expect(meter.reads).toBe(1 + 1 + 0 + approved + teams);
    expect(meter.reads).toBeLessThanOrEqual(1 + 1 + 0 + maxTeamsSum + maxTeamsSum);
    expect(maxTeamsSum).toBeLessThanOrEqual(LIMITS.divisionsMax * LIMITS.teamsMax);
  });

  it('lockRosters：同隊兩個已核准組別只讀一次 cpClubs', async () => {
    await adminDb().doc('cpClubs/club_a').update({ image: LOGO_A });
    const { cid, dvIds } = await published();
    const a = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[0], teamId: 'club_a'
    }));
    const b = await ok<{ enId: string }>(call(handleCpEntry, TESTER, {
      action: 'registerEntry', cid, dvId: dvIds[1], teamId: 'club_a'
    }));
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId: a.enId, decision: 'approve' }));
    await ok(call(handleCpEntry, ADMIN, { action: 'reviewEntry', cid, enId: b.enId, decision: 'approve' }));
    const meter = new ReadMeter();
    await ok(call(handleCpEntry, ADMIN, { action: 'lockRosters', cid }, makeDeps(0, meter)));
    // 查詢 2 筆、隊伍 1
    expect(meter.reads).toBe(1 + 1 + 0 + 2 + 1);
    expect((await adminDb().doc(`competitions/${cid}/entries/${a.enId}`).get()).get('teamLogo')).toBe(LOGO_A);
    expect((await adminDb().doc(`competitions/${cid}/entries/${b.enId}`).get()).get('teamLogo')).toBe(LOGO_A);
  });
});
