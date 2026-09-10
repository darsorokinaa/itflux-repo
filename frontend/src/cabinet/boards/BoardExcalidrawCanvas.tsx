import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CaptureUpdateAction, Excalidraw, mutateElement, useHandleLibrary } from "@excalidraw/excalidraw";
import { boardLibraryAdapter } from "./boardLibrary";
import { isEraserBlockedByImage } from "./boardImageErase";
import { mountCoalescedPointerReplay, isPointerReplayEvent, isReplayingPenPoints } from "./boardPointerInput";
import { flushScheduledFrame, schedulePaintAtFps } from "./boardLiveStroke";
import { mountBoardPdfToolbar } from "./boardPdfToolbar";
import { boardPerfMeasure } from "./boardPerfDev";
import { observeBoardHostSize } from "./boardHostSize";
import { boardSceneCoordsFromClient } from "./boardSceneCoords";
import {
  applyStrokeWidthToScene,
  clampBoardStrokeWidth,
  selectedStrokeWidthIds,
  withBoardStrokeWidthDefault,
} from "./boardStrokeWidth";
import { mountBoardStrokeWidthControl } from "./boardStrokeWidthToolbar";

type SceneFiles = Record<string, unknown>;

export type ExcalidrawAPI = {
  getSceneElements: () => unknown[];
  getSceneElementsIncludingDeleted?: () => unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => SceneFiles;
  updateScene: (payload: Record<string, unknown>) => void;
  addFiles?: (files: unknown[]) => void;
  scrollToContent?: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
  refresh?: () => void;
};

type Props = {
  initialElements: unknown[];
  initialAppState: Record<string, unknown>;
  initialFiles: SceneFiles;
  viewModeEnabled: boolean;
  onChange: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: SceneFiles,
  ) => void;
  onApiReady: (api: ExcalidrawAPI) => void;
  /** Scene-space pointer (Excalidraw coordinates) for remote cursors. */
  onPointerSceneMove?: (x: number, y: number, tool: string) => void;
  /** Начало жеста — отложить применение входящих remote-апдейтов до pointerUp. */
  onPointerSceneDown?: () => void;
  /** Конец жеста — сразу flush live-сцены пирам. */
  onPointerSceneUp?: () => void;
  /** scrollX/scrollY/zoom — для viewport учителя (follow mode). */
  onScrollChange?: (scrollX: number, scrollY: number, zoom: number) => void;
  generateIdForFile?: (file: File) => string | Promise<string>;
  /** Вызывается, когда контейнер имеет ненулевой размер и API готов. */
  onHostReady?: () => void;
  /** Кнопка PDF в тулбаре. */
  onInsertPdf?: () => void;
};

const UI_OPTIONS = {
  welcomeScreen: false,
  canvasActions: {
    loadScene: false,
    export: false,
    saveAsImage: false,
    saveToActiveFile: false,
    clearCanvas: false,
  },
} as const;

function sceneCoordsFromClient(
  clientX: number,
  clientY: number,
  appState: Record<string, unknown>,
): { x: number; y: number } {
  return boardSceneCoordsFromClient(clientX, clientY, appState);
}

function commitLiveFreedrawRender(element: {
  points: number[][];
  pressures?: number[];
  simulatePressure?: boolean;
}): void {
  const points = element.points;
  if (!Array.isArray(points)) return;
  const next: Record<string, unknown> = { points: points.slice() };
  if (!element.simulatePressure && Array.isArray(element.pressures)) {
    next.pressures = element.pressures.slice();
  }
  mutateElement(element as never, next as never);
}

function BoardExcalidrawInner({
  boot,
  onChangeRef,
  onApiReadyRef,
  onPointerSceneMoveRef,
  onPointerSceneDownRef,
  onPointerSceneUpRef,
  onScrollChangeRef,
  generateIdForFileRef,
  onHostReadyRef,
  onInsertPdfRef,
}: {
  boot: {
    initialElements: unknown[];
    initialAppState: Record<string, unknown>;
    initialFiles: SceneFiles;
    viewModeEnabled: boolean;
  };
  onChangeRef: MutableRefObject<Props["onChange"]>;
  onApiReadyRef: MutableRefObject<Props["onApiReady"]>;
  onPointerSceneMoveRef: MutableRefObject<Props["onPointerSceneMove"]>;
  onPointerSceneDownRef: MutableRefObject<Props["onPointerSceneDown"]>;
  onPointerSceneUpRef: MutableRefObject<Props["onPointerSceneUp"]>;
  onScrollChangeRef: MutableRefObject<Props["onScrollChange"]>;
  generateIdForFileRef: MutableRefObject<Props["generateIdForFile"]>;
  onHostReadyRef: MutableRefObject<Props["onHostReady"]>;
  onInsertPdfRef: MutableRefObject<Props["onInsertPdf"]>;
}) {
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hostReadySentRef = useRef(false);
  const strokeControlRef = useRef<ReturnType<typeof mountBoardStrokeWidthControl> | null>(null);
  const liveFreedrawRafRef = useRef<number | null>(null);
  const lastLivePaintAtRef = useRef(0);
  const pendingLiveElementRef = useRef<{
    points: number[][];
    pressures?: number[];
    simulatePressure?: boolean;
    x: number;
    y: number;
  } | null>(null);

  useHandleLibrary({
    excalidrawAPI: api as never,
    adapter: boardLibraryAdapter as never,
  });

  const handleApi = useCallback(
    (next: ExcalidrawAPI) => {
      apiRef.current = next;
      setApi(next);
      onApiReadyRef.current(next);
    },
    [onApiReadyRef],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const onUsableSize = () => {
      try {
        apiRef.current?.refresh?.();
      } catch {
        /* ignore */
      }
      if (!hostReadySentRef.current && api) {
        hostReadySentRef.current = true;
        onHostReadyRef.current?.();
      }
    };

    const stop = observeBoardHostSize(host, { onUsableSize });
    return stop;
  }, [api, onHostReadyRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || boot.viewModeEnabled) return undefined;
    return mountBoardPdfToolbar(host, {
      enabled: true,
      onClick: () => onInsertPdfRef.current?.(),
    });
  }, [api, boot.viewModeEnabled, onInsertPdfRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || boot.viewModeEnabled) return undefined;
    const unmount = mountCoalescedPointerReplay(host, {
      getLiveFreedraw: () => {
        const current = apiRef.current;
        if (!current) return null;
        const appState = current.getAppState?.() || {};
        const el = appState.newElement as {
          type?: string;
          x?: number;
          y?: number;
          points?: number[][];
          pressures?: number[];
          simulatePressure?: boolean;
        } | null;
        const tool = String((appState.activeTool as { type?: string } | undefined)?.type || "");
        const isFreedraw = tool === "freedraw" || el?.type === "freedraw";
        if (!isFreedraw) return null;
        const toScene = (clientX: number, clientY: number) => {
          const liveApp = apiRef.current?.getAppState?.() || appState;
          return sceneCoordsFromClient(clientX, clientY, liveApp);
        };
        if (!el || el.type !== "freedraw" || !Array.isArray(el.points)) {
          return { element: null, toScene };
        }
        return {
          element: el as {
            x: number;
            y: number;
            type: string;
            points: number[][];
            pressures?: number[];
            simulatePressure?: boolean;
          },
          toScene,
        };
      },
      onLiveStrokeMutated: (element) => {
        pendingLiveElementRef.current = element;
        schedulePaintAtFps(liveFreedrawRafRef, lastLivePaintAtRef, () => {
          const el = pendingLiveElementRef.current;
          if (!el) return;
          boardPerfMeasure(() => {
            commitLiveFreedrawRender(el);
            const last = el.points[el.points.length - 1];
            if (last) {
              onPointerSceneMoveRef.current?.(el.x + last[0], el.y + last[1], "freedraw");
            }
          });
        });
      },
      onPenStrokeEnd: () => {
        flushScheduledFrame(liveFreedrawRafRef, () => {
          const el = pendingLiveElementRef.current;
          pendingLiveElementRef.current = null;
          if (!el) return;
          commitLiveFreedrawRender(el);
        });
      },
    });
    return () => {
      pendingLiveElementRef.current = null;
      if (liveFreedrawRafRef.current != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(liveFreedrawRafRef.current);
        liveFreedrawRafRef.current = null;
      }
      unmount();
    };
  }, [boot.viewModeEnabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || boot.viewModeEnabled) return undefined;
    let blocking = false;
    const shouldBlock = (event: PointerEvent) => {
      const current = apiRef.current;
      if (!current) return false;
      const app = current.getAppState?.() || {};
      const { x, y } = sceneCoordsFromClient(event.clientX, event.clientY, app);
      return isEraserBlockedByImage(app, current.getSceneElements?.() || [], x, y);
    };
    const onDown = (event: Event) => {
      const native = event as PointerEvent;
      blocking = shouldBlock(native);
      if (!blocking) return;
      native.stopPropagation();
    };
    const onMoveOrUp = (event: Event) => {
      if (!blocking) return;
      (event as PointerEvent).stopPropagation();
      if (event.type !== "pointermove") blocking = false;
    };
    host.addEventListener("pointerdown", onDown, { capture: true });
    host.addEventListener("pointermove", onMoveOrUp, { capture: true });
    host.addEventListener("pointerup", onMoveOrUp, { capture: true });
    host.addEventListener("pointercancel", onMoveOrUp, { capture: true });
    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointermove", onMoveOrUp, true);
      host.removeEventListener("pointerup", onMoveOrUp, true);
      host.removeEventListener("pointercancel", onMoveOrUp, true);
    };
  }, [boot.viewModeEnabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || boot.viewModeEnabled) return undefined;
    const control = mountBoardStrokeWidthControl(host, {
      enabled: true,
      getWidth: () => apiRef.current?.getAppState?.()?.currentItemStrokeWidth,
      setWidth: (width, commit) => {
        const current = apiRef.current;
        if (!current) return;
        const nextWidth = clampBoardStrokeWidth(width);
        const appState = current.getAppState?.() || {};
        const selectedIds = selectedStrokeWidthIds(appState.selectedElementIds);
        const elements = (
          current.getSceneElementsIncludingDeleted?.()
          || current.getSceneElements?.()
          || []
        ) as unknown[];
        const nextElements = applyStrokeWidthToScene({
          elements,
          selectedIds,
          width: nextWidth,
        });
        try {
          current.updateScene?.({
            ...(nextElements ? { elements: nextElements } : {}),
            appState: { currentItemStrokeWidth: nextWidth },
            captureUpdate: commit
              ? CaptureUpdateAction.IMMEDIATELY
              : CaptureUpdateAction.EVENTUALLY,
          });
        } catch {
          /* ignore */
        }
      },
    });
    strokeControlRef.current = control;
    if (api) {
      control.sync(api.getAppState?.()?.currentItemStrokeWidth);
    }
    return () => {
      control.unmount();
      if (strokeControlRef.current === control) strokeControlRef.current = null;
    };
  }, [api, boot.viewModeEnabled]);

  const libraryReturnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}${window.location.search}`
      : undefined;

  const handleHostPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (isPointerReplayEvent(e.nativeEvent as { __itfluxCoalescedReplay?: boolean })) return;
    const cb = onPointerSceneMoveRef.current;
    const current = apiRef.current;
    if (!cb || !current) return;
    const appState = current.getAppState?.() || {};
    const { x, y } = boardSceneCoordsFromClient(e.clientX, e.clientY, appState);
    const activeTool = appState.activeTool as { type?: string } | undefined;
    cb(x, y, String(activeTool?.type || "pointer"));
  }, [onPointerSceneMoveRef]);

  const handleHostPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Только холст: клик по тулбару/панелям не должен блокировать remote-sync.
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.("canvas.excalidraw__canvas")) return;

    onPointerSceneDownRef.current?.();
  }, [onPointerSceneDownRef]);

  // iOS/iPadOS: без preventDefault на touchmove страница/iframe могут
  // перехватывать жест стилуса даже при touch-action: none у потомков.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const onTouchMove = (ev: TouchEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t?.closest?.("canvas.excalidraw__canvas")) return;
      if (ev.cancelable) ev.preventDefault();
    };

    host.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      host.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const handleHostPointerUp = useCallback(() => {
    onPointerSceneUpRef.current?.();
  }, [onPointerSceneUpRef]);

  return (
    <div
      className="cb-board-excalidraw-host"
      ref={hostRef}
      onPointerMove={handleHostPointerMove}
      onPointerDown={handleHostPointerDown}
      onPointerUp={handleHostPointerUp}
      onPointerCancel={handleHostPointerUp}
      onLostPointerCapture={handleHostPointerUp}
    >
      <Excalidraw
        langCode="ru-RU"
        libraryReturnUrl={libraryReturnUrl}
        initialData={{
          elements: boot.initialElements as never[],
          appState: {
            ...boot.initialAppState,
            theme: boot.initialAppState.theme === "dark" ? "dark" : "light",
            viewModeEnabled: boot.viewModeEnabled,
            currentItemStrokeWidth: withBoardStrokeWidthDefault(
              boot.initialAppState.currentItemStrokeWidth,
            ),
          },
          files: boot.initialFiles as never,
          // НЕ scrollToContent: иначе ученик «прыгает» к началу/центру сцены
          // вместо сохранённого или teacher viewport.
          scrollToContent: false,
        }}
        viewModeEnabled={boot.viewModeEnabled}
        generateIdForFile={async (file) => {
          const custom = generateIdForFileRef.current;
          if (custom) return custom(file);
          if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
          return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        }}
        onChange={(elements, appState, files) => {
          // Synthetic coalesced/densify moves: Excalidraw уже дописал points.
          // Persist/WS только на native pointermove — иначе N копий сцены на кадр.
          if (isReplayingPenPoints()) return;
          boardPerfMeasure(() => {
            const tool = (appState as { activeTool?: { type?: string } }).activeTool?.type;
            if (tool !== "freedraw") {
              strokeControlRef.current?.sync(
                (appState as { currentItemStrokeWidth?: unknown }).currentItemStrokeWidth,
              );
            }
            onChangeRef.current(
              elements as readonly unknown[],
              appState as unknown as Record<string, unknown>,
              (files || {}) as SceneFiles,
            );
          });
        }}
        onScrollChange={(scrollX, scrollY, zoom) => {
          let zoomNum = 1;
          if (typeof zoom === "number" && zoom > 0) zoomNum = zoom;
          else if (zoom && typeof zoom === "object" && typeof (zoom as { value?: number }).value === "number") {
            zoomNum = (zoom as { value: number }).value || 1;
          }
          onScrollChangeRef.current?.(scrollX, scrollY, zoomNum);
        }}
        excalidrawAPI={(next) => handleApi(next as unknown as ExcalidrawAPI)}
        UIOptions={UI_OPTIONS as never}
      />
    </div>
  );
}

/**
 * Host монтируется один раз (memo always-equal) — статус сохранения
 * в родителе не пересоздаёт Excalidraw.
 * initialData должен быть полностью гидратирован ДО первого mount.
 */
const ExcalidrawHost = memo(
  function ExcalidrawHost(props: {
    boot: {
      initialElements: unknown[];
      initialAppState: Record<string, unknown>;
      initialFiles: SceneFiles;
      viewModeEnabled: boolean;
    };
    onChangeRef: MutableRefObject<Props["onChange"]>;
    onApiReadyRef: MutableRefObject<Props["onApiReady"]>;
    onPointerSceneMoveRef: MutableRefObject<Props["onPointerSceneMove"]>;
    onPointerSceneDownRef: MutableRefObject<Props["onPointerSceneDown"]>;
    onPointerSceneUpRef: MutableRefObject<Props["onPointerSceneUp"]>;
    onScrollChangeRef: MutableRefObject<Props["onScrollChange"]>;
    generateIdForFileRef: MutableRefObject<Props["generateIdForFile"]>;
    onHostReadyRef: MutableRefObject<Props["onHostReady"]>;
    onInsertPdfRef: MutableRefObject<Props["onInsertPdf"]>;
  }) {
    return <BoardExcalidrawInner {...props} />;
  },
  () => true,
);

function BoardExcalidrawCanvas({
  initialElements,
  initialAppState,
  initialFiles,
  viewModeEnabled,
  onChange,
  onApiReady,
  onPointerSceneMove,
  onPointerSceneDown,
  onPointerSceneUp,
  onScrollChange,
  generateIdForFile,
  onHostReady,
  onInsertPdf,
}: Props) {
  const onChangeRef = useRef(onChange);
  const onApiReadyRef = useRef(onApiReady);
  const onPointerSceneMoveRef = useRef(onPointerSceneMove);
  const onPointerSceneDownRef = useRef(onPointerSceneDown);
  const onPointerSceneUpRef = useRef(onPointerSceneUp);
  const onScrollChangeRef = useRef(onScrollChange);
  const generateIdForFileRef = useRef(generateIdForFile);
  const onHostReadyRef = useRef(onHostReady);
  const onInsertPdfRef = useRef(onInsertPdf);
  onChangeRef.current = onChange;
  onApiReadyRef.current = onApiReady;
  onPointerSceneMoveRef.current = onPointerSceneMove;
  onPointerSceneDownRef.current = onPointerSceneDown;
  onPointerSceneUpRef.current = onPointerSceneUp;
  onScrollChangeRef.current = onScrollChange;
  generateIdForFileRef.current = generateIdForFile;
  onHostReadyRef.current = onHostReady;
  onInsertPdfRef.current = onInsertPdf;

  const boot = useRef({
    initialElements,
    initialAppState,
    initialFiles,
    viewModeEnabled,
  }).current;

  return (
    <ExcalidrawHost
      boot={boot}
      onChangeRef={onChangeRef}
      onApiReadyRef={onApiReadyRef}
      onPointerSceneMoveRef={onPointerSceneMoveRef}
      onPointerSceneDownRef={onPointerSceneDownRef}
      onPointerSceneUpRef={onPointerSceneUpRef}
      onScrollChangeRef={onScrollChangeRef}
      generateIdForFileRef={generateIdForFileRef}
      onHostReadyRef={onHostReadyRef}
      onInsertPdfRef={onInsertPdfRef}
    />
  );
}

export default memo(BoardExcalidrawCanvas);
