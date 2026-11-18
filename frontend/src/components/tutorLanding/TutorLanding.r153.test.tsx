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
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("pricing/plans")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              plans: [{ slug: "start", name: "Старт", is_free: true, limits: { students: 5 } }],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            total_tasks: 1,
            subjects_count: 1,
            generated_variants_count: 0,
            tasks_by_level: {},
            sample_lesson: {
              slug: "demo-lesson",
              title: "Демо",
              subject: "Информатика",
              short_description: "Коротко",
              preview_path: "/lessons?preview=demo-lesson",
            },
          }),
        });
      }),
    );
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
  }

  function expectHomeKeepsTheRest() {
    const h1 = screen.getByRole("heading", { level: 1, name: "Готовьтесь к уроку за минуты, а не часы" });
    expect(h1).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/Готовые уроки, 25 000\+ заданий/)).toBeTruthy();
    expect(screen.getByTestId("seasonal-hero-sticker")).toBeTruthy();
    expect(screen.getAllByText("Без регистрации")).toHaveLength(2);
    expect(screen.getByText("До 5 учеников на тарифе «Старт»")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Попробовать готовый урок" }).getAttribute("href")).toBe(
      "/lessons?preview=demo-lesson",
    );
    expect(screen.getByRole("link", { name: "Создать вариант ОГЭ/ЕГЭ" }).getAttribute("href")).toBe("/subject");
    expect(screen.getByRole("heading", { level: 2, name: "Что вам нужно сейчас?" })).toBeTruthy();
    expect(screen.getByText("Мне нужен готовый урок")).toBeTruthy();
    expect(screen.getByText("Помочь сбору")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Выберите формат подготовки" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Всё для занятий в одном месте" })).toBeTruthy();
    expect(screen.queryByText("Для репетиторов и учителей математики и информатики")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Доска, видеозвонки/ })).toBeNull();
    expect(screen.queryByText("Попробовать бесплатно")).toBeNull();
    expect(screen.queryByText(/Добавить первого ученика/)).toBeNull();
    expect(screen.queryByText("ДОСКА")).toBeNull();
    expect(document.querySelector("[data-tutor-landing]")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Всё, что нужно для подготовки" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Всё для подготовки к ОГЭ и ЕГЭ уже внутри" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Домашку проверяет платформа, а не Вы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Тарифы" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Частые вопросы" })).toBeNull();
    expect(screen.queryByText(/Тарифы и цены/)).toBeNull();
  }

  it("HomePage: anonymous starts at the first-screen hero", async () => {
    renderHome({ authenticated: false });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Готовьтесь к уроку за минуты, а не часы" })).toBeTruthy();
    });
    expectHomeKeepsTheRest();
    const online = screen.getByRole("link", { name: "Провести онлайн-урок" });
    expect(online.getAttribute("href")).toContain("/cabinet/login");
    expect(online.getAttribute("href")).toContain("mode=register");
    expect(decodeURIComponent(online.getAttribute("href") || "")).toContain("/cabinet/schedule?create=1");
  });

  it("HomePage: Start teacher sees the same first screen", async () => {
    renderHome({
      authenticated: true,
      user: { role: "teacher", has_active_paid_subscription: false },
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Провести онлайн-урок" }).getAttribute("href")).toBe(
        "/cabinet/schedule?create=1",
      );
    });
    expectHomeKeepsTheRest();
  });

  it("HomePage: paid teacher sees the same first block", async () => {
    renderHome({
      authenticated: true,
      user: { role: "teacher", has_active_paid_subscription: true },
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Провести онлайн-урок" }).getAttribute("href")).toBe(
        "/cabinet/schedule?create=1",
      );
    });
    expectHomeKeepsTheRest();
  });
});
