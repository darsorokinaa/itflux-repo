import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import SupportModal from "../cabinet/components/SupportModal";
import CabinetIcon from "../cabinet/CabinetIcons";
import { SUPPORT_OPEN_EVENT } from "../cabinet/support";
import "./SupportFab.css";

/**
 * Глобальная кнопка поддержки + единый SupportModal.
 * Слушает cabinet:open-support, чтобы меню кабинета открывало тот же попап.
 */
export default function SupportFab({ hidden = false }) {
  const [open, setOpen] = useState(false);

  const openSupport = useCallback(() => setOpen(true), []);
  const closeSupport = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (hidden && open) setOpen(false);
  }, [hidden, open]);

  if (hidden || typeof document === "undefined") return null;

  return (
    <>
      {createPortal(
        <button
          type="button"
          className="support-fab"
          onClick={openSupport}
          aria-label="Поддержка"
          title="Поддержка"
        >
          <CabinetIcon name="help" />
          <span className="support-fab__label">Помощь</span>
        </button>,
        document.body,
      )}
      <SupportModal open={open} onClose={closeSupport} />
    </>
  );
}
