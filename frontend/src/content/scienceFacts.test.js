import { describe, expect, it } from "vitest";
import { SCIENCE_FACTS, pickScienceFact } from "./scienceFacts";

const REQUIRED_SNIPPETS = [
  "243 земных суток",
  "восходит на западе",
  "8 минут 20 секунд",
  "полтора часа",
  "Следы астронавтов",
  "чайной ложки",
  "массы всей Солнечной системы",
  "синхронного вращения",
  "Полярное сияние",
  "видим их в прошлом",
  "30 000",
  "идеальном вакууме",
];

const CATEGORIES = [
  "space",
  "physics",
  "math",
  "cs",
  "biology",
  "chemistry",
  "earth",
  "technology",
  "history",
];

describe("scienceFacts", () => {
  it("includes the starter facts and every category", () => {
    expect(SCIENCE_FACTS.length).toBeGreaterThanOrEqual(12);
    const texts = SCIENCE_FACTS.map((fact) => fact.text).join("\n");
    for (const snippet of REQUIRED_SNIPPETS) {
      expect(texts).toContain(snippet);
    }
    expect(new Set(SCIENCE_FACTS.map((fact) => fact.category))).toEqual(new Set(CATEGORIES));
  });

  it("keeps facts short, unique and free of clickbait", () => {
    const texts = SCIENCE_FACTS.map((fact) => fact.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const fact of SCIENCE_FACTS) {
      expect(fact.id).toBeTruthy();
      expect(fact.text.length).toBeGreaterThan(20);
      expect(fact.text.length).toBeLessThanOrEqual(220);
      expect(fact.text.toLowerCase()).not.toContain("вы не поверите");
      expect(fact.text).not.toContain("!");
    }
  });

  it("picks a fact from the local list", () => {
    expect(pickScienceFact(() => 0)).toEqual(SCIENCE_FACTS[0]);
    expect(pickScienceFact(() => 0.999)).toEqual(SCIENCE_FACTS[SCIENCE_FACTS.length - 1]);
  });
});
