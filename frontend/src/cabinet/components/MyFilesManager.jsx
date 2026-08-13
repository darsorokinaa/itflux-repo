import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  copyMyFile,
  createMyFilesFolder,
  emptyMyFilesTrash,
  fetchGroups,
  fetchMyFile,
  fetchMyFiles,
  fetchStudents,
  moveMyFiles,
  myFileDownloadUrl,
  myFilePreviewUrl,
  purgeMyFile,
  restoreMyFile,
  restoreMyFilesFolder,
  trashMyFile,
  trashMyFilesFolder,
  updateMyFile,
  updateMyFilesFolder,
  uploadMyFile,
} from "../../utils/cabinetAuth";
import CabinetModal from "./CabinetModal";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import ConfirmActionModal from "./ConfirmActionModal";
import MyFileAssignModal from "./MyFileAssignModal";
import CabinetIcon from "../CabinetIcons";
import "../styles/my-files.css";

const SECTIONS = [
  { id: "my", label: "Мои файлы" },
  { id: "recent", label: "Недавние" },
  { id: "trash", label: "Корзина" },
];

const KIND_OPTIONS = [
  { value: "", label: "Все типы" },
  { value: "documents", label: "Документы" },
  { value: "images", label: "Изображения" },
  { value: "video", label: "Видео" },
  { value: "audio", label: "Аудио" },
  { value: "archives", label: "Архивы" },
  { value: "code", label: "Код" },
];

function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function extLabel(item) {
  if (item.kind === "folder") return "Папка";
  const ext = (item.extension || "").replace(".", "");
  return ext || "файл";
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a"]);
const TEXT_EXTS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".css", ".js", ".py", ".ts", ".jsx", ".tsx"]);
const PDF_EXTS = new Set([".pdf"]);

function normalizeExt(item) {
  const ext = (item?.extension || "").toLowerCase();
  if (!ext) return "";
  return ext.startsWith(".") ? ext : `.${ext}`;
}

function previewKind(item) {
  if (!item || item.kind === "folder") return "folder";
  const ext = normalizeExt(item);
  const mime = (item.mime_type || "").toLowerCase();
  if (IMAGE_EXTS.has(ext) || mime.startsWith("image/")) return "image";
  if (PDF_EXTS.has(ext) || mime === "application/pdf") return "pdf";
  if (VIDEO_EXTS.has(ext) || mime.startsWith("video/")) return "video";
  if (AUDIO_EXTS.has(ext) || mime.startsWith("audio/")) return "audio";
  if (TEXT_EXTS.has(ext) || mime.startsWith("text/")) return "text";
  return "file";
}

function FileThumb({ item, student, size = "sm" }) {
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

function FilePreviewPane({ file, student }) {
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
    setTextPreview("");
    setTextError("");
    fetch(previewUrl, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("preview");
        const text = await res.text();
        if (!cancelled) setTextPreview(text.slice(0, 4000));
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
      <div className="cb-files__preview cb-files__preview--image">
        <img src={previewUrl} alt={file.display_name || file.name || ""} />
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <div className="cb-files__preview cb-files__preview--pdf">
        <iframe title={file.display_name || "PDF"} src={previewUrl} />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="cb-files__preview cb-files__preview--media">
        <video src={previewUrl} controls preload="metadata" />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="cb-files__preview cb-files__preview--media">
        <audio src={previewUrl} controls preload="metadata" />
      </div>
    );
  }
  if (kind === "text") {
    return (
      <div className="cb-files__preview cb-files__preview--text">
        {textError ? <p className="cb-files__preview-empty">{textError}</p> : null}
        {!textError && !textPreview ? <p className="cb-files__preview-empty">Загрузка превью…</p> : null}
        {textPreview ? <pre>{textPreview}</pre> : null}
      </div>
    );
  }
  return (
    <div className="cb-files__preview cb-files__preview--card">
      <FileThumb item={file} student={student} size="lg" />
      <p className="cb-files__preview-empty">Превью для этого формата недоступно. Скачайте файл.</p>
    </div>
  );
}

export default function MyFilesManager({
  student = false,
  compact = false,
  selectable = false,
  multiSelect = false,
  onSelect,
  acceptKinds,
}) {
  const [section, setSection] = useState("my");
  const [folderId, setFolderId] = useState(null);
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: "Мои файлы" }]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [kind, setKind] = useState("");
  const [view, setView] = useState(compact ? "list" : "list");
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [menu, setMenu] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [purgeItem, setPurgeItem] = useState(null);
  const [purgeForce, setPurgeForce] = useState(false);
  const [purgeRelations, setPurgeRelations] = useState([]);
  const [assignItem, setAssignItem] = useState(null);
  const [studentFilter, setStudentFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (student || compact) return undefined;
    Promise.all([fetchStudents().catch(() => []), fetchGroups().catch(() => [])]).then(
      ([s, g]) => {
        const studentsList = Array.isArray(s) ? s : s?.results || [];
        const groupsList = Array.isArray(g) ? g : g?.results || [];
        setStudents(studentsList);
        setGroups(groupsList);
      },
    );
  }, [student, compact]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMyFiles(
        {
          section,
          folder_id: section === "my" ? folderId || "" : "",
          search: debouncedSearch,
          sort,
          kind,
          student_id: studentFilter,
          group_id: groupFilter,
          page_size: compact ? 40 : 100,
        },
        { student },
      );
      let nextItems = data.items || [];
      if (acceptKinds?.length) {
        nextItems = nextItems.filter(
          (item) => item.kind === "folder" || acceptKinds.includes((item.extension || "").toLowerCase()),
        );
      }
      setItems(nextItems);
      setBreadcrumbs(data.breadcrumbs || [{ id: null, name: "Мои файлы" }]);
      setQuota(data.quota || null);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить файлы");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [
    section,
    folderId,
    debouncedSearch,
    sort,
    kind,
    studentFilter,
    groupFilter,
    student,
    compact,
    acceptKinds,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const showNotice = (text) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2500);
  };

  const openItem = async (item) => {
    if (item.kind === "folder") {
      if (section === "trash") return;
      setSection("my");
      setFolderId(item.id);
      setSelected(null);
      return;
    }
    if (selectable) {
      if (multiSelect) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      } else {
        setSelected(item);
        onSelect?.(item);
      }
      return;
    }
    try {
      const detail = await fetchMyFile(item.id, { student });
      setSelected(detail);
    } catch {
      setSelected(item);
    }
  };

  const handleUploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        await uploadMyFile(file, {
          folderId: section === "my" ? folderId : null,
          student,
        });
      }
      showNotice(files.length > 1 ? "Файлы загружены" : "Файл загружен");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось загрузить файл");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCreateFolder = async () => {
    const name = window.prompt("Название папки");
    if (!name?.trim()) return;
    try {
      await createMyFilesFolder(
        { name: name.trim(), parent_id: section === "my" ? folderId : null },
        { student },
      );
      showNotice("Папка создана");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось создать папку");
    }
  };

  const handleRename = async () => {
    if (!renameItem) return;
    try {
      if (renameItem.kind === "folder") {
        await updateMyFilesFolder(renameItem.id, { name: renameValue }, { student });
      } else {
        await updateMyFile(renameItem.id, { display_name: renameValue }, { student });
      }
      setRenameItem(null);
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось переименовать");
    }
  };

  const handleTrash = async (item) => {
    try {
      if (item.kind === "folder") {
        await trashMyFilesFolder(item.id, { student });
      } else {
        await trashMyFile(item.id, { student });
      }
      if (selected?.id === item.id) setSelected(null);
      showNotice("Перемещено в корзину");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось удалить");
    }
  };

  const handleRestore = async (item) => {
    try {
      if (item.kind === "folder") {
        await restoreMyFilesFolder(item.id);
      } else {
        await restoreMyFile(item.id, {}, { student });
      }
      showNotice("Восстановлено");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось восстановить");
    }
  };

  const handlePurge = async () => {
    if (!purgeItem || purgeItem.kind === "folder") return;
    try {
      await purgeMyFile(purgeItem.id, { force: purgeForce, student });
      setPurgeItem(null);
      setPurgeForce(false);
      setPurgeRelations([]);
      if (selected?.id === purgeItem.id) setSelected(null);
      showNotice("Файл удалён окончательно");
      await load();
    } catch (err) {
      if (err?.status === 409 || err?.data?.code === "FILE_IN_USE") {
        setPurgeRelations(err?.data?.relations || []);
        setPurgeForce(true);
        setError(err?.message || "Файл используется");
        return;
      }
      setError(err?.message || "Не удалось удалить");
    }
  };

  const handleCopy = async (item) => {
    if (item.kind !== "file" || student) return;
    try {
      await copyMyFile(item.id, { folder_id: folderId });
      showNotice("Копия создана");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось скопировать");
    }
  };

  const handleDropOnFolder = async (targetFolder, draggedId, draggedKind) => {
    if (!targetFolder || targetFolder.kind !== "folder") return;
    try {
      if (draggedKind === "folder") {
        await moveMyFiles({ folder_ids: [draggedId], folder_id: targetFolder.id });
      } else {
        await moveMyFiles({ ids: [draggedId], folder_id: targetFolder.id });
      }
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось переместить");
    }
  };

  const confirmSelect = () => {
    if (!selectable) return;
    if (multiSelect) {
      const chosen = items.filter((i) => i.kind === "file" && selectedIds.has(i.id));
      onSelect?.(chosen);
      return;
    }
    if (selected?.kind === "file") onSelect?.(selected);
  };

  const quotaPercent = quota?.percent ?? 0;

  const emptyText = useMemo(() => {
    if (debouncedSearch) return "Ничего не найдено";
    if (section === "trash") return "Корзина пуста";
    if (section === "recent") return "Недавних файлов пока нет";
    return "Здесь пока нет файлов. Загрузите первый материал.";
  }, [debouncedSearch, section]);

  return (
    <div className={`cb-files${compact ? " cb-files--compact" : ""}`}>
      {!compact ? (
        <div className="cb-files__toolbar">
          <button type="button" className="cb-btn cb-btn--primary" onClick={() => fileInputRef.current?.click()} disabled={uploading || section === "trash"}>
            {uploading ? "Загрузка…" : "Загрузить"}
          </button>
          <button type="button" className="cb-btn cb-btn--outline" onClick={handleCreateFolder} disabled={section === "trash"}>
            Создать папку
          </button>
          {section === "trash" && !student ? (
            <button
              type="button"
              className="cb-btn cb-btn--outline"
              onClick={async () => {
                try {
                  const res = await emptyMyFilesTrash();
                  showNotice(res?.blocked?.length ? "Часть файлов не удалена — они используются" : "Корзина очищена");
                  await load();
                } catch (err) {
                  setError(err?.message || "Не удалось очистить корзину");
                }
              }}
            >
              Очистить корзину
            </button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => handleUploadFiles(e.target.files)}
          />
        </div>
      ) : (
        <div className="cb-files__toolbar">
          <button type="button" className="cb-btn cb-btn--outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Загрузка…" : "Загрузить новый"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => handleUploadFiles(e.target.files)}
          />
        </div>
      )}

      <div className="cb-files__layout">
        {!compact ? (
          <nav className="cb-files__nav" aria-label="Разделы файлов">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`cb-files__nav-btn${section === s.id ? " is-active" : ""}`}
                onClick={() => {
                  setSection(s.id);
                  setFolderId(null);
                  setSelected(null);
                }}
              >
                {s.label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="cb-files__main">
          {quota ? (
            <div className="cb-files__quota">
              Использовано {formatBytes(quota.used_bytes)} из {formatBytes(quota.limit_bytes)} ({quotaPercent}%)
              <div className={`cb-files__quota-bar${quota.warning ? " is-warn" : ""}`}>
                <span style={{ width: `${Math.min(100, quotaPercent)}%` }} />
              </div>
            </div>
          ) : null}

          <div className="cb-files__crumbs">
            {breadcrumbs.map((crumb, idx) => {
              const current = idx === breadcrumbs.length - 1;
              return (
                <span key={`${crumb.id || "root"}-${idx}`} style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
                  {idx > 0 ? <span>/</span> : null}
                  <button
                    type="button"
                    className={`cb-files__crumb${current ? " is-current" : ""}`}
                    onClick={() => {
                      if (current) return;
                      setSection("my");
                      setFolderId(crumb.id);
                    }}
                  >
                    {crumb.name}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="cb-files__toolbar">
            <input
              type="search"
              className="cb-files__search"
              placeholder="Поиск по названию"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="cb-files__select-wrap">
              <span className="cb-files__select-label">Сортировка</span>
              <select className="cb-files__select" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="name">По названию</option>
                <option value="updated">По изменению</option>
                <option value="created">По загрузке</option>
                <option value="size">По размеру</option>
                <option value="type">По типу</option>
              </select>
            </label>
            <label className="cb-files__select-wrap">
              <span className="cb-files__select-label">Тип</span>
              <select className="cb-files__select" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            {!compact ? (
              <div className="cb-files__view-toggle" role="group" aria-label="Вид">
                <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>Список</button>
                <button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}>Плитка</button>
              </div>
            ) : null}
          </div>

          {!student && !compact && section === "my" ? (
            <div className="cb-files__filters">
              <label className="cb-files__select-wrap">
                <span className="cb-files__select-label">Ученик</span>
                <select className="cb-files__select" value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}>
                  <option value="">Все ученики</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name || `${s.last_name || ""} ${s.first_name || ""}`.trim()}</option>
                  ))}
                </select>
              </label>
              <label className="cb-files__select-wrap">
                <span className="cb-files__select-label">Группа</span>
                <select className="cb-files__select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                  <option value="">Все группы</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </label>
              {(studentFilter || groupFilter || kind) ? (
                <button
                  type="button"
                  className="cb-btn cb-btn--outline"
                  onClick={() => {
                    setStudentFilter("");
                    setGroupFilter("");
                    setKind("");
                  }}
                >
                  Сбросить фильтры
                </button>
              ) : null}
            </div>
          ) : null}

          {!compact && section === "my" ? (
            <div
              className={`cb-files__drop${dropActive ? " is-active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDropActive(false);
                handleUploadFiles(e.dataTransfer.files);
              }}
            >
              Перетащите файлы сюда, чтобы загрузить
            </div>
          ) : null}

          {notice ? <p className="cb-page-sub">{notice}</p> : null}
          {error ? <div className="cb-files__error">{error}</div> : null}

          {loading ? (
            <div className="cb-files__skeleton">Загрузка…</div>
          ) : items.length === 0 ? (
            <div className="cb-files__empty">{emptyText}</div>
          ) : (
            <div className={view === "grid" && !compact ? "cb-files__grid" : "cb-files__list"}>
              {items.map((item) => {
                const isSelected = selectable
                  ? multiSelect
                    ? selectedIds.has(item.id)
                    : selected?.id === item.id
                  : selected?.id === item.id;
                const RowTag = view === "grid" && !compact ? "div" : "div";
                return (
                  <RowTag
                    key={item.id}
                    className={`${view === "grid" && !compact ? "cb-files__tile" : "cb-files__row"}${isSelected ? " is-selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    draggable={!student && !compact && section === "my"}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", JSON.stringify({ id: item.id, kind: item.kind }));
                    }}
                    onDragOver={(e) => {
                      if (item.kind === "folder") e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
                        if (payload.id && payload.id !== item.id) {
                          handleDropOnFolder(item, payload.id, payload.kind);
                        }
                      } catch {
                        /* ignore */
                      }
                    }}
                    onClick={() => openItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openItem(item);
                      }
                    }}
                  >
                    <FileThumb item={item} student={student} size={view === "grid" && !compact ? "md" : "sm"} />
                    <div className="cb-files__meta">
                      <div className="cb-files__name">{item.name || item.display_name}</div>
                      <div className="cb-files__sub">
                        {item.kind === "folder"
                          ? "Папка"
                          : `${formatBytes(item.size)} · ${formatDate(item.updated_at)}`}
                        {section === "trash" && item.days_left != null ? ` · ещё ${item.days_left} дн.` : ""}
                      </div>
                    </div>
                    {!selectable ? (
                      <div className="cb-files__row-actions">
                        <button
                          type="button"
                          className="cb-files__menu-btn"
                          aria-label="Действия"
                          aria-expanded={menu?.id === item.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenu(menu?.id === item.id ? null : { id: item.id, item, anchor: e.currentTarget });
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    ) : null}
                  </RowTag>
                );
              })}
            </div>
          )}

          {selectable ? (
            <div className="cb-files__toolbar" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="cb-btn cb-btn--primary"
                disabled={multiSelect ? selectedIds.size === 0 : selected?.kind !== "file"}
                onClick={confirmSelect}
              >
                Выбрать
              </button>
            </div>
          ) : null}

          {!compact && selected?.kind === "file" ? (
            <aside className="cb-files__side">
              <div className="cb-files__side-head">
                <h3>{selected.display_name || selected.name}</h3>
                <button type="button" className="cb-btn cb-btn--outline" onClick={() => setSelected(null)}>Закрыть</button>
              </div>
              <FilePreviewPane file={selected} student={student} />
              <dl>
                <dt>Тип</dt>
                <dd>{extLabel(selected)}</dd>
                <dt>Размер</dt>
                <dd>{formatBytes(selected.size)}</dd>
                <dt>Загружен</dt>
                <dd>{formatDate(selected.created_at)}</dd>
                <dt>Изменён</dt>
                <dd>{formatDate(selected.updated_at)}</dd>
                {selected.relations?.length ? (
                  <>
                    <dt>Связи</dt>
                    <dd>
                      {selected.relations.map((r) => (
                        <div key={r.relation_id}>{r.label}: {r.title || "—"}</div>
                      ))}
                    </dd>
                  </>
                ) : null}
              </dl>
              <div className="cb-files__toolbar">
                <a className="cb-btn cb-btn--primary" href={myFileDownloadUrl(selected.id, { student })} target="_blank" rel="noreferrer">
                  Скачать
                </a>
                <a className="cb-btn cb-btn--outline" href={myFilePreviewUrl(selected.id, { student })} target="_blank" rel="noreferrer">
                  Открыть
                </a>
                {!student ? (
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline"
                    onClick={() => setAssignItem(selected)}
                  >
                    Выдать
                  </button>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <CabinetFloatingMenu
        open={Boolean(menu)}
        anchorEl={menu?.anchor}
        onClose={() => setMenu(null)}
      >
        {menu?.item && section !== "trash" ? (
          <>
            {menu.item.kind === "file" ? (
              <div className="cb-files__menu-group">
                <p className="cb-files__menu-title">Файл</p>
                <button
                  type="button"
                  onClick={() => {
                    window.open(myFileDownloadUrl(menu.item.id, { student }), "_blank", "noopener,noreferrer");
                    setMenu(null);
                  }}
                >
                  Скачать
                </button>
              </div>
            ) : null}
            <div className="cb-files__menu-group">
              <p className="cb-files__menu-title">Правка</p>
              <button
                type="button"
                onClick={() => {
                  setRenameItem(menu.item);
                  setRenameValue(menu.item.name || menu.item.display_name || "");
                  setMenu(null);
                }}
              >
                Переименовать
              </button>
              {menu.item.kind === "file" && !student ? (
                <button
                  type="button"
                  onClick={() => {
                    handleCopy(menu.item);
                    setMenu(null);
                  }}
                >
                  Копировать
                </button>
              ) : null}
            </div>
            {menu.item.kind === "file" && !student ? (
              <div className="cb-files__menu-group">
                <p className="cb-files__menu-title">Обучение</p>
                <button
                  type="button"
                  onClick={() => {
                    setAssignItem(menu.item);
                    setMenu(null);
                  }}
                >
                  Выдать ученику / группе
                </button>
              </div>
            ) : null}
            <div className="cb-files__menu-group">
              <p className="cb-files__menu-title">Удаление</p>
              <button
                type="button"
                onClick={() => {
                  handleTrash(menu.item);
                  setMenu(null);
                }}
              >
                В корзину
              </button>
            </div>
          </>
        ) : menu?.item ? (
          <div className="cb-files__menu-group">
            <p className="cb-files__menu-title">Корзина</p>
            <button
              type="button"
              onClick={() => {
                handleRestore(menu.item);
                setMenu(null);
              }}
            >
              Восстановить
            </button>
            {menu.item.kind === "file" ? (
              <button
                type="button"
                onClick={() => {
                  setPurgeItem(menu.item);
                  setPurgeForce(false);
                  setPurgeRelations([]);
                  setMenu(null);
                }}
              >
                Удалить окончательно
              </button>
            ) : null}
          </div>
        ) : null}
      </CabinetFloatingMenu>

      {renameItem ? (
        <CabinetModal
          title="Переименовать"
          onClose={() => setRenameItem(null)}
          footer={(
            <>
              <button type="button" className="cb-btn cb-btn--secondary" onClick={() => setRenameItem(null)}>Отмена</button>
              <button type="button" className="cb-btn cb-btn--primary" onClick={handleRename}>Сохранить</button>
            </>
          )}
        >
          <label className="cb-field">
            <span>Название</span>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </label>
        </CabinetModal>
      ) : null}

      {purgeItem ? (
        <ConfirmActionModal
          open
          title="Удалить окончательно?"
          confirmLabel={purgeForce ? "Всё равно удалить" : "Удалить"}
          danger
          onClose={() => {
            setPurgeItem(null);
            setPurgeForce(false);
            setPurgeRelations([]);
          }}
          onConfirm={handlePurge}
          text={(
            <>
              <p>
                Файл «{purgeItem.display_name || purgeItem.name}» будет удалён без возможности восстановления.
              </p>
              {purgeRelations.length ? (
                <ul>
                  {purgeRelations.map((r) => (
                    <li key={r.relation_id}>{r.label}: {r.title || "—"}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        />
      ) : null}

      {!student ? (
        <MyFileAssignModal
          open={Boolean(assignItem)}
          file={assignItem}
          onClose={() => setAssignItem(null)}
          onAssigned={() => {
            showNotice("Файл выдан");
            load();
          }}
        />
      ) : null}
    </div>
  );
}
