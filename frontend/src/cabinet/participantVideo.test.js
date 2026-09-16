/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

import {
  PARTICIPANT_VIDEO_MODES,
  bindTrackToPresentationStream,
  deriveParticipantVideoMode,
  findRemoteCameraVideo,
  participantInitials,
  selectRemoteParticipant,
  trackLooksDesktop,
} from "./participantVideo";

function videoEl({
  id = "",
  className = "",
  parentId = "",
  parentClass = "",
  tracks = [],
  readyState = 2,
  ended = false,
  videoWidth = 640,
  videoHeight = 360,
} = {}) {
  const parent = {
    id: parentId,
    className: parentClass,
    nodeType: 1,
    parentElement: null,
  };
  return {
    id,
    className,
    nodeType: 1,
    parentElement: parent,
    ended,
    readyState,
    videoWidth,
    videoHeight,
    srcObject: {
      getTracks: () => tracks,
      getVideoTracks: () => tracks,
    },
  };
}

describe("participantVideo selection", () => {
  it("never selects the local teacher", () => {
    const picked = selectRemoteParticipant({
      localId: "teacher",
      pinnedId: "teacher",
      activeSpeakerId: "teacher",
      remotes: [
        { id: "teacher", displayName: "Учитель", local: true },
        { id: "student", displayName: "Дарья", videoMuted: false },
      ],
    });
    expect(picked.id).toBe("student");
  });

  it("prefers pinned, then active student, then speaker, then camera-on", () => {
    const remotes = [
      { id: "a", displayName: "A", videoMuted: true },
      { id: "b", displayName: "B", videoMuted: false },
      { id: "c", displayName: "C", videoMuted: false },
    ];
    expect(selectRemoteParticipant({ remotes, pinnedId: "c" }).id).toBe("c");
    expect(selectRemoteParticipant({ remotes, activeStudentId: "b" }).id).toBe("b");
    expect(selectRemoteParticipant({ remotes, activeSpeakerId: "a" }).id).toBe("a");
    expect(selectRemoteParticipant({ remotes }).id).toBe("b");
  });

  it("returns null when the room has no remote participant", () => {
    expect(selectRemoteParticipant({ remotes: [], localId: "me" })).toBeNull();
  });

  it("builds initials for the floating label", () => {
    expect(participantInitials("Дарья Сорокина")).toBe("ДС");
    expect(participantInitials("Иван")).toBe("ИВ");
    expect(participantInitials("")).toBe("?");
  });

  it("keeps participant video mode separate from call status", () => {
    expect(deriveParticipantVideoMode({})).toBe(PARTICIPANT_VIDEO_MODES.INLINE);
    expect(deriveParticipantVideoMode({ compactCall: true })).toBe(PARTICIPANT_VIDEO_MODES.FLOATING);
    expect(deriveParticipantVideoMode({ compactCall: true, pipActive: true })).toBe(PARTICIPANT_VIDEO_MODES.PIP);
  });
});

describe("remote camera video lookup", () => {
  it("skips local and screen-share videos", () => {
    const local = videoEl({
      id: "localVideo",
      parentId: "localVideoWrapper",
      tracks: [{ readyState: "live", label: "FaceTime", getSettings: () => ({}) }],
    });
    const desktop = videoEl({
      id: "largeVideo",
      parentId: "localScreenshare_container",
      videoWidth: 1920,
      videoHeight: 1080,
      tracks: [{
        readyState: "live",
        label: "screen: window",
        contentHint: "detail",
        getSettings: () => ({ displaySurface: "monitor" }),
      }],
    });
    const remote = videoEl({
      id: "remoteVideo_student",
      parentId: "participant_student",
      parentClass: "remote-video",
      tracks: [{ readyState: "live", label: "camera", getSettings: () => ({ facingMode: "user" }) }],
    });
    const iframe = {
      contentDocument: {
        querySelectorAll: () => [desktop, local, remote],
      },
    };
    expect(findRemoteCameraVideo(iframe, { localId: "teacher", participantId: "student" })).toBe(remote);
  });

  it("returns null for a cross-origin iframe", () => {
    const iframe = {
      get contentDocument() {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    expect(findRemoteCameraVideo(iframe)).toBeNull();
  });

  it("treats displaySurface tracks as desktop", () => {
    expect(trackLooksDesktop({
      getSettings: () => ({ displaySurface: "browser" }),
    })).toBe(true);
    expect(trackLooksDesktop({
      getSettings: () => ({}),
      label: "FaceTime HD",
    })).toBe(false);
  });
});

describe("presentation stream", () => {
  it("swaps tracks without stopping the original remote track", () => {
    const stop = vi.fn();
    const first = { id: "a", readyState: "live", stop };
    const second = { id: "b", readyState: "live", stop };
    const stream = {
      tracks: [first],
      getVideoTracks() {
        return this.tracks;
      },
      removeTrack(track) {
        this.tracks = this.tracks.filter((item) => item !== track);
      },
      addTrack(track) {
        this.tracks.push(track);
      },
    };
    bindTrackToPresentationStream(stream, second);
    expect(stream.tracks).toEqual([second]);
    expect(stop).not.toHaveBeenCalled();
  });
});
