/**
 * «Поверх окон» для звонка урока (r72). Связывает страницу урока с callPip.js.
 *
 * Jitsi (основная связь): окно открывает External API по команде showPiP.
 * LiveKit (резервная): своё окно Document PiP, запасной путь — видео-PiP.
 * Окно не создаёт второго подключения и не трогает iframe звонка.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { reportClientEvent } from "../../utils/clientTelemetry";
import {
  bindAutoPictureInPicture,
  createJitsiPipController,
  currentDocumentPipWindow,
  detectCallPipSupport,
  exitAnyCallPip,
  hasTransientActivation,
  openOwnCallPip,
  requestVideoElementPip,
} from "../callPip";

function diag(event, extra = {}) {
  try {
    reportClientEvent(event, extra);
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} options
 * @param {boolean} options.live           звонок идёт и показан
 * @param {() => object|null} options.getJitsiApi  сырой JitsiMeetExternalAPI
 * @param {number} options.jitsiEpoch      меняется при новом api (переподключение)
 * @param {() => boolean} options.isLiveKit резервная связь сейчас активна (для обработчиков)
 * @param {boolean} options.liveKit        то же для отрисовки кнопки
 * @param {() => object|null} options.getLiveKitMedia  pickPipMedia из LiveKitCallView
 * @param {() => HTMLVideoElement|null} options.getLiveKitRemoteVideo
 * @param {object} options.actions         { onToggleMic, onToggleCam, onHangup }
 * @param {(reason: string) => any} options.legacyFallback  прежний путь (видео-PiP
 *        презентационного <video>) там, где Jitsi PiP недоступен
 */
export default function useCallPip({
  live = false,
  getJitsiApi,
  jitsiEpoch = 0,
  isLiveKit,
  liveKit = false,
  getLiveKitMedia,
  getLiveKitRemoteVideo,
  actions,
  legacyFallback,
} = {}) {
  const [support] = useState(() => detectCallPipSupport());
  const [active, setActive] = useState(false);
  const jitsiRef = useRef(null);
  const ownRef = useRef(null);
  const openedForShareRef = useRef(false);
  const optsRef = useRef({});
  useLayoutEffect(() => {
    optsRef.current = { getJitsiApi, isLiveKit, getLiveKitMedia, getLiveKitRemoteVideo, actions, legacyFallback };
  });

  useEffect(() => {
    const controller = createJitsiPipController({
      getApi: () => optsRef.current.getJitsiApi?.() || null,
      onChange: (snap) => {
        if (!ownRef.current) setActive(Boolean(snap.active));
        if (!snap.active) openedForShareRef.current = false;
      },
    });
    jitsiRef.current = controller;
    return () => {
      jitsiRef.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    if (jitsiEpoch) jitsiRef.current?.attach();
  }, [jitsiEpoch]);

  const liveKitNow = () => Boolean(optsRef.current.isLiveKit?.());

  const closeOwn = useCallback(() => {
    const own = ownRef.current;
    ownRef.current = null;
    try {
      own?.close?.();
    } catch {
      /* ignore */
    }
  }, []);

  /** Открыть окно. Вызывать синхронно из жеста / enterpictureinpicture. */
  const open = useCallback((reason = "button", { requireGesture = false } = {}) => {
    if (requireGesture && !hasTransientActivation()) {
      diag("call_pip_skipped", { reason, why: "no-gesture" });
      return Promise.resolve({ ok: false, reason: "needs-gesture" });
    }
    if (liveKitNow()) {
      if (ownRef.current?.isOpen?.()) return Promise.resolve({ ok: true, already: true });
      if (support.documentPip) {
        const pending = openOwnCallPip({
          getMedia: () => optsRef.current.getLiveKitMedia?.() || null,
          actions: {
            onToggleMic: () => optsRef.current.actions?.onToggleMic?.(),
            onToggleCam: () => optsRef.current.actions?.onToggleCam?.(),
            onHangup: () => {
              // Подтверждение «Завершить урок?» показывается во вкладке: вернём туда.
              closeOwn();
              try {
                window.focus();
              } catch {
                /* ignore */
              }
              optsRef.current.actions?.onHangup?.();
            },
          },
          onClose: () => {
            ownRef.current = null;
            openedForShareRef.current = false;
            setActive(false);
            diag("call_pip_closed", { mode: "own" });
          },
        });
        return pending.then((result) => {
          if (result.ok) {
            ownRef.current = result;
            setActive(true);
          }
          diag(result.ok ? "call_pip_opened" : "call_pip_failed", { mode: "own", reason, why: result.reason || "" });
          return result;
        }).catch(() => ({ ok: false, reason: "error" }));
      }
      const video = optsRef.current.getLiveKitRemoteVideo?.() || null;
      return requestVideoElementPip(video).then((result) => {
        diag(result.ok ? "call_pip_opened" : "call_pip_failed", { mode: "video", reason, why: result.reason || "" });
        return result;
      });
    }
    const result = jitsiRef.current?.open() || { ok: false, reason: "no-call" };
    diag(result.ok ? "call_pip_requested" : "call_pip_failed", { mode: "jitsi", reason, why: result.reason || "" });
    if (!result.ok && result.reason === "unsupported" && reason === "auto") {
      try {
        const legacy = optsRef.current.legacyFallback?.(reason);
        if (legacy && typeof legacy.catch === "function") legacy.catch(() => {});
      } catch {
        /* ignore */
      }
    }
    return Promise.resolve(result);
  }, [closeOwn, support.documentPip]);

  const close = useCallback(() => {
    openedForShareRef.current = false;
    closeOwn();
    jitsiRef.current?.close();
    try {
      if (typeof document !== "undefined" && document.pictureInPictureElement) {
        void document.exitPictureInPicture().catch(() => {});
      }
    } catch {
      /* ignore */
    }
    setActive(false);
  }, [closeOwn]);

  const toggle = useCallback(() => {
    const opened = Boolean(ownRef.current?.isOpen?.())
      || Boolean(jitsiRef.current?.isActive?.() && currentDocumentPipWindow())
      || (typeof document !== "undefined" && Boolean(document.pictureInPictureElement));
    if (opened) {
      close();
      return Promise.resolve({ ok: true, closed: true });
    }
    openedForShareRef.current = false;
    return open("button");
  }, [close, open]);

  /**
   * Своя демонстрация началась. Chrome 139+ после выбора экрана даёт документу
   * свежий жест — им и открываем окно. Без жеста не пытаемся (бросит ошибку).
   */
  const onLocalShareStarted = useCallback(() => {
    const already = Boolean(ownRef.current?.isOpen?.()) || Boolean(currentDocumentPipWindow());
    if (already) return Promise.resolve({ ok: true, already: true });
    return open("share", { requireGesture: true }).then((result) => {
      if (result?.ok) openedForShareRef.current = true;
      return result;
    });
  }, [open]);

  /** Демонстрация закончилась: окно, открытое ради неё, закрываем. */
  const onLocalShareStopped = useCallback(() => {
    if (!openedForShareRef.current) return;
    close();
  }, [close]);

  // Уход со вкладки во время звонка (Chrome: автоматический PiP для звонков).
  useEffect(() => {
    if (!live || !support.mediaSession) return undefined;
    return bindAutoPictureInPicture(() => open("auto"));
  }, [live, open, support.mediaSession]);

  // Звонок закончился или страница ушла — окно закрываем.
  useEffect(() => {
    if (!live) return undefined;
    return () => close();
  }, [live, close]);

  useEffect(() => () => {
    closeOwn();
    void exitAnyCallPip();
  }, [closeOwn]);

  const manualAvailable = support.documentPip || (support.videoPip && Boolean(liveKit));

  return {
    supported: support.documentPip || support.videoPip,
    manualAvailable,
    active,
    open,
    close,
    toggle,
    onLocalShareStarted,
    onLocalShareStopped,
  };
}
