import { describe, expect, it } from "vitest";
import {
  eventDisplaySubtitle,
  eventDisplayTitle,
  getUpcomingEvents,
  upcomingEventDateLabel,
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
