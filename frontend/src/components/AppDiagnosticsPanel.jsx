import { useEffect, useState } from "react";
import { collectAppDiagnostics } from "../utils/appDiagnostics";
import { getAppBuildTime, getAppVersion } from "../utils/appVersion";

export default function AppDiagnosticsPanel() {
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    collectAppDiagnostics()
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Не удалось собрать диагностику");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <section className="cb-notify-card" aria-label="Версия платформы">
      <header className="cb-notify-card__head">
        <h2 className="cb-notify-card__title">Версия платформы</h2>
        <p className="cb-notify-card__sub">
          Сборка: <code>{getAppVersion()}</code>
          {getAppBuildTime() ? <> · {getAppBuildTime()}</> : null}
        </p>
      </header>
      <button
        type="button"
        className="cb-btn cb-btn--outline cb-btn--sm"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Скрыть диагностику" : "Показать диагностику обновления"}
      </button>
      {error ? <p className="cb-notify-alert cb-notify-alert--error">{error}</p> : null}
      {open && info ? (
        <pre
          className="cb-notify-card__sub"
          style={{
            marginTop: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: "0.72rem",
            maxHeight: 320,
            overflow: "auto",
          }}
        >
          {JSON.stringify(
            {
              appVersion: info.appVersion,
              buildTime: info.buildTime,
              dataSchemaVersion: info.dataSchemaVersion,
              updateAvailable: info.updateAvailable,
              remoteVersion: info.remoteVersion,
              apiReachable: info.apiReachable,
              standalone: info.standalone,
              serviceWorker: info.serviceWorker,
              caches: info.caches,
              loadedScripts: info.loadedScripts,
            },
            null,
            2,
          )}
        </pre>
      ) : null}
    </section>
  );
}
