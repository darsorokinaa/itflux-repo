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
import { masteryLabel } from "../studentDisplay";
import StudentSubjectTabs, { getStoredStudentSubjectId } from "../StudentSubjectTabs";

function TopicRow({ item, open, onToggle }) {
  const dateLabel = item.completed_at
    ? formatStudentDate(item.completed_at)
    : "Дата не указана";
  const status = masteryLabel(item.mastery || item.status);

  return (
    <li className={`st-topic-row${open ? " is-open" : ""}`}>
      <button type="button" className="st-topic-row__head" onClick={onToggle} aria-expanded={open}>
        <span className="st-topic-row__dot" aria-hidden="true" />
        <span className="st-topic-row__body">
          <span className="st-topic-row__title">{item.title}</span>
          <span className="st-topic-row__meta">
            {[item.subject, dateLabel, status].filter(Boolean).join(" · ")}
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

function buildTopics(lessons, scheduleEvents) {
  const items = [];
  const seen = new Set();

  for (const event of scheduleEvents || []) {
    const ended = event.ends_at
      ? new Date(event.ends_at).getTime() < Date.now()
      : event.starts_at && new Date(event.starts_at).getTime() < Date.now();
    if (!ended) continue;
    const key = `schedule-${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: key,
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
    const key = `lesson-${lesson.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: key,
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
      result: lesson.progress_percent === 100 ? null : null,
    });
  }

  items.sort((a, b) => {
    const ta = a.completed_at ? new Date(a.completed_at).getTime() : 0;
    const tb = b.completed_at ? new Date(b.completed_at).getTime() : 0;
    return tb - ta;
  });
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
