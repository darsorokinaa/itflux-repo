/** Вынос dataURL/blob из сцены в защищённые asset URL через API. */

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Стабильный URL для persist/live — не blob/data. */
const STABLE_URL_KEY = "itfluxStableURL";

/** Прозрачный 1×1 PNG — fallback, если asset недоступен. */
const MISSING_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const MAX_HYDRATE_RETRIES = 2;
const HYDRATE_CONCURRENCY = 4;

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) return null;
  const [header, b64] = dataUrl.split(",", 2);
  const mime = header.slice(5).split(";", 1)[0] || "application/octet-stream";
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
}

async function parseBlobUrl(blobUrl: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  try {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    const mime = (blob.type || "application/octet-stream").split(";", 1)[0];
    const buf = await blob.arrayBuffer();
    return { mime, bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}

export type SceneFiles = Record<string, Record<string, unknown>>;

export function isTransientFileUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

export function isStableFileUrl(url: string): boolean {
  return Boolean(url) && !isTransientFileUrl(url);
}

export function fileNeedsRemoteHydrate(
  fileId: string,
  meta: Record<string, unknown> | null | undefined,
  localFiles?: SceneFiles | null,
): boolean {
  if (!meta || typeof meta !== "object") return false;
  const url = String(meta.dataURL || meta.url || "");
  if (!url || isTransientFileUrl(url)) return false;
  const local = localFiles?.[fileId];
  if (local && typeof local === "object") {
    const localUrl = String(local.dataURL || local.url || "");
    if (localUrl && isTransientFileUrl(localUrl)) return false;
  }
  return true;
}

/** Подмножество файлов, которым ещё нужен GET asset. */
export function collectFilesNeedingRemoteHydrate(
  files: SceneFiles | null | undefined,
  localFiles?: SceneFiles | null,
): SceneFiles {
  const out: SceneFiles = {};
  if (!files || typeof files !== "object") return out;
  for (const [fileId, meta] of Object.entries(files)) {
    if (fileNeedsRemoteHydrate(fileId, meta, localFiles)) out[fileId] = meta;
  }
  return out;
}

/**
 * Нужна ли сетевая гидратация перед показом сцены пиру.
 * Если локально уже есть blob:/data: для fileId — не блокируем штрихи ожиданием fetch.
 */
export function filesNeedRemoteHydrate(
  files: SceneFiles | null | undefined,
  localFiles?: SceneFiles | null,
): boolean {
  return Object.keys(collectFilesNeedingRemoteHydrate(files, localFiles)).length > 0;
}

/** Оценка «стабильности» файла: постоянный URL лучше data/blob. */
export function fileUrlStability(meta: Record<string, unknown> | null | undefined): number {
  const url = String(meta?.dataURL || meta?.url || "");
  if (!url) return 0;
  if (url.startsWith("/api/") || url.startsWith("http://") || url.startsWith("https://")) return 3;
  if (url.startsWith("data:")) return 2;
  if (url.startsWith("blob:")) return 1;
  return 0;
}

export function preferStableFile(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const left = a && typeof a === "object" ? a : {};
  const right = b && typeof b === "object" ? b : {};
  return fileUrlStability(left) >= fileUrlStability(right) ? { ...right, ...left } : { ...left, ...right };
}

export function stableUrlOf(meta: Record<string, unknown>): string {
  const tagged = String(meta[STABLE_URL_KEY] || "");
  if (isStableFileUrl(tagged)) return tagged;
  const url = String(meta.dataURL || meta.url || "");
  return isStableFileUrl(url) ? url : "";
}

/**
 * Для отображения на canvas: если один файл — гидратированный blob того же
 * asset, что и стабильный URL другого, оставляем blob (иначе remount-баг).
 * Для persist/live по-прежнему используйте preferStableFile / filesForPersist.
 */
export function preferDisplayFile(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const left = a && typeof a === "object" ? a : {};
  const right = b && typeof b === "object" ? b : {};
  const leftUrl = String(left.dataURL || left.url || "");
  const rightUrl = String(right.dataURL || right.url || "");
  const leftStable = stableUrlOf(left);
  const rightStable = stableUrlOf(right);

  if (leftStable && rightStable && leftStable === rightStable) {
    if (isTransientFileUrl(leftUrl) && !isTransientFileUrl(rightUrl)) {
      return { ...right, ...left, [STABLE_URL_KEY]: leftStable };
    }
    if (isTransientFileUrl(rightUrl) && !isTransientFileUrl(leftUrl)) {
      return { ...left, ...right, [STABLE_URL_KEY]: rightStable };
    }
  }
  if (leftStable && isTransientFileUrl(leftUrl) && isStableFileUrl(rightUrl) && rightUrl === leftStable) {
    return { ...right, ...left, [STABLE_URL_KEY]: leftStable };
  }
  if (rightStable && isTransientFileUrl(rightUrl) && isStableFileUrl(leftUrl) && leftUrl === rightStable) {
    return { ...left, ...right, [STABLE_URL_KEY]: rightStable };
  }
  return preferStableFile(left, right);
}

/**
 * Все PNG/JPEG/WebP dataURL и blob: → upload → защищённый API path.
 * Уже загруженные URL оставляем как есть.
 */
export async function externalizeSceneFiles(
  files: SceneFiles | null | undefined,
  upload: (formData: FormData) => Promise<{ id?: string; dataURL?: string; url?: string; mimeType?: string }>,
): Promise<SceneFiles> {
  if (!files || typeof files !== "object") return {};
  const next: SceneFiles = { ...files };

  for (const [fileId, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") continue;
    const dataUrl = String(meta.dataURL || meta.url || "");
    if (!isTransientFileUrl(dataUrl)) continue;

    let parsed: { mime: string; bytes: Uint8Array } | null = null;
    if (dataUrl.startsWith("data:")) {
      parsed = parseDataUrl(dataUrl);
    } else if (dataUrl.startsWith("blob:")) {
      parsed = await parseBlobUrl(dataUrl);
    }
    if (!parsed) continue;
    if (!ALLOWED_MIME.has(parsed.mime)) {
      throw new Error("Допустимы только PNG, JPEG и WebP. SVG не поддерживается.");
    }

    const form = new FormData();
    const blob = new Blob([parsed.bytes.buffer as ArrayBuffer], { type: parsed.mime });
    const ext = parsed.mime === "image/jpeg" ? "jpg" : parsed.mime.split("/")[1];
    form.append("file", blob, `${fileId}.${ext}`);
    form.append("id", fileId);

    const uploaded = await upload(form);
    const path = uploaded.dataURL || uploaded.url;
    if (!path) continue;
    // STABLE_URL_KEY обязателен: Excalidraw BinaryFileData не хранит кастомные
    // поля — после addFiles/onChange dataURL станет blob:, и без этого ключа
    // (или внешнего registry) файл снова попадёт в очередь аплоада.
    next[fileId] = {
      ...meta,
      id: uploaded.id || fileId,
      mimeType: uploaded.mimeType || parsed.mime,
      dataURL: path,
      url: path,
      [STABLE_URL_KEY]: path,
    };
  }

  return next;
}

/** fileId → постоянный API URL. Живёт вне Excalidraw (тот стрипает кастомные поля). */
export type StableUrlMap = Map<string, string>;

export function createStableUrlMap(): StableUrlMap {
  return new Map();
}

/** Запомнить стабильные URL из метаданных файлов (hydrate / upload / snapshot). */
export function rememberStableUrls(
  map: StableUrlMap,
  files: SceneFiles | null | undefined,
): void {
  if (!files || typeof files !== "object") return;
  for (const [fileId, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") continue;
    const stable = stableUrlOf(meta);
    if (stable) map.set(fileId, stable);
  }
}

/**
 * Вернуть в files ключ itfluxStableURL из внешнего registry.
 * Excalidraw onChange отдаёт только BinaryFileData (blob dataURL без наших полей).
 */
export function attachStableUrls(
  files: SceneFiles | null | undefined,
  map: StableUrlMap,
): SceneFiles {
  if (!files || typeof files !== "object") return {};
  const out: SceneFiles = {};
  for (const [fileId, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") {
      out[fileId] = meta as Record<string, unknown>;
      continue;
    }
    const remembered = map.get(fileId) || "";
    const existing = stableUrlOf(meta);
    const stable = existing || (isStableFileUrl(remembered) ? remembered : "");
    if (stable) {
      out[fileId] = { ...meta, [STABLE_URL_KEY]: stable };
      if (!map.has(fileId)) map.set(fileId, stable);
    } else {
      out[fileId] = { ...meta };
    }
  }
  // Файлы, которые есть только в registry (элемент ещё не в getFiles) — не добавляем
  // сюда: publish/ops берут files из сцены. Registry нужен для attach к существующим.
  return out;
}

/** fileId, которым ещё нужна HTTP-загрузка (нет стабильного URL и не грузятся сейчас). */
export function pendingUploadFileIds(
  files: SceneFiles | null | undefined,
  map: StableUrlMap,
  uploadingIds?: Set<string> | null,
): string[] {
  if (!files || typeof files !== "object") return [];
  const out: string[] = [];
  for (const [fileId, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") continue;
    if (uploadingIds?.has(fileId)) continue;
    if (map.has(fileId) && isStableFileUrl(map.get(fileId) || "")) continue;
    if (stableUrlOf(meta)) {
      const s = stableUrlOf(meta);
      map.set(fileId, s);
      continue;
    }
    const url = String(meta.dataURL || meta.url || "");
    // Уже стабильный API URL в dataURL (ещё не помечен в map).
    if (isStableFileUrl(url)) {
      map.set(fileId, url);
      continue;
    }
    if (!url || !isTransientFileUrl(url)) continue;
    out.push(fileId);
  }
  return out;
}

/**
 * После успешного аплоада image.status должен стать "saved"
 * (ExcalidrawImageElement: pending | saved | error) — иначе спиннер на холсте.
 */
export function markImageElementsSaved(
  elements: unknown[] | null | undefined,
  fileIds: Iterable<string>,
): unknown[] {
  const ids = fileIds instanceof Set ? fileIds : new Set(fileIds);
  if (!ids.size) return Array.isArray(elements) ? [...elements] : [];
  const now = Date.now();
  return (elements || []).map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const el = raw as {
      type?: string;
      fileId?: string;
      status?: string;
      version?: number;
      isDeleted?: boolean;
    };
    if (el.isDeleted || el.type !== "image" || !el.fileId || !ids.has(el.fileId)) return raw;
    if (el.status === "saved") return raw;
    return {
      ...el,
      status: "saved",
      version: (Number(el.version) || 0) + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      updated: now,
    };
  });
}

/** Для live-sync: убираем blob:/data: — пирам нужен только постоянный URL. */
export function filesForLivePublish(files: SceneFiles | null | undefined): SceneFiles {
  if (!files || typeof files !== "object") return {};
  const out: SceneFiles = {};
  for (const [id, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") continue;
    const stable = String(meta[STABLE_URL_KEY] || "");
    const url = String(meta.dataURL || meta.url || "");
    const publishUrl = isStableFileUrl(stable) ? stable : (isStableFileUrl(url) ? url : "");
    if (!publishUrl) continue;
    out[id] = {
      ...meta,
      dataURL: publishUrl,
      url: publishUrl,
    };
    delete out[id][STABLE_URL_KEY];
  }
  return out;
}

/**
 * Для REST-сохранения: предпочитаем стабильный API URL, не локальный blob.
 * Иначе каждый autosave перезаливал бы уже загруженные картинки.
 */
export function filesForPersist(files: SceneFiles | null | undefined): SceneFiles {
  if (!files || typeof files !== "object") return {};
  const out: SceneFiles = {};
  for (const [id, meta] of Object.entries(files)) {
    if (!meta || typeof meta !== "object") continue;
    const stable = String(meta[STABLE_URL_KEY] || "");
    const url = String(meta.dataURL || meta.url || "");
    const persistUrl = isStableFileUrl(stable) ? stable : url;
    const next = { ...meta, dataURL: persistUrl, url: persistUrl };
    delete next[STABLE_URL_KEY];
    // Не сохраняем missing-placeholder как «настоящий» файл.
    if (next.dataURL === MISSING_IMAGE_DATA_URL && !isStableFileUrl(stable)) {
      continue;
    }
    out[id] = next;
  }
  return out;
}

/**
 * В REST PATCH нельзя класть data:/blob: — из‑за них сцена «иногда»
 * превышает лимит, хотя картинки уже есть в assets.
 */
export function filesForRestPayload(files: SceneFiles | null | undefined): SceneFiles {
  const persisted = filesForPersist(files);
  const out: SceneFiles = {};
  for (const [id, meta] of Object.entries(persisted)) {
    if (!meta || typeof meta !== "object") continue;
    const url = String(meta.dataURL || meta.url || "");
    if (!isStableFileUrl(url)) continue;
    out[id] = {
      ...meta,
      dataURL: url,
      url,
    };
  }
  return out;
}

export type HydrateBoardFilesResult = {
  files: SceneFiles;
  /** Blob URL, созданные при hydrate — отозвать при размонтировании. */
  blobUrls: string[];
  missingFileIds: string[];
  failedFileIds: string[];
};

async function decodeImageBlob(blob: Blob): Promise<void> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await Promise.race([
        createImageBitmap(blob),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("image_decode_timeout")), 2500);
        }),
      ]);
      bmp.close?.();
      return;
    } catch {
      /* fall through */
    }
  }
  if (typeof Image === "undefined") return;
  const objectUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      const timer = window.setTimeout(() => reject(new Error("image_decode_timeout")), 2500);
      img.onload = () => {
        window.clearTimeout(timer);
        if (typeof img.decode === "function") {
          img.decode().then(() => resolve()).catch(() => resolve());
        } else {
          resolve();
        }
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("image_decode_failed"));
      };
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchAssetAsBlob(url: string, attempt = 0): Promise<Blob> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "image/*,*/*" },
  });
  if (!res.ok) {
    if (attempt < MAX_HYDRATE_RETRIES && (res.status >= 500 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      return fetchAssetAsBlob(url, attempt + 1);
    }
    throw new Error(`asset_http_${res.status}`);
  }
  const blob = await res.blob();
  if (!blob || blob.size === 0) throw new Error("asset_empty");
  return blob;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await worker(items[idx]);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export type HydrateFileOutcome = {
  fileId: string;
  meta: Record<string, unknown>;
  blobUrl?: string;
  missing?: boolean;
  failed?: boolean;
};

async function hydrateOneBoardFile(
  fileId: string,
  meta: Record<string, unknown>,
  opts: { signal?: AbortSignal } = {},
): Promise<HydrateFileOutcome> {
  const record = meta && typeof meta === "object" ? meta : {};
  const rawUrl = String(record.dataURL || record.url || "");
  if (!rawUrl) {
    return {
      fileId,
      missing: true,
      meta: {
        ...record,
        id: record.id || fileId,
        mimeType: record.mimeType || "image/png",
        dataURL: MISSING_IMAGE_DATA_URL,
        url: MISSING_IMAGE_DATA_URL,
        status: "error",
      },
    };
  }
  // Уже data:/blob: — только decode для надёжного первого кадра.
  if (isTransientFileUrl(rawUrl)) {
    if (rawUrl.startsWith("blob:")) {
      try {
        const blob = await parseBlobUrl(rawUrl).then((p) => (
          p ? new Blob([p.bytes.buffer as ArrayBuffer], { type: p.mime }) : null
        ));
        if (blob) await decodeImageBlob(blob);
      } catch {
        /* best-effort */
      }
    }
    return { fileId, meta: { ...record, id: record.id || fileId } };
  }

  try {
    const blob = await fetchAssetAsBlob(rawUrl);
    if (opts.signal?.aborted) {
      return { fileId, meta: { ...record, id: record.id || fileId }, failed: true };
    }
    await decodeImageBlob(blob);
    if (opts.signal?.aborted) {
      return { fileId, meta: { ...record, id: record.id || fileId }, failed: true };
    }
    const objectUrl = URL.createObjectURL(blob);
    return {
      fileId,
      blobUrl: objectUrl,
      meta: {
        ...record,
        id: record.id || fileId,
        mimeType: record.mimeType || blob.type || "image/png",
        dataURL: objectUrl,
        url: objectUrl,
        [STABLE_URL_KEY]: rawUrl,
        created: record.created || Date.now(),
      },
    };
  } catch {
    return {
      fileId,
      failed: true,
      meta: {
        ...record,
        id: record.id || fileId,
        mimeType: record.mimeType || "image/png",
        dataURL: MISSING_IMAGE_DATA_URL,
        url: MISSING_IMAGE_DATA_URL,
        [STABLE_URL_KEY]: rawUrl,
        status: "error",
      },
    };
  }
}

export type HydrateMissingResult = HydrateBoardFilesResult & {
  fetchedFileIds: string[];
  fromCacheFileIds: string[];
};

export function hydrateMissingDidWork(result: HydrateMissingResult): boolean {
  return (
    result.fetchedFileIds.length > 0
    || result.fromCacheFileIds.length > 0
    || result.blobUrls.length > 0
    || result.failedFileIds.length > 0
    || result.missingFileIds.length > 0
  );
}

export type BoardFileHydrator = {
  hydrateMissing(
    files: SceneFiles | null | undefined,
    localFiles?: SceneFiles | null,
    opts?: { signal?: AbortSignal },
  ): Promise<HydrateMissingResult>;
  needsHydrate(files: SceneFiles | null | undefined, localFiles?: SceneFiles | null): boolean;
  remember(files: SceneFiles | null | undefined): void;
  reset(): void;
  isHydrated(fileId: string): boolean;
  isInFlight(fileId: string): boolean;
};

/**
 * Single-flight гидратация по fileId: один HTTP GET на файл, общий Promise
 * для параллельных remote-событий, cache успешных (и терминальных) результатов.
 */
export function createBoardFileHydrator(): BoardFileHydrator {
  let generation = 0;
  const inFlight = new Map<string, Promise<HydrateFileOutcome>>();
  const hydratedIds = new Set<string>();
  const hydratedMeta = new Map<string, Record<string, unknown>>();

  const remember = (files: SceneFiles | null | undefined) => {
    if (!files || typeof files !== "object") return;
    for (const [fileId, meta] of Object.entries(files)) {
      if (!meta || typeof meta !== "object") continue;
      const url = String(meta.dataURL || meta.url || "");
      if (isTransientFileUrl(url) || meta.status === "error") {
        hydratedIds.add(fileId);
        hydratedMeta.set(fileId, meta);
      }
    }
  };

  const getOrStartFlight = (
    fileId: string,
    meta: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<HydrateFileOutcome> => {
    const existing = inFlight.get(fileId);
    if (existing) return existing;
    const gen = generation;
    const promise = hydrateOneBoardFile(fileId, meta, { signal }).then((outcome) => {
      if (generation === gen && !signal?.aborted) {
        hydratedIds.add(fileId);
        hydratedMeta.set(fileId, outcome.meta);
      }
      return outcome;
    }).finally(() => {
      if (generation === gen) inFlight.delete(fileId);
    });
    inFlight.set(fileId, promise);
    return promise;
  };

  return {
    remember,
    reset() {
      generation += 1;
      inFlight.clear();
      hydratedIds.clear();
      hydratedMeta.clear();
    },
    isHydrated: (fileId) => hydratedIds.has(fileId),
    isInFlight: (fileId) => inFlight.has(fileId),
    needsHydrate(files, localFiles) {
      return filesNeedRemoteHydrate(files, localFiles);
    },
    async hydrateMissing(files, localFiles, opts) {
      const subset = collectFilesNeedingRemoteHydrate(files, localFiles);
      const blobUrls: string[] = [];
      const missingFileIds: string[] = [];
      const failedFileIds: string[] = [];
      const resultFiles: SceneFiles = {};
      const fetchedFileIds: string[] = [];
      const fromCacheFileIds: string[] = [];
      const ids = Object.keys(subset);
      if (!ids.length) {
        return {
          files: {},
          blobUrls,
          missingFileIds,
          failedFileIds,
          fetchedFileIds,
          fromCacheFileIds,
        };
      }

      const applyOutcome = (outcome: HydrateFileOutcome) => {
        resultFiles[outcome.fileId] = outcome.meta;
        if (outcome.blobUrl) blobUrls.push(outcome.blobUrl);
        if (outcome.missing) missingFileIds.push(outcome.fileId);
        if (outcome.failed) failedFileIds.push(outcome.fileId);
      };

      const workIds: string[] = [];
      for (const fileId of ids) {
        const cached = hydratedMeta.get(fileId);
        if (cached && hydratedIds.has(fileId)) {
          resultFiles[fileId] = cached;
          fromCacheFileIds.push(fileId);
          continue;
        }
        workIds.push(fileId);
      }

      await mapPool(workIds, HYDRATE_CONCURRENCY, async (fileId) => {
        const outcome = await getOrStartFlight(fileId, subset[fileId], opts?.signal);
        fetchedFileIds.push(fileId);
        applyOutcome(outcome);
      });

      return {
        files: resultFiles,
        blobUrls,
        missingFileIds,
        failedFileIds,
        fetchedFileIds,
        fromCacheFileIds,
      };
    },
  };
}

/**
 * Перед монтированием Excalidraw: стабильные API URL → blob URL + decode.
 * Excalidraw надёжно рисует blob/data с первого кадра; raw /api/... часто
 * «молчит» до remount (особенно в iframe комнаты урока).
 *
 * Стабильный URL сохраняется в itfluxStableURL для persist/live.
 */
export async function hydrateBoardFiles(
  files: SceneFiles | null | undefined,
  opts: { signal?: AbortSignal } = {},
): Promise<HydrateBoardFilesResult> {
  if (!files || typeof files !== "object") {
    return { files: {}, blobUrls: [], missingFileIds: [], failedFileIds: [] };
  }

  const blobUrls: string[] = [];
  const missingFileIds: string[] = [];
  const failedFileIds: string[] = [];
  const next: SceneFiles = { ...files };
  const entries = Object.entries(files).filter(([, meta]) => meta && typeof meta === "object");

  await mapPool(entries, HYDRATE_CONCURRENCY, async ([fileId, meta]) => {
    if (opts.signal?.aborted) return;
    const outcome = await hydrateOneBoardFile(fileId, meta as Record<string, unknown>, opts);
    next[fileId] = outcome.meta;
    if (outcome.blobUrl) blobUrls.push(outcome.blobUrl);
    if (outcome.missing) missingFileIds.push(fileId);
    if (outcome.failed) failedFileIds.push(fileId);
  });

  return { files: next, blobUrls, missingFileIds, failedFileIds };
}

export function revokeBoardBlobUrls(urls: Iterable<string> | null | undefined): void {
  if (!urls) return;
  for (const url of urls) {
    if (typeof url === "string" && url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }
}

/** fileId изображений в elements, для которых нет записи в files. */
export function findMissingImageFileIds(
  elements: unknown[] | null | undefined,
  files: SceneFiles | null | undefined,
): string[] {
  const fileMap = files || {};
  const missing: string[] = [];
  for (const raw of elements || []) {
    if (!raw || typeof raw !== "object") continue;
    const el = raw as { type?: string; fileId?: string; isDeleted?: boolean };
    if (el.isDeleted || el.type !== "image" || !el.fileId) continue;
    if (!fileMap[el.fileId]) missing.push(el.fileId);
  }
  return missing;
}

export { STABLE_URL_KEY, MISSING_IMAGE_DATA_URL };
