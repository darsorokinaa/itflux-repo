const IMAGE_NAME_RE = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;

export function homeworkAttachmentKey(file) {
  if (file == null) return "";
  if (typeof file === "string" || typeof file === "number") return String(file).trim();
  return String(file.id || file.url || "").trim();
}

export function attachmentListKey(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => homeworkAttachmentKey(item))
    .filter(Boolean)
    .join("|");
}

export function isHomeworkAttachmentImage(file) {
  const type = String(file?.content_type || file?.contentType || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  const name = String(file?.filename || file?.name || file?.url || "");
  return IMAGE_NAME_RE.test(name);
}

export function normalizeHomeworkAttachment(item, extra = {}) {
  if (!item || typeof item !== "object") return null;
  const url = String(item.url || "").trim();
  if (!url) return null;
  const filename = String(item.filename || item.name || url.split("/").pop() || "Файл");
  const contentType = String(
    item.content_type || item.contentType || extra.contentType || extra.content_type || "",
  )
    .split(";")[0]
    .trim();
  const id = String(item.id || "").trim() || url;
  return {
    id,
    url,
    filename,
    name: filename,
    content_type: contentType,
    uploaded_at: item.uploaded_at || item.uploadedAt || "",
    isImage: isHomeworkAttachmentImage({
      filename,
      url,
      content_type: contentType,
    }),
  };
}

export function normalizeHomeworkAttachmentList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => normalizeHomeworkAttachment(item)).filter(Boolean);
}

export function appendHomeworkAttachments(list, uploaded) {
  const next = normalizeHomeworkAttachmentList(list);
  const seen = new Set(next.map((item) => homeworkAttachmentKey(item)).filter(Boolean));
  for (const raw of uploaded || []) {
    const item = normalizeHomeworkAttachment(raw);
    if (!item) continue;
    const key = homeworkAttachmentKey(item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    next.push(item);
  }
  return next;
}

export function removeHomeworkAttachment(list, target) {
  const key = homeworkAttachmentKey(target);
  if (!key) return normalizeHomeworkAttachmentList(list);
  return (Array.isArray(list) ? list : []).filter(
    (item) => homeworkAttachmentKey(item) !== key,
  );
}

function storageRow(item) {
  const normalized = normalizeHomeworkAttachment(item);
  if (!normalized) return null;
  const row = {
    id: normalized.id,
    url: normalized.url,
    filename: normalized.filename,
    name: normalized.filename,
    content_type: normalized.content_type || "",
  };
  if (normalized.uploaded_at) row.uploaded_at = normalized.uploaded_at;
  return row;
}

function writeAttachmentMap(mapping, key, rows) {
  const next = { ...(mapping && typeof mapping === "object" ? mapping : {}) };
  if (!key) return next;
  if (rows.length) next[key] = rows;
  else delete next[key];
  return next;
}

export function writeTaskAttachments(result, {
  taskId,
  taskNumber,
  attachments,
  teacher = false,
} = {}) {
  const payload = result && typeof result === "object" ? { ...result } : {};
  const idKey = teacher ? "teacher_attachments_by_task_id" : "attachments_by_task_id";
  const numKey = teacher ? "teacher_attachments_by_number" : "attachments_by_number";
  const rows = (attachments || []).map((item) => storageRow(item)).filter(Boolean);
  payload[idKey] = writeAttachmentMap(payload[idKey], String(taskId || ""), rows);
  payload[numKey] = writeAttachmentMap(payload[numKey], String(taskNumber || ""), rows);
  return payload;
}

export function writeTeacherCommentAttachments(result, attachments) {
  const payload = result && typeof result === "object" ? { ...result } : {};
  payload.teacher_comment_attachments = (attachments || [])
    .map((item) => storageRow(item))
    .filter(Boolean);
  return payload;
}

/**
 * Ignore stale parent snapshots after a local upload/delete.
 * Hydrate only when the incoming identity set actually changed from the
 * last applied props — not when the parent re-renders the same list.
 */
export function shouldHydrateAttachmentList({ incoming, lastHydratedKey }) {
  const nextKey = attachmentListKey(incoming);
  if (nextKey === lastHydratedKey) return { hydrate: false, key: nextKey };
  return { hydrate: true, key: nextKey };
}
