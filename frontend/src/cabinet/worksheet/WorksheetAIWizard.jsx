import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ensureCsrfCookie, getCsrfToken } from "../../utils/cabinetAuth";
import { usePageTitle } from "../hooks/usePageTitle";
import EducationalLoading, { LOADING_MESSAGES } from "../../components/EducationalLoading";
import "../styles/worksheet-ai.css";

const COUNTS = [5, 10, 15, 20];
const DIFFICULTIES = [
  { id: "basic", title: "Базовая" },
  { id: "standard", title: "Стандартная" },
  { id: "advanced", title: "Повышенная" },
  { id: "mixed", title: "Смешанная" },
];
const GOALS = [
  { id: "intro", title: "Знакомство с темой" },
  { id: "practice", title: "Отработка" },
  { id: "review", title: "Повторение" },
  { id: "reinforce", title: "Закрепление" },
  { id: "check", title: "Проверка знаний" },
  { id: "test_prep", title: "Подготовка к контрольной" },
  { id: "exam_prep", title: "Подготовка к экзамену" },
  { id: "other", title: "Другое" },
];
const FORMATS = [
  { id: "training", title: "Тренировка" },
  { id: "homework", title: "Домашняя работа" },
  { id: "independent", title: "Самостоятельная работа" },
  { id: "control", title: "Контрольная работа" },
  { id: "quiz", title: "Проверочная работа" },
  { id: "lesson", title: "Рабочий лист урока" },
  { id: "review", title: "Повторение" },
  { id: "other", title: "Другое" },
];
const WORDING = [
  {
    id: "original",
    title: "Сохранить оригинальные",
    text: "Текст заданий останется без изменений.",
  },
  {
    id: "rephrase",
    title: "Немного переформулировать",
    text: "AI может сделать формулировки более естественными, не меняя смысл.",
  },
  {
    id: "theme",
    title: "Адаптировать под тему",
    text: "AI добавит выбранный сюжет, но сохранит числа, формулы, единицы измерения, ответ и способ решения.",
    careful: true,
  },
];

const READY_STYLES = [
  { id: "whiteboard", title: "Доска", text: "Светлый лист и тонкие акценты по краям." },
  { id: "school", title: "Учебник", text: "Тёплая полоса и спокойные поля." },
  { id: "strict", title: "Бланк", text: "Строгий лист без декора." },
  { id: "minimal", title: "Минимум", text: "Почти пустой лист и тонкая рамка." },
];
const INTENSITY = [
  { id: "light", title: "Лёгкая", text: "Небольшая тематическая подводка." },
  { id: "medium", title: "Средняя", text: "Сюжет встроен в условие." },
  { id: "vivid", title: "Яркая", text: "Весь лист объединён одним сценарием." },
];
const COST_LABELS = {
  base_worksheet_generation: "Сборка листа и готовый стиль",
  task_theme_adaptation: "Адаптация условий",
  task_rewrite: "Переформулировка",
  ai_new_task: "Новые задания",
  ai_design: "AI-оформление",
  theory_block: "Теория",
};

const EMPTY = {
  subject_id: "",
  grade: "7",
  level_id: "",
  topic: "",
  subtopics: [],
  task_count: 10,
  custom_count: "",
  difficulty: "standard",
  goal: "practice",
  goal_text: "",
  format: "training",
  style: "school",
  custom_style: "",
  theme: "",
  wording: "original",
  style_intensity: "light",
  ai_design: false,
  wishes: "",
  wants_theory: false,
  theoryTouched: false,
  theory_detail: "brief",
};

async function api(path, options = {}) {
  await ensureCsrfCookie();
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  const response = await fetch(`/api/cabinet${path}`, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Не удалось выполнить запрос.");
    error.payload = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function plural(count, one, few, many) {
  const value = Math.abs(Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function labelOf(list, id) {
  return list.find((item) => item.id === id)?.title || "";
}

export default function WorksheetAIWizard() {
  usePageTitle("Рабочий лист с AI");
  const navigate = useNavigate();
  const idemRef = useRef("");
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [topicHints, setTopicHints] = useState({ topics: [], subtopics: [] });
  const [topicOpen, setTopicOpen] = useState(false);
  const [subtopicDraft, setSubtopicDraft] = useState("");
  const [step, setStep] = useState("form");
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api("/ai/worksheets/options/")
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setForm((current) => ({
          ...current,
          subject_id: current.subject_id || String(data.subjects?.[0]?.id || ""),
        }));
      })
      .catch((err) => {
        if (!cancelled) setBootError(err.status === 403 || err.status === 401
          ? "Войдите как преподаватель, чтобы создать рабочий лист."
          : err.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!form.subject_id || form.topic.trim().length < 2) {
      setTopicHints({ topics: [], subtopics: [] });
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ subject_id: form.subject_id, q: form.topic.trim() });
      api(`/ai/worksheets/topics/?${query}`)
        .then((data) => setTopicHints(data))
        .catch(() => setTopicHints({ topics: [], subtopics: [] }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [form.subject_id, form.topic]);

  const subject = options?.subjects?.find((item) => String(item.id) === String(form.subject_id));
  const levelIds = options?.subject_levels?.[String(form.subject_id)] || [];
  const levels = (options?.levels || []).filter((item) => levelIds.includes(item.id));
  const summary = [
    `${form.task_count} заданий`,
    form.grade ? `${form.grade} класс` : "",
    form.topic.trim(),
  ].filter(Boolean).join(" · ");

  const theoryDefault = useMemo(() => {
    if (form.format === "control" || form.format === "quiz") return false;
    return form.goal === "intro" || form.format === "lesson";
  }, [form.goal, form.format]);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const addSubtopic = (value) => {
    const text = value.trim();
    if (!text || form.subtopics.includes(text) || form.subtopics.length >= 8) return;
    set({ subtopics: [...form.subtopics, text] });
    setSubtopicDraft("");
  };

  const requestBody = () => ({
    subject_id: Number(form.subject_id),
    grade: form.grade ? Number(form.grade) : "",
    level_id: form.level_id ? Number(form.level_id) : "",
    topic: form.topic.trim(),
    subtopics: form.subtopics,
    task_count: Number(form.task_count),
    difficulty: form.difficulty,
    goal: form.goal,
    goal_text: form.goal_text,
    format: form.format,
    style: form.style || "school",
    custom_style: form.custom_style,
    theme: form.theme,
    wording: form.wording,
    style_intensity: form.style_intensity,
    ai_design: form.ai_design,
    wishes: form.wishes,
    wants_theory: form.theoryTouched ? form.wants_theory : theoryDefault,
    theory_detail: form.theory_detail === "detailed" ? "detailed" : "brief",
  });

  const calculate = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await api("/ai/worksheets/quote/", {
        method: "POST",
        body: JSON.stringify(requestBody()),
      });
      idemRef.current = crypto.randomUUID();
      setQuote(data);
      setStep("review");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    if (!quote?.can_generate) return;
    setError("");
    setLoading(true);
    try {
      const data = await api("/ai/worksheets/generate/", {
        method: "POST",
        body: JSON.stringify({ generation_quote_id: quote.generation_quote_id }),
        headers: { "Idempotency-Key": idemRef.current || crypto.randomUUID() },
      });
      if (!data.worksheet_id) {
        setError(data.warnings?.[0] || "Лист не был создан. Рассчитайте его ещё раз.");
        setQuote(null);
        setStep("form");
        return;
      }
      const inCabinet = window.location.pathname.startsWith("/cabinet");
      const base = inCabinet ? "/cabinet/worksheets" : "/worksheets";
      navigate(`${base}?document=${data.worksheet_id}&charged=${data.charged}`);
    } catch (err) {
      setError(err.message);
      const spent = [
        "GENERATION_FAILED",
        "GENERATION_EMPTY",
        "QUOTE_CONSUMED",
        "AI_UNAVAILABLE",
        "KNOWLEDGE_EMPTY",
        "AI_NOT_CONFIGURED",
      ].includes(err.payload?.code);
      if (spent) {
        setQuote(null);
        setStep("form");
      } else if (err.payload?.balance != null) {
        setQuote((current) => ({ ...current, balance: err.payload.balance, can_generate: false }));
      }
    } finally {
      setLoading(false);
    }
  };

  const backToEditor = () => {
    navigate(window.location.pathname.startsWith("/cabinet") ? "/cabinet/worksheets" : "/worksheets");
  };

  return (
    <div className="wai">
      <header className="wai-top">
        <button type="button" onClick={backToEditor}>К редактору</button>
        <div>
          <h1>Создать рабочий лист с AI</h1>
          <p>Сначала подберём задания и покажем стоимость. Генерация начнётся только после подтверждения.</p>
        </div>
        <span className="wai-balance">{options ? `${options.balance} AI-токенов` : ""}</span>
      </header>

      {bootError ? <div className="wai-error">{bootError}</div> : null}
      {error ? <div className="wai-error">{error}</div> : null}
      {loading ? (
        <EducationalLoading
          message={step === "review" ? LOADING_MESSAGES.worksheet : LOADING_MESSAGES.fetch}
        />
      ) : null}

      {step === "form" ? (
        <div className="wai-layout">
          <div className="wai-main">
            <section>
              <h2>Что изучаем</h2>
              <div className="wai-grid">
                <label>Предмет
                  <select value={form.subject_id} onChange={(event) => set({ subject_id: event.target.value, level_id: "" })}>
                    {(options?.subjects || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>Класс
                  <select value={form.grade} onChange={(event) => set({ grade: event.target.value })}>
                    <option value="">Не выбран</option>
                    {(options?.grades || []).map((grade) => <option key={grade} value={grade}>{grade} класс</option>)}
                  </select>
                </label>
              </div>
              {levels.length ? (
                <label>Уровень платформы
                  <select value={form.level_id} onChange={(event) => set({ level_id: event.target.value })}>
                    <option value="">По классу</option>
                    {levels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              ) : null}
              <label>Тема
                <input
                  value={form.topic}
                  placeholder="Начните вводить тему или напишите свою"
                  onChange={(event) => { set({ topic: event.target.value }); setTopicOpen(true); }}
                  onFocus={() => setTopicOpen(true)}
                />
              </label>
              {topicOpen && topicHints.topics?.length ? (
                <div className="wai-hints">
                  {topicHints.topics.map((item) => (
                    <button key={item} type="button" onClick={() => { set({ topic: item }); setTopicOpen(false); }}>{item}</button>
                  ))}
                </div>
              ) : null}
              <label>Подтемы
                <input
                  value={subtopicDraft}
                  placeholder="Необязательно. Enter — добавить"
                  onChange={(event) => setSubtopicDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addSubtopic(subtopicDraft);
                    }
                  }}
                />
              </label>
              {topicHints.subtopics?.length ? (
                <div className="wai-hints">
                  {topicHints.subtopics.map((item) => (
                    <button key={item} type="button" onClick={() => addSubtopic(item)}>{item}</button>
                  ))}
                </div>
              ) : null}
              {form.subtopics.length ? (
                <div className="wai-chips">
                  {form.subtopics.map((item) => (
                    <button key={item} type="button" onClick={() => set({ subtopics: form.subtopics.filter((value) => value !== item) })}>{item} ×</button>
                  ))}
                </div>
              ) : null}
            </section>

            <section>
              <h2>Какие задания нужны</h2>
              <span className="wai-label">Количество</span>
              <div className="wai-choice">
                {COUNTS.map((count) => (
                  <button key={count} type="button" className={form.task_count === count && !form.custom_count ? "is-on" : ""} onClick={() => set({ task_count: count, custom_count: "" })}>{count}</button>
                ))}
                <input
                  type="number"
                  min="1"
                  max="30"
                  placeholder="Своё"
                  value={form.custom_count}
                  onChange={(event) => set({ custom_count: event.target.value, task_count: Number(event.target.value) || form.task_count })}
                />
              </div>
              <span className="wai-label">Сложность</span>
              <div className="wai-choice">
                {DIFFICULTIES.map((item) => (
                  <button key={item.id} type="button" className={form.difficulty === item.id ? "is-on" : ""} onClick={() => set({ difficulty: item.id })}>{item.title}</button>
                ))}
              </div>
              <p className="wai-note">По умолчанию сложность стандартная. В смешанном листе задания идут от простых к более сложным.</p>
              <div className="wai-grid">
                <label>Цель
                  <select value={form.goal} onChange={(event) => set({ goal: event.target.value })}>
                    {GOALS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                </label>
                <label>Формат
                  <select value={form.format} onChange={(event) => set({ format: event.target.value })}>
                    {FORMATS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                </label>
              </div>
              {form.goal === "other" || form.format === "other" ? (
                <label>Своя формулировка
                  <input value={form.goal_text} onChange={(event) => set({ goal_text: event.target.value })} />
                </label>
              ) : null}
              <span className="wai-label">Условия заданий</span>
              <div className="wai-wording">
                {WORDING.map((item) => (
                  <button key={item.id} type="button" className={`${form.wording === item.id ? "is-on" : ""} ${item.careful ? "is-careful" : ""}`} onClick={() => set({ wording: item.id })}>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
              {form.wording === "theme" ? (
                <>
                  <span className="wai-label">Интенсивность стилизации</span>
                  <div className="wai-wording">
                    {INTENSITY.map((item) => (
                      <button key={item.id} type="button" className={form.style_intensity === item.id ? "is-on" : ""} onClick={() => set({ style_intensity: item.id })}>
                        <strong>{item.title}</strong>
                        <span>{item.text}</span>
                      </button>
                    ))}
                  </div>
                  <p className="wai-note">Во всех трёх режимах числа, формулы, единицы и ответ остаются прежними.</p>
                </>
              ) : null}
              <label className="wai-check">
                <input
                  type="checkbox"
                  checked={form.theoryTouched ? form.wants_theory : theoryDefault}
                  onChange={(event) => set({ wants_theory: event.target.checked, theoryTouched: true })}
                />
                Теоретический блок
              </label>
              {(form.theoryTouched ? form.wants_theory : theoryDefault) ? (
                <div className="wai-wording" role="radiogroup" aria-label="Объём теории">
                  <button type="button" className={form.theory_detail !== "detailed" ? "is-on" : ""} onClick={() => set({ theory_detail: "brief" })}>
                    <strong>Краткая</strong>
                    <span>Определение, правило и один пример.</span>
                  </button>
                  <button type="button" className={form.theory_detail === "detailed" ? "is-on" : ""} onClick={() => set({ theory_detail: "detailed" })}>
                    <strong>Подробная</strong>
                    <span>Правила, несколько примеров и типичная ошибка.</span>
                  </button>
                </div>
              ) : null}
            </section>

            <section>
              <h2>Как оформить</h2>
              <span className="wai-label">Готовый стиль</span>
              <div className="wai-choice" role="radiogroup" aria-label="Готовый стиль">
                {READY_STYLES.map((item) => (
                  <button key={item.id} type="button" className={form.style === item.id ? "is-on" : ""} onClick={() => set({ style: item.id })}>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
              <p className="wai-note">Эти стили не рисуют фон через AI и входят в сборку листа. Свой сюжет ниже может добавить иллюстрацию.</p>
              <label className="wai-check">
                <input type="checkbox" checked={form.ai_design} onChange={(event) => set({ ai_design: event.target.checked })} />
                AI-оформление: модель подберёт заголовки, акценты, плотность и структуру
              </label>
              <label>Тематика / сюжет
                <input value={form.theme} placeholder="Например: космос, осень, без сюжета" onChange={(event) => set({ theme: event.target.value })} />
              </label>
              <p className="wai-note">Сюжет влияет на оформление. Текст заданий меняется только если выбран режим «Адаптировать под тему».</p>
            </section>

            <section>
              <h2>Дополнительные пожелания</h2>
              <label>Что ещё учесть?
                <textarea rows={5} value={form.wishes} placeholder="Добавь в начале короткую теорию. Сделай побольше места для решения. Первые задания простые." onChange={(event) => set({ wishes: event.target.value })} />
              </label>
            </section>
          </div>
          <aside className="wai-side">
            <strong>{summary || "Параметры листа"}</strong>
            <span>{subject?.name || "Предмет"} · {labelOf(DIFFICULTIES, form.difficulty)}</span>
            <button type="button" disabled={loading || !form.subject_id || form.topic.trim().length < 2} onClick={calculate}>
              {loading ? "Считаем…" : "Продолжить"}
            </button>
          </aside>
        </div>
      ) : (
        <section className="wai-review">
          <h2>Рабочий лист готов к созданию</h2>
          <ul>
            <li>{quote?.bank_tasks_selected} {plural(quote?.bank_tasks_selected, "задание найдено", "задания найдено", "заданий найдено")} в банке</li>
            <li>Новых AI-заданий: {quote?.ai_tasks_required || 0}</li>
            {quote?.tasks_to_adapt ? (
              <li>
                {quote.tasks_to_adapt} {plural(quote.tasks_to_adapt, "условие будет адаптировано", "условия будут адаптированы", "условий будут адаптированы")}
              </li>
            ) : null}
            {quote?.tasks_to_rewrite ? (
              <li>
                {quote.tasks_to_rewrite} {plural(quote.tasks_to_rewrite, "условие будет слегка переформулировано", "условия будут слегка переформулированы", "условий будут слегка переформулированы")}
              </li>
            ) : null}
            {!quote?.tasks_to_adapt && !quote?.tasks_to_rewrite ? <li>Изменяемых условий: 0</li> : null}
            {quote?.tasks_not_themable ? (
              <li>
                {quote.tasks_not_themable} {plural(quote.tasks_not_themable, "останется без изменений, потому что его нежелательно тематизировать", "останутся без изменений, потому что их нежелательно тематизировать", "останутся без изменений, потому что их нежелательно тематизировать")}
              </li>
            ) : null}
            <li>{quote?.ai_design ? "AI-оформление: включено" : `Оформление: ${labelOf(READY_STYLES, form.style) || "Учебник"}, без AI-фона`}</li>
            {quote?.theory_block ? (
              <li>
                {form.theory_detail === "detailed"
                  ? "Будет добавлен подробный теоретический блок"
                  : "Будет добавлен короткий теоретический блок"}
              </li>
            ) : null}
          </ul>
          {(quote?.breakdown || []).filter((row) => row.amount > 0).length ? (
            <ul className="wai-breakdown">
              {(quote.breakdown || []).filter((row) => row.amount > 0).map((row) => (
                <li key={row.key}>{COST_LABELS[row.key] || row.key}: {row.amount}</li>
              ))}
            </ul>
          ) : null}
          <p className="wai-price">Стоимость: {quote?.estimated_cost} токенов</p>
          <p>Баланс: {quote?.balance} токенов</p>
          {quote?.can_generate ? <p>После генерации останется: {quote?.balance_after}</p> : <p>Не хватает {quote?.shortage} AI-токенов.</p>}
          <div className="wai-review__actions">
            <button type="button" onClick={() => { setStep("form"); setError(""); }}>Изменить параметры</button>
            <button type="button" className="is-primary" disabled={!quote?.can_generate || loading} onClick={generate}>
              {loading ? "Создаём…" : `Сгенерировать за ${quote?.estimated_cost} токенов`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
