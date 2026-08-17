import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchGroups,
  fetchJournalGroup,
  fetchJournalStudent,
  fetchJournalStudentErrorsSummary,
  fetchStudents,
  normalizeCabinetList,
  createOfflineJournalLesson,
} from "../../utils/cabinetAuth";
import JournalAttentionBlock, {
  buildJournalAttentionItems,
} from "../components/JournalAttentionBlock";
import JournalEntriesFeed from "../components/JournalEntriesFeed";
import JournalLessonsTable from "../components/JournalLessonsTable";
import JournalPerformanceSummary from "../components/JournalPerformanceSummary";
import JournalStudentErrorsPanel from "../components/JournalStudentErrorsPanel";
import { openLessonSummaryTab } from "../journal/openLessonSummary";
import { usePageTitle } from "../hooks/usePageTitle";
import "../styles/journal.css";

function studentLabel(s) {
  return s.full_name || `${s.first_name || ""} ${s.last_name || ""}`.trim() || `Ученик #${s.id}`;
}

function initialsFromName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function OfflineLessonForm({ studentId, groupId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIsoDate);
  const [time, setTime] = useState("12:00");
  const [duration, setDuration] = useState(60);
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!studentId && !groupId) return null;

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await createOfflineJournalLesson({
        student_id: studentId || undefined,
        group_id: groupId || undefined,
        lesson_date: date,
        starts_time: time,
        duration_minutes: Number(duration) || 60,
        actual_topic: topic,
        lesson_summary: summary,
      });
      setTopic("");
      setSummary("");
      setOpen(false);
      onCreated?.(created);
    } catch (err) {
      setError(err?.message || "Не удалось добавить занятие");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="jg-offline-form">
      {!open ? (
        <button type="button" className="jg-btn jg-btn--secondary jg-btn--sm" onClick={() => setOpen(true)}>
          Занятие вне платформы
        </button>
      ) : (
        <form className="jg-offline-form__card" onSubmit={submit}>
          <h3>Занятие вне платформы</h3>
          <p>Урок прошёл без видеозвонка и без записи в расписании. Биллинг создаётся только после завершения журнала.</p>
          <div className="jg-offline-form__grid">
            <label>
              Дата
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label>
              Время
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </label>
            <label>
              Минуты
              <input
                type="number"
                min={1}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
          </div>
          <label>
            Фактическая тема
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Что прошли на уроке" />
          </label>
          <label>
            Заметки
            <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
          {error ? <p className="jg-offline-form__error">{error}</p> : null}
          <div className="jg-offline-form__actions">
            <button type="submit" className="jg-btn jg-btn--primary jg-btn--sm" disabled={saving}>
              {saving ? "Сохранение…" : "Добавить в журнал"}
            </button>
            <button
              type="button"
              className="jg-btn jg-btn--ghost jg-btn--sm"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function CabinetJournalPage() {
  const [params, setParams] = useSearchParams();
  const groupId = params.get("group") ? Number(params.get("group")) : null;
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const eventParam = params.get("event");
  const scopeMode = groupId ? "group" : "student";
  const tabParam = params.get("tab");
  const activeTab = scopeMode === "student" && tabParam === "errors" ? "errors" : "journal";

  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [summary, setSummary] = useState(null);
  const [scopeTitle, setScopeTitle] = useState("");
  const [studentMeta, setStudentMeta] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorsCount, setErrorsCount] = useState(null);
  const [entriesSummary, setEntriesSummary] = useState(null);
  const [entriesFilterPreset, setEntriesFilterPreset] = useState(null);

  const lessonsRef = useRef(null);
  const feedRef = useRef(null);

  const setScope = useCallback((next) => {
    const p = new URLSearchParams(params);
    if (next.group != null && next.group !== "") {
      p.set("group", String(next.group));
      p.delete("student");
    } else if (next.student != null && next.student !== "") {
      p.set("student", String(next.student));
      p.delete("group");
    } else {
      p.delete("group");
      p.delete("student");
    }
    p.delete("event");
    if (next.tab === "errors") p.set("tab", "errors");
    else if (next.tab === "journal" || next.clearTab) p.delete("tab");
    setParams(p, { replace: true });
  }, [params, setParams]);

  const setTab = useCallback((tab) => {
    const p = new URLSearchParams(params);
    if (tab === "errors") p.set("tab", "errors");
    else p.delete("tab");
    setParams(p, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchGroups({ status: "active" }),
      fetchStudents({ status: "active" }),
    ])
      .then(([gRaw, sRaw]) => {
        if (cancelled) return;
        const gList = normalizeCabinetList(gRaw);
        const sList = normalizeCabinetList(sRaw);
        setGroups(gList);
        setStudents(sList);
        if (!groupId && !studentId) {
          if (sList[0]?.id) {
            setScope({ student: sList[0].id });
          } else if (gList[0]?.id) {
            setScope({ group: gList[0].id });
          }
        }
      })
      .catch((err) => setError(err?.message || "Не удалось загрузить список"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadJournal = useCallback(async () => {
    if (!groupId && !studentId) {
      setLessons([]);
      setSummary(null);
      setScopeTitle("");
      setStudentMeta(null);
      setErrorsCount(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (groupId) {
        const data = await fetchJournalGroup(groupId);
        setLessons(data.lessons || []);
        setSummary(data.summary || null);
        setScopeTitle(data.group?.title || "");
        setStudentMeta(null);
        setErrorsCount(null);
      } else {
        const data = await fetchJournalStudent(studentId);
        setLessons(data.lessons || []);
        setSummary(data.summary || null);
        setScopeTitle(data.student?.full_name || "");
        setStudentMeta(data.student || null);
      }
    } catch (err) {
      setError(err?.message || "Не удалось загрузить журнал");
      setLessons([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [groupId, studentId]);

  useEffect(() => {
    void loadJournal();
  }, [loadJournal]);

  // Лёгкий счётчик ошибок для бейджа вкладки (без тяжёлых деталей)
  useEffect(() => {
    if (!studentId || scopeMode !== "student") {
      setErrorsCount(null);
      return undefined;
    }
    let cancelled = false;
    fetchJournalStudentErrorsSummary(studentId)
      .then((data) => {
        if (!cancelled) setErrorsCount(Number(data?.total_errors) || 0);
      })
      .catch(() => {
        if (!cancelled) setErrorsCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, scopeMode]);

  useEffect(() => {
    if (!eventParam) return;
    openLessonSummaryTab(eventParam);
    const p = new URLSearchParams(params);
    p.delete("event");
    setParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventParam]);

  useEffect(() => {
    if (scopeMode === "group" && tabParam === "errors") {
      const p = new URLSearchParams(params);
      p.delete("tab");
      setParams(p, { replace: true });
    }
  }, [scopeMode, tabParam, params, setParams]);

  const switchMode = (mode) => {
    if (mode === "group") {
      const next = groupId || groups[0]?.id;
      if (next) setScope({ group: next, clearTab: true });
      else setScope({ clearTab: true });
      return;
    }
    const next = studentId || students[0]?.id;
    if (next) setScope({ student: next });
    else setScope({});
  };

  const onSelectChange = (value) => {
    if (!value) {
      setScope({});
      return;
    }
    const id = Number(value);
    if (scopeMode === "group") setScope({ group: id, clearTab: true });
    else setScope({ student: id });
  };

  const selectOptions = useMemo(() => {
    if (scopeMode === "group") {
      return groups.map((g) => ({ id: g.id, label: g.title }));
    }
    return students.map((s) => ({ id: s.id, label: studentLabel(s) }));
  }, [scopeMode, groups, students]);

  const selectValue = scopeMode === "group" ? (groupId || "") : (studentId || "");
  const selectPlaceholder =
    scopeMode === "group" ? "— выберите группу —" : "— выберите ученика —";

  const openLesson = (scheduleEventId) => {
    openLessonSummaryTab(scheduleEventId);
  };

  const journalTitle = scopeTitle || (scopeMode === "group" ? "Группа" : "Ученик");
  usePageTitle(journalTitle);

  const detailsHref = groupId
    ? `/cabinet/journal/analytics?group=${groupId}`
    : studentId
      ? `/cabinet/journal/analytics?student=${studentId}`
      : "";

  const attentionItems = useMemo(
    () =>
      buildJournalAttentionItems({
        summary,
        lessons,
        entriesSummary,
        errorsCount: errorsCount || 0,
        scopeMode,
      }),
    [summary, lessons, entriesSummary, errorsCount, scopeMode],
  );

  const onAttentionAction = (item) => {
    if (item.action === "errors") {
      setTab("errors");
      return;
    }
    if (item.action === "analytics" && detailsHref) {
      window.open(detailsHref, "_blank", "noopener,noreferrer");
      return;
    }
    if (item.action === "lessons") {
      lessonsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (item.action === "pending_review") {
      setEntriesFilterPreset({ entry_type: "homework", reviewed: "no", overdue: false });
      feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (item.action === "overdue") {
      setEntriesFilterPreset({ entry_type: "homework", overdue: true, reviewed: "" });
      feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const subtitle =
    scopeMode === "group"
      ? "Журнал группы"
      : studentMeta?.direction
        ? `Журнал ученика · ${studentMeta.direction}`
        : "Журнал ученика";

  return (
    <div className="jg-page jg-page--v2">
      <header className="jg-hero">
        <div className="jg-hero__toolbar">
          <div className="jg-hero__controls">
            <div className="jg-seg jg-seg--solid" role="tablist" aria-label="Тип журнала">
              <button
                type="button"
                role="tab"
                aria-selected={scopeMode === "student"}
                className={`jg-seg__btn${scopeMode === "student" ? " is-active" : ""}`}
                onClick={() => switchMode("student")}
              >
                Ученик
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scopeMode === "group"}
                className={`jg-seg__btn${scopeMode === "group" ? " is-active" : ""}`}
                onClick={() => switchMode("group")}
              >
                Группа
              </button>
            </div>

            <label className="jg-hero__select-wrap">
              <span className="jg-sr-only">
                {scopeMode === "group" ? "Группа" : "Ученик"}
              </span>
              <select
                className="jg-hero__select"
                value={selectValue}
                onChange={(e) => onSelectChange(e.target.value)}
                aria-label={scopeMode === "group" ? "Выбор группы" : "Выбор ученика"}
              >
                <option value="">{selectPlaceholder}</option>
                {selectOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {(groupId || studentId) && activeTab === "journal" && !loading ? (
            <JournalAttentionBlock
              variant="hero"
              items={attentionItems}
              onAction={onAttentionAction}
            />
          ) : null}
        </div>

        <div className="jg-hero__identity">
          <div className="jg-hero__avatar" aria-hidden="true">
            {initialsFromName(journalTitle)}
          </div>
          <div className="jg-hero__text">
            <p className="jg-hero__eyebrow">Журнал</p>
            <h1 className="jg-hero__title">{journalTitle}</h1>
            <p className="jg-hero__subtitle">{subtitle}</p>
          </div>
        </div>
      </header>

      {scopeMode === "student" && studentId ? (
        <div className="jg-primary-tabs-wrap">
          <div className="jg-primary-tabs" role="tablist" aria-label="Разделы журнала ученика">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "journal"}
              className={`jg-primary-tabs__btn${activeTab === "journal" ? " is-active" : ""}`}
              onClick={() => setTab("journal")}
            >
              <span className="jg-primary-tabs__icon" aria-hidden="true">📘</span>
              <span>Журнал</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "errors"}
              className={`jg-primary-tabs__btn jg-primary-tabs__btn--errors${activeTab === "errors" ? " is-active" : ""}${errorsCount > 0 ? " has-errors" : ""}`}
              onClick={() => setTab("errors")}
            >
              <span className="jg-primary-tabs__icon" aria-hidden="true">⚠</span>
              <span>Ошибки ученика</span>
              <span className={`jg-primary-tabs__badge${errorsCount > 0 ? " is-alert" : ""}`}>
                {errorsCount == null ? "…" : errorsCount}
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="jg-state jg-state--error" role="alert">
          <h2>Не удалось загрузить журнал</h2>
          <p>{error}</p>
          <button type="button" className="jg-btn jg-btn--primary" onClick={() => void loadJournal()}>
            Повторить
          </button>
        </div>
      ) : null}

      {!groupId && !studentId ? (
        <div className="jg-state">
          <h2>Выберите ученика или группу</h2>
          <p>Журнал покажет уроки, домашние задания, посещаемость и результаты.</p>
        </div>
      ) : activeTab === "errors" && studentId ? (
        <div className="jg-page__content">
          <JournalStudentErrorsPanel
            studentId={studentId}
            studentName={scopeTitle}
            onErrorsCountChange={setErrorsCount}
          />
        </div>
      ) : (
        <div className="jg-page__content">
          <div ref={lessonsRef}>
            <OfflineLessonForm
              studentId={studentId}
              groupId={groupId}
              onCreated={(created) => {
                void loadJournal();
                if (created?.schedule_event_id) {
                  openLessonSummaryTab(created.schedule_event_id);
                }
              }}
            />
            <JournalLessonsTable
              scopeType={scopeMode}
              lessons={lessons}
              loading={loading}
              onOpenLesson={openLesson}
            />
          </div>

          <div ref={feedRef}>
            <JournalEntriesFeed
              studentId={studentId}
              groupId={groupId}
              filterPreset={entriesFilterPreset}
              onFilterPresetConsumed={() => setEntriesFilterPreset(null)}
              onSummaryChange={setEntriesSummary}
            />
          </div>

          <JournalPerformanceSummary
            summary={summary}
            scopeType={scopeMode}
            loading={loading && !summary}
            variant="compact"
            detailsHref={detailsHref}
            errorsCount={errorsCount}
            onOpenErrors={scopeMode === "student" ? () => setTab("errors") : undefined}
          />
        </div>
      )}
    </div>
  );
}
