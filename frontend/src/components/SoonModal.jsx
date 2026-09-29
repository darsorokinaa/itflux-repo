import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./SoonModal.css";

export default function SoonModal({ title, onClose }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="soon-modal" role="presentation" onClick={onClose}>
      <div
        className="soon-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soon-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="soon-modal__kicker">Скоро</p>
        <h2 id="soon-modal-title">{title}</h2>
        <p>Скоро будет доступно.</p>
        <button type="button" onClick={onClose}>Понятно</button>
      </div>
    </div>
  );
}

export function WorksheetSoonPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const home = location.pathname.startsWith("/cabinet") ? "/cabinet" : "/";
  return (
    <SoonModal
      title="Конструктор материалов"
      onClose={() => navigate(home, { replace: true })}
    />
  );
}
