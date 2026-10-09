import DecorationSample, { DecorationPatternLayer, decorationById, decorationPageKind } from "./decorations";

function layerClass(kind, contained) {
  return `variant-theme-decor variant-theme-decor--${kind}${contained ? " variant-theme-decor--contained" : ""}`;
}

export default function ThemeDecorations({ decorations = [], layoutType = "classic", contained = false }) {
  const selected = (Array.isArray(decorations) ? decorations : [])
    .map((name) => decorationById(name))
    .filter(Boolean);
  if (!contained && layoutType === "classic") return null;
  if (!selected.length) return null;

  const background = selected.filter((item) => item.group === "background");
  const scenes = background.filter((item) => decorationPageKind(item) === "scene");
  const patterns = background.filter((item) => decorationPageKind(item) === "pattern");

  return (
    <>
      {background.length ? (
        <div className={layerClass("background", contained)} aria-hidden="true">
          {background.some((item) => item.render === "map") ? <div className="variant-theme-decor__map" /> : null}
          {background.some((item) => item.render === "clouds") ? (
            <>
              <span className="variant-theme-decor__cloud variant-theme-decor__cloud--a" />
              <span className="variant-theme-decor__cloud variant-theme-decor__cloud--b" />
              <span className="variant-theme-decor__cloud variant-theme-decor__cloud--c" />
            </>
          ) : null}
          <DecorationPatternLayer decorations={patterns.map((item) => item.id)} />
          {scenes.map((item) => (
            <span key={item.id} className={`variant-theme-decor__scene variant-theme-decor__scene--${item.id}`} style={item.place}>
              <DecorationSample name={item.id} />
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
