import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INVALID_LINK_MESSAGE,
  isSafeTelemostJoinUrl,
  navigateTelemostCallWindow,
  reserveTelemostCallWindow,
} from "./telemostBackup";

describe("isSafeTelemostJoinUrl", () => {
  it("accepts public Telemost join links", () => {
    expect(isSafeTelemostJoinUrl("https://telemost.yandex.ru/j/abc123XYZ")).toBe(true);
    expect(isSafeTelemostJoinUrl("https://telemost.360.yandex.ru/j/abc123XYZ")).toBe(true);
  });

  it("rejects unsafe urls", () => {
    expect(isSafeTelemostJoinUrl("http://telemost.yandex.ru/j/abc")).toBe(false);
    expect(isSafeTelemostJoinUrl("https://evil.example/j/abc")).toBe(false);
    expect(isSafeTelemostJoinUrl("https://user:pass@telemost.yandex.ru/j/abc")).toBe(false);
    expect(isSafeTelemostJoinUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeTelemostJoinUrl("https://telemost.yandex.ru.evil.test/j/abc")).toBe(false);
  });
});

describe("Telemost call window", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reserves a sized popup and falls back to a tab", () => {
    const popup = { closed: false };
    const open = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(popup);
    vi.stubGlobal("open", open);
    expect(reserveTelemostCallWindow()).toBe(popup);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1][1]).toBe("_blank");
  });

  it("navigates only a validated Telemost url", () => {
    const popup = { location: { href: "about:blank" }, focus: vi.fn(), close: vi.fn(), closed: false };
    expect(navigateTelemostCallWindow(popup, "https://evil.example/j/abc")).toBe(false);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe("about:blank");
    expect(navigateTelemostCallWindow(popup, "https://telemost.yandex.ru/j/okRoom")).toBe(true);
    expect(popup.location.href).toBe("https://telemost.yandex.ru/j/okRoom");
  });
});
