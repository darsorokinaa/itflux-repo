import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { fetchStudentBilling, fetchStudentProfile, updateStudentProfile } from "../../../utils/cabinetAuth";
import { billingTypeLabel, formatMoney, formatUnits } from "../../billing/billingFormat";
import CabinetIcon from "../../CabinetIcons";
import { loadStudentData } from "../studentData";
import { StudentPageShell } from "../StudentSectionUi";
import "../../styles/payments.css";

export default function StudentProfilePage() {
  const { handleLogout, loggingOut } = useOutletContext?.() ?? {};

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState(null);
  const [billingAccounts, setBillingAccounts] = useState([]);

  useEffect(() => {
    loadStudentData(fetchStudentProfile, "profile")
      .then(setProfile)
      .finally(() => setLoading(false));
    fetchStudentBilling()
      .then((data) => setBillingAccounts(data?.accounts || []))
      .catch(() => setBillingAccounts([]));
  }, []);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    setMsg("");
    setMsgType(null);
    try {
      await updateStudentProfile({
        name: profile.name,
        surname: profile.surname,
        notifications_enabled: profile.notifications_enabled,
      });
      setMsg("Сохранено");
      setMsgType("success");
    } catch (e) {
      setMsg(e.message || "Ошибка сохранения");
      setMsgType("error");
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

      {billingAccounts.length ? (
        <section className="st-profile-section">
          <h2 className="st-profile-section__title">Оплата занятий</h2>
          {billingAccounts.map((acc) => (
            <div key={acc.id} className="pay-student-block" style={{ marginBottom: 10 }}>
              <div className="pay-student-block__grid">
                <div>
                  <span>Схема</span>
                  <strong>{billingTypeLabel(acc.billing_type)}</strong>
                </div>
                <div>
                  <span>Остаток абонемента</span>
                  <strong>
                    {acc.package
                      ? formatUnits(acc.package.remaining_units, acc.package.unit_type)
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Задолженность</span>
                  <strong>{formatMoney(acc.balance?.debt || 0, acc.currency)}</strong>
                </div>
                <div>
                  <span>Цена</span>
                  <strong>
                    {acc.default_lesson_price
                      ? formatMoney(acc.default_lesson_price, acc.currency)
                      : "—"}
                  </strong>
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

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
        <p className="cabinet-auth-muted" style={{ marginBottom: "0.75rem" }}>
          Напоминания об уроках и заданиях — в Telegram и в кабинете.
        </p>
        <Link to="/cabinet/settings/notifications/" className="cb-btn cb-btn--outline cb-btn--pill">
          Настройки уведомлений
        </Link>
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

      {msg && msgType ? (
        <p
          className={`st-toast st-toast--${msgType}`}
          role={msgType === "error" ? "alert" : "status"}
        >
          <CabinetIcon name={msgType === "success" ? "check" : "alert"} />
          <span>{msg}</span>
        </p>
      ) : null}
    </StudentPageShell>
  );
}
