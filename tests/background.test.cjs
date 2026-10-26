const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const P = require('../extension/core.js');
const URL_VALUE = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-100029.m4s?upsig=secret';
function setup(fetcher, config = {}, clock) {
  const hooks = {};
  const event = name => ({addListener: fn => {hooks[name] = fn;}});
  const browser = {
    storage: {local: {get: async () => ({config:{mode:"prime",enabled:true,...config}}), set: async () => {}}},
    runtime: {getURL: () => 'moz-extension://unit/', onMessage: event('message')},
    tabs: {sendMessage: async () => {}, query: async () => [], onRemoved: event('removed'), onUpdated: event('updated')},
    webRequest: {onBeforeSendHeaders: event('headers'), onCompleted:event('completed'),onErrorOccurred:event('error'), onResponseStarted: event('response'),
      onBeforeRequest: {addListener(fn, filter) {hooks[filter.urls[0].includes('api.') ? 'api' : 'observe'] = fn;}}}
  };
  const context = {Primer: P, PrimerAdaptive: require("../extension/adaptive.js"), PrimerMeasure: require("../extension/measure.js"), browser, fetch: (...args) => fetcher(hooks, ...args),
    Date:class extends Date {static now(){return clock?clock():Date.now();}},
    AbortController, performance, setTimeout, clearTimeout, URL, Uint8Array, TextDecoder, console};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/background.js'), 'utf8'), context);
  const sender = {tab: {id: 1}, url: 'https://www.bilibili.com/video/BVtest/?p=4'};
  const run = (overrides = {}, from = sender) => hooks.message({type: 'fetch', url: URL_VALUE, range: '0-999', kind: 'prime', token: 'one', ...overrides}, from);
  return {hooks, run, sender};
}
function response(hooks, options = {}) {
  hooks.headers({url: URL_VALUE, originUrl: 'moz-extension://unit/_generated_background_page.html', requestHeaders: []});
  return {status: options.status || 206, headers: new Headers({'Content-Range': options.contentRange || 'bytes 0-999/1000'}),
    body: options.body || new ReadableStream({start(c) {c.enqueue(new Uint8Array(1000)); c.close();}})};
}
test('exact range completes; diagnostics omit signed URL', async () => {
  const s = setup(async hooks => response(hooks));
  const r = await s.run(); assert.equal(r.complete, true); assert.equal(r.bytes, 1000);
  assert.equal(r.headersApplied, true); assert.equal(JSON.stringify(r).includes('secret'), false);
});
test('adaptive cancels at its byte target and applies recovery size/cooldown independently',async()=>{
 const s=setup(async(hooks,url,options)=>response(hooks,{contentRange:'bytes 0-1999999/2000000',body:new ReadableStream({start(c){
  c.enqueue(new Uint8Array(65536));c.enqueue(new Uint8Array(262144));
  options.signal.addEventListener('abort',()=>c.error(new DOMException('Cancelled','AbortError')));
 }})}),{mode:'adaptive',enabled:true});
 const normal=await s.run({range:'0-1999999',durationSeconds:5});
 assert.equal(normal.reason,'byte-cap');assert.equal(normal.adaptive.targetBytes,262144);assert.equal(normal.mode,'adaptive');
 const recovery=await s.run({range:'0-1999999',recovery:true});
 assert.equal(recovery.bytes,65536);assert.equal(recovery.adaptive.deadlineSeconds,1);
 assert.equal((await s.run({range:'0-1999999',recovery:true})).recoveryCooldown,true);
});
test('deadline applies during response-body consumption, not just headers', async () => {
  const s = setup(async (hooks, url, options) => response(hooks, {body: new ReadableStream({start(c) {
    c.enqueue(new Uint8Array(100));
    options.signal.addEventListener('abort', () => c.error(new DOMException('Cancelled', 'AbortError')));
  }})}), {primeSeconds: 0.1});
  const r = await s.run(); assert.equal(r.outcome, 'partial'); assert.equal(r.reason, 'deadline');
  assert.equal(r.bytes, 100); assert.ok(r.seconds < 1);
});
test('403 and wrong ranges never count as successful warming attempts', async () => {
  for (const options of [{status: 403}, {contentRange: 'bytes 4-999/1000'}]) {
    const s = setup(async hooks => response(hooks, options));
    const r = await s.run(); assert.equal(r.outcome, 'failed'); assert.equal(r.bytes, 0);
  }
});
test('seek cancellation is tab/token scoped and lock spans body reading', async () => {
  let started;
  const began = new Promise(resolve => {started = resolve;});
  const s = setup(async (hooks, url, options) => {
    started(); return response(hooks, {body: new ReadableStream({start(c) {
      options.signal.addEventListener('abort', () => c.error(new DOMException('Cancelled', 'AbortError')));
    }})});
  });
  const promise = s.run(); await began;
  assert.equal((await s.run()).busy, true);
  s.hooks.message({type: 'cancel', token: 'one'}, {...s.sender, tab: {id: 2}});
  assert.equal((await s.run()).busy, true);
  s.hooks.message({type: 'cancel', token: 'one'}, s.sender);
  const r = await promise; assert.equal(r.complete, false); assert.equal(r.outcome, 'no-body');
});
test('header rewrite never modifies ordinary player traffic', async () => {
  let resolve;
  const paused = new Promise(r => {resolve = r;});
  const s = setup(async hooks => {await paused; return response(hooks);});
  const p = s.run(); await new Promise(r => setTimeout(r, 0));
  assert.equal(s.hooks.headers({url: URL_VALUE, originUrl: s.sender.url, requestHeaders: []}), undefined);
  resolve(); await p;
});
test('shared byte budget, URL allowlist and expired signatures prevent requests', async () => {
  let calls = 0;
  const s = setup(async hooks => {calls++; return response(hooks);}, {budgetMiB: 1,maxPrimeMiB:1});
  assert.equal((await s.run({range: '0-1048575'})).budget, true);
  assert.ok((await s.run({url: 'https://example.com/file'})).error);
  assert.ok((await s.run({url: URL_VALUE + '&deadline=1'})).error);
  assert.equal(calls, 0);
});
test('observation mode never issues extension media requests',async()=>{
 let calls=0;const s=setup(async()=>{calls++;},{mode:'observe',enabled:true});
 const r=await s.run();assert.ok(r.error);assert.equal(calls,0);
});
test('player downloads preempt an active prime and block new ones until complete',async()=>{
 let began;const started=new Promise(r=>{began=r;});
 const s=setup(async(hooks,url,options)=>{began();return response(hooks,{body:new ReadableStream({start(c){
  c.enqueue(new Uint8Array(50));options.signal.addEventListener('abort',()=>c.error(new DOMException('Cancelled','AbortError')));
 }})});});
 const running=s.run();await started;
 const d={requestId:'foreground',tabId:1,url:URL_VALUE,timeStamp:Date.now(),originUrl:s.sender.url};
 s.hooks.observe(d);const result=await running;assert.equal(result.reason,'player-priority');
 assert.equal((await s.run()).playerBusy,true);
 s.hooks.completed({...d,timeStamp:Date.now(),statusCode:206});
 assert.equal(result.complete,false);
});
test('other tabs neither block admission nor preempt this tab prime',async()=>{
 let begin;const started=new Promise(r=>{begin=r;});
 const s=setup(async(hooks,url,options)=>{begin();return response(hooks,{body:new ReadableStream({start(c){
  options.signal.addEventListener('abort',()=>c.error(new DOMException('Cancelled','AbortError')));
 }})});});
 const other={requestId:'other',tabId:2,url:URL_VALUE,timeStamp:Date.now(),originUrl:s.sender.url};
 s.hooks.observe(other);const running=s.run();await started;
 s.hooks.observe({...other,requestId:'other2'});
 s.hooks.message({type:'cancel',token:'one'},s.sender);
 const result=await running;assert.notEqual(result.reason,'player-priority');
});
test('starved adaptive probe needs opt-in and waiting; duplicate player range cancels it and cooldown holds',async()=>{
 let now=10000,begin;const started=new Promise(r=>{begin=r;});
 const s=setup(async(hooks,url,options)=>{begin();return response(hooks,{body:new ReadableStream({start(c){
  c.enqueue(new Uint8Array(50));options.signal.addEventListener('abort',()=>c.error(new DOMException('Cancelled','AbortError')));
 }})});},{mode:'adaptive',adaptiveConcurrency:true},()=>now);
 const d={requestId:'player',tabId:1,url:URL_VALUE,timeStamp:now,originUrl:s.sender.url};s.hooks.observe(d);
 s.hooks.headers({...d,requestHeaders:[{name:'Range',value:'bytes=5000-5999'}]});
 const blocked=await s.run();assert.equal(blocked.playerBusy,true);assert.equal(blocked.scheduler.blockers[0].id,'player');
 now=20000;assert.equal((await s.run({range:'5000-5999'})).scheduler.reason,'player-range-overlap');
 const running=s.run();await started;
 const next={...d,requestId:'next',timeStamp:now};s.hooks.observe(next);
 s.hooks.headers({...next,requestHeaders:[{name:'Range',value:'bytes=2000-2999'}]});
 assert.equal((await s.run()).busy,true);
 s.hooks.headers({...next,requestHeaders:[{name:'Range',value:'bytes=0-999'}]});
 const result=await running;assert.equal(result.concurrent,true);assert.equal(result.reason,'player-range-overlap');
 assert.equal(result.adaptive.deadlineSeconds,3);assert.ok(result.adaptive.targetBytes<=262144);
 assert.equal((await s.run()).scheduler.reason,'cooldown');
});
test('stale missing player completion expires without requiring a new player request',async()=>{
 let now=10000;const s=setup(async hooks=>response(hooks),{},()=>now);
 s.hooks.observe({requestId:'lost',tabId:1,url:URL_VALUE,timeStamp:now,originUrl:s.sender.url});
 assert.equal((await s.run()).playerBusy,true);now+=120001;
 assert.equal((await s.run()).complete,true);
});
