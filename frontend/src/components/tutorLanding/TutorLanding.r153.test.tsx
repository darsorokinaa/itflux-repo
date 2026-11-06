/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import TutorLanding from "./TutorLanding";
import HomePage from "../../pages/HomePage";

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

  it("HomePage: anonymous sees TutorLanding", async () => {
    fetchCabinetSession.mockResolvedValue({ authenticated: false });
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
    await waitFor(() => {
      expect(screen.getByText("Для репетиторов и учителей математики и информатики")).toBeTruthy();
    });
    expect(screen.getByRole("heading", { name: "Что вам нужно сейчас?" })).toBeTruthy();
  });

  it("HomePage: Start teacher sees TutorLanding", async () => {
    fetchCabinetSession.mockResolvedValue({
      authenticated: true,
      user: { role: "teacher", has_active_paid_subscription: false },
    });
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
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Тарифы" })).toBeTruthy();
    });
  });

  it("HomePage: paid teacher has no TutorLanding from the quote", async () => {
    fetchCabinetSession.mockResolvedValue({
      authenticated: true,
      user: { role: "teacher", has_active_paid_subscription: true },
    });
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
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Что вам нужно сейчас?" })).toBeTruthy();
    });
    expect(screen.queryByText("Для репетиторов и учителей математики и информатики")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Доска, видеозвонки/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Всё, что нужно для подготовки" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Всё для подготовки к ОГЭ и ЕГЭ уже внутри" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Домашку проверяет платформа, а не Вы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Тарифы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Частые вопросы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Добавьте первого ученика сегодня" })).toBeNull();
    expect(screen.queryByText("Попробовать бесплатно")).toBeNull();
    expect(screen.queryByText("Добавить первого ученика")).toBeNull();
    expect(document.querySelector("[data-tutor-landing]")).toBeNull();
  });
});
