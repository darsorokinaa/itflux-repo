import { describe, it, expect, vi, afterEach } from "vitest";
import { checkBankTaskAnswer } from "./TaskAnswerCheck";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));
}

describe("checkBankTaskAnswer (r130)", () => {
  it("correct", async () => {
    mockFetch(200, { ok: true, correct: true });
    expect(await checkBankTaskAnswer(1, "5")).toBe("correct");
  });
  it("wrong", async () => {
    mockFetch(200, { ok: true, correct: false });
    expect(await checkBankTaskAnswer(1, "4")).toBe("wrong");
  });
  it("rate limit", async () => {
    mockFetch(429, {});
    expect(await checkBankTaskAnswer(1, "4")).toBe("limit");
  });
  it("no answer in bank → error", async () => {
    mockFetch(200, { ok: true, correct: null, no_answer: true });
    expect(await checkBankTaskAnswer(1, "4")).toBe("error");
  });
});
