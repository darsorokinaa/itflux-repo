import { execSync } from "node:child_process";

/** Build id: CI/env → git short hash + UTC stamp → fallback. */
export function resolveAppVersion() {
  const fromEnv = (process.env.VITE_APP_VERSION || process.env.APP_VERSION || "").trim();
  if (fromEnv) return fromEnv;

  let git = "";
  try {
    git = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    git = "";
  }

  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  if (git) return `${stamp}-${git}`;
  return `${stamp}-local`;
}

export function resolveBuildTime() {
  return new Date().toISOString();
}
