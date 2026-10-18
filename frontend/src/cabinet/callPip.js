/**
 * «Поверх окон» для звонка урока (r72).
 *
 * Звонок Jitsi идёт в iframe с lesson.itflux-academy.ru: это другой origin,
 * его <video> и MediaStreamTrack страница не видит, а перенос iframe в окно
 * Picture-in-Picture перезагружает конференцию. Поэтому для Jitsi окно открывает
 * сам External API (Jitsi 9442+, pip.enableBrowserPiP): страница даёт жест и
 * команду showPiP, видео в окно Jitsi передаёт сам.
 *
 * Для резервной связи LiveKit треки свои: окно Document PiP собираем здесь
 * (собеседник, своя камера, микрофон, камера, завершить, вернуться).
 *
 * Всё под проверкой возможностей, все ошибки глушатся: звонок важнее окна.
 */

export const CALL_PIP_WINDOW_SIZE = Object.freeze({ width: 360, height: 270 });
export const JITSI_PIP_WINDOW_SIZE = Object.freeze({ width: 360, height: 220 });

function envWindow(env) {
  if (env) return env;
  return typeof window !== "undefined" ? window : null;
}

function safe(fn, fallback = undefined) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Что умеет браузер. Ничего не вызывает, только смотрит. */
export function detectCallPipSupport(env) {
  const win = envWindow(env);
  const doc = win?.document || null;
  const nav = win?.navigator || null;
  const dpip = safe(() => win?.documentPictureInPicture, null);
  const documentPip = Boolean(dpip && typeof dpip.requestWindow === "function");
  const VideoEl = safe(() => win?.HTMLVideoElement, null);
  const proto = VideoEl?.prototype || null;
  const videoPip = Boolean(
    proto
    && typeof proto.requestPictureInPicture === "function"
    && safe(() => doc?.pictureInPictureEnabled, false) !== false,
  );
  const webkitPresentation = Boolean(proto && typeof proto.webkitSetPresentationMode === "function");
  const mediaSession = Boolean(nav?.mediaSession && typeof nav.mediaSession.setActionHandler === "function");
  return {
    documentPip,
    videoPip,
    webkitPresentation,
    mediaSession,
    /** Есть хоть какой-то способ показать видео поверх окон. */
    any: documentPip || videoPip || webkitPresentation,
  };
}

/** Есть ли сейчас «свежий» жест пользователя. Без API — считаем, что есть. */
export function hasTransientActivation(env) {
  const nav = envWindow(env)?.navigator;
  const ua = safe(() => nav?.userActivation, null);
  if (!ua || typeof ua.isActive !== "boolean") return true;
  return ua.isActive;
}

/**
 * Кусок configOverwrite для Jitsi. Только для браузеров с Document PiP.
 * В Safari Jitsi открывает видео-PiP по blur окна iframe: в уроке это
 * срабатывало бы на каждый клик по доске, поэтому там не включаем.
 */
export function buildJitsiPipConfigOverwrite(env) {
  if (!detectCallPipSupport(env).documentPip) return null;
  return {
    pip: {
      enableBrowserPiP: true,
      disabled: false,
      showOnPrejoin: false,
      // Кнопку рисует страница, панель Jitsi не меняем.
      showToolbarButton: false,
      documentPiP: {
        windowOptions: {
          width: JITSI_PIP_WINDOW_SIZE.width,
          height: JITSI_PIP_WINDOW_SIZE.height,
          disallowReturnToOpener: false,
        },
      },
    },
  };
}

/**
 * External API сам вызывает showPiP, когда iframe уходит из видимой области
 * (IntersectionObserver). В уроке iframe прячется при сворачивании и на
 * телефоне при переходе к материалам — окно открывалось бы неожиданно.
 * Отключаем: окно открывают только кнопка, демонстрация и уход со вкладки.
 */
export function disableJitsiAutoIntersectionPip(api) {
  if (!api || typeof api._teardownIntersectionObserver !== "function") return false;
  try {
    api._teardownIntersectionObserver();
    return true;
  } catch {
    return false;
  }
}

/**
 * Регистрирует обработчик автоматического PiP (Chrome: уход со вкладки во время
 * звонка с камерой/микрофоном). Возвращает функцию снятия.
 */
export function bindAutoPictureInPicture(handler, env) {
  const session = safe(() => envWindow(env)?.navigator?.mediaSession, null);
  if (!session || typeof session.setActionHandler !== "function" || typeof handler !== "function") {
    return () => {};
  }
  try {
    session.setActionHandler("enterpictureinpicture", (details) => {
      try {
        const result = handler(details || {});
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch {
        /* ignore */
      }
    });
  } catch {
    return () => {};
  }
  return () => {
    try {
      session.setActionHandler("enterpictureinpicture", null);
    } catch {
      /* ignore */
    }
  };
}

/** Открытое окно Document PiP этой страницы (любого владельца). */
export function currentDocumentPipWindow(env) {
  const win = safe(() => envWindow(env)?.documentPictureInPicture?.window, null);
  if (!win) return null;
  return safe(() => (win.closed ? null : win), null);
}

/**
 * Контроллер для Jitsi External API.
 * getApi() → сырой JitsiMeetExternalAPI (у сессии кабинета это session.api).
 */
export function createJitsiPipController({ getApi, onChange, env } = {}) {
  const win = envWindow(env);
  const support = detectCallPipSupport(win);
  let active = false;
  let disposed = false;
  let pipWindow = null;
  let boundApi = null;
  const cleanups = [];

  const emit = () => {
    if (disposed) return;
    try {
      onChange?.({ active, supported: support.documentPip });
    } catch {
      /* ignore */
    }
  };

  const setActive = (next) => {
    const value = Boolean(next);
    if (value === active) return;
    active = value;
    emit();
  };

  const onPipHide = () => {
    pipWindow = null;
    setActive(false);
  };

  const trackWindow = (target) => {
    if (!target || target === pipWindow) return;
    pipWindow = target;
    try {
      target.addEventListener("pagehide", onPipHide, { once: true });
    } catch {
      /* ignore */
    }
    setActive(true);
  };

  const dpip = safe(() => win?.documentPictureInPicture, null);
  if (support.documentPip && dpip && typeof dpip.addEventListener === "function") {
    const onEnter = (event) => {
      // Окно открыл External API: на «enter» можно лишь отметить состояние.
      if (!boundApi) return;
      trackWindow(event?.window || currentDocumentPipWindow(win));
    };
    try {
      dpip.addEventListener("enter", onEnter);
      cleanups.push(() => safe(() => dpip.removeEventListener("enter", onEnter)));
    } catch {
      /* ignore */
    }
  }

  const resolveApi = () => {
    const api = safe(() => getApi?.(), null);
    if (!api) return null;
    if (api !== boundApi) {
      boundApi = api;
      disableJitsiAutoIntersectionPip(api);
      if (typeof api.addListener === "function") {
        const entered = () => setActive(true);
        const left = () => {
          if (!currentDocumentPipWindow(win)) setActive(false);
        };
        safe(() => api.addListener("pipEntered", entered));
        safe(() => api.addListener("pipLeft", left));
        cleanups.push(() => {
          safe(() => api.removeListener?.("pipEntered", entered));
          safe(() => api.removeListener?.("pipLeft", left));
        });
      }
    }
    return api;
  };

  return {
    supported: support.documentPip,
    isActive: () => active,
    /** Подхватить новый api после переподключения. */
    attach() {
      if (!disposed) resolveApi();
    },
    /**
     * Открыть окно. requireGesture — для автоматических случаев:
     * без свежего жеста Chrome всё равно откажет, лучше не дёргать Jitsi.
     */
    open({ requireGesture = false } = {}) {
      if (disposed) return { ok: false, reason: "disposed" };
      if (!support.documentPip) return { ok: false, reason: "unsupported" };
      const api = resolveApi();
      if (!api) return { ok: false, reason: "no-call" };
      if (active && currentDocumentPipWindow(win)) return { ok: true, already: true };
      if (requireGesture && !hasTransientActivation(win)) return { ok: false, reason: "needs-gesture" };
      try {
        if (typeof api.showPiP === "function") api.showPiP();
        else if (typeof api.executeCommand === "function") api.executeCommand("showPiP");
        else return { ok: false, reason: "unsupported" };
      } catch {
        return { ok: false, reason: "error" };
      }
      return { ok: true, pending: true };
    },
    close() {
      const api = boundApi;
      if (api) {
        try {
          if (typeof api.hidePiP === "function") api.hidePiP();
          else api.executeCommand?.("hidePiP");
        } catch {
          /* ignore */
        }
      }
      const opened = pipWindow;
      pipWindow = null;
      if (opened) {
        safe(() => opened.removeEventListener?.("pagehide", onPipHide));
        safe(() => {
          if (!opened.closed) opened.close();
        });
      }
      setActive(false);
    },
    toggle() {
      if (active && currentDocumentPipWindow(win)) {
        this.close();
        return { ok: true, closed: true };
      }
      return this.open();
    },
    dispose() {
      if (disposed) return;
      this.close();
      disposed = true;
      for (const fn of cleanups.splice(0)) safe(fn);
      boundApi = null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Собственное окно Document PiP (резервная связь LiveKit).            */
/* ------------------------------------------------------------------ */

const OWN_PIP_STYLES = `
html,body{margin:0;padding:0;width:100%;height:100%;background:#0f172a;color:#f8fafc;overflow:hidden;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
[hidden]{display:none!important}
.cpip{position:relative;width:100%;height:100%;display:flex;flex-direction:column}
.cpip__stage{position:relative;flex:1 1 auto;min-height:0;background:#0b1220}
.cpip__remote{width:100%;height:100%;object-fit:contain;background:#0b1220;display:block}
.cpip__avatar{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
.cpip__avatar-circle{width:72px;height:72px;border-radius:50%;background:#334155;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:600}
.cpip__name{position:absolute;left:8px;bottom:8px;max-width:60%;padding:2px 8px;border-radius:6px;background:rgba(15,23,42,.7);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpip__self{position:absolute;right:8px;bottom:8px;width:28%;max-width:120px;aspect-ratio:4/3;border-radius:8px;overflow:hidden;background:#1e293b;box-shadow:0 2px 10px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18)}
.cpip__self video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:block}
.cpip__self[data-off="true"] video{display:none}
.cpip__self-off{position:absolute;inset:0;display:none;align-items:center;justify-content:center;font-size:11px;color:#cbd5e1}
.cpip__self[data-off="true"] .cpip__self-off{display:flex}
.cpip__bar{flex:0 0 auto;display:flex;gap:8px;justify-content:center;align-items:center;padding:8px;background:#111827}
.cpip__btn{appearance:none;border:0;border-radius:999px;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;background:#334155;color:#f8fafc;cursor:pointer}
.cpip__btn:hover{background:#475569}
.cpip__btn[data-off="true"]{background:#7f1d1d}
.cpip__btn--hangup{background:#dc2626}
.cpip__btn--hangup:hover{background:#b91c1c}
.cpip__btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
`;

const ICONS = {
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  camOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M16 16H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1M10 6h4a2 2 0 0 1 2 2v3l5-3v9"/></svg>',
  hangup: '<svg viewBox="0 0 24 24"><path d="M3 14c5-5 13-5 18 0l-2 3-4-1v-3a10 10 0 0 0-6 0v3l-4 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 14l-3-3 3-3M6 11h8"/></svg>',
};

function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Привязать видеоисточник к <video> в окне. Источник:
 * - объект с attach/detach (трек LiveKit: так LiveKit видит, что видео в PiP,
 *   и не ставит приём на паузу, когда вкладка скрыта);
 * - MediaStreamTrack (kind === "video") — оборачиваем в MediaStream без clone().
 * Свои треки не останавливаем никогда.
 */
export function bindVideoSource(video, source, previous = null) {
  if (!video) return null;
  if (previous && previous === source) return source;
  if (previous) unbindVideoSource(video, previous);
  if (!source) {
    safe(() => { video.srcObject = null; });
    return null;
  }
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  safe(() => video.setAttribute("playsinline", ""));
  if (typeof source.attach === "function") {
    safe(() => source.attach(video));
  } else if (source.kind === "video") {
    const Stream = safe(() => (video.ownerDocument?.defaultView || window).MediaStream, null)
      || (typeof MediaStream !== "undefined" ? MediaStream : null);
    if (Stream) safe(() => { video.srcObject = new Stream([source]); });
  }
  // Звук только в основном окне звонка: в окне PiP <video> всегда без звука.
  video.muted = true;
  safe(() => {
    const playing = video.play?.();
    if (playing && typeof playing.catch === "function") playing.catch(() => {});
  });
  return source;
}

export function unbindVideoSource(video, source) {
  if (!video || !source) return;
  if (typeof source.detach === "function") safe(() => source.detach(video));
  safe(() => { video.srcObject = null; });
}

/**
 * Открывает своё окно Document PiP. Вызывать прямо из обработчика жеста
 * (или enterpictureinpicture): requestWindow идёт первым, без await до него.
 *
 * getMedia() → { remote: { source, name, cameraOff }, local: { source, cameraOff },
 *               micOn, camOn }
 * actions: { onToggleMic, onToggleCam, onHangup, onReturn }
 */
export async function openOwnCallPip({
  env,
  getMedia,
  actions = {},
  size = CALL_PIP_WINDOW_SIZE,
  refreshMs = 1000,
  onClose,
} = {}) {
  const win = envWindow(env);
  if (!detectCallPipSupport(win).documentPip) return { ok: false, reason: "unsupported" };
  let pipWin;
  try {
    pipWin = await win.documentPictureInPicture.requestWindow({
      width: size.width,
      height: size.height,
      disallowReturnToOpener: false,
    });
  } catch (error) {
    return { ok: false, reason: error?.name === "NotAllowedError" ? "needs-gesture" : "error" };
  }
  if (!pipWin?.document) return { ok: false, reason: "error" };

  const doc = pipWin.document;
  let closed = false;
  let timer = 0;
  let remoteBound = null;
  let localBound = null;

  try {
    const style = doc.createElement("style");
    style.textContent = OWN_PIP_STYLES;
    doc.head.appendChild(style);
    doc.title = "Урок — поверх окон";
  } catch {
    /* ignore */
  }

  const root = doc.createElement("div");
  root.className = "cpip";
  root.innerHTML = `
    <div class="cpip__stage">
      <video class="cpip__remote" data-role="remote" muted autoplay playsinline></video>
      <div class="cpip__avatar" data-role="avatar" hidden>
        <div class="cpip__avatar-circle" data-role="initials">?</div>
      </div>
      <div class="cpip__name" data-role="name"></div>
      <div class="cpip__self" data-role="self" data-off="true">
        <video data-role="local" muted autoplay playsinline></video>
        <div class="cpip__self-off">Камера выкл.</div>
      </div>
    </div>
    <div class="cpip__bar" role="toolbar" aria-label="Кнопки звонка">
      <button type="button" class="cpip__btn" data-action="mic"></button>
      <button type="button" class="cpip__btn" data-action="cam"></button>
      <button type="button" class="cpip__btn cpip__btn--hangup" data-action="hangup" title="Завершить звонок" aria-label="Завершить звонок">${ICONS.hangup}</button>
      <button type="button" class="cpip__btn" data-action="back" title="Вернуться во вкладку урока" aria-label="Вернуться во вкладку урока">${ICONS.back}</button>
    </div>`;
  doc.body.appendChild(root);

  const q = (sel) => root.querySelector(sel);
  const remoteVideo = q('[data-role="remote"]');
  const localVideo = q('[data-role="local"]');
  const avatar = q('[data-role="avatar"]');
  const initials = q('[data-role="initials"]');
  const nameEl = q('[data-role="name"]');
  const selfBox = q('[data-role="self"]');
  const micBtn = q('[data-action="mic"]');
  const camBtn = q('[data-action="cam"]');

  const render = () => {
    if (closed) return;
    const media = safe(() => getMedia?.(), null) || {};
    const remote = media.remote || {};
    const local = media.local || {};
    const remoteSource = remote.cameraOff ? null : (remote.source || null);
    remoteBound = bindVideoSource(remoteVideo, remoteSource, remoteBound);
    remoteVideo.hidden = !remoteSource;
    avatar.hidden = Boolean(remoteSource);
    initials.textContent = initialsOf(remote.name);
    nameEl.textContent = remote.name || (remote.waiting ? "Ждём собеседника" : "Собеседник");
    const localSource = local.cameraOff ? null : (local.source || null);
    localBound = bindVideoSource(localVideo, localSource, localBound);
    selfBox.dataset.off = localSource ? "false" : "true";
    const micOn = Boolean(media.micOn);
    const camOn = Boolean(media.camOn);
    micBtn.innerHTML = micOn ? ICONS.mic : ICONS.micOff;
    micBtn.dataset.off = micOn ? "false" : "true";
    micBtn.title = micOn ? "Выключить микрофон" : "Включить микрофон";
    micBtn.setAttribute("aria-label", micBtn.title);
    camBtn.innerHTML = camOn ? ICONS.cam : ICONS.camOff;
    camBtn.dataset.off = camOn ? "false" : "true";
    camBtn.title = camOn ? "Выключить камеру" : "Включить камеру";
    camBtn.setAttribute("aria-label", camBtn.title);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timer) safe(() => win.clearInterval(timer));
    timer = 0;
    unbindVideoSource(remoteVideo, remoteBound);
    unbindVideoSource(localVideo, localBound);
    remoteBound = null;
    localBound = null;
    safe(() => onClose?.());
  };

  const close = () => {
    cleanup();
    safe(() => {
      if (!pipWin.closed) pipWin.close();
    });
  };

  root.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "mic") safe(() => actions.onToggleMic?.());
    else if (action === "cam") safe(() => actions.onToggleCam?.());
    else if (action === "hangup") safe(() => actions.onHangup?.());
    else if (action === "back") {
      safe(() => actions.onReturn?.());
      safe(() => win.focus?.());
      close();
      return;
    }
    win.setTimeout?.(render, 250);
  });

  pipWin.addEventListener("pagehide", cleanup, { once: true });
  render();
  if (refreshMs > 0) timer = win.setInterval(render, refreshMs);

  return { ok: true, window: pipWin, refresh: render, close, isOpen: () => !closed };
}

/**
 * Обычный видео-PiP по готовому <video> (Safari, запасной путь Chrome).
 * Видео должно уже играть: новый элемент без метаданных PiP не откроет.
 */
export async function requestVideoElementPip(video, env) {
  const win = envWindow(env);
  const doc = win?.document;
  if (!video) return { ok: false, reason: "no-video" };
  try {
    if (doc?.pictureInPictureElement === video) return { ok: true, already: true };
    if (typeof video.requestPictureInPicture === "function" && doc?.pictureInPictureEnabled !== false) {
      await video.requestPictureInPicture();
      return { ok: true, mode: "video" };
    }
    if (typeof video.webkitSetPresentationMode === "function"
      && (typeof video.webkitSupportsPresentationMode !== "function"
        || video.webkitSupportsPresentationMode("picture-in-picture"))) {
      video.webkitSetPresentationMode("picture-in-picture");
      return { ok: true, mode: "webkit" };
    }
  } catch (error) {
    return { ok: false, reason: error?.name === "NotAllowedError" ? "needs-gesture" : "error" };
  }
  return { ok: false, reason: "unsupported" };
}

/** Safari: видео само уходит в PiP, когда пользователь уходит со вкладки. */
export function setVideoAutoPip(video, enabled) {
  if (!video) return false;
  try {
    if ("autoPictureInPicture" in video) {
      video.autoPictureInPicture = Boolean(enabled);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Закрыть видео-PiP и окно Document PiP, если открыты. */
export async function exitAnyCallPip(env) {
  const win = envWindow(env);
  const doc = win?.document;
  const docWin = currentDocumentPipWindow(win);
  if (docWin) safe(() => docWin.close());
  try {
    if (doc?.pictureInPictureElement && typeof doc.exitPictureInPicture === "function") {
      await doc.exitPictureInPicture();
    }
  } catch {
    /* ignore */
  }
}
