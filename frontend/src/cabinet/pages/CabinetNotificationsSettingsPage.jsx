import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  disconnectTelegram,
  fetchCabinetSession,
  fetchNotificationPreferences,
  getCabinetHomePath,
  isTeacherRole,
  openTelegramConnect,
  sendTelegramTestNotification,
  updateNotificationPreferences,
} from "../../utils/cabinetAuth";
import "../styles/notifications-settings.css";

const TOGGLE_FIELDS = [
  { key: "notify_lesson_created", label: "Новые занятия" },
  { key: "notify_lesson_moved", label: "Перенос занятий" },
  { key: "notify_lesson_cancelled", label: "Отмена занятий" },
  { key: "notify_lesson_updated", label: "Изменения занятий" },
  { key: "notify_homework", label: "Домашние задания" },
  { key: "notify_review", label: "Результаты проверки" },
  { key: "notify_journal_results", label: "Итоги урока опубликованы" },
  { key: "notify_journal_comment", label: "Комментарий учителя (в итогах)" },
  { key: "notify_journal_recommendation", label: "Новая рекомендация" },
];

const JOURNAL_TEACHER_FIELDS = [
  { key: "notify_journal_daily_digest", label: "Ежедневная сводка журнала" },
];

const BILLING_TEACHER_FIELDS = [
  { key: "notify_payment_received", label: "Поступила оплата" },
  { key: "notify_package_low", label: "Заканчивается абонемент" },
  { key: "notify_debt_created", label: "Возникла задолженность" },
  { key: "notify_billing_daily_digest", label: "Ежедневная финансовая сводка" },
  { key: "notify_billing_weekly_digest", label: "Еженедельная финансовая сводка" },
];

const BILLING_STUDENT_FIELDS = [
  { key: "notify_student_payment_recorded", label: "Оплата зафиксирована" },
  { key: "notify_student_package_low", label: "Осталось мало занятий или минут" },
  { key: "notify_student_package_ended", label: "Абонемент закончился" },
  { key: "notify_student_unpaid_lesson", label: "Есть неоплаченный урок" },
  { key: "notify_student_payment_due", label: "Приближается срок оплаты" },
];

export default function CabinetNotificationsSettingsPage() {
  const location = useLocation();
  const [sessionUser, setSessionUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Уведомления — Личный кабинет";
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((data) => {
        if (!cancelled) setSessionUser(data?.authenticated ? data.user : null);
      })
      .catch(() => {
        if (!cancelled) setSessionUser(null);
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = async () => {
    const data = await fetchNotificationPreferences();
    setPrefs(data);
  };

  useEffect(() => {
    if (!sessionUser) return undefined;
    let cancelled = false;
    fetchNotificationPreferences()
      .then((data) => {
        if (!cancelled) setPrefs(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить настройки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  if (sessionLoading) {
    return (
      <div className="cabinet-auth-page">
        <div className="cabinet-auth-card">
          <p className="cabinet-auth-muted">Проверяем сессию…</p>
        </div>
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <Navigate
        to="/cabinet/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  const homePath = getCabinetHomePath(sessionUser);
  const backLabel = isTeacherRole(sessionUser) ? "В кабинет учителя" : "В кабинет ученика";

  const runAction = async (key, fn, successText) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await fn();
      await reload();
      if (successText) setMessage(successText);
    } catch (err) {
      setError(err.message || "Ошибка");
    } finally {
      setBusy("");
    }
  };

  const handleToggle = async (field, checked) => {
    setPrefs((prev) => (prev ? { ...prev, [field]: checked } : prev));
    try {
      const data = await updateNotificationPreferences({ [field]: checked });
      setPrefs(data);
    } catch (err) {
      setError(err.message || "Не удалось сохранить");
      await reload();
    }
  };

  const handleDigestHour = async (value) => {
    const hour = Number(value);
    setPrefs((prev) => (prev ? { ...prev, digest_hour: hour } : prev));
    try {
      const data = await updateNotificationPreferences({ digest_hour: hour });
      setPrefs(data);
      setMessage("Время сводки сохранено");
    } catch (err) {
      setError(err.message || "Не удалось сохранить");
      await reload();
    }
  };

  return (
    <div className="cabinet-auth-page">
      <div className="cabinet-auth-card cb-notify-settings" style={{ maxWidth: 560, textAlign: "left" }}>
        <p style={{ marginBottom: "0.75rem" }}>
          <Link to={homePath} className="cabinet-auth-link">{backLabel}</Link>
        </p>
        <header className="cb-notify-settings__head">
          <h1 className="cabinet-auth-title" style={{ fontSize: "1.45rem" }}>Уведомления</h1>
          <p className="cabinet-auth-muted">
            Подключите Telegram и выберите, о чём вам напоминать.
          </p>
        </header>

        {error ? <p className="cabinet-auth-error" role="alert">{error}</p> : null}
        {message ? <p className="cb-notify-settings__ok" role="status">{message}</p> : null}

        {loading || !prefs ? (
          <p className="cabinet-auth-muted">Загрузка настроек…</p>
        ) : (
          <>
            <section className="cb-notify-settings__card">
              <h2>Telegram</h2>
              {prefs.connected ? (
                <>
                  <p>
                    Статус: <strong>подключён</strong>
                    {prefs.telegram_username ? ` (@${prefs.telegram_username})` : ""}
                  </p>
                  <div className="cb-notify-settings__actions">
                    <button
                      type="button"
                      className="cb-btn cb-btn--outline"
                      disabled={Boolean(busy)}
                      onClick={() => runAction("test", () => sendTelegramTestNotification(), "Тестовое сообщение отправлено")}
                    >
                      {busy === "test" ? "Отправляем…" : "Отправить тестовое уведомление"}
                    </button>
                    <button
                      type="button"
                      className="cb-btn cb-btn--outline"
                      disabled={Boolean(busy)}
                      onClick={() => runAction("reconnect", () => openTelegramConnect(), "Открыт Telegram для повторного подключения")}
                    >
                      {busy === "reconnect" ? "Открываем…" : "Подключить заново"}
                    </button>
                    <button
                      type="button"
                      className="cb-btn cb-btn--outline"
                      disabled={Boolean(busy)}
                      onClick={() => runAction("disconnect", () => disconnectTelegram(), "Telegram отключён")}
                    >
                      {busy === "disconnect" ? "Отключаем…" : "Отключить Telegram"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>Telegram не подключён. Напоминания можно получать в мессенджере.</p>
                  <button
                    type="button"
                    className="cb-btn cb-btn--primary"
                    disabled={Boolean(busy) || prefs.bot_configured === false}
                    onClick={() => runAction("connect", () => openTelegramConnect())}
                  >
                    {busy === "connect" ? "Открываем…" : "Подключить Telegram"}
                  </button>
                  {prefs.bot_configured === false ? (
                    <p className="cabinet-auth-muted">Подключение временно недоступно.</p>
                  ) : null}
                </>
              )}
            </section>

            <section className="cb-notify-settings__card">
              <h2>Типы уведомлений</h2>
              <ul className="cb-notify-settings__toggles">
                {TOGGLE_FIELDS.map((field) => (
                  <li key={field.key}>
                    <label className="st-toggle-row">
                      <span>{field.label}</span>
                      <input
                        type="checkbox"
                        checked={prefs[field.key] !== false}
                        onChange={(e) => handleToggle(field.key, e.target.checked)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <section className="cb-notify-settings__card">
              <h2>Время сводки</h2>
              <label className="cb-field">
                <span>Час ежедневной сводки</span>
                <select
                  value={prefs.digest_hour ?? 19}
                  onChange={(e) => handleDigestHour(e.target.value)}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {isTeacherRole(sessionUser) ? (
            <section className="cb-notify-settings__card">
              <h2>Журнал — учителю</h2>
              <ul className="cb-notify-settings__toggles">
                {JOURNAL_TEACHER_FIELDS.map((field) => (
                  <li key={field.key}>
                    <label className="st-toggle-row">
                      <span>{field.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(prefs[field.key])}
                        onChange={(e) => handleToggle(field.key, e.target.checked)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </section>
            ) : null}

            <section className="cb-notify-settings__card">
              <h2>Оплаты — учителю</h2>
              <p className="cabinet-auth-muted">Через уже подключённый Telegram, без новых ссылок.</p>
              <ul className="cb-notify-settings__toggles">
                {BILLING_TEACHER_FIELDS.map((field) => (
                  <li key={field.key}>
                    <label className="st-toggle-row">
                      <span>{field.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(prefs[field.key])}
                        onChange={(e) => handleToggle(field.key, e.target.checked)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <section className="cb-notify-settings__card">
              <h2>Оплаты — ученику</h2>
              <p className="cabinet-auth-muted">
                Ученику уходят только если вы включили уведомления для конкретного ученика в разделе «Оплаты».
              </p>
              <ul className="cb-notify-settings__toggles">
                {BILLING_STUDENT_FIELDS.map((field) => (
                  <li key={field.key}>
                    <label className="st-toggle-row">
                      <span>{field.label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(prefs[field.key])}
                        onChange={(e) => handleToggle(field.key, e.target.checked)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
