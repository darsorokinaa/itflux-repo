import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computed } from "@tldraw/state";
import { createUserId, getDefaultUserPresence, TLINSTANCE_ID, UserRecordType } from "@tldraw/tlschema";
import { useSync } from "@tldraw/sync";
import { Tldraw, defaultShapeUtils } from "tldraw";
import "tldraw/tldraw.css";

import { addBoardFiles, disposePdfNotice, installLessonColorSync, installLessonThickness, lessonPresenceAppearance } from "./lessonBoardActions";
import { installLessonSheets } from "./lessonSheets";
import { installCoalescedEraserInput, keepImagesUnderEraser } from "./lessonEraser";
import { lessonBoardComponents } from "./lessonBoardUi";
import { boardDebug, boardDebugMounted, debugBoardComponents } from "./boardDebug";
import { installSyncHold } from "./lessonSyncHold";
import { installLessonLaser } from "./lessonLaser";
import { installLessonThumbnail } from "./lessonThumbnail";

const boardComponents = debugBoardComponents(lessonBoardComponents);
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
import { forgetTldrawSyncToken, prefetchTldrawSyncToken } from "./boardSyncPrefetch";
import {
  BOARD_LOADING_STALL_MS,
  boardReconnectDelay,
  canAutoReconnect,
  isBoardSyncPending,
  watchBoardWake,
} from "./boardSyncWatchdog";
import { markPerf } from "../../utils/appBoot";
import { reportClientEvent } from "../../utils/clientTelemetry";
import {
  boardSyncStatusName,
  nextCanvasGeometry,
} from "./boardDocumentTelemetry";
import { createLessonBoardAssetStore } from "./lessonBoardAssetStore";
import { revealBoardContent } from "./boardOpenFrame";
import { installLessonViewportMemory } from "./lessonViewportMemory";
import BoardV2ErrorBoundary from "./BoardV2ErrorBoundary";
import LessonBoardMessage from "./LessonBoardMessage";
import "../styles/boards.css";

import { markBoard } from "../lessonLoadTrace";

markBoard("tldrawModuleAt", new Date().toISOString());

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

const SYNC_TOKEN_RETRY_MS = [0, 400, 1200];

async function lessonBoardConnectUri(boardId, { fresh = false } = {}) {
  if (fresh) forgetTldrawSyncToken(boardId);
  let lastError = null;
  for (let index = 0; index < SYNC_TOKEN_RETRY_MS.length; index += 1) {
    if (SYNC_TOKEN_RETRY_MS[index] > 0) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, SYNC_TOKEN_RETRY_MS[index]);
      });
    }
    try {
      const issued = await prefetchTldrawSyncToken(boardId);
      const token = issued?.token;
      if (!token) throw new Error("sync token missing");
      const url = new URL(lessonBoardSyncUri(boardId));
      url.searchParams.set("access_token", token);
      return url.toString();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("sync token missing");
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
  const appearance = lessonPresenceAppearance(user, store.get(TLINSTANCE_ID));
  const avatarUrl = typeof user?.imageUrl === "string" ? user.imageUrl.trim() : "";
  const meta = { ...(presence.meta || {}), identityColor: appearance.identityColor };
  if (avatarUrl) meta.avatarUrl = avatarUrl;
  return { ...presence, color: appearance.color, meta };
}

function useLessonBoardSync({ boardId, roomId, users, assets, fresh = false }) {
  const uri = useCallback(() => lessonBoardConnectUri(boardId, { fresh }), [boardId, fresh]);
  // ?tldebug=nopresence — не отправлять присутствие (курсоры, выделение) в комнату.
  const getUserPresence = useCallback(
    boardDebug.has("nopresence") ? () => null : lessonUserPresence,
    [],
  );
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
  attempt = 0,
  reconnect = false,
}) {
  const users = useMemo(
    () => createLessonUserStore({ userId, displayName, color, avatarUrl }),
    [userId, displayName, color, avatarUrl],
  );
  const assets = useMemo(() => createLessonBoardAssetStore(boardId), [boardId]);
  const sync = useLessonBoardSync({ boardId, roomId, users, assets, fresh: reconnect });
  const licenseKey = tldrawLicenseKey();
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

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

  // r124: «loading» дольше 12 с или «error» — пересоздаём соединение со свежим токеном,
  // с нарастающей паузой, не больше BOARD_MAX_AUTO_RECONNECTS раз подряд.
  const pending = isBoardSyncPending(sync.status);
  const autoLeft = canAutoReconnect(attempt);
  useEffect(() => {
    if (!pending || !autoLeft) return undefined;
    const wait = sync.status === "error"
      ? boardReconnectDelay(attempt)
      : BOARD_LOADING_STALL_MS + (attempt > 0 ? boardReconnectDelay(attempt) : 0);
    const timer = window.setTimeout(() => {
      reportClientEvent("board_sync_reconnect", {
        board_id: String(boardId || "").slice(0, 64),
        reason: sync.status === "error" ? "error" : "loading-stall",
        attempt: String(attempt),
      });
      onRetryRef.current?.({ auto: true });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [attempt, autoLeft, boardId, pending, sync.status]);

  // r124: доска снова видна (учитель показал её повторно, вкладка вернулась,
  // iOS Safari восстановил страницу из bfcache, вернулась сеть) и всё ещё не
  // подключена — переподключаемся сразу, не дожидаясь таймера.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const node = typeof document !== "undefined"
      ? document.querySelector('[data-testid="tldraw-board"]')
      : null;
    return watchBoardWake({
      node,
      onWake: (reason) => {
        if (!pendingRef.current) return;
        reportClientEvent("board_sync_reconnect", {
          board_id: String(boardId || "").slice(0, 64),
          reason: String(reason || "wake").slice(0, 32),
          attempt: String(attempt),
        });
        onRetryRef.current?.({ auto: false });
      },
    });
  }, [attempt, boardId]);

  if (pending && !autoLeft) {
    return (
      <LessonBoardMessage
        title="Не удалось подключить доску"
        text="Доска не загружается: соединение с сервером доски не устанавливается. Проверьте интернет (лучше Wi‑Fi, без VPN) и нажмите «Переподключить»."
        onRetry={() => onRetryRef.current?.({ auto: false })}
        retryLabel="Переподключить"
      />
    );
  }
  if (sync.status === "loading") {
    return <LessonBoardMessage text={attempt > 0 ? "Переподключаем доску…" : "Подключаем доску…"} />;
  }
  if (sync.status === "error") {
    return <LessonBoardMessage text="Соединение с доской прервалось, переподключаем…" />;
  }

  return (
    <Tldraw
      store={sync.store}
      licenseKey={licenseKey}
      options={lessonTldrawOptions}
      shapeUtils={[LessonGeoShapeUtil, LessonNoteShapeUtil, ...lessonCanvasShapeUtils]}
      tools={lessonTools}
      overrides={lessonUiOverrides}
      components={boardComponents}
      onMount={(editor) => {
        assets.bind?.(editor);
        keepImagesUnderEraser(editor);
        const disposeColors = installLessonColorSync(editor);
        const disposeLaser = installLessonLaser(editor);
        editor.user.updateUserPreferences({
          colorScheme: "light",
          name: displayName,
          color,
        });
        if (!canEdit) editor.updateInstanceState({ isReadonly: true });
        boardDebugMounted();
        if (boardDebug.has("log")) window.__tlEditor = editor;
        const disposeSyncHold = installSyncHold(editor);
        const disposeSheets = boardDebug.has("nosheets") ? () => {} : installLessonSheets(editor, {
          userId,
          boardId,
          storage: window.localStorage,
        });
        // r114: своя камера с прошлого закрытия (после выбора листа); без неё — прежнее «показать лист».
        const viewportMemory = installLessonViewportMemory(editor, {
          userId,
          boardId,
          storage: window.localStorage,
        });
        const stopReveal = boardDebug.has("nosheets") || viewportMemory.restored
          ? () => {}
          : revealBoardContent(editor);
        const disposeEraserInput = boardDebug.has("noinput") ? () => {} : installCoalescedEraserInput(editor);
        const disposeThickness = installLessonThickness(editor);
        const disposeThumbnail = installLessonThumbnail(editor, { boardId, canEdit });
        if (typeof editor.registerExternalContentHandler === "function") {
          editor.registerExternalContentHandler("files", (content) => (
            addBoardFiles(editor, content?.files, content?.point)
          ));
        }
        return () => {
          viewportMemory.dispose();
          stopReveal();
          disposeThumbnail();
          disposePdfNotice(editor);
          disposeThickness();
          disposeSyncHold();
          disposeEraserInput();
          disposeColors();
          disposeLaser();
          disposeSheets();
        };
      }}
    />
  );
}

function TldrawBoardSession({ boardId, userId, displayName, role, avatarUrl, canEdit, onRetry, attempt = 0, reconnect = false }) {
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
      attempt={attempt}
      reconnect={reconnect}
    />
  );
}

/**
 * Board V2. Права зеркалят view/edit токена комнаты.
 * Растровые картинки уходят в TLAssetStore и хранятся как URL доски.
 */
export default function TldrawBoard(props) {
  // key — пересоздание сессии; auto — номер автоматической попытки подряд
  // (ручное «Переподключить» и повторный показ доски сбрасывают счётчик).
  const [session, setSession] = useState({ key: 0, auto: 0 });
  useEffect(() => {
    markBoard("tldrawMountedAt", new Date().toISOString());
    return () => {
      markBoard("tldrawUnmountAt", new Date().toISOString());
    };
  }, []);
  const retry = (options) => setSession((value) => ({
    key: value.key + 1,
    auto: options?.auto ? value.auto + 1 : 0,
  }));
  const roomId = lessonBoardRoomId(props.boardId);

  return (
    <LessonBoardFrame roomId={roomId} boardId={props.boardId}>
      <BoardV2ErrorBoundary onRetry={retry}>
        <TldrawBoardSession key={session.key} {...props} onRetry={retry} attempt={session.auto} reconnect={session.key > 0} />
      </BoardV2ErrorBoundary>
    </LessonBoardFrame>
  );
}
