import { useEffect, useState } from "react";
import CabinetModal from "./CabinetModal";
import { updateBillingAccountSettings } from "../../utils/cabinetAuth";
import "../styles/payments.css";

/**
 * Редактирование плательщика по биллинг-аккаунту ученика.
 */
export default function PayerEditModal({
  open,
  onClose,
  account,
  onDone,
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !account) return;
    setName(account.payer_name || "");
    setPhone(account.payer_phone || "");
    setEmail(account.payer_email || "");
    setError("");
  }, [open, account]);

  if (!open) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!account?.id) return;
    setBusy(true);
    setError("");
    try {
      const updated = await updateBillingAccountSettings(account.id, {
        payer_name: name.trim(),
        payer_phone: phone.trim(),
        payer_email: email.trim(),
      });
      onDone?.(updated);
      onClose?.();
    } catch (err) {
      setError(err.data?.detail || err.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const title = account?.student_name
    ? `Плательщик · ${account.student_name}`
    : "Плательщик";

  return (
    <CabinetModal onClose={busy ? undefined : onClose} title={title}>
      <form className="pay-payer-form" onSubmit={handleSave}>
        <label className="pay-field">
          <span>Имя / кто платит</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, мама — Анна"
            autoFocus
          />
        </label>
        <label className="pay-field">
          <span>Телефон</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7…"
          />
        </label>
        <label className="pay-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="parent@email.com"
          />
        </label>

        <p className="pay-hint pay-payer-form__hint">
          Отдельный кабинет родителя сейчас недоступен — роль временно отключена.
          Здесь сохраняются контакты плательщика для напоминаний и учёта.
        </p>

        {error ? <p className="pay-error">{error}</p> : null}

        <div className="pay-payer-form__actions">
          <button type="button" className="pay-btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className="pay-btn pay-btn--primary" disabled={busy || !account?.id}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </CabinetModal>
  );
}
