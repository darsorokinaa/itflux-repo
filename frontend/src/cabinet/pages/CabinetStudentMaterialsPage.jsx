import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createStudentMaterialFolder,
  deleteDirectMaterial,
  deleteStudentMaterialFolder,
  fetchCabinetStudent,
  fetchStudentSubjects,
  fetchTeacherStudentMaterials,
  placeStudentMaterials,
  updateStudentMaterialFolder,
} from "../../utils/cabinetAuth";
import {
  CabinetPageHeader,
  CabinetPageShell,
} from "../CabinetSectionUi";
import CabinetIcon from "../CabinetIcons";
import ConfirmActionModal from "../components/ConfirmActionModal";
import MaterialsAssignModal from "../components/MaterialsAssignModal";
import MaterialsDiskBrowser from "../components/MaterialsDiskBrowser";
import { mapApiStudent } from "../cabinetMappers";
import {
  StudentMaterialPreviewModal,
  isMaterialPreviewable,
} from "../student/components/StudentMaterialPreview";
import "../student/styles/student-cabinet.css";

export default function CabinetStudentMaterialsPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewItem, setPreviewItem] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [revokeItem, setRevokeItem] = useState(null);
  const [deleteFolder, setDeleteFolder] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(() => {
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
        setError(err?.message || "Не удалось загрузить материалы ученика.");
      })
      .finally(() => setLoading(false));
  }, [studentId, subjectId]);

  useEffect(() => {
    load();
  }, [load]);

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
      actions.push({ label: "Просмотр", onClick: () => setPreviewItem(item) });
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

  const handleMove = async ({ keys, folderId }) => {
    try {
      await placeStudentMaterials(studentId, { keys, folderId });
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось переместить");
    }
  };

  return (
    <CabinetPageShell className="cb-stu-mat-page">
      <Link to="/cabinet/students" className="cb-stu-mat-back">
        <CabinetIcon name="arrowLeft" />
        К ученикам
      </Link>
      <CabinetPageHeader
        title={`Материалы · ${studentName}`}
        subtitle="Диск выданных материалов: папки, превью и перетаскивание. Оригиналы в библиотеке не двигаются."
        actions={[
          { label: "Выдать материал", primary: true, icon: "plus", onClick: () => setAssignOpen(true) },
        ]}
      />

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
        emptyText="Выдайте материал или создайте папку — как в «Мои файлы»."
        canOrganize
        onOpenFile={openFile}
        onCreateFolder={async ({ name }) => {
          await createStudentMaterialFolder(studentId, { name });
          await load();
        }}
        onRenameFolder={async (folder, { name }) => {
          await updateStudentMaterialFolder(studentId, folder.id, { name });
          await load();
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
          student={{ id: Number(studentId), name: student.name }}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            setAssignOpen(false);
            load();
          }}
        />
      ) : null}
      <ConfirmActionModal
        open={Boolean(revokeItem)}
        title="Отозвать материал?"
        text={
          revokeItem?.direct_group_id
            ? `«${revokeItem?.title}» выдан группе. Отзыв уберёт его у всех учеников группы.`
            : `Ученик больше не увидит «${revokeItem?.title || "этот материал"}» во вкладке «Материалы».`
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
            await load();
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
        text="Материалы останутся у ученика, просто без этой папки."
        confirmLabel="Удалить"
        danger
        onConfirm={async () => {
          if (!deleteFolder) return;
          await deleteStudentMaterialFolder(studentId, deleteFolder.id);
          setDeleteFolder(null);
          await load();
        }}
        onClose={() => setDeleteFolder(null)}
      />
    </CabinetPageShell>
  );
}
