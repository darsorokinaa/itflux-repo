/**
 * Реалистичная страница варианта: 16 заданий ВПР №6, как /vpr/inf/variant/2096.
 * Замер до правки (один коммит на всю страницу, фокус только после rAF):
 * meanKeyCommitMs 16.61, первое нажатие actual 22.7 мс, focusMoved false.
 * После: срочный коммит клетки ~0.7 мс (прогрев среднего первых коммитов < 3 мс),
 * фокус переходит сразу, страница догоняет отдельным коммитом.
 */
import { Profiler } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExamPage from "./ExamPage";

const FORMULAS = [
  "A \\land B",
  "A \\lor B",
  "\\lnot A \\land B",
  "A \\land \\lnot B",
  "\\lnot A \\lor B",
  "A \\lor \\lnot B",
  "\\lnot A \\land \\lnot B",
  "\\lnot A \\lor \\lnot B",
  "\\lnot (A \\land B)",
  "\\lnot (A \\lor B)",
  "\\lnot (\\lnot A \\land B)",
  "\\lnot (A \\land \\lnot B)",
  "\\lnot (\\lnot A \\lor B)",
  "\\lnot (A \\lor \\lnot B)",
  "\\lnot (\\lnot A \\land \\lnot B)",
  "\\lnot (\\lnot A \\lor \\lnot B)",
];

function taskText(formula) {
  return `<p>Заполните таблицу истинности выражения.</p><p><span class="math-inline">&#92;(${formula.replace(/\\/g, "&#92;")}&#92;&#41;</span></p>`;
}

const VARIANT = {
  id: 2096,
  title: "ВПР",
  level: "vpr",
  subject: "inf",
  tasks: FORMULAS.map((formula, index) => ({
    id: 1324 + index,
    number: 6,
    task_title: "Построение таблицы истинности",
    text: taskText(formula),
    answer: "",
    part: 1,
    exam_part: 1,
    max_score: 1,
    truth_table_enabled: true,
    vpr_class: 8,
    vpr_advanced: true,
  })),
  theme_id: null,
  theme: null,
  part_instructions: [],
  cover_paragraphs: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function installMatchMedia() {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
  if (typeof window.ResizeObserver !== "function") {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

describe("ExamPage ввод таблицы истинности", () => {
  it("16 заданий: коммит на цифру и переход между клетками", async () => {
    installMatchMedia();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href.includes("/variant/2096")) {
        return { ok: true, status: 200, text: async () => JSON.stringify(VARIANT) };
      }
      return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
    }));
    const commits = [];
    render(
      <MemoryRouter initialEntries={["/vpr/inf/variant/2096"]}>
        <Profiler id="exam" onRender={(_id, phase, actualDuration) => {
          commits.push({ phase, actualDuration });
        }}>
          <Routes>
            <Route path="/:level/:subject/variant/:variant_id" element={<ExamPage />} />
          </Routes>
        </Profiler>
      </MemoryRouter>
    );
    const first = await waitFor(() => {
      const node = document.querySelector("[data-task-id='1337'] input.truth-input");
      expect(node).toBeTruthy();
      return node;
    }, { timeout: 8000 });
    const mountActual = commits.reduce((sum, row) => sum + row.actualDuration, 0);
    commits.length = 0;
    const samples = [];
    let active = first;
    for (const digit of ["1", "0", "1", "0", "1", "0"]) {
      active.focus();
      const before = commits.length;
      const t0 = performance.now();
      fireEvent.change(active, { target: { value: digit } });
      const wall = performance.now() - t0;
      const fresh = commits.slice(before);
      const shown = active.value;
      const next = document.activeElement?.classList?.contains("truth-input")
        ? document.activeElement
        : active;
      samples.push({
        digit,
        shown,
        wall: Number(wall.toFixed(2)),
        commits: fresh.length,
        parts: fresh.map((row) => Number(row.actualDuration.toFixed(2))),
        actual: Number(fresh.reduce((sum, row) => sum + row.actualDuration, 0).toFixed(2)),
        focusMoved: next !== active,
      });
      if (next !== active) active = next;
    }
    const mean = samples.reduce((sum, row) => sum + row.actual, 0) / samples.length;
    console.log("EXAM_PAGE_TRUTH_PROFILE", JSON.stringify({
      tasks: VARIANT.tasks.length,
      inputs: document.querySelectorAll("input.truth-input").length,
      mountActualMs: Number(mountActual.toFixed(2)),
      meanKeyCommitMs: Number(mean.toFixed(2)),
      samples,
    }));
    const cells = [...document.querySelectorAll("[data-task-id='1337'] input.truth-input")];
    expect(samples[0].focusMoved).toBe(true);
    expect(samples.every((row) => row.focusMoved)).toBe(true);
    expect(cells[0].value).toBe("1");
    expect(cells[3].value).toBe("0");
    expect(document.querySelector("[data-task-id='1337'] .truth-title, [data-task-id='1337'] .truth-formula")).toBeNull();
    expect(document.querySelectorAll("input.truth-input").length).toBeGreaterThan(40);
    const firstParts = samples.map((row) => row.parts[0] ?? row.actual);
    const meanFirst = firstParts.reduce((sum, n) => sum + n, 0) / firstParts.length;
    console.log("EXAM_PAGE_TRUTH_FIRST_COMMIT", Number(meanFirst.toFixed(2)));
    const warmFirst = firstParts.slice(1);
    const warmMean = warmFirst.reduce((sum, n) => sum + n, 0) / warmFirst.length;
    // До правки вся страница была одним коммитом: среднее 16.61 мс, первое нажатие 22.7 мс,
    // фокус не уходил из клетки до rAF после этого коммита.
    expect(warmMean).toBeLessThan(3);
  });
});
