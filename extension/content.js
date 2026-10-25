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
  const history = new Map(); // Host+path+range; signed URL refresh does not reset attempts.
  const message = value => browser.runtime.sendMessage(value);
  function log(value) { events.push({at: new Date().toISOString(), ...value}); if (events.length > 40) events.shift(); }
  function reset(reason, clearSelection = false) {
    generation++; seekUntil = Date.now() + 650;
    if (token) message({type: "cancel", token}).catch(() => {});
    if (clearSelection) { selected = null; segments = []; blocked = ""; }
    notice = reason;
  }
  function adopt(list, source = "playurl API") {
    if (!Array.isArray(list) || !list.length) return;
    const merged = new Map(reps.map(v => [P.identity(v.url), v]));
    for (const v of list) if (P.mediaURL(v.url)) merged.set(P.identity(v.url), v);
    reps = [...merged.values()].slice(-1000);
    detection.metadataSource = source; detection.representations = reps.length;
    choose();
  }
  function choose() {
    // Only a real player video request chooses the representation and CDN.
    for (const observed of recent) {
      const rep = reps.find(v => P.identity(v.url) === P.identity(observed));
      if (!rep) {
        if (/-1-(?:100\d+|30[01]\d+)\.m4s$/.test(new URL(observed).pathname)) return;
        continue;
      }
      const fresh = {...rep, url: observed};
      if (selected && P.identity(selected.url) === P.identity(fresh.url) && selected.index === fresh.index) {
        selected.url = observed; return;
      }
      reset("Media stream changed", true); selected = fresh; return;
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
    if (video) { reset("Player attached"); for (const [name, handler] of Object.entries(handlers)) video.addEventListener(name, handler); }
  }
  const handlers = {
    seeking: () => reset("Seeking — rebuilding window"),
    seeked: () => reset("Seek complete"),
    ratechange: () => reset("Playback speed changed"),
    pause: () => { if (!config.primeWhilePaused) reset("Paused"); },
    waiting: () => { bufferUntil = Date.now() + 3000; reset("Yielding bandwidth to buffering player"); },
    playing: () => { bufferUntil = 0; },
    ended: () => reset("Video ended")
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
    if (selected && /-1-(?:100\d+|30[01]\d+)\.m4s$/.test(url.pathname) && !reps.some(v => P.identity(v.url) === P.identity(value))) reset("Waiting for new stream metadata", true);
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
      bufferedEnd: bufferEnd(), window: video ? (() => { const p = P.plan(segments, video.currentTime, bufferEnd(), video.playbackRate, config); return {from: p.from, to: p.to, segments: p.segments.length}; })() : null,
      pending, bytes: totalBytes, attempted, partial, completed, events,
      detection: {...detection, recentMedia: recent.slice(0, 6).map(u => {
        const parsed = new URL(u); return {host: parsed.hostname, path: parsed.pathname};
      })}};
  }
  async function request(kind, range, segment) {
    token = `${Date.now()}-${Math.random()}`;
    return message({type: "fetch", kind, range, segment, token, url: selected.url});
  }
  async function tick() {
    if (location.href !== lastURL) {
      lastURL = location.href; recent = []; reps = []; reset("Page/part changed", true);
      newestNetworkObservation = -Infinity;
    }
    bindVideo(); inspectGlobal(); inspectResources();
    if (pending || !video) return;
    if (!config.enabled) { notice = "Disabled"; return; }
    if (Date.now() < seekUntil || video.seeking) return;
    if (!config.primeHidden && document.hidden) { notice = "Waiting — tab hidden"; return; }
    if (video.ended) { notice = "Video ended"; return; }
    if (!config.primeWhilePaused && video.paused) { notice = "Waiting — paused"; return; }
    if (Date.now() < bufferUntil || (!video.paused && (video.readyState < 3 || bufferEnd() - video.currentTime < config.minBufferSeconds))) {
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
      if (!segments.length) {
        const r = P.range(selected.index);
        notice = "Reading segment index";
        const result = await request("index", selected.index);
        if (generation !== epoch) return;
        if (result.busy || result.budget) { notice = result.busy ? "Other tab is priming" : "Shared bandwidth budget reached"; return; }
        if ([401, 403].includes(result.status)) blocked = "Access refused — refresh video for fresh playback URLs";
        if (!result.complete || !result.data) throw Error(result.error || "Index fetch incomplete; refresh or retry");
        if (!result.headersApplied) throw Error("Firefox did not attach the expected media headers; request path needs checking");
        segments = P.sidx(Uint8Array.from(result.data).buffer, r.lo);
      }
      const plan = P.plan(segments, video.currentTime, bufferEnd(), video.playbackRate, config);
      const candidate = plan.segments.find(s => {
        const old = history.get(`${P.identity(selected.url)}:${s.lo}-${s.hi}`);
        return !old || (old.outcome === "failed" && old.tries < 2 && Date.now() > old.retryAt);
      });
      if (!candidate) { notice = "Upcoming window attempted; watching playback"; return; }
      const key = `${P.identity(selected.url)}:${candidate.lo}-${candidate.hi}`;
      notice = `Priming ${Math.floor(candidate.start / 60)}:${String(Math.floor(candidate.start % 60)).padStart(2, "0")}`;
      const result = await request("prime", `${candidate.lo}-${candidate.hi}`, candidate.id);
      if (result.busy || result.budget) { notice = result.busy ? "Other tab is priming" : "Shared bandwidth budget reached"; return; }
      if (result.error && !result.outcome) throw Error(result.error);
      totalBytes += result.bytes || 0;
      if (generation !== epoch) { log({outcome: "cancelled after player change", bytes: result.bytes}); return; }
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
    if (msg.type === "playinfo" && (!msg.page || msg.page === location.href)) adopt(msg.reps);
    if (msg.type === "observed") observed(msg.url, "network");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !config.primeHidden) reset("Tab hidden"); });
  window.addEventListener("pagehide", () => reset("Page closed"));
  message({type: "init"}).then(v => { config = P.settings(v.config); }).catch(() => {});
  setInterval(() => {
    if (performance.now() >= nextTick) { nextTick = performance.now() + config.cadenceSeconds * 1000; tick().catch(() => {}); }
    message({type: "summary", value: summary()}).catch(() => {});
  }, 500);
})();
