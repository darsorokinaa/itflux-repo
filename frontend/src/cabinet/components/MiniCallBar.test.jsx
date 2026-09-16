/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MiniCallBar from "./MiniCallBar";

afterEach(() => {
  cleanup();
});

describe("MiniCallBar", () => {
  it("does not show mic, camera, or hide as a text control", () => {
    render(
      <MiniCallBar
        remoteName="Ученик"
        pipAvailable
        onStayOnTop={() => {}}
        onExpand={() => {}}
        onHangup={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /микрофон/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /камер/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Скрыть" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Поверх окон" })).toBeNull();
    expect(screen.queryByRole("button", { name: "На весь экран" })).toBeNull();
    expect(screen.getByRole("button", { name: "Видео поверх окон" })).toBeTruthy();
  });

  it("keeps expand in the more menu and uses a PiP icon", () => {
    const onStayOnTop = vi.fn();
    const onExpand = vi.fn();
    render(
      <MiniCallBar
        remoteName="Ученик"
        pipAvailable
        pipActive
        onStayOnTop={onStayOnTop}
        onExpand={onExpand}
        onHangup={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Вернуть видео в урок" }));
    expect(onStayOnTop).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Ещё" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "На весь экран" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows a compact participant chrome during screen share", () => {
    const onStayOnTop = vi.fn();
    render(
      <MiniCallBar
        shareMode
        remoteName="Дарья"
        remoteAudioMuted
        pipAvailable
        pipNeedsGesture
        onStayOnTop={onStayOnTop}
        onToggleCollapsed={() => {}}
      />,
    );
    expect(screen.getByText("Дарья")).toBeTruthy();
    expect(screen.queryByText("Поверх окон")).toBeNull();
    expect(screen.queryByRole("button", { name: "На весь экран" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Завершить звонок" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Показать ученика поверх окон" }));
    expect(onStayOnTop).toHaveBeenCalledTimes(1);
  });

  it("shows waiting status and can collapse", () => {
    const onToggleCollapsed = vi.fn();
    const { rerender } = render(
      <MiniCallBar
        waiting
        onToggleCollapsed={onToggleCollapsed}
        onExpand={() => {}}
        onHangup={() => {}}
      />,
    );
    expect(screen.getByText("Ждём ученика")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(
      <MiniCallBar
        collapsed
        waiting
        onToggleCollapsed={onToggleCollapsed}
        onExpand={() => {}}
        onHangup={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Показать" })).toBeTruthy();
  });
});
