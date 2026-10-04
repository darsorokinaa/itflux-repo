import { useEffect, useRef } from "react";

import { boardIdFromUrl, workspaceMaterialIdentityKey } from "../meetingPresent";
import { reportClientEvent } from "../../utils/clientTelemetry";

export function lessonBoardFrameKey(material, frameKey) {
  if (!material?.url) return "";
  const id = workspaceMaterialIdentityKey(material) || material.kind || "material";
  const suffix = material.kind === "board" ? String(frameKey ?? 0) : "live";
  return `${id}:${suffix}`;
}

export function lessonBoardId(material) {
  if (material?.kind !== "board") return "";
  return String(material.boardId || boardIdFromUrl(material.url) || "");
}

function visibilityNow() {
  return typeof document === "undefined" ? "" : String(document.visibilityState || "");
}

/**
 * Board iframe for the lesson workspace.
 * The React key is the only remount signal. A connected iframe must keep this node.
 */
export default function LessonBoardWorkspaceFrame({
  material,
  frameKey = 0,
  frameRef,
  src = "",
  onLoad,
}) {
  const reactKey = lessonBoardFrameKey(material, frameKey);
  const boardId = lessonBoardId(material);
  const isBoard = material?.kind === "board";
  const srcRef = useRef(src);
  srcRef.current = src;
  const seenKeyRef = useRef("");

  useEffect(() => {
    if (!isBoard || !reactKey) return undefined;
    const previous = seenKeyRef.current;
    const visibilityState = visibilityNow();
    if (previous && previous !== reactKey) {
      reportClientEvent("board_iframe_key_change", {
        old_key: previous.slice(0, 96),
        new_key: reactKey.slice(0, 96),
        visibilityState,
      });
    }
    seenKeyRef.current = reactKey;
    reportClientEvent("board_iframe_mount", {
      board_id: boardId.slice(0, 64),
      frame_key: reactKey.slice(0, 96),
      src: String(srcRef.current || "").slice(0, 180),
      visibilityState,
    });
    return () => {
      const node = frameRef?.current || null;
      reportClientEvent("board_iframe_unmount", {
        board_id: boardId.slice(0, 64),
        frame_key: reactKey.slice(0, 96),
        visibilityState: visibilityNow(),
        reason: visibilityNow() === "visible" ? "render" : `visibility:${visibilityNow() || "unknown"}`,
        iframe_isConnected: Boolean(node?.isConnected),
      });
    };
  }, [boardId, frameRef, isBoard, reactKey]);

  if (!material?.url) return null;
  return (
    <iframe
      key={reactKey}
      ref={isBoard ? frameRef : undefined}
      title={material.title || "Материал"}
      src={isBoard ? src : material.url}
      data-frame-key={reactKey}
      data-board-id={boardId}
      className={[
        "video-lesson-workspace__frame",
        isBoard ? "video-lesson-workspace__frame--board" : "",
      ].filter(Boolean).join(" ")}
      allow="camera; microphone; display-capture; autoplay; clipboard-read; clipboard-write; fullscreen"
      onLoad={isBoard ? onLoad : undefined}
    />
  );
}
