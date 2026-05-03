import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import MathContent from "../components/MathContent";
import { devApiBase } from "../utils/devApiBase";

function SearchTaskPage() {
  const location = useLocation();
  const q = new URLSearchParams(location.search).get("q")?.trim() ?? "";

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!q) {
      setTasks([]);
      return;
    }
    setLoading(true);
    setError(null);
    const apiBase = devApiBase();
    fetch(`${apiBase}/api/search_task/?q=${encodeURIComponent(q)}`, {
      credentials: apiBase ? "omit" : "same-origin",
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data) => {
        setTasks(data.tasks || []);
      })
      .catch((err) => {
        setError(err.message);
        setTasks([]);
      })
      .finally(() => setLoading(false));
  }, [q]);


  if (!q) {
    return (
      <div className="container search-task-page">
        <div className="search-task-hero">
          <h1>Поиск задачи</h1>
          <p>Введите ID задачи в форме поиска на странице выбора предмета (ОГЭ или ЕГЭ).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container search-task-page">
      <div className="search-task-hero">
        <h1>Поиск: ID {q}</h1>
        <p>Результат поиска по запросу</p>
      </div>

      {loading && (
        <div className="search-task-loading">
          <div className="search-task-spinner" />
          <p>Загрузка...</p>
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="search-task-empty-card">
          <span className="search-task-empty-icon">🔍</span>
          <h3>Ничего не найдено</h3>
          <p>Задача с ID {q} не найдена. Проверьте правильность введённого номера.</p>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="search-task-list">
          {tasks.map((t) => (
            <article key={t.id} className="search-task-card">
              <div className="search-task-card-header">
                <span className="search-task-badge">Задача №{t.task_number}</span>
                <span className="search-task-id">ID: {t.id}</span>
              </div>
              <div className="search-task-card-body">
                <div className="search-task-section">
                  <h4>Условие</h4>
                  <MathContent html={t.task_text || ""} className="search-task-condition" />
                </div>
                {t.answer && (
                  <div className="search-task-section search-task-answer">
                    <h4>Ответ</h4>
                    <MathContent html={t.answer} className="search-task-answer-content" />
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default SearchTaskPage;
