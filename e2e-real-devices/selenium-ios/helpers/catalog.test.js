const test = require("node:test");
const assert = require("node:assert/strict");
const {
  selectRealMobileEntries,
  filterEntries,
  expandRuns,
  buildDeviceMatrix,
  parseMatrixEnv,
  sanitizeDeviceSlug,
  compareEntries,
} = require("./catalog");

const catalog = [
  { os: "ios", os_version: "16", browser: "iphone", device: "iPhone 11", real_mobile: true },
  { os: "ios", os_version: "17", browser: "safari", device: "iPhone 15 Pro Max", real_mobile: true },
  { os: "ios", os_version: "16", browser: "safari", device: "iPhone 15 Pro Max", real_mobile: true },
  { os: "ios", os_version: "17", browser: "chrome", device: "iPhone 15", real_mobile: true },
  { os: "ios", os_version: "17", browser: "safari", device: "iPad Air 5", real_mobile: true },
  { os: "android", os_version: "14.0", browser: "chrome", device: "Google Pixel 8", real_mobile: true },
  { os: "android", os_version: "13.0", browser: "chrome", device: "Samsung Galaxy S23", real_mobile: true },
  { os: "android", os_version: "13.0", browser: "chrome", device: "OnePlus 11", real_mobile: true },
  { os: "android", os_version: "12.0", browser: "chrome", device: "Samsung Galaxy Tab S8", real_mobile: true },
  { os: "android", os_version: "13.0", browser: "firefox", device: "Google Pixel 7", real_mobile: true },
  { os: "Windows", os_version: "11", browser: "chrome", device: null, real_mobile: false },
  { os: "ios", os_version: "17", browser: "safari", device: "iPhone 15 Pro Max", real_mobile: "true" },
];

test("selects unique real mobile iOS Safari and Android Chrome pairs from API catalog", () => {
  const selected = selectRealMobileEntries(catalog);
  const keys = selected.map((e) => `${e.device}|${e.os_version}`);
  assert.deepEqual(keys.sort(), [
    "Google Pixel 8|14.0",
    "OnePlus 11|13.0",
    "Samsung Galaxy S23|13.0",
    "Samsung Galaxy Tab S8|12.0",
    "iPad Air 5|17",
    "iPhone 11|16",
    "iPhone 15 Pro Max|16",
    "iPhone 15 Pro Max|17",
  ].sort());
});

test("sorts new iPhone, old iPhone, iPad, Pixel, Samsung, other Android, Android tablet", () => {
  const selected = selectRealMobileEntries(catalog).sort(compareEntries);
  assert.deepEqual(selected.map((e) => e.device), [
    "iPhone 15 Pro Max",
    "iPhone 15 Pro Max",
    "iPhone 11",
    "iPad Air 5",
    "Google Pixel 8",
    "Samsung Galaxy S23",
    "OnePlus 11",
    "Samsung Galaxy Tab S8",
  ]);
});

test("tablets expand to portrait and landscape; phones stay portrait", () => {
  const runs = expandRuns(selectRealMobileEntries(catalog).sort(compareEntries));
  const ipad = runs.filter((r) => r.device === "iPad Air 5");
  assert.equal(ipad.length, 2);
  assert.deepEqual(ipad.map((r) => r.orientation), ["portrait", "landscape"]);
  const phone = runs.find((r) => r.device === "iPhone 15 Pro Max");
  assert.equal(phone.orientation, "portrait");
  const tab = runs.filter((r) => r.device === "Samsung Galaxy Tab S8");
  assert.equal(tab.length, 2);
});

test("MAX_DEVICES slices sorted runs; 0 keeps all", () => {
  const limited = buildDeviceMatrix(catalog, { MAX_DEVICES: "3" });
  assert.equal(limited.runs.length, 3);
  assert.equal(limited.runs[0].device, "iPhone 15 Pro Max");
  const all = buildDeviceMatrix(catalog, { MAX_DEVICES: "0" });
  assert.equal(all.runs.length, expandRuns(selectRealMobileEntries(catalog).sort(compareEntries)).length);
});

test("DEVICE_OS and DEVICE_KIND filters", () => {
  const iosPhones = filterEntries(selectRealMobileEntries(catalog), { os: "ios", kind: "phone" });
  assert.ok(iosPhones.every((e) => /iPhone/i.test(e.device)));
  const android = filterEntries(selectRealMobileEntries(catalog), { os: "android", kind: "all" });
  assert.ok(android.every((e) => e.os === "android"));
  const tablets = filterEntries(selectRealMobileEntries(catalog), { os: "all", kind: "tablet" });
  assert.deepEqual(tablets.map((e) => e.device).sort(), ["Samsung Galaxy Tab S8", "iPad Air 5"]);
});

test("parseMatrixEnv defaults", () => {
  assert.deepEqual(parseMatrixEnv({}), {
    os: "all",
    kind: "all",
    maxDevices: 0,
    concurrency: 1,
    mode: "core",
    testMinutes: 60,
    deviceNames: [],
    deviceOsVersion: "",
    matrixSet: "",
  });
  assert.equal(parseMatrixEnv({ DEVICE_CONCURRENCY: "3" }).concurrency, 3);
  assert.equal(parseMatrixEnv({ DEVICE_CONCURRENCY: "0" }).concurrency, 1);
  assert.equal(parseMatrixEnv({ BOARD_TEST_MODE: "core" }).mode, "core");
  assert.equal(parseMatrixEnv({ BOARD_TEST_MODE: "smoke" }).mode, "smoke");
  assert.equal(parseMatrixEnv({ BOARD_TEST_MODE: "stress", TEST_MINUTES: "45" }).mode, "stress");
  assert.equal(parseMatrixEnv({ BOARD_TEST_MODE: "quick" }).mode, "quick");
  assert.equal(parseMatrixEnv({ BOARD_TEST_MODE: "stress", TEST_MINUTES: "45" }).testMinutes, 45);
});

test("sanitizeDeviceSlug is filesystem-safe", () => {
  const slug = sanitizeDeviceSlug({
    device: "Samsung Galaxy S23",
    osFamily: "android",
    osVersion: "13.0",
    orientation: "portrait",
  });
  assert.equal(slug, "samsung-galaxy-s23-android-13-0-portrait");
  assert.equal(/[^a-z0-9-]/.test(slug), false);
});

test("DEVICE_NAME is exact and does not match Pro variants", () => {
  const only = buildDeviceMatrix([
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17", real_mobile: true },
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17 Pro", real_mobile: true },
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17 Pro Max", real_mobile: true },
  ], { DEVICE_NAME: "iPhone 17", DEVICE_OS_VERSION: "26" });
  assert.deepEqual(only.runs.map((r) => r.device), ["iPhone 17"]);
  const three = buildDeviceMatrix([
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17", real_mobile: true },
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17 Pro", real_mobile: true },
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17 Pro Max", real_mobile: true },
  ], { DEVICE_NAME: "iPhone 17,iPhone 17 Pro,iPhone 17 Pro Max", DEVICE_OS_VERSION: "26" });
  assert.equal(three.runs.length, 3);
});

test("stress matrix picks one representative per device class, portrait only for tablets", () => {
  const stress = buildDeviceMatrix(catalog, { BOARD_TEST_MODE: "stress" });
  assert.deepEqual(stress.selected.map((e) => e.device), [
    "iPhone 15 Pro Max",
    "iPhone 11",
    "iPad Air 5",
    "Google Pixel 8",
    "Samsung Galaxy S23",
    "Samsung Galaxy Tab S8",
  ]);
  assert.ok(stress.runs.every((r) => r.orientation === "portrait"));
  assert.equal(stress.runs.length, 6);
});

test("quick matrix uses representatives, not the full catalog", () => {
  const quick = buildDeviceMatrix(catalog, { BOARD_TEST_MODE: "quick" });
  assert.equal(quick.runs.length, 6);
  assert.ok(quick.runs.every((r) => r.orientation === "portrait"));
});

test("smoke matrix uses representatives, not the full catalog", () => {
  const smoke = buildDeviceMatrix(catalog, { BOARD_TEST_MODE: "smoke" });
  assert.equal(smoke.runs.length, 6);
  assert.deepEqual(smoke.selected.map((e) => e.device), [
    "iPhone 15 Pro Max",
    "iPhone 11",
    "iPad Air 5",
    "Google Pixel 8",
    "Samsung Galaxy S23",
    "Samsung Galaxy Tab S8",
  ]);
});

test("core matrix keeps all unique device/os/browser/orientation combos", () => {
  const core = buildDeviceMatrix(catalog, { BOARD_TEST_MODE: "core" });
  const keys = core.runs.map((r) => `${r.device}|${r.osVersion}|${r.browserName}|${r.orientation}`);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(core.runs.length > 6);
  const ipad = core.runs.filter((r) => r.device === "iPad Air 5");
  assert.deepEqual(ipad.map((r) => r.orientation), ["portrait", "landscape"]);
});

test("duplicate catalog rows collapse to one run", () => {
  const duped = [
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17", real_mobile: true },
    { os: "ios", os_version: "26", browser: "safari", device: "iPhone 17", real_mobile: true },
    { os: "ios", os_version: "17", browser: "safari", device: "iPhone 17", real_mobile: true },
  ];
  const matrix = buildDeviceMatrix(duped, { BOARD_TEST_MODE: "core" });
  assert.deepEqual(matrix.runs.map((r) => `${r.device}|${r.osVersion}`), ["iPhone 17|26", "iPhone 17|17"]);
});
