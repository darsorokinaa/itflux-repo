import { useEffect, useMemo, useState } from "react";
import { copyMyFilesToStudents, fetchStudents, normalizeCabinetList } from "../../../utils/cabinetAuth";
import { mapApiStudent } from "../../cabinetMappers";
import CabinetModal from "../CabinetModal";
import { studentLabel } from "./fileUtils";

export default function CopyToStudentsModal({
  open,
  files = [],
  materials = [],
  excludeStudentId,
  onClose,
  onCopied,
}) {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setSearch("");
    setSelected(new Set());
    setError("");
    setLoading(true);
    fetchStudents()
      .then((data) => {
        const list = normalizeCabinetList(data).map(mapApiStudent);
        setStudents(list.filter((s) => String(s.id) !== String(excludeStudentId || "")));
      })
      .catch((err) => setError(err?.message || "Не удалось загрузить учеников"))
      .finally(() => setLoading(false));
  }, [open, excludeStudentId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => studentLabel(s).toLowerCase().includes(q));
  }, [students, search]);

  if (!open) return null;

  const count = files.length + materials.length;
  const title = count > 1 ? `Скопировать ${count} файлов ученикам` : "Скопировать ученикам";

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((s) => String(s.id))));
  };

  const handleCopy = async () => {
    if (!selected.size) {
      setError("Выберите хотя бы одного ученика");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await copyMyFilesToStudents({
        ids: files.map((f) => f.id),
        material_ids: materials.map((m) => m.id),
        student_ids: [...selected].map(Number),
      });
      onCopied?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Не удалось скопировать");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CabinetModal
      title={title}
      onClose={submitting ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            onClick={handleCopy}
            disabled={submitting || loading || selected.size === 0}
          >
            {submitting ? "Копируем…" : `Скопировать${selected.size ? ` (${selected.size})` : ""}`}
          </button>
        </>
      )}
    >
      <div className="cb-files-copy">
        <p className="cb-files-copy__lead">
          Файл появится в разделе «Файлы учеников» у выбранных учеников. Физическая копия не создаётся.
        </p>
        <input
          type="search"
          className="cb-files__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск ученика"
          aria-label="Поиск ученика"
        />
        {loading ? <p className="cb-page-sub">Загрузка учеников…</p> : null}
        {!loading && filtered.length > 0 ? (
          <label className="cb-files-copy__all">
            <input
              type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={toggleAll}
            />
            Выбрать всех ({filtered.length})
          </label>
        ) : null}
        <ul className="cb-files-copy__list">
          {filtered.map((s) => (
            <li key={s.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(String(s.id))}
                  onChange={() => toggle(String(s.id))}
                />
                <span>
                  <strong>{studentLabel(s)}</strong>
                  {s.subject ? <em>{s.subject}</em> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {!loading && filtered.length === 0 ? (
          <p className="cb-files__empty">Ученики не найдены.</p>
        ) : null}
        {error ? <p className="cb-modal-form__error" role="alert">{error}</p> : null}
      </div>
    </CabinetModal>
  );
}
