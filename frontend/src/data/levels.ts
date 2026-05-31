export type LevelId = "vpr" | "oge" | "ege";

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
];

export function getLevelDef(id: LevelId): LevelDefinition | undefined {
  return LEVELS.find((l) => l.id === id);
}

export function isLevelId(s: string): s is LevelId {
  return s === "vpr" || s === "oge" || s === "ege";
}
