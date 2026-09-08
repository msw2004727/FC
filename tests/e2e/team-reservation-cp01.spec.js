const { test, expect } = require('@playwright/test');
const { clearBrowserState } = require('./helpers/test-harness');
const fixture = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/activity.css"></head>
<body><main style="max-width:640px;margin:24px auto;padding:16px"><h1>活動詳情</h1><div id="actions" class="detail-action-primary"></div><div id="toast" role="status"></div></main>
<script>
window.eventRecord={id:'evt_fixture',max:10,current:0,status:'open'}; window.staff=true; window.calls=[]; window.nextError=null;
window.escapeHTML=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
window.ApiService={getEvent:()=>eventRecord,getCurrentUser:()=>({uid:'fixture_user'}),getTeams:()=>[{id:'tm_fixture',name:'測試俱樂部'}]};
window.FirebaseService={adjustTeamReservation:async (...args)=>{calls.push(args);if(window.hold)await new Promise(r=>window.release=r);if(nextError){const e=nextError;nextError=null;throw e;}return {};}};
window.App={currentPage:'page-activity-detail',_currentDetailEventId:'evt_fixture',_requireProtectedActionLogin:()=>false,_isCurrentUserTeamStaff:()=>staff,showToast:s=>document.getElementById('toast').textContent=s};
</script><script src="/js/modules/event/event-detail-signup.js"></script><script src="/js/modules/education/edu-course-plan-render.js"></script>
<script>App._ensureTeamReservationStaffTeamsLoaded=async()=>[];App._patchDetailAfterSignup=()=>{};
window.render=()=>document.getElementById('actions').innerHTML=App._composeEventSignupActions(eventRecord,'<button class="primary-btn" id="personal">個人報名</button>');App._refreshSignupButton=render;render();</script></body></html>`;

for (const theme of ['light', 'dark']) {
  test(`CP01 browser ${theme}: course / ordinary / permissions / retry / reopen / console`, async ({ page }, testInfo) => {
    await clearBrowserState(page);
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(err.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      if (url.pathname === '/cp01-fixture' || url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixture });
      await route.continue();
    });
    await page.goto('/cp01-fixture');
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await expect(page.locator('body')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(13, 16, 23)' : 'rgb(244, 246, 249)');
    await page.evaluate(() => { Object.assign(eventRecord, {courseLinked:true,courseLinkSource:'eduCourseLesson',courseTeamId:'tm_fixture',coursePlanId:'plan_fixture'});render(); });
    await expect(page.getByRole('button', { name: '團隊報名', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '個人報名', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '查看課程' })).toBeVisible();
    await page.evaluate(async () => { await App.openTeamReservationModal('evt_fixture'); await App.confirmTeamReservation('evt_fixture','tm_fixture'); });
    expect(await page.evaluate(() => calls.length)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('course.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('link', { name: '查看課程' }).click();
    await page.waitForURL('**/?team=tm_fixture&teamTab=courses&course=plan_fixture&courseView=detail');
    await page.waitForFunction(() => typeof window.App?._getEduCoursePlanShareIntent === 'function');
    // Validate against the real destination parser, without loading production data.
    expect(await page.evaluate(() => App._getEduCoursePlanShareIntent('tm_fixture'))).toMatchObject({ teamTab:'courses',planId:'plan_fixture',openDetail:true });
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await expect(page.locator('body')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(13, 16, 23)' : 'rgb(244, 246, 249)');
    await page.evaluate(() => { staff=false;render(); });
    await expect(page.getByRole('button', { name: '團隊報名', exact: true })).toHaveCount(0);
    await page.evaluate(async () => { await App.confirmTeamReservation('evt_fixture','tm_fixture');staff=true;render(); });
    expect(await page.evaluate(() => calls.length)).toBe(0);
    await page.getByRole('button', { name: '團隊報名', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.locator('#team-reservation-slots-input').fill('2');
    await page.locator('#team-reservation-slots-input').focus();
    await expect(page.locator('#team-reservation-slots-input')).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThan(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('ordinary-modal.png'), fullPage: true, animations: 'disabled' });
    await page.evaluate(() => nextError={details:{reason:'RESERVED_OVER_CAPACITY'}});
    await page.getByRole('button', { name: '確認', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('可用名額');
    await expect(page.getByRole('button', { name: '確認', exact: true })).toBeEnabled();
    await page.evaluate(() => hold=true);
    await page.getByRole('button', { name: '確認', exact: true }).click();
    await page.evaluate(() => App.confirmTeamReservation('evt_fixture','tm_fixture'));
    expect(await page.evaluate(() => calls.length)).toBe(2);
    await page.getByRole('button', { name: '關閉', exact: true }).click();
    await expect(page.locator('#team-reservation-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#team-reservation-modal')).toHaveCSS('opacity', '0');
    expect(await page.evaluate(() => document.body.classList.contains('modal-open'))).toBe(false);
    await page.getByRole('button', { name: '團隊報名', exact: true }).click();
    await page.evaluate(() => {hold=false;release();});
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: '確認', exact: true }).click();
    await expect(page.locator('#team-reservation-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#team-reservation-modal')).toHaveCSS('opacity', '0');
    await expect(page.getByRole('status')).toContainText('已更新團隊名額');
    expect(await page.evaluate(() => calls.length)).toBe(3);
    await page.evaluate(() => {Object.assign(eventRecord,{courseTeamId:'tm_fixture',coursePlanId:'plan_fixture'});nextError={details:{code:'COURSE_LINKED_EVENT_MANAGED_BY_COURSE'}};});
    await page.getByRole('button', { name: '團隊報名', exact: true }).click();
    await page.getByRole('button', { name: '確認', exact: true }).click();
    await expect(dialog.getByRole('link', {name:'查看課程'})).toBeVisible();
    await expect(dialog.getByRole('button', {name:'確認',exact:true})).toHaveCount(0);
    await page.evaluate(() => App.confirmTeamReservation('evt_fixture','tm_fixture'));
    expect(await page.evaluate(() => calls.length)).toBe(4);
    await page.screenshot({path:testInfo.outputPath('stale-course-rejection.png'),fullPage:true,animations:'disabled'});
    await dialog.getByRole('link', {name:'查看課程'}).click();
    await page.waitForURL('**/?team=tm_fixture&teamTab=courses&course=plan_fixture&courseView=detail');
    await page.waitForFunction(() => typeof window.App?._getEduCoursePlanShareIntent === 'function');
    expect(await page.evaluate(() => App._getEduCoursePlanShareIntent('tm_fixture'))).toMatchObject({planId:'plan_fixture',openDetail:true});
    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter(s => !s.startsWith('[confirmTeamReservation]'))).toEqual([]);
    expect(consoleErrors.filter(s => s.startsWith('[confirmTeamReservation]'))).toHaveLength(2);
    await testInfo.attach('console-observation', { body: JSON.stringify({pageErrors,consoleErrors,expectedInjectedErrors:2}), contentType:'application/json' });
  });
}
