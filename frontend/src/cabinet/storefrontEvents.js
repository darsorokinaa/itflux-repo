import { ensureCsrfCookie } from "../utils/cabinetAuth";

const ALLOWED = new Set(["pricing_view", "tariff_click", "promo_applied"]);

function csrfToken() {
  const match = typeof document !== "undefined"
    ? document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
    : null;
  return match ? decodeURIComponent(match[1]) : "";
}

function rememberKey(eventName, extra) {
  const storageKey = `sf:${eventName}:${extra || "once"}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const key = `${eventName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(storageKey, key);
    return key;
  } catch {
    return `${eventName}-${extra || "once"}`;
  }
}

export async function trackStorefront(eventName, metadata = {}, extra = "") {
  if (!ALLOWED.has(eventName) || typeof window === "undefined") return false;
  try {
    await ensureCsrfCookie();
    const csrf = csrfToken();
    await fetch("/api/cabinet/pricing/events/", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
      },
      body: JSON.stringify({
        event_name: eventName,
        metadata,
        idempotency_key: rememberKey(eventName, extra || metadata.plan_slug || metadata.promo_code || ""),
      }),
    });
    return true;
  } catch {
    return false;
  }
}
