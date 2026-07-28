import { useEffect, useState } from "react";
import {
  dismissInstallPrompt,
  isIosDevice,
  isStandaloneDisplay,
  wasInstallDismissed,
} from "./pwaHelpers";
import "./pwa-prompts.css";

/**
 * Shared install prompt — role-aware copy, one PWA for all roles.
 */
export default function PwaInstallPrompt({ role = "teacher" }) {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return !isStandaloneDisplay() && !wasInstallDismissed();
  });
  const [iosHelp, setIosHelp] = useState(false);

  const isTeacher = role !== "student";
  const title = "Установить Цифровой поток";
  const text = isTeacher
    ? "Добавьте платформу на экран телефона, чтобы получать уведомления об уроках, домашних заданиях и действиях учеников."
    : "Добавьте платформу на экран телефона, чтобы получать уведомления об уроках и домашних заданиях.";

  useEffect(() => {
    if (!visible) return undefined;

    const onBip = (event) => {
      event.preventDefault();
      setDeferred(event);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    dismissInstallPrompt();
    setVisible(false);
    setIosHelp(false);
  };

  const install = async () => {
    if (isIosDevice()) {
      setIosHelp(true);
      return;
    }
    if (deferred) {
      deferred.prompt();
      try {
        const choice = await deferred.userChoice;
        if (choice?.outcome === "accepted") {
          dismissInstallPrompt();
          setVisible(false);
        }
      } catch {
        /* ignore */
      }
      setDeferred(null);
      return;
    }
    setIosHelp(true);
  };

  return (
    <aside className="pwa-prompt pwa-prompt--install" role="region" aria-label={title}>
      <div className="pwa-prompt__body">
        <h3 className="pwa-prompt__title">{title}</h3>
        <p className="pwa-prompt__text">{text}</p>
        {iosHelp ? (
          <p className="pwa-prompt__hint">
            {isIosDevice()
              ? "На iPhone/iPad: «Поделиться» → «На экран „Домой“»."
              : "В меню браузера выберите «Установить приложение» или «Добавить на экран „Домой“»."}
          </p>
        ) : null}
      </div>
      <div className="pwa-prompt__actions">
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={install}>
          Установить приложение
        </button>
        <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={close}>
          Не сейчас
        </button>
      </div>
    </aside>
  );
}
