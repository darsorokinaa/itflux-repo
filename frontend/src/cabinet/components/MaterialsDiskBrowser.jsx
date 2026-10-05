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

const FOLDER_TONES = ["#dce7fb", "#f8e7d8", "#e5f3e4", "#eee7f8", "#f8efd4"];
const BADGE_SHORT = {
  interactive: "ИНТ",
  board: "ДОСК",
  lesson: "УРОК",
  task_set: "ВАР",
  worksheet: "ЛИСТ",
  presentation: "ПРЗ",
  methodic: "МЕТ",
  link: "URL",
  file: "ФАЙЛ",
};

function folderTone(id) {
  const value = String(id || "");
  let n = 0;
  for (let i = 0; i < value.length; i += 1) n += value.charCodeAt(i);
  return FOLDER_TONES[n % FOLDER_TONES.length];
}

function materialBadgeKind(item) {
  const kind = item?.preview_kind || "";
  if (kind === "pdf") return "pdf";
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  const ext = String(item?.extension || "").replace(".", "").toLowerCase();
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["doc", "docx", "rtf", "odt"].includes(ext)) return "doc";
  if (item?.type === "interactive") return "audio";
  if (item?.type === "task_set" || item?.type === "presentation") return "sheet";
  if (item?.type === "board" || item?.type === "link") return "doc";
  return "other";
}

function materialBadgeLabel(item) {
  const ext = String(item?.extension || "").replace(".", "").toUpperCase();
  if (ext && ext.length <= 4) return ext;
  const kind = item?.preview_kind || "";
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "IMG";
  if (kind === "video") return "ВИД";
  return BADGE_SHORT[item?.type] || "ФАЙЛ";
}

function MaterialBadge({ item, large = false }) {
  return (
    <span className={`cbf-badge cbf-badge--${materialBadgeKind(item)}${large ? " is-large" : ""}`} aria-hidden>
      {materialBadgeLabel(item)}
    </span>
  );
}

function fileHint(item) {
  return [
    materialTypeLabel(item.type, item.type_label),
    item.student_subject_label,
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
  layout = "default",
  toolbarStart = null,
}) {
  const [internalFolderId, setInternalFolderId] = useState(null);
  const folderId = controlledFolderId !== undefined ? controlledFolderId : internalFolderId;
  const setFolderId = (id) => {
    if (onFolderChange) onFolderChange(id);
    else setInternalFolderId(id);
  };

  const [search, setSearch] = useState("");
  const [view, setView] = useState(layout === "cabinet" ? "list" : "grid");
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

  const parentCrumb = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const folderItems = visible.filter((item) => item.kind === "folder");
  const fileItems = visible.filter((item) => item.kind !== "folder");

  return (
    <div className={layout === "cabinet" ? "cbf-students-browser" : "cb-files"}>
      {layout === "cabinet" ? (
        <>
          <div className="cbf-tools">
            {toolbarStart}
            {canOrganize ? (
              <button
                type="button"
                className="cbf-btn"
                onClick={() => {
                  setFolderModal({ mode: "create" });
                  setFolderName("");
                }}
              >
                <CabinetIcon name="plus" />
                Новая папка
              </button>
            ) : null}
            <label className="cbf-search">
              <span className="cbf-sr">Поиск материалов</span>
              <CabinetIcon name="search" />
              <input
                type="search"
                value={search}
                placeholder="Поиск в файлах и папках"
                autoComplete="off"
                aria-label="Поиск материалов"
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button type="button" className="cbf-search-clear" aria-label="Очистить поиск" onClick={() => setSearch("")}>
                  <CabinetIcon name="close" />
                </button>
              ) : null}
            </label>
          </div>
          <div className="cbf-body">
            <div className="cbf-dir">
              <button
                type="button"
                className="cbf-back"
                aria-label="На папку выше"
                disabled={!parentCrumb}
                onClick={() => parentCrumb?.onClick?.()}
              >
                <CabinetIcon name="arrowLeft" />
              </button>
              <nav className="cbf-crumbs" aria-label="Путь к папке">
                {crumbs.map((crumb, idx) => {
                  const current = idx === crumbs.length - 1;
                  return (
                    <span key={`${crumb.id || "root"}-${idx}`} className="cbf-crumb">
                      {idx > 0 ? <CabinetIcon name="arrow" /> : null}
                      <button
                        type="button"
                        className={current ? "is-current" : ""}
                        onClick={() => { if (!current) crumb.onClick?.(); }}
                        onDragOver={(e) => {
                          if (canOrganize && crumb.id == null && folderId != null) e.preventDefault();
                        }}
                        onDrop={crumb.id == null ? handleDropOnRoot : undefined}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  );
                })}
              </nav>
              <div className="cbf-dir-controls">
                <div className="cbf-view" aria-label="Вид файлов">
                  <button type="button" className={view === "list" ? "is-active" : ""} aria-pressed={view === "list"} aria-label="Список" onClick={() => setView("list")}>
                    <CabinetIcon name="order" />
                  </button>
                  <button type="button" className={view === "grid" ? "is-active" : ""} aria-pressed={view === "grid"} aria-label="Плитки" onClick={() => setView("grid")}>
                    <CabinetIcon name="cards" />
                  </button>
                </div>
              </div>
            </div>

            {error ? <div className="cbf-error">{error}</div> : null}
            {loading ? (
              <div className="cbf-skeleton" aria-busy="true"><div /><div /><div /></div>
            ) : visible.length === 0 ? (
              <div className="cbf-empty">
                <span className="cbf-empty-icon"><CabinetIcon name="folder" /></span>
                <h3>Пока пусто</h3>
                <p>{emptyText}</p>
              </div>
            ) : (
              <>
                {folderItems.length ? (
                  <div className="cbf-folders">
                    {folderItems.map((item) => {
                      const key = `folder-${item.id}`;
                      const over = dropOverId === key;
                      return (
                        <article
                          key={key}
                          className={`cbf-folder${over ? " is-drop" : ""}`}
                          onDragOver={(e) => {
                            if (!canOrganize) return;
                            e.preventDefault();
                            setDropOverId(key);
                          }}
                          onDragLeave={() => {
                            if (dropOverId === key) setDropOverId(null);
                          }}
                          onDrop={(e) => handleDropOnFolder(item, e)}
                        >
                          <button
                            type="button"
                            className="cbf-folder-open"
                            style={{ "--cbf-folder": folderTone(item.id) }}
                            title={`Открыть папку ${item.name}`}
                            onClick={() => openItem(item)}
                          >
                            <span className="cbf-folder-art" aria-hidden />
                            <span className="cbf-folder-text">
                              <strong>{item.name}</strong>
                              <small>{itemSubtitle(item)}</small>
                            </span>
                          </button>
                          {canOrganize ? (
                            <button
                              type="button"
                              className="cbf-folder-more"
                              aria-label={`Действия с папкой ${item.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenu(menu?.id === key ? null : {
                                  id: key,
                                  item,
                                  isFolder: true,
                                  menuItems: [],
                                  anchor: e.currentTarget,
                                });
                              }}
                            >
                              <CabinetIcon name="more" />
                            </button>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : null}

                {fileItems.length ? (
                  <div className="cbf-list-head">
                    <h2>Файлы<span>{fileItems.length}</span></h2>
                    <p>Нажмите на название, чтобы открыть</p>
                  </div>
                ) : null}

                {fileItems.length && view !== "grid" ? (
                  <table className="cbf-table">
                    <thead>
                      <tr>
                        <th>Название</th>
                        <th className="cbf-date-col">Изменён</th>
                        <th className="cbf-menu-col"><span className="cbf-sr">Действия</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileItems.map((item) => {
                        const key = item.library_key || String(item.id);
                        const menuItems = fileMenuItems ? fileMenuItems(item) : [];
                        const title = item.name || item.title;
                        return (
                          <tr
                            key={key}
                            className="cbf-row"
                            draggable={canOrganize}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", JSON.stringify({ key, kind: "file" }));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                          >
                            <td>
                              <button type="button" className="cbf-file-open" title={title} onClick={() => openItem(item)}>
                                <MaterialBadge item={item} />
                                <span className="cbf-file-name">
                                  <strong>{title}</strong>
                                  <small>{fileHint(item)}</small>
                                </span>
                              </button>
                            </td>
                            <td className="cbf-date-col">{formatDate(item.assigned_at || item.updated_at) || "—"}</td>
                            <td className="cbf-menu-col">
                              <div className="cbf-row-actions">
                                <button
                                  type="button"
                                  className="cbf-icon-btn"
                                  aria-label={`Действия с файлом ${title}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenu(menu?.id === key ? null : {
                                      id: key,
                                      item,
                                      isFolder: false,
                                      menuItems,
                                      anchor: e.currentTarget,
                                    });
                                  }}
                                >
                                  <CabinetIcon name="more" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}

                {fileItems.length && view === "grid" ? (
                  <div className="cbf-grid">
                    {fileItems.map((item) => {
                      const key = item.library_key || String(item.id);
                      const menuItems = fileMenuItems ? fileMenuItems(item) : [];
                      const title = item.name || item.title;
                      const image = item.preview_kind === "image" && item.preview_url;
                      return (
                        <article
                          key={key}
                          className="cbf-tile"
                          draggable={canOrganize}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", JSON.stringify({ key, kind: "file" }));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                        >
                          <button
                            type="button"
                            className={`cbf-tile-preview${image ? " is-image" : ""}`}
                            aria-label={`Открыть ${title}`}
                            onClick={() => openItem(item)}
                          >
                            {image ? <img src={item.preview_url} alt="" /> : <MaterialBadge item={item} large />}
                          </button>
                          <div className="cbf-tile-meta">
                            <strong title={title}>{title}</strong>
                            <p>
                              <span>{fileHint(item) || materialBadgeLabel(item)}</span>
                              <span>{formatDate(item.assigned_at || item.updated_at)}</span>
                            </p>
                          </div>
                          <button
                            type="button"
                            className="cbf-icon-btn cbf-tile-more"
                            aria-label={`Действия с файлом ${title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenu(menu?.id === key ? null : {
                                id: key,
                                item,
                                isFolder: false,
                                menuItems,
                                anchor: e.currentTarget,
                              });
                            }}
                          >
                            <CabinetIcon name="more" />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : (
      <>
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
      </>
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
