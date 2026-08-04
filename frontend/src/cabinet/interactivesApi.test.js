import { describe, expect, it } from "vitest";
import {
  buildInteractiveWritePayload,
  mapApiInteractiveDetail,
  mapApiInteractiveListItem,
  mergeInteractiveAfterSave,
  normalizeInteractivesList,
} from "./interactivesApi";
import { getItemCount } from "./interactivesData";

describe("interactivesApi adapters", () => {
  it("maps list item without nested content and keeps id", () => {
    const mapped = mapApiInteractiveListItem({
      id: 42,
      title: "Тест",
      interactive_type: "flashcards",
      status: "draft",
      direction: "oge",
      exam_type: "oge",
      items_count: 3,
      updated_at: "2026-08-01T10:00:00Z",
    });
    expect(mapped.id).toBe(42);
    expect(mapped.type).toBe("flashcards");
    expect(mapped.cards).toEqual([]);
    expect(mapped.status).toBe("draft");
    expect(getItemCount(mapped)).toBe(3);
  });

  it("maps detail with empty optional fields without crashing", () => {
    const mapped = mapApiInteractiveDetail({
      id: 7,
      title: "",
      interactive_type: "matching",
      status: "draft",
      direction: "other",
      exam_type: "none",
      matching_pairs: [],
    });
    expect(mapped.id).toBe(7);
    expect(mapped.type).toBe("matching");
    expect(mapped.pairs.length).toBeGreaterThan(0);
    expect(mapped.pairs[0].left).toBe("");
    expect(mapped.subject).toBeTruthy();
  });

  it("maps ordering type to sequence and accepts missing cover/images", () => {
    const mapped = mapApiInteractiveDetail({
      id: 9,
      title: "Порядок",
      interactive_type: "ordering",
      status: "published",
      ordering_items: [{ text: "step", correct_order: 1, image_url: "" }],
    });
    expect(mapped.type).toBe("sequence");
    expect(mapped.steps).toHaveLength(1);
    expect(mapped.steps[0].image_url).toBe("");
  });

  it("mergeInteractiveAfterSave keeps current id if response omits it", () => {
    const current = mapApiInteractiveDetail({
      id: 15,
      title: "Было",
      interactive_type: "flashcards",
      flashcards: [{ front_text: "a", back_text: "b", order: 0 }],
    });
    const merged = mergeInteractiveAfterSave(current, {
      title: "Стало",
      interactive_type: "flashcards",
      flashcards: [{ front_text: "a", back_text: "b", order: 0 }],
      status: "draft",
    });
    expect(merged.id).toBe(15);
    expect(merged.title).toBe("Стало");
  });

  it("buildInteractiveWritePayload keeps relative image urls", () => {
    const payload = buildInteractiveWritePayload({
      type: "flashcards",
      title: "X",
      exam: "ОГЭ",
      status: "draft",
      cards: [{
        front: "f",
        back: "b",
        front_image_url: "/media/x.png",
        back_image_url: "",
      }],
    });
    expect(payload.flashcards[0].front_image_url).toBe("/media/x.png");
    expect(payload.interactive_type).toBe("flashcards");
  });

  it("normalizeInteractivesList handles array and paginated shapes", () => {
    expect(normalizeInteractivesList([{ id: 1 }])).toHaveLength(1);
    expect(normalizeInteractivesList({ results: [{ id: 2 }] })).toHaveLength(1);
    expect(normalizeInteractivesList(null)).toEqual([]);
  });

  it("getItemCount is safe for null", () => {
    expect(getItemCount(null)).toBe(0);
    expect(getItemCount(undefined)).toBe(0);
  });

  it("mapApiInteractiveListItem returns null for invalid input", () => {
    expect(mapApiInteractiveListItem(null)).toBeNull();
    expect(mapApiInteractiveListItem(undefined)).toBeNull();
  });
});
