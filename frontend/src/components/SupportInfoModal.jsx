import { useEffect, useRef, useState } from "react";
import MathContent from "./MathContent";

const MOBILE_BREAKPOINT = 768;

function getInitialLayout() {
  if (typeof window === "undefined") return { pos: { x: 80, y: 80 }, size: { w: 480, h: 420 } };
  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
  if (isMobile) {
    const w = window.innerWidth * 0.92;
    const h = Math.min(window.innerHeight * 0.65, 400);
    const x = (window.innerWidth - w) / 2;
    const y = Math.max(12, window.innerHeight * 0.08);
    return { pos: { x, y }, size: { w, h } };
  }
  return { pos: { x: 80, y: 80 }, size: { w: 480, h: 420 } };
}

/**
 * Перетаскиваемое и масштабируемое окно со справочной информацией.
 */
export default function SupportInfoModal({ open, items = [], onClose }) {
  const [pos, setPos] = useState(() => getInitialLayout().pos);
  const [size, setSize] = useState(() => getInitialLayout().size);
  const startRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  useEffect(() => {
    if (!open) return;
    const layout = getInitialLayout();
    setPos(layout.pos);
    setSize(layout.size);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleHeaderMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
    const onMove = (ev) => {
      const dx = ev.clientX - startRef.current.x;
      const dy = ev.clientY - startRef.current.y;
      setPos((p) => ({
        x: Math.max(0, startRef.current.posX + dx),
        y: Math.max(0, startRef.current.posY + dy),
      }));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const handleResizeStart = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.w,
      h: size.h,
    };
    const onMove = (ev) => {
      const dx = ev.clientX - resizeRef.current.x;
      const dy = ev.clientY - resizeRef.current.y;
      setSize((s) => ({
        w: Math.max(320, resizeRef.current.w + dx),
        h: Math.max(200, resizeRef.current.h + dy),
      }));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  if (!open) return null;

  return (
    <div className="support-info-overlay" onClick={onClose}>
      <div
        className="support-info-window"
        style={{
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="support-info-header"
          onPointerDown={handleHeaderMouseDown}
          style={{ cursor: "grab", touchAction: "none" }}
        >
          <span className="support-info-title">Справочная информация</span>
          <button
            type="button"
            className="support-info-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div className="support-info-body">
          {items && items.length > 0 ? (
            items.map((item, i) => (
              <div key={i} className="support-info-item">
                <MathContent html={item.html} className="support-info-content" />
              </div>
            ))
          ) : (
            <p className="support-info-empty">Нет справочной информации</p>
          )}
        </div>
        <div
          className="support-info-resize-handle"
          onPointerDown={handleResizeStart}
          title="Изменить размер"
        />
      </div>
    </div>
  );
}
