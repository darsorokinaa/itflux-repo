import { describe, expect, it } from "vitest";
import {
  mapApiPlan,
  mapPlanToHomeworkCard,
  planItemIsPassed,
  planProgressCompleted,
  planProgressLabel,
  planProgressTotal,
} from "./lessonPlansData";

describe("planProgressLabel", () => {
  it("always shows conducted lessons for personal plans, including zero", () => {
    expect(planProgressLabel({
      lessonsCount: 8,
      itemsCount: 8,
      completedCount: 0,
      progressPercent: 0,
    })).toBe("0 из 8 занятий");
  });

  it("uses completedCount instead of reconstructing from percent", () => {
    expect(planProgressLabel({
      itemsCount: 80,
      lessonsCount: 80,
      completedCount: 1,
      progressPercent: 1,
    })).toBe("1 из 80 занятий");
  });

  it("prefers live itemsCount over stale lessonsCount", () => {
    expect(planProgressTotal({ itemsCount: 54, lessonsCount: 8 })).toBe(54);
    expect(planProgressLabel({
      itemsCount: 54,
      lessonsCount: 8,
      completedCount: 3,
    })).toBe("3 из 54 занятий");
  });

  it("keeps catalog cards as a total without conducted progress", () => {
    expect(planProgressLabel({
      itemsCount: 54,
      completedCount: 0,
      isPublic: true,
    })).toBe("54 занятия");
  });

  it("falls back to item statuses when completedCount is missing", () => {
    expect(planProgressCompleted({
      items: [
        { status: "completed" },
        { status: "planned" },
        { status: "completed" },
      ],
    })).toBe(2);
  });

  it("counts past dates as passed even without completed status", () => {
    const now = new Date(2026, 7, 28, 12, 0, 0);
    expect(planProgressCompleted({
      items: [
        { status: "planned", scheduledDate: "2026-08-20" },
        { status: "planned", scheduledDate: "2026-09-04" },
        { status: "completed", scheduledEventStartsAt: "2026-09-10T10:00:00" },
      ],
    }, now)).toBe(1);
  });

  it("does not count a future lesson as passed even if status is completed", () => {
    const now = new Date(2026, 7, 28, 12, 0, 0);
    expect(planItemIsPassed({
      status: "completed",
      scheduledEventStartsAt: "2026-09-02T15:00:00",
    }, now)).toBe(false);
    expect(planItemIsPassed({
      status: "planned",
      scheduledEventStartsAt: "2026-08-27T15:00:00",
    }, now)).toBe(true);
  });
});

describe("mapPlanToHomeworkCard", () => {
  it("shows conducted progress on personal plan cards even at 0%", () => {
    const plan = mapApiPlan({
      id: 1,
      title: "Информатика",
      lessons_count: 0,
      items_count: 12,
      completed_count: 0,
      progress_percent: 0,
      status: "published",
      is_public: false,
    });
    const card = mapPlanToHomeworkCard(plan, { scope: "mine" });
    expect(card.progressLabel).toBe("0 из 12 занятий");
    expect(card.hideProgressBar).toBe(false);
  });
});
