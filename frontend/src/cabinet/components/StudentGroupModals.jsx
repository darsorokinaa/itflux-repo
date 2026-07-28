import { useEffect, useState } from "react";
import CabinetModal from "./CabinetModal";
import ConfirmActionModal from "./ConfirmActionModal";
import StudentBillingPanel from "./StudentBillingPanel";
import StudentNotifySettingsPanel from "./StudentNotifySettingsPanel";
import StudentSubjectsBlock from "./StudentSubjectsBlock";
import BillingPaymentModal from "./BillingPaymentModal";
import BillingPackageModal from "./BillingPackageModal";
import BillingTermsModal from "./BillingTermsModal";
import { buildInvitationUrl, notifyBillingChanged } from "../../utils/cabinetAuth";
import {
  GROUP_EXAM_OPTIONS,
  STUDENT_DIRECTION_OPTIONS,
  STUDENT_STATUS_OPTIONS,
  emptyGroupForm,
  emptyInviteForm,
  emptyStudentForm,
  groupFormFromApi,
  groupToApiPayload,
  inviteFormToApiPayload,
  studentFormFromApi,
  studentToApiPayload,
} from "../cabinetMappers";

const GRADE_OPTIONS = ["", 5, 6, 7, 8, 9, 10, 11];

function FormActions({ onCancel, submitLabel, saving, dangerAction, formId }) {
  return (
    <div className="cb-modal-form__actions">
      {dangerAction}
      <div className="cb-modal-form__actions-main">
        <button type="button" className="cb-btn cb-btn--outline" onClick={onCancel} disabled={saving}>
          Отмена
        </button>
        <button
          type="submit"
          className="cb-btn cb-btn--primary"
          disabled={saving}
          form={formId || undefined}
        >
          {saving ? "Сохранение…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

export function StudentFormModal({ student, onClose, onSave, onArchive, onDelete, onSubjectsChanged }) {
  const isEdit = Boolean(student?.id);
  const isRegistered = Boolean(student?.raw?.is_registered);
  const [form, setForm] = useState(() => (
    student?.raw ? studentFormFromApi(student.raw) : emptyStudentForm()
  ));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [billingKey, setBillingKey] = useState(0);

  useEffect(() => {
    setForm(student?.raw ? studentFormFromApi(student.raw) : emptyStudentForm());
    setError("");
  }, [student]);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isRegistered && !form.first_name.trim()) {
      setError("Укажите имя ученика");
      return;
    }
    setSaving(true);
    try {
      await onSave(studentToApiPayload(form, { registered: isRegistered }));
    } catch (err) {
      setError(err.message || "Не удалось сохранить ученика");
      setSaving(false);
    }
  };

  const handleArchive = () => {
    if (!isEdit || !onArchive) return;
    setArchiveConfirmOpen(true);
  };

  const confirmArchive = async () => {
    if (!isEdit || !onArchive) return;
    setArchiveConfirmOpen(false);
    setSaving(true);
    try {
      await onArchive(student.id);
    } catch (err) {
      setError(err.message || "Не удалось архивировать ученика");
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!isEdit || !onDelete) return;
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!isEdit || !onDelete) return;
    setDeleteConfirmOpen(false);
    setSaving(true);
    try {
      await onDelete(student.id);
    } catch (err) {
      setError(err.message || "Не удалось удалить ученика");
      setSaving(false);
    }
  };

  const bumpBilling = (meta) => {
    setBillingKey((k) => k + 1);
    notifyBillingChanged({ studentId: meta?.studentId || meta?.student_id || student?.id });
  };

  return (
    <>
    <CabinetModal title={isEdit ? "Редактирование ученика" : "Добавить ученика"} onClose={onClose}>
      <div className="cb-modal-form">
        {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
        <form id="student-edit-form" onSubmit={handleSubmit}>
          {isRegistered ? (
            <p className="cabinet-auth-muted cb-modal-form__hint">
              Имя, фамилия и email берутся из аккаунта ученика.
            </p>
          ) : null}
          <div className="cb-plan-editor__grid">
            <label className={`cb-field${isRegistered ? " cb-field--locked" : ""}`}>
              <span>Имя *</span>
              <input
                value={form.first_name}
                onChange={(e) => setField("first_name", e.target.value)}
                autoFocus={!isRegistered}
                required={!isRegistered}
                readOnly={isRegistered}
                tabIndex={isRegistered ? -1 : undefined}
              />
            </label>
            <label className={`cb-field${isRegistered ? " cb-field--locked" : ""}`}>
              <span>Фамилия</span>
              <input
                value={form.last_name}
                onChange={(e) => setField("last_name", e.target.value)}
                readOnly={isRegistered}
                tabIndex={isRegistered ? -1 : undefined}
              />
            </label>
            <label className="cb-field">
              <span>Направление</span>
              <select value={form.direction} onChange={(e) => setField("direction", e.target.value)}>
                {STUDENT_DIRECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="cb-field">
              <span>Класс</span>
              <select value={form.grade} onChange={(e) => setField("grade", e.target.value)}>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g || "none"} value={g}>{g ? `${g} класс` : "Не указан"}</option>
                ))}
              </select>
            </label>
            <label className={`cb-field${isRegistered ? " cb-field--locked" : ""}`}>
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
                readOnly={isRegistered}
                tabIndex={isRegistered ? -1 : undefined}
              />
            </label>
            <label className="cb-field">
              <span>Телефон</span>
              <input
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
              />
            </label>
            <label className="cb-field cb-field--wide">
              <span>Контакт родителя</span>
              <input
                value={form.parent_contact}
                onChange={(e) => setField("parent_contact", e.target.value)}
              />
            </label>
            {isEdit ? (
              <label className="cb-field">
                <span>Статус</span>
                <select value={form.status} onChange={(e) => setField("status", e.target.value)}>
                  {STUDENT_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="cb-field cb-field--wide">
              <span>Заметки</span>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
              />
            </label>
          </div>
        </form>
        {isEdit ? (
          <StudentSubjectsBlock
            studentId={student.id}
            onChanged={() => onSubjectsChanged?.(student.id)}
          />
        ) : null}
        {isEdit ? (
          <StudentBillingPanel
            key={billingKey}
            studentId={student.id}
            onAddPayment={() => setPaymentOpen(true)}
            onNewPackage={() => setPackageOpen(true)}
            onEditTerms={() => setTermsOpen(true)}
          />
        ) : null}
        {isEdit ? <StudentNotifySettingsPanel studentId={student.id} /> : null}
        <FormActions
          formId="student-edit-form"
          onCancel={onClose}
          submitLabel={isEdit ? "Сохранить" : "Добавить"}
          saving={saving}
          dangerAction={isEdit && (onArchive || onDelete) ? (
            <>
              {onArchive ? (
                <button
                  type="button"
                  className="cb-btn cb-btn--outline cb-btn--danger"
                  onClick={handleArchive}
                  disabled={saving}
                >
                  В архив
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  className="cb-btn cb-btn--outline cb-btn--danger"
                  onClick={handleDelete}
                  disabled={saving}
                >
                  Удалить
                </button>
              ) : null}
            </>
          ) : null}
        />
      </div>
    </CabinetModal>
    <ConfirmActionModal
      open={archiveConfirmOpen}
      title="Архивировать ученика?"
      text={`Архивировать ученика ${student?.name || ""}? Его можно будет восстановить во вкладке «Архив».`}
      confirmLabel="В архив"
      danger
      onClose={() => setArchiveConfirmOpen(false)}
      onConfirm={confirmArchive}
    />
    <ConfirmActionModal
      open={deleteConfirmOpen}
      title="Удалить ученика навсегда?"
      text={`Ученик ${student?.name || ""} и все связанные данные (оплаты, абонементы, ДЗ) будут удалены безвозвратно.`}
      confirmLabel="Удалить навсегда"
      danger
      onClose={() => setDeleteConfirmOpen(false)}
      onConfirm={confirmDelete}
    />
    <BillingPaymentModal
      open={paymentOpen}
      onClose={() => setPaymentOpen(false)}
      students={student ? [{ id: student.id, name: student.name }] : []}
      defaultStudentId={student?.id}
      onDone={bumpBilling}
    />
    <BillingPackageModal
      open={packageOpen}
      onClose={() => setPackageOpen(false)}
      students={student ? [{ id: student.id, name: student.name }] : []}
      defaultStudentId={student?.id}
      onDone={bumpBilling}
    />
    <BillingTermsModal
      open={termsOpen}
      onClose={() => setTermsOpen(false)}
      studentId={student?.id}
      studentName={student?.name || ""}
      onDone={bumpBilling}
    />
    </>
  );
}

export function InviteFormModal({ group, onClose, onCreate }) {
  const [form, setForm] = useState(() => emptyInviteForm(group));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdInvite, setCreatedInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    setForm(emptyInviteForm(group));
    setError("");
    setCreatedInvite(null);
    setCopied(false);
    setShowQr(false);
  }, [group]);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const invite = await onCreate(inviteFormToApiPayload(form));
      if (!invite) return;
      setCreatedInvite(invite);
    } catch (err) {
      setError(err.message || "Не удалось создать приглашение");
    } finally {
      setSaving(false);
    }
  };

  const inviteUrl = createdInvite ? buildInvitationUrl(createdInvite.join_path) : "";

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const handleShare = async () => {
    if (!inviteUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Приглашение на платформу",
          text: "Присоединяйтесь к занятиям на платформе «Цифровой поток»",
          url: inviteUrl,
        });
        return;
      } catch {
        // fall through to copy
      }
    }
    await handleCopy();
  };

  const studentName = createdInvite
    ? [createdInvite.first_name, createdInvite.last_name].filter(Boolean).join(" ")
    : "";

  if (createdInvite) {
    return (
      <CabinetModal title="Ссылка создана" onClose={onClose}>
        <div className="cb-modal-form">
          {studentName ? (
            <p className="cabinet-auth-muted">
              Профиль <strong>{studentName}</strong> создан. Отправьте ссылку ученику — после входа он автоматически появится в вашем списке
              {group?.name ? ` в группе «${group.name}»` : ""}.
            </p>
          ) : (
            <p className="cabinet-auth-muted">
              Отправьте ссылку ученику. После регистрации или входа он автоматически появится в вашем списке
              {group?.name ? ` в группе «${group.name}»` : ""}.
            </p>
          )}
          <label className="cb-field cb-field--wide">
            <span>Ссылка для ученика</span>
            <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
          </label>
          {showQr ? (
            <div style={{ textAlign: "center", marginBottom: "12px" }}>
              <img
                alt="QR-код приглашения"
                width={220}
                height={220}
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(inviteUrl)}`}
              />
            </div>
          ) : null}
          <div className="cb-modal-form__actions">
            <div className="cb-modal-form__actions-main">
              <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>
                Готово
              </button>
              <button type="button" className="cb-btn cb-btn--outline" onClick={() => setShowQr((v) => !v)}>
                {showQr ? "Скрыть QR-код" : "Показать QR-код"}
              </button>
              <button type="button" className="cb-btn cb-btn--outline" onClick={handleShare}>
                Отправить
              </button>
              <button type="button" className="cb-btn cb-btn--primary" onClick={handleCopy}>
                {copied ? "Скопировано" : "Скопировать ссылку"}
              </button>
            </div>
          </div>
        </div>
      </CabinetModal>
    );
  }

  return (
    <CabinetModal
      title={group ? `Пригласить в группу «${group.name}»` : "Пригласить ученика"}
      onClose={onClose}
    >
      <form className="cb-modal-form" onSubmit={handleSubmit}>
        {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
        <p className="cabinet-auth-muted" style={{ marginBottom: "12px" }}>
          Введите имя ученика — появится в списке сразу. После входа по ссылке профиль привяжется автоматически.
        </p>
        <div className="cb-plan-editor__grid">
          <label className="cb-field">
            <span>Имя <span style={{ color: "#E53935" }}>*</span></span>
            <input
              type="text"
              value={form.first_name}
              onChange={(e) => setField("first_name", e.target.value)}
              placeholder="Анна"
              required
              autoFocus
            />
          </label>
          <label className="cb-field">
            <span>Фамилия</span>
            <input
              type="text"
              value={form.last_name}
              onChange={(e) => setField("last_name", e.target.value)}
              placeholder="Иванова"
            />
          </label>
          <label className="cb-field cb-field--wide">
            <span>Email ученика (необязательно)</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="Для дополнительной привязки"
            />
          </label>
          <label className="cb-field">
            <span>Направление</span>
            <select value={form.direction} onChange={(e) => setField("direction", e.target.value)}>
              {STUDENT_DIRECTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="cb-field">
            <span>Класс</span>
            <select value={form.grade} onChange={(e) => setField("grade", e.target.value)}>
              {GRADE_OPTIONS.map((g) => (
                <option key={g || "none"} value={g}>{g ? `${g} класс` : "Не указан"}</option>
              ))}
            </select>
          </label>
          <label className="cb-field cb-field--wide">
            <span>Сообщение ученику</span>
            <input
              value={form.message}
              onChange={(e) => setField("message", e.target.value)}
              placeholder="Например: добро пожаловать на курс ОГЭ"
            />
          </label>
        </div>
        <FormActions onCancel={onClose} submitLabel="Создать профиль и ссылку" saving={saving} />
      </form>
    </CabinetModal>
  );
}

export function GroupFormModal({ group, enrollment, onClose, onSave, onArchive, onAttachPlan }) {
  const isEdit = Boolean(group?.id);
  const [form, setForm] = useState(() => (
    group?.raw ? groupFormFromApi(group.raw) : emptyGroupForm()
  ));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  useEffect(() => {
    setForm(group?.raw ? groupFormFromApi(group.raw) : emptyGroupForm());
    setError("");
  }, [group]);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Укажите название группы");
      return;
    }
    setSaving(true);
    try {
      await onSave(groupToApiPayload(form));
    } catch (err) {
      setError(err.message || "Не удалось сохранить группу");
      setSaving(false);
    }
  };

  const handleArchive = () => {
    if (!isEdit || !onArchive) return;
    setArchiveConfirmOpen(true);
  };

  const confirmArchive = async () => {
    if (!isEdit || !onArchive) return;
    setArchiveConfirmOpen(false);
    setSaving(true);
    try {
      await onArchive(group.id);
    } catch (err) {
      setError(err.message || "Не удалось архивировать группу");
      setSaving(false);
    }
  };

  return (
    <>
    <CabinetModal title={isEdit ? "Редактирование группы" : "Создать группу"} onClose={onClose}>
      <form className="cb-modal-form" onSubmit={handleSubmit}>
        {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
        <div className="cb-plan-editor__grid">
          <label className="cb-field cb-field--wide">
            <span>Название *</span>
            <input
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="cb-field">
            <span>Направление</span>
            <select value={form.direction} onChange={(e) => setField("direction", e.target.value)}>
              {STUDENT_DIRECTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="cb-field">
            <span>Экзамен</span>
            <select value={form.exam_type} onChange={(e) => setField("exam_type", e.target.value)}>
              {GROUP_EXAM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="cb-field cb-field--wide">
            <span>Описание</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </label>
        </div>
        {isEdit && onAttachPlan ? (
          <div className="cb-entity-plan-block">
            <div className="cb-entity-plan-block__head">
              <span className="cb-entity-plan-block__label">План уроков</span>
              <button
                type="button"
                className="cb-btn cb-btn--outline cb-btn--sm"
                onClick={() => onAttachPlan(group)}
              >
                {enrollment ? "Сменить план" : "Привязать план"}
              </button>
            </div>
            {enrollment?.planTitle ? (
              <p className="cb-entity-plan-block__title">{enrollment.planTitle}</p>
            ) : (
              <p className="cb-entity-plan-block__empty">План не назначен</p>
            )}
            <div className="cb-entity-plan-block__progress">
              <div className="cb-entity-plan-block__progress-head">
                <span>Прогресс</span>
                <strong>{group?.progress || 0}%</strong>
              </div>
              <div className="cb-entity-plan-block__progress-bar" role="progressbar" aria-valuenow={group?.progress || 0} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${Math.max(0, Math.min(100, group?.progress || 0))}%` }} />
              </div>
            </div>
          </div>
        ) : null}
        <FormActions
          onCancel={onClose}
          submitLabel={isEdit ? "Сохранить" : "Создать"}
          saving={saving}
          dangerAction={isEdit && onArchive ? (
            <button
              type="button"
              className="cb-btn cb-btn--outline cb-btn--danger"
              onClick={handleArchive}
              disabled={saving}
            >
              В архив
            </button>
          ) : null}
        />
      </form>
    </CabinetModal>
    <ConfirmActionModal
      open={archiveConfirmOpen}
      title="Архивировать группу?"
      text={`Архивировать группу «${group?.name || ""}»?`}
      confirmLabel="В архив"
      danger
      onClose={() => setArchiveConfirmOpen(false)}
      onConfirm={confirmArchive}
    />
    </>
  );
}
