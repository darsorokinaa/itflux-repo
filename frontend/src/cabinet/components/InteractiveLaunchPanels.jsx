import { useEffect, useRef, useState } from "react";
import {
  ACCESS_OPTIONS,
  DEFAULT_PARAMS,
  canShareInteractive,
  canAssignInteractive,
  getInteractiveDisplayTitle,
  getStatusMeta,
  getTypeMeta,
} from "../interactivesData";
import { backgroundPreviewStyle } from "../interactiveAppearance";
import { difficultyLabel } from "../interactivesEditorUtils";

const TIMER_PRESETS = [
  { id: "none", label: "Нет", mode: "none", minutes: 0, seconds: 0 },
  { id: "3", label: "3 мин", mode: "countdown", minutes: 3, seconds: 0 },
  { id: "5", label: "5 мин", mode: "countdown", minutes: 5, seconds: 0 },
  { id: "10", label: "10 мин", mode: "countdown", minutes: 10, seconds: 0 },
];

function timerPresetId(params) {
  const p = { ...DEFAULT_PARAMS, ...params };
  if (p.timerMode === "none" || (!p.timerMinutes && !p.timerSeconds)) return "none";
  const match = TIMER_PRESETS.find(
    (item) => item.mode === p.timerMode
      && item.minutes === p.timerMinutes
      && item.seconds === p.timerSeconds,
  );
  return match?.id || "none";
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="ix-launch-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ix-launch-toggle__track" aria-hidden="true" />
    </label>
  );
}

export function InteractivePassport({ interactive }) {
  const typeMeta = getTypeMeta(interactive.type);
  const statusMeta = getStatusMeta(interactive.status);
  const accessLabel = ACCESS_OPTIONS.find((o) => o.id === interactive.access)?.label || "—";

  const entries = [
    { label: "Тип", value: typeMeta.shortLabel },
    { label: "Предмет", value: interactive.subject || "" },
    { label: "Экзамен", value: interactive.exam && interactive.exam !== "без экзамена" ? interactive.exam : "" },
    { label: "Тема", value: interactive.topic || "" },
    { label: "Сложность", value: difficultyLabel(interactive.difficulty) },
    { label: "Статус", value: statusMeta.label, tone: statusMeta.tone },
    { label: "Доступ", value: accessLabel },
  ].filter((entry) => entry.value && entry.value !== "—" && entry.value !== "null" && entry.value !== "undefined");

  return (
    <section className="ix-launch-passport">
      <h3 className="ix-launch-passport__title">Паспорт</h3>
      <dl className="ix-launch-passport__grid">
        {entries.map((entry) => (
          <div key={entry.label} className="ix-launch-passport__cell">
            <dt>{entry.label}</dt>
            <dd>
              {entry.tone ? (
                <span className={`ix-status-badge ix-status-badge--${entry.tone}`}>{entry.value}</span>
              ) : (
                entry.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LaunchSummaryChips({ chips }) {
  if (!chips?.length) return null;
  return (
    <div className="ix-launch-summary">
      {chips.map((chip) => (
        <span key={chip} className="ix-launch-summary__chip">{chip}</span>
      ))}
    </div>
  );
}

export function VisualStylePicker({
  backgrounds = [],
  loading = false,
  activeBackgroundSlug,
  backgroundImage,
  backgroundImageTone = "light",
  onSelectBackground,
  onImageUpload,
  onImageRemove,
  onImageToneChange,
  compact = false,
}) {
  const inputId = "ix-bg-image-upload";
  const isCustom = activeBackgroundSlug === "custom" || Boolean(backgroundImage);

  return (
    <section className={`ix-launch-panel ix-launch-panel--style${compact ? " ix-launch-panel--compact" : ""}`}>
      <h3 className="ix-launch-panel__title">Визуальный стиль</h3>
      <div className="ix-visual-themes ix-visual-themes--compact">
        {loading && !backgrounds.length ? (
          <p className="ix-bg-upload-hint">Загрузка…</p>
        ) : null}
        {backgrounds.map((item) => (
          <button
            key={item.slug}
            type="button"
            className={`ix-visual-theme ix-visual-theme--compact${!isCustom && activeBackgroundSlug === item.slug ? " ix-visual-theme--active" : ""}`}
            onClick={() => onSelectBackground?.(item.slug)}
            aria-pressed={!isCustom && activeBackgroundSlug === item.slug}
          >
            <span className="ix-visual-theme__preview" style={backgroundPreviewStyle(item)} />
            <span className="ix-visual-theme__label">{item.name}</span>
          </button>
        ))}
        <button
          type="button"
          className={`ix-visual-theme ix-visual-theme--compact ix-visual-theme--custom${isCustom ? " ix-visual-theme--active" : ""}`}
          onClick={() => document.getElementById(inputId)?.click()}
          aria-pressed={isCustom}
        >
          <span
            className="ix-visual-theme__preview ix-visual-theme__preview--image"
            style={backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : undefined}
          >
            {!backgroundImage ? "+" : null}
          </span>
          <span className="ix-visual-theme__label">Своя</span>
        </button>
      </div>

      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="ix-bg-upload-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImageUpload?.(file);
          e.target.value = "";
        }}
      />

      {backgroundImage ? (
        <div className="ix-bg-custom-controls ix-bg-custom-controls--compact">
          <div className="ix-bg-custom-actions">
            <ChipGroupInline
              options={[
                { value: "light", label: "Светлый текст" },
                { value: "dark", label: "Тёмный текст" },
              ]}
              value={backgroundImageTone}
              onChange={onImageToneChange}
            />
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onImageRemove}>
              Убрать
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ChipGroupInline({ options, value, onChange }) {
  return (
    <div className="ix-launch-chips ix-launch-chips--inline">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`ix-launch-chip${value === opt.value ? " is-active" : ""}`}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ParametersPanel({ params, onChange, mobileAccordion = false }) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const [open, setOpen] = useState(false);
  const activeTimer = timerPresetId(p);

  const set = (field, value) => onChange({ ...p, [field]: value });

  const applyTimer = (preset) => {
    onChange({
      ...p,
      timerMode: preset.mode,
      timerMinutes: preset.minutes,
      timerSeconds: preset.seconds,
    });
  };

  const body = (
    <div className="ix-params ix-params--compact">
      <div className="ix-launch-field">
        <span className="ix-launch-field__label">Таймер</span>
        <div className="ix-launch-chips">
          {TIMER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`ix-launch-chip${activeTimer === preset.id ? " is-active" : ""}`}
              onClick={() => applyTimer(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <ToggleRow label="Перемешивать" checked={p.shuffleQuestions !== false} onChange={(v) => set("shuffleQuestions", v)} />
      <ToggleRow label="Показывать ответы" checked={p.showAnswersAtEnd !== false} onChange={(v) => set("showAnswersAtEnd", v)} />
      <ToggleRow label="Пояснение после ответа" checked={p.showExplanationAfterAnswer !== false} onChange={(v) => set("showExplanationAfterAnswer", v)} />
      <ToggleRow label="Разрешить повторное прохождение" checked={p.allowRetry !== false} onChange={(v) => set("allowRetry", v)} />
      <ToggleRow label="Автоматическая подложка для текста" checked={p.autoTextBackdrop !== false} onChange={(v) => set("autoTextBackdrop", v)} />
    </div>
  );

  if (mobileAccordion) {
    return (
      <section className="ix-launch-panel ix-launch-panel--params ix-launch-panel--accordion">
        <button type="button" className="ix-launch-panel__accordion-head" onClick={() => setOpen((v) => !v)}>
          <span>Параметры запуска</span>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
        {open ? body : null}
      </section>
    );
  }

  return (
    <section className="ix-launch-panel ix-launch-panel--params">
      <h3 className="ix-launch-panel__title">Параметры запуска</h3>
      {body}
    </section>
  );
}

export function LaunchResultsSection({ results }) {
  const rows = Array.isArray(results) ? results : [];
  return (
    <section className="ix-launch-panel ix-launch-panel--results">
      <h3 className="ix-launch-panel__title">Результаты</h3>
      {rows.length === 0 ? (
        <p className="ix-results-empty">Результатов пока нет</p>
      ) : (
        <div className="ix-results-table-wrap">
          <table className="ix-results-table">
            <thead>
              <tr>
                <th>Ученик</th>
                <th>Результат</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id || index}>
                  <td data-label="Ученик">{row.student || row.studentName || "—"}</td>
                  <td data-label="Результат">{row.score ?? row.result ?? "—"}</td>
                  <td data-label="Дата">{row.date || row.completedAt || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LaunchInfoBar({
  interactive,
  authorName,
  summaryChips = [],
  canStart = true,
  started = false,
  onBack,
  onPublish,
  onStart,
  onRestart,
  onEdit,
  onAssign,
  onShare,
  onDuplicate,
  onUnpublish,
  onDelete,
  onAccessSettings,
}) {
  const typeMeta = getTypeMeta(interactive.type);
  const statusMeta = getStatusMeta(interactive.status);
  const canPublish = interactive.status === "draft" || interactive.status === "review";
  const canShare = canShareInteractive(interactive);
  const canAssign = canAssignInteractive(interactive);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const close = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [moreOpen]);

  return (
    <section className="ix-launch-info ix-launch-info--v2">
      <div className="ix-launch-info__meta">
        <div className="ix-launch-info__nav">
          <button type="button" className="ix-launch-info__back" onClick={onBack}>
            ← К списку
          </button>
        </div>
        <h2 className="ix-launch-info__title">{getInteractiveDisplayTitle(interactive)}</h2>
        <p className="ix-launch-info__line">
          <span>{typeMeta.shortLabel}</span>
          <span className="ix-launch-info__dot">·</span>
          <span>{authorName || "Учитель"}</span>
          <span className="ix-launch-info__dot">·</span>
          <span className={`ix-status-badge ix-status-badge--${statusMeta.tone}`}>
            {statusMeta.label}
          </span>
        </p>
        <LaunchSummaryChips chips={summaryChips} />
      </div>
      <div className="ix-launch-info__actions ix-launch-info__actions--v2">
        {canPublish ? (
          <button type="button" className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill" onClick={onPublish}>
            Опубликовать
          </button>
        ) : (
          <button
            type="button"
            className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill"
            disabled={!canStart}
            onClick={onStart}
          >
            {started ? "Продолжить" : "Начать"}
          </button>
        )}
        {started ? (
          <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={onRestart}>
            Начать заново
          </button>
        ) : null}
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm ix-launch-info__edit" onClick={onEdit}>
          Редактировать
        </button>
        <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onDuplicate}>
          Дублировать
        </button>
        <div className={`ix-launch-more${moreOpen ? " is-open" : ""}`} ref={moreRef}>
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-btn--sm"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-label="Дополнительные действия"
          >
            Ещё
          </button>
          {moreOpen ? (
            <div className="ix-launch-more__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={!canShare}
                title={canShare ? "" : "Сначала опубликуйте интерактив"}
                onClick={() => { setMoreOpen(false); onShare?.(); }}
              >
                Скопировать ссылку
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canAssign}
                title={canAssign ? "" : "Сначала опубликуйте интерактив"}
                onClick={() => { setMoreOpen(false); onAssign?.(); }}
              >
                Выдать
              </button>
              {!canPublish ? (
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onUnpublish?.(); }}>
                  Снять с публикации
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onAccessSettings?.(); }}>
                Настройки доступа
              </button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMoreOpen(false); onDelete?.(); }}>
                Удалить
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
