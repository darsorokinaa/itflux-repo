import { useEffect, useState } from "react";
import { applyAppUpdate, getAppUpdateState, subscribeAppUpdate } from "../utils/appUpdate";
import { isAppUpdateUnsafe } from "../utils/appUpdateGuard";
import "./AppUpdateBanner.css";

export default function AppUpdateBanner() {
  const [state, setState] = useState(() => getAppUpdateState());
  const [unsafe, setUnsafe] = useState(() => isAppUpdateUnsafe());

  useEffect(() => subscribeAppUpdate(setState), []);

  useEffect(() => {
    const tick = () => setUnsafe(isAppUpdateUnsafe());
    tick();
    const id = window.setInterval(tick, 2000);
    window.addEventListener("popstate", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("popstate", tick);
    };
  }, []);

  if (!state.updateAvailable) return null;

  return (
    <div className="itflux-update-banner" role="status" aria-live="polite">
      <div className="itflux-update-banner__text">
        <strong>Доступна новая версия платформы</strong>
        {unsafe ? (
          <span>Сохраните работу, затем обновите страницу.</span>
        ) : (
          <span>Обновите, чтобы получить актуальный интерфейс и материалы.</span>
        )}
      </div>
      <button
        type="button"
        className="itflux-update-banner__btn"
        onClick={() => applyAppUpdate({ force: true })}
      >
        Обновить
      </button>
    </div>
  );
}
