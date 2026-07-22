import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentMaterials } from "../../../utils/cabinetAuth";
import {
  StudentEmptyState,
  StudentPageShell,
} from "../StudentSectionUi";
import CabinetIcon from "../../CabinetIcons";

const TYPE_ICONS = {
  lesson:       { icon: "lessons",   color: "#2F5EF5", bg: "#EEF2FF" },
  task_set:     { icon: "tasks",     color: "#2F5EF5", bg: "#EEF2FF" },
  worksheet:    { icon: "note",      color: "#7C3AED", bg: "#EDE9FE" },
  presentation: { icon: "plan",      color: "#D97706", bg: "#FEF3C7" },
  methodic:     { icon: "book",      color: "#059669", bg: "#D1FAE5" },
  link:         { icon: "arrow",     color: "#2F5EF5", bg: "#EEF2FF" },
  file:         { icon: "folder",    color: "#D97706", bg: "#FEF3C7" },
  board:        { icon: "board",     color: "#0D9488", bg: "#CCFBF1" },
};

function MaterialRow({ item }) {
  const { icon, color, bg } = TYPE_ICONS[item.type] || { icon: "note", color: "#667085", bg: "#F3F4F6" };
  const boardUrl = item.type === "board"
    ? (item.board_url || (item.board_id ? `/cabinet/boards/${item.board_id}` : ""))
    : "";
  const url = boardUrl || item.external_url || item.file_url;
  const isExternal = Boolean(item.external_url) && item.type !== "board";
  const isInternalBoard = item.type === "board" && Boolean(boardUrl);

  const inner = (
    <>
      <span className="st-mat-row__icon" style={{ background: bg, color }} aria-hidden="true">
        <CabinetIcon name={icon} />
      </span>
      <span className="st-mat-row__body">
        <span className="st-mat-row__title">{item.title}</span>
        <span className="st-mat-row__meta">
          {item.type_label}
          {item.lesson_topic ? ` · ${item.lesson_topic}` : ""}
          {item.direct ? " · Выдано учителем" : ""}
        </span>
        {item.message ? <span className="st-mat-row__msg">{item.message}</span> : null}
      </span>
      {url ? (
        <span className="st-mat-row__arrow" aria-hidden="true">
          <CabinetIcon name="arrow" />
        </span>
      ) : (
        <span className="st-mat-row__caption">Файл не прикреплён</span>
      )}
    </>
  );

  if (isInternalBoard) {
    return (
      <Link to={boardUrl} className="st-mat-row st-mat-row--link">
        {inner}
      </Link>
    );
  }

  if (url) {
    return (
      <a
        href={url}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer" : undefined}
        className="st-mat-row st-mat-row--link"
      >
        {inner}
      </a>
    );
  }
  return <div className="st-mat-row st-mat-row--disabled">{inner}</div>;
}

export default function StudentMaterialsPage() {
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    fetchStudentMaterials()
      .then((d) => setAllItems(d?.items || []))
      .catch(() => setAllItems([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        (it.topic || "").toLowerCase().includes(q) ||
        (it.lesson_topic || "").toLowerCase().includes(q) ||
        (it.type_label || "").toLowerCase().includes(q),
    );
  }, [allItems, query]);

  return (
    <StudentPageShell>
      {/* Header */}
      <div className="st-mat-header">
        <h1 className="st-mat-header__title">Материалы</h1>
        <p className="st-mat-header__sub">Теория, файлы, ссылки и доски от учителя</p>
      </div>

      {/* Search */}
      <div className="st-mat-search">
        <span className="st-mat-search__icon" aria-hidden="true">
          <CabinetIcon name="search" />
        </span>
        <input
          ref={inputRef}
          type="search"
          className="st-mat-search__input"
          placeholder="Поиск по названию или теме…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск материалов"
        />
        {query && (
          <button
            type="button"
            className="st-mat-search__clear"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            aria-label="Очистить поиск"
          >
            <CabinetIcon name="close" />
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="st-loading">Загрузка…</div>
      ) : !allItems.length ? (
        <StudentEmptyState
          title="Материалов пока нет"
          text="Учитель ещё не добавил материалы к занятиям и не выдал их напрямую."
          icon="folder"
        />
      ) : !filtered.length ? (
        <div className="st-mat-empty-search">
          <p>По запросу «{query}» ничего не найдено</p>
        </div>
      ) : (
        <div className="st-mat-list">
          {filtered.map((item) => (
            <MaterialRow key={`${item.id}-${item.direct ? "d" : "l"}`} item={item} />
          ))}
        </div>
      )}
    </StudentPageShell>
  );
}
