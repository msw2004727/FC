/**
 * ApiService.deleteTeam — 俱樂部刪除流程統一（改走 Callable deleteTeam）
 *
 * 驗證：
 *   1. 呼叫 asia-east1 的 Callable deleteTeam，不再前端直刪 team 文件或逐一寫 users
 *   2. Callable 失敗 → 錯誤往外拋，teams 與使用者快取完全不動
 *   3. Callable 回 partial → 快取不動
 *   4. 成功（含 alreadyDeleted）→ 才從快取移除 team 與本地 user 的 teamIds
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadApiService({ callableImpl }) {
  const calls = { regions: [], names: [], payloads: [], directWrites: [] };
  const cache = {
    teams: [
      { id: 'tm_a', _docId: 'tm_a', name: '甲隊' },
      { id: 'tm_b', _docId: 'tm_b', name: '乙隊' },
    ],
    adminUsers: [
      { uid: 'U1', _docId: 'U1', teamId: 'tm_a', teamName: '甲隊', teamIds: ['tm_a', 'tm_b'], teamNames: ['甲隊', '乙隊'] },
      { uid: 'U2', _docId: 'U2', teamId: 'tm_b', teamName: '乙隊', teamIds: ['tm_b'], teamNames: ['乙隊'] },
    ],
    currentUser: { uid: 'U3', _docId: 'U3', teamId: 'tm_a', teamName: '甲隊', teamIds: ['tm_a'], teamNames: ['甲隊'] },
  };
  const sandbox = {
    console,
    CACHE_VERSION: '0.test',
    App: {},
    FirebaseService: {
      _cache: cache,
      _saveToLS: () => {},
      ensureAuthReadyForWrite: async () => {},
      deleteTeam: async (...args) => { calls.directWrites.push(['deleteTeam', ...args]); },
      updateUser: async (...args) => { calls.directWrites.push(['updateUser', ...args]); },
    },
    ensureFirebaseFunctionsSdk: async (region) => {
      calls.regions.push(region);
      return {
        httpsCallable: (name) => {
          calls.names.push(name);
          return async (payload) => {
            calls.payloads.push(payload);
            return callableImpl(payload);
          };
        },
      };
    },
    navigator: { userAgent: 'jest' },
    location: { href: 'https://toosterx.com/', hash: '' },
    document: { querySelector: () => null },
    db: null,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/api-service.js'), 'utf8');
  vm.runInNewContext(`${code}\nthis.ApiService = ApiService;`, sandbox, { filename: 'js/api-service.js' });
  return { ApiService: sandbox.ApiService, cache, calls };
}

const snapshot = (cache) => JSON.parse(JSON.stringify(cache));

describe('ApiService.deleteTeam（Callable deleteTeam）', () => {
  test('Callable 失敗 → 錯誤往外拋，快取不動、沒有前端直寫', async () => {
    const err = Object.assign(new Error('COACH_PLUS_REQUIRED'), { code: 'functions/permission-denied' });
    const { ApiService, cache, calls } = loadApiService({ callableImpl: async () => { throw err; } });
    const before = snapshot(cache);

    await expect(ApiService.deleteTeam('tm_a')).rejects.toBe(err);

    expect(snapshot(cache)).toEqual(before);
    expect(calls.regions).toEqual(['asia-east1']);
    expect(calls.names).toEqual(['deleteTeam']);
    expect(calls.payloads).toEqual([{ teamId: 'tm_a' }]);
    expect(calls.directWrites).toEqual([]);
  });

  test('Callable 回 partial → 快取不動', async () => {
    const { ApiService, cache, calls } = loadApiService({
      callableImpl: async () => ({ data: { ok: true, alreadyDeleted: false, partial: { remaining: 2, memberIds: ['x', 'y'], rerun: true } } }),
    });
    const before = snapshot(cache);

    await expect(ApiService.deleteTeam('tm_a')).resolves.toEqual({ status: 'partial' });

    expect(snapshot(cache)).toEqual(before);
    expect(calls.directWrites).toEqual([]);
  });

  test('成功 → 從快取移除 team 與本地 user 的隊籍，不另寫 Firestore', async () => {
    const { ApiService, cache, calls } = loadApiService({
      callableImpl: async () => ({ data: { ok: true, alreadyDeleted: false, cleanedMembers: 2, roleChanges: 0 } }),
    });

    await expect(ApiService.deleteTeam('tm_a')).resolves.toEqual({ status: 'deleted' });

    expect(cache.teams.map(t => t.id)).toEqual(['tm_b']);
    expect(cache.adminUsers[0]).toMatchObject({ teamId: 'tm_b', teamName: '乙隊', teamIds: ['tm_b'], teamNames: ['乙隊'] });
    expect(cache.adminUsers[1]).toMatchObject({ teamId: 'tm_b', teamIds: ['tm_b'] });
    expect(cache.currentUser).toMatchObject({ teamId: null, teamName: null, teamIds: [], teamNames: [] });
    expect(calls.directWrites).toEqual([]);
  });

  test('alreadyDeleted → 視為成功，同樣從快取移除', async () => {
    const { ApiService, cache } = loadApiService({
      callableImpl: async () => ({ data: { ok: true, alreadyDeleted: true, skippedNotifies: 0 } }),
    });

    await expect(ApiService.deleteTeam('tm_a')).resolves.toEqual({ status: 'deleted' });
    expect(cache.teams.map(t => t.id)).toEqual(['tm_b']);
  });
});
