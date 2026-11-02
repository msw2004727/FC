/**
 * 契約測試：新站賽事卡片 `tournamentCards/{id}`（T-089，新站 FC-B 專屬；與舊站 `tournaments` 集合分開）。
 *
 *   - read：公開（含未登入）。
 *   - create／update／delete：`isSuperAdmin() || hasEffectivePerm('admin.tournaments.entry')`
 *     （rolePermissions 角色權限，或啟用中的 userPermissionGrants 個別授權）。不新增權限碼。
 *   - create／update 欄位白名單：name, type, startDate, endDate, url, image, imagePath, createdBy, createdAt, updatedAt；
 *     type ∈ league／cup／friendly；日期 YYYY-MM-DD 且 startDate <= endDate；url 以 https:// 開頭；
 *     create 時 createdBy == 自己 uid、createdAt／updatedAt == request.time；update 不可改 createdBy／createdAt。
 *
 * B 的寫入 payload：新增 setDoc 全部欄位；編輯 updateDoc（name, type, startDate, endDate, url, image, imagePath, updatedAt）。
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const PERM = 'admin.tournaments.entry';
const COL = 'tournamentCards';
let testEnv;

jest.setTimeout(30000);

const CREATE_PAYLOAD = (uid, overrides = {}) => ({
  name: 'FEDA CUP 2026 飛達盃',
  type: 'cup',
  startDate: '2026-10-09',
  endDate: '2026-10-11',
  url: 'https://cup.toosterx.com/',
  image: 'https://firebasestorage.googleapis.com/v0/b/x/o/tournamentCards%2Ftc_new%2Fcover_1.webp',
  imagePath: 'tournamentCards/tc_new/cover_1.webp',
  createdBy: uid,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});
const UPDATE_PAYLOAD = (overrides = {}) => ({
  name: '飛達盃 2026',
  type: 'cup',
  startDate: '2026-10-09',
  endDate: '2026-10-12',
  url: 'https://cup.toosterx.com/2026',
  image: '',
  imagePath: '',
  updatedAt: serverTimestamp(),
  ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: Number(port),
      rules: fs.readFileSync(path.resolve(__dirname, '../..', 'firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), COL, 'tc_feda'), {
      name: 'FEDA CUP 2026 飛達盃',
      type: 'cup',
      startDate: '2026-10-09',
      endDate: '2026-10-11',
      url: 'https://cup.toosterx.com/',
      image: '',
      imagePath: '',
      createdBy: 'uidCreator',
      createdAt: Timestamp.fromMillis(1760000000000),
      updatedAt: Timestamp.fromMillis(1760000000000),
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function ctx(uid, role) {
  return testEnv.authenticatedContext(uid, { role }).firestore();
}
const guest = () => testEnv.unauthenticatedContext().firestore();

async function seedRolePermission(role, permissions) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'rolePermissions', role), { permissions });
  });
}
async function seedGrant(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'userPermissionGrants', uid), { uid, ...data });
  });
}

describe('tournamentCards 讀取：公開', () => {
  test('未登入可讀單筆與清單（orderBy startDate desc + limit 100）', async () => {
    await assertSucceeds(getDoc(doc(guest(), COL, 'tc_feda')));
    await assertSucceeds(getDocs(query(collection(guest(), COL), orderBy('startDate', 'desc'), limit(100))));
  });

  test('一般用戶可讀', async () => {
    await assertSucceeds(getDoc(doc(ctx('uidUser', 'user'), COL, 'tc_feda')));
  });
});

describe('tournamentCards 新增：權限', () => {
  test('角色權限：rolePermissions/admin 含 admin.tournaments.entry 的 admin 可建', async () => {
    await seedRolePermission('admin', [PERM]);
    await assertSucceeds(setDoc(doc(ctx('uidAdmin', 'admin'), COL, 'tc_new'), CREATE_PAYLOAD('uidAdmin')));
  });

  test('個別授權：啟用中的一般用戶可建', async () => {
    await seedGrant('uidGranted', { permissions: [PERM], enabled: true });
    await assertSucceeds(setDoc(doc(ctx('uidGranted', 'user'), COL, 'tc_new'), CREATE_PAYLOAD('uidGranted')));
  });

  test('總管不需要權限碼也可建', async () => {
    await assertSucceeds(setDoc(doc(ctx('uidSuper', 'super_admin'), COL, 'tc_new'), CREATE_PAYLOAD('uidSuper')));
  });

  test.each([
    ['一般用戶', 'uidUser', 'user'],
    ['沒有權限碼的 coach', 'uidCoach', 'coach'],
    ['沒有 rolePermissions 文件的 admin（不是總管）', 'uidAdmin', 'admin'],
  ])('%s 拒絕', async (_label, uid, role) => {
    await assertFails(setDoc(doc(ctx(uid, role), COL, 'tc_new'), CREATE_PAYLOAD(uid)));
  });

  test('角色權限只有其他碼（admin.tournaments.create）拒絕', async () => {
    await seedRolePermission('admin', ['admin.tournaments.create', 'admin.banners.entry']);
    await assertFails(setDoc(doc(ctx('uidAdmin', 'admin'), COL, 'tc_new'), CREATE_PAYLOAD('uidAdmin')));
  });

  test('個別授權停用（enabled:false）拒絕', async () => {
    await seedGrant('uidOff', { permissions: [PERM], enabled: false });
    await assertFails(setDoc(doc(ctx('uidOff', 'user'), COL, 'tc_new'), CREATE_PAYLOAD('uidOff')));
  });

  test('未登入拒絕', async () => {
    await assertFails(setDoc(doc(guest(), COL, 'tc_new'), CREATE_PAYLOAD('uidGuest')));
  });
});

describe('tournamentCards 新增：欄位', () => {
  beforeEach(async () => {
    await seedRolePermission('admin', [PERM]);
  });
  const admin = () => ctx('uidAdmin', 'admin');
  const create = (overrides) => setDoc(doc(admin(), COL, 'tc_new'), CREATE_PAYLOAD('uidAdmin', overrides));

  test('沒有圖片（image／imagePath 省略）可建', async () => {
    const payload = CREATE_PAYLOAD('uidAdmin');
    delete payload.image;
    delete payload.imagePath;
    await assertSucceeds(setDoc(doc(admin(), COL, 'tc_new'), payload));
  });

  test('開始日＝結束日可建', async () => {
    await assertSucceeds(create({ endDate: '2026-10-09' }));
  });

  test.each([
    ['url 是 http', { url: 'http://cup.toosterx.com/' }],
    ['url 是 javascript', { url: 'javascript:alert(1)' }],
    ['url 含空白', { url: 'https://cup.toosterx.com/a b' }],
    ['url 只有 https://', { url: 'https://' }],
    ['url 太長', { url: `https://a.com/${'a'.repeat(500)}` }],
  ])('%s 拒絕', async (_label, overrides) => {
    await assertFails(create(overrides));
  });

  test.each([
    ['type 不在清單', { type: 'open' }],
    ['name 空字串', { name: '' }],
    ['name 太長', { name: 'x'.repeat(81) }],
    ['name 不是字串', { name: 123 }],
    ['日期格式不對', { startDate: '2026/10/09' }],
    ['開始日晚於結束日', { startDate: '2026-10-12' }],
    ['多出白名單外欄位', { featured: true }],
    ['createdBy 不是自己', { createdBy: 'uidOther' }],
    ['createdAt 不是 request.time', { createdAt: Timestamp.fromMillis(1) }],
    ['updatedAt 不是 request.time', { updatedAt: Timestamp.fromMillis(1) }],
    ['image 太長', { image: `https://a.com/${'a'.repeat(1200)}` }],
  ])('%s 拒絕', async (_label, overrides) => {
    await assertFails(create(overrides));
  });

  test('缺必要欄位（url）拒絕', async () => {
    const payload = CREATE_PAYLOAD('uidAdmin');
    delete payload.url;
    await assertFails(setDoc(doc(admin(), COL, 'tc_new'), payload));
  });
});

describe('tournamentCards 編輯', () => {
  test('權限者可編輯（B 的 updateDoc payload）', async () => {
    await seedRolePermission('admin', [PERM]);
    await assertSucceeds(updateDoc(doc(ctx('uidAdmin', 'admin'), COL, 'tc_feda'), UPDATE_PAYLOAD()));
  });

  test('個別授權者可編輯別人建的卡片', async () => {
    await seedGrant('uidGranted', { permissions: [PERM], enabled: true });
    await assertSucceeds(updateDoc(doc(ctx('uidGranted', 'user'), COL, 'tc_feda'), UPDATE_PAYLOAD()));
  });

  test.each([
    ['一般用戶', 'uidUser', 'user'],
    ['沒有權限碼的 coach', 'uidCoach', 'coach'],
  ])('%s 不可編輯', async (_label, uid, role) => {
    await assertFails(updateDoc(doc(ctx(uid, role), COL, 'tc_feda'), UPDATE_PAYLOAD()));
  });

  test('未登入不可編輯', async () => {
    await assertFails(updateDoc(doc(guest(), COL, 'tc_feda'), UPDATE_PAYLOAD()));
  });

  test.each([
    ['改 createdBy', { createdBy: 'uidAdmin' }],
    ['改 createdAt', { createdAt: serverTimestamp() }],
    ['url 改成 http', { url: 'http://cup.toosterx.com/' }],
    ['結束日早於開始日', { endDate: '2026-10-01' }],
    ['多出欄位', { clicks: 1 }],
  ])('權限者 %s 拒絕', async (_label, overrides) => {
    await seedRolePermission('admin', [PERM]);
    await assertFails(updateDoc(doc(ctx('uidAdmin', 'admin'), COL, 'tc_feda'), UPDATE_PAYLOAD(overrides)));
  });
});

describe('tournamentCards 刪除', () => {
  test('角色權限者可刪', async () => {
    await seedRolePermission('admin', [PERM]);
    await assertSucceeds(deleteDoc(doc(ctx('uidAdmin', 'admin'), COL, 'tc_feda')));
  });

  test('個別授權者可刪', async () => {
    await seedGrant('uidGranted', { permissions: [PERM], enabled: true });
    await assertSucceeds(deleteDoc(doc(ctx('uidGranted', 'user'), COL, 'tc_feda')));
  });

  test('總管可刪', async () => {
    await assertSucceeds(deleteDoc(doc(ctx('uidSuper', 'super_admin'), COL, 'tc_feda')));
  });

  test.each([
    ['未登入', () => guest()],
    ['一般用戶', () => ctx('uidUser', 'user')],
    ['沒有權限碼的 coach', () => ctx('uidCoach', 'coach')],
    ['沒有 rolePermissions 文件的 admin', () => ctx('uidAdmin', 'admin')],
  ])('%s 不可刪', async (_label, make) => {
    await assertFails(deleteDoc(doc(make(), COL, 'tc_feda')));
  });
});
