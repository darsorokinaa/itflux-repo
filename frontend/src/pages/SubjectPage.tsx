import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SubjectCard from "../components/SubjectCard";
import ScientistQuoteBanner from "../components/ScientistQuoteBanner";
import NotFoundPage from "./NotFoundPage";
import { getLevelDef, isLevelId, type LevelId } from "../data/levels";
import {
  GRADES_BY_LEVEL,
  SUBJECTS_BY_LEVEL,
  type SubjectDefinition,
  type SubjectId,
} from "../data/subjects";
import { formatTasksCount } from "../utils/formatTasksCount";

type CountMap = Partial<Record<SubjectId, number>>;

export default function SubjectPage() {
  const { level: levelParam } = useParams();
  const navigate = useNavigate();
  const levelStr = (levelParam || "").toLowerCase();

  const level: LevelId | null = isLevelId(levelStr) ? levelStr : null;
  const def = level ? getLevelDef(level) : undefined;

  const grades = level ? GRADES_BY_LEVEL[level] : [];
  const subjects = level ? SUBJECTS_BY_LEVEL[level] : [];
  const singleGrade = grades.length === 1;

  const [selectedClass, setSelectedClass] = useState<number | null>(() =>
    level ? GRADES_BY_LEVEL[level][0] ?? null : null,
  );
  const [selectedSubject, setSelectedSubject] = useState<SubjectId | null>(null);
  const [advancedLevel, setAdvancedLevel] = useState(false);
  const [counts, setCounts] = useState<CountMap>({});
  const [countsLoading, setCountsLoading] = useState(true);

  useEffect(() => {
    if (!level) return;
    const g = GRADES_BY_LEVEL[level];
    if (g.length === 0) return;
    setSelectedClass(g[0]);
    setSelectedSubject(null);
    setAdvancedLevel(false);
  }, [level]);

  const countsQuery = useMemo(() => {
    if (!level) return "";
    if (level !== "vpr" || selectedClass == null) return "";
    const p = new URLSearchParams();
    p.set("grade", String(selectedClass));
    p.set("advanced", advancedLevel ? "1" : "0");
    return `?${p.toString()}`;
  }, [level, selectedClass, advancedLevel]);

  useEffect(() => {
    if (!level) return;
    let cancelled = false;
    setCounts({});
    setCountsLoading(true);
    const url = `/api/${level}/subject-task-counts/${countsQuery}`;
    fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, number>) => {
        if (cancelled || !data || typeof data !== "object") return;
        const next: CountMap = {};
        for (const k of Object.keys(data)) {
          if (typeof data[k] === "number") {
            next[k as SubjectId] = data[k];
          }
        }
        setCounts(next);
      })
      .catch(() => {
        if (!cancelled) setCounts({});
      })
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [level, countsQuery]);

  const countLabelFor = (s: SubjectDefinition) => {
    if (s.comingSoon) return "скоро";
    if (countsLoading) return "…";
    const n = counts[s.id];
    if (typeof n === "number") return formatTasksCount(n);
    return "–";
  };

  const selectedSubjectDef =
    selectedSubject != null ? subjects.find((x) => x.id === selectedSubject) : undefined;

  const canContinue =
    selectedClass != null &&
    selectedSubject != null &&
    !!selectedSubjectDef &&
    !selectedSubjectDef.comingSoon;

  const handleContinue = () => {
    if (!level || !canContinue || !selectedSubject) return;
    const path = `/${level}/${selectedSubject}`;
    if (level === "vpr" && selectedClass != null) {
      const q = new URLSearchParams();
      q.set("grade", String(selectedClass));
      if (advancedLevel) q.set("advanced", "1");
      navigate(`${path}?${q.toString()}`);
      return;
    }
    navigate(path);
  };

  if (!level || !def) {
    return <NotFoundPage />;
  }

  const pageStyle = {
    "--subject-level-color": def.bg,
  } as CSSProperties;

  const leadText = singleGrade
    ? `Выбери предмет — откроется банк заданий · ${grades[0]} класс`
    : "Выбери класс и предмет — откроется банк заданий";

  return (
    <div className="digital-flow-page" style={pageStyle}>
      <div className="digital-flow-page__wrap">
        <main className="subject-pick">
          <div className="subject-pick__top">
            <button
              type="button"
              className="subject-pick__back"
              onClick={() => navigate("/")}
            >
              ← На главную
            </button>
            <span className="subject-pick__badge">{def.badgeLabel}</span>
          </div>

          <header className="section-head section-head--page">
            <h1 className="section-head__title">{def.fullTitle}</h1>
            <p className="section-head__lead">{leadText}</p>
          </header>

          {!singleGrade ? (
            <section className="subject-pick__grades" aria-label="Класс">
              <p className="subject-pick__grades-label">Класс</p>
              <div className="subject-pick__grade-list" role="list">
                {grades.map((g) => {
                  const sel = selectedClass === g;
                  return (
                    <button
                      key={g}
                      type="button"
                      role="listitem"
                      className={
                        sel
                          ? "subject-pick-grade subject-pick-grade--selected"
                          : "subject-pick-grade"
                      }
                      onClick={() => setSelectedClass(g)}
                    >
                      {g}
                      <span className="subject-pick-grade__suffix">класс</span>
                    </button>
                  );
                })}
              </div>

              {level === "vpr" ? (
                <label className="subject-pick__advanced">
                  <input
                    type="checkbox"
                    checked={advancedLevel}
                    onChange={(e) => setAdvancedLevel(e.target.checked)}
                  />
                  Углублённый уровень
                </label>
              ) : null}
            </section>
          ) : null}

          <ScientistQuoteBanner />

          <section
            className="subject-pick__subjects home-levels-grid"
            aria-label="Предметы"
          >
            {subjects.map((s) => (
              <SubjectCard
                key={s.id}
                subject={s}
                countLabel={countLabelFor(s)}
                selectedSubjectId={selectedSubject}
                onClick={() => setSelectedSubject(s.id)}
              />
            ))}
          </section>

          <div className="subject-pick__actions">
            <button
              type="button"
              className="subject-pick__cta"
              disabled={!canContinue}
              onClick={handleContinue}
            >
              Перейти к заданиям
              {canContinue ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              ) : null}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
