import { describe, expect, it } from "vitest";

import {
  SHARE_SURFACE_KIND,
  classifyShareSurfaceKind,
  selectDesktopStageSurface,
} from "./jitsiDesktopSurface";

function candidate(id, rect, extra = {}) {
  return {
    id,
    className: extra.className || "",
    rect,
    visible: extra.visible !== false,
    streamMatch: extra.streamMatch !== false,
    ancestorIds: extra.ancestorIds || [],
    ancestorClasses: extra.ancestorClasses || [],
  };
}

describe("desktop share surface selection", () => {
  it("selects the stage when a 120×120 thumbnail and a large stage share the desktop stream", () => {
    const result = selectDesktopStageSurface([
      candidate("localScreenshare_container", { left: 1308, top: 78, width: 120, height: 120 }, {
        ancestorIds: ["filmstrip", "localVideoTileViewContainer"],
      }),
      candidate("largeVideo", { left: 0, top: 0, width: 1000, height: 562 }, {
        ancestorIds: ["largeVideoContainer", "largeVideoWrapper"],
      }),
    ]);
    expect(result.stageSurfaceFound).toBe(true);
    expect(result.surface.id).toBe("largeVideo");
    expect(result.surfaceKind).toBe(SHARE_SURFACE_KIND.STAGE);
    expect(result.surface.rect).toEqual({ left: 0, top: 0, width: 1000, height: 562 });
  });

  it("does not allow exact when only a visible thumbnail exists and the stage is hidden", () => {
    const result = selectDesktopStageSurface([
      candidate("largeVideo", { left: 0, top: 0, width: 1000, height: 562 }, {
        visible: false,
        ancestorIds: ["largeVideoContainer"],
      }),
      candidate("localScreenshare_container", { left: 1308, top: 78, width: 120, height: 120 }, {
        ancestorIds: ["filmstrip"],
      }),
    ]);
    expect(result.stageSurfaceFound).toBe(false);
    expect(result.surface).toBeNull();
    expect(result.surfaceKind).toBe(SHARE_SURFACE_KIND.LOCAL_PREVIEW);
  });

  it("selects the desktop stage, not a larger camera largeVideo or a desktop thumbnail", () => {
    const result = selectDesktopStageSurface([
      candidate("largeVideo", { left: 0, top: 0, width: 1000, height: 700 }, {
        streamMatch: false,
        ancestorIds: ["largeVideoContainer"],
      }),
      candidate("localScreenshare_container", { left: 1308, top: 78, width: 120, height: 120 }, {
        ancestorIds: ["filmstrip"],
      }),
      candidate("remoteScreenshare", { left: 40, top: 80, width: 900, height: 506 }, {
        ancestorIds: ["largeVideoContainer", "dominantSpeaker"],
        className: "large-video-stream",
      }),
    ]);
    expect(result.stageSurfaceFound).toBe(true);
    expect(result.surface.id).toBe("remoteScreenshare");
    expect(result.surface.rect.width).toBe(900);
  });

  it("promotes an unlabeled large desktop surface over thumbnails", () => {
    const result = selectDesktopStageSurface([
      candidate("localScreenshare_container", { left: 1308, top: 78, width: 120, height: 120 }, {
        ancestorIds: ["filmstrip"],
      }),
      candidate("sharedVideo_123", { left: 8, top: 40, width: 980, height: 551 }, {
        ancestorIds: ["videoconference_page", "dominantSpeaker"],
      }),
    ]);
    expect(result.stageSurfaceFound).toBe(true);
    expect(result.surface.id).toBe("sharedVideo_123");
    expect(result.surfaceKind).toBe(SHARE_SURFACE_KIND.STAGE);
  });

  it("selects the stage among two desktop previews and one stage", () => {
    const result = selectDesktopStageSurface([
      candidate("filmstripShareA", { left: 1300, top: 80, width: 120, height: 68 }, {
        ancestorIds: ["filmstrip", "remoteVideos"],
      }),
      candidate("filmstripShareB", { left: 1300, top: 220, width: 120, height: 68 }, {
        ancestorIds: ["filmstrip"],
        className: "thumbnail",
      }),
      candidate("largeVideo", { left: 12, top: 24, width: 1100, height: 618 }, {
        ancestorIds: ["largeVideoWrapper"],
      }),
    ]);
    expect(result.stageSurfaceFound).toBe(true);
    expect(result.surface.id).toBe("largeVideo");
  });

  it("classifies the confirmed local screenshare thumbnail", () => {
    expect(classifyShareSurfaceKind(candidate("localScreenshare_container", {
      left: 0, top: 0, width: 120, height: 120,
    }))).toBe(SHARE_SURFACE_KIND.LOCAL_PREVIEW);
  });
});
