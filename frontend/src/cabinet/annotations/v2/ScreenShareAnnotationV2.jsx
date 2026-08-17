import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useElementClientRect } from "../useElementClientRect";
import { useFloatingDrag } from "../../useFloatingDrag";
import { TOOLS, participantColor } from "../../screenshare/constants";
import { computeScreenShareContentRect } from "../../screenshare/contentRect";
import { dimensionsChanged } from "./coordinateMapper";
import { createAnnotationEngine } from "./engine";
import { annDebug } from "./debug";
import PresenterToolbar from "./PresenterToolbar";
import { resolvePresenterOverlayPlan } from "./overlays/presenterAdapter";
import { closeDocumentPipWindow, documentPipAvailable, openDocumentPipWindow } from "./overlays/documentPip";

function lasersToList(remoteLasers) {
  if (!remoteLasers) return [];
  if (Array.isArray(remoteLasers)) return remoteLasers;
  return Object.values(remoteLasers);
}

export default function ScreenShareAnnotationV2({
  active = false,
  compact = false,
  canManage = false,
  canAnnotate = false,
  participantsCanAnnotate = true,
  currentUserId = null,
  displayName = "",
  sessionId = "",
  contentWidth = 0,
  contentHeight = 0,
  displaySurface = "",
  localSharing = false,
  tileView = false,
  targetRef = null,
  remoteLasers = {},
  onEngineReady,
  onSend,
  onPointer,
  onSetParticipantsCanAnnotate,
}) {
  const canvasRef = useRef(null);
  const viewportCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const sourceRevisionRef = useRef(1);
  const lastSourceRef = useRef({ width: 0, height: 0, surface: "" });
  const pipWindowRef = useRef(null);
  const onSendRef = useRef(onSend);
  const onPointerRef = useRef(onPointer);
  onSendRef.current = onSend;
  onPointerRef.current = onPointer;
  const [pipWindow, setPipWindow] = useState(null);
  const [pipFailed, setPipFailed] = useState(false);
  const [toolbarDismissed, setToolbarDismissed] = useState(false);
  const [tool, setTool] = useState(TOOLS.POINTER);
  const [color, setColor] = useState(() => participantColor(currentUserId));
  const [width, setWidth] = useState(3);

  const hostBox = useElementClientRect(targetRef, {
    enabled: active,
    live: active,
  });

  const drawing = Boolean(active && canAnnotate && tool !== TOOLS.POINTER);
  const plan = useMemo(
    () => resolvePresenterOverlayPlan({ localSharing, displaySurface }),
    [localSharing, displaySurface],
  );
  const usePlatformOverlay = Boolean(active && plan.platformTab && drawing);
  const layout = useMemo(() => {
    if (!hostBox) return null;
    return computeScreenShareContentRect({
      hostRect: hostBox,
      contentWidth,
      contentHeight,
      compact,
      tileView,
    });
  }, [hostBox, contentWidth, contentHeight, compact, tileView]);

  const drag = useFloatingDrag({
    enabled: active && !pipWindow,
    storageKey: "itflux.ssAnn.toolbar",
    handleSelector: ".ss-ann-v2-toolbar, .ss-ann-v2-toolbar__grip",
  });

  useEffect(() => {
    if (!active) return undefined;
    const engine = createAnnotationEngine({
      authorId: currentUserId,
      displayName,
      sourceWidth: contentWidth || 1920,
      canAnnotate,
      canManage,
      onSend: (...args) => onSendRef.current?.(...args),
      onPointer: (...args) => onPointerRef.current?.(...args),
    });
    engineRef.current = engine;
    onEngineReady?.(engine);
    annDebug("engine-ready", { sessionId, displaySurface, localSharing });
    return () => {
      onEngineReady?.(null);
      engine.dispose();
      engineRef.current = null;
    };
  }, [active, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps -- recreate per share session

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setCanAnnotate(canAnnotate);
    engine.setCanManage(canManage);
    engine.setTool(tool);
    engine.setColor(color);
    engine.setWidth(width);
    engine.setDrawingEnabled(drawing && canAnnotate);
    engine.setSourceWidth(contentWidth || 1920);
    engine.setPointerSpace(usePlatformOverlay ? "viewport" : "content");
  }, [canAnnotate, canManage, tool, color, width, drawing, contentWidth, usePlatformOverlay]);

  useEffect(() => {
    const engine = engineRef.current;
    const node = canvasRef.current;
    if (!engine || !active) return undefined;
    engine.attachCanvas(node);
    if (!usePlatformOverlay) engine.attachHost(node);
    return () => {
      engine.attachCanvas(null);
      if (!usePlatformOverlay) engine.attachHost(null);
    };
  }, [active, usePlatformOverlay, layout?.content?.width, layout?.content?.height]);

  useEffect(() => {
    const engine = engineRef.current;
    const node = viewportCanvasRef.current;
    if (!engine || !usePlatformOverlay) {
      engine?.attachViewportCanvas(null);
      return undefined;
    }
    engine.attachViewportCanvas(node);
    engine.attachHost(node);
    return () => {
      engine.attachViewportCanvas(null);
      engine.attachHost(null);
    };
  }, [usePlatformOverlay]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !layout?.content) return;
    const nextSource = {
      width: Number(contentWidth) || 0,
      height: Number(contentHeight) || 0,
      surface: String(displaySurface || ""),
    };
    const prev = lastSourceRef.current;
    const sourceChanged = (prev.width || prev.height)
      && (
        dimensionsChanged(prev, nextSource)
        || prev.surface !== nextSource.surface
      );
    if (sourceChanged) {
      engine.machine.disable();
      sourceRevisionRef.current += 1;
      if (localSharing && canManage) engine.clearAll();
      annDebug("source-change", {
        from: prev,
        to: nextSource,
        sourceRevision: sourceRevisionRef.current,
      });
    }
    lastSourceRef.current = nextSource;
    engine.setLayout(
      {
        content: layout.content,
        sourceRevision: localSharing ? sourceRevisionRef.current : engine.store.sourceRevision,
      },
      {
        cssWidth: layout.content.width,
        cssHeight: layout.content.height,
        dpr: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
    );
    annDebug("layout", {
      sourceWidth: contentWidth,
      sourceHeight: contentHeight,
      displaySurface,
      container: hostBox,
      contentRect: layout.content,
      dpr: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      sourceRevision: sourceRevisionRef.current,
    });
  }, [layout, contentWidth, contentHeight, displaySurface, localSharing, canManage, hostBox]);

  useEffect(() => {
    engineRef.current?.setLasers(lasersToList(remoteLasers));
  }, [remoteLasers]);

  useEffect(() => {
    if (active) setToolbarDismissed(false);
    else setTool(TOOLS.POINTER);
  }, [active]);

  useEffect(() => {
    if (active) return undefined;
    const pip = pipWindowRef.current;
    pipWindowRef.current = null;
    setPipWindow(null);
    closeDocumentPipWindow(pip);
    return undefined;
  }, [active]);

  useEffect(() => () => {
    closeDocumentPipWindow(pipWindowRef.current);
    pipWindowRef.current = null;
  }, []);

  const openPip = async () => {
    if (!documentPipAvailable()) return;
    const win = await openDocumentPipWindow();
    if (!win) {
      setPipFailed(true);
      return;
    }
    pipWindowRef.current = win;
    setPipWindow(win);
    setPipFailed(false);
    const onClose = () => {
      if (pipWindowRef.current === win) {
        pipWindowRef.current = null;
        setPipWindow(null);
      }
    };
    win.addEventListener("pagehide", onClose);
    win.addEventListener("unload", onClose);
  };

  useEffect(() => {
    if (!active || !localSharing || pipWindow || pipFailed) return undefined;
    if (!plan.pipAvailable) return undefined;
    let cancelled = false;
    void openDocumentPipWindow().then((win) => {
      if (cancelled) {
        closeDocumentPipWindow(win);
        return;
      }
      if (!win) {
        setPipFailed(true);
        return;
      }
      pipWindowRef.current = win;
      setPipWindow(win);
      const onClose = () => {
        if (pipWindowRef.current === win) {
          pipWindowRef.current = null;
          setPipWindow(null);
        }
      };
      win.addEventListener("pagehide", onClose);
    });
    return () => {
      cancelled = true;
    };
  }, [active, localSharing, plan.pipAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  const content = layout?.content;
  const toolbar = toolbarDismissed ? (
    <button
      type="button"
      className="ss-ann-v2-reopen"
      onClick={() => setToolbarDismissed(false)}
      title="Аннотации демонстрации"
    >
      Аннотации
    </button>
  ) : (
    <PresenterToolbar
      tool={tool}
      color={color}
      width={width}
      canAnnotate={canAnnotate}
      canManage={canManage}
      canUndo={canAnnotate}
      participantsCanAnnotate={participantsCanAnnotate}
      pipAvailable={plan.pipAvailable && !pipWindow}
      pipOpen={Boolean(pipWindow)}
      hint={localSharing && !plan.platformTab && !pipWindow && plan.pipAvailable
        ? "Открепите панель, чтобы она осталась поверх других окон"
        : ""}
      onToolChange={(next) => {
        setToolbarDismissed(false);
        setTool(next);
      }}
      onColorChange={setColor}
      onWidthChange={setWidth}
      onUndo={() => engineRef.current?.undo()}
      onClearMine={() => engineRef.current?.clearMine()}
      onClearAll={() => engineRef.current?.clearAll()}
      onSetParticipantsCanAnnotate={onSetParticipantsCanAnnotate}
      onClose={() => {
        setTool(TOOLS.POINTER);
        engineRef.current?.setDrawingEnabled(false);
        setToolbarDismissed(true);
      }}
      onOpenPip={() => void openPip()}
      onPointerDownDrag={pipWindow ? undefined : drag.onPointerDown}
    />
  );

  const toolbarPortal = pipWindow?.document?.body
    ? createPortal(toolbar, pipWindow.document.body)
    : (toolbar && createPortal(
      <div
        ref={drag.nodeRef}
        className={`ss-ann-v2-toolbar-slot${compact ? " is-compact" : ""}`}
        style={{
          ...drag.style,
          transform: drag.positioned ? "none" : undefined,
        }}
      >
        {toolbar}
      </div>,
      document.body,
    ));

  return (
    <>
      {content ? (
        <canvas
          ref={canvasRef}
          className={`ss-ann-v2-canvas${drawing && !usePlatformOverlay ? " is-drawing" : ""}`}
          style={{
            left: content.left,
            top: content.top,
            width: content.width,
            height: content.height,
          }}
        />
      ) : null}
      {usePlatformOverlay ? createPortal(
        <canvas
          ref={viewportCanvasRef}
          className="ss-ann-v2-platform is-drawing"
        />,
        document.body,
      ) : null}
      {toolbarPortal}
    </>
  );
}
