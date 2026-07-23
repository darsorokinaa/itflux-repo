import { useEffect, useState } from "react";
import { fetchOwnStudentSubjects } from "../../utils/cabinetAuth";

const STORAGE_KEY = "cabinet.student.activeSubjectId";

export function getStoredStudentSubjectId() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredStudentSubjectId(id) {
  try {
    if (!id) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    /* ignore */
  }
}

/**
 * Compact subject switcher for student cabinet.
 * Hidden when there is 0–1 subject.
 */
export default function StudentSubjectTabs({ value, onChange, className = "" }) {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchOwnStudentSubjects()
      .then((d) => {
        if (cancelled) return;
        setSubjects(d?.items || []);
      })
      .catch(() => {
        if (!cancelled) setSubjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading || !subjects.length) return;
    if (value && subjects.some((s) => String(s.id) === String(value))) return;
    const stored = getStoredStudentSubjectId();
    if (stored && subjects.some((s) => String(s.id) === String(stored))) {
      onChange?.(stored);
      return;
    }
    if (subjects.length === 1) {
      onChange?.(String(subjects[0].id));
    }
  }, [loading, subjects, value, onChange]);

  if (loading || subjects.length <= 1) return null;

  const active = value || "";

  return (
    <div className={`st-subject-tabs ${className}`.trim()} role="tablist" aria-label="Предметы">
      <button
        type="button"
        role="tab"
        aria-selected={!active}
        className={`st-subject-tabs__btn${!active ? " st-subject-tabs__btn--active" : ""}`}
        onClick={() => {
          setStoredStudentSubjectId("");
          onChange?.("");
        }}
      >
        Все материалы
      </button>
      {subjects.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={String(active) === String(s.id)}
          className={`st-subject-tabs__btn${String(active) === String(s.id) ? " st-subject-tabs__btn--active" : ""}`}
          onClick={() => {
            setStoredStudentSubjectId(String(s.id));
            onChange?.(String(s.id));
          }}
        >
          {s.display_label || s.subject_label || s.subject}
        </button>
      ))}
    </div>
  );
}
