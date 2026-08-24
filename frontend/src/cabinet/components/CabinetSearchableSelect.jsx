import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Компактный searchable dropdown. Не нативный select на 100 пунктов.
 */
export default function CabinetSearchableSelect({
  id,
  label,
  value,
  options = [],
  allLabel = "Все",
  placeholder = "Поиск…",
  onChange,
  disabled = false,
}) {
  const reactId = useId();
  const fieldId = id || reactId;
  const listId = `${fieldId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((opt) => String(opt.id) === String(value)) || null;
  const buttonLabel = selected?.label || allLabel;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const allOption = { id: "", label: allLabel };
    const list = [allOption, ...options];
    if (!q) return list;
    return list.filter((opt) => String(opt.label || "").toLowerCase().includes(q));
  }, [allLabel, options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const selectOption = (opt) => {
    onChange?.(opt.id === "" ? "" : String(opt.id));
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) selectOption(opt);
    }
  };

  return (
    <div className="cb-search-select" ref={rootRef}>
      {label ? (
        <label className="cb-search-select__label" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <button
        type="button"
        id={fieldId}
        className="cb-search-select__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className="cb-search-select__value">{buttonLabel}</span>
        <span className="cb-search-select__chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="cb-search-select__popover">
          <input
            ref={inputRef}
            className="cb-search-select__search"
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul
            id={listId}
            className="cb-search-select__list"
            role="listbox"
            aria-label={label || allLabel}
          >
            {filtered.length === 0 ? (
              <li className="cb-search-select__empty">Никого не нашлось</li>
            ) : filtered.map((opt, index) => {
              const selectedNow = String(opt.id) === String(value || "");
              return (
                <li key={`${opt.id || "all"}-${index}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedNow}
                    className={`cb-search-select__option${index === activeIndex ? " is-active" : ""}${selectedNow ? " is-selected" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(opt)}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
