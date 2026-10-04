import { useEffect, useState } from "react";
import { applyAppUpdate, getAppUpdateState, subscribeAppUpdate } from "../utils/appUpdate";
import { isAppUpdateUnsafe } from "../utils/appUpdateGuard";
import { isChunkRecoveryBlocked, subscribeChunkRecoveryBlocked } from "../utils/clientTelemetry";
import { isLiveSessionPath, requestHardReload } from "../utils/liveSessionGuard";
import "./AppUpdateBanner.css";

export default function AppUpdateBanner() {
  const [state, setState] = useState(() => getAppUpdateState());
  const [unsafe, setUnsafe] = useState(() => isAppUpdateUnsafe());
  const [liveSession, setLiveSession] = useState(() => isLiveSessionPath());
  const [chunkBlocked, setChunkBlocked] = useState(() => isChunkRecoveryBlocked());

  useEffect(() => subscribeAppUpdate(setState), []);
  useEffect(() => subscribeChunkRecoveryBlocked(setChunkBlocked), []);

  useEffect(() => {
    const tick = () => {
      setUnsafe(isAppUpdateUnsafe());
      setLiveSession(isLiveSessionPath());
    };
    tick();
    const id = window.setInterval(tick, 2000);
    window.addEventListener("popstate", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("popstate", tick);
    };
  }, []);

  const showUpdate = state.updateAvailable;
  const showChunk = chunkBlocked && liveSession;
  if (!showUpdate && !showChunk) return null;

  return (
    <div className="itflux-update-banner-stack">
      {showUpdate ? (
        <div className="itflux-update-banner" role="status" aria-live="polite">
          <div className="itflux-update-banner__text">
            {liveSession ? (
              <span>Доступно обновление приложения. Чтобы не прерывать урок, оно будет применено после выхода.</span>
            ) : (
              <>
                <strong>Доступна новая версия платформы</strong>
                {unsafe ? (
                  <span>Сохраните работу, затем обновите страницу.</span>
                ) : (
                  <span>Обновите, чтобы получить актуальный интерфейс и материалы.</span>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            className="itflux-update-banner__btn"
            onClick={() => applyAppUpdate({
              force: true,
              manual: true,
              reason: "user-banner",
              source: "AppUpdateBanner",
            })}
          >
            Обновить
          </button>
        </div>
      ) : null}
      {showChunk ? (
        <div className="itflux-update-banner" role="status" aria-live="polite" data-testid="chunk-recovery-banner">
          <div className="itflux-update-banner__text">
            <span>Не удалось загрузить часть интерфейса. Урок не будет перезагружен автоматически.</span>
          </div>
          <button
            type="button"
            className="itflux-update-banner__btn"
            onClick={() => requestHardReload({
              manual: true,
              reason: "chunk-manual",
              source: "AppUpdateBanner",
              navigate: () => window.location.reload(),
            })}
          >
            Обновить
          </button>
        </div>
      ) : null}
    </div>
  );
}
