/**
 * 賽事封面 cover（模擬器；計畫書「賽事封面圖」做法甲、顧問 §3.536）：
 * 建立／更新／移除、網址驗證回錯帶 field、已結束與已取消只能移除、沒帶 cover 時建立不變、
 * 下架後一般人讀不到根文件（封面只在根文件），cpMine 與摘要片都不帶封面。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { adminDb, assertFails, assertSucceeds, clientDb, closeClients } from '../test-rules/_harness.js';
import { handleCpHost } from '../src/cp/host.js';
import { ADMIN, STRANGER, TESTER, TESTER2, call, createInput, fails, ok, resetAll } from './_cp.js';

process.env.CP_LOGO_BUCKETS = 'demo-cp.firebasestorage.app';
const dl = (path: string, bucket = 'demo-cp.firebasestorage.app') =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=t0`;
const K1 = 'c_abcdefghij012345';
const K2 = 'c_zyxwvutsrq987654';
const coverIn = (key = K1, ms = '1763700000000') => ({
  url: dl(`images/competitions/${key}/cover_${ms}.webp`),
  thumb: dl(`images/competitions/${key}/thumb_${ms}.webp`)
});

async function failsField(p: ReturnType<typeof call>, reason: string, field: string) {
  const out = await p;
  expect(out.ok, `預期 ${reason} 卻成功`).toBe(false);
  if (!out.ok) {
    expect(out.error.reason).toBe(reason);
    expect(out.error.params?.field).toBe(field);
  }
}

const root = async (cid: string) => (await adminDb().doc(`competitions/${cid}`).get()).data()!;

describe('建立帶封面', () => {
  beforeEach(() => resetAll());

  it('合法封面寫進根文件 cover { url, thumb }；cpMine 不帶封面', async () => {
    const cover = coverIn();
    const { cid } = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ cover })));
    expect((await root(cid)).cover).toEqual(cover);
    const mine = (await adminDb().doc(`cpMine/tester/items/${cid}`).get()).data()!;
    expect(Object.keys(mine)).not.toContain('cover');
  });

  it('沒帶 cover（回歸）：建立成功、其他欄位與 cover 為 null 以外完全照舊；cover: null 同義', async () => {
    const a = await ok<{ cid: string; dvIds: string[] }>(call(handleCpHost, TESTER, createInput()));
    const d = await root(a.cid);
    expect(d.cover).toBeNull();
    expect(Object.keys(d).sort()).toEqual([
      'ageBasisAt', 'category', 'contactNote', 'cover', 'createdAt', 'endedAt', 'endedBy', 'feeNote', 'firstMatchAt',
      'hidden', 'hostDisplay', 'hostTeamId', 'hostType', 'lastMatchAt', 'liveLinks', 'name', 'notices', 'regCloseAt',
      'regOpenAt', 'rostersLockedAt', 'sport', 'staffSeq', 'stateVersion', 'status', 'statusReason', 'timezone',
      'updatedAt', 'venues', 'visibility'
    ]);
    expect(d.status).toBe('draft');
    expect(d.stateVersion).toBe(1);
    expect(a.dvIds).toHaveLength(1);
    const b = await ok<{ cid: string }>(call(handleCpHost, ADMIN, createInput({ cover: null, name: '【測試】無封面盃' })));
    expect((await root(b.cid)).cover).toBeNull();
  });

  it('非本專案 bucket、路徑不符、不同資料夾、多出的鍵：建立失敗且沒有寫任何賽事', async () => {
    await failsField(call(handleCpHost, TESTER, createInput({
      cover: { ...coverIn(), url: dl(`images/competitions/${K1}/cover_1763700000000.webp`, 'other-project.appspot.com') }
    })), 'COVER_URL_NOT_ALLOWED', 'cover.url');
    await failsField(call(handleCpHost, TESTER, createInput({
      cover: { ...coverIn(), thumb: dl('images/avatars/u1/thumb_1763700000000.webp') }
    })), 'COVER_URL_NOT_ALLOWED', 'cover.thumb');
    await failsField(call(handleCpHost, TESTER, createInput({
      cover: { url: coverIn(K1).url, thumb: coverIn(K2).thumb }
    })), 'COVER_URL_NOT_ALLOWED', 'cover');
    await failsField(call(handleCpHost, TESTER, createInput({
      cover: { ...coverIn(), extra: 'x' }
    })), 'UNKNOWN_FIELD', 'cover');
    await failsField(call(handleCpHost, TESTER, createInput({ cover: 'https://x' })), 'FIELD_TYPE', 'cover');
    expect((await adminDb().collection('competitions').get()).size).toBe(0);
  });
});

describe('更新封面', () => {
  let cid = '';
  beforeEach(async () => {
    await resetAll();
    cid = (await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput()))).cid;
  });
  afterAll(() => closeClients());

  it('主辦可設定、換新、移除；stateVersion 遞增、稽核 fields 含 cover', async () => {
    const v0 = (await root(cid)).stateVersion;
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: coverIn(K1) }));
    expect((await root(cid)).cover).toEqual(coverIn(K1));
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: coverIn(K2, '1763700009999') }));
    expect((await root(cid)).cover).toEqual(coverIn(K2, '1763700009999'));
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: null }));
    const d = await root(cid);
    expect(d.cover).toBeNull();
    expect(d.stateVersion).toBe(v0 + 3);
    const audits = await adminDb().collection(`competitions/${cid}/audits`).where('action', '==', 'update').get();
    expect(audits.size).toBe(3);
    for (const a of audits.docs) expect(a.get('details').fields).toEqual(['cover']);
  });

  it('沒帶 cover 的更新不動既有封面', async () => {
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: coverIn() }));
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, name: '【測試】改名盃' }));
    expect((await root(cid)).cover).toEqual(coverIn());
  });

  it('不合格的封面更新回錯並保留原封面', async () => {
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: coverIn() }));
    await failsField(call(handleCpHost, TESTER, { action: 'update', cid, cover: { url: 'https://cdn.example/a.webp', thumb: coverIn().thumb } }),
      'COVER_URL_NOT_ALLOWED', 'cover.url');
    await failsField(call(handleCpHost, TESTER, { action: 'update', cid, cover: { url: coverIn(K1).url, thumb: coverIn(K2).thumb } }),
      'COVER_URL_NOT_ALLOWED', 'cover');
    await failsField(call(handleCpHost, TESTER, { action: 'update', cid, cover: { ...coverIn(), w: 1 } }), 'UNKNOWN_FIELD', 'cover');
    expect((await root(cid)).cover).toEqual(coverIn());
  });

  it('非主辦不能改封面（照現有權限）', async () => {
    await fails(call(handleCpHost, TESTER2, { action: 'update', cid, cover: coverIn() }), 'NOT_HOST');
    await fails(call(handleCpHost, TESTER2, { action: 'update', cid, cover: null }), 'NOT_HOST');
  });

  it('下架中主辦不能改也不能移除；管理員可以移除', async () => {
    await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: coverIn() }));
    await adminDb().doc(`competitions/${cid}`).update({ hidden: true });
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, cover: coverIn(K2) }), 'COMPETITION_HIDDEN');
    await fails(call(handleCpHost, TESTER, { action: 'update', cid, cover: null }), 'COMPETITION_HIDDEN');
    await ok(call(handleCpHost, ADMIN, { action: 'update', cid, cover: null }));
    expect((await root(cid)).cover).toBeNull();
  });

  for (const [label, patch] of [
    ['已結束', { endedAt: new Date(), endedBy: 'manual' }],
    ['已取消', { status: 'cancelled', statusReason: '天候' }]
  ] as const) {
    it(`${label}：主辦與管理員都只能移除封面，換新與夾帶其他欄位被擋`, async () => {
      await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: coverIn(K1) }));
      await adminDb().doc(`competitions/${cid}`).update(patch);
      for (const who of [TESTER, ADMIN]) {
        await failsField(call(handleCpHost, who, { action: 'update', cid, cover: coverIn(K2) }), 'COMPETITION_CLOSED', 'cover');
        await fails(call(handleCpHost, who, { action: 'update', cid, cover: null, name: '【測試】偷改名' }), 'COMPETITION_CLOSED');
        await fails(call(handleCpHost, who, { action: 'update', cid, name: '【測試】偷改名' }), 'COMPETITION_CLOSED');
      }
      expect((await root(cid)).cover).toEqual(coverIn(K1));
      await ok(call(handleCpHost, TESTER, { action: 'update', cid, cover: null }));
      expect((await root(cid)).cover).toBeNull();
      // 管理員也能移除（已是 null 再移除一次仍成功，不回錯）
      await ok(call(handleCpHost, ADMIN, { action: 'update', cid, cover: null }));
      const d = await root(cid);
      expect(d.cover).toBeNull();
      expect(d.name).toBe('【測試】週末盃');
      // 非主辦照樣不行
      await fails(call(handleCpHost, TESTER2, { action: 'update', cid, cover: null }), 'NOT_HOST');
    });
  }
});

describe('下架時封面不對外', () => {
  beforeEach(() => resetAll({ isPublic: true }));
  afterAll(() => closeClients());

  it('封面只在根文件：下架後訪客與一般會員讀不到根文件、公開清單不含；摘要片與 cpMine 不帶封面', async () => {
    const cover = coverIn();
    const { cid } = await ok<{ cid: string }>(call(handleCpHost, TESTER, createInput({ cover })));
    await ok(call(handleCpHost, TESTER, { action: 'publish', cid }));
    // 伺服器寫入的摘要片（若之後有賽程）在 competitions/{cid}/summary；這裡放一份代表性的摘要片確認讀取規則跟著根文件
    await adminDb().doc(`competitions/${cid}/summary/tbd`).set({ items: {} });
    const publicList = (who: typeof STRANGER | null) => getDocs(query(collection(clientDb(who as never), 'competitions'),
      where('visibility', '==', 'public'), where('hidden', '==', false),
      where('status', 'in', ['published', 'postponed', 'cancelled']), limit(30)));

    // 上架中：一般人讀得到封面
    const pub = await assertSucceeds(getDoc(doc(clientDb(STRANGER), `competitions/${cid}`)));
    expect(pub.get('cover')).toEqual(cover);
    expect((await assertSucceeds(publicList(null))).docs.find(d => d.id === cid)?.get('cover')).toEqual(cover);

    await ok(call(handleCpHost, ADMIN, { action: 'moderate', cid, hidden: true, reason: '不當內容圖片' }));
    for (const who of [STRANGER, null]) {
      await assertFails(getDoc(doc(clientDb(who as never), `competitions/${cid}`)));
      await assertFails(getDoc(doc(clientDb(who as never), `competitions/${cid}/summary/tbd`)));
      expect((await assertSucceeds(publicList(who))).docs.map(d => d.id)).not.toContain(cid);
    }
    // 摘要片與 cpMine 從來不複製封面
    expect(JSON.stringify((await adminDb().doc(`competitions/${cid}/summary/tbd`).get()).data())).not.toContain('cover');
    expect(Object.keys((await adminDb().doc(`cpMine/tester/items/${cid}`).get()).data()!)).not.toContain('cover');
    // 管理員下架後直接移除封面，恢復上架也不會再出現
    await ok(call(handleCpHost, ADMIN, { action: 'update', cid, cover: null }));
    await ok(call(handleCpHost, ADMIN, { action: 'moderate', cid, hidden: false }));
    const back = await assertSucceeds(getDoc(doc(clientDb(STRANGER), `competitions/${cid}`)));
    expect(back.get('cover')).toBeNull();
  });
});
