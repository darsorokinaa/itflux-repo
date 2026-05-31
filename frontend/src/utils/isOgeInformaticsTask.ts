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
