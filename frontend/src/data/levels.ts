export type LevelId = "vpr" | "oge" | "ege" | "school";

export interface LevelDefinition {
  id: LevelId;
  /** Короткое имя на карточке */
  title: string;
  description: string;
  /** Базовый цвет уровня (акценты) */
  bg: string;
  accent: string;
  /** Тёмная полоска слева (вертикальная подпись класса) */
  stripBg: string;
  /** Градиент основной области карточки */
  gradientFrom: string;
  gradientTo: string;
  /** Подпись в вертикальной полоске */
  stripLabel: string;
  /** Запасной счётчик заданий на главной, если API вернул 0 */
  fallbackTaskCount: number;
  /** Полное название на странице предметов */
  fullTitle: string;
  /** Текст бейджа «ВПР · 7, 8, 10 класс» */
  badgeLabel: string;
}

export const LEVELS: LevelDefinition[] = [
  {
    id: "oge",
    title: "ОГЭ",
    description: "Задания по типам, варианты для класса",
    bg: "#2B52F5",
    accent: "#2B52F5",
    stripBg: "#1A3CD4",
    gradientFrom: "#1A3CD4",
    gradientTo: "#2B52F5",
    stripLabel: "9 класс",
    fallbackTaskCount: 312,
    fullTitle: "Основной государственный экзамен",
    badgeLabel: "ОГЭ · 9 класс",
  },
  {
    id: "ege",
    title: "ЕГЭ",
    description: "Профильная математика и информатика",
    bg: "#4F46E5",
    accent: "#6366F1",
    stripBg: "#3730A3",
    gradientFrom: "#3730A3",
    gradientTo: "#4F46E5",
    stripLabel: "11 класс",
    fallbackTaskCount: 278,
    fullTitle: "Единый государственный экзамен",
    badgeLabel: "ЕГЭ · 11 класс",
  },
  {
    id: "school",
    title: "Школьная программа",
    description: "Программирование и школьные курсы",
    bg: "#0F766E",
    accent: "#14B8A6",
    stripBg: "#115E59",
    gradientFrom: "#0F766E",
    gradientTo: "#14B8A6",
    stripLabel: "5–11 класс",
    fallbackTaskCount: 40,
    fullTitle: "Школьная программа",
    badgeLabel: "Школа · 5–11 класс",
  },
  {
    id: "vpr",
    title: "ВПР",
    description: "Алгебра, геометрия, ЕГЭ-форматы",
    bg: "#0891B2",
    accent: "#0D9488",
    stripBg: "#0E7490",
    gradientFrom: "#0891B2",
    gradientTo: "#14B8A6",
    stripLabel: "7, 8, 10 класс",
    fallbackTaskCount: 184,
    fullTitle: "Всероссийская проверочная работа",
    badgeLabel: "ВПР · 7, 8, 10 класс",
  },
];

const KNOWN_LEVEL_IDS = new Set<string>(LEVELS.map((l) => l.id));

export function getLevelDef(id: string): LevelDefinition | undefined {
  return LEVELS.find((l) => l.id === id);
}

export function isLevelId(s: string): s is LevelId {
  return KNOWN_LEVEL_IDS.has(s);
}

/** Fallback-подпись, если уровня ещё нет в статическом каталоге. */
export function levelLabel(id: string, fallback = ""): string {
  return getLevelDef(id)?.title || fallback || id;
}
