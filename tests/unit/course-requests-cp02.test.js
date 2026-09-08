const fs = require('fs');
const path = require('path');
const vm = require('vm');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const samples=[];
afterAll(()=>{
  if(process.env.CP02_METRICS_PATH) fs.writeFileSync(process.env.CP02_METRICS_PATH,JSON.stringify({
    measuredAt:new Date().toISOString(),method:'actual ApiService invocation count while five same-key promises remain unresolved',
    role:'member',account:'synthetic viewer-a',cache:'cold',query:'all coursePlans for synthetic team-a',samples,
  },null,2),'utf8');
});
function setup() {
  let user = {uid:'viewer-a'};
  const requests = [];
  const api = {getCurrentUser: () => user, listEduCoursePlans: jest.fn(() => { const d=deferred(); requests.push(d); return d.promise; })};
  const ctx = {App:{}, ApiService:api, FirebaseService:api, console:{error:jest.fn()}, window:{}, auth:{currentUser:user}};
  vm.createContext(ctx);
  const source = process.env.CP02_BASELINE_DIR || path.join(__dirname,'../../js/modules/education');
  vm.runInContext(fs.readFileSync(path.join(source,'edu-course-plan.js'),'utf8'),ctx);
  return {app:ctx.App,api,requests,ctx,change(uid) { user={uid}; ctx.auth.currentUser=user; }};
}
describe('CP02 same_key_inflight', () => {
  test.each(Array.from({length:30},(_,i)=>i))('cold same-key sample %i', async () => {
    const {app,api,requests}=setup();
    const work=Array.from({length:5},()=>app._loadEduCoursePlans('team-a'));
    const peak=api.listEduCoursePlans.mock.calls.length;
    samples.push({sample:samples.length+1,triggers:work.length,peak});
    requests.forEach(d=>d.resolve([{id:'plan-a'}]));
    await Promise.all(work);
    expect(peak).toBe(1);
  });
});
describe('CP02 race_retry_isolation', () => {
  test('pin/sort invalidates the pre-mutation request before refreshing',async()=>{
    const {app,requests,ctx}=setup();
    app._eduCoursePlansCache.a=[{id:'p',active:true,sortOrder:0}];
    app.showToast=()=>{};ctx.FirebaseService.updateEduCoursePlan=async()=>{};
    app.renderEduCoursePlanList=()=>app._loadEduCoursePlans('a');
    const old=app._loadEduCoursePlans('a');
    const moved=app._moveCoursePlan('a','p',0);
    expect(requests).toHaveLength(2);
    requests[1].resolve([{id:'p',pinned:true}]);await moved;
    requests[0].resolve([{id:'p',pinned:false}]);await old;
    expect(app.getEduCoursePlans('a')[0].pinned).toBe(true);
  });
  test('actual ApiService timeout releases the owner; late SDK completion cannot replace successful retry',async()=>{
    jest.useFakeTimers();
    try {
      const {app,requests,ctx}=setup();ctx.setTimeout=setTimeout;ctx.clearTimeout=clearTimeout;
      vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/api-service.js'),'utf8')+'\nApiService.getCurrentUser = () => auth.currentUser;',ctx);
      const old=app._loadEduCoursePlans('a');
      await jest.advanceTimersByTimeAsync(18000);await old;
      expect(app._eduCoursePlanLoadFailedByTeam.a).toBe(true);
      const fresh=app._loadEduCoursePlans('a');requests[1].resolve([{id:'fresh'}]);await fresh;
      requests[0].resolve([{id:'late SDK'}]);await Promise.resolve();
      expect(app.getEduCoursePlans('a')[0].id).toBe('fresh');
      expect(jest.getTimerCount()).toBe(0);
    } finally {jest.useRealTimers();}
  });
  test('leave and re-enter invalidates old reads and old finally cannot release the new owner',async()=>{
    const {app,requests,ctx}=setup();
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/modules/education/edu-detail-realtime.js'),'utf8'),ctx);
    const old=app._loadEduCoursePlans('a');
    app._cleanupEduListeners();
    const fresh=app._loadEduCoursePlans('a');
    requests[0].resolve([{id:'stale'}]);await old;
    const same=app._loadEduCoursePlans('a');expect(requests).toHaveLength(2);
    requests[1].resolve([{id:'fresh'}]);await Promise.all([fresh,same]);
    expect(app.getEduCoursePlans('a')[0].id).toBe('fresh');
  });
  test('permission revocation changes scope and discards staff response',async()=>{
    const {app,requests}=setup();let staff=true;app.isEduClubStaff=()=>staff;
    const old=app._loadEduCoursePlans('a');staff=false;
    const fresh=app._loadEduCoursePlans('a');requests[1].resolve([]);await fresh;
    requests[0].resolve([{id:'hidden-staff-plan'}]);await old;
    expect(app.getEduCoursePlans('a')).toEqual([]);
  });
  test('mutation invalidation prevents pre-edit response from overwriting new data',async()=>{
    const {app,requests}=setup();const old=app._loadEduCoursePlans('a');
    app._invalidateEduCoursePlanLoad('a');
    const fresh=app._loadEduCoursePlans('a');requests[1].resolve([{id:'edited'}]);await fresh;
    requests[0].resolve([{id:'old'}]);await old;
    expect(app.getEduCoursePlans('a')[0].id).toBe('edited');
  });
  test('different teams proceed concurrently; failure clears lock and empty retry replaces cache',async()=>{
    const {app,requests}=setup();
    const a=app._loadEduCoursePlans('a'),b=app._loadEduCoursePlans('b');
    expect(requests).toHaveLength(2);
    requests[0].resolve([{id:'old'}]);requests[1].reject(new Error('offline'));
    await Promise.all([a,b]);
    const retry=app._loadEduCoursePlans('a');requests[2].resolve([]);await retry;
    expect(app.getEduCoursePlans('a')).toEqual([]);
    const retryB=app._loadEduCoursePlans('b');requests[3].resolve([{id:'fresh'}]);await retryB;
    expect(app.getEduCoursePlans('b')[0].id).toBe('fresh');
  });
  test('account A to B to A never accepts an old response',async()=>{
    const {app,requests,change}=setup();
    const a=app._loadEduCoursePlans('a');change('viewer-b');
    const b=app._loadEduCoursePlans('a');change('viewer-a');
    const again=app._loadEduCoursePlans('a');
    requests[2].resolve([{id:'new'}]);await again;
    requests[1].resolve([{id:'other-account'}]);requests[0].resolve([{id:'stale'}]);await Promise.all([a,b]);
    expect(app.getEduCoursePlans('a')[0].id).toBe('new');
  });
});
