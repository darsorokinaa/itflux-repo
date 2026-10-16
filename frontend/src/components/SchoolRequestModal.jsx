/** r36 → r50: заявка на тариф «Школа» (модальное окно на странице тарифов). */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";

const EMPTY = {
  name: "",
  school: "",
  contact: "",
  teachers_count: "",
  students_count: "",
  message: "",
  consent: false,
  website: "",
};

function contactLooksValid(value) {
  const v = value.trim();
  if (!v) return false;
  if (v.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  return v.replace(/\D/g, "").length >= 10;
}

export default function SchoolRequestModal({ onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ sending: false, error: "", done: "" });
  const openedAt = useRef(Date.now());

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((er) => ({ ...er, [key]: "" }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = "Укажите имя";
    if (!form.school.trim()) next.school = "Укажите название организации";
    if (!form.contact.trim()) next.contact = "Укажите телефон или e-mail";
    else if (!contactLooksValid(form.contact)) next.contact = "Проверьте телефон или e-mail";
    if (!form.consent) next.consent = "Нужно согласие на обработку персональных данных";
    setErrors(next);
    if (Object.keys(next).length) {
      setState({ sending: false, error: "", done: "" });
      return;
    }
    setState({ sending: true, error: "", done: "" });
    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/school-requests/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ ...form, elapsed_ms: Date.now() - openedAt.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setState({ sending: false, error: data.error || "Не удалось отправить заявку. Попробуйте ещё раз.", done: "" });
        return;
      }
      setState({ sending: false, error: "", done: "Спасибо! Мы свяжемся с вами в ближайшее время." });
    } catch {
      setState({ sending: false, error: "Нет связи с сервером. Попробуйте ещё раз.", done: "" });
    }
  };

  const err = (key) => (errors[key] ? <span className="school-req__field-error" role="alert">{errors[key]}</span> : null);

  return (
    <div className="school-req-overlay" role="dialog" aria-modal="true" aria-labelledby="school-req-title" onClick={onClose}>
      <div className="school-req" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="school-req__close" aria-label="Закрыть" onClick={onClose}>×</button>
        <h2 id="school-req-title" className="school-req__title">Заявка на тариф «Школа»</h2>
        {state.done ? (
          <div className="school-req__done">
            <p>{state.done}</p>
            <button type="button" className="pricing-card__cta" onClick={onClose}>Закрыть</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <label className="school-req__field">Имя*<input value={form.name} onChange={set("name")} maxLength={200} autoComplete="name" aria-invalid={!!errors.name} />{err("name")}</label>
            <label className="school-req__field">Название организации*<input value={form.school} onChange={set("school")} maxLength={300} autoComplete="organization" aria-invalid={!!errors.school} />{err("school")}</label>
            <label className="school-req__field">Телефон или e-mail*<input value={form.contact} onChange={set("contact")} maxLength={254} autoComplete="email" aria-invalid={!!errors.contact} />{err("contact")}</label>
            <div className="school-req__row">
              <label className="school-req__field">Число преподавателей<input type="number" min="1" inputMode="numeric" value={form.teachers_count} onChange={set("teachers_count")} /></label>
              <label className="school-req__field">Число учеников<input type="number" min="1" inputMode="numeric" value={form.students_count} onChange={set("students_count")} /></label>
            </div>
            <label className="school-req__field">Комментарий<textarea value={form.message} onChange={set("message")} rows={3} maxLength={5000} /></label>
            <input className="school-req__hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set("website")} name="website" />
            <label className="school-req__consent">
              <input type="checkbox" checked={form.consent} onChange={set("consent")} />
              <span>Я согласен(на) на обработку персональных данных в соответствии с <Link to="/privacy" target="_blank">политикой конфиденциальности</Link></span>
            </label>
            {err("consent")}
            {state.error ? <p className="school-req__error" role="alert">{state.error}</p> : null}
            <button type="submit" className="pricing-card__cta" disabled={state.sending}>{state.sending ? "Отправляем…" : "Отправить заявку"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
