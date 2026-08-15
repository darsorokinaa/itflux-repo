import AccessGateModal from "./AccessGateModal";

/** Совместимость: анонимный лимит генератора использует общий AccessGate. */
export default function AnonLimitModal({ open, feature, onClose }) {
  const resourceType = feature === "workbooks" ? "workbook" : "variant";
  return (
    <AccessGateModal
      open={open}
      onClose={onClose}
      reason="anonymous"
      resourceType={resourceType}
      authenticated={false}
    />
  );
}
