import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  planItemHomeworkPopoverRows,
  planItemLessonPopoverRows,
  planItemTaskPopoverRows,
} from "../planItemAttachments";
import { mapApiPlanItem } from "../lessonPlansData";
import {
  clearVideoMeetingPresented,
  ensureScheduleEventPlanItem,
  fetchVideoMeetingAttendance,
  fetchVideoMeetingDetail,
  fetchVideoMeetingJoinConfig,
  fetchVideoMeetingLiveAnswers,
  fetchVideoMeetingStatus,
  finishVideoMeeting,
  presentVideoMeetingResource,
  recordVideoMeetingJoin,
  recordVideoMeetingLeave,
  startVideoMeeting,
  updateLessonPlanItem,
} from "../../utils/cabinetAuth";
import {
  buildJitsiEmbedUrl,
  createJitsiMeetSession,
  getMeetingCameraEnabled,
  resolveJitsiDisplayName,
  setMeetingCameraEnabled,
} from "../jitsiMeet";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { openLessonSummaryTab } from "../journal/openLessonSummary";
import PlanItemResourcesPicker from "../components/PlanItemResourcesPicker";
import VideoLessonMaterialsPanel from "../components/VideoLessonMaterialsPanel";
import CabinetIcon from "../CabinetIcons";
import {
  claimMeetingCall,
  releaseMeetingCall,
  subscribeMeetingCall,
} from "../meetingCallOwnership";
import {
  appendMeetingParam,
  appendLiveVariantParams,
  presentedOpenKey,
  postMeetingUnpresent,
} from "../meetingPresent";
import "../styles/video-meeting.css";

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

const STATUS_POLL_MS = 12000;
const PRESENT_POLL_MS = 2500;
const LIVE_ANSWERS_POLL_MS = 2000;

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function mapJoinError(err) {
  const code = err?.code || err?.data?.code || err?.category;
  const message = err?.message || err?.data?.error || err?.data?.detail || "";
  if (code === "not_live") return "Учитель ещё не начал встречу";
  if (code === "too_early") {
    return message || "Подключение будет доступно за 15 минут до начала";
  }
  if (code === "finished" || (err?.status === 409 && code === "finished")) {
    return "Урок завершён";
  }
  if (code === "cancelled") return "Урок отменён";
  if (code === "forbidden" || err?.status === 403) {
    if (code === "window_closed") return "Срок действия ссылки истёк";
    return message || "Сервер отклонил доступ";
  }
  if (err?.status === 404 || code === "not_found") return "Конференция не найдена";
  if (code === "jwt_missing" || code === "jwt_config") {
    return "Сервер отклонил доступ (конфигурация входа)";
  }
  if (code === "jitsi_join_timeout" || code === "join_timeout") {
    return "Не удалось соединиться с сервером конференции. Нажмите «Повторить» или откройте в новой вкладке.";
  }
  if (code === "display_name") {
    return "Не указано имя участника";
  }
  return message || "Не удалось войти во встречу";
}

function absoluteJoinUrl(pageUrl) {
  if (!pageUrl) return "";
  if (pageUrl.startsWith("http")) return pageUrl;
  return `${window.location.origin}${pageUrl}`;
}

/** Название вкладки браузера / subject конференции: «Урок · Имя». */
function resolveLessonTabTitle(detail, meetingConfig) {
  const fromMeeting = String(
    meetingConfig?.subject
    || meetingConfig?.title
    || "",
  ).trim();
  if (fromMeeting) return fromMeeting;
  const fromEvent = String(detail?.event?.title || "").trim();
  if (fromEvent) return fromEvent;
  const audience = String(detail?.event?.audience || "").trim();
  if (audience) {
    return audience.toLowerCase().startsWith("урок") ? audience : `Урок · ${audience}`;
  }
  return "Урок";
}

async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

function isEmbeddableMaterialUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    const abs = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, window.location.origin);
    if (abs.origin === window.location.origin) return true;
    if (/\.(pdf|png|jpe?g|gif|webp|svg)(\?|$)/i.test(abs.pathname)) return true;
  } catch {
    return raw.startsWith("/");
  }
  return false;
}

function resolveMaterialOpenUrl(row, meetingUuid, presented) {
  if (row?.kind === "board" && row.boardId) {
    return appendMeetingParam(`/cabinet/boards/${row.boardId}`, meetingUuid);
  }
  if (row?.kind === "variant") {
    const base = (presented?.kind === "variant" && presented.openUrl) || row.url;
    return appendLiveVariantParams(base, {
      meetingUuid,
      homeworkId: presented?.kind === "variant" ? presented.homeworkId : null,
    });
  }
  if (row?.url) return appendMeetingParam(row.url, meetingUuid);
  return "";
}

export default function VideoMeetingPage() {
  const { meetingUuid } = useParams();
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const leavingRef = useRef(false);
  const participantIdRef = useRef("");
  const returnUrlRef = useRef("/cabinet/schedule");
  const jitsiInitRef = useRef(false);
  const pollTimerRef = useRef(null);
  const lessonTitleRef = useRef("");

  const [detail, setDetail] = useState(null);
  const [pageState, setPageState] = useState("loading"); // loading | waiting | camera | live | finished | cancelled | error
  const [error, setError] = useState("");
  const [mediaWarning, setMediaWarning] = useState("");
  const [participantCount, setParticipantCount] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const [finishConfirm, setFinishConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const cameraPrefRef = useRef(null);
  const [attendance, setAttendance] = useState(null);
  const [asideOpen, setAsideOpen] = useState(false);
  const [presented, setPresented] = useState(null);
  const [presentBusy, setPresentBusy] = useState(false);
  const [workspaceMaterial, setWorkspaceMaterial] = useState(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [materialsToast, setMaterialsToast] = useState("");
  const [mobilePane, setMobilePane] = useState("call"); // call | materials
  const [boardInfo, setBoardInfo] = useState({ loading: true, board: null });
  const [liveAnswers, setLiveAnswers] = useState(null);
  const [liveAnswersLoading, setLiveAnswersLoading] = useState(false);
  const [resourcePicker, setResourcePicker] = useState(null); // "lesson" | "homework" | null
  const [resourcePickerTab, setResourcePickerTab] = useState("library");
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState("");
  const openedPresentKeyRef = useRef("");
  const canManageRef = useRef(false);
  const callOwnerIdRef = useRef(`page-${Math.random().toString(36).slice(2, 10)}`);
  const [roleLabel, setRoleLabel] = useState("");
  const [isModerator, setIsModerator] = useState(false);
  const [moderatorLoginHint, setModeratorLoginHint] = useState("");
  const [moderatorToast, setModeratorToast] = useState("");
  const [joinState, setJoinState] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const [connectionHint, setConnectionHint] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [directMeetUrl, setDirectMeetUrl] = useState("");
  const [showJoinFallback, setShowJoinFallback] = useState(false);
  const moderatorToastTimerRef = useRef(null);

  const disposeApi = useCallback(() => {
    jitsiInitRef.current = false;
    if (apiRef.current) {
      try {
        apiRef.current.executeCommand?.("hangup");
      } catch {
        /* ignore */
      }
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
    setParticipantCount(1);
    setConnectionHint("");
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
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

  const initializeJitsi = useCallback(async () => {
    if (!meetingUuid || jitsiInitRef.current || apiRef.current) {
      return;
    }
    const cameraEnabled = cameraPrefRef.current === true
      || (cameraPrefRef.current == null && getMeetingCameraEnabled(meetingUuid) === true);
    const startWithVideoMuted = !cameraEnabled;
    jitsiInitRef.current = true;
    setError("");
    setMediaWarning("");
    setConnectionHint("Подключение к конференции…");
    setPageState("live");

    try {
      const config = await fetchVideoMeetingJoinConfig(meetingUuid);
      if (config?.meeting?.status && config.meeting.status !== "live") {
        jitsiInitRef.current = false;
        setPageState(config.meeting.status === "finished" ? "finished" : "waiting");
        return;
      }
      if (!config?.domain || !config?.roomName) {
        throw Object.assign(new Error("Backend не смог создать конфигурацию"), { code: "config" });
      }

      returnUrlRef.current = config.meeting?.returnUrl || returnUrlRef.current;
      const moderator = Boolean(config.meeting?.isModerator);
      setIsModerator(moderator);
      setRoleLabel(config.meeting?.roleLabel || (moderator ? "Организатор" : "Участник"));
      setDisplayName(resolveJitsiDisplayName(config));
      setModeratorLoginHint(
        config.requiresModeratorLogin
          ? "На meet.jit.si нажмите «Я организатор» и войдите в аккаунт Jitsi — иначе урок не начнётся."
          : "",
      );

      if (!config.jwt && config.authMode === "jwt") {
        throw Object.assign(new Error("Backend не вернул JWT для Jitsi"), { code: "jwt_missing" });
      }
      if (!containerRef.current) {
        throw new Error("Контейнер конференции недоступен");
      }

      const subject = String(
        lessonTitleRef.current
        || config.meeting?.subject
        || config.meeting?.title
        || "Урок",
      ).trim();
      const joinConfig = {
        ...config,
        startWithVideoMuted,
        meeting: {
          ...(config.meeting || {}),
          subject,
          title: subject,
        },
        event: {
          ...(config.event || {}),
          title: subject,
        },
      };

      try {
        setDirectMeetUrl(buildJitsiEmbedUrl(joinConfig));
      } catch {
        setDirectMeetUrl("");
      }
      setShowJoinFallback(false);

      const showModeratorToast = () => {
        setModeratorToast("Вы стали организатором встречи");
        if (moderatorToastTimerRef.current) {
          window.clearTimeout(moderatorToastTimerRef.current);
        }
        moderatorToastTimerRef.current = window.setTimeout(() => {
          setModeratorToast("");
          moderatorToastTimerRef.current = null;
        }, 3200);
      };

      const wrapped = await createJitsiMeetSession(joinConfig, containerRef.current, {
        onParticipantCount: (n) => {
          if (typeof n === "number" && n >= 0) setParticipantCount(n);
        },
        onJoined: (event) => {
          setJoinState("joined");
          setConnectionHint("");
          setShowJoinFallback(false);
          participantIdRef.current = event?.id || "";
          if (event?.roomName && config.roomName && event.roomName !== config.roomName) {
            setMediaWarning(
              "Комната у вас и у ученика не совпадает. Обновите страницу у обоих участников.",
            );
          }
        },
        onBecameModerator: showModeratorToast,
        onMediaWarning: (msg) => setMediaWarning(msg || ""),
      });
      apiRef.current = wrapped;
      claimMeetingCall(meetingUuid, callOwnerIdRef.current);
      setJoinState(wrapped.mode === "external-api" ? "joined" : "embedded");
      if (wrapped.mode !== "external-api") {
        window.setTimeout(() => {
          if (apiRef.current === wrapped) setShowJoinFallback(true);
        }, 12000);
      }
      try {
        const iframe = wrapped.getIFrame?.();
        if (iframe && typeof window !== "undefined") {
          const style = window.getComputedStyle(iframe);
          console.info("[Jitsi] iframe hit-test", {
            pointerEvents: style.pointerEvents,
            zIndex: style.zIndex,
            visibility: style.visibility,
            display: style.display,
          });
        }
      } catch {
        /* ignore */
      }

      try {
        await recordVideoMeetingJoin(meetingUuid, { jitsiParticipantId: "" });
      } catch {
        /* посещаемость не должна ломать конференцию */
      }
    } catch (err) {
      jitsiInitRef.current = false;
      disposeApi();
      if (err?.code === "not_live" || err?.status === 409) {
        const st = err?.data?.status || "scheduled";
        if (st === "finished") setPageState("finished");
        else if (st === "cancelled") setPageState("cancelled");
        else setPageState("waiting");
        return;
      }
      if (err?.message === "Не удалось загрузить Jitsi Meet") {
        setError("Не удалось соединиться с сервером (external_api.js)");
      } else if (err?.message === "jitsi_join_timeout" || err?.code === "jitsi_join_timeout") {
        setError(mapJoinError({ ...err, code: "jitsi_join_timeout" }));
      } else {
        setError(mapJoinError(err));
      }
      setPageState("error");
    }
  }, [disposeApi, meetingUuid]);

  /** Первый вход — спросить про камеру; повторный (док/материалы) — взять сохранённый выбор. */
  const requestJoin = useCallback(async ({ skipCameraPrompt = false } = {}) => {
    if (!meetingUuid || jitsiInitRef.current || apiRef.current) {
      return;
    }
    const stored = getMeetingCameraEnabled(meetingUuid);
    if (skipCameraPrompt || stored != null) {
      cameraPrefRef.current = stored === true;
      await initializeJitsi();
      return;
    }
    setError("");
    setPageState("camera");
  }, [initializeJitsi, meetingUuid]);

  const onCameraChoice = useCallback((enabled) => {
    if (!meetingUuid) return;
    setMeetingCameraEnabled(meetingUuid, enabled);
    cameraPrefRef.current = enabled;
    void initializeJitsi();
  }, [initializeJitsi, meetingUuid]);

  useEffect(() => () => {
    if (moderatorToastTimerRef.current) {
      window.clearTimeout(moderatorToastTimerRef.current);
    }
  }, []);

  const loadFinishedAttendance = useCallback(async (canManage) => {
    if (!canManage || !meetingUuid) return;
    try {
      const rows = await fetchVideoMeetingAttendance(meetingUuid);
      setAttendance(rows?.results || []);
    } catch {
      setAttendance([]);
    }
  }, [meetingUuid]);

  const bootstrap = useCallback(async () => {
    if (!meetingUuid) return;
    setPageState("loading");
    setError("");
    setAttendance(null);
    leavingRef.current = false;
    disposeApi();

    try {
      const meta = await fetchVideoMeetingDetail(meetingUuid);
      setDetail(meta);
      const tabTitle = resolveLessonTabTitle(meta);
      lessonTitleRef.current = tabTitle;
      document.title = tabTitle;
      setPresented(meta?.presented || meta?.videoMeeting?.presented || null);
      const canManage = Boolean(meta?.canManage);
      canManageRef.current = canManage;
      returnUrlRef.current = canManage
        ? "/cabinet/schedule"
        : "/cabinet/student/lessons";
      setIsModerator(canManage);
      // По умолчанию Jitsi на всю ширину; панель материалов открывается по кнопке.
      setAsideOpen(false);

      const status = meta?.videoMeeting?.status || "scheduled";
      if (status === "finished") {
        setPageState("finished");
        await loadFinishedAttendance(canManage);
        return;
      }
      if (status === "cancelled" || meta?.event?.status === "cancelled") {
        setPageState("cancelled");
        return;
      }
      if (status === "scheduled") {
        setPageState("waiting");
        return;
      }
      if (status === "live") {
        await requestJoin();
      }
    } catch (err) {
      setError(mapJoinError(err));
      setPageState("error");
    }
  }, [disposeApi, loadFinishedAttendance, meetingUuid, requestJoin]);

  useEffect(() => {
    void bootstrap();
    return () => {
      stopPolling();
      sendLeave();
      disposeApi();
    };
  }, [bootstrap, disposeApi, sendLeave, stopPolling]);

  useEffect(() => {
    if (pageState !== "waiting" || !meetingUuid) {
      stopPolling();
      return undefined;
    }
    const tick = async () => {
      try {
        const statusPayload = await fetchVideoMeetingStatus(meetingUuid);
        const status = statusPayload?.status;
        if (status === "live") {
          stopPolling();
          setDetail((prev) => (
            prev
              ? {
                ...prev,
                videoMeeting: {
                  ...(prev.videoMeeting || {}),
                  status: "live",
                  statusLabel: statusPayload.statusLabel || "Идёт сейчас",
                },
              }
              : prev
          ));
          await requestJoin();
        } else if (status === "finished") {
          stopPolling();
          setPageState("finished");
        } else if (status === "cancelled") {
          stopPolling();
          setPageState("cancelled");
        }
      } catch {
        /* polling не должен ломать страницу ожидания */
      }
    };
    pollTimerRef.current = window.setInterval(tick, STATUS_POLL_MS);
    return () => stopPolling();
  }, [meetingUuid, pageState, requestJoin, stopPolling]);

  // Показ доски/варианта у ученика: открываем в рабочей области рядом со звонком
  // (без пересоздания Jitsi и без ухода в другую вкладку).
  useEffect(() => {
    if (!meetingUuid || pageState !== "live") return undefined;
    let cancelled = false;
    let baselineReady = false;

    const openPresentedInWorkspace = (next) => {
      if (canManageRef.current) return;
      if (!next?.openUrl || !next?.kind) {
        openedPresentKeyRef.current = "";
        setWorkspaceMaterial(null);
        return;
      }
      const key = presentedOpenKey(next);
      if (openedPresentKeyRef.current === key) return;
      openedPresentKeyRef.current = key;
      const url = appendMeetingParam(next.openUrl, meetingUuid);
      setWorkspaceMaterial({
        title: next.title || "Материал",
        url,
        kind: next.kind,
        embed: isEmbeddableMaterialUrl(url),
      });
      setAsideOpen(false);
      setMobilePane("materials");
    };

    const applyPresented = (next) => {
      if (cancelled) return;
      setPresented(next || null);

      if (canManageRef.current) {
        if (!next?.openUrl || !next?.kind) {
          openedPresentKeyRef.current = "";
        }
        return;
      }

      if (!next?.openUrl || !next?.kind) {
        const hadOpen = Boolean(openedPresentKeyRef.current);
        openedPresentKeyRef.current = "";
        if (baselineReady && hadOpen) {
          setWorkspaceMaterial(null);
          setMobilePane("call");
        }
        baselineReady = true;
        return;
      }

      const key = presentedOpenKey(next);

      if (!baselineReady) {
        baselineReady = true;
        openedPresentKeyRef.current = key;
        return;
      }

      if (key === openedPresentKeyRef.current) return;
      openPresentedInWorkspace(next);
    };

    const tick = async () => {
      try {
        const statusPayload = await fetchVideoMeetingStatus(meetingUuid);
        if (cancelled) return;
        applyPresented(statusPayload?.presented || null);
        if (statusPayload?.status === "finished") {
          setPageState("finished");
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, PRESENT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [meetingUuid, pageState]);

  useEffect(() => {
    canManageRef.current = Boolean(detail?.canManage);
  }, [detail?.canManage]);

  useEffect(() => {
    if (!meetingUuid) return undefined;
    return subscribeMeetingCall((data) => {
      if (!data || data.meetingUuid !== meetingUuid) return;
      if (data.type === "claim" && data.ownerId && data.ownerId !== callOwnerIdRef.current) {
        // Другая вкладка забрала звонок — не держим вторую сессию здесь.
        disposeApi();
      }
      if (data.type === "unpresent") {
        setPresented(null);
        setLiveAnswers(null);
        openedPresentKeyRef.current = "";
        setWorkspaceMaterial(null);
        setMobilePane("call");
      }
    });
  }, [disposeApi, meetingUuid]);

  useEffect(() => () => {
    releaseMeetingCall(meetingUuid, callOwnerIdRef.current);
  }, [meetingUuid]);

  useEffect(() => {
    if (!meetingUuid || pageState !== "live" || !detail?.canManage) return undefined;
    if (presented?.kind !== "variant") {
      setLiveAnswers(null);
      return undefined;
    }
    // Пока показан вариант — держим панель материалов открытой, чтобы ответы были видны.
    setAsideOpen(true);
    let cancelled = false;
    const tick = async () => {
      setLiveAnswersLoading(true);
      try {
        const data = await fetchVideoMeetingLiveAnswers(meetingUuid);
        if (!cancelled) setLiveAnswers(data);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLiveAnswersLoading(false);
      }
    };
    void tick();
    const id = window.setInterval(tick, LIVE_ANSWERS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [detail?.canManage, meetingUuid, pageState, presented?.kind, presented?.homeworkId, presented?.presentedAt]);

  useEffect(() => {
    const onPageHide = () => sendLeave();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [sendLeave]);

  const onStartLesson = async () => {
    if (!meetingUuid || starting) return;
    setStarting(true);
    setError("");
    try {
      const data = await startVideoMeeting(meetingUuid);
      setDetail((prev) => (
        prev
          ? { ...prev, videoMeeting: data?.videoMeeting || { ...(prev.videoMeeting || {}), status: "live" } }
          : prev
      ));
      stopPolling();
      await requestJoin();
    } catch (err) {
      setError(err?.message || "Не удалось начать урок");
    } finally {
      setStarting(false);
    }
  };

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
      setPageState("finished");
      setFinishConfirm(false);
      await loadFinishedAttendance(true);
      if (isModerator && event?.id) openLessonSummaryTab(event.id);
    } catch (err) {
      setError(err?.message || "Не удалось завершить урок");
    } finally {
      setFinishing(false);
    }
  };

  const onCopyLink = async () => {
    const pageUrl = detail?.videoMeeting?.pageUrl || detail?.videoMeeting?.joinUrl
      || (meetingUuid ? `/cabinet/meetings/${meetingUuid}` : "");
    const ok = await copyText(absoluteJoinUrl(pageUrl));
    if (ok) {
      setCopied(true);
      setCopyHint("Ссылка скопирована");
      window.setTimeout(() => {
        setCopied(false);
        setCopyHint("");
      }, 2000);
    } else {
      setCopyHint("Не удалось скопировать ссылку");
      window.setTimeout(() => setCopyHint(""), 2500);
    }
  };

  const event = detail?.event;
  const meeting = detail?.videoMeeting;
  const canManage = Boolean(detail?.canManage);
  canManageRef.current = canManage;
  const status = meeting?.status || "scheduled";
  const returnUrl = returnUrlRef.current || (canManage ? "/cabinet/schedule" : "/cabinet/student/lessons");
  const scheduleUrl = "/cabinet/schedule";

  const { materialRows, homeworkRows } = useMemo(() => {
    const planItem = event?.planItem || null;
    // Варианты — тоже материалы урока, без отдельного блока.
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

  const refreshMeetingDetail = useCallback(async () => {
    if (!meetingUuid) return;
    try {
      const meta = await fetchVideoMeetingDetail(meetingUuid);
      setDetail(meta);
      setPresented(meta?.presented || meta?.videoMeeting?.presented || null);
    } catch {
      /* ignore */
    }
  }, [meetingUuid]);

  const ensurePlanItem = useCallback(async () => {
    if (!event?.id) throw new Error("Нет занятия");
    if (event?.planItem?.id) return event.planItem;
    const data = await ensureScheduleEventPlanItem(event.id);
    const planItem = data?.planItem || null;
    if (!planItem?.id) throw new Error("Не удалось подготовить урок для материалов");
    setDetail((prev) => (
      prev
        ? { ...prev, event: { ...prev.event, planItem: { ...prev.event?.planItem, ...planItem } } }
        : prev
    ));
    return planItem;
  }, [event]);

  const openAddMaterials = useCallback(async (initialTab = "library") => {
    setAttachError("");
    try {
      await ensurePlanItem();
      setResourcePickerTab(initialTab);
      setResourcePicker("lesson");
    } catch (err) {
      setAttachError(err?.message || "Не удалось открыть добавление материалов");
    }
  }, [ensurePlanItem]);

  const openAddHomework = useCallback(async () => {
    setAttachError("");
    try {
      await ensurePlanItem();
      setResourcePickerTab("library");
      setResourcePicker("homework");
    } catch (err) {
      setAttachError(err?.message || "Не удалось открыть добавление ДЗ");
    }
  }, [ensurePlanItem]);

  const onAttachPlanMaterial = useCallback(async (material) => {
    setAttachError("");
    let planItemId = event?.planItem?.id;
    if (!planItemId) {
      const ensured = await ensurePlanItem();
      planItemId = ensured?.id;
    }
    if (!planItemId || !material?.id) {
      throw new Error("Не удалось прикрепить материал к уроку");
    }
    setAttachBusy(true);
    try {
      const current = (event?.planItem?.materials || []).map((m) => m.id).filter(Boolean);
      if (!current.includes(material.id)) current.push(material.id);
      const data = await updateLessonPlanItem(planItemId, { material_ids: current });
      const mapped = mapApiPlanItem(data);
      setDetail((prev) => (
        prev
          ? { ...prev, event: { ...prev.event, planItem: { ...prev.event?.planItem, ...mapped } } }
          : prev
      ));
      setResourcePicker(null);
      setMaterialsToast("Материал добавлен");
      window.setTimeout(() => setMaterialsToast(""), 2200);
      await refreshMeetingDetail();
    } catch (err) {
      setAttachError(err?.message || "Не удалось добавить материал");
      throw err;
    } finally {
      setAttachBusy(false);
    }
  }, [ensurePlanItem, event, refreshMeetingDetail]);

  const onAttachPlanInteractive = useCallback(async (interactive) => {
    setAttachError("");
    let planItemId = event?.planItem?.id;
    if (!planItemId) {
      const ensured = await ensurePlanItem();
      planItemId = ensured?.id;
    }
    if (!planItemId || !interactive?.id) {
      throw new Error("Не удалось прикрепить интерактив к уроку");
    }
    setAttachBusy(true);
    try {
      const current = (event?.planItem?.attachedInteractives || event?.planItem?.attached_interactives || [])
        .map((i) => i.id)
        .filter(Boolean);
      if (!current.includes(interactive.id)) current.push(interactive.id);
      const data = await updateLessonPlanItem(planItemId, { interactive_ids: current });
      const mapped = mapApiPlanItem(data);
      setDetail((prev) => (
        prev
          ? { ...prev, event: { ...prev.event, planItem: { ...prev.event?.planItem, ...mapped } } }
          : prev
      ));
      setResourcePicker(null);
      setMaterialsToast("Материал добавлен");
      window.setTimeout(() => setMaterialsToast(""), 2200);
      await refreshMeetingDetail();
    } catch (err) {
      setAttachError(err?.message || "Не удалось добавить интерактив");
      throw err;
    } finally {
      setAttachBusy(false);
    }
  }, [ensurePlanItem, event, refreshMeetingDetail]);

  const onAttachHomeworkMaterial = useCallback(async (material) => {
    setAttachError("");
    let planItemId = event?.planItem?.id;
    if (!planItemId) {
      const ensured = await ensurePlanItem();
      planItemId = ensured?.id;
    }
    if (!planItemId || !material?.id) {
      throw new Error("Не удалось прикрепить материал ДЗ");
    }
    setAttachBusy(true);
    try {
      const current = (event?.planItem?.homeworkMaterials || event?.planItem?.homework_materials || [])
        .map((m) => m.id)
        .filter(Boolean);
      if (!current.includes(material.id)) current.push(material.id);
      const data = await updateLessonPlanItem(planItemId, { homework_material_ids: current });
      const mapped = mapApiPlanItem(data);
      setDetail((prev) => (
        prev
          ? { ...prev, event: { ...prev.event, planItem: { ...prev.event?.planItem, ...mapped } } }
          : prev
      ));
      setResourcePicker(null);
      setMaterialsToast("Материал добавлен");
      window.setTimeout(() => setMaterialsToast(""), 2200);
      await refreshMeetingDetail();
    } catch (err) {
      setAttachError(err?.message || "Не удалось добавить материал ДЗ");
      throw err;
    } finally {
      setAttachBusy(false);
    }
  }, [ensurePlanItem, event, refreshMeetingDetail]);

  const onAttachHomeworkInteractive = useCallback(async (interactive) => {
    setAttachError("");
    let planItemId = event?.planItem?.id;
    if (!planItemId) {
      const ensured = await ensurePlanItem();
      planItemId = ensured?.id;
    }
    if (!planItemId || !interactive?.id) {
      throw new Error("Не удалось прикрепить интерактив в ДЗ");
    }
    setAttachBusy(true);
    try {
      const current = (event?.planItem?.homeworkInteractives || event?.planItem?.homework_interactives || [])
        .map((i) => i.id)
        .filter(Boolean);
      if (!current.includes(interactive.id)) current.push(interactive.id);
      const data = await updateLessonPlanItem(planItemId, { homework_interactive_ids: current });
      const mapped = mapApiPlanItem(data);
      setDetail((prev) => (
        prev
          ? { ...prev, event: { ...prev.event, planItem: { ...prev.event?.planItem, ...mapped } } }
          : prev
      ));
      setResourcePicker(null);
      setMaterialsToast("Материал добавлен");
      window.setTimeout(() => setMaterialsToast(""), 2200);
      await refreshMeetingDetail();
    } catch (err) {
      setAttachError(err?.message || "Не удалось добавить интерактив в ДЗ");
      throw err;
    } finally {
      setAttachBusy(false);
    }
  }, [ensurePlanItem, event, refreshMeetingDetail]);

  const showJitsi = pageState === "live" && attendance == null;

  const showMaterialsToast = useCallback((text) => {
    setMaterialsToast(text);
    window.setTimeout(() => setMaterialsToast(""), 2200);
  }, []);

  const openWorkspaceMaterial = useCallback((payload) => {
    if (!payload?.url && !payload?.text) return;
    if (payload.url && !isEmbeddableMaterialUrl(payload.url) && !payload.forceEmbed) {
      window.open(payload.url, "_blank", "noopener,noreferrer");
      return;
    }
    setWorkspaceMaterial({
      title: payload.title || "Материал",
      url: payload.url || "",
      text: payload.text || "",
      kind: payload.kind || "material",
      embed: Boolean(payload.url) && (payload.forceEmbed || isEmbeddableMaterialUrl(payload.url)),
    });
    setAsideOpen(false);
    setMobilePane("materials");
  }, []);

  const closeWorkspaceMaterial = useCallback(() => {
    setWorkspaceMaterial(null);
    setMobilePane("call");
  }, []);

  const onOpenRow = useCallback((row) => {
    if (row?.text && !row?.url) {
      openWorkspaceMaterial({
        title: row.label,
        text: row.text,
        kind: row.kind,
      });
      return;
    }
    const url = resolveMaterialOpenUrl(row, meetingUuid, presented);
    if (!url && row?.kind === "board" && boardInfo?.board?.id) {
      openWorkspaceMaterial({
        title: boardInfo.board.title || "Доска",
        url: appendMeetingParam(`/cabinet/boards/${boardInfo.board.id}`, meetingUuid),
        kind: "board",
        forceEmbed: true,
      });
      return;
    }
    if (!url) return;
    openWorkspaceMaterial({
      title: row.label,
      url,
      kind: row.kind,
      forceEmbed: row.kind === "board" || row.kind === "variant",
    });
  }, [boardInfo?.board, meetingUuid, openWorkspaceMaterial, presented]);

  const onOpenInNewTab = useCallback((row) => {
    const url = resolveMaterialOpenUrl(row, meetingUuid, presented);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, [meetingUuid, presented]);

  const onOpenBoardLocally = useCallback((board) => {
    if (!board?.id) return;
    openWorkspaceMaterial({
      title: board.title || "Доска",
      url: appendMeetingParam(`/cabinet/boards/${board.id}`, meetingUuid),
      kind: "board",
      forceEmbed: true,
    });
  }, [meetingUuid, openWorkspaceMaterial]);

  const onShowBoard = useCallback(async (board) => {
    if (!meetingUuid || !board?.id) return;
    setPresentBusy(true);
    try {
      const data = await presentVideoMeetingResource(meetingUuid, {
        kind: "board",
        boardId: board.id,
      });
      const next = data?.presented || {
        kind: "board",
        boardId: board.id,
        openUrl: `/cabinet/boards/${board.id}`,
        title: board.title || "Доска",
      };
      setPresented(next);
      showMaterialsToast("Материал показан ученику");
    } catch (err) {
      setError(err?.message || "Не удалось показать доску");
    } finally {
      setPresentBusy(false);
    }
  }, [meetingUuid, showMaterialsToast]);

  const onShowVariant = useCallback(async (row) => {
    if (!meetingUuid || !row) return;
    setPresentBusy(true);
    try {
      const data = await presentVideoMeetingResource(meetingUuid, {
        kind: "variant",
        title: row.label || "",
        url: row.url || "",
        materialId: row.materialId || null,
      });
      setPresented(data?.presented || null);
      showMaterialsToast("Материал показан ученику");
    } catch (err) {
      setError(err?.message || "Не удалось показать вариант");
    } finally {
      setPresentBusy(false);
    }
  }, [meetingUuid, showMaterialsToast]);

  const onClearPresented = useCallback(async () => {
    if (!meetingUuid) return;
    setPresentBusy(true);
    try {
      await clearVideoMeetingPresented(meetingUuid);
      setPresented(null);
      setLiveAnswers(null);
      openedPresentKeyRef.current = "";
      postMeetingUnpresent(meetingUuid);
      claimMeetingCall(meetingUuid, callOwnerIdRef.current);
      showMaterialsToast("Материал скрыт от ученика");
    } catch (err) {
      setError(err?.message || "Не удалось скрыть материал");
    } finally {
      setPresentBusy(false);
    }
  }, [meetingUuid, showMaterialsToast]);

  const onToggleVisibility = useCallback(async (row, currentlyShowing) => {
    if (currentlyShowing) {
      await onClearPresented();
      return;
    }
    if (row.kind === "board") {
      const board = row.boardId
        ? { id: row.boardId, title: row.label }
        : boardInfo?.board;
      if (board?.id) await onShowBoard(board);
      return;
    }
    if (row.kind === "variant") {
      await onShowVariant(row);
    }
  }, [boardInfo?.board, onClearPresented, onShowBoard, onShowVariant]);

  const onAddMenuAction = useCallback((actionId) => {
    if (actionId === "homework") {
      void openAddHomework();
      return;
    }
    const tabMap = {
      library: "library",
      file: "file",
      link: "file",
      variant: "variant",
      interactive: "interactives",
    };
    void openAddMaterials(tabMap[actionId] || "library");
  }, [openAddHomework, openAddMaterials]);

  const materialsCount = canManage
    ? (materialRows.length + homeworkRows.length + (boardInfo?.board ? 1 : 0))
    : (presented?.openUrl ? 1 : 0);
  const whenLabel = formatWhen(event?.startsAt, event?.endsAt);
  const statusLiveLabel = status === "live"
    ? "Урок идёт"
    : (meeting?.statusLabel || "");
  const headerTitle = [event?.title || "Урок", displayName].filter(Boolean).join(" · ");
  const headerSub = [
    whenLabel,
    statusLiveLabel,
    typeof participantCount === "number" ? `${participantCount} уч.` : null,
  ].filter(Boolean).join(" · ");
  const workspaceOpen = Boolean(workspaceMaterial);
  const showAside = showJitsi && asideOpen && !workspaceOpen;

  useEffect(() => {
    // Сообщаем Jitsi о смене размеров контейнера без пересоздания сессии.
    window.dispatchEvent(new Event("resize"));
  }, [asideOpen, workspaceOpen, mobilePane]);

  const studentMaterialRows = canManage
    ? materialRows
    : (presented?.openUrl
      ? [{
        key: `presented-${presented.kind}`,
        kind: presented.kind,
        label: presented.title || "Материал",
        typeLabel: presented.kind === "board" ? "Доска" : "Вариант",
        url: presented.openUrl,
        boardId: presented.boardId,
        materialId: presented.materialId,
        homeworkId: presented.homeworkId,
      }]
      : []);

  return (
    <div
      className={[
        "video-lesson-page",
        showAside ? "video-lesson-page--aside" : "",
        workspaceOpen && showJitsi ? "video-lesson-page--workspace" : "",
        mobilePane === "materials" && showJitsi ? "video-lesson-page--mobile-materials" : "",
      ].filter(Boolean).join(" ")}
    >
      <header className="video-lesson-header">
        <div className="video-lesson-header__left">
          <div className="video-lesson-header__meta">
            <h1 className="video-lesson-header__title" title={headerTitle}>
              {headerTitle}
            </h1>
            <p className="video-lesson-header__sub" title={headerSub}>
              {headerSub || roleLabel || "Онлайн-урок"}
            </p>
          </div>
        </div>

        <div className="video-lesson-header__actions">
          {showJitsi ? (
            <button
              type="button"
              className={`video-lesson-btn video-lesson-btn--ghost${asideOpen && !workspaceOpen ? " is-active" : ""}`}
              onClick={() => {
                if (workspaceOpen) closeWorkspaceMaterial();
                setAsideOpen((v) => !v);
                setMobilePane((prev) => (prev === "materials" && asideOpen ? "call" : "materials"));
              }}
              aria-pressed={asideOpen && !workspaceOpen}
              title={asideOpen && !workspaceOpen ? "Скрыть материалы" : "Показать материалы"}
            >
              Материалы{materialsCount ? ` · ${materialsCount}` : ""}
            </button>
          ) : null}

          <div className="vl-header-menu">
            <button
              type="button"
              className="video-lesson-icon-btn"
              aria-label="Меню урока"
              aria-expanded={headerMenuOpen}
              title="Ещё"
              onClick={() => setHeaderMenuOpen((v) => !v)}
            >
              <span aria-hidden="true">•••</span>
            </button>
            {headerMenuOpen ? (
              <div className="vl-dropdown vl-dropdown--header" role="menu">
                <Link
                  role="menuitem"
                  to={returnUrl}
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    sendLeave();
                  }}
                >
                  К расписанию
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    void onCopyLink();
                  }}
                >
                  {copied ? "Ссылка скопирована" : "Скопировать ссылку на урок"}
                </button>
                {directMeetUrl ? (
                  <a
                    role="menuitem"
                    href={directMeetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setHeaderMenuOpen(false)}
                  >
                    Открыть Jitsi на весь экран
                  </a>
                ) : null}
                {canManage && status === "live" && showJitsi ? (
                  <>
                    <div className="vl-dropdown__sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      disabled={finishing}
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setFinishConfirm(true);
                      }}
                    >
                      Завершить урок
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {showJitsi ? (
        <div className="video-lesson-mobile-switch" role="tablist" aria-label="Режим экрана">
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === "call"}
            className={mobilePane === "call" ? "is-active" : ""}
            onClick={() => {
              setMobilePane("call");
              if (workspaceOpen) closeWorkspaceMaterial();
              setAsideOpen(false);
            }}
          >
            Звонок
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === "materials"}
            className={mobilePane === "materials" ? "is-active" : ""}
            onClick={() => {
              setMobilePane("materials");
              setAsideOpen(true);
            }}
          >
            Материалы
          </button>
        </div>
      ) : null}

      <div className="video-lesson-body">
        {workspaceOpen && showJitsi ? (
          <section className="video-lesson-workspace" aria-label="Просмотр материала">
            <div className="video-lesson-workspace__bar">
              <strong className="video-lesson-workspace__title">{workspaceMaterial.title}</strong>
              <div className="video-lesson-workspace__actions">
                <button
                  type="button"
                  className="video-lesson-btn video-lesson-btn--text"
                  onClick={() => {
                    closeWorkspaceMaterial();
                    setAsideOpen(true);
                    setMobilePane("materials");
                  }}
                >
                  Назад к списку
                </button>
                {workspaceMaterial.url ? (
                  <a
                    className="video-lesson-btn video-lesson-btn--text"
                    href={workspaceMaterial.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Открыть в новой вкладке
                  </a>
                ) : null}
                <button
                  type="button"
                  className="video-lesson-btn video-lesson-btn--text"
                  onClick={closeWorkspaceMaterial}
                >
                  Вернуть звонок на весь экран
                </button>
                <button
                  type="button"
                  className="video-lesson-icon-btn"
                  aria-label="Закрыть материал"
                  title="Закрыть"
                  onClick={closeWorkspaceMaterial}
                >
                  <CabinetIcon name="close" />
                </button>
              </div>
            </div>
            <div className="video-lesson-workspace__stage">
              {workspaceMaterial.text && !workspaceMaterial.url ? (
                <div className="video-lesson-workspace__text">{workspaceMaterial.text}</div>
              ) : workspaceMaterial.embed && workspaceMaterial.url ? (
                <iframe
                  title={workspaceMaterial.title}
                  src={workspaceMaterial.url}
                  className="video-lesson-workspace__frame"
                  allow="clipboard-read; clipboard-write; fullscreen"
                />
              ) : (
                <div className="vl-empty">
                  <p className="vl-empty__title">Материал открывается во внешней вкладке</p>
                  {workspaceMaterial.url ? (
                    <a
                      className="video-lesson-btn video-lesson-btn--primary"
                      href={workspaceMaterial.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть
                    </a>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        ) : null}

        <main className="video-lesson-content">
          {pageState === "loading" ? (
            <div className="video-lesson-state">
              <div className="video-lesson-state__spinner" aria-hidden="true" />
              <p className="video-lesson-state__title">Загрузка…</p>
            </div>
          ) : null}

          {pageState === "waiting" ? (
            <div className="video-lesson-state" style={{ position: "relative" }}>
              {canManage ? (
                <>
                  <p className="video-lesson-state__title">Онлайн-урок ещё не начат</p>
                  <p className="video-lesson-state__text">
                    Ссылка уже создана. Когда будете готовы, нажмите «Начать урок».
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    <button
                      type="button"
                      className="video-lesson-btn video-lesson-btn--primary"
                      onClick={() => void onStartLesson()}
                      disabled={starting}
                    >
                      {starting ? "Запуск…" : "Начать урок"}
                    </button>
                    <button type="button" className="video-lesson-btn" onClick={() => void onCopyLink()}>
                      {copied ? "Ссылка скопирована" : "Копировать ссылку"}
                    </button>
                    <Link to={returnUrl} className="video-lesson-btn">
                      Вернуться к уроку
                    </Link>
                  </div>
                  {copyHint ? <p className="video-lesson-state__text">{copyHint}</p> : null}
                </>
              ) : (
                <>
                  <div className="video-lesson-state__spinner" aria-hidden="true" />
                  <p className="video-lesson-state__title">Онлайн-урок ещё не начался</p>
                  <p className="video-lesson-state__text">
                    Подождите, пока учитель начнёт занятие. Страница обновится автоматически.
                  </p>
                  <Link to={returnUrl} className="video-lesson-btn">
                    Вернуться к уроку
                  </Link>
                </>
              )}
              {error ? <p className="video-lesson-state__text" style={{ color: "#fca5a5" }}>{error}</p> : null}
            </div>
          ) : null}

          {pageState === "camera" ? (
            <div className="video-lesson-state video-lesson-state--camera">
              <div className="video-lesson-camera-icon" aria-hidden="true">
                <CabinetIcon name="video" />
              </div>
              <p className="video-lesson-state__title">Включить камеру?</p>
              <p className="video-lesson-state__text">
                Микрофон будет выключен. Камеру можно сменить позже в конференции.
              </p>
              <div className="video-lesson-camera-actions">
                <button
                  type="button"
                  className="video-lesson-btn video-lesson-btn--primary"
                  onClick={() => onCameraChoice(true)}
                >
                  С камерой
                </button>
                <button
                  type="button"
                  className="video-lesson-btn"
                  onClick={() => onCameraChoice(false)}
                >
                  Без камеры
                </button>
              </div>
            </div>
          ) : null}

          {pageState === "cancelled" ? (
            <div className="video-lesson-state">
              <p className="video-lesson-state__title">Урок отменён</p>
              <p className="video-lesson-state__text">Вход в конференцию недоступен.</p>
              <Link to={returnUrl} className="video-lesson-btn video-lesson-btn--primary">
                Вернуться к уроку
              </Link>
            </div>
          ) : null}

          {pageState === "finished" || attendance != null ? (
            <div className="video-lesson-state" style={{ position: "relative" }}>
              <p className="video-lesson-state__title">Урок завершён</p>
              <p className="video-lesson-state__text">
                {canManage
                  ? (attendance?.length
                    ? "Сессии подключений участников (время посчитано на сервере)."
                    : "Подключений пока не было.")
                  : "Повторный вход в конференцию недоступен."}
              </p>
              {canManage && Array.isArray(attendance) ? (
                <div style={{ width: "min(640px, 100%)", textAlign: "left", maxHeight: "40vh", overflow: "auto" }}>
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
              ) : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 12 }}>
                {canManage && event?.id ? (
                  <button
                    type="button"
                    className="video-lesson-btn video-lesson-btn--primary"
                    onClick={() => openLessonSummaryTab(event.id)}
                  >
                    Итоги урока
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    className="video-lesson-btn"
                    onClick={() => void loadFinishedAttendance(true)}
                  >
                    Открыть аналитику
                  </button>
                ) : null}
                <Link to={returnUrl} className="video-lesson-btn">
                  Вернуться к уроку
                </Link>
                <Link to={scheduleUrl} className="video-lesson-btn">
                  Вернуться в расписание
                </Link>
              </div>
            </div>
          ) : null}

          {pageState === "error" ? (
            <div className="video-lesson-state">
              <p className="video-lesson-state__title">Не удалось войти во встречу</p>
              <p className="video-lesson-state__text">{error}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                <button
                  type="button"
                  className="video-lesson-btn video-lesson-btn--primary"
                  onClick={() => void bootstrap()}
                >
                  Повторить подключение
                </button>
                {directMeetUrl ? (
                  <a
                    className="video-lesson-btn"
                    href={directMeetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Открыть в новой вкладке
                  </a>
                ) : null}
                <Link to={returnUrl} className="video-lesson-btn">
                  Вернуться к уроку
                </Link>
              </div>
            </div>
          ) : null}

          {moderatorToast ? (
            <div className="video-lesson-toast" role="status">
              <span className="video-lesson-toast__icon" aria-hidden="true">
                <CabinetIcon name="check" />
              </span>
              <span>{moderatorToast}</span>
            </div>
          ) : null}
          {materialsToast && showJitsi ? (
            <div className="video-lesson-toast" role="status">
              <span>{materialsToast}</span>
            </div>
          ) : null}
          {moderatorLoginHint && showJitsi && !error ? (
            <div className="video-lesson-moderator-hint" role="status">
              <strong>Нужно подтвердить роль организатора</strong>
              <p>{moderatorLoginHint}</p>
              <button type="button" onClick={() => setModeratorLoginHint("")} aria-label="Скрыть подсказку">
                Понятно
              </button>
            </div>
          ) : null}
          {mediaWarning && showJitsi && !error ? (
            <div className="video-lesson-media-warning" role="status">
              <span>{mediaWarning}</span>
              <button type="button" onClick={() => setMediaWarning("")} aria-label="Закрыть">
                ×
              </button>
            </div>
          ) : null}
          {connectionHint && showJitsi && !error ? (
            <div className="video-lesson-media-warning" role="status">
              <span>{connectionHint}</span>
            </div>
          ) : null}
          {showJitsi && showJoinFallback && directMeetUrl && joinState !== "joined" ? (
            <div className="video-lesson-media-warning" role="status">
              <span>
                Кнопка «Присоединиться» не срабатывает? Откройте комнату в новой вкладке
                (часто из‑за JWT/Prosody на сервере).
              </span>
              <a
                className="video-lesson-btn"
                href={directMeetUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none" }}
              >
                Открыть
              </a>
              <button type="button" onClick={() => setShowJoinFallback(false)} aria-label="Закрыть">
                ×
              </button>
            </div>
          ) : null}

          <div
            id="jitsi-container"
            ref={containerRef}
            hidden={!showJitsi}
          />
        </main>

        {showAside ? (
          <VideoLessonMaterialsPanel
            canManage={canManage}
            materialRows={canManage ? materialRows : studentMaterialRows}
            homeworkRows={canManage ? homeworkRows : []}
            presented={presented}
            presentBusy={presentBusy}
            event={event}
            liveAnswers={liveAnswers}
            liveAnswersLoading={liveAnswersLoading}
            attachError={attachError}
            toast={materialsToast}
            onClose={() => {
              setAsideOpen(false);
              setMobilePane("call");
            }}
            onAddMenuAction={onAddMenuAction}
            onOpenRow={onOpenRow}
            onToggleVisibility={onToggleVisibility}
            onOpenInNewTab={onOpenInNewTab}
            onShowBoard={onShowBoard}
            onOpenBoardLocally={onOpenBoardLocally}
            onHidePresented={onClearPresented}
            onBoardPresenceChange={setBoardInfo}
          />
        ) : null}
      </div>

      <ConfirmActionModal
        open={finishConfirm}
        title="Завершить урок?"
        text="Все участники будут отключены от встречи. Это действие нельзя отменить."
        confirmLabel="Завершить"
        danger
        loading={finishing}
        onClose={() => {
          if (!finishing) setFinishConfirm(false);
        }}
        onConfirm={onFinish}
      />

      <PlanItemResourcesPicker
        scope={resourcePicker === "homework" ? "homework" : "lesson"}
        open={Boolean(resourcePicker)}
        initialTab={resourcePickerTab}
        attachedMaterialIds={
          resourcePicker === "homework"
            ? (event?.planItem?.homeworkMaterials || event?.planItem?.homework_materials || []).map((m) => m.id)
            : (event?.planItem?.materials || []).map((m) => m.id)
        }
        attachedInteractiveIds={
          resourcePicker === "homework"
            ? (event?.planItem?.homeworkInteractives || event?.planItem?.homework_interactives || []).map((i) => i.id)
            : (event?.planItem?.attachedInteractives || event?.planItem?.attached_interactives || []).map((i) => i.id)
        }
        onClose={() => { if (!attachBusy) setResourcePicker(null); }}
        onAttachMaterial={resourcePicker === "homework" ? onAttachHomeworkMaterial : onAttachPlanMaterial}
        onAttachInteractive={resourcePicker === "homework" ? onAttachHomeworkInteractive : onAttachPlanInteractive}
      />
    </div>
  );
}
