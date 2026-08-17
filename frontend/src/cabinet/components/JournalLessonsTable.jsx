import { useEffect, useMemo, useRef, useState } from "react";
import { openLessonSummaryTab } from "../journal/openLessonSummary";
import { updateJournalLessonTopics } from "../../utils/cabinetAuth";

const ATTENDANCE_RU = {
  present: "Присутствовал",
  late: "Опоздал",
  left_early: "Ушёл раньше",
  partial: "Часть урока",
  absent_excused: "Уваж. причина",
  absent_unexcused: "Отсутствовал",
  cancelled_by_student: "Отменено",
  cancelled_by_teacher: "Отменено учителем",
  technical_issue: "Техн. причина",
  not_marked: "Не отмечено",
};

const ATTENDANCE_TONE = {
  present: "success",
  late: "warning",
  left_early: "warning",
  partial: "warning",
  absent_excused: "muted",
  absent_unexcused: "danger",
  cancelled_by_student: "muted",
  cancelled_by_teacher: "muted",
  technical_issue: "warning",
  not_marked: "muted",
};

const PLANNED_EMPTY = "Не указана";
const ACTUAL_EMPTY = "Не указана";

function formatDate(iso) {
  if (!iso) return "Дата не указана";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).replace(/\s*г\.?\s*$/u, "");
}

function formatClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatLessonTime(lesson) {
  const start = formatClock(lesson.starts_at || lesson.started_at);
  const end = formatClock(lesson.ends_at || lesson.finished_at);
  if (start && end) return `${start}–${end}`;
  if (start) return start;
  return "";
}

function parseScoreValue(display, raw) {
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  if (!display) return null;
  const match = String(display).match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const n = Number(match[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function scoreTone(value) {
  if (value == null) return "neutral";
  if (value >= 80) return "success";
  if (value >= 50) return "warning";
  return "danger";
}

function lessonSortKey(lesson) {
  const start = lesson?.starts_at || lesson?.started_at || "";
  const date = lesson?.lesson_date || "";
  const id = lesson?.schedule_event_id || lesson?.journal_id || lesson?.id || lesson?.record_id || 0;
  return `${date}T${start}\0${String(id).padStart(12, "0")}`;
}

function sortLessonsNewestFirst(lessons) {
  return [...(lessons || [])].sort((a, b) => lessonSortKey(b).localeCompare(lessonSortKey(a)));
}

function topicFieldsFromLesson(lesson) {
  const planned = (lesson.planned_topic ?? "").trim();
  const actual = (lesson.actual_topic ?? "").trim();
  const legacy = (lesson.topic || "").trim();
  return {
    plannedTopic: planned || (!actual && legacy ? legacy : planned),
    actualTopic: actual,
  };
}

function lessonStatusMeta(lesson, attendance) {
  const status = String(lesson.status || "").toLowerCase();
  if ((lesson.is_offline || lesson.isOffline) && status === "completed") {
    return { label: "Вне платформы", tone: "success" };
  }
  if (status === "completed") {
    return { label: "Проведён", tone: "success" };
  }
  if (
    attendance === "absent_unexcused" ||
    attendance === "absent_excused" ||
    attendance === "cancelled_by_student"
  ) {
    return {
      label: ATTENDANCE_RU[attendance] || "Пропущен",
      tone: ATTENDANCE_TONE[attendance] || "muted",
    };
  }
  if (attendance === "cancelled_by_teacher") {
    return { label: "Отменён", tone: "muted" };
  }
  if (lesson.starts_at) {
    const start = new Date(lesson.starts_at).getTime();
    if (Number.isFinite(start) && start > Date.now()) {
      return { label: "Запланирован", tone: "info" };
    }
  }
  return { label: "Ожидается", tone: "warning" };
}

function flattenRows(scopeType, lessons) {
  const ordered = sortLessonsNewestFirst(lessons);
  if (scopeType === "student") {
    return ordered.map((lesson) => {
      const topics = topicFieldsFromLesson(lesson);
      return {
        key: String(lesson.record_id || lesson.journal_id),
        scheduleEventId: lesson.schedule_event_id,
        lessonDate: lesson.lesson_date,
        lessonTime: formatLessonTime(lesson),
        plannedTopic: topics.plannedTopic,
        actualTopic: topics.actualTopic,
        studentName: null,
        scoreDisplay: lesson.overall_score_display || null,
        scoreRaw: lesson.overall_score,
        comment: lesson.teacher_comment || "",
        attendance: lesson.attendance_status,
        status: lesson.status,
        isOffline: Boolean(lesson.is_offline),
        homeworkId: lesson.homework_id || null,
        canOpenOutcomes: Boolean(lesson.schedule_event_id) && String(lesson.status || "") === "completed",
      };
    });
  }

  const rows = [];
  for (const lesson of ordered) {
    const topics = topicFieldsFromLesson(lesson);
    const students = lesson.students || [];
    const base = {
      scheduleEventId: lesson.schedule_event_id,
      lessonDate: lesson.lesson_date,
      lessonTime: formatLessonTime(lesson),
      plannedTopic: topics.plannedTopic,
      actualTopic: topics.actualTopic,
      status: lesson.status,
      isOffline: Boolean(lesson.is_offline),
      homeworkId: lesson.homework_id || null,
      canOpenOutcomes: Boolean(lesson.schedule_event_id) && String(lesson.status || "") === "completed",
    };
    if (!students.length) {
      rows.push({
        ...base,
        key: `lesson-${lesson.id}`,
        studentName: null,
        scoreDisplay: lesson.avg_overall_display || null,
        scoreRaw: lesson.avg_overall,
        comment: "",
        attendance: null,
      });
      continue;
    }
    for (const s of students) {
      rows.push({
        ...base,
        key: String(s.record_id),
        studentName: s.student_name || null,
        scoreDisplay: s.overall_score_display || null,
        scoreRaw: s.overall_score,
        comment: s.teacher_comment || "",
        attendance: s.attendance_status,
      });
    }
  }
  return rows;
}

function TopicInlineField({
  label,
  emptyLabel,
  value,
  fieldKey,
  scheduleEventId,
  disabled,
  onSaved,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(value || "");
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const display = (value || "").trim();

  const cancel = () => {
    setDraft(value || "");
    setError("");
    setStatus("idle");
    setEditing(false);
  };

  const save = async () => {
    if (!scheduleEventId || disabled) return;
    const next = String(draft || "").trim();
    if (next === String(value || "").trim()) {
      setEditing(false);
      setStatus("idle");
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const saved = await updateJournalLessonTopics(scheduleEventId, {
        [fieldKey]: next,
      });
      onSaved?.(saved, fieldKey);
      setStatus("saved");
      setEditing(false);
      window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1600);
    } catch (err) {
      setStatus("error");
      setError(err?.message || "Не удалось сохранить тему");
    }
  };

  if (editing) {
    return (
      <div className={`jg-topic-field jg-topic-field--editing jg-topic-field--${status}`}>
        <span className="jg-topic-field__label">{label}</span>
        <textarea
          ref={inputRef}
          className="jg-topic-field__input"
          rows={2}
          value={draft}
          disabled={status === "saving"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
        />
        <div className="jg-topic-field__actions">
          <button
            type="button"
            className="jg-btn jg-btn--primary jg-btn--sm"
            disabled={status === "saving"}
            onClick={() => void save()}
          >
            {status === "saving" ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            className="jg-btn jg-btn--ghost jg-btn--sm"
            disabled={status === "saving"}
            onClick={cancel}
          >
            Отмена
          </button>
        </div>
        {error ? <span className="jg-topic-field__error">{error}</span> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`jg-topic-field jg-topic-field--view${display ? "" : " is-empty"}`}
      disabled={!scheduleEventId || disabled}
      title="Нажмите, чтобы изменить"
      onClick={() => {
        if (!scheduleEventId || disabled) return;
        setEditing(true);
        setStatus("idle");
        setError("");
      }}
    >
      <span className="jg-topic-field__label">{label}</span>
      <span className="jg-topic-field__value">{display || emptyLabel}</span>
      {status === "saved" ? <span className="jg-topic-field__hint">Сохранено</span> : null}
    </button>
  );
}

function LessonRow({ row, showStudentName, onTopicsSaved }) {
  const status = lessonStatusMeta(row, row.attendance);
  const scoreValue = parseScoreValue(row.scoreDisplay, row.scoreRaw);
  const canOutcomes = Boolean(row.scheduleEventId);

  const openSummary = () => {
    if (!row.scheduleEventId) return;
    openLessonSummaryTab(row.scheduleEventId);
  };

  return (
    <tr className="jg-data-table__row">
      <td>
        <div className="jg-data-table__strong">{formatDate(row.lessonDate)}</div>
        {row.lessonTime ? <div className="jg-data-table__muted">{row.lessonTime}</div> : null}
      </td>
      {showStudentName ? (
        <td>{row.studentName || "—"}</td>
      ) : null}
      <td>
        <span className={`jg-status-badge jg-status-badge--${status.tone}`}>
          {status.label}
        </span>
      </td>
      <td>
        <TopicInlineField
          label="Планируемая"
          emptyLabel={PLANNED_EMPTY}
          value={row.plannedTopic}
          fieldKey="planned_topic"
          scheduleEventId={row.scheduleEventId}
          onSaved={onTopicsSaved}
        />
      </td>
      <td>
        <TopicInlineField
          label="Фактическая"
          emptyLabel={ACTUAL_EMPTY}
          value={row.actualTopic}
          fieldKey="actual_topic"
          scheduleEventId={row.scheduleEventId}
          onSaved={onTopicsSaved}
        />
      </td>
      <td>
        <span className={`jg-score-chip jg-score-chip--${scoreTone(scoreValue)}`}>
          {row.scoreDisplay || "Нет результата"}
        </span>
      </td>
      <td>
        {row.attendance && row.attendance !== "not_marked"
          ? ATTENDANCE_RU[row.attendance] || row.attendance
          : "Не отмечено"}
      </td>
      <td>
        <span className={row.comment.trim() ? undefined : "jg-data-table__muted"}>
          {row.comment.trim() || "—"}
        </span>
      </td>
      <td className="jg-data-table__actions">
        <button
          type="button"
          className="jg-btn jg-btn--secondary jg-btn--sm"
          disabled={!canOutcomes}
          title={canOutcomes ? "Открыть урок" : "Урок ещё не привязан к расписанию"}
          onClick={openSummary}
        >
          Открыть
        </button>
        <button
          type="button"
          className="jg-btn jg-btn--primary jg-btn--sm"
          disabled={!row.canOpenOutcomes}
          title={
            row.canOpenOutcomes
              ? "Посмотреть итоги урока"
              : "Итоги появятся после проведения урока"
          }
          onClick={openSummary}
        >
          Итоги
        </button>
      </td>
    </tr>
  );
}

/**
 * Список уроков в таблице с границами.
 */
export default function JournalLessonsTable({
  scopeType,
  lessons = [],
  onOpenLesson,
  onLessonTopicsUpdated,
  loading,
}) {
  const [localLessons, setLocalLessons] = useState(lessons);

  useEffect(() => {
    setLocalLessons(lessons);
  }, [lessons]);

  const rows = useMemo(
    () => flattenRows(scopeType, localLessons),
    [scopeType, localLessons],
  );
  const showStudentName = scopeType === "group";

  const handleTopicsSaved = (saved) => {
    if (!saved) return;
    setLocalLessons((prev) =>
      (prev || []).map((lesson) => {
        const eventId = lesson.schedule_event_id;
        if (eventId && Number(eventId) === Number(saved.schedule_event_id)) {
          return {
            ...lesson,
            planned_topic: saved.planned_topic ?? "",
            actual_topic: saved.actual_topic ?? "",
            topic: saved.actual_topic || saved.planned_topic || lesson.topic,
          };
        }
        return lesson;
      }),
    );
    onLessonTopicsUpdated?.(saved);
  };

  if (loading) {
    return (
      <section className="jg-lessons-section">
        <header className="jg-section-head">
          <div>
            <h2>Список уроков</h2>
            <p>Краткая лента уроков ученика или группы</p>
          </div>
        </header>
        <div className="jg-state jg-state--compact">Загрузка уроков…</div>
      </section>
    );
  }

  if (!rows.length) {
    return (
      <section className="jg-lessons-section">
        <header className="jg-section-head">
          <div>
            <h2>Список уроков</h2>
            <p>Краткая лента уроков ученика или группы</p>
          </div>
        </header>
        <div className="jg-state">
          <h3>Пока нет проведённых уроков</h3>
          <p>
            После первого урока здесь появятся темы, посещаемость, домашние задания и результаты.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="jg-lessons-section">
      <header className="jg-section-head">
        <div>
          <h2>Список уроков</h2>
          <p>Темы, посещаемость и результаты. Подробности открываются из строки.</p>
        </div>
        <span className="jg-section-head__count">{rows.length}</span>
      </header>

      <div className="jg-data-table-wrap">
        <table className="jg-data-table">
          <thead>
            <tr>
              <th>Дата</th>
              {showStudentName ? <th>Ученик</th> : null}
              <th>Статус</th>
              <th>Планируемая тема</th>
              <th>Фактическая тема</th>
              <th>Результат</th>
              <th>Посещаемость</th>
              <th>Комментарий</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <LessonRow
                key={row.key}
                row={row}
                showStudentName={showStudentName}
                onTopicsSaved={handleTopicsSaved}
                onOpenLesson={onOpenLesson}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
