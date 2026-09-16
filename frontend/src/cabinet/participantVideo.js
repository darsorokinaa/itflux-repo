/**
 * Presentation helpers for the remote participant video.
 * Does not create a conference, participant, or WebRTC connection.
 */

export const PARTICIPANT_VIDEO_MODES = Object.freeze({
  INLINE: "inline",
  FLOATING: "floating",
  PIP: "pip",
});

const LOCAL_VIDEO_RE = /localvideo|local-video|local_video|localpreview|local-preview|localscreenshare|local-screenshare|local_screenshare|localvideocontainer/;
const DESKTOP_VIDEO_RE = /localscreenshare|desktopstream|desktop-share|screenshare|screen-share|screen_share|sharevideo/;
const REMOTE_HINT_RE = /remotevideo|remote-video|remote_video|participant_|filmstrip|largevideo|large-video/;

function safeStr(value) {
  return String(value || "").trim();
}

export function participantInitials(name) {
  const parts = safeStr(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function selectRemoteParticipant({
  remotes = [],
  localId = "",
  pinnedId = "",
  activeStudentId = "",
  activeSpeakerId = "",
} = {}) {
  const local = safeStr(localId);
  const list = (Array.isArray(remotes) ? remotes : []).filter((item) => {
    const id = safeStr(item?.id);
    if (!id) return false;
    if (item.local) return false;
    if (local && id === local) return false;
    return true;
  });
  if (!list.length) return null;
  const byId = (id) => {
    const key = safeStr(id);
    if (!key || (local && key === local)) return null;
    return list.find((item) => item.id === key) || null;
  };
  return (
    byId(pinnedId)
    || byId(activeStudentId)
    || byId(activeSpeakerId)
    || list.find((item) => item.videoMuted !== true)
    || list[0]
  );
}

export function describeVideoElement(video) {
  const ids = [];
  const classes = [];
  let node = video;
  let hops = 0;
  while (node && node.nodeType === 1 && hops < 16) {
    if (node.id) ids.push(String(node.id));
    if (typeof node.className === "string" && node.className) classes.push(node.className);
    node = node.parentElement;
    hops += 1;
  }
  return {
    id: video?.id ? String(video.id) : "",
    className: typeof video?.className === "string" ? video.className : "",
    ancestorIds: ids,
    ancestorClasses: classes,
    blob: [...ids, ...classes].join(" ").toLowerCase(),
  };
}

export function trackLooksDesktop(track) {
  if (!track) return false;
  try {
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    const surface = safeStr(settings?.displaySurface).toLowerCase();
    if (surface && surface !== "camera") return true;
  } catch {
    /* ignore */
  }
  const hint = safeStr(track.contentHint).toLowerCase();
  if (hint === "detail" || hint === "text") return true;
  const label = safeStr(track.label).toLowerCase();
  return /screen|display|window|monitor|desktop|tab capture/.test(label);
}

export function videoLooksLocal(meta) {
  return LOCAL_VIDEO_RE.test(meta?.blob || "");
}

export function videoLooksDesktop(meta, video) {
  const blob = meta?.blob || "";
  if (DESKTOP_VIDEO_RE.test(blob) && !/remote/.test(blob)) return true;
  const tracks = video?.srcObject?.getVideoTracks?.() || [];
  return tracks.some(trackLooksDesktop);
}

function videoMatchesParticipant(meta, participantId) {
  const id = safeStr(participantId).toLowerCase();
  if (!id) return false;
  return (meta?.blob || "").includes(id) || safeStr(meta?.id).toLowerCase().includes(id);
}

export function readIframeDocument(iframe) {
  if (!iframe) return null;
  try {
    return iframe.contentDocument || iframe.contentWindow?.document || null;
  } catch {
    return null;
  }
}

export function findRemoteCameraVideos(iframe, { localId = "", participantId = "" } = {}) {
  const doc = readIframeDocument(iframe);
  if (!doc) return [];
  let videos = [];
  try {
    videos = [...doc.querySelectorAll("video")];
  } catch {
    return [];
  }
  const scored = [];
  for (const video of videos) {
    if (!video || video.ended) continue;
    const meta = describeVideoElement(video);
    if (videoLooksLocal(meta)) continue;
    if (videoLooksDesktop(meta, video)) continue;
    const stream = video.srcObject;
    const tracks = typeof stream?.getVideoTracks === "function" ? stream.getVideoTracks() : [];
    const hasStream = Boolean(stream && typeof stream.getTracks === "function" && stream.getTracks().length);
    if (!hasStream && Number(video.readyState) < 2) continue;
    const liveCamera = tracks.some((track) => (
      track?.readyState === "live" && !trackLooksDesktop(track)
    ));
    let score = 0;
    if (participantId && videoMatchesParticipant(meta, participantId)) score += 100;
    if (liveCamera) score += 40;
    if (/largevideo|large-video/.test(meta.blob)) score += 25;
    if (REMOTE_HINT_RE.test(meta.blob)) score += 10;
    if (localId && videoMatchesParticipant(meta, localId)) score -= 80;
    scored.push({ video, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.video);
}

export function findRemoteCameraVideo(iframe, options = {}) {
  return findRemoteCameraVideos(iframe, options)[0] || null;
}

export function getLiveVideoTrack(video) {
  const tracks = video?.srcObject?.getVideoTracks?.() || [];
  return tracks.find((track) => track?.readyState === "live" && !trackLooksDesktop(track))
    || tracks.find((track) => !trackLooksDesktop(track))
    || null;
}

/**
 * Put an existing MediaStreamTrack onto a presentation MediaStream.
 * Never stops the original Jitsi track.
 */
export function bindTrackToPresentationStream(stream, track) {
  if (!stream || typeof stream.getVideoTracks !== "function") return stream;
  const current = stream.getVideoTracks();
  for (const item of current) {
    if (item !== track) {
      try {
        stream.removeTrack(item);
      } catch {
        /* ignore */
      }
    }
  }
  if (track && !current.includes(track)) {
    try {
      stream.addTrack(track);
    } catch {
      /* ignore */
    }
  }
  return stream;
}

export function deriveParticipantVideoMode({
  compactCall = false,
  pipActive = false,
} = {}) {
  if (pipActive) return PARTICIPANT_VIDEO_MODES.PIP;
  if (compactCall) return PARTICIPANT_VIDEO_MODES.FLOATING;
  return PARTICIPANT_VIDEO_MODES.INLINE;
}
