import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import SearchByIdForm from "../components/SearchByIdForm";
import MathContent from "../components/MathContent";
import { isOgeInformaticsTask, isOgeRusTask13 } from "../utils/isOgeInformaticsTask";
import StateView from "../components/StateView";
import TaskNoAnswerBadge from "../components/TaskNoAnswerBadge";

function noticeAction(notice) {
  if (notice?.bank_url) {
    return (
      <Link to={notice.bank_url} className="state-view__btn">
        Открыть мой банк
      </Link>
    );
  }
  return (
    <Link to={notice?.login_url || "/cabinet/login"} className="state-view__btn">
      Войти в аккаунт
    </Link>
  );
}

function SearchTaskPage() {
  const location = useLocation();
  const q = new URLSearchParams(location.search).get("q")?.trim() ?? "";

  const [tasks, setTasks] = useState([]);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!q) {
      setTasks([]);
      setNotice(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    // Same-origin /api, не devApiBase(): иначе в Vite сессия localhost не уходит на 127.0.0.1:8000.
    fetch(`/api/search_task/?q=${encodeURIComponent(q)}`, {
      credentials: "same-origin",
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data) => {
        setTasks(data.tasks || []);
        setNotice(data.notice || null);
      })
      .catch((err) => {
        setError(err.message);
        setTasks([]);
        setNotice(null);
      })
      .finally(() => setLoading(false));
  }, [q]);


  if (!q) {
    return (
      <div className="digital-flow-page">
        <div className="digital-flow-page__wrap">
          <div className="container search-task-page">
            <div className="search-task-hero">
              <h1>Поиск задачи</h1>
              <p>Введите ID или код задачи из банка (например D2BQN-001).</p>
              <SearchByIdForm kind="task" className="search-page__form" />
              <p className="search-page__hint">
                Свои задачи — в <Link to="/tasks/my">моём банке</Link>. Или откройте{" "}
                <Link to="/tasks">все задачи</Link> с фильтрами по предмету и уровню.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <div className="container search-task-page">
          <div className="search-task-hero">
            <h1>Поиск: {q}</h1>
            <SearchByIdForm kind="task" initialQuery={q} className="search-page__form" />
          </div>

          {loading && (
        <StateView variant="loading" title="Ищем задачу" description={`Загружаем задачу ${q}…`} />
      )}

      {!loading && error && (
        <StateView
          variant="error"
          title="Не удалось выполнить поиск"
          description="Что-то пошло не так при загрузке. Попробуйте ещё раз."
        />
      )}

      {!loading && !error && notice ? (
        <StateView
          variant="locked"
          title="Задача недоступна"
          description={notice.message}
          action={noticeAction(notice)}
        />
      ) : null}

      {!loading && !error && !notice && tasks.length === 0 && (
        <StateView
          variant="search"
          title="Ничего не найдено"
          description={`Задача ${q} не найдена. Проверьте правильность введённого номера.`}
          action={<Link to="/tasks/my" className="state-view__btn state-view__btn--ghost">Мой банк задач</Link>}
        />
      )}

      {!loading && tasks.length > 0 && (
        <div className="search-task-list">
          {tasks.map((t) => (
            <article key={t.id} className="search-task-card">
              <div className="search-task-card-header">
                <span className="search-task-badge">Задача №{t.task_number}</span>
                <span className="search-task-id">ID: {t.id}</span>
                {!t.answer ? (
                  <TaskNoAnswerBadge />
                ) : null}
                {t.mine ? (
                  <Link to={`/tasks/my/${t.id}`} className="search-task-id">
                    Открыть в моём банке
                  </Link>
                ) : null}
              </div>
              <div className="search-task-card-body">
                <div className="search-task-section">
                  <h4>Условие</h4>
                  <MathContent 
                    html={t.task_text || ""} 
                    className="search-task-condition" 
                    ogeMathChoiceEnhance={t.subject === "math"}
                    ogeInf13Enhance={isOgeInformaticsTask(t.level, t.subject, t.task_number, 13)}
                    ogeRus13Enhance={isOgeRusTask13(t.level, t.subject, t.task_number)}
                    ogeInf6Enhance={t.task_number === 6}
                    egeInfFileEnhance={true}
                    egeInf22Enhance={t.task_number === 22}
                    egeInf1Enhance={t.task_number === 1}
                    egeInf2Enhance={t.task_number === 2}
                  />
                </div>
                {t.answer ? (
                  <div className="search-task-section search-task-answer">
                    <h4>Ответ</h4>
                    <MathContent html={t.answer} className="search-task-answer-content" />
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

export default SearchTaskPage;
