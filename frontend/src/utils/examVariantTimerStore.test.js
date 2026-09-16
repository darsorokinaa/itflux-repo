import { afterEach, describe, expect, it, vi } from "vitest";
import { createExamVariantTimerStore } from "./examVariantTimerStore";

describe("examVariantTimerStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses startedAt as source of truth after remount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const first = createExamVariantTimerStore();
    first.setStatus("running");
    expect(first.getStartedAtIso()).toBe("2026-01-01T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-01-01T12:00:10.000Z"));
    first.nudge();
    expect(first.getSeconds()).toBe(10);
    const startedAt = first.getStartedAtIso();
    first.destroy();

    const second = createExamVariantTimerStore();
    expect(second.getSeconds()).toBe(0);
    second.restoreFromStartedAt(startedAt);
    expect(second.getSeconds()).toBe(10);
    vi.setSystemTime(new Date("2026-01-01T12:00:25.000Z"));
    second.nudge();
    expect(second.getSeconds()).toBe(25);
    second.destroy();
  });

  it("does not reset elapsed while paused", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    const store = createExamVariantTimerStore();
    store.setStatus("running");
    vi.setSystemTime(new Date("2026-01-01T12:01:00.000Z"));
    store.setStatus("paused");
    expect(store.getSeconds()).toBe(60);
    vi.setSystemTime(new Date("2026-01-01T12:05:00.000Z"));
    store.nudge();
    expect(store.getSeconds()).toBe(60);
    store.setStatus("running");
    vi.setSystemTime(new Date("2026-01-01T12:05:10.000Z"));
    store.nudge();
    expect(store.getSeconds()).toBe(70);
    store.destroy();
  });
});
