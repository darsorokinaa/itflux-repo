/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardHostSizeIsUsable, observeBoardHostSize } from "./boardHostSize";

describe("boardHostSize", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("rejects 0×0 and sub-threshold boxes", () => {
    expect(boardHostSizeIsUsable(0, 0)).toBe(false);
    expect(boardHostSizeIsUsable(7, 100)).toBe(false);
    expect(boardHostSizeIsUsable(100, 7)).toBe(false);
    expect(boardHostSizeIsUsable(8, 8)).toBe(true);
  });

  it("notifies once per real size change and ignores sub-pixel jitter", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    Object.defineProperty(host, "clientWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 300 });

    const callbacks: Array<(entries: Array<{ contentRect: DOMRectReadOnly }>) => void> = [];
    class FakeRO {
      constructor(cb: (entries: Array<{ contentRect: DOMRectReadOnly }>) => void) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeRO);

    const onUsableSize = vi.fn();
    const stop = observeBoardHostSize(host, { onUsableSize });
    expect(onUsableSize).toHaveBeenCalledTimes(1);
    expect(onUsableSize).toHaveBeenLastCalledWith({ width: 400, height: 300 });

    const fire = (width: number, height: number) => {
      callbacks[0]([{ contentRect: { width, height } as DOMRectReadOnly }]);
    };
    fire(400.2, 300.1);
    expect(onUsableSize).toHaveBeenCalledTimes(1);
    fire(520, 300);
    expect(onUsableSize).toHaveBeenCalledTimes(2);
    expect(onUsableSize).toHaveBeenLastCalledWith({ width: 520, height: 300 });
    fire(4, 4);
    expect(onUsableSize).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not attach window resize or visualViewport listeners", () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { configurable: true, get: () => 200 });
    Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 100 });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    const add = vi.spyOn(window, "addEventListener");
    const stop = observeBoardHostSize(host, { onUsableSize: () => {} });
    const types = add.mock.calls.map((c) => c[0]);
    expect(types).not.toContain("resize");
    expect(types).not.toContain("orientationchange");
    stop();
    add.mockRestore();
  });
});
