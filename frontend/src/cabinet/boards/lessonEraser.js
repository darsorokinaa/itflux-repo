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

/** Подмешивание coalesced-точек пера в Draw/Highlight на iOS. Выключено. */
export const LESSON_IOS_DRAW_FILL = false;

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
 * Жест ещё не в *.idle и это не набор текста.
 * Окружность ластика и лазер — scribble в instance state, не фигура документа.
 */
export function isOpenBoardGesture(editor) {
  if (!editor) return false;
  if (typeof editor.getEditingShapeId === "function" && editor.getEditingShapeId()) return false;
  if (editor.inputs?.getIsEditing?.()) return false;
  const path = String(editor.getPath?.() || "");
  if (!path || path === "root" || path.endsWith(".idle")) return false;
  return true;
}

function releaseStuckPointer(editor) {
  editor.inputs?.setIsPointing?.(false);
  editor.inputs?.setIsDragging?.(false);
  editor.inputs?.buttons?.delete?.(0);
}

function clientPointFromInputs(editor) {
  const screen = editor.inputs?.getCurrentScreenPoint?.() || { x: 0, y: 0 };
  const bounds = editor.getInstanceState?.()?.screenBounds || { x: 0, y: 0 };
  return {
    x: Number(screen.x) + Number(bounds.x || 0),
    y: Number(screen.y) + Number(bounds.y || 0),
    z: 0,
  };
}

function traceBoardPointer(reason, editor) {
  if (typeof globalThis === "undefined" || !globalThis.__itfluxBoardPointer) return;
  console.info("[itflux board pointer]", reason, String(editor?.getPath?.() || ""));
}

/**
 * tldraw 5.5.1 в Editor.dispatch отбрасывает pointer, пока isPinching.
 * Erasing не слушает interrupt, а ScribbleManager не снимает последнюю
 * точку активного scribble — окружность ластика остаётся в instance state.
 * Пока щипок уже начался, pointer_up туда не доходит: закрываем жест через complete.
 * Иначе штатный pointer_up сам снимает isPointing и вызывает onPointerUp инструмента.
 */
export function endOpenBoardGesture(editor, reason = "end") {
  if (!isOpenBoardGesture(editor)) return false;
  traceBoardPointer(reason, editor);
  const pinching = Boolean(editor.inputs?.getIsPinching?.());
  if (!pinching && typeof editor.dispatch === "function") {
    const isPen = Boolean(editor.inputs?.getIsPen?.() || editor.getInstanceState?.()?.isPenMode);
    editor.dispatch({
      type: "pointer",
      target: "canvas",
      name: "pointer_up",
      point: clientPointFromInputs(editor),
      pointerId: editor.capturedPointerId ?? 1,
      button: 0,
      isPen,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      accelKey: false,
    });
  }
  if (!isOpenBoardGesture(editor)) return true;
  editor.complete?.();
  if (isOpenBoardGesture(editor)) editor.cancel?.();
  releaseStuckPointer(editor);
  return true;
}

/**
 * Перо село, пока палец или ладонь уже вели штрих.
 * Drawing.onInterrupt при isDragging не выходит из drawing, и следующий
 * pointer_move пера дописывает хорду в тот же shape. bailToMark снимает
 * только метку текущего штриха, предыдущие фигуры не трогает.
 */
export function abandonNonPenGesture(editor) {
  if (!isOpenBoardGesture(editor)) return false;
  if (editor.inputs?.getIsPen?.()) return false;
  traceBoardPointer("abandon-non-pen", editor);
  const path = String(editor.getPath?.() || "");
  const ink = path.startsWith("draw.") || path.startsWith("highlight.");
  if (ink) {
    const node = editor.getStateDescendant?.(path);
    if (node?.markId && typeof editor.bailToMark === "function") {
      try {
        editor.bailToMark(node.markId);
      } catch {
        // Метка уже снята самим инструментом.
      }
    }
  }
  editor.cancel?.();
  if (isOpenBoardGesture(editor)) editor.complete?.();
  releaseStuckPointer(editor);
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
    if (event.pointerType === "pen") abandonNonPenGesture(editor);
    notePen(event);
  };

  const onMove = (event) => {
    if (blockForeignPointer(event)) return;
    const eraserWants = shouldDensifyEraserMove(event, Boolean(editor.isIn?.("eraser")));
    // Не подмешиваем coalesced-точки в штрих на iOS: tldraw сам отключил их там
    // (PR #6917); подмешанные точки дают лишнюю геометрию штриха.
    const drawWants = LESSON_IOS_DRAW_FILL && !eraserWants && shouldFillIosPenDraw(
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

  let disposed = false;
  const endIfOpen = (reason) => {
    if (disposed) return;
    try {
      endOpenBoardGesture(editor, reason);
    } catch {
      // Редактор уже снят вместе с холстом.
    }
  };
  const onEditorEvent = (info) => {
    if (info?.type === "pinch" && info?.name === "pinch_start") endIfOpen("pinch");
  };
  const onHidden = () => {
    if (doc.visibilityState === "hidden") endIfOpen("hidden");
  };
  const onPageHide = () => endIfOpen("pagehide");
  const onBlur = () => endIfOpen("blur");
  const onLostCapture = (event) => {
    if (editor.capturedPointerId != null && event.pointerId !== editor.capturedPointerId) return;
    const schedule = doc.defaultView?.queueMicrotask?.bind(doc.defaultView) || queueMicrotask;
    schedule(() => endIfOpen("lostpointercapture"));
  };
  if (typeof editor.on === "function") editor.on("event", onEditorEvent);

  const win = doc.defaultView;
  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("pointermove", onMove, true);
  doc.addEventListener("pointerup", onUp, true);
  doc.addEventListener("pointercancel", onUp, true);
  doc.addEventListener("lostpointercapture", onLostCapture, true);
  doc.addEventListener("visibilitychange", onHidden);
  win?.addEventListener("pagehide", onPageHide);
  win?.addEventListener("blur", onBlur);
  return () => {
    disposed = true;
    if (typeof editor.off === "function") editor.off("event", onEditorEvent);
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("pointerup", onUp, true);
    doc.removeEventListener("pointercancel", onUp, true);
    doc.removeEventListener("lostpointercapture", onLostCapture, true);
    doc.removeEventListener("visibilitychange", onHidden);
    win?.removeEventListener("pagehide", onPageHide);
    win?.removeEventListener("blur", onBlur);
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
