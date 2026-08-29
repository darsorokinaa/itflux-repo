function isRealMobile(entry) {
  if (!entry) return false;
  const value = entry.real_mobile != null ? entry.real_mobile : entry.realMobile;
  return value === true || value === "true" || value === 1 || value === "1";
}

function osFamily(entry) {
  const os = String((entry && entry.os) || "");
  const device = String((entry && entry.device) || "");
  if (/ios/i.test(os) || /iphone|ipad/i.test(device)) return "ios";
  if (/android/i.test(os)) return "android";
  return "";
}

function browserNameOf(entry) {
  return String((entry && (entry.browser || entry.browserName)) || "");
}

function isIosSafariEntry(entry) {
  if (!isRealMobile(entry) || osFamily(entry) !== "ios") return false;
  if (!entry.device) return false;
  if (!/iphone|ipad/i.test(String(entry.device))) return false;
  const browser = browserNameOf(entry);
  if (!browser) return true;
  if (/chrome|firefox|edge|opera|samsung/i.test(browser) && !/safari|iphone|ios/i.test(browser)) return false;
  return true;
}

function isAndroidChromeEntry(entry) {
  if (!isRealMobile(entry) || osFamily(entry) !== "android") return false;
  if (!entry.device) return false;
  const browser = browserNameOf(entry).toLowerCase();
  if (!browser) return true;
  return /chrome|android/.test(browser);
}

function isTabletDevice(device) {
  const d = String(device || "");
  if (/ipad/i.test(d)) return true;
  if (/pixel tablet/i.test(d)) return true;
  if (/galaxy tab|\btab\b|tablet/i.test(d)) return true;
  return false;
}

function kindOf(entry) {
  return isTabletDevice(entry && entry.device) ? "tablet" : "phone";
}

function iphoneGeneration(device) {
  const d = String(device || "");
  if (/iPhone SE/i.test(d)) {
    if (/3rd/i.test(d)) return 8;
    if (/2nd/i.test(d)) return 7;
    return 6;
  }
  const match = d.match(/iPhone\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function osRank(version) {
  const parts = String(version || "0").split(".").map((p) => Number(p) || 0);
  return (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

function androidVendor(device) {
  const d = String(device || "").toLowerCase();
  if (d.includes("pixel")) return "pixel";
  if (d.includes("samsung") || d.includes("galaxy")) return "samsung";
  if (d.includes("oneplus")) return "oneplus";
  if (d.includes("xiaomi") || d.includes("redmi") || d.includes("poco")) return "xiaomi";
  if (d.includes("motorola") || d.includes("moto ")) return "motorola";
  if (d.includes("oppo")) return "oppo";
  if (d.includes("vivo")) return "vivo";
  return "other";
}

function sortGroup(entry) {
  const family = osFamily(entry);
  const kind = kindOf(entry);
  if (family === "ios" && kind === "phone") {
    return iphoneGeneration(entry.device) >= 12 ? 1 : 2;
  }
  if (family === "ios" && kind === "tablet") return 3;
  if (family === "android" && kind === "phone" && androidVendor(entry.device) === "pixel") return 4;
  if (family === "android" && kind === "phone" && androidVendor(entry.device) === "samsung") return 5;
  if (family === "android" && kind === "phone") return 6;
  return 7;
}

function compareEntries(a, b) {
  const ga = sortGroup(a);
  const gb = sortGroup(b);
  if (ga !== gb) return ga - gb;
  if (ga === 1 || ga === 2) {
    const gen = iphoneGeneration(b.device) - iphoneGeneration(a.device);
    if (gen) return gen;
  }
  const os = osRank(b.os_version) - osRank(a.os_version);
  if (os) return os;
  return String(a.device).localeCompare(String(b.device));
}

function uniqueDeviceOs(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const browser = browserNameOf(entry).toLowerCase();
    const key = `${entry.device}|${entry.os_version}|${browser}|${osFamily(entry)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function runKey(run) {
  return `${run.device}|${run.osVersion}|${run.browserName}|${run.orientation}`;
}

function uniqueRuns(runs) {
  const seen = new Set();
  const out = [];
  for (const run of runs || []) {
    const key = runKey(run);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(run);
  }
  return out;
}

function selectRealMobileEntries(catalog) {
  const list = Array.isArray(catalog) ? catalog : [];
  return uniqueDeviceOs(list.filter((entry) => isIosSafariEntry(entry) || isAndroidChromeEntry(entry)));
}

function parseBoardTestEnv(env = process.env) {
  const modeRaw = String(env.BOARD_TEST_MODE || "core").trim().toLowerCase();
  const minutesRaw = env.TEST_MINUTES;
  const minutes = minutesRaw == null || minutesRaw === "" ? 60 : Number(minutesRaw);
  const strokesRaw = env.STRESS_STROKES;
  const strokes = strokesRaw == null || strokesRaw === "" ? 30 : Number(strokesRaw);
  const allowed = new Set([
    "quick", "reliability", "tabcycle", "stress", "smoke", "core", "full",
    "permission", "entry", "soak",
  ]);
  const mode = allowed.has(modeRaw) ? modeRaw : "core";
  return {
    mode,
    testMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 60,
    stressStrokes: Number.isFinite(strokes) && strokes > 0 ? Math.min(50, Math.floor(strokes)) : 30,
  };
}

function parseMatrixEnv(env = process.env) {
  const os = String(env.DEVICE_OS || "all").trim().toLowerCase() || "all";
  const kind = String(env.DEVICE_KIND || "all").trim().toLowerCase() || "all";
  const maxRaw = env.MAX_DEVICES;
  const maxDevices = maxRaw == null || maxRaw === "" ? 0 : Number(maxRaw);
  const concRaw = env.DEVICE_CONCURRENCY;
  const concurrency = concRaw == null || concRaw === "" ? 0 : Number(concRaw);
  const board = parseBoardTestEnv(env);
  const deviceNames = String(env.DEVICE_NAME || "")
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const deviceOsVersion = String(env.DEVICE_OS_VERSION || "").trim();
  const matrixSet = String(env.MATRIX_SET || "").trim().toLowerCase();
  return {
    os: os === "ios" || os === "android" ? os : "all",
    kind: kind === "phone" || kind === "tablet" ? kind : "all",
    maxDevices: Number.isFinite(maxDevices) && maxDevices > 0 ? Math.floor(maxDevices) : 0,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 0,
    mode: board.mode,
    testMinutes: board.testMinutes,
    stressStrokes: board.stressStrokes,
    deviceNames,
    deviceOsVersion,
    matrixSet: matrixSet === "all" || matrixSet === "representatives" ? matrixSet : "",
  };
}

function filterEntries(entries, opts = {}) {
  const os = opts.os || "all";
  const kind = opts.kind || "all";
  const names = opts.deviceNames || [];
  const osVersion = opts.deviceOsVersion || "";
  return (entries || []).filter((entry) => {
    const family = osFamily(entry);
    const deviceKind = kindOf(entry);
    if (os !== "all" && family !== os) return false;
    if (kind !== "all" && deviceKind !== kind) return false;
    if (names.length && !names.includes(String(entry.device))) return false;
    if (osVersion && String(entry.os_version) !== osVersion) return false;
    return true;
  });
}

function toRun(entry, orientation) {
  const family = osFamily(entry);
  return {
    device: entry.device,
    osVersion: String(entry.os_version || ""),
    osFamily: family,
    kind: kindOf(entry),
    orientation,
    browserName: family === "ios" ? "safari" : "chrome",
    vendor: family === "android" ? androidVendor(entry.device) : "apple",
  };
}

function expandRuns(entries, { tabletOrientations } = {}) {
  const runs = [];
  const tabletOrs = Array.isArray(tabletOrientations) && tabletOrientations.length
    ? tabletOrientations
    : ["portrait", "landscape"];
  for (const entry of entries) {
    if (kindOf(entry) === "tablet") {
      for (const orientation of tabletOrs) runs.push(toRun(entry, orientation));
    } else {
      runs.push(toRun(entry, "portrait"));
    }
  }
  return runs;
}

function entryKey(entry) {
  return `${entry.device}|${entry.os_version}|${osFamily(entry)}`;
}

function isIphoneProMax(device) {
  return /iPhone\s+\d+\s+Pro\s+Max/i.test(String(device || ""));
}

function isIphonePro(device) {
  return /iPhone\s+\d+\s+Pro(?!\s+Max)/i.test(String(device || ""));
}

function isIphonePlain(device) {
  const d = String(device || "");
  return /iPhone/i.test(d) && !/Pro/i.test(d);
}

function pickFromSorted(sortedEntries) {
  const list = Array.isArray(sortedEntries) ? sortedEntries : [];
  const used = new Set();
  const takeFirst = (pred) => {
    const found = list.find((entry) => pred(entry) && !used.has(entryKey(entry)));
    if (!found) return null;
    used.add(entryKey(found));
    return found;
  };
  const takeLast = (pred) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const entry = list[i];
      if (pred(entry) && !used.has(entryKey(entry))) {
        used.add(entryKey(entry));
        return entry;
      }
    }
    return null;
  };
  const out = [];
  const add = (entry) => {
    if (entry) out.push(entry);
  };
  return { takeFirst, takeLast, add, out };
}

function pickCoverageRepresentatives(sortedEntries) {
  const { takeFirst, takeLast, add, out } = pickFromSorted(sortedEntries);
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "phone" && iphoneGeneration(e.device) >= 12));
  add(
    takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "phone" && iphoneGeneration(e.device) < 12)
    || takeLast((e) => osFamily(e) === "ios" && kindOf(e) === "phone"),
  );
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "tablet"));
  add(takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "phone" && androidVendor(e.device) === "pixel"));
  add(takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "phone" && androidVendor(e.device) === "samsung"));
  add(takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "tablet"));
  return out;
}

function pickQuickRepresentatives(sortedEntries) {
  const { takeFirst, takeLast, add, out } = pickFromSorted(sortedEntries);
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "phone" && isIphoneProMax(e.device)));
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "phone" && isIphonePro(e.device)));
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "phone" && isIphonePlain(e.device) && iphoneGeneration(e.device) >= 12));
  add(
    takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "phone" && iphoneGeneration(e.device) < 12)
    || takeLast((e) => osFamily(e) === "ios" && kindOf(e) === "phone"),
  );
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "tablet"));
  add(takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "phone" && androidVendor(e.device) === "pixel"));
  add(takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "phone" && androidVendor(e.device) === "samsung"));
  add(takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "tablet"));
  return out;
}

function pickDrawStressRepresentatives(sortedEntries) {
  const { takeFirst, add, out } = pickFromSorted(sortedEntries);
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "phone" && iphoneGeneration(e.device) >= 12));
  add(takeFirst((e) => osFamily(e) === "ios" && kindOf(e) === "tablet"));
  add(
    takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "phone" && androidVendor(e.device) === "pixel")
    || takeFirst((e) => osFamily(e) === "android" && kindOf(e) === "phone" && androidVendor(e.device) === "samsung"),
  );
  return out;
}

function pickStressRepresentatives(sortedEntries) {
  return pickCoverageRepresentatives(sortedEntries);
}

function representativePicker(mode) {
  if (mode === "stress") return pickDrawStressRepresentatives;
  if (mode === "quick" || mode === "tabcycle" || mode === "permission" || mode === "entry") {
    return pickQuickRepresentatives;
  }
  if (mode === "reliability" || mode === "smoke") return pickCoverageRepresentatives;
  return null;
}

function shouldUseRepresentatives(opts) {
  if (opts.deviceNames && opts.deviceNames.length) return false;
  if (opts.matrixSet === "all" || opts.mode === "full" || opts.mode === "core") return false;
  if (opts.matrixSet === "representatives") return true;
  return Boolean(representativePicker(opts.mode));
}

function buildDeviceMatrix(catalog, env = process.env) {
  const opts = parseMatrixEnv(env);
  let selected = filterEntries(selectRealMobileEntries(catalog), opts).sort(compareEntries);
  const picker = shouldUseRepresentatives(opts) ? representativePicker(opts.mode) || pickCoverageRepresentatives : null;
  if (picker) selected = picker(selected);
  let runs = uniqueRuns(expandRuns(selected, {
    tabletOrientations: shouldUseRepresentatives(opts) ? ["portrait"] : ["portrait", "landscape"],
  }));
  if (opts.maxDevices > 0) runs = runs.slice(0, opts.maxDevices);
  return { opts, selected, runs };
}

function sanitizeDeviceSlug(run) {
  const raw = [run.device, run.osFamily, run.osVersion, run.orientation]
    .map((part) => String(part || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);
  return raw.join("-") || "device";
}

async function fetchAutomateBrowsers({ username, accessKey }) {
  const auth = Buffer.from(`${username}:${accessKey}`).toString("base64");
  const response = await fetch("https://api.browserstack.com/automate/browsers.json", {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    throw new Error(`BrowserStack automate/browsers.json HTTP ${response.status}`);
  }
  return response.json();
}

module.exports = {
  isRealMobile,
  osFamily,
  kindOf,
  isTabletDevice,
  isIosSafariEntry,
  isAndroidChromeEntry,
  iphoneGeneration,
  compareEntries,
  selectRealMobileEntries,
  parseMatrixEnv,
  filterEntries,
  expandRuns,
  buildDeviceMatrix,
  sanitizeDeviceSlug,
  fetchAutomateBrowsers,
  sortGroup,
  parseBoardTestEnv,
  pickStressRepresentatives,
  pickCoverageRepresentatives,
  pickQuickRepresentatives,
  pickDrawStressRepresentatives,
  uniqueRuns,
  runKey,
};
