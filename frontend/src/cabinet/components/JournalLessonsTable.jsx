import { useEffect, useMemo, useRef, useState } from "react";
import CabinetIcon from "../CabinetIcons";
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

const PLANNED_EMPTY = "Тема не запланирована";
const ACTUAL_EMPTY = "Фактическая тема не указана";

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
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

function collectDetailFields(lesson, student = null) {
  const fields = [];
  const push = (label, value) => {
    const text = String(value || "").trim();
    if (text) fields.push({ label, value: text });
  };

  const time = formatLessonTime(lesson);
  if (time) push("Время", time);

  push("Итог", lesson.lesson_summary);
  push("Пройденный материал", lesson.material_covered);
  push("Повторить", lesson.material_to_repeat);
  push("План на следующий урок", lesson.next_lesson_plan);

  const rec = (student?.recommendation || lesson.recommendation || "").trim();
  const journalRec = (lesson.recommendations || "").trim();
  if (rec) push("Рекомендация", rec);
  else if (journalRec) push("Рекомендация", journalRec);

  push("Сильные стороны", student?.strengths || lesson.strengths);
  push("Трудности", student?.difficulties || lesson.difficulties);

  const criteria = student?.criterion_scores || lesson.criterion_scores || [];
  if (criteria.length) {
    const lines = criteria
      .map((s) => {
        const title = s.criterion_title || s.title || "Критерий";
        if (s.is_not_applicable) return `${title}: не оценивалось`;
        if (s.value == null || s.value === "") return null;
        return `${title}: ${s.value}`;
      })
      .filter(Boolean);
    if (lines.length) push("Критерии", lines.join(" · "));
  }

  return fields;
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
  // Fallback for older payloads that only had combined topic
  const legacy = (lesson.topic || "").trim();
  return {
    plannedTopic: planned || (!actual && legacy ? legacy : planned),
    actualTopic: actual,
  };
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
        details: collectDetailFields(lesson, lesson),
      };
    });
  }

  const rows = [];
  for (const lesson of ordered) {
    const topics = topicFieldsFromLesson(lesson);
    const students = lesson.students || [];
    if (!students.length) {
      rows.push({
        key: `lesson-${lesson.id}`,
        scheduleEventId: lesson.schedule_event_id,
        lessonDate: lesson.lesson_date,
        lessonTime: formatLessonTime(lesson),
        plannedTopic: topics.plannedTopic,
        actualTopic: topics.actualTopic,
        studentName: null,
        scoreDisplay: lesson.avg_overall_display || null,
        scoreRaw: lesson.avg_overall,
        comment: "",
        attendance: null,
        details: collectDetailFields(lesson),
      });
      continue;
    }
    for (const s of students) {
      rows.push({
        key: String(s.record_id),
        scheduleEventId: lesson.schedule_event_id,
        lessonDate: lesson.lesson_date,
        lessonTime: formatLessonTime(lesson),
        plannedTopic: topics.plannedTopic,
        actualTopic: topics.actualTopic,
        studentName: s.student_name || null,
        scoreDisplay: s.overall_score_display || null,
        scoreRaw: s.overall_score,
        comment: s.teacher_comment || "",
        attendance: s.attendance_status,
        details: collectDetailFields(lesson, s),
      });
    }
  }
  return rows;
}

function AttendanceBadge({ status }) {
  if (!status || status === "not_marked") return <span className="jg-muted">—</span>;
  const tone = ATTENDANCE_TONE[status] || "muted";
  return (
    <span className={`jg-chip jg-chip--${tone}`}>
      {ATTENDANCE_RU[status] || status}
    </span>
  );
}

function ScoreChip({ display, raw }) {
  if (!display) return <span className="jg-muted">—</span>;
  const value = parseScoreValue(display, raw);
  const tone = scoreTone(value);
  return <span className={`jg-score-chip jg-score-chip--${tone}`}>{display}</span>;
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
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
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
            className="jg-topic-field__btn jg-topic-field__btn--primary"
            disabled={status === "saving"}
            onClick={() => void save()}
          >
            {status === "saving" ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            className="jg-topic-field__btn"
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

function JournalRow({ row, showStudentName, onOpenLesson, onTopicsSaved }) {
  const openSummary = () => {
    if (row.scheduleEventId) {
      openLessonSummaryTab(row.scheduleEventId);
      return;
    }
    onOpenLesson?.(row.scheduleEventId);
  };

  return (
    <div className="jg-row">
      <div className="jg-row__main">
        <div className="jg-cell jg-cell--date">
          <span className="jg-date-main">{formatDate(row.lessonDate)}</span>
          {row.lessonTime ? <span className="jg-sub">{row.lessonTime}</span> : null}
        </div>
        <div className="jg-cell jg-cell--topic">
          <div className="jg-topic-stack">
            <TopicInlineField
              label="Планируемая тема"
              emptyLabel={PLANNED_EMPTY}
              value={row.plannedTopic}
              fieldKey="planned_topic"
              scheduleEventId={row.scheduleEventId}
              onSaved={onTopicsSaved}
            />
            <TopicInlineField
              label="Фактическая тема"
              emptyLabel={ACTUAL_EMPTY}
              value={row.actualTopic}
              fieldKey="actual_topic"
              scheduleEventId={row.scheduleEventId}
              onSaved={onTopicsSaved}
            />
          </div>
          {showStudentName && row.studentName ? (
            <span className="jg-sub">{row.studentName}</span>
          ) : null}
        </div>
        <div className="jg-cell jg-cell--score">
          <ScoreChip display={row.scoreDisplay} raw={row.scoreRaw} />
        </div>
        <div className="jg-cell jg-cell--comment">
          {row.comment.trim() ? row.comment : <span className="jg-muted">—</span>}
        </div>
        <div className="jg-cell jg-cell--extra">
          <AttendanceBadge status={row.attendance} />
        </div>
        <div className="jg-cell jg-cell--action">
          <button
            type="button"
            className="jg-outcomes-btn"
            title="Открыть подробные итоги в новой вкладке"
            onClick={openSummary}
          >
            <CabinetIcon name="note" />
            <span>Итоги</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Таблица журнала: дата → темы → результат % → комментарий → статус → итоги.
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
      <div className="jg-lessons-wrap">
        <h2 className="jg-lessons-wrap__title">Таблица уроков</h2>
        <div className="jg-empty">Загрузка…</div>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="jg-lessons-wrap">
        <h2 className="jg-lessons-wrap__title">Таблица уроков</h2>
        <div className="jg-empty">Записей за выбранный период пока нет</div>
      </div>
    );
  }

  return (
    <div className="jg-lessons-wrap">
      <h2 className="jg-lessons-wrap__title">Таблица уроков</h2>
      <div className="jg-grid-head" role="row">
        <div className="jg-cell jg-cell--date">Дата</div>
        <div className="jg-cell jg-cell--topic">Темы урока</div>
        <div className="jg-cell jg-cell--score">Результат</div>
        <div className="jg-cell jg-cell--comment">Комментарий</div>
        <div className="jg-cell jg-cell--extra">Статус</div>
        <div className="jg-cell jg-cell--action" />
      </div>

      <div className="jg-grid-body">
        {rows.map((row) => (
          <JournalRow
            key={row.key}
            row={row}
            showStudentName={showStudentName}
            onOpenLesson={onOpenLesson}
            onTopicsSaved={handleTopicsSaved}
          />
        ))}
      </div>

      <div className="jg-list-end">
        Других записей за выбранный период нет
      </div>
    </div>
  );
}
