import { describe, expect, it } from "vitest";
import {
  accountMatchesTab,
  billingTypeLabel,
  compactLessonBillingLabel,
  financialStatusLabel,
  financialStatusMod,
  formatMoney,
  formatPaymentTerms,
  formatTransactionAmount,
  formatUnits,
  isBillingConfigured,
  resolveAccountState,
  resolvePaymentsRowState,
  statusModClass,
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
    expect(formatUnits("2.00", "lesson")).toBe("2 занятия");
    expect(formatUnits("1.50", "lesson")).toBe("1,5 занятия");
    expect(formatUnits("1.55", "lesson")).toBe("1,6 занятия");
  });

  it("shows package consumption as minus lessons", () => {
    expect(formatTransactionAmount({
      transaction_type: "package_consumption",
      package_units: "1",
      unit_type: "lesson",
      amount: "0",
    })).toBe("−1 занятие");
    expect(formatTransactionAmount({
      transaction_type: "package_return",
      package_units: "1",
      unit_type: "lesson",
      amount: "0",
    })).toBe("+1 занятие");
  });

  it("maps labels", () => {
    expect(billingTypeLabel("per_lesson")).toBe("За урок");
    expect(financialStatusLabel("awaiting_payment")).toBe("Не оплачен");
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

  it("does not treat configured tariff alone as paid", () => {
    const state = resolveAccountState({
      billing_type: "per_lesson",
      default_lesson_price: "1600",
      balance: { debt: "0", credit: "0" },
      currency: "RUB",
      status_label: "условия заданы",
      unpaid_lessons_count: 0,
      unpaid_lessons_amount: "0",
    });
    expect(state.kind).toBe("configured");
    expect(state.headline).toBe("Условия заданы");
  });

  it("labels debt and advance clearly", () => {
    const debt = resolveAccountState({
      billing_type: "per_lesson",
      default_lesson_price: "1600",
      balance: { debt: "3200", credit: "0" },
      currency: "RUB",
      status_label: "есть задолженность",
      unpaid_lessons_amount: "3200",
      unpaid_lessons_count: 2,
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
    })).toContain("Не оплачен");
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

  it("uses server ui meta for payments row", () => {
    const row = resolvePaymentsRowState({
      status_kind: "debt",
      status_mod: "alert",
      headline: "Долг 3 200 ₽ · 2 урока",
      status_detail: "Есть проведённые неоплаченные уроки",
      scheme_label: "Разово за урок",
      debt_amount: "3200",
      unpaid_lessons_count: 2,
      primary_action: "payment",
      primary_label: "Добавить оплату",
      suggested_actions: ["payment", "package"],
      currency: "RUB",
    });
    expect(row.kind).toBe("debt");
    expect(row.statusText).toContain("Долг");
    expect(row.actionNeedsAttention).toBe(true);
    expect(statusModClass("alert")).toBe("pay-status--debt");
  });

  it("filters accounts by tab", () => {
    const debtAcc = { status_kind: "debt", unpaid_lessons_count: 2, debt_amount: "1000" };
    const pkgAcc = { status_kind: "package_ok", package: { remaining_units: 3 }, billing_type: "package_lessons" };
    expect(accountMatchesTab(debtAcc, "debts")).toBe(true);
    expect(accountMatchesTab(debtAcc, "action")).toBe(true);
    expect(accountMatchesTab(pkgAcc, "packages")).toBe(true);
    expect(accountMatchesTab(pkgAcc, "debts")).toBe(false);
  });
});
