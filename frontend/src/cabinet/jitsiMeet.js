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

export {
  createBrowserTabSessionId,
  shouldFallbackToIframe,
  createCallSessionId,
  isJitsiAuthJoinFailure,
};

const SCRIPT_ID = "jitsi-external-api-script";
/** Таймаут входа в конференцию и загрузки External API — из реального урока. */
export const JOIN_TIMEOUT_MS = 15000;
export const JITSI_SCRIPT_LOAD_TIMEOUT_MS = JOIN_TIMEOUT_MS;

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
  return `https://${domain}/${encodeURIComponent(roomName)}${q ? `?${q}` : ""}#${hashParts.join("&")}`;
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
  const options = {
    roomName,
    parentNode: container,
    width: "100%",
    height: "100%",
    lang: "ru",
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
  };
  if (config.jwt) {
    options.jwt = config.jwt;
  }

  console.info("[Jitsi] External API", {
    meetingUuid: config.meeting?.uuid,
    configuredDomain: domain,
    configuredRoomName: roomName,
    roomSuffix: roomName.slice(-8),
    hasJwt: Boolean(config.jwt),
    authMode: config.authMode || "",
    subject,
    diagnostics: config.diagnostics || null,
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

  const api = new JitsiMeetExternalAPI(domain, options);

  let conferenceJoined = false;
  let authFailed = false;
  const joinedWait = new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      hooks.signal?.removeEventListener?.("abort", onAbort);
      resolve(ok);
    };
    const onAbort = () => finish(false);
    const onAuthFail = (eventName, event) => {
      if (!isJitsiAuthJoinFailure(event)) return;
      authFailed = true;
      console.error(`[Jitsi] ${eventName} auth rejected`, {
        roomName,
        meetingUuid: diagnostics.meetingUuid,
        domain,
        hasJwt: Boolean(config.jwt),
        authMode: config.authMode || "",
      });
      finish(false);
    };
    api.addListener("videoConferenceJoined", () => {
      conferenceJoined = true;
      finish(true);
    });
    api.addListener("connectionFailed", (event) => onAuthFail("connectionFailed", event));
    api.addListener("conferenceFailed", (event) => onAuthFail("conferenceFailed", event));
    timer = window.setTimeout(() => {
      if (!conferenceJoined) {
        console.error("[Jitsi] videoConferenceJoined was not received", {
          roomName,
          meetingUuid: diagnostics.meetingUuid,
          tab: diagnostics.browserTabSessionId,
        });
      }
      finish(false);
    }, JOIN_TIMEOUT_MS);
    if (hooks.signal?.aborted) {
      finish(false);
    } else {
      hooks.signal?.addEventListener?.("abort", onAbort, { once: true });
    }
  });

  const { presence, screenShare, watchdog } = wireParticipantListeners(api, {
    ...hooks,
    subject,
    diagnostics,
  });

  let joined = await joinedWait;
  // participants>=1 и локальный snapshot — не доказательство входа:
  // getNumberOfParticipants() считает текущего пользователя. Без
  // videoConferenceJoined не фиксируем join и не открываем сессию.

  if (!joined) {
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
      api.dispose();
    } catch {
      /* ignore */
    }
    container.innerHTML = "";
    const err = new Error("Не удалось войти во встречу");
    if (hooks.signal?.aborted) {
      err.code = "jitsi_aborted";
      err.category = "aborted";
    } else if (authFailed) {
      err.code = "jitsi_auth";
      err.category = "jitsi_auth";
    } else if (config.authMode === "jwt" && !config.jwt) {
      err.code = "jitsi_join_timeout";
      err.category = "jwt_missing";
    } else {
      err.code = "jitsi_join_timeout";
      err.category = "join_timeout";
    }
    throw err;
  }

  return {
    api,
    mode: "external-api",
    roomName,
    presence,
    screenShare,
    watchdog,
    callSessionId: diagnostics.callSessionId,
    dispose: () => {
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
        api.dispose();
      } catch {
        /* ignore */
      }
      try {
        container.innerHTML = "";
      } catch {
        /* ignore */
      }
    },
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
