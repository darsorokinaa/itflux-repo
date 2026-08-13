/**
 * Пройденные темы — история обучения по занятиям и заданиям-урокам.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentLessons, fetchStudentSchedule } from "../../../utils/cabinetAuth";
import {
  StudentEmptyState,
  StudentErrorState,
  StudentLoadingState,
  StudentPageShell,
  formatStudentDate,
} from "../StudentSectionUi";
import { masteryLabel, pluralRu } from "../studentDisplay";
import StudentSubjectTabs, { getStoredStudentSubjectId } from "../StudentSubjectTabs";

function TopicRow({ item, open, onToggle }) {
  const dateLabel = item.completed_at
    ? formatStudentDate(item.completed_at)
    : "Дата не указана";
  const status = masteryLabel(item.mastery || item.status);
  const timesLabel = item.times > 1
    ? `${item.times} ${pluralRu(item.times, "занятие", "занятия", "занятий")}`
    : "";

  return (
    <li className={`st-topic-row${open ? " is-open" : ""}`}>
      <button type="button" className="st-topic-row__head" onClick={onToggle} aria-expanded={open}>
        <span className="st-topic-row__dot" aria-hidden="true" />
        <span className="st-topic-row__body">
          <span className="st-topic-row__title">{item.title}</span>
          <span className="st-topic-row__meta">
            {[item.subject, dateLabel, timesLabel, status].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="st-topic-row__status">{status}</span>
      </button>
      {open ? (
        <div className="st-topic-row__detail">
          {item.teacher ? <p>Учитель: {item.teacher}</p> : null}
          {item.materials_count > 0 ? <p>Материалов: {item.materials_count}</p> : null}
          {item.homework_title ? <p>Домашнее задание: {item.homework_title}</p> : null}
          {item.result != null ? <p>Результат: {item.result}%</p> : null}
          <div className="st-topic-row__actions">
            {item.lesson_path ? (
              <Link to={item.lesson_path} className="cb-btn cb-btn--outline cb-btn--sm">
                Открыть урок
              </Link>
            ) : null}
            {item.homework_path ? (
              <Link to={item.homework_path} className="cb-btn cb-btn--outline cb-btn--sm">
                Домашнее задание
              </Link>
            ) : null}
            <Link to="/cabinet/student/materials" className="cb-btn cb-btn--outline cb-btn--sm">
              Материалы
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function topicDedupeKey(title, subject) {
  const t = String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
  const s = String(subject || "").trim().toLowerCase();
  return `${s}::${t || "занятие"}`;
}

function stampMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mergeTopicRow(existing, incoming) {
  existing.times = (existing.times || 1) + 1;
  if (stampMs(incoming.completed_at) >= stampMs(existing.completed_at)) {
    existing.completed_at = incoming.completed_at || existing.completed_at;
    existing.teacher = incoming.teacher || existing.teacher;
    existing.homework_title = incoming.homework_title || existing.homework_title;
    existing.lesson_path = incoming.lesson_path || existing.lesson_path;
    existing.homework_path = incoming.homework_path || existing.homework_path;
    existing.mastery = incoming.mastery || existing.mastery;
    existing.status = incoming.status || existing.status;
  } else {
    existing.teacher = existing.teacher || incoming.teacher;
    existing.homework_title = existing.homework_title || incoming.homework_title;
    existing.lesson_path = existing.lesson_path || incoming.lesson_path;
    existing.homework_path = existing.homework_path || incoming.homework_path;
  }
  existing.materials_count = Math.max(existing.materials_count || 0, incoming.materials_count || 0);
}

function buildTopics(lessons, scheduleEvents) {
  const byKey = new Map();

  const add = (row) => {
    const key = topicDedupeKey(row.title, row.subject);
    const existing = byKey.get(key);
    if (existing) {
      mergeTopicRow(existing, row);
      return;
    }
    byKey.set(key, { ...row, times: 1 });
  };

  for (const event of scheduleEvents || []) {
    const ended = event.ends_at
      ? new Date(event.ends_at).getTime() < Date.now()
      : event.starts_at && new Date(event.starts_at).getTime() < Date.now();
    if (!ended) continue;
    add({
      id: `schedule-${event.id}`,
      title: event.topic || event.title || "Занятие",
      subject: event.student_subject_label || "",
      completed_at: event.starts_at,
      teacher: event.teacher_name || "",
      materials_count: event.materials_count || 0,
      homework_title: event.homework_title || "",
      mastery: "completed",
      status: "completed",
      lesson_path: event.assignment_id
        ? `/cabinet/student/lessons/${event.assignment_id}`
        : "/cabinet/student/lessons",
      homework_path: null,
      result: null,
    });
  }

  for (const lesson of lessons || []) {
    if (!["completed", "checked", "repeat"].includes(lesson.status)) continue;
    add({
      id: `lesson-${lesson.id}`,
      title: lesson.topic || lesson.title || "Тема",
      subject: lesson.direction || lesson.student_subject_label || "",
      completed_at: lesson.scheduled_at || lesson.due_at || lesson.assigned_at,
      teacher: "",
      materials_count: lesson.materials_count || 0,
      homework_title: "",
      mastery: lesson.status,
      status: lesson.status,
      lesson_path: `/cabinet/student/lessons/${lesson.id}`,
      homework_path: null,
      result: null,
    });
  }

  const items = Array.from(byKey.values());
  items.sort((a, b) => stampMs(b.completed_at) - stampMs(a.completed_at));
  return items;
}

export default function StudentTopicsPage() {
  const [lessons, setLessons] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [subjectId, setSubjectId] = useState(() => getStoredStudentSubjectId());
  const [openId, setOpenId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      fetchStudentLessons(),
      fetchStudentSchedule({ studentSubjectId: subjectId || undefined }),
    ])
      .then(([lessonsRes, scheduleRes]) => {
        setLessons(lessonsRes?.items || []);
        setSchedule(scheduleRes?.items || []);
      })
      .catch((err) => {
        setLessons([]);
        setSchedule([]);
        setError(err?.message || "Не удалось загрузить темы.");
      })
      .finally(() => setLoading(false));
  }, [subjectId]);

  const topics = useMemo(() => buildTopics(lessons, schedule), [lessons, schedule]);

  return (
    <StudentPageShell className="st-topics-page">
      <StudentSubjectTabs value={subjectId} onChange={setSubjectId} />

      {loading ? <StudentLoadingState /> : null}

      {!loading && error ? (
        <StudentErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError("");
            Promise.all([
              fetchStudentLessons(),
              fetchStudentSchedule({ studentSubjectId: subjectId || undefined }),
            ])
              .then(([lessonsRes, scheduleRes]) => {
                setLessons(lessonsRes?.items || []);
                setSchedule(scheduleRes?.items || []);
              })
              .catch((err) => {
                setLessons([]);
                setSchedule([]);
                setError(err?.message || "Не удалось загрузить темы.");
              })
              .finally(() => setLoading(false));
          }}
        />
      ) : null}

      {!loading && !error && topics.length === 0 ? (
        <StudentEmptyState
          icon="book"
          title="Пройденных тем пока нет"
          text="После занятий здесь появится история тем, материалов и заданий."
        />
      ) : null}

      {!loading && !error && topics.length > 0 ? (
        <ol className="st-topic-timeline">
          {topics.map((item) => (
            <TopicRow
              key={item.id}
              item={item}
              open={openId === item.id}
              onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
            />
          ))}
        </ol>
      ) : null}
    </StudentPageShell>
  );
}
