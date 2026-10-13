import { describe, expect, it } from "vitest";

import {
  closeReservedTab,
  isKonturMeetingUrl,
  navigateReservedTab,
  reserveMeetingTab,
} from "./konturTalk";

describe("kontur talk window", () => {
  it("accepts only an https room on a ktalk host", () => {
    expect(isKonturMeetingUrl("https://itflux.ktalk.ru/itflux-abc")).toBe(true);
    expect(isKonturMeetingUrl("http://itflux.ktalk.ru/room")).toBe(false);
    expect(isKonturMeetingUrl("https://evil.example/itflux.ktalk.ru")).toBe(false);
    expect(isKonturMeetingUrl("https://user:secret@itflux.ktalk.ru/room")).toBe(false);
    expect(isKonturMeetingUrl("javascript:alert(1)")).toBe(false);
  });

  it("reports a blocked popup without a tab", () => {
    expect(reserveMeetingTab(() => null)).toBeNull();
  });

  it("navigates a reserved tab and can close it", () => {
    const popup = { location: { href: "about:blank" }, opener: {}, close() { this.closed = true; } };
    const reserved = reserveMeetingTab(() => popup);
    expect(reserved.opener).toBeNull();
    expect(navigateReservedTab(reserved, "https://itflux.ktalk.ru/itflux-abc")).toBe(true);
    expect(popup.location.href).toBe("https://itflux.ktalk.ru/itflux-abc");
    expect(navigateReservedTab(reserved, "https://evil.example/room")).toBe(false);
    closeReservedTab(reserved);
    expect(popup.closed).toBe(true);
  });
});
