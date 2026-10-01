const LEGACY_TYPES = {
  short: "short_answer",
  lines: "solution",
  choice: "single_choice",
  match: "matching",
  gap: "fill_blank",
  error: "find_error",
  table: "table",
  graph: "function_graph",
};

let seq = 0;
export function uid(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

function questionOf(task) {
  return task?.question || task?.q || "";
}

export const TASK_TYPE_GROUPS = [
  {
    id: "quick",
    label: "Быстрый ответ",
    types: ["short_answer", "image_question", "single_choice", "fill_blank"],
  },
  {
    id: "work",
    label: "Развёрнутая работа",
    types: ["solution", "find_error", "text_questions"],
  },
  {
    id: "structure",
    label: "Структурирование",
    types: ["matching", "sorting", "classification", "table"],
  },
  {
    id: "visual",
    label: "Математика и визуализация",
    types: ["function_graph", "coordinate_plane", "unit_circle", "expression", "plane", "solid"],
  },
];

function base(type, extra = {}) {
  const question = extra.question ?? "";
  return {
    type,
    question,
    q: extra.q ?? question,
    content: extra.content || {},
    answer: extra.answer || {},
    teacher_settings: extra.teacher_settings || {},
    student_settings: extra.student_settings || {},
  };
}

export const TASK_TYPE_REGISTRY = {
  short_answer: {
    id: "short_answer",
    label: "Короткий ответ",
    hint: "Вставить недостающее значение или число",
    create: () => base("short_answer", {
      content: { answerKind: "number", tolerance: 0, caseInsensitive: true, ignoreSpaces: true },
      answer: { values: [""] },
    }),
    migrate(task) {
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      if (task?.answer) created.answer.values = [String(task.answer)];
      if (task?.content) return { ...created, ...task, type: "short_answer", q: task.question || task.q || created.q };
      return created;
    },
    validate(task) {
      const values = (task.answer?.values || []).map((item) => String(item).trim()).filter(Boolean);
      return values.length ? [] : ["Укажите хотя бы один правильный ответ."];
    },
  },
  solution: {
    id: "solution",
    label: "Решение",
    hint: "Ученик показывает ход решения",
    create: () => base("solution", {
      content: { lines: "4", showWork: true, showAnswer: true, checkMode: "manual" },
      answer: { final: "", solution: "" },
    }),
    migrate(task) {
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      created.answer.final = task?.answer || task?.answer?.final || "";
      created.answer.solution = task?.solution || task?.answer?.solution || "";
      if (task?.content?.lines) return { ...created, ...task, type: "solution", q: created.question };
      return created;
    },
    validate(task) {
      return String(task.answer?.final || "").trim() ? [] : ["Укажите правильный конечный ответ."];
    },
  },
  single_choice: {
    id: "single_choice",
    label: "Выбор ответа",
    hint: "Один или несколько верных вариантов",
    create: () => base("single_choice", {
      content: { multiple: false, shuffle: true },
      answer: {
        options: ["Вариант 1", "Вариант 2", "Вариант 3"].map((text, index) => ({
          id: uid("opt"),
          label: String.fromCharCode(65 + index),
          text,
          correct: index === 0,
        })),
      },
    }),
    migrate(task) {
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      if (Array.isArray(task?.options) && task.options.length) {
        created.answer.options = task.options.map((text, index) => ({
          id: uid("opt"),
          label: String.fromCharCode(65 + index),
          text: String(text).replace(/^[А-ГA-D]\.\s*/, ""),
          correct: false,
        }));
        const raw = String(task.answer || "").trim().charAt(0);
        const mark = { А: "A", Б: "B", В: "C", Г: "D" }[raw] || raw;
        created.answer.options.forEach((option) => {
          option.correct = option.label === mark;
        });
      }
      if (task?.answer?.options) return { ...task, type: "single_choice", q: questionOf(task) };
      return created;
    },
    validate(task) {
      const options = task.answer?.options || [];
      const errors = [];
      if (options.length < 2) errors.push("Добавьте минимум два варианта.");
      const correct = options.filter((item) => item.correct).length;
      if (!correct) errors.push("Отметьте хотя бы один правильный ответ.");
      if (!task.content?.multiple && correct > 1) errors.push("В режиме одного ответа правильным может быть только один вариант.");
      return errors;
    },
  },
  matching: {
    id: "matching",
    label: "Соответствие",
    hint: "Соединить элементы двух групп",
    create: () => {
      const pairs = [1, 2, 3].map((index) => ({
        leftId: uid("L"),
        rightId: uid("R"),
        left: `Элемент ${index}`,
        right: `Вариант ${index}`,
      }));
      return base("matching", {
        content: { shuffleRight: true, reuseRight: false },
        answer: { pairs },
      });
    },
    migrate(task) {
      if (task?.answer?.pairs) return { ...this.create(), ...task, type: "matching", q: questionOf(task) };
      return { ...this.create(), question: questionOf(task) || "Установите соответствие.", q: questionOf(task) || "Установите соответствие." };
    },
    validate(task) {
      const filled = (value, image) => String(value || "").trim() || image;
      const pairs = (task.answer?.pairs || []).filter((pair) => filled(pair.left, pair.leftImage) && filled(pair.right, pair.rightImage));
      return pairs.length >= 2 ? [] : ["Нужны минимум две заполненные пары."];
    },
  },
  fill_blank: {
    id: "fill_blank",
    label: "Пропуски",
    hint: "Вставить недостающие значения",
    create: () => base("fill_blank", {
      content: {
        parts: [{ type: "text", value: "Логарифм числа 32 по основанию 2 равен 5." }],
      },
      answer: { blanks: {} },
    }),
    migrate(task) {
      if (task?.content?.parts) return { ...this.create(), ...task, type: "fill_blank", q: questionOf(task) };
      return { ...this.create(), question: questionOf(task) || "Заполните пропуски.", q: questionOf(task) || "Заполните пропуски." };
    },
    validate(task) {
      const blanks = (task.content?.parts || []).filter((part) => part.type === "blank");
      if (!blanks.length) return ["Вставьте хотя бы один пропуск."];
      return blanks.every((blank) => (task.answer?.blanks?.[blank.id]?.values || []).some((value) => String(value).trim()))
        ? []
        : ["У каждого пропуска должен быть правильный ответ."];
    },
  },
  find_error: {
    id: "find_error",
    label: "Найди ошибку",
    hint: "Найти и исправить ошибочный шаг",
    create: () => base("find_error", {
      question: "Найдите ошибку в решении и исправьте её.",
      content: { revealStep: false },
      answer: {
        steps: [
          { id: uid("step"), text: "2x + 4 = 10", wrong: false },
          { id: uid("step"), text: "2x = 14", wrong: true },
          { id: uid("step"), text: "x = 7", wrong: false },
        ],
        explanation: "",
        correction: "",
      },
    }),
    migrate(task) {
      const created = this.create();
      if (task?.answer?.steps) return { ...created, ...task, type: "find_error", q: questionOf(task) || created.question };
      created.q = created.question;
      return created;
    },
    validate(task) {
      const errors = [];
      const steps = (task.answer?.steps || []).filter((step) => step.text.trim());
      if (!steps.length) errors.push("Добавьте ошибочное решение по шагам.");
      if (!steps.some((step) => step.wrong)) errors.push("Отметьте шаг, в котором ошибка.");
      if (!String(task.answer?.explanation || task.answer?.correction || "").trim()) {
        errors.push("Добавьте правильное объяснение или решение.");
      }
      return errors;
    },
  },
  table: {
    id: "table",
    label: "Таблица",
    hint: "Таблица с данными и клетками для ответа",
    create: () => base("table", {
      content: { headerRow: false, headerCol: false, rows: 3, cols: 3 },
      answer: {
        cells: Array.from({ length: 9 }, (_, index) => ({
          id: `c${index}`,
          kind: "given",
          value: "",
          correct: "",
        })),
      },
    }),
    migrate(task) {
      if (task?.answer?.cells) return { ...this.create(), ...task, type: "table", q: questionOf(task) };
      return { ...this.create(), question: questionOf(task) || "Заполните таблицу.", q: questionOf(task) || "Заполните таблицу." };
    },
    validate(task) {
      return (task.answer?.cells || []).length ? [] : ["Таблица не должна быть пустой."];
    },
  },
  function_graph: {
    id: "function_graph",
    label: "График функции",
    hint: "Построение и анализ функции",
    create: () => base("function_graph", {
      question: "Постройте график функции.",
      content: {
        expression: "sin(x)",
        showFormula: true,
        showGraph: true,
        showPoints: false,
        showPlane: true,
        showGrid: true,
        viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
      },
      answer: { points: [] },
    }),
    migrate(task) {
      const created = this.create();
      if (task?.content?.expression) return { ...created, ...task, type: "function_graph", q: questionOf(task) || created.question };
      created.q = questionOf(task) || created.question;
      created.question = created.q;
      return created;
    },
    validate(task) {
      return sampleFunction(task.content?.expression, 0) == null ? ["Функция должна быть вычислимой, например x^2 - 4*x + 3."] : [];
    },
  },
  unit_circle: {
    id: "unit_circle",
    label: "Тригонометрическая окружность",
    hint: "Угол на единичной окружности: синус, косинус, тангенс и котангенс",
    subjects: ["Математика"],
    create: () => base("unit_circle", {
      question: "Найдите синус и косинус отмеченного угла.",
      content: {
        angle: 30,
        unit: "rad",
        showAxes: true,
        showAngles: true,
        showSin: false,
        showCos: false,
        showTan: false,
        showCot: false,
        showValues: false,
      },
      answer: { value: "cos = √3/2, sin = 1/2" },
    }),
    migrate(task) {
      const created = this.create();
      if (task?.type === "unit_circle" && task?.content) return { ...created, ...task, type: "unit_circle", q: questionOf(task) || created.question };
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate() { return []; },
  },
  coordinate_plane: {
    id: "coordinate_plane",
    label: "Координатная плоскость",
    hint: "Точки, отрезки и фигуры без готовой функции",
    create: () => base("coordinate_plane", {
      question: "Отметьте точки на координатной плоскости.",
      content: { viewport: { xMin: -6, xMax: 6, yMin: -6, yMax: 6 } },
      answer: { objects: [{ id: uid("obj"), kind: "point", label: "A", x: 2, y: 3, visibleToStudent: true }] },
    }),
    migrate(task) {
      if (task?.answer?.objects) return { ...this.create(), ...task, type: "coordinate_plane", q: questionOf(task) };
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate() { return []; },
  },
  expression: {
    id: "expression",
    label: "Формула / выражение",
    hint: "Вычислить или упростить выражение",
    create: () => base("expression", {
      question: "Вычислите",
      content: { latex: "\\frac{x^2-4}{x-2}" },
      answer: { value: "" },
    }),
    migrate(task) {
      const created = this.create();
      if (task?.content?.latex) return { ...created, ...task, type: "expression", q: questionOf(task) };
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate(task) {
      return String(task.content?.latex || "").trim() ? [] : ["Введите формулу."];
    },
  },
  sorting: {
    id: "sorting",
    label: "Расположить по порядку",
    hint: "Выстроить элементы в нужной последовательности",
    create: () => base("sorting", {
      question: "Расположите числа по возрастанию.",
      content: { direction: "asc" },
      answer: { items: ["Первый элемент", "Второй элемент", "Третий элемент"].map((text) => ({ id: uid("s"), text })) },
    }),
    migrate(task) {
      if (task?.answer?.items) return { ...this.create(), ...task, type: "sorting", q: questionOf(task) };
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate(task) {
      return (task.answer?.items || []).filter((item) => item.text.trim()).length >= 2
        ? []
        : ["Нужны минимум два элемента."];
    },
  },
  classification: {
    id: "classification",
    label: "Классификация",
    hint: "Распределить элементы по группам",
    create: () => base("classification", {
      question: "Распределите выражения по группам.",
      content: { categories: [{ id: "cat_a", title: "Группа 1" }, { id: "cat_b", title: "Группа 2" }] },
      answer: { items: [{ id: uid("el"), text: "Элемент 1", categoryId: "cat_a" }, { id: uid("el"), text: "Элемент 2", categoryId: "cat_b" }] },
    }),
    migrate(task) {
      if (task?.answer?.items && task?.content?.categories) return { ...task, type: "classification", q: questionOf(task) };
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate(task) {
      const errors = [];
      if ((task.content?.categories || []).length < 2) errors.push("Нужны минимум две категории.");
      if (!(task.answer?.items || []).some((item) => String(item.text || "").trim() || item.image)) errors.push("Добавьте хотя бы один элемент.");
      return errors;
    },
  },
  text_questions: {
    id: "text_questions",
    label: "Текст + вопросы",
    hint: "Один источник и несколько вопросов к нему",
    create: () => base("text_questions", {
      question: "Прочитайте текст и ответьте на вопросы.",
      content: { stimulus: "" },
      answer: { questions: [{ id: uid("sq"), prompt: "", answer: "" }] },
    }),
    migrate(task) {
      if (task?.content?.stimulus != null && task?.answer?.questions) return { ...task, type: "text_questions", q: questionOf(task) };
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate(task) {
      return (task.answer?.questions || []).some((item) => item.prompt.trim()) ? [] : ["Добавьте хотя бы один вопрос."];
    },
  },
  plane: {
    id: "plane",
    label: "Планиметрия",
    hint: "Треугольник, четырёхугольники, окружность и угол",
    create: () => base("plane", {
      question: "Найдите площадь фигуры.",
      content: { figures: [{ id: uid("plane"), kind: "triangle", a: 6, h: 4 }] },
      answer: { value: "" },
    }),
    migrate(task) {
      if (task?.type === "plane" && task?.content?.figures) return { ...task, type: "plane", q: questionOf(task) };
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate(task) {
      return (task.content?.figures || []).length ? [] : ["Добавьте хотя бы одну фигуру."];
    },
  },
  solid: {
    id: "solid",
    label: "Стереометрия",
    hint: "Куб, призма, пирамида, цилиндр, конус и шар",
    create: () => base("solid", {
      question: "Найдите объём фигуры.",
      content: { figures: [{ id: uid("solid"), kind: "cube", a: 4 }] },
      answer: { value: "" },
    }),
    migrate(task) {
      if (task?.content?.figures) return { ...task, type: "solid", q: questionOf(task) };
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate(task) {
      return (task.content?.figures || []).length ? [] : ["Добавьте хотя бы одну фигуру."];
    },
  },
  image_question: {
    id: "image_question",
    label: "Изображение + вопрос",
    hint: "Вопрос по рисунку или схеме",
    create: () => base("image_question", {
      question: "Ответьте по изображению.",
      content: { imageUrl: "", caption: "", width: 100 },
      answer: { value: "" },
    }),
    migrate(task) {
      if (task?.content && "imageUrl" in (task.content || {})) return { ...task, type: "image_question", q: questionOf(task) };
      const created = this.create();
      created.question = questionOf(task) || created.question;
      created.q = created.question;
      return created;
    },
    validate(task) {
      return task.content?.imageUrl ? [] : ["Загрузите изображение."];
    },
  },
};

export function canonicalType(type) {
  return LEGACY_TYPES[type] || (TASK_TYPE_REGISTRY[type] ? type : "short_answer");
}

export function getTaskSpec(type) {
  return TASK_TYPE_REGISTRY[canonicalType(type)];
}

export function normalizeTask(task = {}) {
  const type = canonicalType(task.type);
  const spec = TASK_TYPE_REGISTRY[type];
  if (task.type === type && task.content && task.answer) {
    return { ...task, q: task.q || task.question || "" };
  }
  return spec.migrate({ ...task, type });
}

export function createTask(type) {
  const spec = getTaskSpec(type);
  const task = spec.create();
  task.q = task.question;
  return task;
}

export function evalSafe(expression, x) {
  const value = sampleFunction(expression, x);
  return value;
}

export function sampleFunction(expression, x) {
  const source = String(expression || "").trim();
  if (!source) return null;
  const js = source
    .replace(/π/g, "Math.PI")
    .replace(/\bpi\b/g, "Math.PI")
    .replace(/\bsin\b/g, "Math.sin")
    .replace(/\bcos\b/g, "Math.cos")
    .replace(/\btan\b/g, "Math.tan")
    .replace(/\bsqrt\b/g, "Math.sqrt")
    .replace(/\babs\b/g, "Math.abs")
    .replace(/\^/g, "**");
  if (!/^[\d\s+\-*/().,xMathsincopqrtabPI]+$/.test(js)) return null;
  try {
    const value = Function(`"use strict"; const x = ${Number(x)}; return (${js});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
