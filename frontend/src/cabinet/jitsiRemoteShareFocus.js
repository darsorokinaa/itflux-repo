/**
 * r94: у ПОЛУЧАТЕЛЯ демонстрации экрана (например, учитель смотрит экран ученика):
 * пока удалённый участник показывает экран — закрепляем его на главной сцене (и в мини-плеере)
 * и запрашиваем 1080p через setVideoQuality, независимо от размера плитки.
 * Иначе JVB пересылает нижний слой VP9 под маленькую плитку (270p, ~100 кбит/с).
 */
export const SCREENSHARE_RECEIVE_HEIGHT = 1080;
const REPIN_MIN_MS = 2000;

export function parseShareIds(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.participants ?? raw?.data ?? []);
  return (Array.isArray(list) ? list : []).map((x) => String(x?.id ?? x ?? "")).filter(Boolean);
}

export function attachRemoteShareFocus(api, { now = () => Date.now(), keepAliveMs = 10000 } = {}) {
  if (!api?.addListener || typeof api.executeCommand !== "function") return { dispose() {}, state: () => ({}) };
  let localId = "";
  let remoteSharer = "";
  let largeId = "";
  let lastPin = 0;
  let timer = null;
  const handlers = [];
  const cmd = (...a) => {
    try {
      api.executeCommand(...a);
    } catch {
      /* ignore */
    }
  };
  const on = (n, f) => {
    try {
      api.addListener(n, f);
      handlers.push([n, f]);
    } catch {
      /* ignore */
    }
  };
  const pin = (force = false) => {
    if (!remoteSharer) return;
    const t = now();
    if (!force && t - lastPin < REPIN_MIN_MS) return;
    lastPin = t;
    cmd("setTileView", false);
    cmd("setLargeVideoParticipant", remoteSharer);
    cmd("setVideoQuality", SCREENSHARE_RECEIVE_HEIGHT);
  };
  const stopTimer = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const update = (ids) => {
    const remote = ids.find((id) => id && id !== localId) || "";
    if (remote === remoteSharer) return;
    remoteSharer = remote;
    if (remote) {
      pin(true);
      if (timer == null && keepAliveMs > 0) timer = setInterval(() => cmd("setVideoQuality", SCREENSHARE_RECEIVE_HEIGHT), keepAliveMs);
    } else {
      stopTimer();
      cmd("setLargeVideoParticipant"); // вернуть авто-выбор сцены
    }
  };
  on("videoConferenceJoined", (e) => {
    localId = String(e?.id || "");
  });
  on("contentSharingParticipantsChanged", (e) => update(parseShareIds(e)));
  on("largeVideoChanged", (e) => {
    largeId = String(e?.id || "");
    if (remoteSharer && largeId && largeId !== remoteSharer) pin(false);
  });
  on("tileViewChanged", (e) => {
    if (remoteSharer && e?.enabled) pin(false);
  });
  return {
    state: () => ({ localId, remoteSharer, largeId }),
    dispose() {
      stopTimer();
      for (const [n, f] of handlers) {
        try {
          api.removeListener?.(n, f);
        } catch {
          /* ignore */
        }
      }
    },
  };
}
