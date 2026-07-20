import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  planItemHomeworkPopoverRows,
  planItemLessonPopoverRows,
  planItemTaskPopoverRows,
} from "../planItemAttachments";
import {
  fetchVideoMeetingAttendance,
  fetchVideoMeetingDetail,
  fetchVideoMeetingJoinConfig,
  finishVideoMeeting,
  recordVideoMeetingJoin,
  recordVideoMeetingLeave,
  startVideoMeeting,
} from "../../utils/cabinetAuth";
import "../styles/video-meeting.css";

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/** Прямой URL комнаты с JWT — надёжнее External API на этом стенде Prosody. */
function buildJitsiEmbedUrl(config) {
  const params = new URLSearchParams();
  if (config.jwt) params.set("jwt", config.jwt);
  const hashParts = [
    "config.prejoinPageEnabled=false",
    "config.prejoinConfig.enabled=false",
    "config.p2p.enabled=false",
    "config.enableLobby=false",
    "config.requireDisplayName=false",
    "config.startWithAudioMuted=true",
    'config.defaultLanguage="ru"',
    "config.disableDeepLinking=true",
  ];
  const name = config.userInfo?.displayName;
  if (name) {
    hashParts.push(`userInfo.displayName=${JSON.stringify(name)}`);
  }
  const q = params.toString();
  return `https://${config.domain}/${config.roomName}${q ? `?${q}` : ""}#${hashParts.join("&")}`;
}

function formatWhen(startsAt, endsAt) {
  if (!startsAt) return "";
  try {
    const start = new Date(startsAt);
    const date = start.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
    const startTime = start.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (!endsAt) return `${date}, ${startTime}`;
    const endTime = new Date(endsAt).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${date}, ${startTime}–${endTime}`;
  } catch {
    return "";
  }
}

function mapJoinError(err) {
  const code = err?.code || err?.data?.code;
  const message = err?.message || err?.data?.error || "";
  if (code === "too_early") {
    return message || "Подключение будет доступно за 15 минут до начала";
  }
  if (code === "forbidden" || err?.status === 403) {
    if (code === "finished") return "Урок завершён";
    if (code === "cancelled") return "Урок отменён";
    if (code === "window_closed") return "Время подключения истекло";
    return message || "У вас нет доступа к этому уроку";
  }
  if (err?.status === 404 || code === "not_found") return "Конференция не найдена";
  if (code === "jwt_missing" || code === "jwt_config") {
    return "Не удалось получить конфигурацию подключения. Обратитесь к администратору.";
  }
  return message || "Backend не смог создать конфигурацию подключения";
}

function ResourceList({ title, rows, emptyText }) {
  return (
    <section className="video-lesson-aside__section">
      <h2 className="video-lesson-aside__heading">{title}</h2>
      {rows.length ? (
        <ul className="video-lesson-aside__list">
          {rows.map((row) => (
            <li key={row.key} className="video-lesson-aside__item">
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="video-lesson-aside__link"
                >
                  <span className="video-lesson-aside__label">{row.label}</span>
                  {row.typeLabel ? (
                    <span className="video-lesson-aside__type">{row.typeLabel}</span>
                  ) : null}
                </a>
              ) : (
                <div className="video-lesson-aside__static">
                  <span className="video-lesson-aside__label">{row.label}</span>
                  {row.text ? <p className="video-lesson-aside__text">{row.text}</p> : null}
                  {row.typeLabel ? (
                    <span className="video-lesson-aside__type">{row.typeLabel}</span>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="video-lesson-aside__empty">{emptyText}</p>
      )}
    </section>
  );
}

export default function VideoMeetingPage() {
  const { meetingUuid } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const leavingRef = useRef(false);
  const redirectedRef = useRef(false);
  const participantIdRef = useRef("");
  const returnUrlRef = useRef("/cabinet/schedule");
  const connectGenRef = useRef(0);

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mediaWarning, setMediaWarning] = useState("");
  const [participantCount, setParticipantCount] = useState(1);
  const [finishing, setFinishing] = useState(false);
  const [attendance, setAttendance] = useState(null);
  const [asideOpen, setAsideOpen] = useState(true);
  const [roleLabel, setRoleLabel] = useState("");
  const [isModerator, setIsModerator] = useState(false);
  const [moderatorLoginHint, setModeratorLoginHint] = useState("");
  const [roomName, setRoomName] = useState("");
  const [joinState, setJoinState] = useState(""); // connecting | joined | failed
  const [directJitsiUrl, setDirectJitsiUrl] = useState("");
  const joinConfigRef = useRef(null);

  const goBack = useCallback(() => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    navigate(returnUrlRef.current || "/cabinet/schedule", { replace: true });
  }, [navigate]);

  const disposeApi = useCallback(() => {
    if (apiRef.current) {
      try {
        apiRef.current.dispose();
      } catch {
        /* ignore */
      }
      apiRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
  }, []);

  const sendLeave = useCallback(() => {
    if (leavingRef.current || !meetingUuid) return;
    leavingRef.current = true;
    const csrf = getCsrfToken();
    const url = `/api/video-meetings/${meetingUuid}/attendance/leave/`;
    const form = new FormData();
    if (csrf) form.append("csrfmiddlewaretoken", csrf);
    if (participantIdRef.current) {
      form.append("jitsiParticipantId", participantIdRef.current);
    }
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, form);
        return;
      }
    } catch {
      /* fallback below */
    }
    void recordVideoMeetingLeave(meetingUuid, {
      jitsiParticipantId: participantIdRef.current,
    }).catch(() => {});
  }, [meetingUuid]);

  const connect = useCallback(async () => {
    if (!meetingUuid) return;
    const gen = ++connectGenRef.current;
    setLoading(true);
    setError("");
    setModeratorLoginHint("");
    setMediaWarning("");
    setAttendance(null);
    leavingRef.current = false;
    disposeApi();

    try {
      const meta = await fetchVideoMeetingDetail(meetingUuid);
      if (gen !== connectGenRef.current) return;
      setDetail(meta);
      returnUrlRef.current = meta?.canManage
        ? "/cabinet/schedule"
        : "/cabinet/student/lessons";

      if (meta?.videoMeeting?.status === "finished" && meta?.canManage) {
        const rows = await fetchVideoMeetingAttendance(meetingUuid);
        if (gen !== connectGenRef.current) return;
        setAttendance(rows?.results || []);
        setLoading(false);
        return;
      }

      const config = await fetchVideoMeetingJoinConfig(meetingUuid);
      if (gen !== connectGenRef.current) return;
      if (!config?.domain || !config?.roomName) {
        throw Object.assign(new Error("Backend не смог создать конфигурацию"), {
          code: "config",
        });
      }
      returnUrlRef.current = config.meeting?.returnUrl || returnUrlRef.current;
      const moderator = Boolean(config.meeting?.isModerator);
      const needsModeratorLogin = Boolean(config.requiresModeratorLogin);
      setIsModerator(moderator);
      setRoleLabel(config.meeting?.roleLabel || (moderator ? "Организатор" : "Участник"));
      setRoomName(config.roomName || "");
      joinConfigRef.current = config;
      const directUrl = config.jwt
        ? `https://${config.domain}/${encodeURIComponent(config.roomName)}?jwt=${encodeURIComponent(config.jwt)}`
        : `https://${config.domain}/${encodeURIComponent(config.roomName)}`;
      setDirectJitsiUrl(directUrl);
      setModeratorLoginHint(
        needsModeratorLogin
          ? "На meet.jit.si нажмите «Я организатор» и войдите в аккаунт Jitsi — иначе урок не начнётся. Для автоматической роли организатора нужен свой сервер с JWT."
          : "",
      );

      if (config.meeting?.isModerator && meta?.videoMeeting?.status === "scheduled") {
        try {
          await startVideoMeeting(meetingUuid);
          const refreshed = await fetchVideoMeetingDetail(meetingUuid);
          if (gen !== connectGenRef.current) return;
          if (refreshed) setDetail(refreshed);
        } catch {
          /* старт не блокирует вход, если комната уже доступна */
        }
      }

      if (!config.jwt && config.authMode === "jwt") {
        throw Object.assign(new Error("Backend не вернул JWT для Jitsi"), { code: "jwt_missing" });
      }
      if (!containerRef.current) {
        throw new Error("Контейнер конференции недоступен");
      }

      const embedUrl = buildJitsiEmbedUrl(config);
      setDirectJitsiUrl(embedUrl);
      if (typeof console !== "undefined" && console.info) {
        console.info("[video-meeting]", {
          uuid: meetingUuid,
          domain: config.domain,
          roomName: config.roomName,
          isModerator: moderator,
          hasJwt: Boolean(config.jwt),
          mode: "iframe-jwt",
        });
      }

      // Прямой iframe с ?jwt= — External API на этом стенде не доходит до videoConferenceJoined.
      containerRef.current.innerHTML = "";
      const frame = document.createElement("iframe");
      frame.src = embedUrl;
      frame.title = "Jitsi Meet";
      frame.allow =
        "camera; microphone; display-capture; autoplay; clipboard-write; fullscreen";
      frame.allowFullscreen = true;
      frame.style.width = "100%";
      frame.style.height = "100%";
      frame.style.border = "0";
      frame.setAttribute("allowfullscreen", "true");
      containerRef.current.appendChild(frame);
      apiRef.current = {
        dispose: () => {
          try {
            frame.src = "about:blank";
          } catch {
            /* ignore */
          }
        },
        executeCommand: () => {},
      };

      setJoinState("embedded");
      setLoading(false);
      setMediaWarning(
        config.jwt
          ? ""
          : "JWT не выдан — если Prosody требует токен, вход не сработает. Откройте урок на Jitsi напрямую.",
      );
      if (!config.jwt) {
        setJoinState("failed");
      }

      try {
        await recordVideoMeetingJoin(meetingUuid, { jitsiParticipantId: "" });
      } catch {
        /* посещаемость не должна ломать конференцию */
      }
    } catch (err) {
      if (gen !== connectGenRef.current) return;
      disposeApi();
      if (err?.message === "Не удалось загрузить Jitsi Meet") {
        setError("Jitsi-сервер недоступен или не удалось загрузить external_api.js");
      } else if (err?.message?.includes("не поддержив") || err?.name === "NotSupportedError") {
        setError("Браузер не поддерживает необходимые функции для видеоконференции");
      } else if (!navigator.onLine) {
        setError("Сеть была потеряна. Проверьте подключение к интернету.");
      } else {
        setError(mapJoinError(err));
      }
      setLoading(false);
    }
  }, [disposeApi, goBack, meetingUuid, sendLeave]);

  useEffect(() => {
    void connect();
    return () => {
      connectGenRef.current += 1;
      sendLeave();
      disposeApi();
    };
  }, [connect, disposeApi, sendLeave]);

  useEffect(() => {
    const onPageHide = () => sendLeave();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [sendLeave]);

  const onFinish = async () => {
    if (!meetingUuid || finishing) return;
    setFinishing(true);
    try {
      await finishVideoMeeting(meetingUuid);
      try {
        apiRef.current?.executeCommand("hangup");
      } catch {
        /* ignore */
      }
      sendLeave();
      disposeApi();
      goBack();
    } catch (err) {
      setError(err?.message || "Не удалось завершить урок");
      setFinishing(false);
    }
  };

  const event = detail?.event;
  const meeting = detail?.videoMeeting;
  const canManage = Boolean(detail?.canManage);
  const status = meeting?.status || "scheduled";
  const returnUrl = returnUrlRef.current || (canManage ? "/cabinet/schedule" : "/cabinet/student/lessons");

  const { materialRows, homeworkRows } = useMemo(() => {
    const planItem = event?.planItem || null;
    const materials = [
      ...planItemLessonPopoverRows(planItem),
      ...planItemTaskPopoverRows(planItem),
    ];
    if (!materials.length && event?.materials?.trim()) {
      materials.push({
        key: "legacy-materials",
        kind: "notes",
        label: "Материалы",
        text: event.materials.trim(),
      });
    }
    return {
      materialRows: materials,
      homeworkRows: planItemHomeworkPopoverRows(planItem),
    };
  }, [event]);

  const hasLessonResources = Boolean(
    materialRows.length
    || homeworkRows.length
    || event?.topic
    || event?.teacherComment
    || event?.planItem?.goal
    || event?.planItem?.description,
  );

  return (
    <div className={`video-lesson-page${asideOpen && hasLessonResources ? " video-lesson-page--aside" : ""}`}>
      <header className="video-lesson-header">
        <div className="video-lesson-header__meta">
          <h1 className="video-lesson-header__title">
            {event?.title || meeting?.statusLabel || "Онлайн-урок"}
          </h1>
          <p className="video-lesson-header__sub">
            {[event?.topic, event?.teacherName, formatWhen(event?.startsAt, event?.endsAt)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {roomName ? (
            <p className="video-lesson-header__room" title={`${meetingUuid} / ${roomName}`}>
              Комната: {roomName}
            </p>
          ) : null}
        </div>
        <div className="video-lesson-header__actions">
          {roleLabel ? (
            <span
              className={`video-lesson-header__status${isModerator ? " video-lesson-header__status--live" : ""}`}
            >
              {roleLabel}
            </span>
          ) : null}
          <span className={`video-lesson-header__status video-lesson-header__status--${status}`}>
            {meeting?.statusLabel || detail?.joinStateLabel || "Подключение"}
          </span>
          <span className="video-lesson-participants">Участников: {participantCount}</span>
          {joinState ? (
            <span className="video-lesson-participants" title="Состояние входа в MUC Jitsi">
              MUC: {joinState}
            </span>
          ) : null}
          {directJitsiUrl ? (
            <a
              className="video-lesson-btn"
              href={directJitsiUrl}
              target="_blank"
              rel="noreferrer"
            >
              Открыть на Jitsi
            </a>
          ) : null}
          {hasLessonResources ? (
            <button
              type="button"
              className="video-lesson-btn"
              onClick={() => setAsideOpen((v) => !v)}
              aria-pressed={asideOpen}
            >
              {asideOpen ? "Скрыть материалы" : "Материалы и ДЗ"}
            </button>
          ) : null}
          {canManage && status === "live" ? (
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--danger"
              onClick={onFinish}
              disabled={finishing}
            >
              {finishing ? "Завершение…" : "Завершить урок"}
            </button>
          ) : null}
          <Link to={returnUrl} className="video-lesson-btn" onClick={() => sendLeave()}>
            К уроку
          </Link>
        </div>
      </header>

      <div className="video-lesson-body">
        <main className="video-lesson-content">
          {moderatorLoginHint && !error ? (
            <div className="video-lesson-moderator-hint" role="status">
              <strong>Нужно подтвердить роль организатора</strong>
              <p>{moderatorLoginHint}</p>
              <button type="button" onClick={() => setModeratorLoginHint("")} aria-label="Скрыть подсказку">
                Понятно
              </button>
            </div>
          ) : null}
          {mediaWarning && !error ? (
            <div className="video-lesson-media-warning" role="status">
              <span>{mediaWarning}</span>
              {directJitsiUrl && joinState === "failed" ? (
                <a
                  className="video-lesson-btn"
                  href={directJitsiUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: 8 }}
                >
                  Открыть на Jitsi
                </a>
              ) : null}
              <button type="button" onClick={() => setMediaWarning("")} aria-label="Закрыть">
                ×
              </button>
            </div>
          ) : null}
          <div id="jitsi-loading-state" className="video-lesson-state" hidden={!loading || Boolean(error)}>
            <div className="video-lesson-state__spinner" aria-hidden="true" />
            <p className="video-lesson-state__title">Подключение к уроку…</p>
            <p className="video-lesson-state__text">
              Загружаем конференцию. Разрешите доступ к камере и микрофону, если браузер попросит.
            </p>
          </div>

          <div id="jitsi-error-state" className="video-lesson-state" hidden={!error || attendance != null}>
            <p className="video-lesson-state__title">Не удалось подключиться</p>
            <p className="video-lesson-state__text">{error}</p>
            <button type="button" className="video-lesson-btn video-lesson-btn--primary" onClick={() => void connect()}>
              Повторить подключение
            </button>
            <Link to={returnUrl} className="video-lesson-btn">
              Вернуться к уроку
            </Link>
          </div>

          {attendance != null ? (
            <div className="video-lesson-state" style={{ position: "relative" }}>
              <p className="video-lesson-state__title">Посещаемость урока</p>
              <p className="video-lesson-state__text">
                {attendance.length
                  ? "Сессии подключений участников (время посчитано на сервере)."
                  : "Подключений пока не было."}
              </p>
              <div style={{ width: "min(640px, 100%)", textAlign: "left", maxHeight: "50vh", overflow: "auto" }}>
                {attendance.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid rgba(148,163,184,0.25)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <strong>{row.displayName}</strong>
                    <div style={{ color: "#94a3b8", marginTop: 4 }}>
                      {new Date(row.joinedAt).toLocaleString("ru-RU")}
                      {row.leftAt ? ` — ${new Date(row.leftAt).toLocaleString("ru-RU")}` : " — ещё в комнате"}
                      {" · "}
                      {Math.round((row.durationSeconds || 0) / 60)} мин
                    </div>
                  </div>
                ))}
              </div>
              <Link to={returnUrl} className="video-lesson-btn video-lesson-btn--primary">
                Вернуться к расписанию
              </Link>
            </div>
          ) : null}

          <div id="jitsi-container" ref={containerRef} hidden={attendance != null} />
        </main>

        {asideOpen && hasLessonResources && attendance == null ? (
          <aside className="video-lesson-aside" aria-label="Материалы и домашнее задание">
            {(event?.planItem?.goal || event?.planItem?.description || event?.teacherComment) ? (
              <section className="video-lesson-aside__section">
                <h2 className="video-lesson-aside__heading">О занятии</h2>
                {event?.planItem?.goal ? (
                  <p className="video-lesson-aside__text"><strong>Цель.</strong> {event.planItem.goal}</p>
                ) : null}
                {event?.planItem?.description ? (
                  <p className="video-lesson-aside__text">{event.planItem.description}</p>
                ) : null}
                {event?.teacherComment ? (
                  <p className="video-lesson-aside__text"><strong>Комментарий.</strong> {event.teacherComment}</p>
                ) : null}
              </section>
            ) : null}
            <ResourceList
              title="Материалы"
              rows={materialRows}
              emptyText="К этому уроку пока нет материалов."
            />
            <ResourceList
              title="Домашнее задание"
              rows={homeworkRows}
              emptyText="Домашнее задание не назначено."
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
