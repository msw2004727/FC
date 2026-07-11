const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function localStaticScripts() {
  return [...read('index.html').matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map(match => match[1].split('?')[0])
    .filter(src => !/^https?:/i.test(src));
}

describe('startup performance guardrails', () => {
  test('home boot does not automatically prefetch or execute every core page', () => {
    const config = read('js/config.js');
    const index = read('index.html');
    const loader = read('js/core/script-loader.js');

    expect(config).toContain('idleModuleExecutionPreload: false');
    expect(index).not.toContain('ScriptLoader.preloadCorePages();');
    expect(index).not.toContain('ScriptLoader.preloadCorePagesExecutable');
    expect(loader).toContain('PERFORMANCE_FLAGS.idleModuleExecutionPreload !== true');
  });

  test('initial local script count and parse bytes stay within the reviewed budget', () => {
    const scripts = localStaticScripts();
    const rawBytes = scripts.reduce((total, src) => {
      const absolute = path.join(root, src);
      expect(fs.existsSync(absolute)).toBe(true);
      return total + fs.statSync(absolute).size;
    }, 0);

    expect(scripts.length).toBeLessThanOrEqual(54);
    expect(rawBytes).toBeLessThanOrEqual(1_500_000);
  });

  test('public activity list uses list-only scripts and data', () => {
    const loader = read('js/core/script-loader.js');
    const config = read('js/config.js');
    const firebase = read('js/firebase-service.js');
    const listGroup = loader.match(/activityList:\s*\[([\s\S]*?)\],\s*activity:/);

    expect(read('js/modules/home-dashboard.js'))
      .toContain("scriptLoader.ensureGroup('activityCreate')");
    expect(loader).toContain("'page-activities':         ['activityList']");
    expect(listGroup).not.toBeNull();
    expect(listGroup[1]).toContain('event-list-timeline.js');
    expect(listGroup[1]).not.toContain('event-detail.js');
    expect(listGroup[1]).not.toContain('event-create.js');
    expect(listGroup[1]).not.toContain('event-manage.js');

    expect(config).toContain("'page-activities':         { required: ['events'], optional: ['registrations', 'roleActivityCapabilities'], realtime: ['registrations', 'events'] }");
    expect(firebase).toContain("'page-activities':        ['events', 'registrations', 'roleActivityCapabilities']");
    expect(firebase).toContain("'page-activities':      ['registrations', 'events']");
    expect(firebase).toContain("'page-my-activities':   ['registrations']");
    expect(read('js/modules/event/event-manage.js'))
      .toContain('FirebaseService.requestAttendanceRecordsRealtime?.()');
  });

  test('full users realtime is route-scoped while current-user realtime remains direct', () => {
    const config = read('js/config.js');
    const service = read('js/firebase-service.js');
    const crud = read('js/firebase-crud.js');

    expect(config).toContain('routeScopedUsersRealtime: true');
    expect(service).toContain('_fullUsersRealtimePages: new Set([');
    expect(service).toContain('_syncUsersListenerForPage(pageId)');
    expect(service).toContain("'page-teams', 'page-team-detail', 'page-team-manage'");
    expect(service).toContain("'page-messages', 'page-my-activities', 'page-scan'");
    expect(service).toContain("'page-edu-groups', 'page-edu-students', 'page-edu-course-plan'");
    expect(service).toContain('this._syncUsersListenerForPage(');
    expect(service).toContain('this._setupUserListener(authUid)');
    expect(service).toContain('async ensureFullUsersReadyForPage(pageId');
    expect(read('js/core/navigation.js'))
      .toContain('FirebaseService.ensureFullUsersReadyForPage(pageId)');
    expect(crud).toContain("db.collection('users').doc(docId).onSnapshot(");
  });

  test('blocking resource hints and global touch listeners stay out of home boot', () => {
    const index = read('index.html');
    const banner = read('js/modules/banner.js');

    expect(index).not.toMatch(/rel="preload"[^>]+firebase/i);
    expect(index).not.toMatch(/rel="preload"[^>]+liff/i);
    expect(index).toMatch(/href="css\/activity\.css\?v=[^"]+" media="print" onload="this\.media='all'"/);
    expect(banner).toContain("floatingAds.addEventListener('touchstart', onTouchStart, { passive: true })");
    expect(banner).toContain("document.addEventListener('touchcancel', onTouchEnd)");
    expect(banner).toContain("document.removeEventListener('touchmove', onMove)");
  });

  test('service worker precache stays focused on the offline home shell', () => {
    const sw = read('sw.js');

    expect(sw).toContain('const PRECACHE_VERSION = CACHE_NAME.replace');
    expect(sw).toContain("withPrecacheVersion('./css/base.css')");
    expect(sw).toContain("withPrecacheVersion('./pages/home.html')");
    expect(sw).not.toContain("'./css/admin.css'");
    expect(sw).not.toContain("'./pages/activity.html'");
    expect(sw).not.toContain('response.clone().arrayBuffer()');
    expect(sw).toContain('new Response(response.body');
    expect(sw).toContain('event.waitUntil(imageResponse.then(() => imageCacheUpdate)');
    expect(sw).toContain('IMAGE_CACHE_TRIM_INTERVAL');
    expect(sw).toContain('caches.open(IMAGE_CACHE_NAME).then(cache => trimImageCache(cache))');

    const assetBlock = sw.match(/const STATIC_ASSETS\s*=\s*\[([\s\S]*?)\];/);
    expect(assetBlock).not.toBeNull();
    const assetPaths = [...assetBlock[1].matchAll(/['"](\.\/[^'"]+)['"]/g)]
      .map(match => match[1])
      .filter(asset => asset !== './');
    const rawBytes = [...new Set(assetPaths)].reduce((total, asset) => {
      const absolute = path.join(root, asset.replace(/^\.\//, '').split('?')[0]);
      expect(fs.existsSync(absolute)).toBe(true);
      return total + fs.statSync(absolute).size;
    }, 0);
    expect(rawBytes).toBeLessThanOrEqual(900_000);
  });
});
