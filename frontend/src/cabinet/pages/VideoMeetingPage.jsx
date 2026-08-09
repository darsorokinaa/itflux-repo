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
  closeMeetingMaterialSession,
  ensureScheduleEventPlanItem,
  fetchVideoMeetingAttendance,
  fetchVideoMeetingDetail,
  fetchVideoMeetingJoinConfig,
  fetchVideoMeetingLiveAnswers,
  fetchVideoMeetingStatus,
  finishVideoMeeting,
  openMeetingMaterialSession,
  presentVideoMeetingResource,
  recordVideoMeetingJoin,
  recordVideoMeetingLeave,
  setMeetingMaterialFollowPolicy,
  setMeetingMaterialPermission,
  startVideoMeeting,
  transferMeetingMaterialControl,
  updateLessonPlanItem,
} from "../../utils/cabinetAuth";
import {
  buildJitsiEmbedUrl,
  createJitsiMeetSession,
  getMeetingCameraEnabled,
  getMeetingMicEnabled,
  resolveJitsiDisplayName,
  setMeetingCameraEnabled,
  setMeetingMicEnabled,
} from "../jitsiMeet";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { openLessonSummaryTab } from "../journal/openLessonSummary";
import PlanItemResourcesPicker from "../components/PlanItemResourcesPicker";
import VideoLessonMaterialsPanel from "../components/VideoLessonMaterialsPanel";
import SyncedMaterialWorkspace from "../components/SyncedMaterialWorkspace";
import CabinetIcon from "../CabinetIcons";
import { formatPageTitle } from "../hooks/usePageTitle";
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
import {
  canSyncPresentRow,
  createMeetingMaterialCollab,
  createRemoteApplyGuard,
  inferSyncResourceKind,
} from "../meetingMaterialCollab";
import {
  applyMaterialOperation,
  canSendMaterialAction,
  COLLAB_PERMISSIONS,
  defaultCollabPermissionForKind,
  isFollowContentAction,
  isNavigationAction,
} from "../materials/collab";
import { useFloatingDrag } from "../useFloatingDrag";
import "../styles/video-meeting.css";
import "../styles/live-variant-answers.css";

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
const PRESENT_POLL_MS = 10000;
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

function resolveMaterialOpenUrl(row, meetingUuid, presented, { forEmbed = false } = {}) {
  if (row?.kind === "board" && row.boardId) {
    const boardUrl = `/cabinet/boards/${row.boardId}`;
    // В iframe на странице звонка не ставим ?meeting= — иначе MeetingCallDock
    // поднимает второй Jitsi и глушит микрофон.
    return forEmbed ? boardUrl : appendMeetingParam(boardUrl, meetingUuid);
  }
  if (row?.kind === "variant") {
    const base = (presented?.kind === "variant" && presented.openUrl) || row.url;
    return appendLiveVariantParams(base, {
      meetingUuid: forEmbed ? null : meetingUuid,
      homeworkId: presented?.kind === "variant" ? presented.homeworkId : null,
    });
  }
  if (!row?.url) return "";
  // API preview/download не нужно помечать meeting= — query ломает PDF viewer.
  if (String(row.url).startsWith("/api/cabinet/")) return row.url;
  return forEmbed ? row.url : appendMeetingParam(row.url, meetingUuid);
}

export default function VideoMeetingPage() {
  const { meetingUuid } = useParams();
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const leavingRef = useRef(false);
  const leaveTimerRef = useRef(null);
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
  const [materialSession, setMaterialSession] = useState(null);
  const [materialSyncStatus, setMaterialSyncStatus] = useState("synced");
  const [materialNotice, setMaterialNotice] = useState("");
  const [remoteCursors, setRemoteCursors] = useState([]);
  const [remotePreviews, setRemotePreviews] = useState({});
  const [studentViewports, setStudentViewports] = useState({});
  const [materialPresence, setMaterialPresence] = useState([]);
  const [followByUser, setFollowByUser] = useState({});
  const [collabPermOpen, setCollabPermOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagSnapshot, setDiagSnapshot] = useState(null);
  const materialCollabRef = useRef(null);
  const remoteCursorTimersRef = useRef(new Map());
  const remoteApplyGuardRef = useRef(createRemoteApplyGuard());
  const seenOpIdsRef = useRef(new Set());
  const followingTeacherRef = useRef(true);
  const [materialsToast, setMaterialsToast] = useState("");
  const [mobilePane, setMobilePane] = useState("call"); // call | materials
  const [roomFullscreen, setRoomFullscreen] = useState(false);
  const pageRootRef = useRef(null);
  const [callCollapsed, setCallCollapsed] = useState(false);
  const [focusCall, setFocusCall] = useState(false);
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

  const sendLeave = useCallback((immediate = false) => {
    if (!meetingUuid) return;
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    const run = () => {
      if (leavingRef.current) return;
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
    };
    if (immediate) {
      run();
      return;
    }
    // Даём время на remount / reload — сервер склеит короткие разрывы,
    // а если join успеет раньше, leave отменим.
    leaveTimerRef.current = window.setTimeout(run, 2500);
  }, [meetingUuid]);

  const cancelPendingLeave = useCallback(() => {
    if (leaveTimerRef.current) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    leavingRef.current = false;
  }, []);

  const initializeJitsi = useCallback(async () => {
    if (!meetingUuid || jitsiInitRef.current || apiRef.current) {
      return;
    }
    const cameraEnabled = cameraPrefRef.current === true
      || (cameraPrefRef.current == null && getMeetingCameraEnabled(meetingUuid) === true);
    const startWithVideoMuted = !cameraEnabled;
    // Первый вход — с muted mic; если пользователь уже включал микрофон в этом звонке — не глушим снова.
    const micWasEnabled = getMeetingMicEnabled(meetingUuid) === true;
    const startWithAudioMuted = !micWasEnabled;
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
          ? (
            config.domain && !String(config.domain).includes("meet.jit.si")
              ? `На ${config.domain} нет JWT: нажмите «Я организатор» или включите JITSI_AUTH_MODE=jwt на сервере — иначе урок не начнётся.`
              : "На meet.jit.si нажмите «Я организатор» и войдите в аккаунт Jitsi — иначе урок не начнётся."
          )
          : "",
      );

      if (!config.jwt && config.authMode === "jwt") {
        throw Object.assign(new Error("Backend не вернул JWT для Jitsi"), { code: "jwt_missing" });
      }
      if (!containerRef.current) {
        throw new Error("Контейнер конференции недоступен");
      }

      try {
        console.info("[Jitsi] join-config diagnostics", config.diagnostics || {
          roomName: config.roomName,
          domain: config.domain,
          meetingUuid: config.meeting?.uuid,
          role: config.meeting?.role,
          isModerator: config.meeting?.isModerator,
          authMode: config.authMode,
          passwordRequired: config.passwordRequired,
          hasJwt: Boolean(config.jwt),
        });
      } catch {
        /* ignore */
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
        startWithAudioMuted,
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
        onAudioMuteStatusChanged: (payload) => {
          setMeetingMicEnabled(meetingUuid, !payload?.muted);
        },
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
        cancelPendingLeave();
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
  }, [cancelPendingLeave, disposeApi, meetingUuid]);

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
      cancelPendingLeave();
      disposeApi();

    try {
      const meta = await fetchVideoMeetingDetail(meetingUuid);
      setDetail(meta);
      const tabTitle = resolveLessonTabTitle(meta);
      lessonTitleRef.current = tabTitle;
      document.title = formatPageTitle(tabTitle);
      setPresented(meta?.presented || meta?.videoMeeting?.presented || null);
      setMaterialSession(
        meta?.materialSession
        || meta?.videoMeeting?.materialSession
        || null,
      );
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
  }, [cancelPendingLeave, disposeApi, loadFinishedAttendance, meetingUuid, requestJoin]);

  useEffect(() => {
    void bootstrap();
    return () => {
      stopPolling();
      sendLeave(false);
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
      // Без ?meeting= в iframe: звонок остаётся в родительской вкладке.
      const url = String(next.openUrl || "").trim();
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
          setMaterialSession((prev) => {
            if (!prev?.material) setMobilePane("call");
            return prev;
          });
        }
        baselineReady = true;
        return;
      }

      const key = presentedOpenKey(next);

      if (!baselineReady) {
        baselineReady = true;
        // Ученик зашёл, когда материал уже показан — сразу открываем workspace.
        openPresentedInWorkspace(next);
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
        // Файлы идут через materialSession — подстраховываем, если WS не доставил событие.
        if (!canManageRef.current) {
          const session = statusPayload?.materialSession || null;
          if (session?.material) {
            setMaterialSession((prev) => {
              if (
                prev?.sessionId
                && session.sessionId
                && String(prev.sessionId) === String(session.sessionId)
              ) {
                return prev;
              }
              return session;
            });
            setWorkspaceMaterial(null);
            setFocusCall(false);
            setMobilePane("materials");
          }
        }
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
    const onPageHide = () => sendLeave(true);
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
      sendLeave(true);
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

  const materialRows = useMemo(() => {
    const planItem = event?.planItem || null;
    // Только материалы урока — ДЗ не смешиваем во вкладку урока.
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
    return materials.map((row) => ({ ...row, attachmentScope: "lesson" }));
  }, [event]);

  const homeworkRows = useMemo(() => {
    const planItem = event?.planItem || null;
    return planItemHomeworkPopoverRows(planItem).map((row) => ({
      ...row,
      attachmentScope: "homework",
    }));
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
    // Всегда ensure на бэкенде: event.planItem из карточки может быть слотом плана,
    // а не явной привязкой — писать материалы туда нельзя.
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
    const ensured = await ensurePlanItem();
    const planItemId = ensured?.id;
    if (!planItemId || !material?.id) {
      throw new Error("Не удалось прикрепить материал к уроку");
    }
    setAttachBusy(true);
    try {
      const current = (ensured?.materials || event?.planItem?.materials || []).map((m) => m.id).filter(Boolean);
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
    const ensured = await ensurePlanItem();
    const planItemId = ensured?.id;
    if (!planItemId || !interactive?.id) {
      throw new Error("Не удалось прикрепить интерактив к уроку");
    }
    setAttachBusy(true);
    try {
      const current = (ensured?.attachedInteractives || ensured?.attached_interactives
        || event?.planItem?.attachedInteractives || event?.planItem?.attached_interactives || [])
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
    const ensured = await ensurePlanItem();
    const planItemId = ensured?.id;
    if (!planItemId || !material?.id) {
      throw new Error("Не удалось прикрепить материал ДЗ");
    }
    setAttachBusy(true);
    try {
      const current = (ensured?.homeworkMaterials || ensured?.homework_materials
        || event?.planItem?.homeworkMaterials || event?.planItem?.homework_materials || [])
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
    const ensured = await ensurePlanItem();
    const planItemId = ensured?.id;
    if (!planItemId || !interactive?.id) {
      throw new Error("Не удалось прикрепить интерактив в ДЗ");
    }
    setAttachBusy(true);
    try {
      const current = (ensured?.homeworkInteractives || ensured?.homework_interactives
        || event?.planItem?.homeworkInteractives || event?.planItem?.homework_interactives || [])
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

  const onRemovePlanResource = useCallback(async (row) => {
    if (!canManage || !row) return;
    if (!row.materialId && !row.interactiveId) return;
    setAttachError("");
    setAttachBusy(true);
    try {
      const ensured = await ensurePlanItem();
      const planItemId = ensured?.id;
      if (!planItemId) throw new Error("Не удалось обновить материалы урока");

      const scope = row.attachmentScope === "homework" ? "homework" : "lesson";
      const planItem = {
        ...(event?.planItem || {}),
        ...ensured,
      };
      let payload = null;

      if (row.materialId) {
        if (scope === "homework") {
          const current = (planItem.homeworkMaterials || planItem.homework_materials || [])
            .map((m) => m.id)
            .filter((id) => id && id !== row.materialId);
          payload = { homework_material_ids: current };
        } else {
          const current = (planItem.materials || [])
            .map((m) => m.id)
            .filter((id) => id && id !== row.materialId);
          payload = { material_ids: current };
        }
      } else if (row.interactiveId) {
        if (scope === "homework") {
          const current = (planItem.homeworkInteractives || planItem.homework_interactives || [])
            .map((i) => i.id)
            .filter((id) => id && id !== row.interactiveId);
          payload = { homework_interactive_ids: current };
        } else {
          const current = (planItem.attachedInteractives || planItem.attached_interactives || [])
            .map((i) => i.id)
            .filter((id) => id && id !== row.interactiveId);
          payload = { interactive_ids: current };
        }
      }

      if (!payload) return;
      const data = await updateLessonPlanItem(planItemId, payload);
      const mapped = mapApiPlanItem(data);
      setDetail((prev) => (
        prev
          ? { ...prev, event: { ...prev.event, planItem: { ...prev.event?.planItem, ...mapped } } }
          : prev
      ));
      setMaterialsToast("Материал убран с урока");
      window.setTimeout(() => setMaterialsToast(""), 2200);
      await refreshMeetingDetail();
    } catch (err) {
      setAttachError(err?.message || "Не удалось убрать материал");
    } finally {
      setAttachBusy(false);
    }
  }, [canManage, ensurePlanItem, event, refreshMeetingDetail]);

  const showJitsi = pageState === "live" && attendance == null;

  const showMaterialsToast = useCallback((text) => {
    setMaterialsToast(text);
    window.setTimeout(() => setMaterialsToast(""), 2200);
  }, []);

  const showMaterialNotice = useCallback((text) => {
    setMaterialNotice(text);
    window.setTimeout(() => setMaterialNotice(""), 3200);
  }, []);

  const applyMaterialSession = useCallback((session) => {
    setMaterialSession(session || null);
    if (!session?.material) {
      setRemoteCursors([]);
      setRemotePreviews({});
      setStudentViewports({});
      return;
    }
    setPresented(null);
    setFocusCall(false);
    setCallCollapsed(false);
    setAsideOpen(false);
    setMobilePane("materials");
    setWorkspaceMaterial(null);
  }, []);

  // WebSocket синхронизации материалов (доска/вариант — отдельно).
  useEffect(() => {
    if (!meetingUuid || pageState !== "live") return undefined;
    const remoteGuard = remoteApplyGuardRef.current;
    const collab = createMeetingMaterialCollab(meetingUuid, {
      onStatus: (status) => {
        if (status === "open") setMaterialSyncStatus("synced");
        else if (status === "connecting") setMaterialSyncStatus("reconnecting");
        else if (status === "closed" || status === "error") setMaterialSyncStatus("reconnecting");
      },
      onSyncState: (payload) => {
        remoteGuard.run(() => applyMaterialSession(payload?.materialSession || null));
        if (Object.prototype.hasOwnProperty.call(payload || {}, "presented")) {
          setPresented(payload.presented || null);
        }
      },
      onPresented: (presentedPayload) => {
        setPresented(presentedPayload || null);
        if (presentedPayload && !canManageRef.current) {
          setWorkspaceMaterial({
            kind: presentedPayload.kind,
            title: presentedPayload.title,
            url: presentedPayload.openUrl,
            boardId: presentedPayload.boardId,
            homeworkId: presentedPayload.homeworkId,
          });
          setMaterialSession(null);
          setFocusCall(false);
          setMobilePane("materials");
        }
        if (!presentedPayload && !canManageRef.current) {
          setWorkspaceMaterial((prev) => (prev?.kind === "board" || prev?.kind === "variant" ? null : prev));
        }
      },
      onOpened: (payload) => {
        remoteGuard.run(() => applyMaterialSession(payload?.materialSession || {
          sessionId: payload.session_id,
          interactionMode: payload.interaction_mode,
          version: payload.version,
          state: payload.state,
          material: payload.material,
        }));
        if (!canManageRef.current) {
          showMaterialNotice("Преподаватель открыл материал");
        }
      },
      onClosed: () => {
        remoteGuard.run(() => applyMaterialSession(null));
        setRemotePreviews({});
        setRemoteCursors([]);
        setStudentViewports({});
        if (!canManageRef.current) {
          showMaterialNotice("Преподаватель закрыл материал");
          setMobilePane("call");
        }
      },
      onPermissionChanged: (payload) => {
        const mode = payload?.interaction_mode || payload?.materialSession?.interactionMode;
        const follow = payload?.follow_policy || payload?.materialSession?.followPolicy;
        remoteGuard.run(() => {
          setMaterialSession((prev) => {
            if (!prev && !payload.materialSession) return prev;
            return {
              ...(prev || {}),
              ...(payload.materialSession || {}),
              interactionMode: mode || prev?.interactionMode,
              followPolicy: follow || payload.materialSession?.followPolicy || prev?.followPolicy,
              collaborationPermission:
                payload.materialSession?.collaborationPermission
                || payload.collaboration_permission
                || prev?.collaborationPermission,
            };
          });
        });
        if (!canManageRef.current) {
          if (follow === "independent") {
            showMaterialNotice("Разрешён самостоятельный просмотр материала");
          } else if (follow === "strict") {
            showMaterialNotice("Учитель вернул вас к своему экрану");
          } else if (mode === "collaborative") {
            showMaterialNotice("Преподаватель включил совместную работу");
          } else if (mode === "view_only") {
            showMaterialNotice("Совместная работа выключена · следуйте за учителем");
          }
        }
      },
      onOperation: (op) => {
        const opId = op.operation_id || op.operationId;
        if (opId) {
          if (seenOpIdsRef.current.has(opId)) return;
          seenOpIdsRef.current.add(opId);
          if (seenOpIdsRef.current.size > 400) {
            const first = seenOpIdsRef.current.values().next().value;
            seenOpIdsRef.current.delete(first);
          }
        }
        remoteGuard.run(() => {
          setMaterialSession((prev) => {
            if (!prev) return prev;
            const nextState = applyMaterialOperation(prev.state || {}, {
              action: op.action,
              payload: op.payload || {},
              authorId: op.author_id,
              authorRole: op.author_role,
            });
            if (op.action === "annotation_added" || op.action === "annotation_updated") {
              const ann = op.payload?.annotation || op.payload;
              if (ann?.id) {
                setRemotePreviews((rp) => {
                  if (!rp[ann.id]) return rp;
                  const next = { ...rp };
                  delete next[ann.id];
                  return next;
                });
              }
            }
            return { ...prev, state: nextState, version: op.version || prev.version };
          });
        });
      },
      onAnnotationPreview: (payload) => {
        const ann = payload?.payload?.annotation || payload?.annotation || payload?.payload;
        if (!ann?.id) return;
        setRemotePreviews((prev) => ({ ...prev, [ann.id]: ann }));
      },
      onCursor: (payload) => {
        const p = payload?.payload || {};
        if (typeof p.x !== "number" || typeof p.y !== "number") return;
        const authorId = payload.author_id;
        const key = String(authorId || "remote");
        setRemoteCursors((prev) => {
          const next = prev.filter((c) => String(c.authorId) !== key);
          next.push({
            authorId,
            clientId: key,
            x: p.x,
            y: p.y,
            displayName: payload.display_name || (payload.author_role === "teacher" ? "Учитель" : "Ученик"),
            authorRole: payload.author_role,
            role: payload.author_role,
          });
          return next;
        });
        const timers = remoteCursorTimersRef.current;
        if (timers.has(key)) window.clearTimeout(timers.get(key));
        timers.set(key, window.setTimeout(() => {
          setRemoteCursors((prev) => prev.filter((c) => String(c.authorId) !== key));
          timers.delete(key);
        }, 1800));
      },
      onStudentViewport: (payload) => {
        const authorId = payload?.author_id;
        if (authorId == null) return;
        const p = payload?.payload || {};
        const viewport = p.viewport;
        if (!viewport || typeof viewport !== "object") return;
        setStudentViewports((prev) => ({
          ...prev,
          [String(authorId)]: {
            viewport: {
              left: Number(viewport.left) || 0,
              top: Number(viewport.top) || 0,
              width: Math.max(0.01, Number(viewport.width) || 1),
              height: Math.max(0.01, Number(viewport.height) || 1),
            },
            page: Number(p.page) || 1,
            zoom: Number(p.zoom) || 1,
            following: p.following !== false,
            scroll: Number(p.scroll) || 0,
            displayName: payload.display_name || "Ученик",
            updatedAt: Date.now(),
          },
        }));
      },
      onFollowStatus: (payload) => {
        const userId = payload.user_id || payload.author_id;
        if (userId == null) return;
        const following = payload.payload?.following ?? payload.following;
        setFollowByUser((prev) => ({ ...prev, [String(userId)]: Boolean(following) }));
        setMaterialPresence((prev) => prev.map((p) => (
          Number(p.userId) === Number(userId)
            ? { ...p, following: Boolean(following) }
            : p
        )));
      },
      onPresenceJoin: (payload) => {
        const userId = payload.user_id || payload.author_id;
        if (userId == null) return;
        setMaterialPresence((prev) => {
          if (prev.some((p) => Number(p.userId) === Number(userId))) {
            return prev.map((p) => (Number(p.userId) === Number(userId)
              ? {
                ...p,
                displayName: payload.display_name || p.displayName,
                role: payload.author_role || p.role,
              }
              : p));
          }
          return [...prev, {
            userId,
            displayName: payload.display_name || "Участник",
            role: payload.author_role,
            following: true,
          }];
        });
      },
      onPresenceLeave: (payload) => {
        const userId = payload.user_id || payload.author_id;
        setMaterialPresence((prev) => prev.filter((p) => Number(p.userId) !== Number(userId)));
        setRemoteCursors((prev) => prev.filter((c) => Number(c.authorId) !== Number(userId)));
        setStudentViewports((prev) => {
          const next = { ...prev };
          delete next[String(userId)];
          return next;
        });
        setFollowByUser((prev) => {
          const next = { ...prev };
          delete next[String(userId)];
          return next;
        });
      },
      onError: (err) => {
        if (err?.code === "forbidden" || err?.code === "view_only" || err?.code === "nav_locked") {
          showMaterialsToast(err.message || "Действие запрещено");
        }
        setMaterialSyncStatus("error");
      },
    });
    materialCollabRef.current = collab;
    return () => {
      collab.close();
      materialCollabRef.current = null;
      for (const t of remoteCursorTimersRef.current.values()) window.clearTimeout(t);
      remoteCursorTimersRef.current.clear();
      setRemoteCursors([]);
      setRemotePreviews({});
      setStudentViewports({});
      setMaterialPresence([]);
    };
  }, [applyMaterialSession, meetingUuid, pageState, showMaterialNotice, showMaterialsToast]);

  const openSyncedMaterialForRow = useCallback(async (row) => {
    if (!meetingUuid || !row) return;
    const resourceKind = inferSyncResourceKind(row);
    if (!resourceKind) return;
    setPresentBusy(true);
    try {
      const payload = {
        kind: row.kind,
        resourceKind,
        title: row.label || "",
        url: resolveMaterialOpenUrl(row, meetingUuid, presented, { forEmbed: true }) || row.url || "",
        text: row.text || "",
        materialId: row.materialId || null,
        cabinetFileId: row.cabinetFileId || null,
        interactiveId: row.interactiveId || null,
        interactiveType: row.interactiveType || "",
      };
      // REST уже создаёт сессию и рассылает material.opened — повторный WS open
      // деактивирует сессию и ломает персонализированный openUrl у ученика.
      const data = await openMeetingMaterialSession(meetingUuid, payload);
      applyMaterialSession(data?.materialSession || null);
      showMaterialsToast("Материал показан ученику");
    } catch (err) {
      setError(err?.message || "Не удалось открыть материал для ученика");
    } finally {
      setPresentBusy(false);
    }
  }, [applyMaterialSession, meetingUuid, presented, showMaterialsToast]);

  const openWorkspaceMaterial = useCallback((payload) => {
    if (!payload?.url && !payload?.text) return;
    const rawUrl = String(payload.url || "").trim();
    // Не встраиваем страницу самого звонка — получится двойная шапка в iframe.
    const embedsSelfMeeting = Boolean(
      meetingUuid
      && rawUrl
      && /\/cabinet\/meetings\//i.test(rawUrl)
      && rawUrl.includes(meetingUuid),
    );
    if (embedsSelfMeeting || (payload.url && !isEmbeddableMaterialUrl(payload.url) && !payload.forceEmbed)) {
      window.open(payload.url, "_blank", "noopener,noreferrer");
      return;
    }
    setMaterialSession(null);
    setFocusCall(false);
    setCallCollapsed(false);
    setWorkspaceMaterial({
      title: payload.title || "Материал",
      url: payload.url || "",
      text: payload.text || "",
      kind: payload.kind || "material",
      embed: Boolean(payload.url) && (payload.forceEmbed || isEmbeddableMaterialUrl(payload.url)),
    });
    // Для варианта оставляем сайдбар с ответами; звонок уйдёт в compact.
    if (payload.kind === "variant") setAsideOpen(true);
    else setAsideOpen(false);
    setMobilePane("materials");
  }, [meetingUuid]);

  const closeWorkspaceMaterial = useCallback(() => {
    setWorkspaceMaterial(null);
    setMobilePane("call");
  }, []);

  const onOpenRow = useCallback((row) => {
    // Во время live учитель при открытии синхронизируемых материалов сразу показывает их ученику.
    if (canManageRef.current && pageState === "live" && canSyncPresentRow(row)) {
      void openSyncedMaterialForRow(row);
      // Локально тоже открываем через сессию (придёт material.opened / REST).
      return;
    }
    if (row?.text && !row?.url) {
      openWorkspaceMaterial({
        title: row.label,
        text: row.text,
        kind: row.kind,
      });
      return;
    }
    const url = resolveMaterialOpenUrl(row, meetingUuid, presented, { forEmbed: true });
    if (!url && row?.kind === "board" && boardInfo?.board?.id) {
      openWorkspaceMaterial({
        title: boardInfo.board.title || "Доска",
        url: `/cabinet/boards/${boardInfo.board.id}`,
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
  }, [boardInfo?.board, meetingUuid, openSyncedMaterialForRow, openWorkspaceMaterial, pageState, presented]);

  const onOpenInNewTab = useCallback((row) => {
    const url = resolveMaterialOpenUrl(row, meetingUuid, presented, { forEmbed: false });
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, [meetingUuid, presented]);

  const onOpenBoardLocally = useCallback((board) => {
    if (!board?.id) return;
    openWorkspaceMaterial({
      title: board.title || "Доска",
      url: `/cabinet/boards/${board.id}`,
      kind: "board",
      forceEmbed: true,
    });
  }, [openWorkspaceMaterial]);

  const onShowBoard = useCallback(async (board) => {
    if (!meetingUuid || !board?.id) return;
    setPresentBusy(true);
    try {
      applyMaterialSession(null);
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
  }, [applyMaterialSession, meetingUuid, showMaterialsToast]);

  const onShowVariant = useCallback(async (row) => {
    if (!meetingUuid || !row) return;
    setPresentBusy(true);
    try {
      applyMaterialSession(null);
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
  }, [applyMaterialSession, meetingUuid, showMaterialsToast]);

  const onClearPresented = useCallback(async () => {
    if (!meetingUuid) return;
    setPresentBusy(true);
    try {
      if (materialSession?.sessionId) {
        const collab = materialCollabRef.current;
        if (collab?.isOpen()) collab.closeMaterial();
        else await closeMeetingMaterialSession(meetingUuid, { sessionId: materialSession.sessionId });
        applyMaterialSession(null);
      }
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
  }, [applyMaterialSession, materialSession?.sessionId, meetingUuid, showMaterialsToast]);

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
      return;
    }
    if (canSyncPresentRow(row)) {
      await openSyncedMaterialForRow(row);
    }
  }, [boardInfo?.board, onClearPresented, onShowBoard, onShowVariant, openSyncedMaterialForRow]);

  const onToggleCollaborative = useCallback(async (enabled) => {
    if (!meetingUuid || !materialSession?.sessionId) return;
    const mode = enabled ? "collaborative" : "view_only";
    const prevMode = materialSession.interactionMode || "view_only";
    const permission = enabled
      ? (materialSession.collaborationPermission
        || defaultCollabPermissionForKind(materialSession.material?.type)
        || COLLAB_PERMISSIONS.ANNOTATE)
      : materialSession.collaborationPermission;
    setMaterialSession((prev) => (prev ? {
      ...prev,
      interactionMode: mode,
      collaborationPermission: permission,
    } : prev));
    if (enabled) setCollabPermOpen(true);
    try {
      const data = await setMeetingMaterialPermission(meetingUuid, {
        sessionId: materialSession.sessionId,
        mode,
        collaborationPermission: permission,
      });
      if (data?.materialSession) {
        applyMaterialSession(data.materialSession);
      }
    } catch (err) {
      setMaterialSession((prev) => (prev ? { ...prev, interactionMode: prevMode } : prev));
      setError(err?.message || "Не удалось изменить режим");
    }
  }, [applyMaterialSession, materialSession, meetingUuid]);

  const onSetCollaborationPermission = useCallback(async (permission) => {
    if (!meetingUuid || !materialSession?.sessionId) return;
    setMaterialSession((prev) => (prev ? { ...prev, collaborationPermission: permission } : prev));
    try {
      const data = await setMeetingMaterialPermission(meetingUuid, {
        sessionId: materialSession.sessionId,
        mode: "collaborative",
        collaborationPermission: permission,
      });
      if (data?.materialSession) applyMaterialSession(data.materialSession);
      setCollabPermOpen(false);
    } catch (err) {
      setError(err?.message || "Не удалось изменить права");
    }
  }, [applyMaterialSession, materialSession, meetingUuid]);

  const onAllowIndependent = useCallback(async () => {
    if (!meetingUuid || !materialSession?.sessionId) return;
    const prev = materialSession.followPolicy || "strict";
    setMaterialSession((s) => (s ? { ...s, followPolicy: "independent" } : s));
    try {
      const data = await setMeetingMaterialFollowPolicy(meetingUuid, {
        sessionId: materialSession.sessionId,
        followPolicy: "independent",
      });
      if (data?.materialSession) applyMaterialSession(data.materialSession);
    } catch (err) {
      setMaterialSession((s) => (s ? { ...s, followPolicy: prev } : s));
      setError(err?.message || "Не удалось разрешить самостоятельный просмотр");
    }
  }, [applyMaterialSession, materialSession, meetingUuid]);

  const onReturnToLeader = useCallback(async () => {
    if (!meetingUuid || !materialSession?.sessionId) return;
    const prev = materialSession.followPolicy || "strict";
    setMaterialSession((s) => (s ? { ...s, followPolicy: "strict", independentUserIds: [] } : s));
    try {
      const data = await setMeetingMaterialFollowPolicy(meetingUuid, {
        sessionId: materialSession.sessionId,
        followPolicy: "strict",
        independentUserIds: [],
      });
      if (data?.materialSession) applyMaterialSession(data.materialSession);
      // Повторно отправим текущую страницу — ученики синхронизируются.
      const page = materialSession.state?.page || 1;
      materialCollabRef.current?.sendOperation({
        action: "page_changed",
        payload: { page },
      });
    } catch (err) {
      setMaterialSession((s) => (s ? { ...s, followPolicy: prev } : s));
      setError(err?.message || "Не удалось вернуть учеников к экрану");
    }
  }, [applyMaterialSession, materialSession, meetingUuid]);

  const onTransferControl = useCallback(async () => {
    if (!meetingUuid || !materialSession?.sessionId) return;
    const peers = (materialPresence || []).filter((p) => {
      const role = p.role || p.author_role;
      return role === "teacher" || role === "coteacher" || role === "staff";
    });
    const other = peers.find((p) => Number(p.userId) !== Number(detail?.viewerUserId));
    if (!other) {
      showMaterialsToast("В комнате нет другого ведущего для передачи управления");
      return;
    }
    try {
      const data = await transferMeetingMaterialControl(meetingUuid, {
        sessionId: materialSession.sessionId,
        toUserId: other.userId,
      });
      if (data?.materialSession) applyMaterialSession(data.materialSession);
      showMaterialsToast(`Управление передано: ${other.displayName || "коллега"}`);
    } catch (err) {
      setError(err?.message || "Не удалось передать управление");
    }
  }, [applyMaterialSession, detail?.viewerUserId, materialPresence, materialSession, meetingUuid, showMaterialsToast]);

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
    : ((materialSession?.material || presented?.openUrl) ? 1 : 0);
  const whenLabel = formatWhen(event?.startsAt, event?.endsAt);
  const studentLabel = String(event?.audience || "").trim();
  const subjectRaw = String(event?.topic || event?.eventTitle || "").trim();
  // Не дублируем имя ученика: topic/title часто совпадают с audience после auto plan-item.
  const subjectLabel = subjectRaw
    && subjectRaw.toLowerCase() !== studentLabel.toLowerCase()
    ? subjectRaw
    : "";
  const headerTitle = [studentLabel, subjectLabel].filter(Boolean).join(" · ")
    || subjectRaw
    || studentLabel
    || "Урок";
  const headerSub = whenLabel || "";
  const syncedWorkspaceOpen = Boolean(materialSession?.material);
  const workspaceOpen = (Boolean(workspaceMaterial) || syncedWorkspaceOpen) && !focusCall;
  const workspaceTitle = workspaceMaterial?.title
    || materialSession?.material?.title
    || "";
  const liveVariantAnswers = Boolean(canManage && presented?.kind === "variant");
  // Материал открыт — звонок сворачивается в плавающее окно, а не пропадает под оверлеем.
  const compactCall = Boolean(workspaceOpen && showJitsi);
  // Панель материалов рядом со звонком; у учителя — и при открытом workspace.
  const showAside = showJitsi && asideOpen && (
    !workspaceOpen || liveVariantAnswers || canManage
  );

  const {
    nodeRef: compactCallRef,
    style: compactCallStyle,
    dragging: compactCallDragging,
    onPointerDown: onCompactCallPointerDown,
  } = useFloatingDrag({
    enabled: compactCall,
    storageKey: meetingUuid ? `vl-compact-call:${meetingUuid}` : null,
    handleSelector: ".video-lesson-compact-drag",
  });

  useEffect(() => {
    if (!compactCall) setCallCollapsed(false);
  }, [compactCall]);

  const studentMaterialRowsResolved = canManage
    ? materialRows
    : (materialSession?.material
      ? [{
        key: `synced-${materialSession.sessionId}`,
        kind: materialSession.material.type || "material",
        label: materialSession.material.title || "Материал",
        typeLabel: "Показан преподавателем",
        url: materialSession.material.openUrl,
        materialId: materialSession.material.id,
        interactiveId: materialSession.material.interactiveId,
      }]
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
        : []));

  useEffect(() => {
    // Сообщаем Jitsi о смене размеров контейнера без пересоздания сессии.
    window.dispatchEvent(new Event("resize"));
  }, [asideOpen, workspaceOpen, mobilePane]);

  const toggleRoomFullscreen = useCallback(async () => {
    const root = pageRootRef.current;
    const useCssFallback = () => {
      setRoomFullscreen((prev) => {
        const next = !prev;
        document.body.classList.toggle("vl-room-fullscreen", next);
        return next;
      });
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
    };
    try {
      if (!document.fullscreenElement && root?.requestFullscreen) {
        await root.requestFullscreen();
        setRoomFullscreen(true);
        document.body.classList.add("vl-room-fullscreen");
        window.setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setRoomFullscreen(false);
        document.body.classList.remove("vl-room-fullscreen");
        window.setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
        return;
      }
    } catch {
      /* iOS / denied — CSS fallback */
    }
    useCssFallback();
  }, []);

  useEffect(() => {
    const onFs = () => {
      const active = Boolean(document.fullscreenElement);
      setRoomFullscreen(active || document.body.classList.contains("vl-room-fullscreen"));
      if (!active) {
        // Не снимаем CSS-fallback класс здесь — им управляет toggle.
      }
      window.dispatchEvent(new Event("resize"));
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.body.classList.remove("vl-room-fullscreen");
    };
  }, []);

  return (
    <div
      ref={pageRootRef}
      className={[
        "video-lesson-page",
        showAside ? "video-lesson-page--aside" : "",
        workspaceOpen && showJitsi ? "video-lesson-page--workspace" : "",
        compactCall ? "video-lesson-page--compact" : "",
        liveVariantAnswers ? "video-lesson-page--live-answers" : "",
        mobilePane === "materials" && showJitsi ? "video-lesson-page--mobile-materials" : "",
        roomFullscreen ? "is-css-fullscreen" : "",
      ].filter(Boolean).join(" ")}
    >
      <header className="video-lesson-header">
        <div className="video-lesson-header__left">
          <div className="video-lesson-header__meta">
            <h1 className="video-lesson-header__title" title={workspaceOpen && workspaceTitle ? workspaceTitle : headerTitle}>
              {workspaceOpen && workspaceTitle ? workspaceTitle : headerTitle}
            </h1>
            {workspaceOpen ? (
              <p className="video-lesson-header__sub" title={headerTitle}>
                {headerTitle}{headerSub ? ` · ${headerSub}` : ""}
              </p>
            ) : headerSub ? (
              <p className="video-lesson-header__sub" title={headerSub}>
                {headerSub}
              </p>
            ) : null}
          </div>
        </div>

        <div className="video-lesson-header__actions">
          {workspaceOpen ? (
            <button
              type="button"
              className="video-lesson-icon-btn"
              aria-label="Закрыть материал"
              title="Закрыть материал"
              onClick={() => {
                if (syncedWorkspaceOpen) {
                  if (canManage) void onClearPresented();
                  else {
                    applyMaterialSession(null);
                    setMobilePane("call");
                  }
                } else {
                  closeWorkspaceMaterial();
                  setAsideOpen(true);
                  setMobilePane("materials");
                }
              }}
            >
              <CabinetIcon name="close" />
            </button>
          ) : null}
          {showJitsi ? (
            <button
              type="button"
              // На мобильном (≤720px) под шапкой уже есть таб-переключатель
              // Звонок/Материалы — эта кнопка дублировала бы его, отнимая
              // место у заголовка урока, поэтому там скрыта через CSS.
              className={`video-lesson-btn video-lesson-btn--ghost video-lesson-header__materials-btn${asideOpen ? " is-active" : ""}`}
              onClick={() => {
                setFocusCall(false);
                setAsideOpen((v) => !v);
                setMobilePane((prev) => (prev === "materials" && asideOpen ? "call" : "materials"));
              }}
              aria-pressed={asideOpen}
              title={asideOpen ? "Скрыть материалы" : "Показать материалы"}
            >
              Материалы{materialsCount ? ` · ${materialsCount}` : ""}
            </button>
          ) : null}

          <button
            type="button"
            className={`video-lesson-btn video-lesson-btn--ghost${roomFullscreen ? " is-active" : ""}`}
            onClick={() => void toggleRoomFullscreen()}
            aria-pressed={roomFullscreen}
            aria-label={roomFullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
            title={roomFullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
          >
            <CabinetIcon name="expand" />
            <span className="video-lesson-btn__label">{roomFullscreen ? "Окно" : "На весь экран"}</span>
          </button>

          {canManage && status === "live" && showJitsi ? (
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--danger"
              disabled={finishing}
              onClick={() => setFinishConfirm(true)}
              aria-label="Завершить урок"
            >
              {finishing ? "…" : (
                <>Завершить<span className="video-lesson-btn__label-tail"> урок</span></>
              )}
            </button>
          ) : null}
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
        {focusCall && (syncedWorkspaceOpen || workspaceMaterial) && showJitsi ? (
          <div className="video-lesson-material-chip" role="status">
            <span>Материал открыт у ученика</span>
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--ghost"
              onClick={() => {
                setFocusCall(false);
                setMobilePane("materials");
              }}
            >
              Вернуться к материалу
            </button>
          </div>
        ) : null}
        {syncedWorkspaceOpen && showJitsi ? (
          <SyncedMaterialWorkspace
            canManage={canManage}
            meetingUuid={meetingUuid}
            material={materialSession.material}
            state={materialSession.state || {}}
            interactionMode={materialSession.interactionMode || "view_only"}
            followPolicy={materialSession.followPolicy || "strict"}
            syncStatus={
              materialSyncStatus === "reconnecting" && materialSession
                ? "reconnecting"
                : materialSyncStatus
            }
            remoteCursors={remoteCursors}
            remotePreviews={remotePreviews}
            studentViewports={studentViewports}
            presence={materialPresence}
            notice={materialNotice}
            canEditContent
            currentUserId={detail?.viewerUserId ?? detail?.userId ?? null}
            isController={
              !materialSession.controllerUserId
              || Number(materialSession.controllerUserId) === Number(detail?.viewerUserId)
              || detail?.viewerRole === "staff"
            }
            controllerLabel={
              materialSession.controllerUserId
                ? (materialPresence.find((p) => Number(p.userId) === Number(materialSession.controllerUserId))?.displayName
                  || (Number(materialSession.controllerUserId) === Number(detail?.viewerUserId) ? "Вы" : "Ведущий"))
                : ""
            }
            remoteApplyGuard={remoteApplyGuardRef.current}
            onCloseLocal={() => {
              applyMaterialSession(null);
              setMobilePane("call");
            }}
            onCloseForAll={() => void onClearPresented()}
            onToggleCollaborative={(enabled) => void onToggleCollaborative(enabled)}
            onAllowIndependent={() => void onAllowIndependent()}
            onReturnToLeader={() => void onReturnToLeader()}
            onTransferControl={() => void onTransferControl()}
            onStatePatch={({ action, payload }) => {
              const collabPerm = materialSession.collaborationPermission
                || defaultCollabPermissionForKind(materialSession.material?.type);
              const allowed = canSendMaterialAction({
                action,
                canManage,
                isController: Number(materialSession.controllerUserId) === Number(detail?.viewerUserId)
                  || canManage,
                interactionMode: materialSession.interactionMode,
                collaborationPermission: collabPerm,
                followingTeacher: followingTeacherRef.current,
                localBrowsingAway: !followingTeacherRef.current,
              });
              // Local browse-away navigation stays local (not sent).
              if (!canManage && isNavigationAction(action) && !followingTeacherRef.current
                && materialSession.interactionMode !== "collaborative") {
                return;
              }
              if (!allowed && !(canManage || isFollowContentAction(action))) return;
              if (remoteApplyGuardRef.current.isRemote()) return;
              const { operationId } = materialCollabRef.current?.sendOperation({ action, payload }) || {};
              if (operationId) {
                seenOpIdsRef.current.add(operationId);
              }
              setMaterialSession((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  state: applyMaterialOperation(prev.state || {}, {
                    action,
                    payload,
                    authorId: detail?.viewerUserId,
                    authorRole: canManage ? "teacher" : "student",
                  }),
                };
              });
            }}
            onSendCursor={(x, y) => materialCollabRef.current?.sendCursor(x, y)}
            onSendPointer={(x, y) => materialCollabRef.current?.sendPointer(x, y)}
            onSendStudentViewport={(payload) => materialCollabRef.current?.sendStudentViewport(payload)}
            onDrawPreview={(stroke) => {
              const collabPerm = materialSession.collaborationPermission || COLLAB_PERMISSIONS.ANNOTATE;
              if (!canManage && !(
                materialSession.interactionMode === "collaborative"
                && ["annotate", "edit_content", "full"].includes(collabPerm)
              )) return;
              materialCollabRef.current?.sendAnnotationPreview(stroke);
            }}
            onDrawComplete={(stroke) => {
              const collabPerm = materialSession.collaborationPermission || COLLAB_PERMISSIONS.ANNOTATE;
              if (!canManage && !(
                materialSession.interactionMode === "collaborative"
                && ["annotate", "edit_content", "full"].includes(collabPerm)
              )) return;
              const { operationId } = materialCollabRef.current?.sendOperation({
                action: "annotation_added",
                payload: { annotation: stroke },
              }) || {};
              if (operationId) seenOpIdsRef.current.add(operationId);
              setMaterialSession((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  state: applyMaterialOperation(prev.state || {}, {
                    action: "annotation_added",
                    payload: { annotation: stroke },
                    authorId: detail?.viewerUserId,
                    authorRole: canManage ? "teacher" : "student",
                  }),
                };
              });
            }}
            onEraseAnnotation={(ann) => {
              if (!ann?.id) return;
              const collabPerm = materialSession.collaborationPermission || COLLAB_PERMISSIONS.ANNOTATE;
              if (!canManage && !(
                materialSession.interactionMode === "collaborative"
                && ["annotate", "edit_content", "full"].includes(collabPerm)
              )) return;
              materialCollabRef.current?.sendOperation({
                action: "annotation_deleted",
                payload: { id: ann.id },
              });
              setMaterialSession((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  state: applyMaterialOperation(prev.state || {}, {
                    action: "annotation_deleted",
                    payload: { id: ann.id },
                    authorId: detail?.viewerUserId,
                    authorRole: canManage ? "teacher" : "student",
                  }),
                };
              });
            }}
            onClearOwnAnnotations={() => {
              const collabPerm = materialSession.collaborationPermission || COLLAB_PERMISSIONS.ANNOTATE;
              if (!canManage && !(
                materialSession.interactionMode === "collaborative"
                && ["annotate", "edit_content", "full"].includes(collabPerm)
              )) return;
              const anns = materialSession.state?.annotations || [];
              const mine = canManage
                ? anns.filter((a) => a.author_role === "teacher" || a.author_role === "staff" || !a.author_role)
                : anns.filter((a) => Number(a.author_id) === Number(detail?.viewerUserId));
              for (const ann of mine) {
                materialCollabRef.current?.sendOperation({
                  action: "annotation_deleted",
                  payload: { id: ann.id },
                });
              }
              setMaterialSession((prev) => {
                if (!prev) return prev;
                let nextState = prev.state || {};
                for (const ann of mine) {
                  nextState = applyMaterialOperation(nextState, {
                    action: "annotation_deleted",
                    payload: { id: ann.id },
                    authorId: detail?.viewerUserId,
                    authorRole: canManage ? "teacher" : "student",
                  });
                }
                return { ...prev, state: nextState };
              });
            }}
            onInteractiveOp={({ action, payload }) => {
              // Follow (view_only): ответы/поля разрешены; навигация — нет (сервер тоже режет).
              if (!canManage && !isFollowContentAction(action)
                && materialSession.interactionMode !== "collaborative") return;
              if (remoteApplyGuardRef.current.isRemote()) return;
              const { operationId } = materialCollabRef.current?.sendOperation({ action, payload }) || {};
              if (operationId) seenOpIdsRef.current.add(operationId);
              setMaterialSession((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  state: applyMaterialOperation(prev.state || {}, {
                    action,
                    payload,
                    authorId: detail?.viewerUserId,
                    authorRole: canManage ? "teacher" : "student",
                  }),
                };
              });
            }}
            collaborationPermission={
              materialSession.collaborationPermission
              || defaultCollabPermissionForKind(materialSession.material?.type)
            }
            followingTeacher={followingTeacherRef.current}
            onFollowStatusChange={(following) => {
              followingTeacherRef.current = following;
              materialCollabRef.current?.sendFollowStatus({
                following,
                materialId: materialSession.material?.id,
              });
            }}
            onConfigurePermissions={() => setCollabPermOpen(true)}
          />
        ) : null}

        {workspaceMaterial && !syncedWorkspaceOpen && showJitsi ? (
          <section className="video-lesson-workspace video-lesson-workspace--no-bar" aria-label="Просмотр материала">
            <div
              className={[
                "video-lesson-workspace__stage",
                workspaceMaterial.kind === "board" ? "video-lesson-workspace__stage--board" : "",
              ].filter(Boolean).join(" ")}
            >
              {workspaceMaterial.text && !workspaceMaterial.url ? (
                <div className="video-lesson-workspace__text">{workspaceMaterial.text}</div>
              ) : workspaceMaterial.embed && workspaceMaterial.url ? (
                <iframe
                  title={workspaceMaterial.title}
                  src={workspaceMaterial.url}
                  className={[
                    "video-lesson-workspace__frame",
                    workspaceMaterial.kind === "board" ? "video-lesson-workspace__frame--board" : "",
                  ].filter(Boolean).join(" ")}
                  allow="camera; microphone; display-capture; autoplay; clipboard-read; clipboard-write; fullscreen"
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

        <main
          ref={compactCall ? compactCallRef : undefined}
          className={[
            "video-lesson-content",
            compactCallDragging ? "video-lesson-content--dragging" : "",
            compactCall && callCollapsed ? "video-lesson-content--call-collapsed" : "",
          ].filter(Boolean).join(" ")}
          style={compactCall ? compactCallStyle : undefined}
          onPointerDown={compactCall ? onCompactCallPointerDown : undefined}
        >
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
                    ? "Время присутствия участников (короткие переподключения склеены)."
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

          {compactCall ? (
            <div className="video-lesson-compact-drag">
              <span>{callCollapsed ? "Звонок скрыт" : "Звонок"}</span>
              <div className="video-lesson-compact-drag__actions">
                <button
                  type="button"
                  className="video-lesson-compact-drag__expand"
                  onClick={() => setCallCollapsed((v) => !v)}
                >
                  {callCollapsed ? "Показать" : "Скрыть"}
                </button>
                <button
                  type="button"
                  className="video-lesson-compact-drag__expand"
                  onClick={() => {
                    // Только локально убрать материал с экрана — ученику сессия остаётся.
                    setFocusCall(true);
                    setCallCollapsed(false);
                    setMobilePane("call");
                  }}
                >
                  На весь экран
                </button>
              </div>
            </div>
          ) : null}

          <div
            id="jitsi-container"
            ref={containerRef}
            hidden={!showJitsi || (compactCall && callCollapsed)}
          />
        </main>

        {showAside ? (
          <VideoLessonMaterialsPanel
            canManage={canManage}
            materialRows={canManage ? materialRows : studentMaterialRowsResolved}
            homeworkRows={canManage ? homeworkRows : []}
            presented={presented}
            materialSession={materialSession}
            presentBusy={presentBusy}
            removeBusy={attachBusy}
            event={event}
            liveAnswers={liveAnswers}
            liveAnswersLoading={liveAnswersLoading}
            materialPresence={materialPresence}
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
            onRemoveRow={canManage ? onRemovePlanResource : null}
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

      {collabPermOpen ? (
        <div className="vl-collab-perm-modal" role="dialog" aria-modal="true" aria-label="Права совместной работы">
          <div className="vl-collab-perm-modal__card">
            <h3>Права ученика</h3>
            <p>Выберите, что ученик может делать в режиме совместной работы. Максимальные права не выдаются по умолчанию.</p>
            <div className="vl-collab-perm-modal__options">
              {[
                [COLLAB_PERMISSIONS.ANSWERS_ONLY, "Только вводить ответы"],
                [COLLAB_PERMISSIONS.ANNOTATE, "Комментировать и рисовать"],
                [COLLAB_PERMISSIONS.EDIT_CONTENT, "Редактировать содержимое"],
                [COLLAB_PERMISSIONS.FULL, "Полный совместный доступ"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`video-lesson-btn${(materialSession?.collaborationPermission || COLLAB_PERMISSIONS.ANNOTATE) === value ? " video-lesson-btn--primary" : " video-lesson-btn--secondary"}`}
                  onClick={() => void onSetCollaborationPermission(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="video-lesson-btn video-lesson-btn--ghost" onClick={() => setCollabPermOpen(false)}>
              Закрыть
            </button>
          </div>
        </div>
      ) : null}

      {canManage && materialSession ? (
        <aside className="vl-teacher-panel" aria-label="Панель учителя">
          <div className="vl-teacher-panel__head">
            <strong>Участники материала</strong>
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--ghost"
              onClick={() => {
                setDiagSnapshot(materialCollabRef.current?.getDiagnostics?.() || null);
                setDiagOpen((v) => !v);
              }}
            >
              Диагностика
            </button>
          </div>
          <ul className="vl-teacher-panel__list">
            {materialPresence.filter((p) => p.role === "student").map((p) => (
              <li key={p.userId}>
                <span>{p.displayName}</span>
                <span className={p.following === false || followByUser[String(p.userId)] === false ? "is-away" : "is-follow"}>
                  {p.following === false || followByUser[String(p.userId)] === false
                    ? "смотрит сам"
                    : "следует за вами"}
                </span>
              </li>
            ))}
            {!materialPresence.some((p) => p.role === "student") ? (
              <li className="vl-teacher-panel__empty">Ученики ещё не подключены к материалу</li>
            ) : null}
          </ul>
          {diagOpen && detail?.viewerIsStaff ? (
            <pre className="vl-teacher-panel__diag">{JSON.stringify(diagSnapshot || materialCollabRef.current?.getDiagnostics?.() || {}, null, 2)}</pre>
          ) : null}
        </aside>
      ) : null}

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
