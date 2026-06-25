import { useState } from "react";
import {
  createEmptySegment,
  duplicateWheelSegment,
  normalizeWheelSettings,
  reorderWheelSegments,
  SPIN_DURATION_CHIPS,
  WHEEL_SEGMENT_COLORS,
} from "../wheelUtils";

function EditorAccordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ix-ed-accordion">
      <button type="button" className="ix-ed-accordion__head" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="ix-ed-accordion__body">{children}</div> : null}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="ix-ed-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ix-ed-toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

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
  EditorItemShell,
  openIndex,
  setOpenIndex,
  isMobile,
}) {
  const segments = data.segments || [];
  const settings = normalizeWheelSettings(data.wheelSettings);

  const updateSegment = (index, field, value) => {
    const next = segments.map((item, i) => (i === index ? { ...item, [field]: value } : item));
    onSegmentsChange(next);
  };

  const addSegment = () => {
    const next = [...segments, createEmptySegment(segments.length + 1)];
    onSegmentsChange(next.map((item, i) => ({ ...item, order: i + 1 })));
    setOpenIndex(next.length - 1);
  };

  const removeSegment = (index) => {
    const next = segments.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i + 1 }));
    onSegmentsChange(next);
    setOpenIndex(Math.max(0, index - 1));
  };

  const duplicateSegment = (index) => {
    onSegmentsChange(duplicateWheelSegment(segments, index));
    setOpenIndex(segments.length);
  };

  const moveSegment = (from, to) => {
    onSegmentsChange(reorderWheelSegments(segments, from, to));
    setOpenIndex(to);
  };

  const setSetting = (key, value) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <>
      <section className="ix-ed-panel">
        <header className="ix-ed-panel__head">
          <h2 className="ix-ed-panel__title">Сектора</h2>
          <p className="ix-ed-panel__hint">Минимум 2 сектора для публикации</p>
        </header>
        <div className="ix-ed-panel__body">
          <div className="ix-ed-items">
            {segments.map((segment, index) => (
              <EditorItemShell
                key={segment.id}
                index={index}
                title={`Сектор ${index + 1}`}
                summary={segment.title?.trim() || "Без названия"}
                hint={`${segment.points ?? 1} б.`}
                open={openIndex === index}
                onToggle={() => setOpenIndex(openIndex === index ? -1 : index)}
                onDuplicate={() => duplicateSegment(index)}
                onRemove={() => removeSegment(index)}
                canRemove={segments.length > 0}
                onMoveUp={() => moveSegment(index, index - 1)}
                onMoveDown={() => moveSegment(index, index + 1)}
                canMoveUp={index > 0}
                canMoveDown={index < segments.length - 1}
                isMobile={isMobile}
              >
                <div className="ix-ed-fields">
                  <label className="ix-ed-field ix-ed-field--wide">
                    <span>Название</span>
                    <input
                      value={segment.title}
                      onChange={(e) => updateSegment(index, "title", e.target.value)}
                      placeholder="Название сектора"
                    />
                  </label>
                  <label className="ix-ed-field ix-ed-field--wide">
                    <span>Описание</span>
                    <input
                      value={segment.description}
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
              </EditorItemShell>
            ))}
          </div>
          <button type="button" className="cb-btn cb-btn--outline ix-ed-add-btn" onClick={addSegment}>
            + Добавить сектор
          </button>
        </div>
      </section>

      <EditorAccordion title="Дополнительно">
        <div className="ix-ed-wheel-settings">
          <ToggleRow
            label="Перемешивать сектора"
            checked={settings.shuffle_segments === true}
            onChange={(v) => setSetting("shuffle_segments", v)}
          />
          <ToggleRow
            label="Разрешить повторное выпадение"
            checked={settings.allow_repeat !== false}
            onChange={(v) => setSetting("allow_repeat", v)}
          />
          <ToggleRow
            label="Удалять сектор после выпадения"
            checked={settings.remove_after_spin === true}
            onChange={(v) => setSetting("remove_after_spin", v)}
          />
          <ToggleRow
            label="Показывать результат в модальном окне"
            checked={settings.show_result_modal !== false}
            onChange={(v) => setSetting("show_result_modal", v)}
          />
          <ToggleRow
            label="Звук вращения"
            checked={settings.sound_enabled !== false}
            onChange={(v) => setSetting("sound_enabled", v)}
          />
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
        </div>
      </EditorAccordion>
    </>
  );
}
