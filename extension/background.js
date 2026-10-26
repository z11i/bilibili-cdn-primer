"use strict";
const P = Primer, mediaPatterns = ["https://*.bilivideo.com/*", "https://upos-hz-mirrorakam.akamaized.net/*"];
let config = P.settings(), active = null;
const ready = browser.storage.local.get("config").then(v => { config = P.migrateSettings(v.config); });
const summaries = new Map(), usage = [], events = [];
const player = new PrimerMeasure.PlayerTracker(), playbackEvents = [];
const adaptive = new PrimerAdaptive.Controller();
const scheduler = new PrimerAdaptive.Scheduler();
function schedule(tab) { const now=Date.now();return scheduler.evaluate(tab,player.blockers(tab,now),config,now); }
const sessionStartedMs = Date.now();
function playbackRecord(value) { playbackEvents.push(value); if (playbackEvents.length > 1800) playbackEvents.shift(); }
const send = (id, msg) => browser.tabs.sendMessage(id, msg).catch(() => {});
const extensionOrigin = browser.runtime.getURL("");
function trusted(sender) { return sender.tab && /^https:\/\/([\w-]+\.)?bilibili\.com\//.test(sender.url || ""); }
function record(value) { events.push({at: new Date().toISOString(), ...value}); if (events.length > 300) events.shift(); }

// Only our active background fetch gets these headers. Player requests are untouched.
browser.webRequest.onBeforeSendHeaders.addListener(d => {
  player.requestHeaders(d);
  if (active?.concurrent && d.tabId === active.tab && !(d.originUrl || "").startsWith(extensionOrigin)) {
    const row=player.inflight.get(d.requestId), url=P.mediaURL(d.url);
    if(row?.range && url?.pathname===active.path && row.range.lo<=active.range.hi && row.range.hi>=active.range.lo){
      active.cancelReason="player-range-overlap";active.controller.abort();
    }
  }
  if (!active || d.url !== active.url || !(d.originUrl || "").startsWith(extensionOrigin)) return;
  const headers = d.requestHeaders.filter(h => !["origin", "referer"].includes(h.name.toLowerCase()));
  headers.push({name: "Origin", value: "https://www.bilibili.com"}, {name: "Referer", value: active.referer});
  active.headersApplied = true;
  return {requestHeaders: headers};
}, {urls: mediaPatterns}, ["blocking", "requestHeaders"]);
browser.webRequest.onResponseStarted.addListener(d => {
  player.response(d);
  if (active && d.url === active.url && (d.originUrl || "").startsWith(extensionOrigin)) {
    active.remoteIP = d.ip || null; active.fromCache = d.fromCache;
  }
}, {urls: mediaPatterns}, ["responseHeaders"]);
function finishPlayer(d) { const row = player.finish(d); if (row) adaptive.feedback(row, player.primes, config); }
browser.webRequest.onCompleted.addListener(finishPlayer, {urls: mediaPatterns});
browser.webRequest.onErrorOccurred.addListener(finishPlayer, {urls: mediaPatterns});

// Read-only observation of the player's media selection, excluding our own traffic.
browser.webRequest.onBeforeRequest.addListener(d => {
  if (d.tabId < 0 || !P.mediaURL(d.url) || (d.originUrl || "").startsWith(extensionOrigin)) return;
  player.start(d, config.mode);
  if (active?.tab === d.tabId && !active.concurrent) { active.cancelReason = "player-priority"; active.controller.abort(); }
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
  if (!trusted(sender) || !config.enabled || !["prime", "adaptive"].includes(config.mode)) return {error: "Observation mode or disabled"};
  if (active) return {busy: true};
  const url = P.mediaURL(msg.url);
  if (!url) return {error: "Unsupported media host/path"};
  let r; try { r = P.range(msg.range); } catch (e) { return {error: e.message}; }
  const index = msg.kind === "index";
  if (index && r.size > 2 * 1024 * 1024) return {error: "Index exceeds 2 MiB"};
  const expiry = P.deadline(url.href);
  if (expiry && expiry * 1000 < Date.now() + 15000) return {error: "Signed URL expired or expiring; refresh the video", errorCode: "expired"};
  const recovery = config.mode === "adaptive" && Boolean(msg.recovery);
  const scheduling = schedule(sender.tab.id);
  if (!scheduling.allowed) return {playerBusy:true,scheduler:scheduling};
  if(scheduling.concurrent && player.blockers(sender.tab.id,Date.now()).some(b=>b.path===url.pathname && b.range && b.range.lo<=r.hi && b.range.hi>=r.lo))
    return {playerBusy:true,scheduler:{...scheduling,reason:"player-range-overlap"}};
  if (scheduling.concurrent && index && r.size>65536) return {playerBusy:true,scheduler:{...scheduling,reason:"index-too-large"}};
  const policy = config.mode === "adaptive" ? adaptive.policy(url.hostname, url.pathname, config, recovery) : null;
  if(policy && scheduling.concurrent) Object.assign(policy,{concurrent:true,targetBytes:Math.min(policy.targetBytes,262144),deadlineSeconds:Math.min(config.adaptiveDeadlineSeconds,3)});
  const cap = index ? r.size : Math.min(r.size, Math.floor(policy ? policy.targetBytes : config.maxPrimeMiB * 1048576));
  while (usage.length && usage[0].at < Date.now() - 60000) usage.shift();
  // Reserve worst-case bytes before starting; allow one stream chunk of overhead.
  if (usage.reduce((n, v) => n + v.bytes, 0) + cap + 262144 > config.budgetMiB * 1048576) return {budget: true};
  if (!index && recovery && !adaptive.allowRecovery(url.hostname, url.pathname, Date.now())) return {recoveryCooldown:true};
  if(scheduling.concurrent)scheduler.admit(sender.tab.id,Date.now());
  const controller = new AbortController();
  const job = {controller, tab: sender.tab.id, token: msg.token, url: url.href,
    referer: sender.url, mode: config.mode, headersApplied: false,concurrent:scheduling.concurrent,path:url.pathname,range:r};
  active = job;
  const startMs = Date.now();
  const durationSeconds = Number(msg.durationSeconds);
  const primeWindow = index ? null : {startMs,endMs:null,tab:sender.tab.id,host:url.hostname,path:url.pathname,range:r,bytes:0,outcome:"pending",
    mode:job.mode,recovery,concurrent:scheduling.concurrent,durationSeconds:Number.isFinite(durationSeconds)&&durationSeconds>0&&durationSeconds<=600?durationSeconds:null};
  if (primeWindow) player.prime(primeWindow);
  const started = performance.now(); let bytes = 0, status = 0, firstByte = null, reason = "", complete = false;
  let error = null, headers = {}, chunks = [];
  const timer = setTimeout(() => { reason = "deadline"; controller.abort(); }, (index ? (scheduling.concurrent?Math.min(config.adaptiveDeadlineSeconds,3):10) : (policy ? policy.deadlineSeconds : config.primeSeconds)) * 1000);
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
    reason: reason || job.cancelReason || "finished", error, headers, headersApplied: job.headersApplied,
    host: url.hostname, path: url.pathname, range: msg.range,
    remoteIP: job.remoteIP || null, fromBrowserCache: job.fromCache ?? null,concurrent:scheduling.concurrent,scheduler:scheduling};
  result.startMs = startMs; result.endMs = Date.now(); result.mode = job.mode;
  if (policy) result.adaptive = policy;
  if (primeWindow) { Object.assign(primeWindow,{endMs:result.endMs,bytes,outcome:result.outcome,remoteIP:result.remoteIP}); adaptive.prime(result,recovery); }
  record({tab: sender.tab.id, ...result});
  if (index && complete) {
    const out = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    result.data = Array.from(out);
  }
  return result;
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "init" && trusted(sender)) return ready.then(() => ({config}));
  if (msg.type === "policy" && trusted(sender)) return ready.then(() => {
    const url = P.mediaURL(msg.url);
    return url ? {...adaptive.policy(url.hostname,url.pathname,config,Boolean(msg.recovery)),scheduler:schedule(sender.tab.id)} : null;
  });
  if (msg.type === "fetch") return fetchRange(msg, sender);
  if (msg.type === "playback" && trusted(sender)) {
    const v = msg.value;
    // Content scripts send only scalar playback state; never forward page URLs.
    if (v && Number.isFinite(v.atMs)) playbackRecord({...v, tab: sender.tab.id});
    return Promise.resolve({ok: true});
  }
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
  if (msg.type === "get" || msg.type === "export") return ready.then(() => ({
    config, summaries: Object.fromEntries(summaries), playerStats: player.stats,
    scheduler:Object.fromEntries([...summaries.keys()].map(id=>[id,schedule(id)])),
    ...(msg.type === "export" ? {sessionStartedMs, events, adaptiveDecisions:adaptive.decisions, schedulerDecisions:scheduler.decisions,playerRequests: player.requests,
      pendingPlayerRequests: [...player.inflight.values()], playbackEvents,
      measurementNotes: {bytes: "Player byte counts are response-header estimates for completed requests; partial bytes are unknown.",
        comparison: "Prior priming and request overlap are associations, not proof of a cache hit or causal improvement.",
        limits: "Last 1000 player requests, 1800 playback events, 300 prime events; page samples every 2 seconds."}} : {})}));
  if (msg.type === "configure") return (async () => {
    await ready; config = P.settings(msg.value); await browser.storage.local.set({config});
    scheduler.reset();
    playbackRecord({atMs: Date.now(), event: "configuration", config: {...config}});
    active?.controller.abort();
    const tabs = await browser.tabs.query({url: "https://*.bilibili.com/*"});
    await Promise.all(tabs.map(tab => send(tab.id, {type: "configure", config})));
    return {config};
  })();
});
browser.tabs.onRemoved.addListener(id => { summaries.delete(id); player.removeTab(id); scheduler.remove(id);if (active?.tab === id) active.controller.abort(); });
browser.tabs.onUpdated.addListener((id, change) => {
  if(change.status === "loading") {player.removeTab(id);scheduler.remove(id);}
  if (change.status === "loading" && active?.tab === id) active.controller.abort();
});
