import { describe, expect, it, vi } from "vitest";
import {
  externalizeSceneFiles,
  filesForLivePublish,
  filesForPersist,
  preferDisplayFile,
  preferStableFile,
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

  it("filesForLivePublish публикует стабильный URL из hydrate-метаданных", () => {
    const stable = "/api/cabinet/interactive-boards/b/assets/x/";
    const out = filesForLivePublish({
      f1: { dataURL: "blob:http://local/1", [STABLE_URL_KEY]: stable },
      f2: { dataURL: "data:image/png;base64,aaa" },
    });
    expect(Object.keys(out)).toEqual(["f1"]);
    expect(out.f1.dataURL).toBe(stable);
  });
});
