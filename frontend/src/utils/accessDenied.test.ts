/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  accessDeniedMessage,
  isAnonLimitError,
  parseAccessDenied,
} from "./accessDenied";
import {
  accessGateCopy,
  classifyAccessError,
  safeReturnPath,
} from "../accessGate/accessGate";

describe("accessDenied", () => {
  it("parses a flat AccessDenied payload", () => {
    const payload = parseAccessDenied({
      code: "ANON_VARIANT_LIMIT_REACHED",
      message: "Лимит вариантов без регистрации исчерпан. Зарегистрируйтесь или выберите тариф.",
      feature: "variants",
      upgrade_required: true,
    });
    expect(payload?.code).toBe("ANON_VARIANT_LIMIT_REACHED");
    expect(payload?.feature).toBe("variants");
    expect(isAnonLimitError(payload)).toBe(true);
  });

  it("parses nested error, data and DRF detail wrappers", () => {
    expect(
      parseAccessDenied({
        error: {
          code: "ANON_WORKBOOK_LIMIT_REACHED",
          message: "Лимит тетрадей без регистрации исчерпан.",
          feature: "workbooks",
        },
      })?.code,
    ).toBe("ANON_WORKBOOK_LIMIT_REACHED");

    expect(
      isAnonLimitError({
        data: { code: "ANON_VARIANT_LIMIT_REACHED", message: "limit" },
      }),
    ).toBe(true);

    expect(
      parseAccessDenied({
        detail: { code: "SCHEDULE_REQUIRES_PAID_PLAN", message: "Расписание", min_plan: "teacher" },
      })?.code,
    ).toBe("SCHEDULE_REQUIRES_PAID_PLAN");
  });

  it("does not treat other 403s as anonymous limit", () => {
    expect(
      isAnonLimitError({
        code: "VARIANT_LIMIT_REACHED",
        message: "Лимит генерации вариантов исчерпан",
      }),
    ).toBe(false);
    expect(parseAccessDenied({ error: "Forbidden" })).toBeNull();
  });

  it("prefers AccessDenied message over generic Error text", () => {
    const err = Object.assign(new Error("Forbidden"), {
      data: {
        code: "ANON_VARIANT_LIMIT_REACHED",
        message: "Зарегистрируйтесь",
      },
    });
    expect(accessDeniedMessage(err)).toBe("Зарегистрируйтесь");
  });
});

describe("classifyAccessError", () => {
  it("maps anonymous limits to registration, paid content to plan, quotas to limit", () => {
    expect(classifyAccessError({ code: "ANON_VARIANT_LIMIT_REACHED", feature: "variants" })?.reason).toBe("anonymous");
    expect(classifyAccessError({ code: "CONTENT_ACCESS_DENIED", min_plan: "pro" })?.reason).toBe("insufficient_plan");
    expect(classifyAccessError({ code: "SCHEDULE_REQUIRES_PAID_PLAN", min_plan: "teacher" })?.reason).toBe("feature_not_in_plan");
    expect(classifyAccessError({ code: "STUDENT_LIMIT_REACHED" })?.reason).toBe("limit_reached");
    expect(classifyAccessError({ code: "VARIANT_LIMIT_REACHED" })?.reason).toBe("limit_reached");
    expect(classifyAccessError({ status: 500, message: "boom" })).toBeNull();
    expect(classifyAccessError({ code: "schedule_conflict", error: "В это время уже есть занятие." })).toBeNull();
    expect(
      classifyAccessError({
        data: { ok: false, error: "В это время уже есть занятие.", code: "schedule_conflict" },
      }),
    ).toBeNull();
  });
});

describe("accessGateCopy and safeReturnPath", () => {
  it("uses registration CTA for anonymous and tariffs for authenticated plan gaps", () => {
    const anon = accessGateCopy({ reason: "anonymous", resourceType: "lesson", requiredPlan: "pro" });
    expect(anon.primary).toBe("Зарегистрироваться бесплатно");
    expect(anon.title).toContain("регистрация");

    const plan = accessGateCopy(
      { reason: "insufficient_plan", resourceType: "lesson", requiredPlan: "pro" },
      { requiredPlanName: "Профи" },
    );
    expect(plan.primary).toBe("Посмотреть тарифы");
    expect(plan.text).toContain("Профи");
  });

  it("rejects open redirects", () => {
    expect(safeReturnPath("/lessons/abc/view")).toBe("/lessons/abc/view");
    expect(safeReturnPath("//evil.example/phish")).toBe("");
    expect(safeReturnPath("https://evil.example")).toBe("");
    expect(safeReturnPath("/\\evil")).toBe("");
  });
});
