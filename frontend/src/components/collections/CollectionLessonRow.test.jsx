/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CollectionLessonRow from "./CollectionLessonRow";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../pages/lesson-collections.css"),
  "utf8",
);

afterEach(() => {
  cleanup();
});

const lockedLesson = {
  id: 10,
  item_id: 1,
  kind: "lesson",
  slug: "theory",
  number: 1,
  title: "Теория вероятности: введение",
  short_description: "Интерактивный урок по теме «Вероятность и статистика» для 8 класса: от интуитивных представлений о случайности к эксперименту.",
  cover_url: "https://example.com/media/covers/theory.png",
  can_open: false,
  viewed: false,
};

describe("CollectionLessonRow locked layout", () => {
  it("keeps the locked title inside a full-width button", () => {
    const { container } = render(
      <MemoryRouter>
        <CollectionLessonRow
          collection={{ slug: "veroyatnost-10", access: { has_access: false } }}
          lesson={lockedLesson}
        />
      </MemoryRouter>,
    );

    const button = container.querySelector("button.lcol-row--locked");
    expect(button).toBeTruthy();
    expect(button.parentElement.classList.contains("lcol-row-lock")).toBe(true);
    expect(button.parentElement.classList.contains("lcol-row")).toBe(false);
    expect(button.querySelector(".lcol-row__title").textContent).toBe(lockedLesson.title);
    expect(button.querySelector(".lcol-row__desc").textContent).toBe(lockedLesson.short_description);
    expect(button.querySelector("a")).toBeNull();
    expect(screen.getByRole("button", { name: /Теория вероятности/ })).toBeTruthy();
  });

  it("gives a locked file the same full-width row as a lesson", () => {
    const { container } = render(
      <MemoryRouter>
        <CollectionLessonRow
          collection={{ slug: "oge-18", access: { has_access: false, plans: [{ name: "Премиум" }] } }}
          lesson={{
            id: 18,
            item_id: 3,
            kind: "file",
            number: 2,
            title: "Рабочий лист: фигуры на клетчатой бумаге — ОГЭ по математике, №10",
            short_description: "Рабочий лист к уроку «Фигуры на клетчатой бумаге», PDF для печати.",
            can_open: false,
            url: "/api/lesson-collections/oge-18/files/3/",
          }}
        />
      </MemoryRouter>,
    );

    const button = container.querySelector("button.lcol-row--locked");
    expect(button.querySelector(".lcol-row__title").textContent).toMatch(/Рабочий лист/);
    expect(button.querySelector(".lcol-row__desc").textContent).toMatch(/PDF для печати/);
    expect(button.querySelector(".lcol-pill").textContent).toBe("Файл");
    expect(button.querySelector("a")).toBeNull();
  });

  it("keeps an open file as a direct link and a locked variant in the row", () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <CollectionLessonRow
          collection={{ slug: "oge-18", access: { has_access: true } }}
          lesson={{
            id: 19,
            kind: "file",
            number: 4,
            title: "Рабочая тетрадь ОГЭ по математике, №18",
            can_open: true,
            url: "/api/lesson-collections/oge-18/files/4/",
          }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Рабочая тетрадь/ });
    expect(link.getAttribute("href")).toBe("/api/lesson-collections/oge-18/files/4/");
    expect(container.querySelector(".lcol-row--locked")).toBeNull();

    rerender(
      <MemoryRouter>
        <CollectionLessonRow
          collection={{ slug: "oge-18", access: { has_access: false } }}
          lesson={{
            id: 20,
            kind: "variant",
            number: 5,
            title: "Вариант: Комплект по вероятности",
            short_description: "Математика · ОГЭ. Классическая вероятность, противоположное событие и круги Эйлера.",
            can_open: false,
          }}
        />
      </MemoryRouter>,
    );
    const variant = screen.getByRole("button", { name: /Вариант: Комплект по вероятности/ });
    expect(variant.querySelector(".lcol-row__desc").textContent).toMatch(/круги Эйлера/);
    expect(variant.classList.contains("lcol-row")).toBe(true);
  });

  it("still opens a trainer that is not tariff-gated", () => {
    render(
      <MemoryRouter>
        <CollectionLessonRow
          collection={{ slug: "veroyatnost-10", access: { has_access: true } }}
          lesson={{
            id: 11,
            kind: "trainer",
            slug: "trainer",
            number: 2,
            title: "Тренажёр: вероятность",
            can_open: true,
            viewed: false,
          }}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /Тренажёр: вероятность/ });
    expect(link.getAttribute("href")).toBe("/interesting/trainer/view?collection=veroyatnost-10");
    expect(screen.getByText("Тренажёр")).toBeTruthy();
  });

  it("does not trap the locked button in the narrow status column", () => {
    const wrap = css.match(/\.lcol-row-lock \{([^}]+)\}/);
    expect(wrap[1]).toMatch(/display:\s*block/);
    const locked = css.match(/\.lcol-row--locked \{([^}]+)\}/);
    expect(locked[1]).not.toMatch(/display:\s*block/);
    expect(locked[1]).toMatch(/width:\s*100%/);
    expect(css).toMatch(/\.lcol-row--cover \{[^}]*72px 28px 40px minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/html\.seasonal-theme-active \.lcol-row-lock/);
  });
});
