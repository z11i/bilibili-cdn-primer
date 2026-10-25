/* Shared, dependency-free parsing and scheduling. No page code is executed here. */
(() => {
  "use strict";
  const defaults = Object.freeze({enabled: true, leadSeconds: 20, windowSeconds: 60,
    primeSeconds: 2, settleSeconds: 10, fetchMarginSeconds: 3, cadenceSeconds: 1,
    gapSeconds: 0.5, maxPrimeMiB: 4, budgetMiB: 32, minBufferSeconds: 8,
    primeWhilePaused: true, primeHidden: false, cdn: "follow", language: "auto"});
  const limits = {leadSeconds: [0, 300], windowSeconds: [5, 600], primeSeconds: [0.1, 10],
    settleSeconds: [0, 120], fetchMarginSeconds: [0, 30], cadenceSeconds: [0.5, 10],
    gapSeconds: [0, 10], maxPrimeMiB: [0.1, 16], budgetMiB: [1, 256], minBufferSeconds: [0, 60]};
  function settings(input = {}) {
    const value = {...defaults};
    for (const [key, [lo, hi]] of Object.entries(limits)) {
      if (input[key] === undefined) continue;
      const n = Number(input[key]);
      if (!Number.isFinite(n) || n < lo || n > hi) throw Error(`${key}: use ${lo}–${hi}`);
      value[key] = n;
    }
    for (const key of ["enabled", "primeWhilePaused", "primeHidden"]) {
      if (typeof input[key] === "boolean") value[key] = input[key];
    }
    if (["follow", "gcore", "akamai"].includes(input.cdn)) value.cdn = input.cdn;
    if (["auto", "zh_CN", "en"].includes(input.language)) value.language = input.language;
    return value;
  }
  function mediaURL(value) {
    try {
      const u = new URL(value);
      const host = u.hostname;
      if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
      if (!(host.endsWith(".bilivideo.com") || host === "upos-hz-mirrorakam.akamaized.net")) return null;
      if (!/^\/upgcxcode\/[\d/]+\/[^/]+\.m4s$/.test(u.pathname)) return null;
      return u;
    } catch { return null; }
  }
  function identity(value) { const u = mediaURL(value); return u ? u.hostname + u.pathname : ""; }
  function range(value) {
    const m = /^(\d+)-(\d+)$/.exec(String(value));
    if (!m) throw Error("Invalid byte range");
    const lo = Number(m[1]), hi = Number(m[2]);
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo || hi - lo > 64 * 1024 * 1024) throw Error("Byte range out of bounds");
    return {lo, hi, size: hi - lo + 1};
  }
  function sidx(buffer, absoluteStart) {
    const d = new DataView(buffer); let pos = 0;
    const need = (p, n, end) => { if (p + n > end) throw Error("Truncated SIDX"); };
    const u64 = p => { const n = d.getUint32(p) * 4294967296 + d.getUint32(p + 4); if (!Number.isSafeInteger(n)) throw Error("Unsafe SIDX integer"); return n; };
    while (pos + 8 <= d.byteLength) {
      let size = d.getUint32(pos), head = 8;
      const type = String.fromCharCode(...new Uint8Array(buffer, pos + 4, 4));
      if (size === 1) { need(pos, 16, d.byteLength); size = u64(pos + 8); head = 16; }
      if (size === 0) size = d.byteLength - pos;
      const end = pos + size;
      if (size < head || end > d.byteLength) throw Error("Invalid MP4 box");
      if (type !== "sidx") { pos = end; continue; }
      let p = pos + head; need(p, 12, end);
      const version = d.getUint8(p), scale = d.getUint32(p + 8); p += 12;
      if (version > 1 || !scale) throw Error("Unsupported SIDX version/timescale");
      need(p, version ? 20 : 12, end);
      let ticks = version ? u64(p) : d.getUint32(p); p += version ? 8 : 4;
      const first = version ? u64(p) : d.getUint32(p); p += version ? 8 : 4;
      const count = d.getUint16(p + 2); p += 4; need(p, count * 12, end);
      let offset = absoluteStart + end + first;
      const rows = [];
      for (let i = 0; i < count; i++, p += 12) {
        const ref = d.getUint32(p), duration = d.getUint32(p + 4);
        if (ref >>> 31 || !ref || !duration) throw Error("Unsupported SIDX reference");
        if (!Number.isSafeInteger(offset + ref)) throw Error("Unsafe segment offset");
        rows.push({id: i, start: ticks / scale, end: (ticks + duration) / scale,
          lo: offset, hi: offset + ref - 1, size: ref});
        offset += ref; ticks += duration;
      }
      if (!rows.length) throw Error("Empty SIDX");
      return rows;
    }
    throw Error("No SIDX found");
  }
  function representations(obj) {
    const data = obj?.data || obj?.result || obj;
    return (data?.dash?.video || []).flatMap(v => {
      const index = (v.SegmentBase || v.segment_base || {}).indexRange || (v.segment_base || {}).index_range;
      if (!index) return [];
      try { if (range(index).size > 2 * 1024 * 1024) return []; } catch { return []; }
      return [v.baseUrl || v.base_url, ...(v.backupUrl || v.backup_url || [])]
        .filter(u => mediaURL(u)).map(url => ({url, index, quality: v.id, codec: v.codecs,
          width: v.width, height: v.height}));
    });
  }
  function plan(rows, time, bufferedEnd, rate, config) {
    // Lead is wall-clock seconds; window is video-timeline seconds.
    const lead = Math.max(config.leadSeconds, config.primeSeconds + config.settleSeconds + config.fetchMarginSeconds) * rate;
    const from = Math.max(time + lead, bufferedEnd + lead);
    const to = time + lead + config.windowSeconds;
    return {from, to, segments: rows.filter(s => s.start >= from && s.end <= to)};
  }
  const api = {defaults, limits, settings, mediaURL, identity, range, sidx, representations, plan};
  globalThis.Primer = api;
  if (typeof module !== "undefined") module.exports = api;
})();
