/** Ластик снимает штрих поверх картинки и не трогает саму картинку. */

const guarded = new WeakSet();

export function withoutImageEraseTargets(shapes, typeOf) {
  if (!Array.isArray(shapes)) return [];
  return shapes.filter((item) => {
    const id = item && typeof item === "object" ? item.id : item;
    return typeOf(id) !== "image";
  });
}

export function imageSurvivesEraser(shape, source, erasing) {
  return Boolean(erasing && source === "user" && shape?.type === "image");
}

const ERASER_REPLAY = "__itfluxEraserReplay";

/** Мышь не трогаем. Сгущаем только pen/touch, пока выбран штатный ластик. */
export function shouldDensifyEraserMove(event, eraserActive) {
  if (!eraserActive || !event) return false;
  if (event[ERASER_REPLAY]) return false;
  if (event.pointerType === "mouse") return false;
  if (event.type && event.type !== "pointermove") return false;
  return event.pointerType === "pen" || event.pointerType === "touch";
}

function coalescedSamples(event) {
  if (typeof event.getCoalescedEvents !== "function") return [];
  try {
    const list = event.getCoalescedEvents();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function replayPointer(target, type, event, sample) {
  const replay = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: sample.clientX,
    clientY: sample.clientY,
    screenX: sample.screenX,
    screenY: sample.screenY,
    pointerId: event.pointerId,
    pointerType: event.pointerType || "pen",
    buttons: type === "pointerup" ? 0 : event.buttons,
    pressure: sample.pressure ?? event.pressure,
    isPrimary: true,
  });
  replay[ERASER_REPLAY] = true;
  target.dispatchEvent(replay);
}

/** Safari иногда оставляет слой удалённого штриха, пока композитор не перерисует его. */
function flushEraserLayer(root) {
  const layer = root.querySelector?.(".tl-shapes");
  if (!layer) return;
  const previous = layer.style.opacity;
  layer.style.opacity = "0.999";
  window.requestAnimationFrame(() => {
    layer.style.opacity = previous;
  });
}

function eraserGestureActive(editor) {
  return Boolean(editor?.isIn?.("eraser.pointing") || editor?.isIn?.("eraser.erasing"));
}

/**
 * Штатный ластик tldraw смотрит только на последнее pointermove.
 * На iPad Apple Pencil кладёт промежуточные точки в getCoalescedEvents,
 * а сам tldraw на iOS их не читает. Хорда между редкими событиями не пересекает изгиб.
 * pointercancel tldraw уже превращает в один pointer_up. Второй synthetic pointerup
 * вызвал бы второй complete() и лишнюю запись в history.
 */
export function installCoalescedEraserInput(editor) {
  const root = editor?.getContainer?.();
  if (!root || typeof root.addEventListener !== "function") return () => {};

  const onMove = (event) => {
    if (!shouldDensifyEraserMove(event, editor.isIn?.("eraser"))) return;
    const samples = coalescedSamples(event);
    if (samples.length < 2) return;
    const target = event.target;
    if (!target || typeof target.dispatchEvent !== "function") return;
    for (let index = 0; index < samples.length - 1; index += 1) {
      replayPointer(target, "pointermove", event, samples[index]);
    }
  };

  const onCancel = (event) => {
    if (!event || event.pointerType === "mouse" || event[ERASER_REPLAY]) return;
    if (!eraserGestureActive(editor)) return;
    flushEraserLayer(root);
  };

  const onUp = (event) => {
    if (!event || event.pointerType === "mouse" || event[ERASER_REPLAY]) return;
    if (!eraserGestureActive(editor)) return;
    flushEraserLayer(root);
  };

  root.addEventListener("pointermove", onMove, true);
  root.addEventListener("pointercancel", onCancel, true);
  root.addEventListener("pointerup", onUp, true);
  return () => {
    root.removeEventListener("pointermove", onMove, true);
    root.removeEventListener("pointercancel", onCancel, true);
    root.removeEventListener("pointerup", onUp, true);
  };
}

export function keepImagesUnderEraser(editor) {
  if (!editor || guarded.has(editor)) return () => {};
  guarded.add(editor);
  const original = editor.setErasingShapes.bind(editor);
  editor.setErasingShapes = (shapes) => original(
    withoutImageEraseTargets(shapes, (id) => editor.getShape?.(id)?.type),
  );
  return editor.sideEffects.registerBeforeDeleteHandler("shape", (shape, source) => {
    if (imageSurvivesEraser(shape, source, editor.isIn("eraser"))) return false;
    return undefined;
  });
}
