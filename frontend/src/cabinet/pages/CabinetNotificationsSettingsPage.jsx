import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  disconnectTelegram,
  fetchCabinetSession,
  fetchNotificationPreferences,
  fetchPushDevices,
  getCabinetHomePath,
  isTeacherRole,
  openTelegramConnect,
  sendPushTestNotification,
  sendTelegramTestNotification,
  subscribeCabinetPush,
  unsubscribeCabinetPushDevice,
  updateNotificationPreferences,
} from "../../utils/cabinetAuth";
import "../styles/notifications-settings.css";

const TOGGLE_FIELDS = [
  { key: "notify_lesson_created", label: "Новые занятия" },
  { key: "notify_lesson_moved", label: "Перенос занятий" },
  { key: "notify_lesson_cancelled", label: "Отмена занятий" },
  { key: "notify_lesson_updated", label: "Изменения занятий" },
  { key: "notify_homework", label: "Домашние задания / работы на проверку" },
  { key: "notify_review", label: "Результаты проверки" },
  { key: "notify_journal_results", label: "Итоги урока опубликованы" },
  { key: "notify_journal_comment", label: "Комментарий учителя (в итогах)" },
  { key: "notify_journal_recommendation", label: "Новая рекомендация" },
];

const TEACHER_EXTRA_FIELDS = [
  { key: "notify_new_student", label: "Новые ученики" },
  { key: "notify_homework_resubmitted", label: "Исправленные работы" },
  { key: "notify_overdue_homework", label: "Просроченные задания" },
  { key: "notify_student_message", label: "Сообщения учеников" },
  { key: "notify_student_entered_room", label: "Ученик вошёл в комнату" },
  { key: "notify_student_absent", label: "Ученик не подключился" },
  { key: "notify_auto_check_attention", label: "Автопроверка требует внимания" },
  { key: "notify_system", label: "Системные события" },
  { key: "notify_daily_schedule", label: "Расписание на день" },
  { key: "notify_daily_schedule_empty", label: "Сообщать, что сегодня уроков нет" },
];

const REMINDER_OPTIONS = [
  { minutes: 1440, label: "За 24 часа" },
  { minutes: 60, label: "За 1 час" },
  { minutes: 10, label: "За 10 минут" },
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
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isTeacher = isTeacherRole(sessionUser);

  useEffect(() => {
    document.title = "Настройки уведомлений — Личный кабинет";
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
    const [data, pushDevices] = await Promise.all([
      fetchNotificationPreferences(),
      fetchPushDevices().catch(() => ({ devices: [] })),
    ]);
    setPrefs(data);
    setDevices(pushDevices?.devices || []);
  };

  useEffect(() => {
    if (!sessionUser) return undefined;
    let cancelled = false;
    reload()
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
  const backLabel = isTeacher ? "В кабинет учителя" : "В кабинет ученика";

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

  const handleSelect = async (field, value) => {
    setPrefs((prev) => (prev ? { ...prev, [field]: value } : prev));
    try {
      const data = await updateNotificationPreferences({ [field]: value });
      setPrefs(data);
    } catch (err) {
      setError(err.message || "Не удалось сохранить");
      await reload();
    }
  };

  const reminderMinutes = Array.isArray(prefs?.lesson_reminder_minutes)
    ? prefs.lesson_reminder_minutes
    : [1440, 60, 10];

  const toggleReminder = async (minutes, enabled) => {
    const next = enabled
      ? [...new Set([...reminderMinutes, minutes])].sort((a, b) => b - a)
      : reminderMinutes.filter((m) => m !== minutes);
    await handleSelect("lesson_reminder_minutes", next);
  };

  return (
    <div className="cabinet-auth-page">
      <div className="cabinet-auth-card cb-notify-settings" style={{ maxWidth: 560, textAlign: "left" }}>
        <p style={{ marginBottom: "0.75rem" }}>
          <Link to={homePath} className="cabinet-auth-link">{backLabel}</Link>
        </p>
        <header className="cb-notify-settings__head">
          <h1 className="cabinet-auth-title" style={{ fontSize: "1.45rem" }}>Настройки уведомлений</h1>
          <p className="cabinet-auth-muted">
            Одно приложение «Цифровой поток» — push, кабинет и Telegram для вашей роли.
          </p>
        </header>

        {error ? <p className="cabinet-auth-error" role="alert">{error}</p> : null}
        {message ? <p className="cb-notify-settings__ok" role="status">{message}</p> : null}

        {loading || !prefs ? (
          <p className="cabinet-auth-muted">Загрузка настроек…</p>
        ) : (
          <>
            <section className="cb-notify-settings__card">
              <h2>Push-уведомления</h2>
              <p className="cabinet-auth-muted">
                Системные уведомления на телефон и компьютер. Разрешение запрашивается только после нажатия кнопки.
              </p>
              <ul className="cb-notify-settings__toggles">
                <li>
                  <label className="st-toggle-row">
                    <span>Включить Web Push</span>
                    <input
                      type="checkbox"
                      checked={prefs.push_enabled !== false}
                      disabled={!prefs.push_configured}
                      onChange={(e) => handleToggle("push_enabled", e.target.checked)}
                    />
                  </label>
                </li>
                <li>
                  <label className="st-toggle-row">
                    <span>Приватный режим (без сумм на экране блокировки)</span>
                    <input
                      type="checkbox"
                      checked={Boolean(prefs.push_privacy_mode)}
                      onChange={(e) => handleToggle("push_privacy_mode", e.target.checked)}
                    />
                  </label>
                </li>
                <li>
                  <label className="st-toggle-row">
                    <span>Уведомления в кабинете</span>
                    <input
                      type="checkbox"
                      checked={prefs.in_app_enabled !== false}
                      onChange={(e) => handleToggle("in_app_enabled", e.target.checked)}
                    />
                  </label>
                </li>
              </ul>
              {!prefs.push_configured ? (
                <p className="cabinet-auth-muted">
                  Web Push на сервере ещё не настроен (нужны VAPID-ключи). Telegram и кабинет уже работают.
                </p>
              ) : (
                <div className="cb-notify-settings__actions">
                  <button
                    type="button"
                    className="cb-btn cb-btn--primary"
                    disabled={Boolean(busy)}
                    onClick={() => runAction(
                      "push-on",
                      async () => {
                        await subscribeCabinetPush();
                        await sendPushTestNotification();
                      },
                      "Уведомления подключены, тестовое сообщение отправлено",
                    )}
                  >
                    {busy === "push-on" ? "Подключаем…" : "Включить на этом устройстве"}
                  </button>
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline"
                    disabled={Boolean(busy)}
                    onClick={() => runAction("push-test", () => sendPushTestNotification(), "Тестовое push отправлено")}
                  >
                    {busy === "push-test" ? "Отправляем…" : "Тестовое уведомление"}
                  </button>
                </div>
              )}
              {devices.length > 0 ? (
                <ul className="cb-notify-settings__toggles" style={{ marginTop: 12 }}>
                  {devices.map((device) => (
                    <li key={device.id}>
                      <label className="st-toggle-row">
                        <span>
                          {device.device_label || `${device.device_type} · ${device.browser}`}
                          {!device.is_active ? " (отключено)" : ""}
                        </span>
                        {device.is_active ? (
                          <button
                            type="button"
                            className="cb-btn cb-btn--ghost cb-btn--sm"
                            disabled={Boolean(busy)}
                            onClick={() => runAction(
                              `dev-${device.id}`,
                              () => unsubscribeCabinetPushDevice(device.id),
                              "Устройство отключено",
                            )}
                          >
                            Отключить
                          </button>
                        ) : null}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

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
              <h2>Напоминания об уроках</h2>
              <ul className="cb-notify-settings__toggles">
                {REMINDER_OPTIONS.map((opt) => (
                  <li key={opt.minutes}>
                    <label className="st-toggle-row">
                      <span>{opt.label}</span>
                      <input
                        type="checkbox"
                        checked={reminderMinutes.includes(opt.minutes)}
                        onChange={(e) => toggleReminder(opt.minutes, e.target.checked)}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            {isTeacher ? (
              <section className="cb-notify-settings__card">
                <h2>Расписание на день</h2>
                <label className="cb-field">
                  <span>Время утреннего уведомления</span>
                  <select
                    value={prefs.daily_schedule_hour ?? "off"}
                    onChange={(e) => handleSelect(
                      "daily_schedule_hour",
                      e.target.value === "off" ? "off" : Number(e.target.value),
                    )}
                  >
                    <option value="off">Не отправлять</option>
                    {[7, 8, 9].map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            ) : null}

            {isTeacher ? (
              <section className="cb-notify-settings__card">
                <h2>Работы на проверку</h2>
                <label className="cb-field">
                  <span>Режим push</span>
                  <select
                    value={prefs.homework_review_push_mode || "each"}
                    onChange={(e) => handleSelect("homework_review_push_mode", e.target.value)}
                  >
                    <option value="each">Отдельное уведомление по каждой работе</option>
                    <option value="digest_15">Сводка раз в 15 минут</option>
                    <option value="digest_60">Сводка раз в час</option>
                    <option value="in_app_only">Только внутри платформы</option>
                  </select>
                </label>
                <label className="cb-field" style={{ marginTop: 12 }}>
                  <span>Просроченные задания</span>
                  <select
                    value={prefs.overdue_homework_mode || "daily"}
                    onChange={(e) => handleSelect("overdue_homework_mode", e.target.value)}
                  >
                    <option value="immediate">Сразу после срока</option>
                    <option value="daily">Ежедневная сводка</option>
                    <option value="in_app_only">Только в кабинете</option>
                    <option value="off">Не уведомлять</option>
                  </select>
                </label>
              </section>
            ) : null}

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
                {isTeacher
                  ? TEACHER_EXTRA_FIELDS.map((field) => (
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
                  ))
                  : null}
              </ul>
            </section>

            <section className="cb-notify-settings__card">
              <h2>Не беспокоить</h2>
              <ul className="cb-notify-settings__toggles">
                <li>
                  <label className="st-toggle-row">
                    <span>Включить период тишины</span>
                    <input
                      type="checkbox"
                      checked={Boolean(prefs.dnd_enabled)}
                      onChange={(e) => handleToggle("dnd_enabled", e.target.checked)}
                    />
                  </label>
                </li>
                <li>
                  <label className="st-toggle-row">
                    <span>Срочные уведомления во время тишины</span>
                    <input
                      type="checkbox"
                      checked={prefs.dnd_allow_urgent !== false}
                      onChange={(e) => handleToggle("dnd_allow_urgent", e.target.checked)}
                    />
                  </label>
                </li>
              </ul>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                <label className="cb-field">
                  <span>С</span>
                  <input
                    type="time"
                    value={prefs.dnd_start || "22:00"}
                    onChange={(e) => handleSelect("dnd_start", e.target.value)}
                  />
                </label>
                <label className="cb-field">
                  <span>До</span>
                  <input
                    type="time"
                    value={prefs.dnd_end || "07:00"}
                    onChange={(e) => handleSelect("dnd_end", e.target.value)}
                  />
                </label>
              </div>
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

            {isTeacher ? (
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

            {isTeacher ? (
              <>
                <section className="cb-notify-settings__card">
                  <h2>Оплаты — учителю</h2>
                  <p className="cabinet-auth-muted">Через уже подключённые каналы, без новых ссылок.</p>
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
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
