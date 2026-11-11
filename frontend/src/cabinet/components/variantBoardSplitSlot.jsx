import VariantBoardSplit from "./VariantBoardSplit";
import { isTeacherRole } from "../../utils/cabinetAuth";

export default function VariantBoardSplitSlot({
  cabinetUser,
  meetingUuid,
  liveSessionId,
  isLiveVariant,
  cabinetAssignmentId,
}) {
  const teacher =
    isTeacherRole(cabinetUser) &&
    (meetingUuid || liveSessionId || (isLiveVariant && cabinetAssignmentId));
  if (teacher) {
    return (
      <VariantBoardSplit
        meetingUuid={meetingUuid}
        liveSessionId={liveSessionId}
        homeworkId={isLiveVariant ? cabinetAssignmentId : null}
      />
    );
  }
  if (cabinetUser && !isTeacherRole(cabinetUser) && meetingUuid) {
    return <VariantBoardSplit meetingUuid={meetingUuid} readOnly />;
  }
  return null;
}
