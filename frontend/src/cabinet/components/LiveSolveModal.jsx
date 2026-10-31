import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  closeVariantLiveSession,
  createVariantLiveSession,
  fetchVariantIssueQuota,
  fetchVariantLiveSessions,
  variantLimitMessage,
} from "../../utils/cabinetAuth";
import { describeQuota, liveSolveJoinUrl } from "../liveSolve";
import "../styles/live-solve.css";

/**
 * r125: «Решать вариант» вне урока. Учитель создаёт ссылку (для любого своего
 * ученика или для одного), ученик решает, учитель смотрит ответы в реальном времени.
 */
export default function LiveSolveModal({ variantUrl, variantId, title = "", onClose }) {
  const [mode, setMode] = useState("open");
  const [studentId, setStudentId] = useState("");
  const [quota, setQuota] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVariantIssueQuota(variantId).then((d) => { if (!cancelled) setQuota(d); }).catch(() => {});
    fetchVariantLiveSessions({ variantId }).then((d) => { if (!cancelled) setSessions(d?.sessions || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [variantId]);

  const students = useMemo(() => (quota?.students || []).filter((s) => s.hasAccount), [quota]);
  const picked = students.find((s) => String(s.studentId) === String(studentId));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await createVariantLiveSession({
        variantUrl,
        title,
        studentId: mode === "student" && studentId ? Number(studentId) : null,
      });
      setCreated(data.session);
      setSessions((prev) => [data.session, ...prev]);
    } catch (err) {
      const limit = variantLimitMessage(err);
      setError(limit || { text: err?.message || "Не удалось создать ссылку" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (session) => {
    try {
      await navigator.clipboard.writeText(liveSolveJoinUrl(session));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Скопируйте ссылку", liveSolveJoinUrl(session));
    }
  };

  const close = async (session) => {
    if (!window.confirm("Закрыть ссылку? Новые ученики не смогут подключиться, результаты сохранятся.")) return;
    try {
      await closeVariantLiveSession(session.id);
      setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, closedAt: new Date().toISOString() } : s)));
    } catch (err) {
      setError({ text: err?.message || "Не удалось закрыть" });
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="ls-backdrop" role="presentation" onClick={onClose}>
      <div className="ls-modal" role="dialog" aria-modal="true" aria-label="Решать вариант" onClick={(e) => e.stopPropagation()}>
        <div className="ls-head">
          <h2>Решать вариант</h2>
          <button type="button" className="ls-x" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <p className="ls-lead">
          Ученик открывает ссылку, входит в свой кабинет и решает вариант. Вы видите его ответы в реальном времени,
          а результат сохраняется.
        </p>
        {quota?.limit != null && (
          <p className="ls-plan">
            Тариф «{quota.planName}»: до {quota.limit} разных вариантов одному ученику в месяц.
          </p>
        )}

        {!created && (
          <>
            <div className="ls-modes" role="radiogroup">
              <label className={mode === "open" ? "is-on" : ""}>
                <input type="radio" checked={mode === "open"} onChange={() => setMode("open")} />
                Для любого моего ученика
              </label>
              <label className={mode === "student" ? "is-on" : ""}>
                <input type="radio" checked={mode === "student"} onChange={() => setMode("student")} />
                Для одного ученика
              </label>
            </div>
            {mode === "student" && (
              <select className="ls-select" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Выберите ученика</option>
                {students.map((s) => (
                  <option key={s.studentId} value={s.studentId} disabled={!s.canIssue}>
                    {s.displayName} — {describeQuota(s)}
                  </option>
                ))}
              </select>
            )}
            {mode === "student" && picked && !picked.canIssue && (
              <p className="ls-warn">Лимит для этого ученика исчерпан.</p>
            )}
            <button
              type="button"
              className="ls-btn ls-btn--primary"
              disabled={busy || (mode === "student" && (!picked || !picked.canIssue))}
              onClick={create}
            >
              {busy ? "Создаём…" : "Создать ссылку"}
            </button>
          </>
        )}

        {created && (
          <div className="ls-created">
            <div className="ls-link">{liveSolveJoinUrl(created)}</div>
            <div className="ls-row">
              <button type="button" className="ls-btn ls-btn--primary" onClick={() => copy(created)}>
                {copied ? "Скопировано" : "Скопировать ссылку для ученика"}
              </button>
              <a className="ls-btn" href={created.teacherUrl}>Открыть результаты</a>
            </div>
          </div>
        )}

        {error && (
          <div className="ls-error" role="alert">
            {error.text}
            {error.upgradeUrl && (
              <div><a href={error.upgradeUrl}>Перейти на тариф выше</a></div>
            )}
          </div>
        )}

        {sessions.length > 0 && (
          <div className="ls-history">
            <h3>Ссылки по этому варианту</h3>
            <ul>
              {sessions.slice(0, 10).map((s) => (
                <li key={s.id}>
                  <span>
                    {new Date(s.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                    {" · "}
                    {s.studentName || "любой ученик"}
                    {" · решали: "}
                    {s.studentsCount ?? 0}
                    {s.closedAt ? " · закрыта" : ""}
                  </span>
                  <span className="ls-row">
                    <a href={s.teacherUrl}>Результаты</a>
                    {!s.closedAt && <button type="button" className="ls-link-btn" onClick={() => copy(s)}>Ссылка</button>}
                    {!s.closedAt && <button type="button" className="ls-link-btn" onClick={() => close(s)}>Закрыть</button>}
                  </span>
                </li>
              ))}
            </ul>
            <a className="ls-all" href="/cabinet/live-variants">Все live-решения</a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
