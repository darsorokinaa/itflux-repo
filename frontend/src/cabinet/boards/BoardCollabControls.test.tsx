/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BoardCollabControls, { type BoardPresencePerson } from "./BoardCollabControls";

function person(partial: Partial<BoardPresencePerson> & Pick<BoardPresencePerson, "key" | "name">): BoardPresencePerson {
  return {
    initials: partial.name.slice(0, 2).toUpperCase(),
    color: "#123456",
    clientId: partial.clientId ?? null,
    role: partial.role,
    isSelf: partial.isSelf,
    online: partial.online ?? true,
    ...partial,
  };
}

const noop = () => {};

afterEach(() => {
  cleanup();
});

describe("BoardCollabControls", () => {
  it("does not show the idle collaboration label", () => {
    render(
      <BoardCollabControls
        people={[
          person({ key: "self", name: "Учитель", isSelf: true, role: "teacher" }),
          person({ key: "stu", name: "Ученик", clientId: "c1", role: "student" }),
        ]}
        selfRole="teacher"
        connectionStatus="open"
        onGoTo={noop}
        onFollow={noop}
        onStopFollow={noop}
        onMyArea={noop}
      />,
    );
    expect(screen.queryByText("Совместное редактирование активно")).toBeNull();
    expect(screen.queryByText("Подключено")).toBeNull();
  });

  it("still shows reconnect and error statuses", () => {
    const { rerender } = render(
      <BoardCollabControls
        people={[person({ key: "self", name: "Учитель", isSelf: true, role: "teacher" })]}
        selfRole="teacher"
        connectionStatus="connecting"
        reconnectElapsedMs={5000}
        onGoTo={noop}
        onFollow={noop}
        onStopFollow={noop}
        onMyArea={noop}
      />,
    );
    expect(screen.getByText("Переподключение...")).toBeTruthy();

    rerender(
      <BoardCollabControls
        people={[person({ key: "self", name: "Учитель", isSelf: true, role: "teacher" })]}
        selfRole="teacher"
        connectionStatus="error"
        onRetry={noop}
        onGoTo={noop}
        onFollow={noop}
        onStopFollow={noop}
        onMyArea={noop}
      />,
    );
    expect(screen.getByText(/Не удалось восстановить совместное редактирование/)).toBeTruthy();
  });

  it("starts follow when the arrow is clicked", () => {
    const onFollow = vi.fn();
    render(
      <BoardCollabControls
        people={[
          person({ key: "self", name: "Ученик", isSelf: true, role: "student" }),
          person({ key: "tea", name: "Учитель", clientId: "teacher-1", role: "teacher" }),
        ]}
        selfRole="student"
        connectionStatus="open"
        onGoTo={noop}
        onFollow={onFollow}
        onStopFollow={noop}
        onMyArea={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Следить за участником" }));
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow.mock.calls[0][0].clientId).toBe("teacher-1");
  });

  it("starts follow in a 1:1 session even without peer roles", () => {
    const onFollow = vi.fn();
    render(
      <BoardCollabControls
        people={[
          person({ key: "self", name: "Ученик", isSelf: true }),
          person({ key: "tea", name: "Учитель", clientId: "teacher-1" }),
        ]}
        selfRole="student"
        connectionStatus="open"
        onGoTo={noop}
        onFollow={onFollow}
        onStopFollow={noop}
        onMyArea={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Следить за участником" }));
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow.mock.calls[0][0].clientId).toBe("teacher-1");
  });
});
