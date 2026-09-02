import { describe, expect, it } from "vitest";
import {
  canonicalizePlanSubjectId,
  filterPlans,
  mapApiPlan,
  mapPlanToHomeworkCard,
  PLAN_LEVELS,
  planItemIsPassed,
  planLevelLabelFromId,
  planProgressCompleted,
  planProgressLabel,
  planProgressTotal,
  planSubjectLabel,
  planSubjectLine,
  resolvePlanLevelSelection,
  resolvePlanSubjectSelection,
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

describe("plan subject and level labels", () => {
  it("keeps math/physics/russian instead of falling back to informatics", () => {
    expect(planSubjectLabel({ subject: "math", direction: "oge" })).toBe("Математика");
    expect(planSubjectLabel({ subject: "phys", direction: "oge" })).toBe("Физика");
    expect(planSubjectLabel({ subject: "rus", direction: "oge" })).toBe("Русский язык");
    expect(planSubjectLabel({ subject: "inf", direction: "ege" })).toBe("Информатика");
    expect(planSubjectLabel({ direction: "oge" })).toBe("");
    expect(planSubjectLabel("oge")).toBe("");
  });

  it("maps catalog aliases onto generator subject ids without inventing informatics", () => {
    const options = [
      { id: "math_base", label: "Математика базовая" },
      { id: "physics", label: "Физика" },
      { id: "russian", label: "Русский язык" },
      { id: "inf", label: "Информатика" },
    ];
    expect(resolvePlanSubjectSelection("math", options)).toBe("math_base");
    expect(resolvePlanSubjectSelection("phys", options)).toBe("physics");
    expect(resolvePlanSubjectSelection("rus", options)).toBe("russian");
    expect(canonicalizePlanSubjectId("informatics", ["inf", "math"])).toBe("inf");
    expect(resolvePlanSubjectSelection("chem", options)).toBe("chem");
  });

  it("does not fill empty subject as informatics when mapping an API plan", () => {
    const mathPlan = mapApiPlan({
      id: 2,
      title: "ОГЭ математика",
      subject: "math",
      subject_label: "Математика",
      direction: "oge",
      direction_label: "ОГЭ",
      status: "published",
    });
    expect(mathPlan.subject).toBe("math");
    expect(planSubjectLine(mathPlan)).toContain("Математика");
    expect(planSubjectLine(mathPlan)).toContain("ОГЭ");
    expect(planLevelLabelFromId("ege")).toBe("ЕГЭ");
    expect(planLevelLabelFromId("school")).toBe("Школьная программа");

    const emptySubject = mapApiPlan({
      id: 3,
      title: "План",
      direction: "ege",
      status: "draft",
    });
    expect(emptySubject.subject).toBe("");
    expect(planSubjectLabel(emptySubject)).toBe("");
  });

  it("filters by stored subject, not by exam direction", () => {
    const plans = [
      mapApiPlan({ id: 1, title: "Математика ОГЭ", subject: "math", direction: "oge", status: "published" }),
      mapApiPlan({ id: 2, title: "Информатика ОГЭ", subject: "inf", direction: "oge", status: "published" }),
      mapApiPlan({ id: 3, title: "Физика ОГЭ", subject: "phys", direction: "oge", status: "published" }),
    ];
    expect(filterPlans(plans, "math").map((p) => p.id)).toEqual([1]);
    expect(filterPlans(plans, "informatics").map((p) => p.id)).toEqual([2]);
    expect(filterPlans(plans, "physics").map((p) => p.id)).toEqual([3]);
    expect(filterPlans(plans, "oge").map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("keeps exam level ids instead of dropping them", () => {
    expect(resolvePlanLevelSelection("ege", PLAN_LEVELS)).toBe("ege");
    expect(resolvePlanLevelSelection("school", PLAN_LEVELS)).toBe("school");
    expect(resolvePlanLevelSelection("vpr", [{ id: "oge", label: "ОГЭ" }])).toBe("vpr");
  });
});

