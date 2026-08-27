import { describe, expect, it, vi, afterEach } from "vitest";
import {
  attachStableUrls,
  collectFilesNeedingRemoteHydrate,
  createBoardFileHydrator,
  createStableUrlMap,
  externalizeSceneFiles,
  filesForLivePublish,
  filesForPersist,
  filesForRestPayload,
  filesNeedRemoteHydrate,
  hydrateMissingDidWork,
  markImageElementsSaved,
  pendingUploadFileIds,
  preferDisplayFile,
  preferStableFile,
  rememberStableUrls,
  STABLE_URL_KEY,
} from "./boardFiles";
import { mergeSceneFiles } from "./boardSceneMerge";

function bigPngDataUrl(bytesLength: number): string {
  const bytes = new Uint8Array(bytesLength);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes[2] = 0x4e;
  bytes[3] = 0x47;
  bytes[4] = 0x0d;
  bytes[5] = 0x0a;
  bytes[6] = 0x1a;
  bytes[7] = 0x0a;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(binary)}`;
}

describe("externalizeSceneFiles", () => {
  it("выгружает любые dataURL через upload (включая маленькие)", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "f1",
      dataURL: "/api/cabinet/interactive-boards/b/assets/a/",
      mimeType: "image/png",
    });
    const tiny = "data:image/png;base64,iVBORw0KGgo=";
    const out = await externalizeSceneFiles(
      { f1: { mimeType: "image/png", dataURL: tiny } },
      upload,
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(out.f1.dataURL).toBe("/api/cabinet/interactive-boards/b/assets/a/");
  });

  it("выгружает крупные PNG через upload", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "f1",
      dataURL: "/api/cabinet/interactive-boards/b/assets/a/",
      mimeType: "image/png",
    });
    const dataURL = bigPngDataUrl(250_000);
    const out = await externalizeSceneFiles(
      { f1: { mimeType: "image/png", dataURL } },
      upload,
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(out.f1.dataURL).toBe("/api/cabinet/interactive-boards/b/assets/a/");
  });

  it("отклоняет SVG dataURL", async () => {
    const svg = `data:image/svg+xml;base64,${btoa("<svg></svg>")}`;
    await expect(
      externalizeSceneFiles({ f1: { dataURL: svg } }, vi.fn()),
    ).rejects.toThrow(/SVG/);
  });

  it("filesForLivePublish отбрасывает blob/data", () => {
    const out = filesForLivePublish({
      a: { dataURL: "blob:http://local/1" },
      b: { dataURL: "data:image/png;base64,aaa" },
      c: { dataURL: "/api/cabinet/interactive-boards/b/assets/x/" },
    });
    expect(Object.keys(out)).toEqual(["c"]);
  });

  it("preferStableFile выбирает постоянный URL", () => {
    const stable = preferStableFile(
      { dataURL: "blob:http://x" },
      { dataURL: "/api/cabinet/interactive-boards/b/assets/x/" },
    );
    expect(stable.dataURL).toContain("/api/");
  });

  it("mergeSceneFiles сохраняет гидратированный blob того же asset", () => {
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    const merged = mergeSceneFiles(
      { f1: { dataURL: "blob:http://local/1", [STABLE_URL_KEY]: stable } },
      { f1: { dataURL: stable } },
    );
    expect((merged.f1 as { dataURL: string }).dataURL).toMatch(/^blob:/);
  });

  it("preferDisplayFile не затирает decoded blob стабильным URL", () => {
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    const picked = preferDisplayFile(
      { dataURL: "blob:http://local/1", [STABLE_URL_KEY]: stable },
      { dataURL: stable },
    );
    expect(String(picked.dataURL)).toMatch(/^blob:/);
  });

  it("filesForPersist пишет стабильный URL, не blob", () => {
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    const out = filesForPersist({
      f1: { dataURL: "blob:http://local/1", [STABLE_URL_KEY]: stable, mimeType: "image/png" },
    });
    expect(out.f1.dataURL).toBe(stable);
  });

  it("filesForRestPayload не отправляет data/blob в PATCH", () => {
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    const out = filesForRestPayload({
      f1: { dataURL: "blob:http://local/1", [STABLE_URL_KEY]: stable, mimeType: "image/png" },
      f2: { dataURL: "data:image/png;base64,aaaa", mimeType: "image/png" },
      f3: { dataURL: "blob:http://local/2", mimeType: "image/png" },
    });
    expect(Object.keys(out)).toEqual(["f1"]);
    expect(out.f1.dataURL).toBe(stable);
  });

  it("filesForLivePublish публикует стабильный URL из hydrate-метаданных", () => {
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    const out = filesForLivePublish({
      f1: { dataURL: "blob:http://local/1", [STABLE_URL_KEY]: stable },
      f2: { dataURL: "data:image/png;base64,aaa" },
    });
    expect(Object.keys(out)).toEqual(["f1"]);
    expect(out.f1.dataURL).toBe(stable);
  });

  it("filesNeedRemoteHydrate не блокирует штрихи, если blob уже локально", () => {
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    expect(filesNeedRemoteHydrate({ f1: { dataURL: stable } }, {
      f1: { dataURL: "blob:http://local/1", [STABLE_URL_KEY]: stable },
    })).toBe(false);
    expect(filesNeedRemoteHydrate({ f1: { dataURL: stable } }, {})).toBe(true);
    expect(filesNeedRemoteHydrate({}, {})).toBe(false);
    expect(collectFilesNeedingRemoteHydrate(
      {
        f1: { dataURL: stable },
        f2: { dataURL: "blob:http://local/2" },
      },
      { f1: { dataURL: "blob:http://local/1" } },
    )).toEqual({});
    expect(Object.keys(collectFilesNeedingRemoteHydrate(
      { f1: { dataURL: stable }, f2: { dataURL: "/api/cabinet/interactive-boards/b/assets/y/" } },
      { f1: { dataURL: "blob:http://local/1" } },
    ))).toEqual(["f2"]);
  });

  it("attachStableUrls восстанавливает ключ после onChange без кастомных полей", () => {
    const map = createStableUrlMap();
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    rememberStableUrls(map, { f1: { dataURL: stable } });
    // Как отдаёт Excalidraw BinaryFileData — только blob, без itfluxStableURL.
    const attached = attachStableUrls(
      { f1: { id: "f1", dataURL: "blob:http://local/1", mimeType: "image/png" } },
      map,
    );
    expect(attached.f1[STABLE_URL_KEY]).toBe(stable);
    expect(pendingUploadFileIds(attached, map)).toEqual([]);
    expect(filesForLivePublish(attached).f1.dataURL).toBe(stable);
  });

  it("pendingUploadFileIds не требует повторной загрузки при registry hit", () => {
    const map = createStableUrlMap();
    map.set("f1", "/api/cabinet/interactive-boards/b/assets/x/");
    const pending = pendingUploadFileIds(
      { f1: { dataURL: "blob:http://local/1", mimeType: "image/png" } },
      map,
    );
    expect(pending).toEqual([]);
  });

  it("markImageElementsSaved меняет pending → saved", () => {
    const out = markImageElementsSaved(
      [
        { id: "img1", type: "image", fileId: "f1", status: "pending", version: 1 },
        { id: "line1", type: "freedraw", version: 1 },
      ],
      ["f1"],
    ) as Array<{ id: string; status?: string; version?: number }>;
    expect(out.find((e) => e.id === "img1")?.status).toBe("saved");
    expect(out.find((e) => e.id === "img1")?.version).toBe(2);
    expect(out.find((e) => e.id === "line1")?.status).toBeUndefined();
  });

  it("externalizeSceneFiles пишет STABLE_URL_KEY", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "f1",
      dataURL: "/api/cabinet/interactive-boards/b/assets/a/",
      mimeType: "image/png",
    });
    const out = await externalizeSceneFiles(
      { f1: { mimeType: "image/png", dataURL: "data:image/png;base64,iVBORw0KGgo=" } },
      upload,
    );
    expect(out.f1[STABLE_URL_KEY]).toBe("/api/cabinet/interactive-boards/b/assets/a/");
  });
});

function assetUrl(fileId: string): string {
  return `/api/cabinet/interactive-boards/board-1/assets/${fileId}/`;
}

function sceneFiles(ids: string[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(ids.map((id) => [id, { id, dataURL: assetUrl(id), url: assetUrl(id), mimeType: "image/png" }]));
}

describe("createBoardFileHydrator single-flight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockAssetFetch() {
    const calls: string[] = [];
    const inflightByUrl = new Map<string, number>();
    const maxInflightByUrl = new Map<string, number>();
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      inflightByUrl.set(url, (inflightByUrl.get(url) || 0) + 1);
      maxInflightByUrl.set(url, Math.max(maxInflightByUrl.get(url) || 0, inflightByUrl.get(url)!));
      await new Promise((r) => setTimeout(r, 40));
      inflightByUrl.set(url, (inflightByUrl.get(url) || 1) - 1);
      const size = url.includes("big") ? 700_000 : 32;
      return new Response(new Blob([new Uint8Array(size)], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    return { calls, maxInflightByUrl };
  }

  it("событие B до окончания A не делает второй GET того же fileId", async () => {
    const { calls, maxInflightByUrl } = mockAssetFetch();
    const hydrator = createBoardFileHydrator();
    const files = sceneFiles(["img-a"]);

    const a = hydrator.hydrateMissing(files, {});
    expect(hydrator.isInFlight("img-a")).toBe(true);
    const b = hydrator.hydrateMissing(files, {});

    const [ra, rb] = await Promise.all([a, b]);
    expect(calls.filter((u) => u.includes("img-a")).length).toBe(1);
    expect(maxInflightByUrl.get(assetUrl("img-a"))).toBe(1);
    expect(hydrateMissingDidWork(ra)).toBe(true);
    expect(hydrateMissingDidWork(rb)).toBe(true);
    expect(filesNeedRemoteHydrate(files, ra.files)).toBe(false);
    expect(filesNeedRemoteHydrate(files, rb.files)).toBe(false);
  });

  it("не скачивает локальный blob, уже hydrated и in-flight file", async () => {
    const { calls } = mockAssetFetch();
    const hydrator = createBoardFileHydrator();
    const files = sceneFiles(["img-a", "img-b"]);
    const first = await hydrator.hydrateMissing(files, {});
    expect(calls.filter((u) => u.includes("/assets/")).length).toBe(2);

    const again = await hydrator.hydrateMissing(files, {});
    expect(again.fetchedFileIds).toEqual([]);
    expect(calls.filter((u) => u.includes("/assets/")).length).toBe(2);

    const withLocalBlob = await hydrator.hydrateMissing(
      files,
      { "img-a": first.files["img-a"], "img-b": first.files["img-b"] },
    );
    expect(hydrateMissingDidWork(withLocalBlob)).toBe(false);
    expect(calls.filter((u) => u.includes("/assets/")).length).toBe(2);
  });

  it("учитель+ученик, 3 картинки (~700KB), частые scene updates: 1 GET на fileId на клиента", async () => {
    const { calls, maxInflightByUrl } = mockAssetFetch();
    const teacher = createBoardFileHydrator();
    const student = createBoardFileHydrator();
    const files = sceneFiles(["img-small-1", "img-small-2", "img-big"]);

    const burst = (h: ReturnType<typeof createBoardFileHydrator>) =>
      Promise.all(Array.from({ length: 30 }, () => h.hydrateMissing(files, {})));

    const [teacherResults, studentResults] = await Promise.all([burst(teacher), burst(student)]);

    for (const id of ["img-small-1", "img-small-2", "img-big"]) {
      const url = assetUrl(id);
      expect(calls.filter((u) => u === url).length).toBe(2);
      expect(maxInflightByUrl.get(url)).toBeLessThanOrEqual(2);
      expect(teacher.isHydrated(id)).toBe(true);
      expect(student.isHydrated(id)).toBe(true);
    }

    const lastTeacher = teacherResults[teacherResults.length - 1];
    const lastStudent = studentResults[studentResults.length - 1];
    expect(filesNeedRemoteHydrate(files, lastTeacher.files)).toBe(false);
    expect(filesNeedRemoteHydrate(files, lastStudent.files)).toBe(false);

    const teacherAgain = await teacher.hydrateMissing(files, lastTeacher.files);
    const studentAgain = await student.hydrateMissing(files, lastStudent.files);
    expect(hydrateMissingDidWork(teacherAgain)).toBe(false);
    expect(hydrateMissingDidWork(studentAgain)).toBe(false);
    expect(calls.filter((u) => u.includes("/assets/")).length).toBe(6);
  });

  it("reset при смене boardId снова разрешает GET", async () => {
    const { calls } = mockAssetFetch();
    const hydrator = createBoardFileHydrator();
    const files = sceneFiles(["img-a"]);
    await hydrator.hydrateMissing(files, {});
    hydrator.reset();
    expect(hydrator.isHydrated("img-a")).toBe(false);
    await hydrator.hydrateMissing(files, {});
    expect(calls.filter((u) => u.includes("img-a")).length).toBe(2);
  });
});

