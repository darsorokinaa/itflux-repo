import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  fetchVideoMeetingJoinConfig,
  fetchVideoMeetingStatus,
} from "../../utils/cabinetAuth";
import {
  createJitsiMeetSession,
  getMeetingCameraEnabled,
  getMeetingMicEnabled,
  resolveJitsiDisplayName,
  setMeetingMicEnabled,
} from "../jitsiMeet";
import { getMeetingAttendanceTracker } from "../meetingAttendance";
import {
  claimMeetingCall,
  getMeetingCallOwner,
  releaseMeetingCall,
  subscribeMeetingCall,
} from "../meetingCallOwnership";
import { useFloatingDrag } from "../useFloatingDrag";
import FloatingResizeHandles from "../FloatingResizeHandles";
import "../styles/video-meeting.css";

const PRESENT_POLL_MS = 2500;

function readMeetingParam(search) {
  try {
    return new URLSearchParams(search || "").get("meeting") || "";
  } catch {
    return "";
  }
}

function isMeetingPagePath(pathname, meetingUuid) {
  if (!meetingUuid) return false;
  return pathname === `/cabinet/meetings/${meetingUuid}`
    || pathname === `/cabinet/meetings/${meetingUuid}/`;
}

function newOwnerId() {
  return `dock-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Свёрнутый звонок на вкладке с материалом (?meeting=<uuid>).
 * На странице самой встречи не монтируется — там свой Jitsi.
 * В iframe рабочей области встречи тоже не поднимаем — иначе крадём звонок
 * у родителя и глушим микрофон при каждом открытии доски/материала.
 * Если звонок уже живёт в другой вкладке — здесь не поднимаем второй раз.
 */
export default function MeetingCallDock() {
  const location = useLocation();
  const navigate = useNavigate();
  const meetingUuid = readMeetingParam(location.search);
  const onMeetingPage = isMeetingPagePath(location.pathname, meetingUuid);
  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const initRef = useRef(false);
  const ownerIdRef = useRef(newOwnerId());
  const holdingCallRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [callElsewhere, setCallElsewhere] = useState(false);
  const {
    nodeRef: dockRef,
    style: dockStyle,
    dragging: dockDragging,
    resizing: dockResizing,
    onPointerDown: onDockPointerDown,
    onResizePointerDown: onDockResizePointerDown,
  } = useFloatingDrag({
    enabled: !inIframe && (visible || callElsewhere),
    resizable: visible && !collapsed,
    minWidth: 180,
    minHeight: 140,
    storageKey: meetingUuid ? `meeting-call-dock:${meetingUuid}` : null,
    handleSelector: ".meeting-call-dock__bar",
  });

  useEffect(() => {
    // Встроенный просмотр на странице звонка: док не нужен и ломает микрофон.
    if (inIframe || !meetingUuid || onMeetingPage) {
      initRef.current = false;
      holdingCallRef.current = false;
      if (apiRef.current) {
        try {
          apiRef.current.dispose();
        } catch {
          /* ignore */
        }
        apiRef.current = null;
      }
      if (containerRef.current) containerRef.current.innerHTML = "";
      if (!inIframe) releaseMeetingCall(meetingUuid, ownerIdRef.current);
      setVisible(false);
      setCallElsewhere(false);
      setError("");
      return undefined;
    }

    let cancelled = false;
    let returning = false;
    setError("");
    ownerIdRef.current = newOwnerId();
    const attendance = getMeetingAttendanceTracker(meetingUuid);

    const dispose = () => {
      initRef.current = false;
      holdingCallRef.current = false;
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
      if (containerRef.current) containerRef.current.innerHTML = "";
    };

    const returnToCall = () => {
      if (cancelled || returning) return;
      returning = true;
      dispose();
      releaseMeetingCall(meetingUuid, ownerIdRef.current);
      setVisible(false);
      setCallElsewhere(false);
      const meetingPath = `/cabinet/meetings/${meetingUuid}`;
      try {
        window.close();
      } catch {
        /* ignore */
      }
      // Если вкладку нельзя закрыть — возвращаем на страницу звонка.
      window.setTimeout(() => {
        navigate(meetingPath, { replace: true });
      }, 50);
    };

    const unsub = subscribeMeetingCall((data) => {
      if (!data || data.meetingUuid !== meetingUuid) return;
      if (data.type === "claim" && data.ownerId && data.ownerId !== ownerIdRef.current) {
        dispose();
        setVisible(false);
        setCallElsewhere(true);
        setError("");
      }
      if (data.type === "release" && data.ownerId !== ownerIdRef.current) {
        // Вкладка со звонком закрылась — можем поднять звонок здесь.
        if (!holdingCallRef.current && !initRef.current && !cancelled) {
          setCallElsewhere(false);
          window.setTimeout(() => {
            void start();
          }, 60);
        }
      }
      if (data.type === "unpresent") {
        returnToCall();
      }
    });

    // Ученик на другом устройстве / без BroadcastChannel: ловим «Скрыть» через статус.
    const pollPresented = async () => {
      if (cancelled) return;
      try {
        const status = await fetchVideoMeetingStatus(meetingUuid);
        if (cancelled) return;
        if (status?.status === "finished" || status?.status === "cancelled") {
          dispose();
          setVisible(false);
          return;
        }
        // Файлы идут через materialSession — не считаем «пусто», если файл открыт.
        const hasPresented = Boolean(status?.presented?.openUrl);
        const hasMaterialSession = Boolean(status?.materialSession?.material);
        if (!hasPresented && !hasMaterialSession) {
          returnToCall();
        }
      } catch {
        /* ignore */
      }
    };
    const pollId = window.setInterval(() => {
      void pollPresented();
    }, PRESENT_POLL_MS);

    const start = async () => {
      if (cancelled || initRef.current || apiRef.current) return;

      // Звонок уже в другой вкладке — не поднимаем второй Jitsi.
      const existingOwner = getMeetingCallOwner(meetingUuid);
      if (existingOwner && existingOwner !== ownerIdRef.current) {
        setVisible(false);
        setCallElsewhere(true);
        return;
      }

      if (!containerRef.current) {
        // Нужен видимый контейнер для монтирования.
        setVisible(true);
        setCallElsewhere(false);
        window.setTimeout(() => {
          void start();
        }, 40);
        return;
      }

      initRef.current = true;
      setVisible(true);
      setCallElsewhere(false);
      try {
        holdingCallRef.current = true;
        attendance.cancelPendingLeave();
        const config = await fetchVideoMeetingJoinConfig(meetingUuid, {
          browserTabSessionId: `dock-${ownerIdRef.current}`,
        });
        if (cancelled) return;
        if (config?.meeting?.status && config.meeting.status !== "live") {
          setError("Урок уже не идёт");
          initRef.current = false;
          holdingCallRef.current = false;
          return;
        }
        if (!config?.domain || !config?.roomName) {
          throw new Error("Нет конфигурации конференции");
        }
        const subject = String(
          config.meeting?.title || config.meeting?.subject || "Онлайн-урок",
        ).trim();
        const cameraEnabled = getMeetingCameraEnabled(meetingUuid);
        const micEnabled = getMeetingMicEnabled(meetingUuid);
        const joinConfig = {
          ...config,
          startWithVideoMuted: cameraEnabled !== true,
          startWithAudioMuted: micEnabled !== true,
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
        resolveJitsiDisplayName(joinConfig);
        const wrapped = await createJitsiMeetSession(joinConfig, containerRef.current, {
          onAudioMuteStatusChanged: (payload) => {
            setMeetingMicEnabled(meetingUuid, !payload?.muted);
          },
          onJoined: (event) => {
            void attendance.onVerifiedJoin(event);
          },
          onLeft: () => {
            attendance.onConferenceLeft();
          },
        });
        if (cancelled) {
          try {
            wrapped.dispose();
          } catch {
            /* ignore */
          }
          attendance.onUnmount();
          return;
        }
        apiRef.current = wrapped;
        claimMeetingCall(meetingUuid, ownerIdRef.current);
      } catch (err) {
        if (!cancelled) {
          initRef.current = false;
          holdingCallRef.current = false;
          setError(err?.message || "Не удалось свернуть звонок сюда");
        }
      }
    };

    const onPageHide = () => attendance.onPageHide();
    const onBeforeUnload = () => attendance.onPageHide();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    const timer = window.setTimeout(() => {
      void start();
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(pollId);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      unsub();
      dispose();
      attendance.onUnmount();
      releaseMeetingCall(meetingUuid, ownerIdRef.current);
    };
  }, [inIframe, location.pathname, location.search, meetingUuid, navigate, onMeetingPage]);

  if (inIframe || !meetingUuid || onMeetingPage) return null;

  if (callElsewhere && !visible) {
    return (
      <div
        ref={dockRef}
        className={`meeting-call-dock meeting-call-dock--collapsed${dockDragging ? " meeting-call-dock--dragging" : ""}`}
        style={dockStyle}
        role="status"
        onPointerDown={onDockPointerDown}
      >
        <div className="meeting-call-dock__bar meeting-call-dock__bar--drag">
          <span className="meeting-call-dock__title">Звонок в другой вкладке</span>
          <div className="meeting-call-dock__actions">
            <Link
              className="meeting-call-dock__btn meeting-call-dock__btn--primary"
              to={`/cabinet/meetings/${meetingUuid}`}
            >
              К звонку
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div
      ref={dockRef}
      className={[
        "meeting-call-dock",
        collapsed ? "meeting-call-dock--collapsed" : "",
        dockDragging || dockResizing ? "meeting-call-dock--dragging" : "",
        visible && !collapsed ? "meeting-call-dock--resizable" : "",
      ].filter(Boolean).join(" ")}
      style={dockStyle}
      role="complementary"
      aria-label="Свёрнутый видеозвонок"
      onPointerDown={onDockPointerDown}
    >
      <div className="meeting-call-dock__bar meeting-call-dock__bar--drag">
        <span className="meeting-call-dock__title">Видеоурок</span>
        <div className="meeting-call-dock__actions">
          <button
            type="button"
            className="meeting-call-dock__btn"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? "Показать" : "Скрыть"}
          </button>
          <Link
            className="meeting-call-dock__btn meeting-call-dock__btn--primary"
            to={`/cabinet/meetings/${meetingUuid}`}
            onClick={() => {
              releaseMeetingCall(meetingUuid, ownerIdRef.current);
            }}
          >
            К звонку
          </Link>
        </div>
      </div>
      {error ? (
        <p className="meeting-call-dock__error">{error}</p>
      ) : (
        <div
          className="meeting-call-dock__stage"
          ref={containerRef}
          hidden={collapsed}
        />
      )}
      {visible && !collapsed ? (
        <FloatingResizeHandles onPointerDown={onDockResizePointerDown} />
      ) : null}
    </div>
  );
}
