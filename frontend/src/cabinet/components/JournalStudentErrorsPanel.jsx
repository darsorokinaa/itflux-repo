import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { Link } from "react-router-dom";
import MathContent from "../../components/MathContent";
import TaskFileAttachment from "../../components/TaskFileAttachment";
import {
  isEgeInfParallelProcessesTask,
  isEgeInfRoadGraphTask,
  isEgeInfTruthTableTask,
  isEgeInformaticsContext,
  isOgeInformaticsTask,
  isOgeRusTask13,
} from "../../utils/isOgeInformaticsTask";
import { fetchJournalStudentErrors } from "../../utils/cabinetAuth";
import HomeworkFromErrorsModal, { taskErrorKey } from "./HomeworkFromErrorsModal";

function statusLabel(status) {
  if (status === "partial") return "Частично";
  if (status === "incorrect") return "Неверно";
  return status || "Ошибка";
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function AttachmentList({ attachments }) {
  if (!attachments?.length) return <span className="jg-errors-table__empty">—</span>;
  return (
    <ul className="jg-errors-table__files">
      {attachments.map((file) => (
        <li key={file.url}>
          <a href={file.url} target="_blank" rel="noreferrer">
            {file.filename || "Файл"}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ConditionCell({ task, level, subject }) {
  if (!task?.condition_html && !task?.condition_file_url) {
    return <span className="jg-errors-table__empty">Нет условия</span>;
  }
  return (
    <div className="jg-errors-table__rich">
      {task.condition_html ? (
        <MathContent
          html={task.condition_html}
          className="jg-errors-table__condition task-text"
          ogeMathChoiceEnhance={subject === "math"}
          ogeInf13Enhance={isOgeInformaticsTask(level, subject, task.number, 13)}
          ogeRus13Enhance={isOgeRusTask13(level, subject, task.number)}
          ogeInf6Enhance={isOgeInformaticsTask(level, subject, task.number, 6)}
          egeInfFileEnhance={isEgeInformaticsContext(level, subject)}
          egeInf22Enhance={isEgeInfParallelProcessesTask(level, subject, task.number)}
          egeInf1Enhance={isEgeInfRoadGraphTask(level, subject, task.number)}
          egeInf2Enhance={isEgeInfTruthTableTask(level, subject, task.number)}
        />
      ) : null}
      {task.condition_file_url ? <TaskFileAttachment href={task.condition_file_url} /> : null}
    </div>
  );
}

function AnswerCell({ html, empty = "Нет ответа", className = "" }) {
  const text = String(html || "").trim();
  if (!text) return <span className="jg-errors-table__empty">{empty}</span>;
  return (
    <div className={`jg-errors-table__answer ${className}`.trim()}>
      <MathContent html={text} plainHtml />
    </div>
  );
}

function taskNumberKey(task) {
  if (task?.number == null || task.number === "") return "other";
  return String(task.number);
}

function taskSubtopicKey(task) {
  if (task?.subtopic_id != null && task.subtopic_id !== "") {
    return `id:${task.subtopic_id}`;
  }
  const title = String(task?.subtopic_title || "").trim();
  if (title) return `title:${title}`;
  return "none";
}

function taskSubtopicTitle(task) {
  const title = String(task?.subtopic_title || "").trim();
  if (title) return title;
  return "Без подтемы";
}

function FilterTabs({ label, tabs, value, onChange }) {
  if (!tabs.length) return null;
  return (
    <div className="jg-errors-filters" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          className={`jg-errors-filters__btn${value === tab.key ? " is-active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          <span className="jg-errors-filters__label">{tab.label}</span>
          <span className="jg-errors-filters__count">{tab.count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Вкладка журнала: ошибки ученика в таблице + выбор для работы над ошибками.
 * Выбор сохраняется при переключении фильтров.
 */
export default function JournalStudentErrorsPanel({
  studentId,
  studentName = "",
  onErrorsCountChange,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [composeMode, setComposeMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [numberFilter, setNumberFilter] = useState("all");
  const [subtopicFilter, setSubtopicFilter] = useState("all");

  const load = useCallback(async () => {
    if (!studentId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await fetchJournalStudentErrors(studentId);
      setData(next);
      onErrorsCountChange?.(Number(next?.total_errors) || 0);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить ошибки ученика");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [studentId, onErrorsCountChange]);

  useEffect(() => {
    setComposeMode(false);
    setSelectedKeys(new Set());
    setModalOpen(false);
    setNotice("");
    setNumberFilter("all");
    setSubtopicFilter("all");
    void load();
  }, [load]);

  const allTasks = useMemo(() => {
    const rows = [];
    (data?.subjects || []).forEach((group) => {
      (group.tasks || []).forEach((task) => {
        rows.push({
          ...task,
          subject: group.subject,
          subject_label: group.subject_label,
          level: group.level,
          level_label: group.level_label,
        });
      });
    });
    return rows;
  }, [data]);

  const numberFilters = useMemo(() => {
    const base = allTasks.filter((task) => {
      if (subtopicFilter === "all") return true;
      return taskSubtopicKey(task) === subtopicFilter;
    });
    const counts = new Map();
    base.forEach((task) => {
      const key = taskNumberKey(task);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const numbered = [...counts.entries()]
      .filter(([key]) => key !== "other")
      .map(([key, count]) => ({
        key,
        label: `№${key}`,
        count,
        sort: Number(key),
      }))
      .sort((a, b) => {
        const aNum = Number.isFinite(a.sort) ? a.sort : Infinity;
        const bNum = Number.isFinite(b.sort) ? b.sort : Infinity;
        if (aNum !== bNum) return aNum - bNum;
        return String(a.key).localeCompare(String(b.key), "ru");
      });
    const otherCount = counts.get("other") || 0;
    const tabs = [
      { key: "all", label: "Все номера", count: base.length },
      ...numbered,
    ];
    if (otherCount) tabs.push({ key: "other", label: "Без номера", count: otherCount });
    return tabs;
  }, [allTasks, subtopicFilter]);

  const subtopicFilters = useMemo(() => {
    const base = allTasks.filter((task) => {
      if (numberFilter === "all") return true;
      return taskNumberKey(task) === numberFilter;
    });
    const counts = new Map();
    const titles = new Map();
    base.forEach((task) => {
      const key = taskSubtopicKey(task);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!titles.has(key)) titles.set(key, taskSubtopicTitle(task));
    });
    const named = [...counts.entries()]
      .filter(([key]) => key !== "none")
      .map(([key, count]) => ({
        key,
        label: titles.get(key) || "Подтема",
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
    const noneCount = counts.get("none") || 0;
    const tabs = [
      { key: "all", label: "Все подтемы", count: base.length },
      ...named,
    ];
    if (noneCount) tabs.push({ key: "none", label: "Без подтемы", count: noneCount });
    return tabs;
  }, [allTasks, numberFilter]);

  useEffect(() => {
    if (numberFilter !== "all" && !numberFilters.some((tab) => tab.key === numberFilter)) {
      setNumberFilter("all");
    }
  }, [numberFilter, numberFilters]);

  useEffect(() => {
    if (subtopicFilter !== "all" && !subtopicFilters.some((tab) => tab.key === subtopicFilter)) {
      setSubtopicFilter("all");
    }
  }, [subtopicFilter, subtopicFilters]);

  const filteredTasks = useMemo(() => {
    return allTasks.filter((task) => {
      if (numberFilter !== "all" && taskNumberKey(task) !== numberFilter) return false;
      if (subtopicFilter !== "all" && taskSubtopicKey(task) !== subtopicFilter) return false;
      return true;
    });
  }, [allTasks, numberFilter, subtopicFilter]);

  // Выбор по всем ошибкам, не только по видимому фильтру
  const selectedTasks = useMemo(
    () => allTasks.filter((t) => selectedKeys.has(taskErrorKey(t))),
    [allTasks, selectedKeys],
  );

  const selectedVisibleCount = useMemo(
    () => filteredTasks.filter((t) => selectedKeys.has(taskErrorKey(t))).length,
    [filteredTasks, selectedKeys],
  );

  const selectedHiddenCount = selectedTasks.length - selectedVisibleCount;

  const subjectGroups = useMemo(() => {
    const map = new Map();
    filteredTasks.forEach((task) => {
      const key = `${task.subject}|${task.level}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          subject: task.subject,
          subject_label: task.subject_label,
          level: task.level,
          level_label: task.level_label,
          tasks: [],
        });
      }
      map.get(key).tasks.push(task);
    });
    return [...map.values()];
  }, [filteredTasks]);

  const toggle = (task) => {
    const key = taskErrorKey(task);
    setComposeMode(true);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectVisible = () => {
    setComposeMode(true);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      filteredTasks.forEach((task) => next.add(taskErrorKey(task)));
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  const startCompose = () => {
    setComposeMode(true);
    setNotice("");
  };

  const openAssignModal = () => {
    if (!selectedTasks.length) {
      setError("Выберите задания с ошибками");
      return;
    }
    setError("");
    setModalOpen(true);
  };

  if (!studentId) {
    return <div className="jg-empty">Выберите ученика</div>;
  }

  const numberLabel =
    numberFilter === "all"
      ? null
      : numberFilter === "other"
        ? "без номера"
        : `№${numberFilter}`;
  const subtopicLabel =
    subtopicFilter === "all"
      ? null
      : subtopicFilters.find((tab) => tab.key === subtopicFilter)?.label || "подтема";

  const colCount = composeMode ? 9 : 8;

  return (
    <div className="jg-errors">
      <div className="jg-errors__toolbar">
        <div className="jg-errors__toolbar-text">
          <h2 className="jg-errors__title">Ошибки ученика</h2>
          <p className="jg-errors__hint">
            Выбирайте задачи для работы над ошибками — выбор сохраняется при смене фильтров.
          </p>
        </div>
        <div className="jg-errors__actions">
          {!composeMode ? (
            <button
              type="button"
              className="jg-btn jg-btn--primary"
              disabled={loading || !allTasks.length}
              onClick={startCompose}
            >
              Составить работу над ошибками
            </button>
          ) : (
            <>
              <button
                type="button"
                className="jg-btn jg-btn--ghost"
                onClick={() => {
                  setComposeMode(false);
                  clearSelection();
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                className="jg-btn jg-btn--secondary"
                disabled={!filteredTasks.length}
                onClick={selectVisible}
              >
                Выбрать видимые
              </button>
              <button
                type="button"
                className="jg-btn jg-btn--primary"
                disabled={!selectedTasks.length}
                onClick={openAssignModal}
              >
                Выдать как ДЗ
                {selectedTasks.length ? ` (${selectedTasks.length})` : ""}
              </button>
            </>
          )}
        </div>
      </div>

      {notice ? <div className="jg-errors__notice">{notice}</div> : null}
      {error ? <div className="jl-error">{error}</div> : null}

      {loading ? (
        <div className="jg-empty">Загрузка…</div>
      ) : !allTasks.length ? (
        <div className="jg-empty">
          Пока нет задач с ошибками. Они появятся после проверки домашних работ с вариантами.
        </div>
      ) : (
        <>
          <div className="jg-errors-filters-block">
            <div className="jg-errors-filters-block__title">Тип задания</div>
            <FilterTabs
              label="Фильтр по типу задания"
              tabs={numberFilters}
              value={numberFilter}
              onChange={setNumberFilter}
            />
          </div>

          {subtopicFilters.length > 1 ? (
            <div className="jg-errors-filters-block">
              <div className="jg-errors-filters-block__title">Подтема</div>
              <FilterTabs
                label="Фильтр по подтеме"
                tabs={subtopicFilters}
                value={subtopicFilter}
                onChange={setSubtopicFilter}
              />
            </div>
          ) : null}

          <p className="jg-errors__stats">
            Показано: {filteredTasks.length}
            {numberLabel ? ` · ${numberLabel}` : ""}
            {subtopicLabel ? ` · ${subtopicLabel}` : ""}
            {selectedTasks.length
              ? ` · выбрано ${selectedTasks.length}${selectedHiddenCount > 0 ? ` (скрыто фильтром: ${selectedHiddenCount})` : ""}`
              : ""}
          </p>

          <div className="jg-errors-table-wrap">
            <table className="jg-errors-table">
              <thead>
                <tr>
                  {composeMode ? <th className="jg-errors-table__check">Выбор</th> : null}
                  <th className="jg-errors-table__num">№</th>
                  <th>Задание / подтема</th>
                  <th>Статус</th>
                  <th className="jg-errors-table__col-rich">Условие</th>
                  <th className="jg-errors-table__col-rich">Ответ ученика</th>
                  <th className="jg-errors-table__col-rich">Эталон</th>
                  <th>Комментарий и файлы</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {subjectGroups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="jg-errors-table__group">
                      <td colSpan={colCount}>
                        <strong>{group.subject_label || group.subject}</strong>
                        {group.level_label ? (
                          <span className="jg-errors-table__level">{group.level_label}</span>
                        ) : null}
                        <span className="jg-errors-table__group-count">
                          {group.tasks.length}
                        </span>
                      </td>
                    </tr>
                    {group.tasks.map((task) => {
                      const key = taskErrorKey(task);
                      const checked = selectedKeys.has(key);
                      const attachments = Array.isArray(task.attachments) ? task.attachments : [];
                      const teacherAttachments = Array.isArray(task.teacher_attachments)
                        ? task.teacher_attachments
                        : [];
                      const comment = String(task.task_comment || "").trim();
                      return (
                        <tr
                          key={key}
                          className={`jg-errors-table__row${composeMode && checked ? " is-selected" : ""}`}
                        >
                          {composeMode ? (
                            <td className="jg-errors-table__check">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(task)}
                                aria-label={`Выбрать задание ${task.number ?? task.task_id}`}
                              />
                            </td>
                          ) : null}
                          <td className="jg-errors-table__num">
                            {task.number != null ? `№${task.number}` : "—"}
                          </td>
                          <td>
                            <div className="jg-errors-table__title">
                              {task.title || `Задание ${task.task_id}`}
                            </div>
                            <div className="jg-errors-table__sub">
                              {taskSubtopicTitle(task)}
                            </div>
                          </td>
                          <td>
                            <span className={`jg-status-badge jg-status-badge--${task.status === "partial" ? "warning" : "danger"}`}>
                              {statusLabel(task.status)}
                            </span>
                            {task.score != null && task.max_score != null ? (
                              <div className="jg-errors-table__sub">
                                {task.score}/{task.max_score}
                              </div>
                            ) : null}
                          </td>
                          <td className="jg-errors-table__col-rich">
                            <ConditionCell
                              task={task}
                              level={group.level}
                              subject={group.subject}
                            />
                          </td>
                          <td className="jg-errors-table__col-rich">
                            <AnswerCell html={task.student_answer} />
                            {attachments.length ? (
                              <div className="jg-errors-table__files-block">
                                <span className="jg-errors-table__mini-label">Файлы ученика</span>
                                <AttachmentList attachments={attachments} />
                              </div>
                            ) : null}
                          </td>
                          <td className="jg-errors-table__col-rich">
                            <AnswerCell
                              html={task.correct_answer_html}
                              empty="—"
                              className="jg-errors-table__answer--correct"
                            />
                          </td>
                          <td>
                            {comment ? (
                              <p className="jg-errors-table__comment">{comment}</p>
                            ) : (
                              <span className="jg-errors-table__empty">Нет комментария</span>
                            )}
                            {teacherAttachments.length ? (
                              <div className="jg-errors-table__files-block">
                                <span className="jg-errors-table__mini-label">Файлы учителя</span>
                                <AttachmentList attachments={teacherAttachments} />
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <div className="jg-errors-table__source">
                              {task.source_homework_title || "ДЗ"}
                            </div>
                            <div className="jg-errors-table__sub">
                              {formatDate(task.occurred_at)}
                            </div>
                            {task.review_id ? (
                              <Link
                                className="jg-errors-table__link"
                                to={`/cabinet/review/${task.review_id}`}
                              >
                                К проверке
                              </Link>
                            ) : null}
                            {!composeMode ? (
                              <button
                                type="button"
                                className="jg-btn jg-btn--secondary jg-btn--sm jg-errors-table__pick"
                                onClick={() => toggle(task)}
                              >
                                Выбрать
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedTasks.length ? (
        <div className="jg-errors__sticky">
          <span>
            Выбрано: {selectedTasks.length}
            {selectedHiddenCount > 0
              ? ` · сейчас на экране ${selectedVisibleCount}, скрыто фильтром ${selectedHiddenCount}`
              : ""}
          </span>
          <div className="jg-errors__sticky-actions">
            <button type="button" className="jg-btn jg-btn--ghost jg-btn--sm" onClick={clearSelection}>
              Сбросить
            </button>
            <button type="button" className="jg-btn jg-btn--primary jg-btn--sm" onClick={openAssignModal}>
              Выдать как ДЗ
            </button>
          </div>
        </div>
      ) : null}

      <HomeworkFromErrorsModal
        open={modalOpen}
        studentId={studentId}
        studentName={studentName || data?.student?.full_name || ""}
        selectedTasks={selectedTasks}
        suggestedDueAt={data?.suggested_due_at}
        defaultTitle={data?.default_title || "Работа над ошибками"}
        defaultDescription={data?.default_description || ""}
        onClose={() => setModalOpen(false)}
        onDone={(result) => {
          setModalOpen(false);
          setComposeMode(false);
          setSelectedKeys(new Set());
          setNotice(result?.message || "Работа над ошибками создана");
          window.dispatchEvent(new Event("cabinet:nav-counts-refresh"));
          void load();
        }}
      />
    </div>
  );
}
