import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSeasonalTheme } from "./SeasonalThemeProvider";

/**
 * Плавающие кнопки оформления: свёрнуты в одну кнопку,
 * по клику раскрывается список тем периода (вверх, без перекрытия ряда).
 */
export default function SeasonalAppearanceFab({ hidden = false }) {
  const {
    toggleAppearance,
    loading,
    hasSeasonalAppearance,
    periodThemes,
    availableThemes,
    rawTheme,
    theme,
    seasonalEnabled,
  } = useSeasonalTheme();
  const { pathname } = useLocation();
  const [busyId, setBusyId] = useState(null);
  const [open, setOpen] = useState(false);
  const dockRef = useRef(null);

  const inCabinet = pathname.startsWith("/cabinet");

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (dockRef.current && !dockRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (hidden || loading || !hasSeasonalAppearance) return null;

  const current = rawTheme || theme;
  let fabThemes = Array.isArray(periodThemes) ? periodThemes : [];
  if (!fabThemes.length && Array.isArray(availableThemes) && availableThemes.length) {
    fabThemes = availableThemes;
  }
  if (!fabThemes.length && current) {
    fabThemes = [
      {
        id: current.id,
        name: current.name,
        slug: current.slug,
        button_icon_url: current.button_icon_url,
        button_emoji: current.button_emoji,
        allow_user_disable: true,
      },
    ];
  }
  if (!fabThemes.length) return null;

  const activeId =
    seasonalEnabled && current?.id != null ? Number(current.id) : null;
  const single = fabThemes.length === 1;
  const triggerTheme =
    (activeId != null && fabThemes.find((item) => Number(item.id) === activeId))
    || fabThemes[0];

  const onClickTheme = async (item) => {
    if (busyId != null) return;
    setBusyId(item.id);
    try {
      await toggleAppearance(item.id);
      if (!single) setOpen(false);
    } finally {
      setBusyId(null);
    }
  };

  const renderIcon = (item) => {
    const iconUrl = item?.button_icon_url || null;
    const emoji = (item?.button_emoji || "✦").trim() || "✦";
    if (iconUrl) {
      return <img src={iconUrl} alt="" className="seasonal-appearance-fab__img" draggable={false} />;
    }
    return <span className="seasonal-appearance-fab__fallback" aria-hidden="true">{emoji}</span>;
  };

  const dockClass = [
    "seasonal-appearance-fab-dock",
    open ? "seasonal-appearance-fab-dock--open" : "seasonal-appearance-fab-dock--collapsed",
    inCabinet ? "seasonal-appearance-fab-dock--cabinet" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={dockRef}
      className={dockClass}
      role="group"
      aria-label="Сезонное оформление"
    >
      {!single ? (
        <button
          type="button"
          className={`seasonal-appearance-fab seasonal-appearance-fab--trigger${activeId != null ? " seasonal-appearance-fab--on" : " seasonal-appearance-fab--off"}${open ? " seasonal-appearance-fab--expanded" : ""}`}
          onClick={() => setOpen((prev) => !prev)}
          aria-label={open ? "Свернуть темы оформления" : "Темы оформления"}
          aria-expanded={open}
          aria-haspopup="true"
          data-tooltip={open ? "Свернуть" : "Темы оформления"}
        >
          {open ? (
            <span className="seasonal-appearance-fab__close" aria-hidden="true">×</span>
          ) : (
            renderIcon(triggerTheme)
          )}
        </button>
      ) : null}

      <div
        className="seasonal-appearance-fab-dock__themes"
        hidden={!single && !open}
        aria-hidden={!single && !open}
      >
        {fabThemes.map((item) => {
          const isOn = activeId != null && Number(item.id) === activeId;
          const tip = isOn
            ? (item.name ? `Тема: ${item.name}` : "Сезонное оформление")
            : (item.name ? `Включить: ${item.name}` : "Сезонное оформление");

          return (
            <button
              key={item.id}
              type="button"
              className={`seasonal-appearance-fab${isOn ? " seasonal-appearance-fab--on" : " seasonal-appearance-fab--off"}`}
              onClick={() => onClickTheme(item)}
              disabled={busyId != null}
              aria-label={tip}
              aria-pressed={isOn}
              data-tooltip={tip}
              tabIndex={single || open ? 0 : -1}
            >
              {renderIcon(item)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
