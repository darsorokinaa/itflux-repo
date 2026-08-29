/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  bindBoardVisualViewport,
  isBoardCompactShell,
  isBoardEmbeddedInIframe,
  isBoardTouchShell,
  lockBoardPageScroll,
} from "./boardMobileShell";

describe("boardMobileShell", () => {
  afterEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  });

  it("isBoardEmbeddedInIframe is false when self === top", () => {
    expect(isBoardEmbeddedInIframe()).toBe(false);
  });

  it("isBoardEmbeddedInIframe is true when self !== top", () => {
    const original = window.self;
    Object.defineProperty(window, "self", { configurable: true, value: {} });
    try {
      expect(isBoardEmbeddedInIframe()).toBe(true);
    } finally {
      Object.defineProperty(window, "self", { configurable: true, value: original });
    }
  });

  it("isBoardCompactShell follows 768px breakpoint", () => {
    const win = {
      matchMedia: (query: string) => ({
        matches: query.includes("max-width: 768px"),
      }),
    } as Window;
    expect(isBoardCompactShell(win)).toBe(true);
  });

  it("isBoardCompactShell includes short landscape", () => {
    const win = {
      matchMedia: (query: string) => ({
        matches: query.includes("max-height: 600px"),
      }),
    } as Window;
    expect(isBoardCompactShell(win)).toBe(true);
  });

  it("isBoardTouchShell includes coarse tablet pointer", () => {
    const win = {
      matchMedia: (query: string) => ({
        matches: query.includes("pointer: coarse"),
      }),
    } as Window;
    expect(isBoardTouchShell(win)).toBe(true);
    expect(isBoardCompactShell(win)).toBe(false);
  });

  it("lockBoardPageScroll restores overflow and classes", () => {
    document.body.style.overflow = "auto";
    const unlock = lockBoardPageScroll();
    expect(document.documentElement.classList.contains("cb-board-editor-open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    unlock();
    expect(document.documentElement.classList.contains("cb-board-editor-open")).toBe(false);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("bindBoardVisualViewport skips iframe and clears inline size", () => {
    const original = window.self;
    Object.defineProperty(window, "self", { configurable: true, value: {} });
    const style: Record<string, string> = { height: "10px", top: "2px", width: "3px", left: "4px" };
    try {
      const stop = bindBoardVisualViewport(() => ({ style: style as unknown as CSSStyleDeclaration }));
      expect(style.height).toBe("");
      stop();
    } finally {
      Object.defineProperty(window, "self", { configurable: true, value: original });
    }
  });
});
