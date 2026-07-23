import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTelegramStatus, openTelegramConnect } from "../../utils/cabinetAuth";

const DISMISS_KEY = "cabinet_telegram_prompt_dismissed";

/** Временно скрыто везде — вернуть в `true`, когда промпт снова нужен. */
const TELEGRAM_CONNECT_PROMPT_ENABLED = false;

export default function TelegramConnectPrompt({ settingsPath = "/cabinet/settings/notifications/" }) {
  const [visible, setVisible] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!TELEGRAM_CONNECT_PROMPT_ENABLED) return undefined;
    let cancelled = false;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return undefined;
    } catch {
      // ignore
    }
    fetchTelegramStatus()
      .then((status) => {
        if (cancelled) return;
        if (status?.connected) {
          setVisible(false);
          return;
        }
        if (status?.bot_configured === false) {
          setVisible(false);
          return;
        }
        setVisible(true);
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!TELEGRAM_CONNECT_PROMPT_ENABLED || !visible) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError("");
    try {
      await openTelegramConnect();
    } catch (err) {
      setError(err.message || "Не удалось открыть Telegram");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <aside className="cb-telegram-prompt" aria-label="Подключение Telegram">
      <div className="cb-telegram-prompt__body">
        <p className="cb-telegram-prompt__title">
          Получайте напоминания об уроках и заданиях в Telegram
        </p>
        <p className="cb-telegram-prompt__text">Подключение займёт несколько секунд.</p>
        {error ? <p className="cb-telegram-prompt__error" role="alert">{error}</p> : null}
        <div className="cb-telegram-prompt__actions">
          <button
            type="button"
            className="cb-btn cb-btn--primary cb-btn--pill"
            disabled={connecting}
            onClick={handleConnect}
          >
            {connecting ? "Открываем…" : "Подключить Telegram"}
          </button>
          <Link to={settingsPath} className="cb-telegram-prompt__link">
            Настройки уведомлений
          </Link>
          <button type="button" className="cb-telegram-prompt__dismiss" onClick={dismiss}>
            Позже
          </button>
        </div>
      </div>
    </aside>
  );
}
