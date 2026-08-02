import { useCallback, useEffect, useState } from "react";
import CabinetModal from "./CabinetModal";
import {
  createStudentParentInvite,
  fetchStudentParentsAccess,
  revokeStudentParentInvite,
  updateStudentParentAccess,
} from "../../utils/cabinetAuth";
import "../styles/parent-cabinet.css";

const REL_TYPES = [
  { value: "mother", label: "Мама" },
  { value: "father", label: "Папа" },
  { value: "guardian", label: "Опекун" },
  { value: "other", label: "Другой представитель" },
];

const PERM_OPTIONS = [
  ["view_schedule", "Расписание"],
  ["view_homework", "Домашние задания"],
  ["view_results", "Результаты"],
  ["view_journal", "Журнал"],
  ["view_attendance", "Посещаемость"],
  ["view_comments", "Комментарии"],
  ["view_billing", "Финансы"],
  ["receive_notifications", "Уведомления"],
];

const DEFAULT_PERMS = {
  view_schedule: true,
  view_homework: true,
  view_results: true,
  view_journal: true,
  view_attendance: true,
  view_comments: true,
  view_billing: false,
  receive_notifications: true,
};

const STATUS_LABELS = {
  pending: "Приглашение создано",
  accepted: "Принято",
  expired: "Ссылка просрочена",
  revoked: "Отозвано",
  active: "Доступ активен",
  suspended: "Временно отключён",
};

const EMPTY_INVITE_FORM = {
  invited_name: "",
  invited_email: "",
  invited_phone: "",
  relationship_type: "mother",
  expires_days: 7,
  permissions: { ...DEFAULT_PERMS },
};

function absoluteInviteUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${window.location.origin}${path}`;
}

function mergePerms(raw) {
  const next = { ...DEFAULT_PERMS };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(next)) {
      if (key in raw) next[key] = Boolean(raw[key]);
    }
  }
  return next;
}

function PermissionChecks({ permissions, onChange, disabled }) {
  return (
    <fieldset className="cb-parents-access__perms" disabled={disabled}>
      <legend>Доступные данные</legend>
      <div className="cb-parents-access__perms-grid">
        {PERM_OPTIONS.map(([key, label]) => (
          <label key={key} className="cb-parents-access__check">
            <input
              type="checkbox"
              checked={Boolean(permissions[key])}
              onChange={(e) => onChange(key, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PermissionBadges({ permissions }) {
  const perms = permissions || {};
  const enabled = PERM_OPTIONS.filter(([key]) => perms[key]).map(([, label]) => label);
  if (!enabled.length) {
    return <span className="cb-parents-access__badge cb-parents-access__badge--muted">Нет доступа к данным</span>;
  }
  return (
    <div className="cb-parents-access__badges">
      {perms.view_billing ? (
        <span className="cb-parents-access__badge">Финансы</span>
      ) : (
        <span className="cb-parents-access__badge cb-parents-access__badge--muted">Без финансов</span>
      )}
      <span className="cb-parents-access__badge cb-parents-access__badge--muted">
        {enabled.length} из {PERM_OPTIONS.length}
      </span>
    </div>
  );
}

export default function StudentParentsAccessBlock({ studentId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [relationships, setRelationships] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [modal, setModal] = useState(null); // null | { type: 'invite' } | { type: 'edit', relationship }
  const [saving, setSaving] = useState(false);
  const [createdLink, setCreatedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [inviteForm, setInviteForm] = useState({ ...EMPTY_INVITE_FORM, permissions: { ...DEFAULT_PERMS } });
  const [editPerms, setEditPerms] = useState({ ...DEFAULT_PERMS });

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchStudentParentsAccess(studentId);
      setRelationships(data.relationships || []);
      setInvitations(data.invitations || []);
    } catch (err) {
      setError(err.message || "Не удалось загрузить данные о родителях");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openInvite = () => {
    setInviteForm({ ...EMPTY_INVITE_FORM, permissions: { ...DEFAULT_PERMS } });
    setCreatedLink("");
    setError("");
    setModal({ type: "invite" });
  };

  const openEdit = (rel) => {
    setEditPerms(mergePerms(rel.permissions));
    setError("");
    setModal({ type: "edit", relationship: rel });
  };

  const closeModal = () => {
    if (saving) return;
    setModal(null);
  };

  const setInvitePerm = (key, value) => {
    setInviteForm((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: value },
    }));
  };

  const setEditPerm = (key, value) => {
    setEditPerms((prev) => ({ ...prev, [key]: value }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const invite = await createStudentParentInvite(studentId, inviteForm);
      const url = absoluteInviteUrl(invite.invite_url || invite.accept_path);
      setCreatedLink(url);
      setModal(null);
      await load();
    } catch (err) {
      setError(err.message || "Не удалось создать приглашение");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (modal?.type !== "edit" || !modal.relationship) return;
    setSaving(true);
    setError("");
    try {
      await updateStudentParentAccess(studentId, modal.relationship.id, {
        permissions: editPerms,
      });
      setModal(null);
      await load();
    } catch (err) {
      setError(err.message || "Не удалось сохранить доступ");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать ссылку");
    }
  };

  const handleRevokeInvite = async (invitationId) => {
    try {
      await revokeStudentParentInvite(studentId, invitationId);
      await load();
    } catch (err) {
      setError(err.message || "Не удалось отозвать приглашение");
    }
  };

  const handleRelAction = async (relationshipId, action) => {
    try {
      await updateStudentParentAccess(studentId, relationshipId, { action });
      await load();
    } catch (err) {
      setError(err.message || "Не удалось изменить доступ");
    }
  };

  const visibleInvites = invitations.filter((inv) =>
    ["pending", "expired"].includes(inv.status)
  );

  return (
    <div className="cb-entity-plan-block cb-parents-access">
      <div className="cb-entity-plan-block__head">
        <span className="cb-entity-plan-block__label">Родители и доступ</span>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={openInvite}>
          Пригласить родителя
        </button>
      </div>

      {error && !modal ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}

      {createdLink ? (
        <div className="cb-parents-access__link-box">
          <label className="cb-field cb-field--wide">
            <span>Ссылка приглашения (одноразовая)</span>
            <input readOnly value={createdLink} onFocus={(e) => e.target.select()} />
          </label>
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            onClick={() => copyLink(createdLink)}
          >
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="cb-entity-plan-block__empty">Загрузка…</p>
      ) : relationships.length === 0 && visibleInvites.length === 0 ? (
        <p className="cb-entity-plan-block__empty">
          Пока нет связанных родителей. Создайте приглашение из этой карточки ученика.
        </p>
      ) : (
        <ul className="cb-parents-access__list">
          {relationships.map((rel) => (
            <li key={`rel-${rel.id}`} className="cb-parents-access__item">
              <div className="cb-parents-access__main">
                <strong>{rel.parent_name}</strong>
                <span className="cb-parents-access__meta">
                  {rel.relationship_type_label || rel.relationship_type}
                  {" · "}
                  {STATUS_LABELS[rel.status] || rel.status}
                  {rel.confirmed_at
                    ? ` · подключён ${new Date(rel.confirmed_at).toLocaleDateString("ru-RU")}`
                    : ""}
                </span>
                <PermissionBadges permissions={rel.permissions} />
              </div>
              <div className="cb-parents-access__actions">
                <button
                  type="button"
                  className="cb-btn cb-btn--outline cb-btn--sm"
                  onClick={() => openEdit(rel)}
                >
                  Доступ
                </button>
                {rel.status === "active" ? (
                  <>
                    <button
                      type="button"
                      className="cb-btn cb-btn--outline cb-btn--sm"
                      onClick={() => handleRelAction(rel.id, "suspend")}
                    >
                      Отключить
                    </button>
                    <button
                      type="button"
                      className="cb-btn cb-btn--outline cb-btn--sm cb-btn--danger"
                      onClick={() => handleRelAction(rel.id, "revoke")}
                    >
                      Отозвать
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm"
                    onClick={() => handleRelAction(rel.id, "activate")}
                  >
                    Включить
                  </button>
                )}
              </div>
            </li>
          ))}

          {visibleInvites.map((inv) => (
            <li key={`inv-${inv.id}`} className="cb-parents-access__item">
              <div className="cb-parents-access__main">
                <strong>{inv.invited_name || inv.invited_email || "Родитель"}</strong>
                <span className="cb-parents-access__meta">
                  {STATUS_LABELS[inv.status] || inv.status}
                  {inv.expires_at
                    ? ` · до ${new Date(inv.expires_at).toLocaleDateString("ru-RU")}`
                    : ""}
                  {inv.short_code ? ` · код ${inv.short_code}` : ""}
                </span>
                <PermissionBadges permissions={inv.permissions} />
              </div>
              {inv.status === "pending" ? (
                <div className="cb-parents-access__actions">
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm cb-btn--danger"
                    onClick={() => handleRevokeInvite(inv.id)}
                  >
                    Отозвать ссылку
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {modal?.type === "invite" ? (
        <CabinetModal title="Пригласить родителя" onClose={closeModal}>
          <form className="cb-modal-form cb-parents-access__form" onSubmit={handleCreate}>
            {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
            <div className="cb-parents-access__form-grid">
              <label className="cb-field">
                <span>Имя родителя</span>
                <input
                  value={inviteForm.invited_name}
                  onChange={(e) => setInviteForm((p) => ({ ...p, invited_name: e.target.value }))}
                  required
                  autoFocus
                />
              </label>
              <label className="cb-field">
                <span>Email</span>
                <input
                  type="email"
                  value={inviteForm.invited_email}
                  onChange={(e) => setInviteForm((p) => ({ ...p, invited_email: e.target.value }))}
                />
              </label>
              <label className="cb-field">
                <span>Телефон</span>
                <input
                  value={inviteForm.invited_phone}
                  onChange={(e) => setInviteForm((p) => ({ ...p, invited_phone: e.target.value }))}
                />
              </label>
              <label className="cb-field">
                <span>Тип связи</span>
                <select
                  value={inviteForm.relationship_type}
                  onChange={(e) => setInviteForm((p) => ({ ...p, relationship_type: e.target.value }))}
                >
                  {REL_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <label className="cb-field">
                <span>Срок ссылки (дней)</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={inviteForm.expires_days}
                  onChange={(e) =>
                    setInviteForm((p) => ({ ...p, expires_days: Number(e.target.value) || 7 }))
                  }
                />
              </label>
            </div>
            <PermissionChecks
              permissions={inviteForm.permissions}
              onChange={setInvitePerm}
              disabled={saving}
            />
            <div className="cb-modal-form__actions">
              <div className="cb-modal-form__actions-main">
                <button type="button" className="cb-btn cb-btn--outline" onClick={closeModal} disabled={saving}>
                  Отмена
                </button>
                <button type="submit" className="cb-btn cb-btn--primary" disabled={saving}>
                  {saving ? "Создание…" : "Создать ссылку"}
                </button>
              </div>
            </div>
          </form>
        </CabinetModal>
      ) : null}

      {modal?.type === "edit" ? (
        <CabinetModal
          title={`Доступ · ${modal.relationship?.parent_name || "родитель"}`}
          onClose={closeModal}
        >
          <form className="cb-modal-form cb-parents-access__form" onSubmit={handleSaveEdit}>
            {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
            <p className="cb-modal__hint">
              Выберите, какие данные родитель видит в своём кабинете. Изменения применятся сразу.
            </p>
            <PermissionChecks
              permissions={editPerms}
              onChange={setEditPerm}
              disabled={saving}
            />
            <div className="cb-modal-form__actions">
              <div className="cb-modal-form__actions-main">
                <button type="button" className="cb-btn cb-btn--outline" onClick={closeModal} disabled={saving}>
                  Отмена
                </button>
                <button type="submit" className="cb-btn cb-btn--primary" disabled={saving}>
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            </div>
          </form>
        </CabinetModal>
      ) : null}
    </div>
  );
}
