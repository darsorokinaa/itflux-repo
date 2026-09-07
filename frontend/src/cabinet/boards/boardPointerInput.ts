/**
 * Плотная выборка pointer-точек для freehand.
 * Excalidraw 0.18 обрабатывает только последний pointermove кадра и не
 * вызывает getCoalescedEvents — на стилусе сегменты становятся угловатыми.
 * Промежуточные события проигрываем в тот же canvas; формат freedraw не меняем.
 */

export const ITFLUX_POINTER_REPLAY = "__itfluxCoalescedReplay";

/** Не раздувать payload: браузер может отдать десятки coalesced за кадр. */
export const MAX_COALESCED_EXTRA_MOVES = 8;

export type CoalescedPointerLike = {
  clientX: number;
  clientY: number;
  pageX?: number;
  pageY?: number;
  screenX?: number;
  screenY?: number;
  pressure?: number;
  width?: number;
  height?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  tangentialPressure?: number;
};

export function isPointerReplayEvent(event: { [ITFLUX_POINTER_REPLAY]?: boolean } | null | undefined): boolean {
  return Boolean(event && event[ITFLUX_POINTER_REPLAY]);
}

export function readCoalescedPointerEvents(event: {
  getCoalescedEvents?: () => CoalescedPointerLike[];
}): CoalescedPointerLike[] | null {
  const get = event.getCoalescedEvents;
  if (typeof get !== "function") return null;
  try {
    const list = get.call(event);
    if (!Array.isArray(list) || list.length === 0) return null;
    return list;
  } catch {
    return null;
  }
}

export function downsampleEvenly<T>(items: T[], max: number): T[] {
  if (max <= 0 || items.length === 0) return [];
  if (items.length <= max) return items.slice();
  if (max === 1) return [items[items.length - 1]];
  const out: T[] = [];
  const last = items.length - 1;
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round((i / (max - 1)) * last);
    const item = items[idx];
    if (out.length === 0 || out[out.length - 1] !== item) out.push(item);
  }
  return out;
}

/**
 * Промежуточные coalesced-точки до нативного pointermove.
 * Если API нет — пустой список (вызывающий использует обычное событие).
 */
export function coalescedMovesToInject(
  native: CoalescedPointerLike,
  coalesced: CoalescedPointerLike[] | null,
  maxExtra = MAX_COALESCED_EXTRA_MOVES,
): CoalescedPointerLike[] {
  if (!coalesced || coalesced.length <= 1) return [];
  const last = coalesced[coalesced.length - 1];
  const sameAsNative = last.clientX === native.clientX && last.clientY === native.clientY;
  const extras = sameAsNative ? coalesced.slice(0, -1) : coalesced;
  return downsampleEvenly(extras, maxExtra);
}

export function shouldReplayCoalescedPointerMove(event: {
  type?: string;
  buttons?: number;
  pointerType?: string;
  [ITFLUX_POINTER_REPLAY]?: boolean;
}): boolean {
  if (isPointerReplayEvent(event)) return false;
  if (event.type && event.type !== "pointermove") return false;
  if (!event.buttons) return false;
  const pointerType = event.pointerType || "mouse";
  return pointerType === "pen" || pointerType === "touch" || pointerType === "mouse";
}

export function findInteractiveBoardCanvas(host: ParentNode): HTMLCanvasElement | null {
  return (
    (host.querySelector("canvas.excalidraw__canvas.interactive") as HTMLCanvasElement | null)
    || (host.querySelector("canvas.excalidraw__canvas") as HTMLCanvasElement | null)
  );
}

function canvasFromEventTarget(target: EventTarget | null, host: Element): HTMLCanvasElement | null {
  const el = target as HTMLElement | null;
  const hit = el?.closest?.("canvas.excalidraw__canvas") as HTMLCanvasElement | null;
  if (hit) return hit;
  return findInteractiveBoardCanvas(host);
}

function createReplayPointerMove(native: PointerEvent, sample: CoalescedPointerLike): PointerEvent | null {
  if (typeof PointerEvent !== "function") return null;
  try {
    const replay = new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: native.pointerId,
      pointerType: native.pointerType,
      isPrimary: native.isPrimary,
      clientX: sample.clientX,
      clientY: sample.clientY,
      pageX: sample.pageX ?? sample.clientX,
      pageY: sample.pageY ?? sample.clientY,
      screenX: sample.screenX ?? native.screenX,
      screenY: sample.screenY ?? native.screenY,
      pressure: typeof sample.pressure === "number" ? sample.pressure : native.pressure,
      buttons: native.buttons,
      button: native.button,
      width: sample.width ?? native.width,
      height: sample.height ?? native.height,
      tiltX: sample.tiltX ?? native.tiltX,
      tiltY: sample.tiltY ?? native.tiltY,
      twist: sample.twist ?? native.twist,
      tangentialPressure: sample.tangentialPressure ?? native.tangentialPressure,
      view: native.view ?? window,
      movementX: 0,
      movementY: 0,
    });
    Object.defineProperty(replay, ITFLUX_POINTER_REPLAY, { value: true });
    return replay;
  } catch {
    return null;
  }
}

/** Capture-фаза: промежуточные coalesced → synthetic pointermove на canvas. */
export function mountCoalescedPointerReplay(host: Element): () => void {
  const onPointerMove = (event: Event) => {
    const native = event as PointerEvent;
    if (!shouldReplayCoalescedPointerMove(native)) return;
    const canvas = canvasFromEventTarget(native.target, host);
    if (!canvas) return;
    const extras = coalescedMovesToInject(native, readCoalescedPointerEvents(native));
    if (!extras.length) return;
    for (const sample of extras) {
      const replay = createReplayPointerMove(native, sample);
      if (!replay) return;
      canvas.dispatchEvent(replay);
    }
  };

  host.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  return () => {
    host.removeEventListener("pointermove", onPointerMove, true);
  };
}
