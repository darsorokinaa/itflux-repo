import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { CabinetPageHeader, CabinetPageShell } from "../CabinetSectionUi";
import MyFilesManager from "../components/MyFilesManager";

export default function CabinetFilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const workspace = searchParams.get("space") || "my";
  const studentId = searchParams.get("student") || "";
  const studentFolderId = searchParams.get("folder") || "";
  const dir = searchParams.get("dir") || "";

  const updateFilesUrl = useCallback((next) => {
    const params = new URLSearchParams();
    const space = next.space ?? workspace;
    const student = next.student !== undefined ? next.student : studentId;
    const folder = next.folder !== undefined ? next.folder : studentFolderId;
    const nextDir = next.dir !== undefined ? next.dir : dir;

    if (space && space !== "my") params.set("space", space);
    if (space === "my" && nextDir) params.set("dir", String(nextDir));
    if (student) params.set("student", String(student));
    if (folder) params.set("folder", String(folder));
    setSearchParams(params, { replace: false });
  }, [workspace, studentId, studentFolderId, dir, setSearchParams]);

  return (
    <CabinetPageShell className="cb-files-page">
      <CabinetPageHeader
        title="Мои файлы"
        subtitle="Единое хранилище материалов для уроков, заданий и групп"
      />
      <MyFilesManager
        workspace={workspace}
        onWorkspaceChange={(space) => updateFilesUrl({ space, student: "", folder: "", dir: "" })}
        folderId={dir || null}
        onFolderChange={(folder) => updateFilesUrl({ space: "my", dir: folder || "", student: "", folder: "" })}
        studentId={studentId || null}
        onStudentChange={(student) => updateFilesUrl({ space: "students", student: student || "", folder: "", dir: "" })}
        studentFolderId={studentFolderId || null}
        onStudentFolderChange={(folder) => updateFilesUrl({ space: "students", student: studentId, folder: folder || "", dir: "" })}
      />
    </CabinetPageShell>
  );
}
