import { describe, it, expect } from "vitest";
import { safeReturnPath } from "./accessGate";

describe("r93 safeReturnPath strips _itflux_v and nesting", () => {
  it("strips version", () => {
    expect(safeReturnPath("/cabinet/meetings/x/?_itflux_v=abc&a=1")).toBe("/cabinet/meetings/x/?a=1");
    expect(safeReturnPath("/cabinet/?_itflux_v=1")).toBe("/cabinet/");
  });
  it("unnests login next", () => {
    expect(safeReturnPath("/cabinet/login?next=%2Fcabinet%2Flogin%3Fnext%3D%252Fcabinet%252Fmeetings%252Fx%252F%253F_itflux_v%253D2&_itflux_v=3"))
      .toBe("/cabinet/meetings/x/");
  });
  it("keeps external rejection", () => {
    expect(safeReturnPath("//evil.com")).toBe("");
  });
});
