import { describe, expect, it } from "vitest";
import {
  PRESENTATION_MODES,
  derivePresentationMode,
  flattenContentBucket,
  modeToSessionFields,
} from "./modes";

describe("presentation modes", () => {
  it("maps collaborative to collaboration", () => {
    expect(derivePresentationMode({ interactionMode: "collaborative", followPolicy: "strict" }))
      .toBe(PRESENTATION_MODES.COLLABORATION);
  });

  it("maps independent follow policy", () => {
    expect(derivePresentationMode({ interactionMode: "view_only", followPolicy: "independent" }))
      .toBe(PRESENTATION_MODES.INDEPENDENT);
  });

  it("defaults to presentation", () => {
    expect(derivePresentationMode({ interactionMode: "view_only", followPolicy: "strict" }))
      .toBe(PRESENTATION_MODES.PRESENTATION);
  });

  it("round-trips session fields", () => {
    expect(modeToSessionFields("collaboration")).toEqual({
      interactionMode: "collaborative",
      followPolicy: "strict",
    });
    expect(modeToSessionFields("independent")).toEqual({
      interactionMode: "view_only",
      followPolicy: "independent",
    });
  });

  it("flattens shared bucket in presentation", () => {
    const flat = flattenContentBucket({
      shared: { q1: { value: "15", author_id: 1 } },
      9: { q1: { value: "mine", author_id: 9 } },
    }, { currentUserId: 9, canManage: false, presentationMode: "presentation" });
    expect(flat.q1.value).toBe("15");
  });
});
