/**
 * Same-origin fallback for ready lessons / HTML embeds without lessonBridge.
 * Does not use MutationObserver as the source of truth — listens to input/click
 * and infers the active slide from known deck selectors.
 */

const SLIDE_SELECTORS = [
  ".deck .slide",
  ".reveal .slides > section",
  "[data-slide]",
  ".slide",
];

function querySlides(doc) {
  if (!doc) return [];
  for (const sel of SLIDE_SELECTORS) {
    const found = Array.from(doc.querySelectorAll(sel));
    if (found.length) return found;
  }
  return [];
}

function activeSlideIndex(slides) {
  const idx = slides.findIndex((el) => (
    el.classList.contains("active")
    || el.classList.contains("present")
    || el.classList.contains("is-active")
    || el.getAttribute("aria-hidden") === "false"
  ));
  return idx >= 0 ? idx : slides.findIndex((el) => el.offsetParent !== null);
}

function fieldIdOf(el) {
  return el.getAttribute("data-sync-id")
    || el.getAttribute("data-field-id")
    || el.getAttribute("name")
    || el.id
    || "";
}

function collectFields(doc) {
  const fields = {};
  if (!doc) return fields;
  const nodes = doc.querySelectorAll("input, textarea, select, [data-sync-id]");
  nodes.forEach((el) => {
    const id = fieldIdOf(el);
    if (!id) return;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      fields[id] = el.type === "checkbox" ? el.checked : (el.checked ? el.value : fields[id]);
    } else if ("value" in el) {
      fields[id] = el.value;
    }
  });
  return fields;
}

function applyFields(doc, fields) {
  if (!doc || !fields) return;
  Object.entries(fields).forEach(([id, value]) => {
    let el;
    try {
      const esc = CSS.escape(String(id));
      el = doc.querySelector(`[data-sync-id="${esc}"], [data-field-id="${esc}"], [name="${esc}"], #${esc}`);
    } catch {
      el = doc.querySelector(`[data-sync-id="${id}"], [name="${id}"]`);
    }
    if (!el) return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      el.checked = Boolean(value);
    } else if (el instanceof HTMLInputElement && el.type === "radio") {
      el.checked = String(el.value) === String(value);
    } else if ("value" in el) {
      el.value = value == null ? "" : String(value);
    }
  });
}

function showSlide(slides, index) {
  if (!slides.length) return;
  const next = Math.max(0, Math.min(slides.length - 1, Number(index) || 0));
  slides.forEach((el, i) => {
    const on = i === next;
    el.classList.toggle("active", on);
    el.classList.toggle("present", on);
    el.classList.toggle("is-active", on);
    el.hidden = !on;
    if (el.style) {
      if (on) {
        el.style.display = "";
        el.removeAttribute("hidden");
      }
    }
    el.setAttribute("aria-hidden", on ? "false" : "true");
  });
  slides[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

export function attachReadyLessonDomBridge(iframe, {
  onEvent,
  isApplyingRemote,
} = {}) {
  let destroyed = false;
  let doc = null;
  let slides = [];
  const listeners = [];

  const emit = (type, payload) => {
    if (destroyed || isApplyingRemote?.()) return;
    onEvent?.({ source: "lesson-material", type, payload: payload || {}, fallback: true });
  };

  const bind = () => {
    if (destroyed) return false;
    try {
      doc = iframe?.contentDocument || iframe?.contentWindow?.document || null;
    } catch {
      doc = null;
    }
    if (!doc || !doc.body) return false;
    slides = querySlides(doc);
    const onInput = (e) => {
      const el = e.target;
      if (!(el instanceof doc.defaultView.HTMLElement)) return;
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      const fieldId = fieldIdOf(el);
      if (!fieldId) return;
      let value;
      if (el instanceof doc.defaultView.HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        value = el.type === "checkbox" ? el.checked : el.value;
      } else {
        value = "value" in el ? el.value : "";
      }
      emit("ANSWER_CHANGED", { fieldId, taskId: fieldId, value, status: "draft" });
    };
    const onClick = () => {
      const idx = activeSlideIndex(slides);
      if (idx >= 0) {
        const slide = slides[idx];
        emit("STEP_CHANGED", {
          step: idx + 1,
          page: idx + 1,
          slideIndex: idx + 1,
          slideId: slide?.id || slide?.getAttribute("data-slide-id") || `slide-${idx + 1}`,
        });
      }
    };
    doc.addEventListener("input", onInput, true);
    doc.addEventListener("change", onInput, true);
    doc.addEventListener("click", onClick, true);
    listeners.push(() => {
      doc.removeEventListener("input", onInput, true);
      doc.removeEventListener("change", onInput, true);
      doc.removeEventListener("click", onClick, true);
    });
    emit("READY", {
      sdk: "fallback",
      supportsCollaborativeState: Boolean(slides.length || Object.keys(collectFields(doc)).length),
      slideCount: slides.length,
    });
    const idx = activeSlideIndex(slides);
    if (idx >= 0) {
      emit("STEP_CHANGED", { step: idx + 1, page: idx + 1, slideIndex: idx + 1 });
    }
    return true;
  };

  const onLoad = () => {
    window.setTimeout(bind, 50);
  };
  iframe?.addEventListener("load", onLoad);
  bind();

  return {
    isReady: () => Boolean(doc),
    supportsCollaborativeState: () => Boolean(slides.length),
    getState: () => ({
      page: Math.max(1, activeSlideIndex(slides) + 1),
      fields: collectFields(doc),
      slideCount: slides.length,
    }),
    applyRemote: (payload) => {
      if (!doc) bind();
      if (!doc) return false;
      const page = Number(payload?.page || payload?.slideIndex || payload?.step || 0);
      if (page >= 1 && slides.length) showSlide(slides, page - 1);
      const fields = payload?.fields || payload?.content?.fields || null;
      if (fields) applyFields(doc, fields);
      return true;
    },
    setMode: () => true,
    destroy: () => {
      destroyed = true;
      iframe?.removeEventListener("load", onLoad);
      listeners.forEach((fn) => fn());
      doc = null;
      slides = [];
    },
  };
}
