import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import InteractiveEditorPreview from "../components/InteractiveEditorPreview";
import AppearanceSettings from "../components/AppearanceSettings";
import FlashcardsEditor from "../components/FlashcardsEditor";
import {
  BuilderSection,
  InteractiveAdvancedSettings,
  InteractiveBasicSettings,
} from "../components/InteractiveEditorSettings";
import InteractiveImageField from "../components/InteractiveImageField";
import QuizEditor from "../components/QuizEditor";
import WheelEditor from "../components/WheelEditor";
import { CabinetPageShell } from "../CabinetSectionUi";
import { useInteractiveAppearanceCatalog } from "../interactiveAppearance";
import {
  INTERACTIVE_TYPE_LIST,
  createEmptyInteractive,
  getInteractiveDisplayTitle,
  getItemCount,
  getTypeMeta,
  isInteractiveTypeAvailable,
  switchInteractiveType,
} from "../interactivesData";
import {
  buildInteractiveWritePayload,
  mapApiInteractiveDetail,
  mergeInteractiveAfterSave,
} from "../interactivesApi";
import {
  createInteractive,
  fetchInteractive,
  publishInteractive,
  uploadInteractiveImage,
  updateInteractive,
} from "../../utils/cabinetAuth";
import {
  editorTypeSubtitle,
  reorderList,
} from "../interactivesEditorUtils";
import { wheelCanPublish, wheelPublishError } from "../wheelUtils";
import { useAutoSave } from "../hooks/useAutoSave";
import "../styles/interactives-catalog.css";
import "../styles/interactive-appearance.css";
import "../styles/interactive-editor.css";
import "../styles/interactive-wheel.css";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function EditorItemShell({
  title,
  summary,
  hint,
  open,
  onToggle,
  onDuplicate,
  onRemove,
  canRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragging,
  dragOver,
  isMobile = false,
  children,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={[
        "ix-ed-item",
        open ? "ix-ed-item--open" : "",
        dragging ? "ix-ed-item--dragging" : "",
        dragOver ? "ix-ed-item--over" : "",
      ].filter(Boolean).join(" ")}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="ix-ed-item__head">
        {!isMobile ? (
          <button
            type="button"
            className="ix-ed-item__drag"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            aria-label="Перетащить"
          >
            ⋮⋮
          </button>
        ) : null}
        <button type="button" className="ix-ed-item__toggle" onClick={onToggle}>
          <span className="ix-ed-item__chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="ix-ed-item__title">{title}</span>
          {!open ? (
            <span className="ix-ed-item__summary">{summary}</span>
          ) : null}
          {!open && hint ? (
            <span className="ix-ed-item__hint">{hint}</span>
          ) : null}
        </button>
        <div className="ix-ed-item__tools">
          {isMobile ? (
            <div className={`ix-ed-item__menu${menuOpen ? " is-open" : ""}`}>
              <button type="button" className="ix-ed-icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Меню">⋯</button>
              {menuOpen ? (
                <div className="ix-ed-item__menu-pop">
                  <button type="button" disabled={!canMoveUp} onClick={() => { onMoveUp(); setMenuOpen(false); }}>Выше</button>
                  <button type="button" disabled={!canMoveDown} onClick={() => { onMoveDown(); setMenuOpen(false); }}>Ниже</button>
                  <button type="button" onClick={() => { onDuplicate(); setMenuOpen(false); }}>Дублировать</button>
                  {canRemove ? (
                    <button type="button" className="danger" onClick={() => { onRemove(); setMenuOpen(false); }}>Удалить</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <button type="button" className="ix-ed-icon-btn" onClick={onDuplicate} aria-label="Дублировать">⧉</button>
              {canRemove ? (
                <button type="button" className="ix-ed-icon-btn ix-ed-icon-btn--danger" onClick={onRemove} aria-label="Удалить">×</button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {open ? <div className="ix-ed-item__body">{children}</div> : null}
    </div>
  );
}

function UndoRemoveToast({ label, onUndo, onDismiss }) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
    // Timer starts on mount; remount via key when a new item is removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ix-ed-undo-toast" role="status">
      <span>{label}</span>
      <button type="button" className="ix-ed-undo-toast__btn" onClick={onUndo}>
        Отменить
      </button>
    </div>
  );
}

function MatchingEditor({
  data,
  onPairsChange,
  onImageUpload,
  imageUploading,
  openIndex,
  setOpenIndex,
  isMobile,
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [undoRemove, setUndoRemove] = useState(null);

  const updatePair = (index, field, value) => {
    const pairs = [...data.pairs];
    pairs[index] = { ...pairs[index], [field]: value };
    onPairsChange(pairs);
  };

  const addPair = () => {
    onPairsChange([...data.pairs, {
      left: "",
      right: "",
      left_image_url: "",
      right_image_url: "",
      explanation: "",
    }]);
    setOpenIndex(data.pairs.length);
  };

  const removePair = (index) => {
    if (data.pairs.length <= 1) return;
    const item = data.pairs[index];
    onPairsChange(data.pairs.filter((_, i) => i !== index));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
    setUndoRemove({ item, index });
  };

  const restorePair = () => {
    if (!undoRemove) return;
    const pairs = [...data.pairs];
    pairs.splice(undoRemove.index, 0, undoRemove.item);
    onPairsChange(pairs);
    setOpenIndex(undoRemove.index);
    setUndoRemove(null);
  };

  const duplicatePair = (index) => {
    const pairs = [...data.pairs];
    pairs.splice(index + 1, 0, { ...pairs[index] });
    onPairsChange(pairs);
    setOpenIndex(index + 1);
  };

  const movePair = (from, to) => {
    onPairsChange(reorderList(data.pairs, from, to));
    setOpenIndex(to);
  };

  return (
    <section className="ix-ed-panel ix-ed-panel--work">
      <header className="ix-ed-panel__head ix-ed-panel__head--row">
        <div>
          <h2 className="ix-ed-panel__title">Пары</h2>
          <p className="ix-ed-panel__hint">Сопоставьте понятие и ответ.</p>
        </div>
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill" onClick={addPair}>
          + Добавить
        </button>
      </header>
      <div className="ix-ed-panel__body ix-ed-panel__body--stack">
        {(data.pairs || []).map((pair, index) => {
          const summary = pair.left && pair.right
            ? `${pair.left} ↔ ${pair.right}`
            : pair.left || pair.right || "Пустая пара";
          return (
            <EditorItemShell
              key={index}
              index={index}
              title={`Пара ${index + 1}`}
              summary={summary}
              open={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? -1 : index)}
              onDuplicate={() => duplicatePair(index)}
              onRemove={() => removePair(index)}
              canRemove={data.pairs.length > 1}
              onMoveUp={() => movePair(index, index - 1)}
              onMoveDown={() => movePair(index, index + 1)}
              canMoveUp={index > 0}
              canMoveDown={index < data.pairs.length - 1}
              dragging={dragIndex === index}
              dragOver={overIndex === index && dragIndex !== index}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", String(index));
                setDragIndex(index);
              }}
              onDragOver={(e) => { e.preventDefault(); setOverIndex(index); }}
              onDrop={(e) => {
                e.preventDefault();
                movePair(Number(e.dataTransfer.getData("text/plain")), index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              isMobile={isMobile}
            >
              <div className="ix-ed-fields">
                <label className="ix-ed-field">
                  <span>Слева</span>
                  <input value={pair.left} onChange={(e) => updatePair(index, "left", e.target.value)} />
                </label>
                <InteractiveImageField
                  label="Картинка слева"
                  value={pair.left_image_url || ""}
                  uploading={imageUploading}
                  onUpload={async (file) => {
                    const url = await onImageUpload(file);
                    updatePair(index, "left_image_url", url);
                  }}
                  onClear={() => updatePair(index, "left_image_url", "")}
                />
                <label className="ix-ed-field">
                  <span>Справа</span>
                  <input value={pair.right} onChange={(e) => updatePair(index, "right", e.target.value)} />
                </label>
                <InteractiveImageField
                  label="Картинка справа"
                  value={pair.right_image_url || ""}
                  uploading={imageUploading}
                  onUpload={async (file) => {
                    const url = await onImageUpload(file);
                    updatePair(index, "right_image_url", url);
                  }}
                  onClear={() => updatePair(index, "right_image_url", "")}
                />
                <label className="ix-ed-field ix-ed-field--wide">
                  <span>Пояснение</span>
                  <input value={pair.explanation} onChange={(e) => updatePair(index, "explanation", e.target.value)} />
                </label>
              </div>
            </EditorItemShell>
          );
        })}
      </div>
      {undoRemove ? (
        <UndoRemoveToast
          key={`pair-${undoRemove.index}-${undoRemove.item?.left || ""}`}
          label="Пара удалена"
          onUndo={restorePair}
          onDismiss={() => setUndoRemove(null)}
        />
      ) : null}
    </section>
  );
}

function SequenceEditor({
  data,
  onStepsChange,
  onImageUpload,
  imageUploading,
  openIndex,
  setOpenIndex,
  isMobile,
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [undoRemove, setUndoRemove] = useState(null);

  const updateStep = (index, field, value) => {
    const steps = [...data.steps];
    steps[index] = { ...steps[index], [field]: value };
    if (field === "position") steps[index].position = Number(value) || index + 1;
    onStepsChange(steps);
  };

  const addStep = () => {
    onStepsChange([...data.steps, {
      text: "",
      image_url: "",
      explanation: "",
      position: data.steps.length + 1,
    }]);
    setOpenIndex(data.steps.length);
  };

  const removeStep = (index) => {
    if (data.steps.length <= 1) return;
    const item = data.steps[index];
    onStepsChange(data.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i + 1 })));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
    setUndoRemove({ item, index });
  };

  const restoreStep = () => {
    if (!undoRemove) return;
    const steps = [...data.steps];
    steps.splice(undoRemove.index, 0, undoRemove.item);
    onStepsChange(steps.map((s, i) => ({ ...s, position: i + 1 })));
    setOpenIndex(undoRemove.index);
    setUndoRemove(null);
  };

  const duplicateStep = (index) => {
    const steps = [...data.steps];
    steps.splice(index + 1, 0, { ...steps[index], position: index + 2 });
    onStepsChange(steps.map((s, i) => ({ ...s, position: i + 1 })));
    setOpenIndex(index + 1);
  };

  const moveStep = (from, to) => {
    const next = reorderList(data.steps, from, to).map((s, i) => ({ ...s, position: i + 1 }));
    onStepsChange(next);
    setOpenIndex(to);
  };

  return (
    <BuilderSection
      title="Содержимое"
      hint="Правильная последовательность — ученик расставит шаги"
      meta={
        <>
          <span className="ix-builder-section__count">{(data.steps || []).length}</span>
          <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={addStep}>
            + Добавить
          </button>
        </>
      }
    >
      <div className="ix-card-list">
        {(data.steps || []).map((step, index) => (
          <article
            key={index}
            className={[
              "ix-card-row",
              openIndex === index ? "is-open" : "",
              dragIndex === index ? "is-dragging" : "",
              overIndex === index && dragIndex !== index ? "is-over" : "",
            ].filter(Boolean).join(" ")}
            onDragOver={(e) => { e.preventDefault(); setOverIndex(index); }}
            onDrop={(e) => {
              e.preventDefault();
              moveStep(Number(e.dataTransfer.getData("text/plain")), index);
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            <div className="ix-card-row__bar ix-sequence-row__bar">
              <span className="ix-sequence-row__num">{index + 1}</span>
              {!isMobile ? (
                <button
                  type="button"
                  className="ix-card-row__drag"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(index));
                    setDragIndex(index);
                  }}
                  onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  aria-label="Перетащить"
                >
                  ⋮⋮
                </button>
              ) : null}
              <input
                className="ix-wheel-row__input"
                value={step.text || ""}
                placeholder={`Этап ${index + 1}`}
                onChange={(e) => updateStep(index, "text", e.target.value)}
              />
              <div className="ix-card-row__actions">
                <button
                  type="button"
                  className="ix-card-row__edit"
                  onClick={() => setOpenIndex(openIndex === index ? -1 : index)}
                >
                  {openIndex === index ? "Свернуть" : "Ещё"}
                </button>
                <button
                  type="button"
                  className="ix-ed-icon-btn"
                  aria-label="Удалить"
                  disabled={data.steps.length <= 1}
                  onClick={() => removeStep(index)}
                >
                  ×
                </button>
              </div>
            </div>
            {openIndex === index ? (
              <div className="ix-card-row__editor">
                <div className="ix-ed-fields">
                  <InteractiveImageField
                    compact
                    label="Картинка"
                    value={step.image_url || ""}
                    uploading={imageUploading}
                    onUpload={async (file) => {
                      const url = await onImageUpload(file);
                      updateStep(index, "image_url", url);
                    }}
                    onClear={() => updateStep(index, "image_url", "")}
                  />
                  <label className="ix-ed-field ix-ed-field--wide">
                    <span>Пояснение</span>
                    <input value={step.explanation || ""} onChange={(e) => updateStep(index, "explanation", e.target.value)} />
                  </label>
                </div>
                <div className="ix-sequence-row__tools">
                  <button type="button" className="ix-ed-link-btn" onClick={() => duplicateStep(index)}>Дублировать</button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {undoRemove ? (
        <UndoRemoveToast
          key={`step-${undoRemove.index}-${undoRemove.item?.text || ""}`}
          label="Шаг удалён"
          onUndo={restoreStep}
          onDismiss={() => setUndoRemove(null)}
        />
      ) : null}
    </BuilderSection>
  );
}

const TYPE_SIDEBAR_ICONS = {
  wheel: "🎡",
  flashcards: "🃏",
  sequence: "🔢",
  quiz: "❓",
  matching: "🔗",
};

const DEFAULT_CREATE_TYPE = "wheel";

function InteractiveTypeSidebar({ currentType, onSelect, locked = false }) {
  return (
    <aside className="ix-ed-sidebar panel" aria-label="Тип интерактива">
      <div className="ix-ed-sidebar__scroll">
        <p className="ix-ed-sidebar__caption">Тип интерактива</p>
        {INTERACTIVE_TYPE_LIST.map((typeId) => {
          const meta = getTypeMeta(typeId);
          const available = isInteractiveTypeAvailable(typeId);
          const active = currentType === typeId;
          const disabled = locked || !available;
          return (
            <button
              key={typeId}
              type="button"
              className={`ix-ed-type-btn${active ? " is-active" : ""}${!available ? " is-soon" : ""}`}
              disabled={disabled && !active}
              aria-pressed={active}
              onClick={() => {
                if (disabled || active) return;
                onSelect(typeId);
              }}
            >
              <span className="ix-ed-type-btn__icon" aria-hidden="true">
                {TYPE_SIDEBAR_ICONS[typeId] || "✦"}
              </span>
              <span className="ix-ed-type-btn__copy">
                <strong>{meta.label}</strong>
                <span>{available ? meta.description : "Скоро"}</span>
              </span>
            </button>
          );
        })}
        {locked ? (
          <p className="ix-ed-sidebar__note">Тип зафиксирован для опубликованного интерактива</p>
        ) : null}
      </div>
    </aside>
  );
}

export default function CabinetInteractiveEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isNarrow = useMediaQuery("(max-width: 1100px)");

  const resolvedCreateType = useMemo(() => {
    if (isEdit) return null;
    const candidate = type && INTERACTIVE_TYPE_LIST.includes(type) ? type : DEFAULT_CREATE_TYPE;
    if (!isInteractiveTypeAvailable(candidate)) return DEFAULT_CREATE_TYPE;
    return candidate;
  }, [isEdit, type]);

  const newInteractive = useMemo(() => {
    if (isEdit || !resolvedCreateType) return null;
    return createEmptyInteractive(resolvedCreateType);
  }, [isEdit, resolvedCreateType]);

  const [data, setData] = useState(newInteractive);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [imageError, setImageError] = useState("");
  const [openItemIndex, setOpenItemIndex] = useState(0);
  const { catalog, loading: appearanceCatalogLoading } = useInteractiveAppearanceCatalog();
  /** Не сбрасывать форму при смене типа через сайдбар (URL :type обновляется сами). */
  const skipCreateTypeSyncRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (isEdit) {
      setLoading(true);
      setLoadError("");
      fetchInteractive(id)
        .then((apiData) => {
          if (!cancelled) {
            setData(mapApiInteractiveDetail(apiData));
            setOpenItemIndex(0);
            setSaved(true);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            if (import.meta.env.DEV) console.error("Interactive load failed:", err);
            setLoadError(err?.message || "Не удалось загрузить интерактив");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
    }
    if (skipCreateTypeSyncRef.current) {
      skipCreateTypeSyncRef.current = false;
      setLoading(false);
      return undefined;
    }
    setData(newInteractive);
    setOpenItemIndex(0);
    setSaved(true);
    setLoading(false);
    return undefined;
  }, [id, isEdit, newInteractive]);

  const persist = useCallback(async (status) => {
    setSaving(true);
    setPublishError("");
    try {
      const current = data;
      if (!current) return;
      const payload = buildInteractiveWritePayload(current, status || current.status);
      let apiData;
      const existingId = isEdit ? current.id : null;
      if (existingId) {
        if (status === "published") {
          await updateInteractive(existingId, payload);
          apiData = await publishInteractive(existingId);
        } else {
          apiData = await updateInteractive(existingId, payload);
        }
      } else {
        apiData = await createInteractive(payload);
      }
      const next = mergeInteractiveAfterSave(current, apiData);
      if (!next.id) {
        setPublishError("Сервер не вернул идентификатор интерактива. Обновите страницу и попробуйте снова.");
        return;
      }
      setData(next);
      setSaved(true);
      if (!isEdit || String(id) !== String(next.id)) {
        navigate(`/cabinet/interactives/${next.id}/edit`, { replace: true });
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error("Interactive save failed:", err);
      }
      setPublishError(err?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }, [data, id, isEdit, navigate]);

  const autoSave = useCallback(async () => {
    const current = data;
    if (!current || saving) return;
    await persist(current.status || "draft");
  }, [data, persist, saving]);

  useAutoSave({
    enabled: Boolean(data) && !loading && !loadError,
    isDirty: !saved,
    isSaving: saving,
    onSave: autoSave,
  });

  const onImageUpload = useCallback(async (file) => {
    if (!file) throw new Error("Файл не выбран");
    setImageUploading(true);
    setImageError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploaded = await uploadInteractiveImage(formData);
      const url = String(uploaded?.url || "").trim();
      if (!url) throw new Error("Сервер не вернул ссылку на файл");
      setSaved(false);
      return url;
    } catch (err) {
      const message = err?.message || "Не удалось загрузить изображение";
      setImageError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setImageUploading(false);
    }
  }, []);

  const retryLoad = useCallback(() => {
    if (!id) return;
    setLoadError("");
    setLoading(true);
    fetchInteractive(id)
      .then((apiData) => {
        setData(mapApiInteractiveDetail(apiData));
        setOpenItemIndex(0);
        setSaved(true);
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.error("Interactive load failed:", err);
        setLoadError(err?.message || "Не удалось загрузить интерактив");
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--interactive-editor ix-ed-page">
        <p className="cb-loading">Загрузка…</p>
      </CabinetPageShell>
    );
  }

  if (loadError) {
    return (
      <CabinetPageShell className="cb-section--interactive-editor ix-ed-page">
        <div className="ix-error" role="alert">
          <p className="ix-error__text">{loadError}</p>
          <div className="ix-error__actions">
            <button type="button" className="ix-error__retry" onClick={retryLoad}>
              Повторить
            </button>
            <Link to="/cabinet/interactives" className="ix-error__retry ix-error__retry--ghost">
              К списку
            </Link>
          </div>
        </div>
      </CabinetPageShell>
    );
  }

  if (!data) {
    return <Navigate to={`/cabinet/interactives/new/${DEFAULT_CREATE_TYPE}`} replace />;
  }

  const subtitle = editorTypeSubtitle(data.type);
  const typeLocked = isEdit && (data.status === "published" || data.status === "assigned");
  const isCreateFlow = !isEdit;

  const onChange = (field, value) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const onParamsChange = (params) => {
    setData((prev) => ({ ...prev, params }));
    setSaved(false);
  };

  const handleTypeSelect = (nextType) => {
    if (!nextType || nextType === data.type || typeLocked) return;
    if (!isInteractiveTypeAvailable(nextType)) return;
    const hasContent = getItemCount(data) > 1
      || Boolean(String(data.title || "").trim())
      || Boolean(String(data.topic || "").trim());
    if (hasContent) {
      const ok = window.confirm(
        "Сменить тип? Контент текущего формата будет сброшен, общие настройки сохранятся."
      );
      if (!ok) return;
    }
    setData((prev) => switchInteractiveType(prev, nextType));
    setOpenItemIndex(0);
    setSaved(false);
    setPublishError("");
    if (isCreateFlow) {
      skipCreateTypeSyncRef.current = true;
      navigate(`/cabinet/interactives/new/${nextType}`, { replace: true });
    }
  };

  const handlePublish = async () => {
    if (data.type === "wheel" && !wheelCanPublish(data)) {
      setPublishError(wheelPublishError(data));
      return;
    }
    setPublishError("");
    await persist("published");
  };

  const goToLaunch = async () => {
    let targetId = data?.id || (isEdit ? id : null);
    if (!targetId || String(targetId).startsWith("i")) {
      setSaving(true);
      try {
        const apiData = await createInteractive(buildInteractiveWritePayload(data, "draft"));
        const next = mergeInteractiveAfterSave(data, apiData);
        if (!next.id) {
          setPublishError("Сервер не вернул идентификатор интерактива");
          return;
        }
        setData(next);
        targetId = next.id;
        navigate(`/cabinet/interactives/${targetId}/edit`, { replace: true });
      } catch (err) {
        if (import.meta.env.DEV) console.error("Interactive preview save failed:", err);
        setPublishError(err?.message || "Не удалось сохранить");
        return;
      } finally {
        setSaving(false);
      }
    }
    navigate(`/cabinet/interactives/${targetId}`);
  };

  return (
    <CabinetPageShell className="cb-section--interactive-editor ix-ed-page ix-ed-page--builder">
      <div className="ix-builder-shell">
      <header className="ix-ed-topbar ix-ed-topbar--sticky">
        <div className="ix-ed-topbar__left">
          <Link to="/cabinet/interactives" className="ix-ed-back" aria-label="Назад">←</Link>
          <div className="ix-ed-topbar__copy">
            <p className="ix-ed-topbar__title">
              {isCreateFlow ? "Создание интерактива" : getInteractiveDisplayTitle(data)}
            </p>
            <p className="ix-ed-topbar__subtitle">
              {data.status === "published" || data.status === "assigned" ? "Опубликован" : "Черновик"}
              {" · "}
              {subtitle}
              {isCreateFlow && String(data.title || "").trim()
                ? ` · ${String(data.title).trim()}`
                : null}
            </p>
          </div>
        </div>
        <div className="ix-ed-topbar__actions ix-ed-topbar__actions--desktop">
          <button type="button" className="cb-btn cb-btn--ghost" onClick={goToLaunch} disabled={saving}>
            Предпросмотр
          </button>
          <button type="button" className="cb-btn cb-btn--outline" onClick={() => persist("draft")} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={handlePublish} disabled={saving}>
            {saving ? "…" : "Опубликовать"}
          </button>
        </div>
      </header>

      {saved ? <p className="ix-ed-saved" role="status">Сохранено</p> : null}
      {publishError ? <p className="ix-ed-error" role="alert">{publishError}</p> : null}
      {imageError ? <p className="ix-ed-error" role="alert">{imageError}</p> : null}

      {isNarrow ? (
        <div className="ix-ed-type-strip" role="tablist" aria-label="Тип интерактива">
          {INTERACTIVE_TYPE_LIST.map((typeId) => {
            const meta = getTypeMeta(typeId);
            const available = isInteractiveTypeAvailable(typeId);
            const active = data.type === typeId;
            return (
              <button
                key={typeId}
                type="button"
                role="tab"
                aria-selected={active}
                className={`ix-ed-type-chip${active ? " is-active" : ""}`}
                disabled={(typeLocked || !available) && !active}
                onClick={() => handleTypeSelect(typeId)}
              >
                {TYPE_SIDEBAR_ICONS[typeId] || "✦"} {meta.shortLabel || meta.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="ix-ed-layout ix-ed-layout--builder">
        {!isNarrow ? (
          <InteractiveTypeSidebar
            currentType={data.type}
            onSelect={handleTypeSelect}
            locked={typeLocked}
          />
        ) : null}

        <div className="ix-ed-layout__main">
          <InteractiveBasicSettings data={data} onChange={onChange} />

          {data.type === "flashcards" ? (
            <FlashcardsEditor
              data={data}
              onCardsChange={(cards) => onChange("cards", cards)}
              onImageUpload={onImageUpload}
              imageUploading={imageUploading}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
            />
          ) : null}
          {data.type === "matching" ? (
            <MatchingEditor
              data={data}
              onPairsChange={(pairs) => onChange("pairs", pairs)}
              onImageUpload={onImageUpload}
              imageUploading={imageUploading}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
            />
          ) : null}
          {data.type === "sequence" ? (
            <SequenceEditor
              data={data}
              onStepsChange={(steps) => onChange("steps", steps)}
              onImageUpload={onImageUpload}
              imageUploading={imageUploading}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
            />
          ) : null}
          {data.type === "quiz" ? (
            <QuizEditor
              data={data}
              onQuestionsChange={(questions) => onChange("questions", questions)}
              onImageUpload={onImageUpload}
              imageUploading={imageUploading}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
              EditorItemShell={EditorItemShell}
            />
          ) : null}
          {data.type === "wheel" ? (
            <WheelEditor
              data={data}
              onSegmentsChange={(segments) => onChange("segments", segments)}
              onSettingsChange={(wheelSettings) => onChange("wheelSettings", wheelSettings)}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
            />
          ) : null}

          <BuilderSection title="Оформление" hint="Фоны и стили из каталога сервера" collapsible defaultOpen>
            <AppearanceSettings
              data={data}
              onChange={onChange}
              catalog={catalog}
              catalogLoading={appearanceCatalogLoading}
              compact
              showTitle={false}
              showBackground
              showCardStyles
              showSounds={false}
            />
          </BuilderSection>

          <BuilderSection title="Звук" hint="Звуковые пакеты с сервера — только прослушивание в редакторе" collapsible defaultOpen={false}>
            <AppearanceSettings
              data={data}
              onChange={onChange}
              catalog={catalog}
              catalogLoading={appearanceCatalogLoading}
              compact
              showTitle={false}
              showBackground={false}
              showCardStyles={false}
              showSounds
            />
          </BuilderSection>

          <InteractiveAdvancedSettings
            data={data}
            onChange={onChange}
            onParamsChange={onParamsChange}
            onPublish={() => persist("published")}
            onUnpublish={() => persist("draft")}
          />

          {isMobile ? (
            <InteractiveEditorPreview data={data} catalog={catalog} />
          ) : null}
        </div>

        {!isMobile ? (
          <InteractiveEditorPreview data={data} catalog={catalog} />
        ) : null}
      </div>

      <div className="ix-ed-mobile-bar">
        <button type="button" className="cb-btn cb-btn--outline" onClick={() => persist("draft")} disabled={saving}>
          {saving ? "…" : "Сохранить"}
        </button>
        <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={handlePublish} disabled={saving}>
          {saving ? "…" : "Опубликовать"}
        </button>
      </div>
      </div>
    </CabinetPageShell>
  );
}
