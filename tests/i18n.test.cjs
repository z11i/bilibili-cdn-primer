const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../extension/i18n.js');
const root=path.resolve(__dirname,'../extension');
const zh=JSON.parse(fs.readFileSync(path.join(root,'_locales/zh_CN/messages.json')));
const en=JSON.parse(fs.readFileSync(path.join(root,'_locales/en/messages.json')));
const t=(key,args=[])=>zh[key].message.replace(/\$(\d+)/g,(_,n)=>args[+n-1]??'');
test('page language wins only when supported; Chinese remains default regardless of browser locale',()=>{
 assert.equal(I.locale('auto','en-US'),'en'); assert.equal(I.locale('auto','zh-TW'),'zh_CN');
 assert.equal(I.locale('auto',''),'zh_CN'); assert.equal(I.locale('zh_CN','en'),'zh_CN');
 assert.equal(I.locale('en','zh-CN'),'en');
});
test('catalogs cover UI, manifest and status messages with identical substitutions',()=>{
 assert.deepEqual(Object.keys(zh).sort(),Object.keys(en).sort());
 for(const key of Object.keys(zh)) assert.deepEqual(zh[key].message.match(/\$\d+/g),en[key].message.match(/\$\d+/g));
 const html=fs.readFileSync(path.join(root,'popup.html'),'utf8');
 for(const [,key] of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(zh[key],key);
 assert.ok(!html.includes('experiment')); assert.ok(!html.includes('Bytes are discarded'));
});
test('normal, dynamic and failure statuses display Chinese',()=>{
 assert.equal(I.notice('Reading segment index',t),'正在读取视频分段索引');
 assert.equal(I.notice('Priming 24:05',t),'正在预热 24:05');
 assert.equal(I.notice('partial: 2.54 MiB',t),'已部分读取 · 2.54 MiB');
 assert.equal(I.notice('primeSeconds: use 0.1–10',t),'单次请求时长 · 秒：请输入 0.1 至 10 之间的数值');
 assert.equal(I.notice('random raw error',t),'操作未完成，请查看诊断');
});
