/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BankTask } from "./AllTasksBankItem";

vi.mock("./ExamTaskDrawingShell", () => ({
  default: function ExamTaskDrawingShellMock(props: { children?: unknown }) {
    return <div>{props.children as never}</div>;
  },
  ExamTaskDrawingHeaderButton: function HeaderBtn() {
    return <button type="button">board</button>;
  },
}));

vi.mock("./MathContent", () => ({
  default: function MathContentMock(props: { html?: string }) {
    return <div>{props.html}</div>;
  },
}));

vi.mock("./TaskFileAttachment", () => ({
  TaskFileAttachments: function Files() {
    return null;
  },
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

vi.mock("./TaskAnswerCheck", () => ({
  default: function Check() {
    return null;
  },
}));

vi.mock("./TaskNoAnswerBadge", () => ({
  default: function Badge() {
    return null;
  },
}));

import { AllTasksBankItem } from "./AllTasksBankItem";

const noop = () => {};

function renderTask(task: BankTask) {
  return render(
    <AllTasksBankItem
      task={task}
      taskNumber={14}
      pickMode={false}
      inPick={false}
      onTogglePick={noop}
      isTeacher={false}
      copyBusy={false}
      onCopyToBank={noop}
      useProgTaskSheet={false}
      hasTaskBoardDraft={false}
      onOpenBoard={noop}
      subject="inf"
      level="vpr"
      persistEntry={undefined}
      openBoardRequested={false}
      onBoardPersist={noop}
      onConsumedBoardOpenRequest={noop}
      canEditTaskTags={false}
      tagCatalog={[]}
      onTaskTagsChange={noop}
      canEditBankTasks={false}
      taskLists={[]}
      staffGroups={[]}
      staffSubtopics={[]}
      onStaffSaved={noop}
      answerOpen={false}
      onToggleAnswer={noop}
    />
  );
}

describe("bank student pack files", () => {
  afterEach(() => cleanup());

  it("renders student download links and hides teacher references", () => {
    const task: BankTask & { teacher_files?: Array<{ name: string; url: string }> } = {
      id: 14,
      task_number: 14,
      task_title: "Файл",
      subtopic: null,
      text: "<p>условие</p>",
      answer: "",
      student_files: [{ name: "14.TXT", url: "/api/tasks/14/pack-file/?name=14.TXT" }],
      teacher_files: [{ name: "ref14.docx", url: "/api/tasks/14/pack-file/?name=ref14.docx" }],
    };
    renderTask(task);
    const link = screen.getByRole("link", { name: "14.TXT" });
    expect(link.getAttribute("href")).toBe("/api/tasks/14/pack-file/?name=14.TXT");
    expect(screen.queryByRole("link", { name: "ref14.docx" })).toBeNull();
    expect(document.body.textContent).not.toContain("ref14.docx");
  });
});
