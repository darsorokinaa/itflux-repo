import { useEffect, useState } from "react";
import { myFileDownloadUrl, myFilePreviewUrl } from "../../../utils/cabinetAuth";
import CabinetIcon from "../../CabinetIcons";
import { extLabel, formatBytes, formatDate, previewKind } from "./fileUtils";

export function FileThumb({ item, student, size = "sm" }) {
  const kind = previewKind(item);
  const [failed, setFailed] = useState(false);

  if (kind === "folder") {
    return (
      <div className={`cb-files__thumb cb-files__thumb--folder cb-files__thumb--${size}`} aria-hidden>
        <span className="cb-files__folder-icon">
          <CabinetIcon name="folder" />
        </span>
      </div>
    );
  }

  if (kind === "image" && !failed) {
    return (
      <div className={`cb-files__thumb cb-files__thumb--${size}`}>
        <img
          src={myFilePreviewUrl(item.id, { student })}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  if (kind === "video" && !failed) {
    return (
      <div className={`cb-files__thumb cb-files__thumb--video cb-files__thumb--${size}`}>
        <video
          src={myFilePreviewUrl(item.id, { student })}
          muted
          preload="metadata"
          onError={() => setFailed(true)}
        />
        <span className="cb-files__thumb-badge">Видео</span>
      </div>
    );
  }

  const tone = {
    pdf: "pdf",
    audio: "audio",
    text: "text",
    image: "image",
    video: "video",
    file: "file",
  }[kind] || "file";

  return (
    <div className={`cb-files__thumb cb-files__thumb--${tone} cb-files__thumb--${size}`} aria-hidden>
      <span className="cb-files__thumb-ext">{extLabel(item)}</span>
    </div>
  );
}

function PreviewBody({ file, student }) {
  const kind = previewKind(file);
  const previewUrl = myFilePreviewUrl(file.id, { student });
  const [textPreview, setTextPreview] = useState("");
  const [textError, setTextError] = useState("");

  useEffect(() => {
    if (kind !== "text") {
      setTextPreview("");
      setTextError("");
      return undefined;
    }
    let cancelled = false;
    fetch(previewUrl, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("preview");
        const text = await res.text();
        if (!cancelled) setTextPreview(text.slice(0, 8000));
      })
      .catch(() => {
        if (!cancelled) setTextError("Не удалось загрузить текстовое превью");
      });
    return () => {
      cancelled = true;
    };
  }, [kind, previewUrl, file.id]);

  if (kind === "image") {
    return (
      <div className="cb-files-viewer__media">
        <img src={previewUrl} alt={file.display_name || file.name || ""} />
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <div className="cb-files-viewer__pdf">
        <iframe title={file.display_name || "PDF"} src={previewUrl} />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="cb-files-viewer__media">
        <video src={previewUrl} controls preload="metadata" />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="cb-files-viewer__media cb-files-viewer__media--audio">
        <audio src={previewUrl} controls preload="metadata" />
      </div>
    );
  }
  if (kind === "text") {
    return (
      <div className="cb-files-viewer__text">
        {textError ? <p>{textError}</p> : null}
        {!textError && !textPreview ? <p>Загрузка превью…</p> : null}
        {textPreview ? <pre>{textPreview}</pre> : null}
      </div>
    );
  }
  return (
    <div className="cb-files-viewer__fallback">
      <FileThumb item={file} student={student} size="lg" />
      <p>Превью для этого формата недоступно.</p>
      <dl>
        <div><dt>Тип</dt><dd>{extLabel(file)}</dd></div>
        <div><dt>Размер</dt><dd>{formatBytes(file.size)}</dd></div>
        <div><dt>Изменён</dt><dd>{formatDate(file.updated_at)}</dd></div>
      </dl>
    </div>
  );
}

export default function FilePreviewModal({
  file,
  student = false,
  files = [],
  onClose,
  onChange,
  onMenu,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "ArrowLeft") {
        const fileItems = files.filter((item) => item.kind === "file");
        const index = fileItems.findIndex((item) => item.id === file.id);
        if (index > 0) onChange?.(fileItems[index - 1]);
      }
      if (e.key === "ArrowRight") {
        const fileItems = files.filter((item) => item.kind === "file");
        const index = fileItems.findIndex((item) => item.id === file.id);
        if (index >= 0 && index < fileItems.length - 1) onChange?.(fileItems[index + 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, files, onClose, onChange]);

  if (!file) return null;
  const fileItems = files.filter((item) => item.kind === "file");
  const index = fileItems.findIndex((item) => item.id === file.id);
  const prev = index > 0 ? fileItems[index - 1] : null;
  const next = index >= 0 && index < fileItems.length - 1 ? fileItems[index + 1] : null;

  return (
    <div className="cb-files-viewer" role="dialog" aria-modal="true" aria-label="Предпросмотр">
      <div className="cb-files-viewer__bar">
        <div className="cb-files-viewer__title">
          <strong>{file.display_name || file.name}</strong>
          <span>{extLabel(file)} · {formatBytes(file.size)}</span>
        </div>
        <div className="cb-files-viewer__actions">
          {prev ? (
            <button type="button" className="cb-btn cb-btn--outline" onClick={() => onChange?.(prev)}>
              Назад
            </button>
          ) : null}
          {next ? (
            <button type="button" className="cb-btn cb-btn--outline" onClick={() => onChange?.(next)}>
              Далее
            </button>
          ) : null}
          <a className="cb-btn cb-btn--outline" href={myFileDownloadUrl(file.id, { student })} target="_blank" rel="noreferrer">
            Скачать
          </a>
          {onMenu ? (
            <button type="button" className="cb-files__menu-btn" aria-label="Действия" onClick={(e) => onMenu(e, file)}>
              ⋯
            </button>
          ) : null}
          <button type="button" className="cb-modal__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </div>
      </div>
      <div className="cb-files-viewer__body">
        <PreviewBody file={file} student={student} />
      </div>
    </div>
  );
}
