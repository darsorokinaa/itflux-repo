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
import { attachScreenSharePresence } from "./jitsiScreenShare";
import { attachMediaWatchdog } from "./jitsiMediaWatchdog";
import { createCallSessionId } from "./jitsiCallState";
import {
  canonicalJitsiRoomName,
  jitsiRoomsMatch,
  reportMeetingTechnicalEvent,
} from "./jitsiTelemetry";
import { reportClientEvent } from "../utils/clientTelemetry";
import {
  logLifecycle,
  registerJitsiSession,
  unregisterJitsiSession,
} from "./pwa/runtimeResources";

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
/** Историческое имя: мягкий порог join и лимит пробы/загрузки скрипта. Не fatal для урока. */
export const JOIN_TIMEOUT_MS = JOIN_SLOW_THRESHOLD_MS;
export const JITSI_SCRIPT_LOAD_TIMEOUT_MS = JOIN_SLOW_THRESHOLD_MS;

let sessionInitializing = false;

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

export function loadJitsiExternalApi(domain, { timeoutMs = JITSI_SCRIPT_LOAD_TIMEOUT_MS } = {}) {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host) {
    return Promise.reject(new Error("Не задан домен Jitsi"));
  }
  if (typeof window !== "undefined" && window.JitsiMeetExternalAPI) {
    return Promise.resolve(window.JitsiMeetExternalAPI);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else reject(jitsiScriptError());
    };
    const timer = window.setTimeout(() => finish(jitsiScriptTimeoutError()), timeoutMs);

    const attach = (script) => {
      if (window.JitsiMeetExternalAPI) {
        finish(null);
        return;
      }
      if (script.dataset.jitsiError === "1") {
        finish(jitsiScriptError());
        return;
      }
      const ready = script.readyState;
      if (script.dataset.jitsiReady === "1" || ready === "complete" || ready === "loaded") {
        finish(null);
        return;
      }
      script.addEventListener("load", () => {
        script.dataset.jitsiReady = "1";
        finish(null);
      }, { once: true });
      script.addEventListener("error", () => {
        script.dataset.jitsiError = "1";
        finish(jitsiScriptError());
      }, { once: true });
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      attach(existing);
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    // Свой Jitsi (lesson.itflux-academy.ru) — без VPN. meet.jit.si в РФ часто недоступен.
    script.src = `https://${host}/libs/external_api.min.js`;
    attach(script);
    document.head.appendChild(script);
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

/**
 * Минимальный configOverwrite для стабильного входа.
 * Без lobby/prejoin/deeplink — чтобы не зависеть от кнопки предэкрана.
 * subject — человекочитаемое название урока (не UUID комнаты).
 */
export function buildJitsiConfigOverwrite({
  subject,
  startWithVideoMuted = false,
  startWithAudioMuted = true,
} = {}) {
  const title = String(subject || "").trim() || "Урок";
  return {
    prejoinConfig: { enabled: false },
    prejoinPageEnabled: false,
    requireDisplayName: false,
    disableDeepLinking: true,
    startWithAudioMuted: Boolean(startWithAudioMuted),
    startWithVideoMuted: Boolean(startWithVideoMuted),
    disableLobbyMode: true,
    lobby: { enabled: false },
    autoKnockLobby: false,
    enableWelcomePage: false,
    hideLoginButton: true,
    defaultLanguage: "ru",
    subject: title,
    localSubject: title,
    inviteAppName: "Цифровой поток",
    hideConferenceSubject: false,
    hideConferenceTimer: false,
    disableModeratorIndicator: false,
    enableClosePage: false,
    // 1:1 учитель–ученик почти всегда за разными NAT. P2P даёт «видим в списке,
    // но нет звука/видео». Медиа идёт через JVB.
    p2p: { enabled: false },
    // XMPP websocket на native Prosody может отдавать 501; BOSH уже работает.
    preferBosh: true,
    channelLastN: 8,
    startBitrate: 400,
    disableSimulcast: false,
    enableNoAudioDetection: true,
    enableNoisyMicDetection: true,
    stereo: false,
    constraints: {
      video: {
        height: { ideal: 360, max: 720 },
        width: { ideal: 640, max: 1280 },
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
    FILM_STRIP_MAX_HEIGHT: 120,
    DEFAULT_BACKGROUND: "#0f172a",
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

export function stripNullJitsiLocalStorageContentFromUrl(url) {
  const raw = String(url || "");
  const hashIdx = raw.indexOf("#");
  if (hashIdx < 0) return raw;
  const base = raw.slice(0, hashIdx);
  const hash = raw.slice(hashIdx + 1);
  const kept = hash.split("&").filter((part) => {
    if (!part) return false;
    const eq = part.indexOf("=");
    const key = eq >= 0 ? part.slice(0, eq) : part;
    if (key !== "appData.localStorageContent") return true;
    const value = eq >= 0 ? part.slice(eq + 1) : "";
    let decoded = value;
    try {
      decoded = decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      decoded = value;
    }
    return hasValidJitsiLocalStorageContent(decoded);
  });
  return kept.length ? `${base}#${kept.join("&")}` : base;
}

export function sanitizeJitsiIframeElement(iframe) {
  if (!iframe) return iframe;
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
    "config.hideLoginButton=true",
    "config.hideConferenceSubject=false",
    "config.hideConferenceTimer=false",
    'config.defaultLanguage="ru"',
    `config.subject=${encodeURIComponent(JSON.stringify(subject))}`,
    `config.localSubject=${encodeURIComponent(JSON.stringify(subject))}`,
    `config.inviteAppName=${encodeURIComponent(JSON.stringify("Цифровой поток"))}`,
    "config.p2p.enabled=false",
    "config.preferBosh=true",
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

  const q = params.toString();
  // Не передаём appData.localStorageContent: Jitsi падает на Object.keys(null).
  return stripNullJitsiLocalStorageContentFromUrl(
    `https://${domain}/${encodeURIComponent(roomName)}${q ? `?${q}` : ""}#${hashParts.join("&")}`,
  );
}

function wireParticipantListeners(api, hooks) {
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
  });
  registerJoinDiagnostics(api, {
    onMediaWarning: hooks.onMediaWarning,
    diagnostics: hooks.diagnostics,
  });
  return { presence, screenShare, watchdog };
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
  slowMs = JOIN_SLOW_THRESHOLD_MS,
  fatalMs = JOIN_FATAL_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let conferenceJoined = false;
    let slowTimer = 0;
    let fatalTimer = 0;
    const joinListeners = [];

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
      resolve({ outcome, conferenceJoined });
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

function joinFailureFromOutcome(outcome, { signal } = {}) {
  const err = new Error("Не удалось войти во встречу");
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

  const JitsiMeetExternalAPI = await loadJitsiExternalApi(domain);
  if (hooks.signal?.aborted) {
    const err = new Error("Подключение к конференции отменено");
    err.code = "jitsi_aborted";
    throw err;
  }
  container.innerHTML = "";

  const subject = resolveJitsiSubject(config);
  const startWithVideoMuted = Boolean(config.startWithVideoMuted);
  const startWithAudioMuted = config.startWithAudioMuted !== false;
  const options = buildJitsiExternalApiOptions({
    roomName,
    parentNode: container,
    lang: "ru",
    jwt: config.jwt,
    configOverwrite: buildJitsiConfigOverwrite({
      subject,
      startWithVideoMuted,
      startWithAudioMuted,
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
  let api;
  try {
    api = new JitsiMeetExternalAPI(domain, options);
  } finally {
    unhookCreate();
  }
  try {
    sanitizeJitsiIframeElement(api.getIFrame?.());
  } catch {
    /* ignore */
  }
  logJitsiDiagnostic("jitsi_iframe_created", {
    meetingUuid: diagnostics.meetingUuid,
    roomSuffix: roomName.slice(-8),
    hasIframe: Boolean(api.getIFrame?.()),
  });

  const { presence, screenShare, watchdog } = wireParticipantListeners(api, {
    ...hooks,
    subject,
    diagnostics,
  });

  let disposed = false;
  const sessionHolder = { current: null };
  const disposeOnce = (reason) => {
    if (disposed) return;
    disposed = true;
    unregisterJitsiSession(sessionHolder.current);
    unhookAppend();
    logJitsiDiagnostic("jitsi_disposed", {
      reason,
      meetingUuid: diagnostics.meetingUuid,
      roomSuffix: roomName.slice(-8),
    });
    logLifecycle("JITSI_DISPOSE", { reason: String(reason || "").slice(0, 32) });
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

  // participants>=1 — не доказательство входа. Ждём videoConferenceJoined.
  // 15 с без join ≠ fatal: только hint. Dispose только на explicit failure / abort / fatal watchdog.
  const { outcome, conferenceJoined } = await waitForConferenceJoined(api, {
    signal: hooks.signal,
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
    disposeOnce(
      outcome === JOIN_OUTCOME.aborted
        ? "aborted"
        : outcome === JOIN_OUTCOME.fatal
          ? "fatal_timeout"
          : outcome,
    );
    throw joinFailureFromOutcome(outcome, { signal: hooks.signal });
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
