"use strict";
let config, tabId, snapshot, t, currentLanguage;
const $ = id => document.getElementById(id);
const send = value => browser.runtime.sendMessage(value);
const clock = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
async function translate(language) {
  if (language === currentLanguage) return;
  t = await PrimerI18n.load(language); currentLanguage = language;
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  document.title = t("appTitle");
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
}
function fill(value) {
  config = value;
  for (const [key, v] of Object.entries(value)) {
    const input = $(key); if (!input) continue;
    if (input.type === "checkbox") input.checked = v; else input.value = v;
  }
}
function rowsInto(id, rows) {
  $(id).replaceChildren();
  for (const [key, value] of rows) {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = key; dd.textContent = value; $(id).append(dt, dd);
  }
}
async function update() {
  snapshot = await send({type: "get"});
  const s = snapshot.summaries[tabId];
  await translate(PrimerI18n.locale(snapshot.config.language, s?.pageLanguage));
  $("status").textContent = PrimerI18n.notice(s?.notice, t);
  $("status").dataset.active = Boolean(s?.pending);
  const rows = s ? [[t("labelCDN"), s.host || t("notDetected")], [t("labelStream"), s.codec ? `${s.quality || "?"} · ${s.codec}` : s.host ? t("streamObserved") : "? · ?"],
    [t("labelPlayback"), t("bufferValue", [clock(s.current), clock(s.bufferedEnd)])],
    [t("labelWindow"), s.window ? `${clock(s.window.from)}–${clock(s.window.to)}` : "—"],
    [t("labelAttempts"), t("attemptsValue", [s.attempted, s.partial, s.completed])],
    [t("labelTraffic"), `${(s.bytes / 1048576).toFixed(2)} MiB`]] : [];
  if (s?.playback) rows.push([t("labelStalls"), t("stallsValue", [s.playback.stalls, s.playback.stallSeconds.toFixed(1)])]);
  if (s?.adaptive) rows.push([t("labelAdaptive"), t("adaptiveValue", [Math.round(s.adaptive.targetBytes/1024), s.adaptive.deadlineSeconds, s.adaptive.leadSeconds, s.adaptive.samples])], [t("labelDecision"), t("adaptiveReason_"+s.adaptive.reason)], [t("labelRecovery"), t(s.adaptive.recovery ? "recoveryYes" : "recoveryNo")]);
  const stats = snapshot.playerStats?.[tabId];
  if (stats) rows.push([t("labelPlayerRequests"), t("playerRequestsValue", [stats.completed, stats.failed, stats.overlapping])]);
  const scheduling = snapshot.scheduler?.[tabId];
  if (scheduling) rows.push([t("labelScheduler"), t("schedule_"+scheduling.reason)],
    [t("labelBlocked"), t("blockedValue", [scheduling.blockerCount, (scheduling.waitMs/1000).toFixed(1), Math.ceil(scheduling.cooldownMs/1000)])]);
  rowsInto("details", rows);
  rowsInto("detectionDetails", s?.detection ? [[t("labelDetection"), t("detectionValue", [s.detection.representations, s.detection.networkObservations, s.detection.performanceObservations])], [t("indexSource"), t(s.detection.indexSource === "playinfo" ? "indexPlayinfo" : "indexMedia")],
    ...(scheduling?.blockers || []).map(b=>[`${b.host} · ${b.id}`,`${(b.ageMs/1000).toFixed(1)} s · ${b.range ? `${b.range.lo}–${b.range.hi}` : "—"}`])] : []);
}
$("settings").addEventListener("submit", async e => {
  e.preventDefault(); const value = {...config};
  for (const key of Object.keys(value)) {
    const input = $(key); if (!input) continue;
    value[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
  }
  try {
    fill((await send({type: "configure", value: Primer.settings(value)})).config);
    await update(); $("feedback").textContent = t("saved");
  } catch (error) { $("feedback").textContent = PrimerI18n.notice(error.message, t); }
});
$("mode").addEventListener("change", async () => {
  try { fill((await send({type:"configure", value:{...config,mode:$("mode").value,enabled:$("mode").value!=="observe"}})).config); await update(); }
  catch(error) { $("feedback").textContent=PrimerI18n.notice(error.message,t); }
});
$("export").addEventListener("click", async () => {
  await update();
  const full = await send({type:"export"});
  const blob = new Blob([JSON.stringify({version: browser.runtime.getManifest().version, exported: new Date().toISOString(), ...full}, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `bilibili-primer-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
(async () => {
  $("version").textContent = `v${browser.runtime.getManifest().version}`;
  await translate("zh_CN");
  const [tab] = await browser.tabs.query({active: true, currentWindow: true}); tabId = tab?.id;
  await update(); fill(snapshot.config);
  setInterval(() => update().catch(() => {}), 1000);
})().catch(error => { $("status").textContent = t ? PrimerI18n.notice(error.message, t) : "暂时无法读取播放状态"; });
