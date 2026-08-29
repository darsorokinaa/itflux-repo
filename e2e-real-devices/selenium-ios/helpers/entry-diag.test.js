const test = require("node:test");
const assert = require("node:assert/strict");
const { firstDivergence, classifyEntryFailure } = require("./entry-diag");
const { summarizeRuns } = require("../entry-repeat");

test("first divergence is the first mismatched timeline event", () => {
  const pass = {
    events: [
      { name: "T0_NAVIGATION" },
      { name: "T1_MEETING_API" },
      { name: "T2_PREJOIN_RENDERED" },
      { name: "T3_WITHOUT_CAMERA_RENDERED" },
    ],
  };
  const fail = {
    events: [
      { name: "T0_NAVIGATION" },
      { name: "T1_MEETING_API" },
    ],
  };
  const found = firstDivergence(pass, fail);
  assert.equal(found.passEvent, "T2_PREJOIN_RENDERED");
  assert.equal(found.failEvent, null);
  assert.equal(found.failLast, "T1_MEETING_API");
});

test("neither prejoin nor live with a live session is INTERMITTENT_PRODUCTION_SUSPECT", () => {
  const classified = classifyEntryFailure({
    sessionAlive: true,
    staleElementCount: 2,
    snapshot: {
      inferredPageState: "loading",
      cameraWithoutDisplayed: false,
      liveUi: false,
      roomRoot: { exists: true, displayed: true },
    },
  });
  assert.equal(classified.classification, "INTERMITTENT_PRODUCTION_SUSPECT");
  assert.equal(classified.productFailure, false);
});

test("stale while UI is actually present is TEST_BUG", () => {
  const classified = classifyEntryFailure({
    sessionAlive: true,
    staleElementCount: 2,
    snapshot: {
      inferredPageState: "camera",
      cameraWithoutDisplayed: true,
      liveUi: false,
      roomRoot: { exists: true },
    },
  });
  assert.equal(classified.classification, "TEST_BUG");
});

test("independent runs are counted separately and retry is not collapsed to PASS", () => {
  const summary = summarizeRuns([
    { RESULT: "fail", classification: "INTERMITTENT_PRODUCTION_SUSPECT", timeline: { events: [{ name: "T0_NAVIGATION" }] } },
    { RESULT: "pass", classification: "PASS", timeline: { events: [{ name: "T0_NAVIGATION" }, { name: "T2_PREJOIN_RENDERED" }] } },
  ]);
  assert.equal(summary.TOTAL_ATTEMPTS, 2);
  assert.equal(summary.PASS, 1);
  assert.equal(summary.FAIL, 1);
  assert.equal(summary.FAIL_RATE, 50);
  assert.equal(summary.PRODUCT_FAIL_CONFIRMED, false);
});

test("two independent suspect fails confirm PRODUCT_FAIL candidate", () => {
  const summary = summarizeRuns([
    { RESULT: "fail", classification: "INTERMITTENT_PRODUCTION_SUSPECT", timeline: { events: [{ name: "T0_NAVIGATION" }] } },
    { RESULT: "fail", classification: "INTERMITTENT_PRODUCTION_SUSPECT", timeline: { events: [{ name: "T0_NAVIGATION" }] } },
    { RESULT: "pass", classification: "PASS", timeline: { events: [{ name: "T0_NAVIGATION" }, { name: "T9_LIVE_UI" }] } },
  ]);
  assert.equal(summary.PRODUCT_FAIL_CONFIRMED, true);
  assert.equal(summary.FAIL, 2);
  assert.equal(summary.PASS, 1);
});
