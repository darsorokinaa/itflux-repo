import type { LevelId } from "./levels";

export type SubjectId = "math" | "inf" | "phys" | "chem" | "rus" | "lit" | "history";

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
  description: "Числа, формулы, фигуры и задачи",
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
  description: "Алгоритмы, код, логика и данные",
  bg: "#7C3AED",
  accent: "#A78BFA",
  icon: "code",
  pattern: "flow",
};

const SUBJECT_PHYS: SubjectDefinition = {
  id: "phys",
  title: "Физика",
  description: "Движение, энергия и законы природы",
  bg: "#4239B0",
  accent: "#7B74E8",
  icon: "atom",
  pattern: "waves",
  comingSoon: true,
};

const SUBJECT_CHEM: SubjectDefinition = {
  id: "chem",
  title: "Химия",
  description: "Вещества, реакции и свойства материалов",
  bg: "#0A8A62",
  accent: "#54C59F",
  icon: "atom",
  pattern: "waves",
  comingSoon: true,
};

const SUBJECT_RUS: SubjectDefinition = {
  id: "rus",
  title: "Русский язык",
  description: "Правила, тексты и грамотная речь",
  bg: "#D84A6A",
  accent: "#F58FA7",
  icon: "aa",
  pattern: "lines",
  comingSoon: true,
};

const SUBJECT_LIT: SubjectDefinition = {
  id: "lit",
  title: "Литература",
  description: "Книги, герои, авторы и смыслы",
  bg: "#7D46E3",
  accent: "#B38CFB",
  icon: "section",
  pattern: "timeline",
  comingSoon: true,
};

const SUBJECT_HIST: SubjectDefinition = {
  id: "history",
  title: "История",
  description: "События, личности и прошлое мира",
  bg: "#B45309",
  accent: "#FCD34D",
  icon: "section",
  pattern: "timeline",
  comingSoon: true,
};

/** Набор предметов по уровням (информатика — первой в списке). */
export const SUBJECTS_BY_LEVEL: Record<LevelId, SubjectDefinition[]> = {
  vpr: [SUBJECT_INF, SUBJECT_MATH, SUBJECT_PHYS, SUBJECT_RUS, SUBJECT_HIST],
  oge: [SUBJECT_MATH_OGE, SUBJECT_INF, SUBJECT_PHYS, SUBJECT_CHEM, SUBJECT_RUS, SUBJECT_LIT],
  ege: [SUBJECT_INF, SUBJECT_MATH, SUBJECT_RUS],
};

export const GRADES_BY_LEVEL: Record<LevelId, number[]> = {
  vpr: [7, 8, 10],
  oge: [9],
  ege: [11],
};
