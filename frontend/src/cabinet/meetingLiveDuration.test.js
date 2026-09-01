import { describe, expect, it } from "vitest";

import {
  LIVE_WARN_MS,
  MAX_LIVE_MS,
  classifyLiveDurationUi,
  liveElapsedMs,
} from "./meetingLiveDuration";

describe("classifyLiveDurationUi", () => {
  const startedAt = "2026-09-01T10:00:00.000Z";
  const t0 = Date.parse(startedAt);

  it("stays quiet during a normal lesson", () => {
    expect(classifyLiveDurationUi({
      startedAt,
      now: t0 + 50 * 60 * 1000,
      canManage: true,
    }).phase).toBe("ok");
    expect(liveElapsedMs(startedAt, t0 + 1000)).toBe(1000);
  });

  it("warns the teacher before the 2 hour cap", () => {
    const ui = classifyLiveDurationUi({
      startedAt,
      now: t0 + LIVE_WARN_MS,
      canManage: true,
    });
    expect(ui.phase).toBe("warn");
    expect(ui.showFinish).toBe(true);
    expect(ui.title).toMatch(/завершить/i);
    expect(ui.text).toMatch(/создайте новый/i);
  });

  it("asks to finish after 2 hours", () => {
    const ui = classifyLiveDurationUi({
      startedAt,
      now: t0 + MAX_LIVE_MS,
      canManage: true,
    });
    expect(ui.phase).toBe("overdue");
    expect(ui.text).toMatch(/2 часов/);
  });

  it("does not offer finish to a student", () => {
    const ui = classifyLiveDurationUi({
      startedAt,
      now: t0 + LIVE_WARN_MS,
      canManage: false,
    });
    expect(ui.showFinish).toBe(false);
    expect(ui.title).toMatch(/скоро завершится/i);
  });
});
