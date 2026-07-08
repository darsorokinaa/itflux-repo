import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SubjectCard from "../components/SubjectCard";
import NotFoundPage from "./NotFoundPage";
import { getLevelDef, isLevelId, type LevelId } from "../data/levels";
import {
  GRADES_BY_LEVEL,
  SUBJECTS_BY_LEVEL,
  type SubjectDefinition,
} from "../data/subjects";
import "../styles/tool-workspace.css";

type AvailabilityMap = Partial<Record<string, boolean>>;

type SubjectCatalogOverlay = Partial<
  Record<string, Pick<SubjectDefinition, "backgroundColor" | "backgroundImageUrl">>
>;

export default function SubjectPage() {
  const { level: levelParam } = useParams();
  const navigate = useNavigate();
  const levelStr = (levelParam || "").toLowerCase();

  const level: LevelId = isLevelId(levelStr) ? levelStr : "oge";
  const levelParamIsInvalid = Boolean(levelParam) && !isLevelId(levelStr);
  const def = getLevelDef(level);

  const grades = GRADES_BY_LEVEL[level];
  const subjects = SUBJECTS_BY_LEVEL[level];
  const singleGrade = grades.length === 1;

  const [selectedClass, setSelectedClass] = useState<number | null>(() =>
    level ? GRADES_BY_LEVEL[level][0] ?? null : null,
  );
  const [advancedLevel, setAdvancedLevel] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [catalogOverlay, setCatalogOverlay] = useState<SubjectCatalogOverlay>({});

  useEffect(() => {
    const g = GRADES_BY_LEVEL[level];
    if (g.length === 0) return;
    setSelectedClass(g[0]);
    setAdvancedLevel(false);
  }, [level]);

  const dashboardSubjects = useMemo(
    () =>
      subjects.map((subject) => {
        const overlay = catalogOverlay[subject.id];
        if (!overlay) return subject;
        return {
          ...subject,
          ...(overlay.backgroundColor ? { backgroundColor: overlay.backgroundColor } : {}),
          ...(overlay.backgroundImageUrl ? { backgroundImageUrl: overlay.backgroundImageUrl } : {}),
        };
      }),
    [subjects, catalogOverlay],
  );

  const isSubjectLocked = (subject: SubjectDefinition) => {
    const endpointValue = availability[subject.id];
    if (typeof endpointValue === "boolean") {
      return !endpointValue;
    }
    return Boolean(subject.comingSoon);
  };

  const orderedSubjects = useMemo(() => {
    const list = [...dashboardSubjects];
    const inf = list.find((s) => s.id === "inf");
    const rest = list.filter((s) => s.id !== "inf");

    const available = rest.filter((s) => !isSubjectLocked(s));
    const lockedSorted = rest
      .filter((s) => isSubjectLocked(s))
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));

    return inf ? [inf, ...available, ...lockedSorted] : [...available, ...lockedSorted];
  }, [dashboardSubjects, availability]);

  const countsQuery = useMemo(() => {
    if (!level) return "";
    if (level !== "vpr" || selectedClass == null) return "";
    const p = new URLSearchParams();
    p.set("grade", String(selectedClass));
    p.set("advanced", advancedLevel ? "1" : "0");
    return `?${p.toString()}`;
  }, [level, selectedClass, advancedLevel]);

  useEffect(() => {
    let cancelled = false;
    setAvailability({});
    setCatalogOverlay({});
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

          const applyBackground = (id: string, source: Record<string, unknown>) => {
            const backgroundColor = String(source?.background_color || "").trim();
            const backgroundImageUrl = String(source?.background_image_url || "").trim();
            if (backgroundColor || backgroundImageUrl) {
              nextOverlay[id] = {
                ...(backgroundColor ? { backgroundColor } : {}),
                ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
              };
            }
          };

          for (const item of subjects) {
            const id = String(item?.id || "");
            if (!id) continue;
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
          }
          return;
        }
      } catch {
        // fallback to legacy endpoint below
      }

      try {
        await fetch(`/api/${level}/subject-task-counts/${countsQuery}`, {
          credentials: "same-origin",
        });
      } catch {
        if (!cancelled) {
          setAvailability({});
          setCatalogOverlay({});
        }
      }
    };

    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [level, countsQuery]);

  const handleSubjectOpen = (subjectId: string) => {
    if (selectedClass == null) return;
    const subject = dashboardSubjects.find((item) => item.id === subjectId);
    if (!subject || isSubjectLocked(subject)) return;
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

  const handleLevelChange = (nextLevel: LevelId) => {
    if (nextLevel === level) return;
    navigate(`/subject/${nextLevel}`);
  };

  if (levelParamIsInvalid) {
    return <NotFoundPage />;
  }

  const pageStyle = {
    "--subject-level-color": def.bg,
  } as CSSProperties;

  const leadText = singleGrade
    ? `Выберите предмет для ${grades[0]} класса и переходите к настройке варианта.`
    : "Сначала выберите класс, затем предмет и переходите к заданиям.";
  const promoSteps = [
    "Выберите уровень в переключателе над карточками: ОГЭ, ЕГЭ или школьная программа.",
    "Для школьной программы можно выбрать класс и включить «Углублённый уровень».",
    "Нажмите на доступный предмет в сетке справа: карточки «Скоро» пока не открываются.",
  ];

  return (
    <div className="digital-flow-page" style={pageStyle}>
      <div className="digital-flow-page__wrap">
        <main className="subject-dashboard-page">
          <header className="subject-dashboard-page__header">
            <h1 className="subject-dashboard-page__title">Выбор предмета</h1>
            <p className="subject-dashboard-page__lead">{leadText}</p>
          </header>

          <div className="subject-dashboard-page__content">
            <aside className="subject-dashboard-page__promo" aria-label="Подсказка по работе с генератором">
              <span className="subject-dashboard-page__promo-tag">Подготовка к экзамену</span>
              <h2 className="subject-dashboard-page__promo-title">Как выбрать уровень и предмет</h2>
              <p className="subject-dashboard-page__promo-lead">
                Сначала переключите уровень подготовки, затем выберите предмет.
                После клика откроется экран с заданиями по выбранному направлению.
              </p>
              <ol className="subject-dashboard-page__promo-list">
                {promoSteps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </aside>

            <section className="subject-dashboard-page__subjects-panel" aria-label="Предметы">
              <div className="subject-dashboard-page__level-switch" aria-label="Уровень подготовки">
                <p className="subject-dashboard-page__level-switch-label">Уровень подготовки</p>
                <div className="subject-dashboard-page__level-switch-list" role="radiogroup">
                  {([
                    { id: "oge", label: "ОГЭ" },
                    { id: "ege", label: "ЕГЭ" },
                    { id: "vpr", label: "Школьная программа" },
                  ] as Array<{ id: LevelId; label: string }>).map((item) => {
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
                  })}
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
                {orderedSubjects.map((s) => (
                  <SubjectCard
                    key={s.id}
                    subject={s}
                    locked={isSubjectLocked(s)}
                    onClick={() => handleSubjectOpen(s.id)}
                  />
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
