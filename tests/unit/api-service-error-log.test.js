const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadApiService() {
  const writes = [];
  const sandbox = {
    console,
    CACHE_VERSION: '0.test',
    App: {
      currentPage: 'page-activity-detail',
      currentRole: 'user',
      _formatDateTime(date) {
        return date.toISOString();
      },
    },
    FirebaseService: {
      addErrorLog(entry) {
        writes.push(entry);
        return Promise.resolve();
      },
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Line/14.0.0',
    },
    location: {
      href: 'https://toosterx.com/#page-activity-detail',
      hash: '#page-activity-detail',
    },
    document: {
      querySelector: () => null,
    },
    db: null,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/api-service.js'), 'utf8');
  vm.runInNewContext(`${code}\nthis.ApiService = ApiService;`, sandbox, { filename: 'js/api-service.js' });
  sandbox.ApiService.getCurrentUser = () => ({ uid: 'u1', displayName: 'Tester', role: 'user' });
  sandbox.ApiService._errorLogCache = new Set();
  return { ApiService: sandbox.ApiService, writes };
}

describe('ApiService error log noise classification', () => {
  test('detects Firestore IndexedDB transaction failures', () => {
    const { ApiService } = loadApiService();

    expect(ApiService._isFirestoreIndexedDbTransientError(
      new Error('Attempt to get records from database without an in-progress transaction')
    )).toBe(true);
    expect(ApiService._isFirestoreIndexedDbTransientError(new Error('Missing or insufficient permissions.'))).toBe(false);
  });

  test('writes Firestore IndexedDB transaction failures with stable low-noise metadata', () => {
    const { ApiService, writes } = loadApiService();

    ApiService._writeErrorLog(
      'unhandledrejection',
      new Error('Attempt to get records from database without an in-progress transaction')
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      context: 'firestore-indexeddb-transient',
      errorCode: 'firestore-indexeddb-transient',
      errorCategory: 'sdk-transient',
      severityHint: 'low',
      noise: true,
      page: 'page-activity-detail',
      osName: 'iOS',
      browserName: 'LINE',
    });
  });
});
