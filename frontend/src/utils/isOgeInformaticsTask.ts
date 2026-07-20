/** ОГЭ русский язык, сочинение-рассуждение (№13). */
export function isOgeRusTask13(
  level: string | undefined,
  subject: string | undefined,
  taskNumber: number | string | null | undefined
): boolean {
  return (
    String(level || "").toLowerCase() === "oge" &&
    String(subject || "").toLowerCase() === "rus" &&
    Number(taskNumber) === 13
  );
}

/** ОГЭ информатика, задание с номером n (API иногда отдаёт строку). */
export function isOgeInformaticsTask(
  level: string | undefined,
  subject: string | undefined,
  taskNumber: number | string | null | undefined,
  n: number
): boolean {
  return (
    String(level || "").toLowerCase() === "oge" &&
    String(subject || "").toLowerCase() === "inf" &&
    Number(taskNumber) === n
  );
}

export function isOgeInformaticsContext(
  level: string | undefined,
  subject: string | undefined
): boolean {
  return (
    String(level || "").toLowerCase() === "oge" &&
    String(subject || "").toLowerCase() === "inf"
  );
}

/** Задания второй части ОГЭ информатики (13–16), если part_id в API не задан. */
export function isOgeInformaticsPart2TaskNumber(
  level: string | undefined,
  subject: string | undefined,
  taskNumber: number | string | null | undefined
): boolean {
  return isOgeInformaticsContext(level, subject) && Number(taskNumber) >= 13;
}

/** ЕГЭ информатика (любой номер задания). */
export function isEgeInformaticsContext(
  level: string | undefined,
  subject: string | undefined
): boolean {
  return (
    String(level || "").toLowerCase() === "ege" &&
    String(subject || "").toLowerCase() === "inf"
  );
}

/** ЕГЭ информатика, задание с номером n (API иногда отдаёт строку). */
export function isEgeInformaticsTask(
  level: string | undefined,
  subject: string | undefined,
  taskNumber: number | string | null | undefined,
  n: number
): boolean {
  return (
    String(level || "").toLowerCase() === "ege" &&
    String(subject || "").toLowerCase() === "inf" &&
    Number(taskNumber) === n
  );
}

/** ЕГЭ информатика №1 — схема дорог и таблица смежности / расстояний. */
export function isEgeInfRoadGraphTask(
  level: string | undefined,
  subject: string | undefined,
  taskNumber: number | string | null | undefined
): boolean {
  return isEgeInformaticsTask(level, subject, taskNumber, 1);
}

/** ЕГЭ информатика №2 — таблица истинности. */
export function isEgeInfTruthTableTask(
  level: string | undefined,
  subject: string | undefined,
  taskNumber: number | string | null | undefined
): boolean {
  return isEgeInformaticsTask(level, subject, taskNumber, 2);
}

/** ЕГЭ информатика №22 — параллельные и последовательные процессы. */
export function isEgeInfParallelProcessesTask(
  level: string | undefined,
  subject: string | undefined,
  taskNumber: number | string | null | undefined
): boolean {
  return isEgeInformaticsTask(level, subject, taskNumber, 22);
}

/** ОГЭ или ЕГЭ информатика — показываем редактор кода. */
export function isInformaticsCodeEditorContext(
  level: string | undefined,
  subject: string | undefined
): boolean {
  return (
    isOgeInformaticsContext(level, subject) ||
    isEgeInformaticsContext(level, subject)
  );
}
