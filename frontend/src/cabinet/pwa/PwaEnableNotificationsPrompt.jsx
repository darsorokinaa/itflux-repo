import { useEffect, useState } from "react";
import {
  fetchPushDevices,
  fetchPushVapidKey,
  subscribeCabinetPush,
  sendPushTestNotification,
} from "../../utils/cabinetAuth";
import {
  clearPushPromptDismiss,
  dismissPushPrompt,
  notificationPermission,
  wasPushPromptDismissed,
} from "./pwaHelpers";
import "./pwa-prompts.css";

export default function PwaEnableNotificationsPrompt({ role = "teacher", onEnabled }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);

  const isTeacher = role !== "student";
  const title = isTeacher
    ? "Будьте в курсе расписания и работ учеников"
    : "Будьте в курсе уроков и заданий";
  const text = isTeacher
    ? "Включите уведомления, чтобы получать напоминания об уроках, выполненных домашних заданиях, переносах и других важных событиях."
    : "Включите уведомления, чтобы получать напоминания об уроках, домашних заданиях и изменениях расписания.";

  useEffect(() => {
    let cancelled = false;
    const perm = notificationPermission();
    if (perm === "granted" || perm === "unsupported" || wasPushPromptDismissed()) {
      setVisible(false);
      return undefined;
    }

    Promise.all([
      fetchPushVapidKey().catch(() => ({ configured: false })),
      fetchPushDevices().catch(() => ({ active_count: 0 })),
    ]).then(([vapid, devices]) => {
      if (cancelled) return;
      setConfigured(Boolean(vapid?.configured));
      if (vapid?.configured && (devices?.active_count || 0) === 0) {
        setVisible(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      await subscribeCabinetPush();
      try {
        await sendPushTestNotification();
      } catch {
        /* test is best-effort */
      }
      clearPushPromptDismiss();
      setVisible(false);
      onEnabled?.();
    } catch (err) {
      setError(err?.message || "Не удалось включить уведомления");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    dismissPushPrompt();
    setVisible(false);
  };

  return (
    <aside className="pwa-prompt pwa-prompt--push" role="region" aria-label={title}>
      <div className="pwa-prompt__body">
        <h3 className="pwa-prompt__title">{title}</h3>
        <p className="pwa-prompt__text">{text}</p>
        {!configured ? (
          <p className="pwa-prompt__hint">
            Канал Web Push на сервере ещё настраивается. Пока можно пользоваться уведомлениями в кабинете и Telegram.
          </p>
        ) : null}
        {error ? <p className="pwa-prompt__error">{error}</p> : null}
      </div>
      <div className="pwa-prompt__actions">
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-btn--sm"
          disabled={busy || !configured}
          onClick={enable}
        >
          {busy ? "Подключаем…" : "Включить уведомления"}
        </button>
        <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={close} disabled={busy}>
          Позже
        </button>
      </div>
    </aside>
  );
}
