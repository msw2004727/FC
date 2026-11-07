const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
    let gzipBytes = 0;
    const rawBytes = scripts.reduce((total, src) => {
      const absolute = path.join(root, src);
      expect(fs.existsSync(absolute)).toBe(true);
      // Keep the budget platform-stable: Windows checkouts may expand LF to CRLF,
      // while production serves the repository's LF blobs.
      const content = Buffer.from(fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n'));
      gzipBytes += zlib.gzipSync(content, { level: 9 }).length;
      return total + content.length;
    }, 0);

    expect(scripts.length).toBeLessThanOrEqual(54);
    // Reviewed safe-directory, atomic event writes, reliable-message, delegated-profile,
    // and create-modal navigation guards, plus the PageLoader robots-meta strip,
    // and the home next-activity registration query (status-in filter, limit warning,
    // stale-cache calibration, legacy-root filter; T-034); 2026-10-30 事件繫結強化借支：上限由 raw 1,547,900／gz 390,000 調為 1,548,376／390,113（全批 b／c 包完成後實測，相對原上限 +476／+113），A 下線後不追回
    // 2026-11-07 換站 A-03 備援網址（old.toosterx.com 的 LIFF ID 分流與說明註解）借支：raw 上限 1,548,377 → 1,548,496（填入 old 專用 LIFF ID 後副機實測 1,548,496，+119，A 下線後不追回）
    expect(rawBytes).toBeLessThanOrEqual(1_548_496);
    // 2026-11-04 T-090c 建立俱樂部能力開關（能力項目、自建俱樂部略過自動升級、通知補帶 teamId／applicantUid）借支：gz 上限 390,113 → 390,240（實測 390,221，+108，A 下線後不追回；測試同步更新）
    // 2026-11-07 換站 A-03 old 專用 LIFF ID 分流借支：gz 上限 390,240 → 390,358（副機實測 390,358，+118，A 下線後不追回）
    expect(gzipBytes).toBeLessThanOrEqual(390_358);
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
    const banner = read('js/modules/ad-manage/banner.js');

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
    expect(sw).toContain('cleanupLegacyRuntimeCaches()');
    expect(sw).toContain('isLegacyRuntimeCacheName');
    expect(sw).toContain("url.pathname.endsWith('.html')");
    expect(sw).toContain('const cached = await cache.match(event.request)');

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
    // 2026-11-06 顧問 §1.32：900_000→920_000。首頁摘要由自動 inline bot（[skip ci]）寫進 index.html，大小隨活動資料浮動；
    // dfedecde1 讓 main 達 902_297 而紅燈，與功能改動無關。
    expect(rawBytes).toBeLessThanOrEqual(920_000);
  });
});
