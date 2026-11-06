/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TutorLanding from "./TutorLanding";

vi.mock("./useTariffPlans", () => ({
  fmtRub: (n: number | string) => String(n),
  yearDiscountPercent: () => 30,
  useTariffPlans: () => ({
    plans: [
      {
        slug: "start",
        name: "Старт",
        price_month: "0",
        price_year: "0",
        limits: { students: 5 },
      },
      {
        slug: "teacher",
        name: "Репетитор",
        price_month: "990",
        price_year: "8316",
        limits: { students: 15 },
      },
      {
        slug: "pro",
        name: "Профи",
        price_month: "1990",
        price_year: "16716",
        limits: { students: null },
      },
    ],
    failed: false,
  }),
}));

function renderLanding(props: { hideAcquisitionOffers?: boolean; isTeacher?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <TutorLanding {...props} />
    </MemoryRouter>,
  );
}

describe("TutorLanding r152 acquisition offers", () => {
  afterEach(() => cleanup());

  it("anonymous / free: shows hero CTAs, pricing and final CTA", () => {
    renderLanding({ hideAcquisitionOffers: false });
    expect(screen.getAllByText("Попробовать бесплатно").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Добавить первого ученика →")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Тарифы" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Добавьте первого ученика сегодня" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Доска, видеозвонки/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Всё, что нужно для подготовки" })).toBeTruthy();
  });

  it("paid teacher: hides acquisition CTAs and tariff/final blocks, keeps content", () => {
    renderLanding({ hideAcquisitionOffers: true, isTeacher: true });
    expect(screen.queryByText("Попробовать бесплатно")).toBeNull();
    expect(screen.queryByText("Добавить первого ученика →")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Тарифы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Добавьте первого ученика сегодня" })).toBeNull();
    expect(screen.getByRole("heading", { name: /Доска, видеозвонки/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Всё, что нужно для подготовки" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Домашку проверяет платформа, а не Вы" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Частые вопросы" })).toBeTruthy();
  });
});
