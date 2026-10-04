import { describe, expect, it } from "vitest";
import { resolveCabinetTimeout } from "./cabinetAuth";

describe("cabinet timeout policy", () => {
  it("separates reads, mutations, uploads and AI", () => {
    expect(resolveCabinetTimeout("/me/", { method: "GET" })).toBe(20000);
    expect(resolveCabinetTimeout("/students/", { method: "POST" })).toBe(45000);
    expect(resolveCabinetTimeout("/files/", { method: "POST", upload: true })).toBe(300000);
    expect(resolveCabinetTimeout("/ai/request/", { method: "POST" })).toBe(120000);
    expect(resolveCabinetTimeout("/ai/usage/", { method: "GET" })).toBe(20000);
    expect(resolveCabinetTimeout("/me/", { method: "GET", timeoutMs: 0 })).toBe(0);
  });
});