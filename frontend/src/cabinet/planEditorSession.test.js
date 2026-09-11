import { describe, expect, it } from "vitest";
import {
  EMPTY_PLAN_SESSION,
  adoptApiSession,
  clonePlanSession,
  keepLocalSessionWithRemoteId,
  mapPlanItemToEditorSession,
  resolveLivePlanSession,
  sessionHasPersistableContent,
  sessionListKey,
  sessionPersistTitle,
} from "./planEditorSession";

describe("planEditorSession identity", () => {
  it("gives cloned lessons a stable client key distinct from index", () => {
    const first = clonePlanSession(EMPTY_PLAN_SESSION);
    const second = clonePlanSession(EMPTY_PLAN_SESSION);
    expect(first.clientKey).toMatch(/^draft-/);
    expect(second.clientKey).toMatch(/^draft-/);
    expect(first.clientKey).not.toBe(second.clientKey);
    expect(sessionListKey(first, 0)).toBe(first.clientKey);
    expect(sessionListKey(second, 1)).toBe(second.clientKey);
  });

  it("keeps the local client key when an API id appears", () => {
    const local = clonePlanSession(EMPTY_PLAN_SESSION);
    local.title = "Системы счисления";
    const merged = keepLocalSessionWithRemoteId(local, { id: 42 });
    expect(merged.id).toBe(42);
    expect(merged.clientKey).toBe(local.clientKey);
    expect(merged.title).toBe("Системы счисления");
  });

  it("maps calendar dates without keeping a datetime suffix", () => {
    const session = mapPlanItemToEditorSession({
      id: 7,
      title: "Урок",
      scheduled_date: "2026-09-11T00:00:00Z",
    });
    expect(session.scheduledDate).toBe("2026-09-11");
    expect(session.clientKey).toBe("item-7");
  });

  it("adopts API fields but preserves the in-progress client key", () => {
    const local = clonePlanSession(EMPTY_PLAN_SESSION);
    local.topic = "Системы";
    const adopted = adoptApiSession({
      id: 9,
      title: "Урок 1",
      topic: "Другое",
      scheduled_date: "2026-09-11",
    }, local);
    expect(adopted.id).toBe(9);
    expect(adopted.clientKey).toBe(local.clientKey);
    expect(adopted.scheduledDate).toBe("2026-09-11");
  });

  it("prefers the live date over a stale snapshot while saving", () => {
    const snapshot = { id: 7, clientKey: "item-7", scheduledDate: "2026-09-11", title: "ДЗ" };
    const live = [
      { id: 7, clientKey: "item-7", scheduledDate: "2026-09-22", title: "ДЗ" },
    ];
    expect(resolveLivePlanSession(live, snapshot, 0).scheduledDate).toBe("2026-09-22");
    expect(resolveLivePlanSession([], snapshot, 0)).toBeNull();
  });

  it("treats a dated untitled lesson as persistable", () => {
    const session = clonePlanSession(EMPTY_PLAN_SESSION);
    session.scheduledDate = "2026-09-11";
    expect(sessionHasPersistableContent(session)).toBe(true);
    expect(sessionPersistTitle(session, 0)).toBe("Урок 1");
  });
});
