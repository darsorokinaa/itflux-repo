import { useCallback, useEffect, useMemo, useState } from "react";
import { computed } from "@tldraw/state";
import { createUserId, getDefaultUserPresence, UserRecordType } from "@tldraw/tlschema";
import { useSync } from "@tldraw/sync";
import { Tldraw, defaultShapeUtils } from "tldraw";
import "tldraw/tldraw.css";

import { installSavedCustomColors } from "./lessonBoardActions";
import { keepImagesUnderEraser } from "./lessonEraser";
import { lessonBoardComponents } from "./lessonBoardUi";
import { LessonGeoShapeUtil } from "./lessonGeoShape";
import { LessonNoteShapeUtil, lessonCanvasShapeUtils, lessonShapeUtils, lessonTools, lessonUiOverrides } from "./lessonShapes";

const lessonSyncShapeUtils = [
  LessonGeoShapeUtil,
  ...defaultShapeUtils.filter((Util) => Util.type !== "geo"),
  ...lessonShapeUtils,
];
const lessonTldrawOptions = { selectLockedShapes: true };

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
import { createLessonBoardAssetStore } from "./lessonBoardAssetStore";
import BoardV2ErrorBoundary from "./BoardV2ErrorBoundary";
import LessonBoardMessage from "./LessonBoardMessage";
import "../styles/boards.css";

function LessonBoardFrame({ roomId, children }) {
  useEffect(() => lockBoardPageScroll(), []);
  return (
    <div className="cb-board-editor lesson-board-shell" data-testid="tldraw-board" data-room-id={roomId || ""}>
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

function TldrawBoardSynced({
  boardId,
  roomId,
  userId,
  displayName,
  color,
  avatarUrl,
  canEdit,
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

  useEffect(() => {
    if (sync.status && sync.status !== "loading" && sync.status !== "error") {
      markPerf("board_synced");
    }
  }, [sync.status]);

  useEffect(() => {
    if (sync.status !== "loading") {
      setStalled(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setStalled(true), 8000);
    return () => window.clearTimeout(timer);
  }, [sync.status]);

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
      }}
    />
  );
}

function TldrawBoardSession({ boardId, userId, displayName, role, avatarUrl, canEdit, onRetry }) {
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
    <LessonBoardFrame roomId={roomId}>
      <BoardV2ErrorBoundary onRetry={retry}>
        <TldrawBoardSession key={attempt} {...props} onRetry={retry} />
      </BoardV2ErrorBoundary>
    </LessonBoardFrame>
  );
}
