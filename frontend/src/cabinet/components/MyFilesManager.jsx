import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bulkCopyMyFiles,
  bulkTrashMyFiles,
  copyMyFile,
  createMyFilesFolder,
  emptyMyFilesTrash,
  fetchMyFile,
  fetchMyFiles,
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
import { formatStorageBytes, isQuotaExceededError, quotaExceededMessage, quotaPayloadFromError } from "../storageFormat";
import QuotaExceededNotice from "./QuotaExceededNotice";
import EducationalLoading, { LOADING_MESSAGES } from "../../components/EducationalLoading";
import CabinetModal from "./CabinetModal";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import ConfirmActionModal from "./ConfirmActionModal";
import MyFileAssignModal from "./MyFileAssignModal";
import StudentFilesWorkspace from "./StudentFilesWorkspace";
import CabinetIcon from "../CabinetIcons";
import CopyToStudentsModal from "./files/CopyToStudentsModal";
import FileMovePickerModal from "./files/FileMovePickerModal";
import FilePreviewModal from "./files/FilePreviewModal";
import {
  KIND_OPTIONS,
  extLabel,
  formatBytes,
  formatDate,
  isTypingTarget,
  itemName,
  normalizeExt,
  previewKind,
  readStoredView,
  storeView,
} from "./files/fileUtils";
import "../styles/my-files.css";

const FOLDER_TONES = ["#dce7fb", "#e7f3ea", "#f8ead8", "#efe6f8", "#f8e4e4", "#e4f2f4"];
const SHEET_EXTS = new Set([".xls", ".xlsx", ".csv", ".ods", ".tsv"]);
const DOC_EXTS = new Set([".doc", ".docx", ".odt", ".rtf"]);

function folderTone(id) {
  const value = String(id || "");
  let n = 0;
  for (let i = 0; i < value.length; i += 1) n += value.charCodeAt(i);
  return FOLDER_TONES[n % FOLDER_TONES.length];
}

function badgeKind(item) {
  const kind = previewKind(item);
  const ext = normalizeExt(item);
  if (kind === "pdf") return "pdf";
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === "text") return "text";
  if (SHEET_EXTS.has(ext)) return "sheet";
  if (DOC_EXTS.has(ext)) return "doc";
  return "other";
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

function FileBadge({ item, large = false }) {
  const kind = badgeKind(item);
  const label = extLabel(item);
  return (
    <span className={`cbf-badge cbf-badge--${kind}${large ? " is-large" : ""}`} aria-hidden>
      {label.length > 4 ? "ФАЙЛ" : label}
    </span>
  );
}

function TileArt({ item, student }) {
  const kind = previewKind(item);
  const [failed, setFailed] = useState(false);
  if (kind === "image" && !failed) {
    return (
      <img
        src={myFilePreviewUrl(item.id, { student })}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  if (kind === "video") {
    return <span className="cbf-video-art"><CabinetIcon name="video" /></span>;
  }
  return <FileBadge item={item} large />;
}

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
  const [internalFolderId, setInternalFolderId] = useState(null);
  const [recordingsOn, setRecordingsOn] = useState(false);
  const folderId = controlledFolderId !== undefined ? controlledFolderId : internalFolderId;
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;
  const activeWorkspace = controlledWorkspace ?? workspace;

  const setFolder = (next) => {
    if (onFolderChange) onFolderChange(next || null);
    else setInternalFolderId(next || null);
  };

  const setActiveWorkspace = (next) => {
    if (next !== activeWorkspace) {
      if (onWorkspaceChange) onWorkspaceChange(next);
      else {
        setWorkspace(next);
        if (next !== "my") setFolder(null);
      }
    }
    setSelectedKeys(new Set());
    setPreviewFile(null);
  };

  useEffect(() => {
    if (controlledWorkspace != null) setWorkspace(controlledWorkspace);
  }, [controlledWorkspace]);

  const apiSection = activeWorkspace === "students" ? "my" : activeWorkspace;
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: "Мои файлы" }]);
  const [quota, setQuota] = useState(null);
  const [quotaError, setQuotaError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState("asc");
  const [kind, setKind] = useState("");
  const [view, setView] = useState(() => (compact ? "list" : readStoredView("list")));
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [menu, setMenu] = useState(null);
  const [dropOverId, setDropOverId] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [notice, setNotice] = useState("");
  const [renameItem, setRenameItem] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
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
  const fileInputRef = useRef(null);
  const renameRef = useRef(null);
  const shellRef = useRef(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 320);
    return () => window.clearTimeout(t);
  }, [search]);

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

  const currentUploadFolderId = () => {
    const selectedFolders = selectedItems.filter((item) => item.kind === "folder");
    if (selectedFolders.length === 1 && selectedItems.length === 1) {
      return selectedFolders[0].id;
    }
    return apiSection === "my" ? folderIdRef.current : null;
  };

  const handleUploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const targetFolderId = currentUploadFolderId();
    const totalSize = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    const used = Number(quota?.storage_used_bytes ?? quota?.used_bytes ?? 0);
    const limit = Number(quota?.storage_limit_bytes ?? quota?.limit_bytes ?? 0);
    if (limit > 0 && used + totalSize > limit) {
      const payload = {
        ...(quota || {}),
        storage_used_bytes: used,
        storage_limit_bytes: limit,
      };
      const message = quotaExceededMessage(payload);
      setQuotaError({ message, quota: payload });
      setError(message);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const jobs = files.map((file) => ({ name: file.name, progress: 0, error: "", done: false }));
    setUploads(jobs);
    setError("");
    setQuotaError(null);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        await uploadMyFile(file, {
          folderId: targetFolderId,
          student,
          onProgress: (progress) => {
            setUploads((prev) => prev.map((job, i) => (i === index ? { ...job, progress } : job)));
          },
        });
        setUploads((prev) => prev.map((job, i) => (i === index ? { ...job, progress: 100, done: true } : job)));
      } catch (err) {
        const quotaHit = isQuotaExceededError(err);
        const payload = quotaPayloadFromError(err, quota);
        const message = quotaHit ? quotaExceededMessage(payload) : (err?.message || "Ошибка загрузки");
        setUploads((prev) => prev.map((job, i) => (
          i === index ? { ...job, error: message, done: true } : job
        )));
        if (quotaHit) {
          setQuotaError({ message, quota: payload });
          setError(message);
          break;
        }
      }
    }
    await load();
    window.setTimeout(() => setUploads([]), 1800);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCreateFolder = async () => {
    const name = createFolderName.trim();
    if (!name) return;
    try {
      await createMyFilesFolder(
        { name, parent_id: apiSection === "my" ? folderIdRef.current : null },
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

  const handleRestoreItems = async (list) => {
    if (!list?.length) return;
    try {
      for (const item of list) {
        if (item.kind === "folder") await restoreMyFilesFolder(item.id);
        else await restoreMyFile(item.id, {}, { student });
      }
      setSelectedKeys(new Set());
      showNotice("Восстановлено");
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось восстановить");
    }
  };

  const handleToggleFavorite = async (item) => {
    const next = !item.is_favorite;
    try {
      if (item.kind === "folder") {
        await updateMyFilesFolder(item.id, { is_favorite: next }, { student });
      } else {
        await updateMyFile(item.id, { is_favorite: next }, { student });
      }
      setItems((prev) => prev.map((row) => (
        row.id === item.id && row.kind === item.kind ? { ...row, is_favorite: next } : row
      )));
    } catch (err) {
      setError(err?.message || "Не удалось обновить избранное");
    }
  };

  const applyCollection = (id) => {
    setSelectedKeys(new Set());
    setRecordingsOn(id === "recordings");
    if (id === "recordings") {
      setKind("video");
      setActiveWorkspace("my");
      return;
    }
    setKind("");
    setActiveWorkspace(id === "all" ? "my" : id);
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
        await copyMyFile(files[0].id, { folder_id: folderIdRef.current });
      } else if (!student) {
        await bulkCopyMyFiles({
          ids: files.map((i) => i.id),
          folder_ids: folders.map((i) => i.id),
          folder_id: folderIdRef.current,
        });
      }
      showNotice("Копия создана");
      await load();
    } catch (err) {
      if (isQuotaExceededError(err)) {
        const payload = quotaPayloadFromError(err, quota);
        const message = quotaExceededMessage(payload);
        setQuotaError({ message, quota: payload });
        setError(message);
        return;
      }
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

  const usedBytes = Number(quota?.storage_used_bytes ?? quota?.used_bytes ?? 0);
  const limitBytes = Number(quota?.storage_limit_bytes ?? quota?.limit_bytes ?? 0);
  const availableBytes = Number(quota?.available_bytes ?? Math.max(0, limitBytes - usedBytes));
  const quotaBreakdown = Array.isArray(quota?.breakdown) ? quota.breakdown.filter((row) => row.used_bytes > 0) : [];
  const canUpgradeStorage = Boolean(quota?.can_upgrade) && !student;
  const canWrite = apiSection !== "trash";
  const parentCrumb = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : null;
  const collection = recordingsOn && activeWorkspace === "my"
    ? "recordings"
    : activeWorkspace === "recent" ? "recent"
      : activeWorkspace === "favorites" ? "favorites"
        : activeWorkspace === "trash" ? "trash"
          : "all";
  const showStudents = activeWorkspace === "students" && !student && !compact;
  const folders = items.filter((item) => item.kind === "folder");
  const files = items.filter((item) => item.kind === "file");
  const allSelected = items.length > 0 && items.every((item) => selectedKeys.has(selectionKey(item)));
  const listTitle = debouncedSearch
    ? "Результаты поиска"
    : collection === "trash" ? "Удалённые файлы"
      : collection === "recordings" ? "Записи уроков"
        : collection === "favorites" ? "Избранное"
          : "Файлы";

  const emptyCopy = (() => {
    if (debouncedSearch) {
      return {
        title: "Ничего не найдено",
        text: "Попробуйте другое название или сбросьте фильтры.",
        action: "Сбросить фильтры",
        onClick: () => { setSearch(""); setKind(""); setRecordingsOn(false); },
      };
    }
    if (collection === "trash") {
      return {
        title: "Корзина пуста",
        text: "Здесь появятся удалённые файлы и папки.",
        action: "К файлам",
        onClick: () => applyCollection("all"),
      };
    }
    if (collection === "favorites") {
      return {
        title: "Здесь будет избранное",
        text: "Отмечайте важные материалы звёздочкой, чтобы быстро возвращаться к ним.",
        action: "Посмотреть все файлы",
        onClick: () => applyCollection("all"),
      };
    }
    if (collection === "recordings") {
      return {
        title: "Пока нет записей уроков",
        text: "Видеофайлы в этой папке появятся в подборке.",
        action: "К файлам",
        onClick: () => applyCollection("all"),
      };
    }
    if (kind) {
      return {
        title: "Ничего не найдено",
        text: "В этой папке нет файлов выбранного типа.",
        action: "Сбросить фильтры",
        onClick: () => { setKind(""); setRecordingsOn(false); },
      };
    }
    if (collection === "recent") {
      return {
        title: "Недавних файлов пока нет",
        text: "Файлы, которые вы открывали, появятся здесь.",
        action: "К файлам",
        onClick: () => applyCollection("all"),
      };
    }
    if (folderId) {
      return {
        title: "В этой папке пока пусто",
        text: "Добавьте материалы с компьютера или создайте вложенную папку.",
        action: canWrite ? "Загрузить файлы" : "",
        onClick: () => fileInputRef.current?.click(),
      };
    }
    return {
      title: "Храните материалы в одном месте",
      text: "Создавайте папки, загружайте файлы и отмечайте нужное избранным.",
      action: canWrite ? "Загрузить файлы" : "",
      onClick: () => fileInputRef.current?.click(),
    };
  })();

  const itemEvents = (item) => ({
    draggable: !compact && canWrite && apiSection !== "trash",
    onDragStart: (e) => {
      const moving = selectedKeys.has(selectionKey(item)) ? selectedItems : [item];
      e.dataTransfer.setData("text/plain", JSON.stringify({
        ids: moving.filter((row) => row.kind === "file").map((row) => row.id),
        folder_ids: moving.filter((row) => row.kind === "folder").map((row) => row.id),
        id: item.id,
        kind: item.kind,
      }));
    },
    onDragOver: (e) => {
      if (item.kind === "folder" && canWrite) {
        e.preventDefault();
        setDropOverId(item.id);
      }
    },
    onDragLeave: () => {
      if (dropOverId === item.id) setDropOverId(null);
    },
    onDrop: (e) => {
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw || item.kind !== "folder") return;
      e.preventDefault();
      e.stopPropagation();
      setDropOverId(null);
      setDropActive(false);
      try {
        const payload = JSON.parse(raw);
        if (payload.id !== item.id) handleDropOnFolder(item, payload);
      } catch {
        /* ignore */
      }
    },
    onContextMenu: (e) => {
      if (compact || selectable) return;
      e.preventDefault();
      const key = selectionKey(item);
      if (!selectedKeys.has(key)) setSelectedKeys(new Set([key]));
      setMenu({ id: item.id, item, anchor: e.currentTarget });
    },
  });

  const toggleKey = (item, checked) => {
    const key = selectionKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const openMenu = (item, anchor) => {
    setMenu(menu?.id === item.id && menu?.item?.kind === item.kind ? null : { id: item.id, item, anchor });
  };

  return (
    <div className={`cb-files cb-files-shell${compact ? " cb-files--compact" : ""}`}>
      {!compact && !showStudents ? (
        <div className="cbf-actions">
          <button type="button" className="cbf-btn" disabled={!canWrite} onClick={() => { setCreateFolderOpen(true); setCreateFolderName(""); }}>
            <CabinetIcon name="plus" />
            Новая папка
          </button>
          <button type="button" className="cbf-btn cbf-btn--blue" disabled={!canWrite} onClick={() => fileInputRef.current?.click()}>
            <CabinetIcon name="share" />
            Загрузить файлы
          </button>
        </div>
      ) : null}
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => handleUploadFiles(e.target.files)} />

      <section
        className={`cbf-shell${dropActive ? " is-drag" : ""}`}
        ref={shellRef}
        aria-label="Файловый менеджер"
        onDragOver={(e) => {
          if (!canWrite || compact) return;
          const external = [...e.dataTransfer.items].some((it) => it.kind === "file");
          if (!external) return;
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={(e) => {
          if (!shellRef.current?.contains(e.relatedTarget)) setDropActive(false);
        }}
        onDrop={(e) => {
          if (!canWrite) return;
          e.preventDefault();
          setDropActive(false);
          if (e.dataTransfer.files?.length) handleUploadFiles(e.dataTransfer.files);
        }}
      >
        {!compact && !student ? (
          <div className="cbf-tabs" role="tablist" aria-label="Чьи файлы">
            <button
              type="button"
              className="cbf-tab"
              role="tab"
              id="myFilesTab"
              aria-selected={activeWorkspace !== "students"}
              onClick={() => applyCollection("all")}
            >
              <CabinetIcon name="folder" />
              Мои файлы
            </button>
            <button
              type="button"
              className="cbf-tab"
              role="tab"
              id="studentFilesTab"
              aria-selected={activeWorkspace === "students"}
              onClick={() => setActiveWorkspace("students")}
            >
              <CabinetIcon name="users" />
              Файлы учеников
            </button>
            {activeWorkspace !== "students" ? (
              <span className="cbf-private">
                <CabinetIcon name="lock" />
                Личные файлы видны только вам
              </span>
            ) : null}
          </div>
        ) : null}

        {showStudents ? (
          <div className="cbf-students">
            <StudentFilesWorkspace
              studentId={controlledStudentId}
              folderId={controlledStudentFolderId}
              onStudentChange={onStudentChange}
              onFolderChange={onStudentFolderChange}
              onNotice={showNotice}
            />
          </div>
        ) : (
          <div role="tabpanel" aria-labelledby={activeWorkspace === "students" ? "studentFilesTab" : "myFilesTab"}>
            <div className="cbf-tools">
              <label className="cbf-search">
                <span className="cbf-sr">Поиск в файлах и папках</span>
                <CabinetIcon name="search" />
                <input
                  type="search"
                  value={search}
                  placeholder={student ? "Поиск в моих файлах и папках" : "Поиск в моих файлах и папках"}
                  autoComplete="off"
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search ? (
                  <button type="button" className="cbf-search-clear" aria-label="Очистить поиск" onClick={() => setSearch("")}>
                    <CabinetIcon name="close" />
                  </button>
                ) : null}
              </label>
              {compact ? (
                <button type="button" className="cbf-btn" onClick={() => fileInputRef.current?.click()}>
                  Загрузить
                </button>
              ) : null}
              <label className="cbf-select cbf-select--type">
                <span className="cbf-sr">Тип файла</span>
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setRecordingsOn(false);
                  }}
                >
                  {KIND_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {!compact ? (
              <nav className="cbf-filters" aria-label="Подборки файлов">
                {[
                  { id: "all", label: "Все файлы" },
                  { id: "recent", label: "Недавние", icon: "clock" },
                  { id: "favorites", label: "Избранное", icon: "star" },
                  { id: "recordings", label: "Записи уроков", icon: "video" },
                  { id: "trash", label: "Корзина", icon: "trash" },
                ].map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`cbf-chip${collection === chip.id ? " is-active" : ""}`}
                    aria-pressed={collection === chip.id}
                    onClick={() => applyCollection(chip.id)}
                  >
                    {chip.icon ? <CabinetIcon name={chip.icon} /> : null}
                    {chip.label}
                  </button>
                ))}
              </nav>
            ) : null}

            <div className="cbf-body">
              {selectedItems.length && !selectable ? (
                <div className="cbf-bulk">
                  <span className="cbf-bulk-count">Выбрано: {selectedItems.length}</span>
                  {canWrite && apiSection !== "recent" ? (
                    <button type="button" className="cbf-btn" onClick={() => setMoveOpen(true)}>
                      <CabinetIcon name="folder" />
                      Переместить
                    </button>
                  ) : null}
                  {canWrite && !student ? (
                    <button
                      type="button"
                      className="cbf-btn cbf-btn--blue"
                      onClick={() => setCopyTarget({ files: selectedItems.filter((i) => i.kind === "file"), materials: [] })}
                    >
                      <CabinetIcon name="users" />
                      Скопировать ученикам
                    </button>
                  ) : null}
                  {apiSection === "trash" ? (
                    <button type="button" className="cbf-btn cbf-btn--soft" onClick={() => handleRestoreItems(selectedItems)}>
                      <CabinetIcon name="undo" />
                      Восстановить
                    </button>
                  ) : (
                    <button type="button" className="cbf-btn cbf-btn--danger" onClick={() => setDeleteItems(selectedItems)}>
                      <CabinetIcon name="trash" />
                      Удалить
                    </button>
                  )}
                  <button type="button" className="cbf-icon-btn" aria-label="Снять выделение" onClick={() => setSelectedKeys(new Set())}>
                    <CabinetIcon name="close" />
                  </button>
                </div>
              ) : (
                <div className="cbf-dir">
                  <button
                    type="button"
                    className="cbf-back"
                    aria-label="На папку выше"
                    disabled={!parentCrumb || apiSection !== "my"}
                    onClick={() => parentCrumb && setFolder(parentCrumb.id)}
                  >
                    <CabinetIcon name="arrowLeft" />
                  </button>
                  <nav className="cbf-crumbs" aria-label="Путь к папке">
                    {breadcrumbs.map((crumb, idx) => {
                      const current = idx === breadcrumbs.length - 1;
                      return (
                        <span key={`${crumb.id || "root"}-${idx}`} className="cbf-crumb">
                          {idx > 0 ? <CabinetIcon name="arrow" /> : null}
                          <button
                            type="button"
                            className={current ? "is-current" : ""}
                            onClick={() => {
                              if (current || apiSection !== "my") return;
                              setActiveWorkspace("my");
                              setFolder(crumb.id);
                            }}
                          >
                            {crumb.name}
                          </button>
                        </span>
                      );
                    })}
                  </nav>
                  <div className="cbf-dir-controls">
                    <label className="cbf-select cbf-select--sort">
                      <span className="cbf-sr">Сортировка</span>
                      <select
                        value={sort}
                        onChange={(e) => {
                          const next = e.target.value;
                          setSort(next);
                          setOrder(next === "updated" || next === "size" ? "desc" : "asc");
                        }}
                      >
                        <option value="updated">По дате</option>
                        <option value="name">По названию</option>
                        <option value="size">По размеру</option>
                        <option value="type">По типу</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="cbf-icon-btn cbf-sort-dir"
                      aria-label="Изменить направление сортировки"
                      title={order === "asc" ? "По возрастанию" : "По убыванию"}
                      onClick={() => setOrder((v) => (v === "asc" ? "desc" : "asc"))}
                    >
                      {order === "asc" ? "↑" : "↓"}
                    </button>
                    {!compact ? (
                      <div className="cbf-view" aria-label="Вид файлов">
                        <button type="button" className={view === "list" ? "is-active" : ""} aria-pressed={view === "list"} aria-label="Список" onClick={() => setView("list")}>
                          <CabinetIcon name="order" />
                        </button>
                        <button type="button" className={view === "grid" ? "is-active" : ""} aria-pressed={view === "grid"} aria-label="Плитки" onClick={() => setView("grid")}>
                          <CabinetIcon name="cards" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {apiSection === "trash" && !compact ? (
                <p className="cbf-restore-note">
                  Удалённые материалы можно восстановить. Файлы в корзине продолжают занимать место.
                  {!student ? (
                    <button
                      type="button"
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
                </p>
              ) : null}

              {uploads.length ? (
                <div className="cbf-uploads">
                  <EducationalLoading
                    compact
                    align="start"
                    message={
                      uploads.some((job) => !job.error)
                      && uploads.filter((job) => !job.error && !job.done).every((job) => job.progress >= 90)
                        ? LOADING_MESSAGES.almost
                        : LOADING_MESSAGES.file
                    }
                  />
                  {uploads.map((job) => (
                    <div key={job.name} className={`cbf-upload${job.error ? " is-error" : ""}`}>
                      <span>{job.name}</span>
                      <span>{job.error || `${job.progress}%`}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {notice ? <p className="cbf-toast" role="status">{notice}</p> : null}
              {quotaError ? (
                <QuotaExceededNotice
                  message={quotaError.message}
                  quota={quotaError.quota}
                  showOpenFiles={false}
                  showUpgrade={canUpgradeStorage}
                />
              ) : error ? <div className="cbf-error">{error}</div> : null}

              {loading ? (
                <div className="cbf-skeleton" aria-busy="true">
                  <div /><div /><div />
                </div>
              ) : items.length === 0 ? (
                <div className="cbf-empty">
                  <span className="cbf-empty-icon"><CabinetIcon name="folder" /></span>
                  <h3>{emptyCopy.title}</h3>
                  <p>{emptyCopy.text}</p>
                  {emptyCopy.action ? (
                    <button type="button" className="cbf-btn cbf-btn--blue" onClick={emptyCopy.onClick}>{emptyCopy.action}</button>
                  ) : null}
                </div>
              ) : (
                <>
                  {folders.length ? (
                    <div className="cbf-folders">
                      {folders.map((item) => {
                        const key = selectionKey(item);
                        const selected = selectedKeys.has(key);
                        return (
                          <article
                            key={key}
                            className={`cbf-folder${selected ? " is-selected" : ""}${dropOverId === item.id ? " is-drop" : ""}`}
                            {...itemEvents(item)}
                          >
                            <button
                              type="button"
                              className="cbf-folder-open"
                              style={{ "--cbf-folder": folderTone(item.id) }}
                              title={`Открыть папку ${itemName(item)}`}
                              onClick={() => openItem(item)}
                            >
                              <span className="cbf-folder-art" aria-hidden />
                              <span className="cbf-folder-text">
                                <strong>{itemName(item)}</strong>
                                <small>{apiSection === "trash" && item.days_left != null ? `Ещё ${item.days_left} дн.` : "Папка"}</small>
                              </span>
                            </button>
                            {!selectable ? (
                              <button
                                type="button"
                                className="cbf-folder-more"
                                aria-label={`Действия с папкой ${itemName(item)}`}
                                onClick={(e) => { e.stopPropagation(); openMenu(item, e.currentTarget); }}
                              >
                                <CabinetIcon name="more" />
                              </button>
                            ) : null}
                            {!compact ? (
                              <input
                                className="cbf-folder-check"
                                type="checkbox"
                                checked={selected}
                                aria-label={`Выбрать папку ${itemName(item)}`}
                                onChange={(e) => toggleKey(item, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}

                  {files.length ? (
                    <div className="cbf-list-head">
                      <h2>{listTitle}<span>{files.length}</span></h2>
                      <p>Нажмите на название, чтобы открыть</p>
                    </div>
                  ) : null}

                  {files.length && (view !== "grid" || compact) ? (
                    <table className="cbf-table">
                      <thead>
                        <tr>
                          {!compact ? (
                            <th className="cbf-check-col">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                aria-label="Выбрать все видимые файлы и папки"
                                onChange={(e) => setSelectedKeys(e.target.checked ? new Set(items.map(selectionKey)) : new Set())}
                              />
                            </th>
                          ) : null}
                          <th>Название</th>
                          {!student && !compact ? <th className="cbf-access-col">У учеников</th> : null}
                          <th className="cbf-date-col">Изменён</th>
                          <th className="cbf-size-col">Размер</th>
                          {!selectable ? <th className="cbf-menu-col"><span className="cbf-sr">Действия</span></th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {files.map((item) => {
                          const key = selectionKey(item);
                          const selected = selectedKeys.has(key);
                          const hint = debouncedSearch && item.path_label
                            ? item.path_label
                            : (apiSection === "trash" && item.days_left != null ? `Ещё ${item.days_left} дн.` : extLabel(item));
                          return (
                            <tr key={key} className={`cbf-row${selected ? " is-selected" : ""}`} {...itemEvents(item)}>
                              {!compact ? (
                                <td className="cbf-check-col">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    aria-label={`Выбрать ${itemName(item)}`}
                                    onChange={(e) => toggleKey(item, e.target.checked)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </td>
                              ) : null}
                              <td>
                                <button type="button" className="cbf-file-open" title={itemName(item)} onClick={() => openItem(item)}>
                                  <FileBadge item={item} />
                                  <span className="cbf-file-name">
                                    <strong>{itemName(item)}</strong>
                                    <small>
                                      {hint}
                                      <span className="cbf-file-size-inline"> · {formatBytes(item.size)}</span>
                                    </small>
                                  </span>
                                </button>
                              </td>
                              {!student && !compact ? (
                                <td className="cbf-access-col">
                                  <span className="cbf-access">
                                    <CabinetIcon name="lock" />
                                    Только у меня
                                  </span>
                                </td>
                              ) : null}
                              <td className="cbf-date-col">{formatDate(item.updated_at)}</td>
                              <td className="cbf-size-col">{formatBytes(item.size)}</td>
                              {!selectable ? (
                                <td className="cbf-menu-col">
                                  <div className="cbf-row-actions">
                                    {apiSection !== "trash" ? (
                                      <button
                                        type="button"
                                        className={`cbf-icon-btn cbf-star${item.is_favorite ? " is-on" : ""}`}
                                        aria-pressed={Boolean(item.is_favorite)}
                                        aria-label={item.is_favorite ? "Убрать из избранного" : "В избранное"}
                                        onClick={(e) => { e.stopPropagation(); handleToggleFavorite(item); }}
                                      >
                                        <CabinetIcon name="star" />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="cbf-icon-btn"
                                      aria-label={`Действия с файлом ${itemName(item)}`}
                                      onClick={(e) => { e.stopPropagation(); openMenu(item, e.currentTarget); }}
                                    >
                                      <CabinetIcon name="more" />
                                    </button>
                                  </div>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : null}

                  {files.length && view === "grid" && !compact ? (
                    <div className="cbf-grid">
                      {files.map((item) => {
                        const key = selectionKey(item);
                        const selected = selectedKeys.has(key);
                        return (
                          <article key={key} className={`cbf-tile${selected ? " is-selected" : ""}`} {...itemEvents(item)}>
                            {!selectable ? (
                              <input
                                className="cbf-tile-check"
                                type="checkbox"
                                checked={selected}
                                aria-label={`Выбрать ${itemName(item)}`}
                                onChange={(e) => toggleKey(item, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : null}
                            <button
                              type="button"
                              className={`cbf-tile-preview${previewKind(item) === "image" ? " is-image" : ""}${previewKind(item) === "video" ? " is-video" : ""}`}
                              aria-label={`Открыть ${itemName(item)}`}
                              onClick={() => openItem(item)}
                            >
                              <TileArt item={item} student={student} />
                            </button>
                            <div className="cbf-tile-meta">
                              <strong title={itemName(item)}>{itemName(item)}</strong>
                              <p>
                                <span>{extLabel(item)} · {formatBytes(item.size)}</span>
                                <span>{formatDate(item.updated_at)}</span>
                              </p>
                            </div>
                            {!selectable ? (
                              <button
                                type="button"
                                className="cbf-icon-btn cbf-tile-more"
                                aria-label={`Действия с файлом ${itemName(item)}`}
                                onClick={(e) => { e.stopPropagation(); openMenu(item, e.currentTarget); }}
                              >
                                <CabinetIcon name="more" />
                              </button>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}

                  {hasMore ? (
                    <button type="button" className="cbf-btn cbf-more" onClick={() => load({ append: true, nextPage: page + 1 })}>
                      Показать ещё
                    </button>
                  ) : null}
                </>
              )}

              {canWrite && !compact && apiSection === "my" ? (
                <div className="cbf-drop-hint">
                  <CabinetIcon name="share" />
                  <span>
                    Перетащите файлы сюда или{" "}
                    <button type="button" onClick={() => fileInputRef.current?.click()}>выберите на компьютере</button>
                  </span>
                </div>
              ) : null}

              {selectable ? (
                <div className="cbf-pick">
                  <button
                    type="button"
                    className="cbf-btn cbf-btn--blue"
                    disabled={multiSelect ? selectedItems.filter((i) => i.kind === "file").length === 0 : selectedItems[0]?.kind !== "file"}
                    onClick={confirmSelect}
                  >
                    Выбрать
                  </button>
                </div>
              ) : null}
            </div>

            {!compact ? (
              <div className="cbf-foot">
                <span>
                  {pluralRu(folders.length, "папка", "папки", "папок")}
                  {" · "}
                  {pluralRu(files.length, "файл", "файла", "файлов")}
                </span>
                {quota ? (
                  <span title={quotaBreakdown.map((row) => `${row.label} — ${formatStorageBytes(row.used_bytes)}`).join(", ")}>
                    {formatStorageBytes(usedBytes)} из {formatStorageBytes(limitBytes)}
                    {" · осталось "}
                    {formatStorageBytes(availableBytes)}
                  </span>
                ) : (
                  <span>Материалы всегда под рукой</span>
                )}
              </div>
            ) : null}
          </div>
        )}

        {dropActive ? (
          <div className="cbf-drag">
            <CabinetIcon name="share" />
            <strong>Отпустите файлы здесь</strong>
            <span>{folderId ? "Они появятся в текущей папке" : "Они появятся в моих файлах"}</span>
          </div>
        ) : null}
      </section>


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
              <button type="button" onClick={() => { handleToggleFavorite(menu.item); setMenu(null); }}>
                {menu.item.is_favorite ? "Убрать из избранного" : "В избранное"}
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
