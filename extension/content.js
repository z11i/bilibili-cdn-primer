(() => {
  "use strict";
  const P = Primer;
  let config = P.settings(), reps = [], selected = null, segments = [], video = null;
  let generation = 0, pending = false, token = "", lastURL = location.href, nextTick = 0;
  let lastAttempt = 0, seekUntil = 0, bufferUntil = 0, notice = "Waiting for player media requests", blocked = "";
  let recent = [], events = [], totalBytes = 0, attempted = 0, partial = 0, completed = 0;
  const detection = {global: "not checked", metadataSource: null, metadataError: null,
    representations: 0, networkObservations: 0, performanceObservations: 0};
  const seenResources = new Set();
  let newestNetworkObservation = -Infinity;
  const INDEX_PROBE_BYTES = 65536;
  const playback = new PrimerMeasure.PlaybackTracker();
  let lastSampleMs = 0;
  let adaptivePolicy = null;
  const history = new Map(); // Host+path+range; signed URL refresh does not reset attempts.
  const message = value => browser.runtime.sendMessage(value);
  function capturePlayback(event) {
    if (!video) return;
    const state = {atMs: Date.now(), position: video.currentTime, bufferedEnd: bufferEnd(),
      bufferSeconds: Math.max(0, bufferEnd() - video.currentTime), paused: video.paused,
      seeking: Boolean(video.seeking), readyState: video.readyState, rate: video.playbackRate,
      hidden: document.hidden, mode: config.mode, enabled: config.enabled,
      media: selected ? P.identity(selected.url) : null};
    for (const row of playback.add(event, state)) message({type: "playback", value: row}).catch(() => {});
  }
  function log(value) { events.push({at: new Date().toISOString(), ...value}); if (events.length > 40) events.shift(); }
  function reset(reason, clearSelection = false) {
    generation++; seekUntil = Date.now() + 650;
    if (token) message({type: "cancel", token}).catch(() => {});
    if (clearSelection) { selected = null; segments = []; blocked = ""; adaptivePolicy = null; }
    notice = reason;
  }
  function adopt(list, source = "playurl API") {
    if (!Array.isArray(list) || !list.length) return;
    const merged = new Map(reps.map(v => [P.identity(v.url), v]));
    for (const v of list) if (P.mediaURL(v.url)) {
      const key = P.identity(v.url), previous = merged.get(key);
      // An unchanged initial page global must not overwrite a newer API URL.
      if (previous && P.freshURL(v.url, previous.url) === previous.url && previous.url !== v.url) continue;
      if (previous?.source === "playurl API" && source === "window.__playinfo__"
          && (P.deadline(previous.url) || 0) >= (P.deadline(v.url) || 0)) continue;
      merged.set(key, {...v, source});
    }
    reps = [...merged.values()].slice(-1000);
    detection.metadataSource = source; detection.representations = reps.length;
    choose();
  }
  function choose() {
    // A current video request chooses the representation/CDN. Playinfo improves
    // labels and index offsets, but is not required to discover the actual SIDX.
    for (const observed of recent) {
      const rep = reps.find(v => P.identity(v.url) === P.identity(observed));
      if (!rep && !P.videoURL(observed)) continue;
      const fresh = rep ? {...rep, url: P.freshURL(observed, rep.url)}
        : {url: observed, index: null, quality: null, codec: null, source: "media index probe"};
      if (selected && P.identity(selected.url) === P.identity(fresh.url)) {
        if (selected.index && fresh.index && selected.index !== fresh.index) { reset("Media stream changed"); segments = []; }
        if (selected.url !== fresh.url || selected.index !== fresh.index) blocked = "";
        selected = fresh; return;
      }
      // CDN failover does not change the byte layout of the same mirrored media
      // resource. Preserve its parsed SIDX instead of spending every recovery
      // opportunity on the same index. A different explicit index invalidates it.
      const retained = selected && new URL(selected.url).pathname === new URL(fresh.url).pathname &&
        (!selected.index || !fresh.index || selected.index === fresh.index) ? segments : [];
      reset("Media stream changed", true); selected = fresh; segments = retained; return;
    }
  }
  function bufferEnd() {
    if (!video) return 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.15 && video.buffered.end(i) >= video.currentTime) return video.buffered.end(i);
    }
    return video.currentTime;
  }
  function bindVideo() {
    const found = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (found === video) return;
    if (video) for (const [name, handler] of Object.entries(handlers)) video.removeEventListener(name, handler);
    video = found;
    if (video) { capturePlayback("media-change"); reset("Player attached"); for (const [name, handler] of Object.entries(handlers)) video.addEventListener(name, handler); }
  }
  const handlers = {
    seeking: () => { capturePlayback("seeking"); reset("Seeking — rebuilding window"); },
    seeked: () => { capturePlayback("seeked"); reset("Seek complete"); },
    ratechange: () => { capturePlayback("ratechange"); reset("Playback speed changed"); },
    pause: () => { capturePlayback("pause"); if (!config.primeWhilePaused) reset("Paused"); },
    waiting: () => { capturePlayback("waiting"); bufferUntil = Date.now() + 3000; reset("Yielding bandwidth to buffering player"); },
    stalled: () => capturePlayback("stalled"),
    playing: () => { capturePlayback("playing"); bufferUntil = 0; },
    ended: () => { capturePlayback("ended"); reset("Video ended"); }
  };
  function inspectGlobal() {
    try {
      // Copy into the extension realm BEFORE calling array methods. Calling a
      // page array's flatMap would run our callback through a security wrapper.
      const raw = window.wrappedJSObject?.__playinfo__;
      detection.global = raw ? "present" : "absent";
      if (raw) {
        const copy = JSON.parse(JSON.stringify(raw));
        adopt(P.representations(copy), "window.__playinfo__");
        detection.metadataError = null;
      }
    } catch (e) { detection.metadataError = e.message || String(e); }
  }
  function observed(value, source) {
    const url = P.mediaURL(value); if (!url) return;
    if (source === "network") newestNetworkObservation = performance.now();
    detection[source === "performance" ? "performanceObservations" : "networkObservations"]++;
    recent = [value, ...recent.filter(v => P.identity(v) !== P.identity(value))].slice(0, 20);
    if (selected && new URL(selected.url).pathname !== url.pathname && /-1-(?:100\d+|30[01]\d+)\.m4s$/.test(url.pathname) && !reps.some(v => P.identity(v.url) === P.identity(value))) reset("Waiting for new stream metadata", true);
    choose();
  }
  function inspectResources() {
    // Passive fallback for requests made before our listener was attached or
    // not attributed to a tab by webRequest. This makes no extra media requests.
    for (const entry of performance.getEntriesByType?.("resource") || []) {
      if (!["fetch", "xmlhttprequest", "video"].includes(entry.initiatorType) || !P.mediaURL(entry.name)) continue;
      const key = `${entry.startTime}:${entry.name}`;
      if (seenResources.has(key)) continue;
      seenResources.add(key);
      // A completed old resource must not override a newer in-flight request
      // already observed through webRequest (e.g. after changing quality).
      if (entry.startTime < newestNetworkObservation) continue;
      observed(entry.name, "performance");
    }
    if (seenResources.size > 5000) seenResources.clear();
  }
  function summary() {
    return {page: location.origin + location.pathname + (new URL(location.href).searchParams.has("p") ? `?p=${new URL(location.href).searchParams.get("p")}` : ""),
      notice, pageLanguage: document.documentElement?.lang || "", enabled: config.enabled, host: selected ? new URL(selected.url).hostname : null,
      media: selected ? new URL(selected.url).pathname : null,
      quality: selected?.quality, codec: selected?.codec, current: video?.currentTime || 0,
      bufferedEnd: bufferEnd(), window: video ? (() => {
        if (config.mode === "adaptive" && adaptivePolicy?.recovery) {
          const upcoming = segments.filter(s=>s.start>=bufferEnd()-0.15 && s.end>video.currentTime).slice(0,2);
          return {from:upcoming[0]?.start??bufferEnd(),to:upcoming.at(-1)?.end??bufferEnd(),segments:upcoming.length};
        }
        const effective = config.mode === "adaptive" && adaptivePolicy ? {...config,leadSeconds:adaptivePolicy.leadSeconds,primeSeconds:0,settleSeconds:0,fetchMarginSeconds:0} : config;
        const p = P.plan(segments, video.currentTime, bufferEnd(), video.playbackRate, effective);
        return {from:p.from,to:Math.max(p.from,p.to),segments:p.segments.length};
      })() : null,
      pending, bytes: totalBytes, attempted, partial, completed, events, adaptive:config.mode === "adaptive" ? adaptivePolicy : null, playback: playback.summary(),
      detection: {...detection, recentMedia: recent.slice(0, 6).map(u => {
        const parsed = new URL(u); return {host: parsed.hostname, path: parsed.pathname};
      }), selectedSource: selected?.source || null, indexSource: selected?.index ? "playinfo" : "media index probe"}};
  }
  async function request(kind, range, segment, durationSeconds, recovery = false) {
    token = `${Date.now()}-${Math.random()}`;
    return message({type: "fetch", kind, range, segment, durationSeconds, recovery, token, url: selected.url});
  }
  async function tick() {
    if (location.href !== lastURL) {
      capturePlayback("media-change");
      lastURL = location.href; recent = []; reps = []; reset("Page/part changed", true);
      newestNetworkObservation = -Infinity;
    }
    bindVideo(); inspectGlobal(); inspectResources();
    if (video && Date.now() - lastSampleMs >= 2000) { lastSampleMs = Date.now(); capturePlayback("sample"); }
    if (pending || !video) return;
    if (config.mode === "observe") { notice = "Observation only — recording playback without priming"; return; }
    if (!config.enabled) { notice = "Disabled"; return; }
    if (Date.now() < seekUntil || video.seeking) return;
    if (!config.primeHidden && document.hidden) { notice = "Waiting — tab hidden"; return; }
    if (video.ended) { notice = "Video ended"; return; }
    if (!config.primeWhilePaused && video.paused) { notice = "Waiting — paused"; return; }
    const recovery = !video.paused && (video.readyState < 3 || bufferEnd() - video.currentTime < config.minBufferSeconds);
    if (config.mode !== "adaptive" && (Date.now() < bufferUntil || recovery)) {
      notice = "Yielding bandwidth — player needs buffer"; return;
    }
    if (!selected) {
      notice = !reps.length ? (detection.metadataError ? "Playback metadata could not be read — export diagnostics" : "Waiting for playback metadata")
        : !recent.length ? "Metadata found — waiting for a player video request"
          : "Player request found — waiting for matching stream metadata";
      return;
    }
    const host = new URL(selected.url).hostname;
    if ((config.cdn === "gcore" && !host.includes("mirrorcosov")) || (config.cdn === "akamai" && !host.includes("mirrorakam"))) {
      notice = "Waiting — player is using a different CDN"; return;
    }
    if (blocked) { notice = blocked; return; }
    if (Date.now() - lastAttempt < config.gapSeconds * 1000) return;
    const epoch = generation;
    pending = true;
    try {
      if (config.mode === "adaptive") {
        adaptivePolicy = await message({type:"policy",url:selected.url,recovery});
        if (generation !== epoch) return;
      }
      if (!segments.length) {
        const indexRange = selected.index || `0-${INDEX_PROBE_BYTES - 1}`;
        const r = P.range(indexRange);
        notice = "Reading segment index";
        const result = await request("index", indexRange);
        totalBytes += result.bytes || 0;
        if (generation !== epoch) return;
        if (result.playerBusy) { notice = "Player downloading — waiting for idle time"; return; }
        if (result.busy || result.budget) { notice = result.busy ? "Other tab is priming" : "Shared bandwidth budget reached"; return; }
        if (result.errorCode === "expired") { blocked = result.error; notice = blocked; log({error: blocked}); return; }
        if ([401, 403].includes(result.status)) blocked = "Access refused — refresh video for fresh playback URLs";
        if (!result.complete || !result.data) throw Error(result.error || "Index fetch incomplete; refresh or retry");
        if (!result.headersApplied) throw Error("Firefox did not attach the expected media headers; request path needs checking");
        try { segments = P.sidx(Uint8Array.from(result.data).buffer, r.lo); }
        catch (e) {
          if (!selected.index) blocked = "Video index unavailable — refresh video";
          throw e;
        }
      }
      const effective = adaptivePolicy && config.mode === "adaptive" ? {...config,
        leadSeconds:adaptivePolicy.leadSeconds,primeSeconds:0,settleSeconds:0,fetchMarginSeconds:0} : config;
      const plan = recovery && config.mode === "adaptive"
        ? {segments:segments.filter(s=>s.start >= bufferEnd()-0.15 && s.end>video.currentTime && s.start<=video.currentTime+config.windowSeconds)}
        : P.plan(segments, video.currentTime, bufferEnd(), video.playbackRate, effective);
      const candidate = plan.segments.find(s => {
        if(config.mode === "adaptive" && adaptivePolicy?.scheduler?.blockers.some(b=>
          b.path===new URL(selected.url).pathname && b.range && b.range.lo<=s.hi && b.range.hi>=s.lo))return false;
        const old = history.get(`${P.identity(selected.url)}:${s.lo}-${s.hi}`);
        return !old || (old.outcome === "failed" && old.tries < 2 && Date.now() > old.retryAt);
      });
      if (!candidate) { notice = "Upcoming window attempted; watching playback"; return; }
      const key = `${P.identity(selected.url)}:${candidate.lo}-${candidate.hi}`;
      notice = `Priming ${Math.floor(candidate.start / 60)}:${String(Math.floor(candidate.start % 60)).padStart(2, "0")}`;
      const result = await request("prime", `${candidate.lo}-${candidate.hi}`, candidate.id,
        (candidate.end-candidate.start)/Math.max(0.1,video.playbackRate), recovery && config.mode === "adaptive");
      totalBytes += result.bytes || 0;
      if (generation !== epoch) { log({outcome: "cancelled after player change", bytes: result.bytes}); return; }
      if (result.playerBusy) { notice = "Player downloading — waiting for idle time"; return; }
      if (result.recoveryCooldown) { notice = "Recovery — waiting between small probes"; return; }
      if (result.busy || result.budget) { notice = result.busy ? "Other tab is priming" : "Shared bandwidth budget reached"; return; }
      if (result.errorCode === "expired") { blocked = result.error; notice = blocked; log({error: blocked}); return; }
      if (result.error && !result.outcome) throw Error(result.error);
      attempted++;
      if (result.outcome === "partial") partial++;
      if (result.complete) completed++;
      const old = history.get(key);
      const outcome = result.outcome === "no-body" ? "failed" : result.outcome;
      history.set(key, {outcome, tries: (old?.tries || 0) + 1, retryAt: Date.now() + 15000});
      // Bound session memory while retaining recent seek-back attempts.
      if (history.size > 10000) history.delete(history.keys().next().value);
      log({...result, segmentStart: candidate.start});
      notice = result.error || `${result.outcome}: ${(result.bytes / 1048576).toFixed(2)} MiB`;
      if ([401, 403].includes(result.status)) blocked = "Access refused — refresh video for fresh playback URLs";
      if (!result.headersApplied && result.status) blocked = "Media headers missing — open diagnostics";
    } catch (e) {
      if (epoch === generation) { notice = e.message; log({error: e.message}); lastAttempt = Date.now() + 5000; }
    } finally { pending = false; token = ""; lastAttempt = Math.max(lastAttempt, Date.now()); }
  }
  browser.runtime.onMessage.addListener(msg => {
    if (msg.type === "configure") { config = P.settings(msg.config); blocked = ""; reset("Settings changed"); }
    // API responses can finish across an SPA URL change. Matching the actual
    // observed media identity prevents stale responses from selecting old work.
    if (msg.type === "playinfo") adopt(msg.reps);
    if (msg.type === "observed") observed(msg.url, "network");
  });
  document.addEventListener("visibilitychange", () => { capturePlayback("visibility"); if (document.hidden && !config.primeHidden) reset("Tab hidden"); });
  window.addEventListener("pagehide", () => { capturePlayback("pagehide"); reset("Page closed"); });
  message({type: "init"}).then(v => { config = P.settings(v.config); }).catch(() => {});
  setInterval(() => {
    if (performance.now() >= nextTick) { nextTick = performance.now() + config.cadenceSeconds * 1000; tick().catch(() => {}); }
    message({type: "summary", value: summary()}).catch(() => {});
  }, 500);
})();
