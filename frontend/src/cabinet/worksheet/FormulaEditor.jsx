import { useEffect, useRef, useState } from "react";

const EQ_TABS = [
  {
    id: "struct",
    label: "Структура",
    items: [
      { tex: "\\frac{a}{b}", insert: "\\frac{#}{#}", name: "Дробь" },
      { tex: "\\dfrac{a}{b}", insert: "\\dfrac{#}{#}", name: "Крупная дробь" },
      { tex: "\\sqrt{x}", insert: "\\sqrt{#}", name: "Корень" },
      { tex: "\\sqrt[n]{x}", insert: "\\sqrt[#]{#}", name: "Корень n-й степени" },
      { tex: "x^{n}", insert: "^{#}", name: "Степень" },
      { tex: "x_{n}", insert: "_{#}", name: "Индекс" },
      { tex: "x_{i}^{n}", insert: "_{#}^{#}", name: "Индекс и степень" },
      { tex: "|x|", insert: "\\left|#\\right|", name: "Модуль" },
      { tex: "\\lfloor x\\rfloor", insert: "\\lfloor #\\rfloor", name: "Целая часть" },
      { tex: "\\lceil x\\rceil", insert: "\\lceil #\\rceil", name: "Потолок" },
      { tex: "\\overline{AB}", insert: "\\overline{#}", name: "Черта сверху" },
      { tex: "\\vec{a}", insert: "\\vec{#}", name: "Вектор" },
      { tex: "\\hat{a}", insert: "\\hat{#}", name: "Крышка" },
      { tex: "\\widetilde{a}", insert: "\\widetilde{#}", name: "Волна" },
      { tex: "\\binom{n}{k}", insert: "\\binom{#}{#}", name: "Бином" },
      { tex: "\\left(x\\right)", insert: "\\left(#\\right)", name: "Скобки" },
      { tex: "\\left[x\\right]", insert: "\\left[#\\right]", name: "Квадратные скобки" },
      { tex: "\\left\\{x\\right\\}", insert: "\\left\\{#\\right\\}", name: "Фигурные скобки" },
    ],
  },
  {
    id: "algebra",
    label: "Алгебра",
    items: [
      { tex: "\\log_{a} b", insert: "\\log_{#}{#}", name: "Логарифм" },
      { tex: "\\log_2 32", insert: "\\log_{2}{#}", name: "Логарифм по основанию 2" },
      { tex: "\\ln x", insert: "\\ln #", name: "Натуральный логарифм" },
      { tex: "\\lg x", insert: "\\lg #", name: "Десятичный логарифм" },
      { tex: "e^{x}", insert: "e^{#}", name: "Экспонента" },
      { tex: "a^{\\log_b c}", insert: "^{\\log_{#}{#}}", name: "Степень с логарифмом" },
      { tex: "\\pm", insert: "\\pm ", name: "Плюс-минус" },
      { tex: "\\mp", insert: "\\mp ", name: "Минус-плюс" },
      { tex: "\\cdot", insert: "\\cdot ", name: "Умножение" },
      { tex: "\\times", insert: "\\times ", name: "Косой крест" },
      { tex: "\\div", insert: "\\div ", name: "Деление" },
      { tex: "\\circ", insert: "\\circ ", name: "Композиция" },
      { tex: "\\ldots", insert: "\\ldots", name: "Многоточие" },
      { tex: "\\cdots", insert: "\\cdots", name: "Центральное многоточие" },
    ],
  },
  {
    id: "trig",
    label: "Тригонометрия",
    items: [
      { tex: "\\sin x", insert: "\\sin #", name: "Синус" },
      { tex: "\\cos x", insert: "\\cos #", name: "Косинус" },
      { tex: "\\tan x", insert: "\\tan #", name: "Тангенс" },
      { tex: "\\cot x", insert: "\\cot #", name: "Котангенс" },
      { tex: "\\arcsin x", insert: "\\arcsin #", name: "Арксинус" },
      { tex: "\\arccos x", insert: "\\arccos #", name: "Арккосинус" },
      { tex: "\\arctan x", insert: "\\arctan #", name: "Арктангенс" },
      { tex: "\\sin^2 x", insert: "\\sin^{2} #", name: "Синус в квадрате" },
      { tex: "\\cos^2 x", insert: "\\cos^{2} #", name: "Косинус в квадрате" },
      { tex: "\\sinh x", insert: "\\sinh #", name: "Гиперболический синус" },
      { tex: "\\cosh x", insert: "\\cosh #", name: "Гиперболический косинус" },
      { tex: "\\deg", insert: "^{\\circ}", name: "Градус" },
    ],
  },
  {
    id: "calc",
    label: "Анализ",
    items: [
      { tex: "\\lim_{x \\to 0}", insert: "\\lim_{# \\to #}", name: "Предел" },
      { tex: "\\sum_{i=1}^{n}", insert: "\\sum_{#}^{#}", name: "Сумма" },
      { tex: "\\prod_{i=1}^{n}", insert: "\\prod_{#}^{#}", name: "Произведение" },
      { tex: "\\int_{a}^{b}", insert: "\\int_{#}^{#} # \\, dx", name: "Интеграл" },
      { tex: "\\oint", insert: "\\oint_{#} # \\, dx", name: "Контурный интеграл" },
      { tex: "\\frac{d}{dx}", insert: "\\frac{d}{d#}", name: "Производная" },
      { tex: "\\frac{\\partial}{\\partial x}", insert: "\\frac{\\partial #}{\\partial #}", name: "Частная производная" },
      { tex: "f'(x)", insert: "#'", name: "Штрих" },
      { tex: "\\nabla", insert: "\\nabla ", name: "Набла" },
      { tex: "\\infty", insert: "\\infty", name: "Бесконечность" },
    ],
  },
  {
    id: "greek",
    label: "Греческие",
    items: [
      "\\alpha", "\\beta", "\\gamma", "\\delta", "\\varepsilon", "\\theta", "\\lambda", "\\mu", "\\pi", "\\rho", "\\sigma", "\\phi", "\\omega",
      "\\Gamma", "\\Delta", "\\Theta", "\\Lambda", "\\Pi", "\\Sigma", "\\Phi", "\\Omega",
    ].map((tex) => ({ tex, insert: `${tex} `, name: tex.replace("\\", "") })),
  },
  {
    id: "signs",
    label: "Знаки",
    items: [
      { tex: "\\leq", insert: "\\leq ", name: "Меньше или равно" },
      { tex: "\\geq", insert: "\\geq ", name: "Больше или равно" },
      { tex: "\\neq", insert: "\\neq ", name: "Не равно" },
      { tex: "\\approx", insert: "\\approx ", name: "Приближённо" },
      { tex: "\\equiv", insert: "\\equiv ", name: "Тождественно" },
      { tex: "\\sim", insert: "\\sim ", name: "Подобно" },
      { tex: "\\propto", insert: "\\propto ", name: "Пропорционально" },
      { tex: "\\in", insert: "\\in ", name: "Принадлежит" },
      { tex: "\\notin", insert: "\\notin ", name: "Не принадлежит" },
      { tex: "\\subset", insert: "\\subset ", name: "Подмножество" },
      { tex: "\\subseteq", insert: "\\subseteq ", name: "Подмножество или равно" },
      { tex: "\\cup", insert: "\\cup ", name: "Объединение" },
      { tex: "\\cap", insert: "\\cap ", name: "Пересечение" },
      { tex: "\\emptyset", insert: "\\emptyset", name: "Пустое множество" },
      { tex: "\\mathbb{R}", insert: "\\mathbb{R}", name: "Действительные" },
      { tex: "\\mathbb{N}", insert: "\\mathbb{N}", name: "Натуральные" },
      { tex: "\\mathbb{Z}", insert: "\\mathbb{Z}", name: "Целые" },
      { tex: "\\mathbb{Q}", insert: "\\mathbb{Q}", name: "Рациональные" },
      { tex: "\\to", insert: "\\to ", name: "Стрелка" },
      { tex: "\\Rightarrow", insert: "\\Rightarrow ", name: "Следует" },
      { tex: "\\Leftrightarrow", insert: "\\Leftrightarrow ", name: "Равносильно" },
      { tex: "\\forall", insert: "\\forall ", name: "Для всех" },
      { tex: "\\exists", insert: "\\exists ", name: "Существует" },
    ],
  },
  {
    id: "matrix",
    label: "Матрицы",
    items: [
      { tex: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", insert: "\\begin{pmatrix}# & # \\\\ # & #\\end{pmatrix}", name: "Матрица 2×2" },
      { tex: "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}", insert: "\\begin{vmatrix}# & # \\\\ # & #\\end{vmatrix}", name: "Определитель 2×2" },
      { tex: "\\begin{cases}x, & a\\\\y, & b\\end{cases}", insert: "\\begin{cases}#, & # \\\\ #, & #\\end{cases}", name: "Система" },
    ],
  },
];

function insertTemplate(value, start, end, template) {
  const selected = value.slice(start, end);
  let filled = template;
  if (selected && filled.includes("#")) filled = filled.replace("#", selected);
  const chunks = filled.split("#");
  const inserted = chunks.join("");
  return {
    next: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
    cursor: start + chunks[0].length,
  };
}

function nextEmptyGroup(text, from) {
  const match = text.slice(from).match(/\{\s*\}/);
  if (!match) return null;
  const inner = from + match.index + 1;
  return { start: inner, end: inner };
}

function typesetNode(node, wrapped) {
  if (!node) return undefined;
  node.innerHTML = "";
  if (!wrapped) {
    node.textContent = "Предпросмотр появится здесь";
    return undefined;
  }
  node.textContent = wrapped;
  const mj = window.MathJax;
  if (!mj?.typesetPromise) return undefined;
  let cancelled = false;
  const run = () => {
    if (!cancelled) mj.typesetPromise([node]).catch(() => {});
  };
  const startup = mj.startup?.promise;
  if (startup?.then) startup.then(run).catch(run);
  else run();
  return () => { cancelled = true; };
}

export default function FormulaEditor({ value, onChange, onApply, onClose, embedded = false }) {
  const previewRef = useRef(null);
  const paletteRef = useRef(null);
  const inputRef = useRef(null);
  const cursorRef = useRef(null);
  const [tab, setTab] = useState("struct");
  const [display, setDisplay] = useState(false);
  const items = EQ_TABS.find((item) => item.id === tab)?.items || [];
  const wrapped = value.trim() ? (display ? `\\[${value.trim()}\\]` : `\\(${value.trim()}\\)`) : "";

  useEffect(() => typesetNode(previewRef.current, wrapped), [wrapped]);

  useEffect(() => {
    const root = paletteRef.current;
    const mj = window.MathJax;
    if (!root || !mj?.typesetPromise) return undefined;
    let cancelled = false;
    const run = () => {
      if (!cancelled) mj.typesetPromise([root]).catch(() => {});
    };
    const startup = mj.startup?.promise;
    if (startup?.then) startup.then(run).catch(run);
    else run();
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    const node = inputRef.current;
    const pos = cursorRef.current;
    if (node && pos != null) {
      node.focus();
      node.setSelectionRange(pos, pos);
      cursorRef.current = null;
    }
  }, [value]);

  useEffect(() => {
    const node = inputRef.current;
    if (node) {
      const end = node.value.length;
      node.focus();
      node.setSelectionRange(end, end);
    }
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (value.trim()) onApply(display);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onApply, onClose, value, display]);

  const applyInsert = (template) => {
    const node = inputRef.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const result = insertTemplate(value, start, end, template);
    cursorRef.current = result.cursor;
    onChange(result.next);
  };

  const jumpGap = (event) => {
    if (event.key !== "Tab") return;
    const node = inputRef.current;
    if (!node) return;
    const found = nextEmptyGroup(value, node.selectionStart) || nextEmptyGroup(value, 0);
    if (!found) return;
    event.preventDefault();
    node.setSelectionRange(found.start, found.end);
  };

  return (
    <div className={embedded ? "ws-eq ws-eq--inline" : "ws-eq"} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (!embedded && event.target === event.currentTarget) onClose(); }}>
      <div className="ws-eq__card" role="dialog" aria-label="Редактор формул">
        <header className="ws-eq__head">
          <div>
            <strong>Редактор формул</strong>
            <span>Шаблоны, живой предпросмотр и LaTeX. Tab — следующая скобка.</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="ws-eq__preview" ref={previewRef} />
        <div className="ws-eq__tabs" role="tablist">
          {EQ_TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-on" : ""} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div key={tab} className="ws-eq__grid" ref={paletteRef}>
          {items.map((item) => (
            <button key={item.name} type="button" title={item.name} onClick={() => applyInsert(item.insert)}>
              {`\\(${item.tex}\\)`}
            </button>
          ))}
        </div>
        <label className="ws-eq__source">
          <span>Код LaTeX</span>
          <textarea
            ref={inputRef}
            value={value}
            spellCheck={false}
            placeholder="\log_2 32"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={jumpGap}
          />
        </label>
        <footer className="ws-eq__foot">
          <div className="ws-eq__mode">
            <button type="button" className={!display ? "is-on" : ""} onClick={() => setDisplay(false)}>В строке</button>
            <button type="button" className={display ? "is-on" : ""} onClick={() => setDisplay(true)}>Отдельной строкой</button>
          </div>
          <button type="button" onClick={() => onChange("")}>Очистить</button>
          <button type="button" className="ws-eq__apply" disabled={!value.trim()} onClick={() => onApply(display)}>Вставить</button>
        </footer>
      </div>
    </div>
  );
}
