import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import {
  fetchInteractives,
  fetchMaterials,
  fetchStudents,
} from "../../utils/cabinetAuth";

const PLACEHOLDER = "Поиск: ученики, интерактивы, материалы…";
const MIN_QUERY = 2;
const LIMIT = 5;

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function SearchGroup({ label, items, onSelect }) {
  if (!items.length) return null;
  return (
    <div className="cabinet-search-group">
      <p className="cabinet-search-group__label">{label}</p>
      <ul className="cabinet-search-group__list">
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" className="cabinet-search-item" onClick={() => onSelect(item)}>
              <span className="cabinet-search-item__title">{item.title}</span>
              {item.meta ? <span className="cabinet-search-item__meta">{item.meta}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CabinetGlobalSearch({
  className = "",
  inputRef,
  mobile = false,
  onClose,
}) {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState({ students: [], interactives: [], materials: [] });

  const hasResults =
    groups.students.length > 0
    || groups.interactives.length > 0
    || groups.materials.length > 0;

  const runSearch = useCallback(async (value) => {
    const q = value.trim();
    if (q.length < MIN_QUERY) {
      setGroups({ students: [], interactives: [], materials: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [studentsData, interactivesData, materialsData] = await Promise.all([
        fetchStudents({ search: q, status: "active" }),
        fetchInteractives({ search: q }),
        fetchMaterials({ search: q }),
      ]);

      const students = normalizeList(studentsData).slice(0, LIMIT).map((s) => ({
        key: `student-${s.id}`,
        type: "student",
        title: s.full_name || `${s.first_name || ""} ${s.last_name || ""}`.trim(),
        meta: s.direction_label || s.email || "",
        target: "/cabinet/students",
      }));

      const interactives = normalizeList(interactivesData).slice(0, LIMIT).map((i) => ({
        key: `interactive-${i.id}`,
        type: "interactive",
        title: i.title,
        meta: i.interactive_type_label || i.topic || "",
        target: `/cabinet/interactives/${i.id}`,
      }));

      const materials = normalizeList(materialsData).slice(0, LIMIT).map((m) => ({
        key: `material-${m.id}`,
        type: "material",
        title: m.title,
        meta: m.material_type_label || m.topic || "",
        target: "/cabinet/library",
      }));

      setGroups({ students, interactives, materials });
    } catch {
      setGroups({ students: [], interactives: [], materials: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY) {
      setGroups({ students: [], interactives: [], materials: [] });
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      runSearch(query);
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!wrapRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleSelect = (item) => {
    setQuery("");
    setOpen(false);
    setGroups({ students: [], interactives: [], materials: [] });
    onClose?.();
    navigate(item.target);
  };

  const showDropdown = open && query.trim().length >= MIN_QUERY;

  return (
    <div
      ref={wrapRef}
      className={`cabinet-global-search${className ? ` ${className}` : ""}${showDropdown ? " is-open" : ""}`}
    >
      <div className="cabinet-header-search">
        <CabinetIcon name="search" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={PLACEHOLDER}
          aria-label={PLACEHOLDER}
          aria-expanded={showDropdown}
          aria-controls="cabinet-global-search-results"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {mobile && onClose ? (
          <button
            type="button"
            className="cabinet-header-icon-btn"
            aria-label="Закрыть поиск"
            onClick={onClose}
          >
            <CabinetIcon name="close" />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div id="cabinet-global-search-results" className="cabinet-search-dropdown" role="listbox">
          {loading ? (
            <p className="cabinet-search-dropdown__hint">Ищем…</p>
          ) : null}
          {!loading && !hasResults ? (
            <p className="cabinet-search-dropdown__hint">Ничего не найдено</p>
          ) : null}
          {!loading ? (
            <>
              <SearchGroup label="Ученики" items={groups.students} onSelect={handleSelect} />
              <SearchGroup label="Интерактивы" items={groups.interactives} onSelect={handleSelect} />
              <SearchGroup label="Материалы" items={groups.materials} onSelect={handleSelect} />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
