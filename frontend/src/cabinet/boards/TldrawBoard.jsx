import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computed } from "@tldraw/state";
import { createUserId, getDefaultUserPresence, UserRecordType } from "@tldraw/tlschema";
import { useSync } from "@tldraw/sync";
import { Tldraw, defaultShapeUtils } from "tldraw";
import "tldraw/tldraw.css";

import { disposePdfNotice, insertPdfFile, installSavedCustomColors } from "./lessonBoardActions";
import { installLessonSheets } from "./lessonSheets";
import { installCoalescedEraserInput, keepImagesUnderEraser } from "./lessonEraser";
import { fileLooksLikePdf } from "./boardPdf";
import { lessonBoardComponents } from "./lessonBoardUi";
import { LessonGeoShapeUtil } from "./lessonGeoShape";
import { LessonNoteShapeUtil, lessonCanvasShapeUtils, lessonShapeUtils, lessonTools, lessonUiOverrides } from "./lessonShapes";

const lessonSyncShapeUtils = [
  LessonGeoShapeUtil,
  ...defaultShapeUtils.filter((Util) => Util.type !== "geo"),
  ...lessonShapeUtils,
];
const lessonTldrawOptions = { selectLockedShapes: true, maxPages: Infinity };

import { lockBoardPageScroll } from "./boardMobileShell";
import {
  lessonBoardDisplayName,
  lessonBoardPresenceColor,
  lessonBoardRoomId,
  lessonBoardSyncUri,
  tldrawLicenseKey,
} from "./boardProvider";
import { fetchTldrawSyncToken } from "../../utils/cabinetAuth";
import { markPerf } from "../../utils/appBoot";
import { reportClientEvent } from "../../utils/clientTelemetry";
import {
  boardSyncStatusName,
  nextCanvasGeometry,
} from "./boardDocumentTelemetry";
import { createLessonBoardAssetStore } from "./lessonBoardAssetStore";
import BoardV2ErrorBoundary from "./BoardV2ErrorBoundary";
import LessonBoardMessage from "./LessonBoardMessage";
import "../styles/boards.css";

function LessonBoardFrame({ roomId, boardId, children }) {
  const rootRef = useRef(null);
  useEffect(() => lockBoardPageScroll(), []);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    let previous = null;
    const publish = () => {
      const rect = node.getBoundingClientRect();
      const next = nextCanvasGeometry(previous, rect?.width, rect?.height);
      if (!next) return;
      previous = next;
      reportClientEvent("board_canvas_geometry", {
        board_id: String(boardId || "").slice(0, 64),
        width: next.width,
        height: next.height,
      });
    };
    publish();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [boardId]);
  return (
    <div
      ref={rootRef}
      className="cb-board-editor lesson-board-shell"
      data-testid="tldraw-board"
      data-room-id={roomId || ""}
    >
      <div className="lesson-board">{children}</div>
    </div>
  );
}

function createLessonUserStore({ userId, displayName, color, avatarUrl }) {
  const record = UserRecordType.create({
    id: createUserId(String(userId)),
    name: displayName,
    color,
    imageUrl: avatarUrl || "",
    meta: {},
  });
  const currentUser = computed("lesson-board-current-user", () => record);
  const resolved = new Map();
  return {
    currentUser,
    resolve(id) {
      if (!resolved.has(id)) {
        resolved.set(
          id,
          computed(`lesson-board-user-${id}`, () => (id === record.id ? record : null)),
        );
      }
      return resolved.get(id);
    },
  };
}

async function lessonBoardConnectUri(boardId) {
  const issued = await fetchTldrawSyncToken(boardId);
  const token = issued?.token;
  if (!token) throw new Error("sync token missing");
  const url = new URL(lessonBoardSyncUri(boardId));
  url.searchParams.set("access_token", token);
  return url.toString();
}

// useSync reconnects a dropped socket on the same store. Remounting on wake,
// online, or a short stall opens a second socket with the same tab session id
// and throws away strokes that have not been committed.
export function shouldResumeTldrawRoom() {
  return false;
}

function lessonUserPresence(store, user) {
  const presence = getDefaultUserPresence(store, user);
  if (!presence) return null;
  const avatarUrl = typeof user?.imageUrl === "string" ? user.imageUrl.trim() : "";
  if (!avatarUrl) return presence;
  return { ...presence, meta: { ...(presence.meta || {}), avatarUrl } };
}

function useLessonBoardSync({ boardId, roomId, users, assets }) {
  const uri = useCallback(() => lessonBoardConnectUri(boardId), [boardId]);
  const getUserPresence = useCallback(lessonUserPresence, []);
  return useSync({
    uri,
    roomId,
    users,
    assets,
    getUserPresence,
    shapeUtils: lessonSyncShapeUtils,
  });
}

function restoreLegacyScene(editor, sceneData) {
  let cancelled = false;
  let dispose = () => {};
  if (sceneData == null) return undefined;
  // Отдельный модуль, чтобы обычная tldraw-доска не тянула разбор Excalidraw до открытия старой сцены.
  import("./excalidrawToTldraw").then((mod) => {
    if (cancelled) return;
    const attached = mod.attachLegacyExcalidrawScene(editor, sceneData);
    dispose = attached.dispose;
    if (cancelled) {
      dispose();
      return;
    }
    if (attached.restored) installSavedCustomColors(editor);
  }).catch((error) => {
    console.error("failed to restore excalidraw board", error);
  });
  return () => {
    cancelled = true;
    dispose();
  };
}

function TldrawBoardSynced({
  boardId,
  roomId,
  userId,
  displayName,
  color,
  avatarUrl,
  canEdit,
  sceneData,
  onRetry,
}) {
  const users = useMemo(
    () => createLessonUserStore({ userId, displayName, color, avatarUrl }),
    [userId, displayName, color, avatarUrl],
  );
  const assets = useMemo(() => createLessonBoardAssetStore(boardId), [boardId]);
  const sync = useLessonBoardSync({ boardId, roomId, users, assets });
  const licenseKey = tldrawLicenseKey();
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    markPerf("board_mount");
  }, []);

  const syncStatusRef = useRef(sync.status);
  const reportedSyncRef = useRef("");
  useEffect(() => {
    const previous = syncStatusRef.current;
    syncStatusRef.current = sync.status;
    const nextName = boardSyncStatusName(sync.status);
    const prevName = reportedSyncRef.current;
    if (prevName !== nextName) {
      reportedSyncRef.current = nextName;
      reportClientEvent("board_sync_status", {
        board_id: String(boardId || "").slice(0, 64),
        status: nextName,
        previous: prevName,
        raw: String(sync.status || "").slice(0, 32),
      });
    }
    if (sync.status && sync.status !== "loading" && sync.status !== "error") {
      markPerf("board_synced");
    }
    const wasShowingCanvas = previous === "synced-remote" || previous === "synced-local";
    if (!wasShowingCanvas) return;
    if (sync.status !== "loading" && sync.status !== "error") return;
    reportClientEvent("board_error", {
      phase: String(sync.status || "").slice(0, 32),
      previous: String(previous || "").slice(0, 32),
    });
  }, [boardId, sync.status]);

  useEffect(() => {
    if (sync.status !== "loading") {
      setStalled(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setStalled(true);
      if (reportedSyncRef.current === "error") return;
      const previous = reportedSyncRef.current;
      reportedSyncRef.current = "error";
      reportClientEvent("board_sync_status", {
        board_id: String(boardId || "").slice(0, 64),
        status: "error",
        previous,
        raw: "stalled",
      });
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [boardId, sync.status]);

  if (sync.status === "loading" && !stalled) {
    return <LessonBoardMessage text="Подключаем доску…" />;
  }
  if (sync.status === "error" || stalled) {
    return (
      <LessonBoardMessage
        title="Не удалось подключить доску"
        text="Соединение с доской прервалось. Можно повторить, не выходя из урока."
        onRetry={onRetry}
      />
    );
  }

  return (
    <Tldraw
      store={sync.store}
      licenseKey={licenseKey}
      options={lessonTldrawOptions}
      shapeUtils={[LessonGeoShapeUtil, LessonNoteShapeUtil, ...lessonCanvasShapeUtils]}
      tools={lessonTools}
      overrides={lessonUiOverrides}
      components={lessonBoardComponents}
      onMount={(editor) => {
        assets.bind?.(editor);
        keepImagesUnderEraser(editor);
        installSavedCustomColors(editor);
        editor.user.updateUserPreferences({
          colorScheme: "light",
          name: displayName,
          color,
        });
        if (!canEdit) editor.updateInstanceState({ isReadonly: true });
        const disposeSheets = installLessonSheets(editor, {
          userId,
          boardId,
          storage: window.localStorage,
        });
        const disposeEraserInput = installCoalescedEraserInput(editor);
        const previousFiles = editor.externalContentHandlers?.files;
        if (typeof editor.registerExternalContentHandler === "function") {
          editor.registerExternalContentHandler("files", async (content) => {
            const files = Array.isArray(content?.files) ? content.files : [];
            const pdfs = files.filter((file) => fileLooksLikePdf(file));
            const rest = files.filter((file) => !fileLooksLikePdf(file));
            for (const file of pdfs) {
              await insertPdfFile(editor, file, { point: content?.point });
            }
            if (rest.length && typeof previousFiles === "function") {
              await previousFiles({ ...content, files: rest });
            }
          });
        }
        const disposeLegacy = restoreLegacyScene(editor, sceneData);
        return () => {
          disposePdfNotice(editor);
          disposeEraserInput();
          disposeSheets();
          disposeLegacy?.();
        };
      }}
    />
  );
}

function TldrawBoardSession({ boardId, userId, displayName, role, avatarUrl, canEdit, sceneData, onRetry }) {
  const roomId = lessonBoardRoomId(boardId);
  const name = lessonBoardDisplayName(displayName, role);
  const color = lessonBoardPresenceColor(role, userId);
  const ready = Boolean(roomId) && userId !== null && userId !== undefined && String(userId).trim() !== "";
  if (!ready) {
    return (
      <LessonBoardMessage
        title="Не удалось подключить доску"
        text="Не хватает идентификатора доски или участника."
        onRetry={onRetry}
      />
    );
  }
  return (
    <TldrawBoardSynced
      boardId={boardId}
      roomId={roomId}
      userId={userId}
      displayName={name}
      color={color}
      avatarUrl={avatarUrl || ""}
      canEdit={canEdit}
      sceneData={sceneData}
      onRetry={onRetry}
    />
  );
}

/**
 * Board V2. Права зеркалят view/edit токена комнаты.
 * Растровые картинки уходят в TLAssetStore и хранятся как URL доски.
 */
export default function TldrawBoard(props) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((value) => value + 1);
  const roomId = lessonBoardRoomId(props.boardId);

  return (
    <LessonBoardFrame roomId={roomId} boardId={props.boardId}>
      <BoardV2ErrorBoundary onRetry={retry}>
        <TldrawBoardSession key={attempt} {...props} onRetry={retry} />
      </BoardV2ErrorBoundary>
    </LessonBoardFrame>
  );
}
