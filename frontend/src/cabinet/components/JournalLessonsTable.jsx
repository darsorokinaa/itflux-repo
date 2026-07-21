import { useMemo } from "react";
import CabinetIcon from "../CabinetIcons";
import { openLessonSummaryTab } from "../journal/openLessonSummary";

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

function flattenRows(scopeType, lessons) {
  const ordered = sortLessonsNewestFirst(lessons);
  if (scopeType === "student") {
    return ordered.map((lesson) => ({
      key: String(lesson.record_id || lesson.journal_id),
      scheduleEventId: lesson.schedule_event_id,
      lessonDate: lesson.lesson_date,
      lessonTime: formatLessonTime(lesson),
      topic: lesson.topic || "Без темы",
      studentName: null,
      scoreDisplay: lesson.overall_score_display || null,
      scoreRaw: lesson.overall_score,
      comment: lesson.teacher_comment || "",
      attendance: lesson.attendance_status,
      details: collectDetailFields(lesson, lesson),
    }));
  }

  const rows = [];
  for (const lesson of ordered) {
    const students = lesson.students || [];
    if (!students.length) {
      rows.push({
        key: `lesson-${lesson.id}`,
        scheduleEventId: lesson.schedule_event_id,
        lessonDate: lesson.lesson_date,
        lessonTime: formatLessonTime(lesson),
        topic: lesson.topic || "Без темы",
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
        topic: lesson.topic || "Без темы",
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

function JournalRow({ row, showStudentName, onOpenLesson }) {
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
          <span className="jg-topic-title">{row.topic}</span>
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
 * Таблица журнала: дата → урок → результат % → комментарий → статус → итоги.
 */
export default function JournalLessonsTable({
  scopeType,
  lessons = [],
  onOpenLesson,
  loading,
}) {
  const rows = useMemo(() => flattenRows(scopeType, lessons), [scopeType, lessons]);
  const showStudentName = scopeType === "group";

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
        <div className="jg-cell jg-cell--topic">Урок</div>
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
          />
        ))}
      </div>

      <div className="jg-list-end">
        Других записей за выбранный период нет
      </div>
    </div>
  );
}
