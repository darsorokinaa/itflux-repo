import { useState } from "react";
import {
  ACCESS_OPTIONS,
  getStatusMeta,
} from "../interactivesData";
import {
  DIFFICULTY_CHIPS,
  EXAM_CHIPS,
  SUBJECT_CHIPS,
} from "../interactivesEditorUtils";

export function BuilderSection({
  title,
  hint,
  meta,
  collapsible = false,
  defaultOpen = true,
  children,
  className = "",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const showBody = !collapsible || open;

  return (
    <section className={`ix-builder-section ${className}`.trim()}>
      <header className="ix-builder-section__head">
        <div className="ix-builder-section__titles">
          {collapsible ? (
            <button
              type="button"
              className="ix-builder-section__toggle"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              <h2 className="ix-builder-section__title">{title}</h2>
              <span className="ix-builder-section__chevron" aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
            </button>
          ) : (
            <h2 className="ix-builder-section__title">{title}</h2>
          )}
          {hint ? <p className="ix-builder-section__hint">{hint}</p> : null}
        </div>
        {meta ? <div className="ix-builder-section__meta">{meta}</div> : null}
      </header>
      {showBody ? <div className="ix-builder-section__body">{children}</div> : null}
    </section>
  );
}

function SegmentedControl({ options, value, onChange, disabled = false, ariaLabel }) {
  return (
    <div className="ix-ed-segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.id || opt.value}
          type="button"
          className={`ix-ed-segmented__btn${value === (opt.id || opt.value) ? " is-active" : ""}`}
          disabled={disabled}
          aria-pressed={value === (opt.id || opt.value)}
          onClick={() => onChange(opt.id || opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ChipGroup({ options, value, onChange, ariaLabel }) {
  return (
    <div className="ix-ed-chips" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const val = opt.value ?? opt;
        const label = opt.label ?? opt;
        return (
          <button
            key={val}
            type="button"
            className={`ix-ed-chip${value === val ? " is-active" : ""}`}
            aria-pressed={value === val}
            onClick={() => onChange(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <label className="ix-ed-toggle ix-ed-toggle--row">
      <span className="ix-ed-toggle__copy">
        <span className="ix-ed-toggle__label">{label}</span>
        {description ? <span className="ix-ed-toggle__desc">{description}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ix-ed-toggle__track" aria-hidden="true" />
    </label>
  );
}

function AccessCards({ value, onChange }) {
  return (
    <div className="ix-ed-access-cards">
      {ACCESS_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`ix-ed-access-card${value === opt.id ? " is-active" : ""}`}
          aria-pressed={value === opt.id}
          onClick={() => onChange(opt.id)}
        >
          <strong>{opt.label}</strong>
        </button>
      ))}
    </div>
  );
}

/** Блок 1: название и инструкция — главный вход в сценарий. */
export function InteractiveBasicSettings({ data, onChange }) {
  return (
    <BuilderSection title="Основное" hint="Назовите интерактив и подскажите ученику, что делать">
      <label className="ix-ed-field ix-ed-field--hero">
        <span>Название интерактива</span>
        <input
          value={data.title}
          onChange={(e) => onChange("title", e.target.value)}
          placeholder="Например: Логические операции"
        />
      </label>

      <label className="ix-ed-field ix-ed-field--wide">
        <span>Инструкция ученику</span>
        <textarea
          rows={2}
          value={data.instruction}
          onChange={(e) => onChange("instruction", e.target.value)}
          placeholder="Короткая подсказка перед началом"
        />
      </label>
    </BuilderSection>
  );
}

/** Блок «Дополнительно»: предмет, доступ, тумблеры. */
export function InteractiveAdvancedSettings({
  data,
  onChange,
  onParamsChange,
  onPublish,
  onUnpublish,
}) {
  const statusMeta = getStatusMeta(data.status);
  const isPublished = data.status === "published" || data.status === "assigned";
  const subjectChip = SUBJECT_CHIPS.includes(data.subject) ? data.subject : "Другое";
  const params = data.params || {};

  const setParam = (key, value) => {
    onParamsChange({ ...params, [key]: value });
  };

  return (
    <BuilderSection
      title="Дополнительные настройки"
      hint="Предмет, доступ и поведение на уроке"
      collapsible
      defaultOpen={false}
    >
      <div className="ix-ed-extra">
        <label className="ix-ed-field">
          <span>Тема</span>
          <input
            value={data.topic}
            onChange={(e) => onChange("topic", e.target.value)}
            placeholder="О чём это задание"
          />
        </label>

        <div className="ix-ed-field ix-ed-field--secondary">
          <span>Предмет</span>
          <ChipGroup
            options={SUBJECT_CHIPS}
            value={subjectChip}
            onChange={(val) => onChange("subject", val === "Другое" ? "" : val)}
            ariaLabel="Предмет"
          />
          {subjectChip === "Другое" ? (
            <input
              className="ix-ed-field__inline-input"
              value={data.subject}
              onChange={(e) => onChange("subject", e.target.value)}
              placeholder="Укажите предмет"
            />
          ) : null}
        </div>

        <div className="ix-ed-field ix-ed-field--secondary">
          <span>Экзамен</span>
          <ChipGroup
            options={EXAM_CHIPS}
            value={data.exam}
            onChange={(val) => onChange("exam", val)}
            ariaLabel="Экзамен"
          />
        </div>

        <div className="ix-ed-field ix-ed-field--secondary">
          <span>Сложность</span>
          <SegmentedControl
            options={DIFFICULTY_CHIPS}
            value={data.difficulty}
            onChange={(val) => onChange("difficulty", val)}
            ariaLabel="Сложность"
          />
        </div>

        <label className="ix-ed-field">
          <span>Подтема</span>
          <input value={data.subtopic} onChange={(e) => onChange("subtopic", e.target.value)} />
        </label>
        <label className="ix-ed-field">
          <span>№ задания</span>
          <input value={data.taskNumber} onChange={(e) => onChange("taskNumber", e.target.value)} />
        </label>

        <div className="ix-ed-field">
          <span>Доступ</span>
          <AccessCards value={data.access} onChange={(val) => onChange("access", val)} />
        </div>

        <div className="ix-ed-status-row">
          <span className={`ix-status-badge ix-status-badge--${statusMeta.tone}`}>
            {statusMeta.label}
          </span>
          {isPublished ? (
            <button type="button" className="ix-ed-link-btn" onClick={onUnpublish}>
              Снять с публикации
            </button>
          ) : (
            <button type="button" className="ix-ed-link-btn" onClick={onPublish}>
              Опубликовать
            </button>
          )}
        </div>

        <div className="ix-ed-toggles">
          <ToggleRow
            label={data.type === "quiz" ? "Перемешивать вопросы" : "Перемешивать"}
            description="Менять порядок при каждом запуске"
            checked={
              data.type === "matching"
                ? data.shufflePairs !== false
                : params.shuffleQuestions !== false
            }
            onChange={(v) => {
              if (data.type === "matching") onChange("shufflePairs", v);
              else setParam("shuffleQuestions", v);
            }}
          />
          {data.type === "quiz" ? (
            <>
              <ToggleRow
                label="Перемешивать варианты"
                checked={params.shuffleOptions !== false}
                onChange={(v) => setParam("shuffleOptions", v)}
              />
              <ToggleRow
                label="Показывать правильный ответ сразу"
                checked={params.showCorrectImmediately === true}
                onChange={(v) => setParam("showCorrectImmediately", v)}
              />
              <ToggleRow
                label="Показывать ответы в конце"
                checked={params.showAnswersAtEnd !== false}
                onChange={(v) => setParam("showAnswersAtEnd", v)}
              />
            </>
          ) : (
            <ToggleRow
              label="Показывать ответы"
              checked={params.showAnswersAtEnd !== false}
              onChange={(v) => setParam("showAnswersAtEnd", v)}
            />
          )}
          <ToggleRow
            label="Пояснение после ответа"
            checked={params.showExplanationAfterAnswer !== false}
            onChange={(v) => setParam("showExplanationAfterAnswer", v)}
          />
          <ToggleRow
            label="Разрешить повтор"
            description="Ученик может пройти ещё раз"
            checked={params.allowRetry !== false}
            onChange={(v) => setParam("allowRetry", v)}
          />
          {data.type === "quiz" ? (
            <ToggleRow
              label="Записывать результат"
              checked={params.recordInReport !== false}
              onChange={(v) => setParam("recordInReport", v)}
            />
          ) : null}
          {data.type === "matching" ? (
            <ToggleRow
              label="Результат сразу"
              checked={data.showResultImmediately !== false}
              onChange={(v) => onChange("showResultImmediately", v)}
            />
          ) : null}
          {data.type === "sequence" ? (
            <>
              <ToggleRow
                label="Несколько попыток"
                checked={data.allowMultipleAttempts !== false}
                onChange={(v) => onChange("allowMultipleAttempts", v)}
              />
              <ToggleRow
                label="Ответ при ошибке"
                checked={data.showAnswerOnError !== false}
                onChange={(v) => onChange("showAnswerOnError", v)}
              />
            </>
          ) : null}
        </div>

        <label className="ix-ed-field">
          <span>Количество попыток (0 — без лимита)</span>
          <input
            type="number"
            min={0}
            value={params.maxAttempts || 0}
            onChange={(e) => setParam("maxAttempts", Number(e.target.value) || 0)}
          />
        </label>
      </div>
    </BuilderSection>
  );
}

/** @deprecated используйте InteractiveBasicSettings + InteractiveAdvancedSettings */
export default function InteractiveEditorSettings(props) {
  return (
    <>
      <InteractiveBasicSettings data={props.data} onChange={props.onChange} />
      <InteractiveAdvancedSettings {...props} />
    </>
  );
}
