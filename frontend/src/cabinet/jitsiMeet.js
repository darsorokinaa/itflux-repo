/**
 * Инициализация Jitsi для видеоуроков.
 *
 * roomName — только из backend join-config.
 * По умолчанию External API + prejoin выкл. (без кнопки «Присоединиться»).
 * Fallback — iframe с теми же параметрами.
 */

const SCRIPT_ID = "jitsi-external-api-script";
const JOIN_TIMEOUT_MS = 15000;

let sessionInitializing = false;

export function loadJitsiExternalApi(domain) {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host) {
    return Promise.reject(new Error("Не задан домен Jitsi"));
  }
  if (typeof window !== "undefined" && window.JitsiMeetExternalAPI) {
    return Promise.resolve(window.JitsiMeetExternalAPI);
  }
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
        else reject(new Error("Не удалось загрузить Jitsi Meet"));
      });
      existing.addEventListener("error", () => reject(new Error("Не удалось загрузить Jitsi Meet")));
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://${host}/libs/external_api.min.js`;
    script.onload = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else reject(new Error("Не удалось загрузить Jitsi Meet"));
    };
    script.onerror = () => reject(new Error("Не удалось загрузить Jitsi Meet"));
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

/**
 * Минимальный configOverwrite для стабильного входа.
 * Без lobby/prejoin/deeplink — чтобы не зависеть от кнопки предэкрана.
 * subject — человекочитаемое название урока (не UUID комнаты).
 */
export function buildJitsiConfigOverwrite({ subject, startWithVideoMuted = false } = {}) {
  const title = String(subject || "").trim() || "Урок";
  return {
    prejoinConfig: { enabled: false },
    prejoinPageEnabled: false,
    requireDisplayName: false,
    disableDeepLinking: true,
    startWithAudioMuted: true,
    startWithVideoMuted: Boolean(startWithVideoMuted),
    disableLobbyMode: true,
    lobby: { enabled: false },
    autoKnockLobby: false,
    enableWelcomePage: false,
    hideLoginButton: true,
    defaultLanguage: "ru",
    subject: title,
    localSubject: title,
    hideConferenceSubject: false,
    hideConferenceTimer: false,
    disableModeratorIndicator: false,
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
    SHOW_BRAND_WATERMARK: false,
    SHOW_POWERED_BY: false,
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

export function registerJoinDiagnostics(api, { onMediaWarning } = {}) {
  const events = [
    "videoConferenceJoined",
    "videoConferenceLeft",
    "readyToClose",
    "participantRoleChanged",
    "passwordRequired",
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
        } else if (eventName === "peerConnectionFailure") {
          console.error("[Jitsi] peerConnectionFailure", sanitizeJitsiEvent(event));
        } else {
          console.info(`[Jitsi event] ${eventName}`, sanitizeJitsiEvent(event));
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
          onMediaWarning?.("Сервер запрашивает пароль/авторизацию для комнаты.");
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
    "config.startWithAudioMuted=true",
    `config.startWithVideoMuted=${startWithVideoMuted ? "true" : "false"}`,
    "config.hideLoginButton=true",
    "config.hideConferenceSubject=false",
    "config.hideConferenceTimer=false",
    'config.defaultLanguage="ru"',
    `config.subject=${encodeURIComponent(JSON.stringify(subject))}`,
    `config.localSubject=${encodeURIComponent(JSON.stringify(subject))}`,
    "interfaceConfig.MOBILE_APP_PROMO=false",
    "interfaceConfig.SHOW_JITSI_WATERMARK=false",
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName))}`,
  ];

  const q = params.toString();
  return `https://${domain}/${encodeURIComponent(roomName)}${q ? `?${q}` : ""}#${hashParts.join("&")}`;
}

function wireParticipantListeners(api, {
  onParticipantCount,
  onJoined,
  onMediaWarning,
  onBecameModerator,
  subject,
}) {
  const bump = () => {
    try {
      const n = api.getNumberOfParticipants();
      if (typeof n === "number") onParticipantCount?.(n);
    } catch {
      /* ignore */
    }
  };

  const applySubject = () => {
    const title = String(subject || "").trim();
    if (!title) return;
    try {
      api.executeCommand("subject", title);
    } catch {
      /* ignore */
    }
  };

  api.addListener("videoConferenceJoined", (event) => {
    let participantCount = null;
    try {
      participantCount = api.getNumberOfParticipants();
    } catch {
      /* ignore */
    }
    console.info("[Jitsi] videoConferenceJoined", {
      roomName: event?.roomName,
      participantId: event?.id,
      participantCount,
    });
    applySubject();
    onJoined?.(event);
    bump();
  });
  api.addListener("participantJoined", (event) => {
    let participantCount = null;
    try {
      participantCount = api.getNumberOfParticipants();
    } catch {
      /* ignore */
    }
    console.info("[Jitsi] participantJoined", {
      participantId: event?.id,
      participantCount,
    });
    bump();
  });
  api.addListener("participantLeft", (event) => {
    console.info("[Jitsi] participantLeft", { participantId: event?.id });
    bump();
  });
  api.addListener("participantRoleChanged", (event) => {
    console.info("[Jitsi] Role changed", { role: event?.role });
    if (String(event?.role || "").toLowerCase() === "moderator") {
      onBecameModerator?.();
    }
  });

  registerJoinDiagnostics(api, { onMediaWarning });
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
  frame.title = "Jitsi Meet";
  frame.allow = "camera; microphone; display-capture; autoplay; clipboard-write; fullscreen";
  frame.allowFullscreen = true;
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
  container.innerHTML = "";

  const subject = resolveJitsiSubject(config);
  const startWithVideoMuted = Boolean(config.startWithVideoMuted);
  const options = {
    roomName,
    parentNode: container,
    width: "100%",
    height: "100%",
    lang: "ru",
    configOverwrite: buildJitsiConfigOverwrite({ subject, startWithVideoMuted }),
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
  });

  const api = new JitsiMeetExternalAPI(domain, options);
  wireParticipantListeners(api, { ...hooks, subject });

  let conferenceJoined = false;
  const joined = await new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    api.addListener("videoConferenceJoined", () => {
      conferenceJoined = true;
      finish(true);
    });
    const timer = window.setTimeout(() => {
      if (!conferenceJoined) {
        console.error("[Jitsi] videoConferenceJoined was not received");
      }
      finish(false);
    }, JOIN_TIMEOUT_MS);
  });

  if (!joined) {
    try {
      api.dispose();
    } catch {
      /* ignore */
    }
    container.innerHTML = "";
    const err = new Error("Не удалось войти во встречу");
    err.code = "jitsi_join_timeout";
    err.category = config.authMode === "jwt" && !config.jwt
      ? "jwt_missing"
      : "join_timeout";
    throw err;
  }

  return {
    api,
    mode: "external-api",
    roomName,
    dispose: () => {
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
      try {
        return api.getNumberOfParticipants();
      } catch {
        return null;
      }
    },
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
    onJoined,
    onMediaWarning,
    onBecameModerator,
    preferIframe = false,
  } = hooks;

  const forceIframe =
    preferIframe
    || (typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("jitsiEmbed") === "1");

  // Обогащаем subject из хука/конфига, чтобы iframe и API видели одно название.
  const enriched = {
    ...config,
    meeting: {
      ...(config.meeting || {}),
      subject: resolveJitsiSubject(config),
    },
  };

  sessionInitializing = true;
  try {
    if (!forceIframe) {
      try {
        return await createJitsiExternalApiEmbed(enriched, container, {
          onParticipantCount,
          onJoined,
          onMediaWarning,
          onBecameModerator,
        });
      } catch (err) {
        if (err?.code !== "jitsi_join_timeout" && err?.message !== "Не удалось загрузить Jitsi Meet") {
          throw err;
        }
        console.warn("[Jitsi] External API недоступен, fallback iframe", err?.code || err?.message);
        onMediaWarning?.(
          "Автовход не подтверждён — открываем встроенное окно. Если снова увидите «Присоединиться», нажмите или откройте в новой вкладке.",
        );
      }
    }

    return createJitsiIframeEmbed(enriched, container, {
      onEmbedded: (event) => {
        onJoined?.(event);
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
