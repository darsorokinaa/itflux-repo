/**
 * Каталог декоративных элементов темы варианта.
 *
 * Логика:
 * - background + render: "pattern" — прозрачный повторяющийся паттерн на весь лист;
 * - все фоновые декорации сделаны паттернами без собственной прямоугольной подложки;
 * - line — маршрут/соединительная линия;
 *
 * ВАЖНО:
 * id существующих элементов сохранены, чтобы не ломать сохранённые темы.
 */

function Picture({ children }) {
  return (
    <svg
      viewBox="0 0 72 44"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const DECORATION_GROUP_META = [
  {
    id: "background",
    title: "Фон",
    hint: "Прозрачные декоративные паттерны на весь лист",
  },
  {
    id: "line",
    title: "Соединительная линия",
    hint: "Линии и точки между заданиями или остановками маршрута",
  },
];

export const DECORATIONS = [
  // =========================================================
  // BACKGROUNDS — ВСЕ КАК ПРОЗРАЧНЫЕ ПАТТЕРНЫ НА ВЕСЬ ЛИСТ
  // =========================================================

  {
    id: "clouds",
    group: "background",
    render: "pattern",
    pattern: "clouds",
    label: "Облака",
    sample: (
      <Picture>
        <g fill="#AEBFC3" opacity=".58">
          <path d="M5 28c0-4 3.2-7 7.2-7 .7-4.5 4.4-7.8 9-7.8 4.2 0 7.7 2.7 8.9 6.4 1.2-.6 2.6-1 4.1-1 4 0 7.3 2.9 7.7 6.6h.5c3.4 0 6.1 2.4 6.1 5.4H5z" />
          <path d="M45 16c0-2.1 1.8-3.8 4-3.8.6-2.5 3-4.3 5.8-4.3 3.2 0 5.7 2.2 5.9 5.1h.4c2.3 0 4.1 1.4 4.4 3.4H45z" />
        </g>
      </Picture>
    ),
  },

  {
    id: "stars",
    group: "background",
    render: "pattern",
    pattern: "stars",
    label: "Звёздочки",
    sample: (
      <Picture>
        <g fill="#C6B47D" opacity=".72">
          <path d="M8 7l.8 2 2.2.2-1.7 1.4.5 2.1L8 11.6l-1.8 1.1.5-2.1L5 9.2 7.2 9z" />
          <path d="M31 12l.7 1.7 1.9.1-1.5 1.2.5 1.8-1.6-1-1.6 1 .5-1.8-1.5-1.2 1.9-.1z" />
          <path d="M57 8l.9 2.1 2.3.2-1.8 1.5.6 2.2-2-1.2-2 1.2.6-2.2-1.8-1.5 2.3-.2z" />
          <path d="M19 32l.6 1.5 1.7.1-1.3 1.1.4 1.6-1.4-.9-1.5.9.4-1.6-1.3-1.1 1.7-.1z" />
          <path d="M48 31l.7 1.6 1.7.2-1.3 1.1.4 1.6-1.5-.9-1.5.9.5-1.6-1.4-1.1 1.8-.2z" />
        </g>
      </Picture>
    ),
  },

  {
    id: "map",
    group: "background",
    render: "pattern",
    pattern: "map",
    label: "Карта",
    sample: (
      <Picture>
        <g opacity=".72">
          <path
            d="M5 34C15 29 14 18 25 19s10 11 21 9 10-11 20-14"
            fill="none"
            stroke="#6E8D92"
            strokeWidth="1.45"
            strokeDasharray="2 2.4"
            strokeLinecap="round"
          />
          <g fill="#FFFDF8" stroke="#6E8D92" strokeWidth="1.1">
            <circle cx="6" cy="34" r="2.2" />
            <circle cx="25" cy="19" r="2.2" />
            <circle cx="47" cy="28" r="2.2" />
            <circle cx="66" cy="14" r="2.2" />
          </g>
        </g>
      </Picture>
    ),
  },

  {
    id: "mountains",
    group: "background",
    render: "pattern",
    pattern: "mountains",
    label: "Горы",
    sample: (
      <Picture>
        <g opacity=".68" fill="none" strokeLinejoin="round">
          <path d="M4 36l11-13 6 6 12-18 12 15 7-7 15 17" stroke="#87928C" strokeWidth="1.5" />
          <path d="M38 36l8-10 5 5 8-13 9 18" stroke="#6F7C77" strokeWidth="1.25" />
        </g>
        <path d="M33 11l3 4-2.5-.9-2.2 1.2z" fill="#DADFD9" opacity=".68" />
      </Picture>
    ),
  },

  {
    id: "sea",
    group: "background",
    render: "pattern",
    pattern: "sea",
    label: "Море",
    sample: (
      <Picture>
        <g fill="none" strokeLinecap="round">
          <path d="M0 18c6-2 10 2 16 0s10-2 16 0 10 2 16 0 10-2 16 0 8 2 8 0" stroke="#8FB4BA" strokeWidth="1.8" opacity=".72" />
          <path d="M0 28c6-2 10 2 16 0s10-2 16 0 10 2 16 0 10-2 16 0 8 2 8 0" stroke="#B7D0D3" strokeWidth="1.4" opacity=".72" />
          <path d="M0 38c6-2 10 2 16 0s10-2 16 0 10 2 16 0 10-2 16 0 8 2 8 0" stroke="#9DBEC2" strokeWidth="1.3" opacity=".55" />
        </g>
      </Picture>
    ),
  },

  {
    id: "sailboats",
    group: "background",
    render: "pattern",
    pattern: "sailboats",
    label: "Парусники",
    sample: (
      <Picture>
        <g opacity=".7">
          <g transform="translate(8 5)">
            <path d="M14 29V10" stroke="#566C72" strokeWidth="1.1" />
            <path d="M14 11L5 26h9z" fill="#DCE5E2" />
            <path d="M15 14l7 12h-7z" fill="#D1BD91" />
            <path d="M5 28h18l-2.5 4h-13z" fill="#637C81" />
          </g>
          <g transform="translate(41 12) scale(.62)">
            <path d="M14 29V10" stroke="#566C72" strokeWidth="1.1" />
            <path d="M14 11L5 26h9z" fill="#DCE5E2" />
            <path d="M15 14l7 12h-7z" fill="#D1BD91" />
            <path d="M5 28h18l-2.5 4h-13z" fill="#637C81" />
          </g>
        </g>
      </Picture>
    ),
  },

  {
    id: "leaves",
    group: "background",
    render: "pattern",
    pattern: "leaves",
    label: "Листочки",
    sample: (
      <Picture>
        <g fill="#94A083" opacity=".66">
          <ellipse cx="12" cy="10" rx="4.4" ry="2.1" transform="rotate(-35 12 10)" />
          <ellipse cx="31" cy="24" rx="4" ry="2" transform="rotate(28 31 24)" />
          <ellipse cx="57" cy="11" rx="4.4" ry="2.1" transform="rotate(-20 57 11)" />
          <ellipse cx="18" cy="36" rx="3.5" ry="1.7" transform="rotate(20 18 36)" />
          <ellipse cx="55" cy="34" rx="4.1" ry="2" transform="rotate(-30 55 34)" />
        </g>
      </Picture>
    ),
  },

  {
    id: "flowers",
    group: "background",
    render: "pattern",
    pattern: "flowers",
    label: "Цветочки",
    sample: (
      <Picture>
        <g opacity=".72">
          <g transform="translate(11 10)">
            <circle cx="0" cy="-2.8" r="2.1" fill="#DCC8C1" />
            <circle cx="2.8" cy="0" r="2.1" fill="#DCC8C1" />
            <circle cx="0" cy="2.8" r="2.1" fill="#DCC8C1" />
            <circle cx="-2.8" cy="0" r="2.1" fill="#DCC8C1" />
            <circle r="1.25" fill="#C3A66D" />
          </g>
          <g transform="translate(37 23) scale(.78)">
            <circle cx="0" cy="-2.8" r="2.1" fill="#CDD4C0" />
            <circle cx="2.8" cy="0" r="2.1" fill="#CDD4C0" />
            <circle cx="0" cy="2.8" r="2.1" fill="#CDD4C0" />
            <circle cx="-2.8" cy="0" r="2.1" fill="#CDD4C0" />
            <circle r="1.25" fill="#BCA268" />
          </g>
          <g transform="translate(60 11) scale(.66)">
            <circle cx="0" cy="-2.8" r="2.1" fill="#DECBC5" />
            <circle cx="2.8" cy="0" r="2.1" fill="#DECBC5" />
            <circle cx="0" cy="2.8" r="2.1" fill="#DECBC5" />
            <circle cx="-2.8" cy="0" r="2.1" fill="#DECBC5" />
            <circle r="1.25" fill="#C0A36A" />
          </g>
        </g>
      </Picture>
    ),
  },

  // =========================================================
  // LINES
  // =========================================================

  {
    id: "route",
    group: "line",
    line: "solid",
    label: "Линия маршрута",
    sample: (
      <Picture>
        <path
          d="M8 34C17 35 20 26 24 20c5-7 12-9 19-5 7 4 9 13 17 10 3-1 5-4 7-8"
          fill="none"
          stroke="#607D84"
          strokeWidth="2"
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
        <g fill="#FFFDF8" stroke="#607D84" strokeWidth="1.5">
          <circle cx="9" cy="34" r="3" />
          <circle cx="43" cy="15" r="3" />
          <circle cx="67" cy="17" r="3" />
        </g>
      </Picture>
    ),
  },

  {
    id: "route-dots",
    group: "line",
    line: "dots",
    label: "Точки маршрута",
    sample: (
      <Picture>
        <path d="M12 24H60" stroke="#CCD6D5" strokeWidth="1.5" />
        <circle cx="14" cy="24" r="5" fill="#5E7C82" />
        <circle cx="36" cy="24" r="5" fill="#FFFDF8" stroke="#5E7C82" strokeWidth="1.5" />
        <circle cx="58" cy="24" r="5" fill="#D7C6A0" stroke="#5E7C82" strokeWidth="1.5" />
      </Picture>
    ),
  },
];

export const ANIMATIONS = [
  { id: "none", label: "Без анимации" },
  {
    id: "falling-leaves",
    label: "Падающие листья",
    particles: { narrow: 8, wide: 14, color: "#A88A55", shape: "leaf" },
  },
  {
    id: "snow",
    label: "Снег",
    particles: { narrow: 8, wide: 14, color: "#ffffff", shape: "dot" },
  },
  {
    id: "floating-stars",
    label: "Мерцающие звёзды",
    particles: { narrow: 10, wide: 16, color: "#D8C58B", shape: "star" },
  },
  {
    id: "clouds",
    label: "Плывущие облака",
    particles: {
      narrow: 3,
      wide: 5,
      color: "rgba(255, 255, 255, 0.92)",
      shape: "cloud",
    },
  },
];

const GROUP_IDS = new Set(DECORATION_GROUP_META.map((group) => group.id));

export const DECORATION_GROUPS = DECORATION_GROUP_META.map((group) => ({
  ...group,
  items: DECORATIONS.filter((item) => item.group === group.id).map((item) => item.id),
}));

export const DECORATION_LABELS = Object.fromEntries(
  DECORATIONS.map((item) => [item.id, item.label]),
);

export const VARIANT_THEME_DECORATIONS = DECORATIONS.map((item) => item.id);

export const VARIANT_THEME_ANIMATIONS = ANIMATIONS.map((item) => item.id);

export const ANIMATION_LABELS = Object.fromEntries(
  ANIMATIONS.map((item) => [item.id, item.label]),
);

const ANIMATION_BY_ID = new Map(ANIMATIONS.map((item) => [item.id, item]));

export function animationById(id) {
  return ANIMATION_BY_ID.get(String(id || "").toLowerCase()) || null;
}

const BY_ID = new Map(DECORATIONS.map((item) => [item.id, item]));

export function decorationById(id) {
  return BY_ID.get(id) || null;
}

export function decorationLineKind(decorations) {
  const selected = new Set(Array.isArray(decorations) ? decorations : []);
  const lines = DECORATIONS.filter(
    (item) => item.group === "line" && selected.has(item.id),
  );

  if (lines.some((item) => item.line === "dots")) return "dots";
  if (lines.some((item) => item.line === "solid")) return "solid";
  return "none";
}

export function decorationPageKind(item) {
  if (!item || !GROUP_IDS.has(item.group)) return null;
  if (item.render === "pattern") return "pattern";
  if (item.group === "background") return "pattern";
  return null;
}

/**
 * Полноразмерный прозрачный слой с повторяющимися декоративными элементами.
 *
 * Вставляйте его внутрь контейнера страницы:
 *
 * <div className="variant-page">
 *   <DecorationPatternLayer decorations={decorations} />
 *   <div className="variant-page-content">...</div>
 * </div>
 */
export function DecorationPatternLayer({ decorations = [] }) {
  const selected = new Set(Array.isArray(decorations) ? decorations : []);

  const patternComponents = {
    clouds: CloudsPattern,
    stars: StarsPattern,
    map: MapPattern,
    mountains: MountainsPattern,
    sea: SeaPattern,
    sailboats: SailboatsPattern,
    leaves: LeavesPattern,
    flowers: FlowersPattern,
  };

  const activePatterns = DECORATIONS.filter(
    (item) =>
      item.group === "background" &&
      item.render === "pattern" &&
      selected.has(item.id) &&
      patternComponents[item.pattern],
  );

  if (!activePatterns.length) return null;

  return (
    <div className="vt-pattern-layer" aria-hidden="true">
      {activePatterns.map((item) => {
        const PatternComponent = patternComponents[item.pattern];
        return <PatternComponent key={item.id} />;
      })}
    </div>
  );
}

function PatternSvg({ children, className = "" }) {
  return (
    <svg
      className={`vt-pattern-svg ${className}`}
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}


function CloudsPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--clouds">
      <defs>
        <pattern id="vt-clouds-pattern" width="210" height="150" patternUnits="userSpaceOnUse">
          <g fill="#AEBFC3" opacity=".14">
            <path d="M16 64c0-7 5.5-12.5 12.5-12.5 1.2-8 8-13.5 15.8-13.5 7.3 0 13.4 4.7 15.4 11.2 2-1.1 4.5-1.7 7.1-1.7 7 0 12.6 5 13.3 11.5h.9c5.9 0 10.6 4.2 10.6 9.4H16z" />
            <path d="M125 117c0-4.6 3.8-8.2 8.7-8.2.9-5.4 5.6-9.2 11.2-9.2 5.9 0 10.8 4 11.7 9.4 1.5-.7 3.1-1.1 4.8-1.1 5.2 0 9.4 3.7 9.8 8.6h.6c4.2 0 7.6 3 7.6 6.7h-54.4z" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#vt-clouds-pattern)" />
    </PatternSvg>
  );
}

function MapPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--map">
      <defs>
        <pattern id="vt-map-pattern" width="190" height="155" patternUnits="userSpaceOnUse">
          <g opacity=".15">
            <path d="M18 111C37 101 34 75 58 75s21 21 40 21 21-20 40-26"
              fill="none" stroke="#6E8D92" strokeWidth="1.8"
              strokeDasharray="2.3 2.8" strokeLinecap="round" />
            <g fill="#FFFDF8" stroke="#6E8D92" strokeWidth="1.2">
              <circle cx="18" cy="111" r="3.1" />
              <circle cx="58" cy="75" r="3.1" />
              <circle cx="98" cy="96" r="3.1" />
              <circle cx="138" cy="70" r="3.1" />
            </g>
            <path d="M26 31h18M119 30h14M145 126h20" stroke="#A9B6AA" strokeWidth="1.3" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#vt-map-pattern)" />
    </PatternSvg>
  );
}

function MountainsPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--mountains">
      <defs>
        <pattern id="vt-mountains-pattern" width="205" height="155" patternUnits="userSpaceOnUse">
          <g opacity=".14" fill="none" strokeLinejoin="round">
            <path d="M14 122l24-30 13 13 25-38 25 32 13-12 26 35" stroke="#87928C" strokeWidth="2" />
            <path d="M99 126l16-21 10 10 16-26 21 37" stroke="#6F7C77" strokeWidth="1.7" />
          </g>
          <g fill="#BFC6C0" opacity=".12">
            <path d="M73 67l4 6-3.2-1.2-3 1.6z" />
            <path d="M139 89l3.3 4.7-2.6-.9-2.3 1.2z" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#vt-mountains-pattern)" />
    </PatternSvg>
  );
}

function SeaPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--sea">
      <defs>
        <pattern id="vt-sea-pattern" width="185" height="135" patternUnits="userSpaceOnUse">
          <g fill="none" strokeLinecap="round" opacity=".14">
            <path d="M0 36c10-3 16 3 26 0s16-3 26 0 16 3 26 0 16-3 26 0 16 3 26 0 16-3 30 0"
              stroke="#82AEB5" strokeWidth="2.2" />
            <path d="M0 65c10-3 16 3 26 0s16-3 26 0 16 3 26 0 16-3 26 0 16 3 26 0 16-3 30 0"
              stroke="#A8C8CC" strokeWidth="1.7" />
            <path d="M0 96c10-3 16 3 26 0s16-3 26 0 16 3 26 0 16-3 26 0 16 3 26 0 16-3 30 0"
              stroke="#8FB5BA" strokeWidth="1.5" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#vt-sea-pattern)" />
    </PatternSvg>
  );
}

function SailboatsPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--sailboats">
      <defs>
        <pattern id="vt-sailboats-pattern" width="210" height="165" patternUnits="userSpaceOnUse">
          <g opacity=".14">
            <g transform="translate(26 34)">
              <path d="M18 40V12" stroke="#566C72" strokeWidth="1.7" />
              <path d="M18 14L4 36h14z" fill="#9FB4B2" />
              <path d="M20 18l11 18H20z" fill="#C4AD7D" />
              <path d="M4 39h28l-4 6H8z" fill="#627B80" />
            </g>
            <g transform="translate(132 98) scale(.62)">
              <path d="M18 40V12" stroke="#566C72" strokeWidth="1.7" />
              <path d="M18 14L4 36h14z" fill="#9FB4B2" />
              <path d="M20 18l11 18H20z" fill="#C4AD7D" />
              <path d="M4 39h28l-4 6H8z" fill="#627B80" />
            </g>
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#vt-sailboats-pattern)" />
    </PatternSvg>
  );
}

function StarsPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--stars">
      <defs>
        <pattern
          id="vt-stars-pattern"
          width="150"
          height="132"
          patternUnits="userSpaceOnUse"
        >
          <g fill="#C7B47C" opacity=".20">
            <path d="M25 17l1.5 3.7 4 .3-3.1 2.5 1 3.9-3.4-2.1-3.4 2.1 1-3.9-3.1-2.5 4-.3z" />
            <path
              transform="translate(86 20) scale(.72)"
              d="M25 17l1.5 3.7 4 .3-3.1 2.5 1 3.9-3.4-2.1-3.4 2.1 1-3.9-3.1-2.5 4-.3z"
            />
            <path
              transform="translate(40 82) scale(.56)"
              d="M25 17l1.5 3.7 4 .3-3.1 2.5 1 3.9-3.4-2.1-3.4 2.1 1-3.9-3.1-2.5 4-.3z"
            />
            <path
              transform="translate(108 88) scale(.44)"
              d="M25 17l1.5 3.7 4 .3-3.1 2.5 1 3.9-3.4-2.1-3.4 2.1 1-3.9-3.1-2.5 4-.3z"
            />
            <circle cx="18" cy="108" r="1.5" />
            <circle cx="124" cy="48" r="1.2" />
            <circle cx="74" cy="114" r=".9" />
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="100%" fill="url(#vt-stars-pattern)" />
    </PatternSvg>
  );
}

function FlowersPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--flowers">
      <defs>
        <pattern
          id="vt-flowers-pattern"
          width="170"
          height="150"
          patternUnits="userSpaceOnUse"
        >
          <g opacity=".19">
            <Flower x={25} y={25} scale={1} petals="#D8C2BB" center="#BCA066" />
            <Flower x={126} y={62} scale={0.78} petals="#C8D0B9" center="#B99D66" />
            <Flower x={68} y={126} scale={0.58} petals="#DDC8C1" center="#B79B62" />
            <Flower x={148} y={126} scale={0.46} petals="#D4D0BE" center="#B69A63" />
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="100%" fill="url(#vt-flowers-pattern)" />
    </PatternSvg>
  );
}

function Flower({ x, y, scale = 1, petals, center }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <circle cx="0" cy="-5" r="3.6" fill={petals} />
      <circle cx="5" cy="0" r="3.6" fill={petals} />
      <circle cx="0" cy="5" r="3.6" fill={petals} />
      <circle cx="-5" cy="0" r="3.6" fill={petals} />
      <circle cx="0" cy="0" r="2.2" fill={center} />
    </g>
  );
}

function LeavesPattern() {
  return (
    <PatternSvg className="vt-pattern-svg--leaves">
      <defs>
        <pattern
          id="vt-leaves-pattern"
          width="160"
          height="140"
          patternUnits="userSpaceOnUse"
        >
          <g fill="#8E9B80" opacity=".17">
            <ellipse cx="24" cy="28" rx="8" ry="4" transform="rotate(-32 24 28)" />
            <ellipse cx="105" cy="42" rx="7" ry="3.5" transform="rotate(25 105 42)" />
            <ellipse cx="62" cy="105" rx="7.5" ry="3.8" transform="rotate(-20 62 105)" />
            <ellipse cx="138" cy="119" rx="6" ry="3" transform="rotate(34 138 119)" />
            <ellipse cx="26" cy="118" rx="6.5" ry="3.2" transform="rotate(14 26 118)" />
          </g>

          <g stroke="#8E9B80" strokeWidth=".8" opacity=".12" strokeLinecap="round">
            <path d="M18 32l12-8" />
            <path d="M99 46l12-8" />
            <path d="M56 109l12-8" />
            <path d="M133 123l10-7" />
            <path d="M20 122l11-7" />
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="100%" fill="url(#vt-leaves-pattern)" />
    </PatternSvg>
  );
}

export default function DecorationSample({ name }) {
  const item = decorationById(name);
  if (!item?.sample) return null;

  return (
    <span className={`vt-decor-sample vt-decor-sample--${item.id}`}>
      {item.sample}
    </span>
  );
}
