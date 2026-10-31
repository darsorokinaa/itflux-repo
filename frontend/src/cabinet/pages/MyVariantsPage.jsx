import { useCallback, useEffect, useMemo, useState } from "react";
import { closeVariantLiveSession, fetchMyVariants, renameMyVariant } from "../../utils/cabinetAuth";
import { liveSolveJoinUrl } from "../liveSolve";
import "../styles/my-variants.css";

/** r129: «Мои варианты» — созданные учителем варианты, переименование, live-ссылки. */

export function formatVariantDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

export function tasksWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "заданий";
  if (b === 1) return "задание";
  if (b >= 2 && b <= 4) return "задания";
  return "заданий";
}

export function filterVariants(list, { query = "", subject = "", sort = "new" } = {}) {
  const q = query.trim().toLowerCase().replace(/^№\s*/, "");
  const rows = (list || []).filter((v) => {
    if (subject && v.subject !== subject) return false;
    if (!q) return true;
    return String(v.id).includes(q) || (v.title || "").toLowerCase().includes(q);
  });
  const k = (v) => (v.createdAt ? Date.parse(v.createdAt) : 0) || 0;
  rows.sort((a, b) => (sort === "old" ? k(a) - k(b) : k(b) - k(a)));
  return rows;
}

function absUrl(path) {
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function TitleEditor({ variant, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(variant.title || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setValue(variant.title || ""), [variant.title]);

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const d = await renameMyVariant(variant.id, value);
      onSaved(d?.variant || { ...variant, title: value.trim() });
      setEditing(false);
    } catch (e) {
      setErr(e?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form
        className="mv-title-edit"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          maxLength={120}
          value={value}
          placeholder={`Вариант №${variant.id}`}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          aria-label="Название варианта"
        />
        <button type="submit" className="mv-btn mv-btn--primary mv-btn--sm" disabled={busy}>
          {busy ? "…" : "Сохранить"}
        </button>
        <button type="button" className="mv-btn mv-btn--ghost mv-btn--sm" onClick={() => setEditing(false)}>
          Отмена
        </button>
        {err ? <span className="mv-error">{err}</span> : null}
      </form>
    );
  }
  return (
    <div className="mv-title">
      <h3>{variant.title || `Вариант №${variant.id}`}</h3>
      <button type="button" className="mv-icon-btn" title="Переименовать" aria-label="Переименовать" onClick={() => setEditing(true)}>
        ✎
      </button>
    </div>
  );
}

function LiveSessions({ sessions, onClose }) {
  if (!sessions.length) {
    return <p className="mv-muted">Ссылок «Решать вариант» пока нет.</p>;
  }
  return (
    <ul className="mv-live-list">
      {sessions.map((s) => (
        <li key={s.id} className="mv-live">
          <span className={`mv-status ${s.closedAt ? "mv-status--closed" : "mv-status--open"}`}>
            {s.closedAt ? "Закрыта" : "Активна"}
          </span>
          <span className="mv-live__meta">
            {new Date(s.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
            {" · "}
            {s.studentName || "любой ученик"}
            {" · решали: "}
            <b>{s.studentsCount ?? 0}</b>
          </span>
          <span className="mv-live__actions">
            <a className="mv-link" href={s.teacherUrl}>Результаты</a>
            {!s.closedAt && (
              <>
                <button type="button" className="mv-link" onClick={() => copyText(liveSolveJoinUrl(s))}>Копировать ссылку</button>
                <button type="button" className="mv-link mv-link--muted" onClick={() => onClose(s)}>Закрыть</button>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VariantCard({ variant, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const sessions = variant.liveSessions || [];
  const active = sessions.filter((s) => !s.closedAt).length;

  const share = async () => {
    const url = absUrl(variant.url);
    if (navigator.share && window.matchMedia?.("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: variant.title || `Вариант №${variant.id}`, url });
        return;
      } catch {
        /* fallthrough */
      }
    }
    if (await copyText(url)) {
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    }
  };

  const closeSession = async (s) => {
    if (!window.confirm("Закрыть ссылку? Результаты сохранятся.")) return;
    await closeVariantLiveSession(s.id).catch(() => {});
    onUpdate({
      ...variant,
      liveSessions: sessions.map((r) => (r.id === s.id ? { ...r, closedAt: new Date().toISOString() } : r)),
    });
  };

  return (
    <article className="mv-card">
      <div className="mv-card__head">
        <span className="mv-badge" title="Номер варианта">№ {variant.id}</span>
        <span className="mv-chip">{variant.levelName}</span>
        <span className="mv-chip mv-chip--soft">{variant.subjectName}</span>
      </div>
      <TitleEditor variant={variant} onSaved={(v) => onUpdate({ ...variant, ...v, liveSessions: sessions })} />
      <div className="mv-card__meta">
        {variant.tasksCount != null ? <span>{variant.tasksCount} {tasksWord(variant.tasksCount)}</span> : null}
        <span>создан {formatVariantDate(variant.createdAt)}</span>
      </div>
      <div className="mv-actions">
        <a className="mv-btn mv-btn--ghost" href={variant.url}>Открыть</a>
        <a className="mv-btn mv-btn--primary" href={`${variant.url}?action=live`}>Решать вариант</a>
        <a className="mv-btn mv-btn--ghost" href={`${variant.url}?action=pdf`}>PDF</a>
        <button type="button" className="mv-btn mv-btn--ghost" onClick={share}>{shared ? "Скопировано" : "Поделиться"}</button>
      </div>
      <button type="button" className="mv-expand" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span>Ссылки «Решать вариант»: {sessions.length}{active ? ` · активных ${active}` : ""}</span>
        <span className={`mv-chevron${open ? " is-open" : ""}`} aria-hidden="true">▾</span>
      </button>
      {open ? <LiveSessions sessions={sessions} onClose={closeSession} /> : null}
    </article>
  );
}

export default function MyVariantsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [sort, setSort] = useState("new");

  useEffect(() => {
    fetchMyVariants()
      .then((d) => setData({ variants: d?.variants || [], subjects: d?.subjects || [] }))
      .catch((e) => setError(e?.message || "Ошибка загрузки"));
  }, []);

  const update = useCallback((v) => {
    setData((prev) => ({ ...prev, variants: prev.variants.map((x) => (x.id === v.id ? v : x)) }));
  }, []);

  const rows = useMemo(() => filterVariants(data?.variants, { query, subject, sort }), [data, query, subject, sort]);

  return (
    <div className="mv-page">
      <header className="mv-header">
        <div>
          <h1>Мои варианты</h1>
          <p>Варианты, которые вы создали. Переименуйте их — номер варианта сохранится.</p>
        </div>
      </header>
      <div className="mv-toolbar">
        <input
          className="mv-search"
          type="search"
          placeholder="Поиск по названию или номеру"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="mv-select" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Предмет">
          <option value="">Все предметы</option>
          {(data?.subjects || []).map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
        <select className="mv-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
          <option value="new">Сначала новые</option>
          <option value="old">Сначала старые</option>
        </select>
      </div>
      {error ? <p className="mv-error">{error}</p> : null}
      {!data && !error ? <p className="mv-muted">Загрузка…</p> : null}
      {data && rows.length === 0 ? (
        <div className="mv-empty">
          {data.variants.length ? "Ничего не найдено." : "Вы ещё не создали ни одного варианта. Соберите вариант в генераторе — он появится здесь."}
        </div>
      ) : null}
      <div className="mv-grid">
        {rows.map((v) => (
          <VariantCard key={v.id} variant={v} onUpdate={update} />
        ))}
      </div>
    </div>
  );
}
