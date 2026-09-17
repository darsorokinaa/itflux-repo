/**
 * Общая модель отображения задания в рабочей тетради и варианте:
 * сквозная нумерация документа, размер поля решения, HTML-фрагменты печати.
 */
import { inferExamTaskPart } from "./examTaskPart";

export type SolutionSize = "small" | "medium" | "large";

export type DocumentTaskLike = {
  id?: number | string;
  number?: number | null;
  task_number?: number | null;
  exam_number?: number | null;
  exam_part?: number | null;
  part?: number | null;
  part_title?: string | null;
  max_score?: number | null;
  solutionSize?: SolutionSize | null;
};

const LINKED_19_21 = [19, 20, 21];

export type TaskPositionMode = "compact" | "card" | "viewer" | "review" | "print" | "result";

export type TaskPositionInput = {
  position?: number | null;
  displayNumber?: number | null;
  index?: number | null;
  total?: number | null;
  examNumber?: number | string | null;
  task?: DocumentTaskLike | null;
  level?: string | null;
  topic?: string | null;
};

export function toDisplayNumber(
  value: number | string | null | undefined,
  opts: { fromIndex?: boolean } = {}
): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pos = opts.fromIndex ? n + 1 : n;
  return pos >= 1 ? Math.trunc(pos) : null;
}

export function examTypeNumber(task: DocumentTaskLike | null | undefined): number | null {
  const raw = task?.task_number ?? task?.exam_number ?? task?.number;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export function examLevelLabel(level?: string | null): string {
  const lv = String(level || "").toLowerCase();
  if (lv === "ege") return "ЕГЭ";
  if (lv === "oge") return "ОГЭ";
  if (lv === "vpr") return "ВПР";
  return "";
}

export function assignDisplayNumbers<T>(tasks: T[]): Array<T & { displayNumber: number }> {
  return (Array.isArray(tasks) ? tasks : []).map((task, index) => ({
    ...task,
    displayNumber: index + 1,
  }));
}

export function resolveTaskPosition(input: TaskPositionInput = {}): {
  position: number | null;
  total: number | null;
  examNumber: number | null;
  examLabel: string;
  topic: string;
  progressLabel: string;
  ariaLabel: string;
} {
  const position =
    toDisplayNumber(input.position) ??
    toDisplayNumber(input.displayNumber) ??
    toDisplayNumber(input.index, { fromIndex: true });
  const total = toDisplayNumber(input.total);
  const examNumber =
    examTypeNumber(input.task) ??
    toDisplayNumber(input.examNumber);
  const topic = String(input.topic || "").trim();
  const examLabel = examTypeShortLabel(
    input.task || { number: examNumber },
    input.level,
    position
  );
  const progressLabel = formatTaskProgress(position, total);
  return {
    position,
    total,
    examNumber,
    examLabel,
    topic,
    progressLabel,
    ariaLabel: taskPositionAriaLabel({
      position,
      total,
      examNumber,
      level: input.level,
      topic,
    }),
  };
}

/** «ЕГЭ №15» — вторичная подпись. Пусто, если номера экзамена нет. */
export function examTypeShortLabel(
  task: DocumentTaskLike | null | undefined,
  level?: string | null,
  displayNumber?: number | null
): string {
  const exam = examTypeNumber(task);
  if (exam == null) return "";
  const label = examLevelLabel(level);
  if (!label && displayNumber != null && exam === displayNumber) return "";
  return label ? `${label} №${exam}` : `№${exam}`;
}

export function formatTaskProgress(position: number | null, total?: number | null): string {
  const pos = toDisplayNumber(position);
  if (pos == null) return "";
  const tot = toDisplayNumber(total);
  if (tot != null) return `Задание ${pos} из ${tot}`;
  return `Задание ${pos}`;
}

export function taskPositionAriaLabel(input: {
  position?: number | null;
  total?: number | null;
  examNumber?: number | null;
  level?: string | null;
  topic?: string | null;
}): string {
  const parts: string[] = [];
  const progress = formatTaskProgress(input.position ?? null, input.total);
  if (progress) parts.push(`${progress}.`);
  const exam = toDisplayNumber(input.examNumber);
  if (exam != null) {
    const label = examLevelLabel(input.level);
    parts.push(label ? `${label}, задание ${exam}.` : `Задание №${exam}.`);
  }
  const topic = String(input.topic || "").trim();
  if (topic && !parts.some((part) => part.includes(topic))) {
    parts.push(topic.endsWith(".") ? topic : `${topic}.`);
  }
  return parts.join(" ").trim();
}

function normalizeForPart(task: DocumentTaskLike): DocumentTaskLike {
  return {
    ...task,
    number: task.number ?? task.task_number ?? task.exam_number ?? null,
  };
}

export function orderVariantDocumentTasks<T extends DocumentTaskLike>(
  tasks: T[],
  opts: { level?: string | null; subject?: string | null } = {}
): T[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const { level, subject } = opts;
  const partOf = (task: T) => inferExamTaskPart(normalizeForPart(task), level, subject);
  const part1 = tasks.filter((task) => partOf(task) === 1);
  const part2 = tasks.filter((task) => partOf(task) !== 1);
  const examNum = (task: T) => examTypeNumber(task) ?? Number.POSITIVE_INFINITY;
  const linked = part2.filter((task) => LINKED_19_21.includes(examNum(task)));
  const rest = part2.filter((task) => !LINKED_19_21.includes(examNum(task)));
  const showLinked = String(subject || "").toLowerCase() === "inf" && linked.length === 3;
  // Порядок внутри части — как в текущем наборе (pick / DnD), без сортировки по КИМ.
  const part2Ordered = showLinked ? [...linked, ...rest] : part2;
  return [...part1, ...part2Ordered];
}

export function inferSolutionSize(
  task: DocumentTaskLike | null | undefined,
  opts: { level?: string | null; subject?: string | null } = {}
): SolutionSize {
  if (task?.solutionSize === "small" || task?.solutionSize === "medium" || task?.solutionSize === "large") {
    return task.solutionSize;
  }
  const hasPartHint =
    task?.part != null ||
    task?.exam_part != null ||
    Boolean(String(task?.part_title || "").trim()) ||
    examTypeNumber(task) != null;
  if (!hasPartHint) return "medium";
  const part = inferExamTaskPart(normalizeForPart(task || {}), opts.level, opts.subject);
  if (part === 2) return "large";
  if (part === 1) return "small";
  const score = Number(task?.max_score);
  if (Number.isFinite(score) && score >= 2) return "large";
  return "medium";
}

export function solutionAreaHtml(size: SolutionSize = "medium"): string {
  const safe: SolutionSize = size === "small" || size === "large" ? size : "medium";
  return `<div class="tdoc-solution tdoc-solution--${safe} solution-area solution-area--${safe} wb-task__solution workbook-solution-block">
        <div class="tdoc-solution__grid solution-grid wb-solution-grid" role="presentation"></div>
      </div>`;
}

export function answerAreaHtml(): string {
  return `<div class="tdoc-answer wb-task__answer workbook-answer-block">
        <span class="tdoc-answer__label wb-answer-label">Ответ:</span>
        <span class="tdoc-answer__line wb-answer-line" aria-hidden="true"></span>
      </div>`;
}

export function examTypeCaption(
  task: DocumentTaskLike,
  level?: string | null,
  displayNumber?: number
): string {
  return examTypeShortLabel(task, level, displayNumber);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML шапки задания для PDF / рабочей тетради. */
export function taskPositionPrintHtml(input: TaskPositionInput): string {
  const model = resolveTaskPosition(input);
  const examHtml = model.examLabel
    ? `<div class="tdoc-pos__exam tdoc-task__exam">${escapeHtml(model.examLabel)}</div>`
    : "";
  const topicHtml =
    !model.examLabel && model.topic
      ? `<div class="tdoc-pos__exam tdoc-task__exam">${escapeHtml(model.topic)}</div>`
      : "";
  const numHtml =
    model.position != null
      ? `<div class="tdoc-pos__num tdoc-task__num" aria-hidden="true">${model.position}</div>`
      : "";
  return `<div class="tdoc-pos tdoc-pos--print tdoc-task__heading"${
    model.ariaLabel ? ` aria-label="${escapeHtml(model.ariaLabel)}"` : ""
  }>${numHtml}${examHtml}${topicHtml}</div>`;
}
