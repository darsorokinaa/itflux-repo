const DIRECTION_LABELS = {
  oge: "ОГЭ",
  ege: "ЕГЭ",
  python: "Python",
  school: "Школьная база",
  other: "Другое",
};

export const STUDENT_DIRECTION_OPTIONS = [
  { value: "oge", label: "ОГЭ" },
  { value: "ege", label: "ЕГЭ" },
  { value: "python", label: "Python" },
  { value: "school", label: "Школьная база" },
  { value: "other", label: "Другое" },
];

export const GROUP_EXAM_OPTIONS = [
  { value: "none", label: "Без экзамена" },
  { value: "oge", label: "ОГЭ" },
  { value: "ege", label: "ЕГЭ" },
];

export const STUDENT_STATUS_OPTIONS = [
  { value: "active", label: "Активен" },
  { value: "paused", label: "На паузе" },
];

export function mapApiStudent(apiStudent) {
  const direction = DIRECTION_LABELS[apiStudent.direction] || apiStudent.direction_label || apiStudent.direction;
  const groupIds = (apiStudent.group_ids || []).map(String);
  return {
    id: String(apiStudent.id),
    name: apiStudent.full_name,
    subject: apiStudent.direction === "python" ? "Python" : "Информатика",
    grade: apiStudent.grade,
    direction,
    groupId: groupIds[0] || null,
    groupIds,
    status: apiStudent.status === "paused" ? "warning" : apiStudent.status === "archived" ? "warning" : "active",
    needsAttention: false,
    raw: apiStudent,
  };
}

export function mapApiGroup(apiGroup) {
  return {
    id: String(apiGroup.id),
    name: apiGroup.title,
    subject: "Информатика",
    direction: DIRECTION_LABELS[apiGroup.direction] || apiGroup.direction_label || apiGroup.direction,
    progress: 0,
    lastActivity: "—",
    nextLesson: "—",
    raw: apiGroup,
  };
}

export function studentToApiPayload(form, { registered = false } = {}) {
  const payload = {
    direction: form.direction || "other",
    grade: form.grade ? Number(form.grade) : null,
    phone: (form.phone || "").trim(),
    parent_contact: (form.parent_contact || "").trim(),
    status: form.status || "active",
    notes: (form.notes || "").trim(),
  };
  if (!registered) {
    payload.first_name = (form.first_name || "").trim();
    payload.last_name = (form.last_name || "").trim();
    payload.email = (form.email || "").trim();
  }
  return payload;
}

export function groupToApiPayload(form) {
  return {
    title: (form.title || "").trim(),
    description: (form.description || "").trim(),
    direction: form.direction || "other",
    exam_type: form.exam_type || "none",
    status: form.status || "active",
  };
}

export function studentFormFromApi(apiStudent) {
  return {
    first_name: apiStudent.first_name || "",
    last_name: apiStudent.last_name || "",
    direction: apiStudent.direction || "other",
    grade: apiStudent.grade ?? "",
    email: apiStudent.email || "",
    phone: apiStudent.phone || "",
    parent_contact: apiStudent.parent_contact || "",
    status: apiStudent.status || "active",
    notes: apiStudent.notes || "",
  };
}

export function groupFormFromApi(apiGroup) {
  return {
    title: apiGroup.title || "",
    description: apiGroup.description || "",
    direction: apiGroup.direction || "other",
    exam_type: apiGroup.exam_type || "none",
    status: apiGroup.status || "active",
  };
}

export function emptyStudentForm() {
  return {
    first_name: "",
    last_name: "",
    direction: "oge",
    grade: "",
    email: "",
    phone: "",
    parent_contact: "",
    status: "active",
    notes: "",
  };
}

export function emptyGroupForm() {
  return {
    title: "",
    description: "",
    direction: "oge",
    exam_type: "oge",
    status: "active",
  };
}

export function emptyInviteForm(group = null) {
  return {
    first_name: "",
    last_name: "",
    email: "",
    direction: group?.raw?.direction || "oge",
    grade: "",
    message: "",
    group_id: group?.id ? Number(group.id) : null,
  };
}

export function inviteFormToApiPayload(form) {
  return {
    first_name: (form.first_name || "").trim(),
    last_name:  (form.last_name  || "").trim(),
    email: (form.email || "").trim(),
    direction: form.direction || "other",
    grade: form.grade ? Number(form.grade) : null,
    message: (form.message || "").trim(),
    group_id: form.group_id ? Number(form.group_id) : null,
  };
}
