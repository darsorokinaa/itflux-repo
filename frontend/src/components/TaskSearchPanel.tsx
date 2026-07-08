import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  className?: string;
};

/**
 * Быстрый поиск по ID задачи или варианта.
 * Используется в верхнем меню сайта.
 */
export default function TaskSearchPanel({ className = "" }: Props) {
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState("");
  const [variantId, setVariantId] = useState("");

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const variant = variantId.trim();
    const task = taskId.trim();
    // Вариант приоритетнее задачи — сохраняем прежнее поведение шапки.
    if (variant) {
      navigate(`/search-variant?q=${encodeURIComponent(variant)}`);
      return;
    }
    if (task) {
      navigate(`/search/tasks?q=${encodeURIComponent(task)}`);
    }
  };

  return (
    <section className={`task-search-panel ${className}`.trim()} aria-label="Быстрый поиск">
      <div className="task-search-panel__content">
        <h2 className="task-search-panel__title">Быстрый поиск</h2>
        <p className="task-search-panel__subtitle">Введите ID задания или варианта</p>
      </div>

      <form className="task-search-panel__form" onSubmit={onSubmit}>
        <label className="task-search-panel__field">
          <span className="task-search-panel__label">ID задания</span>
          <input
            type="search"
            className="task-search-panel__input"
            placeholder="ID задания"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            title="Введите ID задания"
          />
        </label>

        <label className="task-search-panel__field">
          <span className="task-search-panel__label">№ варианта</span>
          <input
            type="search"
            className="task-search-panel__input"
            placeholder="№ варианта"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            title="Введите номер варианта"
          />
        </label>

        <button type="submit" className="task-search-panel__submit">
          Найти
        </button>
      </form>
    </section>
  );
}
