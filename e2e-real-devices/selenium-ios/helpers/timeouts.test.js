const test = require("node:test");
const assert = require("node:assert/strict");
const { TIMEOUTS, deviceRunTimeoutMs, withWatchdog } = require("./timeouts");
const { DeviceRunLifecycle, runWithLifecycle, sleep } = require("./lifecycle");

test("quick device run budget is minutes, not hours", () => {
  assert.equal(TIMEOUTS.STROKE_HANG, 25_000);
  assert.ok(deviceRunTimeoutMs("quick") <= 6 * 60_000);
  assert.ok(deviceRunTimeoutMs("reliability") <= 8 * 60_000);
  assert.ok(deviceRunTimeoutMs("stress") <= 16 * 60_000);
});

test("watchdog fails fast instead of hanging", async () => {
  const life = new DeviceRunLifecycle();
  await runWithLifecycle(life, async () => {
    await assert.rejects(
      () => withWatchdog(() => sleep(5_000), { timeoutMs: 40, label: "hung command" }),
      /did not finish within 40ms/,
    );
  });
});
