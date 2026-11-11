/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CollectionAccessCard from "./CollectionAccessCard";
import CollectionCard from "./CollectionCard";
import CollectionHeader from "./CollectionHeader";

afterEach(() => {
  cleanup();
});

const closedAccess = { has_access: false, can_purchase: false, plans: [] };

describe("kit item counts", () => {
  it("counts every item in the kit header as материал", () => {
    render(
      <MemoryRouter>
        <CollectionHeader
          collection={{
            title: "Комплект: Вероятность",
            lessons_count: 2,
            duration_minutes: 60,
            author: "Цифровой поток",
          }}
        />
        <CollectionAccessCard
          collection={{
            slug: "veroyatnost-10",
            lessons_count: 2,
            access: closedAccess,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 материала · около 1 час · Цифровой поток")).toBeTruthy();
    expect(screen.getByText("2 материала")).toBeTruthy();
    expect(screen.queryByText(/урок/i)).toBeNull();
    expect(screen.queryByText(/готовых/i)).toBeNull();
  });

  it("uses the same wording on Наборы cards", () => {
    const { rerender } = render(
      <MemoryRouter>
        <CollectionCard
          item={{
            title: "Вероятность",
            slug: "veroyatnost-10",
            subject: "Математика",
            lessons_count: 5,
            access: closedAccess,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("5 материалов")).toBeTruthy();

    rerender(
      <MemoryRouter>
        <CollectionCard
          item={{
            title: "Один материал",
            slug: "one",
            subject: "Математика",
            lessons_count: 1,
            access: closedAccess,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("1 материал")).toBeTruthy();
    expect(screen.queryByText(/урок/i)).toBeNull();
  });

  it("includes file items in the kit total even if lessons_count is lessons-only", () => {
    const lessons = [
      { kind: "lesson", title: "Урок" },
      { kind: "file", title: "Рабочий лист" },
      { kind: "file", title: "Тетрадь" },
    ];
    render(
      <MemoryRouter>
        <CollectionHeader
          collection={{
            title: "Набор с файлами",
            lessons_count: 1,
            lessons,
          }}
        />
        <CollectionAccessCard
          collection={{
            slug: "files",
            lessons_count: 1,
            lessons,
            access: closedAccess,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("3 материала")).toHaveLength(2);
    expect(screen.queryByText(/^1 /)).toBeNull();
  });
});
