import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import InteractivePlayer from "../components/InteractivePlayer";
import { CabinetPageShell } from "../CabinetSectionUi";
import {
  appearancePageClass,
  appearancePageStyle,
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../interactiveAppearance";
import {
  ACCESS_OPTIONS,
  DIFFICULTY_OPTIONS,
  EXAM_OPTIONS,
  createEmptyInteractive,
  getInteractiveById,
  getStatusMeta,
  getTypeMeta,
  upsertInteractive,
} from "../interactivesData";
import "../styles/interactives-catalog.css";
import "../styles/interactive-appearance.css";
import "../styles/interactive-launch.css";

function EditorAccordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ix-editor-accordion">
      <button type="button" className="ix-editor-accordion__head" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="ix-editor-accordion__body">{children}</div> : null}
    </div>
  );
}

function CommonFields({ data, onChange }) {
  return (
    <div className="cb-interactive-editor__common">
      <h2 className="cb-interactive-editor__section-title">Настройки</h2>
      <div className="ix-editor-compact-grid">
        <label className="cb-field">
          <span>Тип</span>
          <input value={getTypeMeta(data.type).label} readOnly disabled />
        </label>
        <label className="cb-field">
          <span>Предмет</span>
          <input value={data.subject} onChange={(e) => onChange("subject", e.target.value)} />
        </label>
        <label className="cb-field">
          <span>Экзамен</span>
          <select value={data.exam} onChange={(e) => onChange("exam", e.target.value)}>
            {EXAM_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <label className="cb-field">
          <span>Тема</span>
          <input value={data.topic} onChange={(e) => onChange("topic", e.target.value)} />
        </label>
        <label className="cb-field">
          <span>Сложность</span>
          <select value={data.difficulty} onChange={(e) => onChange("difficulty", e.target.value)}>
            {DIFFICULTY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <label className="cb-field">
          <span>Статус</span>
          <select value={data.status} onChange={(e) => onChange("status", e.target.value)}>
            <option value="draft">Черновик</option>
            <option value="published">Опубликован</option>
          </select>
        </label>
        <label className="cb-field">
          <span>Доступ</span>
          <select value={data.access} onChange={(e) => onChange("access", e.target.value)}>
            {ACCESS_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
        </label>
      </div>
      <EditorAccordion title="Дополнительно">
        <div className="ix-editor-compact-grid">
          <label className="cb-field">
            <span>Подтема</span>
            <input value={data.subtopic} onChange={(e) => onChange("subtopic", e.target.value)} />
          </label>
          <label className="cb-field">
            <span>№ задания</span>
            <input value={data.taskNumber} onChange={(e) => onChange("taskNumber", e.target.value)} />
          </label>
          <label className="cb-field cb-field--wide">
            <span>Инструкция для ученика</span>
            <textarea rows={2} value={data.instruction} onChange={(e) => onChange("instruction", e.target.value)} placeholder="Короткая подсказка перед началом" />
          </label>
        </div>
      </EditorAccordion>
    </div>
  );
}

function FlashcardItem({ card, index, onUpdate, onDuplicate, onRemove, canRemove }) {
  const [open, setOpen] = useState(!(card.front || card.back));
  const summary = card.front && card.back
    ? `${card.front} → ${card.back}`
    : card.front || card.back || `Карточка ${index + 1}`;

  return (
    <div className={`ix-item-card${open ? " ix-item-card--open" : ""}`}>
      <div className="ix-item-card__head">
        <button type="button" className="ix-item-card__toggle" onClick={() => setOpen((v) => !v)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="ix-item-card__summary">{summary}</span>
        </button>
        <div className="cb-session-editor__tools">
          <button type="button" className="cb-icon-btn" onClick={() => onDuplicate(index)} aria-label="Дублировать">⧉</button>
          {canRemove ? (
            <button type="button" className="cb-icon-btn cb-icon-btn--danger" onClick={() => onRemove(index)} aria-label="Удалить">×</button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="ix-editor-compact-grid">
          <label className="cb-field">
            <span>Лицевая сторона</span>
            <input value={card.front} placeholder="Введите термин" onChange={(e) => onUpdate(index, "front", e.target.value)} />
          </label>
          <label className="cb-field">
            <span>Обратная сторона</span>
            <input value={card.back} placeholder="Введите ответ" onChange={(e) => onUpdate(index, "back", e.target.value)} />
          </label>
          <label className="cb-field">
            <span>Подсказка</span>
            <input value={card.hint} placeholder="Подсказка" onChange={(e) => onUpdate(index, "hint", e.target.value)} />
          </label>
          <label className="cb-field">
            <span>Пояснение</span>
            <input value={card.explanation} placeholder="Пояснение" onChange={(e) => onUpdate(index, "explanation", e.target.value)} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function FlashcardsEditor({ data, onCardsChange }) {
  const updateCard = (index, field, value) => {
    const cards = [...data.cards];
    cards[index] = { ...cards[index], [field]: value };
    onCardsChange(cards);
  };

  const addCard = () => onCardsChange([...data.cards, { front: "", back: "", hint: "", explanation: "" }]);
  const duplicateCard = (index) => {
    const cards = [...data.cards];
    cards.splice(index + 1, 0, { ...cards[index] });
    onCardsChange(cards);
  };
  const removeCard = (index) => {
    if (data.cards.length <= 1) return;
    onCardsChange(data.cards.filter((_, i) => i !== index));
  };

  return (
    <div className="cb-interactive-editor__type">
      <h2 className="cb-interactive-editor__section-title">Карточки</h2>
      {data.cards.map((card, index) => (
        <FlashcardItem
          key={index}
          card={card}
          index={index}
          onUpdate={updateCard}
          onDuplicate={duplicateCard}
          onRemove={removeCard}
          canRemove={data.cards.length > 1}
        />
      ))}
      <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={addCard}>Добавить</button>
    </div>
  );
}

function MatchingEditor({ data, onChange, onPairsChange }) {
  const updatePair = (index, field, value) => {
    const pairs = [...data.pairs];
    pairs[index] = { ...pairs[index], [field]: value };
    onPairsChange(pairs);
  };
  const addPair = () => onPairsChange([...data.pairs, { left: "", right: "", explanation: "" }]);
  const removePair = (index) => {
    if (data.pairs.length <= 1) return;
    onPairsChange(data.pairs.filter((_, i) => i !== index));
  };

  return (
    <div className="cb-interactive-editor__type">
      <h2 className="cb-interactive-editor__section-title">Пары</h2>
      <div className="cb-interactive-editor__toggles">
        <label className="cb-toggle">
          <input type="checkbox" checked={data.shufflePairs} onChange={(e) => onChange("shufflePairs", e.target.checked)} />
          <span>Перемешивать</span>
        </label>
        <label className="cb-toggle">
          <input type="checkbox" checked={data.showResultImmediately} onChange={(e) => onChange("showResultImmediately", e.target.checked)} />
          <span>Результат сразу</span>
        </label>
      </div>
      {data.pairs.map((pair, index) => (
        <div key={index} className="ix-item-card">
          <div className="ix-item-card__head">
            <span>Пара {index + 1}</span>
            <button type="button" className="cb-icon-btn cb-icon-btn--danger" onClick={() => removePair(index)} aria-label="Удалить">×</button>
          </div>
          <div className="ix-editor-compact-grid">
            <label className="cb-field">
              <span>Слева</span>
              <input value={pair.left} onChange={(e) => updatePair(index, "left", e.target.value)} />
            </label>
            <label className="cb-field">
              <span>Справа</span>
              <input value={pair.right} onChange={(e) => updatePair(index, "right", e.target.value)} />
            </label>
            <label className="cb-field cb-field--wide">
              <span>Пояснение</span>
              <input value={pair.explanation} onChange={(e) => updatePair(index, "explanation", e.target.value)} />
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={addPair}>Добавить</button>
    </div>
  );
}

function SequenceEditor({ data, onChange, onStepsChange }) {
  const updateStep = (index, field, value) => {
    const steps = [...data.steps];
    steps[index] = { ...steps[index], [field]: value };
    if (field === "position") steps[index].position = Number(value) || index + 1;
    onStepsChange(steps);
  };
  const addStep = () => onStepsChange([...data.steps, { text: "", explanation: "", position: data.steps.length + 1 }]);
  const removeStep = (index) => {
    if (data.steps.length <= 1) return;
    onStepsChange(data.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i + 1 })));
  };

  return (
    <div className="cb-interactive-editor__type">
      <h2 className="cb-interactive-editor__section-title">Порядок</h2>
      <div className="cb-interactive-editor__toggles">
        <label className="cb-toggle">
          <input type="checkbox" checked={data.allowMultipleAttempts} onChange={(e) => onChange("allowMultipleAttempts", e.target.checked)} />
          <span>Несколько попыток</span>
        </label>
        <label className="cb-toggle">
          <input type="checkbox" checked={data.showAnswerOnError} onChange={(e) => onChange("showAnswerOnError", e.target.checked)} />
          <span>Ответ при ошибке</span>
        </label>
      </div>
      {data.steps.map((step, index) => (
        <div key={index} className="ix-item-card">
          <div className="ix-item-card__head">
            <span>Шаг {index + 1}</span>
            <button type="button" className="cb-icon-btn cb-icon-btn--danger" onClick={() => removeStep(index)} aria-label="Удалить">×</button>
          </div>
          <div className="ix-editor-compact-grid">
            <label className="cb-field cb-field--wide">
              <span>Текст</span>
              <input value={step.text} onChange={(e) => updateStep(index, "text", e.target.value)} />
            </label>
            <label className="cb-field">
              <span>Позиция</span>
              <input type="number" min={1} value={step.position} onChange={(e) => updateStep(index, "position", e.target.value)} />
            </label>
            <label className="cb-field cb-field--wide">
              <span>Пояснение</span>
              <input value={step.explanation} onChange={(e) => updateStep(index, "explanation", e.target.value)} />
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={addStep}>Добавить</button>
    </div>
  );
}

export default function CabinetInteractiveEditorPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const initial = useMemo(() => {
    if (isEdit) {
      const existing = getInteractiveById(id);
      return existing ? { ...existing } : null;
    }
    if (type && ["flashcards", "matching", "sequence"].includes(type)) {
      return createEmptyInteractive(type);
    }
    return null;
  }, [id, isEdit, type]);

  const [data, setData] = useState(initial);
  const [saved, setSaved] = useState(false);
  const { catalog } = useInteractiveAppearanceCatalog();
  const previewAppearance = useMemo(
    () => resolveInteractiveAppearance(data, catalog),
    [data, catalog],
  );

  useEffect(() => {
    setData(initial);
  }, [initial]);

  if (!data) {
    return <Navigate to="/cabinet/interactives/new" replace />;
  }

  const statusMeta = getStatusMeta(data.status);

  const onChange = (field, value) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const persist = (status) => {
    const next = {
      ...data,
      status: status || data.status,
      updatedAt: new Date().toISOString(),
    };
    upsertInteractive(next);
    setData(next);
    setSaved(true);
    if (!isEdit) {
      navigate(`/cabinet/interactives/${next.id}/edit`, { replace: true });
    }
  };

  const goToLaunch = () => {
    const next = { ...data, updatedAt: new Date().toISOString() };
    upsertInteractive(next);
    setData(next);
    if (!isEdit) {
      navigate(`/cabinet/interactives/${next.id}`, { replace: true });
    } else {
      navigate(`/cabinet/interactives/${next.id}`);
    }
  };

  return (
    <CabinetPageShell className="cb-section--interactive-editor">
      <header className="cb-page-header ix-editor-header">
        <div className="cb-page-header__text">
          <p className="cb-editor-breadcrumb">
            <Link to="/cabinet/interactives">Интерактивы</Link>
            <span> / </span>
            <span>{isEdit ? "Редактирование" : "Создание"}</span>
          </p>
          <div className="ix-editor-header__title-row">
            <input
              className="ix-editor-header__title-input"
              value={data.title}
              onChange={(e) => onChange("title", e.target.value)}
              placeholder="Название интерактива"
            />
            <span className={`ix-status-badge ix-status-badge--${data.status === "published" ? "success" : data.status === "assigned" ? "info" : "gray"}`}>
              {statusMeta.label}
            </span>
          </div>
        </div>
        <div className="cb-page-actions">
          <button type="button" className="cb-btn cb-btn--outline" onClick={goToLaunch}>Предпросмотр</button>
          <button type="button" className="cb-btn cb-btn--outline" onClick={() => persist("draft")}>Сохранить</button>
          <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={() => persist("published")}>Опубликовать</button>
        </div>
      </header>

      {saved ? <p className="cb-editor-saved" role="status">Сохранено</p> : null}

      <div className="ix-editor-layout">
        <div className="ix-editor-layout__form">
          <CommonFields data={data} onChange={onChange} />
          {data.type === "flashcards" ? (
            <FlashcardsEditor data={data} onCardsChange={(cards) => onChange("cards", cards)} />
          ) : null}
          {data.type === "matching" ? (
            <MatchingEditor data={data} onChange={onChange} onPairsChange={(pairs) => onChange("pairs", pairs)} />
          ) : null}
          {data.type === "sequence" ? (
            <SequenceEditor data={data} onChange={onChange} onStepsChange={(steps) => onChange("steps", steps)} />
          ) : null}
        </div>

        <aside className="ix-editor-layout__preview">
          <div className="ix-editor-preview">
            <div className="ix-editor-preview__head">
              <h3 className="ix-editor-preview__title">Предпросмотр</h3>
              <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={goToLaunch}>
                Открыть
              </button>
            </div>
            <div
              className={`ix-editor-preview__frame ix-launch-hero ix-launch-hero--playing ${appearancePageClass(previewAppearance)}`}
              style={{ ...appearancePageStyle(previewAppearance), minHeight: 360 }}
            >
              <div className="ix-launch-hero__player">
                <InteractivePlayer interactive={data} appearance={previewAppearance} playing />
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="cb-interactive-editor__footer">
        <Link to="/cabinet/interactives" className="cb-btn cb-btn--outline">К списку</Link>
        <div className="cb-interactive-editor__footer-actions">
          <button type="button" className="cb-btn cb-btn--outline" onClick={goToLaunch}>Предпросмотр</button>
          <button type="button" className="cb-btn cb-btn--outline" onClick={() => persist("draft")}>Сохранить</button>
          <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={() => persist("published")}>Опубликовать</button>
        </div>
      </div>
    </CabinetPageShell>
  );
}
