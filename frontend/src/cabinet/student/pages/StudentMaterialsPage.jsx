import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentMaterials } from "../../../utils/cabinetAuth";
import {
  StudentEmptyState,
  StudentFilterPills,
  StudentPageShell,
  formatStudentDate,
} from "../StudentSectionUi";
import StudentSubjectTabs, { getStoredStudentSubjectId } from "../StudentSubjectTabs";
import CabinetIcon from "../../CabinetIcons";
import { usePageTitle } from "../../hooks/usePageTitle";

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

const TYPE_FILTERS = [
  { id: "all", label: "Все типы" },
  { id: "presentation", label: "Презентации" },
  { id: "methodic", label: "Конспекты" },
  { id: "file", label: "Файлы" },
  { id: "link", label: "Ссылки" },
  { id: "board", label: "Интерактивы" },
  { id: "worksheet", label: "Доп. задания" },
];

function MaterialRow({ item }) {
  const { icon, color, bg } = TYPE_ICONS[item.type] || { icon: "note", color: "#667085", bg: "#F3F4F6" };
  const boardUrl = item.type === "board"
    ? (item.board_url || (item.board_id ? `/cabinet/boards/${item.board_id}` : ""))
    : "";
  const url = boardUrl || item.external_url || item.file_url;
  const isExternal = Boolean(item.external_url) && item.type !== "board";
  const isInternalBoard = item.type === "board" && Boolean(boardUrl);
  const addedAt = item.assigned_at || item.updated_at;
  const actionLabel = item.file_url && !item.external_url && item.type !== "board" ? "Скачать" : "Открыть";

  const inner = (
    <>
      <span className="st-mat-row__icon" style={{ background: bg, color }} aria-hidden="true">
        <CabinetIcon name={icon} />
      </span>
      <span className="st-mat-row__body">
        <span className="st-mat-row__title">{item.title}</span>
        <span className="st-mat-row__meta">
          {[
            item.student_subject_label,
            item.type_label,
            item.lesson_topic || item.topic,
            item.teacher_name ? `Учитель: ${item.teacher_name}` : "",
            addedAt ? formatStudentDate(addedAt) : "",
            item.source === "homework"
              ? "Из ДЗ"
              : item.direct
                ? "Выдано учителем"
                : "",
          ].filter(Boolean).join(" · ")}
        </span>
        {item.message ? <span className="st-mat-row__msg">{item.message}</span> : null}
      </span>
      {url ? (
        <span className="st-mat-row__action">{actionLabel}</span>
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
        download={!isExternal && item.file_url ? true : undefined}
      >
        {inner}
      </a>
    );
  }
  const fallback = item.assignment_id
    ? `/cabinet/student/lessons/${item.assignment_id}`
    : item.homework_id
      ? `/cabinet/student/assignments/${item.homework_id}`
      : "";
  if (fallback) {
    return (
      <Link to={fallback} className="st-mat-row st-mat-row--link">
        {inner}
      </Link>
    );
  }
  return <div className="st-mat-row st-mat-row--disabled">{inner}</div>;
}

function groupByTopic(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.lesson_topic || item.topic || "Без темы";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()];
}

export default function StudentMaterialsPage() {
  usePageTitle("Материалы");
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [subjectId, setSubjectId] = useState(() => getStoredStudentSubjectId());
  const inputRef = useRef(null);

  const handleSubjectChange = useCallback((id) => {
    setSubjectId(id || "");
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchStudentMaterials("", { studentSubjectId: subjectId || undefined })
      .then((d) => setAllItems(d?.items || []))
      .catch(() => setAllItems([]))
      .finally(() => setLoading(false));
  }, [subjectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((it) => {
      if (typeFilter !== "all" && it.type !== typeFilter) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q)
        || (it.topic || "").toLowerCase().includes(q)
        || (it.lesson_topic || "").toLowerCase().includes(q)
        || (it.type_label || "").toLowerCase().includes(q)
        || (it.student_subject_label || "").toLowerCase().includes(q)
      );
    });
  }, [allItems, query, typeFilter]);

  const grouped = useMemo(() => groupByTopic(filtered), [filtered]);

  return (
    <StudentPageShell className="st-materials-page">
      <div className="st-mat-header">
        <h1 className="st-mat-header__title">Материалы</h1>
        <p className="st-mat-header__sub">Презентации, конспекты, файлы, ссылки и записи от учителя</p>
      </div>

      <StudentSubjectTabs value={subjectId} onChange={handleSubjectChange} />
      <StudentFilterPills filters={TYPE_FILTERS} active={typeFilter} onChange={setTypeFilter} />

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
          <p>По выбранным фильтрам ничего не найдено</p>
        </div>
      ) : (
        <div className="st-mat-groups">
          {grouped.map(([topic, items]) => (
            <section key={topic} className="st-mat-group">
              <h2 className="st-mat-group__title">{topic}</h2>
              <div className="st-mat-list">
                {items.map((item) => (
                  <MaterialRow key={`${item.id}-${item.direct ? "d" : "l"}`} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </StudentPageShell>
  );
}
