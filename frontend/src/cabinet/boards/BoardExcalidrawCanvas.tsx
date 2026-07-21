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

function BoardExcalidrawInner({
  boot,
  onChangeRef,
  onApiReadyRef,
}: {
  boot: {
    initialElements: unknown[];
    initialAppState: Record<string, unknown>;
    initialFiles: SceneFiles;
    viewModeEnabled: boolean;
  };
  onChangeRef: MutableRefObject<Props["onChange"]>;
  onApiReadyRef: MutableRefObject<Props["onApiReady"]>;
}) {
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const prevCountRef = useRef(boot.initialElements.length);

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

  return (
    <div className="cb-board-excalidraw-host">
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
        onChange={(elements, appState, files) => {
          const state = appState as unknown as Record<string, unknown>;
          // Вставка из библиотеки (сайдбар открыт): показать новые элементы в кадре
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
}: Props) {
  const onChangeRef = useRef(onChange);
  const onApiReadyRef = useRef(onApiReady);
  onChangeRef.current = onChange;
  onApiReadyRef.current = onApiReady;

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
    />
  );
}

export default memo(BoardExcalidrawCanvas);
