import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteHomeworkAttachment,
  fetchHomeworkAttachments,
  uploadHomeworkAttachments,
} from "../../utils/cabinetAuth";
import CabinetIcon from "../CabinetIcons";

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function isImageAttachment(item) {
  if (item?.is_image) return true;
  const mime = String(item?.mime_type || item?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  const name = String(item?.name || item?.original_name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)$/i.test(name);
}

function extensionOf(name) {
  const text = String(name || "");
  const idx = text.lastIndexOf(".");
  if (idx < 0) return "";
  return text.slice(idx + 1).toUpperCase();
}

/**
 * Область «Фото и файлы» для ДЗ.
 * mode="pending" — файлы до создания ДЗ (локальный список).
 * mode="remote" — существующее ДЗ (API attachments).
 */
export default function HomeworkAttachmentsField({
  homeworkId = null,
  pendingFiles = [],
  onPendingFilesChange,
  disabled = false,
  readOnly = false,
  compact = false,
}) {
  const inputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [fileErrors, setFileErrors] = useState([]);
  const [busyIds, setBusyIds] = useState({});

  const isRemote = Boolean(homeworkId);

  const loadRemote = useCallback(async () => {
    if (!homeworkId) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchHomeworkAttachments(homeworkId);
      setItems(data.attachments || []);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить вложения");
    } finally {
      setLoading(false);
    }
  }, [homeworkId]);

  useEffect(() => {
    if (isRemote) {
      void loadRemote();
    }
  }, [isRemote, loadRemote]);

  const displayItems = useMemo(() => {
    if (isRemote) return items;
    return (pendingFiles || []).map((file, index) => ({
      id: `pending-${index}-${file.name}`,
      name: file.name,
      original_name: file.name,
      size: file.size,
      mime_type: file.type,
      is_image: isImageAttachment({ type: file.type, name: file.name }),
      preview_url: file.type?.startsWith("image/") ? URL.createObjectURL(file) : "",
      pending: true,
      file,
    }));
  }, [isRemote, items, pendingFiles]);

  useEffect(() => () => {
    displayItems.forEach((item) => {
      if (item.pending && item.preview_url) {
        URL.revokeObjectURL(item.preview_url);
      }
    });
  }, [displayItems]);

  const addPending = (fileList) => {
    const next = Array.from(fileList || []);
    if (!next.length) return;
    const merged = [...(pendingFiles || [])];
    next.forEach((file) => {
      const exists = merged.some(
        (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified,
      );
      if (!exists) merged.push(file);
    });
    onPendingFilesChange?.(merged);
  };

  const removePending = (index) => {
    const next = (pendingFiles || []).filter((_, i) => i !== index);
    onPendingFilesChange?.(next);
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !homeworkId) return;
    setUploading(true);
    setError("");
    setFileErrors([]);
    try {
      const result = await uploadHomeworkAttachments(homeworkId, files);
      setItems(result.all_attachments || result.attachments || []);
      if (result.errors?.length) {
        setFileErrors(result.errors);
      }
    } catch (err) {
      const data = err?.data;
      if (data?.errors?.length) {
        setFileErrors(data.errors);
        if (data.all_attachments) setItems(data.all_attachments);
      }
      setError(err?.message || "Не удалось загрузить файлы");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleFiles = (fileList) => {
    if (disabled || readOnly) return;
    if (isRemote) {
      void uploadFiles(fileList);
    } else {
      addPending(fileList);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDeleteRemote = async (attachment) => {
    if (!homeworkId || !attachment?.id) return;
    setBusyIds((prev) => ({ ...prev, [attachment.id]: true }));
    setError("");
    try {
      const result = await deleteHomeworkAttachment(homeworkId, attachment.id);
      setItems(result.attachments || []);
    } catch (err) {
      setError(err?.message || "Не удалось удалить вложение");
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    }
  };

  return (
    <div className={`cb-hw-attachments${compact ? " cb-hw-attachments--compact" : ""}`}>
      <div className="cb-hw-assign-section-head">
        <h3 className="cb-attach-section__title">Фото и файлы</h3>
        {!readOnly ? (
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Загрузка…" : "Прикрепить файлы"}
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="cb-hw-attachments__input"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.png,.jpg,.jpeg,.webp"
        disabled={disabled || readOnly || uploading}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {!readOnly ? (
        <div
          className={`cb-hw-attachments__drop${dragOver ? " is-dragover" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <CabinetIcon name="folder" />
          <span>Перетащите фото и файлы сюда или нажмите «Прикрепить файлы»</span>
          <span className="cb-hw-attachments__hint">
            Можно выбрать несколько файлов за один раз. Изображения и документы.
          </span>
        </div>
      ) : null}

      {loading ? <p className="cabinet-auth-muted">Загрузка вложений…</p> : null}
      {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
      {fileErrors.length ? (
        <ul className="cb-hw-attachments__errors">
          {fileErrors.map((err, i) => (
            <li key={`${err.name}-${i}`}>
              <strong>{err.name || "Файл"}:</strong> {err.detail}
            </li>
          ))}
        </ul>
      ) : null}

      {displayItems.length ? (
        <ul className="cb-hw-attachments__list">
          {displayItems.map((item, index) => {
            const image = isImageAttachment(item);
            const preview = item.preview_url || (image ? item.url : "");
            const openUrl = item.url || preview;
            return (
              <li
                key={item.id || `${item.name}-${index}`}
                className={`cb-hw-attachments__item${image ? " is-image" : ""}`}
              >
                {image && preview ? (
                  <a
                    className="cb-hw-attachments__thumb"
                    href={openUrl || preview}
                    target="_blank"
                    rel="noreferrer"
                    title={item.name}
                  >
                    <img src={preview} alt={item.name || "Изображение"} />
                  </a>
                ) : (
                  <span className="cb-hw-attachments__file-icon" aria-hidden="true">
                    <CabinetIcon name="file" />
                  </span>
                )}
                <span className="cb-hw-attachments__meta">
                  <span className="cb-hw-attachments__name">{item.name || item.original_name}</span>
                  <span className="cb-hw-attachments__sub">
                    {[extensionOf(item.name || item.original_name), formatSize(item.size)]
                      .filter(Boolean)
                      .join(" · ")}
                    {item.pending ? " · не сохранено" : ""}
                  </span>
                </span>
                <span className="cb-hw-attachments__actions">
                  {openUrl && !item.pending ? (
                    <a
                      className="cb-btn cb-btn--outline cb-btn--sm"
                      href={openUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть
                    </a>
                  ) : null}
                  {!readOnly ? (
                    <button
                      type="button"
                      className="cb-hw-attachments__remove"
                      disabled={disabled || busyIds[item.id]}
                      aria-label="Удалить вложение"
                      onClick={() => {
                        if (item.pending) removePending(index);
                        else void handleDeleteRemote(item);
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : !loading ? (
        <p className="cabinet-auth-muted">Файлы пока не прикреплены</p>
      ) : null}
    </div>
  );
}

/** Загрузить отложенные файлы на одно или несколько ДЗ. */
export async function uploadPendingHomeworkFiles(homeworkIds, files) {
  const ids = (Array.isArray(homeworkIds) ? homeworkIds : [homeworkIds]).filter(Boolean);
  const list = Array.isArray(files) ? files : [];
  if (!ids.length || !list.length) {
    return { uploaded: 0, errors: [] };
  }
  const errors = [];
  let uploaded = 0;
  for (const homeworkId of ids) {
    try {
      const result = await uploadHomeworkAttachments(homeworkId, list);
      uploaded += (result.attachments || []).length;
      (result.errors || []).forEach((err) => {
        errors.push({ homeworkId, ...err });
      });
    } catch (err) {
      errors.push({
        homeworkId,
        name: "",
        detail: err?.message || "Ошибка загрузки",
      });
    }
  }
  return { uploaded, errors };
}
