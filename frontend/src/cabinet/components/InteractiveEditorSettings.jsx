import { useState } from "react";
import AppearanceSettings from "./AppearanceSettings";
import {
  ACCESS_OPTIONS,
  getStatusMeta,
} from "../interactivesData";
import {
  DIFFICULTY_CHIPS,
  EXAM_CHIPS,
  SUBJECT_CHIPS,
  TYPE_SEGMENTS,
} from "../interactivesEditorUtils";

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

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="ix-ed-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ix-ed-toggle__track" aria-hidden="true" />
      <span>{label}</span>
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

export default function InteractiveEditorSettings({
  data,
  onChange,
  onParamsChange,
  onPublish,
  onUnpublish,
  typeLocked = true,
}) {
  const statusMeta = getStatusMeta(data.status);
  const isPublished = data.status === "published" || data.status === "assigned";
  const subjectChip = SUBJECT_CHIPS.includes(data.subject) ? data.subject : "Другое";
  const params = data.params || {};

  const setParam = (key, value) => {
    onParamsChange({ ...params, [key]: value });
  };

  return (
    <section className="ix-ed-panel">
      <header className="ix-ed-panel__head">
        <h2 className="ix-ed-panel__title">Главное</h2>
        <p className="ix-ed-panel__hint">Название, тема и ключевые параметры</p>
      </header>

      <div className="ix-ed-panel__body">
        <label className="ix-ed-field ix-ed-field--hero">
          <span>Название интерактива</span>
          <input
            value={data.title}
            onChange={(e) => onChange("title", e.target.value)}
            placeholder="Например: Логические операции"
          />
        </label>

        <label className="ix-ed-field ix-ed-field--hero">
          <span>Тема</span>
          <input
            value={data.topic}
            onChange={(e) => onChange("topic", e.target.value)}
            placeholder="О чём это задание"
          />
        </label>

        <div className="ix-ed-field">
          <span>Тип интерактива</span>
          {data.type === "wheel" ? (
            <span className="ix-ed-type-badge">Колесо фортуны</span>
          ) : (
            <SegmentedControl
              options={TYPE_SEGMENTS}
              value={data.type}
              onChange={(type) => onChange("type", type)}
              disabled={typeLocked}
              ariaLabel="Тип интерактива"
            />
          )}
          {typeLocked && data.type !== "wheel" ? (
            <p className="ix-ed-field__note">Тип задаётся при создании</p>
          ) : null}
          {typeLocked && data.type === "wheel" ? (
            <p className="ix-ed-field__note">Случайное колесо</p>
          ) : null}
        </div>

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
      </div>

      <EditorAccordion title="Дополнительно">
        <div className="ix-ed-extra">
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

          <label className="ix-ed-field ix-ed-field--wide">
            <span>Инструкция для ученика</span>
            <textarea
              rows={2}
              value={data.instruction}
              onChange={(e) => onChange("instruction", e.target.value)}
              placeholder="Короткая подсказка перед началом"
            />
          </label>

          <div className="ix-ed-toggles">
            <ToggleRow
              label={data.type === "quiz" ? "Перемешивать вопросы" : "Перемешивать"}
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

          <AppearanceSettings data={data} onChange={onChange} compact />
        </div>
      </EditorAccordion>
    </section>
  );
}
