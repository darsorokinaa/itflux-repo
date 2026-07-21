import { CabinetPageHeader, CabinetPageShell } from "../CabinetSectionUi";
import MyFilesManager from "../components/MyFilesManager";

export default function CabinetFilesPage() {
  return (
    <CabinetPageShell className="cb-files-page">
      <CabinetPageHeader
        title="Мои файлы"
        subtitle="Единое хранилище материалов для уроков, заданий и групп"
      />
      <MyFilesManager />
    </CabinetPageShell>
  );
}
