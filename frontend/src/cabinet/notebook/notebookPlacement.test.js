import { describe, expect, it } from "vitest";
import { fitImageBox, placeReviewContent, wrapPlainText } from "./notebookPlacement";

describe("review notebook placement", () => {
  it("pins a wide picture to the top instead of the vertical center", () => {
    const box = fitImageBox(2000, 500, 1000, 1414, { align: "top" });
    expect(box.y).toBe(36);
    expect(box.w).toBeLessThanOrEqual(1000 - 72);
    expect(box.x).toBeGreaterThan(0);
    expect(box.y + box.h).toBeLessThan(1414 / 2);
  });

  it("keeps a previously marked photo in the old centered frame", () => {
    const box = fitImageBox(2000, 500, 1000, 1414, { align: "center" });
    expect(box.y).toBeGreaterThan(100);
    expect(box.x).toBeGreaterThanOrEqual(0);
  });

  it("wraps a long answer onto several lines", () => {
    const text = wrapPlainText("один два три четыре пять шесть семь", { maxWidth: 80, fontSize: 22 });
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("places the answer text and the photo at the top, once", async () => {
    const doc = {
      id: "n1",
      owner_role: "teacher",
      answer_text: "<p>Ответ ученика</p>",
      pages: [{
        id: "p1",
        page_type: "attachment",
        width: 1000,
        height: 1414,
        source_attachment: { id: "file-1", url: "/photo.jpg", mime_type: "image/jpeg", filename: "photo.jpg" },
        state: { version: 1, objects: [] },
      }],
    };
    const placed = await placeReviewContent(doc, {
      loadSize: async () => ({ w: 1600, h: 400 }),
    });
    const objects = placed.doc.pages[0].state.objects;
    const text = objects.find((obj) => obj.type === "text");
    const image = objects.find((obj) => obj.type === "image");
    expect(text.text).toBe("Ответ ученика");
    expect(text.y).toBeLessThan(80);
    expect(image.y).toBeGreaterThan(text.y);
    expect(image.y).toBeLessThan(200);
    expect(image.src).toBe("/photo.jpg");
    expect(placed.selectId).toBe(image.id);

    const again = await placeReviewContent(placed.doc, {
      loadSize: async () => ({ w: 1600, h: 400 }),
    });
    expect(again).toBeNull();
  });

  it("does not restack a photo that already has ink", async () => {
    const doc = {
      id: "n1",
      owner_role: "teacher",
      answer_text: "42",
      pages: [{
        id: "p1",
        width: 1000,
        height: 1414,
        source_attachment: { id: "file-1", url: "/photo.jpg", mime_type: "image/jpeg", filename: "photo.jpg" },
        state: {
          objects: [{ id: "ink", type: "pen", points: [{ x: 1, y: 1 }, { x: 4, y: 4 }] }],
        },
      }],
    };
    const placed = await placeReviewContent(doc, {
      loadSize: async () => ({ w: 2000, h: 500 }),
    });
    const objects = placed.doc.pages[0].state.objects;
    expect(objects.some((obj) => obj.sourceKey === "answer-text")).toBe(false);
    const image = objects.find((obj) => obj.type === "image");
    expect(image.y).toBeGreaterThan(100);
  });
});
