import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchGroups,
  fetchJournalGroup,
  fetchJournalStudent,
  fetchStudents,
  normalizeCabinetList,
} from "../../utils/cabinetAuth";
import JournalLessonsTable from "../components/JournalLessonsTable";
import JournalPerformanceSummary from "../components/JournalPerformanceSummary";
import { openLessonSummaryTab } from "../journal/openLessonSummary";
import "../styles/journal.css";

function studentLabel(s) {
  return s.full_name || `${s.first_name || ""} ${s.last_name || ""}`.trim() || `Ученик #${s.id}`;
}

export default function CabinetJournalPage() {
  const [params, setParams] = useSearchParams();
  const groupId = params.get("group") ? Number(params.get("group")) : null;
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const eventParam = params.get("event");
  const scopeMode = groupId ? "group" : "student";

  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [summary, setSummary] = useState(null);
  const [scopeTitle, setScopeTitle] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      } else {
        const data = await fetchJournalStudent(studentId);
        setLessons(data.lessons || []);
        setSummary(data.summary || null);
        setScopeTitle(data.student?.full_name || "");
      }
    } catch (err) {
      setError(err?.message || "Ошибка загрузки журнала");
      setLessons([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [groupId, studentId]);

  useEffect(() => {
    void loadJournal();
  }, [loadJournal]);

  useEffect(() => {
    if (!eventParam) return;
    openLessonSummaryTab(eventParam);
    const p = new URLSearchParams(params);
    p.delete("event");
    setParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventParam]);

  const switchMode = (mode) => {
    if (mode === "group") {
      const next = groupId || groups[0]?.id;
      if (next) setScope({ group: next });
      else setScope({});
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
    if (scopeMode === "group") setScope({ group: id });
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

  return (
    <div className="jg-page">
      <header className="jg-toolbar">
        <div className="jg-toolbar__title-block">
          <span className="jg-toolbar__eyebrow">Журнал</span>
          <h1 className="jg-toolbar__title">
            {scopeTitle || (scopeMode === "group" ? "Группа" : "Ученик")}
          </h1>
        </div>

        <div className="jg-scope">
          <div className="jg-seg" role="tablist" aria-label="Тип журнала">
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

          <label className="jg-scope__select-wrap">
            <span className="jg-sr-only">
              {scopeMode === "group" ? "Группа" : "Ученик"}
            </span>
            <select
              className="jg-scope__select"
              value={selectValue}
              onChange={(e) => onSelectChange(e.target.value)}
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
      </header>

      {error ? <div className="jl-error">{error}</div> : null}

      {!groupId && !studentId ? (
        <div className="jg-empty">Выберите ученика или группу</div>
      ) : (
        <div className="jg-page__content">
          <JournalPerformanceSummary
            summary={summary}
            scopeType={scopeMode}
            loading={loading && !summary}
            variant="compact"
            detailsHref={
              groupId
                ? `/cabinet/journal/analytics?group=${groupId}`
                : studentId
                  ? `/cabinet/journal/analytics?student=${studentId}`
                  : ""
            }
          />
          <JournalLessonsTable
            scopeType={scopeMode}
            lessons={lessons}
            loading={loading}
            onOpenLesson={openLesson}
          />
        </div>
      )}
    </div>
  );
}
