import { beforeEach, describe, expect, it } from "vitest";
import { captureAcquisition, readAcquisition } from "./activationAnalytics";
import {
  captureColleagueCode,
  COLLEAGUE_COOKIE,
  COLLEAGUE_STORAGE_KEY,
  formatRuDays,
  loginHrefWithColleague,
  readColleagueCode,
} from "./colleagueInvite";

describe("colleague invite capture", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = `${COLLEAGUE_COOKIE}=;path=/;max-age=0`;
    document.cookie = "itflux_acq=;path=/;max-age=0";
  });

  it("stores the colleague code without touching the first UTM touch", () => {
    captureAcquisition({
      search: "?utm_source=vk&utm_campaign=potok&utm_content=post&colleague=ab12cd34",
      referrer: "https://vk.com/",
    });
    captureColleagueCode("ab12cd34");
    captureAcquisition({ search: "?utm_source=google&colleague=zzzzzzzz", referrer: "https://google.com/" });
    captureColleagueCode("zzzzzzzz");

    const stored = readAcquisition();
    expect(stored.utm_source).toBe("vk");
    expect(stored.utm_campaign).toBe("potok");
    expect(stored.ref).toBe("");
    expect(readColleagueCode()).toBe("zzzzzzzz");
    expect(sessionStorage.getItem(COLLEAGUE_STORAGE_KEY)).toBe("zzzzzzzz");
    expect(localStorage.getItem("cabinet_acquisition")).not.toContain("zzzzzzzz");
  });

  it("uses the admin day count with a Russian plural and keeps it on the registration link", () => {
    expect(formatRuDays(1)).toBe("1 день");
    expect(formatRuDays(3)).toBe("3 дня");
    expect(formatRuDays(7)).toBe("7 дней");
    expect(formatRuDays(21)).toBe("21 день");
    captureColleagueCode("ab12cd34");
    const params = new URLSearchParams(loginHrefWithColleague("/cabinet/login?role=teacher").split("?")[1]);
    expect(params.get("role")).toBe("teacher");
    expect(params.get("mode")).toBe("register");
    expect(params.get("colleague")).toBe("ab12cd34");
  });

  it("ignores a colleague code that is not a token", () => {
    expect(captureColleagueCode("нет пробела")).toBe("");
    expect(readColleagueCode()).toBe("");
  });
});
