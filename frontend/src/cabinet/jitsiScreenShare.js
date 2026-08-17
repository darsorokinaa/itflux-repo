/** Детектор screen share через реальный Jitsi IFrame API (без доступа к DOM iframe). */

function safeStr(value) {
  return String(value || "").trim();
}

function canListen(api, eventName) {
  let list;
  try {
    list = api?.getSupportedEvents?.();
  } catch {
    list = null;
  }
  if (!Array.isArray(list) || !list.length) return true;
  return list.includes(eventName);
}

function listen(api, eventName, handler, bucket) {
  if (!api || typeof api.addListener !== "function") return;
  if (!canListen(api, eventName)) return;
  try {
    api.addListener(eventName, handler);
    bucket.push([eventName, handler]);
  } catch {
    /* event may be missing in this Jitsi build */
  }
}

export function parseSharingParticipantIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(safeStr).filter(Boolean);
  if (Array.isArray(raw.sharingParticipantIds)) {
    return raw.sharingParticipantIds.map(safeStr).filter(Boolean);
  }
  if (Array.isArray(raw.data)) return raw.data.map(safeStr).filter(Boolean);
  if (Array.isArray(raw.ids)) return raw.ids.map(safeStr).filter(Boolean);
  return [];
}

export function extractTrackResolution(stats, participantId) {
  const resolution = stats?.resolution;
  if (!resolution || typeof resolution !== "object") return null;

  const pickLargest = (node, best = null) => {
    if (!node || typeof node !== "object") return best;
    const w = Number(node.width || node.w);
    const h = Number(node.height || node.h);
    let next = best;
    if (w > 0 && h > 0) {
      const area = w * h;
      if (!next || area > next.width * next.height) next = { width: w, height: h };
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") next = pickLargest(value, next);
    }
    return next;
  };

  const pid = safeStr(participantId);
  if (pid && resolution[pid]) {
    const sized = pickLargest(resolution[pid]);
    if (sized) return sized;
  }
  return pickLargest(resolution);
}

export function buildScreenShareSnapshot({
  localId = "",
  localSharing = false,
  sharingIds = [],
  contentWidth = null,
  contentHeight = null,
  largeVideoId = "",
  tileView = false,
} = {}) {
  const ids = [...new Set((sharingIds || []).map(safeStr).filter(Boolean))];
  const presenterJitsiId = ids[0] || (localSharing ? safeStr(localId) : "");
  return {
    active: Boolean(localSharing || ids.length),
    localSharing: Boolean(localSharing),
    sharingIds: ids,
    presenterJitsiId,
    localId: safeStr(localId),
    contentWidth: contentWidth ? Number(contentWidth) : null,
    contentHeight: contentHeight ? Number(contentHeight) : null,
    largeVideoId: safeStr(largeVideoId),
    tileView: Boolean(tileView),
  };
}

/**
 * Подписка на screenSharingStatusChanged / contentSharingParticipantsChanged
 * и опрос getContentSharingParticipants / isSharingScreen / getConnectionStats.
 */
export function attachScreenSharePresence(api, { onChange, pollMs = 2500 } = {}) {
  const listeners = [];
  let disposed = false;
  let localId = "";
  let localSharing = false;
  let sharingIds = [];
  let contentWidth = null;
  let contentHeight = null;
  let largeVideoId = "";
  let tileView = false;
  let pollTimer = null;

  const emit = (reason = "update") => {
    if (disposed) return;
    const snap = buildScreenShareSnapshot({
      localId,
      localSharing,
      sharingIds,
      contentWidth,
      contentHeight,
      largeVideoId,
      tileView,
    });
    onChange?.(snap, reason);
    return snap;
  };

  const refreshSharingIds = async () => {
    if (!api || typeof api.getContentSharingParticipants !== "function") return;
    try {
      const raw = await api.getContentSharingParticipants();
      const ids = parseSharingParticipantIds(raw);
      if (ids.length || sharingIds.length) sharingIds = ids;
    } catch {
      /* method may be missing */
    }
  };

  const refreshLocalSharing = async () => {
    if (!api || typeof api.isSharingScreen !== "function") return;
    try {
      const on = await api.isSharingScreen();
      if (typeof on === "boolean") localSharing = on;
    } catch {
      /* ignore */
    }
  };

  const refreshResolution = async () => {
    if (!api || typeof api.getConnectionStats !== "function") return;
    try {
      const stats = await api.getConnectionStats();
      const sized = extractTrackResolution(stats, sharingIds[0] || localId);
      if (sized) {
        contentWidth = sized.width;
        contentHeight = sized.height;
      }
    } catch {
      /* ignore */
    }
  };

  const refresh = async (reason = "poll") => {
    if (disposed) return;
    await Promise.all([refreshSharingIds(), refreshLocalSharing(), refreshResolution()]);
    return emit(reason);
  };

  listen(api, "videoConferenceJoined", (event) => {
    localId = safeStr(event?.id);
    void refresh("joined");
  }, listeners);

  listen(api, "screenSharingStatusChanged", (event) => {
    localSharing = Boolean(event?.on);
    void refresh("screenSharingStatusChanged");
  }, listeners);

  listen(api, "contentSharingParticipantsChanged", (event) => {
    sharingIds = parseSharingParticipantIds(event);
    void refresh("contentSharingParticipantsChanged");
  }, listeners);

  listen(api, "largeVideoChanged", (event) => {
    largeVideoId = safeStr(event?.id);
    emit("largeVideoChanged");
  }, listeners);

  listen(api, "tileViewChanged", (event) => {
    tileView = Boolean(event?.enabled);
    emit("tileViewChanged");
  }, listeners);

  const startPoll = () => {
    if (pollTimer != null) return;
    pollTimer = window.setInterval(() => {
      void refresh("interval");
    }, pollMs);
  };

  startPoll();
  void refresh("init");

  return {
    refresh,
    snapshot: () => buildScreenShareSnapshot({
      localId,
      localSharing,
      sharingIds,
      contentWidth,
      contentHeight,
      largeVideoId,
      tileView,
    }),
    pinDesktop(participantId) {
      const id = safeStr(participantId);
      if (!id || !api || typeof api.pinParticipant !== "function") return;
      try {
        api.pinParticipant(id, "desktop");
      } catch {
        try {
          api.pinParticipant(id);
        } catch {
          /* ignore */
        }
      }
    },
    dispose() {
      disposed = true;
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      for (const [eventName, handler] of listeners) {
        try {
          api.removeListener?.(eventName, handler);
        } catch {
          /* ignore */
        }
      }
      listeners.length = 0;
    },
  };
}
