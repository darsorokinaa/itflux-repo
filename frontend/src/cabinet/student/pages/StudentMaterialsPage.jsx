import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchStudentMaterials } from "../../../utils/cabinetAuth";
import {
  StudentEmptyState,
  StudentErrorState,
  StudentFilterPills,
  StudentPageShell,
} from "../StudentSectionUi";
import StudentSubjectTabs, { getStoredStudentSubjectId } from "../StudentSubjectTabs";
import { usePageTitle } from "../../hooks/usePageTitle";
import { STUDENT_MATERIAL_TYPE_FILTERS } from "../../materialTypeConfig";
import {
  StudentMaterialPreviewModal,
  isMaterialPreviewable,
} from "../components/StudentMaterialPreview";
import MaterialsDiskBrowser from "../../components/MaterialsDiskBrowser";

function openTarget(item) {
  if (item.type === "interactive") {
    return item.interactive_url
      || (item.interactive_assignment_id
        ? `/cabinet/student/interactives/${item.interactive_assignment_id}/play`
        : "");
  }
  if (item.type === "board") {
    return item.board_url || (item.board_id ? `/cabinet/boards/${item.board_id}` : "");
  }
  if (item.external_url) return item.external_url;
  if (item.file_url) return item.file_url;
  if (item.assignment_id) return `/cabinet/student/lessons/${item.assignment_id}`;
  if (item.homework_id) return `/cabinet/student/assignments/${item.homework_id}`;
  return "";
}

export default function StudentMaterialsPage() {
  usePageTitle("Материалы");
  const navigate = useNavigate();
  const [allItems, setAllItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [subjectId, setSubjectId] = useState(() => getStoredStudentSubjectId());
  const [previewItem, setPreviewItem] = useState(null);

  const handleSubjectChange = useCallback((id) => {
    setSubjectId(id || "");
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetchStudentMaterials("", { studentSubjectId: subjectId || undefined })
      .then((d) => {
        setAllItems(Array.isArray(d?.items) ? d.items : []);
        setFolders(Array.isArray(d?.folders) ? d.folders : []);
      })
      .catch(() => {
        setAllItems([]);
        setFolders([]);
        setError("Не удалось загрузить материалы. Попробуйте ещё раз.");
      })
      .finally(() => setLoading(false));
  }, [subjectId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => {
    if (typeFilter === "all") return allItems;
    return allItems.filter((it) => it.type === typeFilter);
  }, [allItems, typeFilter]);

  const visibleFolders = useMemo(() => {
    if (typeFilter === "all") return folders;
    const ids = new Set(filteredItems.map((it) => it.folder_id).filter(Boolean));
    return folders.filter((f) => ids.has(f.id));
  }, [folders, filteredItems, typeFilter]);

  const openFile = (item) => {
    if (isMaterialPreviewable(item)) {
      setPreviewItem(item);
      return;
    }
    const url = openTarget(item);
    if (!url) return;
    if (url.startsWith("/")) navigate(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <StudentPageShell className="st-materials-page">
      <div className="st-mat-header">
        <h1 className="st-mat-header__title">Материалы</h1>
        <p className="st-mat-header__sub">Файлы, папки и ссылки от учителя</p>
      </div>

      <StudentSubjectTabs value={subjectId} onChange={handleSubjectChange} />
      <StudentFilterPills filters={STUDENT_MATERIAL_TYPE_FILTERS} active={typeFilter} onChange={setTypeFilter} />

      {error && !loading ? (
        <StudentErrorState message={error} onRetry={load} />
      ) : !loading && !allItems.length && !folders.length ? (
        <StudentEmptyState
          title="Материалов пока нет"
          text="Здесь пока нет материалов. Когда преподаватель добавит их к занятию или отправит вам, они появятся здесь."
          icon="folder"
        />
      ) : (
        <MaterialsDiskBrowser
          items={filteredItems}
          folders={visibleFolders}
          loading={loading}
          emptyText="По выбранным фильтрам материалов нет."
          onOpenFile={openFile}
        />
      )}

      {previewItem ? (
        <StudentMaterialPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      ) : null}
    </StudentPageShell>
  );
}
