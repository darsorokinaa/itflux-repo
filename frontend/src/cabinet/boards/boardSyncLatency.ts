/** Замер и бюджет latency совместной доски (без двух браузеров — симуляция пайплайна). */

import { coalesceBoardOps, diffBoardElements, applyBoardOps, type BoardElementOp } from "./boardOps";
import type { CollabScene } from "./boardSceneMerge";

export type SyncLatencySample = {
  label: string;
  frames: number;
  applyCalls: number;
  finalPoints: number;
  /** Условное «время до финального apply» при 1 apply/кадр (мс при 60fps). */
  coalesceBudgetMs: number;
};

/**
 * Симулирует приём N промежуточных upsert одного штриха и rAF-коалесценцию:
 * за один кадр apply ровно один раз с последней версией.
 */
export function simulateStrokeReceiveCoalesce(pointCounts: number[]): SyncLatencySample {
  let local: CollabScene = { elements: [], appState: {}, files: {} };
  let applyCalls = 0;
  let pending: BoardElementOp[] = [];

  const flushFrame = () => {
    if (!pending.length) return;
    const ops = coalesceBoardOps(pending);
    pending = [];
    local = applyBoardOps(local, { ops });
    applyCalls += 1;
  };

  for (let i = 0; i < pointCounts.length; i += 1) {
    const n = pointCounts[i];
    const points = Array.from({ length: n }, (_, k) => [k, k]);
    const el = { id: "stroke-1", version: i + 1, type: "freedraw", points };
    pending.push({ op: "upsert", element: el });
    // Как rAF: flush раз в «кадр» — здесь каждый 2-й апдейт = конец кадра-пачки.
    // Для worst-case: все кадры копятся, один flush в конце.
  }
  flushFrame();

  const stroke = local.elements.find((e) => (e as { id?: string }).id === "stroke-1") as
    | { points?: unknown[]; version?: number }
    | undefined;
  const finalPoints = Array.isArray(stroke?.points) ? stroke!.points!.length : 0;
  return {
    label: "stroke_coalesce",
    frames: pointCounts.length,
    applyCalls,
    finalPoints,
    coalesceBudgetMs: applyCalls * (1000 / 60),
  };
}

/**
 * Симулирует публикацию штриха: diff после каждого кадра, coalesce на «wire».
 * Возвращает число wire-пакетов при throttle каждые `throttleEvery` кадров.
 */
export function simulateStrokePublishThrottle(
  pointCounts: number[],
  throttleEvery = 2,
): { wirePackets: number; lastPoints: number; opsPerPacket: number[] } {
  let prev: unknown[] | null = null;
  const opsPerPacket: number[] = [];
  let buffered: BoardElementOp[] = [];
  let wirePackets = 0;
  let lastPoints = 0;

  const flush = () => {
    const ops = coalesceBoardOps(buffered);
    buffered = [];
    if (!ops.length) return;
    opsPerPacket.push(ops.length);
    wirePackets += 1;
    const up = ops.find((o) => o.op === "upsert") as { element?: { points?: unknown[] } } | undefined;
    lastPoints = Array.isArray(up?.element?.points) ? up!.element!.points!.length : lastPoints;
  };

  for (let i = 0; i < pointCounts.length; i += 1) {
    const n = pointCounts[i];
    const elements = [
      {
        id: "stroke-1",
        version: i + 1,
        type: "freedraw",
        points: Array.from({ length: n }, (_, k) => [k, Math.sin(k / 3) * 10]),
      },
    ];
    buffered.push(...diffBoardElements(prev, elements));
    prev = elements.map((el) => ({
      ...el,
      points: el.points.map((p) => [...p]),
    }));
    if ((i + 1) % throttleEvery === 0) flush();
  }
  flush();
  return { wirePackets, lastPoints, opsPerPacket };
}

/** Бюджет: при 60 промежуточных точках apply ≤ 1 (после coalesce), points = max. */
export function assertStrokeLatencyBudget(sample: SyncLatencySample): void {
  if (sample.applyCalls !== 1) {
    throw new Error(`expected 1 apply after coalesce, got ${sample.applyCalls}`);
  }
  if (sample.finalPoints < sample.frames) {
    throw new Error(`final points ${sample.finalPoints} < frames ${sample.frames}`);
  }
  if (sample.coalesceBudgetMs > 20) {
    throw new Error(`coalesce budget ${sample.coalesceBudgetMs}ms exceeds 20ms (1 frame)`);
  }
}
