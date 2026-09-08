import { useEffect, useRef, useState } from "react";

import { useElementClientRect } from "../useElementClientRect";
import {
  GEOMETRY_STATUS,
  GEOMETRY_WAIT_MS,
  isTrustedJitsiGeometryEvent,
  normalizeJitsiOrigin,
  parentRectsFromGeometryPayload,
  requestJitsiGeometry,
} from "./jitsiGeometry";
import { reduceShareGeometryMessage } from "./jitsiDesktopTrack";

export function useJitsiShareGeometry({
  enabled = false,
  iframe = null,
  jitsiOrigin = "",
  shareSessionId = "",
  presenterJitsiId = "",
} = {}) {
  const [status, setStatus] = useState(GEOMETRY_STATUS.IDLE);
  const [payload, setPayload] = useState(null);
  const epochRef = useRef(0);
  const payloadRef = useRef(null);
  const iframeHolderRef = useRef(iframe);
  iframeHolderRef.current = iframe;

  const iframeBox = useElementClientRect(iframeHolderRef, {
    enabled: Boolean(enabled && iframe),
    live: Boolean(enabled && iframe),
  });

  useEffect(() => {
    if (!enabled) {
      epochRef.current += 1;
      payloadRef.current = null;
      setPayload(null);
      setStatus(GEOMETRY_STATUS.IDLE);
      return undefined;
    }
    epochRef.current += 1;
    const epoch = epochRef.current;
    payloadRef.current = null;
    setPayload(null);
    setStatus(GEOMETRY_STATUS.WAITING);
    const origin = normalizeJitsiOrigin(jitsiOrigin);
    const session = { shareSessionId, presenterJitsiId, epoch };
    let statusValue = GEOMETRY_STATUS.WAITING;

    const onMessage = (event) => {
      if (!isTrustedJitsiGeometryEvent(event, { jitsiOrigin: origin, iframe })) return;
      const next = reduceShareGeometryMessage(
        { status: statusValue, payload: payloadRef.current },
        event.data,
        session,
      );
      payloadRef.current = next.payload;
      statusValue = next.status;
      setPayload(next.payload);
      setStatus(next.status);
    };

    window.addEventListener("message", onMessage);
    requestJitsiGeometry(iframe, origin, { shareSessionId, presenterJitsiId, epoch });
    const ping = window.setInterval(() => {
      requestJitsiGeometry(iframe, origin, { shareSessionId, presenterJitsiId, epoch });
    }, 400);
    const wait = window.setTimeout(() => {
      if (epochRef.current !== epoch) return;
      if (payloadRef.current) return;
      if (statusValue === GEOMETRY_STATUS.EXACT) return;
      statusValue = GEOMETRY_STATUS.FALLBACK;
      setStatus(GEOMETRY_STATUS.FALLBACK);
    }, GEOMETRY_WAIT_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(ping);
      window.clearTimeout(wait);
    };
  }, [enabled, iframe, jitsiOrigin, shareSessionId, presenterJitsiId]);

  const mapped = (() => {
    if (!payload || !iframeBox) return { content: null, video: null };
    return parentRectsFromGeometryPayload(payload, iframeBox);
  })();

  return {
    status,
    iframeRect: iframeBox,
    videoRect: mapped.video,
    contentRect: mapped.content,
    videoWidth: Number(payload?.videoWidth) || 0,
    videoHeight: Number(payload?.videoHeight) || 0,
    objectFit: payload?.objectFit || "contain",
    participantId: payload?.participantId || "",
    isDesktopTrack: Boolean(payload?.isDesktopTrack || payload?.desktopTrackDetected),
    epoch: payload?.epoch,
    raw: payload,
  };
}
