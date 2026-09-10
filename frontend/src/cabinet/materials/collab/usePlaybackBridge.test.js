import { describe, expect, it } from "vitest";
import { playbackSignature } from "./usePlaybackBridge";

describe("playbackSignature", () => {
  it("is stable for equivalent snapshots", () => {
    expect(playbackSignature({ index: 1, flipped: true }))
      .toBe(playbackSignature({ index: 1, flipped: true }));
  });

  it("changes when logical state changes", () => {
    expect(playbackSignature({ index: 1 })).not.toBe(playbackSignature({ index: 2 }));
  });
});
