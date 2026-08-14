import { describe, expect, it } from "vitest";
import { AUTOSAVE_DEBOUNCE_MS, isBoardPersistableChange } from "./boardAutosave";
import { compactBoardScene, summarizeBoardScene } from "./boardSceneCompact";

function makeFreedraw(id: string, opts: { deleted?: boolean; points?: number } = {}) {
  const n = opts.points ?? 80;
  const points = Array.from({ length: n }, (_, i) => [i, Math.sin(i / 3) * 8]);
  return {
    id,
    type: "freedraw",
    x: 10,
    y: 20,
    width: n,
    height: 16,
    angle: 0,
    isDeleted: Boolean(opts.deleted),
    version: opts.deleted ? 4 : 2,
    versionNonce: 1,
    updated: 1,
    index: id,
    points,
    pressures: points.map((_, i) => 0.4 + (i % 5) * 0.05),
    simulatePressure: false,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1.5,
    roughness: 0,
    opacity: 100,
  };
}

function makeHeavyScene() {
  const elements = [
    ...Array.from({ length: 1500 }, (_, i) => makeFreedraw(`live-${i}`, { points: 60 })),
    ...Array.from({ length: 1700 }, (_, i) => makeFreedraw(`del-${i}`, { deleted: true, points: 90 })),
    { id: "img-1", type: "image", fileId: "used-img", isDeleted: false, version: 1 },
    { id: "img-gone", type: "image", fileId: "deleted-img", isDeleted: true, version: 3, points: [[0, 0]] },
  ];
  const unusedData = `data:image/png;base64,${"A".repeat(80_000)}`;
  const files = {
    "used-img": { mimeType: "image/png", dataURL: "/api/cabinet/interactive-boards/x/assets/a/" },
    "deleted-img": { mimeType: "image/png", dataURL: "/api/cabinet/interactive-boards/x/assets/b/" },
    "orphan-1": { mimeType: "image/png", dataURL: unusedData },
    "orphan-2": { mimeType: "image/png", dataURL: unusedData },
  };
  return { elements, appState: { viewBackgroundColor: "#fff" }, files };
}

describe("compactBoardScene", () => {
  it("сжимает deleted freedraw и выбрасывает неиспользуемые files, не трогая живые элементы", () => {
    const scene = makeHeavyScene();
    const before = summarizeBoardScene(scene);
    const result = compactBoardScene(scene);

    expect(result.changed).toBe(true);
    expect(result.statsAfter.liveCount).toBe(before.liveCount);
    expect(result.statsAfter.deletedCount).toBe(before.deletedCount);
    expect(result.statsAfter.elementCount).toBe(before.elementCount);
    expect(result.statsAfter.unusedFileCount).toBe(0);
    expect(result.statsAfter.fileCount).toBe(2);
    expect(result.scene.files["used-img"]).toBeTruthy();
    expect(result.scene.files["deleted-img"]).toBeTruthy();
    expect(result.scene.files["orphan-1"]).toBeUndefined();

    const live = result.scene.elements.find((raw) => (raw as { id: string }).id === "live-0") as {
      points: unknown[];
    };
    expect(live.points).toHaveLength(60);

    const deleted = result.scene.elements.find((raw) => (raw as { id: string }).id === "del-0") as {
      points: unknown[];
      isDeleted: boolean;
      id: string;
      version: number;
    };
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.id).toBe("del-0");
    expect(deleted.version).toBe(4);
    expect(deleted.points).toEqual([[0, 0]]);
    expect(result.statsAfter.sceneBytes).toBeLessThan(result.statsBefore.sceneBytes / 2);
  });

  it("печатает безопасные BEFORE/AFTER метрики (без содержимого доски)", () => {
    const scene = makeHeavyScene();
    const result = compactBoardScene(scene);
    const fmt = (s: typeof result.statsBefore) => ({
      sceneKb: Math.round(s.sceneBytes / 102.4) / 10,
      elementsKb: Math.round(s.elementsBytes / 102.4) / 10,
      filesKb: Math.round(s.filesBytes / 102.4) / 10,
      elements: s.elementCount,
      deleted: s.deletedCount,
      live: s.liveCount,
      files: s.fileCount,
      unusedFiles: s.unusedFileCount,
    });
    // eslint-disable-next-line no-console
    console.info("[board-compact-metrics]", JSON.stringify({ before: fmt(result.statsBefore), after: fmt(result.statsAfter) }));
    expect(result.statsAfter.liveCount).toBe(result.statsBefore.liveCount);
  });

  it("повторный compact идемпотентен", () => {
    const once = compactBoardScene(makeHeavyScene());
    const twice = compactBoardScene(once.scene);
    expect(twice.changed).toBe(false);
    expect(twice.statsAfter.sceneBytes).toBe(once.statsAfter.sceneBytes);
    expect(twice.statsAfter.elementCount).toBe(once.statsAfter.elementCount);
    expect(twice.statsAfter.fileCount).toBe(once.statsAfter.fileCount);
  });

  it("пустая/нормальная сцена не меняется", () => {
    const empty = compactBoardScene({ elements: [], appState: {}, files: {} });
    expect(empty.changed).toBe(false);

    const normal = compactBoardScene({
      elements: [makeFreedraw("a", { points: 12 })],
      appState: { viewBackgroundColor: "#fff" },
      files: {},
    });
    expect(normal.changed).toBe(false);
    expect(normal.scene.elements).toHaveLength(1);
  });
});

describe("isBoardPersistableChange — pan vs содержимое", () => {
  const files = { f1: { dataURL: "blob:1" } };

  it("viewport-only (pan/zoom) не требует сохранения", () => {
    expect(
      isBoardPersistableChange({
        prevVersionSum: 100,
        nextVersionSum: 100,
        prevElementCount: 40,
        nextElementCount: 40,
        prevRawFiles: files,
        nextRawFiles: files,
        prevBackground: "#fff",
        nextBackground: "#fff",
        prevGrid: "none",
        nextGrid: "none",
        prevTheme: "light",
        nextTheme: "light",
      }),
    ).toBe(false);
  });

  it("первый onChange (files ref ещё не зафиксирован) не считает смену файлов", () => {
    expect(
      isBoardPersistableChange({
        prevVersionSum: 10,
        nextVersionSum: 10,
        prevElementCount: 2,
        nextElementCount: 2,
        prevRawFiles: null,
        nextRawFiles: files,
      }),
    ).toBe(false);
  });

  it("копия files с теми же ключами не выглядит как правка", () => {
    const attachedCopy = { ...files };
    expect(
      isBoardPersistableChange({
        prevVersionSum: 10,
        nextVersionSum: 10,
        prevElementCount: 2,
        nextElementCount: 2,
        prevRawFiles: files,
        nextRawFiles: attachedCopy,
      }),
    ).toBe(false);
    expect(attachedCopy !== files).toBe(true);
  });

  it("рисование (version++) и новый файл требуют сохранения", () => {
    expect(
      isBoardPersistableChange({
        prevVersionSum: 10,
        nextVersionSum: 11,
        prevElementCount: 2,
        nextElementCount: 2,
        prevRawFiles: files,
        nextRawFiles: files,
      }),
    ).toBe(true);
    expect(
      isBoardPersistableChange({
        prevVersionSum: 10,
        nextVersionSum: 10,
        prevElementCount: 2,
        nextElementCount: 2,
        prevRawFiles: files,
        nextRawFiles: { ...files, f2: { dataURL: "blob:2" } },
      }),
    ).toBe(true);
  });

  it("за 10 секунд pan не планирует десятки сохранений", () => {
    const frames = 60 * 10;
    let persistable = 0;
    let oldLogicPersistable = 0;
    let lastAttached: Record<string, unknown> | null = null;
    for (let i = 0; i < frames; i += 1) {
      const attached = { ...files };
      if (
        isBoardPersistableChange({
          prevVersionSum: 500,
          nextVersionSum: 500,
          prevElementCount: 3200,
          nextElementCount: 3200,
          prevRawFiles: files,
          nextRawFiles: attached,
        })
      ) {
        persistable += 1;
      }
      // Старое сравнение: lastFilesRef хранил attachStableUrls-копию.
      if (lastAttached !== files) oldLogicPersistable += 1;
      lastAttached = attached;
    }
    expect(persistable).toBe(0);
    expect(oldLogicPersistable).toBe(frames);
    const oldSavesIfDebounced = Math.ceil((frames / 60) * 1000 / AUTOSAVE_DEBOUNCE_MS);
    expect(oldSavesIfDebounced).toBeGreaterThan(10);
  });
});
