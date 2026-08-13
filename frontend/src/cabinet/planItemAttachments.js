import { getInteractiveDisplayTitle } from "./interactivesData";
import { getLessonOpenUrl } from "./lessonCardUtils";
import { mapApiMaterial, mapApiPlanItem } from "./lessonPlansData";
import { materialTypeLabel } from "./materialTypeConfig";

export function mapApiInteractiveAttachment(interactive) {
  return {
    id: interactive.id,
    title: getInteractiveDisplayTitle(interactive),
    interactiveType: interactive.interactive_type || interactive.interactiveType,
    interactiveTypeLabel:
      interactive.interactive_type_label
      || interactive.interactiveTypeLabel
      || "Интерактив",
    topic: interactive.topic || "",
    subtopic: interactive.subtopic || "",
  };
}

export function materialOpenUrl(material) {
  // Preview API — для iframe; download/media из my-files в браузере не открываются.
  return (
    material.previewUrl
    || material.preview_url
    || material.externalUrl
    || material.external_url
    || material.fileUrl
    || material.file_url
    || ""
  );
}

export function lessonResourceRows(item) {
  const rows = [];
  const materialTitles = new Set();
  (item?.materials || []).forEach((material) => {
    const kind = material.materialType === "task_set"
      ? "variant"
      : material.materialType === "file" || material.materialType === "presentation"
        ? "file"
        : material.materialType === "lesson"
          ? "library_lesson"
          : "material";
    const title = (material.title || "").trim();
    if (title) materialTitles.add(title.toLowerCase());
    rows.push({
      key: `lesson-material-${material.id}`,
      kind,
      label: material.title,
      typeLabel: materialTypeLabel(material.materialType, material.materialTypeLabel),
      url: materialOpenUrl(material),
      materialId: material.id,
      cabinetFileId: material.cabinetFileId || material.cabinet_file_id || null,
    });
  });
  const linkedTitle = (item?.linkedLessonTitle || "").trim();
  // Не дублируем linked_lesson, если тот же урок уже прикреплён как материал.
  if (linkedTitle && !materialTitles.has(linkedTitle.toLowerCase())) {
    rows.push({
      key: `linked-lesson-${item.linkedLessonId || item.linkedLessonTitle}`,
      kind: "linked_lesson",
      label: item.linkedLessonTitle,
      typeLabel: "Урок из библиотеки",
      url: "",
    });
  }
  (item?.attachedInteractives || []).forEach((interactive) => {
    rows.push({
      key: `lesson-interactive-${interactive.id}`,
      kind: "interactive",
      label: getInteractiveDisplayTitle(interactive),
      typeLabel: interactive.interactiveTypeLabel || "Интерактив",
      url: `/cabinet/interactives/${interactive.id}`,
      interactiveId: interactive.id,
      interactiveType: interactive.interactiveType || interactive.interactive_type || "",
    });
  });
  return rows;
}

export function homeworkResourceRows(item) {
  const rows = [];
  (item?.homeworkMaterials || []).forEach((material) => {
    const kind = material.materialType === "task_set"
      ? "variant"
      : material.materialType === "file" || material.materialType === "presentation"
        ? "file"
        : material.materialType || "material";
    rows.push({
      key: `hw-material-${material.id}`,
      kind,
      label: material.title,
      typeLabel: materialTypeLabel(material.materialType, material.materialTypeLabel),
      url: materialOpenUrl(material),
      materialId: material.id,
      cabinetFileId: material.cabinetFileId || material.cabinet_file_id || null,
    });
  });
  (item?.homeworkInteractives || []).forEach((interactive) => {
    rows.push({
      key: `hw-interactive-${interactive.id}`,
      kind: "interactive",
      label: getInteractiveDisplayTitle(interactive),
      typeLabel: interactive.interactiveTypeLabel || "Интерактив",
      url: `/cabinet/interactives/${interactive.id}`,
      interactiveId: interactive.id,
      interactiveType: interactive.interactiveType || interactive.interactive_type || "",
    });
  });
  return rows;
}

export function buildLibraryLessonMaterialPayload(lesson) {
  const url = getLessonOpenUrl(lesson) || "";
  if (!url) return null;
  const absoluteUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
  return {
    title: lesson.title,
    material_type: "lesson",
    external_url: absoluteUrl,
    topic: lesson.topic || lesson.subject || "",
    subtopic: lesson.subtopic || "",
  };
}

export function buildVariantMaterialPayload({ title, url, direction }) {
  return {
    title: title.trim(),
    material_type: "task_set",
    external_url: url.trim(),
  };
}

export function buildLinkMaterialPayload({ title, url }) {
  return {
    title: title.trim(),
    material_type: "link",
    external_url: url.trim(),
  };
}

export function mapPlanItemAttachmentsFromApi(item) {
  if (!item) return item;
  return {
    ...item,
    materials: (item.materials || []).map(mapApiMaterial),
    attachedInteractives: (item.attached_interactives || item.attachedInteractives || [])
      .map(mapApiInteractiveAttachment),
    homeworkMaterials: (item.homework_materials || item.homeworkMaterials || [])
      .map(mapApiMaterial),
    homeworkInteractives: (item.homework_interactives || item.homeworkInteractives || [])
      .map(mapApiInteractiveAttachment),
  };
}

export function planItemForScheduleEvent(apiData, existing = {}) {
  const mapped = mapApiPlanItem(apiData);
  return {
    id: mapped.id,
    order: mapped.order,
    lessonNumber: existing.lessonNumber ?? mapped.order,
    title: mapped.title,
    topic: mapped.topic,
    subtopic: mapped.subtopic,
    taskNumber: mapped.taskNumber,
    goal: mapped.goal,
    description: mapped.description,
    teacherComment: mapped.teacherComment,
    linkedLessonId: mapped.linkedLessonId,
    linkedLessonTitle: mapped.linkedLessonTitle,
    planTitle: existing.planTitle || mapped.raw?.plan_title || "",
    lessonMaterialsNotes: mapped.materialsNotes,
    materials: mapped.materials,
    attachedInteractives: mapped.attachedInteractives,
    homeworkMaterials: mapped.homeworkMaterials,
    homeworkInteractives: mapped.homeworkInteractives,
    homeworkDescription: mapped.homeworkDescription,
  };
}

function toPopoverRow(row, extra = {}, submitted = false) {
  return {
    key: row.key,
    kind: row.kind,
    label: row.label,
    text: extra.text || "",
    url: row.url || "",
    typeLabel: row.typeLabel || "",
    submitted,
    materialId: row.materialId || null,
    cabinetFileId: row.cabinetFileId || null,
    interactiveId: row.interactiveId || null,
    interactiveType: row.interactiveType || "",
    boardId: row.boardId || null,
  };
}

export function planItemLessonPopoverRows(item) {
  if (!item) return [];
  const lessonMaterials = (item.materials || []).filter((material) => material.materialType !== "task_set");
  const rows = lessonResourceRows({ ...item, materials: lessonMaterials });
  const notes = item.lessonMaterialsNotes || item.materialsNotes || "";
  const result = rows.map((row) => toPopoverRow(row));
  if (notes.trim()) {
    result.push({
      key: `notes-${item.id}`,
      kind: "notes",
      label: "Заметки",
      text: notes.trim(),
    });
  }
  return result;
}

export function planItemTaskPopoverRows(item) {
  if (!item) return [];
  // Не передаём linkedLessonTitle: иначе «Урок из библиотеки» дублируется
  // вместе с planItemLessonPopoverRows.
  const taskMaterials = (item.materials || []).filter((material) => material.materialType === "task_set");
  return lessonResourceRows({
    ...item,
    materials: taskMaterials,
    attachedInteractives: [],
    linkedLessonTitle: "",
    linkedLessonId: null,
  }).map((row) => toPopoverRow(row));
}

export function scheduleEventPlanItemToModalItem(item, event) {
  if (!item) return null;
  const eventStatus = event?.status;
  const status = eventStatus === "done" || eventStatus === "completed" ? "completed" : "planned";
  return {
    id: item.id,
    order: item.order,
    title: item.title,
    topic: item.topic || "",
    subtopic: item.subtopic || "",
    taskNumber: item.taskNumber || "",
    goal: item.goal || "",
    plannedResults: item.plannedResults || "",
    description: item.description || "",
    materialsNotes: item.lessonMaterialsNotes || item.materialsNotes || "",
    homeworkDescription: item.homeworkDescription || "",
    teacherComment: item.teacherComment || "",
    linkedLessonId: item.linkedLessonId || null,
    linkedLessonTitle: item.linkedLessonTitle || "",
    materials: item.materials || [],
    attachedInteractives: item.attachedInteractives || [],
    homeworkMaterials: item.homeworkMaterials || [],
    homeworkInteractives: item.homeworkInteractives || [],
    scheduledEventStartsAt: event?.startsAt || null,
    scheduledEventTitle: event?.title || event?.audience || "",
    status,
  };
}

const SUBMITTED_STATUSES = new Set(["submitted", "reviewing", "checked", "completed"]);

export function planItemHomeworkPopoverRows(item, hwStatus = null) {
  if (!item) return [];
  const isSubmitted = hwStatus ? SUBMITTED_STATUSES.has(hwStatus) : false;
  const rows = homeworkResourceRows(item).map((row) => toPopoverRow(row, {}, isSubmitted));
  const description = item.homeworkDescription || "";
  if (description.trim()) {
    rows.unshift({
      key: `hw-desc-${item.id}`,
      kind: "notes",
      label: "Описание",
      text: description.trim(),
    });
  }
  return rows;
}

/** Строки блока «Домашнее задание» в карточке урока — только выданное ДЗ. */
export function eventAssignedHomeworkRows(event) {
  const assigned = event?.assignedHomework || event?.assigned_homework;
  if (!assigned?.id) return [];
  const rows = planItemHomeworkPopoverRows({
    id: assigned.planItemId || assigned.id,
    homeworkDescription: assigned.homeworkDescription || assigned.description || "",
    homeworkMaterials: assigned.homeworkMaterials || assigned.homework_materials || [],
    homeworkInteractives: assigned.homeworkInteractives || assigned.homework_interactives || [],
  });
  if (rows.length) return rows;
  return [{
    key: `assigned-hw-${assigned.id}`,
    kind: "notes",
    label: assigned.title || "Домашнее задание",
    text: assigned.description?.trim() || assigned.statusLabel || "Выдано",
    typeLabel: assigned.statusLabel || "Выдано",
  }];
}
