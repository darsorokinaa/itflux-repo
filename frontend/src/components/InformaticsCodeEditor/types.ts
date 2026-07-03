export type CodeLanguage = "python" | "python-turtle";

export type CodeLanguageOption = {
  id: CodeLanguage;
  label: string;
  hint: string;
};

/** @deprecated Единый режим Python; turtle определяется автоматически */
export const CODE_LANGUAGES: CodeLanguageOption[] = [
  {
    id: "python",
    label: "Python 3",
    hint: "Python в браузере: math, random, файлы, turtle",
  },
];

export type RunStatus =
  | "idle"
  | "loading"
  | "running"
  | "done"
  | "error"
  | "stopped"
  | "timeout";

export type EducationalErrorInfo = {
  type: string;
  message: string;
  line?: number;
  hint?: string;
};

export type RunResult = {
  stdout: string;
  stderr: string;
  error?: string;
  educationalError?: EducationalErrorInfo;
  errorLine?: number;
  timedOut?: boolean;
  truncated?: boolean;
  usedTurtle?: boolean;
};

export type OutputTabId = "stdout" | "errors" | "turtle" | "stdin";

export const DEFAULT_SNIPPETS: Record<string, string> = {
  python: `print("Привет, мир!")

# import math
# print(math.sqrt(16))

# input() — вкладка «Входные данные»
# Файлы — панель слева (main.py — главный файл)
`,
  "python-turtle": `import turtle

t = turtle.Turtle()
for i in range(4):
    t.forward(100)
    t.right(90)

turtle.done()
`,
};

export function codeStorageKey(taskId: number | string, lang: CodeLanguage) {
  return `inf-code:${taskId}:${lang}`;
}

/** Ключ по умолчанию, если задание не выбрано */
export const SIDEBAR_CODE_STORAGE_ID = "sidebar";

export type TaskFileSource = {
  id: number | string;
  label: string;
  fileUrl?: string | null;
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  idle: "Готово",
  loading: "Загрузка среды…",
  running: "Выполняется…",
  done: "Готово",
  error: "Ошибка",
  stopped: "Остановлено",
  timeout: "Превышено время выполнения",
};
