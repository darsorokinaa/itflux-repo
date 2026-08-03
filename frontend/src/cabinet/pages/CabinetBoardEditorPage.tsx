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
  attachStableUrls,
  createStableUrlMap,
  externalizeSceneFiles,
  filesForPersist,
  filesNeedRemoteHydrate,
  findMissingImageFileIds,
  hydrateBoardFiles,
  isTransientFileUrl,
  markImageElementsSaved,
  pendingUploadFileIds,
  rememberStableUrls,
  revokeBoardBlobUrls,
  stableUrlOf,
  STABLE_URL_KEY,
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
  type BoardSceneOpsPayload,
  type CollabPeer,
  type CollabScene,
  type RemoteCursor,
} from "../boards/boardCollab";
import { applyBoardOps, coalesceBoardOps, type BoardElementOp } from "../boards/boardOps";
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
  addFiles?: (files: unknown[]) => void;
  resetScene?: () => void;
};

/** Dev-only диагностика синка доски. Не пишет содержимое dataURL/base64. */
const BOARD_DEBUG = Boolean(import.meta.env?.DEV);
function boardLog(tag: string, data?: Record<string, unknown>) {
  if (!BOARD_DEBUG) return;
  // Строкой, а не вторым аргументом console.debug: при копировании текста
  // консоли (не разворачивая объект вручную) второй аргумент печатается как
  // нераскрытое "Object" — реальные данные не видны в скопированном логе.
  let json = "";
  try {
    json = data ? JSON.stringify(data) : "";
  } catch {
    json = "[unserializable]";
  }
  // eslint-disable-next-line no-console
  console.debug(`[board] ${tag} ${json}`);
}

/**
 * Excalidraw.updateScene() игнорирует ключ `files` — сцена (`sceneData`)
 * принимает только elements/appState/collaborators/captureUpdate. Файлы
 * регистрируются только через отдельный imperative-метод addFiles(). Без
 * этого шага картинки, добавленные удалённо, не появляются на холсте пира
 * вообще (а не «с задержкой») — element типа image рендерится, но данных
 * файла в состоянии Excalidraw нет.
 *
 * addFiles() молча игнорирует id, который уже зарегистрирован (docs: "if
 * file already exists in editor state, the file data is not updated"). Со
 * стороны сети файлы всегда приходят как «сырой» стабильный URL
 * (filesForLivePublish вырезает blob:/data:), а не сразу рисуемый blob —
 * его ещё нужно догрузить (hydrateBoardFiles). Если зарегистрировать id
 * сразу с сырым URL, а не дождаться blob, то более поздний addFiles() с
 * рабочим blob для того же id будет просто отброшен — картинка так и
 * останется невидимой до перезахода. Поэтому сюда должны попадать только
 * уже пригодные для рендера файлы (blob:/data:); для остальных единственная
 * регистрация — из ветки, которая применяется ПОСЛЕ hydrateBoardFiles.
 */
function urlKind(url: unknown): string {
  const s = typeof url === "string" ? url : "";
  if (s.startsWith("blob:")) return "blob";
  if (s.startsWith("data:")) return "data";
  if (s) return "stable";
  return "missing";
}

function toBinaryFileDataList(files: Record<string, unknown> | null | undefined, source = ""): unknown[] {
  const out: unknown[] = [];
  const deferred: string[] = [];
  for (const [id, raw] of Object.entries(files || {})) {
    if (!raw || typeof raw !== "object") continue;
    const meta = raw as Record<string, unknown>;
    const dataURL = meta.dataURL || meta.url;
    if (!dataURL || typeof dataURL !== "string") continue;
    if (!dataURL.startsWith("blob:") && !dataURL.startsWith("data:")) {
      deferred.push(id);
      continue;
    }
    const now = Date.now();
    out.push({
      id: meta.id || id,
      dataURL,
      mimeType: meta.mimeType || "image/png",
      created: typeof meta.created === "number" ? meta.created : now,
      lastRetrieved: typeof meta.lastRetrieved === "number" ? meta.lastRetrieved : now,
    });
  }
  if (BOARD_DEBUG && (out.length || deferred.length)) {
    boardLog(`addFiles:${source}`, {
      registering: out.map((f) => (f as { id: string }).id),
      deferredUntilHydrate: deferred,
    });
  }
  return out;
}

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
  const filesList = toBinaryFileDataList(scene.files, "applyRemoteScene");
  if (filesList.length) api.addFiles?.(filesList);
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
  /**
   * true между pointerdown и pointerup на холсте. Excalidraw теряет активный
   * жест (штрих обрывается до одной точки), если во время рисования прилетает
   * наш собственный updateScene() из применения удалённой сцены/ops — поэтому
   * такие применения на время жеста откладываются, а не выполняются сразу.
   */
  const isDrawingGestureRef = useRef(false);
  const pendingRemoteOpsQueueRef = useRef<Array<{ ops: BoardSceneOpsPayload; meta: { version?: number } }>>([]);
  const pendingRemoteSceneRef = useRef<{ scene: CollabScene; meta: { fromSaved?: boolean; version?: number; cleared?: boolean } } | null>(null);
  const pendingResyncRef = useRef(false);
  /** Файлы, догруженные во время локального жеста — применяем на pointerup, не revoke. */
  const pendingHydrateFilesRef = useRef<Record<string, unknown> | null>(null);
  const gestureEndBoundRef = useRef<(() => void) | null>(null);
  const flushPendingRemoteAppliesRef = useRef<() => void>(() => {});
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
  /** Постоянные API URL вне Excalidraw — BinaryFileData не сохраняет itfluxStableURL. */
  const stableFileUrlsRef = useRef(createStableUrlMap());
  /** fileId, успешно загруженные/восстановленные в этой сессии — без повторного upload. */
  const loadedFilesRef = useRef(new Set<string>());
  const loadingRemoteFilesRef = useRef(new Set<string>());
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
    // Прикрепляем стабильные URL из registry — onChange мог отдать только blob:.
    const filesWithStable = attachStableUrls(
      scene.files as Record<string, Record<string, unknown>>,
      stableFileUrlsRef.current,
    );
    const snapshot: BoardScenePayload = {
      elements: Array.isArray(scene.elements) ? [...scene.elements] : [],
      appState: { ...(scene.appState || {}) },
      files: filesWithStable,
    };

    safeSetSaveStatus("saving");
    try {
      const preUploadFiles = filesForPersist(snapshot.files as Record<string, Record<string, unknown>>) as Record<string, Record<string, unknown>>;
      boardLog("persist:before", {
        version: versionAtSave,
        elementCount: snapshot.elements.length,
        files: Object.fromEntries(
          Object.entries(preUploadFiles).map(([id, meta]) => [id, urlKind(meta?.dataURL || meta?.url)]),
        ),
      });
      const files = await externalizeSceneFiles(
        preUploadFiles,
        (form) => uploadInteractiveBoardImage(boardIdAtSave, form),
      );
      rememberStableUrls(stableFileUrlsRef.current, files);
      for (const id of Object.keys(files)) loadedFilesRef.current.add(id);
      // Смена доски — бросаем. Размонтирование — всё равно сохраняем снимок.
      if (boardIdRef.current !== boardIdAtSave) return;

      const persistFiles = filesForPersist(
        attachStableUrls(files, stableFileUrlsRef.current),
      ) as Record<string, unknown>;

      // Подмешиваем только стабильные URL файлов — не затираем более новые elements.
      if (latestSceneRef.current && boardIdRef.current === boardIdAtSave) {
        const mergedDisplay = attachStableUrls(
          { ...latestSceneRef.current.files, ...files } as Record<string, Record<string, unknown>>,
          stableFileUrlsRef.current,
        );
        latestSceneRef.current = {
          ...latestSceneRef.current,
          files: mergedDisplay,
        };
      }

      const payload: BoardScenePayload = { ...snapshot, files: persistFiles };
      boardLog("persist:sending", {
        files: Object.fromEntries(
          Object.entries(persistFiles).map(([id, meta]) => {
            const m = meta as Record<string, unknown>;
            return [id, urlKind(m?.dataURL || m?.url)];
          }),
        ),
      });
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
              clearApplyingRemoteSoon();
            }
            latestSceneRef.current = buildScenePayload(merged.elements, merged.appState, merged.files);
            lastElementsRef.current = merged.elements;
            lastFilesRef.current = merged.files;
            // Новые картинки из серверной сцены (например, добавил пир, пока
            // мы не успели сохранить) ещё не blob — не блокируем merge, но
            // догружаем их так же, как для scene_saved/resync.
            if (filesNeedRemoteHydrate(
              merged.files as Record<string, Record<string, unknown>>,
              localFiles as Record<string, Record<string, unknown>>,
            )) {
              void hydrateBoardFiles(merged.files as Record<string, Record<string, unknown>>).then((hydrated) => {
                boardLog("hydrate:conflictMerge", {
                  ok: hydrated.blobUrls.length,
                  missing: hydrated.missingFileIds,
                  failed: hydrated.failedFileIds,
                });
                if (boardIdRef.current !== boardIdAtSave || !apiRef.current) {
                  revokeBoardBlobUrls(hydrated.blobUrls);
                  return;
                }
                hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
                // За время await hydrateBoardFiles на канвас мог прилететь более
                // свежий апдейт — пересливаем поверх текущего состояния, а не
                // поверх merged, снятого до await.
                const freshLocal = getLocalElementsForMerge(apiRef.current, latestSceneRef.current?.elements);
                const freshApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
                const freshFiles = (apiRef.current.getFiles?.() || {}) as Record<string, unknown>;
                const reMerged = mergeCollabScenes(
                  { elements: freshLocal, appState: freshApp, files: freshFiles },
                  { elements: merged.elements, appState: merged.appState, files: hydrated.files },
                );
                applyingRemoteRef.current = true;
                applyRemoteSceneToApi(apiRef.current, reMerged);
                clearApplyingRemoteSoon();
                const mergedFiles = { ...freshFiles, ...reMerged.files };
                latestSceneRef.current = buildScenePayload(reMerged.elements, reMerged.appState, mergedFiles);
                lastElementsRef.current = reMerged.elements;
                lastFilesRef.current = mergedFiles;
              });
            }
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

  // persistScene пересоздаётся при каждом изменении conflict/canEdit/... (а conflict
  // переключается прямо внутри обработки 409 несколько раз за один цикл). Если
  // debouncedSaver зависел бы от persistScene, каждое такое пересоздание рождало бы
  // новый singleflight-домен (inFlight/timer сбрасывались бы в исходное состояние) —
  // старый и новый saver переставали делить между собой "идёт ли уже запрос", и
  // ретраи после конфликта версий могли уйти параллельно тому запросу, что ещё не
  // завершился. Результат наблюдался как шквал повторяющихся 409 подряд и риск
  // того, что более старый (и потому неполный) снимок сцены перезапишет в БД уже
  // сохранённый более новый — например, без только что добавленной картинки.
  // Поэтому debouncedSaver создаётся один раз на весь жизненный цикл компонента,
  // а актуальную persistScene читает через ref.
  const persistSceneRef = useRef(persistScene);
  persistSceneRef.current = persistScene;
  const debouncedSaver = useMemo(
    () => createDebouncedSaver(() => persistSceneRef.current(), AUTOSAVE_DEBOUNCE_MS),
    [],
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
      if (gestureEndBoundRef.current) {
        window.removeEventListener("pointerup", gestureEndBoundRef.current);
        window.removeEventListener("pointercancel", gestureEndBoundRef.current);
        gestureEndBoundRef.current = null;
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
    stableFileUrlsRef.current = createStableUrlMap();
    loadedFilesRef.current = new Set();
    loadingRemoteFilesRef.current = new Set();
    uploadingFileIdsRef.current = new Set();
    imageUploadStatusRef.current = "idle";
    setImageUploadStatus("idle");
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
        rememberStableUrls(stableFileUrlsRef.current, rawFiles);
        rememberStableUrls(stableFileUrlsRef.current, hydrated.files);
        for (const id of Object.keys(hydrated.files)) {
          if (stableFileUrlsRef.current.has(id)) loadedFilesRef.current.add(id);
        }
        const orphanIds = findMissingImageFileIds(elements, hydrated.files);
        boardLog("hydrate:initialLoad", {
          fileCount: Object.keys(hydrated.files).length,
          ok: hydrated.blobUrls.length,
          missing: hydrated.missingFileIds,
          failed: hydrated.failedFileIds,
          orphanImageElements: orphanIds,
          registrySize: stableFileUrlsRef.current.size,
        });
        setMissingImageCount(hydrated.failedFileIds.length + orphanIds.length + hydrated.missingFileIds.length);

        const filesReady = attachStableUrls(hydrated.files, stableFileUrlsRef.current);
        // Snapshot мог сохранить pending — после hydrate считаем изображения saved.
        const elementsReady = markImageElementsSaved(
          elements,
          Object.keys(filesReady).filter((id) => loadedFilesRef.current.has(id)),
        );
        const scene = buildScenePayload(
          elementsReady,
          { ...rawApp, ...gridAppStatePatch(style, solidBg), theme },
          filesReady,
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
    const files = attachStableUrls(
      (scene.files || {}) as Record<string, Record<string, unknown>>,
      stableFileUrlsRef.current,
    );
    collabRef.current?.publishLive(
      {
        elements: scene.elements as unknown[],
        appState: scene.appState,
        files,
      },
      versionRef.current,
    );
  }, []);

  const externalizeAndSyncFiles = useCallback(async (scene: BoardScenePayload) => {
    if (!boardId || !apiRef.current) return scene;
    const files = attachStableUrls(
      (scene.files || {}) as Record<string, Record<string, unknown>>,
      stableFileUrlsRef.current,
    );
    const pendingIds = pendingUploadFileIds(
      files,
      stableFileUrlsRef.current,
      uploadingFileIdsRef.current,
    ).filter((id) => !loadedFilesRef.current.has(id));
    if (!pendingIds.length) {
      boardLog("upload:skip", {
        reason: "already_stable_or_in_flight",
        fileIds: Object.keys(files),
        registrySize: stableFileUrlsRef.current.size,
      });
      return { ...scene, files };
    }
    pendingIds.forEach((id) => uploadingFileIdsRef.current.add(id));
    imageUploadStatusRef.current = "uploading";
    setImageUploadStatus("uploading");
    boardLog("upload:start", {
      ids: pendingIds,
      mime: pendingIds.map((id) => String(files[id]?.mimeType || "")),
    });
    try {
      const onlyPending = Object.fromEntries(
        pendingIds.map((id) => [id, files[id]]).filter(([, m]) => m),
      ) as Record<string, Record<string, unknown>>;
      const nextFiles = await externalizeSceneFiles(onlyPending, (form) =>
        uploadInteractiveBoardImage(boardId, form),
      );
      rememberStableUrls(stableFileUrlsRef.current, nextFiles);
      for (const id of pendingIds) {
        if (stableFileUrlsRef.current.has(id)) loadedFilesRef.current.add(id);
      }
      boardLog("upload:done", {
        ids: pendingIds,
        urls: Object.fromEntries(
          pendingIds.map((id) => [id, stableFileUrlsRef.current.get(id) || ""]),
        ),
      });
      // Локально оставляем уже отрисованный blob Excalidraw; в registry — API URL.
      // Перегидратация API→blob после собственного аплоада опасна: addFiles
      // игнорирует существующий id, а при ошибке fetch подставлялся 1×1 placeholder.
      const displayFiles = attachStableUrls(
        { ...files, ...nextFiles },
        stableFileUrlsRef.current,
      );
      // Для отображения предпочитаем исходный blob/data, если он ещё жив.
      for (const id of pendingIds) {
        const prev = files[id];
        const next = displayFiles[id];
        if (!prev || !next) continue;
        const prevUrl = String(prev.dataURL || prev.url || "");
        if (prevUrl.startsWith("blob:") || prevUrl.startsWith("data:")) {
          displayFiles[id] = {
            ...next,
            dataURL: prevUrl,
            url: prevUrl,
            [STABLE_URL_KEY]: stableFileUrlsRef.current.get(id) || stableUrlOf(next),
          };
        }
      }
      pendingIds.forEach((id) => uploadingFileIdsRef.current.delete(id));
      if (!mountedRef.current || boardIdRef.current !== boardId) return scene;

      const baseElements = (latestSceneRef.current?.elements || scene.elements || []) as unknown[];
      const savedElements = markImageElementsSaved(baseElements, pendingIds);
      applyingRemoteRef.current = true;
      // Файл уже в Excalidraw (локальный blob). Добавляем только если вдруг нет.
      const apiFiles = (apiRef.current.getFiles?.() || {}) as Record<string, unknown>;
      const missingForApi = pendingIds.filter((id) => !apiFiles[id]);
      if (missingForApi.length) {
        const toAdd = Object.fromEntries(missingForApi.map((id) => [id, displayFiles[id]]));
        apiRef.current.addFiles?.(toBinaryFileDataList(toAdd, "ownUpload"));
      }
      apiRef.current.updateScene?.({
        elements: savedElements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      const publishFiles = attachStableUrls(displayFiles, stableFileUrlsRef.current);
      latestSceneRef.current = buildScenePayload(
        savedElements,
        latestSceneRef.current?.appState || scene.appState,
        publishFiles,
      );
      lastElementsRef.current = savedElements;
      lastFilesRef.current = publishFiles;
      clearApplyingRemoteSoon();
      imageUploadStatusRef.current = "idle";
      setImageUploadStatus("idle");

      const publishScene = latestSceneRef.current;
      boardLog("upload:publish", {
        elementCount: publishScene.elements.length,
        imageIds: pendingIds,
        fileIds: Object.keys(filesForPersist(publishFiles)),
        statuses: pendingIds.map((id) => {
          const el = savedElements.find(
            (raw) => raw && typeof raw === "object" && (raw as { fileId?: string }).fileId === id,
          ) as { status?: string; id?: string } | undefined;
          return { fileId: id, elementId: el?.id, status: el?.status };
        }),
      });
      // Явное file_add + обычный live: пир сначала получит файл, затем элемент.
      collabRef.current?.publishFileAdd(
        pendingIds.map((id) => ({
          id,
          url: stableFileUrlsRef.current.get(id) || "",
          mimeType: String(publishFiles[id]?.mimeType || "image/png"),
          created: Number(publishFiles[id]?.created) || Date.now(),
        })),
        savedElements.filter((raw) => {
          const el = raw as { type?: string; fileId?: string; isDeleted?: boolean };
          return el.type === "image" && !!el.fileId && pendingIds.includes(el.fileId) && !el.isDeleted;
        }),
      );
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
      boardLog("upload:error", { ids: pendingIds, message: error?.message || "unknown" });
      showNotice(error?.message || "Не удалось загрузить изображение на доску");
      // Не публикуем blob:/data: пирам — только локальный предпросмотр. Элемент не удаляем.
      return scene;
    }
  }, [boardId, debouncedSaver, markLocalSceneChange, publishLiveScene, safeSetSaveStatus, showNotice]);

  viewerUserIdRef.current = board?.viewer_user_id ?? null;
  viewerRoleRef.current = board?.viewer_role || (canManage ? "teacher" : "student");
  canManageRefLocal.current = canManage;

  const clearApplyingRemoteSoon = useCallback(() => {
    // Снимаем флаг ПОСЛЕ следующего кадра, не на микротаске: onChange от
    // updateScene у Excalidraw не гарантированно синхронный (иногда уходит
    // за пределы текущего таска). При микротаске флаг снимался раньше, чем
    // реально прилетал echo-onChange от applyMerged — тот проходил как
    // «настоящее» локальное изменение, запускал autosave, сервер рассылал
    // новый scene_saved, applyMerged срабатывал снова — самоподдерживающийся
    // цикл автосохранений примерно раз в секунду даже без единого действия
    // пользователя (наблюдалось: version доски росла без остановки).
    requestAnimationFrame(() => {
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

      // Excalidraw onChange отдаёт BinaryFileData без itfluxStableURL — возвращаем из registry.
      const filesAttached = attachStableUrls(
        files as Record<string, Record<string, unknown>>,
        stableFileUrlsRef.current,
      );
      const scene = buildScenePayload(nextElements, appState, filesAttached);
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
      lastFilesRef.current = filesAttached;
      markLocalSceneChange();
      safeSetSaveStatus((s) => (s === "dirty" || s === "saving" ? s : "dirty"));
      debouncedSaver.schedule();
      const pendingFileIds = new Set(
        pendingUploadFileIds(
          filesAttached,
          stableFileUrlsRef.current,
          uploadingFileIdsRef.current,
        ).filter((id) => !loadedFilesRef.current.has(id)),
      );
      if (pendingFileIds.size) {
        void externalizeAndSyncFiles(scene);
      }
      // Публикуем сразу, не дожидаясь аплоада картинок — иначе один медленный
      // upload блокирует live-синк остальных правок. Элементы-картинки с ещё
      // не загруженным файлом временно вырезаем: их отправит externalizeAndSyncFiles
      // вместе с готовым файлом, чтобы у пиров не было «сироты» без данных.
      const liveElements = pendingFileIds.size
        ? nextElements.filter((raw) => {
            const el = raw as { type?: string; fileId?: string };
            return !(el.type === "image" && el.fileId && pendingFileIds.has(el.fileId));
          })
        : nextElements;
      publishLiveScene(
        liveElements.length === nextElements.length ? scene : { ...scene, elements: liveElements },
      );
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
      // Во время активного локального жеста (рисуем) не трогаем сцену вообще —
      // даже безобидный updateScene(collaborators) сбивает Excalidraw с толку
      // и штрих обрывается до одной точки. Курсор пира на долю секунды
      // отстанет — не страшно, следующий тик догонит.
      if (isDrawingGestureRef.current) return;
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

    const handleRemoteOpsNow = (ops: BoardSceneOpsPayload, meta: { version?: number }) => {
      if (!apiRef.current || boardIdRef.current !== boardId) return;
      rememberStableUrls(
        stableFileUrlsRef.current,
        ops.files as Record<string, Record<string, unknown>>,
      );
      const localElements = getLocalElementsForMerge(
        apiRef.current,
        latestSceneRef.current?.elements,
      );
      const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
      const localFiles = attachStableUrls(
        (apiRef.current.getFiles?.() || latestSceneRef.current?.files || {}) as Record<string, Record<string, unknown>>,
        stableFileUrlsRef.current,
      );
      const applied = applyBoardOps(
        { elements: localElements, appState: localApp, files: localFiles },
        ops,
      );
      const paintFiles = attachStableUrls(
        { ...localFiles, ...(applied.files || {}) } as Record<string, Record<string, unknown>>,
        stableFileUrlsRef.current,
      );
      const imageUpserts = (ops.ops || []).some((op) => {
        if (op.op !== "upsert" || !op.element) return false;
        return (op.element as { type?: string }).type === "image";
      });
      const needsHydrate = filesNeedRemoteHydrate(
        applied.files as Record<string, Record<string, unknown>>,
        localFiles,
      );

      const paintNow = (displayFiles: Record<string, unknown>, elements = applied.elements) => {
        if (!apiRef.current || boardIdRef.current !== boardId) return;
        const attached = attachStableUrls(
          displayFiles as Record<string, Record<string, unknown>>,
          stableFileUrlsRef.current,
        );
        applyingRemoteRef.current = true;
        const collaborators = buildCollaboratorsMap(remoteCursorsRef.current);
        applyRemoteSceneToApi(apiRef.current, {
          elements,
          appState: { ...applied.appState, collaborators },
          files: attached,
        });
        latestSceneRef.current = buildScenePayload(elements, applied.appState, attached);
        lastElementsRef.current = elements;
        lastFilesRef.current = attached;
        if (typeof meta.version === "number" && meta.version > versionRef.current) {
          versionRef.current = meta.version;
        }
        clearApplyingRemoteSoon();
      };

      const finishHydrate = (hydratedFiles: Record<string, unknown>) => {
        rememberStableUrls(
          stableFileUrlsRef.current,
          hydratedFiles as Record<string, Record<string, unknown>>,
        );
        for (const id of Object.keys(hydratedFiles)) {
          if (stableFileUrlsRef.current.has(id)) loadedFilesRef.current.add(id);
        }
        const savedElements = markImageElementsSaved(
          applied.elements,
          Object.keys(hydratedFiles),
        );
        paintNow({ ...paintFiles, ...hydratedFiles }, savedElements);
      };

      // Image-элемент нельзя применять до addFiles — иначе вечный pending у пира.
      if (imageUpserts && needsHydrate) {
        const remoteFiles = applied.files as Record<string, Record<string, unknown>>;
        const fetchIds = Object.keys(remoteFiles || {}).filter((id) => {
          if (loadingRemoteFilesRef.current.has(id)) return false;
          const local = localFiles[id];
          if (local && typeof local === "object") {
            const localUrl = String((local as { dataURL?: string; url?: string }).dataURL
              || (local as { url?: string }).url
              || "");
            if (localUrl && isTransientFileUrl(localUrl)) return false;
          }
          return true;
        });
        fetchIds.forEach((id) => loadingRemoteFilesRef.current.add(id));
        void hydrateBoardFiles(remoteFiles).then((hydrated) => {
          fetchIds.forEach((id) => loadingRemoteFilesRef.current.delete(id));
          boardLog("hydrate:remoteOpsBeforeImage", {
            ok: hydrated.blobUrls.length,
            missing: hydrated.missingFileIds,
            failed: hydrated.failedFileIds,
          });
          if (boardIdRef.current !== boardId || !apiRef.current) {
            revokeBoardBlobUrls(hydrated.blobUrls);
            return;
          }
          hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
          if (isDrawingGestureRef.current) {
            pendingHydrateFilesRef.current = {
              ...(pendingHydrateFilesRef.current || {}),
              ...hydrated.files,
            };
            // Уже гидратированные blob в ops.files — на pointerup apply без повторного fetch.
            pendingRemoteOpsQueueRef.current.push({
              ops: { ...ops, files: { ...(ops.files || {}), ...hydrated.files } },
              meta,
            });
            return;
          }
          applyingRemoteRef.current = true;
          apiRef.current.addFiles?.(toBinaryFileDataList(hydrated.files, "remoteOpsHydrated"));
          clearApplyingRemoteSoon();
          finishHydrate(hydrated.files);
        });
        return;
      }

      paintNow(paintFiles);
      if (needsHydrate) {
        void hydrateBoardFiles(applied.files as Record<string, Record<string, unknown>>).then((hydrated) => {
          boardLog("hydrate:remoteOps", {
            ok: hydrated.blobUrls.length,
            missing: hydrated.missingFileIds,
            failed: hydrated.failedFileIds,
          });
          if (boardIdRef.current !== boardId || !apiRef.current) {
            revokeBoardBlobUrls(hydrated.blobUrls);
            return;
          }
          hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
          rememberStableUrls(stableFileUrlsRef.current, hydrated.files);
          if (isDrawingGestureRef.current) {
            pendingHydrateFilesRef.current = {
              ...(pendingHydrateFilesRef.current || {}),
              ...hydrated.files,
            };
            return;
          }
          applyingRemoteRef.current = true;
          apiRef.current.addFiles?.(toBinaryFileDataList(hydrated.files, "remoteOpsHydrated"));
          const prev = latestSceneRef.current;
          const mergedFiles = attachStableUrls(
            { ...(prev?.files || {}), ...hydrated.files } as Record<string, Record<string, unknown>>,
            stableFileUrlsRef.current,
          );
          if (prev) latestSceneRef.current = { ...prev, files: mergedFiles };
          lastFilesRef.current = mergedFiles;
          clearApplyingRemoteSoon();
        });
      }
    };

    const handleRemoteFileAddNow = (
      files: Array<{ id: string; url: string; mimeType?: string; created?: number }>,
      elements: unknown[],
    ) => {
      if (!apiRef.current || boardIdRef.current !== boardId) return;
      const asSceneFiles: Record<string, Record<string, unknown>> = {};
      for (const f of files) {
        if (!f?.id || !f?.url) continue;
        if (String(f.url).startsWith("blob:") || String(f.url).startsWith("data:")) continue;
        if (loadedFilesRef.current.has(f.id) && apiRef.current.getFiles?.()?.[f.id]) {
          stableFileUrlsRef.current.set(f.id, f.url);
          continue;
        }
        if (loadingRemoteFilesRef.current.has(f.id)) continue;
        asSceneFiles[f.id] = {
          id: f.id,
          dataURL: f.url,
          url: f.url,
          mimeType: f.mimeType || "image/png",
          created: f.created || Date.now(),
        };
        stableFileUrlsRef.current.set(f.id, f.url);
      }
      if (!Object.keys(asSceneFiles).length && !elements.length) return;

      const applyElements = (displayFiles: Record<string, unknown>) => {
        if (!apiRef.current || boardIdRef.current !== boardId) return;
        if (!elements.length) {
          const prev = latestSceneRef.current;
          const mergedFiles = attachStableUrls(
            { ...(prev?.files || {}), ...displayFiles } as Record<string, Record<string, unknown>>,
            stableFileUrlsRef.current,
          );
          if (prev) latestSceneRef.current = { ...prev, files: mergedFiles };
          lastFilesRef.current = mergedFiles;
          return;
        }
        const localElements = getLocalElementsForMerge(
          apiRef.current,
          latestSceneRef.current?.elements,
        );
        const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
        const localFiles = (latestSceneRef.current?.files || {}) as Record<string, unknown>;
        const savedRemote = markImageElementsSaved(
          elements,
          Object.keys(displayFiles),
        );
        const merged = mergeCollabScenes(
          { elements: localElements, appState: localApp, files: localFiles },
          { elements: savedRemote, appState: {}, files: displayFiles },
        );
        applyingRemoteRef.current = true;
        applyRemoteSceneToApi(apiRef.current, {
          elements: merged.elements,
          appState: { ...merged.appState, collaborators: buildCollaboratorsMap(remoteCursorsRef.current) },
          files: attachStableUrls(
            merged.files as Record<string, Record<string, unknown>>,
            stableFileUrlsRef.current,
          ),
        });
        const attached = attachStableUrls(
          merged.files as Record<string, Record<string, unknown>>,
          stableFileUrlsRef.current,
        );
        latestSceneRef.current = buildScenePayload(merged.elements, merged.appState, attached);
        lastElementsRef.current = merged.elements;
        lastFilesRef.current = attached;
        clearApplyingRemoteSoon();
        boardLog("file_add:applied", {
          fileIds: Object.keys(displayFiles),
          elementCount: elements.length,
          inApi: Object.keys(displayFiles).filter((id) => Boolean(apiRef.current?.getFiles?.()?.[id])),
        });
      };

      if (!Object.keys(asSceneFiles).length) {
        applyElements({});
        return;
      }
      Object.keys(asSceneFiles).forEach((id) => loadingRemoteFilesRef.current.add(id));
      void hydrateBoardFiles(asSceneFiles).then((hydrated) => {
        Object.keys(asSceneFiles).forEach((id) => loadingRemoteFilesRef.current.delete(id));
        boardLog("hydrate:file_add", {
          ok: hydrated.blobUrls.length,
          missing: hydrated.missingFileIds,
          failed: hydrated.failedFileIds,
        });
        if (boardIdRef.current !== boardId || !apiRef.current) {
          revokeBoardBlobUrls(hydrated.blobUrls);
          return;
        }
        hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
        rememberStableUrls(stableFileUrlsRef.current, hydrated.files);
        for (const id of Object.keys(hydrated.files)) {
          if (stableFileUrlsRef.current.has(id)) loadedFilesRef.current.add(id);
        }
        if (isDrawingGestureRef.current) {
          pendingHydrateFilesRef.current = {
            ...(pendingHydrateFilesRef.current || {}),
            ...hydrated.files,
          };
          if (elements.length) {
            pendingRemoteSceneRef.current = {
              scene: { elements, appState: {}, files: hydrated.files },
              meta: { fromSaved: false },
            };
          }
          return;
        }
        // Сначала addFiles, потом elements — требование Excalidraw.
        applyingRemoteRef.current = true;
        apiRef.current.addFiles?.(toBinaryFileDataList(hydrated.files, "file_add"));
        clearApplyingRemoteSoon();
        applyElements(hydrated.files);
      });
    };

    const handleResyncNeededNow = () => {
          // После reconnect подтягиваем серверный snapshot и сливаем с локальным.
          void (async () => {
            try {
              const fresh = await fetchInteractiveBoard(boardId);
              if (boardIdRef.current !== boardId || !apiRef.current) return;
              if (typeof fresh.version === "number" && fresh.version >= versionRef.current) {
                versionRef.current = fresh.version;
              }
              rememberStableUrls(
                stableFileUrlsRef.current,
                (fresh.scene_data?.files || {}) as Record<string, Record<string, unknown>>,
              );
              let remoteFiles = (fresh.scene_data?.files || {}) as Record<string, Record<string, unknown>>;
              const localFilesForHydrate = attachStableUrls(
                (apiRef.current.getFiles?.() || latestSceneRef.current?.files || {}) as Record<string, Record<string, unknown>>,
                stableFileUrlsRef.current,
              );
              if (filesNeedRemoteHydrate(remoteFiles, localFilesForHydrate)) {
                const hydrated = await hydrateBoardFiles(remoteFiles);
                boardLog("hydrate:resync", {
                  ok: hydrated.blobUrls.length,
                  missing: hydrated.missingFileIds,
                  failed: hydrated.failedFileIds,
                });
                hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
                rememberStableUrls(stableFileUrlsRef.current, hydrated.files);
                for (const id of Object.keys(hydrated.files)) {
                  if (stableFileUrlsRef.current.has(id)) loadedFilesRef.current.add(id);
                }
                remoteFiles = hydrated.files as Record<string, Record<string, unknown>>;
                if (apiRef.current) {
                  applyingRemoteRef.current = true;
                  apiRef.current.addFiles?.(toBinaryFileDataList(remoteFiles, "resync"));
                  clearApplyingRemoteSoon();
                }
              }
              if (boardIdRef.current !== boardId || !apiRef.current) return;
              const remoteScene = buildScenePayload(
                markImageElementsSaved(
                  fresh.scene_data?.elements || [],
                  Object.keys(remoteFiles),
                ),
                fresh.scene_data?.appState || {},
                remoteFiles,
              );
              const localElements = getLocalElementsForMerge(
                apiRef.current,
                latestSceneRef.current?.elements,
              );
              const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
              const localFiles = attachStableUrls(
                (apiRef.current.getFiles?.() || latestSceneRef.current?.files || {}) as Record<string, Record<string, unknown>>,
                stableFileUrlsRef.current,
              );
              const merged = mergeCollabScenes(
                { elements: localElements, appState: localApp, files: localFiles },
                remoteScene,
              );
              const displayFiles = attachStableUrls(
                merged.files as Record<string, Record<string, unknown>>,
                stableFileUrlsRef.current,
              );
              applyingRemoteRef.current = true;
              applyRemoteSceneToApi(apiRef.current, {
                elements: merged.elements,
                appState: merged.appState,
                files: displayFiles,
              });
              clearApplyingRemoteSoon();
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
        };

    const handleRemoteSceneNow = (scene: CollabScene, meta: { fromSaved?: boolean; version?: number; cleared?: boolean }) => {
          if (!apiRef.current) return;
          if (boardIdRef.current !== boardId) return;

          rememberStableUrls(
            stableFileUrlsRef.current,
            scene.files as Record<string, Record<string, unknown>>,
          );

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

          // Полная очистка доски пиром — element-level merge с [] оставил бы локальные элементы.
          if (meta.fromSaved && meta.cleared) {
            const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
            const clearedScene = {
              elements: [] as unknown[],
              appState: { ...localApp, ...(scene.appState || {}) },
              files: {},
            };
            applyingRemoteRef.current = true;
            applyRemoteSceneToApi(apiRef.current, clearedScene);
            latestSceneRef.current = buildScenePayload([], clearedScene.appState, {});
            lastElementsRef.current = [];
            lastFilesRef.current = {};
            knownElementIdsRef.current.clear();
            collabRef.current?.resetPublishBase([]);
            dirtyRef.current = false;
            lastSavedRevisionRef.current = localRevisionRef.current;
            safeSetSaveStatus("saved");
            setConflict(false);
            clearApplyingRemoteSoon();
            return;
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

          const applyMerged = (
            displayFiles: Record<string, unknown>,
            elements: unknown[] = merged.elements,
            appStateIn: Record<string, unknown> = merged.appState,
          ) => {
            if (!apiRef.current || boardIdRef.current !== boardId) return;
            applyingRemoteRef.current = true;
            const collaborators = buildCollaboratorsMap(remoteCursorsRef.current);
            applyRemoteSceneToApi(apiRef.current, {
              elements,
              appState: {
                ...appStateIn,
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
              ...appStateIn,
              scrollX: local.scrollX,
              scrollY: local.scrollY,
              zoom: local.zoom,
              collaborators,
              selectedElementIds: local.selectedElementIds,
              theme: boardThemeRef.current,
            };
            const payload = buildScenePayload(elements, nextApp, displayFiles);
            latestSceneRef.current = payload;
            lastElementsRef.current = elements;
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
              boardLog("hydrate:remoteScene", {
                ok: hydrated.blobUrls.length,
                missing: hydrated.missingFileIds,
                failed: hydrated.failedFileIds,
              });
              if (boardIdRef.current !== boardId || !apiRef.current) {
                revokeBoardBlobUrls(hydrated.blobUrls);
                return;
              }
              hydratedBlobUrlsRef.current.push(...hydrated.blobUrls);
              if (isDrawingGestureRef.current) {
                pendingHydrateFilesRef.current = {
                  ...(pendingHydrateFilesRef.current || {}),
                  ...hydrated.files,
                };
                return;
              }
              // За время fetch'а на канвас мог прилететь более свежий апдейт
              // (ops/сцена) — пересливаем поверх текущего состояния, а не поверх
              // merged.elements, снятого до await, иначе мы бы его затёрли.
              const freshLocal = getLocalElementsForMerge(apiRef.current, latestSceneRef.current?.elements);
              const freshApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
              const freshFiles = (apiRef.current.getFiles?.() || {}) as Record<string, unknown>;
              const reMerged = mergeCollabScenes(
                { elements: freshLocal, appState: freshApp, files: freshFiles },
                { elements: merged.elements, appState: merged.appState, files: hydrated.files },
              );
              applyMerged(
                { ...freshFiles, ...reMerged.files },
                reMerged.elements,
                reMerged.appState,
              );
            });
          }
        };

    // Во время активного локального жеста (палец/мышь ещё «внизу») применения
    // откладываются сюда и разом «доигрываются» на pointerup — см. комментарий
    // у isDrawingGestureRef.
    const flushPendingRemoteApplies = () => {
      const opsQueue = pendingRemoteOpsQueueRef.current;
      pendingRemoteOpsQueueRef.current = [];
      if (opsQueue.length) {
        // Сжимаем накопившуюся очередь: для одного id — последняя версия.
        const mergedOps: BoardElementOp[] = [];
        let files: Record<string, unknown> = {};
        let appStatePatch: Record<string, unknown> = {};
        let version: number | undefined;
        for (const { ops, meta } of opsQueue) {
          mergedOps.push(...(ops.ops || []));
          files = { ...files, ...(ops.files || {}) };
          appStatePatch = { ...appStatePatch, ...(ops.appStatePatch || {}) };
          if (typeof meta.version === "number") version = meta.version;
        }
        handleRemoteOpsNow(
          {
            ops: coalesceBoardOps(mergedOps),
            files,
            appStatePatch,
          },
          { version },
        );
      }
      const pendingScene = pendingRemoteSceneRef.current;
      pendingRemoteSceneRef.current = null;
      if (pendingScene) {
        handleRemoteSceneNow(pendingScene.scene, pendingScene.meta);
      }
      const pendingFiles = pendingHydrateFilesRef.current;
      pendingHydrateFilesRef.current = null;
      if (pendingFiles && apiRef.current && boardIdRef.current === boardId) {
        applyingRemoteRef.current = true;
        apiRef.current.addFiles?.(toBinaryFileDataList(pendingFiles, "gestureHydrated"));
        apiRef.current.updateScene?.({
          files: pendingFiles,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        const prev = latestSceneRef.current;
        const mergedFiles = { ...(prev?.files || {}), ...pendingFiles };
        if (prev) latestSceneRef.current = { ...prev, files: mergedFiles };
        lastFilesRef.current = mergedFiles;
        clearApplyingRemoteSoon();
      }
      if (pendingResyncRef.current) {
        pendingResyncRef.current = false;
        handleResyncNeededNow();
      }
    };
    flushPendingRemoteAppliesRef.current = flushPendingRemoteApplies;

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
          if (isDrawingGestureRef.current) {
            pendingRemoteOpsQueueRef.current.push({ ops, meta });
            return;
          }
          handleRemoteOpsNow(ops, meta);
        },
        onRemoteFileAdd: (files, elements) => {
          if (isDrawingGestureRef.current) {
            // Откладываем целиком — file_add требует addFiles до elements.
            pendingRemoteOpsQueueRef.current.push({
              ops: {
                ops: (elements || [])
                  .filter((raw) => raw && typeof raw === "object")
                  .map((raw) => ({ op: "upsert" as const, element: raw as Record<string, unknown> })),
                files: Object.fromEntries(
                  (files || []).map((f) => [
                    f.id,
                    {
                      id: f.id,
                      dataURL: f.url,
                      url: f.url,
                      mimeType: f.mimeType || "image/png",
                      created: f.created || Date.now(),
                    },
                  ]),
                ),
              },
              meta: {},
            });
            return;
          }
          handleRemoteFileAddNow(files, elements);
        },
        onResyncNeeded: () => {
          if (isDrawingGestureRef.current) {
            pendingResyncRef.current = true;
            return;
          }
          handleResyncNeededNow();
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
          if (isDrawingGestureRef.current) {
            pendingRemoteSceneRef.current = { scene, meta };
            return;
          }
          handleRemoteSceneNow(scene, meta);
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

  const handlePointerSceneDown = useCallback(() => {
    isDrawingGestureRef.current = true;
    // Страховка: pointerup может уйти мимо host (iframe / capture) — слушаем window.
    if (gestureEndBoundRef.current) {
      window.removeEventListener("pointerup", gestureEndBoundRef.current);
      window.removeEventListener("pointercancel", gestureEndBoundRef.current);
    }
    const endGesture = () => {
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
      gestureEndBoundRef.current = null;
      if (!isDrawingGestureRef.current) return;
      isDrawingGestureRef.current = false;
      flushPendingRemoteAppliesRef.current();
      collabRef.current?.flushLiveNow();
    };
    gestureEndBoundRef.current = endGesture;
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
  }, []);

  const handlePointerSceneUp = useCallback(() => {
    if (gestureEndBoundRef.current) {
      window.removeEventListener("pointerup", gestureEndBoundRef.current);
      window.removeEventListener("pointercancel", gestureEndBoundRef.current);
      gestureEndBoundRef.current = null;
    }
    if (!isDrawingGestureRef.current) {
      // Уже завершили через window-listener — только досылаем live на всякий случай.
      if (collaborative || canEdit) collabRef.current?.flushLiveNow();
      return;
    }
    isDrawingGestureRef.current = false;
    flushPendingRemoteAppliesRef.current();
    if (!collaborative && !canEdit) return;
    collabRef.current?.flushLiveNow();
  }, [canEdit, collaborative]);

  /** Клик по аватарке участника — центрируем холст на его последнем курсоре (как в Miro). */
  const jumpToPeer = useCallback((clientId: string | null) => {
    if (!clientId) return;
    const api = apiRef.current;
    const cursor = remoteCursorsRef.current.get(clientId);
    if (!api || !cursor) {
      showNotice("Курсор участника пока не виден");
      return;
    }
    const appState = api.getAppState?.() || {};
    const rawZoom = appState.zoom;
    const zoom = typeof rawZoom === "number"
      ? rawZoom
      : Number((rawZoom as { value?: number } | undefined)?.value) || 1;
    const width = Number(appState.width) || (editorRootRef.current?.clientWidth || window.innerWidth);
    const height = Number(appState.height) || (editorRootRef.current?.clientHeight || window.innerHeight);
    api.updateScene?.({
      appState: {
        scrollX: width / (2 * zoom) - cursor.x,
        scrollY: height / (2 * zoom) - cursor.y,
      },
    });
  }, [showNotice]);

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
        api.addFiles?.(toBinaryFileDataList(bootFiles, "boot"));
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
    if (!collaborative) return [] as Array<{ key: string; name: string; initials: string; color: string; clientId: string | null }>;
    const selfName =
      (canManage ? board.owner_name : board.student_name)
      || (canManage ? "Учитель" : "Ученик");
    const byKey = new Map<string, { name: string; clientId: string | null }>();
    byKey.set("self", { name: selfName, clientId: null });
    if (collabPeers.length > 0) {
      for (const peer of collabPeers) {
        const name = peer.displayName || "Участник";
        if (name === selfName) continue;
        byKey.set(peer.clientId, { name, clientId: peer.clientId });
      }
    } else {
      const other = canManage ? board.student_name : board.owner_name;
      if (other && other !== selfName) byKey.set("other", { name: other, clientId: null });
    }
    return Array.from(byKey.entries()).map(([key, info]) => ({
      key,
      name: info.name,
      initials: participantInitials(info.name),
      color: avatarColor(info.name),
      clientId: info.clientId,
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
                <button
                  key={person.key}
                  type="button"
                  className={[
                    "cb-board-editor__avatar",
                    person.clientId ? "cb-board-editor__avatar--clickable" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ backgroundColor: person.color }}
                  title={person.clientId ? `Перейти к ${person.name}` : person.name}
                  disabled={!person.clientId}
                  onClick={() => jumpToPeer(person.clientId)}
                >
                  {person.initials}
                </button>
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
          onPointerSceneDown={handlePointerSceneDown}
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
