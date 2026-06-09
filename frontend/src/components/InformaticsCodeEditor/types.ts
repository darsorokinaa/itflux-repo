export type CodeLanguage = "python" | "python-turtle";

export type CodeLanguageOption = {
  id: CodeLanguage;
  label: string;
  hint: string;
};

export const CODE_LANGUAGES: CodeLanguageOption[] = [
  {
    id: "python",
    label: "Python 3",
    hint: "Полный Python в браузере, чтение и запись файлов",
  },
  {
    id: "python-turtle",
    label: "Turtle",
    hint: "Черепашья графика — код на Python с модулем turtle",
  },
];

export type RunResult = {
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
};

export const DEFAULT_SNIPPETS: Record<CodeLanguage, string> = {
  python: `# Стандартная библиотека: math, random, itertools, collections и др.
print("Привет!")

import math
print("sqrt(16) =", math.sqrt(16))

# Файлы: open("input.txt") — вкладка «Файлы»
# input() — заполните «Входные данные» во вкладке «Вывод»
`,
  "python-turtle": `import turtle

print("Старт")

t = turtle.Turtle()
t.speed(3)
t.color("blue")
t.forward(120)
t.left(90)
t.forward(80)

print("Готово")
`,
};

export function codeStorageKey(taskId: number | string, lang: CodeLanguage) {
  return `inf-code:${taskId}:${lang}`;
}

/** Единый ключ хранения кода в боковом редакторе */
export const SIDEBAR_CODE_STORAGE_ID = "sidebar";

export type TaskFileSource = {
  id: number | string;
  label: string;
  fileUrl?: string | null;
};
