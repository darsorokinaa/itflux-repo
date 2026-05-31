import type { LevelId } from "./levels";

export type SubjectId = "math" | "inf" | "phys" | "rus" | "history";

export type SubjectIconKind = "sum" | "code" | "atom" | "aa" | "section";

export type SubjectPatternKind = "axes" | "flow" | "waves" | "lines" | "timeline";

export interface SubjectDefinition {
  id: SubjectId;
  title: string;
  description: string;
  bg: string;
  accent: string;
  icon: SubjectIconKind;
  pattern: SubjectPatternKind;
  /** Предмет ещё не открыт — показываем бейдж «Скоро», выбор недоступен */
  comingSoon?: boolean;
}

const SUBJECT_MATH_BASE: Omit<SubjectDefinition, "comingSoon"> = {
  id: "math",
  title: "Математика",
  description: "Алгебра, геометрия, ЕГЭ-форматы",
  bg: "#1D4ED8",
  accent: "#60A5FA",
  icon: "sum",
  pattern: "axes",
};

// Математика ОГЭ — уже доступна (задачи добавлены), без бейджа «Скоро»
const SUBJECT_MATH_OGE: SubjectDefinition = { ...SUBJECT_MATH_BASE };

// Остальные уровни — пока «Скоро»
const SUBJECT_MATH: SubjectDefinition = {
  ...SUBJECT_MATH_BASE,
  comingSoon: true,
};

const SUBJECT_INF: SubjectDefinition = {
  id: "inf",
  title: "Информатика",
  description: "Алгоритмы, программирование, логика",
  bg: "#7C3AED",
  accent: "#A78BFA",
  icon: "code",
  pattern: "flow",
};

const SUBJECT_PHYS: SubjectDefinition = {
  id: "phys",
  title: "Физика",
  description: "Механика, электродинамика, расчёты",
  bg: "#059669",
  accent: "#34D399",
  icon: "atom",
  pattern: "waves",
  comingSoon: true,
};

const SUBJECT_RUS: SubjectDefinition = {
  id: "rus",
  title: "Русский язык",
  description: "Орфография, пунктуация, сочинение",
  bg: "#B91C1C",
  accent: "#FCA5A5",
  icon: "aa",
  pattern: "lines",
  comingSoon: true,
};

const SUBJECT_HIST: SubjectDefinition = {
  id: "history",
  title: "История",
  description: "Даты, события, персоналии",
  bg: "#B45309",
  accent: "#FCD34D",
  icon: "section",
  pattern: "timeline",
  comingSoon: true,
};

/** Набор предметов по уровням (информатика — первой в списке). */
export const SUBJECTS_BY_LEVEL: Record<LevelId, SubjectDefinition[]> = {
  vpr: [SUBJECT_INF, SUBJECT_MATH, SUBJECT_PHYS, SUBJECT_RUS, SUBJECT_HIST],
  oge: [SUBJECT_INF, SUBJECT_MATH_OGE, SUBJECT_PHYS, SUBJECT_RUS],
  ege: [SUBJECT_INF, SUBJECT_MATH],
};

export const GRADES_BY_LEVEL: Record<LevelId, number[]> = {
  vpr: [7, 8, 10],
  oge: [9],
  ege: [11],
};
