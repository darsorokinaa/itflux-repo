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
  it("renders only remote avatars and no collaboration plaque", () => {
    render(
      <BoardCollabControls
        people={[
          person({ key: "self", name: "Татьяна", isSelf: true, initials: "ТТ" }),
          person({ key: "stu", name: "Дарья", clientId: "c1", initials: "ДА" }),
        ]}
        onFollow={noop}
        onStopFollow={noop}
      />,
    );
    expect(screen.queryByText("Совместное редактирование активно")).toBeNull();
    expect(screen.queryByText("Подключено")).toBeNull();
    expect(screen.queryByText("Участники")).toBeNull();
    expect(screen.queryByLabelText(/это вы/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Следить за Татьяна" })).toBeNull();
    expect(screen.getByRole("button", { name: "Следить за Дарья" })).toBeTruthy();
  });

  it("does not render when only self is present", () => {
    const { container } = render(
      <BoardCollabControls
        people={[person({ key: "self", name: "Учитель", isSelf: true })]}
        onFollow={noop}
        onStopFollow={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("toggles follow on avatar click without a separate follow button", () => {
    const onFollow = vi.fn();
    const onStopFollow = vi.fn();
    const people = [
      person({ key: "self", name: "Ученик", isSelf: true }),
      person({ key: "tea", name: "Учитель", clientId: "teacher-1" }),
    ];
    const { rerender } = render(
      <BoardCollabControls
        people={people}
        onFollow={onFollow}
        onStopFollow={onStopFollow}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Следить за Учитель" }));
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow.mock.calls[0][0].clientId).toBe("teacher-1");
    expect(onStopFollow).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Следить за участником" })).toBeNull();

    rerender(
      <BoardCollabControls
        people={people}
        followingClientId="teacher-1"
        onFollow={onFollow}
        onStopFollow={onStopFollow}
      />,
    );
    const followed = screen.getByRole("button", { name: "Вы следите за Учитель" });
    expect(followed.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(followed);
    expect(onStopFollow).toHaveBeenCalledTimes(1);
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it("starts follow in a 1:1 session even without peer roles", () => {
    const onFollow = vi.fn();
    render(
      <BoardCollabControls
        people={[
          person({ key: "self", name: "Ученик", isSelf: true }),
          person({ key: "tea", name: "Учитель", clientId: "teacher-1" }),
        ]}
        onFollow={onFollow}
        onStopFollow={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Следить за Учитель" }));
    expect(onFollow).toHaveBeenCalledTimes(1);
    expect(onFollow.mock.calls[0][0].clientId).toBe("teacher-1");
  });

  it("summons from the teacher's own avatar, without a separate button", () => {
    const onSummon = vi.fn();
    const people = [
      person({ key: "self", name: "Татьяна", isSelf: true, role: "teacher", initials: "ТТ" }),
      person({ key: "stu", name: "Дарья", clientId: "c1" }),
    ];
    const { rerender } = render(
      <BoardCollabControls
        people={people}
        onFollow={noop}
        onStopFollow={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: "Перенести ко мне" })).toBeNull();
    expect(screen.queryByText("Перенести ко мне")).toBeNull();

    rerender(
      <BoardCollabControls
        people={people}
        canSummon
        onFollow={noop}
        onStopFollow={noop}
        onSummon={onSummon}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Перенести ко мне" }));
    expect(onSummon).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Перенести ко мне")).toBeNull();
  });

  it("collapses extra avatars behind +N", () => {
    const people = [
      person({ key: "self", name: "Я", isSelf: true }),
      ...["Аня", "Боря", "Вика", "Гена", "Даша"].map((name, index) => (
        person({ key: `p${index}`, name, clientId: `c${index}` })
      )),
    ];
    render(
      <BoardCollabControls
        people={people}
        onFollow={noop}
        onStopFollow={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Следить за Аня" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Следить за Даша" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ещё 1" }));
    expect(screen.getByRole("button", { name: "Следить за Даша" })).toBeTruthy();
  });
});
