"use strict";
const P = Primer, mediaPatterns = ["https://*.bilivideo.com/*", "https://upos-hz-mirrorakam.akamaized.net/*"];
let config = P.settings(), active = null;
const ready = browser.storage.local.get("config").then(v => { config = P.settings(v.config); });
const summaries = new Map(), usage = [], events = [];
const send = (id, msg) => browser.tabs.sendMessage(id, msg).catch(() => {});
const extensionOrigin = browser.runtime.getURL("");
function trusted(sender) { return sender.tab && /^https:\/\/([\w-]+\.)?bilibili\.com\//.test(sender.url || ""); }
function record(value) { events.push({at: new Date().toISOString(), ...value}); if (events.length > 300) events.shift(); }

// Only our active background fetch gets these headers. Player requests are untouched.
browser.webRequest.onBeforeSendHeaders.addListener(d => {
  if (!active || d.url !== active.url || !(d.originUrl || "").startsWith(extensionOrigin)) return;
  const headers = d.requestHeaders.filter(h => !["origin", "referer"].includes(h.name.toLowerCase()));
  headers.push({name: "Origin", value: "https://www.bilibili.com"}, {name: "Referer", value: active.referer});
  active.headersApplied = true;
  return {requestHeaders: headers};
}, {urls: mediaPatterns}, ["blocking", "requestHeaders"]);
browser.webRequest.onResponseStarted.addListener(d => {
  if (active && d.url === active.url && (d.originUrl || "").startsWith(extensionOrigin)) {
    active.remoteIP = d.ip || null; active.fromCache = d.fromCache;
  }
}, {urls: mediaPatterns});

// Read-only observation of the player's media selection, excluding our own traffic.
browser.webRequest.onBeforeRequest.addListener(d => {
  if (d.tabId < 0 || !P.mediaURL(d.url) || (d.originUrl || "").startsWith(extensionOrigin)) return;
  send(d.tabId, {type: "observed", url: d.url});
}, {urls: mediaPatterns, types: ["xmlhttprequest", "media"]});

// SPA navigation can fetch new playinfo without updating window.__playinfo__.
// Pass every response byte straight through; retain only a bounded JSON copy.
browser.webRequest.onBeforeRequest.addListener(d => {
  if (d.tabId < 0) return;
  let filter;
  try { filter = browser.webRequest.filterResponseData(d.requestId); } catch { return; }
  const decoder = new TextDecoder(); let text = "", size = 0, oversized = false;
  filter.ondata = e => {
    filter.write(e.data);
    size += e.data.byteLength;
    if (size > 2 * 1024 * 1024) { oversized = true; text = ""; }
    if (!oversized) text += decoder.decode(e.data, {stream: true});
  };
  filter.onstop = () => {
    filter.close();
    if (oversized) return;
    try { const info = JSON.parse(text + decoder.decode());
      const reps = P.representations(info);
      if (reps.length) send(d.tabId, {type: "playinfo", reps, page: d.documentUrl});
    } catch { /* Non-JSON/API failures leave playback untouched. */ }
  };
  filter.onerror = () => { try { filter.disconnect(); } catch { /* already closed */ } };
}, {urls: ["https://api.bilibili.com/x/player/*playurl*", "https://api.bilibili.com/pgc/player/*playurl*"]}, ["blocking"]);

async function fetchRange(msg, sender) {
  await ready;
  if (!trusted(sender) || !config.enabled) return {error: "Disabled or unsupported page"};
  if (active) return {busy: true};
  const url = P.mediaURL(msg.url);
  if (!url) return {error: "Unsupported media host/path"};
  let r; try { r = P.range(msg.range); } catch (e) { return {error: e.message}; }
  const index = msg.kind === "index";
  if (index && r.size > 2 * 1024 * 1024) return {error: "Index exceeds 2 MiB"};
  const expiry = Number(url.searchParams.get("deadline"));
  if (expiry && expiry * 1000 < Date.now() + 15000) return {error: "Signed URL expired or expiring; refresh the video"};
  const cap = index ? r.size : Math.min(r.size, Math.floor(config.maxPrimeMiB * 1048576));
  while (usage.length && usage[0].at < Date.now() - 60000) usage.shift();
  // Reserve worst-case bytes before starting; allow one stream chunk of overhead.
  if (usage.reduce((n, v) => n + v.bytes, 0) + cap + 262144 > config.budgetMiB * 1048576) return {budget: true};
  const controller = new AbortController();
  const job = {controller, tab: sender.tab.id, token: msg.token, url: url.href,
    referer: sender.url, headersApplied: false};
  active = job;
  const started = performance.now(); let bytes = 0, status = 0, firstByte = null, reason = "", complete = false;
  let error = null, headers = {}, chunks = [];
  const timer = setTimeout(() => { reason = "deadline"; controller.abort(); }, index ? 10000 : config.primeSeconds * 1000);
  try {
    // No browser-cache reads or writes; do not claim this controls CDN cache policy.
    const response = await fetch(url.href, {headers: {Range: `bytes=${r.lo}-${r.hi}`},
      credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal});
    status = response.status;
    for (const name of ["content-range", "cache", "x-cache", "x-cache-lookup", "eo-cache-status", "x-id", "x-server"]) {
      const value = response.headers.get(name); if (value) headers[name] = value;
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(headers["content-range"] || "");
    if (status !== 206 || !match || Number(match[1]) !== r.lo || Number(match[2]) !== r.hi) throw Error(`Expected exact HTTP 206 range; received ${status}`);
    const reader = response.body.getReader();
    while (true) {
      const {done, value} = await reader.read();
      if (done) { complete = bytes === r.size; if (!complete) throw Error("Short response body"); break; }
      if (firstByte === null) firstByte = (performance.now() - started) / 1000;
      bytes += value.byteLength;
      if (bytes > r.size) throw Error("Response exceeds requested range");
      if (index) chunks.push(value);
      if (!index && bytes >= cap && bytes < r.size) { reason = "byte-cap"; controller.abort(); break; }
    }
  } catch (e) {
    if (!controller.signal.aborted) error = e.message || String(e);
  } finally {
    clearTimeout(timer); controller.abort();
    usage.push({at: Date.now(), bytes});
    if (active === job) active = null;
  }
  const result = {kind: msg.kind, segment: msg.segment, status, bytes,
    seconds: (performance.now() - started) / 1000, firstByte, complete,
    outcome: error ? "failed" : complete ? "completed" : bytes ? "partial" : "no-body",
    reason: reason || "finished", error, headers, headersApplied: job.headersApplied,
    host: url.hostname, path: url.pathname, range: msg.range,
    remoteIP: job.remoteIP || null, fromBrowserCache: job.fromCache ?? null};
  if (!index || error) record({tab: sender.tab.id, ...result});
  if (index && complete) {
    const out = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    result.data = Array.from(out);
  }
  return result;
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "init" && trusted(sender)) return ready.then(() => ({config}));
  if (msg.type === "fetch") return fetchRange(msg, sender);
  if (msg.type === "cancel" && trusted(sender)) {
    if (active?.tab === sender.tab.id && active.token === msg.token) active.controller.abort();
    return Promise.resolve({ok: true});
  }
  if (msg.type === "summary" && trusted(sender)) {
    if (msg.value.window) summaries.set(sender.tab.id, msg.value);
    else summaries.delete(sender.tab.id);
    return Promise.resolve({ok: true});
  }
  // UI commands are accepted only from our extension pages.
  if (!sender.url?.startsWith(extensionOrigin)) return;
  if (msg.type === "get") return ready.then(() => ({config, summaries: Object.fromEntries(summaries), events}));
  if (msg.type === "configure") return (async () => {
    await ready; config = P.settings(msg.value); await browser.storage.local.set({config});
    active?.controller.abort();
    const tabs = await browser.tabs.query({url: "https://*.bilibili.com/*"});
    await Promise.all(tabs.map(tab => send(tab.id, {type: "configure", config})));
    return {config};
  })();
});
browser.tabs.onRemoved.addListener(id => { summaries.delete(id); if (active?.tab === id) active.controller.abort(); });
browser.tabs.onUpdated.addListener((id, change) => {
  if (change.status === "loading" && active?.tab === id) active.controller.abort();
});
