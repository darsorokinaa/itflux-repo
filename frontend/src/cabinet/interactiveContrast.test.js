import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  getContrastingTextColor,
  getContrastWarning,
  isAutoTextBackdropEnabled,
  isLightColor,
  parseCssColor,
  relativeLuminance,
  resolveTextBackdrop,
} from "./interactiveContrast";
import {
  canEditInteractive,
  cloneInteractiveForPlay,
  getInteractiveCardMeta,
  getInteractiveInitialState,
  normalizeInteractiveData,
} from "./interactiveNormalize";

describe("interactiveContrast", () => {
  it("parses hex, rgb, named and css-var colors", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("var(--ix-tone-text)")?.r).toBe(15);
  });

  it("computes luminance and light/dark detection beyond black/white", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 2);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 2);
    expect(isLightColor("#f8fafc")).toBe(true);
    expect(isLightColor("#1e293b")).toBe(false);
    expect(isLightColor("#bfdbfe")).toBe(true);
    expect(isLightColor("#2563eb")).toBe(false);
  });

  it("picks contrasting text and backdrop", () => {
    expect(getContrastingTextColor("#ffffff")).toBe("#0f172a");
    expect(getContrastingTextColor("#0f172a")).toBe("#ffffff");

    const lightText = resolveTextBackdrop("#ffffff");
    expect(lightText.needed).toBe(true);
    expect(lightText.textIsLight).toBe(true);
    expect(String(lightText.backdrop)).toContain("0, 0, 0");

    const darkText = resolveTextBackdrop("#0f172a");
    expect(darkText.textIsLight).toBe(false);
    expect(String(darkText.backdrop)).toContain("255, 255, 255");
  });

  it("warns on low contrast combinations", () => {
    expect(getContrastWarning("#ffffff", "#f8fafc")).not.toBeNull();
    expect(getContrastWarning("#0f172a", "#ffffff")).toBeNull();
    expect(contrastRatio("#000", "#fff")).toBeGreaterThan(20);
  });

  it("defaults auto backdrop to enabled for legacy data", () => {
    expect(isAutoTextBackdropEnabled(null)).toBe(true);
    expect(isAutoTextBackdropEnabled({})).toBe(true);
    expect(isAutoTextBackdropEnabled({ autoTextBackdrop: false })).toBe(false);
    expect(isAutoTextBackdropEnabled({ params: { autoTextBackdrop: false } })).toBe(false);
  });
});

describe("interactiveNormalize", () => {
  it("normalizes incomplete / legacy interactive payloads", () => {
    const normalized = normalizeInteractiveData({
      interactive_type: "ordering",
      title: "  Порядок  ",
      description: "null",
      subject: "undefined",
      exam: "без экзамена",
      status: "published",
      ordering_items: [{ text: "A", correct_order: 1 }],
    });

    expect(normalized.type).toBe("sequence");
    expect(normalized.title).toBe("Порядок");
    expect(normalized.description).toBe("");
    expect(normalized.subject).toBe("");
    expect(normalized.steps).toHaveLength(1);
    expect(normalized.params.autoTextBackdrop).toBe(true);
    expect(normalized.params.allowRetry).toBe(true);
  });

  it("builds card meta without empty labels", () => {
    const meta = getInteractiveCardMeta({
      title: "Тест",
      subject: "",
      exam: "без экзамена",
      topic: "Логика",
      difficulty: "",
      description: null,
    });
    expect(meta.metaParts.map((p) => p.label)).toContain("Логика");
    expect(meta.metaParts.every((p) => p.label && p.label !== "null")).toBe(true);
    expect(meta.description).toBe("");
  });

  it("clones play data without mutating source", () => {
    const source = { id: 1, type: "quiz", questions: [{ text: "Q", answers: [] }] };
    const clone = cloneInteractiveForPlay(source);
    clone.questions[0].text = "Changed";
    expect(source.questions[0].text).toBe("Q");
  });

  it("returns fresh initial play state", () => {
    const state = getInteractiveInitialState({ type: "flashcards" });
    expect(state.started).toBe(false);
    expect(state.completed).toBe(false);
    expect(state.answers).toEqual({});
  });

  it("checks edit ownership", () => {
    expect(canEditInteractive({ id: 1 }, 5)).toBe(true);
    expect(canEditInteractive({ id: 1, isOwner: false }, 5)).toBe(false);
    expect(canEditInteractive({ id: 1, teacherId: 5 }, 5)).toBe(true);
    expect(canEditInteractive({ id: 1, teacher_id: 9 }, 5)).toBe(false);
  });
});
