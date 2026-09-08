import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GEOMETRY_STATUS } from "./jitsiGeometry";
import {
  hasDesktopTrackMismatch,
  isDesktopVideoType,
  isExactShareGeometryPayload,
  isJitsiDesktopTrack,
  listJitsiDesktopTracks,
  reduceShareGeometryMessage,
  selectJitsiDesktopTrack,
} from "./jitsiDesktopTrack";

function cameraTrack(participantId, extra = {}) {
  return {
    videoType: "camera",
    mediaType: "video",
    muted: false,
    participantId,
    ...extra,
  };
}

function desktopTrack(participantId, extra = {}) {
  return {
    videoType: "desktop",
    mediaType: "video",
    muted: false,
    participantId,
    ...extra,
  };
}

function stateWith(tracks) {
  return { "features/base/tracks": tracks };
}

const exactPayload = {
  present: true,
  isDesktopTrack: true,
  desktopTrackDetected: true,
  stageSurfaceFound: true,
  surfaceKind: "stage",
  participantId: "sharer-a",
  shareSessionId: "sess-a",
  epoch: 2,
  videoWidth: 1920,
  videoHeight: 1080,
  contentRect: { left: 10, top: 20, width: 800, height: 450 },
};

const sessionA = {
  shareSessionId: "sess-a",
  presenterJitsiId: "sharer-a",
  epoch: 2,
};

describe("Jitsi desktop track detection", () => {
  it("does not treat camera or empty videoType as desktop", () => {
    expect(isDesktopVideoType("camera")).toBe(false);
    expect(isDesktopVideoType("")).toBe(false);
    expect(isJitsiDesktopTrack(cameraTrack("local"))).toBe(false);
    expect(isJitsiDesktopTrack({ videoType: "desktop", mediaType: "audio", participantId: "a" })).toBe(false);
    expect(isJitsiDesktopTrack({
      videoType: "desktop",
      mediaType: "screenshare",
      muted: false,
      participantId: "sharer-a",
    })).toBe(true);
    expect(isJitsiDesktopTrack({ videoType: "desktop", muted: true, participantId: "a" })).toBe(false);
    expect(isJitsiDesktopTrack({
      videoType: "desktop",
      mediaType: "screenshare",
      muted: false,
      participantId: "a",
      jitsiTrack: { getVideoType: () => "desktop", isEnded: () => true },
    })).toBe(false);
  });

  it("finds an unmuted desktop track and ignores camera / large-video speaker", () => {
    const state = stateWith([
      cameraTrack("speaker-b"),
      desktopTrack("sharer-a"),
      cameraTrack("local"),
    ]);
    expect(listJitsiDesktopTracks(state)).toHaveLength(1);
    expect(selectJitsiDesktopTrack(state).participantId).toBe("sharer-a");
  });

  it("camera-only redux state yields no desktop track even with large-video id", () => {
    const state = {
      "features/base/tracks": [cameraTrack("local"), cameraTrack("speaker-b")],
      "features/large-video": { participantId: "speaker-b" },
    };
    expect(selectJitsiDesktopTrack(state, "local")).toBeNull();
    expect(selectJitsiDesktopTrack(state)).toBeNull();
  });

  it("reads videoType from jitsiTrack.getVideoType()", () => {
    const state = stateWith([{
      mediaType: "video",
      muted: false,
      participantId: "sharer-a",
      jitsiTrack: { getVideoType: () => "desktop" },
    }]);
    expect(selectJitsiDesktopTrack(state, "sharer-a")?.participantId).toBe("sharer-a");
  });

  it("fails closed when the desktop owner is not the requested presenter", () => {
    const state = stateWith([desktopTrack("sharer-b")]);
    expect(selectJitsiDesktopTrack(state, "sharer-a")).toBeNull();
    expect(hasDesktopTrackMismatch(state, "sharer-a")).toBe(true);
    expect(hasDesktopTrackMismatch(state, "sharer-b")).toBe(false);
  });
});

describe("exact share geometry predicate", () => {
  it("camera only is never exact", () => {
    expect(isExactShareGeometryPayload({
      present: false,
      isDesktopTrack: false,
      desktopTrackDetected: false,
      videoWidth: 0,
      videoHeight: 0,
      contentRect: null,
    }, sessionA)).toBe(false);
  });

  it("camera metadata 1920×1080 is never exact", () => {
    expect(isExactShareGeometryPayload({
      present: true,
      isDesktopTrack: false,
      participantId: "sharer-a",
      shareSessionId: "sess-a",
      epoch: 2,
      videoWidth: 1920,
      videoHeight: 1080,
      contentRect: { left: 0, top: 0, width: 1280, height: 720 },
    }, sessionA)).toBe(false);
  });

  it("active-speaker camera occupying largeVideo is never exact", () => {
    expect(isExactShareGeometryPayload({
      present: true,
      isDesktopTrack: false,
      desktopTrackDetected: false,
      participantId: "speaker-b",
      shareSessionId: "sess-a",
      epoch: 2,
      videoWidth: 1280,
      videoHeight: 720,
      objectFit: "cover",
      contentRect: { left: 0, top: 0, width: 900, height: 700 },
    }, sessionA)).toBe(false);
  });

  it("desktop share with valid dimensions is exact", () => {
    expect(isExactShareGeometryPayload(exactPayload, sessionA)).toBe(true);
    expect(isExactShareGeometryPayload({
      ...exactPayload,
      desktopTrackDetected: true,
      isDesktopTrack: undefined,
    }, sessionA)).toBe(true);
  });

  it("thumbnail-only desktop geometry is never exact", () => {
    expect(isExactShareGeometryPayload({
      ...exactPayload,
      stageSurfaceFound: false,
      surfaceKind: "local-preview",
      contentRect: { left: 1308, top: 104, width: 120, height: 67.5 },
    }, sessionA)).toBe(false);
  });

  it("desktop dimensions 0×0 stay waiting", () => {
    expect(isExactShareGeometryPayload({
      ...exactPayload,
      videoWidth: 0,
      videoHeight: 0,
    }, sessionA)).toBe(false);
  });

  it("wrong participantId / epoch / shareSessionId are ignored", () => {
    expect(isExactShareGeometryPayload(exactPayload, { ...sessionA, presenterJitsiId: "sharer-b" })).toBe(false);
    expect(isExactShareGeometryPayload(exactPayload, { ...sessionA, epoch: 9 })).toBe(false);
    expect(isExactShareGeometryPayload(exactPayload, { ...sessionA, shareSessionId: "sess-b" })).toBe(false);
  });
});

describe("share geometry status reducer", () => {
  it("revokes exact immediately when desktop stops even if camera fills the tile", () => {
    const exact = reduceShareGeometryMessage(
      { status: GEOMETRY_STATUS.WAITING, payload: null },
      exactPayload,
      sessionA,
    );
    expect(exact.status).toBe(GEOMETRY_STATUS.EXACT);
    const stopped = reduceShareGeometryMessage(exact, {
      present: false,
      isDesktopTrack: false,
      desktopTrackDetected: false,
      participantId: "sharer-a",
      shareSessionId: "sess-a",
      epoch: 2,
      videoWidth: 1280,
      videoHeight: 720,
      contentRect: { left: 0, top: 0, width: 900, height: 700 },
    }, sessionA);
    expect(stopped.status).toBe(GEOMETRY_STATUS.WAITING);
    expect(stopped.payload).toBeNull();
  });

  it("ignores stale A geometry after B start", () => {
    const sessionB = { shareSessionId: "sess-b", presenterJitsiId: "sharer-b", epoch: 3 };
    const current = reduceShareGeometryMessage(
      { status: GEOMETRY_STATUS.WAITING, payload: null },
      { ...exactPayload, participantId: "sharer-b", shareSessionId: "sess-b", epoch: 3 },
      sessionB,
    );
    expect(current.status).toBe(GEOMETRY_STATUS.EXACT);
    const staleA = reduceShareGeometryMessage(current, exactPayload, sessionB);
    expect(staleA.status).toBe(GEOMETRY_STATUS.EXACT);
    expect(staleA.payload.participantId).toBe("sharer-b");
  });

  it("desktop A → camera → desktop B does not keep A's exact", () => {
    const afterA = reduceShareGeometryMessage(
      { status: GEOMETRY_STATUS.WAITING, payload: null },
      exactPayload,
      sessionA,
    );
    const afterCamera = reduceShareGeometryMessage(afterA, {
      present: false,
      isDesktopTrack: false,
      participantId: "sharer-a",
      shareSessionId: "sess-a",
      epoch: 2,
    }, sessionA);
    expect(afterCamera.status).toBe(GEOMETRY_STATUS.WAITING);
    const sessionB = { shareSessionId: "sess-b", presenterJitsiId: "sharer-b", epoch: 3 };
    const lateA = reduceShareGeometryMessage(afterCamera, exactPayload, sessionB);
    expect(lateA.status).toBe(GEOMETRY_STATUS.WAITING);
    const afterB = reduceShareGeometryMessage(lateA, {
      ...exactPayload,
      participantId: "sharer-b",
      shareSessionId: "sess-b",
      epoch: 3,
    }, sessionB);
    expect(afterB.status).toBe(GEOMETRY_STATUS.EXACT);
    expect(afterB.payload.participantId).toBe("sharer-b");
  });
});

describe("Jitsi helper source (desktop-only)", () => {
  const helper = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../deploy/jitsi/itflux-screenshare-geometry.js"),
    "utf8",
  );

  it("does not treat #largeVideo as a share without a desktop track", () => {
    expect(helper).toContain("isDesktopTrackRecord");
    expect(helper).toContain("owner-mismatch");
    expect(helper).toContain("desktop-stage-not-found");
    expect(helper).toContain("selectDesktopStageSurface");
    expect(helper).toContain("localScreenshare_container");
    expect(helper).not.toMatch(/if \(el\.srcObject === stream\) return el/);
  });
});
