import { createPortal } from "react-dom";

function Box({ rect, color, label }) {
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return (
    <div
      className="ss-ann-v2-geom-box"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        borderColor: color,
        color,
      }}
    >
      <span>{label}</span>
    </div>
  );
}

function fmt(rect) {
  if (!rect) return "—";
  return `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

export default function GeometryDebugOverlay({
  enabled = false,
  iframeRect = null,
  videoRect = null,
  contentRect = null,
  canvasRect = null,
  videoWidth = 0,
  videoHeight = 0,
  dpr = 1,
  shareSessionId = "",
  status = "",
  surfaceKind = "",
  stageSurfaceFound = false,
  surfaceCandidateCount = 0,
}) {
  if (!enabled || typeof document === "undefined") return null;
  const host = document.fullscreenElement || document.body;
  return createPortal(
    <div className="ss-ann-v2-geom-debug" aria-hidden="true">
      <Box rect={iframeRect} color="#f43f5e" label="iframe" />
      <Box rect={videoRect} color="#f59e0b" label="video" />
      <Box rect={contentRect} color="#22c55e" label="content" />
      <Box rect={canvasRect} color="#38bdf8" label="canvas" />
      <pre className="ss-ann-v2-geom-debug__log">
{`status ${status}
session ${shareSessionId || "—"}
video ${videoWidth}×${videoHeight}
dpr ${dpr}
surface ${surfaceKind || "—"} stage=${stageSurfaceFound ? "yes" : "no"} n=${surfaceCandidateCount}
iframe ${fmt(iframeRect)}
videoEl ${fmt(videoRect)}
content ${fmt(contentRect)}
canvas ${fmt(canvasRect)}`}
      </pre>
    </div>,
    host,
  );
}
