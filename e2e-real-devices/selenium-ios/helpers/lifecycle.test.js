const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DeviceRunLifecycle,
  runWithLifecycle,
  sleep,
  sleepUnmanaged,
} = require("./lifecycle");
const { waitFor } = require("./dom");
const { raceWithTimeout, withActionTimeout } = require("./board-health");
const { FlowError } = require("./dom");

test("dispose aborts waitFor and leaves no matrix-owned timers", async () => {
  const life = new DeviceRunLifecycle();
  const browser = {};
  let loops = 0;
  await runWithLifecycle(life, async () => {
    const waiter = waitFor(browser, async () => {
      loops += 1;
      return false;
    }, { timeoutMs: 8_000, intervalMs: 40, message: "still polling" });
    const waiterDone = waiter.then(
      () => {
        throw new Error("waitFor should abort");
      },
      (err) => err,
    );
    await sleepUnmanaged(90);
    const cleanup = await life.dispose();
    const err = await waiterDone;
    assert.match(String(err && err.message), /aborted|disposed/);
    assert.equal(cleanup.status, "PASS");
    assert.equal(cleanup.timers, 0);
    assert.equal(cleanup.browser, null);
    assert.equal(life.timerCount, 0);
  });
  assert.ok(loops < 30, `waitFor kept polling after dispose: ${loops}`);
});

test("dispose waits for tracked pending work before clearing browser", async () => {
  const life = new DeviceRunLifecycle();
  let settled = false;
  await runWithLifecycle(life, async () => {
    life.attachBrowser({ deleteSession: async () => {} });
    life.track(sleepUnmanaged(80).then(() => { settled = true; }));
    const cleanup = await life.dispose({ pendingTimeoutMs: 1_000 });
    assert.equal(settled, true);
    assert.equal(cleanup.pending, 0);
    assert.equal(cleanup.browser, null);
    assert.equal(cleanup.status, "PASS");
  });
});

test("race leftover stays tracked until it settles, then dispose can drain it", async () => {
  const life = new DeviceRunLifecycle();
  await runWithLifecycle(life, async () => {
    let finished = false;
    const hung = sleepUnmanaged(120).then(() => { finished = true; return "done"; });
    const raced = await raceWithTimeout(hung, 20);
    assert.equal(raced.timedOut, true);
    assert.equal(finished, false);
    const cleanup = await life.dispose({ pendingTimeoutMs: 1_000 });
    assert.equal(finished, true);
    assert.equal(cleanup.pending, 0);
    assert.equal(life.browser, null);
  });
});

test("withActionTimeout is TEST BUG, never BOARD FREEZE", async () => {
  const life = new DeviceRunLifecycle();
  await runWithLifecycle(life, async () => {
    await assert.rejects(
      () => withActionTimeout(() => sleepUnmanaged(200), { timeoutMs: 20, label: "10 normal strokes", successCount: 8 }),
      (err) => {
        assert.ok(err instanceof FlowError);
        assert.equal(err.classification, "TEST BUG");
        assert.equal(err.productFailure, false);
        assert.match(err.message, /board action timeout after 20ms: 10 normal strokes/);
        return true;
      },
    );
    await life.dispose();
  });
});

test("sleep stops after abortOperation", async () => {
  const life = new DeviceRunLifecycle();
  await runWithLifecycle(life, async () => {
    const pending = sleep(5_000);
    life.abortOperation();
    await assert.rejects(pending, /aborted/);
    await life.dispose();
  });
});
