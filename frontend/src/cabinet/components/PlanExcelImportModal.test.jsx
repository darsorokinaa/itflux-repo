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
    expect(onConfirm).toHaveBeenCalledWith("replace_all");
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
});
