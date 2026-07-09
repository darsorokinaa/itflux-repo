import { useEffect, useState } from "react";
import {
  assignMaterialDirect,
  deleteDirectMaterial,
  fetchDirectMaterials,
  fetchGroups,
  fetchMaterials,
} from "../../utils/cabinetAuth";
import CabinetIcon from "../CabinetIcons";

function AssignForm({ groups, materials, onSuccess }) {
  const [materialId, setMaterialId] = useState("");
  const [groupId, setGroupId]       = useState("");
  const [message, setMessage]       = useState("");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!materialId || !groupId) { setError("Выберите материал и группу."); return; }
    setSaving(true);
    setError("");
    try {
      await assignMaterialDirect({ material_id: Number(materialId), group_id: Number(groupId), message });
      setMaterialId(""); setGroupId(""); setMessage("");
      onSuccess();
    } catch {
      setError("Ошибка при выдаче. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="cb-assign-mat-form" onSubmit={handleSubmit}>
      <h2 className="cb-assign-mat-form__title">Выдать материал ученикам</h2>

      <label className="cb-assign-mat-form__label">
        Материал
        <select
          className="cb-input"
          value={materialId}
          onChange={(e) => setMaterialId(e.target.value)}
          required
        >
          <option value="">— выберите материал —</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>{m.title} ({m.type_label})</option>
          ))}
        </select>
      </label>

      <label className="cb-assign-mat-form__label">
        Группа учеников
        <select
          className="cb-input"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          required
        >
          <option value="">— выберите группу —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
      </label>

      <label className="cb-assign-mat-form__label">
        Сообщение для учеников <span className="cb-assign-mat-form__opt">(необязательно)</span>
        <textarea
          className="cb-input"
          rows={2}
          placeholder="Например: «Прочитайте перед следующим занятием»"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ resize: "vertical" }}
        />
      </label>

      {error ? <p className="cb-assign-mat-form__error">{error}</p> : null}

      <button type="submit" className="cb-btn cb-btn--primary" disabled={saving}>
        {saving ? "Выдаём…" : "Выдать материал"}
      </button>
    </form>
  );
}

function AssignedRow({ item, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm("Отозвать этот материал?")) return;
    setDeleting(true);
    try { await deleteDirectMaterial(item.id); onDelete(item.id); }
    catch { /* ignore */ }
    finally { setDeleting(false); }
  };

  return (
    <div className="cb-assign-mat-row">
      <div className="cb-assign-mat-row__icon">
        <CabinetIcon name="folder" />
      </div>
      <div className="cb-assign-mat-row__body">
        <strong>{item.material_title}</strong>
        <span>{item.material_type_label} · {item.group_title || item.student_name || "—"}</span>
        {item.message ? <em>{item.message}</em> : null}
      </div>
      <button
        type="button"
        className="cb-btn cb-btn--ghost cb-btn--sm"
        onClick={handleDelete}
        disabled={deleting}
        title="Отозвать"
      >
        <CabinetIcon name="close" />
      </button>
    </div>
  );
}

export default function CabinetMaterialsAssignPage() {
  const [materials, setMaterials]   = useState([]);
  const [groups, setGroups]         = useState([]);
  const [assigned, setAssigned]     = useState([]);
  const [loading, setLoading]       = useState(true);

  const loadAll = () => {
    Promise.all([
      fetchMaterials({ mine: "true" }),
      fetchGroups(),
      fetchDirectMaterials(),
    ]).then(([mats, grps, dir]) => {
      setMaterials(mats?.results || mats?.items || []);
      setGroups(grps?.results || grps?.items || []);
      setAssigned(dir?.items || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, []);

  const handleSuccess = () => loadAll();
  const handleDelete  = (id) => setAssigned((prev) => prev.filter((a) => a.id !== id));

  if (loading) return <div className="st-loading">Загрузка…</div>;

  return (
    <div className="cb-section cb-page cb-mat-assign-page">
      <div className="cb-page-header">
        <h1 className="cb-page-title">Материалы для учеников</h1>
        <p className="cb-page-sub">Выдавайте материалы напрямую группам — они появятся в кабинете ученика во вкладке «Материалы».</p>
      </div>

      <div className="cb-mat-assign-layout">
        <AssignForm groups={groups} materials={materials} onSuccess={handleSuccess} />

        <div className="cb-mat-assign-list">
          <h2 className="cb-assign-mat-list__title">Выданные материалы</h2>
          {assigned.length === 0 ? (
            <p className="cb-empty-note">Вы ещё не выдавали материалы напрямую.</p>
          ) : (
            assigned.map((a) => (
              <AssignedRow key={a.id} item={a} onDelete={handleDelete} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
