const { test, expect } = require('@playwright/test');
const { clearBrowserState } = require('./helpers/test-harness');

async function fixture(page, theme) {
  await clearBrowserState(page);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost','127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname !== '/cp02-fixture') return route.continue();
    await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html>
      <html data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/education.css"></head>
      <body><main style="padding:16px;max-width:960px;margin:auto"><h1>課程測試俱樂部</h1>
      <div id="edu-detail-tabs"><button data-edutab="course" class="tab" onclick="App.switchEduTab('course')">課程</button><span class="edu-tab-mine-wrap"><button class="tab" data-edutab="student">學員</button><span id="edu-mine-badge" class="edu-tab-badge"></span></span></div><span id="edu-mine-status" class="edu-mine-status"></span>
      <div id="edu-detail-tab-content"></div><div style="height:900px"></div></main></body></html>`});
  });
  await page.goto('/cp02-fixture');
  await page.evaluate(() => {
    window.escapeHTML = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    window.viewer = {uid:'viewer-a'};
    window.auth = {currentUser:window.viewer};
    window.calls = {plans:0,students:0}; window.failPlans = false;
    window.plans = Array.from({length:8},(_,i)=>({id:'plan-'+i,name:'足球訓練課程 '+i,planType:'weekly',allowSignup:true,active:true,groupId:'group-a'}));
    window.ApiService = {
      getCurrentUser:()=>window.viewer, getTeam:()=>({id:'team-a',type:'education'}),
      async listEduCoursePlans() {window.calls.plans++;await new Promise(r=>setTimeout(r,60));if(window.failPlans)throw Error('cp02 injected offline');return structuredClone(window.plans);},
      async listEduStudents() {window.calls.students++;await new Promise(r=>setTimeout(r,90));return [];},
    };
    window.firebase = {firestore:()=>({collection:()=>({doc:()=>({collection:()=>({onSnapshot:callback=>{window.deliverSnapshot=callback;return ()=>{};}})})})})};
    window.App={currentPage:'page-team-detail',_teamDetailRequestSeq:1,isEduClubStaff:()=>false,
      _loadCourseSessions:async()=>[],_getCourseEnrollCacheKey:()=>null,
      _weekdayLabel:()=>'',_todayStr:()=> '2026-09-07'};
  });
  for (const name of ['edu-course-plan','edu-student-list','edu-detail-render','edu-detail-realtime','edu-course-plan-render']) {
    await page.addScriptTag({url:'/js/modules/education/'+name+'.js'});
  }
  await page.evaluate(() => {
    App._initEduClubDetailSection('team-a');
  });
  await expect(page.locator('.edu-course-card')).toHaveCount(8);
  await page.waitForTimeout(150);
}

for (const theme of ['light','dark']) test(`CP02 ${theme} hydration, local patch, refresh and retry`, async ({page},testInfo) => {
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('cp02 injected offline'))errors.push(msg.text());});
  await fixture(page,theme);
  expect(await page.evaluate(()=>calls.plans)).toBe(1);
  await page.evaluate(()=>{
    window.initialCard=document.querySelector('.edu-course-card');
    window.initialTab=document.querySelector('.edu-cp-view-tabs');
    // Establish a completed user scroll; base.css enables smooth scrolling, whose
    // ongoing animation must not be mistaken for a refresh-induced movement.
    window.scrollTo({top:240,behavior:'instant'});
    window.scrollBefore=window.scrollY;
    window.focusButton=document.querySelector('.edu-cp-view-tabs button');
    focusButton.focus({preventScroll:true});
    for(let i=0;i<5;i++) deliverSnapshot({docs:[]});
  });
  expect(await page.evaluate(()=>({card:initialCard===document.querySelector('.edu-course-card'),tab:initialTab===document.querySelector('.edu-cp-view-tabs'),focus:document.activeElement===focusButton,scroll:scrollY,initial:scrollBefore,calls:calls.plans})))
    .toEqual({card:true,tab:true,focus:true,scroll:240,initial:240,calls:1});
  await page.evaluate(()=>{
    document.querySelector('.edu-cp-detail-btn').focus({preventScroll:true});
    deliverSnapshot({docs:[{id:'student-a',data:()=>({parentUid:'viewer-a',enrollStatus:'active',groupIds:['group-a']})}]});
  });
  await expect(page.locator('.edu-cp-signup-enrolled')).toHaveCount(8);
  expect(await page.evaluate(()=>document.activeElement===document.querySelector('.edu-cp-detail-btn'))).toBe(true);
  await testInfo.attach('scroll-after-member-refresh',{body:JSON.stringify(await page.evaluate(()=>({before:scrollBefore,after:scrollY,behavior:getComputedStyle(document.documentElement).scrollBehavior,cardTop:document.querySelector('.edu-course-card').getBoundingClientRect().top}))),contentType:'application/json'});
  expect(await page.evaluate(()=>scrollY===scrollBefore)).toBe(true);
  await page.waitForTimeout(100);
  await expect(page.locator('#edu-mine-badge')).toHaveText('1');
  await expect(page.locator('#edu-mine-badge')).toHaveCSS('position','absolute');
  expect(await page.evaluate(()=>calls.plans)).toBe(1);
  await page.evaluate(async()=>{failPlans=true;await App.renderEduCoursePlanList('team-a');});
  await expect(page.getByText('課程資料暫時無法更新，先顯示上次資料')).toBeVisible();
  await page.evaluate(async()=>{failPlans=false;await Promise.all(Array.from({length:5},()=>App.renderEduCoursePlanList('team-a')));});
  expect(await page.evaluate(()=>calls.plans)).toBe(3);
  await expect(page.locator('.edu-course-card')).toHaveCount(8);
  await expect(page.locator('.edu-refresh-status')).toHaveCount(0);
  await page.evaluate(()=>window.scrollTo(0,0));
  const expectedColor=theme==='dark'?'rgb(13, 16, 23)':'rgb(244, 246, 249)';
  await expect.poll(()=>page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(expectedColor);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`cp02-${theme}.png`),fullPage:true,animations:'disabled'});
  expect(errors).toEqual([]);
});
