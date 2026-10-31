import { useEffect, useState } from "react";
import { closeVariantLiveSession, fetchVariantLiveSessions } from "../../utils/cabinetAuth";
import { liveSolveJoinUrl } from "../liveSolve";
import "../styles/live-solve.css";

/** r125: список всех «Решать вариант» учителя. */
export default function LiveVariantsPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchVariantLiveSessions().then((d) => setRows(d?.sessions || [])).catch((e) => setError(e?.message || "Ошибка загрузки"));
  }, []);

  const close = async (s) => {
    if (!window.confirm("Закрыть ссылку? Результаты сохранятся.")) return;
    await closeVariantLiveSession(s.id).catch(() => {});
    setRows((prev) => prev.map((r) => (r.id === s.id ? { ...r, closedAt: new Date().toISOString() } : r)));
  };

  return (
    <div className="ls-page">
      <h1>Решение вариантов по ссылке</h1>
      <p>Ссылки, по которым ученики решают варианты вне урока. Ответы видны в реальном времени, результаты сохраняются.</p>
      {error && <p className="ls-error">{error}</p>}
      {rows === null && !error && <p>Загрузка…</p>}
      {rows && rows.length === 0 && <p>Пока нет ни одной ссылки. Откройте вариант и нажмите «Решать вариант».</p>}
      {rows && rows.length > 0 && (
        <table>
          <thead><tr><th>Создана</th><th>Вариант</th><th>Для кого</th><th>Решали</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{s.title}</td>
                <td>{s.studentName || "любой ученик"}</td>
                <td>{s.studentsCount ?? 0}{s.closedAt ? " · закрыта" : ""}</td>
                <td className="ls-row">
                  <a href={s.teacherUrl}>Результаты</a>
                  {!s.closedAt && (
                    <button type="button" className="ls-link-btn" onClick={() => navigator.clipboard?.writeText(liveSolveJoinUrl(s))}>Ссылка</button>
                  )}
                  {!s.closedAt && <button type="button" className="ls-link-btn" onClick={() => close(s)}>Закрыть</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
