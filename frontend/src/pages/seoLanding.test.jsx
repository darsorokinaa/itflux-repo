/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SeoLandingPage from "./SeoLandingPage";
import { seoRegisterPath } from "./seoLandings";

vi.mock("../components/MathContent", () => ({
  default: ({ html }) => <div data-testid="task-html">{html}</div>,
}));

const MATERIALS = {
  slug: "generator-variantov-ege-informatika",
  h1: "Генератор вариантов ЕГЭ по информатике",
    description: "Соберите пример из нескольких заданий ЕГЭ по информатике без регистрации. На странице только условия, без ответов и решений.",
  kind: "variant",
  materials: [
    {
      kind: "task",
      id: 7,
      task_number: 1,
      title: "Анализ данных",
      text: "Открытое условие",
      html: "<p>Открытое условие</p>",
      href: "/zadaniya/ege/inf/1",
    },
  ],
  play: null,
};

describe("SEO landing", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the query as H1 and a registration link with UTM", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/sample/")) {
          return { ok: true, status: 200, json: async () => ({ tasks: [] }) };
        }
        return { ok: true, status: 200, json: async () => MATERIALS };
      }),
    );
    render(
      <MemoryRouter initialEntries={["/generator-variantov-ege-informatika"]}>
        <SeoLandingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Генератор вариантов ЕГЭ по информатике",
    );
    const link = screen.getByRole("link", { name: "Зарегистрироваться" });
    expect(link.getAttribute("href")).toBe(seoRegisterPath("generator-variantov-ege-informatika"));
    expect(link.getAttribute("href")).toContain("utm_source=seo");
    expect(link.getAttribute("href")).toContain("utm_medium=landing");
    expect(link.getAttribute("href")).toContain("utm_campaign=generator-variantov-ege-informatika");
    expect(await screen.findByText("Анализ данных")).toBeTruthy();
  });

  it("asks the sample endpoint for another variant and keeps answers off the page", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith("/sample/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tasks: [
              {
                kind: "task",
                id: 9,
                task_number: 4,
                title: "Новый пример",
                html: "<p>Условие без ответа</p>",
                href: "/zadaniya/ege/inf/4",
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => MATERIALS };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/generator-variantov-ege-informatika"]}>
        <SeoLandingPage />
      </MemoryRouter>,
    );
    await screen.findByText("Анализ данных");
    fireEvent.click(screen.getByRole("button", { name: "Собрать пример" }));
    expect(await screen.findByText("Новый пример")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/seo/landing/generator-variantov-ege-informatika/sample/",
      { credentials: "omit" },
    );
    expect(screen.queryByText(/SECRET-ANSWER/)).toBeNull();
  });

  it("draws on the guest board without a network call", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          h1: "Онлайн-доска для репетитора математики",
          description: "Доска",
          materials: [],
          play: null,
        }),
      })),
    );
    render(
      <MemoryRouter initialEntries={["/onlajn-doska-dlya-repetitora-matematiki"]}>
        <SeoLandingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Карандаш" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ластик" })).toBeTruthy();
    const canvas = screen.getByLabelText("Доска для рисунка");
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10, buttons: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30, buttons: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    expect(screen.getByText(/На сервер он не отправляется/)).toBeTruthy();
    expect(screen.getByText(/В кабинете репетитора/)).toBeTruthy();
  });
});
