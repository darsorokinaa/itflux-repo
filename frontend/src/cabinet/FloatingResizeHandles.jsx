import { FLOATING_RESIZE_EDGES } from "./useFloatingDrag";

export default function FloatingResizeHandles({ onPointerDown, disabled = false }) {
  if (disabled) return null;
  return (
    <>
      {FLOATING_RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          data-resize={edge}
          className={`vl-resize-handle vl-resize-handle--${edge}`}
          onPointerDown={(event) => onPointerDown?.(event, edge)}
        />
      ))}
    </>
  );
}
