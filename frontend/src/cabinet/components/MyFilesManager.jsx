import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bulkCopyMyFiles,
  bulkTrashMyFiles,
  copyMyFile,
  createMyFilesFolder,
  emptyMyFilesTrash,
  fetchMyFile,
  fetchMyFiles,
  fetchStudents,
  moveMyFiles,
  myFileDownloadUrl,
  purgeMyFile,
  restoreMyFile,
  restoreMyFilesFolder,
  trashMyFile,
  trashMyFilesFolder,
  updateMyFile,
  updateMyFilesFolder,
  uploadMyFile,
} from "../../utils/cabinetAuth";
import { mapApiStudent } from "../cabinetMappers";
import CabinetModal from "./CabinetModal";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import ConfirmActionModal from "./ConfirmActionModal";
import MyFileAssignModal from "./MyFileAssignModal";
import StudentFilesWorkspace from "./StudentFilesWorkspace";
import CabinetIcon from "../CabinetIcons";
import CopyToStudentsModal from "./files/CopyToStudentsModal";
import FileMovePickerModal from "./files/FileMovePickerModal";
import FilePreviewModal, { FileThumb } from "./files/FilePreviewModal";
import {
  KIND_OPTIONS,
  extLabel,
  formatBytes,
  formatDate,
  isTypingTarget,
  itemName,
  readStoredView,
  storeView,
  studentLabel,
} from "./files/fileUtils";
import "../styles/my-files.css";

const WORKSPACES = [
  { id: "my", label: "Мои файлы", section: "my" },
  { id: "students", label: "Файлы учеников" },
  { id: "recent", label: "Недавние", section: "recent" },
  { id: "trash", label: "Корзина", section: "trash" },
];

function selectionKey(item) {
  return `${item.kind}:${item.id}`;
}

export default function MyFilesManager({
  student = false,
  compact = false,
  selectable = false,
  multiSelect = false,
  onSelect,
  acceptKinds,
  workspace: controlledWorkspace,
  onWorkspaceChange,
  folderId: controlledFolderId,
  onFolderChange,
  studentId: controlledStudentId,
  onStudentChange,
  studentFolderId: controlledStudentFolderId,
  onStudentFolderChange,
}) {
  const [workspace, setWorkspace] = useState(controlledWorkspace || "my");
  const [navOpen, setNavOpen] = useState(false);
  const [internalFolderId, setInternalFolderId] = useState(null);
  const folderId = controlledFolderId !== undefined ? controlledFolderId : internalFolderId;
  const activeWorkspace = controlledWorkspace ?? workspace;

  const setFolder = (next) => {
    if (onFolderChange) onFolderChange(next || null);
    else setInternalFolderId(next || null);
  };

  const setActiveWorkspace = (next) => {
    if (next !== activeWorkspace) {
      if (onWorkspaceChange) onWorkspaceChange(next);
      else setWorkspace(next);
    }
    setNavOpen(false);
    setSelectedKeys(new Set());
    setPreviewFile(null);
    if (next !== "my") setFolder(null);
  };

  useEffect(() => {
    if (controlledWorkspace != null) setWorkspace(controlledWorkspace);
  }, [controlledWorkspace]);

  const apiSection = activeWorkspace === "students" ? "my" : activeWorkspace;
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: "Мои файлы" }]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");
  const [kind, setKind] = useState("");
  const [view, setView] = useState(() => (compact ? "list" : readStoredView("list")));
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [menu, setMenu] = useState(null);
  const [dropOverId, setDropOverId] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [notice, setNotice] = useState("");
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [purgeItem, setPurgeItem] = useState(null);
  const [purgeForce, setPurgeForce] = useState(false);
  const [purgeRelations, setPurgeRelations] = useState([]);
  const [deleteItems, setDeleteItems] = useState(null);
  const [assignItem, setAssignItem] = useState(null);
  const [copyTarget, setCopyTarget] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [students, setStudents] = useState([]);
  const [studentNavSearch, setStudentNavSearch] = useState("");
  const fileInputRef = useRef(null);
  const renameRef = useRef(null);
  const createWrapRef = useRef(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 320);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (student || compact) return undefined;
    fetchStudents().then((data) => {
      const list = Array.isArray(data) ? data : data?.results || [];
      setStudents(list.map(mapApiStudent));
    }).catch(() => setStudents([]));
  }, [student, compact]);

  useEffect(() => {
    if (compact) return;
    storeView(view);
  }, [view, compact]);

  const load = useCallback(async ({ append = false, nextPage = 1 } = {}) => {
    if (!append) setLoading(true);
    setError("");
    try {
      const data = await fetchMyFiles(
        {
          section: apiSection,
          folder_id: apiSection === "my" ? folderId || "" : "",
          search: debouncedSearch,
          sort,
          order: sort === "name" || sort === "type" ? order : (order || "desc"),
          kind,
          page: nextPage,
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
      setItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
      setBreadcrumbs(data.breadcrumbs || [{ id: null, name: "Мои файлы" }]);
      setQuota(data.quota || null);
      setHasMore(Boolean(data.has_more));
      setPage(data.page || nextPage);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить файлы");
      if (!append) setItems([]);
    } finally {
      setLoading(false);
    }
  }, [apiSection, folderId, debouncedSearch, sort, order, kind, student, compact, acceptKinds]);

  useEffect(() => {
    if (activeWorkspace === "students") {
      setLoading(false);
      return;
    }
    load({ nextPage: 1 });
  }, [load, activeWorkspace]);

  useEffect(() => {
    if (!createOpen) return undefined;
    const onDoc = (e) => {
      if (!createWrapRef.current?.contains(e.target)) setCreateOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [createOpen]);

  const showNotice = (text) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2500);
  };

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(selectionKey(item))),
    [items, selectedKeys],
  );

  const openItem = async (item) => {
    if (item.kind === "folder") {
      if (apiSection === "trash") return;
      if (debouncedSearch && item.path?.length) {
        setActiveWorkspace("my");
        setFolder(item.id);
        setSearch("");
        return;
      }
      setActiveWorkspace("my");
      setFolder(item.id);
      setSelectedKeys(new Set());
      return;
    }
    if (selectable) {
      if (multiSelect) {
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          const key = selectionKey(item);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      } else {
        setSelectedKeys(new Set([selectionKey(item)]));
        onSelect?.(item);
      }
      return;
    }
    if (debouncedSearch && item.folder_id) {
      setSearch("");
      setFolder(item.folder_id);
    }
    setPreviewFile(item);
    try {
      const detail = await fetchMyFile(item.id, { student });
      setPreviewFile(detail);
    } catch {
      setPreviewFile(item);
    }
  };

  const handleSelectClick = (item, index, event) => {
    if (selectable) {
      openItem(item);
      return;
    }
    const key = selectionKey(item);
    const cmd = event.metaKey || event.ctrlKey;
    if (event.shiftKey) {
      const from = Math.min(anchorIndex, index);
      const to = Math.max(anchorIndex, index);
      setSelectedKeys(new Set(items.slice(from, to + 1).map(selectionKey)));
      return;
    }
    if (cmd) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setAnchorIndex(index);
      return;
    }
    setSelectedKeys(new Set([key]));
    setAnchorIndex(index);
  };

  const handleUploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const jobs = files.map((file) => ({ name: file.name, progress: 0, error: "", done: false }));
    setUploads(jobs);
    setError("");
    await Promise.all(files.map(async (file, index) => {
      try {
        await uploadMyFile(file, {
          folderId: apiSection === "my" ? folderId : null,
          student,
          onProgress: (progress) => {
            setUploads((prev) => prev.map((job, i) => (i === index ? { ...job, progress } : job)));
          },
        });
        setUploads((prev) => prev.map((job, i) => (i === index ? { ...job, progress: 100, done: true } : job)));
      } catch (err) {
        setUploads((prev) => prev.map((job, i) => (
          i === index ? { ...job, error: err?.message || "Ошибка загрузки", done: true } : job
        )));
      }
    }));
    const failed = files.length && true;
    if (failed) await load();
    window.setTimeout(() => setUploads([]), 1800);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCreateFolder = async () => {
    const name = createFolderName.trim();
    if (!name) return;
    try {
      await createMyFilesFolder(
        { name, parent_id: apiSection === "my" ? folderId : null },
        { student },
      );
      setCreateFolderOpen(false);
      setCreateFolderName("");
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

  const handleTrashItems = async (targets) => {
    const list = targets?.length ? targets : selectedItems;
    if (!list.length) return;
    try {
      if (list.length === 1) {
        const item = list[0];
        if (item.kind === "folder") await trashMyFilesFolder(item.id, { student });
        else await trashMyFile(item.id, { student });
      } else {
        await bulkTrashMyFiles({
          ids: list.filter((i) => i.kind === "file").map((i) => i.id),
          folder_ids: list.filter((i) => i.kind === "folder").map((i) => i.id),
        }, { student });
      }
      setDeleteItems(null);
      setSelectedKeys(new Set());
      if (previewFile && list.some((i) => i.id === previewFile.id)) setPreviewFile(null);
      showNotice("Перемещено в корзину");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось удалить");
    }
  };

  const handleRestore = async (item) => {
    try {
      if (item.kind === "folder") await restoreMyFilesFolder(item.id);
      else await restoreMyFile(item.id, {}, { student });
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

  const handleCopy = async (list) => {
    const files = (list || selectedItems).filter((i) => i.kind === "file");
    const folders = (list || selectedItems).filter((i) => i.kind === "folder");
    if (!files.length && !folders.length) return;
    try {
      if (files.length === 1 && !folders.length && !student) {
        await copyMyFile(files[0].id, { folder_id: folderId });
      } else if (!student) {
        await bulkCopyMyFiles({
          ids: files.map((i) => i.id),
          folder_ids: folders.map((i) => i.id),
          folder_id: folderId,
        });
      }
      showNotice("Копия создана");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось скопировать");
    }
  };

  const handleMoveTo = async (targetFolderId) => {
    const list = selectedItems.length ? selectedItems : [];
    await moveMyFiles({
      ids: list.filter((i) => i.kind === "file").map((i) => i.id),
      folder_ids: list.filter((i) => i.kind === "folder").map((i) => i.id),
      folder_id: targetFolderId,
    }, { student });
    setSelectedKeys(new Set());
    showNotice("Перемещено");
    await load();
  };

  const handleDropOnFolder = async (targetFolder, payload) => {
    if (!targetFolder || targetFolder.kind !== "folder") return;
    try {
      const ids = payload.ids || (payload.kind === "file" ? [payload.id] : []);
      const folderIds = payload.folder_ids || (payload.kind === "folder" ? [payload.id] : []);
      await moveMyFiles({ ids, folder_ids: folderIds, folder_id: targetFolder.id }, { student });
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось переместить");
    }
  };

  const confirmSelect = () => {
    if (!selectable) return;
    if (multiSelect) {
      onSelect?.(items.filter((i) => i.kind === "file" && selectedKeys.has(selectionKey(i))));
      return;
    }
    const one = items.find((i) => i.kind === "file" && selectedKeys.has(selectionKey(i)));
    if (one) onSelect?.(one);
  };

  useEffect(() => {
    if (compact || selectable) return undefined;
    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        setMenu(null);
        setPreviewFile(null);
        setRenameItem(null);
        setSelectedKeys(new Set());
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedItems.length && apiSection !== "trash") {
        e.preventDefault();
        setDeleteItems(selectedItems);
        return;
      }
      if (e.key === "Enter" && selectedItems.length === 1) {
        e.preventDefault();
        openItem(selectedItems[0]);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && items.length) {
        e.preventDefault();
        setSelectedKeys(new Set(items.map(selectionKey)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compact, selectable, selectedItems, apiSection, items]);

  const quotaPercent = quota?.percent ?? 0;
  const canWrite = apiSection !== "trash" && apiSection !== "recent";
  const filteredNavStudents = students.filter((s) => studentLabel(s).toLowerCase().includes(studentNavSearch.trim().toLowerCase()));
  const parentCrumb = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;

  const emptyNode = (() => {
    if (debouncedSearch) return <div className="cb-files__empty">Ничего не найдено</div>;
    if (apiSection === "trash") return <div className="cb-files__empty">Корзина пуста</div>;
    if (apiSection === "recent") return <div className="cb-files__empty">Недавних файлов пока нет</div>;
    if (folderId) {
      return (
        <div className="cb-files__empty cb-files__empty--onboard">
          <strong>Здесь пока нет файлов</strong>
          <p>Перетащите файлы сюда или нажмите «Создать».</p>
        </div>
      );
    }
    return (
      <div className="cb-files__empty cb-files__empty--onboard">
        <strong>Храните материалы в одном месте</strong>
        <p>Создавайте папки, загружайте файлы и отправляйте материалы ученикам.</p>
        {canWrite ? (
          <button type="button" className="cb-btn cb-btn--primary" onClick={() => fileInputRef.current?.click()}>
            Загрузить первый файл
          </button>
        ) : null}
      </div>
    );
  })();

  const renderRow = (item, index) => {
    const key = selectionKey(item);
    const isSelected = selectedKeys.has(key);
    const over = dropOverId === item.id;
    const isGrid = view === "grid" && !compact;
    return (
      <div
        key={item.id}
        className={`${isGrid ? "cb-files__tile" : "cb-files__row"}${isSelected ? " is-selected" : ""}${over ? " is-drop" : ""}`}
        role="button"
        tabIndex={0}
        draggable={!compact && canWrite}
        onDragStart={(e) => {
          const moving = isSelected ? selectedItems : [item];
          e.dataTransfer.setData("text/plain", JSON.stringify({
            ids: moving.filter((i) => i.kind === "file").map((i) => i.id),
            folder_ids: moving.filter((i) => i.kind === "folder").map((i) => i.id),
            id: item.id,
            kind: item.kind,
          }));
        }}
        onDragOver={(e) => {
          if (item.kind === "folder" && canWrite) {
            e.preventDefault();
            setDropOverId(item.id);
          }
        }}
        onDragLeave={() => {
          if (dropOverId === item.id) setDropOverId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropOverId(null);
          try {
            const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
            if (payload.id !== item.id) handleDropOnFolder(item, payload);
          } catch {
            /* ignore */
          }
        }}
        onClick={(e) => handleSelectClick(item, index, e)}
        onDoubleClick={(e) => {
          e.preventDefault();
          openItem(item);
        }}
        onContextMenu={(e) => {
          if (compact || selectable) return;
          e.preventDefault();
          if (!selectedKeys.has(key)) setSelectedKeys(new Set([key]));
          setMenu({ id: item.id, item, anchor: e.currentTarget });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openItem(item);
          }
        }}
      >
        {!compact && !selectable ? (
          <label className="cb-files__check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                const next = new Set(selectedKeys);
                if (e.target.checked) next.add(key);
                else next.delete(key);
                setSelectedKeys(next);
              }}
            />
          </label>
        ) : null}
        <FileThumb item={item} student={student} size={isGrid ? "md" : "sm"} />
        <div className="cb-files__meta">
          <div className="cb-files__name" title={itemName(item)}>{itemName(item)}</div>
          <div className="cb-files__sub">
            {debouncedSearch && item.path_label ? `${item.path_label} · ` : ""}
            {item.kind === "folder" ? "Папка" : `${extLabel(item)} · ${formatBytes(item.size)} · ${formatDate(item.updated_at)}`}
            {apiSection === "trash" && item.days_left != null ? ` · ещё ${item.days_left} дн.` : ""}
          </div>
        </div>
        {!isGrid && !compact ? (
          <>
            <div className="cb-files__col cb-files__col--type">{extLabel(item)}</div>
            <div className="cb-files__col cb-files__col--size">{item.kind === "folder" ? "—" : formatBytes(item.size)}</div>
            <div className="cb-files__col cb-files__col--date">{formatDate(item.updated_at)}</div>
          </>
        ) : null}
        {!selectable ? (
          <div className="cb-files__row-actions">
            <button
              type="button"
              className="cb-files__menu-btn"
              aria-label="Действия"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(menu?.id === item.id ? null : { id: item.id, item, anchor: e.currentTarget });
              }}
            >
              ⋯
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`cb-files${compact ? " cb-files--compact" : ""}`}>
      {!compact && activeWorkspace !== "students" && canWrite ? (
        <div className="cb-files__toolbar">
          <div className="cb-files__create-wrap" ref={createWrapRef}>
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
                <button type="button" role="menuitem" onClick={() => { setCreateOpen(false); setCreateFolderOpen(true); setCreateFolderName(""); }}>
                  Новая папка
                </button>
                <button type="button" role="menuitem" onClick={() => { setCreateOpen(false); fileInputRef.current?.click(); }}>
                  Загрузить файл
                </button>
                <button type="button" role="menuitem" onClick={() => { setCreateOpen(false); fileInputRef.current?.click(); }}>
                  Загрузить несколько файлов
                </button>
              </div>
            ) : null}
          </div>
          {apiSection === "trash" && !student ? (
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
          <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => handleUploadFiles(e.target.files)} />
        </div>
      ) : compact ? (
        <div className="cb-files__toolbar">
          <button type="button" className="cb-btn cb-btn--outline" onClick={() => fileInputRef.current?.click()}>
            Загрузить новый
          </button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => handleUploadFiles(e.target.files)} />
        </div>
      ) : null}

      {apiSection === "trash" && !compact ? (
        <div className="cb-files__toolbar">
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
        </div>
      ) : null}

      <div className="cb-files__layout">
        {!compact && !student ? (
          <>
            <button type="button" className="cb-files__nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
              <span>{WORKSPACES.find((w) => w.id === activeWorkspace)?.label || "Раздел"}</span>
              <CabinetIcon name="menu" />
            </button>
            <nav className={`cb-files__nav${navOpen ? " is-open" : ""}`} aria-label="Разделы файлов">
              {WORKSPACES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`cb-files__nav-btn${activeWorkspace === s.id && !(s.id === "students" && controlledStudentId) ? " is-active" : ""}${s.id === "recent" ? " cb-files__nav-btn--after-divider" : ""}`}
                  onClick={() => {
                    setActiveWorkspace(s.id);
                    if (s.id === "my") setFolder(null);
                    if (s.id === "students") onStudentChange?.(null);
                  }}
                >
                  {s.label}
                </button>
              ))}
              {activeWorkspace === "students" || students.length ? (
                <div className="cb-files__nav-students">
                  <input
                    type="search"
                    className="cb-files__nav-search"
                    placeholder="Ученик…"
                    value={studentNavSearch}
                    onChange={(e) => setStudentNavSearch(e.target.value)}
                    onFocus={() => setActiveWorkspace("students")}
                  />
                  {filteredNavStudents.slice(0, 12).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`cb-files__nav-btn cb-files__nav-btn--student${String(controlledStudentId) === String(s.id) ? " is-active" : ""}`}
                      onClick={() => {
                        setActiveWorkspace("students");
                        onStudentChange?.(String(s.id));
                      }}
                    >
                      {studentLabel(s)}
                    </button>
                  ))}
                </div>
              ) : null}
            </nav>
          </>
        ) : null}

        <div className="cb-files__main">
          {activeWorkspace === "students" && !student ? (
            <StudentFilesWorkspace
              studentId={controlledStudentId}
              folderId={controlledStudentFolderId}
              onStudentChange={onStudentChange}
              onFolderChange={onStudentFolderChange}
              onNotice={showNotice}
            />
          ) : (
            <>
              {quota && activeWorkspace === "my" ? (
                <div className="cb-files__quota">
                  Использовано {formatBytes(quota.used_bytes)} из {formatBytes(quota.limit_bytes)} ({quotaPercent}%)
                  <div className={`cb-files__quota-bar${quota.warning ? " is-warn" : ""}`}>
                    <span style={{ width: `${Math.min(100, quotaPercent)}%` }} />
                  </div>
                </div>
              ) : null}

              <div className="cb-files__crumbs-row">
                {parentCrumb && apiSection === "my" ? (
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-files__back"
                    onClick={() => setFolder(parentCrumb.id)}
                  >
                    <CabinetIcon name="arrowLeft" />
                    Назад
                  </button>
                ) : null}
                <div className="cb-files__crumbs">
                  {breadcrumbs.map((crumb, idx) => {
                    const current = idx === breadcrumbs.length - 1;
                    return (
                      <span key={`${crumb.id || "root"}-${idx}`} className="cb-files__crumb-wrap">
                        {idx > 0 ? <span className="cb-files__crumb-sep">/</span> : null}
                        <button
                          type="button"
                          className={`cb-files__crumb${current ? " is-current" : ""}`}
                          onClick={() => {
                            if (current) return;
                            setActiveWorkspace("my");
                            setFolder(crumb.id);
                          }}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>

              {selectedItems.length && !selectable ? (
                <div className="cb-files__selection">
                  <span>Выбрано: {selectedItems.length}</span>
                  {canWrite ? (
                    <>
                      <button type="button" className="cb-btn cb-btn--outline" onClick={() => setMoveOpen(true)}>Переместить</button>
                      {!student ? (
                        <button type="button" className="cb-btn cb-btn--outline" onClick={() => setCopyTarget({ files: selectedItems.filter((i) => i.kind === "file"), materials: [] })}>
                          Скопировать ученикам
                        </button>
                      ) : null}
                      <button type="button" className="cb-btn cb-btn--outline" onClick={() => setDeleteItems(selectedItems)}>Удалить</button>
                    </>
                  ) : null}
                  <button type="button" className="cb-btn cb-btn--secondary" onClick={() => setSelectedKeys(new Set())}>Снять выделение</button>
                </div>
              ) : (
                <div className="cb-files__toolbar">
                  <input
                    type="search"
                    className="cb-files__search"
                    placeholder="Поиск в файлах"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <label className="cb-files__select-wrap">
                    <span className="cb-files__select-label">Сортировка</span>
                    <select
                      className="cb-files__select"
                      value={sort}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSort(next);
                        setOrder(next === "updated" || next === "size" ? "desc" : "asc");
                      }}
                    >
                      <option value="name">По названию</option>
                      <option value="updated">По изменению</option>
                      <option value="size">По размеру</option>
                      <option value="type">По типу</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="cb-files__order"
                    onClick={() => setOrder((v) => (v === "asc" ? "desc" : "asc"))}
                    aria-label={order === "asc" ? "По возрастанию" : "По убыванию"}
                  >
                    {order === "asc" ? "↑" : "↓"}
                  </button>
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
              )}

              {!compact && canWrite ? (
                <div
                  className={`cb-files__drop${dropActive ? " is-active" : ""}`}
                  onDragOver={(e) => {
                    if ([...e.dataTransfer.items].some((it) => it.kind === "file")) {
                      e.preventDefault();
                      setDropActive(true);
                    }
                  }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropActive(false);
                    if (e.dataTransfer.files?.length) handleUploadFiles(e.dataTransfer.files);
                  }}
                >
                  Перетащите файлы сюда, чтобы загрузить
                </div>
              ) : null}

              {uploads.length ? (
                <div className="cb-files__uploads">
                  <p>Загружается {uploads.length} {uploads.length === 1 ? "файл" : "файла"}</p>
                  {uploads.map((job) => (
                    <div key={job.name} className={`cb-files__upload-row${job.error ? " is-error" : ""}`}>
                      <span>{job.name}</span>
                      <span>{job.error || `${job.progress}%`}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {notice ? <p className="cb-page-sub">{notice}</p> : null}
              {error ? <div className="cb-files__error">{error}</div> : null}

              {loading ? (
                <div className="cb-files__skeleton" aria-busy="true">
                  <div className="cb-files__skel-row" /><div className="cb-files__skel-row" /><div className="cb-files__skel-row" />
                </div>
              ) : items.length === 0 ? emptyNode : (
                <>
                  {view !== "grid" && !compact ? (
                    <div className="cb-files__list-head" aria-hidden>
                      <span />
                      <span />
                      <span>Название</span>
                      <span>Тип</span>
                      <span>Размер</span>
                      <span>Изменён</span>
                      <span />
                    </div>
                  ) : null}
                  <div className={view === "grid" && !compact ? "cb-files__grid" : "cb-files__list"}>
                    {items.map(renderRow)}
                  </div>
                  {hasMore ? (
                    <button type="button" className="cb-btn cb-btn--outline" onClick={() => load({ append: true, nextPage: page + 1 })}>
                      Показать ещё
                    </button>
                  ) : null}
                </>
              )}

              {selectable ? (
                <div className="cb-files__toolbar" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="cb-btn cb-btn--primary"
                    disabled={multiSelect ? selectedItems.filter((i) => i.kind === "file").length === 0 : selectedItems[0]?.kind !== "file"}
                    onClick={confirmSelect}
                  >
                    Выбрать
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <CabinetFloatingMenu open={Boolean(menu)} anchorEl={menu?.anchor} onClose={() => setMenu(null)}>
        {menu?.item && apiSection !== "trash" ? (
          <>
            <div className="cb-files__menu-group">
              <button type="button" onClick={() => { openItem(menu.item); setMenu(null); }}>
                {menu.item.kind === "folder" ? "Открыть" : "Предпросмотр"}
              </button>
              <button type="button" onClick={() => { setRenameItem(menu.item); setRenameValue(itemName(menu.item)); setMenu(null); }}>
                Переименовать
              </button>
              <button type="button" onClick={() => { setSelectedKeys(new Set([selectionKey(menu.item)])); setMoveOpen(true); setMenu(null); }}>
                Переместить
              </button>
              {!student ? (
                <button type="button" onClick={() => { handleCopy([menu.item]); setMenu(null); }}>
                  Создать копию
                </button>
              ) : null}
            </div>
            {menu.item.kind === "file" && !student ? (
              <div className="cb-files__menu-group">
                <button type="button" onClick={() => { setCopyTarget({ files: [menu.item], materials: [] }); setMenu(null); }}>
                  Скопировать ученикам
                </button>
                <button type="button" onClick={() => { setAssignItem(menu.item); setMenu(null); }}>
                  Выдать как задание
                </button>
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
              <button type="button" onClick={() => { setDeleteItems([menu.item]); setMenu(null); }}>
                Удалить
              </button>
            </div>
          </>
        ) : menu?.item ? (
          <div className="cb-files__menu-group">
            <button type="button" onClick={() => { handleRestore(menu.item); setMenu(null); }}>Восстановить</button>
            {menu.item.kind === "file" ? (
              <button type="button" onClick={() => { setPurgeItem(menu.item); setPurgeForce(false); setPurgeRelations([]); setMenu(null); }}>
                Удалить окончательно
              </button>
            ) : null}
          </div>
        ) : null}
      </CabinetFloatingMenu>

      {previewFile ? (
        <FilePreviewModal
          file={previewFile}
          student={student}
          files={items}
          onClose={() => setPreviewFile(null)}
          onChange={setPreviewFile}
          onMenu={(e, file) => setMenu({ id: file.id, item: file, anchor: e.currentTarget })}
        />
      ) : null}

      {createFolderOpen ? (
        <CabinetModal
          title="Новая папка"
          onClose={() => setCreateFolderOpen(false)}
          footer={(
            <>
              <button type="button" className="cb-btn cb-btn--secondary" onClick={() => setCreateFolderOpen(false)}>Отмена</button>
              <button type="button" className="cb-btn cb-btn--primary" onClick={handleCreateFolder} disabled={!createFolderName.trim()}>Создать</button>
            </>
          )}
        >
          <label className="cb-field">
            <span>Название</span>
            <input
              autoFocus
              value={createFolderName}
              onChange={(e) => setCreateFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setCreateFolderOpen(false);
              }}
            />
          </label>
        </CabinetModal>
      ) : null}

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
            <input
              ref={renameRef}
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenameItem(null);
              }}
            />
          </label>
        </CabinetModal>
      ) : null}

      <FileMovePickerModal
        open={moveOpen}
        student={student}
        movingFolders={selectedItems.filter((i) => i.kind === "folder")}
        currentFolderId={folderId}
        onClose={() => setMoveOpen(false)}
        onMove={handleMoveTo}
      />

      <CopyToStudentsModal
        open={Boolean(copyTarget)}
        files={copyTarget?.files || []}
        materials={copyTarget?.materials || []}
        onClose={() => setCopyTarget(null)}
        onCopied={(result) => {
          const n = result?.created_count || 0;
          const skipped = result?.skipped_count || 0;
          showNotice(skipped ? `Скопировано: ${n}, уже было: ${skipped}` : "Скопировано ученикам");
        }}
      />

      {deleteItems?.length ? (
        <ConfirmActionModal
          open
          danger
          title={deleteItems.length === 1 ? `Удалить «${itemName(deleteItems[0])}»?` : `Удалить выбранное (${deleteItems.length})?`}
          confirmLabel="Удалить"
          onClose={() => setDeleteItems(null)}
          onConfirm={() => handleTrashItems(deleteItems)}
          text={
            deleteItems.some((i) => i.kind === "folder")
              ? "Папка и все содержащиеся в ней файлы будут перемещены в корзину."
              : "Файл будет перемещён в корзину."
          }
        />
      ) : null}

      {purgeItem ? (
        <ConfirmActionModal
          open
          title="Удалить окончательно?"
          confirmLabel={purgeForce ? "Всё равно удалить" : "Удалить"}
          danger
          onClose={() => { setPurgeItem(null); setPurgeForce(false); setPurgeRelations([]); }}
          onConfirm={handlePurge}
          text={(
            <>
              <p>Файл «{itemName(purgeItem)}» будет удалён без возможности восстановления.</p>
              {purgeRelations.length ? (
                <ul>{purgeRelations.map((r) => <li key={r.relation_id}>{r.label}: {r.title || "—"}</li>)}</ul>
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
          onAssigned={() => { showNotice("Файл выдан"); load(); }}
        />
      ) : null}
    </div>
  );
}
