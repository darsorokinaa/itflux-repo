import { useCallback, useEffect, useMemo, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";
import PlanItemCustomMaterialForm from "./PlanItemCustomMaterialForm";
import { getLessonOpenUrl, lessonSubjectLine } from "../lessonCardUtils";
import { buildLibraryLessonMaterialPayload } from "../planItemAttachments";
import { fetchInteractives, createTeacherMaterial } from "../../utils/cabinetAuth";
import { getInteractiveDisplayTitle } from "../interactivesData";

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function ResourcePickRow({ icon, title, meta, attached, disabled, onSelect }) {
  return (
    <button
      type="button"
      className={`cb-attach-item cb-plan-material-pick${attached ? " cb-plan-material-pick--attached" : ""}`}
      onClick={onSelect}
      disabled={disabled || attached}
    >
      <CabinetIcon name={icon} />
      <span className="cb-attach-item__body">
        <span className="cb-attach-item__title">{title}</span>
        {meta ? <span className="cb-attach-item__meta">{meta}</span> : null}
      </span>
      {attached ? <span className="cb-plan-material-pick__badge">Добавлен</span> : null}
    </button>
  );
}

const SCOPE_CONFIG = {
  lesson: {
    title: "Добавить на урок",
    hint: "Выберите готовый урок, интерактив, файлы или вариант по номеру.",
  },
  tasks: {
    title: "Добавить задание",
    hint: "Выберите готовый урок или введите номер варианта с платформы.",
  },
  homework: {
    title: "Добавить к домашнему заданию",
    hint: "К ДЗ можно добавить свой интерактив, файлы или вариант по номеру.",
  },
};

export default function PlanItemResourcesPicker({
  scope = "lesson",
  open,
  initialTab = "library",
  attachedMaterialIds = [],
  attachedInteractiveIds = [],
  onClose,
  onAttachMaterial,
  onAttachInteractive,
}) {
  const config = SCOPE_CONFIG[scope] || SCOPE_CONFIG.lesson;
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState("");
  const [interactives, setInteractives] = useState([]);
  const [libraryLessons, setLibraryLessons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const interactiveSet = useMemo(() => new Set(attachedInteractiveIds), [attachedInteractiveIds]);

  const loadInteractives = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const interactivesData = await fetchInteractives({ search: search.trim() || undefined });
      setInteractives(normalizeList(interactivesData));
    } catch (err) {
      setInteractives([]);
      setError(err?.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/lessons/", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Не удалось загрузить каталог уроков");
      const data = await res.json();
      const lessons = Array.isArray(data?.lessons) ? data.lessons : [];
      const query = search.trim().toLowerCase();
      setLibraryLessons(
        query
          ? lessons.filter((lesson) => {
            const hay = `${lesson.title || ""} ${lesson.topic || ""} ${lesson.subtopic || ""}`.toLowerCase();
            return hay.includes(query);
          })
          : lessons,
      );
    } catch (err) {
      setLibraryLessons([]);
      setError(err?.message || "Не удалось загрузить каталог уроков");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      if (tab === "interactives") loadInteractives();
      else if (tab === "library") loadLibrary();
    }, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [open, loadInteractives, loadLibrary, search, tab]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setTab(initialTab);
      setError("");
    }
  }, [open, initialTab]);

  const attachMaterial = async (payload) => {
    setSaving(true);
    setError("");
    try {
      const material = await createTeacherMaterial(payload);
      await onAttachMaterial?.(material);
    } catch (err) {
      setError(err?.message || "Не удалось добавить материал");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleInteractive = async (interactive) => {
    setSaving(true);
    setError("");
    try {
      await onAttachInteractive?.(interactive);
    } catch (err) {
      setError(err?.message || "Не удалось добавить интерактив");
    } finally {
      setSaving(false);
    }
  };

  const handleLibraryLesson = async (lesson) => {
    const payload = buildLibraryLessonMaterialPayload(lesson);
    if (!payload) {
      setError("Не удалось открыть выбранный урок");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const material = await createTeacherMaterial(payload);
      await onAttachMaterial?.(material);
    } catch (err) {
      setError(err?.message || "Не удалось прикрепить урок");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const customMode = tab === "file" || tab === "variant" ? tab : null;
  const tabs = scope === "lesson"
    ? [
      ["library", "Библиотека"],
      ["interactives", "Интерактивы"],
      ["file", "Файлы"],
      ["variant", "Вариант"],
    ]
    : scope === "tasks"
      ? [
        ["library", "База"],
        ["variant", "Вариант"],
      ]
      : [
        ["interactives", "Интерактивы"],
        ["file", "Файлы"],
        ["variant", "Вариант"],
      ];

  return (
    <CabinetModal title={config.title} onClose={onClose} wide>
      <p className="cabinet-auth-muted cb-plan-material-picker__hint">{config.hint}</p>
      <div className="cb-plan-material-picker__toolbar">
        <div className="cb-plan-material-picker__tabs cb-plan-material-picker__tabs--wrap" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`cb-plan-material-picker__tab${tab === id ? " is-active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {(tab === "interactives" || tab === "library") ? (
          <label className="cb-field cb-plan-material-picker__search">
            <span>Поиск</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "library" ? "Название или тема урока" : "Название интерактива"}
            />
          </label>
        ) : null}
      </div>

      {error && !customMode ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}

      {customMode ? (
        <PlanItemCustomMaterialForm
          mode={customMode}
          saving={saving}
          error={error}
          onSubmit={attachMaterial}
        />
      ) : loading ? (
        <p className="cabinet-auth-muted">Загрузка…</p>
      ) : tab === "library" ? (
        libraryLessons.length === 0 ? (
          <div className="cb-lesson-empty">
            <p>Готовые уроки не найдены</p>
          </div>
        ) : (
          <div className="cb-attach-list cb-plan-material-picker__list">
            {libraryLessons.map((lesson) => (
              <ResourcePickRow
                key={lesson.id || lesson.slug}
                icon="lessons"
                title={lesson.title}
                meta={lessonSubjectLine(lesson)}
                attached={false}
                disabled={saving || !getLessonOpenUrl(lesson)}
                onSelect={() => handleLibraryLesson(lesson)}
              />
            ))}
          </div>
        )
      ) : interactives.length === 0 ? (
        <div className="cb-lesson-empty">
          <p>У вас пока нет интерактивов</p>
          <p className="cabinet-auth-muted">Создайте интерактив в разделе «Интерактивы».</p>
        </div>
      ) : (
        <div className="cb-attach-list cb-plan-material-picker__list">
          {interactives.map((interactive) => (
            <ResourcePickRow
              key={interactive.id}
              icon="interactive"
              title={getInteractiveDisplayTitle({
                ...interactive,
                type: interactive.interactive_type || interactive.type,
              })}
              meta={interactive.interactive_type_label || interactive.interactiveTypeLabel || "Интерактив"}
              attached={interactiveSet.has(interactive.id)}
              disabled={saving}
              onSelect={() => handleInteractive(interactive)}
            />
          ))}
        </div>
      )}
    </CabinetModal>
  );
}
