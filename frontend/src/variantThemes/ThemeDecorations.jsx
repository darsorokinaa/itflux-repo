export default function ThemeDecorations({ decorations = [], layoutType = "classic" }) {
  if (layoutType === "classic" || !Array.isArray(decorations) || decorations.length === 0) {
    return null;
  }
  const set = new Set(decorations);
  return (
    <div className="variant-theme-decor" aria-hidden="true">
      {set.has("map") || layoutType === "route" ? <div className="variant-theme-decor__map" /> : null}
      {set.has("clouds") ? (
        <>
          <span className="variant-theme-decor__cloud variant-theme-decor__cloud--a" />
          <span className="variant-theme-decor__cloud variant-theme-decor__cloud--b" />
          <span className="variant-theme-decor__cloud variant-theme-decor__cloud--c" />
        </>
      ) : null}
    </div>
  );
}
