import { describe, expect, it } from "vitest";
import { clampBoardWidth, variantBoardRequest, VB_MIN } from "./VariantBoardSplit";

describe("VariantBoardSplit helpers", () => {
  it("clamps width", () => {
    expect(clampBoardWidth(100, 1400)).toBe(VB_MIN);
    expect(clampBoardWidth(5000, 1400)).toBe(1040);
    expect(clampBoardWidth(600, 1400)).toBe(600);
    expect(clampBoardWidth(null, 1000)).toBe(450);
  });
  it("builds request by priority", () => {
    expect(variantBoardRequest({ meetingUuid: "m", liveSessionId: "s", homeworkId: 3 })).toEqual({ meeting: "m" });
    expect(variantBoardRequest({ liveSessionId: "s", homeworkId: 3 })).toEqual({ live_session: "s" });
    expect(variantBoardRequest({ homeworkId: 3 })).toEqual({ homework_id: 3 });
    expect(variantBoardRequest({})).toBeNull();
  });
});
