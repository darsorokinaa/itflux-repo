import { describe, expect, it, afterEach, vi } from "vitest";
import { resolveJitsiFrameDomain } from "./jitsiMeet";

describe("resolveJitsiFrameDomain r92 cdn relay", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubHost = (host) => vi.stubGlobal("location", { ...window.location, host });
  it("cdn host always uses same-origin /jitsi", () => {
    vi.spyOn(window, "location", "get").mockReturnValue({ host: "cdn.itflux-academy.ru", origin: "https://cdn.itflux-academy.ru" });
    expect(resolveJitsiFrameDomain("lesson.itflux-academy.ru")).toBe("cdn.itflux-academy.ru/jitsi");
    vi.restoreAllMocks();
  });
  it("main host on desktop stays direct", () => {
    vi.spyOn(window, "location", "get").mockReturnValue({ host: "itflux-academy.ru", origin: "https://itflux-academy.ru" });
    expect(resolveJitsiFrameDomain("lesson.itflux-academy.ru")).toBe("lesson.itflux-academy.ru");
    vi.restoreAllMocks();
  });
  it("other jitsi domains untouched on cdn", () => {
    vi.spyOn(window, "location", "get").mockReturnValue({ host: "cdn.itflux-academy.ru", origin: "https://cdn.itflux-academy.ru" });
    expect(resolveJitsiFrameDomain("8x8.vc")).toBe("8x8.vc");
    vi.restoreAllMocks();
  });
});
