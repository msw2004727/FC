/** @jest-environment jsdom */
const fs=require('fs'),path=require('path'),vm=require('vm');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(){
  document.body.innerHTML='<div id="edu-detail-tabs"></div><span id="edu-mine-badge"></span><span id="edu-mine-status"></span><div id="edu-detail-tab-content"></div>';
  const requests=[],studentReads=[],listeners=[];
  const user={uid:'viewer-a'};
  const ctx={document,window:{},console:{error:jest.fn(),warn:jest.fn(),debug:jest.fn()},auth:{currentUser:user},
    ApiService:{getCurrentUser:()=>ctx.auth.currentUser,getTeam:()=>({id:'a'}),
      listEduCoursePlans:jest.fn(()=>{const d=defer();requests.push(d);return d.promise;}),
      listEduStudents:jest.fn(()=>{const d=defer();studentReads.push(d);return d.promise;})},
    firebase:{firestore:()=>({collection:()=>({doc:()=>({collection:()=>({onSnapshot:cb=>{listeners.push(cb);return ()=>{};}})})})})},
    escapeHTML:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    App:{currentPage:'page-team-detail',_teamDetailRequestSeq:1,isEduClubStaff:()=>false,
      _loadCourseSessions:async()=>[],_getCourseEnrollCacheKey:()=>null,_todayStr:()=> '2026-09-07',_weekdayLabel:()=>''}};
  ctx.FirebaseService=ctx.ApiService;
  vm.createContext(ctx);
  for(const name of ['edu-course-plan','edu-student-list','edu-detail-render','edu-detail-realtime','edu-course-plan-render']){
    const base=process.env.CP02_BASELINE_DIR||path.join(__dirname,'../../js/modules/education');
    vm.runInContext(fs.readFileSync(path.join(base,name+'.js'),'utf8'),ctx);
  }
  ctx.App._refreshTeamMembersCardFromCache=jest.fn();
  const plans=name=>[{id:'plan-a',name,planType:'weekly',active:true,allowSignup:true,groupId:'g'}];
  return {app:ctx.App,ctx,requests,studentReads,listeners,plans};
}
describe('CP02 section_refresh',()=>{
  test('active student hydration and repeated snapshots use the real unpaid badge without new course reads',async()=>{
    const {app,requests,studentReads,listeners,plans}=setup();app._initEduClubDetailSection('a');
    requests[0].resolve(plans('課程 A'));await flush();
    const student={id:'s',parentUid:'viewer-a',groupIds:['g'],enrollStatus:'active'};
    studentReads[0].resolve([student]);await flush();
    expect(requests).toHaveLength(1);
    for(let i=0;i<3;i++){listeners[0]({docs:[{id:'s',data:()=>student}]});await flush();}
    expect(requests).toHaveLength(1);
    expect(document.getElementById('edu-mine-badge').textContent).toBe('1');
  });
  test.each(['.edu-cp-detail-btn','.edu-cp-lessons-btn'])('changed card retains focus on %s',async selector=>{
    const {app,requests,listeners,plans}=setup();app._initEduClubDetailSection('a');
    requests[0].resolve(plans('課程 A'));await flush();
    document.querySelector(selector).focus();
    listeners[0]({docs:[{id:'s',data:()=>({parentUid:'viewer-a',groupIds:['g'],enrollStatus:'active'})}]});await flush();
    expect(document.activeElement).toBe(document.querySelector(selector));
  });
  test.each(['snapshot-first','hydration-first'])('%s: one course load and unchanged nodes survive notifications',async order=>{
    const {app,requests,studentReads,listeners,plans}=setup();app._initEduClubDetailSection('a');
    requests[0].resolve(plans('課程 A'));await flush();
    const card=document.querySelector('.edu-course-card');const tabs=document.querySelector('.edu-cp-view-tabs');
    expect(card).not.toBeNull();
    if(order==='snapshot-first')listeners[0]({docs:[]});
    studentReads[0].resolve([]);await flush();
    listeners[0]({docs:[]});await flush();
    expect(requests).toHaveLength(1);
    expect(document.querySelector('.edu-course-card')).toBe(card);
    expect(document.querySelector('.edu-cp-view-tabs')).toBe(tabs);
    listeners[0]({docs:[{id:'s',data:()=>({parentUid:'viewer-a',groupIds:['g'],enrollStatus:'active'})}]});
    await flush();
    expect(document.querySelector('.edu-cp-signup-enrolled')).not.toBeNull();
    expect(requests).toHaveLength(1);
  });
  test('snapshot beats delayed hydration, including empty snapshots and late failures',async()=>{
    const {app,studentReads,listeners}=setup();app._startEduStudentsListener('a');
    const read=app._loadEduStudents('a');
    listeners[0]({docs:[]});studentReads[0].resolve([{id:'old'}]);await read;
    expect(app.getEduStudents('a')).toEqual([]);
    const retry=app._loadEduStudents('a');listeners[0]({docs:[]});studentReads[1].reject(Error('offline'));await retry;
    expect(app._eduStudentsLoadFailedByTeam.a).toBe(false);
  });
});
describe('CP02 race_retry_isolation',()=>{
  test.each([false,true])('concurrent student reads keep latest intent (reverse=%s)',async reverse=>{
    const {app,studentReads}=setup();const old=app._loadEduStudents('a'),fresh=app._loadEduStudents('a');
    if(reverse){studentReads[1].resolve([{id:'fresh'}]);await fresh;studentReads[0].resolve([{id:'old'}]);}
    else {studentReads[0].resolve([{id:'old'}]);await old;studentReads[1].resolve([{id:'fresh'}]);}
    await Promise.all([old,fresh]);expect(app.getEduStudents('a')).toEqual([{id:'fresh'}]);
  });
  test('education-to-education navigation retains listener lifecycle but replaces course read owner',async()=>{
    const {app,requests,plans}=setup();app._initEduClubDetailSection('a');
    // navigation.js keeps education listeners inside eduSubPages: no manual cleanup here.
    app._teamDetailRequestSeq++;app._initEduClubDetailSection('b');
    app.currentPage='page-edu-course-lessons';app._teamDetailRequestSeq++;
    app.currentPage='page-team-detail';app._initEduClubDetailSection('a');
    expect(requests).toHaveLength(3);
    requests[2].resolve(plans('new A'));await flush();
    requests[0].resolve(plans('old A'));requests[1].resolve(plans('old B'));await flush();
    expect(document.querySelector('.edu-course-name').textContent).toBe('new A');
  });
  test('A→B→A route ignores old render and listener callbacks',async()=>{
    const {app,requests,studentReads,listeners,plans}=setup();
    app._initEduClubDetailSection('a');app._cleanupEduListeners();app._teamDetailRequestSeq++;
    app._initEduClubDetailSection('b');app._cleanupEduListeners();app._teamDetailRequestSeq++;
    app._initEduClubDetailSection('a');requests[2].resolve(plans('latest A'));await flush();
    requests[1].resolve(plans('old B'));requests[0].resolve(plans('old A'));
    studentReads.forEach(d=>d.resolve([]));listeners[0]({docs:[{id:'stale',data:()=>({})}]});await flush();
    expect(document.querySelector('.edu-course-name').textContent).toBe('latest A');
    expect(app.getEduStudents('a')).toEqual([]);
  });
  test('leaving while course loads cannot write DOM; re-entry can retry',async()=>{
    const {app,requests,studentReads,plans}=setup();app._initEduClubDetailSection('a');
    app._cleanupEduListeners();app.currentPage='page-home';document.body.innerHTML='<p>Home</p>';
    requests[0].resolve(plans('late'));studentReads[0].resolve([]);await flush();
    expect(document.body.textContent).toBe('Home');
  });
  test('changing viewer during read never paints old viewer data',async()=>{
    const {app,ctx,requests,studentReads,plans}=setup();app._initEduClubDetailSection('a');
    ctx.auth.currentUser={uid:'viewer-b'};app._teamDetailRequestSeq++;
    app._initEduClubDetailSection('a');requests[1].resolve(plans('viewer B'));await flush();
    requests[0].resolve(plans('viewer A'));studentReads.forEach(d=>d.resolve([{id:'private-a'}]));await flush();
    expect(document.querySelector('.edu-course-name').textContent).toBe('viewer B');
  });
  test('cold error has retry guidance and a successful empty retry clears old UI',async()=>{
    const {app,requests,studentReads}=setup();app._initEduClubDetailSection('a');
    requests[0].reject(Error('offline'));studentReads[0].resolve([]);await flush();
    expect(document.body.textContent).toContain('課程載入失敗');
    const retry=app.switchEduTab('course');requests[1].resolve([]);await retry;
    expect(document.body.textContent).toContain('尚未建立課程方案');
    expect(document.body.textContent).not.toContain('載入失敗');
  });
});
