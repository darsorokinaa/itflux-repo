import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireLiveCallKeepAlive,
  installLiveMeetingLinkGuard,
  isSameMeetingPath,
  shouldOpenLinkInNewTab,
} from "./liveMeetingGuard";

const UUID = "d81b69db-5558-4279-8fbd-7bfe018437e5";
const base = {
  origin: "https://itflux-academy.ru",
  currentHref: `https://itflux-academy.ru/cabinet/meetings/${UUID}`,
  meetingUuid: UUID,
};

describe("isSameMeetingPath", () => {
  it("matches the meeting page with or without trailing slash", () => {
    expect(isSameMeetingPath(`/cabinet/meetings/${UUID}`, UUID)).toBe(true);
    expect(isSameMeetingPath(`/cabinet/meetings/${UUID}/`, UUID)).toBe(true);
    expect(isSameMeetingPath("/cabinet/meetings/other", UUID)).toBe(false);
    expect(isSameMeetingPath("/cabinet", UUID)).toBe(false);
  });
});

describe("shouldOpenLinkInNewTab", () => {
  it.each([
    "/ege/inf/variant/1707",
    "/oge/inf/variant/1828",
    "/cabinet/journal/lesson/1406",
    "/cabinet/schedule",
    "/cabinet",
    "https://itflux-academy.ru/cabinet/journal/lesson/1406?from=meeting",
  ])("opens %s in a new tab during a live call", (href) => {
    expect(shouldOpenLinkInNewTab({ ...base, href })).toBe(true);
  });

  it("keeps same-meeting, external, modified and explicit in-place links alone", () => {
    expect(shouldOpenLinkInNewTab({ ...base, href: `/cabinet/meetings/${UUID}?tab=chat` })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "https://example.com/x" })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "/cabinet", target: "_blank" })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "/cabinet", ctrlKey: true })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "/cabinet", button: 1 })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "/cabinet", allowInPlace: true })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "/cabinet", defaultPrevented: true })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "mailto:a@b.c" })).toBe(false);
    expect(shouldOpenLinkInNewTab({ ...base, href: "/cabinet", meetingUuid: "" })).toBe(false);
  });
});

describe("installLiveMeetingLinkGuard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("intercepts in-app links leaving the meeting and opens them in a new tab", () => {
    window.history.replaceState({}, "", `/cabinet/meetings/${UUID}`);
    const open = vi.spyOn(window, "open").mockReturnValue({});
    document.body.innerHTML = `
      <a id="variant" href="/ege/inf/variant/1707"><span id="inner">Вариант</span></a>
      <a id="self" href="/cabinet/meetings/${UUID}?x=1">Комната</a>
      <div data-meeting-nav="in-place"><a id="exit" href="/cabinet/schedule">Выйти</a></div>`;
    const remove = installLiveMeetingLinkGuard({ meetingUuid: UUID });
    const bubbled = vi.fn((e) => e.preventDefault());
    document.addEventListener("click", bubbled);

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    document.getElementById("inner").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/ege/inf/variant/1707`, "_blank", "noopener");
    expect(bubbled).not.toHaveBeenCalled();

    document.getElementById("self").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.getElementById("exit").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(bubbled).toHaveBeenCalledTimes(2);

    remove();
    document.getElementById("variant").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
    document.removeEventListener("click", bubbled);
  });
});

describe("acquireLiveCallKeepAlive", () => {
  it("holds a Web Lock until released", async () => {
    let held = null;
    const nav = {
      locks: {
        request: vi.fn((name, cb) => {
          held = cb();
          return held;
        }),
      },
    };
    const release = acquireLiveCallKeepAlive(UUID, nav);
    expect(nav.locks.request).toHaveBeenCalledTimes(1);
    expect(nav.locks.request.mock.calls[0][0]).toContain(UUID);
    let done = false;
    held.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    release();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("is a no-op without the Web Locks API", () => {
    expect(() => acquireLiveCallKeepAlive(UUID, {})()).not.toThrow();
    expect(() => acquireLiveCallKeepAlive("", null)()).not.toThrow();
  });
});
