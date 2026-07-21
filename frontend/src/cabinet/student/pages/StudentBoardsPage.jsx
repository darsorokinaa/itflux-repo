import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchStudentInteractiveBoards,
  normalizeCabinetList,
} from "../../../utils/cabinetAuth";
import {
  StudentEmptyState,
  StudentPageShell,
} from "../StudentSectionUi";
import CabinetIcon from "../../CabinetIcons";
import "../../styles/boards.css";

function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatRelativeUpdated(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
    if (diffSec < 45) return "только что";
    const mins = Math.round(diffSec / 60);
    if (mins < 60) return `${mins} ${pluralRu(mins, "минуту", "минуты", "минут")} назад`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} ${pluralRu(hours, "час", "часа", "часов")} назад`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} ${pluralRu(days, "день", "дня", "дней")} назад`;
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

export default function StudentBoardsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchStudentInteractiveBoards()
      .then((data) => {
        if (cancelled) return;
        setItems(normalizeCabinetList(data));
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setItems([]);
        setError(err?.message || "Не удалось загрузить доски");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((board) => (board.title || "").toLowerCase().includes(q));
  }, [items, query]);

  return (
    <StudentPageShell className="cb-boards-page">
      <div className="st-mat-header">
        <h1 className="st-mat-header__title">Интерактивные доски</h1>
        <p className="st-mat-header__sub">Доски, которыми с вами поделился учитель</p>
      </div>

      <div className="st-mat-search">
        <span className="st-mat-search__icon" aria-hidden="true">
          <CabinetIcon name="search" />
        </span>
        <input
          type="search"
          className="st-mat-search__input"
          placeholder="Поиск по названию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск досок"
        />
      </div>

      {loading ? (
        <div className="cb-boards-grid" aria-busy="true" aria-label="Загрузка досок">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="cb-boards-skeleton__card" />
          ))}
        </div>
      ) : null}

      {!loading && error ? (
        <StudentEmptyState title="Не удалось загрузить" text={error} />
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <StudentEmptyState
          title={query.trim() ? "Ничего не найдено" : "Пока нет досок"}
          text={
            query.trim()
              ? "Попробуйте другой запрос"
              : "Когда учитель откроет вам доступ к доске, она появится здесь"
          }
        />
      ) : null}

      {!loading && !error && filtered.length > 0 ? (
        <div className="cb-boards-grid">
          {filtered.map((board) => {
            const viewOnly = !board.can_edit;
            return (
              <Link
                key={board.id}
                to={`/cabinet/boards/${board.id}`}
                className="cb-board-card"
              >
                <span className="cb-board-card__preview" aria-hidden="true">
                  {board.thumbnail ? (
                    <img
                      className="cb-board-card__thumb"
                      src={board.thumbnail}
                      alt=""
                      decoding="async"
                    />
                  ) : (
                    <span className="cb-board-card__thumb-placeholder" />
                  )}
                  {viewOnly ? (
                    <span className="cb-board-card__badge">
                      Только просмотр
                      <span className="cb-board-card__badge-icon">↗</span>
                    </span>
                  ) : null}
                </span>
                <span className="cb-board-card__body">
                  <span className="cb-board-card__title-row">
                    <span className="cb-board-card__title">{board.title || "Без названия"}</span>
                  </span>
                  <span className="cb-board-card__meta">
                    <span className="cb-board-card__mark" aria-hidden="true" />
                    <span className="cb-board-card__meta-text">
                      {board.owner_name || "Учитель"}
                      <span className="cb-board-card__dot"> · </span>
                      Изменено {formatRelativeUpdated(board.updated_at)}
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </StudentPageShell>
  );
}
