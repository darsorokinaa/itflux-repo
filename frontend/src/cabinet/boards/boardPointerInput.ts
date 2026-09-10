/**
 * Плотная выборка pointer-точек для freehand.
 * Excalidraw 0.18 не читает getCoalescedEvents и throttleRAF-ит pointermove
 * (без trailing) — в кадр попадает одно событие, extras/dispatch теряются.
 * Для pen пишем coalesced/densify прямо в live-element.points (mutable),
 * render/persist — раз в rAF. Мышь/палец не трогаем.
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
/** Раньше 12: extras шли в Excalidraw и throttleRAF их резал. Теперь append in-place. */
export const PEN_GAP_MAX_STEPS = 48;

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

/**
 * Linear fill of a sampling gap. Used only when the browser did not give
 * coalesced events (Safari). Does not invent a second smoothing curve —
 * Excalidraw already strokes through the points we append.
 */
export function densifyPenGap(
  from: CoalescedPointerLike,
  to: CoalescedPointerLike,
  maxGapPx = PEN_GAP_PX,
  maxSteps = PEN_GAP_MAX_STEPS,
): CoalescedPointerLike[] {
  const dx = to.clientX - from.clientX;
  const dy = to.clientY - from.clientY;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist <= maxGapPx) return [];
  const steps = Math.min(maxSteps, Math.ceil(dist / maxGapPx));
  if (steps <= 1) return [];

  const out: CoalescedPointerLike[] = [];
  const pr0 = typeof from.pressure === "number" ? from.pressure : undefined;
  const pr1 = typeof to.pressure === "number" ? to.pressure : pr0;
  const pageDx = (to.pageX ?? to.clientX) - (from.pageX ?? from.clientX);
  const pageDy = (to.pageY ?? to.clientY) - (from.pageY ?? from.clientY);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    out.push({
      clientX: from.clientX + dx * t,
      clientY: from.clientY + dy * t,
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
}): CoalescedPointerLike[] {
  const extras = coalescedMovesToInject(opts.native, opts.coalesced);
  if (extras.length) {
    return extras.length > MAX_COALESCED_PEN_EXTRAS
      ? downsampleEvenly(extras, MAX_COALESCED_PEN_EXTRAS)
      : extras;
  }
  if (!opts.last) return [];
  return densifyPenGap(opts.last, opts.native);
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

/** Стилус на pointerup часто прыгает — Excalidraw дописывает эту точку как крючок. */
export function pinPointerEventToClient(
  event: PointerEvent,
  sample: { clientX: number; clientY: number; pageX?: number; pageY?: number },
): boolean {
  try {
    Object.defineProperty(event, "clientX", { value: sample.clientX, configurable: true });
    Object.defineProperty(event, "clientY", { value: sample.clientY, configurable: true });
    if (typeof sample.pageX === "number") {
      Object.defineProperty(event, "pageX", { value: sample.pageX, configurable: true });
    }
    if (typeof sample.pageY === "number") {
      Object.defineProperty(event, "pageY", { value: sample.pageY, configurable: true });
    }
    return event.clientX === sample.clientX && event.clientY === sample.clientY;
  } catch {
    return false;
  }
}

/** Safari/WebKit: clientX часто неперезаписываемый getter — тогда шлём свой pointerup. */
export function createPinnedPointerUp(
  native: PointerEvent,
  sample: { clientX: number; clientY: number; pageX?: number; pageY?: number },
): PointerEvent | null {
  if (typeof PointerEvent !== "function") return null;
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: native.pointerId,
    pointerType: native.pointerType || "pen",
    isPrimary: native.isPrimary,
    clientX: sample.clientX,
    clientY: sample.clientY,
    pageX: sample.pageX ?? sample.clientX,
    pageY: sample.pageY ?? sample.clientY,
    buttons: 0,
    button: native.button,
    pressure: 0,
    view: native.view ?? (typeof window !== "undefined" ? window : undefined),
  };
  try {
    const replay = new PointerEvent("pointerup", init);
    Object.defineProperty(replay, ITFLUX_POINTER_REPLAY, { value: true });
    return replay;
  } catch {
    try {
      const replay = new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: native.pointerId,
        pointerType: native.pointerType || "pen",
        clientX: sample.clientX,
        clientY: sample.clientY,
        buttons: 0,
      });
      Object.defineProperty(replay, ITFLUX_POINTER_REPLAY, { value: true });
      return replay;
    } catch {
      return null;
    }
  }
}

export type LiveFreedrawStroke = {
  x: number;
  y: number;
  type?: string;
  points: number[][];
  pressures?: number[];
  simulatePressure?: boolean;
};

export type LiveFreedrawSession = {
  /** null, пока Excalidraw ещё не создал newElement после pointerdown. */
  element: LiveFreedrawStroke | null;
  toScene: (clientX: number, clientY: number) => { x: number; y: number };
};

export type CoalescedPointerReplayOptions = {
  /** Live freedraw из Excalidraw API. Если есть — не dispatch, а in-place points. */
  getLiveFreedraw?: () => LiveFreedrawSession | null;
  /** Один раз на кадр: invalidate cache / локальный render. */
  onLiveStrokeMutated?: (element: LiveFreedrawStroke) => void;
  /** pointerup/cancel: сбросить отложенный rAF до actionFinalize. */
  onPenStrokeEnd?: () => void;
};

function collectPenClientSamples(
  extras: CoalescedPointerLike[],
  native: PointerEvent,
  startPressure: number | null,
): Array<{ clientX: number; clientY: number; pressure: number }> {
  const out: Array<{ clientX: number; clientY: number; pressure: number }> = [];
  let pressure = startPressure;
  for (const sample of extras) {
    pressure = smoothPenPressure(pressure, sample.pressure ?? native.pressure);
    out.push({ clientX: sample.clientX, clientY: sample.clientY, pressure });
  }
  const nativePressure = smoothPenPressure(pressure, native.pressure);
  out.push({ clientX: native.clientX, clientY: native.clientY, pressure: nativePressure });
  return out;
}

function appendClientSamplesToLive(
  live: LiveFreedrawSession,
  samples: Array<{ clientX: number; clientY: number; pressure: number }>,
): number {
  const element = live.element;
  if (!element || !Array.isArray(element.points) || !samples.length) return 0;
  if (!Array.isArray(element.pressures)) element.pressures = [];
  let added = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const scene = live.toScene(sample.clientX, sample.clientY);
    const dx = scene.x - element.x;
    const dy = scene.y - element.y;
    const last = element.points[element.points.length - 1];
    if (last && last[0] === dx && last[1] === dy) continue;
    element.points.push([dx, dy]);
    if (!element.simulatePressure) element.pressures.push(sample.pressure);
    added += 1;
  }
  return added;
}

/** In-place append. Не копирует points[] на каждую точку. */
export function appendLiveFreedrawSamples(
  element: LiveFreedrawStroke,
  samples: Array<{ sceneX: number; sceneY: number; pressure: number }>,
): number {
  if (!Array.isArray(element.points) || !samples.length) return 0;
  if (!Array.isArray(element.pressures)) element.pressures = [];
  let added = 0;
  for (const sample of samples) {
    const dx = sample.sceneX - element.x;
    const dy = sample.sceneY - element.y;
    const last = element.points[element.points.length - 1];
    if (last && last[0] === dx && last[1] === dy) continue;
    element.points.push([dx, dy]);
    if (!element.simulatePressure) element.pressures.push(sample.pressure);
    added += 1;
  }
  return added;
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
};

/**
 * Capture-фаза: coalesced/densify в live points[].
 * Не dispatch в Excalidraw: его throttleRAF отбрасывает extras и может
 * дописать устаревшую первую точку кадра (крючок).
 */
export function mountCoalescedPointerReplay(
  host: Element,
  options: CoalescedPointerReplayOptions = {},
): () => void {
  let stroke: PenStrokeState | null = null;
  let queued: Array<{ clientX: number; clientY: number; pressure: number }> = [];
  const hasLiveHook = typeof options.getLiveFreedraw === "function";

  const applyToLive = (
    live: LiveFreedrawSession | null,
    samples: Array<{ clientX: number; clientY: number; pressure: number }>,
  ): boolean => {
    if (!live?.element || live.element.type !== "freedraw" || typeof live.toScene !== "function") {
      return false;
    }
    if (!samples.length) return true;
    appendClientSamplesToLive(live, samples);
    options.onLiveStrokeMutated?.(live.element);
    return true;
  };

  const onPointerDown = (event: Event) => {
    const native = event as PointerEvent;
    if (native.pointerType !== "pen") {
      stroke = null;
      queued = [];
      return;
    }
    queued = [];
    const pressure = smoothPenPressure(null, native.pressure);
    stroke = {
      pointerId: native.pointerId,
      clientX: native.clientX,
      clientY: native.clientY,
      pageX: native.pageX,
      pageY: native.pageY,
      pressure,
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
    const extras = penMovesToInject({
      native,
      coalesced,
      last,
    });
    boardPerfMarkPoints(extras.length + 1);
    const samples = collectPenClientSamples(extras, native, last?.pressure ?? null);
    const lastPressure = samples[samples.length - 1]?.pressure ?? last?.pressure ?? native.pressure;

    if (hasLiveHook) {
      const live = options.getLiveFreedraw?.() || null;
      // null = не freedraw (выбор, фигуры, ластик) — не перехватываем pointermove.
      if (!live) return;
      if (live.element && live.element.type === "freedraw" && !queued.length) {
        applyToLive(live, samples);
      } else {
        for (let i = 0; i < samples.length; i += 1) queued.push(samples[i]);
        if (applyToLive(live, queued)) queued.length = 0;
      }
      native.stopPropagation();
      stroke = {
        pointerId: native.pointerId,
        clientX: native.clientX,
        clientY: native.clientY,
        pageX: native.pageX,
        pageY: native.pageY,
        pressure: lastPressure,
      };
      return;
    }

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
      pressure: lastPressure,
    };
  };

  const onPointerUp = (event: Event) => {
    const native = event as PointerEvent;
    if (isPointerReplayEvent(native)) return;
    if (!stroke || native.pointerId !== stroke.pointerId) return;
    const live = hasLiveHook ? options.getLiveFreedraw?.() || null : null;
    if (live && queued.length) applyToLive(live, queued);
    // Только freedraw: фигуры/выбор пером должны видеть реальный pointerup.
    if (live) {
      const pinned = pinPointerEventToClient(native, stroke);
      if (!pinned && typeof window !== "undefined") {
        const replay = createPinnedPointerUp(native, stroke);
        native.stopPropagation();
        queued = [];
        stroke = null;
        options.onPenStrokeEnd?.();
        if (replay) window.dispatchEvent(replay);
        return;
      }
    }
    queued = [];
    stroke = null;
    options.onPenStrokeEnd?.();
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
