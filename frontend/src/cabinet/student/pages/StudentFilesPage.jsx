import { CabinetPageHeader, CabinetPageShell } from "../../CabinetSectionUi";
import MyFilesManager from "../../components/MyFilesManager";

export default function StudentFilesPage() {
  return (
    <CabinetPageShell className="cb-files-page">
      <CabinetPageHeader
        title="Мои файлы"
        subtitle="Ваши файлы и материалы для учёбы"
      />
      <MyFilesManager student />
    </CabinetPageShell>
  );
}
