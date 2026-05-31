import { useEffect, useState } from "react";

export type VprClass = 7 | 8 | 10;
export type VprSubjectId = "math" | "info" | "phys";

export type SubjectSelectorContinuePayload = {
  selectedClass: VprClass;
  selectedSubject: VprSubjectId;
  advancedLevel: boolean;
};

export type SubjectSelectorProps = {
  /** Вызывается при нажатии «Перейти к заданиям», если выбраны класс и предмет */
  onContinue?: (payload: SubjectSelectorContinuePayload) => void;
  className?: string;
};

const GRADES: VprClass[] = [7, 8, 10];

type SubjectDef = {
  id: VprSubjectId;
  title: string;
  description: string;
  bg: string;
  accent: string;
};

/** Ключи ответа API `/api/vpr/subject-task-counts/` */
type VprApiCountKey = "math" | "inf" | "phys";

const SUBJECTS: SubjectDef[] = [
  {
    id: "math",
    title: "Математика",
    description: "Алгебра, геометрия, ЕГЭ-форматы",
    bg: "#1E3A5F",
    accent: "#3B82F6",
  },
  {
    id: "info",
    title: "Информатика",
    description: "Алгоритмы, программирование, логика",
    bg: "#2D1B69",
    accent: "#8B5CF6",
  },
  {
    id: "phys",
    title: "Физика",
    description: "Механика, электродинамика, расчёты",
    bg: "#064E3B",
    accent: "#10B981",
  },
];

function subjectIdToApiCountKey(id: VprSubjectId): VprApiCountKey {
  return id === "info" ? "inf" : id;
}

/** Склонение «N заданий» для карточки */
function formatRuTaskCount(n: number): string {
  const num = Math.max(0, Math.trunc(Number(n)));
  const abs = num % 100;
  const d = num % 10;
  let word = "заданий";
  if (abs > 10 && abs < 20) word = "заданий";
  else if (d === 1) word = "задание";
  else if (d >= 2 && d <= 4) word = "задания";
  return `${num} ${word}`;
}

function MathIcon() {
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill="white"
        fillOpacity={0.9}
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="26"
        fontWeight={600}
      >
        ∑
      </text>
    </svg>
  );
}

function InfIcon() {
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill="white"
        fillOpacity={0.9}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize="15"
        fontWeight={600}
      >
        {"{ }"}
      </text>
    </svg>
  );
}

function PhysIcon() {
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" aria-hidden className="shrink-0">
      <g transform="translate(18 18)" fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={1.35}>
        <ellipse cx={0} cy={0} rx={14} ry={5.5} transform="rotate(0)" />
        <ellipse cx={0} cy={0} rx={14} ry={5.5} transform="rotate(60)" />
        <ellipse cx={0} cy={0} rx={14} ry={5.5} transform="rotate(120)" />
      </g>
      <circle cx={18} cy={18} r={2.25} fill="white" fillOpacity={0.9} />
    </svg>
  );
}

function MathPattern() {
  return (
    <svg
      className="pointer-events-none absolute right-0 top-1/2 h-[90px] w-[140px] -translate-y-1/2 opacity-[0.10]"
      viewBox="0 0 140 90"
      aria-hidden
    >
      <g stroke="white" fill="none" strokeWidth={1.2}>
        <line x1={12} y1={72} x2={72} y2={72} />
        <line x1={12} y1={72} x2={12} y2={18} />
        <polygon points="68,68 76,68 72,62" fill="white" />
        <polygon points="12,18 8,26 16,26" fill="white" />
        <polygon points="72,72 64,76 64,68" fill="white" />
        <circle cx={52} cy={38} r={18} />
        <polygon points="52,22 65,48 39,48" fill="none" />
      </g>
    </svg>
  );
}

function InfPattern() {
  return (
    <svg
      className="pointer-events-none absolute right-0 top-1/2 h-[90px] w-[140px] -translate-y-1/2 opacity-[0.10]"
      viewBox="0 0 140 90"
      aria-hidden
    >
      <g stroke="white" fill="none" strokeWidth={1.2}>
        <rect x={8} y={8} width={32} height={14} rx={3} />
        <rect x={54} y={8} width={32} height={14} rx={3} />
        <rect x={100} y={8} width={32} height={14} rx={3} />
        <rect x={30} y={36} width={36} height={14} rx={3} />
        <rect x={78} y={36} width={36} height={14} rx={3} />
        <rect x={48} y={64} width={44} height={16} rx={3} />
        <line x1={24} y1={22} x2={24} y2={32} />
        <line x1={70} y1={22} x2={70} y2={32} />
        <line x1={116} y1={22} x2={116} y2={32} />
        <line x1={24} y1={32} x2={48} y2={36} />
        <line x1={70} y1={32} x2={70} y2={36} />
        <line x1={116} y1={32} x2={92} y2={36} />
        <line x1={48} y1={50} x2={70} y2={62} />
        <line x1={96} y1={50} x2={70} y2={62} />
      </g>
    </svg>
  );
}

function PhysPattern() {
  return (
    <svg
      className="pointer-events-none absolute right-0 top-1/2 h-[90px] w-[140px] -translate-y-1/2 opacity-[0.10]"
      viewBox="0 0 140 90"
      aria-hidden
    >
      <path
        d="M 4 45 Q 22 18, 40 45 T 76 45 T 112 45 T 136 45"
        fill="none"
        stroke="white"
        strokeWidth={1.5}
        strokeOpacity={1}
      />
      <path
        d="M 4 52 Q 26 30, 48 52 T 88 52 T 128 52"
        fill="none"
        stroke="white"
        strokeWidth={1}
        strokeOpacity={0.5}
      />
      <path
        d="M 4 58 Q 30 42, 56 58 T 100 58 T 136 58"
        fill="none"
        stroke="white"
        strokeWidth={0.8}
        strokeOpacity={0.35}
      />
    </svg>
  );
}

function SubjectPattern({ id }: { id: VprSubjectId }) {
  if (id === "math") return <MathPattern />;
  if (id === "info") return <InfPattern />;
  return <PhysPattern />;
}

function SubjectIcon({ id }: { id: VprSubjectId }) {
  if (id === "math") return <MathIcon />;
  if (id === "info") return <InfIcon />;
  return <PhysIcon />;
}

export default function SubjectSelector({ onContinue, className }: SubjectSelectorProps) {
  const [selectedClass, setSelectedClass] = useState<VprClass | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<VprSubjectId | null>(null);
  const [advancedLevel, setAdvancedLevel] = useState(false);
  const [taskCounts, setTaskCounts] = useState<Record<VprApiCountKey, number> | null>(null);

  const canContinue = selectedClass != null && selectedSubject != null;

  useEffect(() => {
    const ac = new AbortController();
    const qs = new URLSearchParams();
    if (selectedClass != null) qs.set("grade", String(selectedClass));
    if (advancedLevel) qs.set("advanced", "1");
    const q = qs.toString();
    const url = `/api/vpr/subject-task-counts/${q ? `?${q}` : ""}`;
    fetch(url, { credentials: "same-origin", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (ac.signal.aborted || !data || typeof data !== "object") return;
        setTaskCounts({
          math: Math.max(0, Number(data.math) || 0),
          inf: Math.max(0, Number(data.inf) || 0),
          phys: Math.max(0, Number(data.phys) || 0),
        });
      })
      .catch(() => {
        if (!ac.signal.aborted) setTaskCounts(null);
      });
    return () => ac.abort();
  }, [selectedClass, advancedLevel]);

  const handleContinue = () => {
    if (!canContinue || selectedClass == null || selectedSubject == null) return;
    onContinue?.({
      selectedClass,
      selectedSubject,
      advancedLevel,
    });
  };

  return (
    <div
      className={["vpr-subject-selector mx-auto w-full max-w-5xl px-4", className].filter(Boolean).join(" ")}
    >
      <header className="mb-8 text-center md:text-left">
        <h1 className="text-[22px] font-bold leading-tight text-gray-900">Подготовка к ВПР</h1>
        <p className="mt-1 text-[13px] text-gray-400">Выбери класс и предмет — получи банк заданий</p>
      </header>

      <div className="flex flex-col gap-4 md:flex-row">
        {/* Шаг 1 — класс */}
        <div className="vpr-class-panel w-full shrink-0 md:w-[250px]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">ШАГ 1</p>
          <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-5">
            <h2 className="text-base font-bold text-gray-900">Класс</h2>
            <p className="mt-0.5 text-sm text-gray-500">Для кого готовишься?</p>

            <div className="vpr-grade-row mt-5 flex gap-2">
              {GRADES.map((g) => {
                const sel = selectedClass === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setSelectedClass(g)}
                    className={[
                      "vpr-grade-btn flex h-[58px] w-[58px] shrink-0 flex-col items-center justify-center rounded-[12px] border border-solid transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400",
                      sel
                        ? "border-2 border-amber-500 bg-[#FFFBEB] text-[#92400E]"
                        : "border-[1.5px] border-[#E5E7EB] bg-white text-gray-700 hover:bg-[#F9FAFB]",
                    ].join(" ")}
                  >
                    <span className="select-none text-[19px] font-semibold leading-none tabular-nums">{g}</span>
                    <span
                      className={[
                        "mt-0.5 select-none text-[10px] leading-none",
                        sel ? "text-[#92400E]/80" : "text-gray-400",
                      ].join(" ")}
                    >
                      класс
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="mt-5 flex cursor-pointer items-center gap-2 text-[13px] text-gray-800">
              <input
                type="checkbox"
                checked={advancedLevel}
                onChange={(e) => setAdvancedLevel(e.target.checked)}
                className="size-4 rounded border-gray-300 accent-amber-500"
                style={{ accentColor: "#F59E0B" }}
              />
              Углублённый уровень
            </label>
          </div>
        </div>

        {/* Шаг 2 — предмет */}
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">ШАГ 2</p>
          <div className="rounded-[20px] border border-[#E5E7EB] bg-white p-5">
            <h2 className="text-base font-bold text-gray-900">Предмет</h2>
            <p className="mt-0.5 text-sm text-gray-500">Что будешь тренировать?</p>

            <div className="mt-5 flex flex-col gap-[10px]">
              {SUBJECTS.map((s) => {
                const sel = selectedSubject === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSubject(s.id)}
                    className={[
                      "vpr-subject-card relative flex w-full max-w-full items-center gap-4 overflow-hidden rounded-[14px] border-0 px-4 text-left shadow-none ring-0 transition-all ease-out md:px-5",
                      "h-[72px] md:h-[80px]",
                      sel
                        ? "scale-100 opacity-100 duration-[180ms]"
                        : "scale-y-[0.97] opacity-[0.42] duration-150 hover:scale-y-[0.99] hover:opacity-[0.72]",
                    ].join(" ")}
                    style={{
                      backgroundColor: s.bg,
                      borderRadius: 14,
                      boxShadow: sel ? `0 0 0 3px ${s.accent}` : undefined,
                    }}
                  >
                    <SubjectPattern id={s.id} />
                    <SubjectIcon id={s.id} />
                    <div className="relative z-[1] min-w-0 flex-1 text-left">
                      <div className="text-base font-bold text-white">{s.title}</div>
                      <div className="truncate text-[11px] text-[rgba(255,255,255,0.58)]">{s.description}</div>
                    </div>
                    <span className="relative z-[1] shrink-0 text-[11px] font-medium text-white/40">
                      {taskCounts
                        ? formatRuTaskCount(taskCounts[subjectIdToApiCountKey(s.id)])
                        : "…"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-center">
        <button
          type="button"
          disabled={!canContinue}
          onClick={handleContinue}
          className={[
            "vpr-cta-btn min-w-[220px] rounded-[14px] border-0 px-8 py-0 text-base font-semibold shadow-none transition-all duration-[180ms] ease-out",
            "h-[52px]",
            canContinue
              ? "cursor-pointer bg-amber-500 text-white hover:-translate-y-px hover:bg-amber-600 active:scale-[0.98]"
              : "cursor-not-allowed bg-[#E5E7EB] text-[#9CA3AF]",
          ].join(" ")}
          style={{ borderRadius: 14 }}
        >
          Перейти к заданиям
        </button>
      </div>
    </div>
  );
}
