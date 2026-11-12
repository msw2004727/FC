/**
 * 冷啟動計畫批 1(a)：Storage 實例改「第一次使用時才建立」後，commitSecondaryIdentityAvatar 行為不變。
 * 直接跑 functions/index.js 真正的 handler（vm 載入、firebase-* 換成假的、記憶體版 Firestore），
 * firebase-admin/storage 換成可計數的假實作：
 *  - 載入 index.js 時不得建立 Storage（冷啟動不再載入 @google-cloud/storage）。
 *  - 未登入／無權限／清除頭像不建立 Storage；需要讀 metadata 時才建立，且之後重用同一實例。
 *  - 回應與錯誤碼（success／cleared、unauthenticated、permission-denied、failed-precondition）與原本相同；
 *    region／memory／timeout 不變。
 *  - 建立失敗時記 structured log 並把原錯誤往外丟（onCall 層轉成 internal，與原本頂層失敗不同處在於只影響這一支）。
 */

const vm = require('vm');
const { createFakeFirestore, loadFunctionsIndex } = require('./registration-callable-harness');

// index.js 在主 realm 執行，讀的是真正的 process.env（jest 沙箱的 process.env 是副本）。
const realProcess = vm.runInThisContext('process');

const U_SUPER = `U${'9'.repeat(32)}`;
const U_PLAIN = `U${'1'.repeat(32)}`;
const PROJECT_ID = 'demo-project';
const BUCKET = `${PROJECT_ID}.firebasestorage.app`;
const avatarPath = (uid) => `images/users/${uid}/identities/secondary/a.png`;
const avatarUrl = (uid) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(avatarPath(uid))}?alt=media`;
const validCommit = (uid) => ({ avatarUrl: avatarUrl(uid), avatarStoragePath: avatarPath(uid), avatarStorageBucket: BUCKET });

function createStorageStub() {
  const state = {
    getStorageCalls: 0,
    throwOnCreate: null,
    metadata: { contentType: 'image/png', size: 1024 },
    metadataError: null,
    requested: [],
  };
  const storageInstance = {
    bucket: (bucketName) => ({
      file: (filePath) => ({
        getMetadata: async () => {
          state.requested.push({ bucketName, filePath });
          if (state.metadataError) throw state.metadataError;
          return [state.metadata];
        },
      }),
    }),
  };
  const module = {
    getStorage: () => {
      state.getStorageCalls += 1;
      if (state.throwOnCreate) throw state.throwOnCreate;
      return storageInstance;
    },
  };
  return { state, module };
}

function seedUsers() {
  return createFakeFirestore({
    [`users/${U_SUPER}`]: { uid: U_SUPER, lineUserId: U_SUPER, role: 'super_admin' },
    [`users/${U_PLAIN}`]: { uid: U_PLAIN, lineUserId: U_PLAIN, role: 'user' },
  });
}

let savedProjectEnv;

beforeAll(() => {
  savedProjectEnv = realProcess.env.GCLOUD_PROJECT;
  realProcess.env.GCLOUD_PROJECT = PROJECT_ID;
});

afterAll(() => {
  if (savedProjectEnv === undefined) delete realProcess.env.GCLOUD_PROJECT;
  else realProcess.env.GCLOUD_PROJECT = savedProjectEnv;
});

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('commitSecondaryIdentityAvatar with lazy Storage admin', () => {
  let fn;
  let harness;
  let storage;
  let fake;

  beforeAll(() => {
    storage = createStorageStub();
    const loaded = loadFunctionsIndex({ stubs: { 'firebase-admin/storage': storage.module } });
    fn = loaded.exports;
    harness = loaded.harness;
  });

  beforeEach(() => {
    fake = seedUsers();
    harness.current = fake;
    harness.logs.length = 0;
    storage.state.metadata = { contentType: 'image/png', size: 1024 };
    storage.state.metadataError = null;
  });

  test('loading index.js does not create Storage (cold start skips @google-cloud/storage)', () => {
    expect(storage.state.getStorageCalls).toBe(0);
  });

  test('callable options unchanged: asia-east1, 256MiB, 15 s', () => {
    expect(fn.commitSecondaryIdentityAvatar.__options).toEqual({
      region: 'asia-east1', timeoutSeconds: 15, memory: '256MiB',
    });
  });

  test('unauthenticated / permission-denied / clear paths never create Storage', async () => {
    await expect(fn.commitSecondaryIdentityAvatar({ data: validCommit(U_SUPER) }))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_PLAIN }, data: validCommit(U_PLAIN) }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: { clear: true } }))
      .resolves.toEqual({ success: true, cleared: true });
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: { avatarUrl: 'https://evil.example/a.png' } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(storage.state.getStorageCalls).toBe(0);
    const settings = fake.get(`users/${U_SUPER}/identityPrivate/settings`);
    expect(settings.identities.secondary.avatarStoragePath).toBeNull();
  });

  test('valid commit creates Storage once, reads metadata from the submitted object, then reuses the instance', async () => {
    const first = await fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) });
    expect(first).toEqual({ success: true, avatarUrl: avatarUrl(U_SUPER), avatarStoragePath: avatarPath(U_SUPER) });
    expect(storage.state.getStorageCalls).toBe(1);
    expect(storage.state.requested).toContainEqual({ bucketName: BUCKET, filePath: avatarPath(U_SUPER) });
    const settings = fake.get(`users/${U_SUPER}/identityPrivate/settings`);
    expect(settings.identities.secondary).toMatchObject({
      avatarUrl: avatarUrl(U_SUPER), avatarStoragePath: avatarPath(U_SUPER), avatarStorageBucket: BUCKET,
    });

    await fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) });
    expect(storage.state.getStorageCalls).toBe(1);
  });

  test('missing object -> failed-precondition (not found); invalid object -> failed-precondition (invalid)', async () => {
    storage.state.metadataError = Object.assign(new Error('No such object'), { code: 404 });
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) }))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'avatar storage object not found' });

    storage.state.metadataError = null;
    storage.state.metadata = { contentType: 'text/plain', size: 10 };
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) }))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'avatar storage object invalid' });

    storage.state.metadata = { contentType: 'image/png', size: 3 * 1024 * 1024 };
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) }))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'avatar storage object invalid' });
  });

  test('other Storage errors propagate unchanged', async () => {
    const boom = Object.assign(new Error('backend unavailable'), { code: 503 });
    storage.state.metadataError = boom;
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) }))
      .rejects.toBe(boom);
  });
});

describe('getStorageAdmin failure path', () => {
  test('logs structured error, rethrows the original error, and retries on the next call', async () => {
    const storage = createStorageStub();
    const { exports: fn, harness } = loadFunctionsIndex({ stubs: { 'firebase-admin/storage': storage.module } });
    harness.current = seedUsers();
    const createError = Object.assign(new Error('storage init failed'), { code: 'app/invalid-credential' });
    storage.state.throwOnCreate = createError;

    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) }))
      .rejects.toBe(createError);
    expect(harness.logs).toContainEqual(['error', '[getStorageAdmin] getStorage() failed', {
      code: 'app/invalid-credential', message: 'storage init failed',
    }]);
    expect(storage.state.getStorageCalls).toBe(1);

    storage.state.throwOnCreate = null;
    await expect(fn.commitSecondaryIdentityAvatar({ auth: { uid: U_SUPER }, data: validCommit(U_SUPER) }))
      .resolves.toMatchObject({ success: true });
    expect(storage.state.getStorageCalls).toBe(2);
  });
});
