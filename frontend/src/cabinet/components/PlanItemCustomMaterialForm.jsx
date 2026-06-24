import { useRef, useState } from "react";
import { buildLinkMaterialPayload } from "../planItemAttachments";
import { buildVariantMaterialFromNumber } from "../variantMaterialUtils";

export default function PlanItemCustomMaterialForm({ mode, onSubmit, saving, error }) {
  const fileRef = useRef(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [variantNumber, setVariantNumber] = useState("");
  const [localError, setLocalError] = useState("");
  const displayError = localError || error;

  const labels = {
    file: "Файлы",
    link: "Ссылка",
    variant: "Вариант",
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError("");
    try {
      if (mode === "file") {
        const files = Array.from(fileRef.current?.files || []);
        if (!files.length) return;
        for (const file of files) {
          const formData = new FormData();
          formData.append("title", file.name);
          formData.append("material_type", file.type.includes("pdf") ? "presentation" : "file");
          formData.append("file", file);
          await onSubmit(formData);
        }
        return;
      }
      if (mode === "variant") {
        const payload = await buildVariantMaterialFromNumber(variantNumber);
        await onSubmit(payload);
        return;
      }
      if (!title.trim() || !url.trim()) return;
      await onSubmit(buildLinkMaterialPayload({ title, url }));
    } catch (err) {
      setLocalError(err?.message || "Не удалось добавить материал");
    }
  };

  return (
    <form className="cb-plan-custom-material" onSubmit={handleSubmit}>
      {mode === "file" ? (
        <label className="cb-field">
          <span>Файлы</span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.doc,.docx"
          />
          <span className="cb-field__hint">Можно выбрать несколько файлов: PDF, презентация или изображение</span>
        </label>
      ) : mode === "variant" ? (
        <label className="cb-field">
          <span>Номер варианта</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={variantNumber}
            onChange={(e) => setVariantNumber(e.target.value.replace(/\D/g, ""))}
            placeholder="Например, 3274505"
          />
          <span className="cb-field__hint">Номер сгенерированного варианта с платформы</span>
        </label>
      ) : (
        <>
          <label className="cb-field">
            <span>Название</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название материала"
            />
          </label>
          <label className="cb-field">
            <span>URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
        </>
      )}
      {displayError ? <p className="cb-modal-form__error" role="alert">{displayError}</p> : null}
      <button type="submit" className="cb-btn cb-btn--primary cb-btn--sm" disabled={saving}>
        {saving ? "Добавление…" : `Добавить ${labels[mode].toLowerCase()}`}
      </button>
    </form>
  );
}
