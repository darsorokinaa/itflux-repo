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
import { externalizeSceneFiles } from "../boards/boardFiles";
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
} from "../boards/boardCollab";
import "../styles/boards.css";

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
};

type ExcalidrawAPI = {
  getSceneElements: () => unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateScene: (payload: Record<string, unknown>) => void;
  resetScene?: () => void;
};

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
  const latestSceneRef = useRef<BoardScenePayload | null>(null);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [initialData, setInitialData] = useState<BoardScenePayload | null>(null);
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
  const collabRef = useRef<ReturnType<typeof createBoardCollabSession> | null>(null);
  gridStyleRef.current = gridStyle;
  bgColorRef.current = bgColor;
  boardThemeRef.current = boardTheme;
  burgerOpenRef.current = burgerOpen;

  const canEdit = Boolean(board?.can_edit);
  const canManage = Boolean(board?.can_manage);
  const viewModeEnabled = !canEdit;
  const collaborative = Boolean(board?.collaborative_edit);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const persistScene = useCallback(async () => {
    if (!boardId || !canEdit || conflict) return;
    const scene = latestSceneRef.current;
    if (!scene) return;
    if (savingRef.current) return;

    savingRef.current = true;
    setSaveStatus("saving");
    try {
      const files = await externalizeSceneFiles(
        scene.files as Record<string, Record<string, unknown>>,
        (form) => uploadInteractiveBoardImage(boardId, form),
      );
      const payload = { ...scene, files };
      latestSceneRef.current = payload;
      const thumbnail = await captureBoardThumbnail(apiRef.current ?? payload);
      const data = await updateInteractiveBoard(boardId, {
        scene_data: payload,
        version: versionRef.current,
        ...(thumbnail !== null ? { thumbnail } : {}),
      });
      versionRef.current = data.version;
      dirtyRef.current = false;
      setBoard((prev) => (prev ? { ...prev, version: data.version } : prev));
      setSaveStatus("saved");
      setConflict(false);
    } catch (err: unknown) {
      const error = err as { code?: string; status?: number; message?: string };
      if (error?.code === "VERSION_CONFLICT" || error?.status === 409) {
        // При совместном редактировании подтягиваем серверную сцену вместо блокировки.
        if (collaborative) {
          try {
            const fresh = await fetchInteractiveBoard(boardId);
            versionRef.current = fresh.version || versionRef.current;
            const scene = buildScenePayload(
              fresh.scene_data?.elements || [],
              fresh.scene_data?.appState || {},
              fresh.scene_data?.files || {},
            );
            latestSceneRef.current = scene;
            applyingRemoteRef.current = true;
            if (apiRef.current) applyRemoteSceneToApi(apiRef.current, scene);
            window.setTimeout(() => { applyingRemoteRef.current = false; }, 120);
            dirtyRef.current = false;
            setConflict(false);
            setSaveStatus("saved");
            setBoard((prev) => (prev ? { ...prev, version: fresh.version } : prev));
          } catch {
            setConflict(true);
            setSaveStatus("conflict");
          }
        } else {
          setConflict(true);
          setSaveStatus("conflict");
        }
      } else {
        setSaveStatus("error");
        showNotice(error?.message || "Ошибка сохранения");
      }
    } finally {
      savingRef.current = false;
    }
  }, [boardId, canEdit, collaborative, conflict, showNotice]);

  const debouncedSaver = useMemo(
    () => createDebouncedSaver(() => persistScene(), AUTOSAVE_DEBOUNCE_MS),
    [persistScene],
  );

  // При пересоздании saver — flush, не cancel (иначе теряются отложенные сохранения)
  useEffect(() => () => { void debouncedSaver.flush(); }, [debouncedSaver]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    fetchInteractiveBoard(boardId)
      .then((data: BoardDetail) => {
        if (cancelled) return;
        setBoard(data);
        setTitle(data.title || "Новая доска");
        versionRef.current = data.version || 1;
        const rawApp = data.scene_data?.appState || {};
        const style = normalizeGridStyle(rawApp[GRID_STYLE_KEY], rawApp.gridModeEnabled);
        const solidBg = resolveBoardBgColor(rawApp);
        const theme = rawApp.theme === "dark" ? "dark" : "light";
        const scene = buildScenePayload(
          data.scene_data?.elements || [],
          { ...rawApp, ...gridAppStatePatch(style, solidBg), theme },
          data.scene_data?.files || {},
        );
        setInitialData(scene);
        latestSceneRef.current = scene;
        setGridStyle(style);
        setBgColor(solidBg);
        setBoardTheme(theme);
        setLoading(false);
      })
      .catch((err: { message?: string }) => {
        if (cancelled) return;
        setLoadError(err?.message || "Не удалось открыть доску");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

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
  const lastElementsRef = useRef<readonly unknown[] | null>(null);
  const lastFilesRef = useRef<Record<string, unknown> | null>(null);
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

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      syncPaperOverlay(appState);
      syncLeftPanels(appState);
      if (applyingRemoteRef.current) return;
      if (!canEditRef.current || conflictRef.current) return;
      const scene = buildScenePayload(elements, appState, files);
      // Сохраняем наш стиль сетки и цвет бумаги (Excalidraw может не вернуть кастомные ключи)
      scene.appState[GRID_STYLE_KEY] = gridStyleRef.current;
      scene.appState[BG_COLOR_KEY] = bgColorRef.current;
      if (usesPaperOverlay(gridStyleRef.current)) {
        scene.appState.viewBackgroundColor = "transparent";
      }
      scene.appState.theme = boardThemeRef.current;
      const elementsChanged = lastElementsRef.current !== elements;
      const filesChanged = lastFilesRef.current !== files;
      const bgChanged =
        latestSceneRef.current?.appState?.viewBackgroundColor !== scene.appState.viewBackgroundColor;
      const gridChanged =
        latestSceneRef.current?.appState?.[GRID_STYLE_KEY] !== scene.appState[GRID_STYLE_KEY];
      const themeChanged = latestSceneRef.current?.appState?.theme !== scene.appState.theme;
      latestSceneRef.current = scene;
      if (!elementsChanged && !filesChanged && !bgChanged && !gridChanged && !themeChanged) return;
      lastElementsRef.current = elements;
      lastFilesRef.current = files;
      dirtyRef.current = true;
      setSaveStatus((s) => (s === "dirty" || s === "saving" ? s : "dirty"));
      debouncedSaver.schedule();
      collabRef.current?.publishLive(
        {
          elements: scene.elements as unknown[],
          appState: scene.appState,
          files: scene.files as Record<string, unknown>,
        },
        versionRef.current,
      );
    },
    [debouncedSaver, syncPaperOverlay, syncLeftPanels],
  );

  // Совместное редактирование с привязанным учеником (WebSocket live + REST persist).
  useEffect(() => {
    if (!boardId || !board || loading || !excalidrawReady) return undefined;
    if (!collaborative && !canEdit) return undefined;

    const displayName =
      (canManage ? board.owner_name : board.student_name)
      || (canManage ? "Учитель" : "Ученик");

    const session = createBoardCollabSession(boardId, displayName, {
      onStatus: (status) => {
        setCollabStatus(status === "connecting" ? "connecting" : status);
      },
      onPeersChange: setCollabPeers,
      onRemoteScene: (scene, meta) => {
        if (!apiRef.current) return;
        if (meta.fromSaved && typeof meta.version === "number") {
          if (meta.version < versionRef.current) return;
          versionRef.current = meta.version;
          setBoard((prev) => (prev ? { ...prev, version: meta.version! } : prev));
        }

        const localElements = (apiRef.current.getSceneElements?.() || []) as unknown[];
        const localApp = (apiRef.current.getAppState?.() || {}) as Record<string, unknown>;
        const localFiles = (apiRef.current.getFiles?.() || {}) as Record<string, unknown>;
        // Element-level merge: иначе чужой live-кадр затирает наш незавершённый штрих.
        const merged = mergeCollabScenes(
          { elements: localElements, appState: localApp, files: localFiles },
          scene,
        );

        applyingRemoteRef.current = true;
        applyRemoteSceneToApi(apiRef.current, merged);
        const local = apiRef.current.getAppState?.() || {};
        const nextApp = {
          ...merged.appState,
          scrollX: local.scrollX,
          scrollY: local.scrollY,
          zoom: local.zoom,
          collaborators: local.collaborators,
          selectedElementIds: local.selectedElementIds,
          theme: boardThemeRef.current,
        };
        const payload = buildScenePayload(merged.elements, nextApp, merged.files);
        latestSceneRef.current = payload;
        lastElementsRef.current = merged.elements;
        lastFilesRef.current = merged.files;
        if (meta.fromSaved) {
          // После сохранения партнёра не сбрасываем свой dirty, если мы тоже правили.
          if (!dirtyRef.current) {
            setSaveStatus("saved");
            setConflict(false);
          }
        }
        window.setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 80);
      },
    });
    collabRef.current = session;
    setCollabStatus("connecting");

    return () => {
      session.close();
      collabRef.current = null;
      setCollabPeers([]);
      setCollabStatus("off");
    };
  }, [board, boardId, canEdit, canManage, collaborative, excalidrawReady, loading]);

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
      syncPaperOverlay(state);
      syncLeftPanels(state);
    } catch {
      /* ignore */
    }
  }, [syncPaperOverlay, syncLeftPanels]);

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
      dirtyRef.current = true;
      setSaveStatus("dirty");
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
        dirtyRef.current = true;
        setSaveStatus("dirty");
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
        dirtyRef.current = true;
        setSaveStatus("dirty");
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

  if (loading) {
    return (
      <div className="cb-board-editor" aria-busy="true">
        <div className="cb-board-editor__skeleton">Загрузка доски…</div>
      </div>
    );
  }

  if (loadError || !board || !initialData) {
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
            <Link to="/cabinet/boards" className="cb-btn cb-btn--primary">К списку досок</Link>
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
          key={boardId}
          initialElements={initialData.elements}
          initialAppState={initialData.appState}
          initialFiles={initialData.files}
          viewModeEnabled={viewModeEnabled}
          onChange={handleChange}
          onApiReady={handleApiReady}
        />
      </div>

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
