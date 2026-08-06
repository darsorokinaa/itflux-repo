/**
 * Minimal HTML lesson SDK for materials embedded in the lesson room.
 * Include: <script src="/lesson-material-sdk/lesson-material-sdk.js"></script>
 *
 * Outbound (iframe → room):
 *   window.LessonMaterial.post({ type: "ANSWER_CHANGED", payload: { taskId, value } })
 *
 * Inbound (room → iframe): APPLY_REMOTE, SET_MODE, SET_PERMISSIONS, REQUEST_STATE
 */
(function (global) {
  var SOURCE = "lesson-material";
  var ROOM_SOURCE = "lesson-room";
  var parentOrigin = "*";
  var handlers = {};

  function post(type, payload) {
    if (!global.parent || global.parent === global) return;
    global.parent.postMessage({
      source: SOURCE,
      type: type,
      payload: payload || {},
    }, parentOrigin);
  }

  function onMessage(event) {
    var data = event.data;
    if (!data || typeof data !== "object" || data.source !== ROOM_SOURCE) return;
    if (parentOrigin === "*" && event.origin) parentOrigin = event.origin;
    if (parentOrigin !== "*" && event.origin !== parentOrigin) return;
    var type = data.type;
    var payload = data.payload || {};
    if (typeof handlers[type] === "function") handlers[type](payload, data);
    if (type === "REQUEST_STATE" && typeof handlers.STATE_SNAPSHOT === "function") {
      /* consumer may reply via post STATE_SNAPSHOT */
    }
  }

  global.addEventListener("message", onMessage);

  global.LessonMaterial = {
    ready: function (meta) {
      post("READY", meta || {});
    },
    post: post,
    on: function (type, fn) {
      handlers[type] = fn;
    },
    answerChanged: function (taskId, value, status) {
      post("ANSWER_CHANGED", { taskId: taskId, value: value, status: status || "draft" });
    },
    answerTyping: function (taskId, value) {
      post("ANSWER_TYPING", { taskId: taskId, value: value, status: "draft" });
    },
    answerSubmitted: function (taskId, value) {
      post("ANSWER_SUBMITTED", { taskId: taskId, value: value, status: "submitted" });
    },
    stepChanged: function (step) {
      post("STEP_CHANGED", { step: step, page: step });
    },
    viewportChanged: function (viewport) {
      post("VIEWPORT_CHANGED", viewport || {});
    },
    mediaState: function (mediaId, state, currentTime) {
      post("MEDIA_STATE", { mediaId: mediaId, state: state, currentTime: currentTime });
    },
  };

  post("READY", { sdk: "1.0.0" });
})(typeof window !== "undefined" ? window : this);
