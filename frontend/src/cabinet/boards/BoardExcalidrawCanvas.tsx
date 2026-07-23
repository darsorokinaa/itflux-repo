import { memo, useCallback, useRef, useState, type MutableRefObject } from "react";
import { Excalidraw, useHandleLibrary } from "@excalidraw/excalidraw";
import { boardLibraryAdapter } from "./boardLibrary";

type SceneFiles = Record<string, unknown>;

export type ExcalidrawAPI = {
  getSceneElements: () => unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => SceneFiles;
  updateScene: (payload: Record<string, unknown>) => void;
  scrollToContent?: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
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
  generateIdForFile?: (file: File) => string | Promise<string>;
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

function zoomValue(appState: Record<string, unknown>): number {
  const z = appState.zoom;
  if (typeof z === "number" && z > 0) return z;
  if (z && typeof z === "object" && typeof (z as { value?: number }).value === "number") {
    return (z as { value: number }).value || 1;
  }
  return 1;
}

function BoardExcalidrawInner({
  boot,
  onChangeRef,
  onApiReadyRef,
  onPointerSceneMoveRef,
  generateIdForFileRef,
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
  generateIdForFileRef: MutableRefObject<Props["generateIdForFile"]>;
}) {
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const prevCountRef = useRef(boot.initialElements.length);
  const hostRef = useRef<HTMLDivElement | null>(null);

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

  const libraryReturnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}${window.location.search}`
      : undefined;

  const handleHostPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cb = onPointerSceneMoveRef.current;
    const current = apiRef.current;
    if (!cb || !current) return;
    const host = hostRef.current;
    if (!host) return;
    const canvas = host.querySelector("canvas.excalidraw__canvas") as HTMLCanvasElement | null;
    const rect = (canvas || host).getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const appState = current.getAppState?.() || {};
    const zoom = zoomValue(appState);
    const scrollX = Number(appState.scrollX) || 0;
    const scrollY = Number(appState.scrollY) || 0;
    const x = (e.clientX - rect.left) / zoom - scrollX;
    const y = (e.clientY - rect.top) / zoom - scrollY;
    const activeTool = appState.activeTool as { type?: string } | undefined;
    cb(x, y, String(activeTool?.type || "pointer"));
  }, [onPointerSceneMoveRef]);

  return (
    <div
      className="cb-board-excalidraw-host"
      ref={hostRef}
      onPointerMove={handleHostPointerMove}
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
          },
          files: boot.initialFiles as never,
          scrollToContent: true,
        }}
        viewModeEnabled={boot.viewModeEnabled}
        generateIdForFile={async (file) => {
          const custom = generateIdForFileRef.current;
          if (custom) return custom(file);
          if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
          return `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        }}
        onChange={(elements, appState, files) => {
          const state = appState as unknown as Record<string, unknown>;
          const added = elements.length - prevCountRef.current;
          if (added > 0 && added <= 40 && state.openSidebar) {
            try {
              apiRef.current?.scrollToContent?.(elements.slice(-added) as never, {
                fitToContent: true,
                animate: false,
              });
            } catch {
              /* ignore */
            }
          }
          prevCountRef.current = elements.length;
          onChangeRef.current(elements as readonly unknown[], state, (files || {}) as SceneFiles);
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
    generateIdForFileRef: MutableRefObject<Props["generateIdForFile"]>;
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
  generateIdForFile,
}: Props) {
  const onChangeRef = useRef(onChange);
  const onApiReadyRef = useRef(onApiReady);
  const onPointerSceneMoveRef = useRef(onPointerSceneMove);
  const generateIdForFileRef = useRef(generateIdForFile);
  onChangeRef.current = onChange;
  onApiReadyRef.current = onApiReady;
  onPointerSceneMoveRef.current = onPointerSceneMove;
  generateIdForFileRef.current = generateIdForFile;

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
      generateIdForFileRef={generateIdForFileRef}
    />
  );
}

export default memo(BoardExcalidrawCanvas);
