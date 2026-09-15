import { useRef } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";

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
    <div className="hw-nb-drawer" role="dialog" aria-label="Страницы">
      <header>
        <strong>Страницы</strong>
        <button type="button" className="hw-nb-ghost" onClick={onClose} aria-label="Закрыть">✕</button>
      </header>
      <div className="hw-nb-thumbs">
        {pages.map((page, index) => (
          <button
            key={page.id}
            type="button"
            className={`hw-nb-thumb${index === pageIndex ? " is-active" : ""}`}
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
            {page.background_url || (page.source_attachment?.url && /\.(jpe?g|png|webp|gif|bmp|heic|heif)($|\?)/i.test(page.source_attachment?.filename || page.source_attachment.url)) ? (
              <img src={page.background_url || page.source_attachment.url} alt="" />
            ) : page.source_attachment ? (
              <span className="hw-nb-thumb-file">{page.source_attachment.filename || "Файл"}</span>
            ) : (
              <span className="hw-nb-thumb-blank" />
            )}
            <em>{index + 1}</em>
          </button>
        ))}
      </div>
      {!readOnly ? (
        <footer>
          <button type="button" className="hw-nb-ghost" onClick={onAddBlank}><Plus size={16} /> Пустая</button>
          <button type="button" className="hw-nb-ghost" onClick={() => fileRef.current?.click()}><Plus size={16} /> Файл</button>
          <button type="button" className="hw-nb-ghost" onClick={onDuplicate} disabled={!pages[pageIndex]}><Copy size={16} /> Дублировать</button>
          <button type="button" className="hw-nb-ghost" onClick={onDelete} disabled={pages.length <= 1}><Trash2 size={16} /> Удалить</button>
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
    </div>
  );
}
