import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchJournalGroup,
  fetchJournalStudent,
} from "../../utils/cabinetAuth";
import JournalPerformanceSummary from "../components/JournalPerformanceSummary";
import "../styles/journal.css";

/**
 * Подробная аналитика журнала — открывается в новой вкладке из компактной сводки.
 */
export default function CabinetJournalAnalyticsPage() {
  const [params] = useSearchParams();
  const groupId = params.get("group") ? Number(params.get("group")) : null;
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const scopeType = groupId ? "group" : "student";

  const [summary, setSummary] = useState(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!groupId && !studentId) {
      setLoading(false);
      setError("Не выбран ученик или группа");
      return undefined;
    }
    setLoading(true);
    setError("");
    (async () => {
      try {
        if (groupId) {
          const data = await fetchJournalGroup(groupId);
          if (cancelled) return;
          setSummary(data.summary || null);
          setTitle(data.group?.title || "Группа");
        } else {
          const data = await fetchJournalStudent(studentId);
          if (cancelled) return;
          setSummary(data.summary || null);
          setTitle(data.student?.full_name || "Ученик");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Не удалось загрузить сводку");
          setSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, studentId]);

  const backQuery = groupId
    ? `?group=${groupId}`
    : studentId
      ? `?student=${studentId}`
      : "";

  return (
    <div className="jg-page jg-page--analytics">
      <header className="jg-toolbar">
        <div className="jg-toolbar__title-block">
          <span className="jg-toolbar__eyebrow">Журнал · аналитика</span>
          <h1 className="jg-toolbar__title">{title || "Сводка"}</h1>
        </div>
        <Link className="jg-summary-compact__more" to={`/cabinet/journal${backQuery}`}>
          К таблице уроков
        </Link>
      </header>
      {error ? <div className="jl-error">{error}</div> : null}
      <div className="jg-page__content">
        <JournalPerformanceSummary
          summary={summary}
          scopeType={scopeType}
          loading={loading}
          variant="full"
        />
      </div>
    </div>
  );
}
