const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveConcurrency, planMaxAllowed } = require("./plan");

test("concurrency uses BrowserStack max and does not default to 1 when plan allows more", () => {
  assert.equal(resolveConcurrency({
    configured: 0,
    planMax: 6,
    running: 0,
    deviceCount: 8,
  }), 6);
  assert.equal(resolveConcurrency({
    configured: 2,
    planMax: 6,
    running: 0,
    deviceCount: 8,
  }), 2);
  assert.equal(resolveConcurrency({
    configured: 0,
    planMax: 6,
    running: 4,
    deviceCount: 10,
  }), 2);
  assert.equal(resolveConcurrency({
    configured: 0,
    envFallback: 5,
    deviceCount: 3,
  }), 3);
});

test("planMaxAllowed takes the tighter of team and user caps", () => {
  assert.equal(planMaxAllowed({
    parallel_sessions_max_allowed: 10,
    team_parallel_sessions_max_allowed: 6,
  }), 6);
});
