import { type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  kind: "task" | "variant";
  initialQuery?: string;
  className?: string;
};

export default function SearchByIdForm({ kind, initialQuery = "", className = "" }: Props) {
  const navigate = useNavigate();
  const path = kind === "task" ? "/search/tasks" : "/search-variant";

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get("query");
    const query = typeof q === "string" ? q.trim() : "";
    if (query) {
      navigate(`${path}?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <form
      className={`nav-hub-page__search search-by-id-form ${className}`.trim()}
      onSubmit={onSubmit}
    >
      <input
        name="query"
        type="search"
        className="nav-hub-page__search-input"
        placeholder={kind === "task" ? "ID или код задачи…" : "ID варианта…"}
        defaultValue={initialQuery}
        autoComplete="off"
      />
      <button type="submit" className="nav-hub-page__search-btn">
        Найти
      </button>
    </form>
  );
}
