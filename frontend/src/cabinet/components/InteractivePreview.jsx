import CabinetModal from "./CabinetModal";
import InteractivePlayer from "./InteractivePlayer";

export default function InteractivePreview({ interactive, onClose, inline = false }) {
  if (!interactive) return null;

  if (inline) {
    return (
      <div className="cb-preview-inline">
        <InteractivePlayer interactive={interactive} />
      </div>
    );
  }

  return (
    <CabinetModal
      title={interactive.title || "Предпросмотр"}
      onClose={onClose}
      wide
    >
      {interactive.instruction ? (
        <p className="cb-preview-intro">{interactive.instruction}</p>
      ) : null}
      <InteractivePlayer interactive={interactive} />
    </CabinetModal>
  );
}
