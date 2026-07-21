import { useRef, useState } from "react";
import { attachMyFile, uploadMyFile } from "../../utils/cabinetAuth";
import { buildLinkMaterialPayload } from "../planItemAttachments";
import { buildVariantMaterialFromNumber } from "../variantMaterialUtils";
import MyFilesPickerModal from "./MyFilesPickerModal";

export default function PlanItemCustomMaterialForm({ mode, onSubmit, saving, error }) {
  const fileRef = useRef(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [variantNumber, setVariantNumber] = useState("");
  const [localError, setLocalError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const displayError = localError || error;
  const isBusy = saving || busy;

  const labels = {
    file: "Файлы",
    link: "Ссылка",
    variant: "Вариант",
  };

  const attachCabinetFileAsMaterial = async (cabinetFile) => {
    const result = await attachMyFile(cabinetFile.id, { target_type: "material" });
    const material = result.material || {
      id: result.material_id,
      title: cabinetFile.display_name || cabinetFile.name,
      material_type: "file",
      file_url: cabinetFile.download_url,
      cabinet_file_id: cabinetFile.id,
    };
    await onSubmit(material, { fromCabinetFile: true });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError("");
    try {
      if (mode === "file") {
        const files = Array.from(fileRef.current?.files || []);
        if (!files.length) return;
        setBusy(true);
        for (const file of files) {
          const uploaded = await uploadMyFile(file);
          await attachCabinetFileAsMaterial(uploaded);
        }
        if (fileRef.current) fileRef.current.value = "";
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
    } finally {
      setBusy(false);
    }
  };

  const handlePickFromFiles = async (picked) => {
    setLocalError("");
    setBusy(true);
    try {
      const files = Array.isArray(picked) ? picked : [picked];
      for (const file of files) {
        if (file?.kind === "file" || file?.id) {
          await attachCabinetFileAsMaterial(file);
        }
      }
    } catch (err) {
      setLocalError(err?.message || "Не удалось прикрепить файл");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="cb-plan-custom-material" onSubmit={handleSubmit}>
        {mode === "file" ? (
          <>
            <label className="cb-field">
              <span>Загрузить с устройства</span>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.zip"
              />
              <span className="cb-field__hint">
                Файл сохранится в «Мои файлы» и будет прикреплён без лишних копий
              </span>
            </label>
            <button
              type="button"
              className="cb-btn cb-btn--outline cb-btn--sm"
              onClick={() => setPickerOpen(true)}
              disabled={isBusy}
            >
              Выбрать из Моих файлов
            </button>
          </>
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
        <button type="submit" className="cb-btn cb-btn--primary cb-btn--sm" disabled={isBusy}>
          {isBusy ? "Добавление…" : `Добавить ${labels[mode].toLowerCase()}`}
        </button>
      </form>
      <MyFilesPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiSelect
        onSelect={handlePickFromFiles}
      />
    </>
  );
}
