const INSTRUCTION_TITLES = new Set(["домашнее задание", "описание"]);

function isHttpUrl(value) {
  return /^https?:\/\//i.test((value || "").trim());
}

export function isOpenableUrl(value) {
  const text = (value || "").trim();
  if (!text) return false;
  return isHttpUrl(text) || text.startsWith("/");
}

export function resolveTaskHref(task) {
  const urls = [task?.open_url, task?.file_url];
  if (task?.task_type !== "text") urls.push(task?.description);
  return urls.find(isOpenableUrl) || "";
}

function normKey(value) {
  return String(value || "").trim().toLowerCase();
}

function filenameKey(value) {
  const base = normKey(value).replace(/\/+$/, "").split("/").pop()?.split("?")[0] || "";
  if (!base.includes(".")) return "";
  return base;
}

function attachmentKeys(attachments) {
  const keys = new Set();
  for (const file of attachments || []) {
    for (const raw of [
      file.name,
      file.original_name,
      file.url,
      file.preview_url,
      file.file_id,
      file.material_id,
    ]) {
      const key = normKey(raw);
      if (key) keys.add(key);
      const filename = filenameKey(raw);
      if (filename) keys.add(filename);
    }
  }
  return keys;
}

export function isHomeworkInstructionTask(task, description) {
  if (!task || task.is_variant || task.task_type !== "text") return false;
  const desc = (task.description || "").trim();
  const title = (task.title || "").trim().toLowerCase();
  const hw = (description || "").trim();
  if (hw && desc === hw) return true;
  return INSTRUCTION_TITLES.has(title);
}

export function taskDuplicatesAttachment(task, attachments) {
  if (!task || task.is_variant) return false;
  if (task.task_type !== "file" && task.task_type !== "external_link") return false;
  const keys = attachmentKeys(attachments);
  if (!keys.size) return false;
  for (const raw of [
    task.title,
    task.open_url,
    task.file_url,
    task.description,
    task.material_id,
  ]) {
    const key = normKey(raw);
    if (key && keys.has(key)) return true;
    const filename = filenameKey(raw);
    if (filename && keys.has(filename)) return true;
  }
  return false;
}

export function visibleHomeworkResourceTasks(tasks, { description = "", attachments = [] } = {}) {
  return (tasks || []).filter((task) => {
    if (isHomeworkInstructionTask(task, description)) return false;
    if (taskDuplicatesAttachment(task, attachments)) return false;
    if (task.task_type === "text" && !task.is_variant && !resolveTaskHref(task)) {
      return false;
    }
    return true;
  });
}

export function extraHomeworkText(tasks, description) {
  const seen = new Set();
  const parts = [];
  const add = (text) => {
    const value = (text || "").trim();
    if (!value || seen.has(value) || isOpenableUrl(value)) return;
    seen.add(value);
    parts.push(value);
  };
  add(description);
  for (const task of tasks || []) {
    if (task.is_variant || task.task_type !== "text") continue;
    if (resolveTaskHref(task)) continue;
    add(task.description);
  }
  return parts.join("\n\n");
}
