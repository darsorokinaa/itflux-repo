/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlanEditorSessionCard, PlanSessionsList } from "./PlanEditorLessonList";
import { clonePlanSession, EMPTY_PLAN_SESSION, sessionListKey } from "../planEditorSession";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
});

vi.mock("../CabinetIcons", () => ({
  default: function CabinetIcon() {
    return <span data-testid="icon" />;
  },
}));

vi.mock("./CabinetFloatingMenu", () => ({
  default: function CabinetFloatingMenu({ open, children }) {
    return open ? <div role="menu">{children}</div> : null;
  },
}));

vi.mock("./PlanEditorResourceBlock", () => ({
  default: function PlanEditorResourceBlock({ label, actionLabel, onAttach }) {
    return (
      <div>
        <span>{label}</span>
        <button type="button" onClick={onAttach}>{actionLabel}</button>
      </div>
    );
  },
}));

function session(overrides = {}) {
  return { ...clonePlanSession(EMPTY_PLAN_SESSION), title: "Алгоритмы", ...overrides };
}

const noop = () => {};

afterEach(() => cleanup());

describe("PlanEditorSessionCard", () => {
  it("keeps lesson identity and shows numbered title separately", () => {
    const item = session({ title: "1" });
    render(
      <PlanEditorSessionCard
        session={item}
        index={0}
        total={1}
        expanded={false}
        topics={[]}
        isDragging={false}
        isOrigin={false}
        onToggle={noop}
        onChange={noop}
        onDateChange={noop}
        onRestorePlannedDate={noop}
        onMove={noop}
        onMoveToTopic={noop}
        onDuplicate={noop}
        onOpenPicker={noop}
        onRemoveAttachment={noop}
        onSaveSession={noop}
        onDeleteSession={noop}
        onHandlePointerDown={noop}
        attaching={false}
        savingSession={false}
        sessionError={null}
        dateDraft={null}
        plannedDate=""
        dateOverride={false}
      />,
    );
    const card = document.querySelector("[data-plan-index='0']");
    expect(card).toBeTruthy();
    expect(screen.getByLabelText("Перетащить урок")).toBeTruthy();
    expect(screen.getByText("1", { selector: ".cb-pe-session__title" })).toBeTruthy();
    expect(screen.getByText("ДЗ нет")).toBeTruthy();
  });

  it("groups existing fields without renaming them", () => {
    render(
      <PlanEditorSessionCard
        session={session()}
        index={0}
        total={1}
        expanded
        topics={[]}
        isDragging={false}
        isOrigin={false}
        onToggle={noop}
        onChange={noop}
        onDateChange={noop}
        onRestorePlannedDate={noop}
        onMove={noop}
        onMoveToTopic={noop}
        onDuplicate={noop}
        onOpenPicker={noop}
        onRemoveAttachment={noop}
        onSaveSession={noop}
        onDeleteSession={noop}
        onHandlePointerDown={noop}
        attaching={false}
        savingSession={false}
        sessionError={null}
        dateDraft={null}
        plannedDate=""
        dateOverride={false}
      />,
    );
    expect(screen.getByText("Основное")).toBeTruthy();
    expect(screen.getByText("Содержание урока")).toBeTruthy();
    expect(screen.getByText("Материалы и домашнее задание")).toBeTruthy();
    expect(screen.getByText("Комментарий учителя")).toBeTruthy();
    expect(screen.getByText("Прикрепить")).toBeTruthy();
    expect(screen.getByText("Настроить")).toBeTruthy();
  });
});

describe("PlanSessionsList", () => {
  it("keys lesson wraps by sessionListKey, not index", () => {
    const sessions = [session({ title: "A" }), session({ title: "B" })];
    render(
      <PlanSessionsList
        sessions={sessions}
        groups={[{ id: "none", topic: "", topicKey: "", indices: [0, 1] }]}
        showTopics={false}
        expandedIndex={null}
        draggingIndex={null}
        dropLineIndex={null}
        attachingIndex={null}
        savingSessionIndex={null}
        sessionErrors={{}}
        renamingTopicId={null}
        listRef={{ current: null }}
        onToggle={noop}
        onChange={noop}
        onDateChange={noop}
        onRestorePlannedDate={noop}
        onMove={noop}
        onMoveToTopic={noop}
        onDuplicate={noop}
        onOpenPicker={noop}
        onRemoveAttachment={noop}
        onSaveSession={noop}
        onDeleteSession={noop}
        onDeleteTopic={noop}
        onHandlePointerDown={noop}
        onStartRenameTopic={noop}
        onCommitRenameTopic={noop}
        onCancelRenameTopic={noop}
        onAddInTopic={noop}
        dateDraftIndex={null}
        dateDraftValue={null}
        plannedDates={["", ""]}
      />,
    );
    const wraps = [...document.querySelectorAll(".cb-pe-session-wrap")];
    expect(wraps).toHaveLength(2);
    expect(sessionListKey(sessions[0], 0)).not.toBe("0");
    expect(sessionListKey(sessions[1], 1)).not.toBe("1");
    expect(document.querySelector("[data-plan-index='0']")).toBeTruthy();
    expect(document.querySelector("[data-plan-index='1']")).toBeTruthy();
  });
});
