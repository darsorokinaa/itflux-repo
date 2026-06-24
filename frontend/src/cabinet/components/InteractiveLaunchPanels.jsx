import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PARAMS,
  VISUAL_THEMES,
  canShareInteractive,
  canAssignInteractive,
  formatUpdatedAt,
  getStatusMeta,
  getTypeMeta,
} from "../interactivesData";

export function VisualStylePicker({
  activeId,
  backgroundImage,
  backgroundImageTone = "light",
  onSelect,
  onImageUpload,
  onImageRemove,
  onImageToneChange,
}) {
  const inputId = "ix-bg-image-upload";

  return (
    <section className="ix-launch-panel">
      <h3 className="ix-launch-panel__title">Визуальный стиль</h3>
      <div className="ix-visual-themes">
        {VISUAL_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={`ix-visual-theme${activeId === theme.id ? " ix-visual-theme--active" : ""}`}
            onClick={() => onSelect(theme.id)}
            aria-pressed={activeId === theme.id}
          >
            <span className="ix-visual-theme__preview" style={{ background: theme.preview }} />
            <span className="ix-visual-theme__label">{theme.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`ix-visual-theme ix-visual-theme--custom${activeId === "custom" ? " ix-visual-theme--active" : ""}`}
          onClick={() => document.getElementById(inputId)?.click()}
          aria-pressed={activeId === "custom"}
        >
          <span
            className="ix-visual-theme__preview ix-visual-theme__preview--image"
            style={backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : undefined}
          >
            {!backgroundImage ? "+" : null}
          </span>
          <span className="ix-visual-theme__label">Своя картинка</span>
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
        <div className="ix-bg-custom-controls">
          <div className="ix-bg-custom-preview">
            <img src={backgroundImage} alt="" />
          </div>
          <div className="ix-bg-custom-actions">
            <label className="ix-param-row">
              <span>Тон текста на фоне</span>
              <select
                value={backgroundImageTone}
                onChange={(e) => onImageToneChange?.(e.target.value)}
              >
                <option value="light">Светлый</option>
                <option value="dark">Тёмный</option>
              </select>
            </label>
            <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={() => document.getElementById(inputId)?.click()}>
              Заменить
            </button>
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onImageRemove}>
              Убрать
            </button>
          </div>
        </div>
      ) : (
        <p className="ix-bg-upload-hint">JPG или PNG</p>
      )}
    </section>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="ix-param-row ix-param-row--toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function ParametersPanel({ params, onChange }) {
  const p = { ...DEFAULT_PARAMS, ...params };

  const set = (field, value) => onChange({ ...p, [field]: value });

  return (
    <section className="ix-launch-panel">
      <h3 className="ix-launch-panel__title">Параметры</h3>
      <div className="ix-params">
        <label className="ix-param-row">
          <span>Таймер</span>
          <select value={p.timerMode} onChange={(e) => set("timerMode", e.target.value)}>
            <option value="none">Нет</option>
            <option value="forward">Прямой счёт</option>
            <option value="countdown">Обратный счёт</option>
          </select>
        </label>
        {p.timerMode !== "none" ? (
          <div className="ix-param-row ix-param-row--time">
            <label>
              <span>Мин</span>
              <input
                type="number"
                min={0}
                max={99}
                value={p.timerMinutes}
                onChange={(e) => set("timerMinutes", Number(e.target.value) || 0)}
              />
            </label>
            <label>
              <span>Сек</span>
              <input
                type="number"
                min={0}
                max={59}
                value={p.timerSeconds}
                onChange={(e) => set("timerSeconds", Number(e.target.value) || 0)}
              />
            </label>
          </div>
        ) : null}
        <label className="ix-param-row">
          <span>Попытки</span>
          <input
            type="number"
            min={0}
            value={p.maxAttempts}
            onChange={(e) => set("maxAttempts", Number(e.target.value) || 0)}
            placeholder="0 = ∞"
          />
        </label>
        <ToggleRow label="Перемешивать" checked={p.shuffleQuestions} onChange={(v) => set("shuffleQuestions", v)} />
        <ToggleRow label="Показывать ответы" checked={p.showAnswersAtEnd} onChange={(v) => set("showAnswersAtEnd", v)} />
        <ToggleRow label="Пояснение после ответа" checked={p.showExplanationAfterAnswer} onChange={(v) => set("showExplanationAfterAnswer", v)} />
        <ToggleRow label="Повторное прохождение" checked={p.allowRetry} onChange={(v) => set("allowRetry", v)} />
        <ToggleRow label="Записывать результат" checked={p.recordInReport} onChange={(v) => set("recordInReport", v)} />
      </div>
    </section>
  );
}

export function ResultsPanel({ results }) {
  const rows = results || [];
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.scorePercent || 0) - (a.scorePercent || 0)),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <section className="ix-launch-panel">
        <h3 className="ix-launch-panel__title">Результаты</h3>
        <div className="ix-results-empty">
          Результатов пока нет
        </div>
      </section>
    );
  }

  return (
    <section className="ix-launch-panel">
      <h3 className="ix-launch-panel__title">Результаты</h3>
      <div className="cb-results-table-wrap ix-results-table-wrap">
        <table className="cb-results-table ix-results-table">
          <thead>
            <tr>
              <th>Место</th>
              <th>Ученик</th>
              <th>Баллы</th>
              <th>Время</th>
              <th>Дата</th>
              <th>Попытка</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => (
              <tr key={`${row.student}-${row.completedAt}-${index}`}>
                <td>{index + 1}</td>
                <td>{row.student}</td>
                <td>{row.scorePercent ?? "—"}%</td>
                <td>{row.durationMin != null ? `${row.durationMin} мин` : "—"}</td>
                <td>{formatUpdatedAt(row.completedAt)}</td>
                <td>{row.attempts ?? 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LaunchInfoBar({
  interactive,
  authorName,
  onTitleChange,
  onPublish,
  onEdit,
  onAssign,
  onShare,
  onDuplicate,
  onMore,
}) {
  const typeMeta = getTypeMeta(interactive.type);
  const statusMeta = getStatusMeta(interactive.status);
  const [titleDraft, setTitleDraft] = useState(interactive.title || "");
  const canPublish = interactive.status === "draft" || interactive.status === "review";
  const canShare = canShareInteractive(interactive);
  const canAssign = canAssignInteractive(interactive);

  useEffect(() => {
    setTitleDraft(interactive.title || "");
  }, [interactive.title]);

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next !== (interactive.title || "").trim()) {
      onTitleChange?.(next);
    }
  };

  return (
    <section className="ix-launch-info">
      <div className="ix-launch-info__meta">
        <input
          className="ix-launch-info__title-input"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
              e.currentTarget.blur();
            }
          }}
          placeholder="Название интерактива"
          aria-label="Название интерактива"
        />
        <p className="ix-launch-info__line">
          <span>{typeMeta.label}</span>
          <span className="ix-launch-info__dot">·</span>
          <span>{authorName || "Учитель"}</span>
          <span className="ix-launch-info__dot">·</span>
          <span className={`ix-status-badge ix-status-badge--${interactive.status === "published" ? "success" : interactive.status === "assigned" ? "info" : "gray"}`}>
            {statusMeta.label}
          </span>
        </p>
      </div>
      <div className="ix-launch-info__actions">
        {canPublish ? (
          <button type="button" className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill" onClick={onPublish}>
            Опубликовать
          </button>
        ) : null}
        <button
          type="button"
          className="cb-btn cb-btn--outline cb-btn--sm"
          disabled={!canAssign}
          title={canAssign ? "Выдать ученикам" : "Черновик нельзя выдать — сначала опубликуйте"}
          onClick={onAssign}
        >
          Выдать
        </button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={onEdit}>
          Редактировать
        </button>
        <button
          type="button"
          className="cb-btn cb-btn--ghost cb-btn--sm"
          disabled={!canShare}
          title={canShare ? "Скопировать ссылку для учеников" : "Доступно после публикации"}
          onClick={onShare}
        >
          Поделиться
        </button>
        <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onDuplicate}>
          Дублировать
        </button>
        <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onMore}>
          Больше
        </button>
      </div>
    </section>
  );
}
