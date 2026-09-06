import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import MathContent from "../components/MathContent";
import SearchByIdForm from "../components/SearchByIdForm";
import StateView from "../components/StateView";
import TaskFileAttachment from "../components/TaskFileAttachment";
import TaskNoAnswerBadge from "../components/TaskNoAnswerBadge";
import { useAccessGate } from "../hooks/useAccessGate";
import { isOgeInformaticsTask, isOgeRusTask13 } from "../utils/isOgeInformaticsTask";
import {
  archiveMyTask,
  duplicateMyTask,
  fetchMyTask,
} from "../utils/teacherTaskBankApi";
import "../styles/my-task-bank.css";

function taskFiles(task) {
  const seen = new Set();
  const files = [];
  for (const att of task.attachments || []) {
    if (!att?.url || seen.has(att.url)) continue;
    seen.add(att.url);
    files.push({ url: att.url, name: att.name || "" });
  }
  if (task.file_url && !seen.has(task.file_url)) {
    files.push({ url: task.file_url, name: "" });
  }
  return files;
}

function wrap(content) {
  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <div className="container search-task-page">{content}</div>
      </div>
    </div>
  );
}

export default function MyTaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { modal: accessModal, openFromError } = useAccessGate({
    authenticated: true,
    sourcePage: "/tasks/my",
  });

  useEffect(() => {
    fetchMyTask(taskId)
      .then(setTask)
      .catch((err) => setError(err instanceof Error ? err.message : "Задача не найдена"));
  }, [taskId]);

  if (error) {
    return wrap(
      <StateView
        variant="error"
        title="Задача не найдена"
        description={error}
        action={<Link to="/tasks/my" className="state-view__btn">К моему банку</Link>}
      />
    );
  }
  if (!task) {
    return wrap(
      <StateView variant="loading" title="Загружаем задачу" description="Открываем задачу из вашего банка…" />
    );
  }

  const addToVariant = () => {
    if (task.level && task.subject) {
      navigate(`/tasks?level=${encodeURIComponent(task.level)}&subject=${encodeURIComponent(task.subject)}&source=all&pick=variant&add=${task.id}`);
    }
  };

  const taskNumber = task.exam_task_number ?? task.local_number;
  const answerHtml = String(task.answer_html || task.answer || "").trim();
  const files = taskFiles(task);
  const queryLabel = task.public_code || String(task.id);

  return wrap(
    <>
      {accessModal}
      <div className="search-task-hero">
        <h1>Поиск: {queryLabel}</h1>
        <SearchByIdForm kind="task" initialQuery={queryLabel} className="search-page__form" />
      </div>

      <div className="search-task-list">
        <article className="search-task-card">
          <div className="search-task-card-header">
            <span className="search-task-badge">Задача №{taskNumber}</span>
            <span className="search-task-id">ID: {task.id}</span>
            {!answerHtml ? <TaskNoAnswerBadge /> : null}
          </div>
          <div className="search-task-card-body">
            <div className="search-task-section">
              <h4>Условие</h4>
              <MathContent
                html={task.text || ""}
                className="search-task-condition"
                ogeMathChoiceEnhance={task.subject === "math"}
                ogeInf13Enhance={isOgeInformaticsTask(task.level, task.subject, taskNumber, 13)}
                ogeRus13Enhance={isOgeRusTask13(task.level, task.subject, taskNumber)}
                ogeInf6Enhance={taskNumber === 6}
                egeInfFileEnhance={true}
                egeInf22Enhance={taskNumber === 22}
                egeInf1Enhance={taskNumber === 1}
                egeInf2Enhance={taskNumber === 2}
              />
              {files.map((file) => (
                <TaskFileAttachment key={file.url} href={file.url} name={file.name} />
              ))}
            </div>
            {answerHtml ? (
              <div className="search-task-section search-task-answer">
                <h4>Ответ</h4>
                <MathContent html={answerHtml} className="search-task-answer-content" />
              </div>
            ) : null}
          </div>
        </article>
      </div>

      <div className="search-task-owner-bar">
        {task.status !== "archived" && task.level && task.subject ? (
          <button type="button" className="mtb-btn mtb-btn--primary" onClick={addToVariant}>
            Добавить в вариант
          </button>
        ) : null}
        <Link className="mtb-btn" to={`/tasks/my/${task.id}/edit`}>Редактировать</Link>
        <button
          type="button"
          className="mtb-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const copy = await duplicateMyTask(task.id);
              navigate(`/tasks/my/${copy.id}/edit`);
            } catch (err) {
              if (!openFromError(err, { sourcePage: "duplicate" })) {
                setError(err instanceof Error ? err.message : "Не удалось дублировать");
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          Дублировать
        </button>
        {task.status !== "archived" ? (
          <button
            type="button"
            className="mtb-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const next = await archiveMyTask(task.id);
                setTask(next);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Не удалось архивировать");
              } finally {
                setBusy(false);
              }
            }}
          >
            Архивировать
          </button>
        ) : null}
        <Link className="mtb-btn" to="/tasks/my">Мой банк</Link>
      </div>
    </>
  );
}
