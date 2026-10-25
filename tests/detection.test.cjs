const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const P=require('../extension/core.js');
const {sidx}=require('./fixtures.cjs');
function harness() {
 let now=10000,timer,listener;
 const sent=[];
 const base='https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-100029.m4s';
 const info={data:{dash:{video:[{id:120,codecs:'av01',baseUrl:base+'?deadline=1',SegmentBase:{indexRange:'0-6031'}}]}}};
 const video={currentTime:100,paused:true,readyState:4,playbackRate:1,ended:false,clientWidth:100,clientHeight:100,buffered:{length:0},addEventListener(){},removeEventListener(){}};
 const bin=sidx({count:500});
 const c={Primer:P,URL,Uint8Array,Date:class extends Date {static now(){return now;}},performance:{now:()=>now},
  location:{href:'https://www.bilibili.com/video/BVtest/',origin:'https://www.bilibili.com',pathname:'/video/BVtest/'},
  window:{wrappedJSObject:{__playinfo__:info},addEventListener(){}},
  document:{hidden:false,querySelectorAll:()=>[video],addEventListener(){}},setInterval:f=>{timer=f;},
  browser:{runtime:{onMessage:{addListener:f=>{listener=f;}},sendMessage:async msg=>{
   sent.push(msg);
   if(msg.type==='init')return {config:P.settings()};
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
 return {sent,tick,observe:u=>listener({type:'observed',url:u}),metadata:(url,page)=>listener({type:'playinfo',page,reps:[{url,index:'0-6031',quality:120,codec:'av01'}]}),base};
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
