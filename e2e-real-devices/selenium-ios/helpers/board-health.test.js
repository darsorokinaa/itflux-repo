const test = require("node:test");
const assert = require("node:assert/strict");
const { FlowError } = require("./dom");
const {
  freezeFail,
  isTestInfraDrawError,
  isSessionDeadError,
  checkpointMinutesFor,
  rethrowAsFreezeIfProven,
} = require("./board-health");

test("checkpoint marks stay within TEST_MINUTES", () => {
  assert.deepEqual(checkpointMinutesFor(60), [0, 10, 20, 30, 45, 60]);
  assert.deepEqual(checkpointMinutesFor(15), [0, 10, 15]);
  assert.deepEqual(checkpointMinutesFor(10), [0, 10]);
});

test("stale/session errors are not freeze", () => {
  const stale = new FlowError("DRAW", "stale canvas during stroke", {
    productFailure: false,
    classification: "TEST BUG",
  });
  assert.equal(isTestInfraDrawError(stale), true);
  assert.equal(isSessionDeadError(new Error("invalid session id")), true);
  assert.equal(isSessionDeadError(new Error("canvas width 0")), false);
});

test("after successful strokes, later product canvas death becomes BOARD FREEZE", () => {
  const err = new FlowError("DRAW", "canvas gone after stroke", {
    productFailure: true,
    classification: "PRODUCT BUG",
  });
  assert.throws(() => rethrowAsFreezeIfProven(err, { successCount: 3, context: "fast strokes" }), (caught) => {
    assert.equal(caught.code, "BOARD FREEZE");
    assert.equal(caught.productFailure, true);
    return true;
  });
});

test("stale after success stays test bug", () => {
  const err = new FlowError("DRAW", "stale canvas during stroke: stale element reference", {
    productFailure: false,
    classification: "TEST BUG",
  });
  assert.throws(() => rethrowAsFreezeIfProven(err, { successCount: 8, context: "fast strokes" }), (caught) => {
    assert.equal(caught.classification, "TEST BUG");
    assert.equal(caught.code, "DRAW");
    return true;
  });
});

test("freezeFail is product failure", () => {
  const err = freezeFail("canvas width 0 after it worked");
  assert.equal(err.code, "BOARD FREEZE");
  assert.equal(err.productFailure, true);
});

test("stroke timing stats use completed strokes only", () => {
  const { strokeTimingStats } = require("./board-health");
  const stats = strokeTimingStats([
    { actionCompleted: true, durationMs: 2840 },
    { actionCompleted: true, durationMs: 3112 },
    { actionCompleted: true, durationMs: 4500 },
    { actionCompleted: true, durationMs: 5200 },
    { actionCompleted: false, durationMs: 90000, error: "hang" },
  ]);
  assert.equal(stats.firstStrokeMs, 2840);
  assert.equal(stats.lastStrokeMs, 5200);
  assert.equal(stats.maxStrokeMs, 5200);
  assert.equal(stats.medianStrokeMs, 3806);
});

test("slow completed remote strokes are not freeze", () => {
  const { classifyMeasuredStrokeFailure } = require("./board-health");
  const err = classifyMeasuredStrokeFailure({
    record: {
      index: 10,
      actionCompleted: true,
      durationMs: 6200,
      error: null,
    },
    successCount: 9,
    probe: { sessionAlive: true, domResponds: true, canvasFound: true, canvasWidth: 390, canvasHeight: 500 },
  });
  assert.equal(err.classification, "TEST BUG");
  assert.equal(err.productFailure, false);
});

test("hang with canvas still found after prior strokes is BOARD FREEZE", () => {
  const { classifyMeasuredStrokeFailure } = require("./board-health");
  const err = classifyMeasuredStrokeFailure({
    record: {
      index: 7,
      actionCompleted: false,
      error: "stroke action hang after 90000ms",
    },
    successCount: 6,
    probe: {
      sessionAlive: true,
      domResponds: true,
      canvasFound: true,
      canvasWidth: 390,
      canvasHeight: 500,
    },
  });
  assert.equal(err.code, "BOARD FREEZE");
  assert.equal(err.productFailure, true);
});

test("stale/actions/frame errors stay TEST BUG even after prior strokes", () => {
  const { classifyMeasuredStrokeFailure } = require("./board-health");
  for (const error of [
    "stale element reference: element is not attached to the page document",
    'when running "actions" with method "POST"',
    "Can't switch to frame with selector iframe.video-lesson-workspace__frame--board because it doesn't exist",
  ]) {
    const err = classifyMeasuredStrokeFailure({
      record: { index: 7, actionCompleted: false, error },
      successCount: 6,
      probe: { sessionAlive: true, domResponds: true, canvasFound: true, canvasWidth: 390, canvasHeight: 500 },
    });
    assert.equal(err.classification, "TEST BUG", error);
    assert.equal(err.productFailure, false, error);
  }
});

test("hang without DOM response is TEST BUG, not freeze", () => {
  const { classifyMeasuredStrokeFailure } = require("./board-health");
  const err = classifyMeasuredStrokeFailure({
    record: {
      index: 3,
      actionCompleted: false,
      error: "stroke action hang after 90000ms; liveness probe also did not complete",
    },
    successCount: 2,
    probe: { sessionAlive: true, domResponds: false, canvasFound: false },
  });
  assert.equal(err.classification, "TEST BUG");
  assert.equal(err.productFailure, false);
});

test("hang with DOM responding and canvas gone after prior strokes is BOARD FREEZE", () => {
  const { classifyMeasuredStrokeFailure } = require("./board-health");
  const err = classifyMeasuredStrokeFailure({
    record: {
      index: 4,
      actionCompleted: false,
      error: "stroke action hang after 90000ms",
    },
    successCount: 3,
    probe: { sessionAlive: true, domResponds: true, canvasFound: false, canvasWidth: 0, canvasHeight: 0 },
  });
  assert.equal(err.code, "BOARD FREEZE");
  assert.equal(err.productFailure, true);
});
