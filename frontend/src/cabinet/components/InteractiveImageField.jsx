import { useId, useState } from "react";

export default function InteractiveImageField({
  label,
  value,
  onUpload,
  onClear,
  uploading = false,
  compact = false,
}) {
  const [localError, setLocalError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  const handleFile = async (file) => {
    if (!file || !onUpload) return;
    setLocalError("");
    try {
      await onUpload(file);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Не удалось загрузить изображение");
    }
  };

  const handleSelect = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await handleFile(file);
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
        <div className="ix-ed-image-field__filled">
          <img src={value} alt={label || "Изображение"} className="ix-ed-image-field__preview" loading="lazy" />
          <div className="ix-ed-image-field__actions">
            <button
              type="button"
              className="cb-btn cb-btn--outline cb-btn--sm"
              onClick={() => document.getElementById(inputId)?.click()}
              disabled={uploading}
            >
              {uploading ? "Загрузка…" : "Заменить"}
            </button>
            <button
              type="button"
              className="cb-btn cb-btn--ghost cb-btn--sm"
              onClick={onClear}
              disabled={uploading}
            >
              Удалить
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`ix-ed-image-field__dropzone${dragging ? " is-dragging" : ""}`}
          disabled={uploading}
          onClick={() => document.getElementById(inputId)?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            handleFile(file);
          }}
        >
          <span className="ix-ed-image-field__dropzone-plus" aria-hidden="true">+</span>
          <span className="ix-ed-image-field__dropzone-title">
            {uploading ? "Загрузка…" : "Добавить изображение"}
          </span>
          <span className="ix-ed-image-field__dropzone-hint">PNG, JPG, WEBP</span>
        </button>
      )}
      {localError ? <p className="ix-ed-image-field__error">{localError}</p> : null}
    </div>
  );
}
