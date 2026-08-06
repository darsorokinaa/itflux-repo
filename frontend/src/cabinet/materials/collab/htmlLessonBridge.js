/**
 * Secure postMessage bridge for HTML lessons inside the meeting workspace iframe.
 */

const SOURCE = "lesson-material";
const ROOM_SOURCE = "lesson-room";

const INBOUND_TYPES = new Set([
  "READY",
  "STEP_CHANGED",
  "ANSWER_CHANGED",
  "ANSWER_TYPING",
  "ANSWER_SUBMITTED",
  "NAVIGATION",
  "MEDIA_STATE",
  "VIEWPORT_CHANGED",
  "STATE_SNAPSHOT",
]);

export function createHtmlLessonBridge({
  iframe,
  allowedOrigin = "*",
  onEvent,
}) {
  let destroyed = false;
  let ready = false;
  let materialOrigin = null;

  const handler = (event) => {
    if (destroyed) return;
    if (allowedOrigin !== "*" && event.origin !== allowedOrigin) return;
    if (iframe?.contentWindow && event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.source !== SOURCE) return;
    if (!INBOUND_TYPES.has(data.type)) return;
    if (allowedOrigin === "*" && !materialOrigin) materialOrigin = event.origin;
    if (materialOrigin && event.origin !== materialOrigin) return;
    ready = data.type === "READY" ? true : ready;
    onEvent?.(data, event);
  };

  window.addEventListener("message", handler);

  const post = (type, payload = {}) => {
    if (destroyed || !iframe?.contentWindow) return false;
    const target = materialOrigin || (allowedOrigin === "*" ? "*" : allowedOrigin);
    try {
      iframe.contentWindow.postMessage({
        source: ROOM_SOURCE,
        type,
        payload,
      }, target);
      return true;
    } catch {
      return false;
    }
  };

  return {
    isReady: () => ready,
    requestState: () => post("REQUEST_STATE"),
    applyRemote: (payload) => post("APPLY_REMOTE", payload),
    setMode: (mode, permissions) => post("SET_MODE", { mode, permissions }),
    setPermissions: (permissions) => post("SET_PERMISSIONS", { permissions }),
    destroy: () => {
      destroyed = true;
      window.removeEventListener("message", handler);
    },
  };
}

/** Map HTML lesson events → material collaboration actions. */
export function htmlEventToMaterialOp(message) {
  const type = message?.type;
  const payload = message?.payload || {};
  switch (type) {
    case "STEP_CHANGED":
    case "NAVIGATION":
      return {
        action: "page_changed",
        payload: { page: Number(payload.step || payload.page || 1) },
      };
    case "ANSWER_CHANGED":
    case "ANSWER_TYPING":
      return {
        action: "field_changed",
        payload: {
          fieldId: payload.taskId || payload.fieldId || payload.questionId,
          value: payload.value,
          status: type === "ANSWER_TYPING" ? "draft" : (payload.status || "draft"),
          typing: type === "ANSWER_TYPING",
          updated_at: new Date().toISOString(),
        },
      };
    case "ANSWER_SUBMITTED":
      return {
        action: "answer_selected",
        payload: {
          questionId: payload.taskId || payload.questionId,
          value: payload.value,
          status: "submitted",
          updated_at: new Date().toISOString(),
        },
      };
    case "VIEWPORT_CHANGED":
      return {
        action: "viewport_changed",
        payload: {
          scroll: payload.scroll,
          scrollX: payload.scrollX,
          zoom: payload.zoom,
          page: payload.page,
        },
      };
    case "MEDIA_STATE":
      return {
        action: "state_updated",
        payload: {
          patch: {
            tab: `media:${payload.mediaId || "main"}:${payload.state || "unknown"}`,
          },
        },
      };
    default:
      return null;
  }
}
