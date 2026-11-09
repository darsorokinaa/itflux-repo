/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TutorLanding from "./TutorLanding";
import HomePage from "../../pages/HomePage";

vi.mock("../../seasonal/SeasonalHeroSticker", () => ({
  default: () => <aside data-testid="seasonal-hero-sticker">Узнать историю Рождества</aside>,
}));

vi.mock("./useTariffPlans", () => ({
  fmtRub: (n: number | string) => String(n),
  yearDiscountPercent: () => 30,
  useTariffPlans: () => ({
    plans: [
      { slug: "start", name: "Старт", price_month: "0", price_year: "0", limits: { students: 5 } },
      { slug: "teacher", name: "Репетитор", price_month: "990", price_year: "8316", limits: { students: 15 } },
      { slug: "pro", name: "Профи", price_month: "1990", price_year: "16716", limits: { students: null } },
    ],
    failed: false,
  }),
}));

const fetchCabinetSession = vi.fn();
vi.mock("../../utils/cabinetAuth", async () => {
  const actual = await vi.importActual<typeof import("../../utils/cabinetAuth")>("../../utils/cabinetAuth");
  return {
    ...actual,
    fetchCabinetSession: (...args: unknown[]) => fetchCabinetSession(...args),
  };
});

describe("TutorLanding / HomePage r153", () => {
  afterEach(() => {
    cleanup();
    fetchCabinetSession.mockReset();
    vi.unstubAllGlobals();
  });

  it("TutorLanding when mounted shows full quoted landing", () => {
    render(
      <MemoryRouter>
        <TutorLanding />
      </MemoryRouter>,
    );
    expect(screen.getByText("Для репетиторов и учителей математики и информатики")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Доска, видеозвонки/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Всё, что нужно для подготовки" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Всё для подготовки к ОГЭ и ЕГЭ уже внутри" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Домашку проверяет платформа, а не Вы" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Тарифы" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Частые вопросы" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Добавьте первого ученика сегодня" })).toBeTruthy();
    expect(screen.getAllByText("Попробовать бесплатно").length).toBeGreaterThanOrEqual(2);
  });

  function renderHome(session: unknown) {
    fetchCabinetSession.mockResolvedValue(session);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ total_tasks: 1, subjects_count: 1, generated_variants_count: 0, tasks_by_level: {} }),
      }),
    );
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
  }

  function expectHomeWithoutSales() {
    expect(screen.getByRole("heading", { name: /Доска, видеозвонки/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Что вам нужно сейчас?" })).toBeTruthy();
    expect(screen.getByTestId("seasonal-hero-sticker")).toBeTruthy();
    expect(document.querySelector("[data-tutor-landing='hero']")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Всё, что нужно для подготовки" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Всё для подготовки к ОГЭ и ЕГЭ уже внутри" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Домашку проверяет платформа, а не Вы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Тарифы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Частые вопросы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Добавьте первого ученика сегодня" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Выберите формат подготовки" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Всё для занятий в одном месте" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Что говорят учителя" })).toBeNull();
    expect(screen.queryByText(/Тарифы и цены/)).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: /Доска, видеозвонки/ })).toBeTruthy();
  }

  it("HomePage: anonymous sees hero and value paths, not sales blocks", async () => {
    renderHome({ authenticated: false });
    await waitFor(() => {
      expect(screen.getByText("Для репетиторов и учителей математики и информатики")).toBeTruthy();
    });
    expectHomeWithoutSales();
  });

  it("HomePage: Start teacher sees the same short homepage", async () => {
    renderHome({
      authenticated: true,
      user: { role: "teacher", has_active_paid_subscription: false },
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Что вам нужно сейчас?" })).toBeTruthy();
    });
    expectHomeWithoutSales();
  });

  it("HomePage: paid teacher sees hero and value paths, not sales blocks", async () => {
    renderHome({
      authenticated: true,
      user: { role: "teacher", has_active_paid_subscription: true },
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Что вам нужно сейчас?" })).toBeTruthy();
    });
    expectHomeWithoutSales();
  });
});
