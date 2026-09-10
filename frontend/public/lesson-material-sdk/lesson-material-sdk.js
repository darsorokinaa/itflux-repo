/**
 * Minimal HTML lesson SDK for materials embedded in the lesson room.
 * Include: <script src="/lesson-material-sdk/lesson-material-sdk.js"></script>
 *
 * Outbound (iframe → room):
 *   window.LessonMaterial.post({ type: "ANSWER_CHANGED", payload: { taskId, value } })
 *   window.lessonBridge.emitStateChange(change)
 *
 * Inbound (room → iframe): APPLY_REMOTE, SET_STATE, SET_MODE, SET_PERMISSIONS, REQUEST_STATE
 */
(function (global) {
  var SOURCE = "lesson-material";
  var ROOM_SOURCE = "lesson-room";
  var parentOrigin = "*";
  var handlers = {};
  var applyingRemote = false;
  var state = {};
  var stateListeners = [];

  function post(type, payload) {
    if (!global.parent || global.parent === global) return;
    global.parent.postMessage({
      source: SOURCE,
      type: type,
      payload: payload || {},
    }, parentOrigin);
  }

  function clone(value) {
    try {
      return JSON.parse(JSON.stringify(value || {}));
    } catch {
      return {};
    }
  }

  function onMessage(event) {
    var data = event.data;
    if (!data || typeof data !== "object" || data.source !== ROOM_SOURCE) return;
    if (parentOrigin === "*" && event.origin) parentOrigin = event.origin;
    if (parentOrigin !== "*" && event.origin !== parentOrigin) return;
    var type = data.type;
    var payload = data.payload || {};
    if (typeof handlers[type] === "function") handlers[type](payload, data);
    if (type === "APPLY_REMOTE" || type === "SET_STATE") {
      applyingRemote = true;
      try {
        if (payload && typeof payload === "object") {
          state = Object.assign({}, state, payload.state || payload);
        }
        stateListeners.forEach(function (fn) {
          try { fn(clone(state), payload); } catch (err) { /* ignore */ }
        });
      } finally {
        applyingRemote = false;
      }
    }
    if (type === "REQUEST_STATE") {
      post("STATE_SNAPSHOT", { state: clone(state) });
    }
  }

  global.addEventListener("message", onMessage);

  var lessonBridge = {
    getState: function () { return clone(state); },
    setState: function (next) {
      state = clone(next || {});
    },
    onStateChange: function (fn) {
      if (typeof fn === "function") stateListeners.push(fn);
      return function () {
        stateListeners = stateListeners.filter(function (item) { return item !== fn; });
      };
    },
    emitStateChange: function (change) {
      if (applyingRemote) return;
      var patch = change && typeof change === "object" ? change : { value: change };
      state = Object.assign({}, state, patch.state || patch);
      post("STATE_CHANGED", { state: clone(state), patch: patch });
    },
    isApplyingRemote: function () { return applyingRemote; },
  };

  global.lessonBridge = lessonBridge;
  global.LessonMaterial = {
    ready: function (meta) {
      post("READY", Object.assign({ sdk: "1.1.0", supportsCollaborativeState: true }, meta || {}));
    },
    post: post,
    on: function (type, fn) {
      handlers[type] = fn;
    },
    answerChanged: function (taskId, value, status) {
      if (applyingRemote) return;
      post("ANSWER_CHANGED", { taskId: taskId, value: value, status: status || "draft" });
    },
    answerTyping: function (taskId, value) {
      if (applyingRemote) return;
      post("ANSWER_TYPING", { taskId: taskId, value: value, status: "draft" });
    },
    answerSubmitted: function (taskId, value) {
      if (applyingRemote) return;
      post("ANSWER_SUBMITTED", { taskId: taskId, value: value, status: "submitted" });
    },
    stepChanged: function (step, extra) {
      if (applyingRemote) return;
      post("STEP_CHANGED", Object.assign({ step: step, page: step }, extra || {}));
    },
    viewportChanged: function (viewport) {
      if (applyingRemote) return;
      post("VIEWPORT_CHANGED", viewport || {});
    },
    mediaState: function (mediaId, mediaState, currentTime) {
      if (applyingRemote) return;
      post("MEDIA_STATE", { mediaId: mediaId, state: mediaState, currentTime: currentTime });
    },
    bridge: lessonBridge,
  };

  function autoBindSlides() {
    var slides = global.document.querySelectorAll(".deck .slide, .reveal .slides > section, [data-slide], .slide");
    if (!slides.length) return;
    var last = -1;
    function currentIndex() {
      for (var i = 0; i < slides.length; i += 1) {
        var el = slides[i];
        if (el.classList.contains("active") || el.classList.contains("present") || el.classList.contains("is-active")) {
          return i;
        }
      }
      return 0;
    }
    function emitIfChanged() {
      if (applyingRemote) return;
      var idx = currentIndex();
      if (idx === last) return;
      last = idx;
      var slide = slides[idx];
      global.LessonMaterial.stepChanged(idx + 1, {
        slideIndex: idx + 1,
        slideId: slide.id || slide.getAttribute("data-slide-id") || ("slide-" + (idx + 1)),
      });
    }
    global.document.addEventListener("click", function () {
      global.setTimeout(emitIfChanged, 0);
    }, true);
    global.document.addEventListener("keydown", function () {
      global.setTimeout(emitIfChanged, 0);
    }, true);
    emitIfChanged();
  }

  function autoBindFields() {
    global.document.addEventListener("input", function (event) {
      if (applyingRemote) return;
      var el = event.target;
      if (!el || !el.tagName) return;
      if (["INPUT", "TEXTAREA", "SELECT"].indexOf(el.tagName) < 0) return;
      var id = el.getAttribute("data-sync-id") || el.getAttribute("data-field-id") || el.name || el.id;
      if (!id) return;
      var value = (el.type === "checkbox") ? el.checked : el.value;
      global.LessonMaterial.answerTyping(id, value);
    }, true);
    global.document.addEventListener("change", function (event) {
      if (applyingRemote) return;
      var el = event.target;
      if (!el || !el.tagName) return;
      if (["INPUT", "TEXTAREA", "SELECT"].indexOf(el.tagName) < 0) return;
      var id = el.getAttribute("data-sync-id") || el.getAttribute("data-field-id") || el.name || el.id;
      if (!id) return;
      var value = (el.type === "checkbox") ? el.checked : el.value;
      global.LessonMaterial.answerChanged(id, value);
    }, true);
  }

  handlers.APPLY_REMOTE = function (payload) {
    var page = Number((payload && (payload.page || payload.slideIndex || payload.step)) || 0);
    if (page < 1) return;
    var slides = global.document.querySelectorAll(".deck .slide, .reveal .slides > section, [data-slide], .slide");
    if (!slides.length) return;
    var idx = Math.max(0, Math.min(slides.length - 1, page - 1));
    for (var i = 0; i < slides.length; i += 1) {
      var on = i === idx;
      slides[i].classList.toggle("active", on);
      slides[i].classList.toggle("present", on);
      slides[i].hidden = !on;
      slides[i].setAttribute("aria-hidden", on ? "false" : "true");
    }
  };

  if (global.document && global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", function () {
      autoBindSlides();
      autoBindFields();
      post("READY", { sdk: "1.1.0", supportsCollaborativeState: true });
    });
  } else {
    autoBindSlides();
    autoBindFields();
    post("READY", { sdk: "1.1.0", supportsCollaborativeState: true });
  }
})(typeof window !== "undefined" ? window : this);
