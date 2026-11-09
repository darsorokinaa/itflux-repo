import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SubjectCard from "../components/SubjectCard";
import NotFoundPage from "./NotFoundPage";
import { getLevelDef, levelLabel } from "../data/levels";
import {
  GRADES_BY_LEVEL,
  buildSubjectDefinition,
  type SubjectDefinition,
} from "../data/subjects";
import { fetchExamCatalog, type CatalogLevel } from "../utils/examCatalog";
import "../styles/tool-workspace.css";
import { trackValueGoal } from "../utils/valuePath";

type AvailabilityMap = Partial<Record<string, boolean>>;

type SubjectCatalogOverlay = Partial<
  Record<string, Pick<SubjectDefinition, "backgroundColor" | "backgroundImageUrl" | "title">>
>;

const EMPTY_GRADES: number[] = [];
const EMPTY_SUBJECTS: SubjectDefinition[] = [];

export default function SubjectPage() {
  const { level: levelParam } = useParams();
  const navigate = useNavigate();
  const levelStr = (levelParam || "").toLowerCase();

  const [catalogLevels, setCatalogLevels] = useState<CatalogLevel[]>([]);
  const [levelsReady, setLevelsReady] = useState(false);

  const knownLevelIds = useMemo(
    () => new Set(catalogLevels.map((item) => item.id)),
    [catalogLevels],
  );

  const level: string = knownLevelIds.has(levelStr)
    ? levelStr
    : (catalogLevels[0]?.id || levelStr || "oge");
  const levelParamIsInvalid = Boolean(levelParam) && levelsReady && !knownLevelIds.has(levelStr);
  const def = getLevelDef(level);

  const grades = (GRADES_BY_LEVEL as Record<string, number[]>)[level] ?? EMPTY_GRADES;
  const singleGrade = grades.length === 1;
  const catalogSubjectsForLevel = useMemo(
    () => catalogLevels.find((row) => row.id === level)?.subjects || [],
    [catalogLevels, level],
  );

  const [selectedClass, setSelectedClass] = useState<number | null>(() =>
    grades[0] ?? null,
  );
  const [advancedLevel, setAdvancedLevel] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [catalogOverlay, setCatalogOverlay] = useState<SubjectCatalogOverlay>({});
  const [catalogSubjectIds, setCatalogSubjectIds] = useState<string[]>([]);

  useEffect(() => {
    trackValueGoal("generator_opened", { level: levelStr || "subject" });
  }, [levelStr]);

  useEffect(() => {
    let cancelled = false;
    fetchExamCatalog()
      .then((rows) => {
        if (cancelled) return;
        setCatalogLevels(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalogLevels([]);
      })
      .finally(() => {
        if (!cancelled) setLevelsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextGrades = (GRADES_BY_LEVEL as Record<string, number[]>)[level] ?? EMPTY_GRADES;
    if (nextGrades.length === 0) {
      setSelectedClass(null);
      setAdvancedLevel(false);
      return;
    }
    setSelectedClass(nextGrades[0]);
    setAdvancedLevel(false);
  }, [level]);

  const countsQuery = useMemo(() => {
    if (level !== "vpr" || selectedClass == null) return "";
    const q = new URLSearchParams();
    q.set("grade", String(selectedClass));
    if (advancedLevel) q.set("advanced", "1");
    return `?${q.toString()}`;
  }, [level, selectedClass, advancedLevel]);

  const dashboardSubjects = useMemo(() => {
    const ids = catalogSubjectIds.length
      ? catalogSubjectIds
      : catalogSubjectsForLevel.map((s) => s.id);
    const titleById = new Map(catalogSubjectsForLevel.map((s) => [s.id, s.title]));

    return ids.map((id) => {
      const overlay = catalogOverlay[id];
      return buildSubjectDefinition(id, {
        title: overlay?.title || titleById.get(id),
        backgroundColor: overlay?.backgroundColor,
        backgroundImageUrl: overlay?.backgroundImageUrl,
        comingSoon: availability[id] === false,
      });
    });
  }, [availability, catalogOverlay, catalogSubjectIds, catalogSubjectsForLevel]);

  const orderedSubjects = dashboardSubjects.length ? dashboardSubjects : EMPTY_SUBJECTS;

  const isSubjectLocked = (subject: SubjectDefinition) => {
    if (availability[subject.id] === false) return true;
    if (availability[subject.id] === true) return false;
    return Boolean(subject.comingSoon);
  };

  useEffect(() => {
    let cancelled = false;
    setAvailability({});
    setCatalogOverlay({});
    setCatalogSubjectIds([]);
    if (!level || !levelsReady || !knownLevelIds.has(level)) return undefined;

    const loadCatalog = async () => {
      try {
        const catalogRes = await fetch(`/api/${level}/subject-catalog/${countsQuery}`, {
          credentials: "same-origin",
        });
        if (catalogRes.ok) {
          const data = await catalogRes.json();
          const subjects = Array.isArray(data?.subjects) ? data.subjects : [];
          const backgrounds =
            data?.backgrounds && typeof data.backgrounds === "object" ? data.backgrounds : {};
          const nextAvailability: AvailabilityMap = {};
          const nextOverlay: SubjectCatalogOverlay = {};
          const nextIds: string[] = [];

          const applyBackground = (id: string, source: Record<string, unknown>) => {
            const backgroundColor = String(source?.background_color || "").trim();
            const backgroundImageUrl = String(source?.background_image_url || "").trim();
            const title = String(source?.title || "").trim();
            if (backgroundColor || backgroundImageUrl || title) {
              nextOverlay[id] = {
                ...(nextOverlay[id] || {}),
                ...(backgroundColor ? { backgroundColor } : {}),
                ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
                ...(title ? { title } : {}),
              } as SubjectCatalogOverlay[string];
            }
          };

          for (const item of subjects) {
            const id = String(item?.id || "").trim().toLowerCase();
            if (!id) continue;
            nextIds.push(id);
            if (typeof item.is_available === "boolean") {
              nextAvailability[id] = item.is_available;
            }
            applyBackground(id, item as Record<string, unknown>);
          }

          for (const [id, source] of Object.entries(backgrounds)) {
            if (nextOverlay[id]) continue;
            applyBackground(id, source as Record<string, unknown>);
          }
          if (!cancelled) {
            setAvailability(nextAvailability);
            setCatalogOverlay(nextOverlay);
            setCatalogSubjectIds(nextIds);
          }
          return;
        }
      } catch {
        // keep catalog subjects from /api/catalog/
      }

      if (!cancelled) {
        setCatalogSubjectIds(catalogSubjectsForLevel.map((s) => s.id));
      }
    };

    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [level, countsQuery, levelsReady, knownLevelIds, catalogSubjectsForLevel]);

  const handleSubjectOpen = (subjectId: string) => {
    const subject = dashboardSubjects.find((item) => item.id === subjectId);
    if (!subject || isSubjectLocked(subject)) return;
    if (grades.length > 0 && selectedClass == null) return;
    const path = `/${level}/${subjectId}`;
    if (level === "vpr" && selectedClass != null) {
      const q = new URLSearchParams();
      q.set("grade", String(selectedClass));
      if (advancedLevel) q.set("advanced", "1");
      navigate(`${path}?${q.toString()}`);
      return;
    }
    navigate(path);
  };

  const handleLevelChange = (nextLevel: string) => {
    if (nextLevel === level) return;
    navigate(`/subject/${nextLevel}`);
  };

  if (levelParamIsInvalid) {
    return <NotFoundPage />;
  }

  const pageStyle = {
    "--subject-level-color": def?.bg || "#0F766E",
  } as CSSProperties;

  const leadText = singleGrade
    ? `Выберите предмет для ${grades[0]} класса — сразу откроются темы и номера заданий.`
    : grades.length > 0
      ? "Выберите класс и предмет — дальше темы, номера заданий и количество."
      : "Выберите предмет — дальше темы, номера заданий и количество.";
  const promoSteps = [
    "Выберите уровень в переключателе над карточками — список берётся из базы.",
    "Для ВПР можно выбрать класс и включить «Углублённый уровень».",
    "Нажмите на доступный предмет в сетке справа: карточки без заданий пока недоступны.",
  ];

  return (
    <div className="digital-flow-page" style={pageStyle}>
      <div className="digital-flow-page__wrap">
        <main className="subject-dashboard-page">
          <header className="subject-dashboard-page__header">
            <h1 className="subject-dashboard-page__title">Соберите вариант за несколько минут</h1>
            <p className="subject-dashboard-page__lead">{leadText}</p>
          </header>

          <div className="subject-dashboard-page__content">
            <aside className="subject-dashboard-page__promo" aria-label="Подсказка по работе с генератором">
              <span className="subject-dashboard-page__promo-tag">Подготовка к экзамену</span>
              <h2 className="subject-dashboard-page__promo-title">Как собрать вариант</h2>
              <p className="subject-dashboard-page__promo-lead">
                Выберите экзамен и предмет — откроются темы и номера заданий.
                Дальше можно собрать вариант из нужных заданий за несколько минут.
              </p>
              <ol className="subject-dashboard-page__promo-list">
                {promoSteps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </aside>

            <section className="subject-dashboard-page__subjects-panel" aria-label="Предметы">
              <div className="subject-dashboard-page__level-switch" aria-label="Выберите уровень подготовки">
                <p className="subject-dashboard-page__level-switch-label">Выберите уровень</p>
                <div className="subject-dashboard-page__level-switch-list" role="radiogroup">
                  {!levelsReady ? (
                    <span className="subject-dashboard-page__level-option">Загрузка…</span>
                  ) : catalogLevels.length === 0 ? (
                    <span className="subject-dashboard-page__level-option">
                      Уровни не найдены ({levelLabel(levelStr, levelStr)})
                    </span>
                  ) : (
                    catalogLevels.map((item) => {
                      const checked = level === item.id;
                      return (
                        <label
                          key={item.id}
                          className={
                            checked
                              ? `subject-dashboard-page__level-option subject-dashboard-page__level-option--${item.id} is-active`
                              : `subject-dashboard-page__level-option subject-dashboard-page__level-option--${item.id}`
                          }
                        >
                          <input
                            type="radio"
                            name="subject-level"
                            checked={checked}
                            onChange={() => handleLevelChange(item.id)}
                          />
                          <span>{item.label}</span>
                        </label>
                      );
                    })
                  )}
                </div>

                {level === "vpr" && !singleGrade ? (
                  <div className="subject-dashboard-page__vpr-inline" aria-label="Параметры школьной программы">
                    <span className="subject-dashboard-page__vpr-inline-title">Класс</span>
                    <div className="subject-dashboard-page__grade-list" role="list">
                      {grades.map((g) => {
                        const sel = selectedClass === g;
                        return (
                          <button
                            key={g}
                            type="button"
                            role="listitem"
                            className={
                              sel
                                ? "subject-dashboard-page__grade is-selected"
                                : "subject-dashboard-page__grade"
                            }
                            onClick={() => setSelectedClass(g)}
                          >
                            {g}
                            <span className="subject-dashboard-page__grade-suffix">класс</span>
                          </button>
                        );
                      })}
                    </div>
                    <label className="subject-dashboard-page__advanced">
                      <input
                        type="checkbox"
                        checked={advancedLevel}
                        onChange={(e) => setAdvancedLevel(e.target.checked)}
                      />
                      Углублённый уровень
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="subject-dashboard-page__subjects">
                {orderedSubjects.length === 0 && levelsReady ? (
                  <p className="subject-dashboard-page__empty">
                    Для этого уровня в базе пока нет предметов с заданиями.
                  </p>
                ) : (
                  orderedSubjects.map((s) => (
                    <SubjectCard
                      key={s.id}
                      subject={s}
                      locked={isSubjectLocked(s)}
                      onClick={() => handleSubjectOpen(s.id)}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
