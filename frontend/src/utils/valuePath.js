/** Value-first funnel helpers. Reuses Metrika trackGoal; no new ActivationEvent names. */

import { trackGoal } from "./analytics";

export const FIRST_VISIT_KEY = "itflux_first_visit_at";
export const VALUE_REACHED_KEY = "itflux_value_reached";

export function markFirstVisit() {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!sessionStorage.getItem(FIRST_VISIT_KEY)) {
      sessionStorage.setItem(FIRST_VISIT_KEY, String(Date.now()));
    }
  } catch {
    /* ignore */
  }
}

export function secondsSinceFirstVisit() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const started = Number(sessionStorage.getItem(FIRST_VISIT_KEY) || "");
    if (!started) return null;
    return Math.max(0, Math.round((Date.now() - started) / 1000));
  } catch {
    return null;
  }
}

export function trackValueGoal(name, params = {}) {
  if (!name) return;
  const seconds = secondsSinceFirstVisit();
  trackGoal(name, {
    ...params,
    ...(seconds != null ? { seconds_to_event: seconds } : {}),
  });
}

export function rememberValueReached(kind) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(VALUE_REACHED_KEY, String(kind || "value"));
  } catch {
    /* ignore */
  }
}

export function readValueReached() {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(VALUE_REACHED_KEY) || "";
  } catch {
    return "";
  }
}

export function inferValueIntent(path) {
  const raw = String(path || "").trim();
  const p = raw.split("?")[0] || "";
  if (p.startsWith("/lessons") || p.startsWith("/gotovye-uroki")) return "lesson";
  if (p.startsWith("/interesting")) return "lesson";
  if (
    p.startsWith("/generator")
    || p.startsWith("/subject")
    || p.startsWith("/tasks")
    || /^\/(oge|ege|vpr)(\/|$)/.test(p)
  ) {
    return "tasks";
  }
  if (p.startsWith("/repetitor")) return "students";
  if (p.startsWith("/cabinet") && !p.startsWith("/cabinet/login")) return "students";
  return "";
}

export function authLeadForIntent(intent, mode) {
  if (mode !== "register") return "";
  if (intent === "lesson") {
    return "Создайте аккаунт, чтобы открыть этот урок. Он сохранится в вашем кабинете.";
  }
  if (intent === "tasks") {
    return "Создайте аккаунт, чтобы сохранить собранный вариант и продолжить работу с заданиями.";
  }
  if (intent === "students") {
    return "Создайте аккаунт, чтобы настроить работу с учениками в кабинете.";
  }
  return "";
}

export function authSearchWithNext(returnUrl, { mode = "register" } = {}) {
  const params = new URLSearchParams();
  if (mode) params.set("mode", mode);
  if (returnUrl) params.set("next", returnUrl);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
