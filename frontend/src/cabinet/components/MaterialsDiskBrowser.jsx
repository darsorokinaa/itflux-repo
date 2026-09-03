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

function parentKey(value) {
  return value == null || value === "" ? null : String(value);
}

function buildFolderChain(folders, folderId) {
  if (folderId == null || folderId === "") return [];
  const byId = Object.fromEntries(folders.map((f) => [String(f.id), f]));
  const chain = [];
  let current = byId[String(folderId)];
  const seen = new Set();
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    chain.unshift(current);
    current = current.parent_id != null ? byId[String(current.parent_id)] : null;
  }
  return chain;
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
  folderId: controlledFolderId,
  onFolderChange,
  rootLabel = "Материалы",
  breadcrumbPrefix = [],
  onOpenFile,
  onCreateFolder,
  onRenameFolder,
  onRenameFile,
  onDeleteFolder,
  onMove,
  fileMenuItems,
}) {
  const [internalFolderId, setInternalFolderId] = useState(null);
  const folderId = controlledFolderId !== undefined ? controlledFolderId : internalFolderId;
  const setFolderId = (id) => {
    if (onFolderChange) onFolderChange(id);
    else setInternalFolderId(id);
  };

  const [search, setSearch] = useState("");
  const [view, setView] = useState("grid");
  const [menu, setMenu] = useState(null);
  const [dropOverId, setDropOverId] = useState(null);
  const [folderModal, setFolderModal] = useState(null);
  const [folderName, setFolderName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const folderChain = useMemo(
    () => buildFolderChain(folders, folderId),
    [folders, folderId],
  );

  const currentFolder = folderChain.length ? folderChain[folderChain.length - 1] : null;

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
    const currentParent = parentKey(folderId);
    const folderTiles = folders.filter((f) => parentKey(f.parent_id) === currentParent);
    const files = items.filter((it) => (
      currentParent == null ? !it.folder_id : String(it.folder_id) === currentParent
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
    if (!payload.key && !payload.folderId) return;
    if (payload.kind === "folder" && payload.folderId) {
      if (String(payload.folderId) === String(folder.id)) return;
      onMove?.({ folderIds: [payload.folderId], folderId: folder.id });
      return;
    }
    if (payload.key) {
      onMove?.({ keys: [payload.key], folderId: folder.id });
    }
  };

  const handleDropOnRoot = (e) => {
    e.preventDefault();
    setDropOverId(null);
    if (!canOrganize || folderId == null) return;
    const payload = parseDrag(e);
    if (payload.kind === "folder" && payload.folderId) {
      onMove?.({ folderIds: [payload.folderId], folderId: null });
      return;
    }
    if (payload.key) {
      onMove?.({ keys: [payload.key], folderId: null });
    }
  };

  const submitFolderModal = async () => {
    const name = folderName.trim();
    if (!name) return;
    if (folderModal?.mode === "create") {
      await onCreateFolder?.({ name, parentId: folderId });
    } else if (folderModal?.mode === "rename" && folderModal.folder) {
      await onRenameFolder?.(folderModal.folder, { name });
    } else if (folderModal?.mode === "rename-file" && folderModal.file) {
      await onRenameFile?.(folderModal.file, { name });
    }
    setFolderModal(null);
    setFolderName("");
  };

  const crumbs = [
    ...(breadcrumbPrefix || []),
    {
      id: null,
      name: rootLabel,
      onClick: () => setFolderId(null),
    },
    ...folderChain.map((f) => ({
      id: f.id,
      name: f.name,
      onClick: () => setFolderId(f.id),
    })),
  ];

  return (
    <div className="cb-files">
      <div className="cb-files__toolbar">
        {canOrganize ? (
          <div className="cb-files__create-wrap">
            <button
              type="button"
              className="cb-btn cb-btn--primary"
              onClick={() => setCreateOpen((v) => !v)}
              aria-expanded={createOpen}
            >
              + Создать
            </button>
            {createOpen ? (
              <div className="cb-files__create-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateOpen(false);
                    setFolderModal({ mode: "create" });
                    setFolderName("");
                  }}
                >
                  Создать папку
                </button>
              </div>
            ) : null}
          </div>
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

      <nav className="cb-files__crumbs cb-files__crumbs--wrap" aria-label="Путь">
        {crumbs.map((crumb, idx) => {
          const current = idx === crumbs.length - 1;
          return (
            <span key={`${crumb.id || "root"}-${idx}`} className="cb-files__crumb-wrap">
              {idx > 0 ? <span className="cb-files__crumb-sep" aria-hidden>/</span> : null}
              {current ? (
                <span className="cb-files__crumb is-current">{crumb.name}</span>
              ) : (
                <button
                  type="button"
                  className="cb-files__crumb"
                  onClick={() => {
                    if (crumb.onClick) crumb.onClick();
                    else setFolderId(crumb.id);
                  }}
                  onDragOver={(e) => {
                    if (canOrganize && crumb.id == null && folderId != null) e.preventDefault();
                  }}
                  onDrop={crumb.id == null ? handleDropOnRoot : undefined}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>

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
                draggable={canOrganize}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", JSON.stringify(
                    isFolder
                      ? { kind: "folder", folderId: item.id }
                      : { key: item.library_key || String(item.id), kind: "file" },
                  ));
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
                {canOrganize || menuItems.length || onRenameFile ? (
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
            {folderId != null ? (
              <button
                type="button"
                onClick={() => {
                  onMove?.({ folderIds: [menu.item.id], folderId: null });
                  setMenu(null);
                }}
              >
                Переместить в корень
              </button>
            ) : null}
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
            <div className="cb-files__menu-group">
              <p className="cb-files__menu-title">Материал</p>
              {onRenameFile
                && !["interactive", "board", "homework"].includes(String(menu?.item?.type || ""))
                ? (
                <button
                  type="button"
                  onClick={() => {
                    setFolderModal({ mode: "rename-file", file: menu.item });
                    setFolderName(menu.item.name || menu.item.title || "");
                    setMenu(null);
                  }}
                >
                  Переименовать
                </button>
              ) : null}
              {menu?.menuItems?.length ? (
                menu.menuItems.map((action) => (
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
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onOpenFile?.(menu.item);
                    setMenu(null);
                  }}
                >
                  Открыть
                </button>
              )}
            </div>
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
          title={
            folderModal.mode === "rename"
              ? "Переименовать папку"
              : folderModal.mode === "rename-file"
                ? "Переименовать"
                : "Новая папка"
          }
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
