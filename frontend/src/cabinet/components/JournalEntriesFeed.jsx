import { useEffect, useMemo, useState } from "react";
import { fetchJournalEntries } from "../../utils/cabinetAuth";

const TYPE_TABS = [
  { key: "", label: "Все" },
  { key: "lesson", label: "Уроки" },
  { key: "homework", label: "Домашние задания" },
];

const STATUS_RU = {
  // ДЗ / сдача
  submitted: "Сдано",
  checked: "Проверено",
  returned: "Возвращено",
  needs_revision: "Нужна доработка",
  not_submitted: "Не сдано",
  not_assigned: "Не задавалось",
  overdue: "Просрочено",
  in_progress: "В работе",
  new: "Не начато",
  pending: "Ожидает",
  in_review: "На проверке",
  // Публикация записи урока
  draft: "Черновик",
  saved: "Сохранено",
  published: "Опубликовано",
  edited_after_publish: "Изменено после публикации",
  // Статус журнала урока
  completed: "Проведён",
  reopened: "Открыт повторно",
  cancelled: "Отменён",
  // Посещаемость
  present: "Присутствовал",
  late: "Опоздал",
  left_early: "Ушёл раньше",
  partial: "Частично",
  absent_excused: "Уваж. причина",
  absent_unexcused: "Отсутствовал",
  cancelled_by_student: "Отменено учеником",
  cancelled_by_teacher: "Отменено учителем",
  technical_issue: "Техн. причина",
  not_marked: "Не отмечено",
  // Итог ДЗ в сводке
  full: "Выполнено полностью",
  not_done: "Не выполнено",
  not_reviewed: "Не проверено",
};

function statusLabelRu(value, fallback = "Запись") {
  if (value == null || value === "") return fallback;
  const key = String(value).trim();
  if (!key) return fallback;
  // Уже по-русски (есть кириллица) — не трогаем
  if (/[А-Яа-яЁё]/.test(key)) return key;
  return STATUS_RU[key] || STATUS_RU[key.toLowerCase()] || fallback;
}

function entryStatusLabel(entry) {
  return statusLabelRu(entry?.status_label || entry?.status || entry?.badge, "Запись");
}

function entryIcon(entry) {
  if (entry.entry_type === "homework") {
    if (entry.review_url && entry.status === "submitted") return "🔍";
    return "📄";
  }
  return "📘";
}

function entryTypeLabel(entry) {
  if (entry.entry_type === "homework") {
    if (entry.review_url && (entry.status === "submitted" || entry.badge === "На проверке")) {
      return "Работа ученика";
    }
    return "Домашнее задание";
  }
  return "Урок";
}

function entryActionLabel(entry) {
  if (entry.entry_type === "homework") {
    if (entry.review_url && (entry.status === "submitted" || entry.is_overdue === false)) {
      if (["submitted", "pending_review"].includes(String(entry.status)) || entry.badge?.includes("провер")) {
        return "Проверить";
      }
    }
    if (entry.score_percent != null && entry.status === "checked") return "Посмотреть результат";
    return "Открыть задание";
  }
  return "Открыть урок";
}

function formatEntryDate(entry) {
  if (entry.submitted_at) {
    return `Сдано ${new Date(entry.submitted_at).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  if (entry.due_at) {
    return `Срок ${new Date(entry.due_at).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  if (entry.assigned_at) {
    return `Выдано ${new Date(entry.assigned_at).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    })}`;
  }
  return entry.date || "";
}

/**
 * Лента активности: уроки, ДЗ, сдачи и результаты.
 */
export default function JournalEntriesFeed({
  studentId,
  groupId,
  filterPreset = null,
  onFilterPresetConsumed,
  onSummaryChange,
}) {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    entry_type: "",
    homework_only: false,
    overdue: false,
    reviewed: "",
  });
  const [selected, setSelected] = useState(null);
  const [hintOpen, setHintOpen] = useState(false);

  useEffect(() => {
    if (!filterPreset) return;
    setFilters((prev) => ({
      ...prev,
      entry_type: filterPreset.entry_type ?? prev.entry_type,
      homework_only: filterPreset.entry_type === "homework",
      overdue: Boolean(filterPreset.overdue),
      reviewed: filterPreset.reviewed ?? "",
    }));
    onFilterPresetConsumed?.();
  }, [filterPreset, onFilterPresetConsumed]);

  useEffect(() => {
    if (!studentId && !groupId) {
      setEntries([]);
      setSummary(null);
      onSummaryChange?.(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJournalEntries({
      student_id: studentId || undefined,
      group_id: groupId || undefined,
      entry_type: filters.entry_type || undefined,
      homework_only: filters.homework_only ? "1" : undefined,
      overdue: filters.overdue ? "1" : undefined,
      reviewed: filters.reviewed || undefined,
    })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries || []);
        setSummary(data.summary || null);
        setHint(data.summary_hint || "");
        onSummaryChange?.(data.summary || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, groupId, filters, onSummaryChange]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.entry_type) n += 1;
    if (filters.overdue) n += 1;
    if (filters.reviewed) n += 1;
    return n;
  }, [filters]);

  const resetFilters = () => {
    setFilters({
      entry_type: "",
      homework_only: false,
      overdue: false,
      reviewed: "",
    });
  };

  const setType = (key) => {
    setFilters((f) => ({
      ...f,
      entry_type: key,
      homework_only: key === "homework",
    }));
  };

  const hwStats = useMemo(() => {
    if (!summary) return [];
    const items = [
      {
        key: "pending",
        label: "На проверке",
        value: summary.homework_pending_review,
        alert: Number(summary.homework_pending_review) > 0,
      },
      {
        key: "overdue",
        label: "Просрочено",
        value: summary.homework_overdue,
        alert: Number(summary.homework_overdue) > 0,
      },
      {
        key: "assigned",
        label: "Выдано",
        value: summary.homework_assigned,
      },
      {
        key: "avg",
        label: "Средний %",
        value:
          summary.homework_average_percent != null
            ? `${summary.homework_average_percent}%`
            : "—",
      },
    ];
    return items;
  }, [summary]);

  return (
    <section className="jg-feed">
      <header className="jg-feed__head">
        <div className="jg-feed__title-row">
          <div className="jg-feed__title-block">
            <h2>Пройденные уроки и ДЗ</h2>
            {hwStats.length ? (
              <ul className="jg-feed__stats" aria-label="Сводка по домашним заданиям">
                {hwStats.map((stat) => (
                  <li
                    key={stat.key}
                    className={`jg-feed__stat${stat.alert ? " is-alert" : ""}`}
                    title={hint || undefined}
                  >
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </li>
                ))}
                {hint ? (
                  <li>
                    <button
                      type="button"
                      className="jg-feed__stats-info"
                      aria-expanded={hintOpen}
                      onClick={() => setHintOpen((v) => !v)}
                      title="Как считается результат"
                    >
                      i
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

          <div className="jg-feed-filters__types" role="tablist" aria-label="Тип записи">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.key || "all"}
                type="button"
                role="tab"
                aria-selected={filters.entry_type === tab.key}
                className={`jg-feed-filters__type${filters.entry_type === tab.key ? " is-active" : ""}`}
                onClick={() => setType(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {hintOpen && hint ? <p className="jg-feed__hint">{hint}</p> : null}

        <div className="jg-feed-filters" aria-label="Дополнительные фильтры">
          <div className="jg-feed-filters__extra">
            <label className={`jg-feed-filters__chip${filters.overdue ? " is-active" : ""}`}>
              <input
                type="checkbox"
                checked={filters.overdue}
                onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.checked }))}
              />
              Просроченные
            </label>
            <label className="jg-feed-filters__select-wrap">
              <span className="jg-sr-only">Статус проверки</span>
              <select
                className={`jg-feed-filters__select${filters.reviewed ? " is-active" : ""}`}
                value={filters.reviewed}
                onChange={(e) => setFilters((f) => ({ ...f, reviewed: e.target.value }))}
              >
                <option value="">Статус: все</option>
                <option value="no">На проверке</option>
                <option value="yes">Проверено</option>
              </select>
            </label>
            {activeFilterCount ? (
              <button type="button" className="jg-btn jg-btn--ghost jg-btn--sm" onClick={resetFilters}>
                Сбросить
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {loading ? <div className="jg-state jg-state--compact">Загрузка…</div> : null}
      {error ? (
        <div className="jg-state jg-state--error">
          <h3>Не удалось загрузить записи</h3>
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && !error && !entries.length ? (
        <div className="jg-state">
          <h3>
            {activeFilterCount
              ? "По выбранным фильтрам записей нет"
              : "Пока нет записей"}
          </h3>
          <p>
            {activeFilterCount
              ? "Измените фильтры или сбросьте их."
              : "Уроки и домашние задания появятся здесь по мере занятий."}
          </p>
          {activeFilterCount ? (
            <button type="button" className="jg-btn jg-btn--secondary" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && entries.length ? (
        <div className="jg-data-table-wrap">
          <table className="jg-data-table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>Название</th>
                <th>Ученик</th>
                <th>Дата</th>
                <th>Статус</th>
                <th>Результат</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const action = entryActionLabel(entry);
                return (
                  <tr
                    key={entry.id}
                    className={`jg-data-table__row${entry.is_overdue ? " is-overdue" : ""}`}
                  >
                    <td>
                      <span className="jg-data-table__type">
                        <span aria-hidden="true">{entryIcon(entry)}</span>{" "}
                        {entryTypeLabel(entry)}
                      </span>
                    </td>
                    <td>
                      <div className="jg-data-table__strong">{entry.title}</div>
                    </td>
                    <td>{entry.student_name || "—"}</td>
                    <td>
                      <span className="jg-data-table__muted">{formatEntryDate(entry)}</span>
                    </td>
                      <td>
                        <span
                          className={`jg-status-badge jg-status-badge--${entry.is_overdue ? "danger" : "info"}`}
                        >
                          {entryStatusLabel(entry)}
                        </span>
                      </td>
                    <td>
                      {entry.score_percent != null ? `${entry.score_percent}%` : "—"}
                    </td>
                    <td className="jg-data-table__actions">
                      {entry.review_url ? (
                        <a className="jg-btn jg-btn--primary jg-btn--sm" href={entry.review_url}>
                          {action}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="jg-btn jg-btn--secondary jg-btn--sm"
                          onClick={() => setSelected(entry)}
                        >
                          {action}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {selected ? (
        <div className="jg-entry-drawer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="jg-entry-drawer__backdrop"
            aria-label="Закрыть"
            onClick={() => setSelected(null)}
          />
          <div className="jg-entry-drawer__panel">
            <header className="jg-entry-drawer__header">
              <div className="jg-entry-drawer__heading">
                <span className="jg-feed-card__type">{entryTypeLabel(selected)}</span>
                <h3>{selected.title}</h3>
              </div>
              <button type="button" className="jg-btn jg-btn--secondary" onClick={() => setSelected(null)}>
                Закрыть
              </button>
            </header>
            <div className="jg-entry-drawer__meta">
              {selected.student_name ? <p>{selected.student_name}</p> : null}
              <p>Статус: {entryStatusLabel(selected)}</p>
              {selected.score_percent != null ? <p>Результат: {selected.score_percent}%</p> : null}
              {selected.due_at ? <p>Срок: {new Date(selected.due_at).toLocaleString("ru-RU")}</p> : null}
              {selected.submitted_at ? (
                <p>Сдано: {new Date(selected.submitted_at).toLocaleString("ru-RU")}</p>
              ) : null}
              {selected.comment ? <p>Комментарий: {selected.comment}</p> : null}
            </div>
            {(selected.attempts || []).length ? (
              <div className="jg-entry-drawer__attempts">
                <h4>История попыток</h4>
                <ul>
                  {selected.attempts.map((a) => (
                    <li key={a.id}>
                      #{a.attempt_number}: {statusLabelRu(a.status_label || a.status, "—")}
                      {a.score != null ? ` · ${a.score}%` : ""}
                      {a.teacher_comment ? ` — ${a.teacher_comment}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selected.review_url ? (
              <a className="jg-btn jg-btn--primary" href={selected.review_url}>
                Открыть проверку
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
