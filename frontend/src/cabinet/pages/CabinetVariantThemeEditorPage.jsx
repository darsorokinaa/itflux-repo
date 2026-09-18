import { Navigate, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
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

const EMPTY_FORM = {
  name: "",
  slug: "",
  description: "",
  layout_type: "classic",
  is_active: true,
  is_published: false,
  labels: { ...DEFAULT_VARIANT_THEME_LABELS },
  decorations: [],
  animation: "none",
  preview_image_url: "",
  background_image_url: "",
  block_background_image_url: "",
};

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
        setForm({
          name: theme.name || "",
          slug: theme.slug || "",
          description: theme.description || "",
          layout_type: theme.layout_type || "classic",
          is_active: Boolean(theme.is_active),
          is_published: Boolean(theme.is_published),
          labels: { ...DEFAULT_VARIANT_THEME_LABELS, ...(theme.config?.labels || {}) },
          decorations: theme.config?.decorations || [],
          animation: theme.config?.animation || "none",
          preview_image_url: theme.preview_image_url || "",
          background_image_url: theme.background_image_url || theme.config?.background?.url || "",
          block_background_image_url: theme.block_background_image_url || "",
        });
      })
      .catch((err) => setError(err.message || "Не удалось загрузить тему"));
    return () => {
      cancelled = true;
    };
  }, [isNew, themeId, user]);

  const payload = useMemo(() => ({
    name: form.name,
    slug: form.slug,
    description: form.description,
    layout_type: form.layout_type,
    is_active: form.is_active,
    is_published: form.is_published,
    config: {
      labels: form.labels,
      decorations: form.decorations,
      animation: form.animation,
    },
  }), [form]);

  if (!user?.can_manage_variant_themes) {
    return <Navigate to="/cabinet" replace />;
  }

  const patch = (partial) => setForm((prev) => ({ ...prev, ...partial }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = isNew
        ? await createVariantTheme(payload)
        : await updateVariantTheme(loadedId || themeId, payload);
      navigate("/cabinet/variant-themes");
      return saved;
    } catch (err) {
      setError(err.message || "Не удалось сохранить");
      return null;
    } finally {
      setSaving(false);
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
          Превью
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (isNew) {
                setError("Сначала сохраните тему, затем загрузите изображение");
                return;
              }
              try {
                const saved = await uploadVariantThemeImage(loadedId || themeId, "preview_image", file);
                patch({ preview_image_url: saved?.preview_image_url || "" });
              } catch (err) {
                setError(err.message || "Не удалось загрузить превью");
              }
            }}
          />
          {form.preview_image_url ? <img className="vt-admin-preview" src={form.preview_image_url} alt="" /> : null}
        </label>
        <label>
          Фон
          <span className="cb-page-sub">Фон всей страницы варианта</span>
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (isNew) {
                setError("Сначала сохраните тему, затем загрузите фон");
                return;
              }
              try {
                const saved = await uploadVariantThemeImage(loadedId || themeId, "background_image", file);
                patch({ background_image_url: saved?.background_image_url || "" });
              } catch (err) {
                setError(err.message || "Не удалось загрузить фон");
              }
            }}
          />
          {form.background_image_url ? <img className="vt-admin-preview" src={form.background_image_url} alt="" /> : null}
        </label>
        <label>
          Фон блоков
          <span className="cb-page-sub">Фон карточек: вариант, задания, таймер и оформление</span>
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (isNew) {
                setError("Сначала сохраните тему, затем загрузите фон блоков");
                return;
              }
              try {
                const saved = await uploadVariantThemeImage(loadedId || themeId, "block_background_image", file);
                patch({ block_background_image_url: saved?.block_background_image_url || "" });
              } catch (err) {
                setError(err.message || "Не удалось загрузить фон блоков");
              }
            }}
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
