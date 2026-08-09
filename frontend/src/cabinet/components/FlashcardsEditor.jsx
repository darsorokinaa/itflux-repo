import { useEffect, useState } from "react";
import InteractiveImageField from "./InteractiveImageField";
import { BuilderSection } from "./InteractiveEditorSettings";
import { reorderList } from "../interactivesEditorUtils";

function sideModeKey(index, side) {
  return `${index}-${side}`;
}

function inferSideMode(card, side) {
  const text = String(side === "front" ? card.front : card.back || "").trim();
  const img = String(side === "front" ? card.front_image_url : card.back_image_url || "").trim();
  if (img && !text) return "image";
  return "text";
}

function SidePreviewChip({ mode, text, hasImage }) {
  if (mode === "image" || (hasImage && !String(text || "").trim())) {
    return <span className="ix-card-chip ix-card-chip--image">Фото</span>;
  }
  const label = String(text || "").trim();
  return (
    <span className="ix-card-chip ix-card-chip--text" title={label || undefined}>
      {label ? (label.length > 42 ? `${label.slice(0, 42)}…` : label) : "Текст"}
    </span>
  );
}

function CardSideEditor({
  title,
  mode,
  onModeChange,
  text,
  onTextChange,
  imageUrl,
  onImageUpload,
  onImageClear,
  imageUploading,
  placeholder,
}) {
  return (
    <div className="ix-card-side">
      <div className="ix-card-side__head">
        <h4 className="ix-card-side__title">{title}</h4>
        <div className="ix-ed-segmented ix-ed-segmented--sm" role="group" aria-label={title}>
          <button
            type="button"
            className={`ix-ed-segmented__btn${mode === "text" ? " is-active" : ""}`}
            aria-pressed={mode === "text"}
            onClick={() => onModeChange("text")}
          >
            Текст
          </button>
          <button
            type="button"
            className={`ix-ed-segmented__btn${mode === "image" ? " is-active" : ""}`}
            aria-pressed={mode === "image"}
            onClick={() => onModeChange("image")}
          >
            Изображение
          </button>
        </div>
      </div>
      {mode === "text" ? (
        <textarea
          className="ix-card-side__textarea"
          rows={3}
          value={text}
          placeholder={placeholder}
          onChange={(e) => onTextChange(e.target.value)}
        />
      ) : (
        <InteractiveImageField
          compact
          value={imageUrl || ""}
          uploading={imageUploading}
          onUpload={onImageUpload}
          onClear={onImageClear}
        />
      )}
    </div>
  );
}

function UndoRemoveToast({ label, onUndo, onDismiss }) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
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

export default function FlashcardsEditor({
  data,
  onCardsChange,
  onImageUpload,
  imageUploading,
  openIndex,
  setOpenIndex,
  isMobile,
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [undoRemove, setUndoRemove] = useState(null);
  const [sideModes, setSideModes] = useState({});
  const [menuIndex, setMenuIndex] = useState(null);

  const cards = data.cards || [];

  const getMode = (index, side, card) =>
    sideModes[sideModeKey(index, side)] || inferSideMode(card, side);

  const setMode = (index, side, mode) => {
    setSideModes((prev) => ({ ...prev, [sideModeKey(index, side)]: mode }));
  };

  const updateCard = (index, field, value) => {
    const next = [...cards];
    next[index] = { ...next[index], [field]: value };
    onCardsChange(next);
  };

  const addCard = () => {
    onCardsChange([
      ...cards,
      {
        front: "",
        back: "",
        front_image_url: "",
        back_image_url: "",
        hint: "",
        explanation: "",
      },
    ]);
    setOpenIndex(cards.length);
  };

  const duplicateCard = (index) => {
    const next = [...cards];
    next.splice(index + 1, 0, { ...next[index] });
    onCardsChange(next);
    setOpenIndex(index + 1);
    setMenuIndex(null);
  };

  const removeCard = (index) => {
    if (cards.length <= 1) return;
    const item = cards[index];
    onCardsChange(cards.filter((_, i) => i !== index));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
    setUndoRemove({ item, index });
    setMenuIndex(null);
  };

  const restoreCard = () => {
    if (!undoRemove) return;
    const next = [...cards];
    next.splice(undoRemove.index, 0, undoRemove.item);
    onCardsChange(next);
    setOpenIndex(undoRemove.index);
    setUndoRemove(null);
  };

  const moveCard = (from, to) => {
    if (to < 0 || to >= cards.length || from === to) return;
    onCardsChange(reorderList(cards, from, to));
    setOpenIndex(to);
  };

  return (
    <BuilderSection
      title="Содержимое"
      hint="Главный блок: лицевая и обратная сторона каждой карточки"
      meta={
        <>
          <span className="ix-builder-section__count">
            {cards.length}{" "}
            {cards.length === 1 ? "карточка" : cards.length < 5 ? "карточки" : "карточек"}
          </span>
          <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={addCard}>
            + Добавить
          </button>
        </>
      }
    >
      {cards.length === 0 ? (
        <div className="ix-builder-empty">
          <p className="ix-builder-empty__title">Карточек пока нет</p>
          <p className="ix-builder-empty__text">
            Добавьте первую карточку с вопросом и ответом
          </p>
          <button type="button" className="cb-btn cb-btn--primary" onClick={addCard}>
            + Добавить карточку
          </button>
        </div>
      ) : (
        <div className="ix-card-list">
          {cards.map((card, index) => {
            const open = openIndex === index;
            const frontMode = getMode(index, "front", card);
            const backMode = getMode(index, "back", card);
            return (
              <article
                key={index}
                className={[
                  "ix-card-row",
                  open ? "is-open" : "",
                  dragIndex === index ? "is-dragging" : "",
                  overIndex === index && dragIndex !== index ? "is-over" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
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
              >
                <div className="ix-card-row__bar">
                  {!isMobile ? (
                    <button
                      type="button"
                      className="ix-card-row__drag"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(index));
                        e.dataTransfer.effectAllowed = "move";
                        setDragIndex(index);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setOverIndex(null);
                      }}
                      aria-label="Перетащить"
                    >
                      ⋮⋮
                    </button>
                  ) : null}
                  <div className="ix-card-row__summary">
                    <strong className="ix-card-row__title">Карточка {index + 1}</strong>
                    {!open ? (
                      <div className="ix-card-row__preview-line">
                        <SidePreviewChip
                          mode={frontMode}
                          text={card.front}
                          hasImage={Boolean(card.front_image_url)}
                        />
                        <span className="ix-card-row__arrow" aria-hidden="true">
                          →
                        </span>
                        <SidePreviewChip
                          mode={backMode}
                          text={card.back}
                          hasImage={Boolean(card.back_image_url)}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="ix-card-row__actions">
                    <button
                      type="button"
                      className="ix-card-row__edit"
                      onClick={() => setOpenIndex(open ? -1 : index)}
                    >
                      {open ? "Свернуть" : "Изменить"}
                    </button>
                    <div className={`ix-card-row__menu${menuIndex === index ? " is-open" : ""}`}>
                      <button
                        type="button"
                        className="ix-ed-icon-btn"
                        aria-label="Меню"
                        onClick={() => setMenuIndex(menuIndex === index ? null : index)}
                      >
                        ⋯
                      </button>
                      {menuIndex === index ? (
                        <div className="ix-card-row__menu-pop">
                          <button type="button" onClick={() => { moveCard(index, index - 1); setMenuIndex(null); }} disabled={index === 0}>
                            Выше
                          </button>
                          <button type="button" onClick={() => { moveCard(index, index + 1); setMenuIndex(null); }} disabled={index >= cards.length - 1}>
                            Ниже
                          </button>
                          <button type="button" onClick={() => duplicateCard(index)}>
                            Дублировать
                          </button>
                          {cards.length > 1 ? (
                            <button type="button" className="danger" onClick={() => removeCard(index)}>
                              Удалить
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {open ? (
                  <div className="ix-card-row__editor">
                    <div className="ix-card-sides">
                      <CardSideEditor
                        title="Лицевая сторона"
                        mode={frontMode}
                        onModeChange={(m) => setMode(index, "front", m)}
                        text={card.front}
                        onTextChange={(v) => updateCard(index, "front", v)}
                        imageUrl={card.front_image_url}
                        imageUploading={imageUploading}
                        onImageUpload={async (file) => {
                          const url = await onImageUpload(file);
                          updateCard(index, "front_image_url", url);
                          setMode(index, "front", "image");
                        }}
                        onImageClear={() => updateCard(index, "front_image_url", "")}
                        placeholder="Вопрос или термин"
                      />
                      <CardSideEditor
                        title="Обратная сторона"
                        mode={backMode}
                        onModeChange={(m) => setMode(index, "back", m)}
                        text={card.back}
                        onTextChange={(v) => updateCard(index, "back", v)}
                        imageUrl={card.back_image_url}
                        imageUploading={imageUploading}
                        onImageUpload={async (file) => {
                          const url = await onImageUpload(file);
                          updateCard(index, "back_image_url", url);
                          setMode(index, "back", "image");
                        }}
                        onImageClear={() => updateCard(index, "back_image_url", "")}
                        placeholder="Ответ или определение"
                      />
                    </div>
                    <div className="ix-card-sides ix-card-sides--extra">
                      <label className="ix-ed-field">
                        <span>Подсказка</span>
                        <input
                          value={card.hint || ""}
                          placeholder="Необязательно"
                          onChange={(e) => updateCard(index, "hint", e.target.value)}
                        />
                      </label>
                      <label className="ix-ed-field">
                        <span>Пояснение</span>
                        <input
                          value={card.explanation || ""}
                          placeholder="Необязательно"
                          onChange={(e) => updateCard(index, "explanation", e.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {undoRemove ? (
        <UndoRemoveToast
          key={`card-${undoRemove.index}-${undoRemove.item?.front || ""}`}
          label="Карточка удалена"
          onUndo={restoreCard}
          onDismiss={() => setUndoRemove(null)}
        />
      ) : null}
    </BuilderSection>
  );
}
