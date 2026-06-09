import {
  RUN_LIMITS,
  validateFileContent,
  validateUploadSize,
  validateVfsQuota,
} from "./limits";

function normalizeName(name: string) {
  return String(name || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()!;
}

export class VirtualFs {
  private files = new Map<string, string>();

  list(): string[] {
    return [...this.files.keys()].sort((a, b) => a.localeCompare(b, "ru"));
  }

  get(name: string): string | undefined {
    return this.files.get(normalizeName(name));
  }

  set(name: string, content: string) {
    const key = normalizeName(name);
    if (!key) return;

    const fileCheck = validateFileContent(key, content);
    if (!fileCheck.ok) {
      throw new Error(fileCheck.error);
    }

    const quotaCheck = validateVfsQuota(this.files, key, content);
    if (!quotaCheck.ok) {
      throw new Error(quotaCheck.error);
    }

    this.files.set(key, content);
  }

  delete(name: string) {
    this.files.delete(normalizeName(name));
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }

  mountPyodide(pyodide: { FS: { writeFile: (path: string, data: string) => void } }) {
    for (const [name, content] of this.files.entries()) {
      pyodide.FS.writeFile(`/home/user/${name}`, content);
    }
  }
}

const TEXT_EXT = /\.(txt|csv|py|dat|in|log|json|xml|html|htm|md)$/i;

export async function importTaskFiles(
  url: string,
  vfs: VirtualFs
): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Не удалось загрузить файл (${res.status})`);
  }

  const filename = decodeURIComponent(
    url.split("/").pop()?.split("?")[0] || "file"
  );
  const imported: string[] = [];

  if (/\.zip$/i.test(filename)) {
    const buffer = await res.arrayBuffer();
    const uploadCheck = validateUploadSize(buffer.byteLength);
    if (!uploadCheck.ok) {
      throw new Error(uploadCheck.error);
    }

    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter((e) => !e.dir);
    for (const entry of entries) {
      const base = entry.name.split("/").pop() || entry.name;
      if (!TEXT_EXT.test(base)) continue;
      try {
        const content = await entry.async("string");
        vfs.set(base, content);
        imported.push(base);
      } catch (e) {
        if (e instanceof Error && /слишком|максимум/i.test(e.message)) {
          throw e;
        }
        /* skip binary entries inside zip */
      }
    }
    if (!imported.length) {
      throw new Error("В архиве не найдено текстовых файлов (txt, csv, py…)");
    }
    return imported;
  }

  if (TEXT_EXT.test(filename)) {
    const content = await res.text();
    vfs.set(filename, content);
    imported.push(filename);
    return imported;
  }

  throw new Error(
    "Поддерживаются ZIP-архивы и текстовые файлы (txt, csv, py, dat, in…)"
  );
}

export { RUN_LIMITS };
