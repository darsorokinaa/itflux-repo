import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import EventDetailCard from "../components/EventDetailCard";
import {
  planItemHomeworkPopoverRows,
  planItemLessonPopoverRows,
  planItemTaskPopoverRows,
} from "../planItemAttachments";
import { fetchStudentScheduleEvent } from "../../utils/cabinetAuth";
import { useLessonConnectAvailable } from "./StudentSectionUi";

const EVENT_TYPES = {
  group: { label: "Групповое занятие", color: "#2563EB" },
  group_lesson: { label: "Групповое занятие", color: "#2563EB" },
  individual: { label: "Индивидуальное занятие", color: "#F59E0B" },
  individual_lesson: { label: "Индивидуальное занятие", color: "#F59E0B" },
  homework: { label: "Домашнее задание", color: "#D97706" },
  review: { label: "Проверка работ", color: "#DC2626" },
};

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];

function eventAccentColor(event) {
  const tags = event.tags || [];
  if (tags.includes("ege")) return "#7C3AED";
  if (tags.includes("oge")) return "#2563EB";
  if (tags.includes("python")) return "#059669";
  const t = event.type || "";
  if (t === "individual" || t === "individual_lesson") return "#F59E0B";
  if (t === "group" || t === "group_lesson") return "#2563EB";
  return EVENT_TYPES[event.type]?.color || "#2563EB";
}

function formatEventDateShort(event) {
  if (!event?.startsAt) return "";
  const d = new Date(event.startsAt);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function shortenMeetingUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname || "";
    if (path.length > 14) return `${host}${path.slice(0, 10)}…`;
    return `${host}${path}`;
  } catch {
    return url.length > 30 ? `${url.slice(0, 30)}…` : url;
  }
}

function getEventPlanItem(event) {
  if (event.planItem) return event.planItem;
  const items = Array.isArray(event.planItems) ? event.planItems : [];
  return items[0] || null;
}

function getEventPlanMaterials(event) {
  const item = getEventPlanItem(event);
  const rows = [
    ...planItemLessonPopoverRows(item),
    ...planItemTaskPopoverRows(item),
  ];
  if (rows.length) return rows;
  const legacy = (event.materials || "").trim();
  return legacy ? [{ key: "legacy", kind: "notes", label: "Материалы", text: legacy }] : [];
}

function getEventPlanHomework(event) {
  return planItemHomeworkPopoverRows(getEventPlanItem(event), event.homework_status || null);
}

function hasText(value) {
  return Boolean(typeof value === "string" ? value.trim() : value);
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

export default function StudentEventDetailPopover({ eventId, onClose }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canConnect = useLessonConnectAvailable(event?.startsAt, event?.endsAt);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    setError("");
    fetchStudentScheduleEvent(eventId)
      .then((data) => setEvent({ ...data, readOnly: true }))
      .catch(() => {
        setEvent(null);
        setError("Не удалось загрузить занятие");
      })
      .finally(() => setLoading(false));
  }, [eventId]);

  if (!eventId) return null;

  if (loading) {
    return (
      <div className="cb-sch-overlay cb-sch-overlay--lesson" onClick={onClose} role="presentation">
        <div className="cb-sch-popover cb-lesson-card" onClick={(e) => e.stopPropagation()} role="dialog">
          <div className="st-loading" style={{ minHeight: 200 }}>Загрузка…</div>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="cb-sch-overlay cb-sch-overlay--lesson" onClick={onClose} role="presentation">
        <div className="cb-sch-popover cb-lesson-card" onClick={(e) => e.stopPropagation()} role="dialog">
          <p className="st-panel__empty">{error || "Занятие не найдено"}</p>
          <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    );
  }

  const typeInfo = EVENT_TYPES[event.type];
  const planItem = getEventPlanItem(event);
  const materials = getEventPlanMaterials(event);
  const homework = getEventPlanHomework(event);
  const topic = planItem ? (planItem.topic || planItem.title) : (event.topic || event.title || "");
  const hasAbout = planItem && (
    hasText(planItem.goal) || hasText(planItem.description) || hasText(planItem.teacherComment)
  );
  const meetingHref = event.videoMeeting?.pageUrl || event.link || "";
  const hasMeetingLink = Boolean(meetingHref);
  const hasLink = hasMeetingLink && canConnect;
  const isDone = event.status === "done" || event.status === "completed";
  const assignmentId = event.assignment_id;

  const openLesson = () => {
    if (assignmentId) {
      navigate(`/cabinet/student/lessons/${assignmentId}`);
      onClose();
      return;
    }
    if (event.homework_id) {
      navigate(`/cabinet/student/assignments/${event.homework_id}`);
      onClose();
    }
  };

  return (
    <EventDetailCard
      event={event}
      isMobile={isMobile}
      studentMode
      assignmentId={assignmentId}
      typeLabel={typeInfo?.label || "Занятие"}
      accentColor={eventAccentColor(event)}
      profileName={event.teacher_name || ""}
      dateLabel={formatEventDateShort(event)}
      timeRange={`${event.startTime}–${event.endTime}`}
      statusMeta={null}
      recurring={Boolean(event.seriesId)}
      isOnline={event.format === "Онлайн"}
      isCancelled={event.status === "cancelled"}
      isDone={isDone}
      canStart={event.format === "Онлайн" && !isDone && canConnect}
      hasLink={hasLink}
      hasMeetingLinkPending={hasMeetingLink && !canConnect}
      canEditLink={false}
      materials={materials}
      homework={homework}
      planItem={planItem}
      hasAbout={hasAbout}
      topic={topic}
      participants={Array.isArray(event.participants) ? event.participants : []}
      participantsFallback={event.teacher_name || "—"}
      shortenMeetingUrl={shortenMeetingUrl}
      onClose={onClose}
      onEdit={() => {}}
      onOpenLesson={openLesson}
      onStart={() => {
        const href = event.videoMeeting?.pageUrl || event.link || "";
        if (!href) return;
        if (href.startsWith("/cabinet/meetings/")) {
          navigate(href);
          onClose();
          return;
        }
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      onRequestDelete={() => {}}
      onRequestCancel={() => {}}
      onDuplicate={() => {}}
      onSaveLink={() => {}}
      savingLinkId={null}
      startingId={null}
    />
  );
}
