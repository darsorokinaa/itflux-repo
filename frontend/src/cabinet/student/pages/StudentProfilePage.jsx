import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { fetchStudentProfile, updateStudentProfile } from "../../../utils/cabinetAuth";
import { loadStudentData } from "../studentData";
import { StudentPageShell } from "../StudentSectionUi";

export default function StudentProfilePage() {
  const { handleLogout, loggingOut } = useOutletContext?.() ?? {};

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState("");

  useEffect(() => {
    loadStudentData(fetchStudentProfile, "profile")
      .then(setProfile)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    setMsg("");
    try {
      await updateStudentProfile({
        name: profile.name,
        surname: profile.surname,
        notifications_enabled: profile.notifications_enabled,
      });
      setMsg("Сохранено");
    } catch (e) {
      setMsg(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profile) {
    return <StudentPageShell><div className="st-loading">Загрузка…</div></StudentPageShell>;
  }

  return (
    <StudentPageShell>
      {/* Аватар */}
      <div className="st-profile-avatar-block">
        <div className="st-profile-avatar">
          {(profile.name || "?").charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="st-profile-display-name">
            {[profile.name, profile.surname].filter(Boolean).join(" ") || "Ученик"}
          </p>
          <p className="st-profile-role">Ученик · Цифровой поток</p>
        </div>
      </div>

      {/* Данные */}
      <section className="st-profile-section">
        <h2 className="st-profile-section__title">Данные</h2>
        <label className="st-field">
          <span>Имя</span>
          <input
            value={profile.name || ""}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            aria-label="Имя"
          />
        </label>
        <label className="st-field">
          <span>Фамилия</span>
          <input
            value={profile.surname || ""}
            onChange={(e) => setProfile({ ...profile, surname: e.target.value })}
            aria-label="Фамилия"
          />
        </label>
        {profile.email && (
          <p className="st-field-static">
            <span>Email</span>
            <span>{profile.email}</span>
          </p>
        )}
      </section>

      {/* Обучение */}
      <section className="st-profile-section">
        <h2 className="st-profile-section__title">Обучение</h2>
        {profile.direction && (
          <p className="st-field-static"><span>Направление</span><span>{profile.direction}</span></p>
        )}
        {profile.grade && (
          <p className="st-field-static"><span>Класс</span><span>{profile.grade} класс</span></p>
        )}
        {profile.groups?.length > 0 && (
          <p className="st-field-static"><span>Группа</span><span>{profile.groups.join(", ")}</span></p>
        )}
        {profile.teacher_name && (
          <p className="st-field-static"><span>Учитель</span><span>{profile.teacher_name}</span></p>
        )}
      </section>

      {/* Уведомления */}
      <section className="st-profile-section">
        <h2 className="st-profile-section__title">Уведомления</h2>
        <label className="st-toggle-row">
          <span>Напоминания о занятиях</span>
          <input
            type="checkbox"
            checked={profile.notifications_enabled !== false}
            onChange={(e) => setProfile({ ...profile, notifications_enabled: e.target.checked })}
            aria-label="Напоминания о занятиях"
          />
        </label>
      </section>

      {/* Кнопки */}
      <div className="st-profile-actions">
        <button
          type="button"
          className="cb-btn cb-btn--primary cb-btn--pill"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        {handleLogout && (
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--pill"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Выход…" : "Выйти"}
          </button>
        )}
      </div>

      {msg && <p className="st-toast" role="status">{msg}</p>}
    </StudentPageShell>
  );
}
