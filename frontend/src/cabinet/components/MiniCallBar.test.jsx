/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MiniCallBar from "./MiniCallBar";

afterEach(() => {
  cleanup();
});

describe("MiniCallBar", () => {
  it("does not show mic, camera, or hide", () => {
    render(
      <MiniCallBar
        remoteName="Ученик"
        stayOnTopAvailable
        onStayOnTop={() => {}}
        onExpand={() => {}}
        onHangup={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /микрофон/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /камер/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Скрыть" })).toBeNull();
    expect(screen.getByRole("button", { name: "Поверх окон" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "На весь экран" })).toBeTruthy();
  });

  it("toggles stay-on-top from the compact chrome", () => {
    const onStayOnTop = vi.fn();
    render(
      <MiniCallBar
        remoteName="Ученик"
        stayOnTopAvailable
        stayOnTopActive
        onStayOnTop={onStayOnTop}
        onExpand={() => {}}
        onHangup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Вернуть в урок" }));
    expect(onStayOnTop).toHaveBeenCalledTimes(1);
  });
});
