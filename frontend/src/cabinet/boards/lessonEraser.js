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
  if (event.pointerType !== "pen" && event.pointerType !== "touch") return false;
  // Apple Pencil часто шлёт buttons: 0, но pressure > 0. Наведение без нажатия не сгущаем.
  if (event.buttons === 0 && !(Number(event.pressure) > 0)) return false;
  return true;
}

/** Промежуточные точки штриха, если браузер не отдал coalesced-события. */
export function eraserSamplePoints(samples, from, to, step = 6) {
  const list = Array.isArray(samples) ? samples : [];
  if (list.length >= 2) return list.slice(0, -1);
  if (!from || !to) return [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < step * 2) return [];
  const count = Math.min(32, Math.floor(dist / step));
  const points = [];
  for (let index = 1; index < count; index += 1) {
    const t = index / count;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return points;
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

function dispatchPointerMove(editor, event, clientX, clientY) {
  editor.dispatch?.({
    type: "pointer",
    target: "canvas",
    name: "pointer_move",
    point: { x: clientX, y: clientY, z: event.pressure || 0.5 },
    shiftKey: Boolean(event.shiftKey),
    altKey: Boolean(event.altKey),
    ctrlKey: Boolean(event.metaKey || event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    accelKey: Boolean(event.metaKey || event.ctrlKey),
    pointerId: event.pointerId,
    button: 0,
    isPen: event.pointerType === "pen",
  });
}

/** Safari держит старый кадр .tl-canvas (content-visibility) после удаления штриха. */
function flushEraserLayer(root) {
  const canvas = root.querySelector?.(".tl-canvas") || root.querySelector?.(".tl-shapes");
  if (!canvas) return;
  canvas.style.transform = "translateZ(0)";
  void canvas.offsetWidth;
  window.requestAnimationFrame(() => {
    canvas.style.transform = "";
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
  const doc = root?.ownerDocument;
  if (!root || !doc || typeof doc.addEventListener !== "function") return () => {};
  let flushAfter = false;

  const onMove = (event) => {
    if (!shouldDensifyEraserMove(event, editor.isIn?.("eraser"))) return;
    try {
      const samples = coalescedSamples(event);
      if (samples.length >= 2) {
        for (let index = 0; index < samples.length - 1; index += 1) {
          dispatchPointerMove(editor, event, samples[index].clientX, samples[index].clientY);
        }
        return;
      }
      const from = editor.inputs?.getCurrentPagePoint?.();
      const to = editor.screenToPage?.({ x: event.clientX, y: event.clientY });
      const extras = eraserSamplePoints(samples, from, to);
      for (const page of extras) {
        const screen = editor.pageToScreen?.(page);
        if (!screen) continue;
        dispatchPointerMove(editor, event, screen.x, screen.y);
      }
    } catch {
      // Исходное событие всё равно доходит до ластика.
    }
  };

  const onUpCapture = (event) => {
    flushAfter = Boolean(event && event.pointerType !== "mouse" && !event[ERASER_REPLAY] && eraserGestureActive(editor));
  };

  const onUp = () => {
    if (!flushAfter) return;
    flushAfter = false;
    flushEraserLayer(root);
  };

  doc.addEventListener("pointermove", onMove, true);
  doc.addEventListener("pointerup", onUpCapture, true);
  doc.addEventListener("pointercancel", onUpCapture, true);
  doc.addEventListener("pointerup", onUp);
  doc.addEventListener("pointercancel", onUp);
  return () => {
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUpCapture, true);
    doc.removeEventListener("pointercancel", onUpCapture, true);
    doc.removeEventListener("pointerup", onUp);
    doc.removeEventListener("pointercancel", onUp);
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
