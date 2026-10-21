/**
 * Инициализация Jitsi для видеоуроков.
 *
 * roomName — только из backend join-config.
 * По умолчанию External API + prejoin выкл. (без кнопки «Присоединиться»).
 * iframe — только явный ?jitsiEmbed=1 или публичный Jitsi без JWT.
 * JWT-уроки нельзя молча переводить в iframe: иначе участники попадают
 * в разные MUC (token vs guest) и не видят друг друга.
 */

import {
  attachConferencePresence,
  createBrowserTabSessionId,
  isJitsiAuthJoinFailure,
  shouldFallbackToIframe,
} from "./jitsiParticipants";
import { buildJitsiPipConfigOverwrite, disableJitsiAutoIntersectionPip } from "./callPip";
import { attachScreenSharePresence } from "./jitsiScreenShare";
import { attachMediaWatchdog } from "./jitsiMediaWatchdog";
import { createCallSessionId } from "./jitsiCallState";
import {
  canonicalJitsiRoomName,
  jitsiRoomsMatch,
  reportMeetingTechnicalEvent,
} from "./jitsiTelemetry";
import { reportClientEvent } from "../utils/clientTelemetry";
import { describeConferenceClient, logConferenceStage } from "./conferenceDiagnostics";
import {
  logLifecycle,
  registerJitsiSession,
  unregisterJitsiSession,
} from "./pwa/runtimeResources";
import { attachOfficialRemoteControl } from "./jitsiRemoteControl";
import { getJitsiElectronRemoteControlSetup } from "./jitsiElectronRemoteControlRender";
import {
  beginScriptAttempt,
  installScriptErrorCapture,
  noteScriptEvent,
  scriptResourceTiming,
} from "./lessonLoadTrace";

export {
  createBrowserTabSessionId,
  shouldFallbackToIframe,
  createCallSessionId,
  isJitsiAuthJoinFailure,
};

const SCRIPT_ID = "jitsi-external-api-script";
/**
 * 15 с без videoConferenceJoined — не доказанный connection failure.
 * Мягкий порог: обновить hint и продолжать ждать. Не dispose / не reject.
 */
export const JOIN_SLOW_THRESHOLD_MS = 15000;
/** Safety watchdog: только если join так и не состоялся. */
export const JOIN_FATAL_TIMEOUT_MS = 60000;
export const JOIN_SLOW_HINT = "Подключение занимает больше времени…";
/** Историческое имя: мягкий порог join и лимит пробы связи. Не fatal для урока. */
export const JOIN_TIMEOUT_MS = JOIN_SLOW_THRESHOLD_MS;
export const JOIN_KEEP_TAB_HINT = "Не сворачивайте вкладку до подключения";
/**
 * Загрузка external_api.js с 8x8.vc. Не равна hint в 15 с:
 * на медленном канале скрипт легитимно идёт дольше, fatal join — 60 с.
 */
export const JITSI_SCRIPT_LOAD_TIMEOUT_MS = 45000;

let sessionInitializing = false;
let activeExternalApi = null;
let activeSessionDispose = null;

function disposeActiveExternalApi() {
  const disposeSession = activeSessionDispose;
  activeSessionDispose = null;
  const current = activeExternalApi;
  activeExternalApi = null;
  if (typeof disposeSession === "function") {
    try {
      disposeSession("replaced");
    } catch {
      /* ignore */
    }
    return;
  }
  if (!current) return;
  try {
    current.dispose();
  } catch {
    /* ignore */
  }
}

export function jitsiExternalApiScriptUrl(domain, scriptUrl = "") {
  if (String(domain || "").replace(/^https?:\/\//, "").split("/")[0] === "lesson.itflux-academy.ru") return `${window.location.origin}/jitsi_external_api.min.js`;
  const explicit = String(scriptUrl || "").trim();
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0];
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      const scriptHost = parsed.hostname.toLowerCase();
      const expected = host.toLowerCase();
      const allowed = parsed.protocol === "https:" && (
        scriptHost === expected
        || scriptHost === "8x8.vc"
        || scriptHost.endsWith(".8x8.vc")
        || scriptHost === "meet.jit.si"
      );
      if (allowed) return parsed.toString();
    } catch {
      /* backend прислал не URL — используем домен */
    }
  }
  if (!host) return "";
  return host === "lesson.itflux-academy.ru" ? "/jitsi_external_api.min.js" : `https://${host}/libs/external_api.min.js`;
}

export function resolveJitsiApiRoomName(config) {
  const external = String(config?.externalRoomName || "").trim();
  if (external) return external;
  return String(config?.roomName || "").trim();
}

function encodeConferencePath(roomName) {
  return String(roomName || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function jitsiScriptError() {
  const err = new Error("Не удалось загрузить Jitsi Meet");
  err.code = "jitsi_script";
  return err;
}

function jitsiScriptTimeoutError() {
  const err = new Error("Не удалось загрузить Jitsi Meet");
  err.code = "jitsi_script_timeout";
  return err;
}

export function loadJitsiExternalApi(domain, { timeoutMs = JITSI_SCRIPT_LOAD_TIMEOUT_MS, scriptUrl = "", attemptId = "" } = {}) {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0];
  if (!host) {
    return Promise.reject(new Error("Не задан домен Jitsi"));
  }
  const src = jitsiExternalApiScriptUrl(host, scriptUrl);
  installScriptErrorCapture();
  beginScriptAttempt({ attemptId, scriptUrl: src });
  if (typeof window !== "undefined" && window.JitsiMeetExternalAPI) {
    const existing = document.getElementById(SCRIPT_ID);
    const existingSrc = existing?.getAttribute("src") || "";
    const wantsDifferentScript = Boolean(scriptUrl) && existingSrc && existingSrc !== src;
    if (!wantsDifferentScript) {
      noteScriptEvent("api_global", { via: "already_present" });
      return Promise.resolve(window.JitsiMeetExternalAPI);
    }
    noteScriptEvent("tag_removed", {
      reason: "replaced_different_src",
      connected: Boolean(existing?.isConnected),
    });
    existing.remove();
    try {
      delete window.JitsiMeetExternalAPI;
    } catch {
      window.JitsiMeetExternalAPI = undefined;
    }
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let poll = 0;
    let sawLoad = false;
    let sawError = false;
    let inserted = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      const apiGlobal = Boolean(window.JitsiMeetExternalAPI);
      if (apiGlobal) {
        resolve(window.JitsiMeetExternalAPI);
        return;
      }
      const failure = error || jitsiScriptError();
      failure.scriptLoadEvent = sawLoad;
      failure.scriptErrorEvent = sawError;
      failure.apiGlobal = false;
      failure.iframeCreated = false;
      if (failure.code === "jitsi_script_timeout") {
        noteScriptEvent("timeout", {
          inDocument: Boolean(inserted?.isConnected),
          resourceTiming: scriptResourceTiming(src),
        });
        if (inserted?.isConnected) {
          noteScriptEvent("tag_removed", { reason: "timeout", connected: true });
          try {
            inserted.remove();
          } catch {
            /* повтор не должен ждать тот же элемент без load/error */
          }
        }
      }
      reject(failure);
    };
    const timer = window.setTimeout(() => finish(jitsiScriptTimeoutError()), timeoutMs);
    // iPad Safari может выполнить external_api.js и не прислать load. Это не DNS.
    poll = window.setInterval(() => {
      if (window.JitsiMeetExternalAPI) {
        noteScriptEvent("api_global", { via: "poll" });
        finish(null);
      }
    }, 200);

    const attach = (script) => {
      if (window.JitsiMeetExternalAPI) {
        finish(null);
        return;
      }
      if (script.dataset.jitsiError === "1") {
        sawError = true;
        finish(jitsiScriptError());
        return;
      }
      const ready = script.readyState;
      if (script.dataset.jitsiReady === "1" || ready === "complete" || ready === "loaded") {
        sawLoad = true;
        noteScriptEvent("script_load", { via: "readyState", apiGlobal: Boolean(window.JitsiMeetExternalAPI) });
        finish(null);
        return;
      }
      script.addEventListener("load", () => {
        sawLoad = true;
        script.dataset.jitsiReady = "1";
        noteScriptEvent("script_load", { apiGlobal: Boolean(window.JitsiMeetExternalAPI) });
        if (window.JitsiMeetExternalAPI) noteScriptEvent("api_global", { via: "load" });
        finish(null);
      }, { once: true });
      script.addEventListener("error", () => {
        sawError = true;
        script.dataset.jitsiError = "1";
        noteScriptEvent("script_error", { connected: script.isConnected });
        finish(jitsiScriptError());
      }, { once: true });
    };

    const existing = document.getElementById(SCRIPT_ID);
    const existingUsable = existing
      && existing.getAttribute("src") === src
      && (existing.dataset.jitsiReady === "1" || window.JitsiMeetExternalAPI);
    if (existingUsable) {
      attach(existing);
      return;
    }
    if (existing) {
      noteScriptEvent("tag_removed", {
        reason: "replaced_before_ready",
        connected: existing.isConnected,
        ready: existing.dataset.jitsiReady === "1",
      });
      existing.remove();
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    noteScriptEvent("tag_created", { scriptUrl: src });
    // Слушатели раньше src: у кэшированного файла Safari иначе теряет load и ждёт 45 с.
    attach(script);
    script.src = src;
    inserted = script;
    document.head.appendChild(script);
    noteScriptEvent("tag_inserted", { connected: script.isConnected, scriptUrl: script.src });
    if (window.JitsiMeetExternalAPI) finish(null);
  });
}

/** Непустое имя для prejoin / XMPP (не логировать само значение в prod). */
export function resolveJitsiDisplayName(config) {
  const raw = String(config?.userInfo?.displayName || "").trim();
  if (raw) return raw;
  const role = config?.meeting?.isModerator ? "Организатор" : "Участник";
  return role;
}

/** sessionStorage: включена ли камера при входе в урок (на вкладку / док). */
export function getMeetingCameraEnabled(meetingUuid) {
  if (!meetingUuid || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`itflux.meeting.camera.${meetingUuid}`);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore */
  }
  return null;
}

export function setMeetingCameraEnabled(meetingUuid, enabled) {
  if (!meetingUuid || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `itflux.meeting.camera.${meetingUuid}`,
      enabled ? "1" : "0",
    );
  } catch {
    /* ignore */
  }
}

/** sessionStorage: был ли микрофон включён в этом звонке (чтобы не глушить после remount). */
export function getMeetingMicEnabled(meetingUuid) {
  if (!meetingUuid || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`itflux.meeting.mic.${meetingUuid}`);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore */
  }
  return null;
}

export function setMeetingMicEnabled(meetingUuid, enabled) {
  if (!meetingUuid || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `itflux.meeting.mic.${meetingUuid}`,
      enabled ? "1" : "0",
    );
  } catch {
    /* ignore */
  }
}

const JITSI_SAME_ORIGIN_SOURCE_HOST = "lesson.itflux-academy.ru";
const JITSI_RELAY_PAGE_HOST = "cdn.itflux-academy.ru";
const JITSI_SAME_ORIGIN_PAGE_HOSTS = ["itflux-academy.ru", "www.itflux-academy.ru", "itflux.ru", "www.itflux.ru"];

export function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent || "")
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * iPad/iPhone: новые TLS-соединения к lesson.* теряются в сети, поэтому iframe, BOSH и websocket
 * ведём через уже открытый хост страницы: https://<host>/jitsi/ (nginx проксирует на lesson.*).
 * XMPP-домены (hosts.domain/muc) и JWT остаются lesson.itflux-academy.ru.
 */
export function resolveJitsiFrameDomain(domain) {
  const clean = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (clean.toLowerCase() !== JITSI_SAME_ORIGIN_SOURCE_HOST) return clean;
  if (typeof window === "undefined") return clean;
  const pageHost = String(window.location?.host || "").toLowerCase();
  // r92: cdn.* идёт через relay (провайдеры, режущие TLS к основному VPS) — Jitsi всегда same-origin.
  if (pageHost === JITSI_RELAY_PAGE_HOST) return pageHost + "/jitsi";
  if (!isAppleTouchDevice()) return clean;
  if (!JITSI_SAME_ORIGIN_PAGE_HOSTS.includes(pageHost)) return clean;
  return `${pageHost}/jitsi`;
}

export function shouldPreferBosh(domain) {
  const host = String(domain || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .split("/")[0]
    .toLowerCase();
  if (!host) return true;
  if (host === "meet.jit.si" || host === "8x8.vc" || host.endsWith(".8x8.vc")) return false;
  return true;
}

export function buildJitsiHostsOverwrite(domain) {
  const host = String(domain || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .split("/")[0]
    .toLowerCase();
  if (
    !host
    || host === "meet.jit.si"
    || host === "8x8.vc"
    || host.endsWith(".8x8.vc")
  ) {
    return null;
  }
  return {
    domain: host,
    muc: `conference.${host}`,
  };
}

/** Верхний штатный уровень камеры Jitsi (Full HD). Ниже в меню качества остаются 180–720. */
export const JITSI_CAMERA_MAX_HEIGHT = 1080;

export function jitsiCameraConstraints() {
  return {
    video: {
      height: { ideal: JITSI_CAMERA_MAX_HEIGHT, max: JITSI_CAMERA_MAX_HEIGHT, min: 180 },
      width: { ideal: 1920, max: 1920 },
    },
  };
}

/** Ставит в меню качества камеры максимальное разрешение, не переподключая звонок. */
export function applyJitsiCameraResolution(api) {
  if (!api || typeof api.executeCommand !== "function") return;
  try {
    api.executeCommand("setVideoQuality", JITSI_CAMERA_MAX_HEIGHT);
  } catch {
    /* ignore */
  }
}

/** Короткий набор: компактное и обычное окно звонка. */
export const JITSI_COMPACT_TOOLBAR = ["microphone", "camera", "desktop", "hangup"];

/**
 * Все штатные кнопки Jitsi. Неизвестные имена клиент сам пропускает.
 * Включаются только в развёрнутом окне звонка.
 */
export const JITSI_EXPANDED_TOOLBAR = [
  "microphone",
  "camera",
  "desktop",
  "chat",
  "raisehand",
  "reactions",
  "participants-pane",
  "tileview",
  "toggle-camera",
  "select-background",
  "closedcaptions",
  "noisesuppression",
  "whiteboard",
  "shareaudio",
  "sharedvideo",
  "recording",
  "livestreaming",
  "security",
  "mute-everyone",
  "mute-video-everyone",
  "videoquality",
  "filmstrip",
  "invite",
  "profile",
  "settings",
  "stats",
  "shortcuts",
  "help",
  "feedback",
  "download",
  "etherpad",
  "highlight",
  "hangup",
];

/** Панель видна сразу и в компактном окне: на планшете нет hover, автоскрытие прячет кнопки. */
export const JITSI_TOOLBAR_VISIBLE = { alwaysVisible: true, initialTimeout: 0, timeout: 0 };

/**
 * В обычном окне урока свои кнопки снаружи iframe.
 * Микрофон Jitsi всё равно остаётся: клик по нему идёт внутри 8x8.vc
 * и может выдать разрешение. Пустой toolbar и alwaysVisible:false
 * оставляли микрофон выключенным навсегда.
 */
export const JITSI_CUSTOM_TOOLBAR = ["microphone"];

/** В плавающем окне панель Jitsi лежит поверх кадра. Кнопки рисует страница, под видео. */
export const JITSI_FLOATING_TOOLBAR_CONFIG = { alwaysVisible: false, initialTimeout: 0, timeout: 0 };

/** Плавающее окно: штатная панель Jitsi, короткий набор кнопок (без своей панели страницы). */
export const JITSI_FLOATING_TOOLBAR = ["microphone", "camera", "desktop", "tileview", "hangup"];

export function jitsiCallChromeConfig(expanded, { custom = false, floating = false } = {}) {
  if (floating) {
    return {
      toolbarButtons: JITSI_FLOATING_TOOLBAR,
      toolbarConfig: JITSI_TOOLBAR_VISIBLE,
    };
  }
  if (custom && !expanded) {
    return {
      toolbarButtons: JITSI_CUSTOM_TOOLBAR,
      toolbarConfig: JITSI_TOOLBAR_VISIBLE,
    };
  }
  return {
    toolbarButtons: expanded ? JITSI_EXPANDED_TOOLBAR : JITSI_COMPACT_TOOLBAR,
    toolbarConfig: JITSI_TOOLBAR_VISIBLE,
  };
}

/** Сообщает iframe о новом размере контейнера. Не на каждый pointermove. */
export function notifyJitsiContainerResize(api) {
  const session = api?.api || api;
  try {
    const iframe = session?.getIFrame?.();
    iframe?.contentWindow?.dispatchEvent(new Event("resize"));
  } catch {
    /* чужой origin: External API слушает resize родителя */
  }
  try {
    window.dispatchEvent(new Event("resize"));
  } catch {
    /* ignore */
  }
}

/** Меняет панель Jitsi без переподключения. В компактном виде остаётся короткий набор. */
export function applyJitsiCallChrome(api, { expanded = false, custom = false, floating = false } = {}) {
  const session = api?.api || api;
  if (!session || typeof session.executeCommand !== "function") return;
  session.executeCommand("overwriteConfig", jitsiCallChromeConfig(expanded, { custom, floating }));
}

/**
 * Минимальный configOverwrite для стабильного входа.
 * Без lobby/prejoin/deeplink — чтобы не зависеть от кнопки предэкрана.
 * subject — человекочитаемое название урока (не UUID комнаты).
 */
export function buildJitsiConfigOverwrite({
  subject,
  startWithVideoMuted = false,
  startWithAudioMuted = true,
  domain,
  customChrome = false,
  expandedToolbar = false,
  floatingToolbar = false,
} = {}) {
  const title = String(subject || "").trim() || "Урок";
  const hosts = buildJitsiHostsOverwrite(domain);
  return {
    prejoinConfig: { enabled: false },
    prejoinPageEnabled: false,
    requireDisplayName: false,
    disableDeepLinking: true,
    startWithAudioMuted: Boolean(startWithAudioMuted),
    startWithVideoMuted: Boolean(startWithVideoMuted),
    // prejoin выключен. Без этого Jitsi может не создать аудиотрек до unmute,
    // а unmute из родительской страницы не является жестом внутри iframe.
    disableInitialGUM: false,
    disableLobbyMode: true,
    lobby: { enabled: false },
    autoKnockLobby: false,
    enableWelcomePage: false,
    hideLoginButton: true,
    defaultLanguage: "ru",
    subject: title,
    localSubject: title,
    inviteAppName: "Цифровой поток",
    hideConferenceSubject: true,
    hideConferenceTimer: true,
    disableModeratorIndicator: false,
    enableClosePage: false,
    toolbarButtons: floatingToolbar
      ? JITSI_FLOATING_TOOLBAR
      : customChrome
        ? JITSI_CUSTOM_TOOLBAR
        : (expandedToolbar ? JITSI_EXPANDED_TOOLBAR : JITSI_COMPACT_TOOLBAR),
    toolbarConfig: JITSI_TOOLBAR_VISIBLE,
    // 1:1 режим Jitsi оставляет один крупный кадр. Выключение локальной камеры
    // переносит аватар ученика на сцену и прячет учителя в обрезанный filmstrip.
    disable1On1Mode: true,
    filmstrip: {
      disabled: false,
      disableStageFilmstrip: false,
    },
    // 1:1 учитель–ученик почти всегда за разными NAT. P2P даёт «видим в списке,
    // но нет звука/видео». Медиа идёт через JVB.
    p2p: { enabled: false },
    // XMPP websocket на своём Prosody может отдавать 501. На 8x8 и meet.jit.si BOSH не форсируем.
    // iPad/iPhone: новое TLS-соединение для websocket часто теряется в сети, BOSH идёт по уже открытому HTTP/2.
    preferBosh: typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)),
    // Повторный вход с тем же JWT user.id (обновление, мини-окно, проверка связи)
    // иначе Prosody отвечает not-allowed → «Ошибка аутентификации».
    replaceParticipant: true,
    channelLastN: 8,
    resolution: JITSI_CAMERA_MAX_HEIGHT,
    startBitrate: 2500,
    disableSimulcast: false,
    enableNoAudioDetection: true,
    enableNoisyMicDetection: true,
    enableIceRestart: true,
    stereo: false,
    constraints: jitsiCameraConstraints(),
    // Демонстрация экрана: 5–15 fps, VP9 SVC, высокий битрейт для чёткого текста.
    desktopSharingFrameRate: { min: 5, max: 15 },
    videoQuality: {
      codecPreferenceOrder: ["VP9", "VP8", "H264"],
      mobileCodecPreferenceOrder: ["VP8", "H264", "VP9"],
      screenshareCodec: "VP9",
      mobileScreenshareCodec: "VP8",
      enableAdaptiveMode: false,
      // Камера ограничена 1.5 Мбит/с, чтобы не отнимать полосу у экрана у слабых учеников.
      vp8: { maxBitratesVideo: { low: 200000, standard: 500000, high: 1200000, fullHd: 1500000, ssHigh: 3500000 } },
      vp9: { maxBitratesVideo: { low: 100000, standard: 300000, high: 1000000, fullHd: 1500000, ssHigh: 3000000 } },
      h264: { maxBitratesVideo: { low: 200000, standard: 500000, high: 1200000, fullHd: 1500000, ssHigh: 3500000 } },
      maxFullResolution: JITSI_CAMERA_MAX_HEIGHT,
      minHeightForQualityLvl: {
        360: "standard",
        720: "high",
        1080: "fullHd",
      },
    },
    // Скрываем дефолтный тост «Получены права модератора» — показываем свой.
    disabledNotifications: [
      "notify.moderator",
      "notify.grantedToModerator",
      "notify.connectedOneMember",
      "notify.connectedTwoMembers",
      "notify.connectedThreePlusMembers",
    ],
    // Official Jitsi remote-control (Electron SDK). Browser cannot inject OS input.
    disableRemoteControl: false,
    ...(hosts ? { hosts } : {}),
    // r72: «поверх окон» (Document PiP) силами Jitsi. Только Chrome/Edge/Яндекс.
    ...(buildJitsiPipConfigOverwrite() || {}),
  };
}

export function buildJitsiInterfaceConfigOverwrite() {
  return {
    MOBILE_APP_PROMO: false,
    SHOW_JITSI_WATERMARK: false,
    SHOW_WATERMARK_FOR_GUESTS: false,
    SHOW_BRAND_WATERMARK: false,
    SHOW_POWERED_BY: false,
    APP_NAME: "Цифровой поток",
    NATIVE_APP_NAME: "Цифровой поток",
    PROVIDER_NAME: "Цифровой поток",
    DEFAULT_LOGO_URL: "",
    DEFAULT_WELCOME_PAGE_LOGO_URL: "",
    JITSI_WATERMARK_LINK: "",
    DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
    VIDEO_LAYOUT_FIT: "both",
    VERTICAL_FILMSTRIP: true,
    FILM_STRIP_MAX_HEIGHT: 80,
    DEFAULT_BACKGROUND: "#1d293c",
  };
}

export function resolveJitsiSubject(config) {
  const fromMeeting = String(config?.meeting?.subject || config?.meeting?.title || "").trim();
  if (fromMeeting) return fromMeeting;
  const fromEvent = String(config?.event?.title || "").trim();
  if (fromEvent) return fromEvent;
  return "Урок";
}

function sanitizeJitsiEvent(event) {
  if (!event || typeof event !== "object") return event;
  const safe = { ...event };
  delete safe.jwt;
  delete safe.token;
  delete safe.password;
  delete safe.email;
  return safe;
}

function logJitsiDiagnostic(eventName, details = {}, { error = false } = {}) {
  const safe = { ...details };
  delete safe.jwt;
  delete safe.token;
  delete safe.password;
  const logger = error ? console.error : console.info;
  logger(`[Jitsi] ${eventName}`, safe);
}

/**
 * Jitsi ждёт JSON-строку объекта в appData.localStorageContent.
 * null / "null" ломает Object.keys внутри iframe.
 */
export function hasValidJitsiLocalStorageContent(value) {
  if (typeof value !== "string" || !value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined" || trimmed === '"null"') {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed != null && typeof parsed === "object";
  } catch {
    return false;
  }
}

export function buildJitsiAppData(localStorageContent) {
  if (!hasValidJitsiLocalStorageContent(localStorageContent)) return undefined;
  return { localStorageContent };
}

export function readJitsiLocalStorageContent() {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage?.getItem?.("jitsiLocalStorage");
    return hasValidJitsiLocalStorageContent(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

// Jitsi парсит значение дважды (parseURLParams, затем JSON.parse) → нужна JSON-строка "{}".
const JITSI_EMPTY_LOCAL_STORAGE_CONTENT = "%22%7B%7D%22";

export function stripNullJitsiLocalStorageContentFromUrl(url) {
  const raw = String(url || "");
  const hashIdx = raw.indexOf("#");
  if (hashIdx < 0) return raw;
  const base = raw.slice(0, hashIdx);
  const hash = raw.slice(hashIdx + 1);
  // Ключ НЕ удаляем: WebKit (iPad/Safari) в iframe всегда читает appData.localStorageContent;
  // без ключа JSON.parse(undefined) падает раньше setLocalStorageDisabled, и Jitsi рушится
  // (P9.connectionQuality) до сигналинга. null/невалидное заменяем на пустой объект {}.
  const kept = hash.split("&").filter(Boolean).map((part) => {
    const eq = part.indexOf("=");
    const key = eq >= 0 ? part.slice(0, eq) : part;
    if (key !== "appData.localStorageContent") return part;
    const value = eq >= 0 ? part.slice(eq + 1) : "";
    let decoded = value;
    try {
      decoded = decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      decoded = value;
    }
    const trimmed = String(decoded || "").trim();
    const empty = !trimmed || ["null", "undefined", '"null"', '"undefined"', '""'].includes(trimmed);
    if (!empty) return part;
    return `${key}=${JITSI_EMPTY_LOCAL_STORAGE_CONTENT}`;
  });
  return kept.length ? `${base}#${kept.join("&")}` : base;
}

const JITSI_IFRAME_ALLOW = [
  "camera",
  "microphone",
  "display-capture",
  "autoplay",
  "clipboard-write",
  "fullscreen",
  "picture-in-picture",
];

/** Дописывает разрешения iframe до загрузки конференции. Не запрашивает устройства само. */
export function ensureJitsiIframeMediaAllow(iframe) {
  if (!iframe) return iframe;
  try {
    const current = String(iframe.allow || iframe.getAttribute?.("allow") || "");
    const parts = current.split(/;\s*/).map((part) => part.trim()).filter(Boolean);
    const have = new Set(parts.map((part) => part.toLowerCase()));
    for (const token of JITSI_IFRAME_ALLOW) {
      if (!have.has(token)) parts.push(token);
    }
    const next = parts.join("; ");
    if (next !== current) {
      iframe.allow = next;
      iframe.setAttribute?.("allow", next);
    }
  } catch {
    /* ignore */
  }
  return iframe;
}

export function sanitizeJitsiIframeElement(iframe) {
  if (!iframe) return iframe;
  ensureJitsiIframeMediaAllow(iframe);
  try {
    const src = iframe.src || iframe.getAttribute?.("src") || "";
    const next = stripNullJitsiLocalStorageContentFromUrl(src);
    if (next && next !== src) {
      iframe.src = next;
    }
  } catch {
    /* ignore */
  }
  return iframe;
}

function interceptIframeSrc(iframe) {
  if (!iframe) return;
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    if (!desc?.get || !desc?.set) return;
    Object.defineProperty(iframe, "src", {
      configurable: true,
      enumerable: true,
      get() {
        return desc.get.call(this);
      },
      set(value) {
        desc.set.call(this, stripNullJitsiLocalStorageContentFromUrl(String(value || "")));
      },
    });
  } catch {
    /* ignore */
  }
}

export function installJitsiIframeCreateSanitizer() {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return () => {};
  }
  const originalCreate = document.createElement;
  document.createElement = function createElementSanitized(tagName, options) {
    const el = originalCreate.call(document, tagName, options);
    if (String(tagName || "").toLowerCase() === "iframe") {
      interceptIframeSrc(el);
    }
    return el;
  };
  return () => {
    document.createElement = originalCreate;
  };
}

export function hookContainerForJitsiIframeSanitize(container) {
  if (!container || typeof container.appendChild !== "function") {
    return () => {};
  }
  const originalAppend = container.appendChild;
  container.appendChild = function appendSanitized(node) {
    if (node && String(node.tagName || "").toUpperCase() === "IFRAME") {
      interceptIframeSrc(node);
      sanitizeJitsiIframeElement(node);
      ensureJitsiIframeMediaAllow(node);
    }
    return originalAppend.call(this, node);
  };
  return () => {
    container.appendChild = originalAppend;
  };
}

export function buildJitsiExternalApiOptions({
  roomName,
  parentNode,
  configOverwrite,
  interfaceConfigOverwrite,
  jwt,
  userInfo,
  lang = "ru",
  localStorageContent,
} = {}) {
  const options = {
    roomName,
    parentNode,
    width: "100%",
    height: "100%",
    lang,
    configOverwrite,
    interfaceConfigOverwrite,
  };
  if (userInfo) options.userInfo = userInfo;
  if (jwt) options.jwt = jwt;
  const content = localStorageContent === undefined
    ? readJitsiLocalStorageContent()
    : localStorageContent;
  const appData = buildJitsiAppData(content);
  if (appData) options.appData = appData;
  return options;
}

export function registerJoinDiagnostics(api, { onMediaWarning, diagnostics } = {}) {
  const events = [
    "videoConferenceJoined",
    "videoConferenceLeft",
    "readyToClose",
    "participantJoined",
    "participantLeft",
    "participantRoleChanged",
    "passwordRequired",
    "conferenceFailed",
    "cameraError",
    "micError",
    "browserSupport",
    "errorOccurred",
    "peerConnectionFailure",
    "connectionFailed",
  ];

  for (const eventName of events) {
    try {
      api.addListener(eventName, (event) => {
        if (eventName === "errorOccurred") {
          console.error("[Jitsi] errorOccurred", {
            type: event?.type,
            name: event?.name,
            message: event?.message,
            isFatal: event?.isFatal,
          });
        } else if (eventName === "peerConnectionFailure" || eventName === "conferenceFailed") {
          console.error(`[Jitsi] ${eventName}`, sanitizeJitsiEvent(event));
        } else {
          console.info(`[Jitsi event] ${eventName}`, sanitizeJitsiEvent(event));
        }
        if (eventName === "videoConferenceJoined") {
          const eventRoomName = event?.roomName || null;
          const configuredRoomName = diagnostics?.roomName || null;
          console.info("[Jitsi] conference identity", {
            eventRoomName,
            configuredRoomName,
            canonicalEventRoom: canonicalJitsiRoomName(eventRoomName),
            canonicalConfiguredRoom: canonicalJitsiRoomName(configuredRoomName),
            meetingUuid: diagnostics?.meetingUuid || null,
            role: diagnostics?.role || null,
            domain: diagnostics?.domain || null,
          });
          const meetingUuid = diagnostics?.meetingUuid;
          if (meetingUuid) {
            const mismatch = Boolean(eventRoomName && configuredRoomName && !jitsiRoomsMatch(configuredRoomName, eventRoomName));
            void reportMeetingTechnicalEvent(meetingUuid, {
              eventType: mismatch ? "room_mismatch" : "conference_joined",
              role: diagnostics?.role || "",
              reason: mismatch ? "room_mismatch" : "",
              jitsiParticipantId: event?.id || "",
              browserTabSessionId: diagnostics?.browserTabSessionId || "",
              callSessionId: diagnostics?.callSessionId || "",
              metadata: {
                configuredRoomName,
                eventRoomName,
                domain: diagnostics?.domain || "",
                participantId: event?.id || "",
              },
            });
          }
        }
        if (eventName === "participantJoined" || eventName === "participantLeft") {
          const meetingUuid = diagnostics?.meetingUuid;
          if (meetingUuid) {
            void reportMeetingTechnicalEvent(meetingUuid, {
              eventType: eventName === "participantJoined" ? "participant_joined" : "participant_left",
              role: diagnostics?.role || "",
              jitsiParticipantId: event?.id || "",
              browserTabSessionId: diagnostics?.browserTabSessionId || "",
              callSessionId: diagnostics?.callSessionId || "",
              metadata: { participantId: event?.id || "" },
            });
          }
        }
        if (
          eventName === "conferenceFailed"
          || eventName === "connectionFailed"
          || eventName === "peerConnectionFailure"
          || eventName === "readyToClose"
        ) {
          const meetingUuid = diagnostics?.meetingUuid;
          const typeMap = {
            conferenceFailed: "conference_failed",
            connectionFailed: "connection_failed",
            peerConnectionFailure: "peer_connection_failure",
            readyToClose: "ready_to_close",
          };
          if (meetingUuid) {
            if (eventName === "connectionFailed" || eventName === "conferenceFailed") {
              reportClientEvent("jitsi_connection_failed", {
                reason: String(event?.error || event?.message || eventName).slice(0, 120),
              });
            }
            void reportMeetingTechnicalEvent(meetingUuid, {
              eventType: typeMap[eventName],
              role: diagnostics?.role || "",
              reason: event?.error || event?.message || eventName,
              jitsiParticipantId: diagnostics?.participantId || "",
              browserTabSessionId: diagnostics?.browserTabSessionId || "",
              callSessionId: diagnostics?.callSessionId || "",
              metadata: { name: event?.name || "", type: event?.type || "" },
            });
          }
        }
        if (eventName === "errorOccurred") {
          const blob = [event?.type, event?.name, event?.message].filter(Boolean).join(" · ");
          const lower = blob.toLowerCase();
          if (
            lower.includes("conferenceRequestFailed".toLowerCase())
            || lower.includes("service-unavailable")
            || lower.includes("focus")
          ) {
            onMediaWarning?.(
              "Сервер конференций (Jicofo/focus) недоступен. Комната не создаётся — участники не увидят друг друга.",
            );
          } else if (blob) {
            onMediaWarning?.(blob);
          }
        }
        if (eventName === "passwordRequired") {
          // Пустая комната: Jitsi может запросить пароль до фокуса Jicofo.
          // Не срываем ожидание ученика и не подставляем stale password.
          console.warn("[JITSI_PASSWORD_REQUIRED]", {
            authMode: diagnostics?.authMode || "",
            meetingUuid: diagnostics?.meetingUuid || null,
            roomName: diagnostics?.roomName || null,
          });
        }
        if (eventName === "conferenceFailed") {
          onMediaWarning?.(
            event?.error || "Не удалось подключиться к конференции (conferenceFailed).",
          );
        }
      });
    } catch (error) {
      console.warn(`[Jitsi] Event unavailable: ${eventName}`, error);
    }
  }
}

/**
 * Минимальный embed URL: один path/room для всех ролей.
 * Только для iframe / External API. Не использовать как top-level
 * window.location — iOS PWA воспримет другой origin и сбросит сессию.
 */
export function buildJitsiEmbedUrl(config) {
  const roomName = String(config.roomName || "").trim();
  const domain = String(config.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!roomName || !domain) {
    throw new Error("Backend не вернул domain/roomName");
  }
  if (roomName !== config.roomName) {
    throw new Error("roomName был изменён на frontend");
  }

  const displayName = resolveJitsiDisplayName(config);
  const subject = resolveJitsiSubject(config);
  const startWithVideoMuted = Boolean(config.startWithVideoMuted);
  const startWithAudioMuted = config.startWithAudioMuted !== false;
  const params = new URLSearchParams();
  if (config.jwt) params.set("jwt", config.jwt);
  const hosts = buildJitsiHostsOverwrite(domain);

  const hashParts = [
    "config.prejoinPageEnabled=false",
    "config.prejoinConfig.enabled=false",
    "config.requireDisplayName=false",
    "config.disableDeepLinking=true",
    "config.enableWelcomePage=false",
    "config.disableLobbyMode=true",
    "config.lobby.enabled=false",
    "config.autoKnockLobby=false",
    `config.startWithAudioMuted=${startWithAudioMuted ? "true" : "false"}`,
    `config.startWithVideoMuted=${startWithVideoMuted ? "true" : "false"}`,
    "config.disableInitialGUM=false",
    "config.hideLoginButton=true",
    "config.hideConferenceSubject=true",
    "config.hideConferenceTimer=true",
    `config.toolbarButtons=${JSON.stringify(JITSI_COMPACT_TOOLBAR)}`,
    "config.toolbarConfig.alwaysVisible=true",
    "config.toolbarConfig.initialTimeout=0",
    "config.toolbarConfig.timeout=0",
    "config.disable1On1Mode=true",
    'config.defaultLanguage="ru"',
    `config.subject=${encodeURIComponent(JSON.stringify(subject))}`,
    `config.localSubject=${encodeURIComponent(JSON.stringify(subject))}`,
    `config.inviteAppName=${encodeURIComponent(JSON.stringify("Цифровой поток"))}`,
    "config.p2p.enabled=false",
    "config.enableIceRestart=true",
    "config.replaceParticipant=true",
    `config.resolution=${JITSI_CAMERA_MAX_HEIGHT}`,
    `config.constraints.video.height.ideal=${JITSI_CAMERA_MAX_HEIGHT}`,
    `config.constraints.video.height.max=${JITSI_CAMERA_MAX_HEIGHT}`,
    "config.constraints.video.height.min=180",
    "config.constraints.video.width.ideal=1920",
    "config.constraints.video.width.max=1920",
    ...(hosts ? [
      `config.hosts.domain=${encodeURIComponent(JSON.stringify(hosts.domain))}`,
      `config.hosts.muc=${encodeURIComponent(JSON.stringify(hosts.muc))}`,
    ] : []),
    "interfaceConfig.MOBILE_APP_PROMO=false",
    "interfaceConfig.SHOW_JITSI_WATERMARK=false",
    "interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false",
    "interfaceConfig.SHOW_BRAND_WATERMARK=false",
    "interfaceConfig.SHOW_POWERED_BY=false",
    `interfaceConfig.APP_NAME=${encodeURIComponent(JSON.stringify("Цифровой поток"))}`,
    `interfaceConfig.NATIVE_APP_NAME=${encodeURIComponent(JSON.stringify("Цифровой поток"))}`,
    `interfaceConfig.PROVIDER_NAME=${encodeURIComponent(JSON.stringify("Цифровой поток"))}`,
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName))}`,
  ];

  if (shouldPreferBosh(domain)) {
    hashParts.push("config.preferBosh=false");
  }
  const q = params.toString();
  const pathRoom = encodeConferencePath(resolveJitsiApiRoomName(config));
  // Не передаём appData.localStorageContent: Jitsi падает на Object.keys(null).
  return stripNullJitsiLocalStorageContentFromUrl(
    `https://${resolveJitsiFrameDomain(domain)}/${pathRoom}${q ? `?${q}` : ""}#${hashParts.join("&")}`,
  );
}

function conferenceParticipantCount(api) {
  try {
    const listed = api.getParticipantsInfo?.();
    if (Array.isArray(listed) && listed.length > 0) return listed.length;
  } catch {
    /* ignore */
  }
  try {
    const count = api.getNumberOfParticipants?.();
    if (typeof count === "number" && count > 0) return count;
  } catch {
    /* ignore */
  }
  return 1;
}

/**
 * Один участник остаётся на крупном кадре: принудительная плитка прячет его и оставляет чёрный фон.
 * Двое и больше встают рядом. Во время демонстрации экрана раскладку не трогаем.
 */
export function showCallTilesSideBySide(api) {
  if (!api || typeof api.executeCommand !== "function") return;
  try {
    const sharing = typeof api.getContentSharingParticipants === "function"
      ? api.getContentSharingParticipants()
      : [];
    if (Array.isArray(sharing) && sharing.length > 0) return;
  } catch {
    /* ignore */
  }
  const sideBySide = conferenceParticipantCount(api) >= 2;
  try {
    api.executeCommand("setTileView", sideBySide);
  } catch {
    /* ignore */
  }
}

function wireParticipantListeners(api, hooks) {
  const placeTiles = () => showCallTilesSideBySide(api);
  const selectMaxCamera = () => applyJitsiCameraResolution(api);
  const extraListeners = [];
  const listenExtra = (name, handler) => {
    try {
      api.addListener?.(name, handler);
      extraListeners.push([name, handler]);
    } catch {
      /* ignore */
    }
  };
  listenExtra("videoConferenceJoined", placeTiles);
  listenExtra("videoConferenceJoined", selectMaxCamera);
  listenExtra("participantJoined", placeTiles);
  listenExtra("participantLeft", placeTiles);
  // Mute меняет дорожку, не состав участников. Без повторной раскладки
  // сцена остаётся на локальном аватаре и прячет remote.
  listenExtra("videoMuteStatusChanged", placeTiles);
  const presence = attachConferencePresence(api, hooks);
  const screenShare = attachScreenSharePresence(api, {
    onChange: hooks.onScreenShare,
  });
  const watchdog = attachMediaWatchdog(api, {
    diagnostics: hooks.diagnostics,
    getIntended: hooks.getIntendedMedia,
    onWarning: hooks.onMediaWarning,
    onHint: hooks.onConnectionHint,
    onConnectionState: hooks.onConnectionState,
    onAudioMuteStatusChanged: hooks.onAudioMuteStatusChanged,
    onVideoMuteStatusChanged: hooks.onVideoMuteStatusChanged,
    onReconnectRequired: hooks.onReconnectRequired,
    onRecoveryStarted: hooks.onRecoveryStarted,
    shouldReconnect: hooks.shouldReconnect,
    onTelemetry: (eventType, extra = {}) => {
      const meetingUuid = hooks.diagnostics?.meetingUuid;
      if (!meetingUuid) return;
      void reportMeetingTechnicalEvent(meetingUuid, {
        eventType,
        role: hooks.diagnostics?.role || "",
        reason: extra.reason || "",
        jitsiParticipantId: extra.jitsiParticipantId || "",
        browserTabSessionId: hooks.diagnostics?.browserTabSessionId || "",
        callSessionId: extra.callSessionId || hooks.diagnostics?.callSessionId || "",
        metadata: {
          reason: extra.reason || "",
          attempt: extra.attempt,
          intendedMicOn: extra.intendedMicOn,
          intendedCamOn: extra.intendedCamOn,
          visibilityState: extra.visibilityState,
          online: extra.online,
          jitsiParticipantId: extra.jitsiParticipantId || "",
        },
      });
    },
  });
  registerJoinDiagnostics(api, {
    onMediaWarning: hooks.onMediaWarning,
    diagnostics: hooks.diagnostics,
  });
  return {
    presence,
    screenShare,
    watchdog,
    dispose() {
      for (const [name, handler] of extraListeners) {
        try {
          api.removeListener?.(name, handler);
        } catch {
          /* ignore */
        }
      }
      extraListeners.length = 0;
    },
  };
}

export function createJitsiIframeEmbed(config, container, {
  onEmbedded,
  onMediaWarning,
} = {}) {
  if (!container) {
    throw new Error("Контейнер конференции недоступен");
  }
  const roomName = String(config.roomName || "").trim();
  if (!roomName || roomName !== config.roomName) {
    throw new Error("roomName отсутствует или был изменён на frontend");
  }

  const displayName = resolveJitsiDisplayName(config);
  console.info("[Jitsi] Display name check", {
    hasDisplayName: Boolean(displayName),
    length: displayName.length,
  });

  const embedUrl = buildJitsiEmbedUrl(config);
  container.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.src = embedUrl;
  frame.title = "Видеоурок";
  frame.allow = "camera; microphone; display-capture; autoplay; clipboard-write; fullscreen; picture-in-picture";
  frame.allowFullscreen = true;
  frame.setAttribute("playsinline", "true");
  frame.setAttribute("webkit-playsinline", "true");
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.border = "0";
  frame.style.pointerEvents = "auto";
  frame.setAttribute("allowfullscreen", "true");
  container.appendChild(frame);

  console.info("[Jitsi] Embed iframe", {
    meetingUuid: config.meeting?.uuid,
    configuredDomain: config.domain,
    configuredRoomName: roomName,
    roomSuffix: roomName.slice(-8),
    mode: "iframe",
    hasJwt: Boolean(config.jwt),
    authMode: config.authMode || "",
    diagnostics: config.diagnostics || null,
  });

  if (!config.jwt && config.authMode === "jwt") {
    onMediaWarning?.("JWT не выдан — вход на сервере с обязательным токеном может не сработать.");
  }

  const done = () => onEmbedded?.({ roomName, mode: "iframe" });
  frame.addEventListener("load", done, { once: true });
  window.setTimeout(done, 1000);

  return {
    api: null,
    mode: "iframe",
    roomName,
    dispose: () => {
      try {
        frame.src = "about:blank";
      } catch {
        /* ignore */
      }
      try {
        container.innerHTML = "";
      } catch {
        /* ignore */
      }
    },
    executeCommand: (cmd) => {
      if (cmd === "hangup") {
        try {
          frame.src = "about:blank";
        } catch {
          /* ignore */
        }
      }
    },
    getNumberOfParticipants: () => null,
    getIFrame: () => frame,
  };
}

const JOIN_OUTCOME = {
  joined: "joined",
  aborted: "aborted",
  auth: "auth",
  connection: "connection",
  conference: "conference",
  fatal: "fatal",
};

function waitForConferenceJoined(api, {
  signal,
  onSlow,
  onHidden,
  slowMs = JOIN_SLOW_THRESHOLD_MS,
  fatalMs = JOIN_FATAL_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let conferenceJoined = false;
    let slowTimer = 0;
    let fatalTimer = 0;
    const joinListeners = [];
    // Вкладка свёрнута/скрыта во время входа: браузер душит таймеры iframe,
    // lib-jitsi-meet не успевает отправить запрос focus (uid 50, YaBrowser).
    let hiddenDuringJoin = typeof document !== "undefined" && document.visibilityState === "hidden";
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        hiddenDuringJoin = true;
        onHidden?.();
      }
    };
    const onPageHide = () => {
      hiddenDuringJoin = true;
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onPageHide);
    }

    const listen = (name, handler) => {
      api.addListener(name, handler);
      joinListeners.push([name, handler]);
    };

    const cleanup = () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(fatalTimer);
      slowTimer = 0;
      fatalTimer = 0;
      signal?.removeEventListener?.("abort", onAbort);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onPageHide);
      }
      for (const [name, handler] of joinListeners) {
        try {
          api.removeListener?.(name, handler);
        } catch {
          /* ignore */
        }
      }
      joinListeners.length = 0;
    };

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ outcome, conferenceJoined, hiddenDuringJoin });
    };

    const onAbort = () => finish(JOIN_OUTCOME.aborted);

    listen("videoConferenceJoined", () => {
      conferenceJoined = true;
      finish(JOIN_OUTCOME.joined);
    });
    listen("connectionFailed", (event) => {
      finish(isJitsiAuthJoinFailure(event) ? JOIN_OUTCOME.auth : JOIN_OUTCOME.connection);
    });
    listen("conferenceFailed", (event) => {
      finish(isJitsiAuthJoinFailure(event) ? JOIN_OUTCOME.auth : JOIN_OUTCOME.conference);
    });
    listen("errorOccurred", (event) => {
      if (isJitsiAuthJoinFailure(event)) finish(JOIN_OUTCOME.auth);
    });

    slowTimer = window.setTimeout(() => {
      if (settled || conferenceJoined) return;
      onSlow?.();
    }, slowMs);

    fatalTimer = window.setTimeout(() => {
      if (settled || conferenceJoined) return;
      finish(JOIN_OUTCOME.fatal);
    }, fatalMs);

    if (signal?.aborted) {
      finish(JOIN_OUTCOME.aborted);
    } else {
      signal?.addEventListener?.("abort", onAbort, { once: true });
    }
  });
}

function joinFailureFromOutcome(outcome, { signal, iframeCreated = false } = {}) {
  const err = new Error("Не удалось войти во встречу");
  err.iframeCreated = Boolean(iframeCreated);
  if (outcome === JOIN_OUTCOME.aborted || signal?.aborted) {
    err.message = "Подключение к конференции отменено";
    err.code = "jitsi_aborted";
    err.category = "aborted";
    return err;
  }
  if (outcome === JOIN_OUTCOME.auth) {
    err.code = "jitsi_auth";
    err.category = "jitsi_auth";
    return err;
  }
  if (outcome === JOIN_OUTCOME.connection) {
    err.code = "jitsi_connection_failed";
    err.category = "connection_failed";
    return err;
  }
  if (outcome === JOIN_OUTCOME.conference) {
    err.code = "jitsi_conference_failed";
    err.category = "conference_failed";
    return err;
  }
  err.code = "jitsi_join_timeout";
  err.category = "join_timeout";
  return err;
}

async function createJitsiExternalApiEmbed(config, container, hooks = {}) {
  const roomName = String(config.roomName || "").trim();
  const domain = String(config.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!roomName || roomName !== config.roomName) {
    throw new Error("roomName отсутствует или был изменён на frontend");
  }
  if (!domain) {
    throw new Error("Не задан домен Jitsi");
  }

  const displayName = resolveJitsiDisplayName(config);
  console.info("[Jitsi] Display name check", {
    hasDisplayName: Boolean(displayName),
    length: displayName.length,
  });

  const JitsiMeetExternalAPI = await loadJitsiExternalApi(domain, {
    scriptUrl: config.scriptUrl || "",
    attemptId: String(config.diagnostics?.callSessionId || ""),
  });
  logConferenceStage("script_ready", {
    diagId: String(config.diagnostics?.callSessionId || ""),
    ...describeConferenceClient(),
  });
  if (hooks.signal?.aborted) {
    const err = new Error("Подключение к конференции отменено");
    err.code = "jitsi_aborted";
    throw err;
  }
  container.innerHTML = "";

  const subject = resolveJitsiSubject(config);
  const startWithVideoMuted = Boolean(config.startWithVideoMuted);
  const startWithAudioMuted = config.startWithAudioMuted !== false;
  const apiRoomName = resolveJitsiApiRoomName(config);
  const options = buildJitsiExternalApiOptions({
    roomName: apiRoomName,
    parentNode: container,
    lang: "ru",
    jwt: config.jwt,
    configOverwrite: buildJitsiConfigOverwrite({
      subject,
      startWithVideoMuted,
      startWithAudioMuted,
      domain,
      customChrome: Boolean(config.customChrome),
      expandedToolbar: Boolean(config.expandedToolbar) && !config.floatingToolbar,
      floatingToolbar: Boolean(config.floatingToolbar),
    }),
    interfaceConfigOverwrite: buildJitsiInterfaceConfigOverwrite(),
    userInfo: {
      displayName,
      email: config.userInfo?.email || undefined,
      avatarURL: config.userInfo?.avatarUrl || undefined,
    },
  });

  logJitsiDiagnostic("jitsi_init_started", {
    meetingUuid: config.meeting?.uuid,
    configuredDomain: domain,
    roomSuffix: roomName.slice(-8),
    hasJwt: Boolean(config.jwt),
    authMode: config.authMode || "",
    startWithVideoMuted,
    startWithAudioMuted,
    subject,
  });

  if (!config.jwt && config.authMode === "jwt") {
    const err = new Error("Backend не вернул JWT для Jitsi");
    err.code = "jwt_missing";
    err.category = "jwt_missing";
    throw err;
  }

  const diagnostics = {
    ...(config.diagnostics || {}),
    roomName,
    domain,
    meetingUuid: config.meeting?.uuid,
    lessonId: config.diagnostics?.lessonId || config.event?.lessonId || "",
    userId: config.diagnostics?.userId || "",
    authMode: config.authMode || "",
    role: config.meeting?.role || config.diagnostics?.role || "",
    browserTabSessionId: config.diagnostics?.browserTabSessionId || createBrowserTabSessionId(),
    callSessionId: config.diagnostics?.callSessionId || createCallSessionId(),
  };

  const unhookCreate = installJitsiIframeCreateSanitizer();
  const unhookAppend = hookContainerForJitsiIframeSanitize(container);
  disposeActiveExternalApi();
  let api;
  try {
    const frameDomain = resolveJitsiFrameDomain(domain);
    if (frameDomain !== domain) console.info("[Jitsi] same-origin frame domain", { frameDomain });
    api = new JitsiMeetExternalAPI(frameDomain, options);
    activeExternalApi = api;
    // r72: без автопоказа PiP, когда iframe скрыт раскладкой урока.
    disableJitsiAutoIntersectionPip(api);
  } finally {
    unhookCreate();
  }
  try {
    sanitizeJitsiIframeElement(api.getIFrame?.());
    ensureJitsiIframeMediaAllow(api.getIFrame?.());
  } catch {
    /* ignore */
  }
  logConferenceStage("conference_created", {
    diagId: String(diagnostics.callSessionId || ""),
    hasIframe: Boolean(api.getIFrame?.()),
  });
  logJitsiDiagnostic("jitsi_iframe_created", {
    meetingUuid: diagnostics.meetingUuid,
    roomSuffix: roomName.slice(-8),
    hasIframe: Boolean(api.getIFrame?.()),
  });

  const { presence, screenShare, watchdog, dispose: disposeParticipantListeners } = wireParticipantListeners(api, {
    ...hooks,
    subject,
    diagnostics,
  });
  attachOfficialRemoteControl(api, getJitsiElectronRemoteControlSetup());

  let disposed = false;
  const sessionHolder = { current: null };
  let disposeOnce = () => {};
  const disposeSession = (reason) => disposeOnce(reason);
  disposeOnce = (reason) => {
    if (disposed) return;
    disposed = true;
    if (activeSessionDispose === disposeSession) activeSessionDispose = null;
    unregisterJitsiSession(sessionHolder.current);
    unhookAppend();
    logConferenceStage("disconnect", {
      diagId: String(diagnostics.callSessionId || ""),
      reason: String(reason || "").slice(0, 32),
    });
    logJitsiDiagnostic("jitsi_disposed", {
      reason,
      meetingUuid: diagnostics.meetingUuid,
      roomSuffix: roomName.slice(-8),
    });
    logLifecycle("JITSI_DISPOSE", { reason: String(reason || "").slice(0, 32) });
    try {
      disposeParticipantListeners?.();
    } catch {
      /* ignore */
    }
    try {
      watchdog.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      screenShare.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      presence.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      const iframe = api.getIFrame?.();
      if (iframe) iframe.src = "about:blank";
    } catch {
      /* ignore */
    }
    if (activeExternalApi === api) activeExternalApi = null;
    try {
      api.dispose();
    } catch {
      /* ignore */
    }
    try {
      container.innerHTML = "";
    } catch {
      /* ignore */
    }
  };
  activeSessionDispose = disposeSession;

  // participants>=1 — не доказательство входа. Ждём videoConferenceJoined.
  // 15 с без join ≠ fatal: только hint. Dispose только на explicit failure / abort / fatal watchdog.
  const { outcome, conferenceJoined, hiddenDuringJoin } = await waitForConferenceJoined(api, {
    signal: hooks.signal,
    onHidden: () => {
      hooks.onConnectionHint?.(JOIN_KEEP_TAB_HINT);
    },
    onSlow: () => {
      logJitsiDiagnostic("jitsi_join_slow", {
        meetingUuid: diagnostics.meetingUuid,
        roomSuffix: roomName.slice(-8),
        tab: diagnostics.browserTabSessionId,
      });
      hooks.onConnectionHint?.(JOIN_SLOW_HINT);
    },
  });

  if (outcome !== JOIN_OUTCOME.joined || !conferenceJoined) {
    if (outcome === JOIN_OUTCOME.fatal) {
      logJitsiDiagnostic("jitsi_join_fatal_timeout", {
        meetingUuid: diagnostics.meetingUuid,
        roomSuffix: roomName.slice(-8),
        tab: diagnostics.browserTabSessionId,
        conferenceJoined: false,
      }, { error: true });
      if (diagnostics.meetingUuid) {
        void reportMeetingTechnicalEvent(diagnostics.meetingUuid, {
          eventType: "conference_failed",
          role: diagnostics.role || "",
          reason: "jitsi_join_fatal_timeout",
          browserTabSessionId: diagnostics.browserTabSessionId || "",
          callSessionId: diagnostics.callSessionId || "",
          metadata: { domain, roomSuffix: roomName.slice(-8) },
        });
      }
    }
    const iframeCreated = Boolean(api.getIFrame?.());
    disposeOnce(
      outcome === JOIN_OUTCOME.aborted
        ? "aborted"
        : outcome === JOIN_OUTCOME.fatal
          ? "fatal_timeout"
          : outcome,
    );
    const joinErr = joinFailureFromOutcome(outcome, { signal: hooks.signal, iframeCreated });
    joinErr.hiddenDuringJoin = Boolean(hiddenDuringJoin);
    throw joinErr;
  }

  unhookAppend();

  const session = {
    api,
    mode: "external-api",
    roomName,
    presence,
    screenShare,
    watchdog,
    callSessionId: diagnostics.callSessionId,
    dispose: () => disposeOnce("user"),
    executeCommand: (cmd, ...args) => {
      try {
        api.executeCommand(cmd, ...args);
      } catch {
        /* ignore */
      }
    },
    getNumberOfParticipants: () => {
      const snap = presence.snapshot?.();
      if (snap && typeof snap.count === "number") return snap.count;
      try {
        return api.getNumberOfParticipants();
      } catch {
        return null;
      }
    },
    reconcileParticipants: (reason = "manual") => presence.reconcile?.(reason),
    getIFrame: () => {
      try {
        return api.getIFrame?.() || null;
      } catch {
        return null;
      }
    },
  };
  sessionHolder.current = session;
  registerJitsiSession(session);
  logConferenceStage("room_joined", {
    diagId: String(diagnostics.callSessionId || ""),
  });
  logLifecycle("JITSI_INIT", { roomSuffix: roomName.slice(-8) });
  return session;
}

/**
 * Основной вход: External API (ждём videoConferenceJoined).
 * iframe — только fallback или ?jitsiEmbed=1.
 */
export async function createJitsiMeetSession(config, container, hooks = {}) {
  if (sessionInitializing) {
    throw Object.assign(new Error("Jitsi уже инициализируется"), { code: "jitsi_busy" });
  }

  const {
    onParticipantCount,
    onPresence,
    onJoined,
    onLeft,
    onHangup,
    onEmbedded,
    onMediaWarning,
    onBecameModerator,
    onAudioMuteStatusChanged,
    onVideoMuteStatusChanged,
    onScreenShare,
    onConnectionHint,
    onConnectionState,
    onReconnectRequired,
    onRecoveryStarted,
    shouldReconnect,
    getIntendedMedia,
    preferIframe = false,
    signal,
  } = hooks;

  const forceIframe =
    preferIframe
    || (typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("jitsiEmbed") === "1");

  // Обогащаем subject из хука/конфига, чтобы iframe и API видели одно название.
  const enriched = {
    ...config,
    diagnostics: {
      ...(config.diagnostics || {}),
      browserTabSessionId:
        config.diagnostics?.browserTabSessionId || createBrowserTabSessionId(),
      callSessionId: config.diagnostics?.callSessionId || createCallSessionId(),
    },
    meeting: {
      ...(config.meeting || {}),
      subject: resolveJitsiSubject(config),
    },
  };

  const sessionHooks = {
    onParticipantCount,
    onPresence,
    onJoined,
    onLeft,
    onHangup,
    onMediaWarning,
    onBecameModerator,
    onAudioMuteStatusChanged,
    onVideoMuteStatusChanged,
    onScreenShare,
    onConnectionHint,
    onConnectionState,
    onReconnectRequired,
    onRecoveryStarted,
    shouldReconnect,
    getIntendedMedia,
    signal,
  };

  sessionInitializing = true;
  try {
    if (signal?.aborted) {
      const err = new Error("Подключение к конференции отменено");
      err.code = "jitsi_aborted";
      throw err;
    }
    if (!forceIframe) {
      try {
        return await createJitsiExternalApiEmbed(enriched, container, sessionHooks);
      } catch (err) {
        if (err?.code === "jitsi_aborted" || signal?.aborted) {
          throw err;
        }
        if (!shouldFallbackToIframe(err, enriched, { forceIframe: false })) {
          throw err;
        }
        console.warn("[Jitsi] External API недоступен, fallback iframe", err?.code || err?.message);
        const likelyWaitForModerator =
          enriched?.requiresModeratorLogin
          || (enriched?.meeting?.isModerator && !enriched?.jwt);
        onMediaWarning?.(
          likelyWaitForModerator
            ? "Организатор не подтверждён на сервере Jitsi (JWT). На проде: проверьте JITSI_* в .env и выполните sudo bash deploy/jitsi/fix-jwt-prosody.sh — иначе урок не начнётся без «Я организатор»."
            : "Не удалось подтвердить вход через API — открываем встроенное окно. Если видите «Я организатор» / «Присоединитесь», откройте в новой вкладке или проверьте JWT на сервере.",
        );
      }
    }

    return createJitsiIframeEmbed(enriched, container, {
      onEmbedded: (event) => {
        // Iframe load ≠ вход в конференцию. Посещаемость не пишем.
        onEmbedded?.(event);
        onParticipantCount?.(null);
      },
      onMediaWarning,
    });
  } finally {
    sessionInitializing = false;
  }
}

export function createJitsiMeetApi(config, container, hooks) {
  return createJitsiMeetSession(config, container, hooks);
}
