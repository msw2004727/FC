/**
 * 契約測試：`banners` 集合的寫入權限（新站 B 後台「首頁管理—Banner 廣告」M-145 依賴的現況）。
 *
 * 釘住 firestore.rules 現況（不改 Rules）：
 *   - read：公開（含訪客）。
 *   - create／update：isAdmin()（admin、super_admin）或 hasEffectivePerm('admin.banners.entry')
 *     （rolePermissions 角色權限，或啟用中的 userPermissionGrants 個別授權）。沒有欄位白名單。
 *   - delete：一律拒絕（含 super_admin）→ A 的「刪除」是清空欄位（title／slotName／linkUrl／image／
 *     publishAt／unpublishAt／status／clicks），B 也不可改成 deleteDoc。
 *   - 一般用戶、coach、captain（沒有權限碼）、訪客不可寫，包含 `clicks` 欄位。
 *
 * B 的寫入 payload（欄位 allowlist）：
 *   儲存：title／subtitle／titleColor／subtitleColor／slotName／linkUrl／image／publishAt／unpublishAt／status／updatedAt
 *   下架／上架／惰性轉換：status／updatedAt
 *   清空：title／slotName／linkUrl／image／publishAt／unpublishAt／status／clicks／updatedAt
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-rules-test';
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const PERM = 'admin.banners.entry';
let testEnv;

jest.setTimeout(30000);

const SAVE_PAYLOAD = () => ({
  title: '春季聯賽',
  subtitle: '報名開跑',
  titleColor: '#ffffff',
  subtitleColor: '#e5edf8',
  slotName: '廣告位 1',
  linkUrl: 'https://example.com/event',
  image: 'https://firebasestorage.googleapis.com/v0/b/x/o/images%2Fbanners%2Fban1_1',
  publishAt: '2026/10/27 12:00',
  unpublishAt: null,
  status: 'active',
  updatedAt: serverTimestamp(),
});
const STATUS_PAYLOAD = (status) => ({ status, updatedAt: serverTimestamp() });
const CLEAR_PAYLOAD = () => ({
  title: '',
  slotName: '',
  linkUrl: '',
  image: null,
  publishAt: null,
  unpublishAt: null,
  status: 'empty',
  clicks: 0,
  updatedAt: serverTimestamp(),
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
    const db = context.firestore();
    await setDoc(doc(db, 'banners', 'ban1'), {
      id: 'ban1',
      slot: 1,
      slotName: '廣告位 1',
      title: '舊標題',
      status: 'scheduled',
      publishAt: '2026/10/27 10:00',
      unpublishAt: null,
      clicks: 3,
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
    await setDoc(doc(context.firestore(), 'userPermissionGrants', uid), data);
  });
}

describe('banners 讀取', () => {
  test('訪客可讀（首頁輪播與快照需要）', async () => {
    await assertSucceeds(getDoc(doc(guest(), 'banners', 'ban1')));
  });
});

describe('banners 寫入：沒有權限碼的身分一律拒絕', () => {
  const denied = [
    ['訪客', () => guest()],
    ['user', () => ctx('uidUser', 'user')],
    ['coach（沒有權限碼）', () => ctx('uidCoach', 'coach')],
    ['captain（沒有權限碼）', () => ctx('uidCaptain', 'captain')],
  ];

  test.each(denied)('%s 不可儲存、下架、清空', async (_label, make) => {
    const db = make();
    await assertFails(updateDoc(doc(db, 'banners', 'ban1'), SAVE_PAYLOAD()));
    await assertFails(updateDoc(doc(db, 'banners', 'ban1'), STATUS_PAYLOAD('expired')));
    await assertFails(updateDoc(doc(db, 'banners', 'ban1'), CLEAR_PAYLOAD()));
  });

  test.each(denied)('%s 不可寫 clicks（A 的 trackAdClick 對一般用戶被拒）', async (_label, make) => {
    await assertFails(updateDoc(doc(make(), 'banners', 'ban1'), { clicks: 4 }));
  });

  test('一般用戶不可新增橫幅文件', async () => {
    await assertFails(setDoc(doc(ctx('uidUser', 'user'), 'banners', 'ban9'), SAVE_PAYLOAD()));
  });

  test('admin 沒有 rolePermissions 時仍可寫（isAdmin() 直接放行）', async () => {
    await assertSucceeds(updateDoc(doc(ctx('uidAdmin', 'admin'), 'banners', 'ban1'), STATUS_PAYLOAD('expired')));
  });
});

describe('banners 寫入：admin／super_admin／持有 admin.banners.entry', () => {
  test.each([
    ['admin', 'admin'],
    ['super_admin', 'super_admin'],
  ])('%s 可儲存、下架、上架、清空、改 clicks', async (uid, role) => {
    const db = ctx(`uid_${uid}`, role);
    const ref = doc(db, 'banners', 'ban1');
    await assertSucceeds(updateDoc(ref, SAVE_PAYLOAD()));
    await assertSucceeds(updateDoc(ref, STATUS_PAYLOAD('expired')));
    await assertSucceeds(updateDoc(ref, STATUS_PAYLOAD('active')));
    await assertSucceeds(updateDoc(ref, CLEAR_PAYLOAD()));
    await assertSucceeds(updateDoc(ref, { clicks: 10 }));
  });

  test('角色權限：rolePermissions/coach 含 admin.banners.entry 的 coach 可寫', async () => {
    await seedRolePermission('coach', [PERM]);
    await assertSucceeds(updateDoc(doc(ctx('uidCoach', 'coach'), 'banners', 'ban1'), SAVE_PAYLOAD()));
  });

  test('角色權限不含該碼的 coach 仍不可寫', async () => {
    await seedRolePermission('coach', ['admin.users.entry']);
    await assertFails(updateDoc(doc(ctx('uidCoach', 'coach'), 'banners', 'ban1'), SAVE_PAYLOAD()));
  });

  test('個別授權：userPermissionGrants 啟用中的一般用戶可寫', async () => {
    await seedGrant('uidGranted', { permissions: [PERM], enabled: true });
    await assertSucceeds(updateDoc(doc(ctx('uidGranted', 'user'), 'banners', 'ban1'), STATUS_PAYLOAD('expired')));
  });

  test('個別授權停用（enabled:false）或碼不對：不可寫', async () => {
    await seedGrant('uidOff', { permissions: [PERM], enabled: false });
    await seedGrant('uidOther', { permissions: ['admin.users.entry'], enabled: true });
    await assertFails(updateDoc(doc(ctx('uidOff', 'user'), 'banners', 'ban1'), STATUS_PAYLOAD('expired')));
    await assertFails(updateDoc(doc(ctx('uidOther', 'user'), 'banners', 'ban1'), STATUS_PAYLOAD('expired')));
  });

  test('可新增橫幅文件（create 同樣需要權限）', async () => {
    await assertSucceeds(setDoc(doc(ctx('uidAdmin', 'admin'), 'banners', 'ban9'), SAVE_PAYLOAD()));
  });
});

describe('banners 刪除：任何人都不行（B 的「刪除」只能清空欄位）', () => {
  test.each([
    ['訪客', () => guest()],
    ['user', () => ctx('uidUser', 'user')],
    ['admin', () => ctx('uidAdmin', 'admin')],
    ['super_admin', () => ctx('uidSuper', 'super_admin')],
  ])('%s 不可 deleteDoc', async (_label, make) => {
    await assertFails(deleteDoc(doc(make(), 'banners', 'ban1')));
  });

  test('持有 admin.banners.entry 的個別授權者也不可 deleteDoc', async () => {
    await seedGrant('uidGranted', { permissions: [PERM], enabled: true });
    await assertFails(deleteDoc(doc(ctx('uidGranted', 'user'), 'banners', 'ban1')));
  });
});
