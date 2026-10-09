import { Link, Navigate, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { CabinetPageShell } from "../CabinetSectionUi";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  createVariantTheme,
  fetchAdminVariantThemes,
  updateVariantTheme,
  uploadVariantThemeImage,
} from "../../variantThemes/variantThemeApi";
import { DEFAULT_VARIANT_THEME_LABELS, DECORATION_GROUPS, decorationLineKind, VARIANT_THEME_ANIMATIONS, VARIANT_THEME_LAYOUTS } from "../../variantThemes/registry";
import DecorationSample, { ANIMATION_LABELS, DECORATION_LABELS } from "../../variantThemes/DecorationSample";
import ThemeDecorations from "../../variantThemes/ThemeDecorations";
import ThemeEffects from "../../variantThemes/ThemeEffects";
import {
  GRADIENT_DIRECTIONS,
  blockBackgroundStyle,
  normalizeHex,
  orientedImageUrl,
  pageBackgroundStyle,
  pageContrastWarning,
} from "../../variantThemes/themeSurface";
import "../../variantThemes/variant-themes.css";
import "../styles/theme-editor.css";

const IMAGE_FIELDS = [
  "preview_image",
  "background_image",
  "background_image_vertical",
  "block_background_image",
  "sheet_background_image",
  "sheet_background_image_vertical",
];

const PAGE_IMAGES = [
  ["background_image", "background_image_url", "clear_background_image", "Альбомное изображение", "Фон широкой страницы"],
  ["background_image_vertical", "background_image_vertical_url", "clear_background_image_vertical", "Книжное изображение", "Фон узкой страницы"],
];

const ASSETS = [
  ["preview_image", "preview_image_url", "clear_preview_image", "Обложка темы", "Миниатюра в каталоге тем"],
  ["sheet_background_image", "sheet_background_image_url", "clear_sheet_background_image", "Лист, альбомный", "Горизонтальная страница"],
  ["sheet_background_image_vertical", "sheet_background_image_vertical_url", "clear_sheet_background_image_vertical", "Лист, книжный", "Вертикальная страница"],
  ["block_background_image", "block_background_image_url", "clear_block_background_image", "Фон карточки", "Плотный рисунок, текст остаётся читаемым"],
];

const LAYOUTS = {
  classic: "Классический",
  cards: "Карточки",
  route: "Маршрут",
  game: "Игра",
};

const LABEL_FIELDS = [
  ["task", "Одно задание"],
  ["tasks", "Список заданий"],
  ["next", "Кнопка «Далее»"],
  ["previous", "Кнопка «Назад»"],
  ["finish", "Завершение"],
];

const PREVIEW_TASKS = [
  { title: "Решите уравнение", formula: "2x + 5 = 17", answer: "6", topic: "Уравнения" },
  { title: "Найдите значение выражения", formula: "18 − 3 · 4", answer: "6", topic: "Вычисления" },
  { title: "Решите уравнение", formula: "3x − 4 = 11", answer: "5", topic: "Уравнения" },
  { title: "Найдите значение выражения", formula: "24 : 6 + 8", answer: "12", topic: "Вычисления" },
  { title: "Решите уравнение", formula: "5x + 2 = 22", answer: "4", topic: "Уравнения" },
];

function defaultBackground() {
  return { type: "none" };
}

function selectedBackgroundType(background) {
  if (background?.type === "gradient") return "gradient";
  if (background?.type === "color") return "color";
  if (background?.type === "image") {
    if (Array.isArray(background.colors) && background.colors.filter(Boolean).length >= 2) return "gradient";
    if (normalizeHex(background.color)) return "color";
  }
  return "none";
}

function backgroundForType(background, type) {
  const current = background || defaultBackground();
  if (type === "gradient") {
    const colors = Array.isArray(current.colors) && current.colors.filter(Boolean).length >= 2
      ? current.colors.slice(0, 2)
      : ["#9fc8e4", "#e7f3fb"];
    return {
      type: "gradient",
      colors,
      direction: GRADIENT_DIRECTIONS.includes(current.direction) ? current.direction : "vertical",
    };
  }
  if (type === "color") {
    return { type: "color", color: normalizeHex(current.color) || "#cfe8f6" };
  }
  return { type: "none" };
}

function configObjectFromForm(form) {
  return {
    labels: form.labels,
    animation: form.animation,
    background: form.background || defaultBackground(),
    decorations: form.decorations,
  };
}

function stringifyConfig(config) {
  try {
    return JSON.stringify(config || {}, null, 2);
  } catch {
    return "{\n}\n";
  }
}

function formFromTheme(theme) {
  const labels = { ...DEFAULT_VARIANT_THEME_LABELS, ...(theme?.config?.labels || {}) };
  const decorations = Array.isArray(theme?.config?.decorations) ? theme.config.decorations : [];
  const animation = theme?.config?.animation || "none";
  const background = theme?.config?.background || defaultBackground();
  return {
    name: theme?.name || "",
    slug: theme?.slug || "",
    description: theme?.description || "",
    layout_type: theme?.layout_type || "classic",
    is_active: theme ? Boolean(theme.is_active) : true,
    is_published: Boolean(theme?.is_published),
    labels,
    decorations,
    animation,
    background,
    preview_image_url: theme?.preview_image_url || "",
    background_image_url: theme?.background_image_url || theme?.config?.background?.url || "",
    background_image_vertical_url: theme?.background_image_vertical_url || "",
    block_background_image_url: theme?.block_background_image_url || "",
    sheet_background_image_url: theme?.sheet_background_image_url || "",
    sheet_background_image_vertical_url: theme?.sheet_background_image_vertical_url || "",
    configText: stringifyConfig({
      labels,
      animation,
      background,
      decorations,
    }),
  };
}

const EMPTY_FORM = formFromTheme(null);

function cloneForm(form) {
  return JSON.parse(JSON.stringify(form));
}

function labelText(form, key) {
  const value = String(form.labels?.[key] || "").trim();
  return value || DEFAULT_VARIANT_THEME_LABELS[key] || "";
}

function cssUrl(url) {
  if (!url) return undefined;
  return `url("${String(url).replace(/"/g, "%22")}")`;
}

function ThemeAssetGrid({ items, form, pending, onFile, onRemove }) {
  return (
    <div className="te-assets">
      {items.map(([field, urlKey, clearKey, title, desc]) => {
        const url = pending[field]?.url || form[urlKey];
        return (
          <div className="te-asset" key={field}>
            <div
              className={`te-asset-top${url ? " has-image" : ""}`}
              style={{ backgroundImage: cssUrl(url) }}
            >
              <TeIcon name="image" size={23} />
            </div>
            <strong>{title}</strong>
            <p>{desc}</p>
            <div className="te-asset-actions">
              <label className="te-asset-upload">
                <span>{pending[field]?.name || (url ? "Заменить" : "Загрузить")}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label={`${title}: загрузить изображение`}
                  onChange={onFile(field, urlKey)}
                />
              </label>
              {url ? (
                <button
                  className="te-asset-remove"
                  type="button"
                  aria-label={`Удалить: ${title}`}
                  onClick={() => onRemove(field, urlKey, clearKey)}
                >
                  <TeIcon name="close" size={13} />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const GRADIENT_LABELS = {
  vertical: "Сверху вниз",
  horizontal: "Слева направо",
  sunset: "Диагональ",
  sunrise: "Обратная диагональ",
  radial: "Из центра",
};

function HexColorField({ label, value, onChange }) {
  const committed = normalizeHex(value);
  const [draft, setDraft] = useState(committed);
  const [invalid, setInvalid] = useState(false);
  const previous = useRef(null);
  const sent = useRef(committed);

  useEffect(() => {
    setDraft(committed);
    setInvalid(false);
    if (sent.current === committed) return;
    previous.current = null;
    sent.current = committed;
  }, [committed]);

  const commit = (next) => {
    const hex = normalizeHex(next);
    if (!hex || hex === committed) return;
    previous.current = committed;
    sent.current = hex;
    onChange(hex);
  };

  return (
    <div className="te-field te-field--color">
      <span className="te-label">{label}</span>
      <span className="te-color">
        <input
          type="color"
          aria-label={`${label}: палитра`}
          value={committed || "#cfe8f6"}
          onChange={(event) => commit(event.target.value)}
        />
        <input
          className="te-input"
          aria-label={`${label}: HEX`}
          aria-invalid={invalid || undefined}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (normalizeHex(next)) {
              setInvalid(false);
              commit(next);
            } else {
              setInvalid(next.trim() !== "");
            }
          }}
          onBlur={() => {
            if (!normalizeHex(draft)) {
              setDraft(committed);
              setInvalid(false);
            }
          }}
        />
        <button
          type="button"
          className="te-btn"
          disabled={previous.current == null || previous.current === committed}
          onClick={() => {
            const prior = previous.current;
            if (prior == null) return;
            previous.current = committed;
            sent.current = prior;
            onChange(prior);
          }}
        >
          Вернуть
        </button>
      </span>
      {invalid ? <p className="te-error">Нужен цвет #RGB или #RRGGBB.</p> : null}
    </div>
  );
}

function TeIcon({ name, size = 17, className = "", style }) {
  return (
    <svg
      className={`te-icon${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
    >
      <IconShape name={name} />
    </svg>
  );
}

function IconShape({ name }) {
  switch (name) {
    case "settings":
      return <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />;
    case "palette":
      return (
        <>
          <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.8 1.8 0 0 1 1-3.3h3a3 3 0 0 0 3-3 9 9 0 0 0-9-8Z" />
          <path d="M7.2 11h.1M10 7h.1M15 7.5h.1" strokeWidth="3" />
        </>
      );
    case "type":
      return <path d="M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3" />;
    case "code":
      return <path d="m7 6-6 6 6 6M17 6l6 6-6 6M14 3l-4 18" />;
    case "eye":
      return (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
    case "monitor":
      return (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      );
    case "sheet":
      return <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5" />;
    case "expand":
      return <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />;
    case "save":
      return <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8" />;
    case "history":
      return <path d="M3 11a9 9 0 1 1 2.3 7M3 5v6h6M12 7v5l3 2" />;
    case "arrow":
      return <path d="M5 12h14m-5-5 5 5-5 5" />;
    case "check":
      return <path d="m5 12 4 4L19 6" />;
    case "circle-check":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </>
      );
    case "info":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      );
    case "image":
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="m3 18 6-6 4 4 3-3 5 5" />
        </>
      );
    case "close":
      return <path d="m6 6 12 12M18 6 6 18" />;
    case "download":
      return <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />;
    case "upload":
      return <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />;
    default:
      return null;
  }
}

function LayoutArt({ kind }) {
  if (kind === "route") {
    return (
      <svg className="te-layout-art" viewBox="0 0 100 45" aria-hidden="true">
        <path d="M15 15h62a9 9 0 0 1 0 18H32" strokeDasharray="3 4" />
        <circle cx="16" cy="15" r="5" fill="currentColor" />
        <circle cx="48" cy="15" r="5" fill="currentColor" />
        <circle cx="78" cy="15" r="5" />
        <circle cx="78" cy="33" r="4" />
        <circle cx="47" cy="33" r="4" />
      </svg>
    );
  }
  if (kind === "cards") {
    return (
      <svg className="te-layout-art" viewBox="0 0 100 45" aria-hidden="true">
        <rect x="18" y="8" width="26" height="14" rx="3" />
        <rect x="51" y="8" width="26" height="14" rx="3" />
        <rect x="18" y="27" width="26" height="11" rx="3" />
        <rect x="51" y="27" width="26" height="11" rx="3" />
      </svg>
    );
  }
  if (kind === "game") {
    return (
      <svg className="te-layout-art" viewBox="0 0 100 45" aria-hidden="true">
        <rect x="28" y="8" width="44" height="28" rx="8" />
        <circle cx="40" cy="22" r="3" fill="currentColor" />
        <circle cx="60" cy="22" r="3" fill="currentColor" />
        <path d="M46 22h8" />
      </svg>
    );
  }
  return (
    <svg className="te-layout-art" viewBox="0 0 100 45" aria-hidden="true">
      <rect x="19" y="7" width="59" height="8" rx="2" />
      <rect x="19" y="20" width="59" height="8" rx="2" />
      <rect x="19" y="33" width="59" height="5" rx="2" />
      <path d="M26 10.5h6M26 23.5h6" />
    </svg>
  );
}

function ThemeLivePreview({ form, pending, mode, orientation = "horizontal" }) {
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState("");
  const answerRef = useRef(null);
  const backgroundUrl = orientedImageUrl(
    pending.background_image?.url || form.background_image_url,
    pending.background_image_vertical?.url || form.background_image_vertical_url,
    orientation,
  );
  const blockUrl = pending.block_background_image?.url || form.block_background_image_url;
  const sheetUrl = orientedImageUrl(
    pending.sheet_background_image?.url || form.sheet_background_image_url,
    pending.sheet_background_image_vertical?.url || form.sheet_background_image_vertical_url,
    orientation,
  );
  const task = PREVIEW_TASKS[step];
  const routeClass = form.layout_type === "cards" || form.layout_type === "game"
    ? "cards-route"
    : form.layout_type === "classic"
      ? "list-route"
      : "";
  const lineKind = decorationLineKind(form.decorations);

  const go = (delta) => {
    if (step === PREVIEW_TASKS.length - 1 && delta > 0) {
      setFinished(true);
    } else {
      setStep((value) => Math.max(0, Math.min(PREVIEW_TASKS.length - 1, value + delta)));
      setFinished(false);
    }
    setFeedback("");
    setFeedbackKind("");
  };

  const check = () => {
    const value = String(answerRef.current?.value || "").trim().replace(",", ".");
    if (!value) {
      setFeedback("Введите ответ.");
      setFeedbackKind("");
      return;
    }
    const correct = value === task.answer;
    setFeedback(correct ? "Верно! Можно двигаться дальше." : "Пока не получилось. Попробуйте ещё раз.");
    setFeedbackKind(correct ? "correct" : "incorrect");
  };

  const pageStyle = pageBackgroundStyle(form.background, backgroundUrl);
  const sheetStyle = sheetUrl
    ? {
        backgroundImage: cssUrl(sheetUrl),
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }
    : pageStyle;

  if (mode === "sheet") {
    return (
      <div className={`te-sheet-stage te-sheet-stage--${orientation}`} style={sheetStyle}>
        <div className={`te-sheet te-sheet--${orientation}`}>
          <div className="te-sheet-header">
            <div className="te-sheet-kicker">Цифровой поток · Рабочий лист</div>
            <h3>{form.name || "Новая тема"}</h3>
            <div className="te-sheet-info">Имя _________________________ &nbsp; Дата __________</div>
          </div>
          {PREVIEW_TASKS.slice(0, 3).map((item, index) => (
            <div className="te-sheet-task" key={item.formula}>
              <strong>{labelText(form, "task")} {index + 1}</strong>
              <p>{item.title}: &nbsp; {item.formula}.</p>
              <div className="te-sheet-lines" />
            </div>
          ))}
          <div className="te-sheet-foot">
            <span>Цифровой поток</span>
            <span>1 / 1</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`te-screen-stage${orientation === "vertical" ? " te-screen-stage--vertical" : ""}`}
      style={pageStyle}
    >
    <div
      className={`te-screen variant-theme--${form.layout_type}${orientation === "vertical" ? " te-screen--vertical" : ""}`}
    >
      <ThemeDecorations decorations={form.decorations} layoutType={form.layout_type} contained />
      <ThemeEffects type={form.animation} />
      <div className="te-screen-content">
        <div className="te-screen-heading">
          <div className="te-screen-top">
            <span>ПРЕДПРОСМОТР</span>
            <span className="te-preview-theme">
              <TeIcon name="eye" size={12} />
              <span>{form.name || "Новая тема"}</span>
            </span>
          </div>
          <h3>{labelText(form, "tasks")}</h3>
          <p className="te-screen-subtitle">Оформление обновляется сразу, содержание заданий не меняется</p>
        </div>
        <div
          className={`te-route ${routeClass} ${lineKind === "none" ? "no-route" : `route-line route-line--${lineKind}`}`}
          style={{ "--route-progress": `${step * 25}%` }}
        >
          {PREVIEW_TASKS.map((item, index) => (
            <button
              key={item.formula}
              type="button"
              className={`te-stop${index === step && !finished ? " current" : ""}${index < step || finished ? " done" : ""}`}
              onClick={() => {
                setStep(index);
                setFinished(false);
                setFeedback("");
              }}
            >
              {index < step || finished ? "✓" : index + 1}
            </button>
          ))}
        </div>
        <div className={`te-task-card${blockUrl ? " has-image" : ""}`} style={blockBackgroundStyle(blockUrl)}>
          {finished ? (
            <div className="te-finished">
              {labelText(form, "finish")}
              <p style={{ fontSize: 12, fontWeight: 500 }}>Все остановки предпросмотра позади.</p>
              <button
                type="button"
                className="te-check-answer"
                onClick={() => {
                  setStep(0);
                  setFinished(false);
                }}
              >
                Начать заново
              </button>
            </div>
          ) : (
            <>
              <div className="te-task-meta">
                <span className="te-task-number">{labelText(form, "task")} {step + 1}</span>
                <span className="te-task-topic">{task.topic}</span>
              </div>
              <h4>{task.title}</h4>
              <div className="te-equation">{task.formula}</div>
              <div className="te-answer-row">
                <input
                  ref={answerRef}
                  className="te-answer"
                  type="text"
                  inputMode="decimal"
                  placeholder="Ваш ответ"
                  key={step}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      check();
                    }
                  }}
                />
                <button type="button" className="te-check-answer" onClick={check}>Проверить</button>
              </div>
              <p className={`te-feedback ${feedbackKind}`} aria-live="polite">{feedback}</p>
            </>
          )}
        </div>
        <div className="te-preview-nav">
          <button type="button" className="te-back-step" onClick={() => go(-1)} disabled={step === 0 || finished}>
            <TeIcon name="arrow" size={12} style={{ transform: "scaleX(-1)" }} />
            {labelText(form, "previous")}
          </button>
          <button type="button" className="te-next-step" onClick={() => go(1)} disabled={finished}>
            {labelText(form, step === PREVIEW_TASKS.length - 1 ? "finish" : "next")}
            <TeIcon name="arrow" size={12} />
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

export default function CabinetVariantThemeEditorPage() {
  const { user } = useOutletContext();
  const { themeId } = useParams();
  const navigate = useNavigate();
  const isNew = !themeId || themeId === "new";
  const [form, setForm] = useState(EMPTY_FORM);
  const [baseline, setBaseline] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [jsonDirty, setJsonDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedId, setLoadedId] = useState(null);
  const [tab, setTab] = useState("main");
  const [previewMode, setPreviewMode] = useState("screen");
  const [previewOrientation, setPreviewOrientation] = useState("horizontal");
  const [pending, setPending] = useState({});
  const [resetOpen, setResetOpen] = useState(false);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [loaded, setLoaded] = useState(isNew);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState("");
  const [savedNote, setSavedNote] = useState(false);
  const pendingFiles = useRef({
    preview_image: null,
    background_image: null,
    background_image_vertical: null,
    block_background_image: null,
    sheet_background_image: null,
    sheet_background_image_vertical: null,
  });
  const toastTimer = useRef(null);
  const editRev = useRef(0);
  const saveLock = useRef(false);
  const saveSeq = useRef(0);
  const uploadTokens = useRef({});
  const keepDraft = useRef(false);

  usePageTitle(isNew ? "Новая тема варианта" : "Редактирование темы");

  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3400);
  };

  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    Object.values(pendingFiles.current).forEach((file) => {
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
    });
  }, []);

  useEffect(() => {
    if (!user?.can_manage_variant_themes || isNew) {
      setLoaded(true);
      return undefined;
    }
    let cancelled = false;
    const preserveDraft = keepDraft.current;
    keepDraft.current = false;
    if (!preserveDraft) setLoaded(false);
    setError("");
    fetchAdminVariantThemes()
      .then((data) => {
        if (cancelled) return;
        const theme = (data?.themes || []).find((row) => String(row.id) === String(themeId));
        if (!theme) {
          if (!preserveDraft) setError("Тема не найдена");
          return;
        }
        const next = formFromTheme(theme);
        if (preserveDraft) {
          setLoadedId(theme.id);
          setBaseline(cloneForm(next));
          return;
        }
        setLoadedId(theme.id);
        setForm(next);
        setBaseline(cloneForm(next));
        setJsonDirty(false);
        setSavedNote(false);
        editRev.current += 1;
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить тему");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, themeId, user]);

  const isDirty = useMemo(() => {
    return jsonDirty || Object.keys(pending).length > 0 || JSON.stringify(form) !== JSON.stringify(baseline);
  }, [baseline, form, jsonDirty, pending]);

  useEffect(() => {
    const onLeave = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [isDirty]);

  const patch = (partial) => setForm((prev) => {
    editRev.current += 1;
    const next = { ...prev, ...partial };
    if (
      partial.labels !== undefined
      || partial.decorations !== undefined
      || partial.animation !== undefined
      || partial.background !== undefined
    ) {
      next.configText = stringifyConfig(configObjectFromForm(next));
    }
    return next;
  });

  const applyConfigText = (raw = form.configText) => {
    let parsed;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      setJsonError("Некорректный JSON");
      return false;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setJsonError("Конфигурация должна быть JSON-объектом");
      return false;
    }
    setJsonError("");
    setJsonDirty(false);
    editRev.current += 1;
    setForm((prev) => ({
      ...prev,
      labels: { ...DEFAULT_VARIANT_THEME_LABELS, ...(parsed.labels || {}) },
      decorations: Array.isArray(parsed.decorations) ? parsed.decorations : prev.decorations,
      animation: typeof parsed.animation === "string" ? parsed.animation : prev.animation,
      background: parsed.background && typeof parsed.background === "object" && !Array.isArray(parsed.background)
        ? parsed.background
        : prev.background,
      configText: JSON.stringify(parsed, null, 2),
    }));
    return true;
  };

  const activateTab = (key) => {
    if (tab === "advanced" && key !== "advanced" && jsonDirty && !applyConfigText()) return;
    setTab(key);
  };

  const applyUrls = (saved) => {
    if (!saved) return;
    const urls = {
      preview_image_url: saved.preview_image_url || "",
      background_image_url: saved.background_image_url || "",
      background_image_vertical_url: saved.background_image_vertical_url || "",
      block_background_image_url: saved.block_background_image_url || "",
      sheet_background_image_url: saved.sheet_background_image_url || "",
      sheet_background_image_vertical_url: saved.sheet_background_image_vertical_url || "",
    };
    patch(urls);
    setBaseline((prev) => ({ ...prev, ...urls }));
  };

  const dropPending = (field) => {
    const current = pendingFiles.current[field];
    if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
    pendingFiles.current[field] = null;
    setPending((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const flushPendingUploads = async (themePk) => {
    let latest = null;
    for (const field of IMAGE_FIELDS) {
      const file = pendingFiles.current[field]?.file;
      if (!file) continue;
      latest = await uploadVariantThemeImage(themePk, field, file);
      dropPending(field);
    }
    return latest;
  };

  const save = async () => {
    if (saveLock.current || !loaded) return null;
    const seq = ++saveSeq.current;
    const startedRev = editRev.current;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      let config;
      try {
        config = JSON.parse(form.configText || "{}");
        if (!config || typeof config !== "object" || Array.isArray(config)) {
          throw new Error("Конфигурация должна быть JSON-объектом");
        }
      } catch (err) {
        setJsonError(err.message || "Некорректный JSON конфигурации");
        setTab("advanced");
        setError(err.message || "Некорректный JSON конфигурации");
        return null;
      }
      if (!String(form.name || "").trim() || !String(form.slug || "").trim()) {
        setTab("main");
        setError("Укажите название и короткое имя темы");
        return null;
      }
      const body = {
        name: form.name,
        slug: form.slug,
        description: form.description,
        layout_type: form.layout_type,
        is_active: form.is_active,
        is_published: form.is_published,
        config,
      };
      let saved = isNew
        ? await createVariantTheme(body)
        : await updateVariantTheme(loadedId || themeId, body);
      if (!saved?.id) throw new Error("Сервер не вернул тему");
      if (seq !== saveSeq.current) return null;
      const themePk = saved.id;
      setLoadedId(themePk);
      const uploaded = await flushPendingUploads(themePk);
      if (uploaded) saved = uploaded;
      if (seq !== saveSeq.current) return null;
      const next = formFromTheme(saved);
      setBaseline(cloneForm(next));
      if (editRev.current !== startedRev) {
        applyUrls(saved);
        setSavedNote(false);
        if (isNew) keepDraft.current = true;
        showToast("Сохранено. Более новые правки остались в черновике.");
      } else {
        setForm(next);
        setJsonDirty(false);
        setJsonError("");
        setSavedNote(true);
        showToast("Тема сохранена");
      }
      if (isNew && themePk) {
        navigate(`/cabinet/variant-themes/${themePk}`, { replace: true });
      }
      return saved;
    } catch (err) {
      if (seq === saveSeq.current) setError(err.message || "Не удалось сохранить");
      return null;
    } finally {
      if (seq === saveSeq.current) {
        saveLock.current = false;
        setSaving(false);
      }
    }
  };

  const saveRef = useRef(null);
  saveRef.current = save;

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onImageFile = (field, urlKey) => async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    const token = (uploadTokens.current[field] || 0) + 1;
    uploadTokens.current[field] = token;
    if (pendingFiles.current[field]?.previewUrl) URL.revokeObjectURL(pendingFiles.current[field].previewUrl);
    pendingFiles.current[field] = { file, previewUrl, token };
    setPending((prev) => ({ ...prev, [field]: { name: file.name, url: previewUrl } }));
    editRev.current += 1;
    const themePk = loadedId || (!isNew ? themeId : null);
    if (!themePk) {
      setError("");
      return;
    }
    try {
      const saved = await uploadVariantThemeImage(themePk, field, file);
      if (uploadTokens.current[field] !== token) return;
      dropPending(field);
      applyUrls(saved);
      showToast("Изображение добавлено");
    } catch (err) {
      if (uploadTokens.current[field] === token) setError(err.message || "Не удалось загрузить изображение");
    }
  };

  const removeImage = async (field, urlKey, clearKey) => {
    if (pending[field]) {
      dropPending(field);
      return;
    }
    const themePk = loadedId || (!isNew ? themeId : null);
    if (!themePk || !form[urlKey]) return;
    try {
      const saved = await updateVariantTheme(themePk, { [clearKey]: true });
      applyUrls(saved);
      showToast("Изображение удалено");
    } catch (err) {
      setError(err.message || "Не удалось удалить изображение");
    }
  };

  const resetForm = () => {
    IMAGE_FIELDS.forEach((field) => dropPending(field));
    editRev.current += 1;
    setForm(cloneForm(baseline));
    setJsonDirty(false);
    setJsonError("");
    setError("");
    setSavedNote(false);
    setResetOpen(false);
    showToast("Открыта последняя сохранённая версия");
  };

  const resetDefaults = () => {
    patch({
      labels: { ...DEFAULT_VARIANT_THEME_LABELS },
      animation: "none",
      decorations: [],
      background: { type: "none" },
    });
    setDefaultsOpen(false);
    showToast("Оформление сброшено к стандартным значениям. Сохраните тему, чтобы записать их.");
  };

  const downloadJson = () => {
    const blob = new Blob([form.configText || "{}"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${form.slug || "theme"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      editRev.current += 1;
      setForm((prev) => ({ ...prev, configText: text }));
      setJsonDirty(true);
      if (applyConfigText(text)) showToast("Конфигурация применена");
    } catch {
      setJsonError("Не удалось прочитать файл");
    }
  };

  if (!user?.can_manage_variant_themes) {
    return <Navigate to="/cabinet" replace />;
  }

  const statusLabel = saving
    ? "Сохранение…"
    : isDirty
      ? "Есть несохранённые изменения"
      : savedNote
        ? "Тема сохранена"
        : "Изменений нет";
  const crumb = form.name || (isNew ? "Новая тема" : "Тема");

  return (
    <CabinetPageShell className="cb-section--theme-editor">
      <div className="te-app">
        <nav className="te-breadcrumbs" aria-label="Хлебные крошки">
          <Link
            to="/cabinet/variant-themes"
            onClick={(event) => {
              if (!isDirty) return;
              if (!window.confirm("Есть несохранённые изменения. Уйти без сохранения?")) {
                event.preventDefault();
              }
            }}
          >
            Темы вариантов
          </Link>
          <TeIcon name="arrow" size={11} />
          <span>{crumb}</span>
        </nav>
        <div className="te-titlebar">
          <div>
            <h1>{isNew ? "Новая тема" : "Редактирование темы"}</h1>
            <p>Оформление интерактивов и рабочих листов</p>
          </div>
          <div className="te-title-actions">
            <button className="te-btn" type="button" onClick={() => setResetOpen(true)} disabled={!isDirty || saving || !loaded}>
              <TeIcon name="history" size={16} />
              <span>Отмена</span>
            </button>
            <button className="te-btn" type="button" onClick={() => setDefaultsOpen(true)} disabled={saving || !loaded}>
              Сбросить
            </button>
            <button className="te-btn te-btn-primary" type="button" onClick={save} disabled={saving || !loaded}>
              <TeIcon name="save" size={16} />
              <span>{saving ? "Сохранение…" : "Сохранить тему"}</span>
            </button>
          </div>
        </div>
        {error ? <p className="te-banner" role="alert">{error}</p> : null}
        {!loaded ? <p className="te-hint">Загрузка темы…</p> : (
        <div className="te-grid">
          <section className="te-panel" aria-label="Настройки темы">
            <div className="te-tablist" role="tablist" aria-label="Настройки темы">
              {[
                ["main", "settings", "Основное"],
                ["design", "palette", "Оформление"],
                ["labels", "type", "Подписи"],
                ["advanced", "code", "JSON"],
              ].map(([key, icon, title]) => (
                <button
                  key={key}
                  className="te-tab"
                  id={`te-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls={`te-panel-${key}`}
                  tabIndex={tab === key ? 0 : -1}
                  onClick={() => activateTab(key)}
                >
                  <TeIcon name={icon} size={15} />
                  {title}
                </button>
              ))}
            </div>
            <form
              id="te-form"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <fieldset className="te-fieldset" disabled={saving || !loaded}>
              {tab === "main" ? (
                <div className="te-tabpanel" id="te-panel-main" role="tabpanel" aria-labelledby="te-tab-main">
                  <div className="te-section-head">
                    <div>
                      <h2>О теме</h2>
                      <p>Название и способ отображения заданий</p>
                    </div>
                  </div>
                  <div className="te-fields-2">
                    <label className="te-field">
                      <span className="te-label">Название <span className="te-required">*</span></span>
                      <input
                        className="te-input"
                        value={form.name}
                        maxLength={160}
                        required
                        autoComplete="off"
                        onChange={(event) => patch({ name: event.target.value })}
                      />
                    </label>
                    <label className="te-field">
                      <span className="te-label">Короткое имя <small>slug</small></span>
                      <span className="te-slug">
                        <span>theme/</span>
                        <input
                          className="te-input"
                          value={form.slug}
                          maxLength={80}
                          required
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(event) => patch({ slug: event.target.value })}
                        />
                      </span>
                    </label>
                  </div>
                  <label className="te-field">
                    <span className="te-label">Описание</span>
                    <textarea
                      className="te-input"
                      value={form.description}
                      rows={3}
                      maxLength={4000}
                      onChange={(event) => patch({ description: event.target.value })}
                    />
                  </label>
                  <div className="te-divider" />
                  <div className="te-section-head">
                    <div>
                      <h2>Расположение заданий</h2>
                      <p>Выберите, как ученик будет проходить материал</p>
                    </div>
                  </div>
                  <div className="te-layout-options" role="radiogroup" aria-label="Расположение заданий">
                    {VARIANT_THEME_LAYOUTS.map((layout) => (
                      <label key={layout} className="te-choice">
                        <input
                          type="radio"
                          name="layout_type"
                          value={layout}
                          checked={form.layout_type === layout}
                          onChange={() => patch({ layout_type: layout })}
                        />
                        <span className="te-choice-card">
                          <LayoutArt kind={layout} />
                          <span>{LAYOUTS[layout] || layout}</span>
                          <TeIcon className="te-choice-check" name="circle-check" size={13} />
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="te-hint">В варианте сейчас отображаются «Классический» и «Маршрут». Остальные макеты сохраняются в теме.</p>
                  <div className="te-divider" />
                  <div className="te-switch-row">
                    <div>
                      <strong>Активная тема</strong>
                      <p>Можно выбирать при создании материалов</p>
                    </div>
                    <label className="te-switch">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        aria-label="Активная тема"
                        onChange={(event) => patch({ is_active: event.target.checked })}
                      />
                      <span />
                    </label>
                  </div>
                  <div className="te-switch-row">
                    <div>
                      <strong>Опубликована</strong>
                      <p>Доступна пользователям платформы</p>
                    </div>
                    <label className="te-switch">
                      <input
                        type="checkbox"
                        checked={form.is_published}
                        aria-label="Опубликована"
                        onChange={(event) => patch({ is_published: event.target.checked })}
                      />
                      <span />
                    </label>
                  </div>
                </div>
              ) : null}

              {tab === "design" ? (
                <div className="te-tabpanel" id="te-panel-design" role="tabpanel" aria-labelledby="te-tab-design">
                  <div className="te-section-head">
                    <div>
                      <h2>Фон страницы варианта</h2>
                      <p>Изображение закрывает страницу целиком. Цвет виден, если рисунка нет.</p>
                    </div>
                  </div>
                  <div className="te-layout-options te-layout-options--fill" role="radiogroup" aria-label="Тип фона">
                    {[
                      ["none", "Без цвета"],
                      ["color", "Цвет"],
                      ["gradient", "Градиент"],
                    ].map(([type, title]) => (
                      <label key={type} className="te-choice">
                        <input
                          type="radio"
                          name="background_type"
                          value={type}
                          checked={selectedBackgroundType(form.background) === type}
                          onChange={() => patch({ background: backgroundForType(form.background, type) })}
                        />
                        <span className="te-choice-card te-choice-card--text">{title}</span>
                      </label>
                    ))}
                  </div>
                  {selectedBackgroundType(form.background) === "color" ? (
                    <HexColorField
                      label="Цвет фона"
                      value={form.background?.color || ""}
                      onChange={(color) => patch({ background: { type: "color", color } })}
                    />
                  ) : null}
                  {selectedBackgroundType(form.background) === "gradient" ? (
                    <>
                      <div className="te-fields-2">
                        <HexColorField
                          label="Первый цвет"
                          value={form.background?.colors?.[0] || "#9fc8e4"}
                          onChange={(color) => {
                            const colors = [...(form.background?.colors?.length ? form.background.colors : ["#9fc8e4", "#e7f3fb"])];
                            colors[0] = color;
                            patch({ background: { ...form.background, type: "gradient", colors } });
                          }}
                        />
                        <HexColorField
                          label="Второй цвет"
                          value={form.background?.colors?.[1] || "#e7f3fb"}
                          onChange={(color) => {
                            const colors = [...(form.background?.colors?.length ? form.background.colors : ["#9fc8e4", "#e7f3fb"])];
                            colors[1] = color;
                            patch({ background: { ...form.background, type: "gradient", colors } });
                          }}
                        />
                      </div>
                      <label className="te-field">
                        <span className="te-label">Направление</span>
                        <select
                          className="te-input"
                          value={GRADIENT_DIRECTIONS.includes(form.background?.direction) ? form.background.direction : "vertical"}
                          onChange={(event) => patch({
                            background: { ...form.background, type: "gradient", direction: event.target.value },
                          })}
                        >
                          {GRADIENT_DIRECTIONS.map((direction) => (
                            <option key={direction} value={direction}>{GRADIENT_LABELS[direction]}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  {pageContrastWarning(form.background?.type === "gradient" ? form.background?.colors?.[0] : form.background?.color) ? (
                    <p className="te-contrast" role="status">
                      {pageContrastWarning(form.background?.type === "gradient" ? form.background?.colors?.[0] : form.background?.color)}
                    </p>
                  ) : null}
                  <ThemeAssetGrid items={PAGE_IMAGES} form={form} pending={pending} onFile={onImageFile} onRemove={removeImage} />
                  <p className="te-hint">Загрузите рисунок — он станет фоном страницы. Альбомный для широкого экрана, книжный для узкого. Если файл один, он используется в обеих ориентациях.</p>
                  <div className="te-divider" />
                  <div className="te-section-head">
                    <div>
                      <h2>Фоны и изображения</h2>
                      <p>Для экрана и печати можно использовать разные фоны</p>
                    </div>
                  </div>
                  <ThemeAssetGrid items={ASSETS} form={form} pending={pending} onFile={onImageFile} onRemove={removeImage} />
                  <p className="te-hint">PNG, JPG, WebP или GIF. Если загружен только один рисунок, он используется и в книжной, и в альбомной ориентации.</p>
                  <label className="te-field" style={{ marginTop: 21 }}>
                    <span className="te-label">Анимация</span>
                    <select
                      className="te-input"
                      value={form.animation}
                      onChange={(event) => patch({ animation: event.target.value })}
                    >
                      {VARIANT_THEME_ANIMATIONS.map((item) => (
                        <option key={item} value={item}>{ANIMATION_LABELS[item] || item}</option>
                      ))}
                    </select>
                  </label>
                  <div className="te-divider" />
                  <div className="te-decor-head">
                    <div className="te-section-head" style={{ margin: 0 }}>
                      <div>
                        <h2>Декоративные элементы</h2>
                        <p>Фон, соединительная линия и предметы выбираются отдельно и сохраняются вместе с темой.</p>
                      </div>
                    </div>
                    <span className="te-counter">{form.decorations.length} выбрано</span>
                  </div>
                  {DECORATION_GROUPS.map((group) => (
                    <section key={group.id} className="te-decor-group" aria-labelledby={`te-decor-${group.id}`}>
                      <h3 id={`te-decor-${group.id}`}>{group.title}</h3>
                      <p>{group.hint}</p>
                      <div className="te-decor-grid">
                        {group.items.map((name) => (
                          <label key={name} className="te-decor-item">
                            <input
                              type="checkbox"
                              checked={form.decorations.includes(name)}
                              onChange={(event) => {
                                patch({
                                  decorations: event.target.checked
                                    ? [...form.decorations, name]
                                    : form.decorations.filter((item) => item !== name),
                                });
                              }}
                            />
                            <DecorationSample name={name} />
                            <span>{DECORATION_LABELS[name] || name}</span>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}

              {tab === "labels" ? (
                <div className="te-tabpanel" id="te-panel-labels" role="tabpanel" aria-labelledby="te-tab-labels">
                  <div className="te-section-head">
                    <div>
                      <h2>Подписи в интерфейсе</h2>
                      <p>Добавьте теме характер с помощью коротких фраз</p>
                    </div>
                  </div>
                  <div className="te-label-fields">
                    {LABEL_FIELDS.map(([key, title]) => (
                      <label className="te-field" key={key}>
                        <span className="te-label">{title}<small>{key}</small></span>
                        <input
                          className="te-input"
                          value={form.labels[key] || ""}
                          maxLength={60}
                          onChange={(event) => patch({ labels: { ...form.labels, [key]: event.target.value } })}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="te-note">
                    <strong>Подписи сразу видны в предпросмотре.</strong>
                    <br />
                    Формулировки, числа и ответы в заданиях остаются прежними. Если оставить поле пустым, будет использована стандартная подпись.
                  </div>
                </div>
              ) : null}

              {tab === "advanced" ? (
                <div className="te-tabpanel" id="te-panel-advanced" role="tabpanel" aria-labelledby="te-tab-advanced">
                  <div className="te-section-head">
                    <div>
                      <h2>Конфигурация JSON</h2>
                      <p>Для точной настройки, переноса и резервной копии темы</p>
                    </div>
                  </div>
                  <label className="te-field" style={{ margin: 0 }}>
                    <span className="te-label">JSON</span>
                    <textarea
                      className="te-input te-json"
                      value={form.configText}
                      spellCheck={false}
                      aria-invalid={jsonError ? "true" : undefined}
                        onChange={(event) => {
                        editRev.current += 1;
                        setJsonDirty(true);
                        setJsonError("");
                        setForm((prev) => ({ ...prev, configText: event.target.value }));
                      }}
                    />
                  </label>
                  {jsonError ? <p className="te-error" role="alert">{jsonError}</p> : null}
                  <div className="te-json-actions">
                    <button
                      className="te-btn te-btn-primary"
                      type="button"
                      onClick={() => {
                        if (applyConfigText()) showToast("Конфигурация применена");
                      }}
                    >
                      <TeIcon name="check" size={14} />
                      Применить JSON
                    </button>
                    <button className="te-btn" type="button" onClick={downloadJson}>
                      <TeIcon name="download" size={14} />
                      Скачать
                    </button>
                    <label className="te-btn te-file-label">
                      <TeIcon name="upload" size={14} />
                      Загрузить
                      <input type="file" accept=".json,application/json" aria-label="Загрузить JSON" onChange={importJson} />
                    </label>
                  </div>
                  <div className="te-note">
                    При изменении полей конфигурация обновляется автоматически. После ручного редактирования нажмите «Применить JSON».
                  </div>
                </div>
              ) : null}
              </fieldset>
            </form>
            <div className="te-panel-bottom" role="status">
              <span className={`te-dot${isDirty ? " unsaved" : ""}`} />
              <span>{statusLabel}</span>
              <span className="te-panel-note">Без произвольного HTML и JavaScript</span>
            </div>
          </section>

          <aside className="te-preview-col" aria-label="Предпросмотр темы">
            <div className="te-panel">
              <div className="te-preview-head">
                <div className="te-preview-heading">
                  <TeIcon name="eye" size={18} />
                  Предпросмотр
                </div>
                <span className="te-live-label"><span className="te-dot" />В РЕАЛЬНОМ ВРЕМЕНИ</span>
              </div>
              <div className="te-preview-toolbar">
                <div className="te-segments" aria-label="Формат предпросмотра">
                  <button className="te-segment" type="button" aria-pressed={previewMode === "screen"} onClick={() => setPreviewMode("screen")}>
                    <TeIcon name="monitor" size={13} />
                    Интерактив
                  </button>
                  <button className="te-segment" type="button" aria-pressed={previewMode === "sheet"} onClick={() => setPreviewMode("sheet")}>
                    <TeIcon name="sheet" size={13} />
                    Рабочий лист
                  </button>
                </div>
                <div className="te-segments" role="group" aria-label="Ориентация">
                  <button className="te-segment" type="button" aria-pressed={previewOrientation === "horizontal"} onClick={() => setPreviewOrientation("horizontal")}>
                    Альбомная
                  </button>
                  <button className="te-segment" type="button" aria-pressed={previewOrientation === "vertical"} onClick={() => setPreviewOrientation("vertical")}>
                    Книжная
                  </button>
                </div>
                <button className="te-btn-icon" type="button" aria-label="Увеличить предпросмотр" onClick={() => setExpanded(true)}>
                  <TeIcon name="expand" size={16} />
                </button>
              </div>
              <div className="te-preview-frame">
                <ThemeLivePreview form={form} pending={pending} mode={previewMode} orientation={previewOrientation} />
              </div>
              <div className="te-preview-foot">
                <TeIcon name="circle-check" size={13} />
                <span>
                  {form.layout_type === "route"
                    ? "Предпросмотр использует те же цвет, градиент и рисунок, что страница варианта."
                    : form.layout_type === "classic"
                      ? "Классический вид на странице варианта не подменяет фон платформы. Цвет применяется в макете «Маршрут»."
                      : "Макет сохранится. На странице варианта пока показывается классический вид без этого фона."}
                </span>
              </div>
            </div>
            <div className="te-tip">
              <TeIcon name="info" size={17} />
              <div>
                <strong>Отдельный фон для рабочего листа</strong>
                Выберите светлый фон без мелких деталей — так задания останутся хорошо читаемыми при печати.
              </div>
            </div>
          </aside>
        </div>
        )}
      </div>

      {toast ? <div className="te-toast" role="status">{toast}</div> : null}

      {resetOpen ? (
        <div className="te-modal-back" onClick={() => setResetOpen(false)}>
          <div
            className="te-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="te-reset-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="te-reset-title">Отменить изменения?</h2>
            <p>Вернём последнюю сохранённую версию. Текущий черновик будет потерян.</p>
            <div className="te-modal-actions">
              <button className="te-btn" type="button" onClick={() => setResetOpen(false)}>Отмена</button>
              <button className="te-btn te-btn-primary" type="button" onClick={resetForm}>Отменить правки</button>
            </div>
          </div>
        </div>
      ) : null}

      {defaultsOpen ? (
        <div className="te-modal-back" onClick={() => setDefaultsOpen(false)}>
          <div
            className="te-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="te-defaults-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="te-defaults-title">Сбросить оформление?</h2>
            <p>Цвет, градиент, анимация, декорации и подписи вернутся к стандартным. Название, код и загруженные рисунки сохранятся, пока вы не нажмёте «Сохранить тему».</p>
            <div className="te-modal-actions">
              <button className="te-btn" type="button" onClick={() => setDefaultsOpen(false)}>Не сбрасывать</button>
              <button className="te-btn te-btn-primary" type="button" onClick={resetDefaults}>Сбросить оформление</button>
            </div>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div className="te-modal-back" onClick={() => setExpanded(false)}>
          <div
            className="te-modal te-fullscreen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="te-fullscreen-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="te-fullscreen-head">
              <h2 id="te-fullscreen-title">Предпросмотр темы</h2>
              <button className="te-btn-icon" type="button" aria-label="Закрыть предпросмотр" onClick={() => setExpanded(false)}>
                <TeIcon name="close" size={16} />
              </button>
            </div>
            <div className="te-preview-frame">
              <ThemeLivePreview form={form} pending={pending} mode={previewMode} orientation={previewOrientation} />
            </div>
          </div>
        </div>
      ) : null}
    </CabinetPageShell>
  );
}
