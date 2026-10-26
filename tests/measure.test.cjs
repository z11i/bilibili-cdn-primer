const {test}=require('node:test');const assert=require('node:assert/strict');
const P=require('../extension/core.js');global.Primer=P;
const {PlayerTracker,PlaybackTracker}=require('../extension/measure.js');
const url='https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-100029.m4s?upsig=never-export';
const start={requestId:'p',url,tabId:7,timeStamp:1000};
const headers=[{name:'Content-Range',value:'bytes 100-1099/2000'},{name:'Content-Length',value:'1000'},{name:'Cache',value:'HIT'}];
test('player measurements retain timings and header evidence but no signed URLs or cookies',()=>{
 const m=new PlayerTracker();m.start(start,'observe');m.requestHeaders({...start,requestHeaders:[{name:'Range',value:'bytes=100-1099'},{name:'Cookie',value:'private'}]});
 m.response({...start,timeStamp:1100,statusCode:206,fromCache:false,responseHeaders:headers});
 const r=m.finish({requestId:'p',timeStamp:2000,statusCode:206});
 assert.equal(r.firstByteAfterMs,100);assert.equal(r.totalMs,1000);assert.equal(r.completedBytesEstimate,1000);assert.equal(r.endToEndMbpsEstimate,.008);
 assert.equal(r.bytesEvidence,'response-headers');assert.ok(!JSON.stringify(r).includes('never-export'));assert.ok(!JSON.stringify(r).includes('private'));
});
test('aborted bytes and cached network throughput remain unknown',()=>{
 const m=new PlayerTracker();m.start(start,'prime');m.response({...start,timeStamp:1100,statusCode:206,responseHeaders:headers});
 const aborted=m.finish({requestId:'p',timeStamp:1200,error:'NS_BINDING_ABORTED'});
 assert.equal(aborted.completedBytesEstimate,null);assert.equal(aborted.endToEndMbpsEstimate,null);
 m.start(start,'prime');m.response({...start,timeStamp:1100,statusCode:206,fromCache:true,responseHeaders:headers});
 assert.equal(m.finish({requestId:'p',timeStamp:1200}).endToEndMbpsEstimate,null);
});
test('correlation requires same CDN resource and overlapping byte ranges; no-body primes do not qualify',()=>{
 const m=new PlayerTracker(),u=new URL(url);const prime={startMs:100,endMs:500,host:u.hostname,path:u.pathname,range:{lo:100,hi:1099},bytes:50,outcome:'partial'};
 m.prime(prime);m.prime({...prime,bytes:0});m.prime({...prime,host:'other'});m.start(start,'prime');m.requestHeaders({...start,requestHeaders:[{name:'Range',value:'bytes=500-999'}]});
 const r=m.finish({requestId:'p',timeStamp:1500});assert.equal(r.priorPrimes.length,1);assert.equal(r.priorPrimes[0].leadMs,500);
});
test('overlap captures unfinished priming; missing completion cannot retain an infinite busy state',()=>{
 const m=new PlayerTracker();m.prime({startMs:900,endMs:null,bytes:0});m.start(start,'prime');
 assert.equal(m.finish({requestId:'p',timeStamp:1200}).primeOverlapMs,200);
 m.start(start,'prime');m.start({...start,requestId:'next',timeStamp:122000},'prime');assert.equal(m.inflight.size,1);
});
test('playback stall intervals distinguish startup, seek, and paused conditions',()=>{
 const m=new PlaybackTracker();const state={atMs:0,position:0,paused:false,seeking:false,readyState:2};
 m.add('waiting',state);assert.equal(m.active.kind,'startup');m.add('playing',{...state,atMs:1000});assert.equal(m.stalls,0);
 m.add('waiting',{...state,atMs:3000});m.add('waiting',{...state,atMs:3500});
 const events=m.add('playing',{...state,atMs:5000});assert.equal(events[1].durationMs,2000);assert.equal(m.summary().stalls,1);
 m.add('seeking',{...state,atMs:6000});m.add('waiting',{...state,atMs:6100});assert.equal(m.active.kind,'seek');m.add('playing',{...state,atMs:7000});assert.equal(m.stalls,1);
 m.add('waiting',{...state,atMs:8000,paused:true});assert.equal(m.active,null);
 m.add('stalled',{...state,atMs:9000,readyState:4});assert.equal(m.active,null);
});
test('upgrade starts observation-only and reduces old aggressive probe settings',()=>{
 const cfg=P.migrateSettings({enabled:true,primeSeconds:2,maxPrimeMiB:4,budgetMiB:32});
 assert.equal(cfg.mode,'observe');assert.equal(cfg.enabled,false);assert.equal(cfg.primeSeconds,.35);assert.equal(cfg.maxPrimeMiB,.25);
 assert.equal(P.settings().mode,'observe');assert.equal(P.migrateSettings({mode:'prime',enabled:true}).enabled,true);
});
