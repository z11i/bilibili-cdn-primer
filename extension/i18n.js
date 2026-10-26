"use strict";
(() => {
  const statusKeys = {
  "Recovery — waiting between small probes": "statusRecovery",
  "Observation only — recording playback without priming": "statusObserve",
  "Player downloading — waiting for idle time": "statusPlayerBusy",
  "Video index unavailable — refresh video": "statusUnavailableIndex",
  "Waiting for player media requests": "statusWaitingMedia",
  "Media stream changed": "statusChanged",
  "Player attached": "statusPlayer",
  "Seeking — rebuilding window": "statusSeeking",
  "Seek complete": "statusSeeked",
  "Playback speed changed": "statusRate",
  "Paused": "statusPaused",
  "Yielding bandwidth to buffering player": "statusBuffering",
  "Video ended": "statusEnded",
  "Waiting for new stream metadata": "statusNewStream",
  "Page/part changed": "statusPage",
  "Disabled": "statusDisabled",
  "Waiting — tab hidden": "statusHidden",
  "Waiting — paused": "statusWaitingPaused",
  "Yielding bandwidth — player needs buffer": "statusLowBuffer",
  "Playback metadata could not be read — export diagnostics": "statusMetadataError",
  "Waiting for playback metadata": "statusMetadata",
  "Metadata found — waiting for a player video request": "statusRequest",
  "Player request found — waiting for matching stream metadata": "statusMatch",
  "Waiting for matching playinfo and a player video request": "statusLegacyMatch",
  "Waiting — player is using a different CDN": "statusCDN",
  "Reading segment index": "statusIndex",
  "Other tab is priming": "statusOtherTab",
  "Shared bandwidth budget reached": "statusBudget",
  "Upcoming window attempted; watching playback": "statusCovered",
  "Access refused — refresh video for fresh playback URLs": "statusAccess",
  "Media headers missing — open diagnostics": "statusHeaders",
  "Settings changed": "statusSettings",
  "Page closed": "statusClosed",
  "No media data received": "statusNoBody",
  "Request failed; see diagnostics": "statusFailed"
};
  const catalogs = new Map();
  function locale(preference, pageLanguage) {
    if (["zh_CN", "en"].includes(preference)) return preference;
    return /^en(?:[-_]|$)/i.test(pageLanguage || "") ? "en" : "zh_CN";
  }
  async function load(language) {
    if (!catalogs.has(language)) {
      const response = await fetch(browser.runtime.getURL(`_locales/${language}/messages.json`));
      if (!response.ok) throw Error("Locale unavailable");
      catalogs.set(language, await response.json());
    }
    const catalog = catalogs.get(language);
    return (key, args = []) => {
      const text = catalog[key]?.message || key;
      return text.replace(/\$(\d+)/g, (_, n) => String(args[Number(n) - 1] ?? ""));
    };
  }
  function notice(text, t) {
    if (!text) return t("openVideo");
    if (statusKeys[text]) return t(statusKeys[text]);
    let m = /^Priming (.+)$/.exec(text);
    if (m) return t("statusPriming", [m[1]]);
    m = /^(partial|completed|no-body|failed): ([\d.]+) MiB$/.exec(text);
    if (m) return t({partial:"statusPartial",completed:"statusCompleted","no-body":"statusNoBody",failed:"statusFailed"}[m[1]], [m[2]]);
    if (/expired|expiring/i.test(text)) return t("errorExpired");
    if (/Index fetch incomplete/.test(text)) return t("errorIndex");
    if (/headers|media headers/i.test(text)) return t("statusHeaders");
    if (/NetworkError|Failed to fetch|Network request/i.test(text)) return t("errorNetwork");
    m = /received (\d+)/.exec(text);
    if (m) return t("errorRange", [m[1]]);
    m = /^(\w+): use ([\d.]+)–([\d.]+)$/.exec(text);
    if (m) return t("errorSetting", [t(m[1]), m[2], m[3]]);
    return t("errorGeneric");
  }
  globalThis.PrimerI18n = {locale, load, notice};
  if (typeof module !== "undefined") module.exports = {locale, load, notice};
})();
