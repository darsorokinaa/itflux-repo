/** @vitest-environment jsdom */
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createVariantTheme,
  fetchAdminVariantThemes,
  updateVariantTheme,
} from "../../variantThemes/variantThemeApi";
import { decorationById } from "../../variantThemes/decorations";
import CabinetVariantThemeEditorPage from "./CabinetVariantThemeEditorPage";

vi.mock("../../variantThemes/variantThemeApi", () => ({
  createVariantTheme: vi.fn(),
  fetchAdminVariantThemes: vi.fn(),
  updateVariantTheme: vi.fn(),
  uploadVariantThemeImage: vi.fn(),
}));

function renderEditor(path = "/cabinet/variant-themes/new") {
  function Shell() {
    return <Outlet context={{ user: { can_manage_variant_themes: true } }} />;
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/cabinet/variant-themes/:themeId" element={<CabinetVariantThemeEditorPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function savedTheme(overrides = {}) {
  return {
    id: 7,
    name: "Маршрут",
    slug: "marshrut",
    description: "Описание",
    layout_type: "route",
    is_active: true,
    is_published: false,
    config: {
      background: { type: "color", color: "#e7f3fb" },
      labels: { task: "Остановка", tasks: "Путь", next: "Дальше", previous: "Назад", finish: "Финиш" },
      animation: "none",
      decorations: ["clouds"],
    },
    ...overrides,
  };
}

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
});

afterEach(() => {
  cleanup();
});

describe("CabinetVariantThemeEditorPage", () => {
  it("shows the editor without the platform header and switches panels", () => {
    renderEditor();

    expect(screen.getByRole("heading", { level: 1, name: "Новая тема" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Разделы платформы" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Основное", selected: true })).toBeTruthy();
    expect(screen.getByText("В РЕАЛЬНОМ ВРЕМЕНИ")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: /Название/ }), { target: { value: "Путешествие" } });
    expect(screen.getAllByText("Путешествие").length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("tab", { name: "Оформление" }));
    expect(screen.getByRole("heading", { name: "Декоративные элементы" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Фон" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Соединительная линия" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Предметы" })).toBeNull();
    expect(screen.getByText(decorationById("clouds").label)).toBeTruthy();
    fireEvent.click(screen.getByText(decorationById("mountains").label));
    expect(document.querySelector(".vt-pattern-svg--mountains")).toBeTruthy();
    fireEvent.click(screen.getByText(decorationById("route").label));
    expect(document.querySelector(".route-line--solid")).toBeTruthy();
    expect(screen.getByText("Книжное изображение")).toBeTruthy();
    expect(screen.getByText("Лист, альбомный")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Подписи" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Одно задание/ }), { target: { value: "Остановка" } });
    expect(screen.getByText("Остановка 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Книжная" }));
    expect(document.querySelector(".te-screen--vertical")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Книжная" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Альбомная" }));
    expect(document.querySelector(".te-screen--vertical")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Книжная" }));
    fireEvent.click(screen.getByRole("button", { name: "Рабочий лист" }));
    expect(document.querySelector(".te-sheet--vertical")).toBeTruthy();
    expect(document.querySelector(".te-sheet--horizontal")).toBeNull();
    expect(screen.getByText("Цифровой поток · Рабочий лист")).toBeTruthy();
    expect(screen.getByText("Остановка 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    expect(screen.getByRole("button", { name: "Применить JSON" })).toBeTruthy();
  });

  it("loads a saved theme and keeps other fields when the color changes", async () => {
    fetchAdminVariantThemes.mockResolvedValue({ themes: [savedTheme()] });
    renderEditor("/cabinet/variant-themes/7");

    expect(await screen.findByDisplayValue("Маршрут")).toBeTruthy();
    expect(screen.getByDisplayValue("Описание")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Оформление" }));
    const hex = screen.getByRole("textbox", { name: "Цвет фона: HEX" });
    fireEvent.change(hex, { target: { value: "#123456" } });
    expect(hex.value).toBe("#123456");
    expect(document.querySelector(".te-screen-stage").style.backgroundColor).toBe("rgb(18, 52, 86)");
    expect(document.querySelector(".te-screen-stage").style.backgroundImage).not.toContain("9fc8e4");
    expect(screen.getByText("Есть несохранённые изменения")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Основное" }));
    expect(screen.getByDisplayValue("Описание")).toBeTruthy();
    expect(screen.getByDisplayValue("Маршрут")).toBeTruthy();
  });

  it("saves the color and restores it when the editor opens again", async () => {
    fetchAdminVariantThemes.mockResolvedValue({ themes: [savedTheme()] });
    updateVariantTheme.mockImplementation(async (_id, body) => savedTheme({
      config: body.config,
    }));
    renderEditor("/cabinet/variant-themes/7");
    expect(await screen.findByDisplayValue("Маршрут")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Оформление" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Цвет фона: HEX" }), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить тему" }));

    await waitFor(() => expect(updateVariantTheme).toHaveBeenCalled());
    const body = updateVariantTheme.mock.calls[0][1];
    expect(body.config.background).toEqual({ type: "color", color: "#123456" });
    expect(body.name).toBe("Маршрут");
    expect(body.description).toBe("Описание");
    await waitFor(() => expect(screen.getAllByText("Тема сохранена").length).toBeGreaterThan(0));
    expect(updateVariantTheme).toHaveBeenCalledTimes(1);
  });

  it("returns to the last saved version and resets visual defaults only after confirmation", async () => {
    fetchAdminVariantThemes.mockResolvedValue({ themes: [savedTheme()] });
    renderEditor("/cabinet/variant-themes/7");
    const name = await screen.findByDisplayValue("Маршрут");
    fireEvent.change(name, { target: { value: "Черновик" } });
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    fireEvent.click(screen.getByRole("button", { name: "Отменить правки" }));
    expect(screen.getByDisplayValue("Маршрут")).toBeTruthy();
    expect(screen.queryByDisplayValue("Черновик")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Подписи" }));
    expect(screen.getByDisplayValue("Остановка")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(screen.getByRole("dialog", { name: "Сбросить оформление?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Не сбрасывать" }));
    expect(screen.getByDisplayValue("Остановка")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    fireEvent.click(screen.getByRole("button", { name: "Сбросить оформление" }));
    expect(screen.getByDisplayValue("Задание")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Хлебные крошки" }).textContent).toContain("Маршрут");
  });

  it("does not commit an invalid color and keeps the draft when saving fails", async () => {
    renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: /Название/ }), { target: { value: "Поле" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Короткое имя/ }), { target: { value: "pole" } });
    fireEvent.click(screen.getByRole("tab", { name: "Оформление" }));
    fireEvent.click(screen.getByRole("radio", { name: "Цвет" }));
    const hex = screen.getByRole("textbox", { name: "Цвет фона: HEX" });
    fireEvent.change(hex, { target: { value: "синий" } });
    expect(screen.getByText("Нужен цвет #RGB или #RRGGBB.")).toBeTruthy();
    fireEvent.blur(hex);
    expect(hex.value).toBe("#cfe8f6");

    fireEvent.change(hex, { target: { value: "#111111" } });
    expect(screen.getByText(/Выбранный цвет не изменён/)).toBeTruthy();
    expect(hex.value).toBe("#111111");

    createVariantTheme.mockRejectedValue(new Error("Сервер недоступен"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить тему" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Сервер недоступен");
    expect(screen.getByRole("navigation", { name: "Хлебные крошки" }).textContent).toContain("Поле");
    expect(hex.value).toBe("#111111");
  });

  it("keeps newer edits when an older save response arrives", async () => {
    let finish;
    createVariantTheme.mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));
    fetchAdminVariantThemes.mockResolvedValue({ themes: [] });
    renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: /Название/ }), { target: { value: "Первая" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Короткое имя/ }), { target: { value: "pervaya" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить тему" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Название/ }), { target: { value: "Вторая" } });
    finish(savedTheme({ id: 9, name: "Первая", slug: "pervaya" }));
    fetchAdminVariantThemes.mockResolvedValue({
      themes: [savedTheme({ id: 9, name: "Первая", slug: "pervaya" })],
    });
    expect(await screen.findByText(/более новые правки остались в черновике/i)).toBeTruthy();
    expect(screen.getByDisplayValue("Вторая")).toBeTruthy();
  });
});
