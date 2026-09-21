import { describe, expect, it } from "vitest";
import {
  chooseNote,
  pickSpotlight,
  rememberSpotlight,
} from "./dashboardEngagement";

const TODAY = "2026-09-21";
const YESTERDAY = "2026-09-20";

function engagement(cards) {
  return { cards };
}

describe("pickSpotlight", () => {
  it("prefers a rare moment over the daily note", () => {
    const card = pickSpotlight(engagement([
      { kind: "easter", id: "easter-lesson-100", cooldown_days: 3650, title: "100" },
      { kind: "note", id: "note", candidates: [{ id: "n1", text: "Тихий день" }] },
    ]), null, TODAY);
    expect(card.id).toBe("easter-lesson-100");
  });

  it("does not show the same easter the next day", () => {
    const first = pickSpotlight(engagement([
      { kind: "easter", id: "easter-lesson-100", cooldown_days: 3650, title: "100" },
      { kind: "note", id: "note", candidates: [{ id: "n1", text: "Тихий день" }] },
    ]), null, TODAY);
    const memory = rememberSpotlight(null, first, TODAY);
    const next = pickSpotlight(engagement([
      { kind: "easter", id: "easter-lesson-100", cooldown_days: 3650, title: "100" },
      { kind: "note", id: "note", candidates: [{ id: "n1", text: "Тихий день" }] },
    ]), memory, YESTERDAY === TODAY ? TODAY : "2026-09-22");
    expect(next.kind).toBe("note");
    expect(next.title).toBe("Тихий день");
  });

  it("keeps the chosen card for the rest of the day", () => {
    const first = pickSpotlight(engagement([
      { kind: "week", id: "week-2026-38", title: "Ваша неделя" },
      { kind: "recommendation", id: "rec-reviews", title: "Проверить" },
    ]), null, TODAY);
    const memory = rememberSpotlight(null, first, TODAY);
    const again = pickSpotlight(engagement([
      { kind: "week", id: "week-2026-38", title: "Ваша неделя" },
      { kind: "recommendation", id: "rec-reviews", title: "Проверить" },
    ]), memory, TODAY);
    expect(again.id).toBe("week-2026-38");
  });

  it("shows the week summary once, then a recommendation", () => {
    const first = pickSpotlight(engagement([
      { kind: "week", id: "week-2026-38", title: "Ваша неделя" },
      { kind: "recommendation", id: "rec-reviews", title: "Проверить" },
    ]), null, TODAY);
    const memory = rememberSpotlight(null, first, TODAY);
    const next = pickSpotlight(engagement([
      { kind: "week", id: "week-2026-38", title: "Ваша неделя" },
      { kind: "recommendation", id: "rec-reviews", title: "Проверить" },
    ]), memory, "2026-09-22");
    expect(next.id).toBe("rec-reviews");
  });

  it("skips a daily note the person already saw", () => {
    const note = chooseNote(
      [{ id: "n1", text: "Первая" }, { id: "n2", text: "Вторая" }],
      { noteRecent: ["n1"], noteToday: null },
      TODAY,
    );
    expect(note.id).toBe("n2");
  });
});
