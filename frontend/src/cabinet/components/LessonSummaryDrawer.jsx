import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  bulkJournalLesson,
  completeJournalLesson,
  fetchJournalLesson,
  publishJournalLesson,
  saveJournalLesson,
} from "../../utils/cabinetAuth";
import CabinetIcon from "../CabinetIcons";
import {
  ATTENDANCE_OPTIONS,
  JOURNAL_AUTOSAVE_DEBOUNCE_MS,
  buildBeforeUnloadHandler,
  createTabToken,
  filledRecordsCount,
  journalSaveStatusLabel,
} from "../journal/journalAutosave";
import { journalEventPk } from "../journal/openLessonSummary";
import "../styles/journal.css";

const SECTIONS = [
  { id: "attendance", label: "Посещаемость" },
  { id: "grades", label: "Успеваемость" },
  { id: "homework", label: "Домашнее задание" },
];

function scoreForCriterion(record, criterionId) {
  return (record.criterion_scores || []).find((s) => s.criterion_id === criterionId) || null;
}

function criteriaColumns(records) {
  const first = records[0];
  if (!first) return [];
  return (first.criterion_scores || []).slice(0, 4).map((s) => ({
    id: s.criterion_id,
    title: s.criterion_title,
    min: s.min_value,
    max: s.max_value,
  }));
}

function formatLessonDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatPercentScore(score) {
  if (score == null || score === "") return null;
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

function HomeworkResultBlock({ result, showCorrectAnswer = true }) {
  if (!result) return null;
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  const scoreLabel = formatPercentScore(result.score_percent);
  const hasBody =
    tasks.length > 0
    || Boolean(String(result.answer_text || "").trim())
    || Boolean(result.has_attached_file)
    || Boolean(String(result.teacher_comment || "").trim())
    || result.score_percent != null
    || Boolean(result.status_label);
  if (!hasBody) return null;
  return (
    <div className="jl-variant-result">
      <div className="jl-variant-result__head">
        <strong>{result.title || "Домашнее задание"}</strong>
        <span>
          {result.status_label || ""}
          {scoreLabel
            ? `${result.status_label ? " · " : ""}${
              result.correct_count != null && result.checked_count != null
                ? `${result.correct_count}/${result.checked_count} · `
                : ""
            }${scoreLabel}`
            : ""}
        </span>
      </div>
      {tasks.length ? (
        <div className="jl-variant-result__table-wrap">
          <table className="jl-variant-result__table">
            <thead>
              <tr>
                <th>№</th>
                <th>Ответ ученика</th>
                {showCorrectAnswer ? <th>Правильный</th> : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={`hw-${result.homework_id}-${task.id || task.number}`}>
                  <td>{task.number ?? "—"}</td>
                  <td>{String(task.student_answer || "").trim() || "—"}</td>
                  {showCorrectAnswer ? (
                    <td>{String(task.correct_answer || "").trim() || "—"}</td>
                  ) : null}
                  <td>
                    {task.ok === true ? (
                      <span className="jl-variant-result__ok">верно</span>
                    ) : task.ok === false ? (
                      <span className="jl-variant-result__bad">ошибка</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {String(result.answer_text || "").trim() ? (
        <p className="jl-hw-result-note">
          <strong>Ответ:</strong> {result.answer_text}
        </p>
      ) : null}
      {result.has_attached_file ? (
        <p className="jl-hw-result-note">Прикреплён файл</p>
      ) : null}
      {String(result.teacher_comment || "").trim() ? (
        <p className="jl-hw-result-note">
          <strong>Комментарий к ДЗ:</strong> {result.teacher_comment}
        </p>
      ) : null}
    </div>
  );
}

function formatClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatLessonTimeRange(journal) {
  const start = formatClock(journal?.starts_at || journal?.started_at);
  const end = formatClock(journal?.ends_at || journal?.finished_at);
  if (start && end) return `${start}–${end}`;
  if (start) return start;
  const mins = journal?.actual_duration_minutes ?? journal?.planned_duration_minutes;
  if (mins != null && mins !== "") return `${mins} мин`;
  return "";
}

function formatScorePercent(score, mode) {
  if (score == null || score === "") return "—";
  const value = Number(score);
  if (Number.isNaN(value)) return String(score);
  if (mode === "percentage" || mode === "auto_average" || !mode) {
    return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function parseScoreNumber(score) {
  if (score == null || score === "") return null;
  const value = Number(score);
  return Number.isFinite(value) ? value : null;
}

function scoreTone(value, mode) {
  if (value == null) return "neutral";
  if (mode === "five_point") {
    if (value >= 4) return "success";
    if (value >= 3) return "warning";
    return "danger";
  }
  if (mode === "ten_point") {
    if (value >= 8) return "success";
    if (value >= 5) return "warning";
    return "danger";
  }
  if (value >= 80) return "success";
  if (value >= 50) return "warning";
  return "danger";
}

function scoreInputBounds(mode) {
  if (mode === "ten_point") return { min: 1, max: 10, step: 1, suffix: "" };
  if (mode === "five_point") return { min: 1, max: 5, step: 1, suffix: "" };
  return { min: 0, max: 100, step: 1, suffix: "%" };
}

function isCompactScale(min, max) {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  const span = Math.round(hi) - Math.round(lo);
  return span >= 1 && span <= 10;
}

function toIntOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function isAttendanceDone(records) {
  return (
    records.length > 0
    && records.every((r) => r.attendance_status && r.attendance_status !== "not_marked")
  );
}

function isGradesDone(records) {
  return records.some((r) => {
    if (r.overall_score != null && r.overall_score !== "") return true;
    return (r.criterion_scores || []).some(
      (s) => s.is_not_applicable || (s.value != null && s.value !== ""),
    );
  });
}

function isHomeworkDone(journal) {
  return Boolean(
    journal?.homework_skipped
    || journal?.homework
    || journal?.previous_homework_status,
  );
}

function isStepComplete(sectionId, journal, records) {
  if (sectionId === "attendance") return isAttendanceDone(records);
  if (sectionId === "grades") return isGradesDone(records);
  if (sectionId === "homework") return isHomeworkDone(journal);
  return false;
}

function ScalePicker({ min = 1, max = 5, value, disabled = false, onChange, ariaLabel }) {
  const lo = Math.round(Number(min));
  const hi = Math.round(Number(max));
  const options = [];
  for (let n = lo; n <= hi; n += 1) options.push(n);
  const selected = toIntOrNull(value);

  return (
    <div
      className={`jl-scale${disabled ? " is-disabled" : ""}`}
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled}
    >
      {options.map((n) => (
        <button
          key={n}
          type="button"
          className={`jl-scale__btn${selected === n ? " is-selected" : ""}`}
          disabled={disabled}
          onClick={() => onChange?.(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function ScoreChip({ score, mode }) {
  const value = parseScoreNumber(score);
  const tone = scoreTone(value, mode);
  return (
    <span className={`jg-score-chip jg-score-chip--${tone}`}>
      {formatScorePercent(score, mode)}
    </span>
  );
}

function ResultField({ record, scoreMode, scoreBounds, onPatch }) {
  const [manualOpen, setManualOpen] = useState(Boolean(record.overall_score_manual));
  const isPercentMode =
    scoreMode === "percentage" || scoreMode === "auto_average" || !scoreMode;

  useEffect(() => {
    if (record.overall_score_manual) setManualOpen(true);
  }, [record.overall_score_manual, record.id]);

  return (
    <div className="jl-result-field">
      <div className="jl-result-field__head">
        <span className="jl-result-field__label">Результат</span>
        <ScoreChip score={record.overall_score} mode={scoreMode} />
        {!manualOpen ? (
          <button
            type="button"
            className="jl-inline-link"
            onClick={() => setManualOpen(true)}
          >
            Ручная корректировка
          </button>
        ) : null}
      </div>
      {manualOpen ? (
        <label className="jl-field jl-field--compact">
          <span>Ручная корректировка результата</span>
          {isCompactScale(scoreBounds.min, scoreBounds.max) && !isPercentMode ? (
            <ScalePicker
              min={scoreBounds.min}
              max={scoreBounds.max}
              value={record.overall_score}
              ariaLabel="Ручная корректировка результата"
              onChange={(n) =>
                onPatch(record.id, {
                  overall_score: n,
                  overall_score_manual: true,
                })
              }
            />
          ) : (
            <input
              type="number"
              min={scoreBounds.min}
              max={scoreBounds.max}
              step={scoreBounds.step}
              value={record.overall_score ?? ""}
              onChange={(e) =>
                onPatch(record.id, {
                  overall_score: e.target.value === "" ? null : e.target.value,
                  overall_score_manual: true,
                })
              }
            />
          )}
        </label>
      ) : null}
      {record.overall_score_explanation && !manualOpen ? (
        <p className="jl-hint">{record.overall_score_explanation}</p>
      ) : null}
    </div>
  );
}

function CriterionRow({ score, recordId, onCriterion }) {
  const na = Boolean(score.is_not_applicable);
  const useScale = isCompactScale(score.min_value, score.max_value);

  return (
    <div className={`jl-criterion${na ? " is-na" : ""}`}>
      <div className="jl-criterion__main">
        <span className="jl-criterion__label">{score.criterion_title}</span>
        {useScale ? (
          <ScalePicker
            min={score.min_value}
            max={score.max_value}
            value={score.value}
            disabled={na}
            ariaLabel={score.criterion_title}
            onChange={(n) =>
              onCriterion(recordId, score.criterion_id, {
                value: n,
                is_not_applicable: false,
              })
            }
          />
        ) : (
          <input
            className="jl-criterion__input"
            type="number"
            min={score.min_value}
            max={score.max_value}
            step="1"
            disabled={na}
            value={na ? "" : toIntOrNull(score.value) ?? ""}
            onChange={(e) =>
              onCriterion(recordId, score.criterion_id, {
                value: e.target.value === "" ? null : e.target.value,
                is_not_applicable: false,
              })
            }
          />
        )}
      </div>
      <label className="jl-check jl-check--tight">
        <input
          type="checkbox"
          checked={na}
          onChange={(e) =>
            onCriterion(recordId, score.criterion_id, {
              is_not_applicable: e.target.checked,
              value: e.target.checked ? null : score.value,
            })
          }
        />
        Не оценивалось
      </label>
    </div>
  );
}

export default function LessonSummaryDrawer({
  open,
  eventId,
  onClose,
  onSaved,
  onBillingPrompt,
  presentation = "drawer",
  fromMeeting = false,
}) {
  const isPage = presentation === "page";
  const [journal, setJournal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [section, setSection] = useState("attendance");
  const [activeIdx, setActiveIdx] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(null);
  const tabTokenRef = useRef(createTabToken());
  const debounceRef = useRef(null);
  const journalRef = useRef(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const conflictRetryRef = useRef(0);

  useEffect(() => {
    journalRef.current = journal;
  }, [journal]);

  const lessonPk = useMemo(() => journalEventPk(eventId), [eventId]);

  const load = useCallback(async () => {
    if (!lessonPk) {
      setError("Некорректный идентификатор урока");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchJournalLesson(lessonPk);
      setJournal(data);
      setSaveStatus("idle");
      dirtyRef.current = false;
      setActiveIdx(0);
      setSection("attendance");
    } catch (err) {
      setError(err?.message || "Не удалось загрузить журнал");
    } finally {
      setLoading(false);
    }
  }, [lessonPk]);

  useEffect(() => {
    if (open && lessonPk) {
      tabTokenRef.current = createTabToken();
      void load();
    }
  }, [open, lessonPk, load]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = buildBeforeUnloadHandler(() => (dirtyRef.current ? "dirty" : "saved"));
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flushSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const flushSave = useCallback(async () => {
    const current = journalRef.current;
    if (!current || !lessonPk) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    pendingSaveRef.current = false;
    setSaveStatus("saving");
    try {
      const payload = {
        version: current.version,
        tab_token: tabTokenRef.current,
        planned_topic: current.planned_topic,
        actual_topic: current.actual_topic,
        lesson_summary: current.lesson_summary,
        material_covered: current.material_covered,
        material_to_repeat: current.material_to_repeat,
        next_lesson_plan: current.next_lesson_plan,
        recommendations: current.recommendations,
        actual_duration_minutes: current.actual_duration_minutes,
        homework_id: current.homework_id,
        homework_skipped: current.homework_skipped,
        previous_homework_status: current.previous_homework_status,
        student_records: (current.student_records || []).map((r) => ({
          id: r.id,
          attendance_status: r.attendance_status,
          late_minutes: r.late_minutes,
          attended_minutes: r.attended_minutes,
          overall_score: r.overall_score,
          overall_score_manual: r.overall_score_manual,
          teacher_comment: r.teacher_comment,
          private_note: r.private_note,
          recommendation: r.recommendation,
          strengths: r.strengths,
          difficulties: r.difficulties,
          requires_attention: r.requires_attention,
          tag_ids: (r.tags || []).map((t) => t.id),
          criterion_scores: (r.criterion_scores || []).map((s) => ({
            criterion_id: s.criterion_id,
            value: s.value,
            is_not_applicable: s.is_not_applicable,
            comment: s.comment,
          })),
        })),
      };
      const saved = await saveJournalLesson(lessonPk, payload);
      setJournal(saved);
      journalRef.current = saved;
      setSaveStatus("saved");
      dirtyRef.current = false;
      conflictRetryRef.current = 0;
      onSaved?.(saved);
    } catch (err) {
      const code = err?.code || err?.data?.code || "";
      const isConflict =
        err?.status === 409
        || code === "version_conflict"
        || /изменён в другой вкладке|version/i.test(String(err?.message || ""));
      if (isConflict && conflictRetryRef.current < 1) {
        conflictRetryRef.current += 1;
        try {
          const fresh = await fetchJournalLesson(lessonPk);
          setJournal(fresh);
          journalRef.current = fresh;
          dirtyRef.current = true;
          setError("");
          pendingSaveRef.current = true;
          return;
        } catch {
          /* fall through */
        }
      }
      conflictRetryRef.current = 0;
      setSaveStatus("error");
      setError(err?.message || "Ошибка сохранения");
    } finally {
      savingRef.current = false;
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        window.setTimeout(() => {
          void flushSave();
        }, 80);
      }
    }
  }, [lessonPk, onSaved]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveStatus("dirty");
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void flushSave();
    }, JOURNAL_AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const patchJournal = (patch) => {
    setJournal((prev) => (prev ? { ...prev, ...patch } : prev));
    scheduleSave();
  };

  const patchRecord = (recordId, patch) => {
    setJournal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        student_records: prev.student_records.map((r) =>
          r.id === recordId ? { ...r, ...patch } : r,
        ),
      };
    });
    scheduleSave();
  };

  const patchCriterion = (recordId, criterionId, patch) => {
    setJournal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        student_records: prev.student_records.map((r) => {
          if (r.id !== recordId) return r;
          return {
            ...r,
            criterion_scores: (r.criterion_scores || []).map((s) =>
              s.criterion_id === criterionId ? { ...s, ...patch } : s,
            ),
          };
        }),
      };
    });
    scheduleSave();
  };

  const runBulk = async (action, extra = {}) => {
    if (!lessonPk) return;
    setBusy(true);
    setError("");
    try {
      await flushSave();
      const data = await bulkJournalLesson(lessonPk, { action, ...extra });
      setJournal(data.journal);
      setSaveStatus("saved");
    } catch (err) {
      if (err?.code === "confirm_required" || String(err?.message || "").includes("подтвержд")) {
        setConfirmOverwrite({ action, extra });
      } else {
        setError(err?.message || "Не удалось выполнить действие");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFinishLater = async () => {
    if (!lessonPk) return;
    setBusy(true);
    setError("");
    try {
      await flushSave();
      onClose?.();
    } catch (err) {
      setError(err?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!lessonPk) return;
    setBusy(true);
    setError("");
    try {
      await flushSave();
      const unmarked = (journalRef.current?.student_records || []).filter(
        (r) => r.attendance_status === "not_marked",
      );
      const completed = await completeJournalLesson(lessonPk, {
        force: unmarked.length > 0,
      });
      setJournal(completed);
      const data = await publishJournalLesson(lessonPk, { notify: true });
      setJournal(data.journal);
      setSaveStatus("saved");
      onSaved?.(data.journal);
      onClose?.();
      onBillingPrompt?.(lessonPk);
    } catch (err) {
      setError(err?.message || "Не удалось опубликовать");
    } finally {
      setBusy(false);
    }
  };

  const records = journal?.student_records || [];
  const stepStates = useMemo(
    () =>
      SECTIONS.map((s) => ({
        ...s,
        done: isStepComplete(s.id, journal, records),
      })),
    [journal, records],
  );

  if (!open) return null;

  const scoreMode = journal?.overall_score_mode || "auto_average";
  const scoreBounds = scoreInputBounds(scoreMode);
  const isGroup = Boolean(journal?.is_group);
  const cols = criteriaColumns(records);
  const { filled, total } = filledRecordsCount(records);
  const active = records[activeIdx] || records[0];
  const plannedTopic = journal?.planned_topic || "";
  const actualTopic = journal?.actual_topic || "";
  const timeRange = formatLessonTimeRange(journal);

  return (
    <div
      className={`jl-drawer-root${isPage ? " jl-drawer-root--page" : ""}`}
      role={isPage ? "main" : "dialog"}
      aria-modal={isPage ? undefined : true}
      aria-label="Итоги урока"
    >
      {!isPage ? (
        <button type="button" className="jl-drawer-backdrop" aria-label="Закрыть" onClick={onClose} />
      ) : null}
      <div className={`jl-drawer${isPage ? " jl-drawer--page" : ""}`}>
        <header className="jl-drawer__header">
          <div className="jl-drawer__heading">
            <h2 className="jl-drawer__title">Итоги урока</h2>
            <p className="jl-drawer__meta">
              {formatLessonDate(journal?.lesson_date)}
              {timeRange ? ` · ${timeRange}` : ""}
              {plannedTopic ? ` · ${plannedTopic}` : ""}
              {isGroup && journal?.group_title ? ` · ${journal.group_title}` : ""}
            </p>
          </div>
          <div className="jl-drawer__header-actions">
            <span className={`jl-save-status jl-save-status--${saveStatus}`}>
              {journalSaveStatusLabel(saveStatus)}
            </span>
            <button type="button" className="jl-btn jl-btn--ghost" onClick={onClose}>
              {isPage ? "Закрыть вкладку" : "Закрыть"}
            </button>
          </div>
        </header>

        {journal && !loading ? (
          <section className="jl-recap" aria-label="Результаты занятия">
            <h3 className="jl-recap__title">
              {fromMeeting ? "Подтвердите проведение занятия" : "Результаты занятия"}
            </h3>
            <p className="jl-recap__meta">
              {[
                isGroup
                  ? (journal.group_title || "Группа")
                  : (records[0]?.student_name || ""),
                formatLessonDate(journal.lesson_date),
                plannedTopic || actualTopic,
                journal.actual_duration_minutes || journal.planned_duration_minutes
                  ? `${journal.actual_duration_minutes || journal.planned_duration_minutes} мин`
                  : timeRange,
              ].filter(Boolean).join(" · ")}
            </p>
            {journal.homework ? (
              <p className="jl-recap__hw">
                ДЗ: {journal.homework.title || "задание подготовлено"}
                {journal.homework.due_at
                  ? ` · срок ${new Date(journal.homework.due_at).toLocaleDateString("ru-RU")}`
                  : ""}
              </p>
            ) : (
              <p className="jl-recap__hw">ДЗ можно подтвердить или добавить в шаге «Домашнее задание».</p>
            )}
          </section>
        ) : null}

        <nav className="jl-stepper" aria-label="Шаги итогов">
          {stepStates.map((s, index) => {
            const isActive = section === s.id;
            const stateClass = isActive ? " is-active" : s.done ? " is-done" : " is-todo";
            return (
              <div key={s.id} className={`jl-stepper__item${stateClass}`}>
                {index > 0 ? <span className="jl-stepper__line" aria-hidden="true" /> : null}
                <button
                  type="button"
                  className="jl-stepper__btn"
                  aria-current={isActive ? "step" : undefined}
                  onClick={() => setSection(s.id)}
                >
                  <span className="jl-stepper__index" aria-hidden="true">
                    {s.done && !isActive ? <CabinetIcon name="check" /> : index + 1}
                  </span>
                  <span className="jl-stepper__label">{s.label}</span>
                </button>
              </div>
            );
          })}
        </nav>

        {loading ? <div className="jl-state">Загрузка…</div> : null}
        {error ? (
          <div className="jl-error" role="alert">
            {error}
            <button type="button" className="jl-btn jl-btn--ghost" onClick={() => void flushSave()}>
              Повторить сохранение
            </button>
          </div>
        ) : null}

        {journal && !loading ? (
          <div className="jl-drawer__body">
            <section className="jl-topic-block">
              <label className="jl-field">
                <span>Планируемая тема</span>
                <input
                  type="text"
                  value={plannedTopic}
                  placeholder="Тема не запланирована"
                  onChange={(e) => patchJournal({ planned_topic: e.target.value })}
                />
                <span className="jl-field__hint">
                  Синхронизируется с карточкой урока и пунктом плана обучения
                </span>
              </label>
              <label className="jl-field">
                <span className="jl-field__label-row">
                  <span>Фактическая тема</span>
                  {plannedTopic ? (
                    <button
                      type="button"
                      className="jl-inline-link"
                      onClick={() => patchJournal({ actual_topic: plannedTopic })}
                    >
                      <CabinetIcon name="arrow" />
                      Скопировать из плановой
                    </button>
                  ) : null}
                </span>
                <input
                  type="text"
                  value={actualTopic}
                  placeholder="Фактическая тема не указана"
                  onChange={(e) => patchJournal({ actual_topic: e.target.value })}
                />
                <span className="jl-field__hint">
                  Не изменяет план и будущие уроки
                </span>
              </label>
            </section>

            {isGroup ? (
              <p className="jl-progress">
                Заполнено {filled} из {total} учеников
              </p>
            ) : null}

            {section === "attendance" ? (
              <section className="jl-section">
                {isGroup ? (
                  <div className="jl-bulk-bar">
                    <button
                      type="button"
                      className="jl-btn jl-btn--outline"
                      disabled={busy}
                      onClick={() => void runBulk("mark_all_present")}
                    >
                      Отметить всех присутствующими
                    </button>
                  </div>
                ) : null}
                {isGroup ? (
                  <div className="jl-student-cards">
                    {records.map((r, idx) => (
                      <article key={r.id} className="jl-student-card">
                        <div className="jl-student-card__head">
                          <span className="jl-student-name">{r.student_name}</span>
                          <ScoreChip score={r.overall_score} mode={scoreMode} />
                        </div>
                        <label className="jl-field">
                          <span>Посещение</span>
                          <select
                            value={r.attendance_status || "not_marked"}
                            onChange={(e) =>
                              patchRecord(r.id, { attendance_status: e.target.value })
                            }
                          >
                            {ATTENDANCE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(r.attendance_status === "late" || r.attendance_status === "partial") && (
                          <label className="jl-field">
                            <span>
                              {r.attendance_status === "late" ? "Опоздание (мин)" : "Присутствие (мин)"}
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={
                                r.attendance_status === "late"
                                  ? r.late_minutes ?? ""
                                  : r.attended_minutes ?? ""
                              }
                              onChange={(e) => {
                                const v = e.target.value === "" ? null : Number(e.target.value);
                                patchRecord(
                                  r.id,
                                  r.attendance_status === "late"
                                    ? { late_minutes: v }
                                    : { attended_minutes: v },
                                );
                              }}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="jl-btn jl-btn--ghost"
                          onClick={() => {
                            setActiveIdx(idx);
                            setSection("grades");
                            setExpandedId(r.id);
                          }}
                        >
                          Оценки и комментарий
                        </button>
                      </article>
                    ))}
                  </div>
                ) : active ? (
                  <div className="jl-individual">
                    <label className="jl-field jl-field--compact">
                      <span>Посещение — {active.student_name}</span>
                      <select
                        value={active.attendance_status || "not_marked"}
                        onChange={(e) =>
                          patchRecord(active.id, { attendance_status: e.target.value })
                        }
                      >
                        {ATTENDANCE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
              </section>
            ) : null}

            {section === "grades" ? (
              <section className="jl-section jl-section--grades">
                {isGroup ? (
                  <>
                    <div className="jl-student-cards">
                      {records.map((r, idx) => (
                        <article key={`m-${r.id}`} className="jl-student-card">
                          <div className="jl-student-card__head">
                            <span className="jl-student-name">{r.student_name}</span>
                            <ScoreChip score={r.overall_score} mode={scoreMode} />
                          </div>
                          <button
                            type="button"
                            className="jl-btn jl-btn--outline"
                            onClick={() => {
                              setActiveIdx(idx);
                              setExpandedId(r.id);
                            }}
                          >
                            Открыть карточку
                          </button>
                        </article>
                      ))}
                    </div>
                    <div className="jl-bulk-bar">
                      <button
                        type="button"
                        className="jl-btn jl-btn--outline"
                        disabled={busy}
                        onClick={() => void runBulk("copy_previous")}
                      >
                        Скопировать оценки прошлого урока
                      </button>
                      <button
                        type="button"
                        className="jl-btn jl-btn--ghost"
                        disabled={busy}
                        onClick={() =>
                          setConfirmOverwrite({
                            action: "clear_scores",
                            extra: { confirm: true, overwrite_touched: true },
                          })
                        }
                      >
                        Очистить оценки
                      </button>
                    </div>
                    <div className="jl-table-wrap">
                      <table className="jl-table">
                        <thead>
                          <tr>
                            <th className="jl-sticky">Ученик</th>
                            <th>Посещение</th>
                            {cols.map((c) => (
                              <th key={c.id}>{c.title}</th>
                            ))}
                            <th>Результат</th>
                            <th>Комментарий</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((r) => (
                            <tr key={r.id} className={expandedId === r.id ? "is-expanded" : ""}>
                              <td className="jl-sticky">
                                <button
                                  type="button"
                                  className="jl-linkish"
                                  onClick={() =>
                                    setExpandedId((id) => (id === r.id ? null : r.id))
                                  }
                                >
                                  {r.student_name}
                                </button>
                              </td>
                              <td>
                                <select
                                  value={r.attendance_status || "not_marked"}
                                  onChange={(e) =>
                                    patchRecord(r.id, { attendance_status: e.target.value })
                                  }
                                >
                                  {ATTENDANCE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              {cols.map((c) => {
                                const sc = scoreForCriterion(r, c.id);
                                return (
                                  <td key={c.id}>
                                    <input
                                      type="number"
                                      min={c.min}
                                      max={c.max}
                                      step="1"
                                      disabled={sc?.is_not_applicable}
                                      value={
                                        sc?.is_not_applicable
                                          ? ""
                                          : toIntOrNull(sc?.value) ?? ""
                                      }
                                      onChange={(e) =>
                                        patchCriterion(r.id, c.id, {
                                          value: e.target.value === "" ? null : e.target.value,
                                          is_not_applicable: false,
                                        })
                                      }
                                      aria-label={`${r.student_name}: ${c.title}`}
                                    />
                                  </td>
                                );
                              })}
                              <td>
                                <ScoreChip score={r.overall_score} mode={scoreMode} />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  value={r.teacher_comment || ""}
                                  onChange={(e) =>
                                    patchRecord(r.id, { teacher_comment: e.target.value })
                                  }
                                  placeholder="Ученику"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {expandedId ? (
                      <RecordExpanded
                        record={records.find((r) => r.id === expandedId)}
                        scoreMode={scoreMode}
                        scoreBounds={scoreBounds}
                        onPatch={patchRecord}
                        onCriterion={patchCriterion}
                        onNext={() => {
                          const idx = records.findIndex((r) => r.id === expandedId);
                          const next = records[idx + 1];
                          if (next) setExpandedId(next.id);
                        }}
                      />
                    ) : null}
                  </>
                ) : active ? (
                  <RecordExpanded
                    record={active}
                    scoreMode={scoreMode}
                    scoreBounds={scoreBounds}
                    onPatch={patchRecord}
                    onCriterion={patchCriterion}
                    individual
                  />
                ) : null}

                <label className="jl-field">
                  <span>Длительность урока (мин)</span>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={journal.actual_duration_minutes ?? journal.planned_duration_minutes ?? ""}
                    onChange={(e) =>
                      patchJournal({
                        actual_duration_minutes:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  {timeRange ? (
                    <span className="jl-field__hint">По расписанию: {timeRange}</span>
                  ) : null}
                </label>
                <label className="jl-field">
                  <span>Общий итог урока</span>
                  <textarea
                    rows={4}
                    value={journal.lesson_summary || ""}
                    onChange={(e) => patchJournal({ lesson_summary: e.target.value })}
                    placeholder="Что сделали на уроке, ключевые выводы"
                  />
                </label>
                <label className="jl-field">
                  <span>Пройденный материал</span>
                  <textarea
                    rows={3}
                    value={journal.material_covered || ""}
                    onChange={(e) => patchJournal({ material_covered: e.target.value })}
                  />
                </label>
                <label className="jl-field">
                  <span>Нужно повторить</span>
                  <textarea
                    rows={3}
                    value={journal.material_to_repeat || ""}
                    onChange={(e) => patchJournal({ material_to_repeat: e.target.value })}
                  />
                </label>
                <label className="jl-field">
                  <span>План на следующий урок</span>
                  <textarea
                    rows={3}
                    value={journal.next_lesson_plan || ""}
                    onChange={(e) => patchJournal({ next_lesson_plan: e.target.value })}
                  />
                </label>
                <label className="jl-field">
                  <span>Общие рекомендации</span>
                  <textarea
                    rows={3}
                    value={journal.recommendations || ""}
                    onChange={(e) => patchJournal({ recommendations: e.target.value })}
                  />
                </label>
              </section>
            ) : null}

            {section === "homework" ? (
              <section className="jl-section">
                <div className="jl-hw-card">
                  <h3>Выданное задание</h3>
                  {journal.homework ? (
                    <p>
                      {journal.homework.title}
                      {journal.homework.due_at
                        ? ` · срок ${new Date(journal.homework.due_at).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                        : ""}
                      {` · задач: ${journal.homework.tasks_count ?? "—"}`}
                    </p>
                  ) : (
                    <p>Домашнее задание не привязано</p>
                  )}
                  <label className="jl-check">
                    <input
                      type="checkbox"
                      checked={Boolean(journal.homework_skipped)}
                      onChange={(e) => patchJournal({ homework_skipped: e.target.checked })}
                    />
                    Не выдавать домашнее задание
                  </label>
                  <Link className="jl-btn jl-btn--outline" to="/cabinet/review">
                    Открыть проверку ДЗ
                  </Link>
                </div>
                <div className="jl-hw-card">
                  <h3>Предыдущее домашнее задание</h3>
                  {journal.previous_homework ? (
                    <p>
                      {journal.previous_homework.title}
                      {journal.previous_homework.due_at
                        ? ` · срок ${new Date(journal.previous_homework.due_at).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                        : ""}
                    </p>
                  ) : null}
                  <select
                    value={journal.previous_homework_status || ""}
                    onChange={(e) =>
                      patchJournal({ previous_homework_status: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    <option value="full">Выполнено полностью</option>
                    <option value="partial">Выполнено частично</option>
                    <option value="not_done">Не выполнено</option>
                    <option value="not_assigned">Не было задано</option>
                    <option value="not_reviewed">Не проверено</option>
                  </select>
                  {(records || []).map((r) => (
                    r.homework_result ? (
                      <div key={`prev-hw-${r.id}`} className="jl-hw-student-result">
                        {journal.is_group ? (
                          <h4 className="jl-hw-student-result__name">{r.student_name}</h4>
                        ) : null}
                        <HomeworkResultBlock result={r.homework_result} />
                      </div>
                    ) : null
                  ))}
                </div>
              </section>
            ) : null}

          </div>
        ) : null}

        <footer className="jl-drawer__footer">
          <button
            type="button"
            className="jl-btn jl-btn--text"
            disabled={busy}
            onClick={() => void handleFinishLater()}
          >
            Завершить позже
          </button>
          <div className="jl-drawer__footer-actions">
            <button
              type="button"
              className="jl-btn jl-btn--outline"
              disabled={busy}
              onClick={() => void flushSave()}
            >
              Сохранить черновик
            </button>
            <button
              type="button"
              className="jl-btn jl-btn--primary"
              disabled={busy}
              onClick={() => void handlePublish()}
            >
              <CabinetIcon name="export" />
              Опубликовать ученику
            </button>
          </div>
        </footer>

        {confirmOverwrite ? (
          <div className="jl-confirm">
            <p>Перезаписать индивидуально изменённые поля?</p>
            <div className="jl-confirm__actions">
              <button
                type="button"
                className="jl-btn jl-btn--ghost"
                onClick={() => setConfirmOverwrite(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="jl-btn jl-btn--primary"
                onClick={() => {
                  const { action, extra } = confirmOverwrite;
                  setConfirmOverwrite(null);
                  void runBulk(action, { ...extra, overwrite_touched: true, confirm: true });
                }}
              >
                Перезаписать
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecordExpanded({
  record,
  onPatch,
  onCriterion,
  onNext,
  individual = false,
  scoreMode = "auto_average",
  scoreBounds = { min: 0, max: 100, step: 1, suffix: "%" },
}) {
  if (!record) return null;
  const variantResult = record.variant_result || null;
  const variantTasks = Array.isArray(variantResult?.tasks) ? variantResult.tasks : [];
  return (
    <div className="jl-expanded">
      <h3 className="jl-student-name jl-student-name--lg">{record.student_name}</h3>
      {variantTasks.length ? (
        <div className="jl-variant-result">
          <div className="jl-variant-result__head">
            <strong>{variantResult.title || "Вариант на уроке"}</strong>
            {variantResult.score_percent != null ? (
              <span>
                {variantResult.correct_count ?? 0}/{variantResult.checked_count ?? variantTasks.length}
                {" · "}
                {formatPercentScore(variantResult.score_percent)}
              </span>
            ) : null}
          </div>
          <div className="jl-variant-result__table-wrap">
            <table className="jl-variant-result__table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Ответ ученика</th>
                  <th>Правильный</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {variantTasks.map((task) => (
                  <tr key={`${record.id}-${task.id || task.number}`}>
                    <td>{task.number ?? "—"}</td>
                    <td>{String(task.student_answer || "").trim() || "—"}</td>
                    <td>{String(task.correct_answer || "").trim() || "—"}</td>
                    <td>
                      {task.ok === true ? (
                        <span className="jl-variant-result__ok">верно</span>
                      ) : task.ok === false ? (
                        <span className="jl-variant-result__bad">ошибка</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <HomeworkResultBlock result={record.homework_result} />
      <div className="jl-criteria">
        {(record.criterion_scores || []).map((s) => (
          <CriterionRow
            key={s.criterion_id}
            score={s}
            recordId={record.id}
            onCriterion={onCriterion}
          />
        ))}
      </div>
      <ResultField
        record={record}
        scoreMode={scoreMode}
        scoreBounds={scoreBounds}
        onPatch={onPatch}
      />
      <label className="jl-field jl-field--public">
        <span>Комментарий ученику</span>
        <textarea
          rows={2}
          value={record.teacher_comment || ""}
          onChange={(e) => onPatch(record.id, { teacher_comment: e.target.value })}
        />
      </label>
      <label className="jl-field jl-field--private">
        <span>Приватная заметка учителя</span>
        <textarea
          rows={2}
          value={record.private_note || ""}
          onChange={(e) => onPatch(record.id, { private_note: e.target.value })}
        />
      </label>
      <label className="jl-field">
        <span>Рекомендации</span>
        <textarea
          rows={2}
          value={record.recommendation || ""}
          onChange={(e) => onPatch(record.id, { recommendation: e.target.value })}
        />
      </label>
      <label className="jl-field">
        <span>Сильные стороны</span>
        <textarea
          rows={2}
          value={record.strengths || ""}
          onChange={(e) => onPatch(record.id, { strengths: e.target.value })}
        />
      </label>
      <label className="jl-field">
        <span>Трудности</span>
        <textarea
          rows={2}
          value={record.difficulties || ""}
          onChange={(e) => onPatch(record.id, { difficulties: e.target.value })}
        />
      </label>
      <label className="jl-check">
        <input
          type="checkbox"
          checked={Boolean(record.requires_attention)}
          onChange={(e) => onPatch(record.id, { requires_attention: e.target.checked })}
        />
        Требует внимания
      </label>
      {!individual && onNext ? (
        <button type="button" className="jl-btn jl-btn--outline" onClick={onNext}>
          Следующий ученик
        </button>
      ) : null}
    </div>
  );
}
