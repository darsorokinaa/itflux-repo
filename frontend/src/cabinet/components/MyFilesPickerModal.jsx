import CabinetModal from "./CabinetModal";
import MyFilesManager from "./MyFilesManager";

export default function MyFilesPickerModal({
  open,
  onClose,
  onSelect,
  student = false,
  multiSelect = false,
  title = "Выбрать из Моих файлов",
}) {
  if (!open) return null;

  return (
    <CabinetModal title={title} onClose={onClose} wide>
      <div className="cb-files-picker">
        <MyFilesManager
          student={student}
          compact
          selectable
          multiSelect={multiSelect}
          onSelect={(value) => {
            onSelect?.(value);
            onClose?.();
          }}
        />
      </div>
    </CabinetModal>
  );
}
