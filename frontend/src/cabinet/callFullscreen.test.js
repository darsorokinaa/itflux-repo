import { describe, expect, it, vi } from "vitest";

import {
  currentFullscreenElement,
  exitDocumentFullscreen,
  fullscreenApiAvailable,
  fullscreenNeedsFallback,
  requestNodeFullscreen,
} from "./callFullscreen";

describe("call fullscreen", () => {
  it("uses requestFullscreen on the call container", async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const node = { requestFullscreen };
    expect(fullscreenApiAvailable(node)).toBe(true);
    await requestNodeFullscreen(node);
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("falls back only when the browser cannot fullscreen an element", () => {
    expect(fullscreenNeedsFallback({ name: "NotSupportedError" })).toBe(true);
    expect(fullscreenNeedsFallback({ name: "NotAllowedError" })).toBe(false);
    expect(fullscreenApiAvailable({})).toBe(false);
  });

  it("exits through the document fullscreen element", async () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    const frame = document.createElement("div");
    document.body.appendChild(frame);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: frame });
    document.exitFullscreen = exitFullscreen;
    expect(currentFullscreenElement()).toBe(frame);
    await exitDocumentFullscreen();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    document.body.removeChild(frame);
    delete document.fullscreenElement;
  });
});
