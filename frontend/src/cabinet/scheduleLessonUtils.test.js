import { describe, expect, it } from "vitest";
import {
  eventDisplaySubtitle,
  eventDisplayTitle,
  getUpcomingEvents,
  upcomingEventDateLabel,
  getCalendarFetchWindows,
  getCalendarFetchRange,
  mergeScheduleEventLists,
} from "./scheduleLessonUtils";

describe("eventDisplayTitle", () => {
  it("prefers the complete student name over a first-name title", () => {
    expect(eventDisplayTitle({
      title: "Стефания",
      audience: "Стефания Палей",
    })).toBe("Стефания Палей");
  });

  it("does not mix a custom topic with the student name", () => {
    expect(eventDisplayTitle({
      title: "Кодирование информации",
      audience: "Стефания Палей",
    })).toBe("Кодирование информации");
  });
});

describe("eventDisplaySubtitle", () => {
  it("does not repeat overlapping names in the subtitle", () => {
    expect(eventDisplaySubtitle({
      title: "Стефания",
      audience: "Стефания Палей",
      studentSubjectLabel: "Информатика · ОГЭ",
    })).toBe("Информатика · ОГЭ");
  });
});

describe("getUpcomingEvents", () => {
  const now = new Date("2026-08-24T08:00:00+03:00");

  it("sorts by datetime, not by clock time", () => {
    const events = [
      {
        id: "late",
        title: "Стефания Палей",
        startsAt: "2026-08-24T14:00:00+03:00",
        studentSubjectLabel: "Информатика · ОГЭ",
      },
      {
        id: "early",
        title: "Александр Федоров",
        startsAt: "2026-08-24T10:00:00+03:00",
        studentSubjectLabel: "Информатика · ЕГЭ",
      },
    ];
    expect(getUpcomingEvents(events, 3, now).map((ev) => ev.id)).toEqual(["early", "late"]);
  });

  it("dedupes the same student at the same time and keeps the full name", () => {
    const events = [
      {
        id: "short",
        title: "Стефания",
        audience: "Стефания",
        startsAt: "2026-08-24T14:00:00+03:00",
        studentSubjectLabel: "Информатика · ОГЭ",
      },
      {
        id: "full",
        title: "Стефания Палей",
        audience: "Стефания Палей",
        startsAt: "2026-08-24T14:00:00+03:00",
        studentSubjectLabel: "Информатика · ОГЭ",
      },
      {
        id: "other",
        title: "Александр Федоров",
        startsAt: "2026-08-24T10:00:00+03:00",
      },
    ];
    const upcoming = getUpcomingEvents(events, 3, now);
    expect(upcoming.map((ev) => ev.id)).toEqual(["other", "full"]);
    expect(eventDisplayTitle(upcoming[1])).toBe("Стефания Палей");
  });

  it("keeps two different students at the same time", () => {
    const events = [
      { id: "a", title: "Стефания Палей", startsAt: "2026-08-24T14:00:00+03:00" },
      { id: "b", title: "Александр Федоров", startsAt: "2026-08-24T14:00:00+03:00" },
    ];
    expect(getUpcomingEvents(events, 3, now).map((ev) => ev.id).sort()).toEqual(["a", "b"]);
  });

  it("skips cancelled and past lessons", () => {
    const events = [
      { id: "past", title: "Утро", startsAt: "2026-08-24T07:00:00+03:00" },
      { id: "cancel", title: "Отмена", startsAt: "2026-08-24T11:00:00+03:00", status: "cancelled" },
      { id: "ok", title: "День", startsAt: "2026-08-24T12:00:00+03:00" },
    ];
    expect(getUpcomingEvents(events, 3, now).map((ev) => ev.id)).toEqual(["ok"]);
  });
});

describe("upcomingEventDateLabel", () => {
  const now = new Date("2026-08-24T08:00:00+03:00");

  it("labels today and tomorrow", () => {
    expect(upcomingEventDateLabel({ startsAt: "2026-08-24T14:00:00+03:00" }, now)).toBe("сегодня");
    expect(upcomingEventDateLabel({ startsAt: "2026-08-25T10:00:00+03:00" }, now)).toBe("завтра");
  });
});

describe("getCalendarFetchWindows", () => {
  const now = new Date("2026-09-08T12:00:00");

  it("keeps current month as a single window", () => {
    const windows = getCalendarFetchWindows("month", new Date(2026, 8, 8), now);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("does not fetch the months between a past month and upcoming", () => {
    const windows = getCalendarFetchWindows("month", new Date(2026, 0, 15), now);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(windows[1]).toEqual({ from: "2026-09-08", to: "2026-09-29" });
    const union = getCalendarFetchRange("month", new Date(2026, 0, 15), now);
    expect(union).toEqual({ from: "2026-01-01", to: "2026-09-29" });
  });

  it("merges event batches by id", () => {
    const merged = mergeScheduleEventLists([
      { events: [{ id: "local-1" }, { id: "local-2" }] },
      { events: [{ id: "local-2" }, { id: "local-3" }] },
    ]);
    expect(merged.map((ev) => ev.id)).toEqual(["local-1", "local-2", "local-3"]);
  });

  it("dedupes overlapping visible/upcoming windows and sorts by startsAt", () => {
    const merged = mergeScheduleEventLists([
      [
        { id: 2, startsAt: "2026-09-20T10:00:00+03:00" },
        { id: 1, startsAt: "2026-09-08T09:00:00+03:00" },
      ],
      [
        { id: 1, startsAt: "2026-09-08T09:00:00+03:00", title: "from-upcoming" },
        { id: 3, startsAt: "2026-09-25T11:00:00+03:00" },
      ],
    ]);
    expect(merged.map((ev) => ev.id)).toEqual([1, 2, 3]);
    expect(merged[0].title).toBe("from-upcoming");
  });
});
