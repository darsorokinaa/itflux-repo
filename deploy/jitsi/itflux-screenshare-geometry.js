/**
 * Runs INSIDE the Jitsi Meet page (cross-origin iframe).
 * Measures the real desktop/screen-share STAGE video rect.
 * Camera / #largeVideo / filmstrip thumbnails are never treated as a share.
 * No guessed filmstrip/toolbar offsets.
 *
 * Installed by: sudo bash deploy/jitsi/install-screenshare-geometry-bridge.sh
 */
(function itfluxScreenshareGeometryBridge() {
  if (window.__ITFLUX_SS_GEOM__) return;
  window.__ITFLUX_SS_GEOM__ = true;

  var TYPE = "itflux:screenshare-geometry";
  var REQUEST = "itflux:screenshare-geometry-request";
  var SOURCE = "itflux-jitsi";
  var MIN_POST_MS = 50;
  var DESKTOP_TYPES = {
    desktop: true,
    screen: true,
    window: true,
    screenshare: true,
    "screen-share": true,
  };

  var shareSessionId = "";
  var presenterJitsiId = "";
  var epoch = 0;
  var raf = 0;
  var lastKey = "";
  var lastPost = 0;
  var lastCandidateDump = "";
  var observedVideos = new WeakSet();
  var storeUnsub = null;

  function parentTargetOrigin() {
    try {
      if (document.referrer) return new URL(document.referrer).origin;
    } catch (err) { /* ignore */ }
    return "*";
  }

  function asRect(r) {
    return {
      left: Number(r.left) || 0,
      top: Number(r.top) || 0,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
    };
  }

  function fittedContent(stage, videoWidth, videoHeight, objectFit) {
    var left = Number(stage.left) || 0;
    var top = Number(stage.top) || 0;
    var width = Number(stage.width) || 0;
    var height = Number(stage.height) || 0;
    var vw = Number(videoWidth) || 0;
    var vh = Number(videoHeight) || 0;
    var fit = String(objectFit || "contain").toLowerCase();
    if (!width || !height || !vw || !vh || fit === "fill") {
      return {
        left: left,
        top: top,
        width: width,
        height: height,
        sourceUnknown: !vw || !vh,
      };
    }
    var scale = fit === "cover"
      ? Math.max(width / vw, height / vh)
      : Math.min(width / vw, height / vh);
    var rw = vw * scale;
    var rh = vh * scale;
    return {
      left: left + (width - rw) / 2,
      top: top + (height - rh) / 2,
      width: rw,
      height: rh,
      sourceUnknown: false,
    };
  }

  function getJitsiState() {
    try {
      if (window.APP && window.APP.store && typeof window.APP.store.getState === "function") {
        return window.APP.store.getState();
      }
    } catch (err) { /* ignore */ }
    return null;
  }

  function isDesktopVideoType(value) {
    return Boolean(DESKTOP_TYPES[String(value || "").trim().toLowerCase()]);
  }

  function readTrackVideoType(trackRecord) {
    if (!trackRecord) return "";
    if (trackRecord.videoType) return trackRecord.videoType;
    var jt = trackRecord.jitsiTrack || trackRecord.track;
    if (!jt) return "";
    try {
      if (typeof jt.getVideoType === "function") return jt.getVideoType() || "";
    } catch (err) { /* ignore */ }
    return jt.videoType || "";
  }

  function trackMediaEnded(trackRecord) {
    if (!trackRecord) return false;
    if (trackRecord.ended) return true;
    var jt = trackRecord.jitsiTrack || trackRecord.track;
    if (!jt) return false;
    try {
      if (typeof jt.isEnded === "function" && jt.isEnded()) return true;
      var media = typeof jt.getTrack === "function" ? jt.getTrack() : jt.track;
      if (media && media.readyState === "ended") return true;
    } catch (err) { /* ignore */ }
    return false;
  }

  function trackMuted(trackRecord) {
    if (!trackRecord) return true;
    if (trackRecord.muted) return true;
    var jt = trackRecord.jitsiTrack || trackRecord.track;
    if (!jt) return false;
    try {
      if (typeof jt.isMuted === "function") return Boolean(jt.isMuted());
    } catch (err) { /* ignore */ }
    return Boolean(jt.muted);
  }

  function isDesktopTrackRecord(trackRecord) {
    if (!trackRecord || trackMuted(trackRecord) || trackMediaEnded(trackRecord)) return false;
    var mediaType = String(trackRecord.mediaType || trackRecord.type || "").toLowerCase();
    if (mediaType === "audio") return false;
    return isDesktopVideoType(readTrackVideoType(trackRecord));
  }

  function listTracks(state) {
    var raw = state && state["features/base/tracks"];
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      var values = [];
      for (var key in raw) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) values.push(raw[key]);
      }
      return values;
    }
    return [];
  }

  function desktopOwnerId(trackRecord) {
    if (!trackRecord) return "";
    if (trackRecord.participantId != null && trackRecord.participantId !== "") {
      return String(trackRecord.participantId);
    }
    if (trackRecord.participantID != null && trackRecord.participantID !== "") {
      return String(trackRecord.participantID);
    }
    var jt = trackRecord.jitsiTrack || trackRecord.track;
    try {
      if (jt && typeof jt.getParticipantId === "function") {
        var pid = jt.getParticipantId();
        if (pid != null && pid !== "") return String(pid);
      }
    } catch (err) { /* ignore */ }
    return "";
  }

  function selectDesktopTrack(state, expectedPresenterId) {
    var tracks = listTracks(state);
    var desktop = [];
    for (var i = 0; i < tracks.length; i += 1) {
      if (isDesktopTrackRecord(tracks[i])) desktop.push(tracks[i]);
    }
    if (!desktop.length) return null;
    var expected = String(expectedPresenterId || "");
    if (!expected) return desktop[0];
    for (var d = 0; d < desktop.length; d += 1) {
      if (desktopOwnerId(desktop[d]) === expected) return desktop[d];
    }
    return null;
  }

  function isTileView(state) {
    var layout = state && state["features/video-layout"];
    if (!layout) return false;
    return Boolean(layout.tileViewEnabled || layout.tileView);
  }

  function trackStream(trackRecord) {
    var jt = trackRecord && (trackRecord.jitsiTrack || trackRecord.track);
    if (!jt) return null;
    try {
      if (jt.stream) return jt.stream;
      if (typeof jt.getOriginalStream === "function") return jt.getOriginalStream();
      if (typeof jt.getStream === "function") return jt.getStream();
    } catch (err) { /* ignore */ }
    return null;
  }

  function videoMatchesDesktopStream(el, stream) {
    if (!el || !stream) return false;
    var so = el.srcObject;
    if (!so) return false;
    if (so === stream) return true;
    if (so.id && stream.id && so.id === stream.id) return true;
    try {
      var a = so.getVideoTracks ? so.getVideoTracks() : [];
      var b = stream.getVideoTracks ? stream.getVideoTracks() : [];
      if (a && b && a.length && b.length && a[0] && b[0] && a[0].id === b[0].id) return true;
    } catch (err) { /* ignore */ }
    return false;
  }

  function isCssHidden(el) {
    var node = el;
    var hops = 0;
    while (node && node.nodeType === 1 && hops < 24) {
      try {
        var st = window.getComputedStyle(node);
        if (st) {
          if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") {
            return true;
          }
          if (Number(st.opacity) === 0) return true;
        }
      } catch (err) { /* ignore */ }
      node = node.parentElement;
      hops += 1;
    }
    return false;
  }

  function intersectsViewport(rect) {
    var vw = window.innerWidth || 0;
    var vh = window.innerHeight || 0;
    var left = Number(rect.left) || 0;
    var top = Number(rect.top) || 0;
    var width = Number(rect.width) || 0;
    var height = Number(rect.height) || 0;
    if (width <= 0 || height <= 0) return false;
    return left < vw && top < vh && (left + width) > 0 && (top + height) > 0;
  }

  function ancestorMeta(el) {
    var ids = [];
    var classes = [];
    var node = el && el.parentElement;
    var hops = 0;
    while (node && node.nodeType === 1 && hops < 16) {
      if (node.id) ids.push(String(node.id));
      if (node.className && typeof node.className === "string") classes.push(node.className);
      node = node.parentElement;
      hops += 1;
    }
    return { ids: ids, classes: classes };
  }

  function domPath(el) {
    var parts = [];
    var node = el;
    var hops = 0;
    while (node && node.nodeType === 1 && hops < 12) {
      var bit = String(node.tagName || "").toLowerCase();
      if (node.id) bit += "#" + node.id;
      else if (node.className && typeof node.className === "string") {
        bit += "." + node.className.trim().split(/\s+/).slice(0, 3).join(".");
      }
      parts.unshift(bit);
      node = node.parentElement;
      hops += 1;
    }
    return parts.join(">");
  }

  function classNameOf(el) {
    if (!el) return "";
    if (typeof el.className === "string") return el.className;
    if (el.className && typeof el.className.baseVal === "string") return el.className.baseVal;
    return "";
  }

  function blobOfCandidate(candidate) {
    return [
      candidate.id || "",
      candidate.className || "",
      (candidate.ancestorIds || []).join(" "),
      (candidate.ancestorClasses || []).join(" "),
    ].join(" ").toLowerCase();
  }

  function classifyShareSurfaceKind(candidate, tileView) {
    var blob = blobOfCandidate(candidate);
    var id = String(candidate.id || "").toLowerCase();
    // Live-confirmed local sharer thumbnail; never an exact geometry source.
    if (candidate.id === "localScreenshare_container" || id === "localscreenshare_container") {
      return "local-preview";
    }
    if (/localscreenshare|local-screenshare|local_screenshare/.test(blob)) {
      return "local-preview";
    }
    if (/localpreview|local-preview|local_preview/.test(blob)) return "local-preview";
    if (/largevideo|large-video|large_video/.test(blob) || id === "largevideo") return "stage";
    if (!tileView && /filmstrip|thumbnail|remotevideos|filmstrip__/.test(blob)) return "filmstrip";
    return "unknown";
  }

  function shareSurfaceArea(rect) {
    var width = Math.max(0, Number(rect && rect.width) || 0);
    var height = Math.max(0, Number(rect && rect.height) || 0);
    return width * height;
  }

  function pickLargest(list) {
    if (!list.length) return null;
    var best = list[0];
    for (var i = 1; i < list.length; i += 1) {
      if (list[i].area > best.area) best = list[i];
    }
    return best;
  }

  function selectDesktopStageSurface(candidates, tileView) {
    var classified = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      if (!candidate || candidate.visible === false || candidate.streamMatch === false) continue;
      if (shareSurfaceArea(candidate.rect) <= 0) continue;
      var item = {
        element: candidate.element,
        id: candidate.id || "",
        className: candidate.className || "",
        rect: candidate.rect,
        videoWidth: candidate.videoWidth || 0,
        videoHeight: candidate.videoHeight || 0,
        objectFit: candidate.objectFit || "contain",
        visible: true,
        streamMatch: true,
        ancestorIds: candidate.ancestorIds || [],
        ancestorClasses: candidate.ancestorClasses || [],
        path: candidate.path || "",
        surfaceKind: classifyShareSurfaceKind(candidate, tileView),
        area: shareSurfaceArea(candidate.rect),
      };
      classified.push(item);
    }
    var previews = [];
    var stages = [];
    var unknown = [];
    for (var c = 0; c < classified.length; c += 1) {
      var kind = classified[c].surfaceKind;
      if (kind === "filmstrip" || kind === "local-preview") previews.push(classified[c]);
      else if (kind === "stage") stages.push(classified[c]);
      else unknown.push(classified[c]);
    }
    var selected = pickLargest(stages);
    if (!selected && !tileView) {
      selected = pickLargest(unknown);
      if (selected) selected.surfaceKind = "stage";
    }
    if (!selected && tileView) {
      var usable = [];
      for (var u = 0; u < classified.length; u += 1) {
        if (classified[u].surfaceKind !== "local-preview") usable.push(classified[u]);
      }
      selected = pickLargest(usable);
      if (selected) selected.surfaceKind = "stage";
    }
    if (!selected) {
      return {
        surface: null,
        stageSurfaceFound: false,
        surfaceKind: previews.length ? previews[0].surfaceKind : "unknown",
        surfaceCandidateCount: classified.length,
        classified: classified,
      };
    }
    return {
      surface: selected,
      stageSurfaceFound: true,
      surfaceKind: "stage",
      surfaceCandidateCount: classified.length,
      classified: classified,
    };
  }

  function collectDesktopVideoCandidates(stream) {
    var list = [];
    if (!stream) return list;
    var videos = document.querySelectorAll("video");
    for (var v = 0; v < videos.length; v += 1) {
      var el = videos[v];
      var streamMatch = videoMatchesDesktopStream(el, stream);
      if (!streamMatch) continue;
      var rect = asRect(el.getBoundingClientRect());
      var hidden = isCssHidden(el);
      var inView = intersectsViewport(rect);
      var ancestors = ancestorMeta(el);
      var objectFit = "contain";
      try {
        objectFit = window.getComputedStyle(el).objectFit || "contain";
      } catch (err) { /* ignore */ }
      list.push({
        element: el,
        id: el.id || "",
        className: classNameOf(el),
        rect: rect,
        videoWidth: Number(el.videoWidth) || 0,
        videoHeight: Number(el.videoHeight) || 0,
        objectFit: objectFit,
        visible: !hidden && inView && rect.width > 0 && rect.height > 0,
        hidden: hidden,
        inViewport: inView,
        streamMatch: true,
        ancestorIds: ancestors.ids,
        ancestorClasses: ancestors.classes,
        path: domPath(el),
      });
    }
    return list;
  }

  function summarizeCandidates(classified) {
    var out = [];
    for (var i = 0; i < classified.length && i < 12; i += 1) {
      var item = classified[i];
      out.push({
        id: item.id || "",
        className: item.className || "",
        rect: item.rect || null,
        surfaceKind: item.surfaceKind || "unknown",
        area: item.area || 0,
        videoWidth: item.videoWidth || 0,
        videoHeight: item.videoHeight || 0,
        path: item.path || "",
      });
    }
    return out;
  }

  function dumpCandidates(role, classified, selected) {
    var lines = ["ITFLUX SS GEOM " + role + " candidates=" + classified.length];
    for (var i = 0; i < classified.length; i += 1) {
      var item = classified[i];
      var r = item.rect || {};
      lines.push(
        "  #" + (i + 1)
        + " id=" + (item.id || "(none)")
        + " kind=" + item.surfaceKind
        + " rect=" + Math.round(r.width || 0) + "x" + Math.round(r.height || 0)
        + " @ " + Math.round(r.left || 0) + "," + Math.round(r.top || 0)
        + " class=" + (item.className || "")
        + " path=" + (item.path || ""),
      );
    }
    if (selected) {
      var sr = selected.rect || {};
      lines.push(
        "SELECTED id=" + (selected.id || "(none)")
        + " kind=" + selected.surfaceKind
        + " rect=" + Math.round(sr.width || 0) + "x" + Math.round(sr.height || 0)
        + " @ " + Math.round(sr.left || 0) + "," + Math.round(sr.top || 0)
        + " video=" + (selected.videoWidth || 0) + "x" + (selected.videoHeight || 0),
      );
    } else {
      lines.push("SELECTED none");
    }
    var dump = lines.join("\n");
    if (dump !== lastCandidateDump) {
      lastCandidateDump = dump;
      try { console.info(dump); } catch (err) { /* ignore */ }
    }
  }

  function emptyMeasure(reason, extra) {
    extra = extra || {};
    return {
      present: false,
      isDesktopTrack: false,
      desktopTrackDetected: Boolean(extra.desktopTrackDetected),
      stageSurfaceFound: false,
      surfaceKind: extra.surfaceKind || "",
      surfaceRect: null,
      surfaceCandidateCount: extra.surfaceCandidateCount || 0,
      surfaceCandidates: extra.surfaceCandidates || [],
      participantId: extra.participantId || presenterJitsiId || "",
      desktopOwnerId: extra.desktopOwnerId || "",
      videoElementRect: null,
      contentRect: null,
      videoWidth: 0,
      videoHeight: 0,
      objectFit: "contain",
      reason: reason || "no-desktop",
    };
  }

  function measure() {
    var state = getJitsiState();
    var anyDesktop = [];
    var tracks = listTracks(state);
    for (var i = 0; i < tracks.length; i += 1) {
      if (isDesktopTrackRecord(tracks[i])) anyDesktop.push(tracks[i]);
    }
    var track = selectDesktopTrack(state, presenterJitsiId);
    if (!track) {
      if (anyDesktop.length) {
        return emptyMeasure("owner-mismatch", {
          desktopTrackDetected: true,
          participantId: presenterJitsiId || "",
          desktopOwnerId: desktopOwnerId(anyDesktop[0]),
        });
      }
      return emptyMeasure("no-desktop", {
        participantId: presenterJitsiId || "",
      });
    }
    var owner = desktopOwnerId(track);
    var stream = trackStream(track);
    var candidates = collectDesktopVideoCandidates(stream);
    var tileView = isTileView(state);
    var picked = selectDesktopStageSurface(candidates, tileView);
    dumpCandidates("desktop", picked.classified, picked.surface);
    var diagnostics = summarizeCandidates(picked.classified);
    if (!picked.stageSurfaceFound || !picked.surface || !picked.surface.element) {
      return {
        present: true,
        isDesktopTrack: true,
        desktopTrackDetected: true,
        stageSurfaceFound: false,
        surfaceKind: picked.surfaceKind || "unknown",
        surfaceRect: null,
        surfaceCandidateCount: picked.surfaceCandidateCount || 0,
        surfaceCandidates: diagnostics,
        participantId: owner || presenterJitsiId || "",
        desktopOwnerId: owner,
        videoElementRect: null,
        contentRect: null,
        videoWidth: 0,
        videoHeight: 0,
        objectFit: "contain",
        reason: candidates.length ? "desktop-stage-not-found" : "desktop-element-missing",
      };
    }
    var video = picked.surface.element;
    var videoRect = asRect(video.getBoundingClientRect());
    var objectFit = picked.surface.objectFit || "contain";
    try {
      objectFit = window.getComputedStyle(video).objectFit || objectFit;
    } catch (err) { /* ignore */ }
    var vw = Number(video.videoWidth) || 0;
    var vh = Number(video.videoHeight) || 0;
    var content = fittedContent(videoRect, vw, vh, objectFit);
    return {
      present: true,
      isDesktopTrack: true,
      desktopTrackDetected: true,
      stageSurfaceFound: true,
      surfaceKind: "stage",
      surfaceRect: videoRect,
      surfaceCandidateCount: picked.surfaceCandidateCount || 0,
      surfaceCandidates: diagnostics,
      surfaceId: picked.surface.id || video.id || "",
      participantId: owner || presenterJitsiId || "",
      desktopOwnerId: owner,
      videoElementRect: videoRect,
      contentRect: asRect(content),
      videoWidth: vw,
      videoHeight: vh,
      objectFit: objectFit,
      reason: "desktop",
    };
  }

  function post(reason) {
    var measured = measure();
    if (reason && measured.reason === "desktop") measured.reason = reason;
    var payload = {
      type: TYPE,
      source: SOURCE,
      shareSessionId: shareSessionId,
      epoch: epoch,
      participantId: measured.participantId || presenterJitsiId || "",
      desktopOwnerId: measured.desktopOwnerId || "",
      iframeViewportWidth: window.innerWidth,
      iframeViewportHeight: window.innerHeight,
      visualViewportWidth: (window.visualViewport && window.visualViewport.width) || window.innerWidth,
      visualViewportHeight: (window.visualViewport && window.visualViewport.height) || window.innerHeight,
      present: Boolean(measured.present),
      isDesktopTrack: Boolean(measured.isDesktopTrack),
      desktopTrackDetected: Boolean(measured.desktopTrackDetected),
      stageSurfaceFound: Boolean(measured.stageSurfaceFound),
      surfaceKind: measured.surfaceKind || "",
      surfaceId: measured.surfaceId || "",
      surfaceRect: measured.surfaceRect || null,
      surfaceCandidateCount: measured.surfaceCandidateCount || 0,
      surfaceCandidates: measured.surfaceCandidates || [],
      videoElementRect: measured.videoElementRect || null,
      contentRect: measured.contentRect || null,
      videoWidth: measured.videoWidth || 0,
      videoHeight: measured.videoHeight || 0,
      objectFit: measured.objectFit || "contain",
      reason: measured.reason || reason || "update",
      timestamp: Date.now(),
    };
    var key = [
      payload.present,
      payload.isDesktopTrack,
      payload.desktopTrackDetected,
      payload.stageSurfaceFound,
      payload.surfaceKind,
      payload.surfaceId,
      payload.participantId,
      payload.shareSessionId,
      payload.epoch,
      payload.videoWidth,
      payload.videoHeight,
      payload.iframeViewportWidth,
      payload.iframeViewportHeight,
      payload.contentRect && Math.round(payload.contentRect.left),
      payload.contentRect && Math.round(payload.contentRect.top),
      payload.contentRect && Math.round(payload.contentRect.width),
      payload.contentRect && Math.round(payload.contentRect.height),
      payload.reason,
    ].join("|");
    var now = Date.now();
    if (key === lastKey && now - lastPost < 120) return;
    if (now - lastPost < MIN_POST_MS) {
      schedule(reason);
      return;
    }
    lastKey = key;
    lastPost = now;
    var target = parentTargetOrigin();
    try {
      window.parent.postMessage(payload, target);
    } catch (err) {
      window.parent.postMessage(payload, "*");
    }
  }

  function schedule(reason) {
    if (raf) return;
    raf = window.requestAnimationFrame(function () {
      raf = 0;
      post(reason);
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== REQUEST) return;
    if (data.shareSessionId != null) shareSessionId = String(data.shareSessionId || "");
    if (data.presenterJitsiId != null) presenterJitsiId = String(data.presenterJitsiId || "");
    if (data.epoch != null) epoch = Number(data.epoch) || 0;
    post("request");
  });

  var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () {
    schedule("resize");
  }) : null;
  try {
    if (document.documentElement) ro && ro.observe(document.documentElement);
  } catch (err) { /* ignore */ }

  function observeLayoutRoots() {
    var ids = [
      "largeVideoContainer",
      "largeVideoWrapper",
      "videoconference_page",
      "filmstrip",
      "remoteVideos",
      "sideToolbarContainer",
      "new-toolbox",
      "layout_wrapper",
    ];
    for (var i = 0; i < ids.length; i += 1) {
      var node = document.getElementById(ids[i]);
      if (!node) continue;
      try { ro && ro.observe(node); } catch (err) { /* ignore */ }
    }
  }

  function watchVideos() {
    var videos = document.querySelectorAll("video");
    for (var i = 0; i < videos.length; i += 1) {
      var video = videos[i];
      if (observedVideos.has(video)) continue;
      observedVideos.add(video);
      try { ro && ro.observe(video); } catch (err) { /* ignore */ }
      video.addEventListener("loadedmetadata", function () { schedule("metadata"); });
      video.addEventListener("resize", function () { schedule("video-resize"); });
    }
    observeLayoutRoots();
  }

  function subscribeStore() {
    if (storeUnsub) return;
    try {
      if (window.APP && window.APP.store && typeof window.APP.store.subscribe === "function") {
        storeUnsub = window.APP.store.subscribe(function () {
          schedule("store");
        });
      }
    } catch (err) { /* ignore */ }
  }

  var mo = typeof MutationObserver !== "undefined"
    ? new MutationObserver(function () { schedule("dom"); watchVideos(); subscribeStore(); })
    : null;
  if (mo && document.body) {
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  window.addEventListener("resize", function () { schedule("window-resize"); });
  window.addEventListener("orientationchange", function () { schedule("orientation"); });
  document.addEventListener("fullscreenchange", function () { schedule("fullscreen"); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () { schedule("visual-viewport"); });
    window.visualViewport.addEventListener("scroll", function () { schedule("visual-viewport-scroll"); });
  }

  watchVideos();
  subscribeStore();
  window.setInterval(function () {
    watchVideos();
    subscribeStore();
  }, 2500);
  post("init");
})();
