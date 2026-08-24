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
import CopyToStudentsModal from "./files/CopyToStudentsModal";
import { mapApiStudent } from "../cabinetMappers";
import {
  StudentMaterialPreviewModal,
  isMaterialPreviewable,
} from "../student/components/StudentMaterialPreview";
import CabinetIcon from "../CabinetIcons";
import "../styles/students.css";
import "../styles/my-files.css";

function studentInitials(name) {
  const safe = String(name || "").replace(/\./g, "").trim();
  if (!safe) return "??";
  const parts = safe.split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return safe.slice(0, 2).toUpperCase();
}

function avatarTone(student) {
  if (student.subject === "Python" || student.direction === "Python") return "py";
  if (student.direction === "ЕГЭ") return "ege";
  return "oge";
}

function pluralStudents(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ученик`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ученика`;
  return `${n} учеников`;
}

function normalizeStudents(data) {
  return (Array.isArray(data) ? data : data?.results || []).map(mapApiStudent);
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
  const [copyItems, setCopyItems] = useState(null);
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
        setStudents(normalizeStudents(active));
        setArchivedStudents(normalizeStudents(archived));
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
    return pool.filter((s) => (s.name || "").toLowerCase().includes(q));
  }, [students, archivedStudents, studentSearch, showArchived]);

  const studentName = student?.name || "ученика";

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
    actions.push({ label: "Скопировать ученикам", onClick: () => setCopyItems([item]) });
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
        <div className="cb-files-students__head">
          <div>
            <h2 className="cb-files-students__title">Файлы учеников</h2>
            <p className="cb-files-students__sub">
              Выберите ученика, чтобы открыть его материалы и папки
            </p>
          </div>
          {!studentsLoading && filteredStudents.length > 0 ? (
            <span className="cb-files-students__count">{pluralStudents(filteredStudents.length)}</span>
          ) : null}
        </div>

        <div className="cb-files__toolbar cb-files-students__toolbar">
          <button type="button" className="cb-btn cb-btn--primary" onClick={() => setAssignOpen(true)} disabled={studentsLoading}>
            Выдать материал
          </button>
          <input
            type="search"
            className="cb-files__search"
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            placeholder="Поиск по имени"
            aria-label="Поиск ученика"
          />
        </div>

        <div className="cb-files-students__tabs" role="tablist" aria-label="Список учеников">
          <button
            type="button"
            role="tab"
            aria-selected={!showArchived}
            className={`cb-files-students__tab${!showArchived ? " is-active" : ""}`}
            onClick={() => setShowArchived(false)}
          >
            Активные
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showArchived}
            className={`cb-files-students__tab${showArchived ? " is-active" : ""}`}
            onClick={() => setShowArchived(true)}
          >
            Архив
          </button>
        </div>

        {studentsLoading ? (
          <div className="cb-files__skeleton">Загрузка учеников…</div>
        ) : filteredStudents.length === 0 ? (
          <div className="cb-files__empty cb-files-students__empty">
            {showArchived
              ? "В архиве пока нет учеников."
              : "Здесь будут храниться материалы ваших учеников. Добавьте ученика, чтобы начать работу с его файлами."}
          </div>
        ) : (
          <div className="cb-files-students__grid">
            {filteredStudents.map((s) => (
              <button
                key={s.id}
                type="button"
                className="cb-student-row cb-student-row--card cb-files-students__card"
                onClick={() => onStudentChange?.(String(s.id))}
              >
                <span className={`cb-student-row__avatar cb-student-row__avatar--${avatarTone(s)}`}>
                  {studentInitials(s.name)}
                </span>
                <span className="cb-student-row__info">
                  <span className="cb-student-row__name-line">
                    <span className="cb-student-row__name">{s.name}</span>
                  </span>
                  <span className="cb-student-row__meta">
                    {s.subjects?.length
                      ? `${s.subjects.slice(0, 2).join(" · ")}${s.subjects.length > 2 ? ` +${s.subjects.length - 2}` : ""}`
                      : (s.subject || s.direction || "Материалы ученика")}
                  </span>
                </span>
                <span className="cb-files-students__chevron" aria-hidden>
                  <CabinetIcon name="arrow" />
                </span>
              </button>
            ))}
          </div>
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
      <div className="cb-files__toolbar cb-files-students__toolbar">
        <button
          type="button"
          className="cb-btn cb-btn--outline cb-files-students__back"
          onClick={() => {
            onFolderChange?.(null);
            onStudentChange?.(null);
          }}
        >
          <CabinetIcon name="arrowLeft" />
          К ученикам
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
      <CopyToStudentsModal
        open={Boolean(copyItems?.length)}
        files={[]}
        materials={copyItems || []}
        excludeStudentId={studentId}
        onClose={() => setCopyItems(null)}
        onCopied={(result) => {
          const n = result?.created_count || 0;
          onNotice?.(n ? `Скопировано ученикам: ${n}` : "У выбранных учеников этот файл уже был");
        }}
      />
    </div>
  );
}
