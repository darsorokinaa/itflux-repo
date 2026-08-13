import { useState } from "react";
import CabinetModal from "../../components/CabinetModal";
import { LibraryDiskThumb } from "../../components/MaterialsDiskBrowser";

export function isMaterialPreviewable(item) {
  const kind = item?.preview_kind || "";
  return Boolean(item?.preview_url) && (kind === "image" || kind === "pdf" || kind === "video");
}

export function StudentMaterialThumb({ item, size = "sm" }) {
  return <LibraryDiskThumb item={item} size={size} />;
}

export function StudentMaterialPreviewModal({ item, onClose }) {
  if (!item) return null;
  const kind = item.preview_kind;
  const src = item.preview_url;
  const downloadHref = item.file_url || src;

  return (
    <CabinetModal
      title={item.title || "Просмотр файла"}
      onClose={onClose}
      wide
      footer={(
        <>
          {downloadHref ? (
            <a className="cb-btn cb-btn--outline" href={downloadHref} download>
              Скачать
            </a>
          ) : null}
          <button type="button" className="cb-btn cb-btn--primary" onClick={onClose}>
            Закрыть
          </button>
        </>
      )}
    >
      <div className={`st-mat-preview st-mat-preview--${kind || "file"}`}>
        {kind === "image" ? (
          <img src={src} alt={item.title || "Изображение"} />
        ) : null}
        {kind === "pdf" ? (
          <iframe src={src} title={item.title || "PDF"} />
        ) : null}
        {kind === "video" ? (
          <video src={src} controls playsInline />
        ) : null}
        {!["image", "pdf", "video"].includes(kind) ? (
          <p className="st-mat-preview__empty">Предпросмотр для этого файла недоступен.</p>
        ) : null}
      </div>
    </CabinetModal>
  );
}
