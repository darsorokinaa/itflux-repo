import CabinetIcon from "../CabinetIcons";

export default function LateHomeworkMark() {
  return (
    <span className="jg-late-hw-icon" title="Сдано после срока">
      <CabinetIcon name="clock" />
      <span className="jg-sr-only">Сдано после срока</span>
    </span>
  );
}
