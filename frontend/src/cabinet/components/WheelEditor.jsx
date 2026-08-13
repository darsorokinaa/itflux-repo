import { useState } from "react";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import { BuilderSection } from "./InteractiveEditorSettings";
import {
  createEmptySegment,
  duplicateWheelSegment,
  normalizeWheelSettings,
  reorderWheelSegments,
  SPIN_DURATION_CHIPS,
  WHEEL_SEGMENT_COLORS,
} from "../wheelUtils";

function ColorPalette({ value, onChange }) {
  return (
    <div className="ix-wheel-colors" role="group" aria-label="Цвет сектора">
      {WHEEL_SEGMENT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`ix-wheel-colors__dot${value === color ? " is-active" : ""}`}
          style={{ background: color }}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
        >
          {value === color ? <span aria-hidden="true">✓</span> : null}
        </button>
      ))}
    </div>
  );
}

function PointsStepper({ value, onChange }) {
  const num = Number(value) || 0;
  return (
    <div className="ix-wheel-stepper">
      <button type="button" className="ix-wheel-stepper__btn" onClick={() => onChange(Math.max(0, num - 1))} aria-label="Меньше">−</button>
      <span className="ix-wheel-stepper__value">{num}</span>
      <button type="button" className="ix-wheel-stepper__btn" onClick={() => onChange(num + 1)} aria-label="Больше">+</button>
    </div>
  );
}

export default function WheelEditor({
  data,
  onSegmentsChange,
  onSettingsChange,
  openIndex,
  setOpenIndex,
  isMobile,
}) {
  const segments = data.segments || [];
  const settings = normalizeWheelSettings(data.wheelSettings);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [menu, setMenu] = useState(null);

  const updateSegment = (index, field, value) => {
    const next = segments.map((item, i) => (i === index ? { ...item, [field]: value } : item));
    onSegmentsChange(next);
  };

  const addSegment = () => {
    onSegmentsChange([...segments, createEmptySegment(segments.length + 1)]);
    setOpenIndex(segments.length);
  };

  const duplicateSegment = (index) => {
    onSegmentsChange(duplicateWheelSegment(segments, index));
    setOpenIndex(index + 1);
    setMenu(null);
  };

  const removeSegment = (index) => {
    if (segments.length <= 2) return;
    onSegmentsChange(segments.filter((_, i) => i !== index));
    setOpenIndex((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
    setMenu(null);
  };

  const moveSegment = (from, to) => {
    if (to < 0 || to >= segments.length || from === to) return;
    onSegmentsChange(reorderWheelSegments(segments, from, to));
    setOpenIndex(to);
  };

  const setSetting = (key, value) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <>
      <BuilderSection
        title="Содержимое"
        hint="Секторы колеса — минимум 2 для публикации"
        meta={
          <>
            <span className="ix-builder-section__count">{segments.length}</span>
            <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={addSegment}>
              + Добавить
            </button>
          </>
        }
      >
        {segments.length === 0 ? (
          <div className="ix-builder-empty">
            <p className="ix-builder-empty__title">Секторов пока нет</p>
            <p className="ix-builder-empty__text">Добавьте задания или варианты для колеса</p>
            <button type="button" className="cb-btn cb-btn--primary" onClick={addSegment}>
              + Добавить сектор
            </button>
          </div>
        ) : (
          <div className="ix-card-list ix-wheel-rows">
            {segments.map((segment, index) => {
              const open = openIndex === index;
              return (
                <article
                  key={segment.id || index}
                  className={[
                    "ix-card-row",
                    open ? "is-open" : "",
                    dragIndex === index ? "is-dragging" : "",
                    overIndex === index && dragIndex !== index ? "is-over" : "",
                  ].filter(Boolean).join(" ")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverIndex(index);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveSegment(Number(e.dataTransfer.getData("text/plain")), index);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  <div className="ix-card-row__bar ix-wheel-row__bar">
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
                    <span
                      className="ix-wheel-row__swatch"
                      style={{ background: segment.color || "#5867e8" }}
                      aria-hidden="true"
                    />
                    <input
                      className="ix-wheel-row__input"
                      value={segment.title || ""}
                      placeholder="Введите текст задания"
                      onChange={(e) => updateSegment(index, "title", e.target.value)}
                    />
                    <div className="ix-card-row__actions">
                      <button
                        type="button"
                        className="ix-card-row__edit"
                        onClick={() => setOpenIndex(open ? -1 : index)}
                      >
                        {open ? "Свернуть" : "Ещё"}
                      </button>
                      <div className={`ix-card-row__menu${menu?.index === index ? " is-open" : ""}`}>
                        <button
                          type="button"
                          className="ix-ed-icon-btn"
                          aria-label="Меню"
                          onClick={(e) => setMenu(menu?.index === index ? null : { index, anchor: e.currentTarget })}
                        >
                          ⋯
                        </button>
                        <CabinetFloatingMenu
                          open={menu?.index === index}
                          anchorEl={menu?.anchor}
                          onClose={() => setMenu(null)}
                          className="ix-card-row__menu-pop"
                          width={180}
                        >
                          <button type="button" onClick={() => { moveSegment(index, index - 1); setMenu(null); }} disabled={index === 0}>
                            Выше
                          </button>
                          <button type="button" onClick={() => { moveSegment(index, index + 1); setMenu(null); }} disabled={index >= segments.length - 1}>
                            Ниже
                          </button>
                          <button type="button" onClick={() => { duplicateSegment(index); setMenu(null); }}>
                            Дублировать
                          </button>
                          {segments.length > 2 ? (
                            <button type="button" className="danger" onClick={() => { removeSegment(index); setMenu(null); }}>
                              Удалить
                            </button>
                          ) : null}
                        </CabinetFloatingMenu>
                      </div>
                    </div>
                  </div>
                  {open ? (
                    <div className="ix-card-row__editor">
                      <div className="ix-ed-fields">
                        <label className="ix-ed-field ix-ed-field--wide">
                          <span>Описание</span>
                          <input
                            value={segment.description || ""}
                            onChange={(e) => updateSegment(index, "description", e.target.value)}
                            placeholder="Необязательно"
                          />
                        </label>
                        <div className="ix-ed-field">
                          <span>Цвет</span>
                          <ColorPalette
                            value={segment.color}
                            onChange={(color) => updateSegment(index, "color", color)}
                          />
                        </div>
                        <div className="ix-ed-field">
                          <span>Баллы</span>
                          <PointsStepper
                            value={segment.points}
                            onChange={(points) => updateSegment(index, "points", points)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </BuilderSection>

      <BuilderSection title="Настройки колеса" hint="Поведение при запуске" collapsible defaultOpen={false}>
        <div className="ix-ed-toggles">
          <label className="ix-ed-toggle ix-ed-toggle--row">
            <span className="ix-ed-toggle__copy">
              <span className="ix-ed-toggle__label">Перемешивать сектора</span>
            </span>
            <input
              type="checkbox"
              checked={settings.shuffle_segments === true}
              onChange={(e) => setSetting("shuffle_segments", e.target.checked)}
            />
            <span className="ix-ed-toggle__track" aria-hidden="true" />
          </label>
          <label className="ix-ed-toggle ix-ed-toggle--row">
            <span className="ix-ed-toggle__copy">
              <span className="ix-ed-toggle__label">Разрешить повторное выпадение</span>
            </span>
            <input
              type="checkbox"
              checked={settings.allow_repeat !== false}
              onChange={(e) => setSetting("allow_repeat", e.target.checked)}
            />
            <span className="ix-ed-toggle__track" aria-hidden="true" />
          </label>
          <label className="ix-ed-toggle ix-ed-toggle--row">
            <span className="ix-ed-toggle__copy">
              <span className="ix-ed-toggle__label">Удалять сектор после выпадения</span>
            </span>
            <input
              type="checkbox"
              checked={settings.remove_after_spin === true}
              onChange={(e) => setSetting("remove_after_spin", e.target.checked)}
            />
            <span className="ix-ed-toggle__track" aria-hidden="true" />
          </label>
          <label className="ix-ed-toggle ix-ed-toggle--row">
            <span className="ix-ed-toggle__copy">
              <span className="ix-ed-toggle__label">Результат в модальном окне</span>
            </span>
            <input
              type="checkbox"
              checked={settings.show_result_modal !== false}
              onChange={(e) => setSetting("show_result_modal", e.target.checked)}
            />
            <span className="ix-ed-toggle__track" aria-hidden="true" />
          </label>
          <label className="ix-ed-toggle ix-ed-toggle--row">
            <span className="ix-ed-toggle__copy">
              <span className="ix-ed-toggle__label">Звук вращения</span>
            </span>
            <input
              type="checkbox"
              checked={settings.sound_enabled !== false}
              onChange={(e) => setSetting("sound_enabled", e.target.checked)}
            />
            <span className="ix-ed-toggle__track" aria-hidden="true" />
          </label>
        </div>
        <div className="ix-ed-field">
          <span>Длительность вращения</span>
          <div className="ix-ed-chips">
            {SPIN_DURATION_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className={`ix-ed-chip${settings.spin_duration === chip.value ? " is-active" : ""}`}
                onClick={() => setSetting("spin_duration", chip.value)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      </BuilderSection>
    </>
  );
}
