/**
 * Временная DEV-инструментация пайплайна стилуса.
 * В production Vite заменяет import.meta.env.DEV на false — UI не монтируется.
 */

type WindowCounters = {
  inputEvents: number;
  collectedPoints: number;
  frames: number;
  packets: number;
  packetPoints: number;
  longTasks: number;
};

const EMPTY: WindowCounters = {
  inputEvents: 0,
  collectedPoints: 0,
  frames: 0,
  packets: 0,
  packetPoints: 0,
  longTasks: 0,
};

let counters: WindowCounters = { ...EMPTY };
let overlayEl: HTMLDivElement | null = null;
let rafId = 0;
let tickTimer = 0;
let longTaskObserver: PerformanceObserver | null = null;
let lastFrameAt = 0;

function enabled(): boolean {
  return Boolean(import.meta.env?.DEV);
}

export function boardPerfEnabled(): boolean {
  return enabled();
}

export function boardPerfMarkInput(): void {
  if (!enabled()) return;
  counters.inputEvents += 1;
}

export function boardPerfMarkPoints(count: number): void {
  if (!enabled()) return;
  if (count > 0) counters.collectedPoints += count;
}

export function boardPerfMarkPacket(pointCount = 0): void {
  if (!enabled()) return;
  counters.packets += 1;
  if (pointCount > 0) counters.packetPoints += pointCount;
}

export function boardPerfMarkLongTask(durationMs: number): void {
  if (!enabled()) return;
  if (durationMs > 50) counters.longTasks += 1;
}

export function boardPerfMeasure<T>(fn: () => T): T {
  if (!enabled()) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    boardPerfMarkLongTask(performance.now() - t0);
  }
}

function countOpPoints(payload: Record<string, unknown>): number {
  const type = String(payload.type || "");
  if (type === "scene_ops") {
    const opsWrap = payload.ops as { ops?: Array<{ op?: string; element?: { points?: unknown } }> } | undefined;
    const ops = opsWrap?.ops || [];
    let n = 0;
    for (const op of ops) {
      if (op?.op !== "upsert") continue;
      const pts = op.element?.points;
      if (Array.isArray(pts)) n += pts.length;
    }
    return n;
  }
  if (type === "scene_live") {
    const scene = payload.scene as { elements?: Array<{ points?: unknown }> } | undefined;
    let n = 0;
    for (const el of scene?.elements || []) {
      if (Array.isArray(el?.points)) n += el.points.length;
    }
    return n;
  }
  return 0;
}

export function boardPerfMarkRealtimePayload(payload: Record<string, unknown>): void {
  if (!enabled()) return;
  const type = String(payload.type || "");
  if (type !== "scene_ops" && type !== "scene_live") return;
  boardPerfMarkPacket(countOpPoints(payload));
}

function overlayText(snapshot: WindowCounters & { avgPts: string }): string {
  return [
    `input/s ${snapshot.inputEvents}`,
    `points/s ${snapshot.collectedPoints}`,
    `frames/s ${snapshot.frames}`,
    `ws/s ${snapshot.packets}`,
    `pts/pkt ${snapshot.avgPts}`,
    `long>50ms ${snapshot.longTasks}`,
  ].join("\n");
}

function renderOverlay(host: Element, snapshot: WindowCounters & { avgPts: string }): void {
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.className = "cb-board-perf-overlay";
    overlayEl.setAttribute("data-board-perf", "1");
    overlayEl.setAttribute("aria-hidden", "true");
    overlayEl.style.cssText = [
      "position:absolute",
      "left:8px",
      "bottom:8px",
      "z-index:40",
      "pointer-events:none",
      "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
      "color:#e2e8f0",
      "background:rgba(15,23,42,0.72)",
      "border-radius:6px",
      "padding:6px 8px",
      "white-space:pre",
      "max-width:min(92vw,420px)",
    ].join(";");
    host.appendChild(overlayEl);
  }
  overlayEl.textContent = overlayText(snapshot);
}

export function formatBoardPerfOverlayText(snapshot: WindowCounters & { avgPts: string }): string {
  return overlayText(snapshot);
}

function onFrame(now: number): void {
  rafId = window.requestAnimationFrame(onFrame);
  if (!enabled()) return;
  if (lastFrameAt && now - lastFrameAt < 8) {
    // rAF может срабатывать чаще на ProMotion — считаем кадр отрисовки, не vsync 120.
  }
  lastFrameAt = now;
  counters.frames += 1;
}

function startLongTaskObserver(): void {
  if (longTaskObserver || typeof PerformanceObserver === "undefined") return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        boardPerfMarkLongTask(entry.duration);
      }
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
  } catch {
    longTaskObserver = null;
  }
}

export function mountBoardPerfOverlay(host: Element): () => void {
  if (!enabled()) return () => {};

  startLongTaskObserver();
  lastFrameAt = 0;
  counters = { ...EMPTY };
  rafId = window.requestAnimationFrame(onFrame);
  tickTimer = window.setInterval(() => {
    const snap = counters;
    counters = { ...EMPTY };
    const avgPts = snap.packets ? (snap.packetPoints / snap.packets).toFixed(1) : "0";
    renderOverlay(host, { ...snap, avgPts });
  }, 1000);

  return () => {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
    window.clearInterval(tickTimer);
    tickTimer = 0;
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    overlayEl?.remove();
    overlayEl = null;
  };
}
