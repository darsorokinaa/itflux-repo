import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  clearInteractiveBoard,
  duplicateInteractiveBoard,
  fetchInteractiveBoard,
  updateInteractiveBoard,
  uploadInteractiveBoardImage,
} from "../../utils/cabinetAuth";
import CabinetIcon from "../CabinetIcons";
import BoardAccessModal from "../components/BoardAccessModal";
import ConfirmActionModal from "../components/ConfirmActionModal";
import BoardExcalidrawCanvas from "../boards/BoardExcalidrawCanvas";
import {
  AUTOSAVE_DEBOUNCE_MS,
  buildScenePayload,
  createDebouncedSaver,
  saveStatusLabel,
  shouldBlockUnload,
  type BoardScenePayload,
  type SaveStatus,
} from "../boards/boardAutosave";
import {
  boardFileSlug,
  captureBoardThumbnail,
  copyBlobToClipboard,
  downloadBlob,
} from "../boards/boardExport";
import {
  externalizeSceneFiles,
  filesForPersist,
  filesNeedRemoteHydrate,
  findMissingImageFileIds,
  hydrateBoardFiles,
  isTransientFileUrl,
  revokeBoardBlobUrls,
} from "../boards/boardFiles";
import {
  BG_COLOR_KEY,
  GRID_STYLE_KEY,
  gridAppStatePatch,
  normalizeGridStyle,
  paperOverlayStyle,
  resolveBoardBgColor,
  usesPaperOverlay,
  type BoardGridStyle,
} from "../boards/boardGrid";
import {
  createBoardCollabSession,
  mergeCollabScenes,
  type CollabPeer,
  type RemoteCursor,
} from "../boards/boardCollab";
import { applyBoardOps } from "../boards/boardOps";
import {
  filterUnauthorizedMutations,
  stampElementOwnership,
} from "../boards/boardOwnership";
import {
  createBoardLoadMetrics,
  estimateSceneBytes,
  logBoardMetrics,
  phaseLabel,
  type BoardLoadMetrics,
  type BoardLoadPhase,
} from "../boards/boardLifecycle";
import "../styles/boards.css";

const TEACHER_CURSOR = { background: "#2563eb", stroke: "#1d4ed8" };
const STUDENT_CURSOR = { background: "#e11d48", stroke: "#be123c" };

function cursorColorsForRole(role?: string) {
  return role === "teacher" ? TEACHER_CURSOR : STUDENT_CURSOR;
}

function buildCollaboratorsMap(
  cursors: Map<string, RemoteCursor>,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const [clientId, cursor] of cursors) {
    map.set(clientId, {
      pointer: { x: cursor.x, y: cursor.y, tool: "pointer", renderCursor: true },
      button: "up",
      username: cursor.displayName,
      color: cursorColorsForRole(cursor.role),
      id: String(cursor.userId || clientId),
      socketId: clientId,
    });
  }
  return map;
}

type BoardDetail = {
  id: string;
  title: string;
  description?: string;
  version: number;
  scene_data?: BoardScenePayload;
  thumbnail?: string;
  allow_export?: boolean;
  can_export?: boolean;
  can_edit?: boolean;
  can_manage?: boolean;
  permission?: string;
  student?: number | null;
  student_name?: string | null;
  collaborative_edit?: boolean;
  owner_name?: string | null;
  viewer_user_id?: number | null;
  viewer_role?: string | null;
};

type ExcalidrawAPI = {
  getSceneElements: () => unknown[];
  getSceneElementsIncludingDeleted?: () => unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateScene: (payload: Record<string, unknown>) => void;
  resetScene?: () => void;
};

/** Локальные элементы для merge: включая soft-deleted, иначе удаление «откатывается». */
function getLocalElementsForMerge(api: ExcalidrawAPI | null, fallback: unknown[] | null | undefined): unknown[] {
  // latestSceneRef предпочтительнее: onChange уже кладёт туда isDeleted.
  if (fallback && Array.isArray(fallback)) return fallback;
  if (api?.getSceneElementsIncludingDeleted) {
    return (api.getSceneElementsIncludingDeleted() || []) as unknown[];
  }
  return (api?.getSceneElements?.() || []) as unknown[];
}

function applyRemoteSceneToApi(
  api: ExcalidrawAPI,
  scene: { elements: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> },
) {
  const local = api.getAppState?.() || {};
  api.updateScene?.({
    elements: scene.elements,
    appState: {
      ...(scene.appState || {}),
      scrollX: local.scrollX,
      scrollY: local.scrollY,
      zoom: local.zoom,
      collaborators: local.collaborators,
      selectedElementIds: local.selectedElementIds,
      selectedGroupIds: local.selectedGroupIds,
      // Keep local UI theme — remote scene shouldn't flip chrome.
      theme: local.theme === "dark" ? "dark" : "light",
    },
    files: scene.files || {},
    // Remote updates must not enter local undo stack (Excalidraw 0.18+).
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

function hasSelectedElements(appState: Record<string, unknown>): boolean {
  const ids = appState.selectedElementIds;
  if (!ids || typeof ids !== "object") return false;
  return Object.values(ids as Record<string, unknown>).some(Boolean);
}

function slugDownloadName(title: string, ext: string) {
  return `${boardFileSlug(title)}.${ext}`;
}

function participantInitials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toLocaleUpperCase("ru-RU");
  }
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toLocaleUpperCase("ru-RU");
}

const AVATAR_PALETTE = [
  "#0f766e",
  "#1d4ed8",
  "#7c3aed",
  "#b45309",
  "#be123c",
  "#047857",
  "#0369a1",
];

function avatarColor(name: string): string {
  const raw = String(name || "");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export default function CabinetBoardEditorPage() {
  const { boardId = "" } = useParams();
  const navigate = useNavigate();
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const versionRef = useRef(1);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveRequestedRef = useRef(false);
  const latestSceneRef = useRef<BoardScenePayload | null>(null);
  /** Монотонный счётчик локальных правок содержимого (не путать с server version). */
  const localRevisionRef = useRef(0);
  const lastSavedRevisionRef = useRef(0);
  /** Server version последнего успешного PATCH этой вкладки — чтобы игнорировать свой scene_saved. */
  const lastSaveServerVersionRef = useRef(0);
  const hasLocalChangesRef = useRef(false);
  const mountedRef = useRef(true);
  const boardIdRef = useRef(boardId);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  boardIdRef.current = boardId;

  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadPhase, setLoadPhase] = useState<BoardLoadPhase>("initializing");
  const [loadError, setLoadError] = useState("");
  const [loadErrorCode, setLoadErrorCode] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [initialData, setInitialData] = useState<BoardScenePayload | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [missingImageCount, setMissingImageCount] = useState(0);
  const metricsRef = useRef<BoardLoadMetrics>(createBoardLoadMetrics());
  const hydratedBlobUrlsRef = useRef<string[]>([]);
  const loadAbortRef = useRef<AbortController | null>(null);
  const hostReadyRef = useRef(false);
  hostReadyRef.current = hostReady;
  const [exportOpen, setExportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [burgerOpen, setBurgerOpen] = useState(true);
  const [accessOpen, setAccessOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [excalidrawReady, setExcalidrawReady] = useState(false);
  const [bgColor, setBgColor] = useState("#ffffff");
  const [gridStyle, setGridStyle] = useState<BoardGridStyle>("none");
  const [boardTheme, setBoardTheme] = useState<"light" | "dark">("light");
  const [hasSelection, setHasSelection] = useState(false);
  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>([]);
  const [collabStatus, setCollabStatus] = useState<"off" | "connecting" | "open" | "closed" | "error">("off");
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const paperOverlayRef = useRef<HTMLDivElement | null>(null);
  const gridStyleRef = useRef<BoardGridStyle>("none");
  const bgColorRef = useRef("#ffffff");
  const boardThemeRef = useRef<"light" | "dark">("light");
  const burgerOpenRef = useRef(true);
  const hadSelectionRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  /** Sync-гард только на onChange от updateScene(collaborators); не держит publishLive. */
  const applyingCollaboratorsRef = useRef(false);
  const lastElementsRef = useRef<readonly unknown[] | null>(null);
  const lastFilesRef = useRef<Record<string, unknown> | null>(null);
  const knownElementIdsRef = useRef(new Set<string>());
  const viewerUserIdRef = useRef<number | null>(null);
  const viewerRoleRef = useRef<string>("student");
  const canManageRefLocal = useRef(false);
  const saverRef = useRef<{ schedule: () => void; flush: () => Promise<void>; cancel: () => void } | null>(null);
  const collabRef = useRef<ReturnType<typeof createBoardCollabSession> | null>(null);
  const remoteCursorsRef = useRef(new Map<string, RemoteCursor>());
  const boardNamesRef = useRef({ owner: "", student: "" });
  const uploadingFileIdsRef = useRef(new Set<string>());
  const lastActiveToolRef = useRef("");
  const imageUploadStatusRef = useRef<"idle" | "uploading" | "error">("idle");
  const [imageUploadStatus, setImageUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  gridStyleRef.current = gridStyle;
  bgColorRef.current = bgColor;
  boardThemeRef.current = boardTheme;
  burgerOpenRef.current = burgerOpen;
  if (board) {
    boardNamesRef.current = {
      owner: board.owner_name || "",
      student: board.student_name || "",
    };
  }

  const canEdit = Boolean(board?.can_edit);
  const canManage = Boolean(board?.can_manage);
  const viewModeEnabled = !canEdit;
  const collaborative = Boolean(board?.collaborative_edit);
  const boardReady = Boolean(board);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const safeSetSaveStatus = useCallback((status: SaveStatus | ((prev: SaveStatus) => SaveStatus)) => {
    if (!mountedRef.current) return;
    setSaveStatus(status);
  }, []);

  /** Thumbnail в фоне — не блокирует рисование и не входит в критический путь PATCH. */
  const scheduleThumbnailRefresh = useCallback((targetBoardId: string) => {
    if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
    thumbnailTimerRef.current = setTimeout(() => {
      thumbnailTimerRef.current = null;
      if (!mountedRef.current || boardIdRef.current !== targetBoardId) return;
      const scene = latestSceneRef.current;
      void (async () => {
        try {
          const thumbnail = await captureBoardThumbnail(
            apiRef.current ?? (scene as { elements?: Array<{ isDeleted?: boolean } & Record<string, unknown>>; appState?: Record<string, unknown>; files?: Record<string, unknown> }),
          );
          if (!mountedRef.current || boardIdRef.current !== targetBoardId) return;
          if (thumbnail === null) return;
          await updateInteractiveBoard(targetBoardId, { thumbnail });
          if (!mountedRef.current || boardIdRef.current !== targetBoardId) return;
          setBoard((prev) => (prev ? { ...prev, thumbnail } : prev));
        } catch {
          /* preview is best-effort */
        }
      })();
    }, 1500);
  }, []);

  const markLocalSceneChange = useCallback(() => {
    localRevisionRef.current += 1;
    hasLocalChangesRef.current = true;
    dirtyRef.current = true;
  }, []);

  const persistScene = useCallback(async () => {
    if (!boardId || !canEdit || conflict) return;
    if (savingRef.current) {
      saveRequestedRef.current = true;
      return;
    }
    const scene = latestSceneRef.current;
    if (!scene) return;
    if (!dirtyRef.current && localRevisionRef.current <= lastSavedRevisionRef.current) return;

    savingRef.current = true;
    saveRequestedRef.current = false;
    const boardIdAtSave = boardId;
    const revisionAtSave = localRevisionRef.current;
    const versionAtSave = versionRef.current;
    // Снимок на момент старта: правки во время запроса остаются в latestSceneRef.
    const snapshot: BoardScenePayload = {
      elements: Array.isArray(scene.elements) ? [...scene.elements] : [],
      appState: { ...(scene.appState || {}) },
      files: { ...(scene.files || {}) },
    };

    safeSetSaveStatus("saving");
    try {
      const files = await externalizeSceneFiles(
        filesForPersist(snapshot.files as Record<string, Record<string, unknown>>) as Record<string, Record<string, unknown>>,
        (form) => uploadInteractiveBoardImage(boardIdAtSave, form),
      );
      // Смена доски — бросаем. Размонтирование — всё равно сохраняем снимок.
      if (boardIdRef.current !== boardIdAtSave) return;

      const persistFiles = filesForPersist(files) as Record<string, unknown>;

      // Подмешиваем только стабильные URL файлов — не затираем более новые elements.
      if (latestSceneRef.current && boardIdRef.current === boardIdAtSave) {
        latestSceneRef.current = {
          ...latestSceneRef.current,
          files: { ...latestSceneRef.current.files, ...files },
        };
      }

      const payload: BoardScenePayload = { ...snapshot, files: persistFiles };
      const data = await updateInteractiveBoard(boardIdAtSave, {
        scene_data: payload,
        version: versionAtSave,
      });

      if (boardIdRef.current !== boardIdAtSave) return;

      // Не применяем scene из ответа — локальное состояние уже актуально.
      versionRef.current = data.version;
      lastSaveServerVersionRef.current = data.version;
      if (revisionAtSave > lastSavedRevisionRef.current) {
        lastSavedRevisionRef.current = revisionAtSave;
      }

      const hasNewerLocal = localRevisionRef.current > revisionAtSave;
      if (hasNewerLocal) {
        dirtyRef.current = true;
        saveRequestedRef.current = true;
        if (mountedRef.current) safeSetSaveStatus("dirty");
      } else {
        dirtyRef.current = false;
        if (mountedRef.current) safeSetSaveStatus("saved");
      }

      if (mountedRef.current) {
        setBoard((prev) => (prev ? { ...prev, version: data.version } : prev));
        setConflict(false);
        scheduleThumbnailRefresh(boardIdAtSave);
      }
    } catch (err: unknown) {
      if (boardIdRef.current !== boardIdAtSave) return;
      const error = err as { code?: string; status?: number; message?: string };
      if (error?.code === "VERSION_CONFLICT" || error?.status === 409) {
        // При совместном редактировании сливаем серверную сцену, не заменяя локальные правки.
        if (collaborative) {
          try {
            const fresh = await fetchInteractiveBoard(boardIdAtSave);
            if (boardIdRef.current !== boardIdAtSave) return;
            versionRef.current = fresh.version || versionRef.current;
            const remoteScene = buildScenePayload(
              fresh.scene_data?.elements || [],
              fresh.scene_data?.appState || {},
              fresh.scene_data?.files || {},
            );
            const localElements = getLocalElementsForMerge(
              apiRef.current,
              latestSceneRef.current?.elements,
            );
            const localApp = (apiRef.current?.getAppState?.() || latestSceneRef.current?.appState || {}) as Record<string, unknown>;
            const localFiles = (apiRef.current?.getFiles?.() || latestSceneRef.current?.files || {}) as Record<string, unknown>;
            const merged = mergeCollabScenes(
              { elements: localElements, appState: localApp, files: localFiles },
              remoteScene,
            );
            if (mountedRef.current && apiRef.current) {
              applyingRemoteRef.current = true;
              applyRemoteSceneToApi(apiRef.current, merged);
              queueMicrotask(() => { applyingRemoteRef.current = false; });
            }
            latestSceneRef.current = buildScenePayload(merged.elements, merged.appState, merged.files);
            lastElementsRef.current = merged.elements;
            lastFilesRef.current = merged.files;
            // После merge нужно пересохранить нашу актуальную версию поверх серверной.
            markLocalSceneChange();
            saveRequestedRef.current = true;
            if (mountedRef.current) {
              setConflict(false);
              safeSetSaveStatus("dirty");
              setBoard((prev) => (prev ? { ...prev, version: fresh.version } : prev));
            }
          } catch {
            if (mountedRef.current) {
              setConflict(true);
              safeSetSaveStatus("conflict");
            }
          }
        } else if (mountedRef.current) {
          setConflict(true);
          safeSetSaveStatus("conflict");
        }
      } else {
        // Сеть/сервер: локальные правки сохраняем, пометим dirty для повтора.
        dirtyRef.current = true;
        saveRequestedRef.current = true;
        if (mountedRef.current) {
          safeSetSaveStatus("error");
          showNotice(error?.message || "Ошибка сохранения");
        }
      }
    } finally {
      savingRef.current = false;
      if (
        mountedRef.current
        && boardIdRef.current === boardIdAtSave
        && (saveRequestedRef.current || localRevisionRef.current > revisionAtSave)
        && canEdit
        && !conflictRef.current
      ) {
        saveRequestedRef.current = false;
        // Следующее сохранение — после короткого debounce, не параллельно.
        saverRef.current?.schedule();
      }
    }
  }, [boardId, canEdit, collaborative, conflict, markLocalSceneChange, safeSetSaveStatus, scheduleThumbnailRefresh, showNotice]);

  const debouncedSaver = useMemo(
    () => createDebouncedSaver(() => persistScene(), AUTOSAVE_DEBOUNCE_MS),
    [persistScene],
  );
  saverRef.current = debouncedSaver;

  // При пересоздании saver — flush, не cancel (иначе теряются отложенные сохранения)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      void debouncedSaver.flush();
    };
  }, [debouncedSaver]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (thumbnailTimerRef.current) {
        clearTimeout(thumbnailTimerRef.current);
        thumbnailTimerRef.current = null;
      }
      saverRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAbortRef.current?.abort();
    const abort = new AbortController();
    loadAbortRef.current = abort;
    revokeBoardBlobUrls(hydratedBlobUrlsRef.current);
    hydratedBlobUrlsRef.current = [];

    // Сброс при смене доски — ответ предыдущей доски не должен применяться.
    hasLocalChangesRef.current = false;
    localRevisionRef.current = 0;
    lastSavedRevisionRef.current = 0;
    lastSaveServerVersionRef.current = 0;
    dirtyRef.current = false;
    savingRef.current = false;
    saveRequestedRef.current = false;
    latestSceneRef.current = null;
    lastElementsRef.current = null;
    lastFilesRef.current = null;
    metricsRef.current = createBoardLoadMetrics();
    setLoading(true);
    setLoadPhase("loading_scene");
    setLoadError("");
    setLoadErrorCode("");
    setConflict(false);
    setExcalidrawReady(false);
    setHostReady(false);
    setInitialData(null);
    setMissingImageCount(0);
    setSaveStatus("idle");
    saverRef.current?.cancel();
    logBoardMetrics("loading_scene", metricsRef.current);

    void (async () => {
      try {
        const data: BoardDetail = await fetchInteractiveBoard(boardId);
        if (cancelled || abort.signal.aborted || boardIdRef.current !== boardId) return;
        if (hasLocalChangesRef.current) return;

        metricsRef.current.sceneLoadedAt = performance.now();
        setBoard(data);
        setTitle(data.title || "Новая доска");
        versionRef.current = data.version || 1;
        const rawApp = data.scene_data?.appState || {};
        const style = normalizeGridStyle(rawApp[GRID_STYLE_KEY], rawApp.gridModeEnabled);
        const solidBg = resolveBoardBgColor(rawApp);
        const theme = rawApp.theme === "dark" ? "dark" : "light";
        const rawFiles = (data.scene_data?.files || {}) as Record<string, Record<string, unknown>>;
        const elements = data.scene_data?.elements || [];

        setLoadPhase("loading_files");
        logBoardMetrics("loading_files", metricsRef.current);
        const hydrated = await hydrateBoardFiles(rawFiles, { signal: abort.signal });
        if (cancelled || abort.signal.aborted || boardIdRef.current !== boardId) {
          revokeBoardBlobUrls(hydrated.blobUrls);
          return;
        }
        hydratedBlobUrlsRef.current = hydrated.blobUrls;
        const orphanIds = findMissingImageFileIds(elements, hydrated.files);
        setMissingImageCount(hydrated.failedFileIds.length + orphanIds.length + hydrated.missingFileIds.length);

        const scene = buildScenePayload(
          elements,
          { ...rawApp, ...gridAppStatePatch(style, solidBg), theme },
          hydrated.files,
        );
        metricsRef.current.filesLoadedAt = performance.now();
        metricsRef.current.elementCount = Array.isArray(elements) ? elements.length : 0;
        metricsRef.current.fileCount = Object.keys(hydrated.files).length;
        metricsRef.current.sceneBytesApprox = estimateSceneBytes(scene);

        knownElementIdsRef.current = new Set(
          (Array.isArray(elements) ? elements : [])
            .map((el) => (el && typeof el === "object" ? (el as { id?: string }).id : null))
            .filter((id): id is string => Boolean(id)),
        );

        setInitialData(scene);
        latestSceneRef.current = scene;
        setGridStyle(style);
        setBgColor(solidBg);
        setBoardTheme(theme);
        setLoadPhase("connecting");
        setLoading(false);
        logBoardMetrics("connecting", metricsRef.current);
      } catch (err: unknown) {
        if (cancelled || abort.signal.aborted || boardIdRef.current !== boardId) return;
        const error = err as { message?: string; code?: string };
        metricsRef.current.lastError = error?.message || "Не удалось открыть доску";
        metricsRef.current.lastErrorCode = error?.code || "load_failed";
        setLoadError(error?.message || "Не удалось открыть доску");
        setLoadErrorCode(error?.code || "load_failed");
        setLoadPhase("error");
        setLoading(false);
        logBoardMetrics("error", metricsRef.current);
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      revokeBoardBlobUrls(hydratedBlobUrlsRef.current);
      hydratedBlobUrlsRef.current = [];
    };
  }, [boardId, reloadToken]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (shouldBlockUnload(saveStatus, dirtyRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveStatus]);

  const canEditRef = useRef(canEdit);
  const conflictRef = useRef(conflict);
  canEditRef.current = canEdit;
  conflictRef.current = conflict;

  useEffect(() => {
    return () => {
      if (dirtyRef.current && canEdit && !conflict) {
        void persistScene();
      }
    };
  }, [canEdit, conflict, persistScene]);

  // pagehide: flush с keepalive, чтобы не потерять изменения при закрытии вкладки
  useEffect(() => {
    const onPageHide = () => {
      if (!dirtyRef.current || !canEditRef.current || conflictRef.current || !boardId) return;
      const scene = latestSceneRef.current;
      if (!scene) return;
      try {
        const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        const token = csrf ? decodeURIComponent(csrf[1]) : "";
        void fetch(`/api/cabinet/interactive-boards/${boardId}/`, {
          method: "PATCH",
          credentials: "same-origin",
          keepalive: true,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(token ? { "X-CSRFToken": token } : {}),
          },
          body: JSON.stringify({ scene_data: scene, version: versionRef.current }),
        });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [boardId]);

  // Стабильный onChange. Не ставим React-state на openMenu/zoom/selection —
  // иначе родитель ререндерится; ExcalidrawHost от этого защищён memo, но
  // лишние сохранения тоже не нужны.
  const syncPaperOverlay = useCallback((appState: Record<string, unknown>) => {
    const el = paperOverlayRef.current;
    const style = gridStyleRef.current;
    if (!el || !usesPaperOverlay(style)) return;
    const next = paperOverlayStyle(style, appState);
    el.style.backgroundSize = next.backgroundSize;
    el.style.backgroundPosition = next.backgroundPosition;
  }, []);

  const syncLeftPanels = useCallback((appState: Record<string, unknown>) => {
    const selected = hasSelectedElements(appState);
    if (selected !== hadSelectionRef.current) {
      setHasSelection(selected);
      if (selected) {
        setBurgerOpen(false);
      } else {
        // Снятие выделения → снова панель настроек холста
        setBurgerOpen(true);
      }
      hadSelectionRef.current = selected;
    }

    const nextTheme = appState.theme === "dark" ? "dark" : "light";
    if (nextTheme !== boardThemeRef.current) {
      setBoardTheme(nextTheme);
    }
  }, []);

  const publishLiveScene = useCallback((scene: BoardScenePayload) => {
    collabRef.current?.publishLive(
      {
        elements: scene.elements as unknown[],
        appState: scene.appState,
        files: scene.files as Record<string, unknown>,
      },
      versionRef.current,
    );
  }, []);

  const externalizeAndSyncFiles = useCallback(async (scene: BoardScenePayload) => {
    if (!boardId || !apiRef.current) return scene;
    const files = (scene.files || {}) as Record<string, Record<string, unknown>>;
    const pendingIds = Object.entries(files)
      .filter(([id, meta]) => {
        const url = String(meta?.dataURL || meta?.url || "");
        return isTransientFileUrl(url) && !uploadingFileIdsRef.current.has(id);
      })
      .map(([id]) => id);
    if (!pendingIds.length) {
      publishLiveScene(scene);
      return scene;
    }
    pendingIds.forEach((id) => uploadingFileIdsRef.current.add(id));
    imageUploadStatusRef.current = "uploading";
    setImageUploadStatus("uploading");
    try {
      const nextFiles = await externalizeSceneFiles(files, (form) =>
        uploadInteractiveBoardImage(boardId, form),
      );
      // Сразу гидратируем новые API URL → blob, иначе локальный canvas «теряет» картинку.
      const hydratedUpload = await hydrateBoardFiles(
        Object.fromEntries(pendingIds.map((id) => [id, nextFiles[id]]).filter(([, m]) => m)),
      );
      hydratedBlobUrlsRef.current.push(...hydratedUpload.blobUrls);
      const displayFiles = { ...nextFiles, ...hydratedUpload.files };
      pendingIds.forEach((id) => uploadingFileIdsRef.current.delete(id));
      if (!mountedRef.current || boardIdRef.current !== boardId) return scene;
      // Не затираем elements, которые пользователь успел изменить во время upload.
      if (latestSceneRef.current) {
        latestSceneRef.current = {
          ...latestSceneRef.current,
          files: { ...latestSceneRef.current.files, ...displayFiles },
        };
      }
      lastFilesRef.current = {
        ...(lastFilesRef.current || {}),
        ...displayFiles,
      };
      applyingRemoteRef.current = true;
      apiRef.current.updateScene?.({
        files: displayFiles,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      queueMicrotask(() => {
        applyingRemoteRef.current = false;
      });
      imageUploadStatusRef.current = "idle";
      setImageUploadStatus("idle");
      const publishScene = latestSceneRef.current || { ...scene, files: displayFiles };
      publishLiveScene(publishScene);
      markLocalSceneChange();
      safeSetSaveStatus((s) => (s === "dirty" || s === "saving" ? s : "dirty"));
      debouncedSaver.schedule();
      return publishScene;
    } catch (err: unknown) {
      pendingIds.forEach((id) => uploadingFileIdsRef.current.delete(id));
      imageUploadStatusRef.current = "error";
      setImageUploadStatus("error");
      const error = err as { message?: string };
      showNotice(error?.message || "Не удалось загрузить изображение на доску");
      // Не публикуем blob:/data: пирам — только локальный предпросмотр.
      return scene;
    }
  }, [boardId, debouncedSaver, markLocalSceneChange, publishLiveScene, safeSetSaveStatus, showNotice]);

  viewerUserIdRef.current = board?.viewer_user_id ?? null;
  viewerRoleRef.current = board?.viewer_role || (canManage ? "teacher" : "student");
  canManageRefLocal.current = canManage;

  const clearApplyingRemoteSoon = useCallback(() => {
    // Снимаем флаг на следующем микротаске: onChange от updateScene обычно sync,
    // а длинный setTimeout(40–80ms) раньше блокировал исходящий publishLive при курсорах пира.
    queueMicrotask(() => {
      applyingRemoteRef.current = false;
    });
  }, []);

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      syncPaperOverlay(appState);
      syncLeftPanels(appState);
      if (applyingCollaboratorsRef.current) return;
      if (applyingRemoteRef.current) return;
      if (!canEditRef.current || conflictRef.current) return;

      const prevElements = (latestSceneRef.current?.elements || lastElementsRef.current || []) as unknown[];
      let nextElements = elements as unknown[];
      // Владение: stamp на новые, откат чужих мутаций у ученика.
      nextElements = stampElementOwnership(
        nextElements,
        knownElementIdsRef.current,
        viewerUserIdRef.current,
        viewerRoleRef.current,
      );
      nextElements = filterUnauthorizedMutations(prevElements, nextElements, {
        actorUserId: viewerUserIdRef.current,
        actorRole: viewerRoleRef.current,
        canManage: canManageRefLocal.current,
      });
      for (const raw of nextElements) {
        const id = raw && typeof raw === "object" ? (raw as { id?: string }).id : null;
        if (id) knownElementIdsRef.current.add(id);
      }

      const scene = buildScenePayload(nextElements, appState, files);
      // Сохраняем наш стиль сетки и цвет бумаги (Excalidraw может не вернуть кастомные ключи)
      scene.appState[GRID_STYLE_KEY] = gridStyleRef.current;
      scene.appState[BG_COLOR_KEY] = bgColorRef.current;
      if (usesPaperOverlay(gridStyleRef.current)) {
        scene.appState.viewBackgroundColor = "transparent";
      }
      scene.appState.theme = boardThemeRef.current;
      const elementsChanged = lastElementsRef.current !== elements
        || nextElements !== elements;
      const filesChanged = lastFilesRef.current !== files;
      const bgChanged =
        latestSceneRef.current?.appState?.viewBackgroundColor !== scene.appState.viewBackgroundColor;
      const gridChanged =
        latestSceneRef.current?.appState?.[GRID_STYLE_KEY] !== scene.appState[GRID_STYLE_KEY];
      const themeChanged = latestSceneRef.current?.appState?.theme !== scene.appState.theme;
      latestSceneRef.current = scene;
      const toolType = String((appState.activeTool as { type?: string } | undefined)?.type || "");
      if (toolType && toolType !== lastActiveToolRef.current) {
        lastActiveToolRef.current = toolType;
        collabRef.current?.publishActiveTool(toolType);
      }
      if (!elementsChanged && !filesChanged && !bgChanged && !gridChanged && !themeChanged) return;
      lastElementsRef.current = nextElements;
      lastFilesRef.current = files;
      markLocalSceneChange();
      safeSetSaveStatus((s) => (s === "dirty" || s === "saving" ? s : "dirty"));
      debouncedSaver.schedule();
      const hasTransient = Object.values(files).some((meta) => {
        if (!meta || typeof meta !== "object") return false;
        const url = String((meta as { dataURL?: string; url?: string }).dataURL
          || (meta as { url?: string }).url || "");
        return isTransientFileUrl(url);
      });
      if (hasTransient) {
        void externalizeAndSyncFiles(scene);
      } else {
        publishLiveScene(scene);
      }
    },
    [debouncedSaver, externalizeAndSyncFiles, markLocalSceneChange, publishLiveScene, safeSetSaveStatus, syncPaperOverlay, syncLeftPanels],
  );

  // Совместное редактирование с привязанным учеником (WebSocket live + REST persist).
  // Не зависеть от объекта board целиком — иначе каждое обновление version рвёт WS.
  useEffect(() => {
    if (!boardId || !boardReady || loading || !excalidrawReady) return undefined;
    if (!collaborative && !canEdit) return undefined;

    const displayName =
      (canManage ? boardNamesRef.current.owner : boardNamesRef.current.student)
      || (canManage ? "Учитель" : "Ученик");
    const role = canManage ? "teacher" : "student";

    const applyCollaborators = () => {
      if (!apiRef.current) return;
      const collaborators = buildCollaboratorsMap(remoteCursorsRef.current);
      // Не трогаем applyingRemoteRef: курсоры пира раньше блокировали publishLive на десятки ms.
      applyingCollaboratorsRef.current = true;
      apiRef.current.updateScene?.({
        collaborators,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      queueMicrotask(() => {
        applyingCollaboratorsRef.current = false;
      });
    };

    const session = createBoardCollabSession(
      boardId,
      displayName,
      {
        onStatus: (status) => {
          if (status === "open") {
            metricsRef.current.wsConnectedAt = performance.now();
            setLoadPhase(hostReadyRef.current ? "ready" : "connecting");
          } else if (status === "closed") {
            metricsRef.current.reconnectCount += 1;
            setLoadPhase("reconnecting");
          }
          setCollabStatus(status === "connecting" ? "connecting" : status);
        },
        onPeersChange: setCollabPeers,
        onRemoteOps: (ops, meta) => {
          if (!apiRef.current || boardIdRef.current !== boardId) return;
          const localElements = getLocalElementsForMerge(
            apiRef.current,
            latestSceneRef.current?.elements,
          );
          const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
          const localFiles = (apiRef.current.getFiles?.() || latestSceneRef.current?.files || {}) as Record<string, unknown>;
          const applied = applyBoardOps(
            { elements: localElements, appState: localApp, files: localFiles },
            ops,
          );
          const paintFiles = { ...localFiles, ...(applied.files || {}) } as Record<string, unknown>;
          const paintNow = (displayFiles: Record<string, unknown>) => {
            if (!apiRef.current || boardIdRef.current !== boardId) return;
            applyingRemoteRef.current = true;
            const collaborators = buildCollaboratorsMap(remoteCursorsRef.current);
            applyRemoteSceneToApi(apiRef.current, {
              elements: applied.elements,
              appState: { ...applied.appState, collaborators },
              files: displayFiles,
            });
            latestSceneRef.current = buildScenePayload(applied.elements, applied.appState, displayFiles);
            lastElementsRef.current = applied.elements;
            lastFilesRef.current = displayFiles;
            if (typeof meta.version === "number" && meta.version > versionRef.current) {
              versionRef.current = meta.version;
            }
            clearApplyingRemoteSoon();
          };
          // Штрихи/текст — сразу; гидратацию картинок не ждём на критическом пути.
          paintNow(paintFiles);
          if (filesNeedRemoteHydrate(applied.files as Record<string, Record<string, unknown>>, localFiles as Record<string, Record<string, unknown>>)) {
            void hydrateBoardFiles(applied.files as Record<string, Record<string, unknown>>).then((hydrated) => {
              if (boardIdRef.current !== boardId || !apiRef.current) {
                revokeBoardBlobUrls(hydrated.blobUrls);
                return;
              }
              hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
              applyingRemoteRef.current = true;
              apiRef.current.updateScene?.({
                files: hydrated.files,
                captureUpdate: CaptureUpdateAction.NEVER,
              });
              const prev = latestSceneRef.current;
              if (prev) {
                latestSceneRef.current = { ...prev, files: hydrated.files };
              }
              lastFilesRef.current = hydrated.files;
              clearApplyingRemoteSoon();
            });
          }
        },
        onResyncNeeded: () => {
          // После reconnect подтягиваем серверный snapshot и сливаем с локальным.
          void (async () => {
            try {
              const fresh = await fetchInteractiveBoard(boardId);
              if (boardIdRef.current !== boardId || !apiRef.current) return;
              if (typeof fresh.version === "number" && fresh.version >= versionRef.current) {
                versionRef.current = fresh.version;
              }
              const remoteScene = buildScenePayload(
                fresh.scene_data?.elements || [],
                fresh.scene_data?.appState || {},
                fresh.scene_data?.files || {},
              );
              const localElements = getLocalElementsForMerge(
                apiRef.current,
                latestSceneRef.current?.elements,
              );
              const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
              const localFiles = (apiRef.current.getFiles?.() || latestSceneRef.current?.files || {}) as Record<string, unknown>;
              const merged = mergeCollabScenes(
                { elements: localElements, appState: localApp, files: localFiles },
                remoteScene,
              );
              const localFilesForHydrate = localFiles as Record<string, Record<string, unknown>>;
              applyingRemoteRef.current = true;
              applyRemoteSceneToApi(apiRef.current, {
                elements: merged.elements,
                appState: merged.appState,
                files: { ...localFiles, ...(merged.files || {}) },
              });
              clearApplyingRemoteSoon();
              let displayFiles: Record<string, unknown> = { ...localFiles, ...(merged.files || {}) };
              if (filesNeedRemoteHydrate(merged.files as Record<string, Record<string, unknown>>, localFilesForHydrate)) {
                const hydrated = await hydrateBoardFiles(merged.files as Record<string, Record<string, unknown>>);
                hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
                displayFiles = hydrated.files;
                if (boardIdRef.current === boardId && apiRef.current) {
                  applyingRemoteRef.current = true;
                  applyRemoteSceneToApi(apiRef.current, {
                    elements: merged.elements,
                    appState: merged.appState,
                    files: displayFiles,
                  });
                  clearApplyingRemoteSoon();
                }
              }
              latestSceneRef.current = buildScenePayload(merged.elements, merged.appState, displayFiles);
              lastElementsRef.current = merged.elements;
              lastFilesRef.current = displayFiles;
              collabRef.current?.resetPublishBase(merged.elements);
              if (dirtyRef.current) {
                saveRequestedRef.current = true;
                saverRef.current?.schedule();
              }
            } catch {
              showNotice("Не удалось полностью восстановить сцену после разрыва связи");
            }
          })();
        },
        onRemoteCursor: (cursor, clientId) => {
          if (!cursor) {
            remoteCursorsRef.current.delete(clientId);
          } else {
            remoteCursorsRef.current.set(clientId, cursor);
          }
          applyCollaborators();
        },
        onRemoteScene: (scene, meta) => {
          if (!apiRef.current) return;
          if (boardIdRef.current !== boardId) return;

          // Свой scene_saved после PATCH: не трогаем холст (иначе откат/воскрешение удалений).
          if (
            meta.fromSaved
            && typeof meta.version === "number"
            && meta.version === lastSaveServerVersionRef.current
          ) {
            versionRef.current = meta.version;
            if (!dirtyRef.current && localRevisionRef.current <= lastSavedRevisionRef.current) {
              safeSetSaveStatus("saved");
              setConflict(false);
            }
            setBoard((prev) => (prev ? { ...prev, version: meta.version! } : prev));
            return;
          }

          if (meta.fromSaved && typeof meta.version === "number") {
            if (meta.version < versionRef.current) return;
            versionRef.current = meta.version;
            setBoard((prev) => (prev ? { ...prev, version: meta.version! } : prev));
          }

          // Prefer latestSceneRef + IncludingDeleted — getSceneElements() без deleted воскрешает элементы.
          const localElements = getLocalElementsForMerge(
            apiRef.current,
            latestSceneRef.current?.elements,
          );
          const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
          const localFiles = (apiRef.current.getFiles?.() || latestSceneRef.current?.files || {}) as Record<string, unknown>;
          const merged = mergeCollabScenes(
            { elements: localElements, appState: localApp, files: localFiles },
            scene,
          );

          const applyMerged = (displayFiles: Record<string, unknown>) => {
            if (!apiRef.current || boardIdRef.current !== boardId) return;
            applyingRemoteRef.current = true;
            const collaborators = buildCollaboratorsMap(remoteCursorsRef.current);
            applyRemoteSceneToApi(apiRef.current, {
              elements: merged.elements,
              appState: {
                ...merged.appState,
                collaborators,
              },
              files: displayFiles,
            });
            apiRef.current.updateScene?.({
              collaborators,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            const local = apiRef.current.getAppState?.() || {};
            const nextApp = {
              ...merged.appState,
              scrollX: local.scrollX,
              scrollY: local.scrollY,
              zoom: local.zoom,
              collaborators,
              selectedElementIds: local.selectedElementIds,
              theme: boardThemeRef.current,
            };
            const payload = buildScenePayload(merged.elements, nextApp, displayFiles);
            latestSceneRef.current = payload;
            lastElementsRef.current = merged.elements;
            lastFilesRef.current = displayFiles;
            if (meta.fromSaved) {
              if (!dirtyRef.current) {
                safeSetSaveStatus("saved");
                setConflict(false);
              }
            }
            clearApplyingRemoteSoon();
          };

          // Элементы (штрихи) — сразу; картинки догружаем, только если локально ещё нет blob.
          const paintFiles = { ...localFiles, ...(merged.files || {}) } as Record<string, unknown>;
          applyMerged(paintFiles);
          if (filesNeedRemoteHydrate(
            merged.files as Record<string, Record<string, unknown>>,
            localFiles as Record<string, Record<string, unknown>>,
          )) {
            void hydrateBoardFiles(merged.files as Record<string, Record<string, unknown>>).then((hydrated) => {
              if (boardIdRef.current !== boardId) {
                revokeBoardBlobUrls(hydrated.blobUrls);
                return;
              }
              hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
              applyMerged(hydrated.files as Record<string, unknown>);
            });
          }
        },
      },
      { role },
    );
    collabRef.current = session;
    setCollabStatus("connecting");

    return () => {
      session.close();
      collabRef.current = null;
      remoteCursorsRef.current.clear();
      setCollabPeers([]);
      setCollabStatus("off");
    };
  }, [
    boardId,
    boardReady,
    canEdit,
    canManage,
    clearApplyingRemoteSoon,
    collaborative,
    excalidrawReady,
    loading,
    safeSetSaveStatus,
    showNotice,
  ]);

  const handlePointerSceneMove = useCallback((x: number, y: number, tool: string) => {
    if (!collaborative && !canEdit) return;
    collabRef.current?.publishCursor(x, y, tool);
  }, [canEdit, collaborative]);

  const handlePointerSceneUp = useCallback(() => {
    if (!collaborative && !canEdit) return;
    collabRef.current?.flushLiveNow();
  }, [canEdit, collaborative]);

  const generateIdForFile = useCallback(async (_file: File) => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }, []);
  const handleApiReady = useCallback((api: ExcalidrawAPI) => {
    apiRef.current = api;
    setExcalidrawReady(true);
    try {
      const state = api.getAppState?.() || {};
      const patch = {
        ...gridAppStatePatch(gridStyleRef.current, bgColorRef.current),
        theme: boardThemeRef.current,
      };
      api.updateScene?.({ appState: patch });
      // Повторно отдаём гидратированные files — Excalidraw иногда теряет их
      // при первом paint в iframe с нулевым размером.
      const bootFiles = latestSceneRef.current?.files;
      if (bootFiles && Object.keys(bootFiles).length) {
        api.updateScene?.({
          files: bootFiles,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      syncPaperOverlay(state);
      syncLeftPanels(state);
    } catch {
      /* ignore */
    }
  }, [syncPaperOverlay, syncLeftPanels]);

  const handleHostReady = useCallback(() => {
    setHostReady(true);
    metricsRef.current.readyAt = performance.now();
    setLoadPhase("ready");
    logBoardMetrics("ready", metricsRef.current);
    try {
      apiRef.current?.refresh?.();
    } catch {
      /* ignore */
    }
  }, []);

  const retryBoardLoad = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  // Если превью ещё нет, но на доске уже есть элементы — сохранить thumbnail для списка
  useEffect(() => {
    if (!excalidrawReady || !boardId || !canEdit || conflict) return;
    if (board?.thumbnail) return;
    const scene = latestSceneRef.current;
    const hasElements = (scene?.elements || []).some((el) => !(el as { isDeleted?: boolean })?.isDeleted);
    if (!hasElements) return;
    let cancelled = false;
    void (async () => {
      const thumbnail = await captureBoardThumbnail(apiRef.current ?? scene);
      if (cancelled || thumbnail === null || thumbnail === "") return;
      try {
        await updateInteractiveBoard(boardId, { thumbnail });
        if (!cancelled) {
          setBoard((prev) => (prev ? { ...prev, thumbnail } : prev));
        }
      } catch {
        /* ignore backfill errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [excalidrawReady, boardId, board?.thumbnail, canEdit, conflict]);

  useEffect(() => {
    if (!exportOpen && !moreOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".cb-board-editor__menu")) return;
      setExportOpen(false);
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [exportOpen, moreOpen]);

  const applyBackground = (color: string) => {
    setBgColor(color);
    bgColorRef.current = color;
    const patch = gridAppStatePatch(gridStyleRef.current, color);
    apiRef.current?.updateScene?.({ appState: patch });
    if (latestSceneRef.current) {
      latestSceneRef.current = {
        ...latestSceneRef.current,
        appState: { ...latestSceneRef.current.appState, ...patch },
      };
      markLocalSceneChange();
      safeSetSaveStatus("dirty");
      debouncedSaver.schedule();
    }
  };

  const applyGridStyle = (style: BoardGridStyle) => {
    setGridStyle(style);
    gridStyleRef.current = style;
    const patch = gridAppStatePatch(style, bgColorRef.current);
    apiRef.current?.updateScene?.({ appState: patch });
    if (latestSceneRef.current) {
      latestSceneRef.current = {
        ...latestSceneRef.current,
        appState: { ...latestSceneRef.current.appState, ...patch },
      };
      if (canEdit && !conflict) {
        markLocalSceneChange();
        safeSetSaveStatus("dirty");
        debouncedSaver.schedule();
      }
    }
    if (usesPaperOverlay(style)) {
      // Дать React отрисовать оверлей, затем синхронизировать смещение
      window.requestAnimationFrame(() => {
        syncPaperOverlay(apiRef.current?.getAppState?.() || { zoom: { value: 1 }, scrollX: 0, scrollY: 0 });
      });
    }
  };

  const applyTheme = (theme: "light" | "dark") => {
    setBoardTheme(theme);
    boardThemeRef.current = theme;
    apiRef.current?.updateScene?.({ appState: { theme } });
    if (latestSceneRef.current) {
      latestSceneRef.current = {
        ...latestSceneRef.current,
        appState: { ...latestSceneRef.current.appState, theme },
      };
      if (canEdit && !conflict) {
        markLocalSceneChange();
        safeSetSaveStatus("dirty");
        debouncedSaver.schedule();
      }
    }
  };

  const clearSelectionAndOpenCanvasPanel = () => {
    apiRef.current?.updateScene?.({ appState: { selectedElementIds: {} } });
    hadSelectionRef.current = false;
    setHasSelection(false);
    setBurgerOpen(true);
  };

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTitle(value);
    if (!canManage) return;
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(async () => {
      try {
        await updateInteractiveBoard(boardId, { title: value.trim() || "Новая доска" });
        setBoard((prev) => (prev ? { ...prev, title: value.trim() || "Новая доска" } : prev));
      } catch (err: unknown) {
        const error = err as { message?: string };
        showNotice(error?.message || "Не удалось переименовать");
      }
    }, 700);
  };

  const handleRetrySave = async () => {
    await debouncedSaver.flush();
  };

  const requestClear = () => {
    if (!canEdit) return;
    setClearConfirmOpen(true);
  };

  const confirmClear = async () => {
    if (!canEdit) return;
    setClearLoading(true);
    try {
      const data = await clearInteractiveBoard(boardId, { version: versionRef.current });
      versionRef.current = data.version;
      const empty = buildScenePayload([], {}, {});
      latestSceneRef.current = empty;
      apiRef.current?.updateScene?.({ elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
      dirtyRef.current = false;
      setSaveStatus("saved");
      setConflict(false);
      setClearConfirmOpen(false);
      showNotice("Доска очищена");
    } catch (err: unknown) {
      const error = err as { code?: string; status?: number; message?: string };
      if (error?.code === "VERSION_CONFLICT" || error?.status === 409) {
        setConflict(true);
        setSaveStatus("conflict");
      } else {
        showNotice(error?.message || "Не удалось очистить");
      }
    } finally {
      setClearLoading(false);
    }
  };

  const handleSaveAsCopy = async () => {
    try {
      if (canEdit && latestSceneRef.current) {
        // Локальные изменения уйдут в копию текущего состояния через duplicate серверной версии —
        // сначала создаём копию серверной, затем патчим сцену если нужно.
      }
      const copy = await duplicateInteractiveBoard(boardId);
      if (latestSceneRef.current && canEdit) {
        try {
          await updateInteractiveBoard(copy.id, {
            scene_data: latestSceneRef.current,
            version: copy.version,
          });
        } catch {
          /* копия уже создана */
        }
      }
      showNotice("Сохранено как копия");
      navigate(`/cabinet/boards/${copy.id}`, { replace: true });
    } catch (err: unknown) {
      const error = err as { message?: string };
      showNotice(error?.message || "Не удалось создать копию");
    }
  };

  const getExportModules = async () => import("@excalidraw/excalidraw");

  const handleExportPng = async () => {
    if (!apiRef.current) return;
    const { exportToBlob } = await getExportModules();
    const blob = await exportToBlob({
      elements: apiRef.current.getSceneElements(),
      appState: { ...apiRef.current.getAppState(), exportBackground: true },
      files: apiRef.current.getFiles(),
      mimeType: "image/png",
    });
    downloadBlob(blob, slugDownloadName(title, "png"));
    setExportOpen(false);
  };

  const handleExportSvg = async () => {
    if (!apiRef.current) return;
    const { exportToSvg } = await getExportModules();
    const svg = await exportToSvg({
      elements: apiRef.current.getSceneElements(),
      appState: { ...apiRef.current.getAppState(), exportBackground: true },
      files: apiRef.current.getFiles(),
    });
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
    downloadBlob(blob, slugDownloadName(title, "svg"));
    setExportOpen(false);
  };

  const handleExportExcalidraw = async () => {
    if (!apiRef.current) return;
    const { serializeAsJSON } = await getExportModules();
    const json = serializeAsJSON(
      apiRef.current.getSceneElements(),
      apiRef.current.getAppState(),
      apiRef.current.getFiles(),
      "local",
    );
    downloadBlob(new Blob([json], { type: "application/json" }), slugDownloadName(title, "excalidraw"));
    setExportOpen(false);
  };

  const handleCopyImage = async () => {
    if (!apiRef.current) return;
    const { exportToBlob } = await getExportModules();
    const blob = await exportToBlob({
      elements: apiRef.current.getSceneElements(),
      appState: { ...apiRef.current.getAppState(), exportBackground: true },
      files: apiRef.current.getFiles(),
      mimeType: "image/png",
    });
    const ok = await copyBlobToClipboard(blob);
    showNotice(ok ? "Изображение скопировано" : "Буфер обмена недоступен в этом браузере");
    setExportOpen(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      showNotice("Полноэкранный режим недоступен");
    }
  };

  const handleImageUpload = async (
    files: File[],
  ): Promise<{ dataURL: string; id: string; mimeType: string } | null> => {
    const file = files?.[0];
    if (!file || !boardId) return null;
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      showNotice("Допустимы форматы PNG, JPEG и WebP");
      return null;
    }
    if (file.size > 5 * 1024 * 1024) {
      showNotice("Изображение слишком большое (макс. 5 МБ)");
      return null;
    }
    try {
      const form = new FormData();
      form.append("file", file);
      const uploaded = await uploadInteractiveBoardImage(boardId, form);
      return {
        id: uploaded.id,
        dataURL: uploaded.dataURL || uploaded.url,
        mimeType: uploaded.mimeType || file.type,
      };
    } catch (err: unknown) {
      const error = err as { message?: string };
      showNotice(error?.message || "Не удалось загрузить изображение");
      return null;
    }
  };

  if (loading || loadPhase === "loading_scene" || loadPhase === "loading_files") {
    return (
      <div className="cb-board-editor" aria-busy="true">
        <div className="cb-board-editor__skeleton">
          <p>{phaseLabel(loadPhase)}</p>
          <p className="cb-board-editor__skeleton-hint">Изображения подготавливаются до открытия холста</p>
        </div>
      </div>
    );
  }

  if (loadError || loadPhase === "error" || !board || !initialData) {
    return (
      <div className="cb-board-editor">
        <div className="cb-board-editor__top">
          <Link to="/cabinet/boards" className="cb-board-editor__back" aria-label="Назад">
            <CabinetIcon name="arrowLeft" />
          </Link>
        </div>
        <div className="cb-board-editor__skeleton">
          <div>
            <p>{loadError || "Доска не найдена"}</p>
            {loadErrorCode ? (
              <p className="cb-board-editor__skeleton-hint">Код: {loadErrorCode}</p>
            ) : null}
            <div className="cb-board-editor__banner-actions" style={{ marginTop: 12 }}>
              <button type="button" className="cb-btn cb-btn--primary" onClick={retryBoardLoad}>
                Повторить загрузку
              </button>
              <Link to="/cabinet/boards" className="cb-btn">К списку досок</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const statusLabel = saveStatusLabel(saveStatus);
  const statusClass = [
    "cb-board-editor__status",
    saveStatus === "error" || saveStatus === "conflict" ? `cb-board-editor__status--${saveStatus}` : "",
  ].filter(Boolean).join(" ");

  const allowExport = board.can_export !== undefined
    ? Boolean(board.can_export)
    : board.allow_export !== false || canManage;

  const collabParticipants = (() => {
    if (!collaborative) return [] as Array<{ key: string; name: string; initials: string; color: string }>;
    const selfName =
      (canManage ? board.owner_name : board.student_name)
      || (canManage ? "Учитель" : "Ученик");
    const byKey = new Map<string, string>();
    byKey.set("self", selfName);
    if (collabPeers.length > 0) {
      for (const peer of collabPeers) {
        const name = peer.displayName || "Участник";
        if (name === selfName) continue;
        byKey.set(peer.clientId, name);
      }
    } else {
      const other = canManage ? board.student_name : board.owner_name;
      if (other && other !== selfName) byKey.set("other", other);
    }
    return Array.from(byKey.entries()).map(([key, name]) => ({
      key,
      name,
      initials: participantInitials(name),
      color: avatarColor(name),
    }));
  })();

  const collabTitle = collabParticipants.length
    ? `На доске: ${collabParticipants.map((p) => p.name).join(", ")}`
    : "Совместное редактирование";

  const editorClassName = [
    "cb-board-editor",
    burgerOpen ? "cb-board-editor--burger" : "",
    hasSelection ? "cb-board-editor--selection" : "",
    boardTheme === "dark" ? "cb-board-editor--dark" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={editorClassName} ref={editorRootRef}>
      {notice ? <div className="cb-soon-toast" role="status">{notice}</div> : null}

      {conflict ? (
        <div className="cb-board-editor__banner" role="alert">
          <span>
            Доска была изменена в другом окне. Обновите страницу или сохраните свою версию как копию.
          </span>
          <div className="cb-board-editor__banner-actions">
            <button type="button" className="cb-board-editor__btn" onClick={() => window.location.reload()}>
              Обновить
            </button>
            <button type="button" className="cb-board-editor__btn cb-board-editor__btn--primary" onClick={handleSaveAsCopy}>
              Сохранить как копию
            </button>
          </div>
        </div>
      ) : null}

      <header className="cb-board-editor__top">
        <div className="cb-board-editor__left">
          <button
            type="button"
            className="cb-board-editor__back"
            aria-label="Назад"
            onClick={async () => {
              if (dirtyRef.current && canEdit && !conflict) {
                await debouncedSaver.flush();
              }
              navigate("/cabinet/boards");
            }}
          >
            <CabinetIcon name="arrowLeft" />
          </button>
          <input
            className="cb-board-editor__title"
            value={title}
            onChange={handleTitleChange}
            disabled={!canManage}
            aria-label="Название доски"
          />
          {statusLabel ? <span className={statusClass}>{statusLabel}</span> : null}
          {collaborative && collabParticipants.length > 0 ? (
            <div
              className={[
                "cb-board-editor__avatars",
                collabStatus === "open" ? "cb-board-editor__avatars--live" : "",
              ].filter(Boolean).join(" ")}
              title={collabTitle}
              aria-label={collabTitle}
            >
              {collabParticipants.map((person) => (
                <span
                  key={person.key}
                  className="cb-board-editor__avatar"
                  style={{ backgroundColor: person.color }}
                  title={person.name}
                >
                  {person.initials}
                </span>
              ))}
            </div>
          ) : null}
          {saveStatus === "error" ? (
            <button type="button" className="cb-board-editor__btn" onClick={handleRetrySave}>
              Повторить
            </button>
          ) : null}
        </div>

        <div className="cb-board-editor__right">
          {allowExport ? (
            <div className="cb-board-editor__menu">
              <button
                type="button"
                className="cb-board-editor__action"
                onClick={() => { setExportOpen((v) => !v); setMoreOpen(false); }}
              >
                <CabinetIcon name="export" />
                <span>Экспорт</span>
              </button>
              {exportOpen ? (
                <div className="cb-board-editor__menu-panel" role="menu">
                  <button type="button" onClick={handleExportPng}>Скачать PNG</button>
                  <button type="button" onClick={handleExportSvg}>Скачать SVG</button>
                  <button type="button" onClick={handleExportExcalidraw}>Скачать .excalidraw</button>
                  <button type="button" onClick={handleCopyImage}>Копировать изображение</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {canManage ? (
            <button
              type="button"
              className="cb-board-editor__action cb-board-editor__desktop-only"
              onClick={() => setAccessOpen(true)}
            >
              <CabinetIcon name="settings" />
              <span>Настройки доступа</span>
            </button>
          ) : null}

          <button
            type="button"
            className="cb-board-editor__action"
            onClick={toggleFullscreen}
            aria-label="Полный экран"
          >
            <CabinetIcon name="expand" />
            <span className="cb-board-editor__desktop-only">Полный экран</span>
          </button>

          {canEdit ? (
            <>
              <span className="cb-board-editor__sep cb-board-editor__desktop-only" aria-hidden="true" />
              <button
                type="button"
                className="cb-board-editor__action cb-board-editor__action--danger cb-board-editor__desktop-only"
                onClick={requestClear}
                aria-label="Очистить доску"
                title="Очистить доску"
              >
                <CabinetIcon name="trash" />
              </button>
            </>
          ) : null}

          <div className="cb-board-editor__menu cb-board-editor__mobile-only">
            <button
              type="button"
              className="cb-board-editor__action"
              onClick={() => { setMoreOpen((v) => !v); setExportOpen(false); }}
            >
              <span>Ещё</span>
            </button>
            {moreOpen ? (
              <div className="cb-board-editor__menu-panel" role="menu">
                {canEdit ? <button type="button" onClick={() => { setMoreOpen(false); requestClear(); }}>Очистить доску</button> : null}
                {canManage ? <button type="button" onClick={() => { setMoreOpen(false); setAccessOpen(true); }}>Настройки доступа</button> : null}
                <button type="button" onClick={() => { setMoreOpen(false); void handleSaveAsCopy(); }}>Создать копию</button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="cb-board-editor__canvas">
        {!excalidrawReady ? (
          <div className="cb-board-editor__skeleton">Загрузка редактора…</div>
        ) : null}

        {/* Панель настроек холста — взаимоисключаема с SelectedShapeActions */}
        <div className="cb-board-burger">
          <button
            type="button"
            className="cb-board-burger__btn"
            aria-label="Настройки холста"
            aria-expanded={burgerOpen}
            onClick={() => {
              setExportOpen(false);
              setMoreOpen(false);
              if (hadSelectionRef.current) {
                clearSelectionAndOpenCanvasPanel();
                return;
              }
              setBurgerOpen((v) => !v);
            }}
          >
            <span className="cb-board-burger__icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          {burgerOpen ? (
            <div className="cb-board-burger__panel" role="menu">
              <p className="cb-board-burger__label">Тема</p>
              <div className="cb-board-burger__row">
                <button
                  type="button"
                  className={boardTheme === "light" ? "is-active" : ""}
                  onClick={() => applyTheme("light")}
                >
                  Светлая
                </button>
                <button
                  type="button"
                  className={boardTheme === "dark" ? "is-active" : ""}
                  onClick={() => applyTheme("dark")}
                >
                  Тёмная
                </button>
              </div>
              <p className="cb-board-burger__label">Бумага</p>
              <div className="cb-board-burger__row cb-board-burger__row--wrap">
                <button
                  type="button"
                  className={gridStyle === "none" ? "is-active" : ""}
                  onClick={() => applyGridStyle("none")}
                >
                  Чистая
                </button>
                <button
                  type="button"
                  className={gridStyle === "cells" ? "is-active" : ""}
                  onClick={() => applyGridStyle("cells")}
                >
                  Клетки
                </button>
                <button
                  type="button"
                  className={gridStyle === "ruled" ? "is-active" : ""}
                  onClick={() => applyGridStyle("ruled")}
                >
                  Линии
                </button>
                <button
                  type="button"
                  className={gridStyle === "dots" ? "is-active" : ""}
                  onClick={() => applyGridStyle("dots")}
                >
                  Точки
                </button>
              </div>
              {canEdit ? (
                <>
                  <p className="cb-board-burger__label">Цвет фона</p>
                  <label className="cb-board-burger__color">
                    <input
                      type="color"
                      value={bgColor === "transparent" ? "#ffffff" : bgColor}
                      onChange={(e) => applyBackground(e.target.value)}
                    />
                    <span>{bgColor === "transparent" ? "#ffffff" : bgColor}</span>
                  </label>
                </>
              ) : null}
              <button
                type="button"
                className="cb-board-burger__item"
                onClick={() => {
                  showNotice("Отмена: Ctrl+Z · Повтор: Ctrl+Shift+Z · Удалить: Delete · Рука: пробел");
                }}
              >
                Горячие клавиши
              </button>
              {canEdit ? (
                <button
                  type="button"
                  className="cb-board-burger__item cb-board-burger__item--danger"
                  onClick={() => {
                    requestClear();
                  }}
                >
                  Очистить доску
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          className="cb-board-paper"
          style={{ backgroundColor: bgColor === "transparent" ? "#ffffff" : bgColor }}
          aria-hidden="true"
        >
          {usesPaperOverlay(gridStyle) ? (
            <div
              ref={paperOverlayRef}
              className={`cb-board-paper__pattern cb-board-paper__pattern--${gridStyle}`}
            />
          ) : null}
        </div>

        <BoardExcalidrawCanvas
          key={`${boardId}:${reloadToken}`}
          initialElements={initialData.elements}
          initialAppState={initialData.appState}
          initialFiles={initialData.files}
          viewModeEnabled={viewModeEnabled}
          onChange={handleChange}
          onApiReady={handleApiReady}
          onHostReady={handleHostReady}
          onPointerSceneMove={handlePointerSceneMove}
          onPointerSceneUp={handlePointerSceneUp}
          generateIdForFile={generateIdForFile}
        />
      </div>

      {loadPhase === "reconnecting" ? (
        <div className="cb-soon-toast" role="status">Восстанавливаем соединение…</div>
      ) : null}
      {missingImageCount > 0 && hostReady ? (
        <div className="cb-soon-toast" role="status">
          Часть изображений недоступна ({missingImageCount}).
          {" "}
          <button type="button" className="cb-board-editor__linkbtn" onClick={retryBoardLoad}>
            Повторить загрузку
          </button>
        </div>
      ) : null}
      {imageUploadStatus === "uploading" ? (
        <div className="cb-soon-toast" role="status">Загрузка изображения…</div>
      ) : null}
      {imageUploadStatus === "error" ? (
        <div className="cb-soon-toast" role="status">Ошибка загрузки изображения. Повторите вставку.</div>
      ) : null}

      {/* Скрытый input для программной загрузки — Excalidraw имеет свой UI; серверная загрузка через API при необходимости */}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        aria-hidden="true"
        onChange={async (e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          await handleImageUpload(list);
          e.target.value = "";
        }}
      />

      {accessOpen ? (
        <BoardAccessModal
          boardId={boardId}
          allowExport={board.allow_export !== false}
          onClose={() => setAccessOpen(false)}
          onSaved={(data: { allow_export?: boolean }) => {
            setBoard((prev) => (prev ? { ...prev, allow_export: data.allow_export } : prev));
            showNotice("Доступ обновлён");
          }}
        />
      ) : null}

      <ConfirmActionModal
        open={clearConfirmOpen}
        title="Очистить доску?"
        text="Очистить доску? Это действие нельзя отменить."
        confirmLabel="Очистить"
        danger
        loading={clearLoading}
        onClose={() => {
          if (!clearLoading) setClearConfirmOpen(false);
        }}
        onConfirm={() => {
          void confirmClear();
        }}
      />
    </div>
  );
}
