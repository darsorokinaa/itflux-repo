import { describe, expect, it } from "vitest";
import { buildPlanHighlights, formatStorageLabel } from "./planHighlights";

describe("formatStorageLabel", () => {
  it("formats megabytes and gigabytes", () => {
    expect(formatStorageLabel(512)).toBe("512 МБ");
    expect(formatStorageLabel(1024)).toBe("1 ГБ");
    expect(formatStorageLabel(3072)).toBe("3 ГБ");
    expect(formatStorageLabel(10240)).toBe("10 ГБ");
  });
});

describe("buildPlanHighlights", () => {
  const teacher = {
    slug: "teacher",
    limits: {
      students: 10,
      groups: 5,
      storage_mb: 1024,
      variants_monthly: 100,
      workbooks_monthly: 30,
      interactives: 10,
      ai_requests: 150,
    },
    features: { basic_notifications: true, extended_library: true },
  };

  it("includes storage, groups and interactives", () => {
    const lines = buildPlanHighlights(teacher).map((item) =>
      typeof item === "string" ? item : item.text,
    );
    expect(lines).toContain("1 ГБ хранилища");
    expect(lines).toContain("до 5 групп");
    expect(lines).toContain("10 интерактивов в месяц");
    expect(lines).toContain("уведомления");
    expect(lines).toContain("Запись учеников по ссылке");
  });

  it("adds AI only when requested", () => {
    const withoutAi = buildPlanHighlights(teacher).join(" ");
    const withAi = buildPlanHighlights(teacher, { includeAi: true }).join(" ");
    expect(withoutAi).not.toContain("ИИ-запрос");
    expect(withAi).toContain("150 ИИ-запросов в месяц");
  });

  it("shows unlimited groups for premium", () => {
    const lines = buildPlanHighlights({
      slug: "premium",
      limits: { students: 30, groups: null, storage_mb: 10240, variants_monthly: null },
      features: { priority_support: true, analytics: true, advanced_notifications: true },
    });
    expect(lines).toContain("группы без лимита");
    expect(lines).toContain("10 ГБ хранилища");
  });
});
