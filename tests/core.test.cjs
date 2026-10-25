const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../extension/core.js');
test('SIDX v0/v1 reference offsets and presentation times', () => {
  const make = require('./fixtures.cjs').sidx;
  for (const version of [0,1]) {
    const bin = make({count:3,version,firstOffset:17,earliest:1000});
    const rows = P.sidx(bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength),979);
    assert.equal(rows.length,3);
    assert.deepEqual(rows.map(r=>[r.start,r.end]),[[1,6],[6,11],[11,16]]);
    assert.equal(rows[0].lo,979+bin.length+17);
    assert.equal(rows[0].hi,rows[0].lo+999999);
    assert.equal(rows[1].lo,rows[0].hi+1);
  }
});
test('SIDX rejects malformed and nested references', () => {
  assert.throws(() => P.sidx(new ArrayBuffer(3), 0));
  const b = new ArrayBuffer(44), d = new DataView(b);
  d.setUint32(0, 44); new Uint8Array(b, 4, 4).set([...Buffer.from('sidx')]);
  d.setUint32(16, 1000); d.setUint16(30, 1); d.setUint32(32, 0x80000001); d.setUint32(36, 1000);
  assert.throws(() => P.sidx(b, 0), /reference/);
});
test('moving window excludes player buffer and scales wall-clock lead at 2x', () => {
  const rows = Array.from({length: 100}, (_, i) => ({start: i * 5, end: i * 5 + 5}));
  const cfg = P.settings();
  assert.deepEqual(P.plan(rows, 100, 120, 1, cfg).segments.map(s => s.start), [140,145,150,155,160,165,170,175]);
  const p = P.plan(rows, 100, 120, 2, cfg);
  assert.equal(p.from, 160); assert.equal(p.to, 200);
  assert.equal(P.plan(rows, 100, 250, 1, cfg).segments.length, 0);
});
test('minimum lead covers prime, settle and delivery margins', () => {
  assert.equal(P.plan([], 100, 100, 2, P.settings({leadSeconds: 0})).from, 130);
});
test('input restrictions reject arbitrary URLs, unsafe integers and invalid settings', () => {
  for (const url of ['https://example.com/upgcxcode/1/2/a.m4s', 'https://evilbilivideo.com/upgcxcode/1/2/a.m4s', 'http://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/a.m4s', 'https://upos-sz-mirrorcosov.bilivideo.com:8888/upgcxcode/1/2/a.m4s']) assert.equal(P.mediaURL(url), null);
  assert.ok(P.mediaURL('https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-100029.m4s'));
  assert.throws(() => P.range('0-9007199254740993'));
  assert.throws(() => P.range('9-2'));
  assert.throws(() => P.settings({primeSeconds: -1}));
});
test('only recognized video IDs qualify for header probing; audio never does', () => {
 const base='https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-';
 assert.ok(P.videoURL(base+'100029.m4s'));
 assert.ok(P.videoURL(base+'30080.m4s'));
 assert.equal(P.videoURL(base+'30280.m4s'),null);
 assert.equal(P.videoURL(base+'30232.m4s'),null);
});
test('fresh metadata signatures replace old observed signatures only for the exact same resource', () => {
 const base='https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/2/3/3-1-100029.m4s';
 assert.equal(P.freshURL(base+'?deadline=1',base+'?deadline=9'),base+'?deadline=9');
 assert.equal(P.freshURL(base+'?deadline=9',base+'?deadline=1'),base+'?deadline=9');
 assert.equal(P.freshURL(base+'?deadline=1',base.replace('mirrorcosov','other')+'?deadline=9'),base+'?deadline=1');
 assert.equal(P.deadline(base+'?deadline=invalid'),null);
});
test('header probes find SIDX after initialization boxes and ignore following media bytes',()=>{
 const index=require('./fixtures.cjs').sidx({count:3});
 const header=Buffer.alloc(40);header.writeUInt32BE(16,0);header.write('ftyp',4);header.writeUInt32BE(24,16);header.write('moov',20);
 const probe=Buffer.concat([header,index,Buffer.alloc(65536-header.length-index.length)]);
 const rows=P.sidx(probe.buffer.slice(probe.byteOffset,probe.byteOffset+probe.length),0);
 assert.equal(rows[0].lo,40+index.length);
 assert.equal(rows[2].end,15);
});
