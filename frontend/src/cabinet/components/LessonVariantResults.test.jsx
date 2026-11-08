/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LessonVariantResults from "./LessonVariantResults";
import { lessonVariantsOf, variantScoreLabel } from "./lessonVariantResults";

vi.mock("../../components/taskDocument/TaskNumber", () => ({
  TaskPosition: ({ position, examNumber }) => <span>{position || examNumber}</span>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const checked = {
  homework_id: 1,
  variant_id: 101,
  title: "Дроби (№ 101)",
  status: "checked",
  status_label: "Проверено",
  score_percent: 80,
  earned_points: 4,
  max_points: 5,
  correct_count: 4,
  checked_count: 5,
  tasks: [
    { id: 1, number: 1, student_answer: "1/2", correct_answer: "1/2", ok: true },
    { id: 2, number: 2, student_answer: "3", correct_answer: "4", ok: false },
  ],
  attempts: [
    { id: 9, attempt_number: 1, status: "checked", status_label: "Проверено", score: 40, is_final: true },
  ],
  report_ready: true,
  report_url: "/api/cabinet/journal/lessons/5/variants/101/report/?student_id=2",
  report_filename: "report-Анна Иванова.pdf",
};

const pending = {
  homework_id: 2,
  variant_id: 202,
  title: "Вариант №202",
  status: "pending_review",
  status_label: "Ждёт проверки",
  score_percent: 0,
  earned_points: 0,
  max_points: 5,
  tasks: [],
  attempts: [],
};

describe("LessonVariantResults", () => {
  it("shows every variant of the lesson and does not treat a pending one as zero", () => {
    render(
      <LessonVariantResults
        variants={[checked, pending]}
        parentReport={"Здравствуйте!\nВариант №202 — ждёт проверки, балл не выставлен"}
        showParentReport
      />,
    );

    expect(screen.getByText("Дроби (№ 101)")).toBeTruthy();
    expect(screen.getByText("Вариант №202")).toBeTruthy();
    expect(screen.getByText("4 из 5 · 80%")).toBeTruthy();
    expect(screen.getByText("Ждёт проверки")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByText("Балл не выставлен")).toBeTruthy();
    expect(screen.getByLabelText("Текст отчёта для родителя").textContent).toMatch(/балл не выставлен/);
    expect(screen.getByRole("button", { name: "Скопировать" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Скачать текст" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Скачать отчёт" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Файл отчёта после проверки" })).toBeTruthy();
  });

  it("downloads the finish-variant file for this variant only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
      headers: { get: () => 'attachment; filename="report-Анна Иванова.pdf"' },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LessonVariantResults variants={[checked, pending]} showParentReport={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Скачать отчёт" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe(checked.report_url);
    expect(screen.queryAllByRole("button", { name: "Скачать отчёт" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Файл отчёта после проверки" })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("opens the existing result table and keeps attempt history", () => {
    render(<LessonVariantResults variants={[checked]} showParentReport={false} showCorrectAnswer />);

    fireEvent.click(screen.getByRole("button", { name: "Подробный результат" }));
    expect(screen.getByText("Правильный")).toBeTruthy();
    expect(screen.getAllByText("1/2").length).toBeGreaterThan(0);
    expect(document.querySelector(".jl-variant-result__table")).toBeTruthy();
    const history = document.querySelector(".jl-lesson-variants__attempts")?.textContent || "";
    expect(history).toMatch(/Проверено/);
    expect(history).toMatch(/40%/);
  });

  it("hides the parent report and the answer key for the student", () => {
    render(<LessonVariantResults variants={[checked]} showParentReport={false} showCorrectAnswer={false} />);

    expect(screen.queryByLabelText("Текст отчёта для родителя")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Подробный результат" }));
    expect(screen.queryByText("Правильный")).toBeNull();
    expect(screen.getByText("Ваш ответ")).toBeTruthy();
    expect(screen.queryByText("4")).toBeNull();
  });

  it("shows an empty state without a fake score", () => {
    render(
      <LessonVariantResults
        variants={[]}
        parentReport="На этом занятии варианты не выдавались."
        showParentReport
      />,
    );

    expect(screen.getByText("На этом уроке варианты не выдавались.")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("Балл не выставлен")).toBeNull();
  });

  it("falls back to a stored single result and ignores a non-checked zero", () => {
    expect(lessonVariantsOf({ variant_result: { title: "Вариант №7", tasks: [{ ok: true }] } })).toHaveLength(1);
    expect(lessonVariantsOf({})).toEqual([]);
    expect(variantScoreLabel(pending)).toBeNull();
    expect(variantScoreLabel({ status: "checked", score_percent: 0, checked_count: 2 })).toBe("0%");
  });
});
