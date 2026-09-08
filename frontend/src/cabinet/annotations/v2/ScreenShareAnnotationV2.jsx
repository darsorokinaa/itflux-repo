import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useElementClientRect } from "../useElementClientRect";
import { useFloatingDrag } from "../../useFloatingDrag";
import {
  HIGHLIGHTER_OPACITY_DEFAULT,
  TOOLS,
  isPassthroughTool,
  participantColor,
} from "../../screenshare/constants";
import { computeScreenShareContentRect } from "../../screenshare/contentRect";
import CabinetIcon from "../../CabinetIcons";
import { createAnnotationEngine } from "./engine";
import { annDebug, isAnnDebugEnabled } from "./debug";
import PresenterToolbar from "./PresenterToolbar";
import GeometryDebugOverlay from "./GeometryDebugOverlay";
import { useJitsiShareGeometry } from "./useJitsiShareGeometry";
import { GEOMETRY_STATUS } from "./jitsiGeometry";
import { resolvePresenterOverlayPlan } from "./overlays/presenterAdapter";
import { closeDocumentPipWindow } from "./overlays/documentPip";
import {
  collapsedAnnotationUi,
  openedAnnotationUi,
  shouldResetAnnotationUi,
  shouldShowAnnotationTrigger,
} from "./zoomSession";

function portalRoot() {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement || document.body;
}

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
  isPresenter = false,
  participantsCanAnnotate = false,
  showAuthorNames = false,
  presenterUserId = null,
  currentUserId = null,
  displayName = "",
  sessionId = "",
  contentWidth = 0,
  contentHeight = 0,
  displaySurface = "",
  localSharing = false,
  tileView = false,
  targetRef = null,
  jitsiOrigin = "",
  presenterJitsiId = "",
  remoteLasers = {},
  syncUnavailable = false,
  onEngineReady,
  onSend,
  onPointer,
  onSetParticipantsCanAnnotate,
  onSetShowAuthorNames,
}) {
  const canvasRef = useRef(null);
  const viewportCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const pipWindowRef = useRef(null);
  const sessionIdRef = useRef(sessionId);
  const onSendRef = useRef(onSend);
  const onPointerRef = useRef(onPointer);
  onSendRef.current = onSend;
  onPointerRef.current = onPointer;
  const [pipWindow, setPipWindow] = useState(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [tool, setTool] = useState(TOOLS.POINTER);
  const [color, setColor] = useState(() => participantColor(currentUserId));
  const [width, setWidth] = useState(2);
  const [opacity, setOpacity] = useState(HIGHLIGHTER_OPACITY_DEFAULT);
  const [fontSize, setFontSize] = useState(18);
  const [fontWeight, setFontWeight] = useState(650);
  const [stampKind, setStampKind] = useState("star");
  const [textDraft, setTextDraft] = useState(null);
  const [fsTick, setFsTick] = useState(0);
  const [iframeNode, setIframeNode] = useState(null);
  const [debugOn, setDebugOn] = useState(false);

  const hostBox = useElementClientRect(targetRef, {
    enabled: active,
    live: active,
  });

  useEffect(() => {
    if (!active) {
      setIframeNode(null);
      return undefined;
    }
    const host = targetRef?.current;
    const read = () => {
      const node = host?.querySelector?.("iframe") || null;
      setIframeNode((prev) => (prev === node ? prev : node));
    };
    read();
    const mo = typeof MutationObserver !== "undefined" && host
      ? new MutationObserver(read)
      : null;
    try { mo?.observe(host, { childList: true, subtree: true }); } catch { /* ignore */ }
    const timer = window.setInterval(read, 1000);
    return () => {
      mo?.disconnect();
      window.clearInterval(timer);
    };
  }, [active, targetRef]);

  const geometry = useJitsiShareGeometry({
    enabled: active,
    iframe: iframeNode,
    jitsiOrigin,
    shareSessionId: sessionId,
    presenterJitsiId,
  });

  const geometryExact = geometry.status === GEOMETRY_STATUS.EXACT && Boolean(geometry.contentRect);
  const drawing = Boolean(
    active
    && canAnnotate
    && toolbarOpen
    && !isPassthroughTool(tool)
    && geometryExact,
  );
  const plan = useMemo(
    () => resolvePresenterOverlayPlan({ localSharing, displaySurface }),
    [localSharing, displaySurface],
  );
  // Tab-viewport overlay would use a different space than viewers' contain-fit tile.
  const usePlatformOverlay = Boolean(active && plan.nativeAvailable && drawing);
  const layout = useMemo(() => {
    if (geometryExact && geometry.contentRect) {
      return computeScreenShareContentRect({
        hostRect: geometry.iframeRect || hostBox,
        contentWidth: geometry.videoWidth || contentWidth,
        contentHeight: geometry.videoHeight || contentHeight,
        compact,
        tileView,
        objectFit: geometry.objectFit,
        exactContentRect: geometry.contentRect,
        exactVideoRect: geometry.videoRect,
        geometryStatus: GEOMETRY_STATUS.EXACT,
      });
    }
    if (!hostBox) return null;
    return computeScreenShareContentRect({
      hostRect: hostBox,
      contentWidth,
      contentHeight,
      compact,
      tileView,
      geometryStatus: geometry.status === GEOMETRY_STATUS.WAITING
        ? GEOMETRY_STATUS.WAITING
        : GEOMETRY_STATUS.FALLBACK,
    });
  }, [
    geometryExact,
    geometry.contentRect,
    geometry.videoRect,
    geometry.iframeRect,
    geometry.videoWidth,
    geometry.videoHeight,
    geometry.objectFit,
    geometry.status,
    hostBox,
    contentWidth,
    contentHeight,
    compact,
    tileView,
  ]);

  const drag = useFloatingDrag({
    enabled: active && !pipWindow,
    storageKey: "itflux.ssAnn.toolbar",
    handleSelector: ".ss-ann-v2-toolbar__grip",
  });

  useEffect(() => {
    if (!active) return undefined;
    const engine = createAnnotationEngine({
      authorId: currentUserId,
      displayName,
      sourceWidth: contentWidth || 1920,
      canAnnotate,
      canManage,
      isPresenter: Boolean(isPresenter || localSharing),
      showAuthorNames,
      presenterUserId: presenterUserId ?? currentUserId,
      sessionId,
      onSend: (...args) => onSendRef.current?.(...args),
      onPointer: (...args) => onPointerRef.current?.(...args),
      onTextRequest: (point) => {
        setTextDraft({ x: point.x, y: point.y, value: "" });
      },
    });
    engineRef.current = engine;
    onEngineReady?.(engine);
    annDebug("engine-ready", { sessionId, displaySurface, localSharing });
    return () => {
      onEngineReady?.(null);
      engine.dispose();
      engineRef.current = null;
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps -- overlay lifetime; session swap is setSessionId

  useEffect(() => {
    engineRef.current?.setSessionId(sessionId);
  }, [sessionId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setCanAnnotate(canAnnotate);
    engine.setCanManage(canManage);
    engine.setIsPresenter(Boolean(isPresenter || localSharing));
    engine.setShowAuthorNames(showAuthorNames);
    engine.setPresenterUserId(presenterUserId ?? currentUserId);
    engine.setTool(tool);
    engine.setColor(color);
    engine.setWidth(width);
    engine.setOpacity(opacity);
    engine.setFontSize(fontSize);
    engine.setFontWeight(fontWeight);
    engine.setStampKind(stampKind);
    engine.setDrawingEnabled(drawing && canAnnotate && geometryExact);
    engine.setSourceWidth(geometry.videoWidth || contentWidth || 1920);
    engine.setPointerSpace(usePlatformOverlay ? "viewport" : "content");
  }, [
    canAnnotate,
    canManage,
    isPresenter,
    localSharing,
    showAuthorNames,
    presenterUserId,
    currentUserId,
    tool,
    color,
    width,
    opacity,
    fontSize,
    fontWeight,
    stampKind,
    drawing,
    contentWidth,
    geometryExact,
    geometry.videoWidth,
    usePlatformOverlay,
  ]);

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
    engine.setLayout(
      { content: layout.content },
      {
        cssWidth: layout.content.width,
        cssHeight: layout.content.height,
        dpr: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
    );
    annDebug("layout", {
      sourceWidth: geometry.videoWidth || contentWidth,
      sourceHeight: geometry.videoHeight || contentHeight,
      displaySurface,
      container: hostBox,
      iframeRect: geometry.iframeRect,
      videoRect: geometry.videoRect,
      contentRect: layout.content,
      geometryStatus: geometry.status,
      shareSessionId: sessionId,
    });
  }, [layout, contentWidth, contentHeight, displaySurface, hostBox]);

  useEffect(() => {
    engineRef.current?.setLasers(lasersToList(remoteLasers));
  }, [remoteLasers]);

  useEffect(() => {
    const prevSessionId = sessionIdRef.current;
    sessionIdRef.current = sessionId;
    if (!shouldResetAnnotationUi({ active, prevSessionId, sessionId })) return;
    const next = collapsedAnnotationUi();
    setToolbarOpen(next.toolbarOpen);
    setTool(next.tool);
    setTextDraft(null);
  }, [active, sessionId]);

  useEffect(() => {
    if (canAnnotate) return;
    const next = collapsedAnnotationUi();
    setToolbarOpen(next.toolbarOpen);
    setTool(next.tool);
    setTextDraft(null);
  }, [canAnnotate]);

  useEffect(() => {
    setDebugOn(isAnnDebugEnabled());
  }, [active, fsTick]);

  useEffect(() => {
    const open = () => {
      const next = openedAnnotationUi();
      setToolbarOpen(next.toolbarOpen);
      setTool(next.tool);
    };
    window.addEventListener("itflux-ss-ann-open", open);
    const onFs = () => setFsTick((n) => n + 1);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("itflux-ss-ann-open", open);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  useEffect(() => {
    if (!active || !toolbarOpen) return undefined;
    const onKey = (event) => {
      const key = String(event.key || "");
      if (key === "Escape") {
        if (textDraft) {
          setTextDraft(null);
          return;
        }
        setTool(TOOLS.POINTER);
        engineRef.current?.setDrawingEnabled(false);
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const lower = key.toLowerCase();
      if (lower === "z" && event.shiftKey) {
        event.preventDefault();
        engineRef.current?.redo();
        return;
      }
      if (lower === "z") {
        event.preventDefault();
        engineRef.current?.undo();
        return;
      }
      if (lower === "y") {
        event.preventDefault();
        engineRef.current?.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, toolbarOpen, textDraft]);

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

  if (!active) return null;

  const content = geometryExact ? layout?.content : null;
  const dockRect = content || hostBox;
  const collapseToolbar = () => {
    const next = collapsedAnnotationUi();
    setTool(next.tool);
    setTextDraft(null);
    engineRef.current?.setDrawingEnabled(false);
    setToolbarOpen(next.toolbarOpen);
  };
  const openToolbar = () => {
    const next = openedAnnotationUi();
    setTool(next.tool);
    setToolbarOpen(next.toolbarOpen);
  };
  const showTrigger = shouldShowAnnotationTrigger({ active, canAnnotate });
  const presenter = Boolean(isPresenter || localSharing);
  const toolbar = toolbarOpen && showTrigger ? (
    <PresenterToolbar
      tool={tool}
      color={color}
      width={width}
      opacity={opacity}
      fontSize={fontSize}
      fontWeight={fontWeight}
      stampKind={stampKind}
      canAnnotate={canAnnotate && geometryExact}
      canManage={canManage}
      isPresenter={presenter}
      participantsCanAnnotate={participantsCanAnnotate}
      showAuthorNames={showAuthorNames}
      syncUnavailable={syncUnavailable}
      geometryStatus={geometry.status}
      onToolChange={setTool}
      onColorChange={setColor}
      onWidthChange={setWidth}
      onOpacityChange={setOpacity}
      onFontSizeChange={setFontSize}
      onFontWeightChange={setFontWeight}
      onStampKindChange={setStampKind}
      onUndo={() => engineRef.current?.undo()}
      onRedo={() => engineRef.current?.redo()}
      onClearMine={() => engineRef.current?.clearMine()}
      onClearViewers={() => engineRef.current?.clearViewers()}
      onClearAll={() => engineRef.current?.clearAll()}
      onSetParticipantsCanAnnotate={onSetParticipantsCanAnnotate}
      onSetShowAuthorNames={onSetShowAuthorNames}
      onDock={() => drag.reset?.()}
      onClose={collapseToolbar}
      onPointerDownDrag={pipWindow ? undefined : drag.onPointerDown}
    />
  ) : null;

  const host = portalRoot() || document.body;
  void fsTick;

  const viewH = typeof window !== "undefined"
    ? (window.visualViewport?.height || window.innerHeight)
    : 800;
  const defaultToolbarStyle = dockRect ? {
    left: Math.max(8, dockRect.left + 12),
    top: Math.max(8, Math.min(dockRect.top + dockRect.height - 92, viewH - 100)),
    right: "auto",
    bottom: "auto",
    transform: "none",
  } : undefined;

  const triggerStyle = dockRect ? {
    left: Math.max(8, dockRect.left + 12),
    top: Math.max(8, Math.min(dockRect.top + dockRect.height - 48, viewH - 56)),
    right: "auto",
    bottom: "auto",
    transform: "none",
  } : undefined;

  const toolbarPortal = !toolbar && !showTrigger
    ? null
    : pipWindow?.document?.body
      ? createPortal(toolbar, pipWindow.document.body)
      : createPortal(
        <div
          ref={drag.nodeRef}
          className={`ss-ann-v2-toolbar-slot${compact ? " is-compact" : ""}`}
          style={{
            ...(drag.positioned ? drag.style : (toolbar ? defaultToolbarStyle : triggerStyle)),
            transform: drag.positioned ? "none" : (toolbar ? defaultToolbarStyle?.transform : triggerStyle?.transform),
          }}
        >
          {toolbar || (showTrigger ? (
            <button
              type="button"
              className="ss-ann-v2-reopen"
              onClick={openToolbar}
              title="Аннотации"
              aria-expanded="false"
              aria-label="Аннотации"
            >
              <CabinetIcon name="pencil" />
              <span>Аннотации</span>
            </button>
          ) : null)}
        </div>,
        host,
      );

  const contentCanvas = content ? (
    <canvas
      ref={canvasRef}
      className={[
        "ss-ann-v2-canvas",
        drawing && !usePlatformOverlay ? "is-drawing" : "",
        tool === TOOLS.SELECT ? "is-select" : "",
      ].filter(Boolean).join(" ")}
      style={{
        left: content.left,
        top: content.top,
        width: content.width,
        height: content.height,
      }}
    />
  ) : null;

  const textEditor = textDraft && content ? createPortal(
    <input
      className="ss-ann-v2-text"
      autoFocus
      maxLength={280}
      value={textDraft.value}
      aria-label="Текст аннотации"
      style={{
        left: content.left + textDraft.x * content.width,
        top: content.top + textDraft.y * content.height - 18,
      }}
      onChange={(event) => setTextDraft((prev) => (prev ? { ...prev, value: event.target.value } : prev))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          engineRef.current?.commitText(textDraft, textDraft.value);
          setTextDraft(null);
        }
        if (event.key === "Escape") setTextDraft(null);
      }}
      onBlur={() => {
        if (textDraft.value.trim()) engineRef.current?.commitText(textDraft, textDraft.value);
        setTextDraft(null);
      }}
    />,
    host,
  ) : null;

  return (
    <>
      {contentCanvas ? createPortal(contentCanvas, host) : null}
      {usePlatformOverlay ? createPortal(
        <canvas
          ref={viewportCanvasRef}
          className="ss-ann-v2-platform is-drawing"
        />,
        host,
      ) : null}
      {textEditor}
      {toolbarPortal}
      <GeometryDebugOverlay
        enabled={debugOn}
        iframeRect={geometry.iframeRect}
        videoRect={geometry.videoRect}
        contentRect={geometry.contentRect}
        canvasRect={content}
        videoWidth={geometry.videoWidth}
        videoHeight={geometry.videoHeight}
        dpr={typeof window !== "undefined" ? window.devicePixelRatio : 1}
        shareSessionId={sessionId}
        status={geometry.status}
        surfaceKind={geometry.raw?.surfaceKind || ""}
        stageSurfaceFound={Boolean(geometry.raw?.stageSurfaceFound)}
        surfaceCandidateCount={Number(geometry.raw?.surfaceCandidateCount) || 0}
      />
    </>
  );
}
