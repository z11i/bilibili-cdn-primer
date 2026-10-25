const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const P = require('../extension/core.js');
const URL_VALUE = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-100029.m4s?upsig=secret';
function setup(fetcher, config = {}) {
  const hooks = {};
  const event = name => ({addListener: fn => {hooks[name] = fn;}});
  const browser = {
    storage: {local: {get: async () => ({config}), set: async () => {}}},
    runtime: {getURL: () => 'moz-extension://unit/', onMessage: event('message')},
    tabs: {sendMessage: async () => {}, query: async () => [], onRemoved: event('removed'), onUpdated: event('updated')},
    webRequest: {onBeforeSendHeaders: event('headers'), onResponseStarted: event('response'),
      onBeforeRequest: {addListener(fn, filter) {hooks[filter.urls[0].includes('api.') ? 'api' : 'observe'] = fn;}}}
  };
  const context = {Primer: P, browser, fetch: (...args) => fetcher(hooks, ...args),
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
  const s = setup(async hooks => {calls++; return response(hooks);}, {budgetMiB: 1});
  assert.equal((await s.run({range: '0-1048575'})).budget, true);
  assert.ok((await s.run({url: 'https://example.com/file'})).error);
  assert.ok((await s.run({url: URL_VALUE + '&deadline=1'})).error);
  assert.equal(calls, 0);
});
