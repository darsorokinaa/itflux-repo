import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createStudentMaterialFolder,
  deleteDirectMaterial,
  deleteStudentMaterialFolder,
  fetchCabinetStudent,
  fetchStudentSubjects,
  fetchStudents,
  fetchTeacherStudentMaterials,
  placeStudentMaterials,
  updateStudentMaterialFolder,
} from "../../utils/cabinetAuth";
import ConfirmActionModal from "./ConfirmActionModal";
import MaterialsAssignModal from "./MaterialsAssignModal";
import MaterialsDiskBrowser from "./MaterialsDiskBrowser";
import { mapApiStudent } from "../cabinetMappers";
import {
  StudentMaterialPreviewModal,
  isMaterialPreviewable,
} from "../student/components/StudentMaterialPreview";
import CabinetIcon from "../CabinetIcons";
import "../styles/my-files.css";

function studentDisplayName(student) {
  return student?.full_name
    || student?.name
    || `${student?.last_name || ""} ${student?.first_name || ""}`.trim()
    || "Ученик";
}

export default function StudentFilesWorkspace({
  studentId: controlledStudentId,
  folderId: controlledFolderId,
  onStudentChange,
  onFolderChange,
  onNotice,
}) {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [archivedStudents, setArchivedStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentSearch, setStudentSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [student, setStudent] = useState(null);
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewItem, setPreviewItem] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [revokeItem, setRevokeItem] = useState(null);
  const [deleteFolder, setDeleteFolder] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const studentId = controlledStudentId ? String(controlledStudentId) : "";

  useEffect(() => {
    setStudentsLoading(true);
    Promise.all([
      fetchStudents().catch(() => []),
      fetchStudents({ status: "archived" }).catch(() => []),
    ])
      .then(([active, archived]) => {
        const normalize = (data) => (Array.isArray(data) ? data : data?.results || []);
        setStudents(normalize(active));
        setArchivedStudents(normalize(archived));
      })
      .finally(() => setStudentsLoading(false));
  }, []);

  const loadMaterials = useCallback(() => {
    if (!studentId) return Promise.resolve();
    setLoading(true);
    setError("");
    return Promise.all([
      fetchCabinetStudent(studentId),
      fetchTeacherStudentMaterials(studentId, { studentSubjectId: subjectId || undefined }),
      fetchStudentSubjects(studentId).catch(() => []),
    ])
      .then(([studentData, materialsData, subjectsData]) => {
        setStudent(mapApiStudent(studentData));
        setItems(Array.isArray(materialsData?.items) ? materialsData.items : []);
        setFolders(Array.isArray(materialsData?.folders) ? materialsData.folders : []);
        const list = (Array.isArray(subjectsData) ? subjectsData : subjectsData?.items || [])
          .filter((s) => s.status !== "archived");
        setSubjects(list);
      })
      .catch((err) => {
        setStudent(null);
        setItems([]);
        setFolders([]);
        setError(err?.message || "Не удалось загрузить файлы ученика.");
      })
      .finally(() => setLoading(false));
  }, [studentId, subjectId]);

  useEffect(() => {
    if (studentId) loadMaterials();
    else {
      setStudent(null);
      setItems([]);
      setFolders([]);
    }
  }, [studentId, loadMaterials]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const pool = showArchived ? archivedStudents : students;
    if (!q) return pool;
    return pool.filter((s) => studentDisplayName(s).toLowerCase().includes(q));
  }, [students, archivedStudents, studentSearch, showArchived]);

  const studentName = studentDisplayName(student);

  const openFile = (item) => {
    if (isMaterialPreviewable(item)) {
      setPreviewItem(item);
      return;
    }
    if (item.edit_url) {
      navigate(item.edit_url);
      return;
    }
    if (item.external_url) {
      window.open(item.external_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (item.file_url) {
      window.open(item.file_url, "_blank", "noopener,noreferrer");
    }
  };

  const fileMenuItems = (item) => {
    const actions = [];
    if (isMaterialPreviewable(item)) {
      actions.push({ label: "Открыть", onClick: () => setPreviewItem(item) });
    }
    if (item.edit_url) {
      actions.push({ label: "Редактировать", onClick: () => navigate(item.edit_url) });
    }
    if (item.external_url) {
      actions.push({ label: "Открыть ссылку", onClick: () => window.open(item.external_url, "_blank", "noopener,noreferrer") });
    }
    if (item.file_url) {
      actions.push({ label: "Скачать", onClick: () => window.open(item.file_url, "_blank", "noopener,noreferrer") });
    }
    if (item.can_revoke) {
      actions.push({ label: "Отозвать", onClick: () => setRevokeItem(item) });
    }
    return actions;
  };

  const handleMove = async ({ keys, folderId: targetFolderId, folderIds }) => {
    try {
      if (folderIds?.length) {
        for (const fid of folderIds) {
          await updateStudentMaterialFolder(studentId, fid, { parent_id: targetFolderId });
        }
        onNotice?.("Папка перемещена");
      } else {
        await placeStudentMaterials(studentId, { keys, folderId: targetFolderId });
        onNotice?.("Файл перемещён");
      }
      await loadMaterials();
    } catch (err) {
      setError(err?.message || "Не удалось переместить");
    }
  };

  if (!studentId) {
    return (
      <div className="cb-files-students">
        <div className="cb-files__toolbar">
          <button type="button" className="cb-btn cb-btn--primary" onClick={() => setAssignOpen(true)} disabled={studentsLoading}>
            Выдать материал
          </button>
          <input
            type="search"
            className="cb-files__search"
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            placeholder="Поиск ученика"
            aria-label="Поиск ученика"
          />
        </div>

        <div className="cb-files-students__tabs">
          <button
            type="button"
            className={`cb-files-students__tab${!showArchived ? " is-active" : ""}`}
            onClick={() => setShowArchived(false)}
          >
            Активные
          </button>
          <button
            type="button"
            className={`cb-files-students__tab${showArchived ? " is-active" : ""}`}
            onClick={() => setShowArchived(true)}
          >
            Архив
          </button>
        </div>

        {studentsLoading ? (
          <div className="cb-files__skeleton">Загрузка учеников…</div>
        ) : filteredStudents.length === 0 ? (
          <div className="cb-files__empty">
            {showArchived
              ? "В архиве пока нет учеников."
              : "Здесь будут храниться материалы ваших учеников. Добавьте ученика, чтобы начать работу с его файлами."}
          </div>
        ) : (
          <ul className="cb-files-students__list">
            {filteredStudents.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="cb-files-students__row"
                  onClick={() => onStudentChange?.(String(s.id))}
                >
                  <span className="cb-files-students__avatar" aria-hidden>
                    <CabinetIcon name="user" />
                  </span>
                  <span className="cb-files-students__name">{studentDisplayName(s)}</span>
                  <CabinetIcon name="arrow" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {assignOpen ? (
          <MaterialsAssignModal
            onClose={() => setAssignOpen(false)}
            onAssigned={() => {
              setAssignOpen(false);
              onNotice?.("Материалы выданы");
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="cb-files-students">
      <div className="cb-files__toolbar">
        <button
          type="button"
          className="cb-btn cb-btn--outline"
          onClick={() => {
            onFolderChange?.(null);
            onStudentChange?.(null);
          }}
        >
          ← К ученикам
        </button>
        <button type="button" className="cb-btn cb-btn--primary" onClick={() => setAssignOpen(true)}>
          Выдать материал
        </button>
      </div>

      {subjects.length > 1 ? (
        <label className="cb-files__select-wrap" style={{ marginBottom: 12, maxWidth: 240 }}>
          <span className="cb-files__select-label">Предмет</span>
          <select
            className="cb-files__select"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">Все предметы</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_label || s.subject_label || s.title || "Предмет"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <MaterialsDiskBrowser
        items={items}
        folders={folders}
        loading={loading}
        error={error}
        emptyText={`У ${studentName} пока нет файлов. Создайте папку или добавьте материал.`}
        canOrganize
        folderId={controlledFolderId}
        onFolderChange={onFolderChange}
        rootLabel={studentName}
        breadcrumbPrefix={[{ id: null, name: "Файлы учеников", onClick: () => { onFolderChange?.(null); onStudentChange?.(null); } }]}
        onOpenFile={openFile}
        onCreateFolder={async ({ name, parentId }) => {
          await createStudentMaterialFolder(studentId, {
            name,
            parent_id: parentId ?? controlledFolderId ?? null,
          });
          onNotice?.("Папка создана");
          await loadMaterials();
        }}
        onRenameFolder={async (folder, { name }) => {
          await updateStudentMaterialFolder(studentId, folder.id, { name });
          onNotice?.("Папка переименована");
          await loadMaterials();
        }}
        onDeleteFolder={(folder) => setDeleteFolder(folder)}
        onMove={handleMove}
        fileMenuItems={fileMenuItems}
      />

      {previewItem ? (
        <StudentMaterialPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      ) : null}
      {assignOpen && student ? (
        <MaterialsAssignModal
          student={{ id: Number(studentId), name: studentName }}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            setAssignOpen(false);
            onNotice?.("Материалы выданы");
            loadMaterials();
          }}
        />
      ) : null}
      <ConfirmActionModal
        open={Boolean(revokeItem)}
        title="Отозвать материал?"
        text={
          revokeItem?.direct_group_id
            ? `«${revokeItem?.title}» выдан группе. Отзыв уберёт его у всех учеников группы.`
            : `Ученик больше не увидит «${revokeItem?.title || "этот материал"}».`
        }
        confirmLabel="Отозвать"
        danger
        loading={revoking}
        onConfirm={async () => {
          if (!revokeItem?.direct_assignment_id) return;
          setRevoking(true);
          try {
            await deleteDirectMaterial(revokeItem.direct_assignment_id);
            setRevokeItem(null);
            onNotice?.("Материал отозван");
            await loadMaterials();
          } catch {
            setError("Не удалось отозвать материал.");
          } finally {
            setRevoking(false);
          }
        }}
        onClose={() => { if (!revoking) setRevokeItem(null); }}
      />
      <ConfirmActionModal
        open={Boolean(deleteFolder)}
        title="Удалить папку?"
        text="Материалы останутся у ученика. Вложенные папки будут удалены вместе с этой."
        confirmLabel="Удалить"
        danger
        onConfirm={async () => {
          if (!deleteFolder) return;
          await deleteStudentMaterialFolder(studentId, deleteFolder.id);
          setDeleteFolder(null);
          onNotice?.("Папка удалена");
          if (String(controlledFolderId) === String(deleteFolder.id)) {
            onFolderChange?.(null);
          }
          await loadMaterials();
        }}
        onClose={() => setDeleteFolder(null)}
      />
    </div>
  );
}
