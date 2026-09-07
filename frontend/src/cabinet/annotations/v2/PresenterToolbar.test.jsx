/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PresenterToolbar from "./PresenterToolbar";
import { TOOLS } from "../../screenshare/constants";

const noop = () => {};

afterEach(() => {
  cleanup();
});

describe("PresenterToolbar", () => {
  it("does not clear annotations when collapsed", () => {
    const onClose = vi.fn();
    const onClearAll = vi.fn();
    render(
      <PresenterToolbar
        tool={TOOLS.PEN}
        color="#ef4444"
        width={4}
        canAnnotate
        canManage
        onClose={onClose}
        onClearAll={onClearAll}
        onToolChange={noop}
        onColorChange={noop}
        onWidthChange={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it("asks before clearing every annotation", () => {
    const onClearAll = vi.fn();
    render(
      <PresenterToolbar
        tool={TOOLS.POINTER}
        color="#ef4444"
        width={4}
        canAnnotate
        canManage
        onClearAll={onClearAll}
        onClose={noop}
        onToolChange={noop}
        onColorChange={noop}
        onWidthChange={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Очистить все" }));
    expect(onClearAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("toggles student drawing permission from the annotation UI", () => {
    const onSetParticipantsCanAnnotate = vi.fn();
    render(
      <PresenterToolbar
        tool={TOOLS.POINTER}
        color="#ef4444"
        width={4}
        canAnnotate
        canManage
        participantsCanAnnotate={false}
        onSetParticipantsCanAnnotate={onSetParticipantsCanAnnotate}
        onClose={noop}
        onToolChange={noop}
        onColorChange={noop}
        onWidthChange={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Разрешить пометки ученику" }));
    expect(onSetParticipantsCanAnnotate).toHaveBeenCalledWith(true);
  });
});
