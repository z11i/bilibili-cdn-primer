const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const P=require('../extension/core.js');
const {sidx}=require('./fixtures.cjs');
function harness(mode="prime") {
 let now=10000,timer,listener;
 const sent=[];
 const base='https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-100029.m4s';
 const info={data:{dash:{video:[{id:120,codecs:'av01',baseUrl:base+'?deadline=1',SegmentBase:{indexRange:'0-6031'}}]}}};
 const video={currentTime:100,paused:true,readyState:4,playbackRate:1,ended:false,clientWidth:100,clientHeight:100,buffered:{length:0},addEventListener(){},removeEventListener(){}};
 const bin=sidx({count:500});
 const c={Primer:P,PrimerMeasure:require("../extension/measure.js"),URL,Uint8Array,Date:class extends Date {static now(){return now;}},performance:{now:()=>now},
  location:{href:'https://www.bilibili.com/video/BVtest/',origin:'https://www.bilibili.com',pathname:'/video/BVtest/'},
  window:{wrappedJSObject:{__playinfo__:info},addEventListener(){}},
  document:{hidden:false,querySelectorAll:()=>[video],addEventListener(){}},setInterval:f=>{timer=f;},
  browser:{runtime:{onMessage:{addListener:f=>{listener=f;}},sendMessage:async msg=>{
   sent.push(msg);
   if(msg.type==='init')return {config:P.settings({mode,enabled:mode!=="observe"})};
   if(msg.type==='policy')return {targetBytes:65536,deadlineSeconds:1,leadSeconds:20,recovery:msg.recovery,reason:'initial',samples:0};
   if(msg.type==='fetch') {
    if(P.deadline(msg.url)===1)return {errorCode:'expired',error:'Signed URL expired or expiring; refresh the video'};
    if(msg.kind==='index')return {complete:true,headersApplied:true,data:[...bin]};
    return {bytes:100,status:206,headersApplied:true,outcome:'partial',complete:false};
   }
   return {};
  }}}
 };
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/content.js'),'utf8'),c);
 async function tick(){now+=2000;timer();for(let i=0;i<20;i++)await Promise.resolve();}
 return {sent,tick,video,observe:u=>listener({type:'observed',url:u}),metadata:(url,page,index='0-6031')=>listener({type:'playinfo',page,reps:[{url,index,quality:120,codec:'av01'}]}),base};
}
test('expired signatures stop retrying and a newly observed signature resumes priming',async()=>{
 const h=harness();h.observe(h.base+'?deadline=1');await h.tick();await h.tick();
 for(let i=0;i<10;i++)await h.tick();
 assert.equal(h.sent.filter(m=>m.type==='fetch').length,1);
 assert.match(h.sent.filter(m=>m.type==='summary').at(-1).value.notice,/expired/);
 h.observe(h.base+'?deadline=9999999999');await h.tick();await h.tick();
 assert.ok(h.sent.some(m=>m.type==='fetch'&&m.kind==='prime'));
});
test('an API response across an SPA URL change matches by current media identity',async()=>{
 const h=harness();h.observe(h.base+'?deadline=1');await h.tick();await h.tick();
 h.metadata(h.base+'?deadline=9999999999','https://www.bilibili.com/video/BVtest/?p=previous');
 await h.tick();await h.tick();
 assert.ok(h.sent.some(m=>m.type==='fetch'&&m.kind==='prime'&&m.url.endsWith('deadline=9999999999')));
});

test('observation captures playback samples without fetching even an index',async()=>{
 const h=harness("observe");h.observe(h.base+'?deadline=9999999999');await h.tick();await h.tick();
 assert.equal(h.sent.filter(m=>m.type==='fetch').length,0);
 assert.ok(h.sent.some(m=>m.type==='playback'&&m.value.event==='sample'));
});
test('adaptive low-buffer state schedules nearby recovery work instead of blocking indefinitely',async()=>{
 const h=harness('adaptive');h.video.paused=false;h.video.readyState=2;
 h.observe(h.base+'?deadline=9999999999');for(let i=0;i<4;i++)await h.tick();
 const primes=h.sent.filter(m=>m.type==='fetch'&&m.kind==='prime');
 assert.ok(primes.length>0);assert.ok(primes.every(m=>m.recovery&&m.durationSeconds>0));
 const s=h.sent.filter(m=>m.type==='summary').at(-1).value;
 assert.equal(s.adaptive.recovery,true);assert.ok(s.window.from>=h.video.currentTime-0.15);
});

test('CDN failover retains the same resource index; different resources and index ranges invalidate it',async()=>{
 const h=harness('adaptive'), fresh=h.base+'?deadline=9999999999';
 h.observe(fresh);for(let i=0;i<3;i++)await h.tick();
 const initial=h.sent.filter(m=>m.type==='fetch'&&m.kind==='index').length;assert.equal(initial,1);
 const mirror=fresh.replace('upos-sz-mirrorcosov.bilivideo.com','upos-hz-mirrorakam.akamaized.net');
 h.observe(mirror);for(let i=0;i<3;i++)await h.tick();
 assert.equal(h.sent.filter(m=>m.type==='fetch'&&m.kind==='index').length,initial);
 assert.ok(h.sent.some(m=>m.type==='fetch'&&m.kind==='prime'&&m.url===mirror));
 const changed=mirror.replace('/3-1-100029.m4s','/4-1-100029.m4s');
 h.metadata(changed);h.observe(changed);for(let i=0;i<3;i++)await h.tick();
 assert.equal(h.sent.filter(m=>m.type==='fetch'&&m.kind==='index').length,initial+1);
 const other=changed.replace('upos-hz-mirrorakam.akamaized.net','upos-sz-mirrorcosov.bilivideo.com');
 h.metadata(other,undefined,'0-7031');h.observe(other);for(let i=0;i<3;i++)await h.tick();
 assert.equal(h.sent.filter(m=>m.type==='fetch'&&m.kind==='index').length,initial+2);
 h.metadata(other,undefined,'0-8031');h.observe(other);for(let i=0;i<3;i++)await h.tick();
 assert.equal(h.sent.filter(m=>m.type==='fetch'&&m.kind==='index').length,initial+3);
});
