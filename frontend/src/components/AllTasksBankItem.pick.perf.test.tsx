/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useMemo, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BankTask } from "./AllTasksBankItem";

const shellRenders = { n: 0 };

vi.mock("./ExamTaskDrawingShell", () => ({
  default: function ExamTaskDrawingShellMock(props: { taskId: number; children?: unknown }) {
    shellRenders.n += 1;
    return <div data-testid={`shell-${props.taskId}`}>{props.children as never}</div>;
  },
  ExamTaskDrawingHeaderButton: function HeaderBtn(props: { onClick?: () => void }) {
    return (
      <button type="button" onClick={props.onClick}>
        board
      </button>
    );
  },
}));

vi.mock("./MathContent", () => ({
  default: function MathContentMock(props: { html?: string }) {
    return <div data-testid="math">{props.html}</div>;
  },
}));

vi.mock("./TaskFileAttachment", () => ({
  TaskFileAttachments: function Files() {
    return null;
  },
  collectTaskFiles: () => [],
}));

vi.mock("./AllTasksTagEditor", () => ({
  AllTasksTaskTagsEditor: function Tags() {
    return null;
  },
}));

vi.mock("./AllTasksStaffEditor", () => ({
  AllTasksStaffEditor: function Staff() {
    return null;
  },
}));

import { AllTasksBankItem } from "./AllTasksBankItem";
// @ts-ignore JSX module without d.ts
import ExamTaskDrawingShell from "./ExamTaskDrawingShell";

function makeTasks(n: number): BankTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    task_number: 1,
    task_title: "Задание",
    subtopic: null,
    text: `<p>Условие ${i + 1}</p>`,
    answer: "42",
  }));
}

const noop = () => {};
const emptyTags: never[] = [];
const emptyLists: never[] = [];
const emptyGroups: never[] = [];
const emptySubs: never[] = [];

function UnmemoizedPickList({ tasks }: { tasks: BankTask[] }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  return (
    <ul>
      {tasks.map((task) => {
        const inPick = selected.has(task.id);
        return (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={inPick}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(task.id);
                    else next.delete(task.id);
                    return next;
                  });
                }}
              />
              <span>{inPick ? "Добавлено" : "Добавить"}</span>
            </label>
            <ExamTaskDrawingShell
              enabled
              taskId={task.id}
              level="oge"
              subject="math"
              variantId="task-bank"
              persistEntry={undefined}
              onDrawingPersist={() => {}}
              openBoardForTaskId={null}
              onConsumedBoardOpenRequest={() => {}}
            >
              <div>{task.text}</div>
            </ExamTaskDrawingShell>
          </li>
        );
      })}
    </ul>
  );
}

function MemoizedPickList({ tasks }: { tasks: BankTask[] }) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const onTogglePick = useCallback((task: BankTask, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(task.id);
      else next.delete(task.id);
      return next;
    });
  }, []);
  const selectedIds = useMemo(() => selected, [selected]);

  return (
    <ul>
      {tasks.map((task) => (
        <AllTasksBankItem
          key={task.id}
          task={task}
          taskNumber={task.task_number ?? 1}
          pickMode
          inPick={selectedIds.has(task.id)}
          onTogglePick={onTogglePick}
          isTeacher={false}
          copyBusy={false}
          onCopyToBank={noop}
          useProgTaskSheet={false}
          hasTaskBoardDraft={false}
          onOpenBoard={noop}
          subject="math"
          level="oge"
          persistEntry={undefined}
          openBoardRequested={false}
          onBoardPersist={noop}
          onConsumedBoardOpenRequest={noop}
          canEditTaskTags={false}
          tagCatalog={emptyTags}
          onTaskTagsChange={noop}
          canEditBankTasks={false}
          taskLists={emptyLists}
          staffGroups={emptyGroups}
          staffSubtopics={emptySubs}
          onStaffSaved={noop}
          answerOpen={false}
          onToggleAnswer={noop}
        />
      ))}
    </ul>
  );
}

describe("All tasks pick-mode add click", () => {
  beforeAll(() => {
    class FakeRO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    class FakeIO {
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      cb: IntersectionObserverCallback;
      observe(node: Element) {
        this.cb(
          [{ isIntersecting: true, target: node } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    cleanup();
    shellRenders.n = 0;
  });

  it("legacy inline list re-renders every drawing shell on one Add click", () => {
    const tasks = makeTasks(80);
    render(<UnmemoizedPickList tasks={tasks} />);
    const afterMount = shellRenders.n;
    expect(afterMount).toBe(80);

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(screen.getByText("Добавлено")).toBeTruthy();
    expect(shellRenders.n - afterMount).toBe(80);
  });

  it("memoized cards do not re-render drawing shells on one Add click", () => {
    const tasks = makeTasks(80);
    render(<MemoizedPickList tasks={tasks} />);
    const afterMount = shellRenders.n;
    expect(afterMount).toBe(80);

    const firstAdd = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    fireEvent.click(firstAdd);

    expect(firstAdd.checked).toBe(true);
    expect(screen.getByText("Добавлено")).toBeTruthy();
    expect(shellRenders.n).toBe(afterMount);

    fireEvent.click(firstAdd);
    expect(firstAdd.checked).toBe(false);
    expect(shellRenders.n).toBe(afterMount);

    fireEvent.click(firstAdd);
    expect(firstAdd.checked).toBe(true);
    expect(shellRenders.n).toBe(afterMount);
  });

  it("memoized 200-card list keeps click work proportional to one card", () => {
    const tasks = makeTasks(200);
    render(<MemoizedPickList tasks={tasks} />);
    const afterMount = shellRenders.n;
    expect(afterMount).toBe(200);

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const t0 = performance.now();
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[2]);
    fireEvent.click(boxes[3]);
    const elapsed = performance.now() - t0;

    expect(boxes.slice(0, 4).every((box) => box.checked)).toBe(true);
    expect(shellRenders.n).toBe(afterMount);
    expect(elapsed).toBeLessThan(250);
  });
});
