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

/**
 * tldraw 5.5.1 читает getCoalescedEvents в useCanvasEvents только если
 * `!tlenv.isIos`. isIos — это iPad/iPhone в userAgent. На таком UA
 * промежуточные точки Draw/Highlight отбрасываются, хотя у инструмента
 * useCoalescedEvents = true. Ластик useCoalescedEvents не включает никогда.
 * Предсказанные точки (getPredictedEvents) в геометрию не пишем.
 */
export function tldrawSkipsCoalescedEvents(userAgent) {
  const agent = String(userAgent || "");
  return /iPad/i.test(agent) || /iPhone/i.test(agent);
}

/** Чужой pointerId не сгущаем: ладонь не должна провести хорду от пера. */
export function sameActivePointer(activeId, pointerId) {
  return activeId == null || activeId === pointerId;
}

/** Промежуточные coalesced только у пера, пока Draw/Highlight и tldraw их пропускает. */
export function shouldFillIosPenDraw(event, toolId, iosSkipsCoalesced) {
  if (!iosSkipsCoalesced || !event) return false;
  if (event[ERASER_REPLAY]) return false;
  if (event.pointerType !== "pen") return false;
  if (event.type && event.type !== "pointermove") return false;
  if (toolId !== "draw" && toolId !== "highlight") return false;
  if (event.buttons === 0 && !(Number(event.pressure) > 0)) return false;
  return true;
}

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

function dispatchPointerMove(editor, event, clientX, clientY, pressure) {
  const z = pressure === undefined ? (event.pressure || 0.5) : pressure;
  editor.dispatch?.({
    type: "pointer",
    target: "canvas",
    name: "pointer_move",
    point: { x: clientX, y: clientY, z },
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

/** Все coalesced, кроме последней: её доставит сам tldraw тем же pointermove. */
function dispatchCoalescedPrefix(editor, event) {
  const samples = coalescedSamples(event);
  if (samples.length < 2) return false;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const sample = samples[index];
    const pressure = typeof sample.pressure === "number" ? sample.pressure : undefined;
    dispatchPointerMove(editor, event, sample.clientX, sample.clientY, pressure);
  }
  return true;
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
  const iosSkipsCoalesced = tldrawSkipsCoalescedEvents(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  let activePointerId = null;

  const releasePointer = (event) => {
    if (!sameActivePointer(activePointerId, event?.pointerId)) return;
    if (activePointerId == null) return;
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
  };

  const blockForeignPointer = (event) => {
    if (activePointerId == null || event.pointerId === activePointerId) return false;
    if (event.pointerType === "pen") return false;
    // Ладонь не должна дойти до tldraw: при пере не-pen он снимает штрих
    // и начинает второй от точки касания.
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    return true;
  };

  const notePen = (event) => {
    if (event.pointerType !== "pen") return;
    if (event.type === "pointerdown" || event.buttons > 0 || Number(event.pressure) > 0) {
      activePointerId = event.pointerId;
    }
  };

  const onDown = (event) => {
    if (blockForeignPointer(event)) return;
    notePen(event);
  };

  const onMove = (event) => {
    if (blockForeignPointer(event)) return;
    const eraserWants = shouldDensifyEraserMove(event, Boolean(editor.isIn?.("eraser")));
    const drawWants = !eraserWants && shouldFillIosPenDraw(
      event,
      editor.getCurrentToolId?.(),
      iosSkipsCoalesced,
    );
    if (!eraserWants && !drawWants) {
      notePen(event);
      return;
    }
    if (activePointerId != null && event.pointerId !== activePointerId) {
      // Смена id пера не диспатчится: иначе хорда соединит два стилуса.
      if (event.pointerType !== "pen") return;
      activePointerId = event.pointerId;
      return;
    }
    activePointerId = event.pointerId;
    if (eraserWants) {
      try {
        if (dispatchCoalescedPrefix(editor, event)) return;
        const from = editor.inputs?.getCurrentPagePoint?.();
        const to = editor.screenToPage?.({ x: event.clientX, y: event.clientY });
        const extras = eraserSamplePoints(coalescedSamples(event), from, to);
        for (const page of extras) {
          const screen = editor.pageToScreen?.(page);
          if (!screen) continue;
          dispatchPointerMove(editor, event, screen.x, screen.y);
        }
      } catch {
        // Исходное событие всё равно доходит до ластика.
      }
      return;
    }
    try {
      dispatchCoalescedPrefix(editor, event);
    } catch {
      // Штатный pointermove tldraw всё равно обработает.
    }
  };

  const onUp = (event) => {
    if (blockForeignPointer(event)) return;
    releasePointer(event);
  };

  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("pointermove", onMove, true);
  doc.addEventListener("pointerup", onUp, true);
  doc.addEventListener("pointercancel", onUp, true);
  return () => {
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUp, true);
    doc.removeEventListener("pointercancel", onUp, true);
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
