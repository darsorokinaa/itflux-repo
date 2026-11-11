/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ReadyLessonsPage from "./ReadyLessonsPage";

vi.mock("../hooks/useAccessGate", () => ({
  useCabinetAuthed: () => false,
  useAccessGate: () => ({ modal: null, openGate: () => {} }),
}));

vi.mock("../components/LessonPreviewModal", () => ({ default: () => null }));
vi.mock("../components/TryNowLessons", () => ({ default: () => null }));

const lesson = {
  id: 1,
  slug: "probability-intro",
  title: "Теория вероятности: введение",
  subject: "Математика",
  grade: 9,
  exam_type: "oge",
  level: "ОГЭ",
  status: "published",
  access_level: "free",
  access: { allowed: true },
};

const kit = {
  id: 10,
  slug: "veroyatnost-10",
  title: "Комплект: Вероятность — ОГЭ по математике, №10",
  subject: "Математика",
  grade: 9,
  exam_type: "oge",
  level: "ОГЭ",
  lessons_count: 2,
  short_description: "В комплекте урок и тренажёр.",
  access: { has_access: false },
  url: "/lessons/collections/veroyatnost-10",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubCatalog() {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = String(url);
    if (path.includes("/api/lesson-collections/")) {
      return { ok: true, json: async () => ({ collections: [kit], total: 1 }) };
    }
    if (path.includes("/api/lessons/")) {
      return { ok: true, json: async () => ({ lessons: [lesson], total: 1 }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}

function renderPage(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReadyLessonsPage />
    </MemoryRouter>,
  );
}

describe("ReadyLessonsPage kits", () => {
  it("hides kits on Все and shows them only on Наборы", async () => {
    stubCatalog();
    renderPage("/lessons");
    expect(await screen.findByRole("heading", { name: "Теория вероятности: введение" })).toBeTruthy();
    expect(screen.queryByText("Комплект: Вероятность — ОГЭ по математике, №10")).toBeNull();
    expect(screen.queryByText("Открыть набор")).toBeNull();
    expect(screen.getByText("Найдено:")?.parentElement?.textContent || document.body.textContent).toMatch(/Найдено:\s*1/);

    cleanup();
    stubCatalog();
    renderPage("/lessons?kind=collections");
    expect(await screen.findByText("Комплект: Вероятность — ОГЭ по математике, №10")).toBeTruthy();
    expect(screen.getByText("Открыть набор")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Теория вероятности: введение" })).toBeNull();
  });
});
