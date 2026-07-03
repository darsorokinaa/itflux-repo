/** Учебное представление ошибок Python (Pyodide / Skulpt / статический анализ). */

export type EducationalError = {
  type: string;
  message: string;
  line?: number;
  hint?: string;
  raw?: string;
};

const ERROR_HINTS: Record<string, string> = {
  NameError:
    "Проверьте, что переменная объявлена и имя написано без опечаток.",
  SyntaxError:
    "Проверьте двоеточия, скобки, кавычки и отступы — в Python отступы важны.",
  IndentationError:
    "Строки внутри if, for, while и def должны иметь одинаковый отступ (обычно 4 пробела).",
  TypeError:
    "Возможно, вы передали значение не того типа — число вместо строки или наоборот.",
  ValueError:
    "Функция получила аргумент правильного типа, но с недопустимым значением.",
  IndexError:
    "Индекс выходит за границы списка — проверьте длину списка.",
  KeyError: "В словаре нет такого ключа — проверьте написание ключа.",
  ZeroDivisionError: "Деление на ноль невозможно — проверьте знаменатель.",
  EOFError:
    "Программа запросила ввод, но входные данные закончились. Добавьте строки во вкладку «Входные данные».",
  ImportError:
    "Модуль не найден или недоступен. Проверьте имя модуля и имя файла при import.",
  ModuleNotFoundError:
    "Модуль не найден. Проверьте имя файла (например, utils.py → from utils import …).",
  AttributeError:
    "У объекта нет такого метода или свойства — проверьте имя и тип объекта.",
  FileNotFoundError:
    "Файл не найден. Создайте его во вкладке «Файлы» или проверьте имя в open().",
};

function extractLine(text: string): number | undefined {
  const patterns = [
    /line\s+(\d+)/i,
    /строка\s+(\d+)/i,
    /File\s+"[^"]*",\s*line\s+(\d+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

function extractType(text: string): string {
  const m = text.match(/^(\w+Error|\w+Exception|SyntaxError):\s*/);
  if (m?.[1]) return m[1];
  if (/SyntaxError/i.test(text)) return "SyntaxError";
  if (/IndentationError/i.test(text)) return "IndentationError";
  return "Ошибка";
}

function extractMessage(text: string, type: string): string {
  const stripped = text
    .replace(/^PythonError:\s*/i, "")
    .replace(new RegExp(`^${type}:\\s*`, "i"), "")
    .split("\n")[0]
    .trim();
  return stripped || text.split("\n")[0].trim();
}

export function formatEducationalError(raw: string): EducationalError {
  const type = extractType(raw);
  const message = extractMessage(raw, type);
  const line = extractLine(raw);
  const hint = ERROR_HINTS[type];

  return { type, message, line, hint, raw };
}

export function formatErrorBlock(err: EducationalError): string {
  const lines = [`${err.type}: ${err.message}`];
  if (err.line != null) lines.push(`Строка ${err.line}`);
  if (err.hint) lines.push(err.hint);
  return lines.join("\n");
}
