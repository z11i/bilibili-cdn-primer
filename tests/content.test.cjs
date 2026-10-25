const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const P = require('../extension/core.js');
test('seek aborts old generation; stale initial playinfo cannot restore old part', async () => {
  const url = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/98/10/123456789/123456789-1-100029.m4s?sig=fixture';
  const bin = require('./fixtures.cjs').sidx({count: 500});
  let timer, listener, now = 10000, finishPrime;
  const sent = [], handlers = {};
  const video = {currentTime: 1800, paused: true, readyState: 4, playbackRate: 1, ended: false,
    clientWidth: 1000, clientHeight: 700, buffered: {length: 0},
    addEventListener: (e, f) => {handlers[e] = f;}, removeEventListener: () => {}};
  const info = {data: {dash: {video: [{id: 120, codecs: 'av01', baseUrl: url, SegmentBase: {indexRange: `0-${bin.length - 1}`}}]}}};
  const context = {
    Primer: P, URL, Uint8Array, performance: {now: () => now}, Date: class extends Date {static now() {return now;}},
    location: {href: 'https://www.bilibili.com/video/BVtest/?p=4', origin: 'https://www.bilibili.com', pathname: '/video/BVtest/'},
    window: {wrappedJSObject: {__playinfo__: info}, addEventListener() {}},
    document: {hidden: false, querySelectorAll: () => [video], addEventListener() {}},
    setInterval: f => {timer = f;},
    browser: {runtime: {onMessage: {addListener: f => {listener = f;}}, sendMessage: async msg => {
      sent.push(msg);
      if (msg.type === 'init') return {config: P.settings()};
      if (msg.type === 'fetch' && msg.kind === 'index') return {complete: true, headersApplied: true, data: [...bin]};
      if (msg.type === 'fetch') return new Promise(resolve => {finishPrime = resolve;});
      return {};
    }}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/content.js'), 'utf8'), context);
  const flush = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
  await flush(); listener({type: 'observed', url});
  timer(); await flush(); now += 2000; timer(); await flush();
  assert.equal(sent.filter(v => v.type === 'fetch' && v.kind === 'prime').length, 1);
  handlers.seeking(); await flush();
  assert.ok(sent.some(v => v.type === 'cancel'));
  finishPrime({bytes: 100, outcome: 'partial', status: 206, headersApplied: true}); await flush();
  video.currentTime = 2000; now += 2000; timer(); await flush();
  assert.equal(sent.filter(v => v.type === 'fetch' && v.kind === 'prime').length, 2);
  // New video request before its metadata arrives. Global still points to old video.
  listener({type: 'observed', url: url.replaceAll('123456789', '99999999999')});
  finishPrime({bytes: 10, outcome: 'partial', status: 206, headersApplied: true}); await flush();
  now += 2000; timer(); await flush();
  const latest = sent.filter(v => v.type === 'summary').at(-1).value;
  assert.equal(latest.host, null);
  assert.equal(sent.filter(v => v.type === 'fetch' && v.kind === 'prime').length, 2);
});
