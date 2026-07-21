import { describe, expect, it } from "vitest";
import {
  billingTypeLabel,
  compactLessonBillingLabel,
  financialStatusLabel,
  financialStatusMod,
  formatMoney,
  formatPaymentTerms,
  formatUnits,
  isBillingConfigured,
  resolveAccountState,
  transactionTypeLabel,
} from "./billingFormat";

describe("billingFormat", () => {
  it("formats money in RUB", () => {
    expect(formatMoney("1600", "RUB")).toContain("₽");
    expect(formatMoney("1600.5", "RUB")).toMatch(/1.?600/);
  });

  it("formats package units", () => {
    expect(formatUnits("90", "minute")).toContain("минут");
    expect(formatUnits("2", "lesson")).toContain("занятия");
    expect(formatUnits("1", "lesson")).toContain("занятие");
  });

  it("maps labels", () => {
    expect(billingTypeLabel("per_lesson")).toBe("За урок");
    expect(financialStatusLabel("awaiting_payment")).toBe("Ожидает оплаты");
    expect(financialStatusLabel("needs_decision")).toBe("Требует оформления");
    expect(transactionTypeLabel("charge")).toBe("Начисление");
  });

  it("maps status modifiers", () => {
    expect(financialStatusMod("paid")).toBe("ok");
    expect(financialStatusMod("awaiting_payment")).toBe("warn");
    expect(financialStatusMod("needs_decision")).toBe("alert");
  });

  it("does not treat zero balance without tariff as paid", () => {
    const account = {
      billing_type: "manual",
      balance: { debt: "0", credit: "0" },
      status_label: "оплата не настроена",
    };
    expect(isBillingConfigured(account)).toBe(false);
    const state = resolveAccountState(account);
    expect(state.kind).toBe("not_configured");
    expect(state.headline).toBe("Оплата не настроена");
    expect(state.primaryLabel).toBe("Настроить");
  });

  it("labels debt and advance clearly", () => {
    const debt = resolveAccountState({
      billing_type: "per_lesson",
      default_lesson_price: "1600",
      balance: { debt: "3200", credit: "0" },
      currency: "RUB",
      status_label: "есть задолженность",
    });
    expect(debt.kind).toBe("debt");
    expect(debt.headline).toContain("Долг");
    expect(debt.primaryLabel).toBe("Добавить оплату");

    const advance = resolveAccountState({
      billing_type: "per_lesson",
      default_lesson_price: "1600",
      balance: { debt: "0", credit: "2000" },
      currency: "RUB",
      status_label: "всё оплачено",
    });
    expect(advance.kind).toBe("advance");
    expect(advance.headline).toContain("Аванс");
  });

  it("formats payment terms without dashes", () => {
    expect(formatPaymentTerms({
      billing_type: "per_lesson",
      default_lesson_price: "1600",
      currency: "RUB",
      settings: { default_lesson_duration_minutes: 60 },
    })).toContain("За урок");
  });

  it("builds compact lesson billing labels", () => {
    expect(compactLessonBillingLabel({ financial_status: "paid" })).toBe("Оплачено");
    expect(compactLessonBillingLabel({
      financial_status: "awaiting_payment",
      amount: "1600",
      currency: "RUB",
    })).toContain("Ожидает оплаты");
    expect(compactLessonBillingLabel({ financial_status: "needs_decision" })).toBe("Требует оформления");
    expect(compactLessonBillingLabel({
      financial_status: "paid_from_package",
      label: "Абонемент: осталось 3 зан.",
    })).toContain("Абонемент");
    expect(compactLessonBillingLabel({
      financial_status: "not_charged",
      price_source_label: "Абонемент",
    })).toContain("Абонемент");
  });
});
