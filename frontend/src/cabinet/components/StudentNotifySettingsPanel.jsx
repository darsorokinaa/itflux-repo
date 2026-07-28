import { useEffect, useState } from "react";
import {
  fetchStudentNotifySettings,
  updateStudentNotifySettings,
} from "../../utils/cabinetAuth";

const BOOL_FIELDS = [
  { key: "notify_homework", label: "Работы на проверку" },
  { key: "notify_messages", label: "Сообщения" },
  { key: "notify_overdue", label: "Просроченные задания" },
  { key: "notify_billing", label: "Оплаты" },
  { key: "notify_attendance", label: "Посещаемость" },
];

function TriStateSelect({ value, onChange }) {
  const normalized = value === true ? "on" : value === false ? "off" : "inherit";
  return (
    <select
      value={normalized}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "on" ? true : v === "off" ? false : null);
      }}
    >
      <option value="inherit">Как в общих настройках</option>
      <option value="on">Включить</option>
      <option value="off">Отключить</option>
    </select>
  );
}

export default function StudentNotifySettingsPanel({ studentId }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!studentId) return undefined;
    let cancelled = false;
    setLoading(true);
    fetchStudentNotifySettings(studentId)
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (!studentId) return null;

  const save = async (patch) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await updateStudentNotifySettings(studentId, patch);
      setSettings(data);
      setMessage("Сохранено");
    } catch (err) {
      setError(err.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cb-notify-settings__card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Уведомления об ученике</h3>
      <p className="cabinet-auth-muted" style={{ marginTop: 0 }}>
        Общие настройки учителя — базовые. Здесь можно уточнить для этого ученика.
      </p>
      {loading || !settings ? (
        <p className="cabinet-auth-muted">Загрузка…</p>
      ) : (
        <>
          {error ? <p className="cabinet-auth-error">{error}</p> : null}
          {message ? <p className="cb-notify-settings__ok">{message}</p> : null}
          <label className="cb-field">
            <span>Режим</span>
            <select
              value={settings.mode || "all"}
              disabled={saving}
              onChange={(e) => save({ mode: e.target.value })}
            >
              <option value="all">Все события</option>
              <option value="important_only">Только важные</option>
              <option value="mute_optional">Отключить необязательные</option>
            </select>
          </label>
          <ul className="cb-notify-settings__toggles" style={{ marginTop: 12 }}>
            {BOOL_FIELDS.map((field) => (
              <li key={field.key}>
                <label className="st-toggle-row">
                  <span>{field.label}</span>
                  <TriStateSelect
                    value={settings[field.key]}
                    onChange={(val) => save({ [field.key]: val })}
                  />
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
