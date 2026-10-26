const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../extension/core.js');
const {Controller}=require('../extension/adaptive.js');
const {Scheduler}=require('../extension/adaptive.js');
const config=P.settings({mode:'adaptive',enabled:true});
const host='upos-sz-mirrorcosov.bilivideo.com',path='/upgcxcode/1/2/3/3-1-100029.m4s';
function sample(c,id,changes={},primeChanges={}) {
 const prime={startMs:id*100,endMs:id*100+10,host,path,tab:1,mode:'adaptive',recovery:false,
  range:{lo:0,hi:999},bytes:100,outcome:'partial',durationSeconds:5,remoteIP:'92.223.84.84',...primeChanges};
 const r={startMs:prime.endMs+10000,endMs:prime.endMs+11000,host,path,tab:1,mode:'adaptive',
  range:{lo:0,hi:999},fromBrowserCache:false,primeOverlapMs:0,remoteIP:'92.223.84.84',
  complete:true,status:206,totalMs:1000,firstByteAfterMs:50,...changes};
 c.feedback(r,[prime],config);return {r,prime};
}
test('adaptive is opt-in and policy stays within byte/time/lead caps',()=>{
 assert.equal(P.settings().mode,'observe');assert.equal(config.mode,'adaptive');
 const c=new Controller();assert.equal(c.policy(host,path,config).targetBytes,262144);
 const v=c.policy(host,path,P.settings({...config,adaptiveMaxPrimeMiB:0.0625,adaptiveMaxLeadSeconds:20}),true);
 assert.equal(v.targetBytes,65536);assert.equal(v.deadlineSeconds,1);assert.equal(v.leadSeconds,20);
 assert.equal(c.allowRecovery(host,path,1000),true);assert.equal(c.allowRecovery(host,path,15999),false);assert.equal(c.allowRecovery(host,path,16000),true);
});
test('feedback excludes route changes, browser cache, concurrency, recovery and unrelated ranges',()=>{
 const c=new Controller();
 for(const change of [{complete:false},{status:403},{remoteIP:'other'},{fromBrowserCache:true},{primeOverlapMs:1},{tab:2},{range:{lo:1000,hi:1999}}])sample(c,1,change);
 sample(c,1,{}, {recovery:true});sample(c,1,{}, {mode:'prime'});
 assert.equal(c.policy(host,path,config).samples,0);
 const {r,prime}=sample(c,2);c.feedback(r,[prime],config);
 assert.equal(c.policy(host,path,config).samples,1);
});
test('repeated feedback changes only one control at a time; estimates are stream scoped',()=>{
 const c=new Controller();
 for(let i=1;i<=3;i++)sample(c,i,{totalMs:4000});
 let policy=c.policy(host,path,config);assert.equal(policy.targetBytes,1048576);assert.equal(policy.leadSeconds,21);
 for(let i=4;i<=6;i++)sample(c,i,{totalMs:4000,firstByteAfterMs:900});
 policy=c.policy(host,path,config);assert.equal(policy.targetBytes,1048576);assert.equal(policy.leadSeconds,25);
 for(let i=7;i<=12;i++)sample(c,i);
 assert.equal(c.policy(host,path,config).targetBytes,262144);
 assert.equal(c.policy(host,path+'new',config).samples,0);
});
test('no-body requests never count as successful warming and preemptions do not train estimates',()=>{
 const c=new Controller();const r={host,path,mode:'adaptive',bytes:0,reason:'deadline'};
 c.prime(r,true);c.prime({...r,reason:'player-priority'});assert.equal(c.policy(host,path,config).leadSeconds,21);
 for(let i=0;i<3;i++)c.prime(r);
 assert.equal(c.policy(host,path,config).leadSeconds,25);assert.equal(c.policy(host,path,config).samples,0);
});
test('scheduler requires opt-in, sustained waiting and cooldown; tabs do not share waiting state',()=>{
 const s=new Scheduler(), blockers=[{id:'a',ageMs:500}];
 assert.equal(s.evaluate(1,blockers,config,1000).allowed,false);
 assert.equal(s.evaluate(1,blockers,config,99999).allowed,false);
 s.reset();const on={...config,adaptiveConcurrency:true};
 assert.equal(s.evaluate(1,blockers,on,1000).reason,'waiting');
 assert.equal(s.evaluate(1,blockers,on,10999).allowed,false);
 assert.equal(s.evaluate(1,blockers,on,11000).concurrent,true);
 s.admit(1,11000);assert.equal(s.evaluate(1,blockers,on,11001).reason,'cooldown');
 assert.equal(s.evaluate(1,blockers,on,41000).allowed,true);
 assert.equal(s.evaluate(2,blockers,on,41000).allowed,false);
 assert.equal(s.evaluate(1,[],on,42000).reason,'idle');
 assert.equal(s.evaluate(1,blockers,on,42001).reason,'waiting');
 s.remove(1);assert.equal(s.tabs.has(1),false);
});
