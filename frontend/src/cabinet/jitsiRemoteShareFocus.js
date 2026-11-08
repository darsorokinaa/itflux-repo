/**
 * У получателя демонстрации экран держим на главной сцене и запрашиваем 1080p,
 * пока показ развёрнут. Иначе мост оставляет нижний слой VP9, выбранный под
 * миниатюру (около 180–270p), и после reconnect или смены раскладки не поднимает его.
 * Свёрнутая полоска звонка высокий слой не требует. Это потолок приёма, не гарантия
 * при слабом канале: «Слабое соединение» по-прежнему может опустить качество.
 */
import { SCREEN_SHARE_RECEIVE_HEIGHT } from "./screenShareQuality";

export { SCREEN_SHARE_RECEIVE_HEIGHT as SCREENSHARE_RECEIVE_HEIGHT };
const REPIN_MIN_MS = 2000;
const QUALITY_MIN_MS = 400;

export function parseShareIds(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.participants ?? raw?.data ?? []);
  return (Array.isArray(list) ? list : []).map((x) => String(x?.id ?? x ?? "")).filter(Boolean);
}

export function attachRemoteShareFocus(api, {
  now = () => Date.now(),
  keepAliveMs = 10000,
  schedule = (fn) => setTimeout(fn, 350),
} = {}) {
  if (!api?.addListener || typeof api.executeCommand !== "function") return { dispose() {}, state: () => ({}), noteLayout() {} };
  let localId = "";
  let remoteSharer = "";
  let largeId = "";
  let viewExpanded = true;
  let lastPin = 0;
  let lastQuality = 0;
  let timer = null;
  let laterTimer = null;
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
  const clearLater = () => {
    if (laterTimer != null) {
      clearTimeout(laterTimer);
      laterTimer = null;
    }
  };
  const requestQuality = (force = false) => {
    if (!remoteSharer || !viewExpanded) return false;
    const t = now();
    if (!force && t - lastQuality < QUALITY_MIN_MS) return false;
    lastQuality = t;
    cmd("setVideoQuality", SCREEN_SHARE_RECEIVE_HEIGHT);
    return true;
  };
  const pin = (force = false) => {
    if (!remoteSharer || !viewExpanded) return;
    const t = now();
    if (!force && t - lastPin < REPIN_MIN_MS) return;
    lastPin = t;
    cmd("setTileView", false);
    cmd("setLargeVideoParticipant", remoteSharer);
    requestQuality(true);
  };
  const ensureTimer = () => {
    if (timer == null && keepAliveMs > 0) {
      timer = setInterval(() => requestQuality(true), keepAliveMs);
    }
  };
  const stopTimer = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const update = (ids, { force = false } = {}) => {
    const remote = ids.find((id) => id && id !== localId) || "";
    if (remote === remoteSharer) {
      if (force && remote) {
        ensureTimer();
        pin(true);
      }
      return;
    }
    remoteSharer = remote;
    if (remote) {
      pin(true);
      ensureTimer();
    } else {
      stopTimer();
      clearLater();
      cmd("setLargeVideoParticipant");
    }
  };
  const readSharers = async () => {
    if (typeof api.getContentSharingParticipants !== "function") return null;
    try {
      const raw = await api.getContentSharingParticipants();
      return parseShareIds(raw);
    } catch {
      return null;
    }
  };
  const restoreAfterJoin = async () => {
    const ids = await readSharers();
    if (ids && ids.length) {
      update(ids, { force: true });
      return;
    }
    if (remoteSharer) pin(true);
  };
  const noteLayout = ({ expanded = true } = {}) => {
    const next = expanded !== false;
    const becameExpanded = next && !viewExpanded;
    viewExpanded = next;
    if (!remoteSharer) return;
    if (!viewExpanded) {
      clearLater();
      return;
    }
    // Повторный resize не выключает групповой вид. Сцена возвращается на экран
    // только когда показ снова разворачивают после свёрнутой полоски.
    if (becameExpanded) pin(true);
    else requestQuality(false);
    clearLater();
    try {
      laterTimer = schedule(() => {
        laterTimer = null;
        if (remoteSharer && viewExpanded) requestQuality(true);
      });
    } catch {
      /* ignore */
    }
  };
  on("videoConferenceJoined", (e) => {
    localId = String(e?.id || "");
    void restoreAfterJoin();
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
    state: () => ({ localId, remoteSharer, largeId, viewExpanded }),
    noteLayout,
    dispose() {
      stopTimer();
      clearLater();
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
