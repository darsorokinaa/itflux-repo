import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./cabinet-floating-menu.css";

export default function CabinetFloatingMenu({
  open,
  anchorEl,
  onClose,
  children,
  className = "cb-files__menu",
  align = "right",
  width = 228,
  placement = "anchor",
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorEl || placement === "sheet") return undefined;

    const place = () => {
      const rect = anchorEl.getBoundingClientRect();
      const menuWidth = width;
      const estimatedHeight = 280;
      let left = align === "right" ? rect.right - menuWidth : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
      let top = rect.bottom + 6;
      if (top + estimatedHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - estimatedHeight - 6);
      }
      setPos({ top, left });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorEl, align, width, onClose, placement]);

  useLayoutEffect(() => {
    if (!open || placement !== "sheet") return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, placement, onClose]);

  if (!open || typeof document === "undefined") return null;

  const isSheet = placement === "sheet";

  return createPortal(
    <>
      <div
        className="cb-float-menu-catch"
        role="presentation"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose?.();
        }}
      />
      <div
        className={`${className} cb-float-menu${isSheet ? " cb-float-menu--sheet" : ""}`.trim()}
        role="menu"
        style={isSheet ? undefined : {
          "--cb-float-top": `${pos.top}px`,
          "--cb-float-left": `${pos.left}px`,
          minWidth: width,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
