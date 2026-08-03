import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  disconnectTelegram,
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
import AppDiagnosticsPanel from "../../components/AppDiagnosticsPanel";
import "../styles/notifications-settings.css";

const REMINDER_OPTIONS = [
  { minutes: 1440, label: "За 24 часа", description: "Напоминание за сутки до урока" },
  { minutes: 60, label: "За 1 час", description: "Короткое напоминание за час" },
  { minutes: 10, label: "За 10 минут", description: "Перед самым началом занятия" },
];

const TYPE_GROUPS = [
  {
    id: "homework",
    title: "Домашние задания",
    fields: [
      {
        key: "notify_homework",
        label: "Новые домашние задания и работы на проверку",
        description: "Ученику — о выдаче ДЗ; учителю — о сданных работах.",
      },
      {
        key: "notify_homework_resubmitted",
        label: "Ученик сдал исправленную работу",
        description: "Сообщать о повторной сдаче после доработки.",
        teacherOnly: true,
      },
      {
        key: "notify_overdue_homework",
        label: "Просроченные задания",
        description: "Сводка по ученикам, которые не сдали работу вовремя.",
        teacherOnly: true,
      },
    ],
  },
  {
    id: "review",
    title: "Проверка работ",
    fields: [
      {
        key: "notify_review",
        label: "Результат проверки",
        description: "Сообщать, когда работа проверена или возвращена на доработку.",
      },
      {
        key: "notify_journal_results",
        label: "Итоги урока опубликованы",
        description: "Уведомление об опубликованных итогах занятия.",
      },
      {
        key: "notify_journal_comment",
        label: "Комментарий в итогах",
        description: "Если в итогах есть комментарий учителя.",
      },
      {
        key: "notify_journal_recommendation",
        label: "Новая рекомендация",
        description: "Если в итогах появилась рекомендация.",
      },
      {
        key: "notify_auto_check_attention",
        label: "Автопроверка требует внимания",
        description: "Когда автоматическая проверка не завершилась полностью.",
        teacherOnly: true,
      },
      {
        key: "notify_journal_daily_digest",
        label: "Ежедневная сводка журнала",
        description: "Сводка по журналу успеваемости за день.",
        teacherOnly: true,
        defaultOff: true,
      },
    ],
  },
  {
    id: "schedule",
    title: "Уроки и расписание",
    fields: [
      {
        key: "notify_lesson_created",
        label: "Новые занятия",
        description: "Сообщать о создании урока в расписании.",
      },
      {
        key: "notify_lesson_moved",
        label: "Перенос занятия",
        description: "Когда урок переносят на другое время.",
      },
      {
        key: "notify_lesson_cancelled",
        label: "Отмена занятия",
        description: "Когда занятие отменяют.",
      },
      {
        key: "notify_lesson_updated",
        label: "Изменение занятия",
        description: "Изменились тема, ссылка или другие детали.",
      },
      {
        key: "notify_participants_changed",
        label: "Изменение участников",
        description: "Вас добавили или убрали с занятия.",
      },
      {
        key: "notify_daily_schedule",
        label: "Расписание на день",
        description: "Утренняя сводка занятий на сегодня.",
        teacherOnly: true,
      },
      {
        key: "notify_daily_schedule_empty",
        label: "Сообщать, что сегодня уроков нет",
        description: "Даже если день пустой — прислать короткое сообщение.",
        teacherOnly: true,
      },
    ],
  },
  {
    id: "classroom",
    title: "Ученики и уроки",
    teacherOnly: true,
    fields: [
      {
        key: "notify_new_student",
        label: "Новые ученики",
        description: "Ученик присоединился по приглашению.",
      },
      {
        key: "notify_student_message",
        label: "Сообщения учеников",
        description: "Текстовые сообщения к заданиям.",
      },
      {
        key: "notify_student_entered_room",
        label: "Ученик вошёл в комнату",
        description: "Ученик зашёл в комнату урока до или во время занятия.",
      },
      {
        key: "notify_student_absent",
        label: "Ученик не подключился",
        description: "Ученик не зашёл в комнату после начала урока.",
      },
      {
        key: "notify_system",
        label: "Системные события",
        description: "Важные сообщения платформы и технические оповещения.",
      },
    ],
  },
  {
    id: "billing-teacher",
    title: "Оплаты и абонементы",
    teacherOnly: true,
    description: "Через кабинет, Web Push и Telegram.",
    fields: [
      {
        key: "notify_payment_received",
        label: "Оплата получена",
        description: "Когда вы регистрируете оплату ученика.",
        defaultOff: true,
      },
      {
        key: "notify_package_low",
        label: "Заканчивается абонемент",
        description: "У ученика осталось мало занятий или минут.",
        defaultOff: true,
      },
      {
        key: "notify_debt_created",
        label: "Нет оплаты / задолженность",
        description: "Урок проведён без оплаты.",
        defaultOff: true,
      },
      {
        key: "notify_billing_daily_digest",
        label: "Ежедневная финансовая сводка",
        description: "Краткая сводка по оплатам за день.",
        defaultOff: true,
      },
      {
        key: "notify_billing_weekly_digest",
        label: "Еженедельная финансовая сводка",
        description: "Сводка по оплатам за неделю.",
        defaultOff: true,
      },
    ],
  },
  {
    id: "billing-student",
    title: "Оплаты ученику",
    teacherOnly: true,
    description: "Ученику уходят только если для него включены уведомления в разделе «Оплаты».",
    fields: [
      {
        key: "notify_student_payment_recorded",
        label: "Оплата зафиксирована",
        description: "Сообщать ученику о записанной оплате.",
        defaultOff: true,
      },
      {
        key: "notify_student_package_low",
        label: "Осталось мало занятий или минут",
        description: "Предупреждение ученику о заканчивающемся абонементе.",
        defaultOff: true,
      },
      {
        key: "notify_student_package_ended",
        label: "Абонемент закончился",
        description: "Сообщать, что занятий в абонементе больше нет.",
        defaultOff: true,
      },
      {
        key: "notify_student_unpaid_lesson",
        label: "Есть неоплаченный урок",
        description: "Сообщать ученику о неоплаченном занятии.",
        defaultOff: true,
      },
      {
        key: "notify_student_payment_due",
        label: "Приближается срок оплаты",
        description: "Напоминания и персональные сообщения об оплате.",
        defaultOff: true,
      },
    ],
  },
];

const SAVE_FIELDS = [
  "push_enabled",
  "push_privacy_mode",
  "in_app_enabled",
  "notify_lesson_created",
  "notify_lesson_moved",
  "notify_lesson_cancelled",
  "notify_lesson_updated",
  "notify_participants_changed",
  "notify_homework",
  "notify_review",
  "notify_journal_results",
  "notify_journal_comment",
  "notify_journal_recommendation",
  "notify_journal_daily_digest",
  "notify_new_student",
  "notify_homework_resubmitted",
  "notify_overdue_homework",
  "notify_student_message",
  "notify_student_entered_room",
  "notify_student_absent",
  "notify_auto_check_attention",
  "notify_system",
  "notify_daily_schedule",
  "notify_daily_schedule_empty",
  "notify_payment_received",
  "notify_package_low",
  "notify_debt_created",
  "notify_billing_daily_digest",
  "notify_billing_weekly_digest",
  "notify_student_payment_recorded",
  "notify_student_package_low",
  "notify_student_package_ended",
  "notify_student_unpaid_lesson",
  "notify_student_payment_due",
  "dnd_enabled",
  "dnd_allow_urgent",
  "dnd_start",
  "dnd_end",
  "digest_hour",
  "daily_schedule_hour",
  "homework_review_push_mode",
  "overdue_homework_mode",
  "lesson_reminder_minutes",
];

function normalizeForCompare(prefs) {
  if (!prefs) return null;
  const next = {};
  for (const key of SAVE_FIELDS) {
    if (key === "lesson_reminder_minutes") {
      const list = Array.isArray(prefs.lesson_reminder_minutes)
        ? [...prefs.lesson_reminder_minutes].map(Number).sort((a, b) => b - a)
        : [];
      next[key] = list;
    } else if (key === "daily_schedule_hour") {
      next[key] = prefs.daily_schedule_hour == null ? "off" : Number(prefs.daily_schedule_hour);
    } else {
      next[key] = prefs[key];
    }
  }
  return next;
}

function prefsEqual(a, b) {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
}

function buildSavePayload(prefs) {
  const payload = {};
  for (const key of SAVE_FIELDS) {
    if (key === "daily_schedule_hour") {
      payload[key] = prefs.daily_schedule_hour == null || prefs.daily_schedule_hour === "off"
        ? "off"
        : Number(prefs.daily_schedule_hour);
    } else if (key === "lesson_reminder_minutes") {
      payload[key] = Array.isArray(prefs.lesson_reminder_minutes)
        ? prefs.lesson_reminder_minutes
        : [];
    } else if (key === "digest_hour") {
      payload[key] = Number(prefs.digest_hour ?? 19);
    } else {
      payload[key] = prefs[key];
    }
  }
  return payload;
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled = false,
  onChange,
}) {
  return (
    <label
      className={`cb-notify-switch${disabled ? " is-disabled" : ""}`}
      htmlFor={id}
    >
      <span className="cb-notify-switch__copy">
        <span className="cb-notify-switch__label">{label}</span>
        {description ? (
          <span className="cb-notify-switch__desc">{description}</span>
        ) : null}
      </span>
      <span className="cb-notify-switch__control">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="cb-notify-switch__track" aria-hidden="true" />
      </span>
    </label>
  );
}

function ChannelStatusCard({ icon, title, status, tone, description, badge, actions }) {
  return (
    <article className={`cb-notify-channel cb-notify-channel--${tone}`}>
      <div className="cb-notify-channel__icon" aria-hidden="true">
        <CabinetIcon name={icon} />
      </div>
      <div className="cb-notify-channel__body">
        <div className="cb-notify-channel__top">
          <h3 className="cb-notify-channel__title">{title}</h3>
          <span className={`cb-notify-badge cb-notify-badge--${tone}`}>
            {badge || status}
          </span>
        </div>
        {description ? <p className="cb-notify-channel__desc">{description}</p> : null}
        {actions ? <div className="cb-notify-channel__actions">{actions}</div> : null}
      </div>
    </article>
  );
}

function FieldSelect({ id, label, value, onChange, children }) {
  return (
    <label className="cb-notify-field" htmlFor={id}>
      <span className="cb-notify-field__label">{label}</span>
      <select id={id} className="cb-notify-field__select" value={value} onChange={onChange}>
        {children}
      </select>
    </label>
  );
}

function isFieldChecked(prefs, field) {
  if (field.defaultOff) return Boolean(prefs[field.key]);
  return prefs[field.key] !== false;
}

export default function CabinetNotificationsSettingsPage() {
  const outlet = useOutletContext() || {};
  const user = outlet.user;
  const isTeacher = isTeacherRole(user);
  const homePath = getCabinetHomePath(user) || (isTeacher ? "/cabinet" : "/cabinet/student");
  const morePath = isTeacher ? "/cabinet/more" : "/cabinet/student/more";

  const [savedPrefs, setSavedPrefs] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [devices, setDevices] = useState([]);
  const [devicePushStatus, setDevicePushStatus] = useState("checking");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const { toast, showToast } = useSoonToast();
  const ignoreUnloadRef = useRef(false);
  const autosaveTimer = useRef(null);

  const refreshDevicePushStatus = useCallback(async () => {
    try {
      const {
        getCurrentPushEndpoint,
        isIosDevice,
        isStandaloneDisplay,
        notificationPermission,
      } = await import("../pwa/pwaHelpers");
      if (typeof window === "undefined" || !("PushManager" in window)) {
        setDevicePushStatus("unsupported");
        return;
      }
      if (isIosDevice() && !isStandaloneDisplay()) {
        setDevicePushStatus("needs_install");
        return;
      }
      const permission = notificationPermission();
      if (permission === "denied") {
        setDevicePushStatus("denied");
        return;
      }
      if (permission === "default" || permission === "unsupported") {
        setDevicePushStatus(permission === "unsupported" ? "unsupported" : "prompt");
        return;
      }
      const endpoint = await getCurrentPushEndpoint();
      setDevicePushStatus(endpoint ? "subscribed" : "stale");
    } catch {
      setDevicePushStatus("unsupported");
    }
  }, []);

  const dirty = useMemo(
    () => Boolean(prefs && savedPrefs && !prefsEqual(prefs, savedPrefs)),
    [prefs, savedPrefs],
  );

  const reload = useCallback(async () => {
    const [data, pushDevices] = await Promise.all([
      fetchNotificationPreferences(),
      fetchPushDevices().catch(() => ({ devices: [] })),
    ]);
    setPrefs(data);
    setSavedPrefs(data);
    setDevices(pushDevices?.devices || []);
    await refreshDevicePushStatus();
    return data;
  }, [refreshDevicePushStatus]);

  usePageTitle("Настройки уведомлений");

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err) => {
        if (!cancelled) setSaveError(err.message || "Не удалось загрузить настройки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, reload]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!dirty || ignoreUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const persistPrefs = useCallback(async (nextPrefs, { silent = false } = {}) => {
    setSaving(true);
    setSaveError("");
    try {
      const data = await updateNotificationPreferences(buildSavePayload(nextPrefs));
      const merged = { ...nextPrefs, ...data };
      delete merged.ok;
      delete merged.error;
      setPrefs(merged);
      setSavedPrefs(merged);
      if (!silent) showToast("Сохранено");
      return merged;
    } catch (err) {
      const msg = err.message || "Не удалось сохранить настройки. Попробуйте ещё раз.";
      setSaveError(msg);
      if (!silent) showToast(msg);
      setPrefs(savedPrefs);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [savedPrefs, showToast]);

  const setField = (field, value) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => {
        persistPrefs(next, { silent: true }).catch(() => {});
      }, 400);
      return next;
    });
    setSaveError("");
  };

  const reminderMinutes = Array.isArray(prefs?.lesson_reminder_minutes)
    ? prefs.lesson_reminder_minutes
    : [1440, 60, 10];

  const toggleReminder = (minutes, enabled) => {
    const next = enabled
      ? [...new Set([...reminderMinutes, minutes])].sort((a, b) => b - a)
      : reminderMinutes.filter((m) => m !== minutes);
    setField("lesson_reminder_minutes", next);
  };

  const visibleGroups = useMemo(
    () => TYPE_GROUPS
      .filter((group) => !group.teacherOnly || isTeacher)
      .map((group) => ({
        ...group,
        fields: group.fields.filter((field) => !field.teacherOnly || isTeacher),
      }))
      .filter((group) => group.fields.length > 0),
    [isTeacher],
  );

  const setGroupEnabled = (group, enabled) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      group.fields.forEach((field) => {
        next[field.key] = enabled;
      });
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => {
        persistPrefs(next, { silent: true }).catch(() => {});
      }, 400);
      return next;
    });
    setSaveError("");
  };

  const runAction = async (key, fn, successText) => {
    setBusy(key);
    setSaveError("");
    try {
      await fn();
      await reload();
      if (successText) showToast(successText);
    } catch (err) {
      setSaveError(err.message || "Ошибка");
      showToast(err.message || "Не удалось выполнить действие");
    } finally {
      setBusy("");
    }
  };

  const handleSave = async () => {
    if (!prefs || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const data = await updateNotificationPreferences(buildSavePayload(prefs));
      // API returns { ok: true, ...payload }
      const next = { ...prefs, ...data };
      delete next.ok;
      delete next.error;
      setPrefs(next);
      setSavedPrefs(next);
      showToast("Настройки уведомлений сохранены");
    } catch (err) {
      const msg = err.message || "Не удалось сохранить настройки. Попробуйте ещё раз.";
      setSaveError(msg);
      showToast(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (dirty && !window.confirm("Есть несохранённые изменения. Отменить их?")) return;
    setPrefs(savedPrefs);
    setSaveError("");
  };

  const handleBack = (event) => {
    if (dirty && !window.confirm("Есть несохранённые изменения. Уйти со страницы?")) {
      event.preventDefault();
      return;
    }
    ignoreUnloadRef.current = true;
  };

  if (!user) {
    return (
      <CabinetPageShell className="cb-section--notify">
        <p className="cb-notify-muted">Загрузка…</p>
      </CabinetPageShell>
    );
  }

  const pushConfigured = Boolean(prefs?.push_configured);
  const pushOn = prefs?.push_enabled !== false && pushConfigured;
  const inAppOn = prefs?.in_app_enabled !== false;
  const telegramConnected = Boolean(prefs?.connected);
  const devicePushCopy = {
    checking: { status: "Проверяем…", tone: "muted", description: "Проверяем подписку этого устройства." },
    subscribed: {
      status: "Уведомления включены на этом устройстве",
      tone: "ok",
      description: "Системные уведомления в браузере на этом устройстве.",
    },
    prompt: {
      status: "Разрешение ещё не запрошено",
      tone: "warn",
      description: "Нажмите «Включить на этом устройстве», чтобы разрешить уведомления.",
    },
    denied: {
      status: "Уведомления запрещены в браузере",
      tone: "warn",
      description: "Разрешите уведомления в настройках браузера, затем включите снова.",
    },
    stale: {
      status: "Подписка устарела — включите повторно",
      tone: "warn",
      description: "Разрешение есть, но активной подписки на этом устройстве нет.",
    },
    unsupported: {
      status: "Устройство не поддерживает Web Push",
      tone: "muted",
      description: "Этот браузер не умеет принимать push-уведомления.",
    },
    needs_install: {
      status: "Уведомления доступны только после установки приложения",
      tone: "warn",
      description: "На iPhone/iPad сначала добавьте сайт на экран «Домой».",
    },
  }[devicePushStatus] || {
    status: pushOn ? "Включён" : "Выключен",
    tone: pushOn ? "ok" : "muted",
    description: "Системные уведомления в браузере на этом устройстве.",
  };

  return (
    <CabinetPageShell className="cb-section--notify">
      {toast}

      <nav className="cb-notify-crumbs" aria-label="Навигация">
        <Link to={homePath} className="cb-notify-crumbs__link" onClick={handleBack}>
          Кабинет
        </Link>
        <span className="cb-notify-crumbs__sep" aria-hidden="true">/</span>
        <span className="cb-notify-crumbs__current">Настройки уведомлений</span>
      </nav>

      <header className="cb-notify-hero">
        <div className="cb-notify-hero__text">
          <Link
            to={morePath}
            className="cb-notify-back"
            onClick={handleBack}
          >
            <CabinetIcon name="arrowLeft" />
            <span>Назад</span>
          </Link>
          <h1 className="cb-notify-hero__title">Настройки уведомлений</h1>
          <p className="cb-notify-hero__sub">
            Выберите, какие уведомления получать в кабинете, через Web Push и Telegram.
          </p>
        </div>
        <div className="cb-notify-hero__actions">
          <button
            type="button"
            className="cb-btn cb-btn--outline"
            disabled={!dirty || saving}
            onClick={handleCancel}
          >
            Отмена
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            disabled={!dirty || saving || loading}
            onClick={handleSave}
          >
            {saving ? "Сохранение…" : "Сохранить изменения"}
          </button>
        </div>
      </header>

      {saveError ? (
        <p className="cb-notify-alert cb-notify-alert--error" role="alert">{saveError}</p>
      ) : null}
      {dirty ? (
        <p className="cb-notify-alert cb-notify-alert--warn" role="status">
          Есть несохранённые изменения
        </p>
      ) : null}

      {loading || !prefs ? (
        <p className="cb-notify-muted">Загрузка настроек…</p>
      ) : (
        <>
          <section className="cb-notify-channels" aria-label="Каналы уведомлений">
            <ChannelStatusCard
              icon="bell"
              title="Уведомления в кабинете"
              status={inAppOn ? "Включены" : "Выключены"}
              tone={inAppOn ? "ok" : "muted"}
              description="Показываются в колокольчике кабинета."
            />
            <ChannelStatusCard
              icon="spark"
              title="Web Push на этом устройстве"
              status={!pushConfigured ? "Не настроен" : devicePushCopy.status}
              tone={!pushConfigured ? "warn" : devicePushCopy.tone}
              badge={!pushConfigured ? "Недоступно" : undefined}
              description={
                !pushConfigured
                  ? "Web Push пока недоступен: на сервере не настроены VAPID-ключи."
                  : devicePushCopy.description
              }
              actions={pushConfigured ? (
                <>
                  <button
                    type="button"
                    className="cb-btn cb-btn--primary cb-btn--sm"
                    disabled={Boolean(busy) || devicePushStatus === "unsupported"}
                    onClick={() => runAction(
                      "push-on",
                      async () => {
                        await subscribeCabinetPush();
                        await sendPushTestNotification();
                      },
                      "Тестовое уведомление отправлено",
                    )}
                  >
                    {busy === "push-on" ? "Подключаем…" : "Включить на этом устройстве"}
                  </button>
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm"
                    disabled={Boolean(busy) || devicePushStatus === "unsupported"}
                    onClick={() => runAction(
                      "push-test",
                      async () => {
                        await sendPushTestNotification();
                      },
                      "Тестовое уведомление отправлено",
                    )}
                  >
                    {busy === "push-test" ? "Отправляем…" : "Отправить тестовое уведомление"}
                  </button>
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm"
                    disabled={Boolean(busy) || devicePushStatus !== "subscribed"}
                    onClick={() => runAction(
                      "push-off",
                      async () => {
                        const { unsubscribeCurrentPush } = await import("../pwa/pwaHelpers");
                        const endpoint = await unsubscribeCurrentPush();
                        if (endpoint) await unsubscribeCabinetPushDevice(endpoint);
                      },
                      "Уведомления отключены на этом устройстве",
                    )}
                  >
                    {busy === "push-off" ? "Отключаем…" : "Отключить на этом устройстве"}
                  </button>
                </>
              ) : null}
            />
            <ChannelStatusCard
              icon="video"
              title="Telegram"
              status={telegramConnected ? "Подключён" : "Не подключён"}
              tone={telegramConnected ? "ok" : "muted"}
              description={
                telegramConnected
                  ? (prefs.telegram_username
                    ? `Аккаунт @${prefs.telegram_username}`
                    : "Получайте напоминания в мессенджере")
                  : "Получайте напоминания и уведомления в Telegram"
              }
              actions={telegramConnected ? (
                <>
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm"
                    disabled={Boolean(busy)}
                    onClick={() => runAction("test", () => sendTelegramTestNotification(), "Тестовое сообщение отправлено")}
                  >
                    {busy === "test" ? "Отправляем…" : "Тест"}
                  </button>
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm"
                    disabled={Boolean(busy)}
                    onClick={() => runAction("disconnect", () => disconnectTelegram(), "Telegram отключён")}
                  >
                    {busy === "disconnect" ? "Отключаем…" : "Отключить"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="cb-btn cb-btn--primary cb-btn--sm"
                  disabled={Boolean(busy) || prefs.bot_configured === false}
                  onClick={() => runAction("connect", () => openTelegramConnect())}
                >
                  {busy === "connect" ? "Открываем…" : "Подключить Telegram"}
                </button>
              )}
            />
          </section>

          <div className="cb-notify-layout">
            <div className="cb-notify-col cb-notify-col--side">
              <section className="cb-notify-card">
                <header className="cb-notify-card__head">
                  <h2 className="cb-notify-card__title">Каналы доставки</h2>
                  <p className="cb-notify-card__sub">Выберите, куда отправлять уведомления.</p>
                </header>
                <div className="cb-notify-switch-list">
                  <SwitchRow
                    id="notify-in-app"
                    label="Уведомления в кабинете"
                    description="Список уведомлений внутри платформы"
                    checked={prefs.in_app_enabled !== false}
                    onChange={(v) => setField("in_app_enabled", v)}
                  />
                  <SwitchRow
                    id="notify-push"
                    label="Web Push"
                    description={
                      pushConfigured
                        ? "Системные уведомления браузера"
                        : "Недоступно: на сервере нет VAPID-ключей"
                    }
                    checked={prefs.push_enabled !== false}
                    disabled={!pushConfigured}
                    onChange={(v) => setField("push_enabled", v)}
                  />
                  <SwitchRow
                    id="notify-privacy"
                    label="Приватный режим"
                    description="Не показывать текст и суммы в уведомлениях на экране блокировки."
                    checked={Boolean(prefs.push_privacy_mode)}
                    onChange={(v) => setField("push_privacy_mode", v)}
                  />
                </div>
                {devices.length > 0 ? (
                  <ul className="cb-notify-devices">
                    {devices.map((device) => (
                      <li
                        key={device.id}
                        className={`cb-notify-devices__item${device.is_current ? " is-current" : ""}`}
                      >
                        <span>
                          {device.device_label || `${device.device_type} · ${device.browser}`}
                        </span>
                        {device.is_active ? (
                          <button
                            type="button"
                            className="cb-btn cb-btn--ghost cb-btn--sm"
                            disabled={Boolean(busy)}
                            onClick={() => runAction(
                              `dev-${device.id}`,
                              async () => {
                                if (device.is_current) {
                                  const { unsubscribeCurrentPush } = await import("../pwa/pwaHelpers");
                                  await unsubscribeCurrentPush().catch(() => {});
                                }
                                await unsubscribeCabinetPushDevice(device.id);
                              },
                              device.is_current
                                ? "Уведомления отключены на этом устройстве"
                                : "Устройство отключено",
                            )}
                          >
                            Отключить
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section className="cb-notify-card">
                <header className="cb-notify-card__head">
                  <h2 className="cb-notify-card__title">Telegram</h2>
                  <p className="cb-notify-card__sub">
                    {telegramConnected
                      ? "Аккаунт подключён. Можно отправить тест или отключить."
                      : "Подключите бота, чтобы получать напоминания в мессенджере."}
                  </p>
                </header>
                <div className="cb-notify-telegram">
                  <div className="cb-notify-telegram__status">
                    <span className={`cb-notify-dot cb-notify-dot--${telegramConnected ? "ok" : "muted"}`} />
                    <div>
                      <strong>{telegramConnected ? "Подключён" : "Не подключён"}</strong>
                      {telegramConnected && prefs.telegram_username ? (
                        <p>@{prefs.telegram_username}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="cb-notify-telegram__actions">
                    {telegramConnected ? (
                      <>
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
                          {busy === "disconnect" ? "Отключаем…" : "Отключить"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="cb-btn cb-btn--primary"
                        disabled={Boolean(busy) || prefs.bot_configured === false}
                        onClick={() => runAction("connect", () => openTelegramConnect())}
                      >
                        {busy === "connect" ? "Открываем…" : "Подключить Telegram"}
                      </button>
                    )}
                  </div>
                  {prefs.bot_configured === false ? (
                    <p className="cb-notify-muted">Подключение временно недоступно.</p>
                  ) : null}
                </div>
              </section>

              <section className="cb-notify-card">
                <header className="cb-notify-card__head">
                  <h2 className="cb-notify-card__title">Когда отправлять</h2>
                  <p className="cb-notify-card__sub">Расписание сводок и режимы доставки.</p>
                </header>
                <div className="cb-notify-fields">
                  {isTeacher ? (
                    <FieldSelect
                      id="daily-schedule-hour"
                      label="Утренняя сводка"
                      value={prefs.daily_schedule_hour ?? "off"}
                      onChange={(e) => setField(
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
                    </FieldSelect>
                  ) : null}

                  {isTeacher ? (
                    <FieldSelect
                      id="homework-review-mode"
                      label="Новые работы на проверку"
                      value={prefs.homework_review_push_mode || "each"}
                      onChange={(e) => setField("homework_review_push_mode", e.target.value)}
                    >
                      <option value="each">Отдельное уведомление о каждой работе</option>
                      <option value="digest_15">Сводка раз в 15 минут</option>
                      <option value="digest_60">Сводка раз в час</option>
                      <option value="in_app_only">Только внутри платформы</option>
                    </FieldSelect>
                  ) : null}

                  {isTeacher ? (
                    <FieldSelect
                      id="overdue-mode"
                      label="Просроченные задания"
                      value={prefs.overdue_homework_mode || "daily"}
                      onChange={(e) => setField("overdue_homework_mode", e.target.value)}
                    >
                      <option value="immediate">Сразу после срока</option>
                      <option value="daily">Ежедневная сводка</option>
                      <option value="in_app_only">Только в кабинете</option>
                      <option value="off">Не уведомлять</option>
                    </FieldSelect>
                  ) : null}

                  <FieldSelect
                    id="digest-hour"
                    label="Час ежедневной сводки"
                    value={prefs.digest_hour ?? 19}
                    onChange={(e) => setField("digest_hour", Number(e.target.value))}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </FieldSelect>
                </div>

                <div className="cb-notify-dnd">
                  <h3 className="cb-notify-card__subtitle">Не беспокоить</h3>
                  <div className="cb-notify-switch-list">
                    <SwitchRow
                      id="dnd-enabled"
                      label="Включить период тишины"
                      checked={Boolean(prefs.dnd_enabled)}
                      onChange={(v) => setField("dnd_enabled", v)}
                    />
                    <SwitchRow
                      id="dnd-urgent"
                      label="Срочные уведомления во время тишины"
                      checked={prefs.dnd_allow_urgent !== false}
                      onChange={(v) => setField("dnd_allow_urgent", v)}
                    />
                  </div>
                  <div className="cb-notify-dnd__times">
                    <label className="cb-notify-field" htmlFor="dnd-start">
                      <span className="cb-notify-field__label">С</span>
                      <input
                        id="dnd-start"
                        type="time"
                        className="cb-notify-field__select"
                        value={prefs.dnd_start || "22:00"}
                        onChange={(e) => setField("dnd_start", e.target.value)}
                      />
                    </label>
                    <label className="cb-notify-field" htmlFor="dnd-end">
                      <span className="cb-notify-field__label">До</span>
                      <input
                        id="dnd-end"
                        type="time"
                        className="cb-notify-field__select"
                        value={prefs.dnd_end || "07:00"}
                        onChange={(e) => setField("dnd_end", e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </section>
            </div>

            <div className="cb-notify-col cb-notify-col--main">
              <section className="cb-notify-card">
                <header className="cb-notify-card__head">
                  <h2 className="cb-notify-card__title">Напоминания об уроках</h2>
                  <p className="cb-notify-card__sub">
                    Выберите, за какое время до занятия отправлять напоминание.
                  </p>
                </header>
                <div className="cb-notify-switch-list">
                  {REMINDER_OPTIONS.map((opt) => (
                    <SwitchRow
                      key={opt.minutes}
                      id={`reminder-${opt.minutes}`}
                      label={opt.label}
                      description={opt.description}
                      checked={reminderMinutes.includes(opt.minutes)}
                      onChange={(v) => toggleReminder(opt.minutes, v)}
                    />
                  ))}
                </div>
              </section>

              <section className="cb-notify-card cb-notify-card--types">
                <header className="cb-notify-card__head cb-notify-card__head--row">
                  <div>
                    <h2 className="cb-notify-card__title">Типы уведомлений</h2>
                    <p className="cb-notify-card__sub">
                      Включите только те события, о которых хотите получать сообщения.
                    </p>
                  </div>
                </header>

                {visibleGroups.map((group) => (
                  <div key={group.id} className="cb-notify-group">
                    <div className="cb-notify-group__head">
                      <h3 className="cb-notify-group__title">{group.title}</h3>
                      <div className="cb-notify-group__actions">
                        <button
                          type="button"
                          className="cb-notify-link-btn"
                          onClick={() => setGroupEnabled(group, true)}
                        >
                          Включить все
                        </button>
                        <button
                          type="button"
                          className="cb-notify-link-btn"
                          onClick={() => setGroupEnabled(group, false)}
                        >
                          Выключить все
                        </button>
                      </div>
                    </div>
                    {group.description ? (
                      <p className="cb-notify-card__sub">{group.description}</p>
                    ) : null}
                    <div className="cb-notify-switch-list">
                      {group.fields.map((field) => (
                        <SwitchRow
                          key={field.key}
                          id={`type-${field.key}`}
                          label={field.label}
                          description={field.description}
                          checked={isFieldChecked(prefs, field)}
                          onChange={(v) => setField(field.key, v)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </section>

              <AppDiagnosticsPanel />
            </div>
          </div>
        </>
      )}

      <div className="cb-notify-sticky" aria-label="Сохранение настроек">
        <button
          type="button"
          className="cb-btn cb-btn--outline"
          disabled={!dirty || saving}
          onClick={handleCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="cb-btn cb-btn--primary"
          disabled={!dirty || saving || loading}
          onClick={handleSave}
        >
          {saving ? "Сохранение…" : "Сохранить изменения"}
        </button>
      </div>
    </CabinetPageShell>
  );
}
