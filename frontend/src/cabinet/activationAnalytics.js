/** Teacher activation intent events. Confirmed actions are written by the backend. */

import { ensureCsrfCookie } from "../utils/cabinetAuth";

export const INTENT_EVENTS = new Set([
  "add_student_cta_viewed",
  "add_student_clicked",
  "student_form_opened",
  "student_form_validation_failed",
  "student_invite_copy_clicked",
  "student_invite_share_clicked",
  "student_invite_registration_started",
  "subject_creation_started",
  "lesson_creation_started",
]);

const SENT_PREFIX = "ae:";

function getCsrfToken() {
  const match = typeof document !== "undefined"
    ? document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
    : null;
  return match ? decodeURIComponent(match[1]) : "";
}

function clientSessionId() {
  if (typeof window === "undefined") return "";
  try {
    const key = "cabinet-activation-session";
    let value = window.sessionStorage.getItem(key);
    if (!value) {
      value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return "";
  }
}

function rememberSent(key) {
  if (typeof window === "undefined") return false;
  try {
    const storageKey = SENT_PREFIX + key;
    if (window.sessionStorage.getItem(storageKey) === "1") return true;
    window.sessionStorage.setItem(storageKey, "1");
    return false;
  } catch {
    return false;
  }
}

export function activationIdempotencyKey(eventName, extra = "") {
  return extra ? `${eventName}:${extra}` : eventName;
}

export async function trackActivationIntent(eventName, {
  objectId = null,
  objectType = "",
  source = "",
  metadata = {},
  idempotencyKey = "",
} = {}) {
  if (!INTENT_EVENTS.has(eventName)) return false;
  const key = idempotencyKey || activationIdempotencyKey(eventName, objectId || "user");
  if (rememberSent(key)) return false;
  try {
    await ensureCsrfCookie();
    const csrf = getCsrfToken();
    await fetch("/api/cabinet/activation-events/", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
      },
      body: JSON.stringify({
        event_name: eventName,
        object_id: objectId,
        object_type: objectType,
        source,
        metadata,
        idempotency_key: key,
        client_session_id: clientSessionId(),
      }),
    });
    return true;
  } catch {
    return false;
  }
}

export {
  ACQUISITION_STORAGE_KEY,
  captureAcquisition,
  readAcquisition,
  readPromoCode,
  savePromoCode,
} from "./visitContext";
