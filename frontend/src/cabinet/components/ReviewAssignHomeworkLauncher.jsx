import { useEffect, useMemo, useState } from "react";
import CabinetModal from "./CabinetModal";
import CabinetSearchableSelect from "./CabinetSearchableSelect";
import HomeworkAssignModal from "./HomeworkAssignModal";
import { mapApiStudent } from "../cabinetMappers";
import { fetchStudents, normalizeCabinetList } from "../../utils/cabinetAuth";

/** r119: «+ Задать ДЗ» из раздела «Домашние задания» — выбор ученика → штатная HomeworkAssignModal. */
export default function ReviewAssignHomeworkLauncher({ initialStudentId = "", onClose, onAssigned }) {
  const [students, setStudents] = useState(null);
  const [error, setError] = useState("");
  const [studentId, setStudentId] = useState(initialStudentId ? String(initialStudentId) : "");
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchStudents({ status: "active" })
      .then((data) => {
        if (!alive) return;
        const list = normalizeCabinetList(data).map(mapApiStudent);
        setStudents(list);
        if (initialStudentId) {
          const st = list.find((s) => String(s.id) === String(initialStudentId));
          if (st) setPicked(st);
        }
      })
      .catch((err) => alive && setError(err?.message || "Не удалось загрузить учеников"));
    return () => { alive = false; };
  }, [initialStudentId]);

  const options = useMemo(
    () => (students || []).map((s) => ({ id: String(s.id), label: s.name })),
    [students],
  );

  if (picked) {
    return (
      <HomeworkAssignModal
        student={picked}
        enrollment={null}
        onClose={onClose}
        onAssigned={onAssigned}
      />
    );
  }

  const selected = (students || []).find((s) => String(s.id) === String(studentId)) || null;

  return (
    <CabinetModal
      title="Задать ДЗ"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            disabled={!selected}
            onClick={() => setPicked(selected)}
          >
            Далее
          </button>
        </>
      )}
    >
      {error ? <p className="cb-form-error">{error}</p> : null}
      {students === null && !error ? <p>Загружаем учеников…</p> : null}
      {students && students.length === 0 ? <p>Сначала добавьте ученика в разделе «Ученики».</p> : null}
      {students && students.length > 0 ? (
        <CabinetSearchableSelect
          id="review-assign-student"
          label="Кому задать"
          value={studentId}
          options={options}
          allLabel="Выберите ученика"
          placeholder="Найти ученика"
          onChange={(id) => setStudentId(id || "")}
        />
      ) : null}
    </CabinetModal>
  );
}
