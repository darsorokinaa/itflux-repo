import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
// @ts-ignore JSX module without d.ts
import ExamTaskDrawingShell, { ExamTaskDrawingHeaderButton } from "./ExamTaskDrawingShell";
// @ts-ignore JSX module without d.ts
import MathContent from "./MathContent";
// @ts-ignore JSX module without d.ts
import { TaskFileAttachments } from "./TaskFileAttachment";
// @ts-ignore JSX module without d.ts
import TaskNoAnswerBadge from "./TaskNoAnswerBadge";
import { AllTasksTaskTagsEditor, type TaskTag } from "./AllTasksTagEditor";
import {
  AllTasksStaffEditor,
  type StaffGroupOption,
  type StaffSubtopicOption,
  type StaffTaskListOption,
  type StaffTaskPatch,
} from "./AllTasksStaffEditor";

export type BankTask = {
  id: number;
  task_number: number | null;
  task_title: string;
  task_list_id?: number | null;
  subtopic: string | null;
  subtopic_id?: number | null;
  subdivision?: string | null;
  text: string;
  answer?: string | null;
  file_url?: string | null;
  attachments?: Array<{ url: string; name?: string | null }>;
  part_id?: number | null;
  part_title?: string | null;
  author?: string | null;
  tags?: TaskTag[];
  group_id?: number | null;
  scope?: string | null;
  source_label?: string | null;
  local_number?: number | null;
  public_code?: string | null;
  bank_code?: string | null;
};

export const ALL_TASKS_BOARD_VARIANT_ID = "task-bank";
export const EMPTY_STAFF_TASK_LISTS: StaffTaskListOption[] = [];
export const EMPTY_STAFF_GROUPS: StaffGroupOption[] = [];
export const EMPTY_STAFF_SUBTOPICS: StaffSubtopicOption[] = [];
export const EMPTY_TASK_TAGS: TaskTag[] = [];

export function isFunctionGraphTask(
  task: Pick<BankTask, "task_title" | "subtopic" | "task_number">
) {
  const hay = `${task.task_title || ""} ${task.subtopic || ""}`.toLowerCase();
  return hay.includes("график") && hay.includes("функц");
}

export function isEnglishWritingSubject(subject: string): boolean {
  const s = String(subject || "").trim().toLowerCase();
  return s === "eng" || s === "eng_write";
}

export const LazyVisible = memo(function LazyVisible({
  minHeight = 140,
  rootMargin = "600px 0px",
  children,
}: {
  minHeight?: number;
  rootMargin?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [visible, rootMargin]);

  return (
    <div
      ref={ref}
      className="all-tasks-lazy"
      style={visible ? undefined : { minHeight }}
    >
      {visible ? (
        children
      ) : (
        <div className="all-tasks-lazy__skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
});

type TaskBodyProps = {
  task: BankTask;
  taskNumber: number;
  subject: string;
  level: string;
  useProgTaskSheet: boolean;
  persistEntry: unknown;
  openBoardRequested: boolean;
  onBoardPersist: (payload: { taskId: number } & Record<string, unknown>) => void;
  onConsumedBoardOpenRequest: () => void;
  canEditTaskTags: boolean;
  tagCatalog: TaskTag[];
  onTaskTagsChange: (taskId: number, tags: TaskTag[]) => void;
  canEditBankTasks: boolean;
  taskLists: StaffTaskListOption[];
  staffGroups: StaffGroupOption[];
  staffSubtopics: StaffSubtopicOption[];
  onStaffSaved: (patch: StaffTaskPatch) => void;
  staffGroupIdForTask?: number | null;
  answerOpen: boolean;
  onToggleAnswer: (taskId: number) => void;
  showAttachmentsFallback?: boolean;
};

const AllTasksTaskBody = memo(function AllTasksTaskBody({
  task,
  taskNumber,
  subject,
  level,
  useProgTaskSheet,
  persistEntry,
  openBoardRequested,
  onBoardPersist,
  onConsumedBoardOpenRequest,
  canEditTaskTags,
  tagCatalog,
  onTaskTagsChange,
  canEditBankTasks,
  taskLists,
  staffGroups,
  staffSubtopics,
  onStaffSaved,
  staffGroupIdForTask = null,
  answerOpen,
  onToggleAnswer,
  showAttachmentsFallback = true,
}: TaskBodyProps) {
  const onDrawingPersist = useCallback(
    (payload: Record<string, unknown>) => {
      onBoardPersist({ taskId: task.id, ...payload });
    },
    [onBoardPersist, task.id]
  );
  const answerHtml = (task.answer || "").trim();
  const hasFiles = Boolean(task.file_url || (task.attachments && task.attachments.length));

  return (
    <>
      {canEditTaskTags ? (
        <AllTasksTaskTagsEditor
          taskId={task.id}
          selected={task.tags || EMPTY_TASK_TAGS}
          catalog={tagCatalog}
          onChange={onTaskTagsChange}
        />
      ) : null}
      <div className="all-tasks-item__content">
        <ExamTaskDrawingShell
          enabled
          taskId={task.id}
          level={level}
          subject={subject}
          variantId={ALL_TASKS_BOARD_VARIANT_ID}
          persistEntry={persistEntry}
          onDrawingPersist={onDrawingPersist}
          openBoardForTaskId={openBoardRequested ? task.id : null}
          onConsumedBoardOpenRequest={onConsumedBoardOpenRequest}
        >
          <LazyVisible minHeight={120}>
            <MathContent
              html={task.text || ""}
              className="all-tasks-item__html"
              plainHtml
              ogeMathChoiceEnhance={subject === "math"}
              progTaskSheet={useProgTaskSheet}
              taskNumber={taskNumber}
            />
            {showAttachmentsFallback || hasFiles ? <TaskFileAttachments task={task} /> : null}
            {task.author ? <div className="task-author">{task.author}</div> : null}
          </LazyVisible>
        </ExamTaskDrawingShell>
      </div>
      {canEditBankTasks ? (
        <AllTasksStaffEditor
          taskId={task.id}
          taskListId={task.task_list_id ?? null}
          groupId={task.group_id ?? staffGroupIdForTask}
          subtopicId={task.subtopic_id ?? null}
          answer={task.answer || ""}
          taskLists={taskLists}
          groups={staffGroups}
          subtopics={staffSubtopics}
          showGroup
          onSaved={onStaffSaved}
        />
      ) : null}
      {answerHtml ? (
        <div className="all-tasks-item__answer-foot">
          <button
            type="button"
            className="all-tasks-item__answer-btn"
            onClick={() => onToggleAnswer(task.id)}
            aria-expanded={answerOpen ? "true" : "false"}
          >
            {answerOpen ? "Скрыть ответ" : "Посмотреть ответ"}
          </button>
        </div>
      ) : null}
      {answerOpen ? (
        <div
          className="all-tasks-item__answer"
          role="region"
          aria-live="polite"
          aria-label="Правильный ответ"
        >
          {answerHtml ? (
            <MathContent
              html={answerHtml}
              className="all-tasks-item__html all-tasks-item__html--answer"
              plainHtml
            />
          ) : (
            <p>Ответ не указан.</p>
          )}
        </div>
      ) : null}
    </>
  );
});

type BankItemProps = {
  task: BankTask;
  taskNumber: number;
  pickMode: boolean;
  inPick: boolean;
  onTogglePick: (task: BankTask, checked: boolean) => void;
  isTeacher: boolean;
  copyBusy: boolean;
  onCopyToBank: (task: BankTask) => void;
  useProgTaskSheet: boolean;
  hasTaskBoardDraft: boolean;
  onOpenBoard: (taskId: number) => void;
} & Omit<TaskBodyProps, "task" | "taskNumber" | "showAttachmentsFallback" | "staffGroupIdForTask">;

export const AllTasksBankItem = memo(function AllTasksBankItem({
  task,
  taskNumber,
  pickMode,
  inPick,
  onTogglePick,
  isTeacher,
  copyBusy,
  onCopyToBank,
  useProgTaskSheet,
  hasTaskBoardDraft,
  onOpenBoard,
  ...bodyProps
}: BankItemProps) {
  const answerHtml = (task.answer || "").trim();
  return (
    <li className="all-tasks-list__item">
      <article
        className={[
          "all-tasks-item",
          useProgTaskSheet ? "all-tasks-item--prog-sheet" : "",
          task.subdivision === "geom" ? "all-tasks-item--geom" : "",
          task.subdivision === "alg" ? "all-tasks-item--alg" : "",
          isFunctionGraphTask(task) ? "all-tasks-item--function-graphs" : "",
          pickMode && inPick ? "all-tasks-item--in-workbook" : "",
          isTeacher && task.source_label === "teacher" ? "all-tasks-item--mine" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-task-id={task.id}
        data-task-number={task.task_number ?? undefined}
      >
        <div className="all-tasks-item__card">
          <header className="all-tasks-item__head">
            <p className="all-tasks-item__meta">
              <span className="all-tasks-item__num">
                {task.source_label === "teacher" && task.local_number != null
                  ? `№${task.local_number}`
                  : `№${taskNumber}`}
              </span>
              {isTeacher ? (
                <span
                  className={`mtb-badge ${
                    task.source_label === "teacher" ? "mtb-badge--mine" : "mtb-badge--platform"
                  }`}
                >
                  {task.source_label === "teacher" ? "Моя задача" : "Общий банк"}
                </span>
              ) : null}
              {task.public_code ? (
                <>
                  <span className="all-tasks-item__meta-sep" aria-hidden>
                    ·
                  </span>
                  <span>{task.public_code}</span>
                </>
              ) : null}
              <span className="all-tasks-item__meta-sep" aria-hidden>
                ·
              </span>
              <span>ID {task.id}</span>
              {task.task_title ? (
                <>
                  <span className="all-tasks-item__meta-sep" aria-hidden>
                    ·
                  </span>
                  <span>{task.task_title}</span>
                </>
              ) : null}
              {task.subtopic ? (
                <>
                  <span className="all-tasks-item__meta-sep" aria-hidden>
                    ·
                  </span>
                  <span>{task.subtopic}</span>
                </>
              ) : null}
              {!answerHtml ? <TaskNoAnswerBadge /> : null}
            </p>
            <div className="all-tasks-item__actions">
              {pickMode ? (
                <label className="all-tasks-item__workbook-check">
                  <input
                    type="checkbox"
                    checked={inPick}
                    onChange={(e) => onTogglePick(task, e.target.checked)}
                  />
                  <span>{inPick ? "Добавлено" : "Добавить"}</span>
                </label>
              ) : null}
              <ExamTaskDrawingHeaderButton
                onClick={() => onOpenBoard(task.id)}
                hasDraft={hasTaskBoardDraft}
              />
              {task.source_label !== "teacher" ? (
                <button
                  type="button"
                  className="all-tasks-item__answer-btn"
                  disabled={copyBusy}
                  onClick={() => onCopyToBank(task)}
                >
                  Скопировать в мой банк
                </button>
              ) : null}
            </div>
          </header>
          <AllTasksTaskBody
            {...bodyProps}
            task={task}
            taskNumber={taskNumber}
            useProgTaskSheet={useProgTaskSheet}
            showAttachmentsFallback
          />
        </div>
      </article>
    </li>
  );
});

type GroupPartProps = {
  task: BankTask;
  hasTaskBoardDraft: boolean;
  onOpenBoard: (taskId: number) => void;
} & Omit<TaskBodyProps, "showAttachmentsFallback">;

const AllTasksGroupPart = memo(function AllTasksGroupPart({
  task,
  hasTaskBoardDraft,
  onOpenBoard,
  ...bodyProps
}: GroupPartProps) {
  const taskNumber = task.task_number ?? 0;
  const answerHtml = (task.answer || "").trim();
  return (
    <section
      className={[
        "all-tasks-item__group-part",
        isFunctionGraphTask(task) ? "all-tasks-item__group-part--function-graphs" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-task-id={task.id}
      data-task-number={task.task_number ?? undefined}
    >
      <div className="all-tasks-item__group-part-head">
        <p className="all-tasks-item__meta">
          <span className="all-tasks-item__num">№{taskNumber}</span>
          <span className="all-tasks-item__meta-sep" aria-hidden>
            ·
          </span>
          <span>ID {task.id}</span>
          {task.task_title ? (
            <>
              <span className="all-tasks-item__meta-sep" aria-hidden>
                ·
              </span>
              <span>{task.task_title}</span>
            </>
          ) : null}
          {task.part_title ? (
            <>
              <span className="all-tasks-item__meta-sep" aria-hidden>
                ·
              </span>
              <span>{task.part_title}</span>
            </>
          ) : null}
          {!answerHtml ? <TaskNoAnswerBadge /> : null}
        </p>
        <div className="all-tasks-item__actions">
          <ExamTaskDrawingHeaderButton
            onClick={() => onOpenBoard(task.id)}
            hasDraft={hasTaskBoardDraft}
          />
        </div>
      </div>
      <AllTasksTaskBody
        {...bodyProps}
        task={task}
        taskNumber={taskNumber}
        showAttachmentsFallback={false}
      />
    </section>
  );
});

type GroupItemProps = {
  groupId: number;
  tasks: BankTask[];
  subdivision?: string | null;
  pickMode: boolean;
  inPick: boolean;
  onToggleGroup: (tasks: BankTask[], checked: boolean) => void;
  subject: string;
  level: string;
  useProgTaskSheet: boolean;
  boardsByTask: Record<string, unknown>;
  openAnswers: Record<number, boolean>;
  openBoardForTaskId: number | null;
  boardPersistHasDraft: (persist: unknown) => boolean;
  onOpenBoard: (taskId: number) => void;
  onBoardPersist: TaskBodyProps["onBoardPersist"];
  onConsumedBoardOpenRequest: () => void;
  canEditTaskTags: boolean;
  tagCatalog: TaskTag[];
  onTaskTagsChange: (taskId: number, tags: TaskTag[]) => void;
  canEditBankTasks: boolean;
  taskLists: StaffTaskListOption[];
  staffGroups: StaffGroupOption[];
  staffSubtopics: StaffSubtopicOption[];
  onStaffSaved: (patch: StaffTaskPatch) => void;
  onToggleAnswer: (taskId: number) => void;
};

const AllTasksGroupBody = memo(function AllTasksGroupBody({
  tasks,
  subject,
  groupId,
  boardsByTask,
  openAnswers,
  openBoardForTaskId,
  boardPersistHasDraft,
  ...shared
}: Omit<GroupItemProps, "pickMode" | "inPick" | "onToggleGroup" | "subdivision">) {
  const stackGroupTasks = isEnglishWritingSubject(subject);
  const firstTask = tasks[0];
  const otherTasks = tasks.slice(1);

  const renderPart = (task: BankTask) => {
    const persistEntry = boardsByTask[String(task.id)];
    return (
      <AllTasksGroupPart
        key={task.id}
        task={task}
        taskNumber={task.task_number ?? 0}
        subject={subject}
        persistEntry={persistEntry}
        openBoardRequested={openBoardForTaskId === task.id}
        hasTaskBoardDraft={boardPersistHasDraft(persistEntry)}
        answerOpen={!!openAnswers[task.id]}
        staffGroupIdForTask={groupId}
        {...shared}
      />
    );
  };

  if (stackGroupTasks) {
    return <div className="all-tasks-item__group-col">{tasks.map(renderPart)}</div>;
  }

  return (
    <>
      <div className="all-tasks-item__group-col all-tasks-item__group-col--main">
        {firstTask ? renderPart(firstTask) : null}
      </div>
      {otherTasks.length > 0 ? (
        <div className="all-tasks-item__group-col all-tasks-item__group-col--sub">
          {otherTasks.map(renderPart)}
        </div>
      ) : null}
    </>
  );
});

export const AllTasksGroupItem = memo(function AllTasksGroupItem({
  groupId,
  tasks,
  subdivision,
  pickMode,
  inPick,
  onToggleGroup,
  subject,
  ...bodyProps
}: GroupItemProps) {
  const groupNums = tasks
    .map((t) => t.task_number)
    .filter((n): n is number => n != null);
  const groupHasMissingAnswer = tasks.some((t) => !(t.answer && String(t.answer).trim()));

  return (
    <li className="all-tasks-list__item">
      <article
        className={[
          "all-tasks-item",
          "all-tasks-item--group",
          subdivision === "geom" ? "all-tasks-item--geom" : "",
          subdivision === "alg" ? "all-tasks-item--alg" : "",
          pickMode && inPick ? "all-tasks-item--in-workbook" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-group-id={groupId}
      >
        <div className="all-tasks-item__card">
          <header className="all-tasks-item__head all-tasks-item__head--group">
            <p className="all-tasks-item__meta">
              <span className="all-tasks-item__num">Группа заданий</span>
              <span className="all-tasks-item__meta-sep" aria-hidden>
                ·
              </span>
              <span>вариант #{groupId}</span>
              {groupNums.length ? (
                <>
                  <span className="all-tasks-item__meta-sep" aria-hidden>
                    ·
                  </span>
                  <span>№{groupNums.join(", ")}</span>
                </>
              ) : null}
              {groupHasMissingAnswer ? <TaskNoAnswerBadge /> : null}
            </p>
            <div className="all-tasks-item__actions">
              {pickMode ? (
                <label className="all-tasks-item__workbook-check">
                  <input
                    type="checkbox"
                    checked={inPick}
                    onChange={(e) => onToggleGroup(tasks, e.target.checked)}
                  />
                  <span>{inPick ? "Добавлено" : "Добавить группу"}</span>
                </label>
              ) : null}
            </div>
          </header>
          <div
            className={[
              "all-tasks-item__group-body",
              isEnglishWritingSubject(subject) ? "all-tasks-item__group-body--stack" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <AllTasksGroupBody
              tasks={tasks}
              subject={subject}
              groupId={groupId}
              {...bodyProps}
            />
          </div>
        </div>
      </article>
    </li>
  );
});
