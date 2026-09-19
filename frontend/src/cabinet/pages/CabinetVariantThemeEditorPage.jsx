import { Navigate, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { CabinetPageHeader, CabinetPageShell } from "../CabinetSectionUi";
import {
  createVariantTheme,
  fetchAdminVariantThemes,
  updateVariantTheme,
  uploadVariantThemeImage,
} from "../../variantThemes/variantThemeApi";
import { DEFAULT_VARIANT_THEME_LABELS, VARIANT_THEME_ANIMATIONS, VARIANT_THEME_DECORATIONS, VARIANT_THEME_LAYOUTS } from "../../variantThemes/registry";
import ThemeDecorations from "../../variantThemes/ThemeDecorations";
import ThemeEffects from "../../variantThemes/ThemeEffects";
import { ThemeRouteProgress } from "../../variantThemes/ThemeNavigation";
import "../../variantThemes/variant-themes.css";

function defaultBackground() {
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
    block_background_image_url: theme?.block_background_image_url || "",
    configText: stringifyConfig({
      labels,
      animation,
      background,
      decorations,
    }),
  };
}

const EMPTY_FORM = formFromTheme(null);

export default function CabinetVariantThemeEditorPage() {
  const { user } = useOutletContext();
  const { themeId } = useParams();
  const navigate = useNavigate();
  const isNew = !themeId || themeId === "new";
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [loadedId, setLoadedId] = useState(null);
  const pendingFiles = useRef({
    preview_image: null,
    background_image: null,
    block_background_image: null,
  });

  useEffect(() => {
    if (!user?.can_manage_variant_themes || isNew) return undefined;
    let cancelled = false;
    fetchAdminVariantThemes()
      .then((data) => {
        const theme = (data?.themes || []).find((row) => String(row.id) === String(themeId));
        if (!theme) {
          setError("Тема не найдена");
          return;
        }
        if (cancelled) return;
        setLoadedId(theme.id);
        setForm(formFromTheme(theme));
      })
      .catch((err) => setError(err.message || "Не удалось загрузить тему"));
    return () => {
      cancelled = true;
    };
  }, [isNew, themeId, user]);

  if (!user?.can_manage_variant_themes) {
    return <Navigate to="/cabinet" replace />;
  }

  const patch = (partial) => setForm((prev) => {
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

  const parsedConfig = () => {
    const parsed = JSON.parse(form.configText || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Конфигурация должна быть JSON-объектом");
    }
    return parsed;
  };

  const applyUrls = (saved) => {
    if (!saved) return;
    patch({
      preview_image_url: saved.preview_image_url || "",
      background_image_url: saved.background_image_url || "",
      block_background_image_url: saved.block_background_image_url || "",
    });
  };

  const flushPendingUploads = async (themePk) => {
    const pending = pendingFiles.current;
    let latest = null;
    for (const field of ["preview_image", "background_image", "block_background_image"]) {
      const file = pending[field];
      if (!file) continue;
      latest = await uploadVariantThemeImage(themePk, field, file);
      pending[field] = null;
    }
    return latest;
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      let config;
      try {
        config = parsedConfig();
      } catch (err) {
        setError(err.message || "Некорректный JSON конфигурации");
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
      const themePk = saved?.id || loadedId || themeId;
      setLoadedId(themePk);
      const uploaded = await flushPendingUploads(themePk);
      if (uploaded) saved = uploaded;
      setForm(formFromTheme(saved));
      if (isNew && themePk) {
        navigate(`/cabinet/variant-themes/${themePk}`, { replace: true });
      }
      return saved;
    } catch (err) {
      setError(err.message || "Не удалось сохранить");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const onImageFile = (field, urlKey) => async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const themePk = loadedId || (!isNew ? themeId : null);
    if (!themePk) {
      pendingFiles.current[field] = file;
      patch({ [urlKey]: "" });
      setError("");
      return;
    }
    try {
      const saved = await uploadVariantThemeImage(themePk, field, file);
      applyUrls(saved);
    } catch (err) {
      setError(err.message || "Не удалось загрузить изображение");
    }
  };

  return (
    <CabinetPageShell>
      <CabinetPageHeader
        title={isNew ? "Новая тема варианта" : "Редактирование темы"}
        subtitle="Шаблон оформления. Без произвольного HTML и JavaScript."
        actions={[
          { label: "К списку", href: "/cabinet/variant-themes" },
          { label: saving ? "Сохранение…" : "Сохранить", onClick: save, primary: true },
        ]}
      />
      {error ? <p className="cb-page-sub" role="alert">{error}</p> : null}
      <form
        className="vt-admin-form cb-hw-card"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label>
          Название
          <input value={form.name} onChange={(e) => patch({ name: e.target.value })} required />
        </label>
        <label>
          Slug
          <input value={form.slug} onChange={(e) => patch({ slug: e.target.value })} required />
        </label>
        <label>
          Описание
          <textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={3} />
        </label>
        <label>
          Layout
          <select value={form.layout_type} onChange={(e) => patch({ layout_type: e.target.value })}>
            {VARIANT_THEME_LAYOUTS.map((layout) => (
              <option key={layout} value={layout}>{layout}</option>
            ))}
          </select>
        </label>
        <label>
          Конфигурация JSON
          <span className="cb-page-sub">labels, animation, background, decorations. Сохраняется вместе с темой.</span>
          <textarea
            value={form.configText}
            rows={18}
            spellCheck={false}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}
            onChange={(e) => setForm((prev) => ({ ...prev, configText: e.target.value }))}
            onBlur={() => {
              try {
                const parsed = parsedConfig();
                setForm((prev) => ({
                  ...prev,
                  labels: { ...DEFAULT_VARIANT_THEME_LABELS, ...(parsed.labels || {}) },
                  decorations: Array.isArray(parsed.decorations) ? parsed.decorations : prev.decorations,
                  animation: parsed.animation || prev.animation,
                  background: parsed.background || prev.background,
                }));
              } catch {
                /* keep raw text until save */
              }
            }}
          />
        </label>
        <label>
          Превью
          <input type="file" accept="image/*" onChange={onImageFile("preview_image", "preview_image_url")} />
          {pendingFiles.current.preview_image ? (
            <span className="cb-page-sub">Файл выбран и сохранится вместе с темой</span>
          ) : null}
          {form.preview_image_url ? <img className="vt-admin-preview" src={form.preview_image_url} alt="" /> : null}
        </label>
        <label>
          Фон
          <span className="cb-page-sub">Фон всей страницы варианта</span>
          <input type="file" accept="image/*" onChange={onImageFile("background_image", "background_image_url")} />
          {form.background_image_url ? <img className="vt-admin-preview" src={form.background_image_url} alt="" /> : null}
        </label>
        <label>
          Фон блоков
          <span className="cb-page-sub">Фон карточек: вариант, задания, таймер и оформление</span>
          <input
            type="file"
            accept="image/*"
            onChange={onImageFile("block_background_image", "block_background_image_url")}
          />
          {form.block_background_image_url ? <img className="vt-admin-preview" src={form.block_background_image_url} alt="" /> : null}
        </label>
        <label>
          Animation
          <select value={form.animation} onChange={(e) => patch({ animation: e.target.value })}>
            {VARIANT_THEME_ANIMATIONS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Decorations</legend>
          {VARIANT_THEME_DECORATIONS.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={form.decorations.includes(name)}
                onChange={(e) => {
                  patch({
                    decorations: e.target.checked
                      ? [...form.decorations, name]
                      : form.decorations.filter((item) => item !== name),
                  });
                }}
              />
              {" "}{name}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Названия</legend>
          {Object.keys(DEFAULT_VARIANT_THEME_LABELS).map((key) => (
            <label key={key}>
              {key}
              <input
                value={form.labels[key] || ""}
                onChange={(e) => patch({ labels: { ...form.labels, [key]: e.target.value } })}
              />
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => patch({ is_active: e.target.checked })}
          />
          {" "}Активна
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.is_published}
            onChange={(e) => patch({ is_published: e.target.checked })}
          />
          {" "}Опубликована
        </label>
        <button
          type="button"
          className="cb-btn cb-btn--outline"
          onClick={() => setPreviewOn((v) => !v)}
        >
          {previewOn ? "Скрыть предпросмотр" : "Предпросмотр"}
        </button>
        {previewOn ? (
          <div className={`vt-admin-preview-box variant-theme--${form.layout_type}`}>
            <ThemeDecorations decorations={form.decorations} layoutType={form.layout_type} />
            <ThemeEffects type={form.animation} />
            {form.layout_type === "route" ? (
              <ThemeRouteProgress
                tasks={[1, 2, 3, 4, 5, 6].map((n) => ({ id: n, displayNumber: n }))}
                activeId={4}
              />
            ) : (
              <p style={{ padding: 24 }}>{form.labels.task} 1</p>
            )}
          </div>
        ) : null}
      </form>
    </CabinetPageShell>
  );
}
