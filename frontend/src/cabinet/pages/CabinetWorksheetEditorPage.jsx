import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";
import { ensureCsrfCookie, getCsrfToken } from "../../utils/cabinetAuth";
import { usePageTitle } from "../hooks/usePageTitle";
import { FormulaTextField, TaskInspector, TaskSheetFace, TaskTypePicker } from "../worksheet/TaskTypeEditors";
import { canonicalType, createTask, getTaskSpec } from "../worksheet/taskTypeRegistry";
import {
  collectContentWarnings,
  collectMetricWarnings,
  contentBox,
  fitSheet,
  paginateBlocks,
  paginateGrid,
  placeGrid,
} from "../worksheet/worksheetLayout";
import "../styles/worksheet-editor.css";

const STAGE_W = 794;
const STAGE_H = 1123;
const SNAP = 10;

const PURPOSES = [
  { id: "intro", title: "Новая тема", text: "объяснить новое и разобрать первые примеры" },
  { id: "practice", title: "Закрепить", text: "от простого примера к самостоятельному применению" },
  { id: "check", title: "Проверить", text: "быстро увидеть, что ученик понял, а что нет" },
  { id: "review", title: "Повторить", text: "собрать несколько навыков одной темы" },
  { id: "homework", title: "Домашняя работа", text: "самостоятельная практика без учителя" },
];

const STANDARD_STYLES = [
  {
    id: "whiteboard",
    api: "whiteboard",
    title: "Доска",
    prompt: "Светлый фон, тонкие формулы и небольшие акценты по краям. Центральная область чистая.",
  },
  {
    id: "textbook",
    api: "school",
    title: "Учебник",
    prompt: "Аккуратная учебная полоса, спокойные поля.",
  },
  {
    id: "exam",
    api: "strict",
    title: "Бланк",
    prompt: "Строгий экзаменационный бланк без декора.",
    toner: true,
  },
  {
    id: "minimal",
    api: "minimal",
    title: "Минимум",
    prompt: "Почти пустой лист, только тонкая рамка.",
  },
];
const WORKSHEET_HELP_STEPS = [
  "Укажите предмет, класс, тему и тип листа.",
  "Решите, собирать задания заново или оставить те, что уже на листе.",
  "Выберите готовый стиль или опишите своё оформление.",
  "Нажмите «Создать рабочий лист». Правки сами записываются в один черновик.",
  "Поправьте блоки, проверьте вид для ученика и учителя и скачайте PDF.",
];

const WORKSHEET_HELP_TOPICS = [
  {
    title: "Задания с нуля",
    text: "Лист собирается по теме, числу заданий и времени. За сборку списываются AI-токены. Если указать номер варианта, в лист попадут задания этого варианта без изменений.",
  },
  {
    title: "Оставить задания",
    text: "Тексты заданий не меняются. Можно обновить только фон или добавить теорию в начало листа.",
  },
  {
    title: "Оформление",
    text: "Доска, учебник, бланк и минимум применяются сразу и не рисуют фон через AI. Своё описание задаёт картинку: рисунок по краям, середина листа остаётся светлой, чтобы задания читались.",
  },
  {
    title: "Правка листа",
    text: "Добавьте заголовок, текст, справку, факт или задание. Двойной щелчок меняет текст. Над листом переключаются ориентация, колонки, отступы и сетка.",
  },
  {
    title: "Режимы",
    text: "«Предпросмотр» и «Печать» показывают лист. «Интерактив» — как ученик будет решать. «Мои работы» открывает сохранённые листы.",
  },
  {
    title: "Черновик и копии",
    text: "Черновик один: новые правки обновляют его, а не создают копию. «Дублировать» делает отдельный сохранённый лист.",
  },
];

function WorksheetHelpDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ws-help-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ws-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ws-help__head">
          <h2 id="ws-help-title">Как собрать материал</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть">Закрыть</button>
        </header>
        <ol className="ws-help__steps">
          {WORKSHEET_HELP_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <ul className="ws-help__topics">
          {WORKSHEET_HELP_TOPICS.map((item) => (
            <li key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

const STOCK_PROMPTS = new Set([
  ...STANDARD_STYLES.map((item) => item.prompt),
  "Спокойное оформление листа, без лишнего декора.",
]);

function styleForApi(style) {
  return STANDARD_STYLES.find((item) => item.id === style)?.api || "school";
}

const THEME_PALETTES = [
  { keys: ["хогварт", "гарри", "волшеб", "маги", "сказк"], accent: "#6b4a1b", paper: "#f6efe2", ink: "#2a2118", frame: "#c4a574" },
  { keys: ["космос", "звезд", "планет", "галактик"], accent: "#24538f", paper: "#f3f6fb", ink: "#1b2740", frame: "#8eadd4" },
  { keys: ["осень", "листв"], accent: "#b8612a", paper: "#fbf6ef", ink: "#3a2a22", frame: "#e2b48a" },
  { keys: ["мор", "океан", "вод"], accent: "#1f6f8b", paper: "#f3f8f8", ink: "#16343c", frame: "#8ec4c8" },
  { keys: ["спорт", "мяч", "игр"], accent: "#2e7c5d", paper: "#f6faf7", ink: "#1d3328", frame: "#9dccb0" },
];

function teacherWishes(form) {
  return [form.vision, form.extra]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n");
}

function designPromptOf(form) {
  const prompt = String(form.themePrompt || "").trim();
  const extra = String(form.extra || "").trim();
  if (!extra || prompt.includes(extra)) return prompt;
  return prompt ? `${prompt}\n${extra}` : extra;
}

function wantsAiDesign(form) {
  const extra = String(form.extra || "").trim();
  if (extra) return true;
  const prompt = String(form.themePrompt || "").trim();
  return Boolean(prompt) && !STOCK_PROMPTS.has(prompt);
}

function themeCaption(form) {
  const text = designPromptOf(form)
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item && !STOCK_PROMPTS.has(item) && !item.startsWith("Строгий бланк"))
    .join(" · ");
  if (!text) return "";
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function themeLook(form) {
  const text = designPromptOf(form).toLowerCase().replaceAll("ё", "е");
  if (!text || !wantsAiDesign(form)) return null;
  const palette = THEME_PALETTES.find((item) => item.keys.some((key) => text.includes(key)));
  if (palette) return palette;
  const hue = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return {
    accent: `hsl(${hue} 72% 38%)`,
    paper: `hsl(${hue} 78% 96%)`,
    ink: `hsl(${hue} 40% 16%)`,
    frame: `hsl(${hue} 78% 46%)`,
  };
}

const TASK_TYPES = [
  { id: "short", label: "Короткий ответ" },
  { id: "lines", label: "Решение" },
  { id: "choice", label: "Выбор ответа" },
  { id: "match", label: "Соответствие" },
  { id: "gap", label: "Пропуски" },
  { id: "error", label: "Найди ошибку" },
  { id: "table", label: "Таблица" },
  { id: "graph", label: "График" },
];

const TASK_BANK = {
  Математика: [
    { q: "Вычислите: \\(\\log_2 32\\).", type: "short", answer: "5", solution: "\\(2^5=32\\)." },
    { q: "Вычислите: \\(\\log_3 \\frac{1}{27}\\).", type: "short", answer: "−3" },
    { q: "Найдите значение: \\(\\log_5 25+\\log_2 8\\).", type: "lines", answer: "5" },
    { q: "Вычислите: \\(\\log_2 48-\\log_2 3\\).", type: "lines", answer: "4" },
    { q: "Какое равенство верно?", type: "choice", options: ["А. \\(\\log_a(x+y)=\\log_a x+\\log_a y\\)", "Б. \\(\\log_a(xy)=\\log_a x+\\log_a y\\)", "В. \\(\\log_a x^2=\\log_a x+2\\)", "Г. \\(\\log_a 1=1\\)"], answer: "Б" },
    { q: "Вычислите: \\(2\\log_3 9-\\log_3 27\\).", type: "lines", answer: "1" },
    { q: "Найдите \\(x\\), если \\(\\log_2 x=6\\).", type: "lines", answer: "64" },
  ],
  Информатика: [
    { q: "Переведите \\(101101_2\\) в десятичную систему.", type: "short", answer: "45" },
    { q: "Сколько единиц в двоичной записи числа 45?", type: "short", answer: "4" },
    { q: "Упростите: \\((A \\land B) \\lor \\lnot A\\).", type: "lines", answer: "\\(\\lnot A \\lor B\\)" },
    { q: "Значение \\(2**5 + 3*4\\) в Python.", type: "short", answer: "44" },
    { q: "Какой ответ верный?", type: "choice", options: ["А. Байт = 4 бита", "Б. 1 Кбайт = 1024 байта", "В. 1 Мбайт = 1000 Кбайт", "Г. Бит больше байта"], answer: "Б" },
  ],
};

const GROUPS = [
  { id: "warm", title: "Начинаем с простого", structure: "Разогрев", detail: "простые вычисления", skill: "прямое вычисление" },
  { id: "apply", title: "Применяем свойства", structure: "Основная практика", detail: "применение свойств", skill: "применение правила" },
  { id: "check", title: "Проверяем понимание", structure: "Проверка понимания", detail: "поиск ошибки", skill: "поиск ошибки" },
  { id: "final", title: "Итоговое задание", structure: "Итог", detail: "повышенный уровень", skill: "самостоятельное применение" },
];

function snap(value) {
  return Math.round(value / SNAP) * SNAP;
}

function newId() {
  return `b${Date.now().toString(36)}${Math.random().toString(16).slice(2, 7)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[ch]));
}

function purposeById(id) {
  return PURPOSES.find((item) => item.id === id) || PURPOSES[0];
}

function minutesFor(count) {
  return Math.max(10, Math.round(Number(count || 7) * 3.5));
}

function splitCounts(count) {
  const n = Math.max(3, Math.min(12, Number(count) || 7));
  const warm = Math.max(1, Math.round(n * 0.28));
  const final = 1;
  const check = 1;
  const apply = Math.max(1, n - warm - check - final);
  const used = warm + apply + check + final;
  return { warm, apply: apply + (n - used), check, final, total: n };
}

function tokenWord(count) {
  const value = Math.abs(Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "токен";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "токена";
  return "токенов";
}

function withTheoryText(blocks, text) {
  const theory = String(text || "").trim();
  const list = Array.isArray(blocks) ? blocks.map((block) => ({ ...block })) : [];
  const heading = { id: newId(), type: "heading", text: "Теория", align: "left", fullWidth: true, placed: false };
  const body = { id: newId(), type: "text", text: theory, align: "left", fullWidth: true, placed: false };
  if (list[0]?.type === "heading" && String(list[0].text || "").trim() === "Теория" && list[1]?.type === "text") {
    return [
      { ...list[0], fullWidth: true },
      { ...list[1], text: theory, fullWidth: true },
      ...list.slice(2),
    ];
  }
  return [heading, body, ...list];
}

function wantsTheoryOf(form) {
  if (form.theoryTouched) return Boolean(form.theory);
  return form.purpose === "intro";
}

function theoryDetailOf(form) {
  return form.theoryDetail === "detailed" ? "detailed" : "brief";
}

function theoryCaption(detail) {
  return detail === "detailed"
    ? "подробное объяснение в начале листа"
    : "короткий текст в начале листа";
}

function TheoryDetailPicker({ value, onChange }) {
  const detail = value === "detailed" ? "detailed" : "brief";
  return (
    <div className="ws-theory-detail" role="radiogroup" aria-label="Объём теории">
      <button type="button" role="radio" aria-checked={detail === "brief"} className={detail === "brief" ? "is-on" : ""} onClick={() => onChange("brief")}>Краткая</button>
      <button type="button" role="radio" aria-checked={detail === "detailed"} className={detail === "detailed" ? "is-on" : ""} onClick={() => onChange("detailed")}>Подробная</button>
    </div>
  );
}

function levelFor(groupId) {
  if (groupId === "warm") return "база";
  if (groupId === "final") return "повышенный";
  return "стандарт";
}

const INSERTS = [
  { id: "heading", label: "Заголовок" },
  { id: "text", label: "Текст" },
  { id: "short", label: "Короткий ответ" },
  { id: "lines", label: "Решение" },
  { id: "choice", label: "Выбор ответа" },
  { id: "table", label: "Таблица" },
  { id: "graph", label: "График" },
];

function previewBlocks(form) {
  const tasks = buildPreviewTasks(form);
  const items = [];
  let lastGroup = "";
  tasks.forEach((task, index) => {
    if (task.groupId !== lastGroup) {
      items.push({
        id: `heading-${task.groupId}`,
        type: "heading",
        text: task.groupTitle,
        groupId: task.groupId,
      });
      lastGroup = task.groupId;
    }
    items.push({
      ...task,
      type: "task",
      x: 48,
      y: 280 + index * 120,
      w: 690,
      h: task.task.type === "choice" ? 140 : 110,
      locked: false,
      padding: 8,
      z: index + 5,
    });
  });
  return items;
}

function buildPreviewTasks(form) {
  const parts = splitCounts(form.count);
  const bank = TASK_BANK[form.subject] || TASK_BANK["Математика"];
  const sequence = [
    ...Array.from({ length: parts.warm }, () => "warm"),
    ...Array.from({ length: parts.apply }, () => "apply"),
    ...Array.from({ length: parts.check }, () => "check"),
    ...Array.from({ length: parts.final }, () => "final"),
  ].slice(0, parts.total);
  const manual = form.autoTypes ? null : form.types;
  return sequence.map((groupId, index) => {
    const base = JSON.parse(JSON.stringify(bank[index % bank.length]));
    const group = GROUPS.find((item) => item.id === groupId);
    const type = manual?.length ? manual[index % manual.length] : (groupId === "check" ? "choice" : base.type);
    return {
      id: `preview-${index}`,
      number: index + 1,
      groupId,
      groupTitle: group.title,
      structure: group.structure,
      skill: group.skill,
      level: levelFor(groupId),
      points: groupId === "final" ? 2 : 1,
      task: { ...base, type, q: base.q },
    };
  });
}

function MathHtml({ html, className, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    node.innerHTML = html || "";
    const mj = window.MathJax;
    if (!mj?.typesetPromise) return undefined;
    let dead = false;
    const run = () => {
      if (dead) return;
      mj.typesetPromise([node]).catch(() => {});
    };
    const startup = mj.startup?.promise;
    if (startup?.then) startup.then(run).catch(run);
    else run();
    return () => { dead = true; };
  }, [html]);
  return <div ref={ref} className={className} onClick={onClick} />;
}

function Editable({ html, className, onCommit, plain = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || document.activeElement === node) return;
    if (node.innerHTML !== html) node.innerHTML = html || "";
  }, [html]);
  return (
    <div
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={(event) => {
        if (event.currentTarget.querySelector("mjx-container, .MathJax")) {
          event.currentTarget.innerHTML = html || "";
        }
      }}
      onBlur={(event) => {
        const node = event.currentTarget;
        if (node.querySelector("mjx-container, .MathJax")) return;
        onCommit(plain ? node.innerText : node.innerHTML);
      }}
    />
  );
}

function WorkArea({ area }) {
  if (!area || area.kind === "none") return null;
  const lines = Number(area.lines) || 3;
  if (area.kind === "grid") return <div className="ws-gridpaper" style={{ minHeight: lines * 28 }} />;
  if (area.kind === "blank") return <div className="ws-blank-space" style={{ minHeight: lines * 28 }} />;
  return <div className="ws-ruled ws-work" style={{ minHeight: lines * 28 }} />;
}

const BLOCK_MARK = {
  short_answer: "А",
  solution: "≡",
  single_choice: "○",
  matching: "↔",
  fill_blank: "␣",
  find_error: "!",
  table: "▦",
  function_graph: "∿",
  coordinate_plane: "+",
  expression: "√",
  sorting: "↕",
  classification: "▣",
  text_questions: "¶",
  image_question: "▢",
  plane: "△",
  solid: "◇",
  heading: "H",
  text: "T",
  reference: "i",
  fact: "★",
};

const NOTE_BLOCKS = {
  heading: { title: "Заголовок", label: "Заголовок", rows: 2, placeholder: "Введите заголовок" },
  text: { title: "Текст", label: "Текст", rows: 4, placeholder: "Введите текст" },
  reference: { title: "Справочная информация", label: "Текст", rows: 4, placeholder: "Формулы и сведения для ученика", kicker: "Справочная информация" },
  fact: { title: "Интересный факт", label: "Текст", rows: 3, placeholder: "Короткий факт по теме", kicker: "Интересный факт" },
};

const NOTE_DEFAULTS = {
  reference: "Объём куба V = a³, параллелепипеда V = abc, цилиндра V = πr²h, конуса V = ⅓πr²h, шара V = ⁴⁄₃πr³.",
  fact: "Пчелиные соты близки к правильным шестиугольным призмам: так на тот же объём уходит меньше воска.",
};

function pointsWord(value) {
  const count = Math.abs(Number(value) || 0);
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 > 10 && mod100 < 20) return `${count} баллов`;
  if (mod10 === 1) return `${count} балл`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} балла`;
  return `${count} баллов`;
}

function BlockMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="ws-block-menu" ref={ref}>
      <button type="button" aria-label="Действия с блоком" aria-expanded={open} onClick={() => setOpen((value) => !value)}>⋯</button>
      {open ? (
        <div className="ws-float__menu" role="menu">
          {items.map((item) => (
            <button key={item.label} type="button" className={item.danger ? "is-danger" : ""} role="menuitem" onClick={() => { setOpen(false); item.onClick(); }}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AlignIcons({ value, onChange }) {
  const align = value || "left";
  return (
    <div className="ws-align" role="group" aria-label="Выравнивание">
      {[
        ["left", "Слева", "M4 6h16M4 12h10M4 18h16"],
        ["center", "По центру", "M4 6h16M7 12h10M4 18h16"],
        ["right", "Справа", "M4 6h16M10 12h10M4 18h16"],
      ].map(([id, label, path]) => (
        <button key={id} type="button" className={align === id ? "is-on" : ""} aria-label={label} aria-pressed={align === id} onClick={() => onChange(id)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      ))}
    </div>
  );
}

function InspectorTask({ block, subject, onChange, onLevel, onSkill, onPoints, onType, onFlags, onWork, onDuplicate, onEasier, onHarder, onUp, onDown, onDelete, focus, onFocus }) {
  const spec = getTaskSpec(block.task?.type);
  const level = ["база", "стандарт", "повышенный"].includes(block.level) ? block.level : "стандарт";
  const mark = BLOCK_MARK[canonicalType(block.task?.type)] || "•";
  return (
    <section className="ws-inspector">
      <header className="ws-block-head">
        <span className="ws-block-head__mark" aria-hidden="true">{mark}</span>
        <h2>{spec.label}</h2>
        <BlockMenu items={[
          { label: "Дублировать", onClick: onDuplicate },
          { label: "Заменить на более простое", onClick: onEasier },
          { label: "Заменить на более сложное", onClick: onHarder },
          { label: "Переместить выше", onClick: onUp },
          { label: "Переместить ниже", onClick: onDown },
          { label: "Удалить", onClick: onDelete, danger: true },
        ]} />
      </header>
      <TaskInspector task={block.task} onChange={onChange} focus={focus} onFocus={onFocus} />
      <p className="ws-section-label">Параметры</p>
      <label className="ws-field"><span className="ws-label">Тип задания</span><TaskTypePicker type={block.task?.type || "short_answer"} subject={subject} onChange={onType} /></label>
      <label className="ws-field">
        <span className="ws-label">Уровень</span>
        <select value={level} onChange={(event) => onLevel(event.target.value)}>
          <option value="база">База</option>
          <option value="стандарт">Стандарт</option>
          <option value="повышенный">Повышенный</option>
        </select>
      </label>
      <label className="ws-field"><span className="ws-label">Навык</span><input value={block.skill || ""} placeholder="только для учителя" onChange={(event) => onSkill(event.target.value)} /></label>
      <label className="ws-field"><span className="ws-label">Баллы</span><input type="number" min="1" value={block.points || 1} onChange={(event) => onPoints(Number(event.target.value))} /></label>
      <p className="ws-section-label">Показывать на листе</p>
      <div className="ws-type-choice">
        <label><input type="checkbox" checked={!!block.showLevel} onChange={(event) => onFlags({ showLevel: event.target.checked })} /> Уровень</label>
        <label><input type="checkbox" checked={!!block.showPoints} onChange={(event) => onFlags({ showPoints: event.target.checked })} /> Баллы</label>
      </div>
      <p className="ws-section-label">Место для решения</p>
      <label className="ws-field">
        <select
          aria-label="Место для решения"
          value={block.workArea?.kind === "lines" ? `lines-${block.workArea.lines}` : (block.workArea?.kind || "none")}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "none") onWork({ kind: "none" });
            else if (value.startsWith("lines-")) onWork({ kind: "lines", lines: Number(value.slice(6)) });
            else onWork({ kind: value, lines: value === "blank" ? 4 : 6 });
          }}
        >
          <option value="none">Нет</option>
          <option value="lines-1">1 строка</option>
          <option value="lines-2">2 строки</option>
          <option value="lines-3">3 строки</option>
          <option value="grid">Клетчатое поле</option>
          <option value="blank">Пустое поле</option>
        </select>
      </label>
    </section>
  );
}

function InspectorSection({ block, onChange, onUp, onDown, onDelete }) {
  const spec = NOTE_BLOCKS[block.type] || NOTE_BLOCKS.text;
  return (
    <section className="ws-inspector">
      <header className="ws-block-head">
        <span className="ws-block-head__mark" aria-hidden="true">{BLOCK_MARK[block.type] || "T"}</span>
        <h2>{spec.title}</h2>
        <BlockMenu items={[
          { label: "Переместить выше", onClick: onUp },
          { label: "Переместить ниже", onClick: onDown },
          { label: "Удалить", onClick: onDelete, danger: true },
        ]} />
      </header>
      <label className="ws-field">
        <span className="ws-label">{spec.label}</span>
        <FormulaTextField
          value={block.text || ""}
          rows={spec.rows}
          placeholder={spec.placeholder}
          ariaLabel={spec.label}
          onChange={(text) => onChange({ text })}
        />
      </label>
      <label className="ws-field"><span className="ws-label">Описание</span><textarea value={block.note || ""} placeholder="необязательно" onChange={(event) => onChange({ note: event.target.value })} /></label>
      <p className="ws-section-label">Выравнивание</p>
      <AlignIcons value={block.align} onChange={(align) => onChange({ align })} />
    </section>
  );
}

function Accordion({ title, hint, open, onToggle, children }) {
  return (
    <div className={`ws-acc${open ? " is-open" : ""}`}>
      <button type="button" className="ws-acc__btn" aria-expanded={open} onClick={onToggle}>
        <span className="ws-acc__copy">
          <strong>{title}</strong>
          <span>{hint}</span>
        </span>
        <svg className="ws-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      {open ? <div className="ws-acc__body">{children}</div> : null}
    </div>
  );
}

function formatWorkTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function CabinetWorksheetEditorPage() {
  usePageTitle("Конструктор материалов");
  const stageRef = useRef(null);
  const centerRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const dragRef = useRef(null);
  const [blocks, setBlocks] = useState([]);
  const [assembled, setAssembled] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [sheetFocus, setSheetFocus] = useState(null);
  const [zoomPreset, setZoomPreset] = useState("fit-width");
  const [fitWidth, setFitWidth] = useState(0.72);
  const [fitPage, setFitPage] = useState(0.55);
  const [view, setView] = useState("student");
  const [mode, setMode] = useState("editor");
  const editMode = mode === "editor";
  const [orientation, setOrientation] = useState("portrait");
  const [marginMm, setMarginMm] = useState(12);
  const [blockHeights, setBlockHeights] = useState({});
  const [headerHeight, setHeaderHeight] = useState(180);
  const [exportGate, setExportGate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [textEditId, setTextEditId] = useState("");
  const [floatMenu, setFloatMenu] = useState("");
  const [gridOn, setGridOn] = useState(false);
  const pagesRef = useRef(null);
  const scaleRef = useRef(1);
  const contentWidthRef = useRef(680);
  const clipboardRef = useRef(null);
  const [bgData, setBgData] = useState(null);
  const [toast, setToast] = useState("");
  const [mobilePane, setMobilePane] = useState("gen");
  const [openSection, setOpenSection] = useState("");
  const [form, setForm] = useState({
    subject: "Математика",
    grade: "10",
    topic: "Логарифмы: вычисления и свойства",
    goal: "Вычислять логарифмы и применять основные свойства в несложных выражениях.",
    purpose: "practice",
    count: 7,
    minutes: 25,
    difficulty: "От простого к сложному",
    autoTypes: true,
    types: ["short", "lines", "error"],
    sourceText: "",
    textbook: "",
    ownTasks: "",
    fipi: "",
    extra: "",
    vision: "",
    style: "whiteboard",
    themePrompt: "Ярко и необычно: насыщенные цвета, крупный характерный шрифт заголовка, цветные плашки и иллюстрации по краям листа. Середина светлая, чтобы задания читались.",
    mono: false,
    toner: false,
    density: "обычная",
    answers: true,
    solutions: true,
    criteria: true,
    variants: 1,
    studentCopy: true,
    teacherCopy: true,
    studentLine: true,
    designOnly: false,
    theoryDetail: "brief",
  });
  const formRef = useRef(form);
  const assembledRef = useRef(assembled);
  const blocksRef = useRef(blocks);
  formRef.current = form;
  assembledRef.current = assembled;
  useEffect(() => {
    const art = typeof form.background === "string" ? form.background : "";
    setBgData(art.startsWith("data:image/") ? art : null);
  }, [form.background]);
  if (dragRef.current?.mode !== "reorder" && dragRef.current?.mode !== "resize") blocksRef.current = blocks;
  const [dragOverId, setDragOverId] = useState("");

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1700);
  }, []);

  const commit = useCallback((next) => {
    setBlocks(next);
    const snapshot = JSON.stringify(next);
    const historyList = historyRef.current;
    const index = historyIndexRef.current;
    if (historyList[index] === snapshot) return;
    const trimmed = historyList.slice(0, index + 1);
    trimmed.push(snapshot);
    historyRef.current = trimmed.slice(-80);
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

  const sourceBlocks = useCallback(
    () => (assembled ? blocks : previewBlocks(form)),
    [assembled, blocks, form],
  );

  const patchBlock = useCallback((id, patch) => {
    const list = sourceBlocks();
    setAssembled(true);
    commit(list.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }, [commit, sourceBlocks]);

  useEffect(() => {
    const node = centerRef.current;
    if (!node) return undefined;
    const apply = () => {
      const box = contentBox("a4", orientation, marginMm);
      const availW = Math.max(160, node.clientWidth - 32);
      const availH = Math.max(160, node.clientHeight - 32);
      setFitWidth(Math.min(1, availW / box.page.width));
      setFitPage(Math.min(1, availW / box.page.width, availH / box.page.height));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [orientation, marginMm, mobilePane, mode]);

  useEffect(() => {
    const stage = stageRef.current;
    const mj = window.MathJax;
    if (!stage || !mj?.typesetPromise) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      mj.typesetPromise([stage]).catch(() => {});
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [blocks, form, view, assembled, bgData]);

  const sheetBlocks = assembled ? blocks : previewBlocks(form);
  const previewTasks = useMemo(
    () => sheetBlocks.filter((block) => block.type === "task"),
    [sheetBlocks],
  );

  const selected = previewTasks.find((block) => block.id === selectedId) || null;
  const purpose = purposeById(form.purpose);
  const minutes = form.minutes || minutesFor(form.count);
  const wantsTheory = wantsTheoryOf(form);

  const setField = (key) => (event) => {
    const value = event.target.type === "number" ? Number(event.target.value) : event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };
  const applyStandardStyle = (item) => {
    setForm((current) => ({
      ...current,
      style: item.id,
      themePrompt: item.prompt,
      background: "",
      mono: Boolean(item.mono),
      toner: Boolean(item.toner),
      keepBackground: false,
    }));
  };

  const [documentId, setDocumentId] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("document") || "";
    if (fromUrl && fromUrl !== "null") return fromUrl;
    try {
      const saved = JSON.parse(localStorage.getItem("itflux.worksheet.draft.v1") || "null");
      return saved?.documentId || "";
    } catch {
      return "";
    }
  });
  const [works, setWorks] = useState([]);
  const [worksState, setWorksState] = useState("idle");
  const [openingId, setOpeningId] = useState("");
  const [workActionId, setWorkActionId] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [libraryTick, setLibraryTick] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const savingRef = useRef(false);
  const pendingDraftRef = useRef(null);
  const lostDocumentRef = useRef(false);
  const documentIdRef = useRef(documentId);
  useEffect(() => {
    documentIdRef.current = documentId;
  }, [documentId]);
  const skipInitialLoad = useRef(false);
  const [aiSubjects, setAiSubjects] = useState(null);
  const [aiBalance, setAiBalance] = useState(null);
  const [designCost, setDesignCost] = useState(5);
  const [theoryCost, setTheoryCost] = useState(2);
  const [showWatermark, setShowWatermark] = useState(true);
  const [aiQuote, setAiQuote] = useState(null);
  const [aiQuoteMessage, setAiQuoteMessage] = useState("");
  const [aiQuoteStatus, setAiQuoteStatus] = useState("loading");
  const [aiBusy, setAiBusy] = useState(false);
  const [quoteNonce, setQuoteNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureCsrfCookie();
        const response = await fetch("/api/cabinet/ai/worksheets/options/", { credentials: "same-origin" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        setAiSubjects(data.subjects || []);
        if (typeof data.balance === "number") setAiBalance(data.balance);
        const design = (data.costs || []).find((item) => item.key === "ai_design");
        if (design && typeof design.amount === "number") setDesignCost(design.amount);
        const theory = (data.costs || []).find((item) => item.key === "theory_block");
        if (theory && typeof theory.amount === "number") setTheoryCost(theory.amount);
        setShowWatermark(data.watermark !== false);
      } catch {
        if (!cancelled) setAiSubjects([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (form.designOnly) {
      setAiQuote(null);
      setAiQuoteMessage("");
      setAiQuoteStatus("idle");
      return undefined;
    }
    if (!aiSubjects) return undefined;
    const subject = aiSubjects.find((item) => item.name === form.subject)
      || aiSubjects.find((item) => (item.name || "").toLowerCase().includes(String(form.subject || "").toLowerCase()));
    if (!subject || String(form.topic || "").trim().length < 2) {
      setAiQuote(null);
      setAiQuoteMessage("");
      setAiQuoteStatus("idle");
      return undefined;
    }
    const variantId = String(form.variantNumber || "").replace(/\D/g, "");
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAiQuoteStatus("loading");
      try {
        await ensureCsrfCookie();
        const headers = { Accept: "application/json", "Content-Type": "application/json" };
        const csrf = getCsrfToken();
        if (csrf) headers["X-CSRFToken"] = csrf;
        const response = await fetch("/api/cabinet/ai/worksheets/quote/", {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify({
            subject_id: subject.id,
            grade: Number(form.grade) || "",
            topic: String(form.topic).trim(),
            task_count: Math.min(30, Math.max(1, Number(form.count) || 7)),
            difficulty: form.difficulty === "Равномерная" ? "standard" : "mixed",
            goal: form.purpose === "homework" ? "practice" : (form.purpose || "practice"),
            format: form.purpose === "homework" ? "homework" : form.purpose === "check" ? "quiz" : form.purpose === "intro" ? "lesson" : "training",
            wording: "original",
            wants_theory: wantsTheoryOf(form),
            theory_detail: theoryDetailOf(form),
            keep_background: Boolean(form.keepBackground),
            ai_design: wantsAiDesign(form),
            style: styleForApi(form.style),
            custom_style: designPromptOf(form),
            wishes: teacherWishes(form),
            ...(variantId ? { variant_id: Number(variantId) } : {}),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setAiQuote(null);
          setAiQuoteMessage(data.message || "Не удалось посчитать стоимость");
          setAiQuoteStatus("error");
          return;
        }
        setAiQuoteMessage("");
        setAiQuote(data);
        setAiQuoteStatus("ready");
        if (typeof data.balance === "number") setAiBalance(data.balance);
      } catch {
        if (!cancelled) {
          setAiQuote(null);
          setAiQuoteStatus("error");
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiSubjects, form.designOnly, form.subject, form.grade, form.topic, form.count, form.difficulty, form.purpose, form.theory, form.theoryTouched, form.theoryDetail, form.keepBackground, form.themePrompt, form.extra, form.vision, form.variantNumber, quoteNonce]);

  const createWithAi = async () => {
    if (!aiQuote?.can_generate || aiBusy) return;
    setAiBusy(true);
    try {
      await ensureCsrfCookie();
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRFToken"] = csrf;
      const response = await fetch("/api/cabinet/ai/worksheets/generate/", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ generation_quote_id: aiQuote.generation_quote_id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.worksheet_id) {
        if (data.code !== "GENERATION_IN_PROGRESS") setQuoteNonce((value) => value + 1);
        throw new Error(data.message || data.warnings?.[0] || "Не удалось создать лист.");
      }
      const documentResponse = await fetch(`/api/cabinet/ai/worksheets/documents/${data.worksheet_id}/`, {
        credentials: "same-origin",
      });
      const document = await documentResponse.json().catch(() => ({}));
      if (!documentResponse.ok) throw new Error("Лист создан, но не открылся.");
      if (data.worksheet_id) setDocumentId(data.worksheet_id);
      if (Array.isArray(document.blocks)) {
        setAssembled(true);
        setSelectedId(null);
        setMobilePane("sheet");
        setView("student");
        commit(document.blocks.map((block) => ({ ...block, placed: false })));
      }
      if (document.form && typeof document.form === "object") {
        setForm((current) => ({
          ...current,
          ...document.form,
          keepBackground: current.keepBackground,
          background: current.keepBackground ? (current.background || "") : (document.form.background || ""),
        }));
      }
      window.dispatchEvent(new Event("itflux:ai-tokens"));
      showToast(`Рабочий лист создан. Списано ${data.charged} AI-токенов.`);
      setQuoteNonce((value) => value + 1);
    } catch (error) {
      showToast(error.message || "Не удалось создать лист.");
    } finally {
      setAiBusy(false);
    }
  };

  const requestAi = async (path, body) => {
    await ensureCsrfCookie();
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    };
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRFToken"] = csrf;
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (typeof data.balance === "number") setAiBalance(data.balance);
    return { response, data };
  };

  const applyKeptTasks = async () => {
    const updateBackground = !form.keepBackground;
    const addTheory = wantsTheoryOf(form);
    if (aiBusy || (!updateBackground && !addTheory)) return;
    setAiBusy(true);
    let charged = 0;
    let backgroundDone = false;
    try {
      if (updateBackground && wantsAiDesign(form)) {
        const prompt = designPromptOf(form).trim();
        if (prompt.length < 3) throw new Error("Опишите оформление.");
        const { response, data } = await requestAi("/api/cabinet/ai/worksheets/background/", { prompt });
        if (!response.ok || !data.background) throw new Error(data.message || "Не удалось обновить оформление.");
        setForm((current) => ({ ...current, background: data.background, designOnly: true }));
        charged += Number(data.charged) || 0;
        backgroundDone = true;
      }
      if (addTheory) {
        const topic = String(form.topic || "").trim();
        if (topic.length < 2) throw new Error("Укажите тему.");
        const { response, data } = await requestAi("/api/cabinet/ai/worksheets/theory/", {
          subject: form.subject,
          grade: Number(form.grade) || "",
          topic,
          wishes: teacherWishes(form),
          theory_detail: theoryDetailOf(form),
        });
        if (!response.ok || !String(data.text || "").trim()) {
          throw new Error(backgroundDone
            ? "Фон обновлён. Теорию добавить не удалось."
            : (data.message || "Не удалось добавить теорию."));
        }
        setAssembled(true);
        commit(withTheoryText(sourceBlocks(), data.text));
        charged += Number(data.charged) || 0;
      }
      window.dispatchEvent(new Event("itflux:ai-tokens"));
      const done = [
        updateBackground && wantsAiDesign(form) ? "Фон обновлён" : "",
        updateBackground && !wantsAiDesign(form) ? "Стандартный стиль на листе" : "",
        addTheory ? "теория добавлена" : "",
      ].filter(Boolean).join(", ");
      showToast(charged
        ? `${done}. Задания без изменений. Списано ${charged} токенов.`
        : `${done}. Задания без изменений.`);
    } catch (error) {
      showToast(error.message || "Не удалось обновить лист.");
    } finally {
      setAiBusy(false);
    }
  };

  const keepBackground = Boolean(form.designOnly && form.keepBackground);
  const addTheory = Boolean(form.designOnly && wantsTheory);
  const aiBackground = !keepBackground && wantsAiDesign(form);
  const keptSpend = (aiBackground ? designCost : 0) + (addTheory ? theoryCost : 0);
  const theoryReady = String(form.topic || "").trim().length >= 2;
  const designPromptReady = designPromptOf(form).trim().length >= 3;
  const keptShort = aiBalance != null && aiBalance < keptSpend ? keptSpend - aiBalance : 0;
  const keptBlocked = form.designOnly && (
    (aiBackground && !designPromptReady)
    || (addTheory && !theoryReady)
    || (keepBackground && !addTheory)
    || keptShort > 0
  );
  const tokenLine = form.designOnly
    ? (aiBusy
      ? (addTheory && !keepBackground ? "Обновляем лист…" : addTheory ? "Пишем теорию…" : aiBackground ? "Рисуем фон…" : "Обновляем стиль…")
      : keepBackground && !addTheory
        ? "Фон останется"
        : aiBackground && !designPromptReady
          ? "Опишите оформление"
        : !aiBackground && !addTheory
          ? "Стиль без AI"
          : addTheory && !theoryReady
            ? "Укажите тему"
            : keptShort
              ? `Не хватает ${keptShort} токенов`
              : `${keptSpend} ${tokenWord(keptSpend)}`)
    : aiBusy
    ? "Создаём лист…"
    : aiQuoteStatus === "error"
      ? "Не удалось посчитать стоимость"
      : aiQuote && !aiQuote.can_generate
        ? `Не хватает ${aiQuote.shortage} токенов`
        : aiQuote
          ? `${aiQuote.estimated_cost} токенов`
          : "Считаем стоимость…";

  const setTaskType = (id, nextType) => {
    const current = sourceBlocks().find((block) => block.id === id);
    if (!current) return;
    const created = createTask(nextType);
    const question = current.task?.question || current.task?.q || created.question;
    patchBlock(id, { task: { ...created, question, q: question } });
  };

  const setTaskLevel = (id, level) => {
    patchBlock(id, { level });
  };

  const removeTask = (id) => {
    if (selectedId === id) setSelectedId(null);
    const rest = sourceBlocks().filter((block) => block.id !== id);
    let number = 0;
    setAssembled(true);
    commit(rest.map((block) => (block.type === "task" ? { ...block, number: ++number } : block)));
  };

  const addSimilar = (source) => {
    const list = sourceBlocks();
    const copy = {
      ...JSON.parse(JSON.stringify(source)),
      id: newId(),
      number: list.filter((block) => block.type === "task").length + 1,
    };
    copy.task.q = copy.task.q || "Новое задание";
    if (source.placed) {
      copy.placed = true;
      copy.x = (source.x || 36) + 28;
      copy.y = (source.y || 200) + 28;
      copy.w = source.boxW || source.w;
    }
    setSelectedId(copy.id);
    setAssembled(true);
    commit([...list, copy]);
  };

  const addBlock = (kind) => {
    const list = sourceBlocks();
    const taskCount = list.filter((block) => block.type === "task").length;
    let block;
    if (NOTE_BLOCKS[kind]) {
      block = { id: newId(), type: kind, text: NOTE_DEFAULTS[kind] || "" };
    } else {
      const number = taskCount + 1;
      const task = createTask(kind);
      const lowest = list.reduce((max, item) => Math.max(max, item.placed ? (item.y || 0) + (item.boxH || 140) : 0), 0);
      block = {
        id: newId(),
        type: "task",
        number,
        groupId: "custom",
        groupTitle: "",
        structure: "",
        skill: "",
        level: "стандарт",
        points: 1,
        task,
        x: 48,
        y: 200,
        w: 690,
        h: kind === "choice" ? 140 : 110,
        z: number + 5,
        padding: 8,
        locked: false,
        placed: list.some((item) => item.placed),
        ...(list.some((item) => item.placed) ? { x: 36, y: lowest + 24, w: 560 } : {}),
      };
    }
    if (block && list.some((item) => item.placed) && block.type !== "task") {
      const lowest = list.reduce((max, item) => Math.max(max, (item.y || 0) + (item.boxH || 80)), 0);
      block.placed = true;
      block.x = 36;
      block.y = lowest + 24;
      block.w = 560;
    }
    setAssembled(true);
    setSelectedId(block.id);
    commit([...list, block]);
    showToast("Блок добавлен");
  };

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    setBlocks(JSON.parse(historyRef.current[historyIndexRef.current]));
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    setBlocks(JSON.parse(historyRef.current[historyIndexRef.current]));
  };

  useEffect(() => {
    const onKey = (event) => {
      const typing = event.target.closest("input, textarea, select, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (typing || !editMode) return;
      if (event.key === "Escape") {
        setSelectedId(null);
        setSelectedIds([]);
        setTextEditId("");
        setFloatMenu("");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const ids = sourceBlocks().filter((block) => block.type !== "page-break").map((block) => block.id);
        setSelectedIds(ids);
        setSelectedId(ids[0] || null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        const ids = selectedIds.length ? selectedIds : [selectedId];
        const items = sourceBlocks().filter((block) => ids.includes(block.id) && block.type !== "page-break");
        if (items.length) clipboardRef.current = JSON.parse(JSON.stringify(items));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && clipboardRef.current?.length) {
        event.preventDefault();
        const clones = clipboardRef.current.map((item) => ({ ...JSON.parse(JSON.stringify(item)), id: newId(), placed: false }));
        const list = [...sourceBlocks()];
        const anchor = list.findIndex((block) => block.id === selectedId);
        list.splice(anchor + 1, 0, ...clones);
        let number = 0;
        setAssembled(true);
        setSelectedId(clones[0].id);
        setSelectedIds(clones.map((item) => item.id));
        commit(list.map((block) => (block.type === "task" ? { ...block, number: ++number } : block)));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selectedId) {
        event.preventDefault();
        const current = sourceBlocks().find((block) => block.id === selectedId);
        if (current?.type === "task") addSimilar(current);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedId && selectedId !== "sheet-title" && selectedId !== "sheet-goal") {
        event.preventDefault();
        const ids = new Set(selectedIds.length ? selectedIds : [selectedId]);
        const rest = sourceBlocks().filter((block) => !ids.has(block.id));
        let number = 0;
        setSelectedId(null);
        setSelectedIds([]);
        setAssembled(true);
        commit(rest.map((block) => (block.type === "task" ? { ...block, number: ++number } : block)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const activateSheet = () => {
    if (assembledRef.current) return blocksRef.current;
    const list = previewBlocks(formRef.current);
    assembledRef.current = true;
    blocksRef.current = list;
    setAssembled(true);
    setBlocks(list);
    return list;
  };

  const renumber = (list) => {
    let number = 0;
    return list.map((block) => (block.type === "task" ? { ...block, number: ++number } : block));
  };

  const onReorderMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.mode !== "reorder") return;
    const scroller = centerRef.current?.querySelector(".ws-canvas__scroll");
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      if (event.clientY > rect.bottom - 56) scroller.scrollTop += 16;
      else if (event.clientY < rect.top + 56) scroller.scrollTop -= 16;
    }
    const node = document.elementFromPoint(event.clientX, event.clientY);
    const overId = node?.closest?.("[data-block-id]")?.dataset.blockId;
    if (!overId || overId === drag.id || overId === drag.overId) return;
    drag.overId = overId;
    setDragOverId(overId);
    setBlocks((current) => {
      const base = current.length ? current : blocksRef.current;
      const from = base.findIndex((block) => block.id === drag.id);
      const to = base.findIndex((block) => block.id === overId);
      if (from < 0 || to < 0) return base;
      const next = [...base];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      const numbered = renumber(next);
      blocksRef.current = numbered;
      return numbered;
    });
  };

  const onReorderUp = () => {
    window.removeEventListener("pointermove", onReorderMove);
    window.removeEventListener("pointerup", onReorderUp);
    setDragging(false);
    if (dragRef.current?.mode !== "reorder") return;
    dragRef.current = null;
    setDragOverId("");
    if (assembledRef.current) commit(blocksRef.current);
  };

  const onGripDown = (event, id) => {
    if (!editMode) return;
    event.preventDefault();
    event.stopPropagation();
    activateSheet();
    dragRef.current = { mode: "reorder", id, overId: "" };
    setSelectedId(id);
    setSelectedIds([id]);
    setDragging(true);
    window.addEventListener("pointermove", onReorderMove);
    window.addEventListener("pointerup", onReorderUp);
  };

  const onResizeDown = (event, id) => {
    event.preventDefault();
    event.stopPropagation();
    activateSheet();
    const node = event.currentTarget.closest("[data-block-id]");
    const currentScale = scaleRef.current || 1;
    const startY = event.clientY;
    const startX = event.clientX;
    const startH = (node?.getBoundingClientRect().height || 88) / currentScale;
    const startW = (node?.getBoundingClientRect().width || 320) / currentScale;
    const resizeWidth = event.currentTarget.dataset.axis === "x";
    dragRef.current = { mode: "resize", id };
    setSelectedId(id);
    setDragging(true);
    const move = (ev) => {
      const boxH = Math.max(48, snap(startH + (ev.clientY - startY) / currentScale));
      const limit = contentWidthRef.current || 680;
      const boxW = resizeWidth ? Math.max(180, Math.min(limit, snap(startW + (ev.clientX - startX) / currentScale))) : undefined;
      setBlocks((current) => {
        const base = current.some((block) => block.id === id) ? current : blocksRef.current;
        const next = base.map((block) => (
          block.id === id ? { ...block, boxH, ...(boxW ? { boxW } : {}), placed: false } : block
        ));
        blocksRef.current = next;
        return next;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
      setDragging(false);
      commit(blocksRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleSection = (id) => setOpenSection((current) => (current === id ? "" : id));
  const geometry = useMemo(() => contentBox("a4", orientation, marginMm), [orientation, marginMm]);
  contentWidthRef.current = geometry.contentWidth;
  const scale = zoomPreset === "fit-width" ? fitWidth : zoomPreset === "fit-page" ? fitPage : Number(zoomPreset) || 1;
  scaleRef.current = scale;
  const gutter = form.blockGap === 12 || form.blockGap === 24 ? form.blockGap : 16;
  const fitted = useMemo(
    () => {
      const options = {
        contentHeight: geometry.contentHeight,
        firstUsed: headerHeight + gutter,
        gap: gutter,
      };
      if (form.columns === 1) {
        return { columns: 1, pages: paginateBlocks(sheetBlocks, blockHeights, options) };
      }
      if (form.columns === 2) {
        return { columns: 2, pages: paginateGrid(sheetBlocks, blockHeights, { ...options, columns: 2 }) };
      }
      return fitSheet(sheetBlocks, blockHeights, options);
    },
    [sheetBlocks, blockHeights, geometry.contentHeight, headerHeight, form.columns, gutter],
  );
  const pages = fitted.pages;
  const columnCount = fitted.columns;
  const warnings = useMemo(() => [
    ...collectContentWarnings(sheetBlocks),
    ...collectMetricWarnings(sheetBlocks, blockHeights, geometry.contentHeight),
  ], [sheetBlocks, blockHeights, geometry.contentHeight]);
  const sheetLook = themeLook(form);
  const sheetTheme = themeCaption(form);
  const sheetClass = [
    "ws-sheet",
    `is-${form.style || "whiteboard"}`,
    sheetLook ? "is-vivid" : "",
    sheetLook && !bgData ? "is-themed" : "",
    bgData ? "has-art" : "",
    form.mono ? "is-bw" : "",
    form.toner ? "is-toner" : "",
    form.density === "плотная" ? "is-dense" : "",
    columnCount > 1 ? "is-columns" : "",
  ].filter(Boolean).join(" ");
  const sheetStyle = {
    ...(bgData ? {
      backgroundImage: `url("${bgData}")`,
      backgroundSize: "100% 100%",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      "--sheet-art": `url("${bgData}")`,
    } : {}),
    ...(sheetLook ? {
      "--ws-accent": sheetLook.accent,
      "--ws-ink": sheetLook.ink,
      "--ws-frame": sheetLook.frame,
      ...(bgData ? {} : { "--page-background": sheetLook.paper }),
    } : {}),
    "--ws-gutter": `${gutter}px`,
  };

  const moveBlock = (id, direction) => {
    const list = [...sourceBlocks()];
    const index = list.findIndex((block) => block.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(next, 0, item);
    let number = 0;
    setAssembled(true);
    commit(list.map((block) => (block.type === "task" ? { ...block, number: ++number, placed: false } : block)));
  };

  const placeInColumn = (id, column) => {
    setForm((current) => (current.columns === 2 ? current : { ...current, columns: 2 }));
    patchBlock(id, { column, fullWidth: false });
  };

  const toggleBlockWidth = (id) => {
    const block = sourceBlocks().find((item) => item.id === id);
    const fullWidth = !block?.fullWidth;
    if (fullWidth) setForm((current) => ({ ...current, columns: 2 }));
    patchBlock(id, fullWidth ? { fullWidth: true, column: undefined } : { fullWidth: false });
  };

  const replaceFromBank = (block, direction) => {
    const bank = TASK_BANK[form.subject] || TASK_BANK["Математика"];
    const currentQ = block.task?.q || block.task?.question || "";
    const wanted = canonicalType(block.task?.type);
    const bankType = { short_answer: "short", solution: "lines", single_choice: "choice", matching: "match", fill_blank: "gap", find_error: "error", function_graph: "graph" }[wanted] || block.task?.type;
    let pool = bank.filter((item) => item.q !== currentQ);
    if (direction === "harder") pool = pool.filter((item) => item.type === "lines" || item.type === bankType);
    else if (direction === "easier") pool = pool.filter((item) => item.type === "short" || item.type === bankType);
    else pool = pool.filter((item) => item.type === bankType);
    const pick = pool[0];
    if (!pick) {
      showToast("В базе нет подходящей замены. Генерация ИИ спишет AI credits и не изменит размер блока.");
      return;
    }
    const levels = ["база", "стандарт", "повышенный"];
    const levelIndex = Math.max(0, levels.indexOf(block.level));
    const level = direction === "harder" ? levels[Math.min(2, levelIndex + 1)] : direction === "easier" ? levels[Math.max(0, levelIndex - 1)] : block.level;
    patchBlock(block.id, {
      level,
      task: { ...block.task, q: pick.q, question: pick.q, answer: pick.answer ?? block.task?.answer, solution: pick.solution, options: pick.options },
    });
    showToast("Замена взята из базы. Размер блока сохранён.");
  };

  const insertAfter = (afterId, kind) => {
    const list = sourceBlocks();
    const index = list.findIndex((block) => block.id === afterId);
    const taskCount = list.filter((block) => block.type === "task").length;
    let block;
    if (NOTE_BLOCKS[kind]) block = { id: newId(), type: kind, text: NOTE_DEFAULTS[kind] || "" };
    else {
      block = {
        id: newId(),
        type: "task",
        number: taskCount + 1,
        groupId: "custom",
        skill: "",
        level: "стандарт",
        points: 1,
        task: createTask(kind),
      };
    }
    const after = list[index];
    if (after?.placed) {
      block.placed = true;
      block.x = after.x || 36;
      block.y = (after.y || 0) + (after.boxH || 120) + 16;
      block.w = after.boxW || after.w || 560;
    }
    const next = [...list];
    next.splice(index + 1, 0, block);
    let number = 0;
    setAssembled(true);
    setSelectedId(block.id);
    commit(next.map((item) => (item.type === "task" ? { ...item, number: ++number } : item)));
  };

  const renderTask = (task) => {
    const active = editMode && (task.id === selectedId || selectedIds.includes(task.id));
    const question = task.task?.q || task.task?.question || "";
    const level = ["база", "стандарт", "повышенный"].includes(task.level) ? task.level : "стандарт";
    const levelName = level === "база" ? "База" : level === "повышенный" ? "Повышенный" : "Стандарт";
    const hasMeta = !!(task.showLevel || task.showPoints);
    const editQuestion = (event) => {
      if (!editMode) return;
      event.stopPropagation();
      if (event.shiftKey) {
        setSelectedIds((current) => (current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]));
        setSelectedId(task.id);
        return;
      }
      setSelectedIds([task.id]);
      setSelectedId(task.id);
      setTextEditId(task.id);
      setFloatMenu("");
    };
    const choose = (event) => {
      event.stopPropagation();
      if (!editMode) return;
      if (event.shiftKey) {
        setSelectedIds((current) => (current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]));
      } else {
        setSelectedIds([task.id]);
      }
      setSelectedId(task.id);
      setFloatMenu("");
    };
    const questionNode = textEditId === task.id && editMode ? (
      <Editable className="ws-task__q" html={question} onCommit={(value) => { patchBlock(task.id, { task: { ...task.task, q: value, question: value } }); setTextEditId(""); }} />
    ) : question.trim() ? (
      <MathHtml className="ws-task__q" html={question} onClick={editQuestion} />
    ) : (
      <div className="ws-task__q ws-placeholder" onClick={editQuestion}>Введите условие задания</div>
    );
    return (
      <article
        key={task.id}
        className={`ws-task${active ? " is-selected" : ""}${hasMeta ? " has-meta" : ""}`}
        onClick={choose}
      >
        {hasMeta ? (
          <div className="ws-task__lead">
            <span className="ws-num">{task.number}.</span>
            {task.showLevel ? <span className="ws-level">{levelName}</span> : null}
            {task.showPoints ? <span className="ws-points">{pointsWord(task.points || 1)}</span> : null}
          </div>
        ) : <span className="ws-num">{task.number}.</span>}
        <div className="ws-task__main">{questionNode}</div>
        <div className="ws-task__rest">
          <TaskSheetFace
            task={task.task}
            view={mode === "print" || mode === "interactive" ? "student" : view}
            mode={mode}
            compose={editMode}
            onChange={editMode ? (next) => patchBlock(task.id, { task: next }) : undefined}
            focus={sheetFocus?.blockId === task.id ? sheetFocus : null}
            onFocus={(focus) => {
              setSelectedId(task.id);
              setSelectedIds([task.id]);
              setSheetFocus({ blockId: task.id, ...focus });
            }}
          />
          <WorkArea area={task.workArea} />
        </div>
      </article>
    );
  };

  const flattenPages = (pageList) => {
    const out = [];
    pageList.forEach((items, index) => {
      if (index > 0) out.push({ id: newId(), type: "page-break" });
      items.forEach((block) => out.push(block));
    });
    return out;
  };

  const duplicatePage = (index) => {
    const next = pages.map((items) => [...items]);
    const copy = (pages[index] || []).map((block) => ({ ...JSON.parse(JSON.stringify(block)), id: newId(), placed: false }));
    next.splice(index + 1, 0, copy);
    setAssembled(true);
    commit(renumber(flattenPages(next)));
  };

  const deletePage = (index) => {
    const next = pages.filter((_, pageIndex) => pageIndex !== index);
    setSelectedId(null);
    setSelectedIds([]);
    setAssembled(true);
    commit(renumber(flattenPages(next.length ? next : [[]])));
  };

  const movePage = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setAssembled(true);
    commit(renumber(flattenPages(next)));
  };

  const addPage = () => {
    setAssembled(true);
    commit([...sourceBlocks(), { id: newId(), type: "page-break" }]);
  };

  useEffect(() => {
    const root = pagesRef.current;
    if (!root) return undefined;
    const read = () => {
      const next = {};
      root.querySelectorAll("[data-block-id]").forEach((node) => {
        next[node.dataset.blockId] = node.offsetHeight;
        const text = node.querySelector(".ws-task__q, .ws-note-block, .ws-group");
        if (text) next[`${node.dataset.blockId}:font`] = parseFloat(window.getComputedStyle(text).fontSize) || 0;
      });
      const headerNode = root.querySelector("[data-sheet-header]");
      const headerH = headerNode?.offsetHeight || 0;
      setBlockHeights((prev) => {
        const keys = Object.keys(next);
        if (keys.length === Object.keys(prev).length && keys.every((key) => prev[key] === next[key])) return prev;
        return next;
      });
      setHeaderHeight((prev) => (prev === headerH ? prev : headerH));
    };
    const observer = new ResizeObserver(read);
    observer.observe(root);
    root.querySelectorAll("[data-block-id], [data-sheet-header]").forEach((node) => observer.observe(node));
    read();
    return () => observer.disconnect();
  }, [sheetBlocks, mode, view, orientation, marginMm, form.topic, form.goal, form.studentLine, pages.length]);

  const applyDocument = useCallback((data) => {
    if (data?.id) setDocumentId(data.id);
    if (Array.isArray(data?.blocks)) {
      setAssembled(data.blocks.length > 0);
      commit(data.blocks.map((block) => ({ ...block, placed: false })));
    }
    if (data?.form && typeof data.form === "object") setForm((current) => ({ ...current, ...data.form }));
    if (data?.orientation === "landscape" || data?.orientation === "portrait") setOrientation(data.orientation);
    if (data?.margin_mm) setMarginMm(Number(data.margin_mm) || 12);
  }, [commit]);

  const openWork = useCallback(async (id) => {
    setOpeningId(id);
    try {
      await ensureCsrfCookie();
      const response = await fetch(`/api/cabinet/ai/worksheets/documents/${id}/`, { credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast("Не удалось открыть работу.");
        return;
      }
      applyDocument(data);
      lostDocumentRef.current = false;
      setSelectedId(null);
      setSelectedIds([]);
      setView("student");
      setMode("editor");
      setMobilePane("sheet");
      const params = new URLSearchParams(window.location.search);
      params.set("document", id);
      params.delete("charged");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    } catch {
      showToast("Не удалось открыть работу.");
    } finally {
      setOpeningId("");
    }
  }, [applyDocument, showToast]);

  const forgetOpenDocument = () => {
    lostDocumentRef.current = false;
    skipInitialLoad.current = true;
    setDocumentId("");
    setBlocks([]);
    setAssembled(false);
    setSelectedId(null);
    setSelectedIds([]);
    try {
      localStorage.removeItem("itflux.worksheet.draft.v1");
    } catch {
      /* хранилище недоступно */
    }
    window.history.replaceState(null, "", window.location.pathname);
  };

  const startNewSheet = () => {
    forgetOpenDocument();
    setMode("editor");
    setMobilePane("sheet");
  };

  const worksheetHeaders = async () => {
    await ensureCsrfCookie();
    const headers = { Accept: "application/json" };
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRFToken"] = csrf;
    return headers;
  };

  const duplicateWork = async (id) => {
    if (workActionId) return;
    setConfirmDeleteId("");
    setWorkActionId(id);
    try {
      const response = await fetch(`/api/cabinet/ai/worksheets/documents/${id}/duplicate/`, {
        method: "POST",
        credentials: "same-origin",
        headers: await worksheetHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.id) {
        showToast("Не удалось сделать копию.");
        return;
      }
      setWorks((current) => [data, ...current.filter((item) => item.id !== data.id)]);
      showToast("Копия создана.");
    } catch {
      showToast("Не удалось сделать копию.");
    } finally {
      setWorkActionId("");
    }
  };

  const deleteWork = async (id) => {
    if (workActionId) return;
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setWorkActionId(id);
    try {
      const response = await fetch(`/api/cabinet/ai/worksheets/documents/${id}/`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: await worksheetHeaders(),
      });
      if (!response.ok && response.status !== 204) {
        showToast("Не удалось удалить работу.");
        return;
      }
      setWorks((current) => current.filter((item) => item.id !== id));
      setConfirmDeleteId("");
      if (documentIdRef.current === id) forgetOpenDocument();
      showToast("Работа удалена.");
    } catch {
      showToast("Не удалось удалить работу.");
    } finally {
      setWorkActionId("");
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("document");
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem("itflux.worksheet.draft.v1") || "null");
    } catch {
      stored = null;
    }
    const id = fromUrl && fromUrl !== "null" ? fromUrl : (stored?.documentId || "");
    if (!id) {
      if (Array.isArray(stored?.blocks) && stored.blocks.length) {
        setBlocks(stored.blocks.map((block) => ({ ...block, placed: false })));
        setAssembled(true);
      }
      if (stored?.form && typeof stored.form === "object") setForm((current) => ({ ...current, ...stored.form }));
      if (stored?.orientation === "landscape" || stored?.orientation === "portrait") setOrientation(stored.orientation);
      if (stored?.marginMm) setMarginMm(Number(stored.marginMm) || 12);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        await ensureCsrfCookie();
        const response = await fetch(`/api/cabinet/ai/worksheets/documents/${id}/`, { credentials: "same-origin" });
        if (!response.ok) {
          if (cancelled) return;
          if (!fromUrl && Array.isArray(stored?.blocks) && stored.blocks.length) {
            setDocumentId("");
            setBlocks(stored.blocks.map((block) => ({ ...block, placed: false })));
            setAssembled(true);
          } else {
            showToast("Не удалось открыть созданный лист.");
          }
          return;
        }
        const data = await response.json();
        if (cancelled || skipInitialLoad.current) return;
        applyDocument(data);
        const charged = params.get("charged");
        if (charged) showToast(`Рабочий лист создан. Списано ${charged} AI-токенов.`);
        params.delete("charged");
        params.set("document", id);
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      } catch {
        if (!cancelled) showToast("Не удалось открыть созданный лист.");
      }
    })();
    return () => { cancelled = true; };
  }, [applyDocument, showToast]);

  useEffect(() => {
    if (mode !== "works") return undefined;
    let cancelled = false;
    setWorksState("loading");
    (async () => {
      try {
        const response = await fetch("/api/cabinet/ai/worksheets/documents/", { credentials: "same-origin" });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setWorksState("error");
          return;
        }
        setWorks(Array.isArray(data.documents) ? data.documents : []);
        setWorksState("ready");
      } catch {
        if (!cancelled) setWorksState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [mode, libraryTick]);

  useEffect(() => {
    if (!assembled) return undefined;
    const timer = window.setTimeout(() => {
      const slim = blocks.map((block) => {
        const copy = { ...block, placed: false };
        const url = copy.task?.content?.imageUrl;
        if (typeof url === "string" && url.length > 400000) {
          copy.task = { ...copy.task, content: { ...copy.task.content, imageUrl: "" } };
        }
        return copy;
      });
      const payload = {
        blocks: slim,
        form,
        title: form.topic || "Черновик",
        orientation,
        margin_mm: marginMm,
      };
      const knownId = documentIdRef.current || documentId || "";
      try {
        localStorage.setItem("itflux.worksheet.draft.v1", JSON.stringify({
          blocks: slim,
          form,
          orientation,
          marginMm,
          documentId: knownId,
        }));
      } catch {
        /* локальное хранилище переполнено */
      }
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRFToken"] = csrf;
      const remember = (id) => {
        documentIdRef.current = id;
        setDocumentId(id);
        setLibraryTick((value) => value + 1);
        try {
          const raw = localStorage.getItem("itflux.worksheet.draft.v1");
          const saved = raw ? JSON.parse(raw) : {};
          saved.documentId = id;
          localStorage.setItem("itflux.worksheet.draft.v1", JSON.stringify(saved));
        } catch {
          /* хранилище недоступно */
        }
        const params = new URLSearchParams(window.location.search);
        if (params.get("document") !== id) {
          params.set("document", id);
          const query = params.toString();
          window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
        }
      };
      const persist = (body) => {
        if (savingRef.current) {
          pendingDraftRef.current = body;
          return;
        }
        const currentId = documentIdRef.current;
        savingRef.current = true;
        const finish = () => {
          savingRef.current = false;
          const next = pendingDraftRef.current;
          pendingDraftRef.current = null;
          if (next) persist(next);
        };
        if (!currentId) {
          if (lostDocumentRef.current) {
            savingRef.current = false;
            return;
          }
          fetch("/api/cabinet/ai/worksheets/documents/", {
            method: "POST",
            credentials: "same-origin",
            headers,
            body: JSON.stringify(body),
          }).then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.id) remember(data.id);
          }).catch(() => {}).finally(finish);
          return;
        }
        fetch(`/api/cabinet/ai/worksheets/documents/${currentId}/`, {
          method: "PATCH",
          credentials: "same-origin",
          headers,
          body: JSON.stringify(body),
        }).then(async (response) => {
          if (response.ok) {
            setLibraryTick((value) => value + 1);
            return;
          }
          if (response.status === 404) {
            lostDocumentRef.current = true;
            documentIdRef.current = "";
            setDocumentId("");
            pendingDraftRef.current = null;
          }
        }).catch(() => {}).finally(finish);
      };
      persist(payload);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [blocks, form, assembled, orientation, marginMm, documentId]);

  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-ws-page", "1");
    style.textContent = `@media print { @page { size: A4 ${orientation}; margin: 0; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [orientation]);

  return (
    <div
      className={`ws-editor${gridOn ? " is-grid" : ""}${dragging ? " is-dragging" : ""} is-pane-${mobilePane} is-${orientation}${editMode ? " is-editing" : ""} is-${mode}`}
      style={{
        "--page-width": `${geometry.page.width}px`,
        "--page-height": `${geometry.page.height}px`,
        "--page-margin": `${geometry.margin}px`,
      }}
    >
      <WorksheetHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="ws-mobile-tabs">
        <button type="button" className={mobilePane === "gen" ? "is-active" : ""} onClick={() => setMobilePane("gen")}>Настройка</button>
        <button type="button" className={mobilePane === "sheet" ? "is-active" : ""} onClick={() => setMobilePane("sheet")}>Лист</button>
        <button type="button" className={mobilePane === "props" ? "is-active" : ""} onClick={() => setMobilePane("props")}>Свойства</button>
      </div>
      <div className="ws-workspace">
        <aside className="ws-side ws-side--left">
          <header className="ws-hero-head">
            <h2>Конструктор материалов</h2>
            <button type="button" className="ws-help-btn" onClick={() => setHelpOpen(true)}>
              <CabinetIcon name="help" />
              Инструкция
            </button>
          </header>
          <div className="ws-side__scroll">
            <section className="ws-main-card">
              <div className="ws-grid2">
                <label className="ws-field">
                  <span className="ws-label">Предмет</span>
                  <select value={form.subject} onChange={setField("subject")}>
                    <option>Математика</option>
                    <option>Информатика</option>
                    <option>Русский язык</option>
                    <option>Физика</option>
                  </select>
                </label>
                <label className="ws-field">
                  <span className="ws-label">Класс</span>
                  <select value={form.grade} onChange={setField("grade")}>
                    <option>8</option><option>9</option><option>10</option><option>11</option>
                  </select>
                </label>
              </div>
              <label className="ws-field">
                <span className="ws-label">Тема</span>
                <input type="text" value={form.topic} onChange={setField("topic")} />
              </label>
              <label className="ws-field">
                <span className="ws-label">Тип листа</span>
                <select value={form.purpose} onChange={setField("purpose")}>
                  {PURPOSES.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
              <p className="ws-hint">{purposeById(form.purpose).text}</p>
              <label className="ws-field">
                <span className="ws-label">Сложность</span>
                <select value={form.difficulty} onChange={setField("difficulty")}>
                  <option>От простого к сложному</option>
                  <option>Равномерная</option>
                  <option>Диагностическая смесь</option>
                </select>
              </label>
              <fieldset className="ws-source">
                <legend className="ws-label">Задания</legend>
                <label>
                  <input
                    type="radio"
                    name="ws-task-source"
                    checked={!form.designOnly}
                    onChange={() => setForm((current) => ({ ...current, designOnly: false }))}
                  />
                  <span>Создать задания с нуля</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="ws-task-source"
                    checked={Boolean(form.designOnly)}
                    onChange={() => setForm((current) => ({ ...current, designOnly: true }))}
                  />
                  <span>Оставить задания без изменений</span>
                </label>
              </fieldset>
              <label className="ws-check">
                <input
                  type="checkbox"
                  checked={Boolean(form.keepBackground)}
                  onChange={(event) => setForm((current) => ({ ...current, keepBackground: event.target.checked }))}
                />
                <span>Оставить фон без изменений</span>
              </label>
              <label className="ws-check ws-theory">
                <input
                  type="checkbox"
                  checked={wantsTheory}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    theory: event.target.checked,
                    theoryTouched: true,
                  }))}
                />
                <span>
                  Добавить теорию
                  <small>{theoryCaption(theoryDetailOf(form))} · {theoryCost} {tokenWord(theoryCost)}</small>
                </span>
              </label>
              {wantsTheory ? (
                <TheoryDetailPicker
                  value={theoryDetailOf(form)}
                  onChange={(theoryDetail) => setForm((current) => ({ ...current, theoryDetail }))}
                />
              ) : null}
              {form.designOnly ? (
                <p className="ws-hint">
                  {form.keepBackground && wantsTheory
                    ? `Фон и задания останутся как есть. В начало листа добавится ${theoryDetailOf(form) === "detailed" ? "подробный" : "короткий"} текст с теорией.`
                    : form.keepBackground
                      ? "Фон и задания останутся как есть."
                      : wantsTheory
                        ? `Задания останутся. Фон обновится, и в начало листа добавится ${theoryDetailOf(form) === "detailed" ? "подробная" : "краткая"} теория.`
                        : "Тексты и структура листа останутся как есть. Поменяется только фоновая картинка."}
                </p>
              ) : (
                <>
                  <label className="ws-field">
                    <span className="ws-label">Номер варианта</span>
                    <input
                      inputMode="numeric"
                      value={form.variantNumber || ""}
                      placeholder="С платформы, если задания брать оттуда"
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        variantNumber: event.target.value.replace(/\D/g, "").slice(0, 12),
                      }))}
                    />
                  </label>
                  {form.variantNumber ? (
                    <p className="ws-hint">
                      {aiQuote?.exact_variant
                        ? `Все ${aiQuote.requested_tasks} заданий варианта №${aiQuote.variant_id} войдут в лист без изменений.`
                        : aiQuoteStatus === "error"
                          ? aiQuoteMessage
                          : "Задания этого варианта попадут в лист без изменений."}
                    </p>
                  ) : null}
                  <div className="ws-grid2">
                    {form.variantNumber ? null : (
                      <label className="ws-field">
                        <span className="ws-label">Заданий</span>
                        <input type="number" min="3" max="12" value={form.count} onChange={setField("count")} />
                      </label>
                    )}
                    <label className="ws-field">
                      <span className="ws-label">Время</span>
                      <select value={String(minutes)} onChange={(event) => setForm((current) => ({ ...current, minutes: Number(event.target.value) }))}>
                        {[25, 40, 60].includes(Number(minutes)) ? null : <option value={String(minutes)}>{minutes} минут</option>}
                        <option value="25">25 минут</option>
                        <option value="40">40 минут</option>
                        <option value="60">60 минут</option>
                      </select>
                    </label>
                  </div>
                  <label className="ws-field ws-field--prompt">
                    <span className="ws-label">Опишите более конкретно, что хотите видеть</span>
                    <textarea
                      rows={4}
                      value={form.vision || ""}
                      onChange={setField("vision")}
                      placeholder="Например: только вычисления по свойствам, без текстовых задач, с коротким ответом"
                    />
                  </label>
                </>
              )}
            </section>

            <Accordion
              title="Дополнительно"
              hint="оформление и пожелания"
              open={openSection === "extra"}
              onToggle={() => toggleSection("extra")}
            >
              <span className="ws-label">Готовый стиль</span>
              <div className="ws-styles" role="radiogroup" aria-label="Готовый стиль">
                {STANDARD_STYLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={form.style === item.id && String(form.themePrompt || "").trim() === item.prompt ? "is-on" : ""}
                    onClick={() => applyStandardStyle(item)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
              <p className="ws-hint">Доска, учебник, бланк и минимум применяются сразу и не рисуют фон через AI.</p>
              <label className="ws-field ws-field--prompt">
                <span className="ws-label">Своё оформление</span>
                <textarea
                  rows={4}
                  value={form.themePrompt}
                  onChange={setField("themePrompt")}
                  placeholder="Например: осенние листья, школа, теория и практика"
                />
              </label>
              <label className="ws-field">
                <span className="ws-label">Отдельные пожелания</span>
                <textarea
                  rows={3}
                  value={form.extra}
                  onChange={setField("extra")}
                  placeholder="Что ещё учесть в листе"
                />
              </label>
              <label className="ws-check">
                <input type="checkbox" checked={form.studentLine !== false} onChange={(event) => setForm((current) => ({ ...current, studentLine: event.target.checked }))} />
                <span>Строка ученика — ФИО, класс и дата</span>
              </label>
              <label className="ws-field">
                <span className="ws-label">Поля страницы</span>
                <select value={String(marginMm)} onChange={(event) => setMarginMm(Number(event.target.value))}>
                  <option value="8">8 мм</option>
                  <option value="10">10 мм</option>
                  <option value="12">12 мм</option>
                  <option value="16">16 мм</option>
                </select>
              </label>
              <div className="ws-types">
                <button type="button" className={form.answers ? "is-on" : ""} onClick={() => setForm((current) => ({ ...current, answers: !current.answers }))}>Ключ ответов</button>
                <button type="button" className={form.solutions ? "is-on" : ""} onClick={() => setForm((current) => ({ ...current, solutions: !current.solutions }))}>Краткие решения</button>
                <button type="button" className={form.variants > 1 ? "is-on" : ""} onClick={() => setForm((current) => ({ ...current, variants: current.variants > 1 ? 1 : 2 }))}>Вариант B</button>
                <button type="button" className={form.criteria ? "is-on" : ""} onClick={() => setForm((current) => ({ ...current, criteria: !current.criteria }))}>Критерии</button>
              </div>
            </Accordion>
            <div className="ws-cta">
              <button
                type="button"
                disabled={aiBusy || (form.designOnly ? keptBlocked : !aiQuote?.can_generate)}
                onClick={form.designOnly ? applyKeptTasks : createWithAi}
              >
                {form.designOnly
                  ? (addTheory && !keepBackground ? "Обновить оформление и теорию" : addTheory ? "Добавить теорию" : "Обновить оформление")
                  : "Создать рабочий лист"}
                <span>{tokenLine}</span>
              </button>
            </div>
          </div>
        </aside>

        <section className="ws-center">
          <header className="ws-center__head">
            <div className="ws-modes" role="tablist" aria-label="Режим">
              <button type="button" role="tab" aria-selected={mode === "editor"} className={mode === "editor" ? "is-active" : ""} onClick={() => setMode("editor")}>Редактирование</button>
              <button type="button" role="tab" aria-selected={mode === "preview"} className={mode === "preview" ? "is-active" : ""} onClick={() => { setMode("preview"); setSelectedId(null); setSelectedIds([]); setFloatMenu(""); }}>Предпросмотр</button>
              <button type="button" role="tab" aria-selected={mode === "interactive"} className={mode === "interactive" ? "is-active" : ""} onClick={() => { setMode("interactive"); setSelectedId(null); setFloatMenu(""); }}>Интерактив</button>
              <button type="button" role="tab" aria-selected={mode === "print"} className={mode === "print" ? "is-active" : ""} onClick={() => { setMode("print"); setSelectedId(null); setFloatMenu(""); }}>Печать</button>
              <button type="button" role="tab" aria-selected={mode === "works"} className={mode === "works" ? "is-active" : ""} onClick={() => { setMode("works"); setSelectedId(null); setFloatMenu(""); }}>Мои работы</button>
            </div>
            {mode === "editor" || mode === "preview" ? (
              <div className="ws-modes" role="tablist" aria-label="Что показать">
                <button type="button" role="tab" aria-selected={view === "student"} className={view === "student" ? "is-active" : ""} onClick={() => setView("student")}>Ученик</button>
                <button type="button" role="tab" aria-selected={view === "teacher"} className={view === "teacher" ? "is-active" : ""} onClick={() => setView("teacher")}>Учитель</button>
              </div>
            ) : null}
            {mode === "works" ? null : <div className="ws-zoom">
              <button type="button" className="ws-icon-btn" onClick={undo} disabled={historyIndexRef.current <= 0} aria-label="Отменить" title="Отменить"><CabinetIcon name="undo" /></button>
              <button type="button" className="ws-icon-btn" onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1} aria-label="Повторить" title="Повторить"><CabinetIcon name="redo" /></button>
              <button type="button" onClick={() => setOrientation((value) => (value === "portrait" ? "landscape" : "portrait"))}>{orientation === "portrait" ? "Альбом" : "Книга"}</button>
              <button type="button" onClick={() => setForm((current) => ({ ...current, columns: columnCount > 1 ? 1 : 2 }))}>{columnCount > 1 ? "1 колонка" : "2 колонки"}</button>
              <select
                aria-label="Отступ между блоками"
                value={String(gutter)}
                onChange={(event) => setForm((current) => ({ ...current, blockGap: Number(event.target.value) }))}
              >
                <option value="12">Отступ 12</option>
                <option value="16">Отступ 16</option>
                <option value="24">Отступ 24</option>
              </select>
              <button type="button" onClick={() => setGridOn((value) => !value)}>{gridOn ? "Скрыть сетку" : "Сетка"}</button>
              <button type="button" onClick={() => { if (warnings.length) setExportGate(true); else window.print(); }}>Скачать PDF</button>
              <select aria-label="Масштаб" value={String(zoomPreset)} onChange={(event) => {
                const value = event.target.value;
                setZoomPreset(value === "fit-width" || value === "fit-page" ? value : Number(value));
              }}>
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="fit-width">По ширине</option>
                <option value="fit-page">Страница</option>
              </select>
              <span>{Math.round(scale * 100)}%</span>
            </div>}
          </header>
          {mode === "works" ? null : (
            <p className="ws-cirfik">Если нужна структура рабочего листа — обратитесь к Цифрику, он в нижнем правом углу экрана.</p>
          )}
          {editMode ? <div className="ws-insert">
            <span>Блок</span>
            <button type="button" onClick={() => addBlock("heading")}>Заголовок</button>
            <button type="button" onClick={() => addBlock("text")}>Текст</button>
            <button type="button" onClick={() => addBlock("reference")}>Справка</button>
            <button type="button" onClick={() => addBlock("fact")}>Факт</button>
            <TaskTypePicker type="" label="Добавить задание" subject={form.subject} onChange={(nextType) => addBlock(nextType)} />
          </div> : null}
          {editMode && selectedIds.length > 1 ? (
            <div className="ws-context">
              <span>Выбрано: {selectedIds.length}</span>
              <button type="button" className="is-danger" onClick={() => {
                const drop = new Set(selectedIds);
                const rest = sourceBlocks().filter((block) => !drop.has(block.id));
                let number = 0;
                setSelectedId(null);
                setSelectedIds([]);
                setAssembled(true);
                commit(rest.map((block) => (block.type === "task" ? { ...block, number: ++number } : block)));
              }}>Удалить</button>
            </div>
          ) : null}
          {exportGate || (mode === "print" && warnings.length) ? (
            <div className="ws-issues">
              <strong>Найдено {warnings.length} {warnings.length === 1 ? "проблема" : "проблемы"}.</strong>
              {warnings.map((warning) => (
                <div key={`${warning.id}-${warning.text}`}>
                  <button type="button" onClick={() => { setMode("editor"); setSelectedId(warning.id); setSelectedIds([warning.id]); setExportGate(false); }}>{warning.text}</button>
                </div>
              ))}
              {exportGate ? (
                <>
                  <button type="button" className="ws-issues__go" onClick={() => { setExportGate(false); window.print(); }}>Всё равно экспортировать</button>
                  <button type="button" onClick={() => setExportGate(false)}>Закрыть</button>
                </>
              ) : null}
            </div>
          ) : null}
          {mode === "works" ? (
            <div className="ws-works">
              <div className="ws-works__head">
                <div>
                  <h2>Мои работы</h2>
                  <p>Откройте карточку, чтобы показать лист.</p>
                </div>
              </div>
              {worksState === "loading" ? <p className="ws-works__empty">Загружаем работы…</p> : null}
              {worksState === "error" ? <p className="ws-works__empty">Не удалось загрузить список.</p> : null}
              <ul className="ws-works__grid">
                <li>
                  <button type="button" className="ws-work-card ws-work-card--new" onClick={startNewSheet}>
                    <span className="ws-work-card__sheet is-empty">Новый лист</span>
                  </button>
                </li>
                {works.map((work) => {
                  const meta = [work.subject, work.grade ? `${work.grade} класс` : ""].filter(Boolean).join(" · ");
                  const busy = workActionId === work.id;
                  return (
                    <li key={work.id}>
                      <article className={`ws-work-card${work.id === documentId ? " is-current" : ""}${openingId === work.id ? " is-opening" : ""}`}>
                        <button
                          type="button"
                          className="ws-work-card__open"
                          onClick={() => openWork(work.id)}
                          disabled={Boolean(openingId) || Boolean(workActionId)}
                        >
                          <span className="ws-work-card__sheet">
                            {meta ? <span className="ws-work-card__kicker">{meta}</span> : null}
                            <strong>{work.title || "Без названия"}</strong>
                            {(work.preview || []).length ? (work.preview || []).map((line, index) => (
                              <span className="ws-work-card__line" key={`${index}-${line}`}>{line}</span>
                            )) : <span className="ws-work-card__line">Пустой лист</span>}
                          </span>
                          <span className="ws-work-card__caption">
                            <em className={work.status === "draft" ? "is-draft" : "is-saved"}>{work.status === "draft" ? "Черновик" : "Сохранено"}</em>
                            {work.task_count ? <span>{work.task_count} зад.</span> : null}
                            {work.updated_at ? <span>{formatWorkTime(work.updated_at)}</span> : null}
                          </span>
                        </button>
                        <div className="ws-work-card__actions">
                          <button type="button" onClick={() => duplicateWork(work.id)} disabled={Boolean(workActionId)}>
                            {busy ? "…" : "Дублировать"}
                          </button>
                          <button type="button" className="is-danger" onClick={() => deleteWork(work.id)} disabled={Boolean(workActionId)}>
                            {confirmDeleteId === work.id ? "Удалить?" : "Удалить"}
                          </button>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
          <div className="ws-canvas" ref={centerRef}>
            <div className="ws-canvas__scroll">
              <div className="ws-zoom-slot">
                <div
                  className="ws-pages"
                  ref={(node) => { pagesRef.current = node; stageRef.current = node; }}
                  style={{ zoom: scale }}
                >
                  {pages.map((pageBlocks, pageIndex) => (
                    <div className="ws-page" key={pageBlocks[0]?.id || `page-${pageIndex}`}>
                      <div
                        className={sheetClass}
                        style={sheetStyle}
                        onClick={() => { if (editMode) { setSelectedId(null); setSelectedIds([]); setFloatMenu(""); } }}
                      >
                        <div className="ws-safe">
                          {pageIndex === 0 ? (
                            <div data-sheet-header>
                              <div className="ws-kicker">{form.subject} · {form.grade} класс</div>
                              {sheetTheme && !bgData ? <div className="ws-theme-line">{sheetTheme}</div> : null}
                              <div className={editMode && selectedId === "sheet-title" ? "is-selected" : ""} onClick={(event) => { event.stopPropagation(); if (editMode) setSelectedId("sheet-title"); }}>
                                {textEditId === "sheet-title" ? (
                                  <Editable className="ws-sheet-title" html={escapeHtml(form.topic || "Тема листа")} plain onCommit={(value) => { setForm((current) => ({ ...current, topic: value })); setTextEditId(""); }} />
                                ) : (
                                  <h1 className="ws-sheet-title" onDoubleClick={(event) => { if (!editMode) return; event.stopPropagation(); setTextEditId("sheet-title"); }}>{form.topic || "Тема листа"}</h1>
                                )}
                              </div>
                              <div className="ws-sheet-meta">
                                <span>{previewTasks.length} заданий</span>
                                <span>≈ {minutes} минут</span>
                                <span>{purpose.title}</span>
                                {form.variants > 1 ? <span>{form.variants} вар.</span> : null}
                              </div>
                              {form.studentLine !== false ? (
                                <div className="ws-lines">
                                  <div className="ws-line">ФИО</div>
                                  <div className="ws-line">Класс</div>
                                  <div className="ws-line">Дата</div>
                                </div>
                              ) : null}
                              <div className={`ws-today${editMode && selectedId === "sheet-goal" ? " is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); if (editMode) setSelectedId("sheet-goal"); }} onDoubleClick={(event) => { if (!editMode) return; event.stopPropagation(); setTextEditId("sheet-goal"); }}>
                                <strong>Сегодня тренируем: </strong>
                                {textEditId === "sheet-goal" ? (
                                  <Editable className="ws-inline" html={escapeHtml(form.goal || "")} plain onCommit={(value) => { setForm((current) => ({ ...current, goal: value })); setTextEditId(""); }} />
                                ) : (
                                  <span>{form.goal || "результат обучения появится здесь"}</span>
                                )}
                              </div>
                            </div>
                          ) : null}
                          {pageBlocks.length ? (() => {
                            const cells = columnCount > 1 ? placeGrid(pageBlocks, columnCount) : [];
                            const renderBlock = (block) => {
                            const selected = editMode && (block.id === selectedId || selectedIds.includes(block.id));
                            const note = NOTE_BLOCKS[block.type];
                            const body = note ? (
                              <div className={`ws-block-row${selected ? " is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); if (!editMode) return; setSelectedId(block.id); setSelectedIds(event.shiftKey ? (selectedIds.includes(block.id) ? selectedIds.filter((id) => id !== block.id) : [...selectedIds, block.id]) : [block.id]); if (!event.shiftKey) setTextEditId(block.id); }}>
                                {note.kicker ? (
                                  <div className={`ws-callout ws-callout--${block.type}`}>
                                    <span className="ws-callout__kicker">{note.kicker}</span>
                                    {textEditId === block.id && editMode ? (
                                      <Editable className="ws-callout__text" html={escapeHtml(block.text || "")} plain onCommit={(value) => { patchBlock(block.id, { text: value }); setTextEditId(""); }} />
                                    ) : block.text ? (
                                      <MathHtml className="ws-callout__text" html={escapeHtml(block.text)} />
                                    ) : (
                                      <div className="ws-callout__text"><span className="ws-placeholder">{note.placeholder}</span></div>
                                    )}
                                  </div>
                                ) : textEditId === block.id && editMode ? (
                                  <Editable
                                    className={block.type === "heading" ? "ws-group" : "ws-note-block"}
                                    html={escapeHtml(block.text || "")}
                                    plain
                                    onCommit={(value) => { patchBlock(block.id, { text: value }); setTextEditId(""); }}
                                  />
                                ) : (
                                  block.text ? (
                                    <MathHtml className={block.type === "heading" ? "ws-group" : "ws-note-block"} html={escapeHtml(block.text)} />
                                  ) : (
                                    <div className={block.type === "heading" ? "ws-group" : "ws-note-block"}>
                                      <span className="ws-placeholder">{note.placeholder}</span>
                                    </div>
                                  )
                                )}
                                {block.note ? <p className="ws-note">{block.note}</p> : null}
                              </div>
                            ) : renderTask(block);
                            return (
                              <div key={block.id}>
                                <div
                                  data-block-id={block.id}
                                  data-align={block.align || "left"}
                                  className={`ws-flow-block${block.id === dragOverId ? " is-over" : ""}`}
                                  style={{
                                    minHeight: block.boxH || undefined,
                                    width: block.boxW || undefined,
                                    maxWidth: "100%",
                                  }}
                                >
                                  <span className="ws-grip" title="Перетащите, чтобы изменить порядок" aria-hidden="true" onPointerDown={(event) => onGripDown(event, block.id)} />
                                  {editMode ? (
                                    <div className="ws-block-tools" onClick={(event) => event.stopPropagation()}>
                                      <button type="button" aria-pressed={block.column !== 1 && !block.fullWidth} onClick={() => placeInColumn(block.id, 0)}>Слева</button>
                                      <button type="button" aria-pressed={block.column === 1 && !block.fullWidth} onClick={() => placeInColumn(block.id, 1)}>Справа</button>
                                      <button type="button" aria-pressed={!!block.fullWidth} onClick={() => toggleBlockWidth(block.id)}>Ширина</button>
                                      <button type="button" className="is-danger" onClick={() => removeTask(block.id)}>Удалить</button>
                                    </div>
                                  ) : null}
                                  <div className="ws-flow-block__body">{body}</div>
                                  <div className="ws-resize-h" title="Добавить место снизу" onPointerDown={(event) => onResizeDown(event, block.id)} />
                                  <div className="ws-resize-c" data-axis="x" title="Изменить ширину" onPointerDown={(event) => onResizeDown(event, block.id)} />
                                </div>
                                {Number(blockHeights[block.id]) > geometry.contentHeight ? <p className="ws-clip-warn">Элемент может быть обрезан при печати.</p> : null}
                                {editMode ? (
                                  <div className={`ws-gap${floatMenu === `add:${block.id}` ? " is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
                                    <button type="button" className="ws-gap__btn" aria-label="Добавить блок" onClick={() => setFloatMenu(floatMenu === `add:${block.id}` ? "" : `add:${block.id}`)}>+</button>
                                    {floatMenu === `add:${block.id}` ? (
                                      <div className="ws-float__menu">
                                        <button type="button" onClick={() => { insertAfter(block.id, "short_answer"); setFloatMenu(""); }}>Задание</button>
                                        <button type="button" onClick={() => { insertAfter(block.id, "image_question"); setFloatMenu(""); }}>Изображение</button>
                                        <button type="button" onClick={() => { insertAfter(block.id, "text"); setFloatMenu(""); }}>Текст</button>
                                        <button type="button" onClick={() => { insertAfter(block.id, "heading"); setFloatMenu(""); }}>Раздел</button>
                                        <button type="button" onClick={() => { insertAfter(block.id, "reference"); setFloatMenu(""); }}>Справка</button>
                                        <button type="button" onClick={() => { insertAfter(block.id, "fact"); setFloatMenu(""); }}>Факт</button>
                                        <button type="button" onClick={() => { insertAfter(block.id, "table"); setFloatMenu(""); }}>Таблица</button>
                                        <button type="button" onClick={() => { insertAfter(block.id, "function_graph"); setFloatMenu(""); }}>График</button>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                            };
                            if (columnCount > 1) {
                              return (
                                <div className="ws-grid-flow">
                                  {cells.map((cell) => (
                                    <div
                                      key={cell.block.id}
                                      className="ws-grid-cell"
                                      style={{ gridRow: cell.row, gridColumn: `${cell.col} / span ${cell.span}` }}
                                    >
                                      {renderBlock(cell.block)}
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return <div className="ws-stack">{pageBlocks.map(renderBlock)}</div>;
                          })() : <p className="ws-empty-page">Пустая страница. Добавьте задание.</p>}
                        </div>
                        <div className="ws-page-no">{pageIndex + 1}</div>
                        {showWatermark ? <p className="ws-watermark">Сделано на Цифровом потоке</p> : null}
                      </div>
                      {editMode ? (
                        <div className="ws-page-tools">
                          <span>Страница {pageIndex + 1}</span>
                          <button type="button" onClick={() => movePage(pageIndex, -1)}>Выше</button>
                          <button type="button" onClick={() => movePage(pageIndex, 1)}>Ниже</button>
                          <button type="button" onClick={() => duplicatePage(pageIndex)}>Дублировать</button>
                          <button type="button" onClick={() => deletePage(pageIndex)}>Удалить страницу</button>
                        </div>
                      ) : <p className="ws-page-tools">Страница {pageIndex + 1}</p>}
                    </div>
                  ))}
                  {editMode ? <button type="button" className="ws-add-page" onClick={addPage}>Добавить страницу</button> : null}
                </div>
              </div>
            </div>
          </div>
          )}
        </section>

        <aside className="ws-side ws-side--right">
          <div className="ws-side__scroll">
            {editMode && sheetBlocks.find((block) => block.id === selectedId)?.type === "task" ? (
              <InspectorTask
                subject={form.subject}
                block={sheetBlocks.find((block) => block.id === selectedId)}
                onChange={(next) => patchBlock(selectedId, { task: next })}
                onLevel={(level) => setTaskLevel(selectedId, level)}
                onSkill={(skill) => patchBlock(selectedId, { skill })}
                onPoints={(points) => patchBlock(selectedId, { points })}
                onFlags={(flags) => patchBlock(selectedId, flags)}
                onType={(nextType) => setTaskType(selectedId, nextType)}
                onWork={(workArea) => patchBlock(selectedId, { workArea })}
                onDuplicate={() => addSimilar(sheetBlocks.find((block) => block.id === selectedId))}
                onEasier={() => replaceFromBank(sheetBlocks.find((block) => block.id === selectedId), "easier")}
                onHarder={() => replaceFromBank(sheetBlocks.find((block) => block.id === selectedId), "harder")}
                onUp={() => moveBlock(selectedId, -1)}
                onDown={() => moveBlock(selectedId, 1)}
                onDelete={() => removeTask(selectedId)}
                focus={sheetFocus?.blockId === selectedId ? sheetFocus : null}
                onFocus={(focus) => setSheetFocus({ blockId: selectedId, ...focus })}
              />
            ) : null}
            {editMode && NOTE_BLOCKS[sheetBlocks.find((block) => block.id === selectedId)?.type] ? (
              <InspectorSection
                block={sheetBlocks.find((block) => block.id === selectedId)}
                onChange={(patch) => patchBlock(selectedId, patch)}
                onUp={() => moveBlock(selectedId, -1)}
                onDown={() => moveBlock(selectedId, 1)}
                onDelete={() => removeTask(selectedId)}
              />
            ) : null}
            {editMode && (selectedId === "sheet-title" || selectedId === "sheet-goal") ? (
              <section className="ws-inspector ws-sheet-props">
                <header className="ws-hero-head"><h2>{selectedId === "sheet-title" ? "Заголовок листа" : "Цель занятия"}</h2><span>шапка листа</span></header>
                {selectedId === "sheet-title" ? (
                  <label className="ws-field"><span className="ws-label">Название</span><input value={form.topic} onChange={(event) => setForm((current) => ({ ...current, topic: event.target.value }))} /></label>
                ) : (
                  <label className="ws-field"><span className="ws-label">Сегодня тренируем</span><textarea value={form.goal} onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))} /></label>
                )}
                <label className="ws-check">
                  <input type="checkbox" checked={form.studentLine !== false} onChange={(event) => setForm((current) => ({ ...current, studentLine: event.target.checked }))} />
                  <span>Строка ученика — ФИО, класс и дата</span>
                </label>
              </section>
            ) : null}
            {editMode && !selectedId ? (
              <section className="ws-inspector">
                <header className="ws-hero-head">
                  <h2>Свойства</h2>
                  <span>ничего не выбрано</span>
                </header>
                <label className="ws-check">
                  <input type="checkbox" checked={form.studentLine !== false} onChange={(event) => setForm((current) => ({ ...current, studentLine: event.target.checked }))} />
                  <span>Строка ученика — ФИО, класс и дата</span>
                </label>
                <p className="ws-inspector__hint">Выберите задание или заголовок на листе. Его настройки появятся здесь.</p>
              </section>
            ) : null}
            {!editMode ? (
            <section className="ws-inspector">
            <header className="ws-hero-head">
              <h2>Перед сборкой</h2>
              <span>быстрая проверка листа</span>
            </header>
            <div className="ws-fold is-static">
              <span className="ws-fold__title">Методическая проверка</span>
              <div className="ws-checkline"><span>Цель и задания</span><span className="ws-ok">{form.topic && form.goal ? "согласовано" : "уточните тему"}</span></div>
              <div className="ws-checkline"><span>Сложность</span><span className="ws-ok">плавная</span></div>
              <div className="ws-checkline"><span>Повторы</span><span className="ws-ok">нет</span></div>
              <div className="ws-checkline"><span>Время</span><span>≈ {minutes} минут</span></div>
            </div>
            <div className="ws-fold is-static">
              <span className="ws-fold__title">Структура листа</span>
              <div className="ws-flow">
                {GROUPS.map((group, index) => {
                  const count = previewTasks.filter((task) => task.groupId === group.id).length;
                  return (
                    <div key={group.id} className="ws-flow-item">
                      <span className="ws-flow-num">{index + 1}</span>
                      <span className="ws-flow-copy"><strong>{group.structure}</strong><em>{group.detail}</em></span>
                      <b>{count}</b>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="ws-fold is-static">
              <span className="ws-fold__title">После сборки</span>
              <p className="ws-inspector__hint">Лист уже можно править: заменить задание, добавить блок или изменить оформление без повторной генерации.</p>
            </div>
            </section>
            ) : null}
          </div>
        </aside>
      </div>
      {toast ? <div className="ws-toast">{toast}</div> : null}
    </div>
  );
}
