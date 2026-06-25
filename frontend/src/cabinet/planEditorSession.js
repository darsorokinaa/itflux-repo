import { getInteractiveDisplayTitle } from "./interactivesData";
import { mapApiMaterial, mapApiPlanItem } from "./lessonPlansData";
import { mapApiInteractiveAttachment, materialOpenUrl } from "./planItemAttachments";

export const EMPTY_PLAN_SESSION = {
  id: null,
  title: "",
  topic: "",
  subtopic: "",
  examTask: "",
  goal: "",
  brief: "",
  comment: "",
  materialsNotes: "",
  lessonMaterials: [],
  lessonInteractives: [],
  taskMaterials: [],
  homeworkDescription: "",
  homeworkMaterials: [],
  homeworkInteractives: [],
};

export function mapPlanItemToEditorSession(item) {
  const materials = (item.materials || []).map(mapApiMaterial);
  return {
    id: item.id ?? null,
    title: item.title || "",
    topic: item.topic || "",
    subtopic: item.subtopic || "",
    examTask: item.task_number || "",
    goal: item.goal || "",
    brief: item.description || "",
    comment: item.teacher_comment || "",
    materialsNotes: item.lesson_materials_notes || "",
    lessonMaterials: materials.filter((m) => m.materialType !== "task_set"),
    lessonInteractives: (item.attached_interactives || item.attachedInteractives || [])
      .map(mapApiInteractiveAttachment),
    taskMaterials: materials.filter((m) => m.materialType === "task_set"),
    homeworkDescription: item.homework_description || "",
    homeworkMaterials: (item.homework_materials || item.homeworkMaterials || []).map(mapApiMaterial),
    homeworkInteractives: (item.homework_interactives || item.homeworkInteractives || [])
      .map(mapApiInteractiveAttachment),
  };
}

export function mapApiItemResponseToSession(data) {
  return mapPlanItemToEditorSession(mapApiPlanItem(data));
}

export function buildPlanItemApiPayload(session, order) {
  return {
    order,
    title: session.title,
    topic: session.topic,
    subtopic: session.subtopic,
    task_number: session.examTask,
    goal: session.goal,
    description: session.brief,
    lesson_materials_notes: session.materialsNotes,
    homework_description: session.homeworkDescription,
    teacher_comment: session.comment,
    material_ids: [
      ...session.lessonMaterials.map((m) => m.id),
      ...session.taskMaterials.map((m) => m.id),
    ].filter(Boolean),
    interactive_ids: session.lessonInteractives.map((i) => i.id).filter(Boolean),
    homework_material_ids: session.homeworkMaterials.map((m) => m.id).filter(Boolean),
    homework_interactive_ids: session.homeworkInteractives.map((i) => i.id).filter(Boolean),
  };
}

function attachmentRow({ key, kind, label, typeLabel, url, materialId, interactiveId }) {
  return { key, kind, label, typeLabel, url, materialId, interactiveId };
}

export function sessionLessonAttachmentRows(session) {
  const rows = [];
  (session.lessonMaterials || []).forEach((material) => {
    const kind = material.materialType === "file" || material.materialType === "presentation"
      ? "file"
      : material.materialType === "lesson"
        ? "library_lesson"
        : "material";
    rows.push(attachmentRow({
      key: `lm-${material.id}`,
      kind,
      label: material.title,
      typeLabel: material.materialTypeLabel || "Материал",
      url: materialOpenUrl(material),
      materialId: material.id,
    }));
  });
  (session.lessonInteractives || []).forEach((interactive) => {
    rows.push(attachmentRow({
      key: `li-${interactive.id}`,
      kind: "interactive",
      label: getInteractiveDisplayTitle(interactive),
      typeLabel: interactive.interactiveTypeLabel || "Интерактив",
      url: `/cabinet/interactives/${interactive.id}`,
      interactiveId: interactive.id,
    }));
  });
  return rows;
}

export function sessionTaskAttachmentRows(session) {
  return (session.taskMaterials || []).map((material) => attachmentRow({
    key: `task-${material.id}`,
    kind: "variant",
    label: material.title,
    typeLabel: material.materialTypeLabel || "Вариант",
    url: materialOpenUrl(material),
    materialId: material.id,
  }));
}

export function sessionHomeworkAttachmentRows(session) {
  const rows = [];
  (session.homeworkMaterials || []).forEach((material) => {
    const kind = material.materialType === "task_set"
      ? "variant"
      : material.materialType === "file" || material.materialType === "presentation"
        ? "file"
        : "material";
    rows.push(attachmentRow({
      key: `hwm-${material.id}`,
      kind,
      label: material.title,
      typeLabel: material.materialTypeLabel || "Материал",
      url: materialOpenUrl(material),
      materialId: material.id,
    }));
  });
  (session.homeworkInteractives || []).forEach((interactive) => {
    rows.push(attachmentRow({
      key: `hwi-${interactive.id}`,
      kind: "interactive",
      label: getInteractiveDisplayTitle(interactive),
      typeLabel: interactive.interactiveTypeLabel || "Интерактив",
      url: `/cabinet/interactives/${interactive.id}`,
      interactiveId: interactive.id,
    }));
  });
  return rows;
}

export function sessionResourceSummary(session) {
  const materials = sessionLessonAttachmentRows(session).length
    + (session.materialsNotes?.trim() ? 1 : 0);
  const tasks = sessionTaskAttachmentRows(session).length;
  const homework = sessionHomeworkAttachmentRows(session).length
    + (session.homeworkDescription?.trim() ? 1 : 0);
  return {
    materials,
    tasks,
    homework: homework > 0 ? "есть" : "нет",
  };
}

export function clonePlanSession(session) {
  return {
    ...session,
    id: null,
    lessonMaterials: [...(session.lessonMaterials || [])],
    lessonInteractives: [...(session.lessonInteractives || [])],
    taskMaterials: [...(session.taskMaterials || [])],
    homeworkMaterials: [...(session.homeworkMaterials || [])],
    homeworkInteractives: [...(session.homeworkInteractives || [])],
  };
}

export function planEditorStats(sessions) {
  return {
    sessions: sessions.length,
    materials: sessions.reduce((sum, s) => sum + sessionResourceSummary(s).materials, 0),
    tasks: sessions.reduce((sum, s) => sum + sessionResourceSummary(s).tasks, 0),
    homework: sessions.filter((s) => sessionResourceSummary(s).homework === "есть").length,
  };
}

/** Преобразует локальное состояние редактора в формат mapApiPlanItem для предпросмотра. */
export function editorSessionToPlanItem(session, order) {
  const lessonMaterials = [...(session.lessonMaterials || []), ...(session.taskMaterials || [])];
  return {
    id: session.id,
    order,
    title: session.title.trim() || `Занятие ${order}`,
    topic: session.topic || "",
    subtopic: session.subtopic || "",
    taskNumber: session.examTask || "",
    goal: session.goal || "",
    plannedResults: "",
    description: session.brief || "",
    materialsNotes: session.materialsNotes || "",
    homeworkDescription: session.homeworkDescription || "",
    teacherComment: session.comment || "",
    linkedLessonId: null,
    linkedLessonTitle: "",
    materials: lessonMaterials,
    attachedInteractives: [...(session.lessonInteractives || [])],
    homeworkMaterials: [...(session.homeworkMaterials || [])],
    homeworkInteractives: [...(session.homeworkInteractives || [])],
    scheduledEventId: null,
    scheduledEventTitle: "",
    scheduledEventStartsAt: null,
    status: "draft",
    statusLabel: "Черновик",
    scheduledDate: null,
    completedAt: null,
    createdAt: null,
  };
}
