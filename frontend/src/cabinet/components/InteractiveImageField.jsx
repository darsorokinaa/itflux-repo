import { useMemo, useState } from "react";

export default function InteractiveImageField({
  label,
  value,
  onUpload,
  onClear,
  uploading = false,
  compact = false,
}) {
  const [localError, setLocalError] = useState("");
  const inputId = useMemo(
    () => `ix-ed-image-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );

  const handleSelect = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUpload) return;
    setLocalError("");
    try {
      await onUpload(file);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Не удалось загрузить изображение");
    }
  };

  return (
    <div className={`ix-ed-image-field${compact ? " ix-ed-image-field--compact" : ""}`}>
      {label ? <span className="ix-ed-image-field__label">{label}</span> : null}
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="ix-ed-file-input"
        onChange={handleSelect}
      />
      {value ? (
        <img src={value} alt={label || "Изображение"} className="ix-ed-image-field__preview" loading="lazy" />
      ) : (
        <div className="ix-ed-image-field__empty">Изображение не прикреплено</div>
      )}
      <div className="ix-ed-image-field__actions">
        <button
          type="button"
          className="cb-btn cb-btn--outline cb-btn--sm"
          onClick={() => document.getElementById(inputId)?.click()}
          disabled={uploading}
        >
          {uploading ? "Загрузка…" : (value ? "Заменить файл" : "Прикрепить файл")}
        </button>
        {value ? (
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-btn--sm"
            onClick={onClear}
            disabled={uploading}
          >
            Убрать
          </button>
        ) : null}
      </div>
      {localError ? <p className="ix-ed-image-field__error">{localError}</p> : null}
    </div>
  );
}
