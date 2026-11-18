import { buildClockCorrection, clockEditBasis } from '../src/engine/match-clock.js';
import { elapsedSec } from '../src/engine/clock.js';
import { buildFinishPatch } from '../src/engine/live-actions.js';
const match={status:'live',period:'h1',clock:{running:true,periodStartedAt:new Date(1000),elapsedSecAtPause:10}};
test('CLOCK-ADDED division lengths, exact seconds, backward corrections and running restart',()=>{
  for(const duration of [25,30]){
    const division={periods:1,matchDurationMin:duration};
    const c=buildClockCorrection({match,division,seconds:duration*60+150,nowMs:10000});
    expect(c.addedTimeSec).toBe(150);expect(elapsedSec(c,15000)).toBe(duration*60+155);
    expect(buildClockCorrection({match:{...match,clock:c},division,seconds:60,nowMs:20000}).addedTimeSec).toBe(0);
  }
});
test('CLOCK-FINAL finished correction remains stopped and keeps score/lock/period untouched',()=>{
  const m={...match,status:'confirmed',period:'ft',lock:{locked:true},score:{home:1,away:0}};
  const c=buildClockCorrection({match:m,division:{periods:1,matchDurationMin:25},seconds:1650,nowMs:10000});
  expect(c).toMatchObject({running:false,periodStartedAt:null,elapsedSecAtPause:1650,addedTimeSec:150,periodId:'h1'});
  expect(elapsedSec(c,20000)).toBe(1650);expect(m.status).toBe('confirmed');
  expect(clockEditBasis({...m,clock:c}).running).toBe(false);
});
test('CLOCK-FINISH retains edited time on final submission',()=>{
 const p=buildFinishPatch({score:{home:1,away:0},events:[],uid:'s',matchDurationMin:25,periods:1,clock:{running:false,elapsedSecAtPause:1650,periodId:'h1'}});
 expect(p.clock).toMatchObject({elapsedSecAtPause:1650,addedTimeSec:150,running:false,periodId:'h1'});
});
test('CLOCK-VALIDATE negative/fractional times and unstarted matches cannot be corrected',()=>{
 for(const seconds of [-1,1.5,86401])expect(()=>buildClockCorrection({match,division:{periods:1,matchDurationMin:25},seconds,nowMs:0})).toThrow();
 expect(()=>buildClockCorrection({match:{...match,status:'scheduled'},division:{periods:1,matchDurationMin:25},seconds:5,nowMs:0})).toThrow();
});
