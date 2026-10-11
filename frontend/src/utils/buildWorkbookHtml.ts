/**
 * Вариант и рабочая тетрадь открываются в автономном шаблоне
 * public/templates/shablon_varianta_ege_2027.html.
 * В script#document-data подставляется JSON. «<» экранируется как \\u003c.
 */

import { prepareBankTaskDisplayHtml } from "../components/MathContent.jsx";
import { collectTaskFiles } from "../components/TaskFileAttachment.jsx";
import { examVariantCopy } from "./examVariantCopy";
import { formatTasksCount } from "./formatTasksCount";
import { inferExamTaskPart, isOgeMathPictureTask } from "./examTaskPart";
import {
  examTypeNumber,
  orderVariantDocumentTasks,
  type SolutionSize,
} from "./taskDocument";

export const EXAM_TEMPLATE_URL = "/templates/shablon_varianta_ege_2027.html";

const TEMPLATE_FOOTER = "Цифровой поток • Учебные материалы";
const TEMPLATE_YEAR = "2027";
const TEMPLATE_WATERMARK = "ПРОЕКТ ЕГЭ 2027";

const ALLOWED_TAGS = new Set(
  "p div span br b strong i em u s sub sup ul ol li table thead tbody tfoot tr th td colgroup col caption figure figcaption img math semantics mrow mi mn mo mtext mfrac msqrt mroot msup msub msubsup mfenced mtable mtr mtd mover munder munderover mspace menclose mpadded mstyle svg g path rect line circle ellipse polyline polygon text tspan defs marker title desc".split(
    " "
  )
);

const DROP_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta"]);

export type WorkbookTask = {
  id: number;
  task_number: number | null;
  text: string;
  answer?: string | null;
  subtopic?: string | null;
  task_title?: string | null;
  file_url?: string | null;
  /** Все вложения задания: архив, pdf, картинка. */
  files?: Array<{ url?: string | null; name?: string | null }>;
  part?: number | null;
  part_title?: string | null;
  exam_part?: number | null;
  max_score?: number | null;
  author?: string | null;
  solutionSize?: SolutionSize | null;
};

export type WorkbookOptions = {
  /** Блок «Для учителя» внизу листа. В шаблоне такого блока нет. */
  showGrading?: boolean;
  /** Поле для решения: в шаблоне это клетка. */
  showSolutionSpace?: boolean;
  /** Строка «Ответ:» у заданий части 1. */
  showAnswers?: boolean;
  /** Отдельный лист ответов. */
  showAnswerKey?: boolean;
  /** Номер задания из банка рядом с номером на листе. */
  showTaskIds?: boolean;
  /** Строка «Фамилия, имя» на листе. В PDF её можно выключить галочкой «ФИО». */
  showStudentLine?: boolean;
  /** Строка «Дата» на листе. В PDF её можно выключить галочкой «Дата». */
  showDateLine?: boolean;
};

export type WorkbookMeta = {
  title: string;
  subtitle?: string;
  subject?: string;
  /** Уровень экзамена (oge/ege/vpr/school). */
  level?: string;
  /** Заголовок на листе; для варианта номер берётся отдельно. */
  sheetTitle?: string;
  /** workbook — рабочий лист; variant — экзаменационный вариант. */
  mode?: "workbook" | "variant";
  /** Например «150 минут». */
  examDuration?: string;
  options?: WorkbookOptions;
  /** Тексты TaskPreview по частям 1 и 2. Пустые ключи заменяются текстом предмета. */
  partInstructions?: Record<string, string> | null;
  /** Абзацы инструкции с обложки из TaskPreview без части. */
  coverParagraphs?: string[] | null;
  /** Фон печатного листа из темы: альбомный и книжный. */
  sheetBackground?: { landscape?: string | null; portrait?: string | null } | null;
};

export type VariantPdfTask = {
  id: number;
  number?: number | null;
  text?: string;
  answer?: string | null;
  subtopic_title?: string | null;
  task_title?: string | null;
  file?: string | null;
  attachments?: Array<{ url?: string; name?: string | null }>;
  part?: number | null;
  part_title?: string | null;
  exam_part?: number | null;
  max_score?: number | null;
  author?: string | null;
};

export type ExamTemplateFigure = {
  src?: string;
  svg?: string;
  widthMm: number;
  placement: "right" | "center";
  alt: string;
};

export type ExamTemplateMaterial = {
  href: string;
  name: string;
};

export type ExamTemplateTask = {
  number: string;
  part: 1 | 2;
  html?: string;
  text?: string;
  figure?: ExamTemplateFigure;
  materials?: ExamTemplateMaterial[];
  answer?: string;
  answerStyle?: "none";
  /** ID задания в банке. На листе виден, только если включена галочка. */
  id?: number;
};

export type ExamTemplateDocument = {
  mode: "exam" | "worksheet";
  title: string;
  subject: string;
  grade: string;
  year: string;
  level: string;
  variant: string;
  duration: number;
  startPage: number;
  headerLeft: string;
  footer: string;
  watermark: string;
  worksheetInstructions?: string;
  partInstructions?: Record<string, string>;
  coverParagraphs?: string[];
  coverAnswerNote?: string;
  coverToolsNote?: string;
  showAnswerExample?: boolean;
  /** Фон страницы: landscape — разворот A4, portrait — одна страница A4. */
  sheetBackground?: { landscape: string; portrait: string };
  options: {
    layout: "spread";
    includeCover: boolean;
    showWatermark: boolean;
    showAlternatives: boolean;
    showAnswerKey: boolean;
    showTaskIds: boolean;
    showStudentName: boolean;
    showStudentDate: boolean;
    solutionLines: number;
    solutionStyle: "lines" | "grid";
  };
  tasks: ExamTemplateTask[];
};

export const VARIANT_PDF_OPTIONS: Required<WorkbookOptions> = {
  showGrading: false,
  showSolutionSpace: true,
  showAnswers: true,
  showAnswerKey: true,
  showTaskIds: false,
  showStudentLine: false,
  showDateLine: false,
};

const SUBJECT_HEADINGS: Record<string, string> = {
  math: "МАТЕМАТИКА",
  math_base: "МАТЕМАТИКА",
  inf: "ИНФОРМАТИКА",
  prog: "ИНФОРМАТИКА",
  rus: "РУССКИЙ ЯЗЫК",
  phys: "ФИЗИКА",
  chem: "ХИМИЯ",
  bio: "БИОЛОГИЯ",
  hist: "ИСТОРИЯ",
  history: "ИСТОРИЯ",
  soc: "ОБЩЕСТВОЗНАНИЕ",
  geo: "ГЕОГРАФИЯ",
  eng: "АНГЛИЙСКИЙ ЯЗЫК",
  lit: "ЛИТЕРАТУРА",
};

export function variantTasksToWorkbookTasks(tasks: VariantPdfTask[]): WorkbookTask[] {
  return tasks.map((task) => ({
    id: task.id,
    task_number: examTypeNumber({ number: task.number }),
    text: task.text || "",
    answer: task.answer ?? null,
    subtopic: task.subtopic_title ?? null,
    task_title: task.task_title ?? null,
    file_url: task.file || task.attachments?.[0]?.url || null,
    files: collectTaskFiles(task),
    part: task.part ?? null,
    part_title: task.part_title ?? null,
    exam_part: task.exam_part ?? null,
    max_score: task.max_score ?? null,
    author: task.author ?? null,
  }));
}

function normalizeOptions(options?: WorkbookOptions): Required<WorkbookOptions> {
  return {
    showGrading: options?.showGrading === true,
    showSolutionSpace: options?.showSolutionSpace === true,
    showAnswers: options?.showAnswers !== false,
    showAnswerKey: options?.showAnswerKey === true,
    showTaskIds: options?.showTaskIds === true,
    showStudentLine: options?.showStudentLine !== false,
    showDateLine: options?.showDateLine !== false,
  };
}

function siteOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    return window.location.origin;
  }
  return "";
}

function sheetBackgroundPayload(
  meta: WorkbookMeta
): { landscape: string; portrait: string } | undefined {
  const landscape = safeSheetUrl(absoluteUrl(String(meta.sheetBackground?.landscape || "")));
  const portrait = safeSheetUrl(absoluteUrl(String(meta.sheetBackground?.portrait || "")));
  if (!landscape && !portrait) return undefined;
  return { landscape, portrait };
}

function safeSheetUrl(value: string): string {
  const href = value.trim();
  if (!href || href.length > 2000) return "";
  if (!/^(?:https?:\/\/|\/)/i.test(href)) return "";
  if (/[\s<>"'()\\]|javascript:|data:/i.test(href)) return "";
  return href;
}

function absoluteUrl(src: string): string {
  const value = src.trim();
  if (!value) return "";
  if (/^(?:data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);|https?:\/\/)/i.test(value)) return value;
  const origin = siteOrigin();
  if (!origin) return value;
  if (value.startsWith("/")) return `${origin}${value}`;
  return `${origin}/${value.replace(/^\.\//, "")}`;
}

function subjectHeading(meta: WorkbookMeta): string {
  const code = String(meta.subject || "").toLowerCase();
  if (SUBJECT_HEADINGS[code]) return SUBJECT_HEADINGS[code];
  const parts = String(meta.subtitle || "")
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);
  const named = parts.find((part) => !/^(ЕГЭ|ОГЭ|ВПР)$/i.test(part) && !/класс|задание|углуб|базов/i.test(part));
  if (named) return named.toLocaleUpperCase("ru-RU");
  return String(meta.subject || "").toLocaleUpperCase("ru-RU");
}

function documentGrade(meta: WorkbookMeta): string {
  const fromSubtitle = String(meta.subtitle || "").match(/(\d{1,2})\s*класс/i);
  if (fromSubtitle) return fromSubtitle[1];
  const level = String(meta.level || "").toLowerCase();
  if (level === "ege") return "11";
  if (level === "oge") return "9";
  return "";
}

function documentProfile(meta: WorkbookMeta): string {
  const subject = String(meta.subject || "").toLowerCase();
  const level = String(meta.level || "").toLowerCase();
  const subtitle = String(meta.subtitle || "").toLowerCase();
  if (subject === "math_base") return "Базовый уровень";
  if (subject === "math" && level === "ege") return "Профильный уровень";
  if (level === "vpr" && subtitle.includes("углуб")) return "Углублённый уровень";
  return "";
}

function documentVariant(meta: WorkbookMeta): string {
  for (const source of [meta.sheetTitle, meta.title, meta.subtitle]) {
    const match = String(source || "").match(/вариант\s*№?\s*(\d+)/i);
    if (match) return match[1];
  }
  return "";
}

function documentDuration(meta: WorkbookMeta): number {
  const match = String(meta.examDuration || "").match(/(\d+)/);
  const minutes = match ? Number(match[1]) : 235;
  if (!Number.isFinite(minutes)) return 235;
  return Math.max(1, Math.min(600, minutes));
}

function headerLeft(meta: WorkbookMeta, mode: "exam" | "worksheet"): string {
  if (mode === "worksheet") return "";
  const level = String(meta.level || "").toLowerCase();
  if (level === "oge") return `Тренировочный вариант ОГЭ ${TEMPLATE_YEAR} г.`;
  if (level === "vpr") return `Тренировочный вариант ВПР ${TEMPLATE_YEAR} г.`;
  return "";
}

function worksheetIntro(tasks: WorkbookTask[]): string {
  const parts = [
    `В листе ${formatTasksCount(tasks.length)}.`,
    "Внимательно прочитайте условия. Запишите ответы и необходимые решения.",
  ];
  const themes: string[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const title = (task.task_title || "").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    themes.push(title);
  }
  if (themes.length === 1) parts.splice(1, 0, `Тема: ${themes[0]}.`);
  else if (themes.length > 1) parts.splice(1, 0, `Темы: ${themes.join(", ")}.`);
  return parts.join(" ");
}

function taskPart(task: WorkbookTask, level?: string, subject?: string): 1 | 2 {
  const part = inferExamTaskPart(
    {
      number: task.task_number,
      task_number: task.task_number,
      part: task.part,
      part_title: task.part_title,
      exam_part: task.exam_part,
    },
    level,
    subject
  );
  return part === 2 ? 2 : 1;
}

function orderedTasks(tasks: WorkbookTask[], meta: WorkbookMeta, exam: boolean): WorkbookTask[] {
  if (!exam) return tasks;
  return orderVariantDocumentTasks(tasks, { level: meta.level, subject: meta.subject });
}

function documentNumbers(tasks: WorkbookTask[], exam: boolean): string[] {
  const preferred = tasks.map((task, index) => {
    if (!exam) return String(index + 1);
    const examNumber = examTypeNumber(task);
    return examNumber != null ? String(examNumber) : String(index + 1);
  });
  const unique = new Set(preferred);
  if (unique.size === preferred.length && preferred.every((number) => number.length > 0 && number.length <= 8)) {
    return preferred;
  }
  return tasks.map((_, index) => String(index + 1));
}

function prepareTaskSource(raw: string, subject?: string, level?: string): string {
  if (!raw) return "";
  try {
    return prepareBankTaskDisplayHtml(raw, {
      ogeMathChoiceEnhance: subject === "math" || subject === "math_base" || !subject,
      progTaskSheet: level === "school" && subject === "prog",
    });
  } catch {
    return raw;
  }
}

function plainText(raw: string, subject?: string, level?: string): string {
  const html = prepareTaskSource(raw, subject, level);
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return (holder.textContent || "").replace(/\s+/g, " ").trim();
}

function dollarToKatex(value: string): string {
  const display = value.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => `\\[${tex}\\]`);
  return display.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_match, prefix: string, tex: string) => `${prefix}\\(${tex}\\)`);
}

function figureAlt(value: string | null | undefined): string {
  const alt = String(value || "").trim();
  if (!alt || alt === "undefined" || alt === "null") return "Рисунок к заданию";
  return alt;
}

function normalizedLabel(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function listStart(ol: Element): number {
  const start = Number(ol.getAttribute("start"));
  return Number.isInteger(start) && start >= 1 ? start : 1;
}

function isBareIndexLabel(value: string, n: number): boolean {
  const text = normalizedLabel(value);
  return text === String(n) || text === `${n}.` || text === `${n})`;
}

function hasVisibleRemainder(el: HTMLElement): boolean {
  return Boolean(normalizedLabel(el.textContent || "") || el.querySelector("img, svg, math, table"));
}

/** Печатный лист сам ставит «1.» у <ol>. Бейдж варианта и «1)» в тексте дают второй номер. */
function dedupePrintedListNumbers(root: HTMLElement): void {
  for (const ol of [...root.querySelectorAll("ol")]) {
    const items = [...ol.children].filter((el): el is HTMLElement => el.localName === "li");
    if (items.length < 2) continue;
    const start = listStart(ol);
    const choice = ol.classList.contains("oge-math-choice-options");

    for (const li of items) {
      const badges = [...li.querySelectorAll(".oge-math-choice-option__num")];
      if (!badges.length) continue;
      const rest = li.cloneNode(true) as HTMLElement;
      rest.querySelectorAll(".oge-math-choice-option__num").forEach((el) => el.remove());
      if (hasVisibleRemainder(rest)) badges.forEach((el) => el.remove());
    }

    const plainBadges = items.map((li, index) => plainIndexBadge(li, start + index));
    if (plainBadges.every(Boolean)) plainBadges.forEach((badge) => badge?.remove());

    items.forEach((li, index) => {
      if (choice) unwrapSoleFlow(li);
      stripLeadingPunctuatedIndex(li, start + index);
      if (choice) inlineDisplayMath(li);
    });
  }
}

function plainIndexBadge(li: HTMLElement, n: number): Element | null {
  const first = [...li.childNodes].find((node) => {
    if (node.nodeType === Node.TEXT_NODE) return Boolean(normalizedLabel(node.textContent || ""));
    return node.nodeType === Node.ELEMENT_NODE;
  });
  if (!first || first.nodeType !== Node.ELEMENT_NODE) return null;
  const el = first as Element;
  if (!["span", "b", "strong"].includes(el.localName)) return null;
  if (!isBareIndexLabel(el.textContent || "", n)) return null;
  const rest = li.cloneNode(true) as HTMLElement;
  const same = [...rest.childNodes].find((node) => node.nodeType === Node.ELEMENT_NODE);
  same?.remove();
  return hasVisibleRemainder(rest) ? el : null;
}

function unwrapSoleFlow(li: HTMLElement): void {
  let guard = 0;
  while (guard < 6 && li.children.length === 1) {
    const only = li.children[0];
    if (!only || !["p", "div", "span"].includes(only.localName)) break;
    if (only.querySelector("table, ul, ol")) break;
    while (only.firstChild) li.insertBefore(only.firstChild, only);
    only.remove();
    guard += 1;
  }
}

function stripLeadingPunctuatedIndex(li: HTMLElement, n: number): void {
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  const index = texts.findIndex((node) => normalizedLabel(node.data));
  if (index < 0) return;
  const node = texts[index];
  const original = node.data;
  const next = texts[index + 1];
  const nextOriginal = next?.data;
  const inline = new RegExp(`^\\s*${n}[.)]\\s+`);
  const alone = new RegExp(`^\\s*${n}[.)]\\s*$`);
  if (inline.test(original)) {
    node.data = original.replace(inline, "");
  } else if (alone.test(original)) {
    node.data = "";
    if (next && /^\s+/.test(next.data)) next.data = next.data.replace(/^\s+/, "");
  } else {
    return;
  }
  if (!hasVisibleRemainder(li)) {
    node.data = original;
    if (next && nextOriginal != null) next.data = nextOriginal;
  }
}

function inlineDisplayMath(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of nodes) {
    node.data = node.data
      .replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => `$${tex}$`)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, tex: string) => `\\(${tex}\\)`);
  }
}

function convertDollarMathIn(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of nodes) node.data = dollarToKatex(node.data);
}

function replacePre(el: Element): void {
  const text = el.textContent || "";
  const paragraph = document.createElement("p");
  text.split("\n").forEach((line, index) => {
    if (index) paragraph.appendChild(document.createElement("br"));
    paragraph.appendChild(document.createTextNode(line));
  });
  el.replaceWith(paragraph);
}

function isInformaticsTaskOne(subject: string | undefined, taskNumber: number | null | undefined): boolean {
  const code = String(subject || "").toLowerCase();
  return (code === "inf" || code === "informatics") && Number(taskNumber) === 1;
}

function sanitizeTaskHtml(
  raw: string,
  subject?: string,
  level?: string,
  taskNumber?: number | null
): { html: string; figure?: ExamTemplateFigure } {
  const prepared = prepareTaskSource(raw, subject, level);
  if (typeof document === "undefined") {
    return { html: dollarToKatex(prepared) };
  }
  const root = document.createElement("div");
  root.innerHTML = prepared;

  for (const el of [...root.querySelectorAll("pre")]) replacePre(el);

  let guard = 0;
  while (guard < 40) {
    const bad = [...root.querySelectorAll("*")].find((el) => {
      const name = el.localName.toLowerCase();
      return DROP_TAGS.has(name) || !ALLOWED_TAGS.has(name);
    });
    if (!bad) break;
    guard += 1;
    if (DROP_TAGS.has(bad.localName.toLowerCase())) bad.remove();
    else bad.replaceWith(...bad.childNodes);
  }

  let figure: ExamTemplateFigure | undefined;
  for (const img of [...root.querySelectorAll("img")]) {
    const src = absoluteUrl(img.getAttribute("src") || "");
    if (!src) {
      img.remove();
      continue;
    }
    img.setAttribute("src", src);
    img.removeAttribute("srcset");
    const parent = img.parentElement;
    const inTable = Boolean(img.closest("table"));
    const parentText = (parent?.textContent || "").replace(/\s+/g, " ").trim();
    const alt = figureAlt(img.getAttribute("alt"));
    if (img.getAttribute("alt") !== alt) img.setAttribute("alt", alt);
    const blockParent = parent && ["p", "div", "figure"].includes(parent.localName) && parent !== root;
    const onlyImage =
      blockParent &&
      !inTable &&
      parent.querySelectorAll("img, svg").length === 1 &&
      (parentText === "" || parentText === alt);
    const roadGraph =
      img.classList.contains("ege-inf-1-graph-img") || Boolean(img.closest(".ege-inf-1-graph"));
    // Задание 1: схема дорог остаётся в условии и печатается крупно, как файл в базе.
    if (isInformaticsTaskOne(subject, taskNumber) && (roadGraph || onlyImage)) {
      img.removeAttribute("width");
      img.removeAttribute("height");
      img.classList.add("illustration");
      continue;
    }
    if (onlyImage && !figure && parent) {
      const large = isOgeMathPictureTask(level, subject, taskNumber);
      figure = {
        src,
        widthMm: large ? 84 : 42,
        placement: "right",
        alt,
      };
      parent.remove();
      continue;
    }
    if (!img.getAttribute("width")) img.setAttribute("width", "320");
    img.setAttribute("alt", figureAlt(img.getAttribute("alt")));
  }

  dedupePrintedListNumbers(root);
  convertDollarMathIn(root);

  for (const el of [...root.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || /url\s*\(|javascript:|expression\s*\(/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  return { html: root.innerHTML.trim(), figure };
}

function taskMaterials(task: WorkbookTask): ExamTemplateMaterial[] {
  const seen = new Set<string>();
  const materials: ExamTemplateMaterial[] = [];
  for (const file of collectTaskFiles({ attachments: task.files, file_url: task.file_url })) {
    const href = absoluteUrl(file.url);
    if (!href || seen.has(href)) continue;
    if (!/^(?:https?:\/\/|\/)/i.test(href)) continue;
    seen.add(href);
    materials.push({ href, name: file.name });
  }
  return materials;
}

function buildTemplateTask(
  task: WorkbookTask,
  number: string,
  part: 1 | 2,
  options: Required<WorkbookOptions>,
  subject?: string,
  level?: string
): ExamTemplateTask {
  const body = sanitizeTaskHtml(task.text || "", subject, level, task.task_number);
  const html = body.html;
  const materials = taskMaterials(task);
  const answer = dollarToKatex(plainText(task.answer || "", subject, level));
  const result: ExamTemplateTask = { number, part };
  const taskId = Number(task.id);
  if (Number.isInteger(taskId) && taskId > 0) result.id = taskId;
  if (materials.length) result.materials = materials;
  if (html) result.html = html;
  else if (!body.figure) result.text = plainText(task.text || "", subject, level) || " ";
  if (body.figure) result.figure = body.figure;
  if (answer) result.answer = answer;
  if (!options.showAnswers) result.answerStyle = "none";
  return result;
}

export function buildExamTemplateDocument(tasks: WorkbookTask[], meta: WorkbookMeta): ExamTemplateDocument {
  const exam = meta.mode === "variant";
  const mode = exam ? "exam" : "worksheet";
  const sheetBackground = sheetBackgroundPayload(meta);
  const options = normalizeOptions(meta.options);
  const source = orderedTasks(Array.isArray(tasks) ? tasks : [], meta, exam);
  const numbers = documentNumbers(source, exam);
  const templateTasks = source.map((task, index) =>
    buildTemplateTask(
      task,
      numbers[index],
      exam ? taskPart(task, meta.level, meta.subject) : 1,
      options,
      meta.subject,
      meta.level
    )
  );

  return {
    mode,
    title: exam ? "Тренировочный вариант" : meta.sheetTitle?.trim() || meta.title?.trim() || "Рабочий лист",
    subject: subjectHeading(meta),
    grade: documentGrade(meta),
    year: TEMPLATE_YEAR,
    level: documentProfile(meta),
    variant: documentVariant(meta),
    duration: documentDuration(meta),
    startPage: 1,
    headerLeft: headerLeft(meta, mode),
    footer: TEMPLATE_FOOTER,
    watermark: exam ? "" : TEMPLATE_WATERMARK,
    ...(mode === "worksheet" ? { worksheetInstructions: worksheetIntro(source) } : variantCopy(meta)),
    ...(sheetBackground ? { sheetBackground } : {}),
    options: {
      layout: "spread",
      includeCover: exam,
      showWatermark: false,
      showAlternatives: false,
      showAnswerKey: options.showAnswerKey,
      showTaskIds: options.showTaskIds,
      showStudentName: options.showStudentLine,
      showStudentDate: options.showDateLine,
      solutionLines: options.showSolutionSpace ? 8 : 0,
      solutionStyle: options.showSolutionSpace ? "grid" : "lines",
    },
    tasks: templateTasks,
  };
}

function instructionLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function variantCopy(meta: WorkbookMeta): Pick<
  ExamTemplateDocument,
  "partInstructions" | "coverParagraphs" | "coverAnswerNote" | "coverToolsNote" | "showAnswerExample"
> {
  const copy = examVariantCopy(meta.level, meta.subject);
  const overrides = meta.partInstructions || {};
  const partInstructions = {
    "1": instructionLine(overrides["1"]) || copy.part1,
    "2": instructionLine(overrides["2"]) || copy.part2,
  };
  const coverParagraphs = (meta.coverParagraphs || []).map(instructionLine).filter(Boolean);
  if (coverParagraphs.length) {
    return { partInstructions, coverParagraphs };
  }
  return {
    partInstructions,
    coverAnswerNote: copy.coverAnswer,
    coverToolsNote: copy.tools,
    showAnswerExample: copy.example,
  };
}

const DOCUMENT_DATA_RE = /<script id="document-data" type="application\/json">[\s\S]*?<\/script>/;

export function injectExamTemplateData(templateHtml: string, data: ExamTemplateDocument): string {
  if (!DOCUMENT_DATA_RE.test(templateHtml)) {
    throw new Error("В шаблоне нет script#document-data");
  }
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  // Функция-замена: иначе `$&nbsp;` и `$$` в формулах становятся спецпоследовательностями replace.
  return templateHtml.replace(
    DOCUMENT_DATA_RE,
    () => `<script id="document-data" type="application/json">\n${json}\n</script>`
  );
}

const VARIANT_DOWNLOAD_STYLE = `<style id="variant-download-style">
#settings-form label.wide:has(input[name="footer"]),
#settings-form label.wide:has(input[name="watermark"]),
.controls label.field:has(#watermark),
.controls label.field:has(#alternatives){display:none!important}
.watermark{display:none!important}
.answer-heading{margin:0 0 1mm;font-size:10pt}
.answer-table{margin:0.6mm 0;font-size:8pt;line-height:1.1}
.answer-table th,.answer-table td{border:0.075mm solid #222;padding:0.165mm 1mm;line-height:1.1;vertical-align:middle}
.answer-table .katex{font-size:1em;line-height:1.1}
.answer-table .katex-display{margin:0}
</style>`;

export function buildWorkbookHtml(tasks: WorkbookTask[], meta: WorkbookMeta, templateHtml?: string): string {
  const shell =
    templateHtml ||
    `<!doctype html><html lang="ru"><head><script id="document-data" type="application/json">{}</script></head><body></body></html>`;
  const data = buildExamTemplateDocument(tasks, meta);
  const html = injectExamTemplateData(shell, data);
  if (data.mode !== "exam" || !html.includes("</head>")) return html;
  return html.replace("</head>", `${VARIANT_DOWNLOAD_STYLE}</head>`);
}

let templatePromise: Promise<string> | null = null;

function loadExamTemplate(): Promise<string> {
  if (!templatePromise) {
    templatePromise = fetch(EXAM_TEMPLATE_URL)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .catch((err) => {
        templatePromise = null;
        throw err;
      });
  }
  return templatePromise;
}

function writeDocument(win: Window, html: string): void {
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export function openWorkbook(tasks: WorkbookTask[], meta: WorkbookMeta): void {
  try {
    buildExamTemplateDocument(tasks, meta);
  } catch (err) {
    console.error("WORKBOOK_BUILD_ERR:", err);
    window.alert("Не удалось сформировать файл. Обновите страницу и попробуйте снова.");
    return;
  }

  const win = window.open("", "_blank");
  if (!win) {
    window.alert("Разрешите всплывающие окна, чтобы открыть документ.");
    return;
  }
  writeDocument(
    win,
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сборка документа</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#eceef1;color:#334155"><p style="padding:28px 24px">Сборка документа…</p></body></html>`
  );

  loadExamTemplate()
    .then((template) => {
      writeDocument(win, buildWorkbookHtml(tasks, meta, template));
    })
    .catch((err) => {
      console.error("WORKBOOK_TEMPLATE_ERR:", err);
      writeDocument(
        win,
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ошибка</title></head><body style="font-family:Arial,sans-serif;padding:28px;color:#334155">Не удалось открыть шаблон документа. Обновите страницу и попробуйте снова.</body></html>`
      );
    });
}
