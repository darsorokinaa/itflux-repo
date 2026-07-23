/** Загрузка каталога уровней и предметов из БД (`/api/catalog/`). */

export type CatalogSubject = {
  id: string;
  title: string;
};

export type CatalogLevel = {
  id: string;
  label: string;
  subjects: CatalogSubject[];
};

type CatalogApiRow = {
  level?: string;
  level_rus?: string;
  subjects?: Array<{ subject_short?: string; subject_name?: string }>;
};

export function parseCatalogPayload(data: unknown): CatalogLevel[] {
  const rows = Array.isArray((data as { catalog?: unknown })?.catalog)
    ? ((data as { catalog: CatalogApiRow[] }).catalog)
    : [];
  return rows
    .map((row) => {
      const id = String(row?.level || "").trim().toLowerCase();
      if (!id) return null;
      const subjects = Array.isArray(row?.subjects)
        ? row.subjects
          .map((s) => {
            const sid = String(s?.subject_short || "").trim().toLowerCase();
            if (!sid) return null;
            return {
              id: sid,
              title: String(s?.subject_name || "").trim() || sid,
            };
          })
          .filter(Boolean) as CatalogSubject[]
        : [];
      return {
        id,
        label: String(row?.level_rus || "").trim() || id,
        subjects,
      };
    })
    .filter(Boolean) as CatalogLevel[];
}

export async function fetchExamCatalog(): Promise<CatalogLevel[]> {
  const res = await fetch("/api/catalog/", { credentials: "same-origin" });
  if (!res.ok) return [];
  const data = await res.json();
  return parseCatalogPayload(data);
}
