/**
 * detailCoreSplit（Wave 2 拆包）— event-detail.js deferred handler wrappers
 * 載入真實 event-detail.js，驗證 9 個 stable wrapper 的行為：
 * ensureGroup 順序、真身轉呼、載入失敗降級、防自我遞迴。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../js/modules/event/event-detail.js'),
  'utf8'
);

const EXPECTED_WRAPPERS = [
  '_forcePromoteWaitlist',
  '_forceDemoteToWaitlist',
  '_removeParticipant',
  '_removeUnregUser',
  '_startTableEdit',
  '_finishRosterManagement',
  '_startUnregTableEdit',
  '_confirmAllUnregAttendance',
  'editMyActivity',
];

function loadEventDetail({ ensureGroupImpl } = {}) {
  const ensureCalls = [];
  const scriptLoader = {
    ensureGroup: jest.fn((g) => {
      ensureCalls.push(g);
      return ensureGroupImpl ? ensureGroupImpl(g) : Promise.resolve();
    }),
  };
  const app = { showToast: jest.fn() };
  const context = {
    console: { ...console, error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    App: app,
    ScriptLoader: scriptLoader,
    window: { addEventListener: () => {}, location: { href: 'https://example.com/' } },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: {},
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { app, scriptLoader, ensureCalls, context };
}

describe('detailCoreSplit — deferred handler wrappers（真實 event-detail.js）', () => {
  test('9 個 wrapper 全部掛上且帶 _detailCoreSplitWrapper 標記', () => {
    const { app } = loadEventDetail();
    EXPECTED_WRAPPERS.forEach((name) => {
      expect(typeof app[name]).toBe('function');
      expect(app[name]._detailCoreSplitWrapper).toBe(true);
    });
  });

  test('不得包 _retryAttendanceTableLoad（真身留核心，包了會自我遮蔽）', () => {
    const { app } = loadEventDetail();
    expect(app._retryAttendanceTableLoad?._detailCoreSplitWrapper).toBeUndefined();
  });

  test('roster wrapper：先 create 後 manage 整組載入，轉呼真身並透傳參數', async () => {
    const { app, ensureCalls } = loadEventDetail({
      ensureGroupImpl: (g) => {
        if (g === 'activityManage') {
          // 模擬延後檔載入：真身以 Object.assign 覆寫 wrapper
          app._startTableEdit = jest.fn(() => 'real-result');
        }
        return Promise.resolve();
      },
    });
    const result = await app._startTableEdit('evt-1');
    expect(ensureCalls).toEqual(['activityCreate', 'activityManage']);
    expect(app._startTableEdit).toHaveBeenCalledWith('evt-1');
    expect(result).toBe('real-result');
  });

  test('editMyActivity wrapper：先 activityCreate 再 activityManage（lifecycle 依賴 create 檔）', async () => {
    const { app, ensureCalls } = loadEventDetail({
      ensureGroupImpl: (g) => {
        if (g === 'activityManage') app.editMyActivity = jest.fn(() => 'edited');
        return Promise.resolve();
      },
    });
    const result = await app.editMyActivity('evt-9');
    expect(ensureCalls).toEqual(['activityCreate', 'activityManage']);
    expect(result).toBe('edited');
  });

  test('任一 wrapper 都不可只載 manage（lifecycle 覆寫 editMyActivity 後需 create 在場）', () => {
    const { app } = loadEventDetail();
    expect(app._deferredEventHandlerGroups).toEqual(['activityCreate', 'activityManage']);
  });

  test('群組載入失敗：Toast 提示、不拋錯、不呼叫真身', async () => {
    const { app } = loadEventDetail({
      ensureGroupImpl: () => Promise.reject(new Error('network down')),
    });
    await expect(app._removeParticipant('evt-1', 'uid-1')).resolves.toBeUndefined();
    expect(app.showToast).toHaveBeenCalled();
  });

  test('防自我遞迴：群組載入後真身仍缺席 → 攔下並提示，不無限遞迴', async () => {
    const { app, scriptLoader } = loadEventDetail(); // ensureGroup resolve 但不覆寫真身
    await expect(app._forcePromoteWaitlist('evt-1', 'uid-1')).resolves.toBeUndefined();
    expect(scriptLoader.ensureGroup).toHaveBeenCalledTimes(2); // create + manage 各一次，無遞迴
    expect(app.showToast).toHaveBeenCalled();
  });
});
