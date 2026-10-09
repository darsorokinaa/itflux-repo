/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PlanExcelImportModal from "./PlanExcelImportModal";

vi.mock("./CabinetIcons", () => ({
  default: function CabinetIcon() {
    return <span data-testid="icon" />;
  },
}));

const preview = {
  mode: "replace_all",
  can_import: true,
  warnings: [],
  confirmation: "В плане сейчас 20 уроков. После обновления останется 8 уроков из Excel. Это действие заменит текущий состав плана.",
  summary: {
    found: 8,
    file_count: 8,
    current_count: 20,
    after_count: 8,
    added: 8,
    replaced: 0,
    errors: 0,
    warnings: 0,
  },
  rows: [
    {
      excel_row: 2,
      status: "ready",
      result: "Будет в новом плане",
      messages: [],
      item: { title: "Урок 1", topic: "Тема", scheduled_date: "2026-09-11" },
    },
    {
      excel_row: 3,
      status: "ready",
      result: "Будет в новом плане",
      messages: [],
      item: { title: "Урок 2", topic: "Тема", scheduled_date: null },
    },
  ],
};

describe("PlanExcelImportModal", () => {
  afterEach(() => cleanup());

  it("describes whole-plan replace without mentioning IDs", () => {
    render(
      <PlanExcelImportModal
        preview={preview}
        hasExistingLessons
        loading={false}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getAllByText("Обновить план целиком").length).toBeGreaterThan(0);
    expect(screen.getByText(/Полностью заменить текущий список уроков/)).toBeTruthy();
    expect(screen.getByText("В файле")).toBeTruthy();
    expect(screen.getByText("Сейчас в плане")).toBeTruthy();
    expect(screen.getByText("После импорта")).toBeTruthy();
    expect(screen.getAllByText("8 уроков").length).toBe(2);
    expect(screen.getByText("20 уроков")).toBeTruthy();
    expect(screen.queryByText(/ID обновятся/)).toBeNull();
    expect(screen.queryByText(/Будет обновлено/)).toBeNull();
    expect(screen.getAllByText("Будет в новом плане")).toHaveLength(2);
  });

  it("asks to refetch preview when switching to add-by-date", () => {
    const onModeChange = vi.fn();
    render(
      <PlanExcelImportModal
        preview={preview}
        hasExistingLessons
        loading={false}
        onClose={() => {}}
        onConfirm={() => {}}
        onModeChange={onModeChange}
      />,
    );
    fireEvent.click(screen.getByText("Добавить уроки"));
    expect(onModeChange).toHaveBeenCalledWith("insert");
  });

  it("requires explicit acknowledgement before replacing the whole plan", () => {
    const onConfirm = vi.fn();
    render(
      <PlanExcelImportModal
        preview={preview}
        hasExistingLessons
        loading={false}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const submit = screen.getByRole("button", { name: "Обновить план целиком" });
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith("replace_all", { confirmDeletes: false });
  });

  it("explains date replacement as было / станет", () => {
    render(
      <PlanExcelImportModal
        preview={{
          mode: "replace_dates",
          can_import: true,
          confirmation: "Будет заменено: 1 урок. Добавлено: 0.",
          summary: { file_count: 1, current_count: 3, after_count: 3, added: 0, replaced: 1 },
          rows: [{
            excel_row: 2,
            status: "ready",
            result: "16.09.2026\nБыло: Логика\nСтанет: Алгебра логики",
            messages: [],
            item: { title: "Алгебра логики", topic: "Логика", scheduled_date: "2026-09-16" },
          }],
        }}
        hasExistingLessons
        loading={false}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getAllByText("Заменить уроки по датам").length).toBeGreaterThan(0);
    expect(screen.getByText("Добавлено")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("Было: Логика")).toBeTruthy();
    expect(screen.getByText("Станет: Алгебра логики")).toBeTruthy();
    expect(screen.queryByText("UPDATE")).toBeNull();
  });

  it("lets the teacher skip a change, take the site version, and move a calendar event", () => {
    const onConfirm = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <PlanExcelImportModal
        preview={{
          mode: "sync",
          can_import: true,
          confirmation: "Без изменений: 0. Обновятся: 1.",
          summary: { unchanged: 0, updated: 1, added: 1, deleted: 1, dates_changed: 1, attention: 2, conflicts: 1 },
          warnings: ["Одно занятие изменили на сайте после скачивания файла."],
          rows: [
            {
              excel_row: 2,
              status: "update",
              result: "Будет обновлено: название",
              messages: [],
              item: { title: "Новое имя", topic: "Тема", scheduled_date: "2026-10-16" },
              event_move: { can_move: true, reason: "Событие останется, пока его отдельно не перенести." },
            },
            {
              excel_row: 3,
              status: "conflict",
              conflict: true,
              resolution: "site",
              result: "На сайте новее.",
              messages: ["Это занятие изменили на сайте после скачивания файла."],
              diffs: [{ field: "title", label: "название", site: "На сайте", file: "В файле" }],
              item: { title: "В файле", topic: "Тема", scheduled_date: "2026-10-12" },
            },
            {
              excel_row: null,
              current_id: 9,
              status: "delete",
              result: "Будет удалено после подтверждения",
              messages: ["Занятие будет удалено из плана."],
              item: { title: "Лишнее", topic: "Тема" },
            },
          ],
        }}
        hasExistingLessons
        loading={false}
        onClose={() => {}}
        onConfirm={onConfirm}
        onSelectionChange={onSelectionChange}
      />,
    );
    expect(screen.getByText(/на сайте «На сайте», в файле «В файле»/)).toBeTruthy();
    const applyBoxes = screen.getAllByRole("checkbox", { name: "Применить" });
    const fileBox = screen.getByRole("checkbox", { name: "Взять версию из файла" });
    expect(fileBox.checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Перенести событие в календаре" }));
    fireEvent.click(fileBox);
    fireEvent.click(applyBoxes[1]);
    expect(onSelectionChange).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Применить изменения" }));
    expect(onConfirm).toHaveBeenCalledWith("sync", {
      confirmDeletes: false,
      excludeRows: ["delete:9"],
      acceptConflicts: [3],
      moveEventRows: [2],
    });
  });

  it("offers to create an ambiguous duplicate as a new lesson", () => {
    const onConfirm = vi.fn();
    render(
      <PlanExcelImportModal
        preview={{
          mode: "sync",
          can_import: true,
          confirmation: "Есть повторяющиеся коды.",
          warnings: ["Есть повторяющиеся коды или одинаковые строки без уникального кода."],
          summary: { unchanged: 0, updated: 0, added: 0, deleted: 0, attention: 1 },
          rows: [
            {
              excel_row: 4,
              status: "ambiguous",
              allow_create: true,
              result: "Нужно решение",
              messages: ["Код строки повторяется. Занятие не обновляется и не создаётся автоматически."],
              item: { title: "Копия", topic: "Тема", scheduled_date: "2026-10-15" },
            },
          ],
        }}
        hasExistingLessons
        loading={false}
        onClose={() => {}}
        onConfirm={onConfirm}
        onSelectionChange={() => {}}
      />,
    );
    const box = screen.getByRole("checkbox", { name: "Создать как новое занятие" });
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Применить изменения" }));
    expect(onConfirm).toHaveBeenCalledWith("sync", {
      confirmDeletes: false,
      excludeRows: [],
      acceptConflicts: [4],
      moveEventRows: [],
    });
  });
});
