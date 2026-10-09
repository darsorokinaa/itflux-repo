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

/** Наши файлы, а не внешняя ссылка. Им нельзя открываться через target=_blank на iOS. */
export function isAppFileUrl(url) {
  const raw = String(url || "");
  return (
    raw.includes("/attached-file")
    || raw.includes("/homework/attachments/")
    || /\/files\/(?:shared\/)?[^/?#]+\/(?:download|preview)\/?(?:\?|#|$)/.test(raw)
    || /\/materials\/\d+\/(?:file|preview)\/?(?:\?|#|$)/.test(raw)
    || raw.includes("/media/")
    || raw.includes("/lesson/attachment/")
  );
}

export function prefersInPlaceFileOpen() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 900px)").matches;
}

/** inline — браузер показывает файл; download — отдаёт как вложение. */
export function withFileIntent(url, intent) {
  const raw = String(url || "").trim();
  if (!raw || !isAppFileUrl(raw) || raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(raw, base);
    if (intent === "download") {
      parsed.searchParams.delete("inline");
      parsed.searchParams.set("download", "1");
    } else {
      parsed.searchParams.delete("download");
      parsed.searchParams.set("inline", "1");
    }
    const sameApp = typeof window !== "undefined" && parsed.origin === window.location.origin;
    const localDev = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(parsed.origin);
    if ((/^https?:\/\//i.test(raw) && !localDev && !sameApp)) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

function presentFile(file) {
  const openSrc = resolveAttachmentOpenSrc(file);
  const previewSrc = resolveAttachmentPreviewSrc(file) || openSrc;
  return {
    ...file,
    url: withFileIntent(openSrc, "inline") || openSrc,
    preview_url: withFileIntent(previewSrc, "inline") || previewSrc,
  };
}

export function openAttachmentPreferPreview(file, setPreview) {
  if (!file) return;
  const kind = attachmentPreviewKind(file);
  const href = withFileIntent(resolveAttachmentOpenSrc(file), "inline") || resolveAttachmentOpenSrc(file);
  const mobile = prefersInPlaceFileOpen();
  const showSheet = kind === "image" || kind === "video" || (!mobile && isAttachmentPreviewable(file));
  if (showSheet && typeof setPreview === "function") {
    setPreview(presentFile(file));
    return;
  }
  if (!href || typeof window === "undefined") return;
  if (mobile && isAppFileUrl(href)) {
    window.location.assign(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Клик по ссылке: картинку и видео оставляем в окне, остальное на телефоне — обычный переход. */
export function attachmentOpenClick(file, setPreview) {
  return (event) => {
    if (!event || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return;
    const kind = attachmentPreviewKind(file);
    const mobile = prefersInPlaceFileOpen();
    const showSheet = kind === "image" || kind === "video" || (!mobile && isAttachmentPreviewable(file));
    if (!showSheet || typeof setPreview !== "function") return;
    event.preventDefault();
    openAttachmentPreferPreview(file, setPreview);
  };
}

export default function AttachmentPreviewModal({ file, onClose }) {
  const kind = attachmentPreviewKind(file);
  const src = resolveAttachmentPreviewSrc(file);
  const openHref = resolveAttachmentOpenSrc(file) || src;
  const inlineHref = withFileIntent(openHref, "inline") || openHref;
  const downloadHref = withFileIntent(openHref, "download") || openHref;
  const title = fileLabel(file);
  const inPlace = prefersInPlaceFileOpen();

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
          {inlineHref ? (
            <a
              className="cb-btn cb-btn--outline"
              href={inlineHref}
              {...(inPlace ? {} : { target: "_blank", rel: "noreferrer" })}
            >
              Открыть снаружи
            </a>
          ) : null}
          {downloadHref ? (
            <a
              className="cb-btn cb-btn--outline"
              href={downloadHref}
              {...(inPlace ? {} : { target: "_blank", rel: "noreferrer" })}
            >
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
          inPlace ? (
            <p className="att-preview__empty">
              На телефоне PDF открывается отдельным экраном.{" "}
              {inlineHref ? <a href={inlineHref}>Открыть PDF</a> : null}
            </p>
          ) : (
            <object className="att-preview__pdf" data={src} type="application/pdf" title={title}>
              <iframe src={src} title={title} />
              <p className="att-preview__empty">
                Предпросмотр PDF недоступен в этом браузере.{" "}
                {inlineHref ? (
                  <a href={inlineHref} target="_blank" rel="noreferrer">Открыть файл</a>
                ) : null}
              </p>
            </object>
          )
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
