import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsUrl } from "./analytics";

describe("sanitizeAnalyticsUrl", () => {
  it("redacts token query params", () => {
    const out = sanitizeAnalyticsUrl("https://itflux.ru/lesson/join/?token=secret.jwt.value&x=1");
    expect(out).toContain("token=%5Bredacted%5D");
    expect(out).not.toContain("secret.jwt");
    expect(out).toContain("x=1");
  });

  it("redacts invite path segments", () => {
    const out = sanitizeAnalyticsUrl("https://itflux.ru/invite/abcToken123/");
    expect(out).toContain("/invite/[redacted]/");
    expect(out).not.toContain("abcToken123");
  });
});
