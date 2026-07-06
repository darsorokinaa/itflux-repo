import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import InteractiveEditorPreview from "../components/InteractiveEditorPreview";
import InteractiveEditorSettings from "../components/InteractiveEditorSettings";
import QuizEditor from "../components/QuizEditor";
import WheelEditor from "../components/WheelEditor";
import { CabinetPageShell } from "../CabinetSectionUi";
import { useInteractiveAppearanceCatalog } from "../interactiveAppearance";
import {
  createEmptyInteractive,
  getInteractiveDisplayTitle,
  isInteractiveTypeAvailable,
} from "../interactivesData";
import {
  buildInteractiveWritePayload,
  mapApiInteractiveDetail,
} from "../interactivesApi";
import {
  createInteractive,
  fetchInteractive,
  publishInteractive,
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
  index,
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

function FlashcardsEditor({ data, onCardsChange, openIndex, setOpenIndex, isMobile }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const updateCard = (index, field, value) => {
    const cards = [...data.cards];
    cards[index] = { ...cards[index], [field]: value };
    onCardsChange(cards);
  };

  const addCard = () => {
    onCardsChange([...data.cards, {
      front: "",
      back: "",
      front_image_url: "",
      back_image_url: "",
      hint: "",
      explanation: "",
    }]);
    setOpenIndex(data.cards.length);
  };

  const duplicateCard = (index) => {
    const cards = [...data.cards];
    cards.splice(index + 1, 0, { ...cards[index] });
    onCardsChange(cards);
    setOpenIndex(index + 1);
  };

  const removeCard = (index) => {
    if (data.cards.length <= 1) return;
    onCardsChange(data.cards.filter((_, i) => i !== index));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
  };

  const moveCard = (from, to) => {
    onCardsChange(reorderList(data.cards, from, to));
    setOpenIndex(to);
  };

  return (
    <section className="ix-ed-panel ix-ed-panel--work">
      <header className="ix-ed-panel__head ix-ed-panel__head--row">
        <div>
          <h2 className="ix-ed-panel__title">Карточки</h2>
          <p className="ix-ed-panel__hint">Главный рабочий блок: термины, ответы и пояснения.</p>
        </div>
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill" onClick={addCard}>
          + Добавить
        </button>
      </header>
      <div className="ix-ed-panel__body ix-ed-panel__body--stack">
        {data.cards.map((card, index) => {
          const summary = card.front && card.back
            ? `${card.front} → ${card.back}`
            : card.front || card.back || "Пустая карточка";
          const hint = card.hint ? `Подсказка: ${card.hint}` : "";
          return (
            <EditorItemShell
              key={index}
              index={index}
              title={`Карточка ${index + 1}`}
              summary={summary}
              hint={hint}
              open={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? -1 : index)}
              onDuplicate={() => duplicateCard(index)}
              onRemove={() => removeCard(index)}
              canRemove={data.cards.length > 1}
              onMoveUp={() => moveCard(index, index - 1)}
              onMoveDown={() => moveCard(index, index + 1)}
              canMoveUp={index > 0}
              canMoveDown={index < data.cards.length - 1}
              dragging={dragIndex === index}
              dragOver={overIndex === index && dragIndex !== index}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", String(index));
                e.dataTransfer.effectAllowed = "move";
                setDragIndex(index);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("text/plain"));
                moveCard(from, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              isMobile={isMobile}
            >
              <div className="ix-ed-fields">
                <label className="ix-ed-field">
                  <span>Лицевая сторона</span>
                  <input value={card.front} placeholder="Термин" onChange={(e) => updateCard(index, "front", e.target.value)} />
                </label>
                <label className="ix-ed-field">
                  <span>Картинка (лицевая)</span>
                  <input
                    value={card.front_image_url || ""}
                    placeholder="https://..."
                    onChange={(e) => updateCard(index, "front_image_url", e.target.value)}
                  />
                </label>
                <label className="ix-ed-field">
                  <span>Обратная сторона</span>
                  <input value={card.back} placeholder="Ответ" onChange={(e) => updateCard(index, "back", e.target.value)} />
                </label>
                <label className="ix-ed-field">
                  <span>Картинка (обратная)</span>
                  <input
                    value={card.back_image_url || ""}
                    placeholder="https://..."
                    onChange={(e) => updateCard(index, "back_image_url", e.target.value)}
                  />
                </label>
                <label className="ix-ed-field">
                  <span>Подсказка</span>
                  <input value={card.hint} placeholder="Необязательно" onChange={(e) => updateCard(index, "hint", e.target.value)} />
                </label>
                <label className="ix-ed-field ix-ed-field--wide">
                  <span>Пояснение</span>
                  <input value={card.explanation} placeholder="Необязательно" onChange={(e) => updateCard(index, "explanation", e.target.value)} />
                </label>
              </div>
            </EditorItemShell>
          );
        })}
      </div>
    </section>
  );
}

function MatchingEditor({ data, onPairsChange, openIndex, setOpenIndex, isMobile }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

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
    onPairsChange(data.pairs.filter((_, i) => i !== index));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
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
        {data.pairs.map((pair, index) => {
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
                <label className="ix-ed-field">
                  <span>Картинка слева</span>
                  <input
                    value={pair.left_image_url || ""}
                    placeholder="https://..."
                    onChange={(e) => updatePair(index, "left_image_url", e.target.value)}
                  />
                </label>
                <label className="ix-ed-field">
                  <span>Справа</span>
                  <input value={pair.right} onChange={(e) => updatePair(index, "right", e.target.value)} />
                </label>
                <label className="ix-ed-field">
                  <span>Картинка справа</span>
                  <input
                    value={pair.right_image_url || ""}
                    placeholder="https://..."
                    onChange={(e) => updatePair(index, "right_image_url", e.target.value)}
                  />
                </label>
                <label className="ix-ed-field ix-ed-field--wide">
                  <span>Пояснение</span>
                  <input value={pair.explanation} onChange={(e) => updatePair(index, "explanation", e.target.value)} />
                </label>
              </div>
            </EditorItemShell>
          );
        })}
      </div>
    </section>
  );
}

function SequenceEditor({ data, onStepsChange, openIndex, setOpenIndex, isMobile }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

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
    onStepsChange(data.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i + 1 })));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
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
    <section className="ix-ed-panel ix-ed-panel--work">
      <header className="ix-ed-panel__head ix-ed-panel__head--row">
        <div>
          <h2 className="ix-ed-panel__title">Порядок</h2>
          <p className="ix-ed-panel__hint">Шаги, которые ученик расставит по порядку.</p>
        </div>
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill" onClick={addStep}>
          + Добавить
        </button>
      </header>
      <div className="ix-ed-panel__body ix-ed-panel__body--stack">
        {data.steps.map((step, index) => (
          <EditorItemShell
            key={index}
            index={index}
            title={`Шаг ${index + 1}`}
            summary={step.text || "Пустой шаг"}
            open={openIndex === index}
            onToggle={() => setOpenIndex(openIndex === index ? -1 : index)}
            onDuplicate={() => duplicateStep(index)}
            onRemove={() => removeStep(index)}
            canRemove={data.steps.length > 1}
            onMoveUp={() => moveStep(index, index - 1)}
            onMoveDown={() => moveStep(index, index + 1)}
            canMoveUp={index > 0}
            canMoveDown={index < data.steps.length - 1}
            dragging={dragIndex === index}
            dragOver={overIndex === index && dragIndex !== index}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", String(index));
              setDragIndex(index);
            }}
            onDragOver={(e) => { e.preventDefault(); setOverIndex(index); }}
            onDrop={(e) => {
              e.preventDefault();
              moveStep(Number(e.dataTransfer.getData("text/plain")), index);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
            isMobile={isMobile}
          >
            <div className="ix-ed-fields">
              <label className="ix-ed-field ix-ed-field--wide">
                <span>Текст</span>
                <input value={step.text} onChange={(e) => updateStep(index, "text", e.target.value)} />
              </label>
              <label className="ix-ed-field ix-ed-field--wide">
                <span>Картинка</span>
                <input
                  value={step.image_url || ""}
                  placeholder="https://..."
                  onChange={(e) => updateStep(index, "image_url", e.target.value)}
                />
              </label>
              <label className="ix-ed-field">
                <span>Позиция</span>
                <input type="number" min={1} value={step.position} onChange={(e) => updateStep(index, "position", e.target.value)} />
              </label>
              <label className="ix-ed-field ix-ed-field--wide">
                <span>Пояснение</span>
                <input value={step.explanation} onChange={(e) => updateStep(index, "explanation", e.target.value)} />
              </label>
            </div>
          </EditorItemShell>
        ))}
      </div>
    </section>
  );
}

export default function CabinetInteractiveEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const isMobile = useMediaQuery("(max-width: 768px)");

  const newInteractive = useMemo(() => {
    if (isEdit) return null;
    if (!type || !["flashcards", "matching", "sequence", "quiz", "wheel"].includes(type)) return null;
    if (!isInteractiveTypeAvailable(type)) return null;
    return createEmptyInteractive(type);
  }, [isEdit, type]);

  const [data, setData] = useState(newInteractive);
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [openItemIndex, setOpenItemIndex] = useState(0);
  const { catalog } = useInteractiveAppearanceCatalog();

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
          if (!cancelled) setLoadError(err?.message || "Не удалось загрузить интерактив");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
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
      if (isEdit && current.id) {
        if (status === "published") {
          await updateInteractive(current.id, payload);
          apiData = await publishInteractive(current.id);
        } else {
          apiData = await updateInteractive(current.id, payload);
        }
      } else {
        apiData = await createInteractive(payload);
      }
      const next = mapApiInteractiveDetail(apiData);
      setData(next);
      setSaved(true);
      if (!isEdit) {
        navigate(`/cabinet/interactives/${next.id}/edit`, { replace: true });
      }
    } catch (err) {
      setPublishError(err?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }, [data, isEdit, navigate]);

  const autoSave = useCallback(async () => {
    const current = data;
    if (!current || saving) return;
    await persist(current.status || "draft");
  }, [data, persist, saving]);

  useAutoSave({
    enabled: Boolean(data) && !loading,
    isDirty: !saved,
    isSaving: saving,
    onSave: autoSave,
  });

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--interactive-editor ix-ed-page">
        <p className="cb-loading">Загрузка…</p>
      </CabinetPageShell>
    );
  }

  if (loadError) {
    return <Navigate to="/cabinet/interactives" replace state={{ error: loadError }} />;
  }

  if (!data) {
    return <Navigate to="/cabinet/interactives/new" replace />;
  }

  const subtitle = editorTypeSubtitle(data.type);

  const onChange = (field, value) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const onParamsChange = (params) => {
    setData((prev) => ({ ...prev, params }));
    setSaved(false);
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
    let targetId = isEdit ? data.id : null;
    if (!targetId) {
      setSaving(true);
      try {
        const apiData = await createInteractive(buildInteractiveWritePayload(data, "draft"));
        const next = mapApiInteractiveDetail(apiData);
        setData(next);
        targetId = next.id;
        navigate(`/cabinet/interactives/${targetId}/edit`, { replace: true });
      } catch (err) {
        setPublishError(err?.message || "Не удалось сохранить");
        return;
      } finally {
        setSaving(false);
      }
    }
    navigate(`/cabinet/interactives/${targetId}`);
  };

  return (
    <CabinetPageShell className="cb-section--interactive-editor ix-ed-page">
      <header className="ix-ed-topbar">
        <div className="ix-ed-topbar__left">
          <Link to="/cabinet/interactives" className="ix-ed-back">← Назад</Link>
          <div className="ix-ed-topbar__copy">
            <p className="ix-ed-topbar__title">{getInteractiveDisplayTitle(data)}</p>
            <p className="ix-ed-topbar__subtitle">
              Редактор интерактива · {subtitle}
            </p>
          </div>
        </div>
        <div className="ix-ed-topbar__actions ix-ed-topbar__actions--desktop">
          <button type="button" className="cb-btn cb-btn--ghost" onClick={goToLaunch} disabled={saving}>Предпросмотр</button>
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

      <div className="ix-ed-layout">
        <div className="ix-ed-layout__main">
          <InteractiveEditorSettings
            data={data}
            onChange={onChange}
            onParamsChange={onParamsChange}
            typeLocked
            onPublish={() => persist("published")}
            onUnpublish={() => persist("draft")}
          />

          {data.type === "flashcards" ? (
            <FlashcardsEditor
              data={data}
              onCardsChange={(cards) => onChange("cards", cards)}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
            />
          ) : null}
          {data.type === "matching" ? (
            <MatchingEditor
              data={data}
              onPairsChange={(pairs) => onChange("pairs", pairs)}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
            />
          ) : null}
          {data.type === "sequence" ? (
            <SequenceEditor
              data={data}
              onStepsChange={(steps) => onChange("steps", steps)}
              openIndex={openItemIndex}
              setOpenIndex={setOpenItemIndex}
              isMobile={isMobile}
            />
          ) : null}
          {data.type === "quiz" ? (
            <QuizEditor
              data={data}
              onQuestionsChange={(questions) => onChange("questions", questions)}
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
              EditorItemShell={EditorItemShell}
            />
          ) : null}

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
    </CabinetPageShell>
  );
}
