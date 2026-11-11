import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createMeetingMaterialCollab } from "../meetingMaterialCollab";
import { fetchVideoMeetingStatus } from "../../utils/cabinetAuth";
import {
  studentSplitStamp,
  variantBoardRequest,
  visibleStudentSplit,
} from "./variantBoardSplitSync";
import StudentSplitChrome from "./variantBoardStudent";
import { useSplitWidth, useTeacherBoard } from "./variantBoardSplitHooks";
import { TeacherSplitPortal } from "./variantBoardSplitView";
import "../styles/variant-board-split.css";

function useRemotePresented(meetingUuid, enabled) {
  const [presented, setPresented] = useState(null);
  useEffect(() => {
    if (!enabled || !meetingUuid) return undefined;
    let cancelled = false;
    const pull = () => {
      fetchVideoMeetingStatus(meetingUuid)
        .then((st) => {
          if (!cancelled) setPresented(st?.presented ?? null);
        })
        .catch(() => {});
    };
    pull();
    if (typeof WebSocket !== "function") {
      return () => {
        cancelled = true;
      };
    }
    const collab = createMeetingMaterialCollab(meetingUuid, {
      onSyncState: (payload) => {
        if (payload && Object.prototype.hasOwnProperty.call(payload, "presented")) pull();
      },
      onPresented: () => pull(),
    });
    return () => {
      cancelled = true;
      collab.close();
    };
  }, [meetingUuid, enabled]);
  return presented;
}

function readOnlyPanelOpen(split, collapsed) {
  return Boolean(split && !collapsed);
}

export default function VariantBoardSplit({
  meetingUuid, liveSessionId, homeworkId, readOnly = false, presented,
}) {
  const request = variantBoardRequest({ meetingUuid, liveSessionId, homeworkId });
  const reqKey = request ? JSON.stringify(request) : "";
  const followRemote = Boolean(readOnly && presented === undefined);
  const remotePresented = useRemotePresented(meetingUuid, followRemote);
  const shownPresented = followRemote ? remotePresented : presented;
  const split = readOnly ? visibleStudentSplit(shownPresented) : null;
  const stamp = studentSplitStamp(shownPresented);
  const [hiddenStamp, setHiddenStamp] = useState("");
  const collapsed = Boolean(readOnly && stamp && hiddenStamp === stamp);
  const teacher = useTeacherBoard(meetingUuid, reqKey);
  const panelOpen = readOnly ? readOnlyPanelOpen(split, collapsed) : teacher.open;
  const chrome = useSplitWidth(panelOpen);
  if (typeof document === "undefined") return null;
  if (!readOnly && request) return <TeacherSplitPortal model={teacher} chrome={chrome} />;
  if (!readOnly || !meetingUuid) return null;
  return createPortal(
    <StudentSplitChrome
      split={split}
      collapsed={collapsed}
      onCollapse={() => setHiddenStamp(stamp)}
      onExpand={() => setHiddenStamp("")}
      width={chrome.width}
      isMobile={chrome.isMobile}
      dragging={chrome.dragging}
      onDragStart={chrome.startDrag}
    />,
    document.body,
  );
}
