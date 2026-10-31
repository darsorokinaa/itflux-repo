import { describe, expect, it } from "vitest";
import { describeQuota, joinErrorText, liveSolveJoinUrl } from "./liveSolve";
import { variantLimitMessage } from "../utils/cabinetAuth";

describe("r125 live solve helpers", () => {
  it("builds join url", () => {
    expect(liveSolveJoinUrl({ id: "abc", joinPath: "/variant-live/abc" }, "https://x.ru")).toBe("https://x.ru/variant-live/abc");
    expect(liveSolveJoinUrl({ id: "abc" }, "")).toBe("/variant-live/abc");
    expect(liveSolveJoinUrl(null, "")).toBe("");
  });
  it("describes quota", () => {
    expect(describeQuota({ limit: null })).toBe("без ограничений");
    expect(describeQuota({ limit: 3, used: 1, remaining: 2 })).toBe("осталось 2 из 3");
    expect(describeQuota({ limit: 3, used: 3, remaining: 0 })).toBe("лимит исчерпан (3 из 3)");
    expect(describeQuota({ limit: 3, used: 3, remaining: 0, alreadyIssued: true })).toContain("уже выдан");
  });
  it("maps join errors", () => {
    expect(joinErrorText({ status: 410 })).toContain("закрыл");
    expect(joinErrorText({ status: 403, data: { detail: "Нет доступа" } })).toBe("Нет доступа");
  });
  it("detects variant limit errors", () => {
    expect(variantLimitMessage({ code: "x" })).toBeNull();
    const m = variantLimitMessage({ code: "VARIANT_PER_STUDENT_LIMIT", data: { detail: "Лимит", upgrade_url: "/cabinet/upgrade" } });
    expect(m).toEqual({ text: "Лимит", upgradeUrl: "/cabinet/upgrade" });
  });
});
