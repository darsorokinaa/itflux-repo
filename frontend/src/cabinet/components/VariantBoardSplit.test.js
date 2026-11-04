import { describe, expect, it } from "vitest";
import { clampBoardWidth, variantBoardFrameSrc, variantBoardRequest, VB_MIN } from "./VariantBoardSplit";
import { isVariantEmbed } from "../boards/variantEmbed";

describe("VariantBoardSplit helpers", () => {
  it("clamps width", () => {
    expect(clampBoardWidth(100, 1400)).toBe(VB_MIN);
    expect(clampBoardWidth(5000, 1400)).toBe(1040);
    expect(clampBoardWidth(600, 1400)).toBe(600);
    expect(clampBoardWidth(null, 1000)).toBe(450);
  });
  it("builds request by priority, never with a board id", () => {
    expect(variantBoardRequest({ meetingUuid: "m", liveSessionId: "s", homeworkId: 3 })).toEqual({ meeting: "m" });
    expect(variantBoardRequest({ liveSessionId: "s", homeworkId: 3 })).toEqual({ live_session: "s" });
    expect(variantBoardRequest({ homeworkId: 3 })).toEqual({ homework_id: 3 });
    expect(variantBoardRequest({})).toBeNull();
  });
  it("embeds board in variant mode", () => {
    expect(variantBoardFrameSrc("a b")).toBe("/cabinet/boards/a%20b?embed=variant");
    expect(isVariantEmbed("?embed=variant")).toBe(true);
    expect(isVariantEmbed("?embed=other")).toBe(false);
    expect(isVariantEmbed("")).toBe(false);
  });
});

import { variantBoardPickBody } from "./VariantBoardSplit";
describe("r148 pick body", () => {
  it("only group/mine/student_id, never a board id", () => {
    expect(variantBoardPickBody({ meeting: "m" }, "group")).toEqual({ meeting: "m", target: "group" });
    expect(variantBoardPickBody({ meeting: "m" }, "mine")).toEqual({ meeting: "m", target: "mine" });
    expect(variantBoardPickBody({ meeting: "m" }, 5)).toEqual({ meeting: "m", student_id: 5 });
    expect(variantBoardPickBody({ meeting: "m" }, null)).toEqual({ meeting: "m" });
  });
});
