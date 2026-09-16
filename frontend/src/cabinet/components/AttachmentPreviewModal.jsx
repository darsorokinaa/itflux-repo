import { useEffect } from "react";
import CabinetModal from "./CabinetModal";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|heic|heif)(?:\?|$)/i;
const PDF_RE = /\.pdf(?:\?|$)/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(?:\?|$)/i;

function fileLabel(file) {
  return String(
    file?.filename || file?.name || file?.original_name || file?.title || "Файл",
  ).trim() || "Файл";
}

function fileProbe(file) {
  return String(
    file?.filename
      || file?.name
      || file?.original_name
      || file?.title
      || file?.preview_url
      || file?.url
      || "",
  );
}

export function attachmentPreviewKind(file) {
  if (!file) return "";
  if (file.preview_kind === "image" || file.preview_kind === "pdf" || file.preview_kind === "video") {
    return file.preview_kind;
  }
  const mime = String(file.mime_type || file.content_type || file.contentType || "").toLowerCase();
  const probe = fileProbe(file);
  if (file.is_image || file.isImage || mime.startsWith("image/") || IMAGE_RE.test(probe)) return "image";
  if (mime === "application/pdf" || PDF_RE.test(probe)) return "pdf";
  if (mime.startsWith("video/") || VIDEO_RE.test(probe)) return "video";
  return "";
}

/** Для shared/cabinet files download → preview; иначе исходный url. */
export function resolveAttachmentPreviewSrc(file) {
  const preview = String(file?.preview_url || "").trim();
  if (preview) return preview;
  const url = String(file?.url || "").trim();
  if (!url) return "";
  if (/\/download\/?(\?|$)/i.test(url)) {
    return url.replace(/\/download\/?(?=\?|$)/i, "/preview/");
  }
  return url;
}

export function resolveAttachmentOpenSrc(file) {
  return String(file?.url || file?.preview_url || file?.file_url || "").trim();
}

export function isAttachmentPreviewable(file) {
  return Boolean(attachmentPreviewKind(file) && resolveAttachmentPreviewSrc(file));
}

export function openAttachmentPreferPreview(file, setPreview) {
  if (!file) return;
  if (isAttachmentPreviewable(file) && typeof setPreview === "function") {
    setPreview(file);
    return;
  }
  const href = resolveAttachmentOpenSrc(file);
  if (!href || typeof window === "undefined") return;
  window.open(href, "_blank", "noopener,noreferrer");
}

export default function AttachmentPreviewModal({ file, onClose }) {
  const kind = attachmentPreviewKind(file);
  const src = resolveAttachmentPreviewSrc(file);
  const openHref = resolveAttachmentOpenSrc(file) || src;
  const title = fileLabel(file);

  useEffect(() => {
    if (!file) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose]);

  if (!file || !src) return null;

  return (
    <CabinetModal
      title={title}
      onClose={onClose}
      wide
      footer={(
        <>
          {openHref ? (
            <a className="cb-btn cb-btn--outline" href={openHref} target="_blank" rel="noreferrer">
              Открыть снаружи
            </a>
          ) : null}
          {openHref ? (
            <a className="cb-btn cb-btn--outline" href={openHref} download>
              Скачать
            </a>
          ) : null}
          <button type="button" className="cb-btn cb-btn--primary" onClick={onClose}>
            Закрыть
          </button>
        </>
      )}
    >
      <div className={`att-preview att-preview--${kind || "file"}`}>
        {kind === "image" ? (
          <img src={src} alt={title} />
        ) : null}
        {kind === "pdf" ? (
          <object className="att-preview__pdf" data={src} type="application/pdf" title={title}>
            <iframe src={src} title={title} />
            <p className="att-preview__empty">
              Предпросмотр PDF недоступен в этом браузере.{" "}
              {openHref ? (
                <a href={openHref} target="_blank" rel="noreferrer">Открыть файл</a>
              ) : null}
            </p>
          </object>
        ) : null}
        {kind === "video" ? (
          <video src={src} controls playsInline preload="metadata" />
        ) : null}
        {!["image", "pdf", "video"].includes(kind) ? (
          <p className="att-preview__empty">Предпросмотр для этого файла недоступен.</p>
        ) : null}
      </div>
    </CabinetModal>
  );
}
