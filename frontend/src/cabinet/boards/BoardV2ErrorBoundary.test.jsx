/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STALE_BOARD_TITLE } from "../../utils/boardTabReload";
import BoardV2ErrorBoundary from "./BoardV2ErrorBoundary";

function Broken({ message }) {
  throw new TypeError(message);
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  try {
    delete window.top;
  } catch {
    /* top stays on the prototype */
  }
});

describe("BoardV2ErrorBoundary", () => {
  it("reloads the board tab for a missing default export instead of remounting", () => {
    const reload = vi.fn();
    const onRetry = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace: vi.fn(),
    });
    sessionStorage.setItem("itflux.chunk-recover", String(Date.now()));
    render(
      <BoardV2ErrorBoundary onRetry={onRetry}>
        <Broken message="undefined is not an object (evaluating 'x._result.default')" />
      </BoardV2ErrorBoundary>,
    );
    expect(screen.getByText(STALE_BOARD_TITLE)).toBeTruthy();
    expect(screen.queryByText(/_result\.default/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Перезагрузить вкладку" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("auto-reloads a top-level board tab once", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace: vi.fn(),
    });
    render(
      <BoardV2ErrorBoundary>
        <Broken message="Importing a module script failed." />
      </BoardV2ErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("itflux.chunk-recover")).toBeTruthy();
  });

  it("does not auto-reload a board inside a meeting iframe", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace: vi.fn(),
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: { location: { pathname: "/cabinet/meetings/abc" } },
    });
    render(
      <BoardV2ErrorBoundary>
        <Broken message="Importing a module script failed." />
      </BoardV2ErrorBoundary>,
    );
    expect(screen.getByText(STALE_BOARD_TITLE)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("itflux.chunk-recover")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Перезагрузить вкладку" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps a manual retry for an ordinary board crash", () => {
    const reload = vi.fn();
    const onRetry = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace: vi.fn(),
    });
    render(
      <BoardV2ErrorBoundary onRetry={onRetry}>
        <Broken message="canvas exploded" />
      </BoardV2ErrorBoundary>,
    );
    expect(screen.getByText(/canvas exploded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
