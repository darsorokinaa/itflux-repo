import { useRef } from "react";
import { Copy, PanelLeft, Plus, Trash2, Upload } from "lucide-react";

function pagePreview(page) {
  const source = page?.source_attachment;
  const filename = source?.filename || "";
  const url = page?.background_url || source?.url || "";
  const isImage = Boolean(page?.background_url)
    || /\.(jpe?g|png|webp|gif|bmp|heic|heif)($|\?)/i.test(filename || url);
  if (url && isImage) return { kind: "image", url };
  if (source) return { kind: "file", name: filename || "Файл" };
  return { kind: "blank" };
}

export default function NotebookPagesDrawer({
  pages,
  pageIndex,
  onSelect,
  onAddBlank,
  onAddFile,
  onDuplicate,
  onDelete,
  onReorder,
  readOnly,
  open,
  onClose,
}) {
  const fileRef = useRef(null);
  if (!open) return null;
  const onDrop = (from, to) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder?.(next.map((page, index) => ({ ...page, page_number: index + 1 })));
  };
  return (
    <aside className="hw-nb-drawer" aria-label="Страницы тетради">
      <header className="hw-nb-side-heading">
        <h2>Страницы</h2>
        <span className="hw-nb-count">{pages.length}</span>
        <button type="button" className="hw-nb-icon-btn" onClick={onClose} aria-label="Скрыть страницы">
          <PanelLeft size={16} />
        </button>
      </header>
      <div className="hw-nb-thumbs">
        {pages.map((page, index) => {
          const preview = pagePreview(page);
          const active = index === pageIndex;
          return (
            <button
              key={page.id}
              type="button"
              className={`hw-nb-thumb${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              draggable={!readOnly}
              onClick={() => onSelect(index)}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onDrop(Number(event.dataTransfer.getData("text/plain")), index);
              }}
            >
              <span className="hw-nb-thumb-sheet">
                {preview.kind === "image" ? <img src={preview.url} alt="" /> : null}
                {preview.kind === "file" ? <span className="hw-nb-thumb-file">{preview.name}</span> : null}
                {preview.kind === "blank" ? <span className="hw-nb-thumb-blank" /> : null}
              </span>
              <span className="hw-nb-thumb-label">Страница {index + 1}</span>
            </button>
          );
        })}
      </div>
      {!readOnly ? (
        <footer className="hw-nb-side-bottom">
          <button type="button" className="hw-nb-side-btn hw-nb-side-btn--soft" onClick={onAddBlank}>
            <Plus size={16} />
            Новая страница
          </button>
          <button type="button" className="hw-nb-side-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
            Загрузить работу
          </button>
          <p className="hw-nb-side-note">Фото, скан или файл ученика</p>
          <div className="hw-nb-side-extra">
            <button type="button" onClick={onDuplicate} disabled={!pages[pageIndex]}>
              <Copy size={14} />
              Дублировать
            </button>
            <button type="button" onClick={onDelete} disabled={pages.length <= 1}>
              <Trash2 size={14} />
              Удалить
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/*,.pdf,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onAddFile?.(file);
            }}
          />
        </footer>
      ) : null}
    </aside>
  );
}
