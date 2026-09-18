import { Link, Navigate, useOutletContext } from "react-router-dom";
import { useEffect, useState } from "react";
import { CabinetPageHeader, CabinetPageShell } from "../CabinetSectionUi";
import { deleteVariantTheme, fetchAdminVariantThemes } from "../../variantThemes/variantThemeApi";

function statusLabel(theme) {
  if (!theme.is_active) return "Выключена";
  if (!theme.is_published) return "Черновик";
  return "Опубликована";
}

export default function CabinetVariantThemesPage() {
  const { user } = useOutletContext();
  const [themes, setThemes] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!user?.can_manage_variant_themes) return undefined;
    let cancelled = false;
    fetchAdminVariantThemes()
      .then((data) => {
        if (!cancelled) setThemes(data?.themes || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить темы");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user?.can_manage_variant_themes) {
    return <Navigate to="/cabinet" replace />;
  }

  return (
    <CabinetPageShell>
      <CabinetPageHeader
        title="Темы вариантов"
        subtitle="Оформление вариантов. Создание шаблонов — только администратор."
        actions={[{ label: "Создать тему", href: "/cabinet/variant-themes/new", primary: true }]}
      />
      {error ? <p className="cb-page-sub" role="alert">{error}</p> : null}
      <div className="cb-hw-card" style={{ overflowX: "auto" }}>
        <table className="vt-admin-table">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Название</th>
              <th>Layout</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {themes.map((theme) => (
              <tr key={theme.id}>
                <td>
                  {theme.preview_image_url ? (
                    <img className="vt-admin-preview" src={theme.preview_image_url} alt="" />
                  ) : (
                    <span className="vt-admin-preview" />
                  )}
                </td>
                <td>{theme.name}</td>
                <td>{theme.layout_type}</td>
                <td>{statusLabel(theme)}</td>
                <td>
                  <Link className="cb-btn cb-btn--outline cb-btn--sm" to={`/cabinet/variant-themes/${theme.id}`}>
                    Изменить
                  </Link>
                  {" "}
                  <button
                    type="button"
                    className="cb-btn cb-btn--outline cb-btn--sm"
                    disabled={busyId === theme.id}
                    onClick={async () => {
                      if (!window.confirm(`Удалить тему «${theme.name}»?`)) return;
                      setBusyId(theme.id);
                      try {
                        await deleteVariantTheme(theme.id);
                        setThemes((prev) => prev.filter((row) => row.id !== theme.id));
                      } catch (err) {
                        setError(err.message || "Не удалось удалить");
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
            {!themes.length ? (
              <tr>
                <td colSpan={5}>Тем пока нет</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </CabinetPageShell>
  );
}
