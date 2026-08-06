import { describe, expect, it } from "vitest";
import {
  assertStrokeLatencyBudget,
  simulateStrokePublishThrottle,
  simulateStrokeReceiveCoalesce,
} from "./boardSyncLatency";

describe("boardSyncLatency", () => {
  it("коалесцирует 60 кадров штриха в 1 apply с полными points", () => {
    const counts = Array.from({ length: 60 }, (_, i) => i + 1);
    const sample = simulateStrokeReceiveCoalesce(counts);
    expect(sample.applyCalls).toBe(1);
    expect(sample.finalPoints).toBe(60);
    expect(sample.coalesceBudgetMs).toBeLessThanOrEqual(20);
    assertStrokeLatencyBudget(sample);
  });

  it("throttle публикации сжимает wire-пакеты и сохраняет финальные points", () => {
    const counts = Array.from({ length: 40 }, (_, i) => (i + 1) * 2);
    const pub = simulateStrokePublishThrottle(counts, 4);
    // 40 кадров / 4 + финальный flush ≤ 11
    expect(pub.wirePackets).toBeLessThanOrEqual(11);
    expect(pub.wirePackets).toBeGreaterThan(0);
    expect(pub.lastPoints).toBe(80);
    // Каждый пакет после coalesce — один upsert штриха.
    expect(pub.opsPerPacket.every((n) => n === 1)).toBe(true);
  });

  it("бюджет: до/после coalesce — без минутной очереди apply", () => {
    // «До»: наивно 60 apply. «После»: 1 apply.
    const beforeApplyCalls = 60;
    const after = simulateStrokeReceiveCoalesce(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(after.applyCalls).toBe(1);
    expect(after.applyCalls / beforeApplyCalls).toBeLessThanOrEqual(1 / 60);
  });
});
