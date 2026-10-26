/* Local-only measurements; no media bodies or signed query strings retained. */
(() => {
 'use strict';
 const push=(a,v,n=1000)=>{a.push(v);if(a.length>n)a.shift();};
 const header=(hs,n)=>hs?.find(h=>h.name.toLowerCase()===n)?.value||null;
 const bytesRange=v=>{const m=/^(?:bytes=|bytes )(\d+)-(\d+)(?:\/(?:\d+|\*))?$/.exec(v||'');if(!m)return null;const lo=+m[1],hi=+m[2];return Number.isSafeInteger(lo)&&Number.isSafeInteger(hi)&&hi>=lo?{lo,hi}:null;};
 class PlayerTracker {
  constructor(){this.inflight=new Map();this.requests=[];this.primes=[];this.stats={};}
  start(d,mode){const u=Primer.mediaURL(d.url);if(!u)return;
   this.inflight.set(d.requestId,{id:d.requestId,tab:d.tabId,startMs:d.timeStamp,host:u.hostname,path:u.pathname,mode,range:null,responseRange:null,headerBodyBytes:null,firstByteMs:null});
   for(const [id,r] of this.inflight)if(d.timeStamp-r.startMs>120000)this.finish({requestId:id,timeStamp:d.timeStamp,error:'measurement-timeout'});
  }
  requestHeaders(d){const r=this.inflight.get(d.requestId);if(r)r.range=bytesRange(header(d.requestHeaders,'range'));}
  response(d){const r=this.inflight.get(d.requestId);if(!r)return;
   r.firstByteMs=d.timeStamp;r.status=d.statusCode;r.remoteIP=d.ip||null;r.fromBrowserCache=typeof d.fromCache==='boolean'?d.fromCache:null;
   r.responseRange=bytesRange(header(d.responseHeaders,'content-range'));
   const n=Number(header(d.responseHeaders,'content-length'));r.headerBodyBytes=n>0&&Number.isSafeInteger(n)?n:r.responseRange?r.responseRange.hi-r.responseRange.lo+1:null;
   r.cacheHeaders={};for(const name of ['cache','x-cache','x-cache-lookup','eo-cache-status']){const v=header(d.responseHeaders,name);if(v)r.cacheHeaders[name]=v.slice(0,200);}
  }
  prime(v){push(this.primes,v);}
  finish(d){const r=this.inflight.get(d.requestId);if(!r)return null;this.inflight.delete(d.requestId);
   r.endMs=d.timeStamp;r.totalMs=Math.max(0,r.endMs-r.startMs);r.error=d.error||null;r.status=d.statusCode||r.status||0;r.complete=!r.error;
   r.firstByteAfterMs=r.firstByteMs===null?null:Math.max(0,r.firstByteMs-r.startMs);r.completedBytesEstimate=r.complete?r.headerBodyBytes:null;
   r.bytesEvidence=r.completedBytesEstimate===null?'unknown':'response-headers';
   r.endToEndMbpsEstimate=r.complete&&r.fromBrowserCache===false&&r.completedBytesEstimate&&r.totalMs>0?r.completedBytesEstimate*8/r.totalMs/1000:null;
   r.primeOverlapMs=0;r.priorPrimes=[];
   for(const p of this.primes){r.primeOverlapMs+=Math.max(0,Math.min(p.endMs??r.endMs,r.endMs)-Math.max(p.startMs,r.startMs));const requested=r.range||r.responseRange;
    if(p.endMs!==null&&p.endMs<=r.startMs&&p.host===r.host&&p.path===r.path&&requested&&p.range&&p.bytes>0&&p.range.lo<=requested.hi&&p.range.hi>=requested.lo)
     r.priorPrimes.push({endMs:p.endMs,leadMs:r.startMs-p.endMs,requestedRange:p.range,receivedBytes:p.bytes,outcome:p.outcome});
   }
   r.priorPrimes=r.priorPrimes.slice(-12);const s=this.stats[r.tab]||(this.stats[r.tab]={completed:0,failed:0,overlapping:0,precededByPrime:0});
   s[r.complete?'completed':'failed']++;if(r.primeOverlapMs>0)s.overlapping++;if(r.priorPrimes.length)s.precededByPrime++;push(this.requests,r);return r;
  }
  blockers(tab,now=Date.now()){
   for(const [id,r] of this.inflight)if(now-r.startMs>120000)this.finish({requestId:id,timeStamp:now,error:'measurement-timeout'});
   return [...this.inflight.values()].filter(r=>r.tab===tab).map(r=>({id:r.id,host:r.host,path:r.path,range:r.range,ageMs:Math.max(0,now-r.startMs)}));
  }
  busy(tab){return tab===undefined?this.inflight.size>0:this.blockers(tab).length>0;}
  removeTab(tab){for(const [id,r] of this.inflight)if(r.tab===tab)this.inflight.delete(id);}
 }
 class PlaybackTracker {
  constructor(){this.active=null;this.started=false;this.lastSeekMs=-Infinity;this.stalls=0;this.stallMs=0;}
  add(event,state){
   const out=[{event,...state}];
   if(['playing','pause','seeking','ended','media-change','pagehide'].includes(event)&&this.active){
    const durationMs=Math.max(0,state.atMs-this.active.startMs);
    out.push({event:'stall-end',...state,kind:this.active.kind,startMs:this.active.startMs,durationMs,endedBy:event});
    if(this.active.kind==='playback'){this.stalls++;this.stallMs+=durationMs;}
    this.active=null;
   }
   if(event==='seeking')this.lastSeekMs=state.atMs;
   if(event==='media-change')this.started=false;
   if(event==='playing')this.started=true;
   if((event==='waiting'||(event==='stalled'&&state.readyState<3))&&!state.paused&&!this.active){
    const kind=state.seeking||state.atMs-this.lastSeekMs<1000?'seek':this.started?'playback':'startup';
    this.active={startMs:state.atMs,position:state.position,kind};out.push({event:'stall-start',...state,kind});
   }
   return out;
  }
  summary(){return {stalls:this.stalls,stallSeconds:this.stallMs/1000,activeStall:this.active};}
 }
 const api={PlayerTracker,PlaybackTracker,bytesRange};globalThis.PrimerMeasure=api;if(typeof module!=='undefined')module.exports=api;
})();
