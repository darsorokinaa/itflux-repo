import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_OPTIONS,
  buildBeforeUnloadHandler,
  filledRecordsCount,
  hasUnsavedChanges,
  isAbsentStatus,
  journalSaveStatusLabel,
} from "./journalAutosave";

describe("journalAutosave", () => {
  it("labels save statuses", () => {
    expect(journalSaveStatusLabel("saving")).toContain("Сохранение");
    expect(journalSaveStatusLabel("saved")).toContain("Черновик");
    expect(journalSaveStatusLabel("error")).toContain("Ошибка");
  });

  it("detects unsaved changes", () => {
    expect(hasUnsavedChanges("dirty")).toBe(true);
    expect(hasUnsavedChanges("saved")).toBe(false);
    expect(hasUnsavedChanges("idle")).toBe(false);
  });

  it("beforeunload only when dirty", () => {
    const dirty = buildBeforeUnloadHandler(() => "dirty");
    const event = { preventDefault: () => {}, returnValue: "" } as BeforeUnloadEvent;
    dirty(event);
    expect(event.returnValue).toBe("");

    const clean = buildBeforeUnloadHandler(() => "saved");
    const event2 = { preventDefault: () => {}, returnValue: "x" } as BeforeUnloadEvent;
    clean(event2);
    expect(event2.returnValue).toBe("x");
  });

  it("counts filled records", () => {
    const { filled, total } = filledRecordsCount([
      { attendance_status: "present" },
      { attendance_status: "not_marked" },
      { attendance_status: "not_marked", fields_touched: { teacher_comment: true } },
    ]);
    expect(total).toBe(3);
    expect(filled).toBe(2);
  });

  it("knows absent statuses", () => {
    expect(isAbsentStatus("absent_unexcused")).toBe(true);
    expect(isAbsentStatus("present")).toBe(false);
    expect(ATTENDANCE_OPTIONS.length).toBeGreaterThanOrEqual(10);
  });
});
