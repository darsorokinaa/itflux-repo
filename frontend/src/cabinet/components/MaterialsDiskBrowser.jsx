import { useMemo, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import { getMaterialTypeConfig, materialTypeLabel } from "../materialTypeConfig";
import "../styles/my-files.css";

const FORMAT_EXTS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
  "mp4", "mov", "webm", "mp3", "wav", "ogg", "m4a",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "rar", "7z", "txt", "csv", "rtf",
]);

function extLabel(item) {
  const kind = item?.preview_kind || "";
  if (kind === "video") return "Видео";
  if (kind === "image") return "Фото";
  if (kind === "pdf") return "PDF";
  const ext = (item?.extension || "").replace(".", "").toLowerCase();
  if (FORMAT_EXTS.has(ext)) return ext.toUpperCase();
  return getMaterialTypeConfig(item?.type).label;
}

function thumbTone(item) {
  const kind = item?.preview_kind || "";
  if (kind === "pdf") return "pdf";
  if (kind === "video") return "video";
  if (kind === "image") return "image";
  if (item?.type === "interactive") return "audio";
  if (item?.type === "board") return "text";
  return "file";
}

export function LibraryDiskThumb({ item, size = "sm" }) {
  const [failed, setFailed] = useState(false);
  if (item?.kind === "folder") {
    return (
      <div className={`cb-files__thumb cb-files__thumb--folder cb-files__thumb--${size}`} aria-hidden>
        <span className="cb-files__folder-icon">
          <CabinetIcon name="folder" />
        </span>
      </div>
    );
  }
  const kind = item?.preview_kind || "";
  if (kind === "image" && item.preview_url && !failed) {
    return (
      <div className={`cb-files__thumb cb-files__thumb--${size}`}>
        <img
          src={item.preview_url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  if (kind === "video" && item.preview_url && !failed) {
    return (
      <div className={`cb-files__thumb cb-files__thumb--video cb-files__thumb--${size}`}>
        <video src={item.preview_url} muted preload="metadata" onError={() => setFailed(true)} />
        <span className="cb-files__thumb-badge">Видео</span>
      </div>
    );
  }
  return (
    <div className={`cb-files__thumb cb-files__thumb--${thumbTone(item)} cb-files__thumb--${size}`} aria-hidden>
      <span className="cb-files__thumb-ext">{extLabel(item)}</span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

function itemSubtitle(item) {
  if (item.kind === "folder") {
    const n = item.item_count || 0;
    if (n === 1) return "1 материал";
    return `${n} материалов`;
  }
  return [
    materialTypeLabel(item.type, item.type_label),
    item.student_subject_label,
    formatDate(item.assigned_at || item.updated_at),
  ].filter(Boolean).join(" · ");
}

export default function MaterialsDiskBrowser({
  items = [],
  folders = [],
  loading = false,
  error = "",
  emptyText = "Здесь пока нет материалов.",
  canOrganize = false,
  onOpenFile,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMove,
  fileMenuItems,
}) {
  const [folderId, setFolderId] = useState(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("grid");
  const [menu, setMenu] = useState(null);
  const [dropOverId, setDropOverId] = useState(null);
  const [folderModal, setFolderModal] = useState(null);
  const [folderName, setFolderName] = useState("");

  const currentFolder = useMemo(
    () => folders.find((f) => String(f.id) === String(folderId)) || null,
    [folders, folderId],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const matchedFolders = folders.filter((f) => (f.name || "").toLowerCase().includes(q));
      const matchedFiles = items.filter((it) => (
        (it.title || "").toLowerCase().includes(q)
        || (it.topic || "").toLowerCase().includes(q)
        || (it.folder_name || "").toLowerCase().includes(q)
        || (it.type_label || "").toLowerCase().includes(q)
      ));
      return [...matchedFolders, ...matchedFiles];
    }
    const inRoot = folderId == null;
    const folderTiles = inRoot ? folders : [];
    const files = items.filter((it) => (
      inRoot ? !it.folder_id : String(it.folder_id) === String(folderId)
    ));
    return [...folderTiles, ...files];
  }, [items, folders, folderId, search]);

  const openItem = (item) => {
    if (item.kind === "folder") {
      setFolderId(item.id);
      setMenu(null);
      return;
    }
    onOpenFile?.(item);
  };

  const parseDrag = (e) => {
    try {
      return JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
    } catch {
      return {};
    }
  };

  const handleDropOnFolder = (folder, e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOverId(null);
    if (!canOrganize) return;
    const payload = parseDrag(e);
    if (!payload.key || payload.kind === "folder") return;
    onMove?.({ keys: [payload.key], folderId: folder.id });
  };

  const handleDropOnRoot = (e) => {
    e.preventDefault();
    setDropOverId(null);
    if (!canOrganize || folderId == null) return;
    const payload = parseDrag(e);
    if (!payload.key || payload.kind === "folder") return;
    onMove?.({ keys: [payload.key], folderId: null });
  };

  const submitFolderModal = async () => {
    const name = folderName.trim();
    if (!name) return;
    if (folderModal?.mode === "create") {
      await onCreateFolder?.({ name });
    } else if (folderModal?.mode === "rename" && folderModal.folder) {
      await onRenameFolder?.(folderModal.folder, { name });
    }
    setFolderModal(null);
    setFolderName("");
  };

  return (
    <div className="cb-files">
      <div className="cb-files__toolbar">
        {canOrganize ? (
          <button
            type="button"
            className="cb-btn cb-btn--outline"
            onClick={() => { setFolderModal({ mode: "create" }); setFolderName(""); }}
          >
            Создать папку
          </button>
        ) : null}
        <input
          type="search"
          className="cb-files__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск…"
          aria-label="Поиск материалов"
        />
        <div className="cb-files__view-toggle" role="group" aria-label="Вид">
          <button type="button" className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")}>
            Значки
          </button>
          <button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}>
            Список
          </button>
        </div>
      </div>

      <div className="cb-files__crumbs">
        <button
          type="button"
          className={`cb-files__crumb${folderId == null ? " is-current" : ""}`}
          onClick={() => setFolderId(null)}
          onDragOver={(e) => { if (canOrganize && folderId != null) e.preventDefault(); }}
          onDrop={handleDropOnRoot}
        >
          Материалы
        </button>
        {currentFolder ? (
          <>
            <span aria-hidden>/</span>
            <span className="cb-files__crumb is-current">{currentFolder.name}</span>
          </>
        ) : null}
      </div>

      {error ? <div className="cb-files__error">{error}</div> : null}

      {loading ? (
        <div className="cb-files__skeleton">Загрузка…</div>
      ) : visible.length === 0 ? (
        <div className="cb-files__empty">{emptyText}</div>
      ) : (
        <div className={view === "grid" ? "cb-files__grid" : "cb-files__list"}>
          {visible.map((item) => {
            const key = item.kind === "folder" ? `folder-${item.id}` : item.library_key || String(item.id);
            const isFolder = item.kind === "folder";
            const over = dropOverId === key;
            const menuItems = !isFolder && fileMenuItems ? fileMenuItems(item) : [];
            return (
              <div
                key={key}
                className={`${view === "grid" ? "cb-files__tile" : "cb-files__row"}${over ? " is-selected" : ""}`}
                role="button"
                tabIndex={0}
                draggable={canOrganize && !isFolder}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", JSON.stringify({
                    key: item.library_key || String(item.id),
                    kind: isFolder ? "folder" : "file",
                  }));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (canOrganize && isFolder) {
                    e.preventDefault();
                    setDropOverId(key);
                  }
                }}
                onDragLeave={() => {
                  if (dropOverId === key) setDropOverId(null);
                }}
                onDrop={isFolder ? (e) => handleDropOnFolder(item, e) : undefined}
                onClick={() => openItem(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openItem(item);
                  }
                }}
              >
                <LibraryDiskThumb item={item} size={view === "grid" ? "md" : "sm"} />
                <div className="cb-files__meta">
                  <div className="cb-files__name">{item.name || item.title}</div>
                  <div className="cb-files__sub">{itemSubtitle(item)}</div>
                </div>
                {canOrganize || menuItems.length ? (
                  <div className="cb-files__row-actions">
                    <button
                      type="button"
                      className="cb-files__menu-btn"
                      aria-label="Действия"
                      aria-expanded={menu?.id === key}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu(menu?.id === key ? null : {
                          id: key,
                          item,
                          isFolder,
                          menuItems,
                          anchor: e.currentTarget,
                        });
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <CabinetFloatingMenu
        open={Boolean(menu)}
        anchorEl={menu?.anchor}
        onClose={() => setMenu(null)}
      >
        {menu?.isFolder ? (
          <div className="cb-files__menu-group">
            <p className="cb-files__menu-title">Папка</p>
            <button
              type="button"
              onClick={() => {
                setFolderModal({ mode: "rename", folder: menu.item });
                setFolderName(menu.item.name || "");
                setMenu(null);
              }}
            >
              Переименовать
            </button>
            <button
              type="button"
              onClick={() => {
                onDeleteFolder?.(menu.item);
                setMenu(null);
              }}
            >
              Удалить папку
            </button>
          </div>
        ) : (
          <>
            {menu?.menuItems?.length ? (
              <div className="cb-files__menu-group">
                <p className="cb-files__menu-title">Материал</p>
                {menu.menuItems.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      action.onClick?.();
                      setMenu(null);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="cb-files__menu-group">
                <p className="cb-files__menu-title">Материал</p>
                <button
                  type="button"
                  onClick={() => {
                    onOpenFile?.(menu.item);
                    setMenu(null);
                  }}
                >
                  Открыть
                </button>
              </div>
            )}
            {canOrganize && menu?.item?.folder_id ? (
              <div className="cb-files__menu-group">
                <p className="cb-files__menu-title">Папка</p>
                <button
                  type="button"
                  onClick={() => {
                    onMove?.({ keys: [menu.item.library_key || String(menu.item.id)], folderId: null });
                    setMenu(null);
                  }}
                >
                  Убрать из папки
                </button>
              </div>
            ) : null}
          </>
        )}
      </CabinetFloatingMenu>

      {folderModal ? (
        <CabinetModal
          title={folderModal.mode === "rename" ? "Переименовать папку" : "Новая папка"}
          onClose={() => setFolderModal(null)}
          footer={(
            <>
              <button type="button" className="cb-btn cb-btn--secondary" onClick={() => setFolderModal(null)}>
                Отмена
              </button>
              <button type="button" className="cb-btn cb-btn--primary" onClick={submitFolderModal}>
                Сохранить
              </button>
            </>
          )}
        >
          <label className="cb-field">
            <span>Название</span>
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitFolderModal();
                }
              }}
            />
          </label>
        </CabinetModal>
      ) : null}
    </div>
  );
}
