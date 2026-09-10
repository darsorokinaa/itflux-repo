import { describe, expect, it } from "vitest";
import { formatBoardPerfOverlayText } from "./boardPerfDev";

describe("boardPerfDev overlay", () => {
  it("lists the required DEV metrics and not a production banner", () => {
    const text = formatBoardPerfOverlayText({
      inputEvents: 120,
      collectedPoints: 400,
      frames: 60,
      packets: 8,
      packetPoints: 160,
      longTasks: 1,
      avgPts: "20.0",
    });
    expect(text).toContain("input/s 120");
    expect(text).toContain("points/s 400");
    expect(text).toContain("frames/s 60");
    expect(text).toContain("ws/s 8");
    expect(text).toContain("pts/pkt 20.0");
    expect(text).toContain("long>50ms 1");
  });
});
