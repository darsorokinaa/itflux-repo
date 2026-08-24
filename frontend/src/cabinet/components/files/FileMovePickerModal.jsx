import { useEffect, useMemo, useState } from "react";
import { fetchMyFilesFolderTree } from "../../../utils/cabinetAuth";
import CabinetIcon from "../../CabinetIcons";
import CabinetModal from "../CabinetModal";
import { collectDescendantIds } from "./fileUtils";

function FolderTree({
  byParent,
  parentId = null,
  selectedId,
  blockedIds,
  expanded,
  onToggle,
  onSelect,
}) {
  const key = parentId ? String(parentId) : "root";
  const children = byParent.get(key) || [];
  if (!children.length) return null;
  return (
    <ul className="cb-files-tree">
      {children.map((folder) => {
        const id = String(folder.id);
        const blocked = blockedIds.has(id);
        const open = expanded.has(id);
        const hasKids = (byParent.get(id) || []).length > 0;
        return (
          <li key={id}>
            <div className={`cb-files-tree__row${selectedId === id ? " is-selected" : ""}${blocked ? " is-disabled" : ""}`}>
              {hasKids ? (
                <button
                  type="button"
                  className={`cb-files-tree__twist${open ? " is-open" : ""}`}
                  aria-label={open ? "Свернуть" : "Развернуть"}
                  onClick={() => onToggle(id)}
                >
                  <CabinetIcon name="arrow" />
                </button>
              ) : (
                <span className="cb-files-tree__twist-spacer" />
              )}
              <button
                type="button"
                className="cb-files-tree__name"
                disabled={blocked}
                onClick={() => {
                  if (!blocked) onSelect(id);
                }}
              >
                <CabinetIcon name="folder" />
                <span>{folder.name}</span>
              </button>
            </div>
            {open && hasKids ? (
              <FolderTree
                byParent={byParent}
                parentId={id}
                selectedId={selectedId}
                blockedIds={blockedIds}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function FileMovePickerModal({
  open,
  student = false,
  movingFolders = [],
  currentFolderId = null,
  onClose,
  onMove,
}) {
  const [folders, setFolders] = useState([]);
  const [selectedId, setSelectedId] = useState(currentFolderId ? String(currentFolderId) : null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    setSelectedId(currentFolderId ? String(currentFolderId) : null);
    setError("");
    setLoading(true);
    fetchMyFilesFolderTree({ student })
      .then((data) => setFolders(data.items || []))
      .catch((err) => setError(err?.message || "Не удалось загрузить папки"))
      .finally(() => setLoading(false));
  }, [open, student, currentFolderId]);

  const blockedIds = useMemo(() => {
    const blocked = new Set();
    movingFolders.forEach((folder) => {
      collectDescendantIds(folders, folder.id).forEach((id) => blocked.add(id));
    });
    return blocked;
  }, [folders, movingFolders]);

  const byParent = useMemo(() => {
    const map = new Map();
    folders.forEach((folder) => {
      const key = folder.parent_id ? String(folder.parent_id) : "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(folder);
    });
    return map;
  }, [folders]);

  if (!open) return null;

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMove = async () => {
    if (selectedId && blockedIds.has(String(selectedId))) {
      setError("Нельзя переместить папку внутрь самой себя");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onMove?.(selectedId);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Не удалось переместить");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedName = selectedId
    ? folders.find((f) => String(f.id) === String(selectedId))?.name || "папка"
    : "Мои файлы";

  return (
    <CabinetModal
      title="Переместить"
      onClose={submitting ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="button" className="cb-btn cb-btn--primary" onClick={handleMove} disabled={submitting || loading}>
            {submitting ? "Перемещаем…" : `Переместить сюда`}
          </button>
        </>
      )}
    >
      <div className="cb-files-move">
        <p className="cb-files-move__current">Текущая папка: <strong>{selectedName}</strong></p>
        <button
          type="button"
          className={`cb-files-tree__root${selectedId == null ? " is-selected" : ""}`}
          onClick={() => setSelectedId(null)}
        >
          Мои файлы
        </button>
        {loading ? <p className="cb-page-sub">Загрузка…</p> : null}
        <FolderTree
          byParent={byParent}
          selectedId={selectedId}
          blockedIds={blockedIds}
          expanded={expanded}
          onToggle={toggle}
          onSelect={setSelectedId}
        />
        {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
      </div>
    </CabinetModal>
  );
}
