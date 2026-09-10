/**
 * Плотная выборка pointer-точек для freehand.
 * Excalidraw 0.18 обрабатывает только последний pointermove кадра и не
 * вызывает getCoalescedEvents — на стилусе сегменты становятся угловатыми.
 * Промежуточные события проигрываем в тот же canvas; формат freedraw не меняем.
 *
 * Мышь/палец не реплеим: у них и так достаточно точек, лишние synthetic
 * pointermove только увеличивают стоимость onChange.
 */

import { boardPerfMarkInput, boardPerfMarkPoints } from "./boardPerfDev";

export const ITFLUX_POINTER_REPLAY = "__itfluxCoalescedReplay";

/**
 * Аварийный потолок на кадр (зависший main thread). Обычный стилус даёт
 * единицы–десятки coalesced — все они проходят без прореживания.
 */
export const MAX_COALESCED_PEN_EXTRAS = 48;

/** Экранные CSS px: плотнее — плавнее, но выше стоимость replay. */
export const PEN_GAP_PX = 2.75;
export const PEN_GAP_MAX_STEPS = 12;

export const PEN_PRESSURE_EMA_PREV = 0.7;
export const PEN_PRESSURE_EMA_CURRENT = 0.3;
export const PEN_PRESSURE_FALLBACK = 0.5;

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

let penReplayDepth = 0;

/** true, пока synthetic coalesced/densify pointermove идёт в Excalidraw. */
export function isReplayingPenPoints(): boolean {
  return penReplayDepth > 0;
}

export function withPenPointReplay(fn: () => void): void {
  penReplayDepth += 1;
  try {
    fn();
  } finally {
    penReplayDepth -= 1;
  }
}

/**
 * Fallback обязателен: Safari/iPadOS может не иметь getCoalescedEvents
 * или бросать при вызове.
 */
export function coalescedEventsOrFallback(event: {
  getCoalescedEvents?: () => CoalescedPointerLike[];
} & CoalescedPointerLike): CoalescedPointerLike[] {
  const events =
    typeof event.getCoalescedEvents === "function"
      ? (() => {
          try {
            const list = event.getCoalescedEvents();
            return Array.isArray(list) && list.length ? list : null;
          } catch {
            return null;
          }
        })()
      : null;
  return events || [event];
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
 * Если API нет — пустой список (вызывающий использует fallback-интерполяцию).
 */
export function coalescedMovesToInject(
  native: CoalescedPointerLike,
  coalesced: CoalescedPointerLike[] | null,
  maxExtra = MAX_COALESCED_PEN_EXTRAS,
): CoalescedPointerLike[] {
  if (!coalesced || coalesced.length <= 1) return [];
  const last = coalesced[coalesced.length - 1];
  const sameAsNative = last.clientX === native.clientX && last.clientY === native.clientY;
  const extras = sameAsNative ? coalesced.slice(0, -1) : coalesced;
  if (extras.length <= maxExtra) return extras.slice();
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
  return (event.pointerType || "mouse") === "pen";
}

/** 0 / NaN на pen в контакте = нет pressure API, не толщина 0. */
export function readPenPressure(raw: unknown, previous: number | null): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  if (previous != null && previous > 0) return previous;
  return PEN_PRESSURE_FALLBACK;
}

export function smoothPenPressure(previous: number | null, current: number): number {
  const cur = readPenPressure(current, previous);
  if (previous == null) return cur;
  return previous * PEN_PRESSURE_EMA_PREV + cur * PEN_PRESSURE_EMA_CURRENT;
}

/** Разворот ≥ ~78° — только хорда, иначе крючки на 180°. */
export function isSharpPenTurn(
  prev: CoalescedPointerLike,
  from: CoalescedPointerLike,
  to: CoalescedPointerLike,
): boolean {
  const ix = from.clientX - prev.clientX;
  const iy = from.clientY - prev.clientY;
  const ox = to.clientX - from.clientX;
  const oy = to.clientY - from.clientY;
  const inLen = Math.hypot(ix, iy);
  const outLen = Math.hypot(ox, oy);
  if (inLen < 0.5 || outLen < 0.5) return false;
  return (ix * ox + iy * oy) / (inLen * outLen) < 0.2;
}

function samplePenSegment(
  from: CoalescedPointerLike,
  to: CoalescedPointerLike,
  t: number,
  control: { x: number; y: number } | null,
): { x: number; y: number } {
  if (!control) {
    return {
      x: from.clientX + (to.clientX - from.clientX) * t,
      y: from.clientY + (to.clientY - from.clientY) * t,
    };
  }
  const mt = 1 - t;
  return {
    x: mt * mt * from.clientX + 2 * mt * t * control.x + t * t * to.clientX,
    y: mt * mt * from.clientY + 2 * mt * t * control.y + t * t * to.clientY,
  };
}

/**
 * Донасыщение разрыва. Без prev — хорда.
 * С prev и плавным поворотом — квадратичная Безье: concavity круга,
 * конечная точка остаётся native (наконечник).
 */
export function densifyPenGap(
  from: CoalescedPointerLike,
  to: CoalescedPointerLike,
  prev: CoalescedPointerLike | null = null,
  maxGapPx = PEN_GAP_PX,
  maxSteps = PEN_GAP_MAX_STEPS,
): CoalescedPointerLike[] {
  const dx = to.clientX - from.clientX;
  const dy = to.clientY - from.clientY;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist <= maxGapPx) return [];
  const steps = Math.min(maxSteps, Math.ceil(dist / maxGapPx));
  if (steps <= 1) return [];

  let control: { x: number; y: number } | null = null;
  if (prev && !isSharpPenTurn(prev, from, to)) {
    const ix = from.clientX - prev.clientX;
    const iy = from.clientY - prev.clientY;
    const inLen = Math.hypot(ix, iy);
    if (inLen > 0.5) {
      const dotN = (ix * dx + iy * dy) / (inLen * dist);
      const cross = ix * dy - iy * dx;
      const sagitta = Math.min(8, dist * 0.22, dist * 0.38 * Math.max(0, 1 - dotN));
      if (sagitta > 0.35) {
        const inv = 1 / dist;
        const side = cross >= 0 ? -1 : 1;
        const ox = (-dy * inv) * side * sagitta * 2;
        const oy = (dx * inv) * side * sagitta * 2;
        control = {
          x: from.clientX + dx * 0.5 + ox,
          y: from.clientY + dy * 0.5 + oy,
        };
      }
    }
  }

  const out: CoalescedPointerLike[] = [];
  const pr0 = typeof from.pressure === "number" ? from.pressure : undefined;
  const pr1 = typeof to.pressure === "number" ? to.pressure : pr0;
  const pageDx = (to.pageX ?? to.clientX) - (from.pageX ?? from.clientX);
  const pageDy = (to.pageY ?? to.clientY) - (from.pageY ?? from.clientY);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const pos = samplePenSegment(from, to, t, control);
    out.push({
      clientX: pos.x,
      clientY: pos.y,
      pageX: (from.pageX ?? from.clientX) + pageDx * t,
      pageY: (from.pageY ?? from.clientY) + pageDy * t,
      pressure: pr0 != null && pr1 != null ? pr0 + (pr1 - pr0) * t : pr1,
    });
  }
  return out;
}

export function penMovesToInject(opts: {
  native: CoalescedPointerLike;
  coalesced: CoalescedPointerLike[] | null;
  last: CoalescedPointerLike | null;
  prev?: CoalescedPointerLike | null;
}): CoalescedPointerLike[] {
  let extras = coalescedMovesToInject(opts.native, opts.coalesced);
  const prev = opts.prev || null;
  if (!extras.length) {
    if (opts.last) extras = densifyPenGap(opts.last, opts.native, prev);
    return extras;
  }
  if (opts.last) {
    extras = densifyPenGap(opts.last, extras[0], prev).concat(extras);
  }
  if (extras.length > MAX_COALESCED_PEN_EXTRAS) {
    extras = downsampleEvenly(extras, MAX_COALESCED_PEN_EXTRAS);
  }
  return extras;
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

function createReplayPointerMove(native: PointerEvent, sample: CoalescedPointerLike, pressure: number): PointerEvent | null {
  if (typeof PointerEvent !== "function") return null;
  const base: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: native.pointerId,
    pointerType: native.pointerType || "pen",
    isPrimary: native.isPrimary,
    clientX: sample.clientX,
    clientY: sample.clientY,
    buttons: native.buttons,
    button: native.button,
    pressure,
  };
  const full: PointerEventInit = {
    ...base,
    pageX: sample.pageX ?? sample.clientX,
    pageY: sample.pageY ?? sample.clientY,
    screenX: sample.screenX ?? native.screenX,
    screenY: sample.screenY ?? native.screenY,
    width: sample.width ?? native.width,
    height: sample.height ?? native.height,
    tiltX: sample.tiltX ?? native.tiltX,
    tiltY: sample.tiltY ?? native.tiltY,
    twist: sample.twist ?? native.twist,
    tangentialPressure: sample.tangentialPressure ?? native.tangentialPressure,
    view: native.view ?? (typeof window !== "undefined" ? window : undefined),
    movementX: 0,
    movementY: 0,
  };
  try {
    const replay = new PointerEvent("pointermove", full);
    Object.defineProperty(replay, ITFLUX_POINTER_REPLAY, { value: true });
    return replay;
  } catch {
    try {
      const replay = new PointerEvent("pointermove", base);
      Object.defineProperty(replay, ITFLUX_POINTER_REPLAY, { value: true });
      return replay;
    } catch {
      return null;
    }
  }
}

type PenStrokeState = {
  pointerId: number;
  clientX: number;
  clientY: number;
  pageX?: number;
  pageY?: number;
  pressure: number;
  prevX: number;
  prevY: number;
};

/** Capture-фаза: промежуточные coalesced / densify → synthetic pointermove на canvas. */
export function mountCoalescedPointerReplay(host: Element): () => void {
  let stroke: PenStrokeState | null = null;

  const onPointerDown = (event: Event) => {
    const native = event as PointerEvent;
    if (native.pointerType !== "pen") {
      stroke = null;
      return;
    }
    const pressure = smoothPenPressure(null, native.pressure);
    stroke = {
      pointerId: native.pointerId,
      clientX: native.clientX,
      clientY: native.clientY,
      pageX: native.pageX,
      pageY: native.pageY,
      pressure,
      prevX: native.clientX,
      prevY: native.clientY,
    };
  };

  const onPointerMove = (event: Event) => {
    const native = event as PointerEvent;
    if (!shouldReplayCoalescedPointerMove(native)) return;
    boardPerfMarkInput();
    const canvas = canvasFromEventTarget(native.target, host);
    if (!canvas) return;
    const coalesced = coalescedEventsOrFallback(native);
    const last = stroke && stroke.pointerId === native.pointerId ? stroke : null;
    const prev = last
      ? { clientX: last.prevX, clientY: last.prevY }
      : null;
    const extras = penMovesToInject({
      native,
      coalesced,
      last,
      prev,
    });
    boardPerfMarkPoints(extras.length + 1);
    let pressure = last?.pressure ?? null;
    withPenPointReplay(() => {
      for (const sample of extras) {
        pressure = smoothPenPressure(pressure, sample.pressure ?? native.pressure);
        const replay = createReplayPointerMove(native, sample, pressure);
        if (!replay) continue;
        canvas.dispatchEvent(replay);
      }
    });
    stroke = {
      pointerId: native.pointerId,
      clientX: native.clientX,
      clientY: native.clientY,
      pageX: native.pageX,
      pageY: native.pageY,
      pressure: smoothPenPressure(pressure, native.pressure),
      prevX: last ? last.clientX : native.clientX,
      prevY: last ? last.clientY : native.clientY,
    };
  };

  const onPointerUp = (event: Event) => {
    const native = event as PointerEvent;
    if (stroke && native.pointerId === stroke.pointerId) stroke = null;
  };

  host.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  host.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  host.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
  host.addEventListener("pointercancel", onPointerUp, { capture: true, passive: true });
  return () => {
    host.removeEventListener("pointerdown", onPointerDown, true);
    host.removeEventListener("pointermove", onPointerMove, true);
    host.removeEventListener("pointerup", onPointerUp, true);
    host.removeEventListener("pointercancel", onPointerUp, true);
  };
}
