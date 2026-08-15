import { useEffect, useState } from "react";
import {
  ensureCabinetPushSubscription,
  fetchPushDevices,
  fetchPushVapidKey,
  fetchNotificationPreferences,
  subscribeCabinetPush,
  sendPushTestNotification,
} from "../../utils/cabinetAuth";
import {
  dismissPushPrompt,
  notificationPermission,
  wasPushPromptDismissed,
} from "./pwaHelpers";
import "./pwa-prompts.css";

/**
 * Show enable prompt only when the browser has not granted permission yet.
 * If permission is already granted, restore the existing subscription silently.
 */
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
    if (perm === "unsupported" || perm === "denied" || wasPushPromptDismissed()) {
      setVisible(false);
      return undefined;
    }

    (async () => {
      const vapid = await fetchPushVapidKey().catch(() => ({ configured: false }));
      if (cancelled) return;
      const ok = Boolean(vapid?.configured);
      setConfigured(ok);
      if (!ok) {
        setVisible(false);
        return;
      }

      if (perm === "granted") {
        const restored = await ensureCabinetPushSubscription().catch(() => null);
        if (cancelled) return;
        if (restored?.ok || restored?.device) {
          setVisible(false);
          return;
        }
        if (restored?.needs_user_gesture) {
          setVisible(true);
          return;
        }
        setVisible(false);
        return;
      }

      const [devices, prefs] = await Promise.all([
        fetchPushDevices().catch(() => ({ active_count: 0 })),
        fetchNotificationPreferences().catch(() => null),
      ]);
      if (cancelled) return;
      if (prefs && prefs.push_enabled === false) {
        setVisible(false);
        return;
      }
      const needsSubscribe = (devices?.active_count || 0) === 0;
      setVisible(needsSubscribe);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  const enable = async () => {
    setBusy(true);
    setError("");
    try {
      await subscribeCabinetPush("", { mode: "enable" });
      try {
        await sendPushTestNotification();
      } catch {
        /* test is best-effort */
      }
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
