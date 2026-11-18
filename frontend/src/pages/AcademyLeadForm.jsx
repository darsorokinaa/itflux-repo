import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { trackGoal } from "../utils/analytics";
import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";
import { readAcquisition } from "../cabinet/visitContext";
import {
  ACADEMY_CONSENT_VERSION,
  ACADEMY_SUCCESS_MESSAGE,
  SUBJECTS,
  collectAcquisition,
  validateAcademyForm,
} from "./academyLead";

const EMPTY = {
  student_name: "",
  parent_name: "",
  grade: "",
  subject: "",
  contact: "",
  comment: "",
  consent: false,
  company_website: "",
};

function FieldError({ id, children }) {
  if (!children) return null;
  return <p className="academy-error" id={id} role="alert">{children}</p>;
}

function describedBy(base, key, errors) {
  return errors[key] ? `${base}-${key}-error` : undefined;
}

async function sendAcademyLead(form, acquisition) {
  await ensureCsrfCookie();
  const response = await fetch("/api/academy-leads/", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CSRFToken": getCsrfToken(),
    },
    body: JSON.stringify({
      student_name: form.student_name.trim(),
      parent_name: form.parent_name.trim(),
      grade: Number(form.grade),
      subject: form.subject,
      contact: form.contact.trim(),
      comment: form.comment.trim(),
      consent: true,
      consent_text_version: ACADEMY_CONSENT_VERSION,
      company_website: form.company_website,
      ...acquisition,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 429) {
    return { formError: data.error || "Слишком много попыток. Попробуйте позже." };
  }
  if (!response.ok || !data.ok) {
    return {
      errors: data.errors && typeof data.errors === "object" ? data.errors : null,
      formError: data.error || "Не удалось отправить заявку. Попробуйте ещё раз.",
    };
  }
  return { success: data.message || ACADEMY_SUCCESS_MESSAGE };
}

function applySendResult(result, form, setErrors, setFormError, setSuccess) {
  if (result.formError) setFormError(result.formError);
  if (result.errors) setErrors(result.errors);
  if (!result.success) return;
  trackGoal("academy_lead_submit", { subject: form.subject, grade: form.grade });
  setSuccess(result.success);
}

export default function AcademyLeadForm() {
  const { search } = useLocation();
  const formBase = useId();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState("");
  const [formError, setFormError] = useState("");
  const successRef = useRef(null);

  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const next = validateAcademyForm(form);
    setErrors(next);
    setFormError("");
    if (Object.keys(next).length) {
      document.getElementById(`${formBase}-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setSending(true);
    try {
      const result = await sendAcademyLead(form, collectAcquisition({
        search,
        stored: readAcquisition(),
        referrer: typeof document !== "undefined" ? document.referrer : "",
      }));
      applySendResult(result, form, setErrors, setFormError, setSuccess);
    } catch {
      setFormError("Нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  if (success) {
    return (
      <div className="academy-success" role="status" tabIndex={-1} ref={successRef}>
        <p>{success}</p>
      </div>
    );
  }

  return (
    <form className="academy-form" onSubmit={submit} noValidate>
      <div className="academy-field">
        <label htmlFor={`${formBase}-student_name`}>Имя ученика</label>
        <input id={`${formBase}-student_name`} value={form.student_name} onChange={(event) => setField("student_name", event.target.value)} autoComplete="section-student name" maxLength={200} required aria-invalid={errors.student_name ? "true" : "false"} aria-describedby={describedBy(formBase, "student_name", errors)} />
        <FieldError id={`${formBase}-student_name-error`}>{errors.student_name}</FieldError>
      </div>
      <div className="academy-field">
        <label htmlFor={`${formBase}-parent_name`}>Имя родителя <span className="academy-optional">(необязательно)</span></label>
        <input id={`${formBase}-parent_name`} value={form.parent_name} onChange={(event) => setField("parent_name", event.target.value)} autoComplete="section-parent name" maxLength={200} />
      </div>
      <div className="academy-field">
        <label htmlFor={`${formBase}-grade`}>Класс</label>
        <select id={`${formBase}-grade`} value={form.grade} onChange={(event) => setField("grade", event.target.value)} required aria-invalid={errors.grade ? "true" : "false"} aria-describedby={describedBy(formBase, "grade", errors)}>
          <option value="">Выберите класс</option>
          <option value="9">9</option>
          <option value="10">10</option>
          <option value="11">11</option>
        </select>
        <FieldError id={`${formBase}-grade-error`}>{errors.grade}</FieldError>
      </div>
      <div className="academy-field">
        <label htmlFor={`${formBase}-subject`}>Предмет</label>
        <select id={`${formBase}-subject`} value={form.subject} onChange={(event) => setField("subject", event.target.value)} required aria-invalid={errors.subject ? "true" : "false"} aria-describedby={describedBy(formBase, "subject", errors)}>
          <option value="">Выберите предмет</option>
          {SUBJECTS.map((item) => (
            <option key={item.value} value={item.value} disabled={form.grade !== "" && !item.grades.includes(Number(form.grade))}>{item.label}</option>
          ))}
        </select>
        <FieldError id={`${formBase}-subject-error`}>{errors.subject}</FieldError>
      </div>
      <div className="academy-field">
        <label htmlFor={`${formBase}-contact`}>Контакт — Telegram @username или телефон</label>
        <input id={`${formBase}-contact`} value={form.contact} onChange={(event) => setField("contact", event.target.value)} autoComplete="tel" inputMode="text" maxLength={80} required aria-invalid={errors.contact ? "true" : "false"} aria-describedby={describedBy(formBase, "contact", errors)} />
        <FieldError id={`${formBase}-contact-error`}>{errors.contact}</FieldError>
      </div>
      <div className="academy-field">
        <label htmlFor={`${formBase}-comment`}>Комментарий <span className="academy-optional">(необязательно)</span></label>
        <textarea id={`${formBase}-comment`} value={form.comment} onChange={(event) => setField("comment", event.target.value)} rows={4} maxLength={4000} placeholder="Цель и есть ли уже результаты пробников" />
        <FieldError id={`${formBase}-comment-error`}>{errors.comment}</FieldError>
      </div>
      <div className="academy-hp" aria-hidden="true">
        <label>
          Компания
          <input name="company_website" tabIndex={-1} autoComplete="off" value={form.company_website} onChange={(event) => setField("company_website", event.target.value)} />
        </label>
      </div>
      <label className="academy-consent">
        <input id={`${formBase}-consent`} type="checkbox" checked={form.consent} onChange={(event) => setField("consent", event.target.checked)} aria-invalid={errors.consent ? "true" : "false"} aria-describedby={describedBy(formBase, "consent", errors)} />
        <span>
          Я родитель (законный представитель) ученика и даю{" "}
          <Link to="/academy/consent">согласие на обработку персональных данных</Link>
          {" "}— моих и ученика — для связи по заявке и проведения бесплатной диагностики. С{" "}
          <Link to="/privacy">Политикой обработки персональных данных</Link> ознакомлен(а).
        </span>
      </label>
      <FieldError id={`${formBase}-consent-error`}>{errors.consent}</FieldError>
      {formError ? <p className="academy-error" role="alert">{formError}</p> : null}
      <button className="academy-btn academy-submit" type="submit" disabled={sending}>
        {sending ? "Отправляем…" : "Записаться на диагностику"}
      </button>
    </form>
  );
}
