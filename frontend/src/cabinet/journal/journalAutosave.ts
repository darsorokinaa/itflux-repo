/** Чистая логика автосохранения журнала — тестируется без DOM. */

export type JournalSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export const JOURNAL_AUTOSAVE_DEBOUNCE_MS = 1200;

export function journalSaveStatusLabel(status: JournalSaveStatus): string {
  switch (status) {
    case "saving":
      return "Сохранение…";
    case "saved":
      return "Черновик сохранён";
    case "error":
      return "Ошибка сохранения";
    case "dirty":
      return "Есть несохранённые изменения";
    default:
      return "";
  }
}

export function createTabToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export type JournalDraftPayload = {
  version?: number;
  tab_token?: string;
  planned_topic?: string;
  actual_topic?: string;
  lesson_summary?: string;
  material_covered?: string;
  material_to_repeat?: string;
  next_lesson_plan?: string;
  recommendations?: string;
  actual_duration_minutes?: number | null;
  homework_id?: number | null;
  homework_skipped?: boolean;
  previous_homework_status?: string;
  student_records?: Array<Record<string, unknown>>;
};

export function hasUnsavedChanges(status: JournalSaveStatus): boolean {
  return status === "dirty" || status === "saving" || status === "error";
}

export function buildBeforeUnloadHandler(getStatus: () => JournalSaveStatus) {
  return (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges(getStatus())) return;
    event.preventDefault();
    event.returnValue = "";
  };
}

export function filledRecordsCount(
  records: Array<{ attendance_status?: string; fields_touched?: Record<string, unknown> }>,
): { filled: number; total: number } {
  const total = records.length;
  const filled = records.filter((r) => {
    if (r.attendance_status && r.attendance_status !== "not_marked") return true;
    return Boolean(r.fields_touched && Object.keys(r.fields_touched).length);
  }).length;
  return { filled, total };
}

export const ATTENDANCE_OPTIONS = [
  { value: "present", label: "Присутствовал" },
  { value: "late", label: "Опоздал" },
  { value: "left_early", label: "Ушёл раньше" },
  { value: "partial", label: "Часть урока" },
  { value: "absent_excused", label: "Отсутствовал (уваж.)" },
  { value: "absent_unexcused", label: "Отсутствовал" },
  { value: "cancelled_by_student", label: "Отменил ученик" },
  { value: "cancelled_by_teacher", label: "Отменил учитель" },
  { value: "technical_issue", label: "Техническая причина" },
  { value: "not_marked", label: "Не отмечено" },
] as const;

export function isAbsentStatus(status: string): boolean {
  return [
    "absent_excused",
    "absent_unexcused",
    "cancelled_by_student",
    "cancelled_by_teacher",
    "technical_issue",
  ].includes(status);
}
