import type { CSSProperties } from "react";
import type { LevelDefinition, LevelId } from "../data/levels";

const patternWrapStyle: CSSProperties = {
  position: "absolute",
  right: 0,
  top: "50%",
  transform: "translateY(-50%)",
  opacity: 0.1,
  pointerEvents: "none",
  zIndex: 0,
  width: 140,
  height: 90,
};

function LevelPattern({ level }: { level: LevelId }) {
  if (level === "vpr") {
    return (
      <svg className="pointer-events-none" style={patternWrapStyle} viewBox="0 0 140 90" fill="none" aria-hidden>
        <g stroke="white" strokeWidth="1.4">
          <line x1="12" y1="72" x2="120" y2="72" />
          <line x1="12" y1="72" x2="12" y2="16" />
          <circle cx="70" cy="40" r="32" />
          <polygon points="70,12 100,60 40,60" fill="none" />
        </g>
      </svg>
    );
  }
  if (level === "oge") {
    return (
      <svg className="pointer-events-none" style={patternWrapStyle} viewBox="0 0 140 90" fill="none" aria-hidden>
        <g stroke="white" strokeWidth="1.3">
          <rect x="8" y="8" width="40" height="24" rx="4" />
          <rect x="58" y="8" width="40" height="24" rx="4" />
          <rect x="33" y="40" width="40" height="24" rx="4" />
          <rect x="33" y="58" width="40" height="24" rx="4" />
          <line x1="28" y1="32" x2="52" y2="40" />
          <line x1="78" y1="32" x2="52" y2="40" />
          <line x1="52" y1="64" x2="52" y2="58" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="pointer-events-none" style={patternWrapStyle} viewBox="0 0 140 90" fill="none" aria-hidden>
      <path
        d="M6 45 Q 40 20, 70 45 T 134 45"
        stroke="white"
        strokeWidth="2.2"
        fill="none"
        opacity="0.95"
      />
      <path
        d="M6 58 Q 44 40, 72 58 T 134 58"
        stroke="white"
        strokeWidth="1.2"
        fill="none"
        opacity="0.7"
      />
      <path
        d="M6 32 Q 36 12, 68 32 T 120 32"
        stroke="white"
        strokeWidth="1.5"
        fill="none"
        opacity="0.55"
      />
    </svg>
  );
}

const iconGlyphStyle = { color: "rgba(255,255,255,0.9)" as const };

function LevelIcon({ level }: { level: LevelId }) {
  if (level === "vpr") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center" style={iconGlyphStyle} aria-hidden>
        <svg width="36" height="36" viewBox="0 0 36 36">
          <text
            x="18"
            y="25"
            textAnchor="middle"
            fill="currentColor"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "26px" }}
          >
            ∑
          </text>
        </svg>
      </div>
    );
  }
  if (level === "oge") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center" style={iconGlyphStyle} aria-hidden>
        <svg width="36" height="36" viewBox="0 0 36 36">
          <text
            x="18"
            y="22"
            textAnchor="middle"
            fill="currentColor"
            style={{ fontFamily: "ui-monospace, monospace", fontSize: "14px" }}
          >
            &lt;&gt;
          </text>
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center" style={iconGlyphStyle} aria-hidden>
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <g transform="translate(18,18)">
          <ellipse rx="12" ry="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <ellipse
            rx="12"
            ry="5"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
            transform="rotate(60)"
          />
          <ellipse
            rx="12"
            ry="5"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
            transform="rotate(120)"
          />
          <circle cx="0" cy="0" r="2.5" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
}

export type LevelCardProps = {
  level: LevelDefinition;
  taskCountLabel: string;
  selectedLevel: LevelId | null;
  onClick: () => void;
};

export default function LevelCard({ level, taskCountLabel, selectedLevel, onClick }: LevelCardProps) {
  const id = level.id;
  const opacity = selectedLevel === null ? 1 : selectedLevel === id ? 1 : 0.42;
  const transform =
    selectedLevel === null || selectedLevel === id ? "scale(1)" : "scaleY(0.97)";
  const ringSelected = selectedLevel === id ? `, 0 0 0 3px ${level.accent}` : "";
  const boxShadow = `0 2px 12px rgba(0, 0, 0, 0.08)${ringSelected}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 cursor-pointer flex-row overflow-hidden p-0 transition-[opacity,transform,box-shadow] duration-[180ms] ease-out md:flex-1"
      style={{
        minHeight: "96px",
        borderRadius: 14,
        isolation: "isolate",
        opacity,
        transform,
        boxShadow,
      }}
    >
      {/* Вертикальная полоска с классом */}
      <div
        className="flex shrink-0 items-center justify-center self-stretch"
        style={{
          width: "12%",
          minWidth: 44,
          maxWidth: 56,
          background: level.stripBg,
        }}
      >
        <span
          className="whitespace-nowrap leading-tight"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: "rgba(255,255,255,0.92)",
            textAlign: "left",
          }}
        >
          {level.stripLabel}
        </span>
      </div>

      {/* Основная область: иконка | текст | счётчик — один горизонтальный ряд */}
      <div
        className="relative min-w-0 flex-1 self-stretch"
        style={{
          background: `linear-gradient(95deg, ${level.gradientFrom} 0%, ${level.gradientTo} 100%)`,
        }}
      >
        <LevelPattern level={level.id} />
        <div
          className="relative z-[1] flex h-full min-w-0 flex-row items-center gap-4"
          style={{ padding: "10px 20px", textAlign: "left" }}
        >
          <LevelIcon level={level.id} />
          <div className="min-w-0 flex-1" style={{ textAlign: "left" }}>
            <div className="text-base font-bold leading-tight" style={{ color: "#ffffff" }}>
              {level.title}
            </div>
            <div
              className="break-words text-[11px] leading-snug whitespace-normal"
              style={{ color: "rgba(255,255,255,0.58)", textAlign: "left" }}
            >
              {level.description}
            </div>
          </div>
          <span
            className="shrink-0 self-center text-[11px] font-medium whitespace-nowrap"
            style={{ color: "rgba(255,255,255,0.4)", textAlign: "left" }}
          >
            {taskCountLabel}
          </span>
        </div>
      </div>
    </button>
  );
}
