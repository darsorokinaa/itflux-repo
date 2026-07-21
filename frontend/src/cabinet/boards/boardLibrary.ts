/** Персистентность и стартовый набор библиотеки Excalidraw. */

const STORAGE_KEY = "itflux-excalidraw-library-v1";

type LibraryItem = {
  id: string;
  status: "published" | "unpublished";
  elements: readonly unknown[];
  created: number;
  name?: string;
};

type LibraryPersistedData = {
  libraryItems: LibraryItem[];
};

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Минимальные фигуры без convertToExcalidrawElements (чтобы не тянуть тяжёлый импорт в тестах). */
function baseShape(
  type: "rectangle" | "ellipse" | "diamond" | "arrow",
  opts: { width: number; height: number; backgroundColor?: string },
) {
  const id = uid(type);
  const common = {
    id,
    type,
    x: 0,
    y: 0,
    width: opts.width,
    height: opts.height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: opts.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed: Math.floor(Math.random() * 2 ** 31),
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
  if (type === "arrow") {
    return {
      ...common,
      type: "arrow" as const,
      points: [
        [0, 0],
        [opts.width, opts.height],
      ],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
    };
  }
  return common;
}

export function getStarterLibraryItems(): LibraryItem[] {
  const now = Date.now();
  return [
    {
      id: uid("lib"),
      status: "published",
      name: "Прямоугольник",
      created: now,
      elements: [baseShape("rectangle", { width: 140, height: 90, backgroundColor: "#a5d8ff" })],
    },
    {
      id: uid("lib"),
      status: "published",
      name: "Овал",
      created: now - 1,
      elements: [baseShape("ellipse", { width: 140, height: 90, backgroundColor: "#b2f2bb" })],
    },
    {
      id: uid("lib"),
      status: "published",
      name: "Ромб",
      created: now - 2,
      elements: [baseShape("diamond", { width: 120, height: 120, backgroundColor: "#ffec99" })],
    },
    {
      id: uid("lib"),
      status: "published",
      name: "Стрелка",
      created: now - 3,
      elements: [baseShape("arrow", { width: 160, height: 40 })],
    },
  ];
}

export const boardLibraryAdapter = {
  async load(_meta?: { source: "load" | "save" }): Promise<LibraryPersistedData | null> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LibraryPersistedData;
        if (Array.isArray(parsed?.libraryItems) && parsed.libraryItems.length > 0) {
          return parsed;
        }
      }
    } catch {
      /* ignore */
    }
    return { libraryItems: getStarterLibraryItems() };
  },

  async save(libraryData: LibraryPersistedData): Promise<void> {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(libraryData));
    } catch {
      /* quota / private mode */
    }
  },
};
