import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { CabinetPageHeader, CabinetPageShell } from "../CabinetSectionUi";
import MyFilesManager from "../components/MyFilesManager";

export default function CabinetFilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const workspace = searchParams.get("space") || "my";
  const studentId = searchParams.get("student") || "";
  const studentFolderId = searchParams.get("folder") || "";

  const updateFilesUrl = useCallback((next) => {
    const params = new URLSearchParams();
    const space = next.space ?? workspace;
    const student = next.student !== undefined ? next.student : studentId;
    const folder = next.folder !== undefined ? next.folder : studentFolderId;

    if (space && space !== "my") params.set("space", space);
    if (student) params.set("student", String(student));
    if (folder) params.set("folder", String(folder));
    setSearchParams(params, { replace: false });
  }, [workspace, studentId, studentFolderId, setSearchParams]);

  return (
    <CabinetPageShell className="cb-files-page">
      <CabinetPageHeader
        title="Мои файлы"
        subtitle="Единое хранилище материалов для уроков, заданий и групп"
      />
      <MyFilesManager
        workspace={workspace}
        onWorkspaceChange={(space) => updateFilesUrl({ space, student: "", folder: "" })}
        studentId={studentId || null}
        onStudentChange={(student) => updateFilesUrl({ space: "students", student: student || "", folder: "" })}
        studentFolderId={studentFolderId || null}
        onStudentFolderChange={(folder) => updateFilesUrl({ space: "students", student: studentId, folder: folder || "" })}
      />
    </CabinetPageShell>
  );
}
