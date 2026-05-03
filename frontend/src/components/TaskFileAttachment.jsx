/** Имя файла из URL для подписи к ссылке. */
function fileDisplayName(href) {
  const s = String(href || "").trim();
  if (!s) return "Архив с файлами задания";
  try {
    const u = new URL(s, typeof window !== "undefined" ? window.location.href : "http://localhost/");
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const decoded = decodeURIComponent(last.split("?")[0] || "");
    if (decoded) return decoded;
  } catch {
    /* fall through */
  }
  const tail = s.split("/").pop()?.split("?")[0] || "";
  try {
    const d = decodeURIComponent(tail);
    if (d) return d;
  } catch {
    if (tail) return tail;
  }
  return "Архив с файлами задания";
}

function fileExtensionUpper(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toUpperCase() : "";
}

/** Вторая строка под именем: тип файла · пояснение. */
function fileMetaLine(displayName) {
  const ext = fileExtensionUpper(displayName);
  const hints = {
    ZIP: "ZIP · материалы к заданию",
    "7Z": "7-Zip · материалы к заданию",
    RAR: "RAR · материалы к заданию",
    PDF: "PDF · документ",
    DOC: "DOC · документ",
    DOCX: "DOCX · документ",
    XLS: "XLS · таблица",
    XLSX: "XLSX · таблица",
    TXT: "TXT · текстовый файл",
    PNG: "PNG · изображение",
    JPG: "JPG · изображение",
    JPEG: "JPEG · изображение",
    GIF: "GIF · изображение",
    WEBP: "WEBP · изображение",
  };
  if (ext && hints[ext]) return hints[ext];
  if (ext) return `${ext} · материалы к заданию`;
  return "Файл · материалы к заданию";
}

const FILE_DOC_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const DOWNLOAD_SVG = (
  <svg className="file-download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/**
 * Карточка-ссылка на материалы к заданию (архив / файл).
 * Автор задания (в т.ч. «ФИПИ») выводится отдельно в разметке страницы — `.task-author`.
 */
export default function TaskFileAttachment({ href }) {
  if (!href) return null;
  const displayName = fileDisplayName(href);
  const meta = fileMetaLine(displayName);

  return (
    <div className="task-files">
      <a className="file-attachment" href={href} target="_blank" rel="noreferrer" download>
        <div className="file-icon">{FILE_DOC_SVG}</div>
        <div className="file-info">
          <span className="file-name">{displayName}</span>
          <span className="file-meta">{meta}</span>
        </div>
        {DOWNLOAD_SVG}
      </a>
    </div>
  );
}
