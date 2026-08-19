import { Navigate, useParams, useSearchParams } from "react-router-dom";

export default function CabinetStudentMaterialsPage() {
  const { studentId } = useParams();
  const [searchParams] = useSearchParams();
  const folder = searchParams.get("folder");
  const params = new URLSearchParams({ space: "students", student: String(studentId) });
  if (folder) params.set("folder", folder);
  return <Navigate to={`/cabinet/files?${params.toString()}`} replace />;
}
