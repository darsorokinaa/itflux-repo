import { useEffect, useState } from "react";
import { fetchInteractives, fetchMyFiles } from "../../utils/cabinetAuth";

const TABS = [
  ["file", "Мои файлы"],
  ["interactive", "Интерактивы"],
  ["variant", "Вариант"],
  ["trainer", "Тренажёры"],
];

function listOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

export default function MessageLibraryPicker({ open, viewerRole, onClose, onPick }) {
  const [tab, setTab] = useState("file");
  const [search, setSearch] = useState("");
  const [variantNumber, setVariantNumber] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tabs = viewerRole === "teacher" ? TABS : TABS.filter(([id]) => id !== "interactive");

  useEffect(() => {
    if (!open) return;
    setTab(viewerRole === "teacher" ? "file" : "file");
    setSearch("");
    setVariantNumber("");
    setError("");
  }, [open, viewerRole]);

  useEffect(() => {
    if (!open || tab === "variant") return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        let next = [];
        if (tab === "file") {
          const data = await fetchMyFiles(
            { search: search.trim(), page_size: 40 },
            { student: viewerRole === "student" },
          );
          next = listOf(data).filter((item) => item.kind === "file");
        } else if (tab === "interactive") {
          const data = await fetchInteractives({ search: search.trim(), status: "published" });
          next = listOf(data).filter((item) => (item.status || "published") === "published");
        } else {
          const params = new URLSearchParams();
          if (search.trim()) params.set("q", search.trim());
          const suffix = params.toString() ? `?${params}` : "";
          const res = await fetch(`/api/interesting/${suffix}`, { credentials: "same-origin" });
          if (!res.ok) throw new Error("Не удалось загрузить тренажёры");
          const data = await res.json();
          next = Array.isArray(data?.items) ? data.items : [];
        }
        if (!cancelled) setRows(next);
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setError(err?.message || "Не удалось загрузить раздел");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, tab, search, viewerRole]);

  if (!open) return null;

  const pickFile = (item) => onPick({
    kind: "file",
    id: item.id,
    title: item.display_name || item.name || "Файл",
    label: "Мои файлы",
  });
  const pickInteractive = (item) => onPick({
    kind: "interactive",
    id: item.id,
    title: item.title || "Интерактив",
    label: "Интерактив",
  });
  const pickTrainer = (item) => onPick({
    kind: "trainer",
    slug: item.slug,
    title: item.title || "Тренажёр",
    label: "Тренажёр",
  });

  return (
    <div className="cb-msg__library">
      <div className="cb-msg__library-head">
        <strong>Из библиотеки</strong>
        <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      <div className="cb-msg__library-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "is-active" : ""}
            onClick={() => { setTab(id); setSearch(""); setError(""); }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "variant" ? (
        <form
          className="cb-msg__library-variant"
          onSubmit={(event) => {
            event.preventDefault();
            const number = variantNumber.trim();
            if (!/^\d+$/.test(number)) {
              setError("Введите номер варианта");
              return;
            }
            onPick({ kind: "variant", id: Number(number), title: `Вариант №${number}`, label: "Вариант" });
            setVariantNumber("");
          }}
        >
          <input
            inputMode="numeric"
            value={variantNumber}
            onChange={(event) => setVariantNumber(event.target.value.replace(/\D/g, ""))}
            placeholder="Номер варианта"
          />
          <button type="submit">Прикрепить</button>
        </form>
      ) : (
        <label className="cb-msg__search cb-msg__library-search">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tab === "file" ? "Название файла" : tab === "interactive" ? "Название интерактива" : "Название тренажёра"}
          />
        </label>
      )}
      {error ? <p className="cb-msg__error">{error}</p> : null}
      {tab !== "variant" ? (
        <div className="cb-msg__library-list">
          {loading ? <p className="cb-msg__hint">Загрузка…</p> : null}
          {!loading && rows.length === 0 ? <p className="cb-msg__hint">В этом разделе пока ничего нет</p> : null}
          {rows.map((item) => (
            <button
              key={item.id || item.slug}
              type="button"
              className="cb-msg__dialog"
              onClick={() => {
                if (tab === "file") pickFile(item);
                else if (tab === "interactive") pickInteractive(item);
                else pickTrainer(item);
              }}
            >
              <span className="cb-msg__dialog-main">
                <span className="cb-msg__name">{item.display_name || item.name || item.title}</span>
                <span className="cb-msg__role">{tabs.find(([id]) => id === tab)?.[1]}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="cb-msg__hint">Номер сгенерированного варианта, как в комнате урока.</p>
      )}
    </div>
  );
}
