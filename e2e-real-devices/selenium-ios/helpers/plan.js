async function fetchAutomatePlan({ username, accessKey }) {
  const auth = Buffer.from(`${username}:${accessKey}`).toString("base64");
  const response = await fetch("https://api.browserstack.com/automate/plan.json", {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) {
    throw new Error(`BrowserStack automate/plan.json HTTP ${response.status}`);
  }
  return response.json();
}

function planMaxAllowed(plan) {
  if (!plan || typeof plan !== "object") return 0;
  const team = Number(plan.team_parallel_sessions_max_allowed);
  const user = Number(plan.parallel_sessions_max_allowed);
  const values = [team, user].filter((n) => Number.isFinite(n) && n > 0);
  return values.length ? Math.min(...values) : 0;
}

function resolveConcurrency({
  configured = 0,
  envFallback = 0,
  planMax = 0,
  running = 0,
  deviceCount = 0,
} = {}) {
  const fromEnv = Number.isFinite(envFallback) && envFallback > 0 ? Math.floor(envFallback) : 0;
  const maxAllowed = (Number.isFinite(planMax) && planMax > 0 ? Math.floor(planMax) : 0) || fromEnv || 5;
  const inUse = Number.isFinite(running) && running > 0 ? Math.floor(running) : 0;
  const available = Math.max(1, maxAllowed - inUse);
  const wanted = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : available;
  const devices = Number.isFinite(deviceCount) && deviceCount > 0 ? Math.floor(deviceCount) : wanted;
  return Math.max(1, Math.min(wanted, available, maxAllowed, devices));
}

module.exports = {
  fetchAutomatePlan,
  planMaxAllowed,
  resolveConcurrency,
};
