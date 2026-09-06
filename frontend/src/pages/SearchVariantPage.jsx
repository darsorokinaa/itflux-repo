import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import SearchByIdForm from "../components/SearchByIdForm";
import MathContent from "../components/MathContent";
import StateView from "../components/StateView";
import TaskNoAnswerBadge from "../components/TaskNoAnswerBadge";

function formatLevel(level) {
  const x = String(level || "").toLowerCase();
  if (x === "ege") return "ЕГЭ";
  if (x === "oge") return "ОГЭ";
  if (x === "vpr") return "ВПР";
  return String(level || "").toUpperCase();
}

function tasksCountLabel(n) {
  const abs = Number(n);
  const m = abs % 10;
  const m100 = abs % 100;
  let word = "заданий";
  if (m100 < 11 || m100 > 14) {
    if (m === 1) word = "задание";
    else if (m >= 2 && m <= 4) word = "задания";
  }
  return `${abs} ${word}`;
}

function SearchVariantPage() {
  const location = useLocation();
  const q = new URLSearchParams(location.search).get("q")?.trim() ?? "";

  const [data, setData] = useState({ variant: null, tasks: [], notice: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!q) {
      setData({ variant: null, tasks: [], notice: null });
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/search_variant/?q=${encodeURIComponent(q)}`, {
      credentials: "same-origin",
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((d) => {
        setData({ variant: d.variant || null, tasks: d.tasks || [], notice: d.notice || null });
      })
      .catch((err) => {
        setError(err.message);
        setData({ variant: null, tasks: [], notice: null });
      })
      .finally(() => setLoading(false));
  }, [q]);

  const variantHref =
    data.variant && data.variant.level && data.variant.subject
      ? `/${data.variant.level}/${data.variant.subject}/variant/${data.variant.id}`
      : null;

  const subline =
    data.variant && data.tasks.length > 0
      ? `${data.variant.subject_name || ""} · ${formatLevel(data.variant.level)} · ${tasksCountLabel(data.tasks.length)}`
      : "";

  const wrap = (content) => (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <div className="container search-variant-page search-variant-page--v2">{content}</div>
      </div>
    </div>
  );

  if (!q) {
    return wrap(
      <div className="sv-intro">
        <h1 className="sv-intro-title">Поиск варианта</h1>
        <p className="sv-intro-lead">Введите числовой ID сохранённого варианта.</p>
        <SearchByIdForm kind="variant" className="search-page__form" />
      </div>
    );
  }

  return wrap(
    <>
      {loading && (
        <StateView variant="loading" title="Загружаем вариант" description={`Вариант с ID ${q}…`} />
      )}

      {!loading && error && (
        <StateView
          variant="error"
          title="Не удалось загрузить вариант"
          description={`Вариант ${q}: ${error}`}
        />
      )}

      {!loading && !error && data.notice ? (
        <StateView
          variant="locked"
          title="Вариант недоступен"
          description={data.notice.message}
          action={
            data.notice.bank_url ? (
              <Link to={data.notice.bank_url} className="state-view__btn">Открыть мой банк</Link>
            ) : (
              <Link to={data.notice.login_url || "/cabinet/login"} className="state-view__btn">Войти в аккаунт</Link>
            )
          }
        />
      ) : null}

      {!loading && !error && !data.notice && (!data.variant || data.tasks.length === 0) && (
        <StateView
          variant="search"
          title="Ничего не найдено"
          description={`Вариант с ID ${q} не найден. Проверьте номер и попробуйте снова.`}
          action={<Link to="/tasks" className="state-view__btn state-view__btn--ghost">Открыть все задачи</Link>}
        />
      )}

      {!loading && !error && !data.notice && data.variant && data.tasks.length > 0 && (
        <>
          <header className="sv-header">
            <div className="sv-header-text">
              <h1 className="sv-header-title">Вариант ID {data.variant.id}</h1>
              <p className="sv-header-sub">{subline}</p>
              <SearchByIdForm kind="variant" initialQuery={q} className="search-page__form" />
            </div>
            {variantHref ? (
              <Link
                to={variantHref}
                className="sv-header-cta"
                target="_blank"
                rel="noopener noreferrer"
              >
                Перейти к варианту
              </Link>
            ) : null}
          </header>

          <div
            className="exam-page search-variant-exam-scope"
            data-level={data.variant.level}
            data-subject={data.variant.subject}
          >
            <div className="sv-task-list" role="list">
              {data.tasks.map((t) => (
                <div key={`${t.id}-${t.number}`} className="sv-task-row" role="listitem">
                  <div className="sv-task-num" aria-hidden="true">
                    {t.number}
                  </div>
                  <div className="sv-task-main">
                    <div className="sv-task-header">
                      <p className="sv-task-title">Задание {t.number}</p>
                      <div className="sv-task-id-row">
                        <span className="sv-task-id-label">ID</span>
                        <span className="sv-task-id-value">{t.id}</span>
                        {!String(t.answer || "").trim() ? (
                          <TaskNoAnswerBadge />
                        ) : null}
                      </div>
                    </div>
                    <div className="task-content">
                      {t.task_text ? (
                        <MathContent
                          html={t.task_text}
                          className="all-tasks-item__html task-text"
                          plainHtml
                          ogeMathChoiceEnhance={data.variant.subject === "math"}
                        />
                      ) : (
                        <span className="sv-task-text-fallback">Текст задания недоступен.</span>
                      )}
                    </div>
                    <div className="sv-task-answer">
                      <MathContent html={String(t.answer || "")} className="sv-task-answer-inner" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default SearchVariantPage;
