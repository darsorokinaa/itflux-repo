import { useCallback, useRef } from "react";

export function playbackSignature(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

/**
 * Echo-safe publisher for logical interactive playback state.
 * Mark the outgoing snapshot as applied so the remote echo does not re-set local UI.
 */
export function usePlaybackBridge({ publish = false, onChange } = {}) {
  const lastSigRef = useRef("");
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const skipEmitRef = useRef(false);

  const emit = useCallback((snapshot) => {
    if (!publishRef.current || !onChangeRef.current) return;
    lastSigRef.current = playbackSignature(snapshot);
    onChangeRef.current(snapshot);
  }, []);

  const shouldApplyRemote = useCallback((remote) => {
    if (!remote || typeof remote !== "object") return false;
    const sig = playbackSignature(remote);
    if (sig === lastSigRef.current) return false;
    lastSigRef.current = sig;
    skipEmitRef.current = true;
    return true;
  }, []);

  const consumeSkipEmit = useCallback(() => {
    if (!skipEmitRef.current) return false;
    skipEmitRef.current = false;
    return true;
  }, []);

  return { emit, shouldApplyRemote, consumeSkipEmit, lastSigRef };
}
