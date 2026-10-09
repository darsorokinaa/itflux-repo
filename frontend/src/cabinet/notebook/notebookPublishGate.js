const flushes = new Set();
let uploadsPending = 0;
let uploadError = null;
const uploadWaiters = [];

export const NOTEBOOK_SAVE_FAILED = "Не удалось сохранить тетрадь. Попробуйте ещё раз.";
export const NOTEBOOK_SAVE_UNCONFIRMED = "Сервер не подтвердил сохранение тетради.";
export const NOTEBOOK_VERSION_CONFLICT = "Тетрадь изменена в другой вкладке. Более новая версия на сервере сохранена. Пометки из этой вкладки не записаны: сохраните их отдельно или обновите тетрадь и повторите действие.";
export const UNSAVED_CLOSE_WARNING = "Последние несохранённые пометки не попадут в проверку. Закрыть тетрадь без сохранения?";

export function registerNotebookFlush(fn) {
  flushes.add(fn);
  return () => flushes.delete(fn);
}

export async function flushOpenNotebooks() {
  const tasks = [...flushes].map((fn) => fn());
  await Promise.all(tasks);
}

export function trackFeedbackUpload(promise) {
  uploadsPending += 1;
  const finish = (error) => {
    if (error && !uploadError) uploadError = error;
    uploadsPending -= 1;
    if (uploadsPending > 0) return;
    const err = uploadError;
    uploadError = null;
    const waiters = uploadWaiters.splice(0);
    waiters.forEach((waiter) => (err ? waiter.reject(err) : waiter.resolve()));
  };
  return Promise.resolve(promise).then(
    (value) => {
      finish(null);
      return value;
    },
    (error) => {
      finish(error);
      throw error;
    },
  );
}

export function waitForFeedbackUploads() {
  if (uploadsPending === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    uploadWaiters.push({ resolve, reject });
  });
}

export async function flushNotebookForPublish({ commitLive, save }) {
  commitLive?.();
  return save();
}

export async function publishAfterReady({ publish }) {
  await waitForFeedbackUploads();
  await flushOpenNotebooks();
  return publish();
}

export function confirmedNotebookVersion(saved) {
  const version = Number(saved?.version);
  return Number.isFinite(version) ? version : null;
}

export async function saveNotebookLatest({
  readLatest,
  save,
  hasPending,
  clearPending,
  onConflict,
  maxAttempts = 6,
} = {}) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    clearPending?.();
    const payload = readLatest?.();
    if (!payload?.id) {
      throw Object.assign(new Error(NOTEBOOK_SAVE_FAILED), { code: "notebook_save_failed" });
    }
    let saved;
    try {
      saved = await save(payload);
    } catch (err) {
      if (err?.code === "version_conflict") {
        onConflict?.(err, payload);
        throw Object.assign(new Error(NOTEBOOK_VERSION_CONFLICT), {
          code: "version_conflict",
          data: err.data,
        });
      }
      throw err;
    }
    const version = confirmedNotebookVersion(saved);
    if (version == null) {
      throw Object.assign(new Error(NOTEBOOK_SAVE_UNCONFIRMED), { code: "notebook_save_unconfirmed" });
    }
    if (hasPending?.()) continue;
    return { ...saved, version };
  }
  throw Object.assign(new Error(NOTEBOOK_SAVE_FAILED), { code: "notebook_save_failed" });
}

/** Локальная копия пометок для скачивания. На сервер не пишется. */
export function localNotebookFile(doc) {
  const body = JSON.stringify({
    notebook_id: doc?.id || "",
    pages: doc?.pages || [],
  });
  return { filename: "pomety-lokalno.json", body };
}

export function resetNotebookPublishGateForTests() {
  flushes.clear();
  uploadsPending = 0;
  uploadError = null;
  uploadWaiters.splice(0);
}
