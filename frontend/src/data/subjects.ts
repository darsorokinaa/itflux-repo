import type { LevelId } from "./levels";

export type SubjectId = "math" | "inf" | "phys" | "chem" | "rus" | "lit" | "history";

export type SubjectIconKind = "sum" | "code" | "atom" | "aa" | "section";

export type SubjectPatternKind = "axes" | "flow" | "waves" | "lines" | "timeline";
export type SubjectMotifKind =
  | "formula"
  | "graph"
  | "figure"
  | "code"
  | "algorithm"
  | "data"
  | "force"
  | "link"
  | "energy"
  | "molecule"
  | "flask"
  | "atom"
  | "text"
  | "quote"
  | "speech"
  | "book"
  | "hero"
  | "quill"
  | "timeline"
  | "landmark"
  | "scroll";

export interface SubjectDefinition {
  id: SubjectId;
  title: string;
  description: string;
  bg: string;
  accent: string;
  icon: SubjectIconKind;
  pattern: SubjectPatternKind;
  patternAsset: string;
  motifs: readonly [SubjectMotifKind, SubjectMotifKind, SubjectMotifKind];
  /** Предмет ещё не открыт — показываем бейдж «Скоро», выбор недоступен */
  comingSoon?: boolean;
}

const PATTERN_MATH = new URL("../assets/subject-patterns/math.svg", import.meta.url).href;
const PATTERN_INF = new URL("../assets/subject-patterns/inf.svg", import.meta.url).href;
const PATTERN_PHYS = new URL("../assets/subject-patterns/phys.svg", import.meta.url).href;
const PATTERN_CHEM = new URL("../assets/subject-patterns/chem.svg", import.meta.url).href;
const PATTERN_RUS = new URL("../assets/subject-patterns/rus.svg", import.meta.url).href;
const PATTERN_LIT = new URL("../assets/subject-patterns/lit.svg", import.meta.url).href;
const PATTERN_HISTORY = new URL("../assets/subject-patterns/history.svg", import.meta.url).href;

const SUBJECT_MATH_BASE: Omit<SubjectDefinition, "comingSoon"> = {
  id: "math",
  title: "Математика",
  description: "Числа, формулы, фигуры и задачи",
  bg: "#1D4ED8",
  accent: "#60A5FA",
  icon: "sum",
  pattern: "axes",
  patternAsset: PATTERN_MATH,
  motifs: ["formula", "graph", "figure"],
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
  patternAsset: PATTERN_INF,
  motifs: ["code", "algorithm", "data"],
};

const SUBJECT_PHYS: SubjectDefinition = {
  id: "phys",
  title: "Физика",
  description: "Движение, энергия и законы природы",
  bg: "#4239B0",
  accent: "#7B74E8",
  icon: "atom",
  pattern: "waves",
  patternAsset: PATTERN_PHYS,
  motifs: ["force", "link", "energy"],
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
  patternAsset: PATTERN_CHEM,
  motifs: ["molecule", "flask", "atom"],
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
  patternAsset: PATTERN_RUS,
  motifs: ["text", "quote", "speech"],
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
  patternAsset: PATTERN_LIT,
  motifs: ["book", "hero", "quill"],
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
  patternAsset: PATTERN_HISTORY,
  motifs: ["timeline", "landmark", "scroll"],
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
