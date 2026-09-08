import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANNOTATION_PIP_SIZE,
  bindPipWindowClose,
  closeDocumentPipWindow,
  documentPipAvailable,
  openDocumentPipWindow,
} from "./documentPip";

describe("annotation document PiP", () => {
  afterEach(() => {
    delete window.documentPictureInPicture;
    vi.restoreAllMocks();
  });

  it("is unavailable without Document Picture-in-Picture", () => {
    expect(documentPipAvailable()).toBe(false);
  });

  it("opens a compact always-on-top toolbar window", async () => {
    const pipWindow = {
      document: {
        adoptedStyleSheets: [],
        querySelectorAll: () => [],
        head: { appendChild: vi.fn() },
        body: { className: "" },
      },
      addEventListener: vi.fn(),
      close: vi.fn(),
    };
    const requestWindow = vi.fn(async () => pipWindow);
    window.documentPictureInPicture = { requestWindow };
    const result = await openDocumentPipWindow();
    expect(result).toBe(pipWindow);
    expect(requestWindow).toHaveBeenCalledWith({
      width: ANNOTATION_PIP_SIZE.width,
      height: ANNOTATION_PIP_SIZE.height,
      disallowReturnToOpener: false,
    });
    expect(pipWindow.document.body.className).toBe("ss-ann-v2-pip-body");
  });

  it("closes the window and ignores a missing handle", () => {
    const pipWindow = { closed: false, close: vi.fn() };
    closeDocumentPipWindow(pipWindow);
    expect(pipWindow.close).toHaveBeenCalledTimes(1);
    expect(() => closeDocumentPipWindow(null)).not.toThrow();
  });

  it("notifies when the floating window is closed", () => {
    const listeners = {};
    const pipWindow = {
      addEventListener: vi.fn((type, handler) => {
        listeners[type] = handler;
      }),
      removeEventListener: vi.fn(),
    };
    const onClose = vi.fn();
    const unbind = bindPipWindowClose(pipWindow, onClose);
    listeners.pagehide();
    expect(onClose).toHaveBeenCalledTimes(1);
    unbind();
    expect(pipWindow.removeEventListener).toHaveBeenCalled();
  });
});
